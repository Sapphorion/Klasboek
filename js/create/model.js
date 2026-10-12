// Materials made in Create: the data model, numbering and totals, and offline starting templates.
//
// Tests, worksheets and notes are a list of blocks (heading, text, question…).
// Slides, rubrics and flashcards have their own simple shapes.
import { state, subjectById, atpById } from '../state.js';
import { graphDefaults, cleanSvg } from './graph.js';
import { repair } from '../ai.js';

export const TYPES = [
  { id: 'test', label: 'Test or exam', icon: 'doc', blurb: 'Sections, mark allocation, memo and a cognitive-level grid.' },
  { id: 'worksheet', label: 'Worksheet', icon: 'sheet', blurb: 'Questions with answer space, for class or homework, with a memo.' },
  { id: 'notes', label: 'Notes or summary', icon: 'book', blurb: 'Headings, explanations, key-fact boxes, vocabulary and pictures.' },
  { id: 'slides', label: 'Slides', icon: 'slides', blurb: 'A themed slide deck with speaker notes.' },
  { id: 'rubric', label: 'Rubric', icon: 'grid', blurb: 'Criteria and level descriptors for a task or project.' },
  { id: 'cards', label: 'Flashcards and word search', icon: 'clip', blurb: 'Terms and meanings: cut-out cards, a glossary, or a word search.' },
];
export const typeInfo = id => TYPES.find(t => t.id === id) || TYPES[0];
export const isBlockDoc = c => ['test', 'worksheet', 'notes'].includes(c.type);

export const BLOCKS = [
  { id: 'heading', label: 'Heading' },
  { id: 'text', label: 'Paragraph' },
  { id: 'list', label: 'Bullet list' },
  { id: 'box', label: 'Highlight box' },
  { id: 'vocab', label: 'Vocabulary table' },
  { id: 'section', label: 'Question section' },
  { id: 'question', label: 'Question' },
  { id: 'image', label: 'Picture' },
  { id: 'graph', label: 'Graph' },
  { id: 'diagram', label: 'Diagram (drawn by AI)' },
  { id: 'table', label: 'Table' },
  { id: 'lines', label: 'Writing lines' },
  { id: 'pagebreak', label: 'Page break' },
];
export const blockLabel = t => BLOCKS.find(b => b.id === t)?.label || t;

export function newBlock(type) {
  switch (type) {
    case 'heading': return { type, text: 'Heading' };
    case 'text': return { type, text: '' };
    case 'list': return { type, items: [''] };
    case 'box': return { type, title: 'Remember', text: '', style: 'key' };
    case 'vocab': return { type, items: [{ term: '', meaning: '' }] };
    case 'section': return { type, title: 'Section', text: '' };
    case 'question': return { type, q: '', marks: 2, cog: 1, kind: 'open', options: [], answer: '', lines: null };
    case 'image': return { type, src: '', caption: '', width: 60 };
    case 'graph': return graphDefaults();
    case 'diagram': return { type, prompt: '', svg: '', caption: '', width: 60 };
    case 'table': return { type, rows: [['Heading 1', 'Heading 2'], ['', '']] };
    case 'lines': return { type, count: 5 };
    case 'pagebreak': return { type };
    default: return { type: 'text', text: '' };
  }
}

// ---------- Cognitive levels ----------
// Starting targets only. Teachers should set these to their subject's CAPS / Programme of Assessment policy.
export const COG_PRESETS = {
  maths: { names: ['Knowledge', 'Routine procedures', 'Complex procedures', 'Problem solving'], targets: [20, 35, 30, 15] },
  science: { names: ['Recall', 'Comprehension', 'Application and analysis', 'Evaluation and synthesis'], targets: [15, 40, 35, 10] },
  language: { names: ['Literal', 'Reorganisation', 'Inference', 'Evaluation and appreciation'], targets: [20, 20, 40, 20] },
  general: { names: ['Remembering', 'Understanding', 'Applying and analysing', 'Evaluating and creating'], targets: [30, 40, 20, 10] },
};
export function cogPresetFor(subjectName = '') {
  const s = subjectName.toLowerCase();
  if (/math|wisk/.test(s) && !/literacy|geletterd/.test(s)) return 'maths';
  if (/physical|natural|technical sci|fisiese|natuurwet/.test(s)) return 'science';
  if (/language|english|afrikaans|isixhosa|isizulu|sesotho|setswana|sepedi|huistaal|addisionele/.test(s)) return 'language';
  return 'general';
}

// ---------- Numbering and totals ----------
// Sections become QUESTION 1, QUESTION 2 …; questions inside them 1.1, 1.2 …; questions before any section 1, 2 ….
export function numberBlocks(blocks) {
  const labels = new Map();
  let sec = 0, q = 0, loose = 0;
  blocks.forEach((b, i) => {
    if (b.type === 'section') { sec++; q = 0; labels.set(i, `QUESTION ${sec}`); }
    else if (b.type === 'question') {
      if (sec) { q++; labels.set(i, `${sec}.${q}`); } else { loose++; labels.set(i, String(loose)); }
    }
  });
  return labels;
}
export const questionMarks = b => Math.max(0, +b.marks || 0);
export function sectionTotals(blocks) {
  const totals = new Map(); let cur = -1;
  blocks.forEach((b, i) => {
    if (b.type === 'section') { cur = i; totals.set(i, 0); }
    else if (b.type === 'question' && cur >= 0) totals.set(cur, totals.get(cur) + questionMarks(b));
  });
  return totals;
}
export const totalMarks = blocks => blocks.filter(b => b.type === 'question').reduce((a, b) => a + questionMarks(b), 0);

export function cogGrid(c) {
  const qs = (c.blocks || []).filter(b => b.type === 'question');
  const total = totalMarks(c.blocks || []) || 1;
  const names = c.meta?.levelNames || COG_PRESETS.general.names;
  const targets = c.meta?.levelTargets || COG_PRESETS.general.targets;
  return names.map((name, i) => {
    const marks = qs.filter(b => (+b.cog || 1) === i + 1).reduce((a, b) => a + questionMarks(b), 0);
    return { level: i + 1, name, marks, pct: Math.round(marks / total * 100), target: targets[i] ?? 0 };
  });
}

// ---------- New materials ----------
export function blankCreation(type, { subjectId = '', grade = '', title = '', atpId = '', sourceText = '' } = {}) {
  const subj = subjectById(subjectId);
  const preset = COG_PRESETS[cogPresetFor(subj?.name)];
  const c = {
    type, title: title || typeInfo(type).label, subjectId, grade: grade || subj?.grade || '', language: subj?.language || 'English',
    source: { atpId, text: sourceText },
    design: { theme: type === 'test' ? 'classic' : 'modern', size: 'normal', header: type !== 'notes' && type !== 'slides', memo: ['test', 'worksheet'].includes(type), grid: type === 'test', cover: type === 'test' && state.settings.defaultCover ? state.settings.defaultCover : false, layout: 'cards' },
    meta: { time: type === 'test' ? 60 : 0, instructions: [], levelNames: preset.names, levelTargets: preset.targets, seed: Math.floor(Math.random() * 1e6) },
  };
  if (isBlockDoc(c)) c.blocks = [];
  if (type === 'slides') c.slides = [];
  if (type === 'rubric') c.rubric = { task: '', levels: defaultLevels(), criteria: [] };
  if (type === 'cards') c.cards = [];
  return c;
}
const defaultLevels = () => [{ label: 'Excellent', marks: '4' }, { label: 'Good', marks: '3' }, { label: 'Adequate', marks: '2' }, { label: 'Not yet', marks: '1' }];

// Offline starting point, filled from the ATP topic (or pasted text) where possible.
export function templateCreation(type, opts = {}) {
  const c = blankCreation(type, opts);
  const atp = atpById(opts.atpId);
  const topic = opts.title || atp?.topic || 'Topic';
  c.title = opts.title || (type === 'test' ? `${topic} test` : topic);
  const META = /^(resources|hulpbronne|informal assessment|formal assessment|assessment|sba)\b[^:]*:\s*/i;
  const lines = (atp?.details || opts.sourceText || '').split('\n').map(s => s.trim()).filter(l => l && !META.test(l)).slice(0, 8);
  const points = lines.length ? lines : [topic];
  const q = (text, marks, cog, extra = {}) => ({ type: 'question', q: text, marks, cog, kind: 'open', options: [], answer: '', lines: null, ...extra });

  if (type === 'test') {
    c.meta.instructions = ['Answer ALL the questions.', 'Write neatly and show all your working.', 'Number your answers exactly as the questions are numbered.'];
    c.blocks = [
      { type: 'section', title: 'Multiple choice', text: 'Choose the correct answer. Write only the letter (A–D).' },
      ...points.slice(0, 4).map(p => q(`Which statement about ${p.replace(/[.;:]$/, '').toLowerCase()} is correct?`, 1, 1, { kind: 'mcq', options: ['', '', '', ''] })),
      { type: 'section', title: 'Short questions', text: '' },
      ...points.slice(0, 4).map(p => q(`Define or describe: ${p.replace(/[.;:]$/, '')}.`, 2, 1)),
      { type: 'section', title: 'Longer questions', text: '' },
      ...points.slice(0, 3).map((p, i) => q(`Explain, using an example: ${p.replace(/[.;:]$/, '')}.`, 4, i < 2 ? 2 : 3)),
      q(`Apply what you have learnt about ${topic.toLowerCase()} to a new situation.`, 5, 4),
    ];
  } else if (type === 'worksheet') {
    c.blocks = [
      { type: 'text', text: 'Answer all the questions in the spaces provided.' },
      ...points.slice(0, 5).map(p => q(`Explain: ${p.replace(/[.;:]$/, '')}.`, 2, 1)),
      q(`Give your own example of ${topic.toLowerCase()} and explain it.`, 4, 3),
    ];
  } else if (type === 'notes') {
    c.blocks = [
      { type: 'text', text: `In this section you will learn about ${topic.toLowerCase()}.` },
      ...points.flatMap(p => [{ type: 'heading', text: p.replace(/[.;:]$/, '') }, { type: 'text', text: '' }]),
      { type: 'box', title: 'Key facts', text: '', style: 'key' },
      { type: 'vocab', items: [{ term: '', meaning: '' }, { term: '', meaning: '' }] },
    ];
  } else if (type === 'slides') {
    c.slides = [
      { title: 'Today we will', bullets: points.slice(0, 4), notes: '' },
      ...points.map(p => ({ title: p.replace(/[.;:]$/, '').slice(0, 70), bullets: [''], notes: '' })),
      { title: 'Recap', bullets: points.slice(0, 3).map(p => p.replace(/[.;:]$/, '') + '?'), notes: '' },
    ];
  } else if (type === 'rubric') {
    c.rubric.task = topic;
    c.rubric.criteria = ['Content and accuracy', 'Understanding of concepts', 'Organisation and presentation', 'Use of sources and evidence'].map(name => ({ name, descriptors: ['', '', '', ''] }));
  } else if (type === 'cards') {
    c.cards = points.slice(0, 8).map(p => ({ term: p.replace(/[.;:]$/, '').split(/[:–-]/)[0].trim().slice(0, 40), meaning: '' }));
  }
  return c;
}

// A lesson's worksheet or slides → a material you can design.
export function creationFromLesson(lesson, kind) {
  const c = blankCreation(kind, { subjectId: lesson.subjectId, title: lesson.content?.worksheet?.title || lesson.title, atpId: lesson.atpId });
  c.grade = subjectById(lesson.subjectId)?.grade || '';
  c.lessonId = lesson.id;
  if (kind === 'worksheet') {
    const ws = lesson.content.worksheet || { questions: [] };
    const out = [];
    if (ws.instructions) out.push({ type: 'text', text: ws.instructions });
    let sec = null;
    for (const qn of ws.questions) {
      if (qn.section && qn.section !== sec) { sec = qn.section; out.push({ type: 'section', title: sec, text: '' }); }
      out.push({ type: 'question', q: qn.q, marks: +qn.marks || 1, cog: 1, kind: 'open', options: [], answer: qn.answer || '', lines: qn.lines ?? null });
    }
    c.blocks = out;
  } else {
    c.title = lesson.content.title || lesson.title;
    c.slides = (lesson.content.slides || []).map(s => ({ title: s.title, bullets: s.bullets || [], notes: s.notes || '' }));
  }
  return c;
}

export const subjectNameOf = c => subjectById(c.subjectId)?.name || '';
export const schoolName = () => state.settings.school || '';

// ---------- AI <-> material ----------
// Pictures never go to the AI: they become numbered refs and are put back afterwards.
export function toAiJson(c) {
  if (isBlockDoc(c)) return {
    title: c.title, time: c.meta?.time || 0, instructions: c.meta?.instructions || [],
    blocks: (c.blocks || []).map((b, i) => b.type === 'image' ? { type: 'image', ref: i, title: b.caption || '' }
      : b.type === 'diagram' ? { type: 'diagram', ref: i, prompt: b.prompt || '', caption: b.caption || '' }
      : b.type === 'vocab' ? { type: 'vocab', terms: b.items } : b.type === 'lines' ? { type: 'text', text: `[${b.count} writing lines]` } : { ...b }),
  };
  if (c.type === 'slides') return { title: c.title, slides: (c.slides || []).map((s, i) => ({ title: s.title, bullets: s.bullets, notes: s.notes, ...(s.image ? { imageRef: i } : {}) })) };
  if (c.type === 'rubric') return { title: c.title, task: c.rubric.task, levels: c.rubric.levels, criteria: c.rubric.criteria };
  if (c.type === 'cards') return { title: c.title, cards: c.cards };
  return {};
}

export function applyAi(c, r, previous = null) {
  r = repair(r || {});
  if (r.title) c.title = r.title;
  if (isBlockDoc(c)) {
    if (c.type === 'test') { if (r.time) c.meta.time = r.time; if (r.instructions?.length) c.meta.instructions = r.instructions; }
    const old = previous?.blocks || [];
    const usedRefs = new Set();
    c.blocks = (r.blocks || []).map(b => {
      if (b.type === 'image') { const src = old[b.ref]; if (src?.type === 'image') { usedRefs.add(b.ref); return src; } return null; }
      if (b.type === 'diagram') {
        const prev = b.ref != null ? old[b.ref] : null;
        if (prev?.type === 'diagram' && !b.svg) { usedRefs.add(b.ref); return { ...prev, caption: b.caption ?? prev.caption }; }
        const svg = cleanSvg(b.svg || '');
        return svg ? { type: 'diagram', prompt: b.prompt || '', svg, caption: b.caption || '', width: 60 } : (b.prompt ? { type: 'diagram', prompt: b.prompt, svg: '', caption: b.caption || '', width: 60 } : null);
      }
      if (b.type === 'graph') return { ...graphDefaults(), fns: (b.fns || []).filter(Boolean).slice(0, 4), points: (b.points || []).filter(p => isFinite(+p.x) && isFinite(+p.y)).map(p => ({ x: +p.x, y: +p.y, label: p.label || '' })),
        xmin: isFinite(+b.xmin) && b.xmin !== undefined ? +b.xmin : -5, xmax: isFinite(+b.xmax) && b.xmax !== undefined ? +b.xmax : 5, ymin: isFinite(+b.ymin) && b.ymin !== undefined ? +b.ymin : -5, ymax: isFinite(+b.ymax) && b.ymax !== undefined ? +b.ymax : 5, caption: b.caption || '' };
      if (b.type === 'vocab') return { type: 'vocab', items: (b.terms || b.items || []).map(t => typeof t === 'string' ? { term: t, meaning: '' } : t) };
      if (b.type === 'question') return { type: 'question', q: b.q || b.text || '', marks: Math.max(0, +b.marks || 1), cog: Math.min(4, Math.max(1, +b.cog || 1)), kind: b.kind === 'mcq' ? 'mcq' : 'open', options: b.kind === 'mcq' ? (b.options || []).slice(0, 6) : [], answer: b.answer || '', lines: null };
      if (b.type === 'section') return { type: 'section', title: b.title || b.text || '', text: b.title ? (b.text || '') : '' };
      if (b.type === 'box') return { type: 'box', title: b.title || '', text: b.text || '', style: b.style || 'key' };
      if (b.type === 'list') return { type: 'list', items: b.items || [] };
      if (b.type === 'table') return { type: 'table', rows: b.rows?.length ? b.rows : [['']] };
      if (b.type === 'heading') return { type: 'heading', text: b.text || b.title || '' };
      if (b.type === 'pagebreak') return { type: 'pagebreak' };
      return { type: 'text', text: b.text || '' };
    }).filter(Boolean);
    // Pictures the AI dropped are kept at the end rather than lost.
    old.forEach((b, i) => { if ((b.type === 'image' || (b.type === 'diagram' && b.svg)) && !usedRefs.has(i) && !(r.blocks || []).some(x => x.ref === i)) c.blocks.push(b); });
  } else if (c.type === 'slides') {
    const old = previous?.slides || [];
    c.slides = (r.slides || []).map(s => ({ title: s.title || '', bullets: s.bullets || [], notes: s.notes || '', image: s.imageRef != null ? old[s.imageRef]?.image || '' : '' }));
  } else if (c.type === 'rubric') {
    c.rubric = { task: r.task ?? c.rubric.task, levels: (r.levels || []).map(l => ({ label: l.label, marks: String(l.marks ?? '') })), criteria: (r.criteria || []).map(cr => ({ name: cr.name, descriptors: (r.levels || []).map((_, k) => cr.descriptors?.[k] || '') })) };
  } else if (c.type === 'cards') {
    c.cards = (r.cards || []).map(x => ({ term: x.term || '', meaning: x.meaning || '' }));
  }
  return c;
}

// A lesson's learner notes → a notes material you can design.
export function creationFromNotes(lesson) {
  const n = lesson.content?.notes || {};
  const c = blankCreation('notes', { subjectId: lesson.subjectId, title: n.title || lesson.title, atpId: lesson.atpId });
  c.lessonId = lesson.id;
  const blocks = [];
  if (n.intro) blocks.push({ type: 'text', text: n.intro });
  for (const s of n.sections || []) {
    blocks.push({ type: 'heading', text: s.heading || '' });
    if (s.text) blocks.push({ type: 'text', text: s.text });
    if ((s.bullets || []).filter(Boolean).length) blocks.push({ type: 'list', items: s.bullets.filter(Boolean) });
  }
  if ((n.keyPoints || []).filter(Boolean).length) blocks.push({ type: 'box', title: 'Key points', text: n.keyPoints.filter(Boolean).map(k => '• ' + k).join('\n'), style: 'key' });
  if ((lesson.content?.vocabulary || []).length) blocks.push({ type: 'vocab', items: lesson.content.vocabulary.map(v => ({ ...v })) });
  c.blocks = blocks;
  return c;
}
