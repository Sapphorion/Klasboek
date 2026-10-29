// Create: make tests, worksheets, notes, slides, rubrics and flashcards, then design them
// with a live A4 preview.
import { siyavulaFor, chaptersOf } from '../siyavula.js';
import { poaTasks, taskById, taskLine, kindLabel, describeTask } from '../poa.js';
import { state, onChange, saveCreation, deleteCreation, creationById, subjectById, subjectLabel, atpById, classLabel } from '../state.js';
import { h, icon, toast, modal, confirmBox, busy, dropZone, esc } from '../ui.js';
import { aiCreate, aiRevise, aiReady, aiUnavailableReason, aiDiagram, aiCreateTest, aiTestSection } from '../ai.js';
import { extractText, matchSubject } from '../importers.js';
import { termWeekOf, today, fmt, addDays, mondayOf } from '../dates.js';
import { standardiseLevels } from '../create/model.js';
import { downloadBloomXlsx } from '../create/bloom.js';
import { TYPES, typeInfo, isBlockDoc, BLOCKS, blockLabel, newBlock, templateCreation, blankCreation, applyAi, toAiJson, numberBlocks, totalMarks, cogGrid, COG_PRESETS, cogPresetFor, creationFromLesson, creationFromNotes } from '../create/model.js';
import { THEMES, themeCss, renderCreation, printCreation, rubricMax } from '../create/render.js';
import { exportCreationDocx, exportCreationPptx } from '../create/export.js';
import { checkFor } from '../aicheck.js';
import { graphSvg, cleanSvg, rasterise, compile } from '../create/graph.js';
import { covers, coverById, openCoverEditor, coversSection, withCover } from '../create/covers.js';
import { openChecker } from './checker.js';
import { askFirst } from '../create/askfirst.js';

// Pop-out menus close when you tap somewhere else.
document.addEventListener('click', e => document.querySelectorAll('details.setup-menu[open], details.version-menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));

export function renderCreate(root, [id]) {
  const c = id && creationById(id);
  if (c) return designer(root, c);
  const draw = () => root.replaceChildren(listPage());
  const off = onChange(w => { if (['creations', 'subjects', 'lessons'].includes(w)) draw(); });
  draw();
  return off;
}

// ---------- Start page ----------
let filterSubject = '', filterType = '', search = '', planWeek = 0;
const EXAMPLES = [
  ['test', 'Grade 11 Maths test on functions, 50 marks, 1 hour, with graphs'],
  ['worksheet', 'Grade 9 NS worksheet on cells with a labelled diagram'],
  ['notes', 'One-page summary of electric circuits for Grade 10'],
  ['slides', '10 slides introducing photosynthesis for Grade 8'],
];
const GETS = {
  test: ['Sections and numbered questions', 'Marks per question and section totals', 'Memo with mark split', 'Cognitive-level grid', 'Graphs and diagrams'],
  worksheet: ['Questions with answer lines', 'Marks and a memo', 'Pictures, tables, graphs'],
  notes: ['Headings and short explanations', 'Key-fact boxes and vocabulary', 'Worked examples, diagrams'],
  slides: ['Title slide in your school colour', 'Short bullets and speaker notes', 'Pictures; export to PowerPoint'],
  rubric: ['Criteria × levels with marks', 'Learner name lines', 'Total out of'],
  cards: ['Cut-out cards (double-sided)', 'Glossary', 'Word search with answers'],
};

function listPage() {
  const page = h('div', { class: 'page create-page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Create'),
    h('p', { class: 'muted' }, 'Tests, worksheets, notes and slides with your school layout, memos, graphs and diagrams. Edit anything, make easier or harder versions, and export to Word, PowerPoint or PDF.')));
  page.append(askCard(), plannerCard());
  page.append(h('section', {}, h('h2', {}, 'Or start from scratch'),
    h('div', { class: 'type-grid' }, TYPES.map(t => h('button', { class: 'type-card', onclick: () => newDialog(t.id) },
      h('span', { class: 'tc-icon' }, icon(t.icon, 22)), h('strong', {}, t.label),
      h('ul', { class: 'tc-gets' }, (GETS[t.id] || []).map(g => h('li', {}, g))))))));
  page.append(coversSection(), materialsList());
  return page;
}

// "Tell it what you want"
function askCard() {
  const ta = h('textarea', { rows: 2, placeholder: 'Describe what you need, e.g. “Grade 10 Physical Sciences test on electric circuits, 40 marks, 45 minutes, with a circuit diagram”', 'aria-label': 'Describe what you want to make' });
  const status = h('div', { 'aria-live': 'polite' });
  const go = h('button', { class: 'btn primary' }, icon('spark'), 'Make it');
  const run = async (adjust = false) => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const r = parseRequest(text);
    if (adjust || !aiReady()) { newDialog(r.type, { ...r, extra: text }); return; }
    const extra = await withAnswers(r.type, { ...r, extra: text });
    if (extra === null) return;
    const live = h('span', { class: 'muted' });
    const onProg = e => { live.textContent = ' · ' + e.detail; };
    window.addEventListener('ai-progress', onProg);
    status.replaceChildren(h('p', { class: 'small' }, h('span', { class: 'spinner' }), ` Making a ${typeInfo(r.type).label.toLowerCase()}${r.subjectId ? ' · ' + subjectLabel(subjectById(r.subjectId)) : r.grade ? ' · Grade ' + r.grade : ''}${r.marks ? ' · ' + r.marks + ' marks' : ''}${r.time ? ' · ' + r.time + ' min' : ''}… about a minute.`, live));
    const done = busy(go, 'Making…');
    try { await buildWithAi(r.type, { ...r, extra }); }
    catch (e) { status.replaceChildren(h('p', { class: 'error small' }, e.message)); }
    finally { done(); window.removeEventListener('ai-progress', onProg); }
  };
  go.onclick = () => run(false);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(false); });
  return h('section', { class: 'card-sec ask-card' },
    h('h2', {}, 'What do you want to make?'),
    ta,
    h('div', { class: 'row wrap' }, go, h('button', { class: 'btn ghost', onclick: () => run(true) }, 'Choose the details first'),
      !aiReady() ? h('span', { class: 'muted small' }, aiUnavailableReason() + ' Without AI you get a ready-made layout to fill in.') : null),
    h('div', { class: 'ask-examples' }, h('span', { class: 'muted small' }, 'Try:'), EXAMPLES.map(([, t]) => h('button', { class: 'chip', onclick: () => { ta.value = t; ta.focus(); } }, t))),
    status);
}

// Turn a sentence into a type, subject, grade, marks, time and count.
export function parseRequest(text) {
  const t = text.toLowerCase();
  const type = /\b(test|exam|toets|eksamen|paper|vraestel|control test)\b/.test(t) ? 'test'
    : /\b(slides?|presentation|powerpoint|skyfies?)\b/.test(t) ? 'slides'
    : /\b(notes?|summary|summaries|study guide|opsomming|notas|mind ?map)\b/.test(t) ? 'notes'
    : /\brubric\b/.test(t) ? 'rubric'
    : /\b(flash ?cards?|word ?search|glossary|woordsoek)\b/.test(t) ? 'cards'
    : 'worksheet';
  const grade = (t.match(/\b(?:gr(?:ade|aad)?\.?\s*)(\d{1,2})\b/) || [])[1] || '';
  let subj = matchSubject(text, state.subjects, grade || '');
  if (!subj && grade) subj = state.subjects.find(s => String(s.grade) === grade && t.includes(s.name.toLowerCase().slice(0, 4))) || null;
  const marks = +(t.match(/(\d{1,3})\s*(?:marks?|punte)/) || [])[1] || 0;
  const mins = +(t.match(/(\d{1,3})\s*(?:min|minutes|minute)/) || [])[1] || 0;
  const hours = parseFloat((t.match(/(\d(?:[.,]\d)?|an?|one|two)\s*(?:hours?|hrs?|uur)/) || [])[1]?.replace(',', '.').replace(/^(a|an|one)$/, '1').replace('two', '2')) || 0;
  const count = +(t.match(/(\d{1,2})\s*(?:questions?|slides?|cards?|terms?|criteria|vrae|skyfies)/) || [])[1] || 0;
  return { type, subjectId: subj?.id || '', grade: grade || subj?.grade || '', marks, time: mins || Math.round(hours * 60), count,
    language: /\bafrikaans\b/.test(t) ? 'Afrikaans' : '' };
}

// Lessons from the planner, with one-tap materials.
function plannerCard() {
  const mon = addDays(mondayOf(today()), planWeek * 7);
  const end = addDays(mon, 6);
  const P = state.timetable.periods;
  const seen = new Set();
  const lessons = state.lessons.filter(l => l.date >= mon && l.date <= end)
    .sort((a, b) => (a.date + P.findIndex(p => p.id === a.periodId)).localeCompare(b.date + P.findIndex(p => p.id === b.periodId)))
    .filter(l => { const k = `${l.subjectId}|${l.cls}|${l.atpId || l.title}|${l.subtopic || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const body = lessons.length ? h('ul', { class: 'plan-list' }, lessons.slice(0, 12).map(l => {
    const s = subjectById(l.subjectId);
    return h('li', { style: { '--subj': s?.colour || '#777' } },
      h('div', { class: 'pl-main' }, h('strong', {}, l.title + (l.subtopic ? ' · ' + l.subtopic : '')),
        h('span', { class: 'muted small' }, `${fmt(l.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${classLabel(s, l.cls)}`)),
      h('div', { class: 'pl-acts' }, ['worksheet', 'test', 'notes', 'slides'].map(type => h('button', { class: 'chip', onclick: e => fromLesson(l, type, e.currentTarget) }, typeInfo(type).label.replace(' or summary', '').replace(' or exam', '')))));
  })) : h('p', { class: 'muted small' }, state.lessons.length ? 'No lessons planned for this week.' : 'Plan some lessons on the Planner and they show up here, ready to turn into worksheets, tests, notes and slides.');
  return h('section', { class: 'card-sec plan-card' },
    h('div', { class: 'row between wrap' }, h('h2', {}, 'From your planner'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Week' },
        h('button', { 'aria-pressed': String(planWeek === 0), onclick: () => { planWeek = 0; redrawList(); } }, 'This week'),
        h('button', { 'aria-pressed': String(planWeek === 1), onclick: () => { planWeek = 1; redrawList(); } }, 'Next week'))),
    body);
}
const redrawList = () => document.querySelector('.create-page')?.replaceWith(listPage());

async function fromLesson(l, type, btn) {
  // Use what the lesson already has, if anything.
  let c = null;
  if (type === 'worksheet' && l.content?.worksheet?.questions?.length) c = creationFromLesson(l, 'worksheet');
  if (type === 'slides' && l.content?.slides?.length) c = creationFromLesson(l, 'slides');
  if (type === 'notes' && l.content?.notes?.sections?.length) c = creationFromNotes(l);
  if (c) { c.title = c.title || l.title; await saveCreation(c); location.hash = 'create/' + c.id; toast('Made from the lesson. Edit and design it.'); return; }
  const s = subjectById(l.subjectId);
  const opts = { subjectId: l.subjectId, grade: s?.grade || '', atpId: l.atpId, title: '', lessonId: l.id,
    extra: [l.subtopic ? `Focus on: ${l.subtopic}.` : '', l.cls ? `For class ${l.cls}.` : ''].filter(Boolean).join(' '), topic: l.title };
  if (!aiReady()) { const t = templateCreation(type, { ...opts, title: l.title }); t.lessonId = l.id; await saveCreation(t); location.hash = 'create/' + t.id; toast('Template ready. Fill it in and design it.'); return; }
  const extra = await withAnswers(type, opts);
  if (extra === null) return;
  const done = busy(btn, 'Making…');
  try { await buildWithAi(type, { ...opts, extra }); } catch (e) { toast(e.message, 'error'); } finally { done(); }
}

function materialsList() {
  const q = search.toLowerCase();
  const list = [...state.creations].filter(c => (!filterSubject || c.subjectId === filterSubject) && (!filterType || c.type === filterType) && (!q || (c.title || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  const sec = h('section', {}, h('div', { class: 'row between wrap' }, h('h2', {}, 'Your materials'),
    h('div', { class: 'row wrap' },
      h('input', { type: 'search', class: 'sm', placeholder: 'Search', value: search, 'aria-label': 'Search materials', oninput: e => { search = e.target.value; const el = document.querySelector('.mat-section'); el?.replaceWith(materialsList()); document.querySelector('.mat-section input[type=search]')?.focus(); } }),
      h('select', { class: 'sm', 'aria-label': 'Type', onchange: e => { filterType = e.target.value; redrawList(); } }, h('option', { value: '' }, 'All types'), TYPES.map(t => h('option', { value: t.id, selected: t.id === filterType }, t.label))),
      state.subjects.length > 1 ? h('select', { class: 'sm', 'aria-label': 'Subject', onchange: e => { filterSubject = e.target.value; redrawList(); } }, h('option', { value: '' }, 'All subjects'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === filterSubject }, subjectLabel(s)))) : null)),
    list.length ? h('ul', { class: 'mat-list creations' }, list.map(c => {
      const s = subjectById(c.subjectId);
      const parent = c.versionOf && creationById(c.versionOf);
      return h('li', {},
        h('span', { class: 'ext', style: { background: s?.colour || 'var(--chalk)' } }, icon(typeInfo(c.type).icon, 16)),
        h('div', { class: 'mat-main' }, h('a', { class: 'link strong', href: '#create/' + c.id }, c.title || 'Untitled'),
          h('span', { class: 'muted small' }, [typeInfo(c.type).label, s ? subjectLabel(s) : (c.grade ? 'Grade ' + c.grade : ''), parent ? `version of “${parent.title}”` : '', c.updated ? 'edited ' + fmt(c.updated.slice(0, 10)) : ''].filter(Boolean).join(' · '))),
        h('button', { class: 'btn ghost sm', onclick: async () => { const copy = JSON.parse(JSON.stringify(c)); delete copy.id; copy.title += ' (copy)'; await saveCreation(copy, { silent: false }); toast('Copied.'); } }, 'Duplicate'),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete ' + c.title, onclick: async () => { if (await confirmBox(`Delete “${c.title}”?`)) deleteCreation(c.id); } }, icon('trash', 16)));
    })) : h('p', { class: 'empty' }, state.creations.length ? 'Nothing matches.' : 'Nothing yet. Describe what you want above, or start from your planner.'));
  sec.className = 'mat-section';
  return sec;
}

// Ask the teacher a few questions about this request first (see create/askfirst.js).
// Resolves with the request's instructions plus the answers, or null when the teacher cancels.
async function withAnswers(type, o) {
  const atp = o.atpId ? atpById(o.atpId) : null;
  const answers = await askFirst(type, { subject: subjectById(o.subjectId)?.name, grade: o.grade, language: o.language,
    topic: o.topic || o.title || atp?.topic || '', details: String(o.details ?? atp?.details ?? '').slice(0, 4000),
    sourceText: String(o.sourceText || '').slice(0, 3000), extra: o.extra || '',
    marks: ['test', 'worksheet'].includes(type) ? (o.marks || (type === 'test' ? 50 : 20)) : 0, time: type === 'test' ? (o.time || 60) : 0,
    count: o.count || 0, length: o.length, levelsCount: o.levelsCount });
  if (answers === null) return null;
  return [o.extra || '', answers].filter(Boolean).join('\n\n');
}

// Build a material with AI and open it.
async function buildWithAi(type, o) {
  const c = blankCreation(type, { subjectId: o.subjectId, grade: o.grade, title: o.title || '', atpId: o.atpId || '', sourceText: o.sourceText || '' });
  if (o.language) c.language = o.language;
  if (o.lessonId) c.lessonId = o.lessonId;
  const subj = subjectById(o.subjectId);
  const atp = o.atpId ? atpById(o.atpId) : null;
  const marks = ['test', 'worksheet'].includes(type) ? (o.marks || (type === 'test' ? 50 : 20)) : 0;
  const brief = { subject: subj?.name, grade: c.grade, language: c.language, topic: o.topic || o.title || atp?.topic || '', details: o.details ?? atp?.details ?? '', sourceText: o.sourceText || '', extra: o.extra || '',
    marks, time: type === 'test' ? (o.time || 60) : 0, count: o.count || { worksheet: 8, slides: 10, rubric: 5, cards: 16 }[type] || 0, length: o.length || 'medium', levelsCount: o.levelsCount || 4, levelNames: c.meta.levelNames, levelTargets: c.meta.levelTargets };
  if (o.poaTask && (o.poaTask.levelPercents || []).length === (brief.levelNames || []).length) brief.levelTargets = o.poaTask.levelPercents;
  const r = type === 'test' ? await aiCreateTest(brief) : await aiCreate(type, brief);
  applyAi(c, r);
  c.meta.brief = { topic: brief.topic, details: brief.details, extra: brief.extra, sourceText: (brief.sourceText || '').slice(0, 20000) };
  const empty = isBlockDoc(c) ? !c.blocks.length : c.type === 'slides' ? !c.slides.length : c.type === 'cards' ? !c.cards.length : c.type === 'rubric' ? !c.rubric.criteria.length : false;
  if (empty) throw new Error('The AI sent back an empty page. Please try again; if it keeps happening, try Claude Opus in Settings.');
  if (marks) c.meta.targetMarks = marks;
  if (!c.title) c.title = o.title || atp?.topic || typeInfo(type).label;
  if (o.poaTask) applyPoa(c, o.poaTask);
  await saveCreation(c);
  location.hash = 'create/' + c.id;
  if (r.failed?.length) toast(`Done, but Question ${r.failed.join(' and ')} didn’t come through. Tap its heading and choose “Write this question again”.`, 'warn');
  else toast('Done. Tap anything on the page to change it.');
  return c;
}

// A PoA task's levels become the test's cognitive level targets; the task is remembered on the material.
function applyPoa(c, t) {
  c.meta.poa = { id: t.id, name: t.name, term: t.term };
  if ((t.levelPercents || []).length === (c.meta.levelNames || []).length) c.meta.levelTargets = t.levelPercents.slice();
  if (t.marks) c.meta.targetMarks = t.marks;
  if (t.minutes && c.type === 'test') c.meta.time = t.minutes;
}

// ---------- New (choose the details) ----------
function newDialog(type, pre = {}) {
  const t = typeInfo(type);
  const tw = termWeekOf(today());
  const sid = pre.subjectId ?? state.subjects[0]?.id ?? '';
  const f = { subjectId: sid, grade: pre.grade || subjectById(sid)?.grade || '', title: '', source: 'atp', atpId: '', text: '', extra: pre.extra || '',
    marks: pre.marks || (type === 'test' ? 50 : 20), time: pre.time || 60, count: pre.count || { worksheet: 8, slides: 10, rubric: 5, cards: 16 }[type] || 0, length: 'medium', levelsCount: 4, language: pre.language || '' };
  const pickAtp = () => {
    const items = state.atp.filter(a => a.subjectId === f.subjectId);
    const now = tw && items.find(a => a.term === tw.term && tw.week >= a.week && tw.week <= (a.weekEnd || a.week));
    f.atpId = now?.id || items[0]?.id || '';
    // Tests and worksheets can cover several topics: start with this week's ATP topic and its textbook chapter.
    // No topic this week (e.g. a revision or test week)? Tests cover what was just taught: the latest earlier topic.
    const before = !now && tw ? items.filter(a => a.term < tw.term || (a.term === tw.term && (a.weekEnd || a.week) < tw.week)).sort((a, b) => a.term - b.term || a.week - b.week).at(-1) : null;
    const pick = now || before;
    f.atpIds = new Set(pick ? [pick.id] : []);
    const a0 = pick, sv = a0 && siyavulaFor(subjectById(f.subjectId), a0.topic, a0.details || '');
    f.chapters = new Set(sv ? [sv.path] : []);
  };
  const MULTI = ['test', 'worksheet'].includes(type);
  f.poaId = '';
  pickAtp();
  if (pre.extra) f.source = 'none';
  const body = h('div', {});
  const m = modal(`New ${t.label.toLowerCase()}`, body, { wide: true });
  const num = (label, key, min, max) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'number', min, max, value: f[key], oninput: e => f[key] = +e.target.value }));
  // Tick as many ATP topics and Siyavula chapters as the test should cover.
  const topicPicker = atps => {
    const subj = subjectById(f.subjectId);
    const chs = chaptersOf(subj && { ...subj, grade: f.grade || subj.grade }).filter(() => state.settings.edition !== 'uni');
    const count = h('span', { class: 'muted small' });
    const tell = () => { const n = f.atpIds.size + f.chapters.size; count.textContent = n ? `${n} chosen` : 'Nothing chosen yet'; };
    const tick = (set, key, label, sub) => h('label', { class: 'tp-item' },
      h('input', { type: 'checkbox', checked: set.has(key), onchange: e => { e.target.checked ? set.add(key) : set.delete(key); tell(); } }),
      h('span', {}, label, sub ? h('small', { class: 'muted' }, sub) : null));
    const termBtn = term => h('button', { type: 'button', class: 'chip', onclick: () => { const ids = atps.filter(a => a.term === term).map(a => a.id); const all = ids.every(id => f.atpIds.has(id)); ids.forEach(id => all ? f.atpIds.delete(id) : f.atpIds.add(id)); draw(); } }, `Term ${term}`);
    const terms = [1, 2, 3, 4].filter(t => atps.some(a => a.term === t));
    tell();
    return h('div', { class: 'field topic-pick' },
      h('div', { class: 'row between' }, h('span', { class: 'lbl' }, 'Topics to cover'), count),
      h('div', { class: 'tp-cols' },
        h('div', { class: 'tp-box' },
          h('div', { class: 'tp-head' }, h('b', {}, 'ATP'), terms.length > 1 ? h('span', { class: 'row wrap', style: { gap: '.3rem' } }, h('span', { class: 'muted small' }, 'Tick a whole term:'), terms.map(termBtn)) : null),
          atps.length ? h('div', { class: 'tp-list' }, terms.map(term => h('div', {}, h('div', { class: 'tp-term' }, `Term ${term}`),
            atps.filter(a => a.term === term).map(a => tick(f.atpIds, a.id, a.topic, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}`)))))
          : h('p', { class: 'muted small' }, f.subjectId ? 'This subject has no ATP yet. Upload it on the Subjects page.' : 'Choose a subject to pick from its ATP.')),
        chs.length ? h('div', { class: 'tp-box' },
          h('div', { class: 'tp-head' }, h('b', {}, 'Siyavula textbook')),
          h('div', { class: 'tp-list' }, chs.map(c => tick(f.chapters, c[2], `Ch ${c[0]}: ${c[1]}`, null)))) : null));
  };
  // A formal task from the subject's Programme of Assessment: sets the marks, time, content and levels.
  const wordsOf = t => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const usePoa = id => {
    f.poaId = id;
    const t = taskById(subjectById(f.subjectId), id);
    if (!t) { draw(); return; }
    if (t.marks) f.marks = t.marks;
    if (t.minutes) f.time = t.minutes;
    if (!f.title.trim() || f.titleFromPoa) { f.title = t.name; f.titleFromPoa = true; }
    // Tick the ATP topics the task covers (or, if the PoA doesn't list them, that term's topics).
    const items = state.atp.filter(a => a.subjectId === f.subjectId);
    // A topic matches when the names are mostly the same words (or one contains the other).
    const same = (x, y) => { const a = x.toLowerCase().trim(), b = y.toLowerCase().trim(); if (!a || !b) return false; if (a.includes(b) || b.includes(a)) return true;
      const A = wordsOf(a), B = wordsOf(b); const both = [...A].filter(w => B.has(w)).length; return both / (A.size + B.size - both || 1) >= 0.5; };
    const named = items.filter(a => (t.topicList || []).some(x => same(x, a.topic)));
    const hits = named.length ? named : items.filter(a => a.term === t.term);
    if (hits.length) { f.source = 'atp'; f.atpIds = new Set(hits.map(a => a.id)); f.chapters = new Set(); }
    draw();
  };
  const poaPicker = () => {
    const tasks = poaTasks(subjectById(f.subjectId));
    if (!tasks.length) return f.subjectId ? h('p', { class: 'muted small' }, 'Tip: upload this subject’s Programme of Assessment on the ', h('a', { href: '#subjects/' + f.subjectId }, 'Subjects page'), ' and you can start from a formal task here.') : null;
    const t = taskById(subjectById(f.subjectId), f.poaId);
    return h('div', { class: 'field poa-pick' }, h('span', { class: 'lbl' }, 'Programme of Assessment task (optional)'),
      h('select', { onchange: e => usePoa(e.target.value) },
        h('option', { value: '' }, 'Not a formal PoA task'),
        [1, 2, 3, 4].map(term => { const list = tasks.filter(x => (x.term || 1) === term); return list.length ? h('optgroup', { label: `Term ${term}` }, list.map(x => h('option', { value: x.id, selected: x.id === f.poaId }, `${x.name}${taskLine(x) ? ' · ' + taskLine(x) : ''}`))) : null; })),
      t ? h('p', { class: 'poa-note small' }, `${kindLabel(t.kind)} · Term ${t.term}${taskLine(t) ? ' · ' + taskLine(t) : ''}. `,
        (t.topicList || []).length ? `Covers: ${t.topicList.join('; ')}. ` : '', (t.levelPercents || []).length ? `Levels ${t.levelPercents.join('/')}%. ` : '', t.format ? `Format: ${t.format}` : '',
        h('span', { class: 'muted' }, ' The AI follows these.')) : null);
  };
  const draw = () => {
    const atps = state.atp.filter(a => a.subjectId === f.subjectId);
    const srcText = h('textarea', { rows: 5, placeholder: 'Paste notes, a textbook section or a memo. Or upload a file below.', oninput: e => f.text = e.target.value }, f.text);
    const status = h('div', { 'aria-live': 'polite' });
    const options = {
      test: [num('Total marks', 'marks', 5, 300), num('Time (minutes)', 'time', 5, 240)],
      worksheet: [num('Number of questions', 'count', 2, 40), num('Total marks', 'marks', 5, 150)],
      notes: [h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Length'), h('div', { class: 'seg', role: 'radiogroup' }, ['short', 'medium', 'long'].map(l => h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.length === l), onclick: () => { f.length = l; draw(); } }, { short: 'One page', medium: 'Two pages', long: 'Three or four' }[l]))))],
      slides: [num('Number of slides', 'count', 3, 30)],
      rubric: [num('Criteria', 'count', 2, 10), num('Levels', 'levelsCount', 2, 7)],
      cards: [num('Number of terms', 'count', 4, 40)],
    }[type];
    body.replaceChildren(
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('select', { onchange: e => { f.subjectId = e.target.value; f.grade = subjectById(f.subjectId)?.grade || ''; f.poaId = ''; pickAtp(); draw(); } },
          h('option', { value: '' }, 'Not linked to a subject'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === f.subjectId }, subjectLabel(s))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Grade'), h('input', { value: f.grade, placeholder: 'e.g. 9', oninput: e => f.grade = e.target.value.trim() })),
        h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', { class: 'lbl' }, 'Title or topic'), h('input', { value: f.title, placeholder: type === 'test' ? 'e.g. Term 4 controlled test: Statistics' : 'e.g. Photosynthesis', oninput: e => { f.title = e.target.value; f.titleFromPoa = false; } }))),
      MULTI ? poaPicker() : null,
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'What should it be based on?'),
        h('div', { class: 'seg', role: 'radiogroup' }, [['atp', MULTI ? 'ATP and textbook topics' : 'An ATP topic'], ['text', 'My notes or a file'], ['none', 'Just the title / my description']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.source === k), onclick: () => { f.source = k; draw(); } }, l)))),
      f.source === 'atp' && MULTI ? topicPicker(atps) :
      f.source === 'atp' ? (atps.length ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ATP topic'), h('select', { onchange: e => f.atpId = e.target.value },
        [1, 2, 3, 4].map(term => { const list = atps.filter(a => a.term === term); return list.length ? h('optgroup', { label: `Term ${term}` }, list.map(a => h('option', { value: a.id, selected: a.id === f.atpId }, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}: ${a.topic}`))) : null; })))
        : h('p', { class: 'muted small' }, f.subjectId ? 'This subject has no ATP yet. Upload it on the Subjects page, or use your own notes.' : 'Choose a subject to pick from its ATP.')) : null,
      f.source === 'text' ? h('div', { class: 'stack' }, srcText, dropZone({ accept: '.pdf,.docx,.xlsx,.txt,.md', label: 'Upload a file to use', hint: 'PDF, Word or text. Its text is added above.', onFiles: async ([file]) => {
        status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
        try { const t2 = await extractText(file); f.text = (f.text ? f.text + '\n\n' : '') + t2.trim(); srcText.value = f.text; status.replaceChildren(h('p', { class: 'ok small' }, `Added the text from ${file.name} (${Math.round(t2.length / 1000)}k characters).`)); }
        catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
      } }), status) : null,
      h('div', { class: 'form-grid' }, options),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Anything else for the AI? (optional)'), h('textarea', { rows: 2, placeholder: 'e.g. Include a graph question and a labelled diagram, use Gqeberha examples, mostly multiple choice', oninput: e => f.extra = e.target.value }, f.extra)),
      h('div', { class: 'row end wrap' },
        !aiReady() ? h('span', { class: 'muted small' }, aiUnavailableReason()) : null,
        h('button', { class: 'btn ghost', onclick: () => start(false) }, icon('doc'), 'Start from a template'),
        (() => { const b = h('button', { class: 'btn primary', disabled: !aiReady() }, icon('spark'), 'Write it with AI'); b.onclick = () => start(true, b); return b; })()),
    );
  };
  const start = async (useAi, btn) => {
    const multi = f.source === 'atp' && MULTI;
    const picked = multi ? state.atp.filter(a => f.atpIds.has(a.id)).sort((a, b) => a.term - b.term || a.week - b.week) : [];
    const subj = subjectById(f.subjectId);
    const chs = multi ? chaptersOf(subj && { ...subj, grade: f.grade || subj.grade }).filter(c => f.chapters.has(c[2])) : [];
    if (useAi && multi && !picked.length && !chs.length && !f.title.trim()) { toast('Tick at least one topic, or type a title.', 'warn'); return; }
    const atp = multi ? picked[0] || null : f.source === 'atp' ? atpById(f.atpId) : null;
    const names = [...picked.map(a => a.topic), ...chs.filter(c => !picked.some(a => siyavulaFor(subj, a.topic, a.details || '')?.path === c[2])).map(c => c[1])];
    const autoTitle = names.length > 3 ? `${names.slice(0, 2).join('; ')} and ${names.length - 2} more` : names.length > 1 ? names.slice(0, -1).join('; ') + ' and ' + names.at(-1) : names[0] || '';
    const opts = { subjectId: f.subjectId, grade: f.grade, title: f.title.trim() || (multi ? autoTitle : ''), atpId: atp?.id || '', sourceText: f.source === 'text' ? f.text : '' };
    if (multi && (picked.length + chs.length > 1 || chs.length)) {
      opts.topic = names.join('; ');
      opts.details = [
        ...picked.map(a => `ATP Term ${a.term} week ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}: ${a.topic}${a.details ? ' — ' + String(a.details).slice(0, 1500) : ''}`),
        ...chs.map(c => `Siyavula textbook, Chapter ${c[0]}: ${c[1]}. Sections: ${c[3].split(' ; ').filter(x => x && x !== '(none)').join('; ')}`),
      ].join('\n');
      opts.multi = names.length;
    }
    const poaTask = MULTI ? taskById(subj, f.poaId) : null;
    if (poaTask) { opts.poa = describeTask(subj, poaTask); opts.poaTask = poaTask; }
    if (useAi) {
      const all = { ...opts, extra: [opts.poa || '', opts.multi > 1 ? `Cover all ${opts.multi} topics listed, spreading the marks fairly across them.` : '', f.extra].filter(Boolean).join(' '), marks: f.marks, time: f.time, count: f.count, length: f.length, levelsCount: f.levelsCount, language: f.language };
      const extra = await withAnswers(type, all);
      if (extra === null) return;
      const done = busy(btn, 'Writing… about a minute');
      try { await buildWithAi(type, { ...all, extra }); m.close(); }
      catch (e) { toast(e.message, 'error'); } finally { done(); }
      return;
    }
    const c = templateCreation(type, opts);
    if (type === 'test') c.meta.time = f.time;
    if (poaTask) applyPoa(c, poaTask);
    if (['test', 'worksheet'].includes(type)) c.meta.targetMarks = f.marks;
    if (f.language) c.language = f.language;
    await saveCreation(c);
    m.close();
    location.hash = 'create/' + c.id;
    toast('Template ready. Tap anything on the page to change it.');
  };
  draw();
}

// ---------- Designer ----------
let pane = 'edit'; // on narrow screens: 'edit' | 'preview'
function designer(root, c) {
  ensureCss();
  if (standardiseLevels(c)) saveCreation(c);
  let selected = -1;
  const history = [];
  const snapshot = () => { history.push(JSON.stringify(c)); if (history.length > 25) history.shift(); undoBtn.disabled = false; };
  let saveT, prevT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => saveCreation(c), 500); };
  const preview = h('div', { class: 'preview-paper' });
  const previewWrap = h('div', { class: 'preview-wrap', 'aria-label': 'Page preview' }, preview);
  previewWrap.addEventListener('scroll', () => placeTools && placeTools());
  const fit = () => { const w = previewWrap.clientWidth - 24; if (w > 0) preview.style.zoom = Math.min(1, w / 794); };
  // Little toolbar on the selected block in the page preview.
  const pvTools = h('div', { class: 'pv-tools', hidden: true });
  const placeTools = () => {
    const el = selected >= 0 && isBlockDoc(c) ? preview.querySelector(`[data-i="${selected}"]`) : null;
    if (!el) { pvTools.hidden = true; return; }
    const wr = previewWrap.getBoundingClientRect(), r = el.getBoundingClientRect();
    const i = selected;
    pvTools.replaceChildren(
      h('button', { 'aria-label': 'Move up', disabled: i === 0, onclick: () => { snapshot(); [c.blocks[i - 1], c.blocks[i]] = [c.blocks[i], c.blocks[i - 1]]; selected = i - 1; structural(); } }, icon('up', 15)),
      h('button', { 'aria-label': 'Move down', disabled: i >= c.blocks.length - 1, onclick: () => { snapshot(); [c.blocks[i + 1], c.blocks[i]] = [c.blocks[i], c.blocks[i + 1]]; selected = i + 1; structural(); } }, icon('down', 15)),
      h('button', { 'aria-label': 'Duplicate', onclick: () => { snapshot(); c.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(c.blocks[i]))); selected = i + 1; structural(); } }, icon('copy', 15)),
      h('button', { 'aria-label': 'Delete', onclick: () => { snapshot(); c.blocks.splice(i, 1); selected = -1; structural(); toast('Deleted. Undo brings it back.'); } }, icon('trash', 15)),
      h('button', { class: 'pv-edit', onclick: () => { pane = 'edit'; layout(); scrollToSel(); } }, icon('pen', 15), 'Edit'));
    pvTools.hidden = false;
    pvTools.style.top = Math.max(0, r.top - wr.top + previewWrap.scrollTop - 38) + 'px';
    pvTools.style.left = Math.max(4, Math.min(wr.width - pvTools.offsetWidth - 4, r.right - wr.left - pvTools.offsetWidth)) + 'px';
  };
  previewWrap.append(pvTools);
  const renderPreview = () => {
    preview.innerHTML = renderCreation(c);
    if (selected >= 0) preview.querySelector(`[data-i="${selected}"]`)?.classList.add('pv-sel');
    totals();
    requestAnimationFrame(placeTools);
  };
  const changed = () => { clearTimeout(prevT); prevT = setTimeout(renderPreview, 120); save(); };
  const structural = () => { save(); drawEditor(); renderPreview(); };

  previewWrap.addEventListener('click', e => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    if (e.target.closest('.pv-tools')) return;
    selected = +el.dataset.i; drawEditor();
    preview.querySelectorAll('.pv-sel').forEach(x => x.classList.remove('pv-sel')); el.classList.add('pv-sel'); placeTools();
    if (innerWidth >= 1100) { const card = editor.querySelector(`[data-ed="${selected}"]`); card?.scrollIntoView({ behavior: 'smooth', block: 'center' }); card?.querySelector('textarea, input:not([type=checkbox])')?.focus({ preventScroll: true }); }
  });

  const editor = h('div', { class: 'ed-list' });
  const totalsEl = h('span', { class: 'ed-total' });
  const totals = () => {
    if (['test', 'worksheet'].includes(c.type)) totalsEl.textContent = `${totalMarks(c.blocks)} marks`;
    else if (c.type === 'rubric') totalsEl.textContent = `out of ${rubricMax(c)}`;
    else if (c.type === 'slides') totalsEl.textContent = `${(c.slides || []).length + 1} slides`;
    else if (c.type === 'cards') totalsEl.textContent = `${(c.cards || []).filter(x => x.term).length} terms`;
    else totalsEl.textContent = '';
    if (c.type === 'test') drawCog();
    drawChecks();
  };
  const checksEl = h('div', { class: 'checks' });
  const drawChecks = () => {
    const list = checksOf(c);
    checksEl.replaceChildren(list.length
      ? h('details', { class: 'checks-box' }, h('summary', {}, icon('flag', 14), `${list.length} thing${list.length > 1 ? 's' : ''} to check`),
          h('ul', {}, list.map(x => h('li', {}, x.i != null ? h('button', { class: 'link', onclick: () => { selected = x.i; drawEditor(); renderPreview(); scrollToSel(); } }, x.msg) : x.msg))))
      : (isBlockDoc(c) && c.type !== 'notes' ? h('span', { class: 'checks-ok' }, icon('check', 14), 'Marks, memo and levels check out') : ''));
  };

  const undoBtn = h('button', { class: 'btn ghost sm', disabled: true, onclick: () => { const s = history.pop(); if (!s) return; Object.assign(c, JSON.parse(s)); undoBtn.disabled = !history.length; structural(); toast('Undone.'); } }, 'Undo');

  // ---------- Top bar ----------
  const titleIn = h('input', { class: 'title-input', value: c.title, 'aria-label': 'Title', oninput: e => { c.title = e.target.value; changed(); } });
  const exportBtns = h('div', { class: 'row wrap' },
    h('button', { class: 'btn', onclick: () => printCreation(c) }, icon('print'), c.type === 'slides' ? 'Print handout / PDF' : 'Print / PDF'),
    c.type !== 'slides' ? expBtn('Word', 'doc', async () => exportCreationDocx(await withCover(await rasterise(c)))) : expBtn('PowerPoint', 'slides', () => exportCreationPptx(c)),
    c.type === 'test' ? expBtn('Taxonomy sheet', 'sheet', () => downloadBloomXlsx(c)) : null);
  const d = c.design;
  const toggle = (key, label) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: !!d[key], onchange: e => { d[key] = e.target.checked; changed(); } }), label);
  const buildDesignBar = () => h('div', { class: 'design-bar' },
    h('div', { class: 'seg themes', role: 'radiogroup', 'aria-label': 'Theme' }, THEMES.map(t => h('button', { role: 'radio', 'aria-checked': String(d.theme === t.id), title: t.note, onclick: e => { d.theme = t.id; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); changed(); } }, t.label))),
    c.type !== 'slides' ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Text size' }, [['normal', 'Normal text'], ['large', 'Large text']].map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(d.size === v), onclick: e => { d.size = v; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); changed(); } }, l))) : null,
    c.type === 'cards' ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Print as' }, [['cards', 'Cut-out cards'], ['glossary', 'Glossary'], ['wordsearch', 'Word search']].map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(d.layout === v), onclick: () => { d.layout = v; structural(); drawTop(); } }, l))) : null,
    h('div', { class: 'chips' },
      ['test', 'worksheet', 'rubric'].includes(c.type) || (c.type === 'cards' && d.layout === 'wordsearch') ? toggle('header', 'Name and class lines') : null,
      ['test', 'worksheet'].includes(c.type) ? toggle('memo', 'Memo') : null,
      c.type === 'test' ? toggle('grid', 'Taxonomy levels sheet in the memo') : null,
      ['test', 'worksheet'].includes(c.type) ? coverSelect() : null,
      ['test', 'worksheet'].includes(c.type) ? (() => { const chk = checkFor(c); return h('label', { class: 'chip', title: `Hidden instruction asks AI tools to use “${chk.word}” ${chk.n} times` }, h('input', { type: 'checkbox', checked: !!chk.on, onchange: e => { chk.on = e.target.checked; changed(); } }), `Hidden AI check (“${chk.word}”)`); })() : null,

      c.type === 'cards' && d.layout === 'wordsearch' ? h('button', { class: 'chip', onclick: () => { c.meta.seed = Math.floor(Math.random() * 1e6); changed(); } }, 'New puzzle') : null));
  const aiIn = h('input', { placeholder: 'Ask AI to change it, e.g. “make it easier for Grade 8” or “add two diagram questions”', 'aria-label': 'Change with AI', onkeydown: e => { if (e.key === 'Enter') aiBtn.click(); } });
  const aiBtn = h('button', { class: 'btn', disabled: !aiReady(), title: aiUnavailableReason() || '' }, icon('spark'), 'Change');
  aiBtn.onclick = async () => {
    const instr = aiIn.value.trim(); if (!instr) { aiIn.focus(); return; }
    const done = busy(aiBtn, 'Changing…');
    try {
      const subj = subjectById(c.subjectId);
      const prev = JSON.parse(JSON.stringify(c));
      const r = await aiRevise(c.type, toAiJson(c), instr, { subject: subj?.name, grade: c.grade, language: c.language, levelNames: c.type === 'test' ? c.meta.levelNames : null });
      snapshot();
      applyAi(c, r, prev);
      aiIn.value = ''; structural(); titleIn.value = c.title;
      toast('Changed.', 'ok', { action: { label: 'Undo', run: () => undoBtn.click() } });
    } catch (e) { toast(e.message, 'error'); } finally { done(); }
  };

  function coverSelect() {
    const list = covers();
    const val = d.cover === true ? 'generated' : typeof d.cover === 'string' && coverById(d.cover) ? d.cover : '';
    return h('label', { class: 'chip cover-chip' }, 'Cover page',
      h('select', { 'aria-label': 'Cover page', onchange: e => {
        const v = e.target.value;
        if (v === '__upload') { e.target.value = val; openCoverEditor(null, cv => { d.cover = cv.id; structural(); drawTop(); }); return; }
        d.cover = v === 'generated' ? true : v || false; changed(); drawTop();
      } },
        h('option', { value: '', selected: !val }, 'None'),
        c.type === 'test' ? h('option', { value: 'generated', selected: val === 'generated' }, 'Teacher’s Desk cover') : null,
        list.map(cv => h('option', { value: cv.id, selected: val === cv.id }, cv.name)),
        h('option', { value: '__upload' }, 'Upload the school’s cover sheet…')));
  }

  function versionMenu() {
    const other = c.language === 'Afrikaans' ? ['en', 'English'] : ['af', 'Afrikaans'];
    const items = [
      ['easier', 'Easier (support)', 'Simpler wording and more scaffolding, same topic and marks'],
      ['harder', 'Harder (extension)', 'More higher-order questions, same topic and marks'],
      ['b', 'Version B', 'Same skills and marks, different numbers and questions, so answers can’t be copied'],
      [other[0], `In ${other[1]}`, 'Everything translated, memo included'],
      ['large', 'Large print', 'Bigger text and spacing (no AI needed)'],
    ];
    const box = h('details', { class: 'more-menu version-menu' }, h('summary', { class: 'btn ghost' }, icon('copy'), 'Make a version'),
      h('div', { class: 'more-list', role: 'menu' }, items.map(([k, label, hint]) => h('button', { role: 'menuitem', disabled: k !== 'large' && !aiReady(), onclick: e => { box.open = false; makeVersion(k, label, box.querySelector('summary')); } },
        h('span', {}, h('strong', {}, label), h('span', { class: 'muted small' }, hint))))));
    return box;
  }
  async function makeVersion(kind, label, btn) {
    const copy = JSON.parse(JSON.stringify(c)); delete copy.id; copy.versionOf = c.versionOf || c.id; delete copy.created;
    const suffix = { easier: ' (easier)', harder: ' (extension)', b: ' (Version B)', af: ' (Afrikaans)', en: ' (English)', large: ' (large print)' }[kind];
    if (kind === 'large') { copy.design.size = 'large'; copy.title = c.title + suffix; await saveCreation(copy); location.hash = 'create/' + copy.id; toast('Large-print version made.'); return; }
    const instr = {
      easier: 'Make an easier version for learners who need support: simpler wording, shorter sentences, more scaffolding (e.g. sentence starters, part-questions, word banks), same topic and roughly the same total marks. Update every memo answer.',
      harder: 'Make a more challenging extension version: more higher-order and problem-solving questions, same topic and the same total marks. Update every memo answer.',
      b: 'Make a parallel Version B for another class: the same structure, skills, marks, cognitive levels and difficulty, but different numbers, contexts, examples and wording so answers cannot be copied from version A. Recalculate every memo answer.',
      af: 'Translate everything into Afrikaans using South African school terminology (e.g. Vraag, punte, Memorandum). Keep structure, marks and levels. Translate the memo too.',
      en: 'Translate everything into South African English using school terminology. Keep structure, marks and levels. Translate the memo too.',
    }[kind];
    const done = busy(btn, 'Making…');
    try {
      const subj = subjectById(c.subjectId);
      const r = await aiRevise(c.type, toAiJson(c), instr, { subject: subj?.name, grade: c.grade, language: kind === 'af' ? 'Afrikaans' : kind === 'en' ? 'English' : c.language, levelNames: c.type === 'test' ? c.meta.levelNames : null });
      applyAi(copy, r, c);
      copy.title = (r.title || c.title).replace(/\s*\((easier|extension|Version B|Afrikaans|English)\)$/i, '') + suffix;
      if (kind === 'af') copy.language = 'Afrikaans'; if (kind === 'en') copy.language = 'English';
      await saveCreation(copy);
      location.hash = 'create/' + copy.id;
      toast(`${label} made. The original is unchanged.`);
    } catch (e) { toast(e.message, 'error'); } finally { done(); }
  }

  const top = h('div', { class: 'designer-top' });
  const drawTop = () => {
    const subj = subjectById(c.subjectId);
    const setup = h('details', { class: 'more-menu setup-menu' }, h('summary', { class: 'btn ghost' }, icon('gear', 16), 'Page setup'),
      h('div', { class: 'more-list setup-panel' }, buildDesignBar(), c.type === 'test' ? testMeta() : null));
    top.replaceChildren(
      h('div', { class: 'row between wrap' },
        h('a', { href: '#create', class: 'back' }, icon('left', 16), 'All materials'),
        h('div', { class: 'row wrap' }, undoBtn, exportBtns)),
      titleIn,
      h('p', { class: 'muted small ed-meta' }, [typeInfo(c.type).label, subj ? subjectLabel(subj) : (c.grade ? 'Grade ' + c.grade : ''), ''].filter(Boolean).join(' · '), totalsEl, checksEl),
      h('div', { class: 'row wrap ed-toolbar' }, setup, ['test', 'worksheet', 'notes'].includes(c.type) || c.type === 'slides' ? versionMenu() : null,
        ['test', 'worksheet'].includes(c.type) ? h('button', { class: 'btn ghost', onclick: () => openChecker(checkFor(c)) }, icon('check', 16), 'Check learners’ answers') : null),
      h('div', { class: 'ai-bar' }, aiIn, aiBtn));
  };

  // ---------- Editors ----------
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const area = (val, on, rows = 2, ph = '') => grow(h('textarea', { rows, placeholder: ph, oninput: e => { on(e.target.value); changed(); } }, val || ''));
  const input = (val, on, attrs = {}) => h('input', { value: val ?? '', ...attrs, oninput: e => { on(e.target.value); changed(); } });

  const cogBox = h('div', { class: 'cog-live' });
  const drawCog = () => {
    if (c.type !== 'test') return;
    const rows = cogGrid(c);
    cogBox.replaceChildren(...rows.map(r => h('div', { class: 'cog-row' + (Math.abs(r.pct - r.target) > 5 ? ' off' : '') },
      h('span', {}, `${r.level}. ${r.name}`), h('div', { class: 'cog-bar' }, h('span', { style: { width: Math.min(100, r.pct) + '%' } }), h('i', { style: { left: r.target + '%' }, title: 'Target' })), h('b', {}, `${r.marks} marks · ${r.pct}%`), h('span', { class: 'muted small' }, `target ${r.target}%`))));
  };

  function testMeta() {
    const preset = cogPresetFor(subjectById(c.subjectId)?.name);
    return h('div', { class: 'meta-card' },
      h('h3', {}, 'Test details and cognitive levels'),
      h('div', { class: 'form-grid' },
        field('Time (minutes)', input(c.meta.time, v => c.meta.time = +v || 0, { type: 'number', min: 0 })),
        field('Date written', input(c.meta.date || '', v => c.meta.date = v, { type: 'date' })),
        field('Instructions (one per line)', area((c.meta.instructions || []).join('\n'), v => c.meta.instructions = v.split('\n').map(s => s.trim()).filter(Boolean), 3))),
      h('div', { class: 'cog-edit' }, h('span', { class: 'lbl' }, 'Levels and targets (% of marks)'),
        ...[0, 1, 2, 3].map(i => h('div', { class: 'row' }, h('span', { class: 'muted' }, `${i + 1}.`),
          input(c.meta.levelNames[i], v => c.meta.levelNames[i] = v, { 'aria-label': `Level ${i + 1} name` }),
          input(c.meta.levelTargets[i], v => c.meta.levelTargets[i] = +v || 0, { type: 'number', min: 0, max: 100, class: 'num', 'aria-label': `Level ${i + 1} target` }), h('span', { class: 'muted' }, '%'))),
        h('div', { class: 'row wrap' }, h('span', { class: 'hint' }, 'The school’s standard taxonomy sheet: the same for every subject and grade.'),
          h('button', { class: 'link small', onclick: () => { const p = COG_PRESETS[preset]; c.meta.levelNames = [...p.names]; c.meta.levelTargets = [...p.targets]; structural(); } }, 'Reset to the standard'))),
      cogBox);
  }

  const BLOCK_ICONS = { heading: 'pen', text: 'doc', list: 'menu', box: 'flag', vocab: 'book', section: 'grid', question: 'check', image: 'upload', graph: 'swap', diagram: 'spark', table: 'grid', lines: 'menu', pagebreak: 'down' };
  const summary = (b, i, labels) => {
    const cut = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
    switch (b.type) {
      case 'heading': return cut(b.text) || 'Heading';
      case 'text': return cut(b.text) || 'Empty paragraph';
      case 'list': return cut((b.items || []).filter(Boolean).join(' · ')) || 'Empty list';
      case 'box': return cut(b.title || b.text) || 'Box';
      case 'vocab': return `${(b.items || []).filter(v => v.term).length} terms`;
      case 'section': return `${labels.get(i)}${b.title ? ': ' + cut(b.title, 50) : ''}`;
      case 'question': return `${labels.get(i)}  ${cut(b.q, 60) || 'Empty question'}  (${+b.marks || 0})${b.answer ? '' : ' · no memo'}`;
      case 'image': return b.src ? (b.caption || 'Picture') : 'Picture: none chosen yet';
      case 'graph': return 'Graph: ' + (cut((b.fns || []).filter(Boolean).join(';  '), 60) || 'no functions');
      case 'diagram': return b.svg ? (cut(b.caption || b.prompt, 60) || 'Diagram') : 'Diagram: not drawn yet';
      case 'table': return `Table ${b.rows?.length || 0} × ${Math.max(0, ...(b.rows || []).map(r => r.length))}`;
      case 'lines': return `${b.count} writing lines`;
      default: return blockLabel(b.type);
    }
  };

  // The "+" between blocks: pick what to add.
  function addMenu(at, compact = false) {
    const wrap = h('div', { class: 'add-between' + (compact ? ' compact' : '') });
    const btn = h('button', { class: 'add-btn', 'aria-label': 'Add here', title: 'Add here', onclick: () => { wrap.classList.toggle('open'); } }, icon('plus', 14), compact ? null : h('span', {}, 'Add'));
    const kinds = c.type === 'notes' ? ['heading', 'text', 'list', 'box', 'vocab', 'image', 'diagram', 'graph', 'table', 'pagebreak']
      : ['question', 'section', 'text', 'image', 'diagram', 'graph', 'table', 'box', 'lines', 'pagebreak'];
    const menu = h('div', { class: 'add-menu', role: 'menu' }, kinds.map(k => h('button', { role: 'menuitem', onclick: () => { snapshot(); c.blocks.splice(at, 0, newBlock(k)); selected = at; structural(); scrollToSel(); } }, icon(BLOCK_ICONS[k] || 'plus', 16), blockLabel(k))));
    wrap.append(btn, menu);
    return wrap;
  }
  const scrollToSel = () => requestAnimationFrame(() => editor.querySelector(`[data-ed="${selected}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

  // Small AI changes to one block.
  async function tweak(i, instr, btn) {
    const b = c.blocks[i];
    const done = busy(btn, 'Changing…');
    try {
      const subj = subjectById(c.subjectId);
      const mini = { ...c, blocks: [b] };
      const r = await aiRevise(c.type, { title: c.title, blocks: toAiJson(mini).blocks }, `Change ONLY this block: ${instr}. Return the replacement block(s) only. You may return more than one block (for example a diagram or graph block followed by the question). Keep the marks unless asked. Update the memo answer to match.`, { subject: subj?.name, grade: c.grade, language: c.language, levelNames: c.type === 'test' ? c.meta.levelNames : null });
      const tmp = { type: c.type, title: c.title, meta: JSON.parse(JSON.stringify(c.meta || {})), blocks: [] };
      applyAi(tmp, { blocks: r.blocks || [] }, { blocks: [b] });
      if (!tmp.blocks.length) throw new Error('The AI didn’t send anything back. Try again.');
      snapshot();
      c.blocks.splice(i, 1, ...tmp.blocks);
      selected = i; structural(); toast('Changed. Undo brings the old one back.');
    } catch (e) { toast(e.message, 'error'); } finally { done(); }
  }

  const sectionEnd = i => { let j = i + 1; while (j < c.blocks.length && c.blocks[j].type !== 'section') j++; return j; };
  const sectionMarks = i => c.blocks.slice(i + 1, sectionEnd(i)).filter(b => b.type === 'question').reduce((a, b) => a + (+b.marks || 0), 0);
  // Write one QUESTION (section) again: keeps the rest of the paper exactly as it is.
  async function rewriteSection(i, btn) {
    const sec = c.blocks[i], end = sectionEnd(i);
    const secs = c.blocks.map((b, k) => b.type === 'section' ? { title: b.title, marks: k === i ? (sectionMarks(k) || sec.redo?.marks || 10) : sectionMarks(k) } : null).filter(Boolean);
    const n = c.blocks.slice(0, i + 1).filter(b => b.type === 'section').length;
    const existing = c.blocks.slice(i + 1, end).filter(b => b.type === 'question').map(b => b.q).join(' | ').slice(0, 1500);
    const want = { title: sec.title, marks: secs[n - 1].marks, focus: sec.redo?.focus || (existing ? `Same topic as before, new questions. Old questions were: ${existing}` : sec.title), visual: sec.redo?.visual || (c.blocks.slice(i + 1, end).some(b => b.type === 'diagram') ? 'diagram' : c.blocks.slice(i + 1, end).some(b => b.type === 'graph') ? 'graph' : 'none') };
    const done = busy(btn, 'Writing…');
    try {
      const subj = subjectById(c.subjectId);
      const o = { subject: subj?.name, grade: c.grade, language: c.language, topic: c.meta.brief?.topic || c.title, details: c.meta.brief?.details || '', extra: c.meta.brief?.extra || '', sourceText: c.meta.brief?.sourceText || '', levelNames: c.meta.levelNames, levelTargets: c.meta.levelTargets };
      const blocks = await aiTestSection(o, want, n, secs);
      for (const b of blocks.filter(b => b.type === 'diagram' && !b.svg && b.prompt).slice(0, 2)) { try { const d = await aiDiagram(b.prompt, o); b.svg = d.svg; b.caption ||= d.caption; } catch {} }
      const tmp = { type: c.type, title: c.title, meta: JSON.parse(JSON.stringify(c.meta || {})), blocks: [] };
      applyAi(tmp, { blocks });
      snapshot();
      c.blocks.splice(i, end - i, ...tmp.blocks);
      selected = i; structural(); toast(`Question ${n} written again (${want.marks} marks). Undo brings back the old one.`);
    } catch (e) { toast(e.message, 'error'); } finally { done(); }
  }

  // Questions, sections and text are always open: type straight in. Pictures, graphs and diagrams open when tapped.
  const ALWAYS = new Set(['question', 'section', 'text', 'heading']);
  function blockEditor(b, i, labels) {
    const always = ALWAYS.has(b.type);
    const open = selected === i || always;
    const move = dir => { const j = i + dir; if (j < 0 || j >= c.blocks.length) return; snapshot(); [c.blocks[i], c.blocks[j]] = [c.blocks[j], c.blocks[i]]; selected = j; structural(); };
    const handle = h('button', { class: 'drag-h', 'aria-label': 'Drag to move', title: 'Drag to move' }, '⋮⋮');
    const head = h('div', { class: 'ed-head' },
      handle,
      always ? h('span', { class: 'ed-sum fixed' }, h('span', { class: 'ed-type' }, b.type === 'question' ? h('b', {}, labels.get(i) || '') : icon(BLOCK_ICONS[b.type] || 'doc', 14), b.type === 'question' ? (b.kind === 'mcq' ? 'Multiple choice' : 'Question') : b.type === 'section' ? (labels.get(i) || 'Section') : blockLabel(b.type)))
      : h('button', { class: 'ed-sum', 'aria-expanded': String(open), onclick: () => { selected = open ? -1 : i; drawEditor(); renderPreview(); if (!open) scrollToSel(); } },
        h('span', { class: 'ed-type' }, icon(BLOCK_ICONS[b.type] || 'doc', 14), blockLabel(b.type)), h('span', { class: 'ed-text' }, summary(b, i, labels))),
      open ? h('div', { class: 'row ed-tools' },
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('up', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === c.blocks.length - 1, onclick: () => move(1) }, icon('down', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Duplicate', onclick: () => { snapshot(); c.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); selected = i + 1; structural(); } }, icon('copy', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: () => { snapshot(); c.blocks.splice(i, 1); selected = -1; structural(); toast('Deleted. Undo brings it back.'); } }, icon('trash', 16))) : null);
    const card = h('div', { class: 'ed-card' + (selected === i ? ' sel' : '') + (open ? '' : ' closed') + (always ? ' always t-' + b.type : ''), 'data-ed': i }, head);
    dragReorder(handle, card, i);
    // Typing in a block highlights it on the page, without redrawing (so the cursor stays put).
    const pick = () => {
      if (selected === i) return;
      selected = i;
      editor.querySelectorAll('.ed-card.sel').forEach(x => x.classList.remove('sel')); card.classList.add('sel');
      preview.querySelectorAll('.pv-sel').forEach(x => x.classList.remove('pv-sel'));
      const el = preview.querySelector(`[data-i="${i}"]`); if (el) { el.classList.add('pv-sel'); if (innerWidth >= 1100) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      placeTools();
    };
    card.addEventListener('focusin', pick);
    if (always) card.addEventListener('click', pick);
    if (!open) return card;

    let body;
    switch (b.type) {
      case 'heading': body = input(b.text, v => b.text = v, { class: 'ed-heading', 'aria-label': 'Heading' }); break;
      case 'text': body = area(b.text, v => b.text = v, 3, 'Write here. Leave a blank line between paragraphs. **bold** for bold.'); break;
      case 'list': body = field('Items (one per line)', area((b.items || []).join('\n'), v => b.items = v.split('\n'), 3)); break;
      case 'box': body = h('div', { class: 'stack' }, h('div', { class: 'row' }, input(b.title, v => b.title = v, { placeholder: 'Box title', 'aria-label': 'Box title' }),
        h('select', { 'aria-label': 'Box style', onchange: e => { b.style = e.target.value; changed(); } }, [['key', 'Key fact'], ['info', 'Information'], ['warn', 'Warning']].map(([v, l]) => h('option', { value: v, selected: b.style === v }, l)))), area(b.text, v => b.text = v, 2)); break;
      case 'vocab': body = h('div', { class: 'stack' }, ...(b.items || []).map((v, k) => h('div', { class: 'row vocab-row' },
        input(v.term, x => v.term = x, { placeholder: 'Term', 'aria-label': 'Term' }), input(v.meaning, x => v.meaning = x, { placeholder: 'Meaning', 'aria-label': 'Meaning' }),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove term', onclick: () => { b.items.splice(k, 1); structural(); } }, icon('x', 14)))),
        h('button', { class: 'btn ghost sm', onclick: () => { b.items.push({ term: '', meaning: '' }); structural(); } }, icon('plus', 14), 'Add term')); break;
      case 'section': {
        const redo = h('button', { class: 'btn ghost sm', disabled: !aiReady(), title: aiUnavailableReason() || '' }, icon('spark', 14), b.redo ? 'Write this question again' : 'Rewrite this whole question with AI');
        redo.onclick = () => rewriteSection(i, redo);
        body = h('div', { class: 'stack' }, input(b.title, v => b.title = v, { placeholder: 'Section title, e.g. Multiple choice', 'aria-label': 'Section title' }), input(b.text, v => b.text = v, { placeholder: 'Instructions for this section (optional)', 'aria-label': 'Section instructions' }),
          c.type === 'test' ? h('div', { class: 'row wrap' }, redo, h('span', { class: 'muted small' }, `${sectionMarks(i)} marks`)) : null);
        break;
      }
      case 'question': {
        const levels = c.meta?.levelNames || COG_PRESETS.general.names;
        const marksOut = h('b', { class: 'mk-val' }, String(+b.marks || 0));
        const step = d => { b.marks = Math.max(0, (+b.marks || 0) + d); marksOut.textContent = b.marks; changed(); drawCog(); };
        body = h('div', { class: 'stack' },
          area(b.q, v => b.q = v, 2, 'Question'),
          h('div', { class: 'row wrap q-opts' },
            h('span', { class: 'inline stepper' }, 'Marks', h('button', { class: 'icon-btn', 'aria-label': 'One mark less', onclick: () => step(-1) }, '−'), marksOut, h('button', { class: 'icon-btn', 'aria-label': 'One mark more', onclick: () => step(1) }, '+')),
            h('label', { class: 'inline' }, 'Type', h('select', { onchange: e => { b.kind = e.target.value; if (b.kind === 'mcq' && (b.options || []).length < 2) b.options = ['', '', '', '']; structural(); } }, [['open', 'Written answer'], ['mcq', 'Multiple choice']].map(([v, l]) => h('option', { value: v, selected: b.kind === v }, l)))),
            c.type === 'test' || c.type === 'worksheet' ? h('label', { class: 'inline' }, 'Level', h('select', { onchange: e => { b.cog = +e.target.value; changed(); } }, levels.map((n, k) => h('option', { value: k + 1, selected: (+b.cog || 1) === k + 1 }, `${k + 1}. ${n}`)))) : null,
            b.kind !== 'mcq' ? h('label', { class: 'inline' }, 'Lines', input(b.lines ?? '', v => b.lines = v === '' ? null : +v, { type: 'number', min: 0, class: 'num', placeholder: 'auto' })) : null),
          b.kind === 'mcq' ? h('div', { class: 'stack' }, ...(b.options || []).map((o, k) => h('div', { class: 'row' }, h('b', {}, 'ABCDEF'[k]), input(o, v => b.options[k] = v, { 'aria-label': 'Option ' + 'ABCDEF'[k] }))),
            (b.options || []).length < 6 ? h('button', { class: 'link small', onclick: () => { b.options.push(''); structural(); } }, 'Add an option') : null) : null,
          field('Memo answer and mark split', area(b.answer, v => b.answer = v, 1, 'e.g. x = 3 ✓  y = −2 ✓ (2). One ✓ per mark.')));
        break;
      }
      case 'image': {
        const up = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = up.files[0]; if (!f) return; b.src = await toImage(f); structural(); } });
        body = h('div', { class: 'stack' },
          b.src ? h('img', { src: b.src, class: 'ed-img', alt: '' }) : h('button', { class: 'drop small-drop', onclick: () => up.click() }, icon('upload', 18), h('span', {}, 'Choose a picture, or take a photo of a diagram')),
          up, sizeRow(b), b.src ? h('button', { class: 'btn ghost sm', onclick: () => up.click() }, 'Replace picture') : null);
        break;
      }
      case 'graph': body = graphEditor(b); break;
      case 'diagram': body = diagramEditor(b); break;
      case 'table': {
        const cols = Math.max(1, ...b.rows.map(r => r.length));
        body = h('div', { class: 'stack' },
          h('div', { class: 'ed-table', style: { gridTemplateColumns: `repeat(${cols}, minmax(6rem, 1fr))` } }, b.rows.flatMap((r, ri) => Array.from({ length: cols }, (_, ci) => input(r[ci] ?? '', v => { r[ci] = v; }, { class: ri === 0 ? 'th' : '', 'aria-label': `Row ${ri + 1} column ${ci + 1}` })))),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn ghost sm', onclick: () => { b.rows.push(Array(cols).fill('')); structural(); } }, '+ Row'),
            h('button', { class: 'btn ghost sm', onclick: () => { b.rows.forEach(r => r.push('')); structural(); } }, '+ Column'),
            b.rows.length > 1 ? h('button', { class: 'btn ghost sm', onclick: () => { b.rows.pop(); structural(); } }, '− Row') : null,
            cols > 1 ? h('button', { class: 'btn ghost sm', onclick: () => { b.rows.forEach(r => r.length = cols - 1); structural(); } }, '− Column') : null));
        break;
      }
      case 'lines': body = h('label', { class: 'inline' }, 'Number of lines', input(b.count, v => b.count = +v || 0, { type: 'number', min: 1, max: 40, class: 'num' })); break;
      case 'pagebreak': body = h('p', { class: 'muted small' }, 'The next block starts on a new page.'); break;
    }
    card.append(body);
    // Ask AI to change just this block.
    if (aiReady() && ['question', 'text', 'section', 'box', 'list', 'vocab', 'table', 'heading'].includes(b.type)) {
      const tIn = h('input', { placeholder: 'Ask AI to change just this…', 'aria-label': 'Change this block with AI' });
      const goB = h('button', { class: 'btn sm' }, icon('spark', 14), 'Change');
      goB.onclick = () => { if (tIn.value.trim()) tweak(i, tIn.value.trim(), goB); else tIn.focus(); };
      tIn.addEventListener('keydown', e => { if (e.key === 'Enter') goB.click(); });
      const quick = b.type === 'question' ? [['Easier', 'make it easier'], ['Harder', 'make it harder and higher-order'], ['Rewrite', 'reword it more clearly'], ['Add a diagram', 'add a labelled diagram (or a graph for maths functions) before the question, and refer to it'], ['Real-life context', 'set it in a South African real-life context']]
        : [['Simpler', 'simpler language for the grade'], ['Shorter', 'make it shorter'], ['Rewrite', 'reword it more clearly']];
      card.append(h('div', { class: 'ed-ai' }, h('div', { class: 'chips' }, quick.map(([l, instr]) => { const qb = h('button', { class: 'chip' }, icon('spark', 12), l); qb.onclick = () => tweak(i, instr, qb); return qb; })), h('div', { class: 'row' }, tIn, goB)));
    }
    return card;
  }

  function sizeRow(b) {
    return h('div', { class: 'row wrap' },
      h('label', { class: 'inline' }, 'Width', h('input', { type: 'range', min: 20, max: 100, step: 5, value: b.width || 60, oninput: e => { b.width = +e.target.value; changed(); } })),
      input(b.caption, v => b.caption = v, { placeholder: 'Caption, e.g. Figure 1', 'aria-label': 'Caption' }));
  }

  function graphEditor(b) {
    const pv = h('div', { class: 'ed-graph' });
    const redraw = () => { pv.innerHTML = graphSvg(b); changed(); };
    const fnRows = h('div', { class: 'stack' });
    const drawFns = () => fnRows.replaceChildren(...(b.fns || []).map((f, k) => h('div', { class: 'row' },
      h('input', { value: f, placeholder: 'e.g. f(x) = x² − 4', 'aria-label': `Function ${k + 1}`, oninput: e => { b.fns[k] = e.target.value; redraw(); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove function', onclick: () => { b.fns.splice(k, 1); drawFns(); redraw(); } }, icon('x', 14)))),
      (b.fns || []).length < 4 ? h('button', { class: 'link small', onclick: () => { b.fns.push(''); drawFns(); } }, '+ Another function') : null);
    drawFns();
    const num = (label, key) => h('label', { class: 'inline' }, label, h('input', { type: 'number', class: 'num', value: b[key], oninput: e => { b[key] = +e.target.value; redraw(); } }));
    const ptRows = h('div', { class: 'stack' });
    const drawPts = () => ptRows.replaceChildren(...(b.points || []).map((p, k) => h('div', { class: 'row' },
      h('input', { class: 'num', value: p.x, 'aria-label': 'x', placeholder: 'x', oninput: e => { p.x = +e.target.value; redraw(); } }),
      h('input', { class: 'num', value: p.y, 'aria-label': 'y', placeholder: 'y', oninput: e => { p.y = +e.target.value; redraw(); } }),
      h('input', { value: p.label || '', 'aria-label': 'Label', placeholder: 'Label, e.g. A(2;0)', oninput: e => { p.label = e.target.value; redraw(); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove point', onclick: () => { b.points.splice(k, 1); drawPts(); redraw(); } }, icon('x', 14)))),
      h('button', { class: 'link small', onclick: () => { (b.points ||= []).push({ x: 0, y: 0, label: '' }); drawPts(); redraw(); } }, '+ Point'));
    drawPts();
    pv.innerHTML = graphSvg(b);
    return h('div', { class: 'stack' },
      h('span', { class: 'lbl' }, 'Functions'), fnRows,
      h('div', { class: 'row wrap' }, num('x from', 'xmin'), num('to', 'xmax'), num('y from', 'ymin'), num('to', 'ymax')),
      h('div', { class: 'row wrap' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.grid !== false, onchange: e => { b.grid = e.target.checked; redraw(); } }), 'Grid'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.labels !== false, onchange: e => { b.labels = e.target.checked; redraw(); } }), 'Numbers on axes')),
      h('details', {}, h('summary', { class: 'small' }, `Points (${(b.points || []).length})`), ptRows),
      pv, sizeRow(b),
      h('p', { class: 'hint' }, 'Type functions the way you would on the board: y = 2x + 1, f(x) = −x² + 4, y = 2^x, y = 3/x, y = 2sin x (degrees when the x range is wide).'));
  }

  function diagramEditor(b) {
    const prompt = area(b.prompt, v => b.prompt = v, 2, 'Describe the diagram, e.g. “Series circuit: cell, switch, two bulbs and an ammeter” or “Plant cell with parts labelled A to F”');
    const draw = h('button', { class: 'btn sm', disabled: !aiReady(), title: aiUnavailableReason() || '' }, icon('spark', 14), b.svg ? 'Draw it again' : 'Draw it');
    draw.onclick = async () => {
      if (!b.prompt?.trim()) { prompt.focus(); return; }
      const done = busy(draw, 'Drawing…');
      try { const subj = subjectById(c.subjectId); const r = await aiDiagram(b.prompt, { subject: subj?.name, grade: c.grade, language: c.language }); const svg = cleanSvg(r.svg); if (!svg) throw new Error('The drawing didn’t come out. Try describing it differently.'); snapshot(); b.svg = svg; if (!b.caption && r.caption) b.caption = r.caption; structural(); }
      catch (e) { toast(e.message, 'error'); } finally { done(); }
    };
    const pasteArea = h('textarea', { rows: 3, placeholder: '<svg …>…</svg>', 'aria-label': 'SVG code' });
    return h('div', { class: 'stack' },
      prompt,
      h('div', { class: 'row wrap' }, draw, !aiReady() ? h('span', { class: 'muted small' }, 'Needs AI. Or use a Picture block with a photo of your diagram.') : null),
      b.svg ? h('div', { class: 'ed-graph', html: b.svg }) : null,
      sizeRow(b),
      h('details', {}, h('summary', { class: 'small' }, 'Paste your own SVG drawing'), pasteArea,
        h('button', { class: 'btn ghost sm', onclick: () => { const svg = cleanSvg(pasteArea.value); if (!svg) { toast('That isn’t an SVG drawing.', 'error'); return; } snapshot(); b.svg = svg; structural(); } }, 'Use it')));
  }

  // Drag a block by its handle to a new place.
  function dragReorder(handle, card, i) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const cards = [...editor.querySelectorAll('.ed-card[data-ed]')];
      let to = i;
      card.classList.add('dragging');
      const mark = () => cards.forEach((cd, k) => { cd.classList.toggle('drop-before', k === to && to !== i && to !== i + 1); cd.classList.toggle('drop-after', to === cards.length && k === cards.length - 1 && i !== cards.length - 1); });
      const move = ev => {
        const y = ev.clientY;
        const k = cards.findIndex(cd => { const r = cd.getBoundingClientRect(); return y < r.top + r.height / 2; });
        to = k < 0 ? cards.length : k; mark();
        const ep = editor.closest('.ed-pane') || document.scrollingElement;
        if (y < 80) window.scrollBy(0, -12); else if (y > innerHeight - 80) window.scrollBy(0, 12);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        cards.forEach(cd => cd.classList.remove('drop-before', 'drop-after', 'dragging'));
        const dest = to > i ? to - 1 : to;
        if (dest !== i) { snapshot(); const [blk] = c.blocks.splice(i, 1); c.blocks.splice(dest, 0, blk); selected = dest; structural(); }
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  }

  function quickAdd(list, make) {
    return h('div', { class: 'quick-add' }, h('span', { class: 'muted small' }, 'Add:'), list.map(([t, l]) => h('button', { class: 'chip', onclick: () => { snapshot(); make(t); structural(); setTimeout(() => editor.lastElementChild?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } }, '+ ' + l)));
  }

  function drawEditor() {
    const kids = [];
    if (isBlockDoc(c)) {
      const labels = numberBlocks(c.blocks);
      kids.push(h('p', { class: 'muted small ed-tip' }, 'Type straight into the questions and memo. Drag ⋮⋮ to move, + adds something in between. Tap a question on the page to jump to it.'));
      kids.push(addMenu(0, true));
      c.blocks.forEach((b, i) => { kids.push(blockEditor(b, i, labels)); kids.push(addMenu(i + 1, i < c.blocks.length - 1)); });
      if (!c.blocks.length) kids.push(h('p', { class: 'empty' }, 'Empty. Use Add to put in your first question or paragraph.'));
    } else if (c.type === 'slides') {
      c.slides.forEach((s, i) => {
        const up = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = up.files[0]; if (f) { s.image = await toImage(f); structural(); } } });
        kids.push(h('div', { class: 'ed-card', 'data-ed': i },
          h('div', { class: 'ed-head' }, h('span', { class: 'ed-type' }, `Slide ${i + 2}`), h('div', { class: 'row' },
            h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { snapshot(); [c.slides[i - 1], c.slides[i]] = [c.slides[i], c.slides[i - 1]]; structural(); } }, icon('up', 16)),
            h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === c.slides.length - 1, onclick: () => { snapshot(); [c.slides[i + 1], c.slides[i]] = [c.slides[i], c.slides[i + 1]]; structural(); } }, icon('down', 16)),
            h('button', { class: 'icon-btn', 'aria-label': 'Delete slide', onclick: () => { snapshot(); c.slides.splice(i, 1); structural(); } }, icon('trash', 16)))),
          input(s.title, v => s.title = v, { class: 'ed-heading', 'aria-label': 'Slide title' }),
          field('Bullets (one per line)', area((s.bullets || []).join('\n'), v => s.bullets = v.split('\n'), 3)),
          field('Speaker notes', area(s.notes, v => s.notes = v, 1)),
          h('div', { class: 'row wrap' }, s.image ? h('img', { src: s.image, class: 'ed-thumb', alt: '' }) : null,
            h('button', { class: 'btn ghost sm', onclick: () => up.click() }, icon('upload', 14), s.image ? 'Replace picture' : 'Add a picture'),
            s.image ? h('button', { class: 'btn ghost sm', onclick: () => { s.image = ''; structural(); } }, 'Remove picture') : null, up)));
      });
      kids.push(quickAdd([['slide', 'Slide']], () => c.slides.push({ title: 'New slide', bullets: [''], notes: '' })));
    } else if (c.type === 'rubric') {
      const r = c.rubric;
      kids.push(h('div', { class: 'ed-card' }, field('Task description', area(r.task, v => r.task = v, 2)),
        h('span', { class: 'lbl' }, 'Levels (best first)'),
        ...r.levels.map((l, k) => h('div', { class: 'row' }, input(l.label, v => l.label = v, { 'aria-label': 'Level name' }), input(l.marks, v => l.marks = v, { class: 'num', 'aria-label': 'Marks', placeholder: 'marks' }),
          r.levels.length > 2 ? h('button', { class: 'icon-btn', 'aria-label': 'Remove level', onclick: () => { snapshot(); r.levels.splice(k, 1); r.criteria.forEach(cr => cr.descriptors.splice(k, 1)); structural(); } }, icon('x', 14)) : null)),
        r.levels.length < 7 ? h('button', { class: 'btn ghost sm', onclick: () => { r.levels.push({ label: 'Level', marks: '' }); r.criteria.forEach(cr => cr.descriptors.push('')); structural(); } }, '+ Level') : null));
      r.criteria.forEach((cr, i) => kids.push(h('div', { class: 'ed-card', 'data-ed': i },
        h('div', { class: 'ed-head' }, h('span', { class: 'ed-type' }, `Criterion ${i + 1}`), h('button', { class: 'icon-btn', 'aria-label': 'Delete criterion', onclick: () => { snapshot(); r.criteria.splice(i, 1); structural(); } }, icon('trash', 16))),
        input(cr.name, v => cr.name = v, { class: 'ed-heading', 'aria-label': 'Criterion' }),
        ...r.levels.map((l, k) => field(`${l.label}${l.marks ? ` (${l.marks})` : ''}`, area(cr.descriptors[k], v => cr.descriptors[k] = v, 1))))));
      kids.push(quickAdd([['c', 'Criterion']], () => r.criteria.push({ name: 'New criterion', descriptors: r.levels.map(() => '') })));
    } else if (c.type === 'cards') {
      kids.push(h('div', { class: 'ed-card' }, h('span', { class: 'lbl' }, 'Terms and meanings'),
        ...c.cards.map((x, k) => h('div', { class: 'row vocab-row', 'data-ed': k },
          input(x.term, v => x.term = v, { placeholder: 'Term', 'aria-label': 'Term' }), input(x.meaning, v => x.meaning = v, { placeholder: 'Meaning', 'aria-label': 'Meaning' }),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { snapshot(); c.cards.splice(k, 1); structural(); } }, icon('x', 14)))),
        h('p', { class: 'hint' }, 'Word search uses the terms (letters only, 3–15 long).')));
      kids.push(quickAdd([['t', 'Term']], () => c.cards.push({ term: '', meaning: '' })));
    }
    editor.replaceChildren(...kids);
    drawCog();
  }

  // ---------- Layout ----------
  const tabs = h('div', { class: 'seg pane-tabs', role: 'tablist' },
    h('button', { role: 'tab', onclick: () => { pane = 'edit'; layout(); } }, 'Edit'),
    h('button', { role: 'tab', onclick: () => { pane = 'preview'; layout(); fit(); } }, 'Preview'));
  const split = h('div', { class: 'designer-split' }, h('div', { class: 'ed-pane' }, editor), previewWrap);
  const layout = () => { split.dataset.pane = pane; tabs.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', String((k === 0) === (pane === 'edit')))); };
  drawTop();
  root.replaceChildren(h('div', { class: 'page designer' }, top, tabs, split));
  layout(); drawEditor(); renderPreview();
  requestAnimationFrame(fit);
  const ro = new ResizeObserver(fit); ro.observe(previewWrap);
  const off = onChange(w => { if (w === 'settings') { ensureCss(true); renderPreview(); } });
  return () => { ro.disconnect(); off(); clearTimeout(saveT); saveCreation(c); };
}

const expBtn = (label, ic, fn) => {
  const b = h('button', { class: 'btn ghost' }, icon(ic), label);
  b.onclick = async () => { const done = busy(b, 'Saving…'); try { await fn(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'error'); } finally { done(); } };
  return b;
};

function ensureCss(force) {
  let s = document.getElementById('create-theme-css');
  if (s && !force) return;
  if (!s) { s = document.createElement('style'); s.id = 'create-theme-css'; document.head.append(s); }
  s.textContent = themeCss();
}

function grow(t) { const f = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 360) + 'px'; }; requestAnimationFrame(f); t.addEventListener('input', f); return t; }

// Pictures are resized and flattened onto white so diagrams with transparency print cleanly.
function toImage(file, max = 1400) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(/png|gif|svg/.test(file.type) ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => rej(new Error('Could not open that picture.'));
    img.src = URL.createObjectURL(file);
  });
}

// Things a teacher would want to fix before printing.
function checksOf(c) {
  const out = [];
  if (!isBlockDoc(c) || c.type === 'notes') {
    if (isBlockDoc(c)) (c.blocks || []).forEach((b, i) => { if (b.type === 'diagram' && !b.svg) out.push({ i, msg: 'A diagram hasn’t been drawn yet.' }); });
    return out;
  }
  const blocks = c.blocks || [];
  const labels = numberBlocks(blocks);
  const total = totalMarks(blocks);
  if (c.meta?.targetMarks && total !== c.meta.targetMarks) out.push({ msg: `The marks add up to ${total}, not ${c.meta.targetMarks}.` });
  blocks.forEach((b, i) => {
    if (b.type === 'question') {
      const n = labels.get(i);
      if (!String(b.q || '').trim()) out.push({ i, msg: `Question ${n} is empty.` });
      if (!(+b.marks > 0)) out.push({ i, msg: `Question ${n} has no marks.` });
      if (!String(b.answer || '').trim()) out.push({ i, msg: `Question ${n} has no memo answer.` });
      else if (b.kind !== 'mcq' && +b.marks > 1) { const ticks = (String(b.answer).match(/✓/g) || []).length; if (ticks && ticks !== +b.marks) out.push({ i, msg: `Question ${n}: the memo has ${ticks} ✓ but the question is worth ${b.marks}.` }); }
      if (b.kind === 'mcq' && (b.options || []).filter(o => String(o).trim()).length < 2) out.push({ i, msg: `Question ${n} needs its multiple-choice options.` });
    }
    if (b.type === 'diagram' && !b.svg) out.push({ i, msg: 'A diagram hasn’t been drawn yet.' });
    if (b.type === 'graph') for (const f of (b.fns || []).filter(x => String(x).trim())) { try { compile(f); } catch { out.push({ i, msg: `The graph can’t read “${f}”.` }); } }
    if (b.type === 'image' && !b.src) out.push({ i, msg: 'A picture block is empty.' });
  });
  if (c.type === 'test') for (const r of cogGrid(c)) if (Math.abs(r.pct - r.target) > 5) out.push({ msg: `Level ${r.level} (${r.name}) is ${r.pct}% of the marks; the target is ${r.target}%.` });
  return out;
}
