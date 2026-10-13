// All calls to Claude live here, so a future paid version can route them through a
// server (with accounts and billing) by changing only this file.
import { state } from './state.js';

const API = 'https://api.anthropic.com/v1/messages';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — best balance (recommended)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, cheapest' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most thorough' },
];

export const aiReady = () => !!(state.settings.aiEnabled && state.settings.apiKey && navigator.onLine);
export function aiUnavailableReason() {
  if (!state.settings.aiEnabled) return 'AI is switched off in Settings.';
  if (!state.settings.apiKey) return 'Add your Claude API key in Settings to use AI.';
  if (!navigator.onLine) return 'You are offline. AI needs internet; templates still work.';
  return '';
}

// Models sometimes send a list as a JSON string ("[{…}]"), or as an object with numbered keys.
// Put lists back into shape wherever one is expected, so nothing downstream trips over it.
const LIST_KEYS = new Set(['blocks', 'slides', 'cards', 'criteria', 'levels', 'options', 'items', 'terms', 'rows', 'fns', 'points', 'instructions', 'bullets', 'descriptors',
  'questions', 'phases', 'objectives', 'vocabulary', 'sections', 'keyPoints', 'resources', 'events', 'cells', 'periods', 'topics', 'weeks', 'notes_sections']);
function asList(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^[\[{]/.test(t)) { try { return asList(JSON.parse(t)); } catch { /* cut off or not JSON */ } }
    if (/^\[/.test(t)) throw new Error('The AI’s answer came back incomplete. Please try again (a shorter piece, or fewer marks, helps).');
    return t.split('\n').map(x => x.trim()).filter(Boolean);
  }
  if (typeof v === 'object') { const keys = Object.keys(v); if (keys.length && keys.every(k => /^\d+$/.test(k))) return keys.sort((a, b) => a - b).map(k => v[k]); return [v]; }
  return [v];
}
export function repair(x, key = '') {
  if (LIST_KEYS.has(key)) x = asList(x);
  if (Array.isArray(x)) return x.map(v => repair(v, key === 'rows' ? 'row' : ''));
  if (key === 'row' && !Array.isArray(x)) return asList(x);
  if (x && typeof x === 'object') { for (const k of Object.keys(x)) x[k] = repair(x[k], k); return x; }
  return x;
}

// The AI answers as a stream, so long pieces (a 50-mark test with a memo and diagrams) don't time out,
// and the teacher sees progress instead of a frozen button.
let progressFn = null;
export function onAiProgress(fn) { progressFn = fn; return () => { if (progressFn === fn) progressFn = null; }; }

async function call({ system, content, tool, maxTokens = 8000 }) {
  const reason = aiUnavailableReason();
  if (reason) throw new Error(reason);
  // Newer models don't accept a forced tool_choice, so the tool is offered with "auto"
  // and the system prompt tells Claude to answer through it. One retry if it doesn't.
  const sys = `${system}\n\nAlways answer by calling the ${tool.name} tool exactly once with the complete result. Do not write any other text.`;
  const messages = [{ role: 'user', content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = await post({ system: sys, messages, tool, maxTokens });
    const block = j.content?.find(b => b.type === 'tool_use' && b.name === tool.name);
    if (j.stop_reason === 'max_tokens') throw new Error('The answer was too long and got cut off. Try a shorter piece or fewer marks, or pick Claude Opus in Settings.');
    if (block && block.input && Object.keys(block.input).length) return repair(unwrap(block.input, tool));
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = jsonFrom(text);
    if (parsed) return repair(unwrap(parsed, tool));
    messages.push({ role: 'assistant', content: j.content?.length ? j.content : [{ type: 'text', text: '…' }] },
      { role: 'user', content: `Please give the complete result by calling the ${tool.name} tool now.` });
  }
  throw new Error('Claude didn’t send anything back that Klasboek could use. Please try again.');
}

// Sometimes the result arrives wrapped, e.g. {"save_material": {...}} or {"input": {...}}.
function unwrap(x, tool) {
  const want = Object.keys(tool.schema?.properties || {});
  const has = o => o && typeof o === 'object' && want.some(k => k in o);
  if (has(x)) return x;
  for (const v of Object.values(x || {})) {
    if (has(v)) return v;
    if (typeof v === 'string' && /^\s*\{/.test(v)) { try { const o = JSON.parse(v); if (has(o)) return o; } catch {} }
  }
  return x;
}

async function post({ system, messages, tool, maxTokens }) {
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': state.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: state.settings.model || MODELS[0].id,
        max_tokens: maxTokens,
        system,
        messages,
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
        tool_choice: { type: 'auto' },
        stream: true,
      }),
    });
  } catch {
    throw new Error('Could not reach Claude. Check your internet connection.');
  }
  if (!res.ok) {
    let msg = `Claude API error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    if (res.status === 401) msg = 'Your API key was rejected. Check it in Settings.';
    if (res.status === 402 || /credit balance/i.test(msg)) msg = 'Your Claude account has no credit left. Top up under Billing at platform.claude.com.';
    if (res.status === 429) msg = 'Rate limit reached. Wait a minute and try again.';
    if (res.status === 529 || res.status === 503) msg = 'Claude is busy right now. Try again in a minute.';
    if (res.status === 404 && /model/i.test(msg)) msg = 'That AI model isn’t available on your account. Pick another model in Settings.';
    throw new Error(msg);
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('event-stream') || !res.body) return res.json(); // (proxies or tests that answer in one go)
  return readStream(res.body);
}

// Server-sent events → the same shape as a normal (non-streamed) reply.
async function readStream(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const out = { content: [], stop_reason: null };
  const json = [];
  let buf = '', chars = 0, lastTick = 0;
  const tick = () => {
    if (Date.now() - lastTick < 250) return;
    lastTick = Date.now();
    const all = json.join('');
    const q = (all.match(/"type"\s*:\s*"question"/g) || []).length;
    const sl = (all.match(/"bullets"\s*:/g) || []).length;
    const msg = (q ? `${q} question${q > 1 ? 's' : ''} written…` : sl ? `${sl} slide${sl > 1 ? 's' : ''} written…` : `Writing… ${Math.round(chars / 100) / 10}k characters`);
    progressFn?.(msg); window.dispatchEvent(new CustomEvent('ai-progress', { detail: msg }));
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'content_block_start') { out.content[ev.index] = { ...ev.content_block }; if (ev.content_block.type === 'tool_use') json[ev.index] = ''; }
      else if (ev.type === 'content_block_delta') {
        const b = out.content[ev.index];
        if (ev.delta.type === 'input_json_delta') { json[ev.index] = (json[ev.index] || '') + ev.delta.partial_json; chars += ev.delta.partial_json.length; tick(); }
        else if (ev.delta.type === 'text_delta' && b) { b.text = (b.text || '') + ev.delta.text; chars += ev.delta.text.length; tick(); }
      } else if (ev.type === 'message_delta') { if (ev.delta?.stop_reason) out.stop_reason = ev.delta.stop_reason; }
      else if (ev.type === 'error') throw new Error(ev.error?.type === 'overloaded_error' ? 'Claude is busy right now. Try again in a minute.' : (ev.error?.message || 'Claude stopped with an error. Try again.'));
    }
  }
  out.content = out.content.filter(Boolean);
  out.content.forEach((b, k) => {
    if (b.type !== 'tool_use') return;
    const raw = json[k] || '';
    if (!raw.trim()) { b.input = b.input || {}; return; }
    try { b.input = JSON.parse(raw); }
    catch { b.input = {}; if (!out.stop_reason || out.stop_reason === 'end_turn') out.stop_reason = 'max_tokens'; }
  });
  return out;
}

function jsonFrom(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function testKey() {
  const r = await call({
    system: 'Reply using the tool.',
    content: 'Say hello to a South African teacher in five words.',
    tool: { name: 'reply', description: 'Reply', schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    maxTokens: 100,
  });
  return r.text;
}

// ---------- ATP ----------
const ATP_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'integer', description: 'Term number 1-4' },
          week: { type: 'integer', description: 'First week of term this topic is taught' },
          weekEnd: { type: 'integer', description: 'Last week if it spans several weeks, else same as week' },
          topic: { type: 'string', description: 'Short topic name as in the ATP' },
          details: { type: 'string', description: 'Concepts, skills, content and assessment notes for that week, one point per line' },
        },
        required: ['term', 'week', 'topic', 'details'],
      },
    },
  },
  required: ['items'],
};

export async function aiParseAtp(text, subject) {
  const r = await call({
    system: 'You extract South African CAPS Annual Teaching Plans (ATPs) into clean structured data. Keep the wording of topics and concepts faithful to the document. Do not invent content that is not in the text.',
    content: `Subject: ${subject.name}${subject.grade ? ', Grade ' + subject.grade : ''}.\nBelow is text extracted from an ATP document. It may be jumbled because it came from a table. Return every teaching week as an item (term, week, topic, details). If one topic covers several weeks, give week and weekEnd. Include formal assessment tasks as their own items where the ATP lists them.\n\n---\n${text.slice(0, 120000)}`,
    tool: { name: 'save_atp', description: 'Save the structured ATP', schema: ATP_SCHEMA },
    maxTokens: 16000,
  });
  return r.items || [];
}

// ---------- Timetable from a photo ----------
export async function aiReadTimetable(dataUrl, days) {
  const [meta, b64] = dataUrl.split(',');
  const media = meta.match(/data:(.*?);/)[1];
  return call({
    system: 'You read school timetables from images accurately. Only report what is visible.',
    content: [
      { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
      { type: 'text', text: `This is a teacher's timetable. Days in the app are: ${days.join(', ')} (dayIndex 0 = ${days[0]}). List the teaching periods (label and times if shown) and every cell that has a lesson. For each cell give the subject as written and the class/group (e.g. 9B) if shown. Skip breaks. If it is a two-week cycle (Week A and Week B, or Day 1 to Day 10), set week to 1 for Week A / Days 1-5 and 2 for Week B / Days 6-10, with dayIndex 0-4 inside that week. Otherwise set week to 1.` },
    ],
    tool: {
      name: 'save_timetable', description: 'Save the timetable',
      schema: {
        type: 'object',
        properties: {
          periods: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, start: { type: 'string', description: 'HH:MM 24h or empty' }, end: { type: 'string', description: 'HH:MM 24h or empty' } }, required: ['label'] } },
          cells: { type: 'array', items: { type: 'object', properties: { week: { type: 'integer', description: '1 = Week A (or the only week), 2 = Week B' }, dayIndex: { type: 'integer' }, periodIndex: { type: 'integer', description: '0-based index into periods' }, subject: { type: 'string' }, cls: { type: 'string' }, room: { type: 'string' } }, required: ['dayIndex', 'periodIndex', 'subject'] } },
        },
        required: ['periods', 'cells'],
      },
    },
    maxTokens: 6000,
  });
}

// ---------- Lesson content ----------
const NOTES_SCHEMA = {
  type: 'object', description: 'Summarised learner notes (1-2 pages) learners keep and revise from',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string', description: 'One or two sentences' },
    sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string', description: 'Clear explanation in short paragraphs, with a worked example where it fits' }, bullets: { type: 'array', items: { type: 'string' } } }, required: ['heading', 'text'] } },
    keyPoints: { type: 'array', items: { type: 'string' }, description: '4-8 key points to remember' },
  },
  required: ['title', 'sections', 'keyPoints'],
};

export const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    objectives: { type: 'array', items: { type: 'string' }, description: 'Learners will be able to… (3-5)' },
    priorKnowledge: { type: 'string' },
    vocabulary: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, meaning: { type: 'string' } }, required: ['term', 'meaning'] } },
    resources: { type: 'array', items: { type: 'string' } },
    phases: {
      type: 'array', description: 'Introduction, development/main teaching, learner activity, consolidation',
      items: { type: 'object', properties: { name: { type: 'string' }, minutes: { type: 'integer' }, teacher: { type: 'string', description: 'What the teacher does and says' }, learners: { type: 'string', description: 'What learners do' } }, required: ['name', 'minutes', 'teacher', 'learners'] },
    },
    assessment: { type: 'string', description: 'Informal assessment / checking for understanding' },
    differentiation: { type: 'object', properties: { support: { type: 'string' }, extension: { type: 'string' } } },
    homework: { type: 'string' },
    slides: {
      type: 'array', description: '6-12 classroom slides. Short bullets learners can read from the back of a class.',
      items: { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string', description: 'Teacher speaker notes' } }, required: ['title', 'bullets'] },
    },
    notes: NOTES_SCHEMA,
    worksheet: {
      type: 'object',
      properties: {
        title: { type: 'string' }, instructions: { type: 'string' },
        questions: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, q: { type: 'string' }, marks: { type: 'integer' }, answer: { type: 'string', description: 'Memo answer' }, lines: { type: 'integer', description: 'Answer lines to leave' } }, required: ['q', 'marks', 'answer'] } },
      },
      required: ['title', 'instructions', 'questions'],
    },
  },
  required: ['title', 'objectives', 'phases', 'slides', 'worksheet', 'notes'],
};

export async function aiLessonContent(ctx) {
  const lang = ctx.language && ctx.language !== 'English' ? `Write everything in ${ctx.language}.` : 'Write in South African English.';
  return call({
    system: `You are an experienced South African teacher writing CAPS-aligned lesson materials. Use South African contexts, names, places and Rand amounts where examples need them. Be practical for a real classroom of 30-45 learners with limited resources. Questions must have correct memo answers and follow CAPS cognitive levels (mix of knowledge, routine, complex). ${lang}`,
    content: `Write a complete lesson.
Subject: ${ctx.subject}
Grade: ${ctx.grade || 'not specified'}
Class: ${ctx.cls || '-'}
Lesson length: ${ctx.minutes} minutes (phase minutes must add up to this)
ATP topic: ${ctx.topic}
ATP content for this week:
${ctx.details || '(none given)'}
${ctx.subtopic ? `This lesson focuses on: ${ctx.subtopic}. Keep the lesson on that part of the topic.\n` : ''}${ctx.textbook ? `Textbook guidance: learners use the Siyavula open textbook (${ctx.textbook.book}), ${ctx.textbook.chapter}; most relevant sections: ${ctx.textbook.sections.join('; ')}. Follow its sequence, terminology and notation, and refer learners to it (${ctx.textbook.url}) for reading and extra exercises.\n` : ''}${ctx.lessonOfWeek ? `This is lesson ${ctx.lessonOfWeek.n} of ${ctx.lessonOfWeek.total} on this topic this week, so focus on the part that fits that position.` : ''}
${ctx.notes ? 'Teacher notes: ' + ctx.notes : ''}
${ctx.upcomingTest ? (ctx.upcomingTest.sameDay ? `Learners write "${ctx.upcomingTest.title}" (${ctx.upcomingTest.type}) on the day of this lesson; keep the lesson short and supportive around it.` : `Learners write "${ctx.upcomingTest.title}" (${ctx.upcomingTest.type}) on ${ctx.upcomingTest.date}. Build in revision and exam-style practice that prepares them for it.`) : ''}
Worksheet (the class activity): about ${ctx.worksheetMarks || 20} marks.
Also write summarised learner notes for this lesson that learners keep and revise from.`,
    tool: { name: 'save_lesson', description: 'Save the lesson materials', schema: CONTENT_SCHEMA },
    maxTokens: 12000,
  });
}

// ---------- School calendar (year planner, test/exam timetable) ----------
const EVENTS_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD if it spans several days, else empty' },
          title: { type: 'string', description: 'Short title as written, e.g. "Gr 10 Mathematics P1" or "Schools open"' },
          type: { type: 'string', enum: ['exam', 'test', 'deadline', 'holiday', 'meeting', 'event'] },
          time: { type: 'string', description: 'e.g. 08:00 or 08:00–10:00, else empty' },
          grade: { type: 'string', description: 'Grade number or R if the event is for one grade, else empty' },
          subject: { type: 'string', description: 'Subject name if it is a test or exam, else empty' },
          noTeaching: { type: 'boolean', description: 'True if there is no normal teaching that day (public holiday, school closed, staff development day)' },
        },
        required: ['date', 'title', 'type'],
      },
    },
  },
  required: ['events'],
};

export async function aiReadCalendar({ text, image, pdf }, kind, year) {
  const what = kind === 'assessments' ? 'a test and exam timetable' : 'a school year planner (calendar of events)';
  const intro = `This is ${what} from a South African school. The year is ${year} unless the document says otherwise. List every dated item. For exam or test timetables, make one item per grade and subject paper. Use type "holiday" for public holidays and days without school.`;
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.split(';')[0].slice(5), data: image.split(',')[1] } }, { type: 'text', text: intro }]
    : pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: intro }]
    : `${intro}\n\n---\n${String(text).slice(0, 120000)}`;
  const r = await call({
    system: 'You extract dates and events from school documents accurately. Only report what is in the document.',
    content,
    tool: { name: 'save_events', description: 'Save the calendar events', schema: EVENTS_SCHEMA },
    maxTokens: 16000,
  });
  return (r.events || []).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).map(e => ({
    date: e.date, endDate: /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') && e.endDate > e.date ? e.endDate : '',
    title: e.title || '', type: e.type || 'event', time: e.time || '', grade: e.grade || '', subject: e.subject || '', noTeaching: !!e.noTeaching || e.type === 'holiday',
  }));
}

// ---------- Moderation notice ----------
export async function aiReadNotice({ text, image, pdf }, year) {
  const intro = `This is a moderation notice or circular sent to a South African teacher. Today is in ${year}. Extract what the teacher must do: a short title, the moderation level, subject and grade if given, the due date (when the work must be submitted or moderation happens), the list of items to submit or prepare, and any other notes (venue, who to give it to, format).`;
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.split(';')[0].slice(5), data: image.split(',')[1] } }, { type: 'text', text: intro }]
    : pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: intro }]
    : `${intro}\n\n---\n${String(text).slice(0, 60000)}`;
  const r = await call({
    system: 'You extract tasks and deadlines from school notices accurately. Only report what the notice says.',
    content,
    tool: { name: 'save_notice', description: 'Save the moderation notice', schema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, level: { type: 'string', enum: ['School', 'Cluster', 'District', 'Provincial', ''] },
        subject: { type: 'string' }, grade: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD or empty' },
        items: { type: 'array', items: { type: 'string' }, description: 'Things to submit or prepare, one per item' },
        notes: { type: 'string' },
      },
      required: ['title', 'items'],
    } },
    maxTokens: 4000,
  });
  return { title: r.title || '', level: r.level || '', subject: r.subject || '', grade: r.grade || '', due: /^\d{4}-\d{2}-\d{2}$/.test(r.due || '') ? r.due : '', items: r.items || [], notes: r.notes || '' };
}

// ---------- Create: materials ----------
const BLOCK_ITEM = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['heading', 'text', 'list', 'box', 'vocab', 'section', 'question', 'table', 'pagebreak', 'image', 'graph', 'diagram'] },
    text: { type: 'string', description: 'Heading text, paragraph text (blank line between paragraphs, **bold** allowed), box text, or section instructions' },
    title: { type: 'string', description: 'Box title or section title (e.g. "Multiple choice")' },
    style: { type: 'string', enum: ['key', 'info', 'warn'], description: 'Box style' },
    items: { type: 'array', items: { type: 'string' }, description: 'Bullet list items' },
    terms: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, meaning: { type: 'string' } }, required: ['term', 'meaning'] }, description: 'Vocabulary rows' },
    q: { type: 'string', description: 'Question text' },
    marks: { type: 'integer' },
    cog: { type: 'integer', description: 'Cognitive level 1-4 (see the level names given)' },
    kind: { type: 'string', enum: ['open', 'mcq'] },
    options: { type: 'array', items: { type: 'string' }, description: 'For mcq: exactly 4 options, one correct' },
    answer: { type: 'string', description: 'Memo: the expected answer with mark allocation, e.g. "Photosynthesis ✓ (1)". For mcq give the letter and the option.' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Table rows; first row is the header' },
    ref: { type: 'integer', description: 'For image and diagram blocks you were given: keep the ref' },
    fns: { type: 'array', items: { type: 'string' }, description: 'Graph block: up to 4 functions, e.g. "f(x) = x^2 - 4", "g(x) = 2x + 1", "y = 3sin x" (trig in degrees)' },
    xmin: { type: 'number' }, xmax: { type: 'number' }, ymin: { type: 'number' }, ymax: { type: 'number' },
    points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' } }, required: ['x', 'y'] }, description: 'Graph block: labelled points, e.g. turning point A' },
    svg: { type: 'string', description: 'Diagram block: a simple, clean, black-and-white SVG line drawing (viewBox about 0 0 400 300, stroke black, white fill, readable text labels, no colour needed, no external images). Must be scientifically correct.' },
    prompt: { type: 'string', description: 'Diagram block: one sentence describing what the drawing shows' },
    caption: { type: 'string', description: 'Graph, diagram or image caption, e.g. "Figure 1"' },
  },
  required: ['type'],
};
const DOC_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, time: { type: 'integer', description: 'Minutes, tests only' }, instructions: { type: 'array', items: { type: 'string' }, description: 'Cover instructions, tests only' }, blocks: { type: 'array', items: BLOCK_ITEM } }, required: ['title', 'blocks'] };
const SLIDES_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string', description: 'Teacher speaker notes' }, imageRef: { type: 'integer', description: 'Keep if given' } }, required: ['title', 'bullets'] } } }, required: ['title', 'slides'] };
const RUBRIC_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, task: { type: 'string' }, levels: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, marks: { type: 'string', description: 'e.g. "4" or "7-8"' } }, required: ['label', 'marks'] } }, criteria: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, descriptors: { type: 'array', items: { type: 'string' }, description: 'One per level, same order as levels' } }, required: ['name', 'descriptors'] } } }, required: ['title', 'levels', 'criteria'] };
const CARDS_SCHEMA = { type: 'object', properties: { title: { type: 'string' }, cards: { type: 'array', items: { type: 'object', properties: { term: { type: 'string', description: 'One word or a short phrase' }, meaning: { type: 'string', description: 'Clear, short definition for the grade' } }, required: ['term', 'meaning'] } } }, required: ['title', 'cards'] };
const schemaFor = type => ({ test: DOC_SCHEMA, worksheet: DOC_SCHEMA, notes: DOC_SCHEMA, slides: SLIDES_SCHEMA, rubric: RUBRIC_SCHEMA, cards: CARDS_SCHEMA }[type]);

const CREATE_SYSTEM = lang => `You are an experienced South African teacher creating CAPS-aligned classroom materials. Use South African contexts, names, places and Rand amounts where examples need them. Be accurate: every memo answer must be correct. Memo answers show the mark split with ticks, e.g. "x = 3 ✓ (1)" or "photosynthesis ✓ uses light energy ✓ (2)", and the ticks add up to the question's marks. When a question needs a graph, add a "graph" block right before it (functions and axis ranges). When it needs a labelled diagram (cell, circuit, apparatus, triangle, food web), add a "diagram" block with a clean, compact SVG line drawing (simple shapes, no more than about 60 elements). Use them where a real paper would, not on every question, and at most three diagrams per piece. Pitch language and difficulty at the grade given. ${lang && lang !== 'English' ? `Write everything in ${lang}.` : 'Write in South African English.'}`;

function brief(type, o) {
  const lv = (o.levelNames || []).map((n, i) => `${i + 1} = ${n} (target ${o.levelTargets?.[i] ?? '?'}% of marks)`).join('; ');
  const what = {
    test: `A formal test${o.marks ? ` of ${o.marks} marks` : ''}${o.time ? `, ${o.time} minutes` : ''}. Use "section" blocks (each becomes QUESTION 1, QUESTION 2 …) with "question" blocks inside. Mix question types: some multiple choice (kind "mcq", 1 mark each), short and longer questions. Give every question marks, a cognitive level (cog) and a full memo answer. Spread marks across cognitive levels to match the targets: ${lv}. Also give test instructions and time.`,
    worksheet: `A worksheet${o.count ? ` with about ${o.count} questions` : ''}${o.marks ? `, about ${o.marks} marks` : ''}. Start with a short instruction paragraph. Optional sections. Give every question marks, a cog level (${lv}) and a memo answer.`,
    notes: `Learner notes / summary${o.length === 'short' ? ' (one page)' : o.length === 'long' ? ' (3-4 pages)' : ' (about two pages)'}: headings, clear explanations in short paragraphs, bullet lists, at least one "box" with key facts, a worked example where it fits, and a vocabulary block with the key terms.`,
    slides: `A slide deck of about ${o.count || 10} slides: a hook, objectives, teaching slides with short bullets learners can read from the back of the class, an activity slide and a recap. Add speaker notes.`,
    rubric: `An assessment rubric with ${o.levelsCount || 4} levels (best first) and ${o.count || 5} criteria. Descriptors must be specific and observable. Give each level a mark or mark range.`,
    cards: `${o.count || 16} flashcards with key terms and short definitions.`,
  }[type];
  return `${what}
Subject: ${o.subject || 'not specified'}
Grade: ${o.grade || 'not specified'}
Title or topic: ${o.topic || ''}
${o.details ? 'ATP content to cover:\n' + o.details : ''}
${o.sourceText ? 'Use this source material:\n---\n' + o.sourceText.slice(0, 40000) + '\n---' : ''}
${o.extra ? 'Teacher’s instructions: ' + o.extra : ''}`;
}

export async function aiCreate(type, o) {
  return call({
    system: CREATE_SYSTEM(o.language),
    content: brief(type, o),
    tool: { name: 'save_material', description: 'Save the material', schema: schemaFor(type) },
    maxTokens: 32000,
  });
}

// Change an existing material by instruction ("make it easier", "add two diagram questions").
export async function aiRevise(type, current, instruction, o) {
  return call({
    system: CREATE_SYSTEM(o.language) + ' You are revising an existing material. Keep everything the teacher did not ask to change. Keep image blocks / imageRef values exactly as given.',
    content: `Subject: ${o.subject || ''}. Grade: ${o.grade || ''}.${o.levelNames ? ' Cognitive levels: ' + o.levelNames.map((n, i) => `${i + 1} = ${n}`).join('; ') + '.' : ''}
Teacher’s request: ${instruction}

Current material (JSON):
${JSON.stringify(current).slice(0, 60000)}`,
    tool: { name: 'save_material', description: 'Save the revised material', schema: schemaFor(type) },
    maxTokens: 32000,
  });
}

// ---------- Tell the planner ----------
export async function aiTell(text, weekDates, periods, year) {
  const r = await call({
    system: 'You turn a South African teacher’s short note about their school week into calendar entries. Only include what the note says.',
    content: `The week on screen: ${weekDates.map(d => `${d.label} = ${d.date}`).join(', ')}. Year ${year}.
Periods: ${periods.map(p => `${p.label}${p.start ? ' (' + p.start + '–' + p.end + ')' : ''}`).join(', ')}.
For each thing that changes the school day give an item. effect: "none" = no normal lessons all day; "periods" = only some periods are lost (list their labels); "note" = lessons go ahead, it is just a note; "normal" = a normal school day (no entry needed).
Teacher’s note: ${text}`,
    tool: { name: 'save_week', description: 'Save what happens this week', schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' }, endDate: { type: 'string', description: 'YYYY-MM-DD or empty' }, title: { type: 'string' },
      effect: { type: 'string', enum: ['none', 'periods', 'note', 'normal'] }, periods: { type: 'array', items: { type: 'string' }, description: 'Period labels lost' },
    }, required: ['date', 'title', 'effect'] } } }, required: ['items'] } },
    maxTokens: 3000,
  });
  return r.items || [];
}

export async function aiLessonNotes(ctx) {
  const lang = ctx.language && ctx.language !== 'English' ? `Write everything in ${ctx.language}.` : 'Write in South African English.';
  return call({
    system: `You are an experienced South African teacher writing CAPS-aligned learner notes. Clear, accurate, at the right level for the grade, with South African examples. ${lang}`,
    content: `Write summarised learner notes (1-2 pages) for this lesson.\nSubject: ${ctx.subject}\nGrade: ${ctx.grade || 'not specified'}\nTopic: ${ctx.topic}${ctx.subtopic ? '\nFocus of this lesson: ' + ctx.subtopic : ''}\nATP content:\n${ctx.details || '(none given)'}${ctx.textbook ? `\nTextbook: Siyavula ${ctx.textbook.book}, ${ctx.textbook.chapter} (sections: ${ctx.textbook.sections.join('; ')}). Match its terminology and notation.` : ''}${ctx.notes ? '\nTeacher notes: ' + ctx.notes : ''}`,
    tool: { name: 'save_notes', description: 'Save the notes', schema: NOTES_SCHEMA },
    maxTokens: 8000,
  });
}

// One labelled diagram as a clean SVG line drawing.
export async function aiDiagram(prompt, o = {}) {
  const r = await call({
    system: CREATE_SYSTEM(o.language) + ' You draw clear, correct diagrams for school papers as simple SVG.',
    content: `Draw this for a ${o.subject || ''} ${o.grade ? 'Grade ' + o.grade : ''} paper: ${prompt}
Rules: black lines on white, stroke-width 2, viewBox about 0 0 400 300, labels in Arial 14px with label lines where needed, no colour unless asked, no external images or fonts. Leave label text blank (or use letters A, B, C…) if the question asks learners to identify the parts.`,
    tool: { name: 'save_diagram', description: 'Save the drawing', schema: { type: 'object', properties: { svg: { type: 'string' }, caption: { type: 'string' } }, required: ['svg'] } },
    maxTokens: 8000,
  });
  return { svg: r.svg || '', caption: r.caption || '' };
}
