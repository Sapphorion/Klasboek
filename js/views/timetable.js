// The teacher's timetable: periods, days, and which subject/class sits in each slot.
import { state, onChange, saveTimetable, subjectById, subjectLabel, upsertSubject } from '../state.js';
import { h, icon, toast, busy, dropZone, modal, confirmBox } from '../ui.js';
import { uid } from '../db.js';
import { readTimetableFile, matchSubject, kindOf } from '../importers.js';
import { aiReadTimetable, aiReady, aiUnavailableReason } from '../ai.js';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderTimetable(root) {
  const draw = () => root.replaceChildren(view());
  const off = onChange(w => { if (['timetable', 'subjects'].includes(w)) draw(); });
  draw();
  return off;
}

function view() {
  const tt = state.timetable;
  const page = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Timetable'), h('p', { class: 'muted' }, 'Your periods and what you teach in each. The planner shows these slots every week and auto-plan fills them from the ATP.')));

  const status = h('div', { 'aria-live': 'polite' });
  const importer = dropZone({
    accept: '.xlsx,.xls,.csv,.docx,image/*', label: 'Import a timetable',
    hint: 'Excel or Word is read on your device. A photo or screenshot is read by AI.',
    onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try {
        let res;
        if (kindOf(file) === 'image') {
          const dataUrl = await shrinkImage(file);
          await saveTimetable({ image: dataUrl });
          if (!aiReady()) { status.replaceChildren(h('p', { class: 'warn' }, `${aiUnavailableReason()} The photo is shown below the grid so you can copy it in by hand.`)); return; }
          res = await aiReadTimetable(dataUrl, tt.days);
        } else res = await readTimetableFile(file);
        status.replaceChildren();
        applyImport(res);
      } catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    },
  });

  const days = h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'School days'),
    h('div', { class: 'row wrap' }, ALL_DAYS.map(d => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: tt.days.includes(d), onchange: e => {
      const next = ALL_DAYS.filter(x => x === d ? e.target.checked : tt.days.includes(x));
      if (!next.length) return;
      // Re-key cells so each day keeps its lessons.
      const cells = {};
      for (const [k, v] of Object.entries(tt.cells)) { const [di, pid] = k.split('|'); const ni = next.indexOf(tt.days[+di]); if (ni >= 0) cells[`${ni}|${pid}`] = v; }
      saveTimetable({ days: next, cells });
    } }), d))));

  page.append(h('div', { class: 'tt-top' }, importer, status, days));
  page.append(h('div', { class: 'grid-scroll' }, ttGrid()));
  page.append(h('div', { class: 'row' },
    h('button', { class: 'btn ghost', onclick: () => { const last = tt.periods.at(-1); saveTimetable({ periods: [...tt.periods, { id: uid('p'), label: String(tt.periods.length + 1), start: last?.end || '', end: '' }] }); } }, icon('plus'), 'Add period'),
    Object.keys(tt.cells).length ? h('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Clear every slot in the timetable? Periods stay.', 'Clear slots')) saveTimetable({ cells: {} }); } }, 'Clear slots') : null,
  ));
  if (tt.image) page.append(h('figure', { class: 'tt-photo' }, h('img', { src: tt.image, alt: 'Photo of your printed timetable' }), h('figcaption', { class: 'row between' }, 'Your timetable photo, for reference.', h('button', { class: 'btn ghost sm', onclick: () => saveTimetable({ image: '' }) }, 'Remove photo'))));
  if (!state.subjects.length) page.append(h('p', { class: 'warn' }, 'Add your subjects first so you can choose them in the grid. ', h('a', { href: '#subjects' }, 'Add subjects')));
  return page;
}

function ttGrid() {
  const tt = state.timetable;
  const grid = h('div', { class: 'tt-grid', style: { gridTemplateColumns: `11rem repeat(${tt.days.length}, minmax(9.5rem, 1fr))` } });
  grid.append(h('div', { class: 'tt-head' }, 'Period'), ...tt.days.map(d => h('div', { class: 'tt-head' }, d)));
  tt.periods.forEach((p, pi) => {
    grid.append(h('div', { class: 'tt-period' },
      h('input', { class: 'p-label', value: p.label, 'aria-label': 'Period name', onchange: e => { p.label = e.target.value; saveTimetable({}); } }),
      h('div', { class: 'row' },
        h('input', { type: 'time', value: p.start, 'aria-label': `Period ${p.label} start`, onchange: e => { p.start = e.target.value; saveTimetable({}); } }),
        h('input', { type: 'time', value: p.end, 'aria-label': `Period ${p.label} end`, onchange: e => { p.end = e.target.value; saveTimetable({}); } })),
      h('button', { class: 'link small danger', onclick: async () => {
        const used = state.lessons.filter(l => l.periodId === p.id).length;
        if (used && !await confirmBox(`${used} planned lessons use this period. They will stay in your data but won't show on the planner.`, 'Remove period')) return;
        const cells = Object.fromEntries(Object.entries(tt.cells).filter(([k]) => k.split('|')[1] !== p.id));
        saveTimetable({ periods: tt.periods.filter(x => x.id !== p.id), cells });
      } }, 'Remove')));
    tt.days.forEach((d, di) => {
      const key = `${di}|${p.id}`; const c = tt.cells[key] || {};
      const subj = subjectById(c.subjectId);
      grid.append(h('div', { class: 'tt-cell' + (subj ? ' filled' : ''), style: subj ? { '--subj': subj.colour } : {} },
        h('select', { 'aria-label': `${d} period ${p.label} subject`, onchange: e => { const v = e.target.value; if (v) tt.cells[key] = { ...c, subjectId: v }; else delete tt.cells[key]; saveTimetable({}); } },
          h('option', { value: '' }, 'Free'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === c.subjectId }, subjectLabel(s)))),
        subj ? h('input', { placeholder: 'Class', value: c.cls || '', 'aria-label': `${d} period ${p.label} class`, onchange: e => { tt.cells[key] = { ...c, cls: e.target.value.trim() }; saveTimetable({}); } }) : null,
      ));
    });
  });
  return grid;
}

// Imported periods/cells → timetable, matching subject names to the teacher's subjects.
function applyImport(res) {
  const tt = state.timetable;
  const periods = res.periods.map((p, i) => ({ id: tt.periods[i]?.id || uid('p'), label: p.label || String(i + 1), start: p.start || tt.periods[i]?.start || '', end: p.end || tt.periods[i]?.end || '' }));
  const unknown = new Map();
  const rows = res.cells.map(c => ({ ...c, match: matchSubject(c.subject, state.subjects) }));
  rows.filter(r => !r.match && r.subject).forEach(r => unknown.set(r.subject.trim(), (unknown.get(r.subject.trim()) || 0) + 1));

  const body = h('div', {});
  const m = modal('Check the imported timetable', body, { wide: true });
  const choices = {}; // unknown name -> subjectId | 'new' | ''
  for (const name of unknown.keys()) choices[name] = 'new';
  body.append(
    h('p', {}, `Found ${periods.length} periods and ${rows.length} lessons.`),
    unknown.size ? h('div', {}, h('h3', {}, 'Subjects to match'), h('p', { class: 'muted small' }, 'These names don’t match your subjects yet. Pick one, create it, or skip.'),
      h('div', { class: 'stack' }, [...unknown].map(([name, n]) => h('label', { class: 'row between match-row' }, h('span', {}, h('strong', {}, name), h('span', { class: 'muted small' }, ` · ${n} slot${n > 1 ? 's' : ''}`)),
        h('select', { onchange: e => choices[name] = e.target.value }, h('option', { value: 'new' }, 'Create as new subject'), h('option', { value: '' }, 'Skip (leave free)'), state.subjects.map(s => h('option', { value: s.id }, subjectLabel(s)))))))) : null,
    h('div', { class: 'table-wrap' }, h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', {}, ''), ...state.timetable.days.map(d => h('th', {}, d)))),
      h('tbody', {}, periods.map((p, pi) => h('tr', {}, h('th', {}, `${p.label} ${p.start}`), ...state.timetable.days.map((d, di) => { const r = rows.find(r => r.dayIndex === di && r.periodIndex === pi); return h('td', {}, r ? `${r.subject}${r.cls ? ' ' + r.cls : ''}` : ''); })))))),
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const map = {};
        for (const [name, v] of Object.entries(choices)) {
          if (v === 'new') { const grade = (rows.find(r => r.subject.trim() === name)?.cls.match(/^\d{1,2}/) || [])[0] || ''; const s = await upsertSubject({ name, grade, language: /afr/i.test(name) ? 'Afrikaans' : 'English' }); map[name] = s.id; }
          else map[name] = v;
        }
        const cells = {};
        for (const r of rows) {
          if (r.dayIndex < 0 || r.dayIndex >= tt.days.length || !periods[r.periodIndex]) continue;
          const sid = r.match?.id || map[r.subject.trim()];
          if (sid) cells[`${r.dayIndex}|${periods[r.periodIndex].id}`] = { subjectId: sid, cls: r.cls || '', room: r.room || '' };
        }
        await saveTimetable({ periods, cells }); m.close(); toast('Timetable imported.');
      } }, 'Use this timetable')));
}

function shrinkImage(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => rej(new Error('Could not open that image. Use a JPG or PNG.'));
    img.src = URL.createObjectURL(file);
  });
}
export { shrinkImage };
