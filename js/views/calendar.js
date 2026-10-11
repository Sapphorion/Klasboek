// School calendar: year planner, test and exam timetables, holidays, meetings, deadlines.
import { state, onChange, saveEvent, saveEvents, deleteEvents, eventById, subjectById, subjectLabel, addMaterial } from '../state.js';
import { h, icon, toast, modal, confirmBox, dropZone, busy } from '../ui.js';
import { readCalendarFile, matchSubject, kindOf } from '../importers.js';
import { aiReadCalendar, aiReady, aiUnavailableReason } from '../ai.js';
import { today, parse, iso, addDays, mondayOf, fmt, fmtLong, inTerm } from '../dates.js';
import { EVENT_TYPES, typeOf, eventsOn, noTeachingOn, byDateThenType, eventLabel, allEvents } from '../events.js';
import { shrinkImage } from './timetable.js';
import { afterTeachingChange, changeFor } from '../adjust.js';

let month = today().slice(0, 7); // 'YYYY-MM'
let selected = today();
let mode = 'month';
const hidden = new Set(); // event types filtered out

// The calendar now lives inside the planner (Month view). Old links redirect there.
export function renderCalendar(root, [date]) {
  location.replace('#planner/month' + (date ? '/' + date : ''));
  return null;
}

let host = null, hostOpts = {};
export function setCalendarDate(date) { if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { selected = date; month = date.slice(0, 7); } }
// Month view body, embedded in the planner. opts.onOpenWeek(date), opts.onDayMenu(date)
export function calendarBody(opts = {}) {
  hostOpts = opts;
  host = h('div', { class: 'cal-embed' });
  host.append(view());
  return host;
}

function view() {
  const page = h('div', { class: 'cal-page' });

  const status = h('div', { 'aria-live': 'polite' });
  const upload = kind => dropZone({
    accept: '.pdf,.docx,.xlsx,.xls,.csv,image/*',
    label: kind === 'planner' ? 'Upload the year planner' : 'Upload a test or exam timetable',
    hint: 'PDF, Word, Excel, or a photo (read by AI)',
    onFiles: ([file]) => importFile(file, kind, status),
  });
  page.append(h('div', { class: 'cal-uploads' }, upload('planner'), upload('assessments')), status);

  // ---------- Toolbar ----------
  const [y, m] = month.split('-').map(Number);
  const title = new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const shift = n => { const d = new Date(y, m - 1 + n, 1); month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; rerender(); };
  page.append(h('div', { class: 'toolbar cal-toolbar' },
    h('div', { class: 'week-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')),
      h('h2', { class: 'cal-title' }, mode === 'month' ? title : 'All events'),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right')),
      month !== today().slice(0, 7) ? h('button', { class: 'btn ghost sm', onclick: () => { month = today().slice(0, 7); selected = today(); rerender(); } }, 'Today') : null),
    h('div', { class: 'row wrap' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
        h('button', { 'aria-pressed': String(mode === 'month'), onclick: () => { mode = 'month'; rerender(); } }, 'Month'),
        h('button', { 'aria-pressed': String(mode === 'list'), onclick: () => { mode = 'list'; rerender(); } }, 'List')),
      h('button', { class: 'btn', onclick: () => editEvent({ date: selected, type: 'event' }) }, icon('plus'), 'Add event')),
  ));
  page.append(h('div', { class: 'legend', role: 'group', 'aria-label': 'Show event types' }, EVENT_TYPES.map(t =>
    h('button', { class: 'chip legend-chip', 'aria-pressed': String(!hidden.has(t.id)), style: { '--c': t.colour }, onclick: () => { hidden.has(t.id) ? hidden.delete(t.id) : hidden.add(t.id); rerender(); } },
      h('span', { class: 'dot' }), t.label))));

  if (mode === 'month') page.append(h('div', { class: 'cal-body' }, monthGrid(y, m - 1), dayPanel()));
  else page.append(listView());
  if (state.events.length) page.append(sources());
  return page;
}

function rerender() { if (host?.isConnected) host.replaceChildren(view()); }

const visible = list => list.filter(e => !hidden.has(e.type));

function monthGrid(y, m) {
  const first = iso(new Date(y, m, 1));
  const start = mondayOf(first);
  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Month' });
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => grid.append(h('div', { class: 'cal-dow' + (i > 4 ? ' wknd' : ''), role: 'columnheader' }, d)));
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.slice(0, 7) !== month) break;
    const evs = visible(eventsOn(d));
    const wd = (parse(d).getDay() + 6) % 7;
    const school = inTerm(d) && wd < 5 && !noTeachingOn(d);
    const cell = h('div', {
      class: ['cal-day', d.slice(0, 7) !== month && 'other', d === today() && 'today', d === selected && 'sel', wd > 4 && 'wknd', !school && wd < 5 && 'closed'].filter(Boolean).join(' '),
      role: 'gridcell', tabindex: 0, 'aria-selected': String(d === selected),
      'aria-label': `${fmtLong(d)}${evs.length ? ', ' + evs.length + ' event' + (evs.length > 1 ? 's' : '') : ''}${!school && wd < 5 ? ', no school' : ''}`,
    },
      h('span', { class: 'cal-num' }, String(parse(d).getDate())),
      (() => { const n = state.lessons.filter(l => l.date === d).length; return n ? h('span', { class: 'cal-lessons' }, `${n} lesson${n > 1 ? 's' : ''}`) : null; })(),
      h('div', { class: 'cal-pills' },
        evs.slice(0, 3).map(e => h('button', { class: 'pill', style: { '--c': typeOf(e.type).colour }, title: eventLabel(e), onclick: ev => { ev.stopPropagation(); openEvent(e); } }, h('span', {}, e.title))),
        evs.length > 3 ? h('span', { class: 'more' }, `+${evs.length - 3}`) : null));
    const pick = () => { selected = d; if (d.slice(0, 7) !== month) month = d.slice(0, 7); rerender(); };
    cell.addEventListener('click', pick);
    cell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    cell.addEventListener('dblclick', () => hostOpts.onOpenWeek ? hostOpts.onOpenWeek(d) : editEvent({ date: d, type: 'event' }));
    grid.append(cell);
  }
  return grid;
}

function dayPanel() {
  const evs = eventsOn(selected);
  const wd = (parse(selected).getDay() + 6) % 7;
  const note = wd > 4 ? 'Weekend' : !inTerm(selected) ? 'School holiday' : noTeachingOn(selected) ? 'No teaching' : '';
  return h('aside', { class: 'day-panel' },
    h('h3', {}, fmtLong(selected)), note ? h('p', { class: 'muted small' }, note) : null,
    evs.length ? h('ul', { class: 'ev-list' }, evs.map(eventRow)) : h('p', { class: 'muted' }, 'Nothing on this day.'),
    h('div', { class: 'row wrap' },
      hostOpts.onDayMenu && wd < 5 ? h('button', { class: 'btn sm', onclick: () => hostOpts.onDayMenu(selected) }, icon('pen', 16), 'Change this day') : h('button', { class: 'btn ghost sm', onclick: () => editEvent({ date: selected, type: 'event' }) }, icon('plus', 16), 'Add event'),
      hostOpts.onOpenWeek ? h('button', { class: 'btn ghost sm', onclick: () => hostOpts.onOpenWeek(selected) }, icon('calendar', 16), 'Open this week') : null));
}

function eventRow(e) {
  const t = typeOf(e.type); const s = subjectById(e.subjectId);
  return h('li', {}, h('button', { class: 'ev-row', style: { '--c': t.colour }, onclick: () => openEvent(e) },
    h('span', { class: 'ev-type' }, t.label),
    h('strong', {}, e.title),
    h('span', { class: 'muted small' }, [e.endDate ? `${fmt(e.date)} – ${fmt(e.endDate)}` : '', e.time, s ? subjectLabel(s) : (e.grade ? 'Grade ' + e.grade : ''), e.noTeaching ? 'no teaching' : '', e.notice ? e.notes : ''].filter(Boolean).join(' · '))));
}

function listView() {
  const from = `${month}-01`;
  const evs = visible(allEvents().filter(e => (e.endDate || e.date) >= from)).sort(byDateThenType);
  if (!evs.length) return h('p', { class: 'empty' }, state.events.length ? 'No events from this month on. Go back a month, or switch filters on.' : 'No events yet. Upload your year planner or add an event.');
  const groups = new Map();
  for (const e of evs) { const k = e.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  return h('div', { class: 'cal-list' }, [...groups].map(([k, list]) => h('section', {},
    h('h3', {}, new Date(+k.slice(0, 4), +k.slice(5) - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })),
    h('ul', { class: 'ev-list dated' }, list.map(e => h('li', {}, h('span', { class: 'ev-date' }, fmt(e.date, { weekday: 'short', day: 'numeric', month: 'short' })), eventRow(e)))))));
}

function sources() {
  const by = new Map();
  for (const e of state.events) { const k = e.source || 'Added by hand'; by.set(k, (by.get(k) || 0) + 1); }
  return h('details', { class: 'sources' }, h('summary', {}, `Where these events came from (${by.size})`),
    h('ul', {}, [...by].map(([src, n]) => h('li', { class: 'row between' }, h('span', {}, h('strong', {}, src), h('span', { class: 'muted small' }, ` · ${n} event${n > 1 ? 's' : ''}`)),
      h('button', { class: 'btn ghost sm danger', onclick: async () => {
        if (!await confirmBox(`Remove all ${n} events from ${src}? Use this before uploading a newer version.`, 'Remove events')) return;
        const gone = state.events.filter(e => (e.source || 'Added by hand') === src);
        await deleteEvents(gone.map(e => e.id)); toast('Events removed.');
        const freed = gone.filter(e => e.noTeaching || (e.blockedPeriods || []).length).map(e => ({ from: e.date, to: e.endDate || e.date }));
        if (freed.length) afterTeachingChange({ freed }, 'Days that had no lessons are free again.');
      } }, 'Remove')))));
}

// ---------- Event editor ----------
function editEvent(e) {
  const isNew = !e.id;
  const before = isNew ? null : JSON.parse(JSON.stringify(e));
  const f = { title: '', type: 'event', date: today(), endDate: '', time: '', subjectId: '', grade: '', cls: '', notes: '', noTeaching: false, blockedPeriods: [], ...e };
  f.blockedPeriods = [...(f.blockedPeriods || [])];
  const effect = teachingEffect(f);
  const body = h('form', { class: 'form-grid', onsubmit: async ev => {
    ev.preventDefault();
    if (!f.title.trim()) { toast('Give the event a title.', 'error'); return; }
    if (f.endDate && f.endDate < f.date) { toast('The end date is before the start date.', 'error'); return; }
    const saved = await saveEvent({ ...f, title: f.title.trim(), endDate: f.endDate && f.endDate !== f.date ? f.endDate : '', source: f.source || '' });
    m.close(); toast(isNew ? 'Event added.' : 'Event saved.');
    afterTeachingChange(changeFor(before, saved), `“${saved.title}” changes teaching time.`);
  } },
    fld('Title', h('input', { value: f.title, required: true, placeholder: 'e.g. Gr 10 Mathematics test', oninput: ev => f.title = ev.target.value }), true),
    fld('Type', h('select', { onchange: ev => { f.type = ev.target.value; if (f.type === 'holiday') effect.set('none'); } }, EVENT_TYPES.map(t => h('option', { value: t.id, selected: t.id === f.type }, t.label)))),
    fld('Date', h('input', { type: 'date', value: f.date, required: true, onchange: ev => f.date = ev.target.value })),
    fld('Until (optional)', h('input', { type: 'date', value: f.endDate || '', onchange: ev => f.endDate = ev.target.value })),
    fld('Time (optional)', h('input', { value: f.time, placeholder: 'e.g. 08:00–10:00', oninput: ev => f.time = ev.target.value })),
    fld('Subject (for tests and exams)', h('select', { onchange: ev => f.subjectId = ev.target.value }, h('option', { value: '' }, 'Not one of my subjects'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === f.subjectId }, subjectLabel(s))))),
    fld('Grade', h('input', { value: f.grade, placeholder: 'e.g. 10', oninput: ev => f.grade = ev.target.value.trim() })),
    fld('Notes', h('textarea', { rows: 2, oninput: ev => f.notes = ev.target.value }, f.notes || ''), true),
    effect.el,
    h('div', { class: 'row between', style: { gridColumn: '1 / -1' } },
      isNew ? h('span') : h('button', { type: 'button', class: 'btn ghost danger sm', onclick: async () => { if (await confirmBox(`Delete “${f.title}”?`)) { await deleteEvents([f.id]); m.close(); toast('Event deleted.'); afterTeachingChange(changeFor(before, null), `“${f.title}” was removed, so that time is free again.`); } } }, icon('trash', 16), 'Delete'),
      h('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Add event' : 'Save event')),
  );
  const m = modal(isNew ? 'Add an event' : 'Edit event', body);
}
// "Effect on teaching": normal lessons / no lessons all day / some periods are lost.
export function teachingEffect(f) {
  const val = () => f.noTeaching ? 'none' : (f.blockedPeriods || []).length ? 'periods' : 'normal';
  const el = h('div', { class: 'field effect', style: { gridColumn: '1 / -1' } });
  const draw = () => {
    const v = val();
    el.replaceChildren(h('span', { class: 'lbl' }, 'Effect on teaching'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Effect on teaching' }, [['normal', 'Normal lessons'], ['none', 'No lessons all day'], ['periods', 'Some periods are lost']].map(([k, l]) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === k), onclick: () => set(k) }, l))),
      v === 'periods' ? h('div', { class: 'chips' }, state.timetable.periods.map(p => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: f.blockedPeriods.includes(p.id), onchange: e => {
        f.blockedPeriods = e.target.checked ? [...f.blockedPeriods, p.id] : f.blockedPeriods.filter(x => x !== p.id);
        if (!f.blockedPeriods.length) { f.noTeaching = false; draw(); }
      } }), `P${p.label}${p.start ? ' ' + p.start : ''}`))) : null,
      h('span', { class: 'hint' }, v === 'normal' ? 'The planner stays as it is. The event shows as a note.' : 'The planner blocks this time and moves lessons planned in it to the class’s next free period.'));
  };
  const set = k => {
    f.noTeaching = k === 'none';
    if (k !== 'periods') f.blockedPeriods = [];
    else if (!f.blockedPeriods.length) f.blockedPeriods = state.timetable.periods.slice(-3).map(p => p.id);
    draw();
  };
  draw();
  return { el, set };
}

const fld = (label, input, wide) => h('label', { class: 'field', style: wide ? { gridColumn: '1 / -1' } : {} }, h('span', { class: 'lbl' }, label), input);

// ---------- Import ----------
function matchEventSubject(e) {
  const pool = state.subjects.filter(s => !e.grade || !s.grade || String(s.grade) === String(e.grade));
  return matchSubject(e.subject || e.title, pool)?.id || '';
}

async function importFile(file, kind, status) {
  const year = state.settings.year || new Date().getFullYear();
  status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
  try {
    let res;
    try { res = await readCalendarFile(file, kind, year); }
    catch (err) {
      if (!err.needsAi) throw err;
      if (!aiReady()) { status.replaceChildren(h('p', { class: 'warn' }, `${err.message} ${aiUnavailableReason()}`)); return; }
      status.replaceChildren(h('span', { class: 'spinner' }), ' Claude is reading it… up to a minute');
      const image = kindOf(file) === 'image' ? await shrinkImage(file, 2000) : null;
      const pdf = kindOf(file) === 'pdf' ? await toBase64(file) : null;
      res = { events: await aiReadCalendar(image ? { image } : { pdf }, kind, year), text: '', year, ai: true };
    }
    status.replaceChildren();
    reviewImport(file, kind, res);
  } catch (err) { status.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

function reviewImport(file, kind, res) {
  let rows = prep(res.events);
  function prep(list) {
    return list.map(e => {
      const subjectId = matchEventSubject(e);
      const dup = state.events.some(x => x.date === e.date && x.title.toLowerCase() === e.title.toLowerCase());
      // In a whole-school exam timetable, keep only papers for subjects you teach.
      const keep = !dup && (kind !== 'assessments' || !!subjectId || !['test', 'exam'].includes(e.type));
      return { ...e, subjectId, include: keep, dup };
    });
  }
  const body = h('div', {});
  const m = modal(`Check the ${kind === 'planner' ? 'year planner' : 'test and exam timetable'}`, body, { wide: true });
  const draw = () => {
    const n = rows.filter(r => r.include).length;
    const mine = rows.filter(r => r.subjectId).length;
    body.replaceChildren(
      rows.length
        ? h('p', {}, `Found ${rows.length} dated item${rows.length > 1 ? 's' : ''} in `, h('strong', {}, file.name), res.ai ? ' (read by AI)' : '', '. ',
            kind === 'assessments' ? `${mine} match your subjects and are ticked. ` : '', 'Untick anything you don’t need, fix dates or types, then save.')
        : h('p', { class: 'error' }, 'No dates were found in this file. ', aiReady() && !res.ai ? 'Try reading it with AI.' : 'Add the events by hand, or connect AI in Settings to read harder layouts.'),
      h('div', { class: 'row wrap' },
        aiReady() && !res.ai ? (() => { const b = h('button', { class: 'btn ghost sm' }, icon('spark', 16), 'Read with AI instead'); b.onclick = async () => {
          const done = busy(b, 'Reading… up to a minute');
          try { rows = prep(await aiReadCalendar({ text: res.text }, kind, res.year || state.settings.year)); res.ai = true; draw(); }
          catch (e) { toast(e.message, 'error'); } finally { done(); }
        }; return b; })() : null,
        h('button', { class: 'btn ghost sm', onclick: () => { rows.forEach(r => r.include = !r.dup); draw(); } }, 'Tick all'),
        h('button', { class: 'btn ghost sm', onclick: () => { rows.forEach(r => r.include = false); draw(); } }, 'Untick all'),
        rows.some(r => r.dup) ? h('span', { class: 'muted small' }, `${rows.filter(r => r.dup).length} already in your calendar (unticked).`) : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'edit-table ev-table' },
        h('thead', {}, h('tr', {}, ['', 'Date', 'Until', 'Type', 'Title', 'Time', 'Grade', 'My subject', 'No teaching'].map(t => h('th', {}, t)))),
        h('tbody', {}, rows.map(r => h('tr', { class: r.include ? '' : 'off' },
          h('td', {}, h('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Include ' + r.title, onchange: e => { r.include = e.target.checked; e.target.closest('tr').classList.toggle('off', !r.include); count(); } })),
          h('td', {}, h('input', { type: 'date', value: r.date, onchange: e => r.date = e.target.value })),
          h('td', {}, h('input', { type: 'date', value: r.endDate || '', onchange: e => r.endDate = e.target.value })),
          h('td', {}, h('select', { onchange: e => { r.type = e.target.value; if (r.type === 'holiday') r.noTeaching = true; draw(); } }, EVENT_TYPES.map(t => h('option', { value: t.id, selected: t.id === r.type }, t.label)))),
          h('td', {}, h('input', { value: r.title, oninput: e => r.title = e.target.value })),
          h('td', {}, h('input', { class: 'w-time', value: r.time || '', oninput: e => r.time = e.target.value })),
          h('td', {}, h('input', { class: 'num', value: r.grade || '', oninput: e => r.grade = e.target.value.trim() })),
          h('td', {}, h('select', { onchange: e => { r.subjectId = e.target.value; if (r.subjectId) { r.include = true; draw(); } } }, h('option', { value: '' }, '—'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === r.subjectId }, subjectLabel(s))))),
          h('td', {}, h('input', { type: 'checkbox', checked: !!r.noTeaching, 'aria-label': 'No teaching', onchange: e => r.noTeaching = e.target.checked })),
        ))))),
      h('div', { class: 'row end sticky-foot' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        saveBtn),
    );
    count();
  };
  const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
    const list = rows.filter(r => r.include && r.date && r.title.trim()).map(({ include, dup, subject, ...e }) => ({ ...e, title: e.title.trim(), endDate: e.endDate && e.endDate > e.date ? e.endDate : '', notes: e.notes || '', cls: '', source: file.name }));
    if (!list.length) { toast('Tick at least one event to save.', 'error'); return; }
    await saveEvents(list);
    await addMaterial(file, { kind: 'calendar' }).catch(() => {});
    m.close();
    const blocked = list.filter(e => e.noTeaching).map(e => ({ from: e.date, to: e.endDate || e.date }));
    if (blocked.length) setTimeout(() => afterTeachingChange({ blocked }, 'Some of the new events have no lessons.'), 400);
    const first = list.map(e => e.date).sort()[0];
    month = first.slice(0, 7); selected = first; mode = 'month'; rerender();
    toast(`Saved ${list.length} event${list.length > 1 ? 's' : ''}. The original file is in Materials.`);
  } });
  const count = () => { saveBtn.textContent = `Save ${rows.filter(r => r.include).length} events`; };
  draw();
}

const toBase64 = file => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });

// Notices open their own page; other events open the editor.
export function openEvent(e) {
  if (e.notice) { document.querySelector('dialog.modal')?.close(); location.hash = 'moderation/notice/' + e.notice; return; }
  editEvent(e);
}

export { editEvent };
