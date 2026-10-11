// Subjects and their Annual Teaching Plans.
import { state, onChange, upsertSubject, deleteSubject, replaceAtp, replaceAtpTerm, saveAtpItem, deleteAtpItem, subjectLabel, SUBJECT_COLOURS, freeColour } from '../state.js';
import { h, icon, toast, busy, confirmBox, dropZone, modal } from '../ui.js';
import { uid } from '../db.js';
import { readAtpFile } from '../importers.js';
import { aiParseAtp, aiReady, aiUnavailableReason } from '../ai.js';
import { termWeeks } from '../dates.js';

let selected = null;

export function renderSubjects(root, [id]) {
  if (id) selected = id;
  if (!state.subjects.find(s => s.id === selected)) selected = state.subjects[0]?.id || null;
  const draw = () => root.replaceChildren(view());
  const off = onChange(w => { if (['subjects', 'atp', 'lessons'].includes(w)) draw(); });
  draw();
  return off;
}

function view() {
  const wrap = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Subjects & ATPs'), h('p', { class: 'muted' }, 'Add each subject you teach, then upload its Annual Teaching Plan. The planner uses the ATP to know what to teach each week.')));
  const list = h('nav', { class: 'subj-list', 'aria-label': 'Subjects' },
    state.subjects.map(s => {
      const n = state.atp.filter(a => a.subjectId === s.id).length;
      return h('button', { class: 'subj-item', 'aria-current': String(s.id === selected), style: { '--subj': s.colour }, onclick: () => { location.hash = 'subjects/' + s.id; } },
        h('strong', {}, subjectLabel(s)), h('span', { class: 'muted small' }, n ? `${n} ATP topics` : 'No ATP yet'));
    }),
    h('button', { class: 'btn ghost', onclick: addSubjectDialog }, icon('plus'), 'Add subject'),
  );
  const s = state.subjects.find(x => x.id === selected);
  const detail = s ? subjectDetail(s) : h('div', { class: 'empty big' }, h('h2', {}, 'No subjects yet'), h('p', {}, 'Start with the subject you teach most.'), h('button', { class: 'btn primary', onclick: addSubjectDialog }, icon('plus'), 'Add subject'));
  wrap.append(h('div', { class: 'two-pane' }, list, detail));
  return wrap;
}

// CAPS subjects, grouped so the list is quick to scan on a tablet.
const CAPS_SUBJECTS = [
  ['Languages', ['English Home Language', 'English First Additional Language', 'Afrikaans Huistaal', 'Afrikaans Eerste Addisionele Taal', 'isiXhosa Home Language', 'isiXhosa First Additional Language', 'isiZulu Home Language', 'isiZulu First Additional Language', 'Sesotho Home Language', 'Sesotho First Additional Language', 'Setswana Home Language', 'Sepedi Home Language']],
  ['Mathematics', ['Mathematics', 'Mathematical Literacy', 'Technical Mathematics']],
  ['Sciences', ['Natural Sciences', 'Natural Sciences and Technology', 'Physical Sciences', 'Life Sciences', 'Technical Sciences', 'Agricultural Sciences']],
  ['Humanities and commerce', ['Social Sciences', 'Geography', 'History', 'Economic and Management Sciences', 'Accounting', 'Business Studies', 'Economics', 'Tourism', 'Religion Studies']],
  ['Technology', ['Technology', 'Computer Applications Technology', 'Information Technology', 'Engineering Graphics and Design', 'Consumer Studies', 'Hospitality Studies']],
  ['Arts', ['Creative Arts', 'Visual Arts', 'Dramatic Arts', 'Music', 'Dance Studies']],
  ['Life skills', ['Life Orientation', 'Life Skills']],
];
const ALL_CAPS = CAPS_SUBJECTS.flatMap(([, list]) => list);
const OTHER = '__other__';

function subjectForm(s, onSave) {
  const f = { name: s.name || '', grade: s.grade || '', language: s.language || 'English', colour: s.colour || freeColour(s.id) };
  const isOther = !!f.name && !ALL_CAPS.includes(f.name);
  const otherIn = h('input', { value: isOther ? f.name : '', placeholder: 'Type the subject name', 'aria-label': 'Subject name', hidden: !isOther, oninput: e => f.name = e.target.value });
  const langSel = h('select', { onchange: e => f.language = e.target.value }, ['English', 'Afrikaans'].map(l => h('option', { selected: l === f.language }, l)));
  const pick = h('select', { 'aria-label': 'Subject', onchange: e => {
    const v = e.target.value;
    if (v === OTHER) { otherIn.hidden = false; f.name = otherIn.value; otherIn.focus(); return; }
    otherIn.hidden = true; f.name = v;
    // Afrikaans subjects get Afrikaans materials by default.
    if (v) { f.language = /^Afrikaans/.test(v) ? 'Afrikaans' : 'English'; langSel.value = f.language; }
  } },
    h('option', { value: '', disabled: true, selected: !f.name }, 'Choose a subject…'),
    CAPS_SUBJECTS.map(([group, list]) => h('optgroup', { label: group }, list.map(n => h('option', { value: n, selected: n === f.name }, n)))),
    h('option', { value: OTHER, selected: isOther }, 'Other (type your own)…'));
  const form = h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); if (!f.name.trim()) { toast('Choose a subject, or pick Other and type its name.', 'error'); return; } onSave({ ...s, ...f, name: f.name.trim() }); } },
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), pick, otherIn),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Grade'), h('select', { onchange: e => f.grade = e.target.value }, ['', 'R', ...Array.from({ length: 12 }, (_, i) => String(i + 1)), 'Adult'].map(g => h('option', { value: g, selected: g === String(f.grade) }, g ? (/^\d+$/.test(g) ? 'Grade ' + g : g === 'R' ? 'Grade R' : g) : 'Not grade-specific')))),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Language for materials'), langSel),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Colour'), h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' }, SUBJECT_COLOURS.map(c => {
      const b = h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-checked': String(c === f.colour), 'aria-label': c, style: { background: c } });
      b.onclick = () => { f.colour = c; b.parentElement.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-checked', String(x === b))); };
      return b;
    }))),
    h('div', { class: 'row end', style: { gridColumn: '1 / -1' } }, h('button', { class: 'btn primary', type: 'submit' }, s.id ? 'Save subject' : 'Add subject')),
  );
  return form;
}

function addSubjectDialog() {
  const m = modal('Add a subject', subjectForm({}, async s => { const saved = await upsertSubject(s); m.close(); selected = saved.id; location.hash = 'subjects/' + saved.id; toast(`${saved.name} added. Now upload its ATP.`); }));
}

function subjectDetail(s) {
  const items = state.atp.filter(a => a.subjectId === s.id);
  const box = h('section', { class: 'subj-detail' });
  box.append(h('div', { class: 'row between' },
    h('h2', { style: { '--subj': s.colour }, class: 'subj-title' }, subjectLabel(s)),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost sm', onclick: () => { const m = modal('Edit subject', subjectForm(s, async v => { await upsertSubject(v); m.close(); toast('Saved.'); })); } }, 'Edit'),
      h('button', { class: 'btn ghost sm danger', onclick: async () => { if (await confirmBox(`Delete ${s.name} and its ATP? Planned lessons stay but lose their subject link.`)) { await deleteSubject(s.id); toast('Subject deleted.'); } } }, icon('trash', 16), 'Delete'))));

  // Upload
  const status = h('div', { class: 'upload-status', 'aria-live': 'polite' });
  const zone = dropZone({
    accept: '.pdf,.docx,.xlsx,.xls,.csv', label: items.length ? 'Replace the ATP' : 'Upload the ATP',
    hint: 'DBE ATP PDF, Word or Excel. Read on your device, nothing is sent anywhere.',
    onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try {
        const { items: parsed, text } = await readAtpFile(file);
        s.atpText = text; s.atpFile = file.name; await upsertSubject(s);
        reviewDialog(s, parsed, file.name, text);
        status.replaceChildren();
      } catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    },
  });
  box.append(h('div', { class: 'atp-upload' }, zone, status,
    s.atpText ? h('p', { class: 'muted small' }, `Source: ${s.atpFile || 'uploaded file'}. `, aiButton(s)) : null));

  // ATP table
  if (items.length) box.append(atpTable(s, items));
  else box.append(h('p', { class: 'muted' }, 'No ATP topics yet. Upload the ATP above, or ', h('button', { class: 'link', onclick: async () => { await saveAtpItem({ id: uid('a_'), subjectId: s.id, term: 1, week: 1, weekEnd: 1, topic: 'New topic', details: '', order: 0 }); } }, 'type them in'), '.'));
  return box;
}

function aiButton(s) {
  const b = h('button', { class: 'link', disabled: !aiReady(), title: aiUnavailableReason() || 'Let Claude read the ATP. Better for complicated tables.' }, icon('spark', 14), ' Read it again with AI');
  b.onclick = async () => {
    const done = busy(b, 'Claude is reading the ATP… up to a minute');
    try { const items = await aiParseAtp(s.atpText, s); reviewDialog(s, items, 'AI reading of ' + (s.atpFile || 'ATP'), s.atpText); }
    catch (e) { toast(e.message, 'error'); }
    finally { done(); }
  };
  return b;
}

// Show what was found before saving, so the teacher can fix it.
export function reviewDialog(s, items, source, text, opts = {}) {
  const fix = opts.normalize || (x => x);
  items = items.map(i => ({ ...i, weekEnd: i.weekEnd || i.week }));
  const terms = [...new Set(items.map(i => i.term))];
  const body = h('div', {});
  const m = modal(opts.term ? `Check the term plan: ${subjectLabel(s)}, term ${opts.term}` : `Check the ATP: ${s.name}`, body, { wide: true });
  const draw = () => body.replaceChildren(
    items.length
      ? h('p', {}, `Found ${items.length} weekly topics across term${terms.length > 1 ? 's' : ''} ${terms.join(', ')} in `, h('strong', {}, source), '. Fix anything that looks wrong, then save.')
      : h('p', { class: 'error' }, 'No week-by-week topics were found. ', aiReady() ? 'Try reading it with AI, or add rows by hand.' : 'Add rows by hand, or connect AI in Settings to read complex tables.'),
    h('div', { class: 'row wrap' },
      aiReady() && !source.startsWith('AI') ? (() => { const b = h('button', { class: 'btn ghost sm' }, icon('spark', 16), 'Read with AI instead'); b.onclick = async () => { const done = busy(b, 'Reading…'); try { items = fix((await aiParseAtp(text, s)).map(i => ({ ...i, weekEnd: i.weekEnd || i.week }))); source = 'AI reading'; draw(); } catch (e) { toast(e.message, 'error'); } finally { done(); } }; return b; })() : null,
      h('button', { class: 'btn ghost sm', onclick: () => { items.push({ term: items.at(-1)?.term || 1, week: (items.at(-1)?.weekEnd || 0) + 1, weekEnd: (items.at(-1)?.weekEnd || 0) + 1, topic: '', details: '' }); draw(); } }, icon('plus', 16), 'Add row'),
      h('details', { class: 'raw' }, h('summary', {}, 'Show extracted text'), h('pre', {}, text.slice(0, 20000)))),
    editTable(items, draw),
    h('div', { class: 'row end sticky-foot' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', disabled: !items.length, onclick: async () => {
        const clean = items.filter(i => i.topic || i.details).map(i => ({ term: +i.term || 1, week: +i.week || 1, weekEnd: Math.max(+i.weekEnd || +i.week, +i.week), topic: (i.topic || '').trim() || `Week ${i.week}`, details: (i.details || '').trim() }));
        const planned = state.lessons.filter(l => state.atp.some(a => a.id === l.atpId && a.subjectId === s.id && (!opts.term || a.term === opts.term))).length;
        if (planned && !await confirmBox(`${planned} planned lessons are linked to the old ATP. They will keep their titles but lose the link.`, 'Save new ATP')) return;
        if (opts.term) { await replaceAtpTerm(s.id, opts.term, clean.map(c => ({ ...c, term: opts.term }))); m.close(); toast(`Term ${opts.term} plan saved for ${s.name}: ${clean.length} topics. Other terms are unchanged.`); return; }
        await replaceAtp(s.id, clean); m.close(); toast(`Saved ${clean.length} ATP topics for ${s.name}.`);
      } }, `Save ${items.length} topics`)),
  );
  draw();
}

function editTable(items, redraw) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'edit-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Term'), h('th', {}, 'Week'), h('th', {}, 'to'), h('th', {}, 'Topic'), h('th', {}, 'Content and skills'), h('th', {}, h('span', { class: 'sr' }, 'Remove')))),
    h('tbody', {}, items.map((it, i) => h('tr', {},
      h('td', {}, h('input', { type: 'number', min: 1, max: 4, class: 'num', value: it.term, 'aria-label': 'Term', oninput: e => it.term = +e.target.value })),
      h('td', {}, h('input', { type: 'number', min: 1, max: 14, class: 'num', value: it.week, 'aria-label': 'Week', oninput: e => it.week = +e.target.value })),
      h('td', {}, h('input', { type: 'number', min: 1, max: 14, class: 'num', value: it.weekEnd, 'aria-label': 'To week', oninput: e => it.weekEnd = +e.target.value })),
      h('td', {}, h('textarea', { rows: 2, 'aria-label': 'Topic', oninput: e => it.topic = e.target.value }, it.topic)),
      h('td', {}, h('textarea', { rows: 3, 'aria-label': 'Content', oninput: e => it.details = e.target.value }, it.details)),
      h('td', {}, h('button', { class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => { items.splice(i, 1); redraw(); } }, icon('trash', 16))),
    )))));
}

function atpTable(s, items) {
  const byTerm = [1, 2, 3, 4].map(t => items.filter(a => a.term === t)).filter(x => x.length);
  return h('div', { class: 'atp-view' },
    h('div', { class: 'row between' }, h('h3', {}, 'Teaching plan and coverage'), h('button', { class: 'btn ghost sm', onclick: () => reviewDialog(s, items.map(a => ({ ...a })), 'your saved ATP', s.atpText || '') }, 'Edit all')),
    byTerm.map(list => {
      const t = list[0].term; const weeks = termWeeks(t);
      const covered = list.filter(a => state.lessons.some(l => l.atpId === a.id)).length;
      return h('section', { class: 'term-block' },
        h('h4', {}, `Term ${t}`, h('span', { class: 'muted small' }, ` · ${covered} of ${list.length} topics planned${weeks ? ' · ' + weeks + ' school weeks' : ''}`)),
        h('div', { class: 'cov-bar', role: 'img', 'aria-label': `${covered} of ${list.length} planned` }, h('span', { style: { width: (covered / list.length * 100) + '%', background: s.colour } })),
        h('ol', { class: 'atp-list' }, list.map(a => {
          const ls = state.lessons.filter(l => l.atpId === a.id);
          const taught = ls.filter(l => l.done).length;
          return h('li', {},
            h('span', { class: 'wk' }, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}`),
            h('div', {}, h('strong', {}, a.topic), a.details ? h('p', { class: 'muted small clamp' }, a.details.split('\n').join(' · ')) : null),
            h('span', { class: 'status ' + (taught ? 'taught' : ls.length ? 'planned' : '') }, taught ? `${taught}/${ls.length} taught` : ls.length ? `${ls.length} planned` : 'Not planned'),
            h('button', { class: 'icon-btn', 'aria-label': 'Delete topic', onclick: async () => { if (await confirmBox(`Delete “${a.topic}”?`)) deleteAtpItem(a.id); } }, icon('trash', 15)),
          );
        })));
    }));
}
