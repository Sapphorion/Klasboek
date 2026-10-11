// One lesson: details, generate materials (AI or template), edit them, export, attach files.
import { state, lessonById, saveLesson, deleteLesson, subjectById, atpById, subjectLabel, addMaterial } from '../state.js';
import { h, icon, modal, toast, busy, confirmBox, download, shareFile, shareText } from '../ui.js';
import { fmtLong, minutesBetween } from '../dates.js';
import { buildContent, buildNotes, lessonContext } from '../generate.js';
import { aiReady, aiUnavailableReason } from '../ai.js';
import { exportLessonPlanDocx, exportSlidesPptx, printLesson, lessonDocHtml, docCss, buildWorksheetDocx, buildNotesDocx, activityText } from '../exporters.js';
import { checkFor } from '../aicheck.js';
import { openChecker } from './checker.js';
import { eventsOn, nextAssessment, typeOf, eventLabel } from '../events.js';
import { creationFromLesson, creationFromNotes } from '../create/model.js';
import { saveCreation } from '../state.js';
import { markDone } from '../adjust.js';

let tab = 'plan';
let editing = false;

export function openLesson(id) {
  const l = lessonById(id);
  if (!l) return;
  ensurePreviewCss();
  const body = h('div', { class: 'lesson-panel' });
  const m = modal(l.title || 'Lesson', body, { wide: true, onClose: () => { if (lessonById(l.id)) saveLesson(l); } });
  const save = debounce(async () => { if (lessonById(l.id)) await saveLesson(l); }, 400);
  const draw = () => body.replaceChildren(...panel(l, save, draw, m));
  draw();
}

function ensurePreviewCss() {
  let st = document.getElementById('doc-preview-css');
  if (!st) { st = document.createElement('style'); st.id = 'doc-preview-css'; document.head.append(st); }
  st.textContent = docCss('#' + (state.settings.brandColour || '#1E3B33').replace('#', ''), '.doc-preview');
}

function panel(l, save, draw, m) {
  const s = subjectById(l.subjectId);
  const a = atpById(l.atpId);
  const period = state.timetable.periods.find(p => p.id === l.periodId);
  const ctx = lessonContext(l);
  const c = l.content;

  const dayEvents = l.date ? eventsOn(l.date) : [];
  const nextTest = l.date ? nextAssessment(l.subjectId, l.date, 21) : null;
  const top = h('section', { class: 'lp-top' },
    h('div', { class: 'meta-line' }, h('span', { class: 'swatch', style: { background: s?.colour || '#777' } }),
      !l.date ? 'Not on the planner yet: drag it from “Needs a period” onto a period.' : `${fmtLong(l.date)} · Period ${period?.label || ''}${period?.start ? ' (' + period.start + '–' + period.end + ', ' + minutesBetween(period.start, period.end) + ' min)' : ''}`,
      s ? ` · ${subjectLabel(s)}${l.cls ? ' · ' + l.cls : ''}` : ''),
    l.date && !l.done ? h('div', { class: 'row wrap lp-done' },
      h('button', { class: 'btn ghost sm', title: 'For work you covered earlier, e.g. revision already done in class', onclick: async () => { m.close(); await markDone([l], { label: `“${l.title || 'Lesson'}” marked as already done` }); } }, icon('check', 16), 'Already done: take it off the plan'),
      h('span', { class: 'muted small' }, 'This class’s next lessons move up into the free period.')) : null,
    !l.date && l.done ? h('div', { class: 'row wrap lp-done' },
      h('span', { class: 'done-badge' }, icon('check', 14), `Done already${l.doneOn ? ' (marked ' + fmtLong(l.doneOn) + ')' : ''}`),
      h('button', { class: 'btn ghost sm', onclick: async () => { l.done = false; await saveLesson(l); toast('It’s back under “Needs a period” on the planner.'); draw(); } }, 'Not done: put it back')) : null,
    (dayEvents.length || nextTest) ? h('div', { class: 'lp-events' },
      dayEvents.map(e => h('a', { class: 'ev-row', href: '#planner/month/' + e.date, onclick: () => m.close(), style: { '--c': typeOf(e.type).colour } }, h('span', { class: 'ev-type' }, 'Today · ' + typeOf(e.type).label), h('strong', {}, eventLabel(e)))),
      nextTest && !dayEvents.includes(nextTest) ? h('a', { class: 'ev-row', href: '#planner/month/' + nextTest.date, onclick: () => m.close(), style: { '--c': typeOf(nextTest.type).colour } }, h('span', { class: 'ev-type' }, `Coming up · ${fmtLong(nextTest.date)}`), h('strong', {}, eventLabel(nextTest))) : null) : null);

  const details = h('details', { class: 'lp-more', open: !c },
    h('summary', {}, 'Lesson details'),
    h('div', { class: 'lp-details' },
      h('div', { class: 'form-grid' },
        field('Lesson title', h('input', { value: l.title || '', oninput: e => { l.title = e.target.value; save(); m.el.querySelector('header h2').textContent = l.title; } })),
        field('Subject', h('select', { onchange: e => { l.subjectId = e.target.value; save(); draw(); } }, state.subjects.map(x => h('option', { value: x.id, selected: x.id === l.subjectId }, subjectLabel(x))))),
        field('Class', h('input', { value: l.cls || '', placeholder: 'e.g. 9B', oninput: e => { l.cls = e.target.value; save(); } })),
        field('Taught', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!l.done, onchange: e => { l.done = e.target.checked; save(); } }), 'Mark as taught'))),
      a ? h('details', { class: 'atp-box' }, h('summary', {}, `ATP: Term ${a.term}, week ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''} · ${a.topic}`), h('pre', {}, a.details || 'No details in the ATP for this week.')) : h('p', { class: 'muted' }, 'Not linked to an ATP topic.'),
      field('Notes for this lesson (also guides the AI)', h('textarea', { rows: 2, placeholder: 'e.g. Recap last lesson’s test, use the projector, 3 learners absent last week', oninput: e => { l.notes = e.target.value; save(); } }, l.notes || ''))));

  // ---------- Generate ----------
  const reason = aiUnavailableReason();
  const genAi = h('button', { class: 'btn ' + (c ? 'ghost sm' : 'primary'), disabled: !aiReady(), title: reason || 'Claude writes the lesson plan, notes, activity with memo, and slides' }, icon('spark'), c ? 'Rewrite with AI' : 'Write the lesson with AI');
  const genTpl = h('button', { class: 'btn ghost' + (c ? ' sm' : ''), title: 'Builds a structured draft from the ATP. Works offline.' }, icon('doc'), c ? 'Reset to template' : 'Start from the ATP (offline)');
  const run = async (useAi, btn) => {
    if (c && !await confirmBox('This replaces the lesson plan, notes, activity and slides you have now.', 'Replace')) return;
    const done = busy(btn, useAi ? 'Writing… about a minute' : 'Building…');
    try { l.content = await buildContent(l, { useAi }); checkFor(l); await saveLesson(l); toast(useAi ? 'Lesson written. Check it before you use it.' : 'Template ready. Fill in the gaps.'); draw(); }
    catch (e) { toast(e.message, 'error'); }
    finally { done(); }
  };
  genAi.onclick = () => run(true, genAi);
  genTpl.onclick = () => run(false, genTpl);
  const gen = h('div', { class: c ? 'lp-regen row wrap' : 'lp-generate' },
    c ? h('span', { class: 'muted small' }, c.source === 'ai' ? 'Written by AI: check facts and answers before class.' : 'Template draft: add your own content where it’s thin.') : h('p', {}, 'Make the lesson plan, learner notes, the activity with its memo, and slides in one go.'),
    h('div', { class: 'row wrap' }, genAi, genTpl),
    reason && !c ? h('p', { class: 'muted small' }, reason, ' ', !state.settings.apiKey ? h('a', { href: '#settings', onclick: () => m.close() }, 'Open Settings') : null) : null);

  const out = [top, details, gen];
  if (c) {
    const tabs = h('div', { class: 'tabs lp-tabs', role: 'tablist' }, [['plan', 'Lesson plan'], ['notes', 'Notes'], ['activity', 'Activity & memo'], ['slides', `Slides (${c.slides?.length || 0})`], ['files', `Files (${l.materialIds?.length || 0})`]].map(([t, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(tab === t), onclick: () => { tab = t; draw(); } }, label)));
    const pane = h('div', { class: 'tab-pane', role: 'tabpanel' });
    if (tab === 'plan') pane.append(...docTab(l, 'plan', save, draw, m, ctx));
    if (tab === 'notes') pane.append(...notesTab(l, save, draw, m));
    if (tab === 'activity') pane.append(...activityTab(l, save, draw, m));
    if (tab === 'slides') pane.append(h('div', { class: 'doc-bar' }, expBtn('Download PowerPoint', 'slides', () => exportSlidesPptx(l)), designBtn(l, 'slides', m)), slidesEditor(c, save, draw));
    if (tab === 'files') pane.append(filesPane(l, save, draw));
    out.push(tabs, pane);
  } else {
    out.push(h('div', { class: 'tab-pane' }, filesPane(l, save, draw)));
  }

  out.push(h('div', { class: 'row between lp-foot' },
    h('button', { class: 'btn danger ghost sm', onclick: async () => { if (await confirmBox('Delete this lesson and its materials? Attached files stay in your Materials library.')) { await deleteLesson(l.id); m.close(); toast('Lesson deleted.'); } } }, icon('trash'), 'Delete lesson'),
    h('button', { class: 'btn', onclick: () => m.close() }, 'Done'),
  ));
  return out;
}

const viewEditSeg = draw => h('div', { class: 'seg', role: 'group', 'aria-label': 'View or edit' },
  h('button', { 'aria-pressed': String(!editing), onclick: () => { editing = false; draw(); } }, 'View'),
  h('button', { 'aria-pressed': String(editing), onclick: () => { editing = true; draw(); } }, icon('pen', 14), 'Edit'));
const preview = html => { const d = h('div', { class: 'doc-preview' }); d.innerHTML = html; return d; };
const designBtn = (l, kind, m) => h('button', { class: 'btn ghost sm', title: 'Pictures, themes and layout in Create', onclick: async () => { const cr = await saveCreation(kind === 'notes' ? creationFromNotes(l) : creationFromLesson(l, kind)); m.close(); location.hash = 'create/' + cr.id; } }, icon('pen', 16), 'Design it');

function docTab(l, what, save, draw, m, ctx) {
  return [
    h('div', { class: 'doc-bar' }, viewEditSeg(draw),
      expBtn('Download (Word)', 'download', () => exportLessonPlanDocx(l)),
      h('button', { class: 'btn ghost sm', onclick: () => printLesson(l, 'plan') }, icon('print'), 'Print / PDF'),
      shareBtn('Share', () => exportLessonPlanDocx(l, { get: true }), l.title)),
    editing ? planEditor(l.content, save, ctx) : preview(lessonDocHtml(l, 'plan')),
  ];
}

function notesTab(l, save, draw, m) {
  const c = l.content;
  if (!c.notes) {
    const ai = h('button', { class: 'btn primary', disabled: !aiReady(), title: aiUnavailableReason() || '' }, icon('spark'), 'Write the notes with AI');
    const tpl = h('button', { class: 'btn ghost' }, icon('doc'), 'Start from the ATP (offline)');
    const go = async (useAi, b) => { const done = busy(b, useAi ? 'Writing…' : 'Building…'); try { c.notes = await buildNotes(l, { useAi }); await saveLesson(l); draw(); } catch (e) { toast(e.message, 'error'); } finally { done(); } };
    ai.onclick = () => go(true, ai); tpl.onclick = () => go(false, tpl);
    return [h('div', { class: 'empty-state' }, h('p', {}, 'Summarised notes learners keep and revise from. Download, print or share them with the class.'), h('div', { class: 'row wrap' }, ai, tpl))];
  }
  return [
    h('div', { class: 'doc-bar' }, viewEditSeg(draw),
      expBtn('Download (Word)', 'download', async () => { const f = await buildNotesDocx(l); download(f.blob, f.name); }),
      h('button', { class: 'btn ghost sm', onclick: () => printLesson(l, 'notes') }, icon('print'), 'Print / PDF'),
      shareBtn('Share with learners', () => buildNotesDocx(l), c.notes.title || l.title),
      designBtn(l, 'notes', m)),
    editing ? notesEditor(c.notes, c, save, draw) : preview(lessonDocHtml(l, 'notes')),
  ];
}

function activityTab(l, save, draw, m) {
  const c = l.content;
  const chk = checkFor(l);
  const checkPanel = h('details', { class: 'aic-panel', open: !!chk.on },
    h('summary', {}, icon('spark', 14), ` Hidden AI check: ${chk.on ? `on (“${chk.word}” × ${chk.n})` : 'off'}`),
    h('p', { class: 'small' }, 'The learner copy (Word, print and PDF) carries an instruction in invisible text. If a learner pastes the questions into an AI tool, its answers will use the word below. It is a clue to follow up, not proof: a learner may type the questions out, some AI tools ignore hidden text, and the plain-text message has no check.'),
    h('div', { class: 'row wrap' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!chk.on, onchange: e => { chk.on = e.target.checked; save(); draw(); } }), 'Add the check to the learner copy'),
      h('label', { class: 'inline' }, 'Word', h('input', { value: chk.word, class: 'w-word', oninput: e => { chk.word = e.target.value.trim().split(/\s+/)[0] || chk.word; save(); } })),
      h('label', { class: 'inline' }, 'Times', h('input', { type: 'number', min: 1, max: 20, class: 'num', value: chk.n, oninput: e => { chk.n = Math.max(1, +e.target.value || 6); save(); } })),
      h('button', { class: 'btn sm', onclick: () => openChecker(chk) }, icon('check', 16), 'Check a learner’s answers')),
    h('p', { class: 'hint' }, 'Tip: a screen reader may read the hidden text aloud. Switch the check off for classes where learners use one.'));
  return [
    h('div', { class: 'doc-bar' }, viewEditSeg(draw),
      shareBtn('Share with learners', () => buildWorksheetDocx(l, 'learner'), c.worksheet?.title || l.title, 'primary'),
      h('button', { class: 'btn ghost sm', onclick: () => shareText(activityText(l), c.worksheet?.title || l.title) }, icon('paper', 16), 'Send as a message'),
      shareBtn('Share memo', () => buildWorksheetDocx(l, 'memo'), 'Memo: ' + (c.worksheet?.title || l.title)),
      h('details', { class: 'more-menu' }, h('summary', { class: 'btn ghost sm' }, 'More'),
        h('div', { class: 'menu' },
          expBtn('Download learner copy (Word)', 'download', async () => { const f = await buildWorksheetDocx(l, 'learner'); download(f.blob, f.name); }),
          expBtn('Download memo (Word)', 'download', async () => { const f = await buildWorksheetDocx(l, 'memo'); download(f.blob, f.name); }),
          h('button', { class: 'btn ghost sm', onclick: () => printLesson(l, 'worksheet') }, icon('print'), 'Print learner copy'),
          h('button', { class: 'btn ghost sm', onclick: () => printLesson(l, 'memo') }, icon('print'), 'Print memo'),
          designBtn(l, 'worksheet', m)))),
    checkPanel,
    editing ? worksheetEditor(c, save, draw)
      : h('div', { class: 'act-views' }, h('h3', {}, 'Learner copy'), preview(lessonDocHtml(l, 'worksheet')), h('h3', {}, 'Memo (teacher copy)'), preview(lessonDocHtml(l, 'memo'))),
  ];
}

function shareBtn(label, build, title, kind = 'ghost') {
  const b = h('button', { class: `btn ${kind} sm` }, icon('paper', 16), label);
  b.onclick = async () => { const done = busy(b, 'Preparing…'); try { const f = await build(); done(); await shareFile(f, title); } catch (e) { done(); toast(e.message, 'error'); } };
  return b;
}

function notesEditor(n, c, save, draw) {
  return h('div', { class: 'editor' },
    field('Title', h('input', { value: n.title || '', oninput: e => { n.title = e.target.value; save(); } })),
    field('Introduction', ta(n.intro, v => { n.intro = v; save(); }, 2)),
    h('div', { class: 'stack' }, (n.sections ||= []).map((sct, i) => h('div', { class: 'phase' },
      h('div', { class: 'row' }, h('input', { class: 'ph-name', value: sct.heading, 'aria-label': 'Heading', oninput: e => { sct.heading = e.target.value; save(); } }),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove section', onclick: () => { n.sections.splice(i, 1); save(); draw(); } }, icon('trash', 16))),
      field('Explanation', ta(sct.text, v => { sct.text = v; save(); }, 3, 'Blank line between paragraphs')),
      field('Bullets (one per line)', ta(linesIn(sct.bullets), v => { sct.bullets = linesOut(v); save(); }, 2))))),
    h('button', { class: 'btn ghost', onclick: () => { n.sections.push({ heading: 'New section', text: '', bullets: [] }); save(); draw(); } }, icon('plus'), 'Add a section'),
    field('Key points (one per line)', ta(linesIn(n.keyPoints), v => { n.keyPoints = linesOut(v); save(); }, 3)),
    field('Key vocabulary (term: meaning, one per line)', ta((c.vocabulary || []).map(v => `${v.term}: ${v.meaning}`).join('\n'), v => { c.vocabulary = linesOut(v).map(x => { const i = x.indexOf(':'); return i > 0 ? { term: x.slice(0, i).trim(), meaning: x.slice(i + 1).trim() } : { term: x, meaning: '' }; }); save(); }, 2)),
  );
}

const expBtn = (label, ic, fn) => {
  const b = h('button', { class: 'btn ghost sm' }, icon(ic), label);
  b.onclick = async () => { const done = busy(b, 'Saving…'); try { await fn(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, 'error'); } finally { done(); } };
  return b;
};

// ---------- Editors ----------
function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}
const linesIn = (arr) => (arr || []).join('\n');
const linesOut = (v) => v.split('\n').map(s => s.trim()).filter(Boolean);
function autoGrow(t) { const f = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 420) + 'px'; }; requestAnimationFrame(f); t.addEventListener('input', f); return t; }
const ta = (value, on, rows = 2, ph = '') => autoGrow(h('textarea', { rows, placeholder: ph, oninput: e => on(e.target.value) }, value || ''));

function planEditor(c, save, ctx) {
  c.differentiation ||= { support: '', extension: '' };
  const phaseTotal = () => (c.phases || []).reduce((a, p) => a + (+p.minutes || 0), 0);
  const totalEl = h('span', { class: 'muted small' });
  const updTotal = () => { const t = phaseTotal(); totalEl.textContent = `${t} of ${ctx.minutes} minutes`; totalEl.classList.toggle('warn', t !== ctx.minutes); };
  updTotal();
  return h('div', { class: 'editor' },
    field('Objectives (one per line)', ta(linesIn(c.objectives), v => { c.objectives = linesOut(v); save(); }, 3)),
    field('Prior knowledge', ta(c.priorKnowledge, v => { c.priorKnowledge = v; save(); }, 2, 'What learners should already know')),
    field('Key vocabulary (term: meaning, one per line)', ta((c.vocabulary || []).map(v => `${v.term}: ${v.meaning}`).join('\n'), v => { c.vocabulary = linesOut(v).map(x => { const i = x.indexOf(':'); return i > 0 ? { term: x.slice(0, i).trim(), meaning: x.slice(i + 1).trim() } : { term: x, meaning: '' }; }); save(); }, 2)),
    field('Resources (one per line)', ta(linesIn(c.resources), v => { c.resources = linesOut(v); save(); }, 2)),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Lesson phases ', totalEl),
      h('div', { class: 'phases' }, (c.phases || []).map(p => h('div', { class: 'phase' },
        h('div', { class: 'row' }, h('input', { class: 'ph-name', value: p.name, 'aria-label': 'Phase name', oninput: e => { p.name = e.target.value; save(); } }),
          h('input', { class: 'ph-min', type: 'number', min: 0, value: p.minutes, 'aria-label': 'Minutes', oninput: e => { p.minutes = +e.target.value; updTotal(); save(); } }), h('span', { class: 'muted small' }, 'min')),
        h('div', { class: 'two' }, field('Teacher', ta(p.teacher, v => { p.teacher = v; save(); })), field('Learners', ta(p.learners, v => { p.learners = v; save(); }))),
      )))),
    field('Assessment', ta(c.assessment, v => { c.assessment = v; save(); })),
    h('div', { class: 'two' },
      field('Support (learners who struggle)', ta(c.differentiation.support, v => { c.differentiation.support = v; save(); })),
      field('Extension (learners who finish early)', ta(c.differentiation.extension, v => { c.differentiation.extension = v; save(); }))),
    field('Homework', ta(c.homework, v => { c.homework = v; save(); })),
  );
}

function slidesEditor(c, save, draw) {
  c.slides ||= [];
  const list = h('ol', { class: 'slide-list' }, c.slides.map((s, i) => h('li', { class: 'slide-ed' },
    h('div', { class: 'slide-preview', 'aria-hidden': 'true' }, h('strong', {}, s.title), h('ul', {}, (s.bullets || []).slice(0, 5).map(b => h('li', {}, b)))),
    h('div', { class: 'slide-fields' },
      field('Slide title', h('input', { value: s.title, oninput: e => { s.title = e.target.value; save(); } })),
      field('Bullets (one per line)', ta(linesIn(s.bullets), v => { s.bullets = linesOut(v); save(); }, 3)),
      field('Speaker notes', ta(s.notes, v => { s.notes = v; save(); }, 1)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', disabled: i === 0, onclick: () => { [c.slides[i - 1], c.slides[i]] = [c.slides[i], c.slides[i - 1]]; save(); draw(); } }, 'Move up'),
        h('button', { class: 'btn ghost sm', disabled: i === c.slides.length - 1, onclick: () => { [c.slides[i + 1], c.slides[i]] = [c.slides[i], c.slides[i + 1]]; save(); draw(); } }, 'Move down'),
        h('button', { class: 'btn ghost sm danger', onclick: () => { c.slides.splice(i, 1); save(); draw(); } }, 'Remove')),
    ))));
  return h('div', { class: 'editor' }, h('p', { class: 'muted small' }, 'A title slide with the subject, class and date is added automatically.'), list,
    h('button', { class: 'btn ghost', onclick: () => { c.slides.push({ title: 'New slide', bullets: [], notes: '' }); save(); draw(); } }, icon('plus'), 'Add slide'));
}

function worksheetEditor(c, save, draw) {
  c.worksheet ||= { title: c.title, instructions: '', questions: [] };
  const ws = c.worksheet;
  const totalEl = h('strong', {});
  const upd = () => { totalEl.textContent = ws.questions.reduce((a, q) => a + (+q.marks || 0), 0) + ' marks'; };
  upd();
  return h('div', { class: 'editor' },
    h('div', { class: 'two' }, field('Worksheet title', h('input', { value: ws.title, oninput: e => { ws.title = e.target.value; save(); } })), h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Total'), totalEl)),
    field('Instructions', ta(ws.instructions, v => { ws.instructions = v; save(); })),
    h('div', { class: 'q-list' }, ws.questions.map((q, i) => h('div', { class: 'q-ed' },
      h('div', { class: 'q-num' }, i + 1),
      h('div', { class: 'q-fields' },
        h('div', { class: 'row wrap' },
          h('input', { class: 'q-sec', value: q.section || '', placeholder: 'Section (optional)', 'aria-label': 'Section', oninput: e => { q.section = e.target.value; save(); } }),
          h('label', { class: 'inline' }, 'Marks', h('input', { type: 'number', min: 0, class: 'num', value: q.marks, oninput: e => { q.marks = +e.target.value; upd(); save(); } })),
          h('label', { class: 'inline' }, 'Lines', h('input', { type: 'number', min: 0, class: 'num', value: q.lines ?? '', placeholder: 'auto', oninput: e => { q.lines = e.target.value === '' ? undefined : +e.target.value; save(); } })),
          h('button', { class: 'icon-btn', 'aria-label': `Remove question ${i + 1}`, onclick: () => { ws.questions.splice(i, 1); save(); draw(); } }, icon('trash', 16))),
        field('Question', ta(q.q, v => { q.q = v; save(); })),
        field('Memo answer', ta(q.answer, v => { q.answer = v; save(); }, 1, 'Expected answer and mark allocation')),
      )))),
    h('button', { class: 'btn ghost', onclick: () => { ws.questions.push({ section: ws.questions.at(-1)?.section || '', q: '', marks: 2, answer: '' }); save(); draw(); } }, icon('plus'), 'Add question'),
  );
}

function filesPane(l, save, draw) {
  l.materialIds ||= [];
  const attached = l.materialIds.map(id => state.materials.find(m => m.id === id)).filter(Boolean);
  const others = state.materials.filter(m => !l.materialIds.includes(m.id) && (!m.subjectId || m.subjectId === l.subjectId));
  const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: async () => {
    for (const f of input.files) { const m = await addMaterial(f, { subjectId: l.subjectId, lessonId: l.id }); l.materialIds.push(m.id); }
    await saveLesson(l); toast('File attached.'); draw();
  } });
  const sel = h('select', { 'aria-label': 'Attach from library' }, h('option', { value: '' }, 'Attach from your library…'), others.map(m => h('option', { value: m.id }, m.name)));
  sel.onchange = async () => { if (!sel.value) return; l.materialIds.push(sel.value); await saveLesson(l); draw(); };
  return h('div', { class: 'editor' },
    attached.length ? h('ul', { class: 'file-list' }, attached.map(m => h('li', {},
      icon('clip', 16), h('button', { class: 'link', onclick: () => download(m.blob, m.name) }, m.name), h('span', { class: 'muted small' }, sizeOf(m.size)),
      h('button', { class: 'icon-btn', 'aria-label': 'Detach ' + m.name, onclick: async () => { l.materialIds = l.materialIds.filter(x => x !== m.id); await saveLesson(l); draw(); } }, icon('x', 16))))) : h('p', { class: 'muted' }, 'No files attached. Attach a reading, video link file, past paper or your own worksheet.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn ghost', onclick: () => input.click() }, icon('upload'), 'Upload files'), input, others.length ? sel : null),
  );
}
export const sizeOf = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
