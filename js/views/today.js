// Today: one calm page with what you need this morning. Today's lessons, the month, what needs
// attention, your to-dos, what's coming up and how far each class is this term.
import { state, onChange, subjectById, atpById, classLabel, saveLesson, saveDiary } from '../state.js';
import { h, icon } from '../ui.js';
import { today, addDays, fmt, termWeekOf, inTerm, mondayOf, weekdayIndex } from '../dates.js';
import { ttCellAt, isTeachingDay, posLabel, ttDayFor } from '../ttday.js';
import { periodBlocked, blockingEventFor, upcoming, eventLabel, typeOf, noticesDueSoon, eventsOn, noTeachingOn } from '../events.js';
import { openLesson } from './lesson.js';
import { openEvent, editEvent } from './calendar.js';
import { openWeeklyPlanner } from './formats.js';
import { isUni } from '../edition.js';
import { dueText } from './notices.js';
import { stockAlerts } from './stock.js';
import { progressFor, classesOf } from './progress.js';

let rootEl = null;
export function renderToday(root) {
  rootEl = root;
  const off = onChange(w => { if (['lessons', 'events', 'diary', 'notices', 'stock', 'timetable', 'subjects', 'atp', 'settings'].includes(w)) draw(); });
  draw();
  return () => { off(); rootEl = null; };
}
function draw() { if (rootEl) rootEl.replaceChildren(view()); }

function nextTeachingDay(from) {
  for (let i = 0, d = from; i < 60; i++, d = addDays(d, 1)) if (isTeachingDay(d)) return d;
  return null;
}

function greeting() {
  const hr = new Date().getHours();
  const name = (state.settings.teacherName || '').trim();
  return (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + name : '');
}

// Laid out like the Skool Huis "Today" page: greeting and date, quick buttons, then a main column
// (today at a glance and the month) beside a column of boxes (what needs attention, to-dos, coming up).
let calMonth = null; // the month showing in the small calendar ('YYYY-MM')
function view() {
  const t = today();
  const tw = termWeekOf(t);
  const school = !isUni();
  const cyc = isTeachingDay(t) ? posLabel(ttDayFor(t)) : '';
  const dayNo = /^Day \d+/.exec(cyc)?.[0] || '';
  const page = h('div', { class: 'page today-page' });
  page.append(h('header', { class: 'today-top' },
    h('h1', {}, greeting()),
    h('p', { class: 'lede-small' }, [fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), tw && inTerm(t) ? `Term ${tw.term}, week ${tw.week}` : 'School holiday', dayNo].filter(Boolean).join(' · '))));

  page.append(h('nav', { class: 'quick', 'aria-label': 'Quick actions' },
    h('a', { class: 'quick-btn primary', href: '#planner' }, icon('calendar', 16), 'Planner'),
    h('a', { class: 'quick-btn', href: '#create' }, icon('pen', 16), school ? 'Make a test' : 'Create'),
    h('a', { class: 'quick-btn', href: '#diary/' + t }, icon('diary', 16), 'Diary note'),
    h('button', { class: 'quick-btn', onclick: () => editEvent({ date: t }) }, icon('plus', 16), 'Add event'),
    school ? h('button', { class: 'quick-btn', onclick: () => openWeeklyPlanner() }, icon('doc', 16), 'Weekly planner') : null));

  if (!state.subjects.length) {
    page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Getting started'),
      h('ol', { class: 'steps' },
        h('li', {}, h('a', { href: '#subjects' }, 'Add your subjects and upload the ATPs')),
        h('li', {}, h('a', { href: '#timetable' }, 'Upload or fill in your timetable')),
        h('li', {}, h('a', { href: '#planner' }, 'Auto-plan your first week in the planner')))));
  }

  const grid = h('div', { class: 'today-grid' });
  const main = h('div', { class: 'today-main' });
  const side = h('div', { class: 'today-side' });
  grid.append(main, side);
  page.append(grid);

  // ===== Main column =====
  const day = isTeachingDay(t) ? t : nextTeachingDay(addDays(t, 1));
  const dayLessons = day ? state.lessons.filter(l => l.date === day && l.subjectId) : [];
  const ready = dayLessons.filter(l => l.content).length, taught = dayLessons.filter(l => l.done).length;
  const label = day === t ? 'Lessons today' : day ? `Next school day · ${fmt(day, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'Lessons';
  main.append(h('a', { class: 'today-card', href: '#planner' + (day ? '/week/' + day : '') },
    h('span', { class: 'today-card-title' }, label),
    dayLessons.length
      ? h('span', {}, h('strong', {}, `${dayLessons.length} ${dayLessons.length === 1 ? 'lesson' : 'lessons'}`), ` · ${ready} ready · ${taught} taught`)
      : h('span', { class: 'muted' }, day ? 'Nothing planned yet' : 'No school days in the next two months'),
    dayLessons.length ? h('span', { class: 'reg-progress', 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(100 * Math.max(ready, taught) / dayLessons.length) + '%' } })) : null));

  const lessonsCard = h('section', { class: 'today-box today-lessons' }, h('h2', {}, day === t ? 'Today’s lessons' : 'Lessons'));
  if (!day) lessonsCard.append(h('p', { class: 'muted' }, 'No school days coming up in the next two months. Check your term dates in Settings.'));
  else lessonsCard.append(dayList(day));
  main.append(lessonsCard);
  main.append(attentionBox(t, day, tw, school));
  main.append(todoBox(t));
  main.append(monthBox(t, tw));

  // ===== Side column =====

  const evs = upcoming({ from: addDays(t, 1), days: 7, limit: 8 });
  side.append(h('section', { class: 'today-box' }, h('h2', {}, 'Coming up'),
    evs.length ? h('ul', { class: 'today-list' }, ...evs.map(e => h('li', {},
      h('span', { class: 'when' }, fmt(e.date, { weekday: 'short', day: 'numeric' })),
      h('button', { class: 'link', onclick: () => openEvent(e) }, h('span', { class: 'dot', style: { background: typeOf(e.type).colour } }), eventLabel(e)))))
      : h('p', { class: 'muted small' }, 'Nothing on the calendar for the next 7 days.'),
    h('a', { class: 'small', href: '#calendar' }, school ? 'Open the school calendar' : 'Open the calendar')));

  if (tw && state.subjects.length) {
    const rows = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, p: progressFor(s, cls, tw.term, tw.week) }))).filter(r => r.p.total);
    if (rows.length) side.append(h('section', { class: 'today-box today-progress' }, h('h2', {}, `Term ${tw.term} so far`),
      h('div', { class: 'prog-rows' }, ...rows.map(({ s, cls, p }) => h('a', { class: 'prog-row', href: `#progress/${tw.term}`, style: { '--subj': s.colour } },
        h('span', { class: 'pr-name' }, classLabel(s, cls)),
        h('span', { class: 'bar' }, h('span', { style: { width: Math.round(100 * p.covered / p.total) + '%' } }), h('span', { class: 'due', style: { left: Math.round(100 * p.dueByNow / p.total) + '%' } })),
        h('span', { class: 'pr-note ' + (p.behind > 0 ? 'warn' : '') }, p.behind > 0 ? `${p.behind} behind` : 'On track')))),
      h('a', { class: 'small', href: `#progress/${tw.term}` }, 'See the full term report')));
  }
  return page;
}

// What needs doing, most urgent first. Everything links to where it gets done.
function attentionBox(t, day, tw, school) {
  const items = [];
  const late = state.diary.filter(d => d.kind === 'todo' && !d.done && d.date < t);
  if (late.length) items.push({ urgent: true, node: h('a', { href: '#diary/list' }, `${late.length} ${late.length === 1 ? 'to-do is' : 'to-dos are'} overdue`) });
  const notToday = day === t ? state.lessons.filter(l => l.date === t && l.subjectId && !l.content && !l.done) : [];
  for (const l of notToday.slice(0, 3)) items.push({ urgent: true, node: h('button', { class: 'link', onclick: () => openLesson(l.id) }, `Today: ${classLabel(subjectById(l.subjectId), l.cls)} isn’t prepared yet`) });
  const soon = [];
  for (let d = addDays(day || t, 1), i = 0; i < 7; i++, d = addDays(d, 1)) soon.push(...state.lessons.filter(l => l.date === d && !l.done && !l.content && l.subjectId));
  soon.sort((a, b) => a.date.localeCompare(b.date) || a.periodId.localeCompare(b.periodId));
  for (const l of soon.slice(0, 3)) items.push({ node: h('button', { class: 'link', onclick: () => openLesson(l.id) }, `Prepare ${classLabel(subjectById(l.subjectId), l.cls)} for ${fmt(l.date, { weekday: 'short', day: 'numeric' })}: ${l.title || atpById(l.atpId)?.topic || 'lesson'}`) });
  if (soon.length > 3) items.push({ node: h('a', { href: '#planner' }, `${soon.length - 3} more lessons this week still to prepare`) });
  if (school) {
    for (const n of noticesDueSoon(14)) items.push({ urgent: n.due && n.due <= addDays(t, 3), node: h('span', {}, h('a', { href: '#moderation' }, n.title), ' ', h('span', { class: 'muted small' }, dueText(n))) });
    const al = stockAlerts();
    if (state.stock.length) {
      if (al.expired.length) items.push({ urgent: true, node: h('a', { href: '#stock' }, `${al.expired.length} lab ${al.expired.length === 1 ? 'item has' : 'items have'} expired: ${al.expired.slice(0, 3).map(x => x.name).join(', ')}`) });
      const low = al.low.filter(x => !al.expired.includes(x));
      if (low.length) items.push({ node: h('a', { href: '#stock' }, `${low.length} lab ${low.length === 1 ? 'item is' : 'items are'} low or out: ${low.slice(0, 3).map(x => x.name).join(', ')}`) });
      if (al.soon.length) items.push({ node: h('a', { href: '#stock' }, `${al.soon.length} lab ${al.soon.length === 1 ? 'item expires' : 'items expire'} within 60 days`) });
    }
  }
  if (tw && state.subjects.length) {
    const behind = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, p: progressFor(s, cls, tw.term, tw.week) }))).filter(r => r.p.total && r.p.behind > 1);
    for (const r of behind.slice(0, 3)) items.push({ node: h('a', { href: `#progress/${tw.term}` }, `${classLabel(r.s, r.cls)} is ${r.p.behind} topics behind the ATP`) });
  }
  return h('section', { class: 'today-box' }, h('h2', {}, 'Needs attention'),
    items.length ? h('ul', { class: 'attention' }, items.map(i => h('li', { class: i.urgent ? 'urgent' : '' }, i.node))) : h('p', { class: 'muted' }, 'All clear.'));
}

function todoBox(t) {
  const todos = state.diary.filter(d => d.kind === 'todo' && !d.done && d.date <= addDays(t, 14)).sort((a, b) => a.date.localeCompare(b.date));
  const inp = h('input', { placeholder: 'Add a to-do, e.g. Phone 10A parents', 'aria-label': 'New to-do' });
  const when = h('input', { type: 'date', value: t, 'aria-label': 'Date for the to-do' });
  const add = async () => { const text = inp.value.trim(); if (!text) { inp.focus(); return; } await saveDiary({ date: when.value || t, kind: 'todo', text, done: false }); };
  inp.onkeydown = e => { if (e.key === 'Enter') add(); };
  return h('section', { class: 'today-box' }, h('h2', {}, 'To do'),
    h('div', { class: 'todo-add' }, inp, h('div', { class: 'row' }, when, h('button', { class: 'btn ghost sm', onclick: add }, 'Add'))),
    todos.length ? h('ul', { class: 'today-list todos' }, ...todos.slice(0, 8).map(d => h('li', { class: d.date < t ? 'late' : '' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: async () => { d.done = true; await saveDiary(d); } }),
        h('span', {}, (d.text || '').split('\n')[0] || 'To do')),
      h('a', { class: 'when', href: '#diary/' + d.date }, d.date === t ? 'Today' : d.date < t ? 'Overdue' : fmt(d.date, { weekday: 'short', day: 'numeric' })))))
      : h('p', { class: 'muted small' }, 'Nothing to do. Add one above, or in the Diary.'),
    todos.length > 8 ? h('a', { class: 'small', href: '#diary/list' }, `${todos.length - 8} more in the Diary`) : null);
}

// A small month calendar with the events on it, and today's events underneath.
function monthBox(t, tw) {
  const box = h('section', { class: 'today-box month-box' });
  const draw = () => {
    const m = calMonth || t.slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const first = `${m}-01`;
    const start = mondayOf(first);
    const shift = n => { const d = new Date(y, mo - 1 + n, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; draw(); };
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (i >= 35 && d.slice(0, 7) !== m) break;
      const evs = eventsOn(d);
      const wk = weekdayIndex(d) >= 5;
      cells.push(h('a', { class: ['mc-day', d.slice(0, 7) !== m ? 'out' : '', d === t ? 'today' : '', (!inTerm(d) || noTeachingOn(d)) && !wk ? 'off' : '', wk ? 'wkend' : ''].filter(Boolean).join(' '), href: '#calendar/' + d, 'aria-label': fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (evs.length ? ': ' + evs.map(e => e.title).join(', ') : '') },
        h('span', { class: 'mc-n' }, String(+d.slice(8))),
        ...evs.slice(0, 2).map(e => h('span', { class: 'mc-ev', style: { background: typeOf(e.type).colour } }, e.title)),
        evs.length > 2 ? h('span', { class: 'mc-more' }, `+${evs.length - 2}`) : null));
    }
    const todays = eventsOn(t);
    box.replaceChildren(
      h('div', { class: 'mc-head' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left', 16)),
        h('h2', {}, new Date(y, mo - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('right', 16)),
        h('a', { class: 'small mc-full', href: '#calendar' + (calMonth ? '/' + calMonth + '-01' : '') }, 'Full calendar')),
      h('div', { class: 'mc-grid' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('span', { class: 'mc-wd' }, d)), cells),
      h('div', { class: 'mc-today' },
        h('div', { class: 'row between' }, h('span', {}, h('strong', {}, 'Today'), tw && inTerm(t) ? h('span', { class: 'muted small' }, ` · Term ${tw.term}, week ${tw.week}`) : null),
          h('button', { class: 'btn ghost sm', onclick: () => editEvent({ date: t }) }, 'Add event')),
        todays.length ? h('ul', { class: 'mc-list' }, todays.map(e => h('li', {},
          h('span', { class: 'mc-time' }, e.time || 'All day'),
          h('button', { class: 'link', onclick: () => openEvent(e) }, h('span', { class: 'dot', style: { background: typeOf(e.type).colour } }), e.title),
          h('span', { class: 'muted small' }, typeOf(e.type).label.split(' (')[0])))) : h('p', { class: 'muted small' }, 'Nothing on the calendar today.')));
  };
  draw();
  return box;
}

function dayList(day) {
  const ul = h('ol', { class: 'today-day' });
  const now = new Date(); const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const p of state.timetable.periods) {
    const lessons = state.lessons.filter(l => l.date === day && l.periodId === p.id);
    const blocked = periodBlocked(day, p.id);
    const cell = blocked ? null : ttCellAt(day, p.id);
    const s = cell && subjectById(cell.subjectId);
    if (!lessons.length && !s && !blocked) continue;
    const isNow = day === today() && p.start && p.end && hm >= p.start && hm < p.end;
    const li = h('li', { class: (isNow ? 'now ' : '') + (blocked ? 'lost' : '') },
      h('span', { class: 'per' }, h('b', {}, 'P' + p.label), h('span', { class: 'muted small' }, p.start || '')));
    const body = h('div', { class: 'what' });
    if (blocked && !lessons.length) body.append(h('span', { class: 'muted' }, blockingEventFor(day, p.id)?.title || 'No teaching'));
    for (const l of lessons) {
      const ls = subjectById(l.subjectId); const a = atpById(l.atpId);
      body.append(h('div', { class: 'td-lesson', style: { '--subj': ls?.colour || '#777' } },
        h('button', { class: 'link td-title', onclick: () => openLesson(l.id) },
          h('span', { class: 'td-cls' }, classLabel(ls, l.cls)), h('span', {}, l.title || a?.topic || 'Lesson'),
          l.subtopic ? h('span', { class: 'muted small' }, l.subtopic) : null),
        h('span', { class: 'td-flags' }, l.content ? h('span', { class: 'tag ok' }, 'Ready') : h('span', { class: 'tag' }, 'Not prepared')),
        h('button', { class: 'tick', 'aria-pressed': String(!!l.done), title: l.done ? 'Taught. Tap to undo.' : 'Mark as taught', 'aria-label': (l.done ? 'Taught: undo ' : 'Mark as taught: ') + (l.title || ''), onclick: async () => { l.done = !l.done; await saveLesson(l); } }, icon('check', 14))));
    }
    if (!lessons.length && s) body.append(h('span', { class: 'td-empty' }, classLabel(s, cell.cls), h('a', { class: 'small', href: '#planner' }, 'Nothing planned yet')));
    li.append(body);
    ul.append(li);
  }
  if (!ul.children.length) return h('p', { class: 'muted' }, 'No lessons on your timetable for this day.');
  return ul;
}
