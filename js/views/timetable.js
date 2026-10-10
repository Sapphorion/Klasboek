// The teacher's timetable: periods, days, and which subject/class sits in each slot.
// Supports a one-week timetable or a two-week cycle (Week A / Week B).
import { state, onChange, saveTimetable, subjectById, subjectLabel, upsertSubject } from '../state.js';
import { h, icon, toast, dropZone, modal, confirmBox } from '../ui.js';
import { uid } from '../db.js';
import { readTimetableFile, matchSubject, kindOf } from '../importers.js';
import { aiReadTimetable, aiReady, aiUnavailableReason } from '../ai.js';
import { cycleWeekOf, cycleLetter, today, mondayOf, addDays } from '../dates.js';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let editWeek = 1; // which week of the cycle the grid is showing

const mapKey = w => (w === 2 ? 'cellsB' : 'cells');
const cellsOf = w => state.timetable[mapKey(w)] || (state.timetable[mapKey(w)] = {});

export function renderTimetable(root) {
  const draw = () => root.replaceChildren(view());
  const off = onChange(w => { if (['timetable', 'subjects', 'settings'].includes(w)) draw(); });
  draw();
  return off;
}

function view() {
  const tt = state.timetable;
  const two = (tt.cycle || 1) === 2;
  if (!two) editWeek = 1;
  const page = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Timetable'), h('p', { class: 'muted' }, 'Your periods and what you teach in each. The planner shows these slots every week and auto-plan fills them from the ATP.')));

  const status = h('div', { 'aria-live': 'polite' });
  const importer = dropZone({
    accept: '.xlsx,.xls,.csv,.docx,image/*', label: 'Import a timetable',
    hint: 'Excel or Word is read on your device. A photo or screenshot is read by AI. Two-week (Week A/B or Day 1–10) timetables work too.',
    onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try {
        let res;
        if (kindOf(file) === 'image') {
          const dataUrl = await shrinkImage(file);
          await saveTimetable({ image: dataUrl });
          if (!aiReady()) { status.replaceChildren(h('p', { class: 'warn' }, `${aiUnavailableReason()} The photo is shown below the grid so you can copy it in by hand.`)); return; }
          res = await aiReadTimetable(dataUrl, tt.days);
          res.cycle = res.cells.some(c => c.week === 2) ? 2 : 1;
        } else res = await readTimetableFile(file);
        status.replaceChildren();
        applyImport(res);
      } catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    },
  });

  // ---------- Cycle ----------
  const cycleBox = h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Timetable repeats'),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Timetable repeats' },
      h('button', { role: 'radio', 'aria-checked': String(!two), onclick: () => setCycle(1) }, 'Every week'),
      h('button', { role: 'radio', 'aria-checked': String(two), onclick: () => setCycle(2) }, 'Every two weeks (Week A / B)')));

  const days = h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'School days'),
    h('div', { class: 'row wrap' }, ALL_DAYS.map(d => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: tt.days.includes(d), onchange: e => {
      const next = ALL_DAYS.filter(x => x === d ? e.target.checked : tt.days.includes(x));
      if (!next.length) return;
      // Re-key cells so each day keeps its lessons, in both weeks of the cycle.
      const rekey = map => { const out = {}; for (const [k, v] of Object.entries(map || {})) { const [di, pid] = k.split('|'); const ni = next.indexOf(tt.days[+di]); if (ni >= 0) out[`${ni}|${pid}`] = v; } return out; };
      saveTimetable({ days: next, cells: rekey(tt.cells), cellsB: rekey(tt.cellsB) });
    } }), d))));

  page.append(h('div', { class: 'tt-top' }, importer, status, h('div', { class: 'row wrap tt-opts' }, cycleBox, days)));

  if (two) page.append(cyclePanel());

  page.append(h('div', { class: 'grid-scroll' }, ttGrid(editWeek)));
  const other = 3 - editWeek;
  page.append(h('div', { class: 'row wrap' },
    h('button', { class: 'btn ghost', onclick: () => { const last = tt.periods.at(-1); saveTimetable({ periods: [...tt.periods, { id: uid('p'), label: String(tt.periods.length + 1), start: last?.end || '', end: '' }] }); } }, icon('plus'), 'Add period'),
    two ? h('button', { class: 'btn ghost', onclick: async () => {
      if (Object.keys(cellsOf(other)).length && !await confirmBox(`Replace everything in Week ${cycleLetter(other)} with a copy of Week ${cycleLetter(editWeek)}?`, 'Copy')) return;
      await saveTimetable({ [mapKey(other)]: JSON.parse(JSON.stringify(cellsOf(editWeek))) });
      toast(`Copied Week ${cycleLetter(editWeek)} into Week ${cycleLetter(other)}. Now change what's different.`);
    } }, `Copy Week ${cycleLetter(editWeek)} to Week ${cycleLetter(other)}`) : null,
    Object.keys(cellsOf(editWeek)).length ? h('button', { class: 'btn ghost danger', onclick: async () => {
      if (await confirmBox(`Clear every slot${two ? ` in Week ${cycleLetter(editWeek)}` : ''}? Periods stay.`, 'Clear slots')) saveTimetable({ [mapKey(editWeek)]: {} });
    } }, two ? `Clear Week ${cycleLetter(editWeek)}` : 'Clear slots') : null,
  ));
  if (tt.image) page.append(h('figure', { class: 'tt-photo' }, h('img', { src: tt.image, alt: 'Photo of your printed timetable' }), h('figcaption', { class: 'row between' }, 'Your timetable photo, for reference.', h('button', { class: 'btn ghost sm', onclick: () => saveTimetable({ image: '' }) }, 'Remove photo'))));
  if (!state.subjects.length) page.append(h('p', { class: 'warn' }, 'Add your subjects first so you can choose them in the grid. ', h('a', { href: '#subjects' }, 'Add subjects')));
  return page;
}

async function setCycle(n) {
  const tt = state.timetable;
  if ((tt.cycle || 1) === n) return;
  if (n === 1 && Object.keys(tt.cellsB || {}).length && !await confirmBox('Switch to a one-week timetable? Week A will be used every week. Week B is kept in case you switch back.', 'Switch')) return;
  editWeek = 1;
  await saveTimetable({ cycle: n });
  if (n === 2) toast('Two-week cycle on. Fill in Week B, or copy Week A and change what differs.');
}

function cyclePanel() {
  const tt = state.timetable;
  const thisWeek = cycleWeekOf(addDays(mondayOf(today()), 1));
  return h('section', { class: 'cycle-panel' },
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Week of the cycle' },
      [1, 2].map(w => h('button', { role: 'tab', 'aria-selected': String(editWeek === w), onclick: () => { editWeek = w; saveTimetable({}); } },
        `Week ${cycleLetter(w)}`, h('span', { class: 'tab-count' }, ` ${Object.keys(cellsOf(w)).length} lessons`)))),
    h('div', { class: 'row wrap cycle-rules' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'How the weeks count'),
        h('select', { onchange: e => saveTimetable({ cycleMode: e.target.value }) },
          h('option', { value: 'term', selected: tt.cycleMode !== 'continuous' }, 'Every term starts on Week A'),
          h('option', { value: 'continuous', selected: tt.cycleMode === 'continuous' }, 'Carries on from one term to the next'))),
      h('p', { class: 'muted small' }, `This week is Week ${cycleLetter(thisWeek)}. If that’s wrong, tap the Week badge on the planner to swap A and B.`)));
}

function ttGrid(week) {
  const tt = state.timetable;
  const cells = cellsOf(week);
  const two = (tt.cycle || 1) === 2;
  const grid = h('div', { class: 'tt-grid' + (two ? ' week-' + cycleLetter(week).toLowerCase() : ''), style: { gridTemplateColumns: `11rem repeat(${tt.days.length}, minmax(9.5rem, 1fr))` } });
  grid.append(h('div', { class: 'tt-head' }, two ? `Week ${cycleLetter(week)}` : 'Period'), ...tt.days.map(d => h('div', { class: 'tt-head' }, d)));
  tt.periods.forEach(p => {
    grid.append(h('div', { class: 'tt-period' },
      h('input', { class: 'p-label', value: p.label, 'aria-label': 'Period name', onchange: e => { p.label = e.target.value; saveTimetable({}); } }),
      h('div', { class: 'row' },
        h('input', { type: 'time', value: p.start, 'aria-label': `Period ${p.label} start`, onchange: e => { p.start = e.target.value; saveTimetable({}); } }),
        h('input', { type: 'time', value: p.end, 'aria-label': `Period ${p.label} end`, onchange: e => { p.end = e.target.value; saveTimetable({}); } })),
      h('button', { class: 'link small danger', onclick: async () => {
        const used = state.lessons.filter(l => l.periodId === p.id).length;
        if (used && !await confirmBox(`${used} planned lessons use this period. They will stay in your data but won't show on the planner.`, 'Remove period')) return;
        const drop = map => Object.fromEntries(Object.entries(map || {}).filter(([k]) => k.split('|')[1] !== p.id));
        saveTimetable({ periods: tt.periods.filter(x => x.id !== p.id), cells: drop(tt.cells), cellsB: drop(tt.cellsB) });
      } }, 'Remove')));
    tt.days.forEach((d, di) => {
      const key = `${di}|${p.id}`; const c = cells[key] || {};
      const subj = subjectById(c.subjectId);
      grid.append(h('div', { class: 'tt-cell' + (subj ? ' filled' : ''), style: subj ? { '--subj': subj.colour } : {} },
        h('select', { 'aria-label': `${two ? 'Week ' + cycleLetter(week) + ' ' : ''}${d} period ${p.label} subject`, onchange: e => { const v = e.target.value; if (v) cells[key] = { ...c, subjectId: v }; else delete cells[key]; saveTimetable({}); } },
          h('option', { value: '' }, 'Free'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === c.subjectId }, subjectLabel(s)))),
        subj ? h('input', { placeholder: 'Class', value: c.cls || '', 'aria-label': `${d} period ${p.label} class`, onchange: e => { cells[key] = { ...c, cls: e.target.value.trim() }; saveTimetable({}); } }) : null,
      ));
    });
  });
  return grid;
}

// Imported periods/cells → timetable, matching subject names to the teacher's subjects.
function applyImport(res) {
  const tt = state.timetable;
  const periods = res.periods.map((p, i) => ({ id: tt.periods[i]?.id || uid('p'), label: p.label || String(i + 1), start: p.start || tt.periods[i]?.start || '', end: p.end || tt.periods[i]?.end || '' }));
  const two = res.cycle === 2;
  // A one-week file goes into the week being edited (so you can import Week B on its own).
  const rows = res.cells.map(c => ({ ...c, week: two ? (c.week === 2 ? 2 : 1) : editWeek, match: matchSubject(c.subject, state.subjects) }));
  const unknown = new Map();
  rows.filter(r => !r.match && r.subject).forEach(r => unknown.set(r.subject.trim(), (unknown.get(r.subject.trim()) || 0) + 1));
  const weeks = two ? [1, 2] : [editWeek];
  const bWeek = rows.filter(r => r.week === 2).length;

  const body = h('div', {});
  const m = modal('Check the imported timetable', body, { wide: true });
  const choices = {};
  for (const name of unknown.keys()) choices[name] = 'new';
  const preview = w => h('div', { class: 'table-wrap' }, h('table', { class: 'mini' },
    h('thead', {}, h('tr', {}, h('th', {}, two ? `Week ${cycleLetter(w)}` : ''), ...tt.days.map(d => h('th', {}, d)))),
    h('tbody', {}, periods.map((p, pi) => h('tr', {}, h('th', {}, `${p.label} ${p.start}`), ...tt.days.map((d, di) => { const r = rows.find(r => r.week === w && r.dayIndex === di && r.periodIndex === pi); return h('td', {}, r ? `${r.subject}${r.cls ? ' ' + r.cls : ''}` : ''); }))))));
  body.append(
    h('p', {}, two
      ? `Found a two-week timetable: ${periods.length} periods, ${rows.length - bWeek} lessons in Week A and ${bWeek} in Week B.`
      : `Found ${periods.length} periods and ${rows.length} lessons.${(tt.cycle || 1) === 2 ? ` They’ll go into Week ${cycleLetter(editWeek)}.` : ''}`),
    unknown.size ? h('div', {}, h('h3', {}, 'Subjects to match'), h('p', { class: 'muted small' }, 'These names don’t match your subjects yet. Pick one, create it, or skip.'),
      h('div', { class: 'stack' }, [...unknown].map(([name, n]) => h('label', { class: 'row between match-row' }, h('span', {}, h('strong', {}, name), h('span', { class: 'muted small' }, ` · ${n} slot${n > 1 ? 's' : ''}`)),
        h('select', { onchange: e => choices[name] = e.target.value }, h('option', { value: 'new' }, 'Create as new subject'), h('option', { value: '' }, 'Skip (leave free)'), state.subjects.map(s => h('option', { value: s.id }, subjectLabel(s)))))))) : null,
    ...weeks.map(preview),
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const map = {};
        for (const [name, v] of Object.entries(choices)) {
          if (v === 'new') { const grade = (rows.find(r => r.subject.trim() === name)?.cls.match(/^\d{1,2}/) || [])[0] || ''; const s = await upsertSubject({ name, grade, language: /afr/i.test(name) ? 'Afrikaans' : 'English' }); map[name] = s.id; }
          else map[name] = v;
        }
        const out = { 1: {}, 2: {} };
        for (const r of rows) {
          if (r.dayIndex < 0 || r.dayIndex >= tt.days.length || !periods[r.periodIndex]) continue;
          const sid = r.match?.id || map[r.subject.trim()];
          if (sid) out[r.week][`${r.dayIndex}|${periods[r.periodIndex].id}`] = { subjectId: sid, cls: r.cls || '', room: r.room || '' };
        }
        const patch = { periods };
        if (two) Object.assign(patch, { cycle: 2, cells: out[1], cellsB: out[2] });
        else patch[mapKey(editWeek)] = out[editWeek];
        await saveTimetable(patch); m.close();
        toast(two ? 'Two-week timetable imported (Week A and Week B).' : 'Timetable imported.');
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
