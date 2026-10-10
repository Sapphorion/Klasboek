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
    if (j.stop_reason === 'max_tokens') throw new Error('The response was too long and got cut off. Try again, or pick a bigger model in Settings.');
    if (block) return block.input;
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = jsonFrom(text);
    if (parsed) return parsed;
    messages.push({ role: 'assistant', content: j.content?.length ? j.content : [{ type: 'text', text: '…' }] },
      { role: 'user', content: `Please give the result by calling the ${tool.name} tool now.` });
  }
  throw new Error('Claude did not return structured content. Try again.');
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
    throw new Error(msg);
  }
  return res.json();
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
    worksheet: {
      type: 'object',
      properties: {
        title: { type: 'string' }, instructions: { type: 'string' },
        questions: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, q: { type: 'string' }, marks: { type: 'integer' }, answer: { type: 'string', description: 'Memo answer' }, lines: { type: 'integer', description: 'Answer lines to leave' } }, required: ['q', 'marks', 'answer'] } },
      },
      required: ['title', 'instructions', 'questions'],
    },
  },
  required: ['title', 'objectives', 'phases', 'slides', 'worksheet'],
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
${ctx.lessonOfWeek ? `This is lesson ${ctx.lessonOfWeek.n} of ${ctx.lessonOfWeek.total} on this topic this week, so focus on the part that fits that position.` : ''}
${ctx.notes ? 'Teacher notes: ' + ctx.notes : ''}
${ctx.upcomingTest ? (ctx.upcomingTest.sameDay ? `Learners write "${ctx.upcomingTest.title}" (${ctx.upcomingTest.type}) on the day of this lesson; keep the lesson short and supportive around it.` : `Learners write "${ctx.upcomingTest.title}" (${ctx.upcomingTest.type}) on ${ctx.upcomingTest.date}. Build in revision and exam-style practice that prepares them for it.`) : ''}
Worksheet: about ${ctx.worksheetMarks || 20} marks.`,
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
