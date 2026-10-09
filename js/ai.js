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
  const res = await fetch(API, {
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
      messages: [{ role: 'user', content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  });
  if (!res.ok) {
    let msg = `Claude API error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    if (res.status === 401) msg = 'Your API key was rejected. Check it in Settings.';
    if (res.status === 429) msg = 'Rate limit reached. Wait a minute and try again.';
    throw new Error(msg);
  }
  const j = await res.json();
  const block = j.content?.find(b => b.type === 'tool_use');
  if (!block) throw new Error('Claude did not return structured content. Try again.');
  if (j.stop_reason === 'max_tokens') throw new Error('The response was too long and got cut off. Try a shorter section or a bigger model.');
  return block.input;
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
      { type: 'text', text: `This is a teacher's timetable. Days in the app are: ${days.join(', ')} (dayIndex 0 = ${days[0]}). List the teaching periods (label and times if shown) and every cell that has a lesson. For each cell give the subject as written and the class/group (e.g. 9B) if shown. Skip breaks.` },
    ],
    tool: {
      name: 'save_timetable', description: 'Save the timetable',
      schema: {
        type: 'object',
        properties: {
          periods: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, start: { type: 'string', description: 'HH:MM 24h or empty' }, end: { type: 'string', description: 'HH:MM 24h or empty' } }, required: ['label'] } },
          cells: { type: 'array', items: { type: 'object', properties: { dayIndex: { type: 'integer' }, periodIndex: { type: 'integer', description: '0-based index into periods' }, subject: { type: 'string' }, cls: { type: 'string' }, room: { type: 'string' } }, required: ['dayIndex', 'periodIndex', 'subject'] } },
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
Worksheet: about ${ctx.worksheetMarks || 20} marks.`,
    tool: { name: 'save_lesson', description: 'Save the lesson materials', schema: CONTENT_SCHEMA },
    maxTokens: 12000,
  });
}
