// Today: one calm page with what you need this morning. Today's lessons, what's coming up,
// your to-dos, moderation deadlines, lab stock warnings and how far each class is this term.
import { state, onChange, subjectById, atpById, classLabel, saveLesson, saveDiary } from '../state.js';
import { h, icon } from '../ui.js';
import { today, addDays, fmt, termWeekOf, inTerm } from '../dates.js';
import { ttCellAt } from '../ttday.js';
import { isTeachingDay } from '../ttday.js';
import { periodBlocked, blockingEventFor, upcoming, eventLabel, typeOf, noticesDueSoon } from '../events.js';
import { openLesson } from './lesson.js';
import { openEvent } from './calendar.js';
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

function view() {
  const t = today();
  const tw = termWeekOf(t);
  const page = h('div', { class: 'page today-page' });
  page.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, greeting()),
      h('p', { class: 'muted' }, fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (tw && inTerm(t) ? ` · Term ${tw.term}, week ${tw.week}` : ' · School holiday'))),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn ghost', href: '#planner' }, icon('calendar', 16), 'Planner'),
      h('a', { class: 'btn ghost', href: '#diary/' + t }, icon('diary', 16), 'Diary'))));

  if (!state.subjects.length) {
    page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Getting started'),
      h('ol', { class: 'steps' },
        h('li', {}, h('a', { href: '#subjects' }, 'Add your subjects and upload the ATPs')),
        h('li', {}, h('a', { href: '#timetable' }, 'Upload or fill in your timetable')),
        h('li', {}, h('a', { href: '#planner' }, 'Auto-plan your first week in the planner')))));
  }

  const grid = h('div', { class: 'today-grid' });
  page.append(grid);

  // ----- Lessons -----
  const day = isTeachingDay(t) ? t : nextTeachingDay(addDays(t, 1));
  const lessonsCard = h('section', { class: 'card-sec today-lessons' },
    h('h2', {}, day === t ? 'Today’s lessons' : day ? `Next school day: ${fmt(day, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'Lessons'));
  if (!day) lessonsCard.append(h('p', { class: 'muted' }, 'No school days coming up in the next two months. Check your term dates in Settings.'));
  else lessonsCard.append(dayList(day));
  grid.append(lessonsCard);

  // ----- Needs preparing -----
  const soon = [];
  for (let d = addDays(day || t, 1), i = 0; i < 7; i++, d = addDays(d, 1)) soon.push(...state.lessons.filter(l => l.date === d && !l.done && !l.content && l.subjectId));
  const notReady = soon.sort((a, b) => a.date.localeCompare(b.date) || a.periodId.localeCompare(b.periodId)).slice(0, 8);

  // ----- Side column -----
  const side = h('div', { class: 'today-side' });
  grid.append(side);

  const evs = upcoming({ from: t, days: 7, limit: 8 });
  side.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Coming up this week'),
    evs.length ? h('ul', { class: 'today-list' }, ...evs.map(e => h('li', {},
      h('span', { class: 'when' }, e.date === t ? 'Today' : fmt(e.date, { weekday: 'short', day: 'numeric' })),
      h('button', { class: 'link', onclick: () => openEvent(e) }, h('span', { class: 'dot', style: { background: typeOf(e.type).colour } }), eventLabel(e)))))
      : h('p', { class: 'muted small' }, 'Nothing on the calendar for the next 7 days.'),
    h('a', { class: 'small', href: '#calendar' }, 'Open the school calendar')));

  const todos = state.diary.filter(d => d.kind === 'todo' && !d.done && d.date <= addDays(t, 7)).sort((a, b) => a.date.localeCompare(b.date));
  if (todos.length) side.append(h('section', { class: 'card-sec' }, h('h2', {}, 'To do'),
    h('ul', { class: 'today-list todos' }, ...todos.slice(0, 8).map(d => h('li', { class: d.date < t ? 'late' : '' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: async () => { d.done = true; await saveDiary(d); } }),
        h('span', {}, (d.text || '').split('\n')[0] || 'To do')),
      h('a', { class: 'when', href: '#diary/' + d.date }, d.date === t ? 'Today' : d.date < t ? 'Overdue' : fmt(d.date, { weekday: 'short', day: 'numeric' })))))));

  if (notReady.length) side.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Still to prepare'),
    h('p', { class: 'muted small' }, 'Coming lessons without a plan, slides or worksheet yet.'),
    h('ul', { class: 'today-list' }, ...notReady.map(l => h('li', {},
      h('span', { class: 'when' }, l.date === t ? 'Today' : fmt(l.date, { weekday: 'short', day: 'numeric' })),
      h('button', { class: 'link', onclick: () => openLesson(l.id) }, classLabel(subjectById(l.subjectId), l.cls) + ': ' + (l.title || atpById(l.atpId)?.topic || 'Lesson')))))));

  const nots = noticesDueSoon(14);
  if (nots.length) side.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Moderation'),
    h('ul', { class: 'today-list' }, ...nots.map(n => h('li', {}, h('a', { href: '#moderation' }, n.title), h('span', { class: 'muted small' }, dueText(n)))))));

  const al = stockAlerts();
  if (state.stock.length && (al.expired.length || al.soon.length || al.low.length)) {
    const bits = [al.expired.length && `${al.expired.length} expired`, al.soon.length && `${al.soon.length} expiring within 60 days`, al.low.length && `${al.low.length} low or out`].filter(Boolean);
    side.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Lab stock'),
      h('p', { class: al.expired.length ? 'bad' : 'warn' }, bits.join(' · ')),
      h('ul', { class: 'today-list' }, ...[...al.expired, ...al.soon, ...al.low].filter((x, i, a) => a.indexOf(x) === i).slice(0, 5).map(it => h('li', {}, it.name))),
      h('a', { class: 'small', href: '#stock' }, 'Open lab stock')));
  }

  // ----- Term progress -----
  if (tw && state.subjects.length) {
    const rows = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, p: progressFor(s, cls, tw.term, tw.week) }))).filter(r => r.p.total);
    if (rows.length) grid.append(h('section', { class: 'card-sec today-progress' }, h('h2', {}, `Term ${tw.term} so far`),
      h('div', { class: 'prog-rows' }, ...rows.map(({ s, cls, p }) => h('a', { class: 'prog-row', href: `#progress/${tw.term}` , style: { '--subj': s.colour } },
        h('span', { class: 'pr-name' }, classLabel(s, cls)),
        h('span', { class: 'bar' }, h('span', { style: { width: Math.round(100 * p.covered / p.total) + '%' } }), h('span', { class: 'due', style: { left: Math.round(100 * p.dueByNow / p.total) + '%' } })),
        h('span', { class: 'pr-note ' + (p.behind > 0 ? 'warn' : '') }, p.behind > 0 ? `${p.behind} topic${p.behind === 1 ? '' : 's'} behind` : 'On track')))),
      h('a', { class: 'small', href: `#progress/${tw.term}` }, 'See the full term report')));
  }
  return page;
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
