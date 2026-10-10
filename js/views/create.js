// Create: make tests, worksheets, notes, slides, rubrics and flashcards, then design them
// with a live A4 preview.
import { state, onChange, saveCreation, deleteCreation, creationById, subjectById, subjectLabel, atpById } from '../state.js';
import { h, icon, toast, modal, confirmBox, busy, dropZone, esc } from '../ui.js';
import { aiCreate, aiRevise, aiReady, aiUnavailableReason } from '../ai.js';
import { extractText } from '../importers.js';
import { termWeekOf, today, fmt } from '../dates.js';
import { TYPES, typeInfo, isBlockDoc, BLOCKS, blockLabel, newBlock, templateCreation, blankCreation, applyAi, toAiJson, numberBlocks, totalMarks, cogGrid, COG_PRESETS, cogPresetFor } from '../create/model.js';
import { THEMES, themeCss, renderCreation, printCreation, rubricMax } from '../create/render.js';
import { exportCreationDocx, exportCreationPptx } from '../create/export.js';

export function renderCreate(root, [id]) {
  const c = id && creationById(id);
  if (c) return designer(root, c);
  const draw = () => root.replaceChildren(listPage());
  const off = onChange(w => { if (['creations', 'subjects'].includes(w)) draw(); });
  draw();
  return off;
}

// ---------- List ----------
let filterSubject = '';
function listPage() {
  const page = h('div', { class: 'page create-page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Create'),
    h('p', { class: 'muted' }, 'Make classroom materials from an ATP topic, your own notes or a file, then design them on the page: themes, pictures, boxes and tables. Export to Word, PowerPoint or PDF.')));
  page.append(h('section', {}, h('h2', {}, 'Make something new'),
    h('div', { class: 'type-grid' }, TYPES.map(t => h('button', { class: 'type-card', onclick: () => newDialog(t.id) },
      h('span', { class: 'tc-icon' }, icon(t.icon, 22)), h('strong', {}, t.label), h('span', { class: 'muted small' }, t.blurb))))));
  const list = [...state.creations].filter(c => !filterSubject || c.subjectId === filterSubject).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  page.append(h('section', {}, h('div', { class: 'row between wrap' }, h('h2', {}, 'Your materials'),
    state.subjects.length > 1 ? h('select', { class: 'sm', 'aria-label': 'Subject', onchange: e => { filterSubject = e.target.value; document.getElementById('main').replaceChildren(listPage()); } }, h('option', { value: '' }, 'All subjects'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === filterSubject }, subjectLabel(s)))) : null),
    list.length ? h('ul', { class: 'mat-list creations' }, list.map(c => {
      const s = subjectById(c.subjectId);
      return h('li', {},
        h('span', { class: 'ext', style: { background: s?.colour || 'var(--chalk)' } }, icon(typeInfo(c.type).icon, 16)),
        h('div', { class: 'mat-main' }, h('a', { class: 'link strong', href: '#create/' + c.id }, c.title || 'Untitled'),
          h('span', { class: 'muted small' }, [typeInfo(c.type).label, s ? subjectLabel(s) : '', c.updated ? 'edited ' + fmt(c.updated.slice(0, 10)) : ''].filter(Boolean).join(' · '))),
        h('button', { class: 'btn ghost sm', onclick: async () => { const copy = JSON.parse(JSON.stringify(c)); delete copy.id; copy.title += ' (copy)'; await saveCreation(copy, { silent: false }); toast('Copied.'); } }, 'Duplicate'),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete ' + c.title, onclick: async () => { if (await confirmBox(`Delete “${c.title}”?`)) deleteCreation(c.id); } }, icon('trash', 16)));
    })) : h('p', { class: 'empty' }, 'Nothing yet. Pick a type above to make your first one.')));
  return page;
}

// ---------- New ----------
function newDialog(type) {
  const t = typeInfo(type);
  const tw = termWeekOf(today());
  const f = { subjectId: state.subjects[0]?.id || '', grade: state.subjects[0]?.grade || '', title: '', source: 'atp', atpId: '', text: '', extra: '',
    marks: type === 'test' ? 50 : 20, time: 60, count: { worksheet: 8, slides: 10, rubric: 5, cards: 16 }[type] || 0, length: 'medium', levelsCount: 4 };
  const pickAtp = () => {
    const items = state.atp.filter(a => a.subjectId === f.subjectId);
    const now = tw && items.find(a => a.term === tw.term && tw.week >= a.week && tw.week <= (a.weekEnd || a.week));
    f.atpId = now?.id || items[0]?.id || '';
  };
  pickAtp();
  const body = h('div', {});
  const m = modal(`New ${t.label.toLowerCase()}`, body, { wide: true });
  const num = (label, key, min, max) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'number', min, max, value: f[key], oninput: e => f[key] = +e.target.value }));
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
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('select', { onchange: e => { f.subjectId = e.target.value; f.grade = subjectById(f.subjectId)?.grade || ''; pickAtp(); draw(); } },
          h('option', { value: '' }, 'Not linked to a subject'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === f.subjectId }, subjectLabel(s))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Grade'), h('input', { value: f.grade, placeholder: 'e.g. 9', oninput: e => f.grade = e.target.value.trim() })),
        h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', { class: 'lbl' }, 'Title or topic'), h('input', { value: f.title, placeholder: type === 'test' ? 'e.g. Term 4 controlled test: Statistics' : 'e.g. Photosynthesis', oninput: e => f.title = e.target.value }))),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'What should it be based on?'),
        h('div', { class: 'seg', role: 'radiogroup' }, [['atp', 'An ATP topic'], ['text', 'My notes or a file'], ['none', 'Just the title']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(f.source === k), onclick: () => { f.source = k; draw(); } }, l)))),
      f.source === 'atp' ? (atps.length ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ATP topic'), h('select', { onchange: e => f.atpId = e.target.value },
        [1, 2, 3, 4].map(term => { const list = atps.filter(a => a.term === term); return list.length ? h('optgroup', { label: `Term ${term}` }, list.map(a => h('option', { value: a.id, selected: a.id === f.atpId }, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}: ${a.topic}`))) : null; })))
        : h('p', { class: 'muted small' }, f.subjectId ? 'This subject has no ATP yet. Upload it on the Subjects page, or use your own notes.' : 'Choose a subject to pick from its ATP.')) : null,
      f.source === 'text' ? h('div', { class: 'stack' }, srcText, dropZone({ accept: '.pdf,.docx,.xlsx,.txt,.md', label: 'Upload a file to use', hint: 'PDF, Word or text. Its text is added above.', onFiles: async ([file]) => {
        status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
        try { const t2 = await extractText(file); f.text = (f.text ? f.text + '\n\n' : '') + t2.trim(); srcText.value = f.text; status.replaceChildren(h('p', { class: 'ok small' }, `Added the text from ${file.name} (${Math.round(t2.length / 1000)}k characters).`)); }
        catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
      } }), status) : null,
      h('div', { class: 'form-grid' }, options),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Anything else for the AI? (optional)'), h('textarea', { rows: 2, placeholder: 'e.g. Include a diagram question, use Gqeberha examples, mostly multiple choice', oninput: e => f.extra = e.target.value }, f.extra)),
      h('div', { class: 'row end wrap' },
        !aiReady() ? h('span', { class: 'muted small' }, aiUnavailableReason()) : null,
        h('button', { class: 'btn ghost', onclick: () => start(false) }, icon('doc'), 'Start from a template'),
        (() => { const b = h('button', { class: 'btn primary', disabled: !aiReady() }, icon('spark'), 'Write it with AI'); b.onclick = () => start(true, b); return b; })()),
    );
  };
  const start = async (useAi, btn) => {
    const atp = f.source === 'atp' ? atpById(f.atpId) : null;
    const opts = { subjectId: f.subjectId, grade: f.grade, title: f.title.trim(), atpId: atp?.id || '', sourceText: f.source === 'text' ? f.text : '' };
    let c;
    if (!useAi) c = templateCreation(type, opts);
    else {
      const done = busy(btn, 'Writing… about a minute');
      try {
        c = blankCreation(type, opts);
        const subj = subjectById(f.subjectId);
        const r = await aiCreate(type, { subject: subj?.name, grade: f.grade, language: subj?.language, topic: opts.title || atp?.topic || 'Choose a suitable topic', details: atp?.details || '', sourceText: opts.sourceText, extra: f.extra,
          marks: ['test', 'worksheet'].includes(type) ? f.marks : 0, time: type === 'test' ? f.time : 0, count: f.count, length: f.length, levelsCount: f.levelsCount, levelNames: c.meta.levelNames, levelTargets: c.meta.levelTargets });
        applyAi(c, r);
        if (!c.title) c.title = opts.title || atp?.topic || typeInfo(type).label;
      } catch (e) { toast(e.message, 'error'); done(); return; }
      done();
    }
    if (type === 'test' && !useAi) c.meta.time = f.time;
    await saveCreation(c);
    m.close();
    location.hash = 'create/' + c.id;
    toast(useAi ? 'Written. Check it, then design it.' : 'Template ready. Fill it in and design it.');
  };
  draw();
}

// ---------- Designer ----------
let pane = 'edit'; // on narrow screens: 'edit' | 'preview'
function designer(root, c) {
  ensureCss();
  let selected = -1;
  const history = [];
  const snapshot = () => { history.push(JSON.stringify(c)); if (history.length > 25) history.shift(); undoBtn.disabled = false; };
  let saveT, prevT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => saveCreation(c), 500); };
  const preview = h('div', { class: 'preview-paper' });
  const previewWrap = h('div', { class: 'preview-wrap', 'aria-label': 'Page preview' }, preview);
  const fit = () => { const w = previewWrap.clientWidth - 24; if (w > 0) preview.style.zoom = Math.min(1, w / 794); };
  const renderPreview = () => {
    preview.innerHTML = renderCreation(c);
    if (selected >= 0) preview.querySelector(`[data-i="${selected}"]`)?.classList.add('pv-sel');
    totals();
  };
  const changed = () => { clearTimeout(prevT); prevT = setTimeout(renderPreview, 120); save(); };
  const structural = () => { save(); drawEditor(); renderPreview(); };

  previewWrap.addEventListener('click', e => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    selected = +el.dataset.i; drawEditor();
    editor.querySelector(`[data-ed="${selected}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (innerWidth < 1100) { pane = 'edit'; layout(); }
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
  };

  const undoBtn = h('button', { class: 'btn ghost sm', disabled: true, onclick: () => { const s = history.pop(); if (!s) return; Object.assign(c, JSON.parse(s)); undoBtn.disabled = !history.length; structural(); toast('Undone.'); } }, 'Undo');

  // ---------- Top bar ----------
  const titleIn = h('input', { class: 'title-input', value: c.title, 'aria-label': 'Title', oninput: e => { c.title = e.target.value; changed(); } });
  const exportBtns = h('div', { class: 'row wrap' },
    h('button', { class: 'btn', onclick: () => printCreation(c) }, icon('print'), c.type === 'slides' ? 'Print handout / PDF' : 'Print / PDF'),
    c.type !== 'slides' ? expBtn('Word', 'doc', () => exportCreationDocx(c)) : expBtn('PowerPoint', 'slides', () => exportCreationPptx(c)));
  const d = c.design;
  const toggle = (key, label) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: !!d[key], onchange: e => { d[key] = e.target.checked; changed(); } }), label);
  const buildDesignBar = () => h('div', { class: 'design-bar' },
    h('div', { class: 'seg themes', role: 'radiogroup', 'aria-label': 'Theme' }, THEMES.map(t => h('button', { role: 'radio', 'aria-checked': String(d.theme === t.id), title: t.note, onclick: e => { d.theme = t.id; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); changed(); } }, t.label))),
    c.type !== 'slides' ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Text size' }, [['normal', 'Normal text'], ['large', 'Large text']].map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(d.size === v), onclick: e => { d.size = v; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget))); changed(); } }, l))) : null,
    c.type === 'cards' ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Print as' }, [['cards', 'Cut-out cards'], ['glossary', 'Glossary'], ['wordsearch', 'Word search']].map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(d.layout === v), onclick: () => { d.layout = v; structural(); drawTop(); } }, l))) : null,
    h('div', { class: 'chips' },
      ['test', 'worksheet', 'rubric'].includes(c.type) || (c.type === 'cards' && d.layout === 'wordsearch') ? toggle('header', 'Name and class lines') : null,
      ['test', 'worksheet'].includes(c.type) ? toggle('memo', 'Memo') : null,
      c.type === 'test' ? toggle('grid', 'Cognitive-level grid') : null,
      c.type === 'test' ? toggle('cover', 'Cover page') : null,
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
      toast('Changed. Use Undo if you prefer the old version.');
    } catch (e) { toast(e.message, 'error'); } finally { done(); }
  };

  const top = h('div', { class: 'designer-top' });
  const drawTop = () => {
    const subj = subjectById(c.subjectId);
    top.replaceChildren(
      h('div', { class: 'row between wrap' },
        h('a', { href: '#create', class: 'back' }, icon('left', 16), 'All materials'),
        h('div', { class: 'row wrap' }, undoBtn, exportBtns)),
      titleIn,
      h('p', { class: 'muted small ed-meta' }, [typeInfo(c.type).label, subj ? subjectLabel(subj) : (c.grade ? 'Grade ' + c.grade : ''), ''].filter(Boolean).join(' · '), totalsEl),
      buildDesignBar(),
      h('div', { class: 'ai-bar' }, aiIn, aiBtn));
  };
  drawTop();

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
    return h('details', { class: 'ed-card meta-card', open: true },
      h('summary', {}, 'Test details and cognitive levels'),
      h('div', { class: 'form-grid' },
        field('Time (minutes)', input(c.meta.time, v => c.meta.time = +v || 0, { type: 'number', min: 0 })),
        field('Instructions (one per line)', area((c.meta.instructions || []).join('\n'), v => c.meta.instructions = v.split('\n').map(s => s.trim()).filter(Boolean), 3))),
      h('div', { class: 'cog-edit' }, h('span', { class: 'lbl' }, 'Levels and targets (% of marks)'),
        ...[0, 1, 2, 3].map(i => h('div', { class: 'row' }, h('span', { class: 'muted' }, `${i + 1}.`),
          input(c.meta.levelNames[i], v => c.meta.levelNames[i] = v, { 'aria-label': `Level ${i + 1} name` }),
          input(c.meta.levelTargets[i], v => c.meta.levelTargets[i] = +v || 0, { type: 'number', min: 0, max: 100, class: 'num', 'aria-label': `Level ${i + 1} target` }), h('span', { class: 'muted' }, '%'))),
        h('div', { class: 'row wrap' }, h('span', { class: 'hint' }, 'Starting values only. Set them to your subject’s CAPS / Programme of Assessment policy.'),
          h('button', { class: 'link small', onclick: () => { const p = COG_PRESETS[preset]; c.meta.levelNames = [...p.names]; c.meta.levelTargets = [...p.targets]; structural(); } }, 'Reset to suggested'))),
      cogBox);
  }

  function blockEditor(b, i) {
    const labels = numberBlocks(c.blocks);
    const move = dir => { const j = i + dir; if (j < 0 || j >= c.blocks.length) return; snapshot(); [c.blocks[i], c.blocks[j]] = [c.blocks[j], c.blocks[i]]; selected = j; structural(); };
    const head = h('div', { class: 'ed-head' },
      h('span', { class: 'ed-type' }, blockLabel(b.type), labels.get(i) ? h('b', {}, ' ' + labels.get(i)) : null),
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('up', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === c.blocks.length - 1, onclick: () => move(1) }, icon('down', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Duplicate', onclick: () => { snapshot(); c.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); selected = i + 1; structural(); } }, icon('copy', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: () => { snapshot(); c.blocks.splice(i, 1); selected = -1; structural(); toast('Deleted. Undo brings it back.'); } }, icon('trash', 16))));
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
      case 'section': body = h('div', { class: 'stack' }, input(b.title, v => b.title = v, { placeholder: 'Section title, e.g. Multiple choice', 'aria-label': 'Section title' }), input(b.text, v => b.text = v, { placeholder: 'Instructions for this section (optional)', 'aria-label': 'Section instructions' })); break;
      case 'question': {
        const levels = c.meta?.levelNames || COG_PRESETS.general.names;
        body = h('div', { class: 'stack' },
          area(b.q, v => b.q = v, 2, 'Question'),
          h('div', { class: 'row wrap q-opts' },
            h('label', { class: 'inline' }, 'Type', h('select', { onchange: e => { b.kind = e.target.value; if (b.kind === 'mcq' && (b.options || []).length < 2) b.options = ['', '', '', '']; structural(); } }, [['open', 'Written answer'], ['mcq', 'Multiple choice']].map(([v, l]) => h('option', { value: v, selected: b.kind === v }, l)))),
            h('label', { class: 'inline' }, 'Marks', input(b.marks, v => b.marks = +v || 0, { type: 'number', min: 0, class: 'num' })),
            c.type === 'test' || c.type === 'worksheet' ? h('label', { class: 'inline' }, 'Level', h('select', { onchange: e => { b.cog = +e.target.value; changed(); } }, levels.map((n, k) => h('option', { value: k + 1, selected: (+b.cog || 1) === k + 1 }, `${k + 1}. ${n}`)))) : null,
            b.kind !== 'mcq' ? h('label', { class: 'inline' }, 'Lines', input(b.lines ?? '', v => b.lines = v === '' ? null : +v, { type: 'number', min: 0, class: 'num', placeholder: 'auto' })) : null),
          b.kind === 'mcq' ? h('div', { class: 'stack' }, ...(b.options || []).map((o, k) => h('div', { class: 'row' }, h('b', {}, 'ABCDEF'[k]), input(o, v => b.options[k] = v, { 'aria-label': 'Option ' + 'ABCDEF'[k] }))),
            (b.options || []).length < 6 ? h('button', { class: 'link small', onclick: () => { b.options.push(''); structural(); } }, 'Add an option') : null) : null,
          field('Memo answer', area(b.answer, v => b.answer = v, 1, 'Expected answer and mark allocation')));
        break;
      }
      case 'image': {
        const up = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = up.files[0]; if (!f) return; b.src = await toImage(f); structural(); } });
        body = h('div', { class: 'stack' },
          b.src ? h('img', { src: b.src, class: 'ed-img', alt: '' }) : h('button', { class: 'drop small-drop', onclick: () => up.click() }, icon('upload', 18), h('span', {}, 'Choose a picture or diagram')),
          up,
          h('div', { class: 'row wrap' }, b.src ? h('button', { class: 'btn ghost sm', onclick: () => up.click() }, 'Replace') : null,
            h('label', { class: 'inline' }, 'Width', h('input', { type: 'range', min: 20, max: 100, step: 5, value: b.width || 60, oninput: e => { b.width = +e.target.value; changed(); } }))),
          input(b.caption, v => b.caption = v, { placeholder: 'Caption (optional), e.g. Figure 1: A plant cell', 'aria-label': 'Caption' }));
        break;
      }
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
    const addSel = h('select', { class: 'sm add-below', 'aria-label': 'Add below', onchange: e => { if (!e.target.value) return; snapshot(); c.blocks.splice(i + 1, 0, newBlock(e.target.value)); selected = i + 1; structural(); } },
      h('option', { value: '' }, '+ Add below…'), BLOCKS.map(x => h('option', { value: x.id }, x.label)));
    const card = h('div', { class: 'ed-card' + (selected === i ? ' sel' : ''), 'data-ed': i, onfocusin: () => { if (selected !== i) { selected = i; preview.querySelectorAll('.pv-sel').forEach(x => x.classList.remove('pv-sel')); const el = preview.querySelector(`[data-i="${i}"]`); el?.classList.add('pv-sel'); el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); editor.querySelectorAll('.ed-card.sel').forEach(x => x.classList.remove('sel')); card.classList.add('sel'); } } },
      head, body, addSel);
    return card;
  }

  function quickAdd(list, make) {
    return h('div', { class: 'quick-add' }, h('span', { class: 'muted small' }, 'Add:'), list.map(([t, l]) => h('button', { class: 'chip', onclick: () => { snapshot(); make(t); structural(); setTimeout(() => editor.lastElementChild?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } }, '+ ' + l)));
  }

  function drawEditor() {
    const kids = [];
    if (isBlockDoc(c)) {
      if (c.type === 'test') kids.push(testMeta());
      c.blocks.forEach((b, i) => kids.push(blockEditor(b, i)));
      if (!c.blocks.length) kids.push(h('p', { class: 'empty' }, 'Empty. Add blocks below.'));
      const common = c.type === 'notes' ? [['heading', 'Heading'], ['text', 'Paragraph'], ['list', 'List'], ['box', 'Box'], ['image', 'Picture'], ['vocab', 'Vocabulary'], ['table', 'Table']]
        : [['question', 'Question'], ['section', 'Section'], ['text', 'Paragraph'], ['image', 'Picture'], ['table', 'Table'], ['box', 'Box'], ['lines', 'Lines'], ['pagebreak', 'Page break']];
      kids.push(quickAdd(common, t => { c.blocks.push(newBlock(t)); selected = c.blocks.length - 1; }));
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
