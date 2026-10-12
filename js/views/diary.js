// Teacher diary: a page per day with your lessons, what's on the calendar, and your own entries.
// Any entry can also go on the school calendar (meetings, duties, parent contact, deadlines…).
import { state, onChange, saveDiary, deleteDiary, diaryOn, diaryById, saveEvent, deleteEvents, eventById, saveLesson, subjectById, classLabel } from '../state.js';
import { h, icon, toast, confirmBox } from '../ui.js';
import { today, addDays, mondayOf, fmt, fmtLong, termWeekOf, inTerm } from '../dates.js';
import { eventsOn, typeOf, eventLabel } from '../events.js';
import { openEvent } from './calendar.js';
import { openDayMenu } from './daymenu.js';
import { openLesson } from './lesson.js';

export const KINDS = [
  { id: 'note', label: 'Note', ev: 'reminder' },
  { id: 'todo', label: 'To do', ev: 'reminder' },
  { id: 'meeting', label: 'Meeting', ev: 'meeting' },
  { id: 'duty', label: 'Duty', ev: 'event' },
  { id: 'parent', label: 'Parent contact', ev: 'meeting' },
  { id: 'learner', label: 'Learner', ev: 'reminder' },
  { id: 'deadline', label: 'Deadline', ev: 'deadline' },
  { id: 'reflection', label: 'Reflection', ev: 'reminder' },
];
const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

let date = today();
let mode = 'day';     // 'day' | 'list'
let query = '', kindFilter = '';
let draft = { kind: 'note', text: '', time: '', cal: false };
let rootEl = null;

export function renderDiary(root, [d] = []) {
  rootEl = root;
  if (d === 'list') mode = 'list';
  else { mode = 'day'; if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) date = d; }
  const off = onChange(w => { if (['diary', 'events', 'lessons', 'notices', 'subjects', 'timetable'].includes(w)) rerender(); });
  rerender();
  return () => { off(); rootEl = null; };
}
function rerender() {
  if (!rootEl) return;
  const focus = document.activeElement?.dataset?.keep;
  rootEl.replaceChildren(view());
  if (focus) rootEl.querySelector(`[data-keep="${focus}"]`)?.focus();
}
const go = d => { location.hash = 'diary/' + d; };

// ---------- Calendar link ----------
const titleOf = e => { const first = (e.text || '').split('\n')[0].trim(); return (first.length > 70 ? first.slice(0, 68) + '…' : first) || kindOf(e.kind).label; };
export async function syncEvent(entry) {
  const ev = entry.eventId && eventById(entry.eventId);
  if (!entry.onCalendar) { if (ev) await deleteEvents([ev.id]); entry.eventId = ''; return; }
  const e = await saveEvent({ ...(ev || {}), id: ev?.id, date: entry.date, endDate: '', title: titleOf(entry), type: kindOf(entry.kind).ev, time: entry.time || '',
    subjectId: '', grade: '', cls: entry.cls || '', notes: entry.text, noTeaching: false, blockedPeriods: [], source: 'Diary', diaryId: entry.id });
  entry.eventId = e.id;
}
async function save(entry, { quiet = true } = {}) {
  if (!entry.id) await saveDiary(entry, { silent: true }); // needs an id before the event links to it
  await syncEvent(entry);
  await saveDiary(entry, { silent: quiet });
}
async function remove(entry) {
  if (!await confirmBox('Delete this diary entry?' + (entry.onCalendar ? ' It comes off the calendar too.' : ''), 'Delete')) return;
  if (entry.eventId && eventById(entry.eventId)) await deleteEvents([entry.eventId]);
  await deleteDiary(entry.id);
  toast('Diary entry deleted.');
}

// ---------- Page ----------
function view() {
  const page = h('div', { class: 'diary-page' });
  const tw = termWeekOf(date);
  page.append(h('div', { class: 'toolbar' },
    mode === 'day' ? h('div', { class: 'week-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => go(addDays(date, -1)) }, icon('left')),
      h('div', { class: 'week-title' }, h('h1', {}, fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })), h('span', { class: 'muted' }, tw ? `Term ${tw.term}, week ${tw.week}` : inTerm(date) ? '' : 'School holiday')),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => go(addDays(date, 1)) }, icon('right')),
      date !== today() ? h('button', { class: 'btn ghost sm', onclick: () => go(today()) }, 'Today') : null,
      h('input', { type: 'date', class: 'sm diary-pick', value: date, 'aria-label': 'Go to date', onchange: e => e.target.value && go(e.target.value) }),
    ) : h('div', { class: 'week-title' }, h('h1', {}, 'Diary'), h('span', { class: 'muted' }, `${state.diary.length} entr${state.diary.length === 1 ? 'y' : 'ies'}`)),
    h('div', { class: 'row wrap' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Diary view' },
        h('button', { 'aria-pressed': String(mode === 'day'), onclick: () => go(date) }, 'Day'),
        h('button', { 'aria-pressed': String(mode === 'list'), onclick: () => { location.hash = 'diary/list'; } }, 'All entries')),
      h('button', { class: 'btn ghost', onclick: () => exportDiaryDocx(mondayOf(date), addDays(mondayOf(date), 6)).catch(e => toast(e.message, 'error')) }, icon('download'), 'Week (.docx)')),
  ));
  page.append(mode === 'day' ? dayView() : listView());
  return page;
}

function dayView() {
  const wrap = h('div', { class: 'diary-day' });
  // Left: lessons and calendar for the day.
  const P = state.timetable.periods;
  const lessons = state.lessons.filter(l => l.date === date).sort((a, b) => P.findIndex(p => p.id === a.periodId) - P.findIndex(p => p.id === b.periodId));
  const evs = eventsOn(date).filter(e => !e.diaryId);
  const left = h('div', { class: 'diary-col' },
    h('section', { class: 'card-sec' }, h('h2', {}, 'Lessons'),
      lessons.length ? h('ul', { class: 'diary-lessons' }, lessons.map(l => {
        const s = subjectById(l.subjectId); const p = P.find(x => x.id === l.periodId);
        return h('li', { style: { '--subj': s?.colour || '#777' } },
          h('button', { class: 'link strong', onclick: () => openLesson(l.id) }, `P${p?.label ?? '?'} · ${classLabel(s, l.cls)}`),
          h('span', {}, l.title + (l.subtopic ? ` · ${l.subtopic}` : '')),
          h('textarea', { rows: 2, 'data-keep': 'refl-' + l.id, placeholder: 'How did it go? What to carry over?', 'aria-label': `How did ${l.title} go?`, onchange: e => { l.reflection = e.target.value.trim(); saveLesson(l); } }, l.reflection || ''));
      })) : h('p', { class: 'muted small' }, inTerm(date) ? 'No lessons planned for this day.' : 'No school today.')),
    h('section', { class: 'card-sec' }, h('div', { class: 'row between' }, h('h2', {}, 'On the calendar'),
        h('button', { class: 'btn ghost sm', onclick: () => openDayMenu(date, mondayOf(date)) }, icon('pen', 16), 'Change this day')),
      evs.length ? h('ul', { class: 'ev-list' }, evs.map(e => h('li', {}, h('button', { class: 'ev-row', style: { '--c': typeOf(e.type).colour }, onclick: () => e.notice ? location.hash = 'moderation/notice/' + e.notice : openEvent(e) },
        h('span', { class: 'ev-type' }, typeOf(e.type).label + (e.time ? ' · ' + e.time : '')), h('strong', {}, eventLabel(e)))))) : h('p', { class: 'muted small' }, 'Nothing on the school calendar.'),
      h('div', { class: 'row wrap small diary-links' }, h('a', { href: '#calendar/' + date }, 'Open the calendar'), h('a', { href: '#planner/week/' + mondayOf(date) }, 'Open this week in the planner'))),
  );

  // Right: entries.
  const entries = diaryOn(date);
  const carried = state.diary.filter(d => d.kind === 'todo' && !d.done && d.date < date).sort((a, b) => a.date.localeCompare(b.date));
  const right = h('div', { class: 'diary-col' },
    h('section', { class: 'card-sec diary-add' }, h('h2', {}, 'Add to the diary'), addForm()),
    h('section', { class: 'card-sec' }, h('h2', {}, `Entries${entries.length ? ` (${entries.length})` : ''}`),
      entries.length ? h('ul', { class: 'diary-entries' }, entries.map(entryRow)) : h('p', { class: 'muted small' }, 'Nothing written for this day yet.')),
    carried.length ? h('section', { class: 'card-sec' }, h('h2', {}, `Still to do (${carried.length})`),
      h('ul', { class: 'diary-entries' }, carried.map(e => entryRow(e, { showDate: true })))) : null,
  );
  wrap.append(left, right);
  return wrap;
}

function addForm() {
  const text = h('textarea', { rows: 3, 'data-keep': 'new', placeholder: 'e.g. Phoned Thabo’s mom about homework. Follow up Friday.', 'aria-label': 'Diary entry', oninput: e => draft.text = e.target.value }, draft.text);
  const submit = async () => {
    if (!draft.text.trim()) { text.focus(); return; }
    const entry = { date, time: draft.time, kind: draft.kind, text: draft.text.trim(), done: false, cls: '', onCalendar: draft.cal, eventId: '' };
    draft = { kind: draft.kind, text: '', time: '', cal: false };
    await save(entry, { quiet: false });
    toast(entry.onCalendar ? 'Added to the diary and the calendar.' : 'Added to the diary.');
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });
  return h('div', { class: 'stack' },
    h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Kind of entry' }, KINDS.map(k => h('button', { type: 'button', role: 'radio', class: 'chip kind-' + k.id, 'aria-checked': String(draft.kind === k.id), onclick: () => {
      draft.kind = k.id; draft.text = text.value;
      if (['meeting', 'duty', 'deadline'].includes(k.id)) draft.cal = true;
      rerender();
    } }, k.label))),
    text,
    h('div', { class: 'row wrap' },
      h('label', { class: 'row' }, h('span', { class: 'muted small' }, 'Time'), h('input', { type: 'time', value: draft.time, 'aria-label': 'Time (optional)', onchange: e => draft.time = e.target.value })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.cal, onchange: e => draft.cal = e.target.checked }), 'Also put it on the calendar'),
      h('button', { class: 'btn primary', style: { marginLeft: 'auto' }, onclick: submit }, icon('plus'), 'Add')));
}

function entryRow(e, { showDate = false } = {}) {
  const k = kindOf(e.kind);
  const onCal = e.onCalendar && e.eventId && eventById(e.eventId);
  let editing = false;
  const li = h('li', { class: 'diary-entry kind-' + k.id + (e.done ? ' done' : '') });
  const draw = () => {
    li.replaceChildren(
      e.kind === 'todo' ? h('input', { type: 'checkbox', checked: !!e.done, 'aria-label': 'Done', onchange: async ev => { e.done = ev.target.checked; await saveDiary(e); } }) : h('span', { class: 'kind-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'de-body' },
        h('div', { class: 'de-meta' }, h('span', { class: 'de-kind' }, k.label), showDate ? h('a', { href: '#diary/' + e.date }, fmt(e.date, { weekday: 'short', day: 'numeric', month: 'short' })) : null, e.time ? h('span', {}, e.time) : null,
          onCal ? h('span', { class: 'de-cal', title: 'On the calendar' }, icon('calendar', 12), 'On the calendar') : null),
        editing ? editForm(e, () => { editing = false; draw(); }) : h('p', { class: 'de-text' }, e.text)),
      editing ? null : h('div', { class: 'de-acts' },
        h('button', { class: 'icon-btn', 'aria-label': 'Edit entry', onclick: () => { editing = true; draw(); } }, icon('pen', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete entry', onclick: () => remove(e) }, icon('trash', 16))));
  };
  draw();
  return li;
}

function editForm(e, done) {
  const f = { ...e };
  return h('div', { class: 'stack de-edit' },
    h('div', { class: 'row wrap' },
      h('select', { 'aria-label': 'Kind', onchange: ev => f.kind = ev.target.value }, KINDS.map(k => h('option', { value: k.id, selected: k.id === f.kind }, k.label))),
      h('input', { type: 'date', value: f.date, 'aria-label': 'Date', onchange: ev => f.date = ev.target.value || f.date }),
      h('input', { type: 'time', value: f.time || '', 'aria-label': 'Time', onchange: ev => f.time = ev.target.value })),
    h('textarea', { rows: 3, 'aria-label': 'Entry', oninput: ev => f.text = ev.target.value }, f.text),
    h('div', { class: 'row wrap' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!f.onCalendar, onchange: ev => f.onCalendar = ev.target.checked }), 'On the calendar'),
      h('button', { class: 'btn ghost sm', style: { marginLeft: 'auto' }, onclick: done }, 'Cancel'),
      h('button', { class: 'btn primary sm', onclick: async () => { Object.assign(e, f, { text: f.text.trim() || e.text }); await save(e, { quiet: false }); toast('Saved.'); } }, 'Save')));
}

function listView() {
  const q = query.toLowerCase();
  const list = state.diary.filter(d => (!kindFilter || d.kind === kindFilter) && (!q || d.text.toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
  const box = h('div', { class: 'diary-list' });
  box.append(h('div', { class: 'row wrap' },
    h('input', { type: 'search', placeholder: 'Search the diary', value: query, 'data-keep': 'q', 'aria-label': 'Search the diary', oninput: e => { query = e.target.value; rerender(); } }),
    h('select', { 'aria-label': 'Kind', onchange: e => { kindFilter = e.target.value; rerender(); } }, h('option', { value: '' }, 'All kinds'), KINDS.map(k => h('option', { value: k.id, selected: k.id === kindFilter }, k.label)))));
  if (!list.length) { box.append(h('p', { class: 'empty' }, state.diary.length ? 'Nothing matches.' : 'Your diary is empty. Open a day and add an entry.')); return box; }
  let cur = '';
  let ul = null;
  for (const e of list.slice(0, 300)) {
    if (e.date !== cur) { cur = e.date; box.append(h('h3', { class: 'diary-date' }, h('a', { href: '#diary/' + e.date }, fmtLong(e.date)))); ul = h('ul', { class: 'diary-entries' }); box.append(ul); }
    ul.append(entryRow(e));
  }
  return box;
}

// ---------- Export ----------
export async function exportDiaryDocx(from, to) {
  const { docKit } = await import('../exporters.js');
  const k = await docKit();
  const P = state.timetable.periods;
  const kids = [k.p(`Teacher diary: ${fmt(from, { day: 'numeric', month: 'long' })} – ${fmt(to, { day: 'numeric', month: 'long', year: 'numeric' })}`, { bold: true, size: 32, color: k.B, after: 120 }),
    state.settings.teacherName ? k.p(state.settings.teacherName + (state.settings.school ? ' · ' + state.settings.school : ''), { color: '555555', after: 200 }) : k.p('')];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const entries = diaryOn(d);
    const lessons = state.lessons.filter(l => l.date === d).sort((a, b) => P.findIndex(p => p.id === a.periodId) - P.findIndex(p => p.id === b.periodId));
    const evs = eventsOn(d).filter(e => !e.diaryId);
    if (!entries.length && !lessons.length && !evs.length) continue;
    kids.push(k.heading(fmtLong(d)));
    if (evs.length) kids.push(...k.bullets(evs.map(e => `${typeOf(e.type).label}: ${eventLabel(e)}`)));
    if (lessons.length) {
      const w = [900, 2800, 5660];
      kids.push(k.table(w, [k.row([k.cell('Period', { bold: true, fill: 'EEF2F0', w: w[0] }), k.cell('Class and topic', { bold: true, fill: 'EEF2F0', w: w[1] }), k.cell('How it went', { bold: true, fill: 'EEF2F0', w: w[2] })], { header: true }),
        ...lessons.map(l => k.row([k.cell('P' + (P.find(p => p.id === l.periodId)?.label ?? ''), { w: w[0] }), k.cell(`${classLabel(subjectById(l.subjectId), l.cls)}\n${l.title}${l.subtopic ? ' · ' + l.subtopic : ''}`, { w: w[1] }), k.cell(l.reflection || '', { w: w[2] })], { cantSplit: true }))]));
      kids.push(k.p('', { after: 60 }));
    }
    for (const e of entries) kids.push(k.p([k.run(`${kindOf(e.kind).label}${e.time ? ' · ' + e.time : ''}${e.kind === 'todo' ? (e.done ? ' (done)' : ' (to do)') : ''}: `, { bold: true }), k.run(e.text)], { after: 80 }));
  }
  if (kids.length <= 2) throw new Error('Nothing in the diary for that week yet.');
  await k.save(kids, `Diary ${from}`);
}
