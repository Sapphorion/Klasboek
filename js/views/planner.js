// Week planner: timetable periods × school days, ATP topics to drag in, lessons to open.
import { state, onChange, subjectById, atpById, saveLesson, saveLessons, deleteLesson, subjectLabel, saveTimetable, saveSettings, saveAtpItem, classLabel, diaryOn } from '../state.js';
import { h, icon, toast, confirmBox } from '../ui.js';
import { today, mondayOf, addDays, fmt, termWeekOf, mondayOfTermWeek, termWeeks, inTerm, weekdayIndex, cycleWeekOf, cycleLetter, cellsFor } from '../dates.js';
import { exportWeekPlanDocx } from '../exporters.js';
import { openLesson } from './lesson.js';
import { eventsOn, noTeachingOn, assessmentsForLesson, upcoming, typeOf, eventLabel, noticesDueSoon, periodBlocked, blockingEventFor } from '../events.js';
import { editEvent, openEvent } from './calendar.js';
import { dueText } from './notices.js';
import { openTermPlanUpload } from './termplan.js';
import { ttCellAt, ttDayFor, posLabel, changedOn, swapsOn } from '../ttday.js';
import { openTtChanges } from './ttchanges.js';
import { openTell } from './tellbox.js';
import { openDayMenu } from './daymenu.js';
import { openTidy, findProblems } from './tidy.js';
import { partsOf } from './lesson.js';
import { markDone } from '../adjust.js';

let weekStart = mondayOf(today());
let trayScope = 'week';      // 'week' | 'term'
let traySubject = '';        // filter
let picked = null;           // tap-to-place: { atpId } or { lessonId }

let showDone = false;        // show topics marked "done already" in the tray

let rootEl = null;
// #planner, #planner/week/DATE (old #planner/month links go to the calendar)
export function renderPlanner(root, [mode, date] = []) {
  if (mode === 'month') { location.replace('#calendar' + (date ? '/' + date : '')); return null; }
  rootEl = root;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) weekStart = mondayOf(date);
  const off = onChange(w => { if (['lessons', 'atp', 'subjects', 'timetable', 'settings', 'materials', 'events', 'notices', 'diary'].includes(w)) rerender(); });
  rerender();
  return () => { off(); rootEl = null; };
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function weekDays() {
  return state.timetable.days.map((label, i) => ({ label, date: addDays(weekStart, Math.max(0, WEEK.indexOf(label))), i }));
}
const dayIdxOf = date => state.timetable.days.indexOf(WEEK[weekdayIndex(date)]);
const cellKey = (dayIdx, pid) => `${dayIdx}|${pid}`;

function moreMenu(tw, days) {
  const item = (ic, label, fn) => h('button', { role: 'menuitem', onclick: e => { e.target.closest('details').open = false; fn(); } }, icon(ic, 18), label);
  return h('details', { class: 'more-menu' },
    h('summary', { class: 'btn ghost', 'aria-label': 'More planner options' }, icon('grid'), 'More'),
    h('div', { class: 'more-list', role: 'menu' },
      item('swap', 'Timetable changes and period swaps', () => openTtChanges(weekStart)),
      item('upload', 'Upload a term plan', () => openTermPlanUpload(tw?.term)),
      item('month', 'Upload year planner or test timetable', () => { location.hash = 'calendar/' + weekStart; }),
      item('swap', 'Google or Outlook calendar', () => import('./extcal.js').then(x => x.openExternalCalendars())),
      item('check', 'Check grades and colours', openTidy),
      item('download', 'Download week plan (.docx)', () => exportWeekPlanDocx(weekStart, days).catch(e => toast(e.message, 'error'))),
    ));
}

function view() {
  const tw = termWeekOf(weekStart) || termWeekOf(addDays(weekStart, 4));
  const days = weekDays();
  const wrap = h('div', { class: 'planner' + (state.settings.plannerLook === 'colour' ? '' : ' calm') });
  if (!state.settings.onboarded) wrap.append(onboarding());

  // ---------- Toolbar ----------
  const termLabel = tw ? `Term ${tw.term}, week ${tw.week}` : 'School holiday';
  wrap.append(h('div', { class: 'toolbar' },
    h('div', { class: 'week-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous week', onclick: () => { weekStart = addDays(weekStart, -7); rerender(); } }, icon('left')),
      h('div', { class: 'week-title' }, h('h1', {}, termLabel), h('span', { class: 'muted' }, `${fmt(days[0].date)} – ${fmt(days.at(-1).date, { day: 'numeric', month: 'short', year: 'numeric' })}`)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next week', onclick: () => { weekStart = addDays(weekStart, 7); rerender(); } }, icon('right')),
      cycleBadge(tw),
      weekStart !== mondayOf(today()) ? h('button', { class: 'btn ghost sm', onclick: () => { weekStart = mondayOf(today()); rerender(); } }, 'This week') : null,
      termJump(tw),
    ),
    h('div', { class: 'row wrap' },
      h('a', { class: 'btn ghost', href: '#calendar/' + weekStart }, icon('month'), 'Calendar'),
      h('button', { class: 'btn', onclick: () => openTell(weekStart, days), title: 'Say what’s different this week, e.g. “Wednesday prize giving”' }, icon('pen'), 'Tell the planner'),
      h('button', { class: 'btn ghost', onclick: autoPlan, title: 'Place this week’s ATP topics into your timetable slots' }, icon('wand'), 'Auto-plan week'),
      moreMenu(tw, days),
    ),
  ));

  wrap.append(tidyBanner(), weekStrip());
  if (picked) wrap.append(h('div', { class: 'picked-bar', role: 'status' }, 'Tap an empty period to place ', h('strong', {}, pickedLabel()), '.', h('button', { class: 'btn ghost sm', onclick: () => { picked = null; rerender(); } }, 'Cancel')));

  // ---------- Grid ----------
  // Default: days down the side, periods across the top. The other way round is one tap away.
  const rows = (state.settings.plannerLayout || 'days-rows') === 'days-rows';
  const periods = state.timetable.periods;
  const grid = h('div', {
    class: 'week-grid ' + (rows ? 'rows' : 'cols'), role: 'grid', 'aria-label': 'Week timetable',
    style: { gridTemplateColumns: rows ? `11rem repeat(${periods.length}, minmax(8rem, 1fr))` : `4.5rem repeat(${days.length}, minmax(9rem, 1fr))`,
      // As wide as all its columns, so the white page carries on when you scroll sideways.
      minWidth: rows ? `calc(11rem + ${periods.length} * 8rem + 2px)` : `calc(4.5rem + ${days.length} * 9rem + 2px)` },
  });
  const dayHead = d => {
    const isToday = d.date === today();
    const evs = eventsOn(d.date);
    const blocked = noTeachingOn(d.date);
    return h('div', { class: 'day-head' + (isToday ? ' today' : '') + (blocked ? ' blocked' : ''), role: rows ? 'rowheader' : 'columnheader' },
      h('button', { class: 'dh-top', title: 'Change this day: no school, lost periods, a test, a note…', 'aria-label': `${d.label} ${fmt(d.date)}. Change this day`, onclick: () => openDayMenu(d.date, weekStart) },
        h('strong', {}, d.label), h('span', {}, fmt(d.date)), h('span', { class: 'dh-edit', 'aria-hidden': 'true' }, icon('pen', 13))),
      (() => {
        const pos = ttDayFor(d.date);
        const changed = changedOn(d.date);
        if (!pos || (!changed && (state.timetable.cycle || 1) < 2)) return null;
        const sw = swapsOn(d.date).length;
        return h('button', { class: 'tt-day-label' + (changed ? ' changed' : ''), title: 'Timetable changes', onclick: () => openTtChanges(weekStart) },
          (changed && pos.source ? 'Follows ' : '') + posLabel(pos) + (sw ? ` · ${sw} swap${sw > 1 ? 's' : ''}` : ''));
      })(),
      (() => { const n = diaryOn(d.date).length; return n ? h('a', { class: 'dh-diary', href: '#diary/' + d.date, title: 'Diary for this day' }, icon('diary', 13), `${n} diary entr${n > 1 ? 'ies' : 'y'}`) : null; })(),
      evs.length ? h('div', { class: 'day-events' }, evs.slice(0, 3).map(e => h('button', { class: 'pill', style: { '--c': typeOf(e.type).colour }, title: eventLabel(e), onclick: () => openEvent(e) }, h('span', {}, e.title))),
        evs.length > 3 ? h('button', { class: 'more', onclick: () => openDayMenu(d.date, weekStart) }, `+${evs.length - 3}`) : null) : null);
  };
  const periodHead = p => h('div', { class: 'period-head', role: rows ? 'columnheader' : 'rowheader' }, h('strong', {}, p.label), p.start ? h('span', {}, p.start + (rows && p.end ? '–' + p.end : '')) : null);
  grid.append(h('div', { class: 'corner' }, rows ? h('button', { class: 'rotate', title: 'Show days across the top', 'aria-label': 'Show days across the top', onclick: () => saveSettings({ plannerLayout: 'days-cols' }) }, icon('swap', 16)) : h('button', { class: 'rotate', title: 'Show days down the side', 'aria-label': 'Show days down the side', onclick: () => saveSettings({ plannerLayout: 'days-rows' }) }, icon('swap', 16))));
  if (rows) {
    periods.forEach(p => grid.append(periodHead(p)));
    for (const d of days) { grid.append(dayHead(d)); for (const p of periods) grid.append(slot(d, p)); }
  } else {
    days.forEach(d => grid.append(dayHead(d)));
    for (const p of periods) { grid.append(periodHead(p)); for (const d of days) grid.append(slot(d, p)); }
  }
  if (!state.timetable.periods.length) grid.append(h('p', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'Add your periods on the Timetable page first.'));

  wrap.append(h('div', { class: 'planner-body' + ((state.settings.plannerLayout || 'days-rows') === 'days-rows' ? ' rows' : '') }, h('div', { class: 'grid-scroll' }, grid), tray(tw)));
  return wrap;
}

function rerender() {
  if (!rootEl) return;
  const sc = rootEl.querySelector('.grid-scroll')?.scrollLeft || 0;
  rootEl.replaceChildren(view());
  const g = rootEl.querySelector('.grid-scroll'); if (g) g.scrollLeft = sc;
}

function tidyBanner() {
  const p = findProblems({ lessonsInPlace: false });
  const n = p.noGrade.length + p.wrong.length + p.clash.length;
  if (!n) return h('span');
  const what = [p.wrong.length || p.noGrade.length ? 'some classes are filed under the wrong grade' : '', p.clash.length ? 'some subjects share a colour' : ''].filter(Boolean).join(' and ');
  return h('div', { class: 'notice-banner tidy-banner', role: 'status' }, icon('flag', 18),
    h('div', {}, h('strong', {}, 'Grades or colours mixed up'), h('span', {}, `It looks like ${what}.`)),
    h('button', { class: 'btn sm', onclick: openTidy }, 'Check and fix'));
}

// This week and next week at a glance: tests, deadlines, events, moderation.
function weekStrip() {
  const col = (label, from) => {
    const list = upcoming({ from, days: 6, limit: 8 }).filter(e => (e.endDate || e.date) >= from);
    return h('div', { class: 'ws-col' }, h('h3', {}, label),
      list.length ? h('ul', {}, list.map(e => h('li', {},
        h('button', { class: 'ev-chip', style: { '--c': typeOf(e.type).colour }, title: typeOf(e.type).label, onclick: () => e.notice ? location.hash = 'moderation/notice/' + e.notice : openEvent(e) },
          h('span', { class: 'when' }, e.date < from ? 'Ongoing' : fmt(e.date, { weekday: 'short', day: 'numeric' })),
          h('span', {}, e.title, e.notes && e.notice ? h('span', { class: 'muted' }, ' · ' + e.notes) : null))))) :
        h('p', { class: 'muted small' }, 'Nothing on the calendar.'));
  };
  return h('section', { class: 'week-strip', 'aria-label': 'What’s coming' },
    col(weekStart === mondayOf(today()) ? 'This week' : `Week of ${fmt(weekStart)}`, weekStart),
    col('Next week', addDays(weekStart, 7)),
    h('button', { class: 'ws-add btn ghost sm', onclick: () => editEvent({ date: weekStart < today() && today() < addDays(weekStart, 7) ? today() : weekStart, type: 'test' }) }, icon('plus', 16), 'Test or deadline'));
}

function cycleBadge(tw) {
  if ((state.timetable.cycle || 1) < 2 || !tw) return null;
  const w = (ttDayFor(addDays(weekStart, 1)) || ttDayFor(weekStart) || { week: cycleWeekOf(addDays(weekStart, 1)) }).week;
  const other = cycleLetter(3 - w);
  return h('button', {
    class: 'cycle-badge', 'data-week': cycleLetter(w), title: `Tap if this should be Week ${other}`,
    'aria-label': `Week ${cycleLetter(w)} of your two-week timetable. Tap to make this Week ${other}.`,
    onclick: async () => {
      await saveTimetable({ cycleOffset: 1 - (state.timetable.cycleOffset || 0) });
      toast(`This week is now Week ${other}. The weeks after it have swapped too.`);
    },
  }, `Week ${cycleLetter(w)}`);
}

function termJump(tw) {
  // Every school week of the year, grouped by term, so any week is one tap away.
  const sel = h('select', { class: 'sm week-pick', 'aria-label': 'Choose a week', onchange: () => { if (sel.value) { weekStart = sel.value; rerender(); } } });
  if (!tw) sel.append(h('option', { value: '', selected: true }, 'Holiday · choose a week'));
  [1, 2, 3, 4].forEach(t => {
    const n = termWeeks(t);
    if (!n) return;
    sel.append(h('optgroup', { label: `Term ${t}` }, Array.from({ length: n }, (_, i) => {
      const mon = mondayOfTermWeek(t, i + 1);
      const isNow = mon === mondayOf(today());
      return h('option', { value: mon, selected: mon === weekStart }, `Term ${t}, week ${i + 1} · ${fmt(mon)}–${fmt(addDays(mon, 4))}${isNow ? ' (this week)' : ''}`);
    })));
  });
  return sel;
}

function slot(d, p) {
  const closed = periodBlocked(d.date, p.id);
  const ttCell = closed ? null : ttCellAt(d.date, p.id);
  const ttSubj = ttCell && subjectById(ttCell.subjectId);
  const lessons = state.lessons.filter(l => l.date === d.date && l.periodId === p.id);
  const school = inTerm(d.date);
  const el = h('div', {
    class: 'slot' + (school ? '' : ' holiday') + (closed ? ' no-teach' : '') + (ttSubj ? ' expected' : ''),
    role: 'gridcell', 'data-date': d.date, 'data-period': p.id, tabindex: lessons.length ? -1 : 0,
    style: ttSubj ? { '--subj': ttSubj.colour } : {},
    'aria-label': `${d.label} period ${p.label}${ttSubj ? ', ' + classLabel(ttSubj, ttCell.cls) : ''}${lessons.length ? '' : ', empty'}`,
  });
  if (ttSubj && !lessons.length) el.append(h('span', { class: 'expect' }, classLabel(ttSubj, ttCell.cls)));
  if (closed && !lessons.length) { const ev = blockingEventFor(d.date, p.id); if (ev && !ev.noTeaching) el.append(h('span', { class: 'expect lost' }, ev.title)); }
  if (!school && !lessons.length && !ttSubj) el.append(h('span', { class: 'expect' }, ''));
  for (const l of lessons) el.append(lessonChip(l));
  el.addEventListener('click', e => { if (e.target === el || e.target.classList.contains('expect')) placePicked(d.date, p.id); });
  el.addEventListener('dblclick', async e => {
    if (lessons.length || picked) return;
    const sid = ttCell?.subjectId || state.subjects[0]?.id || '';
    const l = await saveLesson({ date: d.date, periodId: p.id, subjectId: sid, atpId: '', title: 'New lesson', cls: ttCell?.cls || '', notes: '', content: null, materialIds: [], done: false });
    openLesson(l.id);
  });
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); placePicked(d.date, p.id); } });
  return el;
}

function lessonChip(l) {
  const s = subjectById(l.subjectId);
  const a = atpById(l.atpId);
  const hasContent = !!l.content;
  const chip = h('div', {
    class: 'lesson' + (l.done ? ' done' : ''), 'data-lesson': l.id, tabindex: 0, role: 'button',
    style: { '--subj': s?.colour || '#777' }, 'aria-label': `${classLabel(s, l.cls)}: ${l.title || a?.topic || ''}. Open lesson.`,
  },
    h('span', { class: 'l-subj' }, classLabel(s, l.cls)),
    h('span', { class: 'l-title' }, l.title || a?.topic || 'Untitled'),
    l.subtopic ? h('span', { class: 'l-sub', title: l.subtopic }, l.subtopic) : null,
    h('span', { class: 'l-flags' }, hasContent ? h('span', { class: 'flag', title: 'Materials ready' }, icon('doc', 12), l.content.source === 'ai' ? 'AI' : 'Draft') : null, l.materialIds?.length ? h('span', { class: 'flag', title: 'Attached files' }, icon('clip', 12), l.materialIds.length) : null, l.done ? h('span', { class: 'flag' }, icon('check', 12), 'Taught') : null, ...assessmentsForLesson(l).slice(0, 1).map(e => h('span', { class: 'flag assess', title: eventLabel(e) }, icon('flag', 12), e.type === 'exam' ? 'Exam' : 'Test'))),
  );
  if (l.date) chip.append(h('button', { class: 'tick no-drag', 'aria-pressed': String(!!l.done), title: l.done ? 'Taught. Tap to undo.' : 'Mark as taught', 'aria-label': (l.done ? 'Taught: undo ' : 'Mark as taught: ') + (l.title || ''),
    onclick: async e => { e.stopPropagation(); l.done = !l.done; await saveLesson(l); } }, icon('check', 14)));
  makeDraggable(chip, { lessonId: l.id });
  chip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLesson(l.id); }
    if (e.key === 'm' || e.key === 'M') { picked = { lessonId: l.id }; rerender(); }
  });
  return chip;
}

// ---------- Tray of ATP topics ----------
function tray(tw) {
  const box = h('aside', { class: 'tray', 'aria-label': 'ATP topics to plan' });
  const subjects = state.subjects;
  box.append(h('div', { class: 'tray-head' },
    h('h2', {}, 'To plan'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Show topics for' },
      h('button', { 'aria-pressed': String(trayScope === 'week'), onclick: () => { trayScope = 'week'; rerender(); } }, 'This week'),
      h('button', { 'aria-pressed': String(trayScope === 'term'), onclick: () => { trayScope = 'term'; rerender(); } }, 'Whole term')),
    subjects.length > 1 ? h('select', { class: 'sm', 'aria-label': 'Subject', onchange: e => { traySubject = e.target.value; rerender(); } },
      h('option', { value: '' }, 'All subjects'), subjects.map(s => h('option', { value: s.id, selected: s.id === traySubject }, subjectLabel(s)))) : null,
  ));
  const waiting = state.lessons.filter(l => !l.date && !l.done);
  if (waiting.length) box.append(h('div', { class: 'needs-period' },
    h('h3', {}, `Needs a period (${waiting.length})`),
    h('p', { class: 'muted small' }, 'These were moved off when teaching time was lost and didn’t fit before the end of term. Drag one onto a period.'),
    h('div', { class: 'np-list' }, waiting.map(lessonChip))));
  const list = h('div', { class: 'tray-list', 'data-tray': '1' });
  if (!subjects.length) list.append(h('p', { class: 'empty' }, 'Add a subject and upload its ATP to see topics here. ', h('a', { href: '#subjects' }, 'Add a subject')));
  else if (!tw) list.append(h('p', { class: 'empty' }, 'This week is a school holiday. Use Jump to choose a term.'));
  else {
    const all = state.atp.filter(a => (!traySubject || a.subjectId === traySubject) && a.term === tw.term && (trayScope === 'term' || (tw.week >= a.week && tw.week <= (a.weekEnd || a.week))));
    const doneN = all.filter(a => a.done).length;
    const items = showDone ? all : all.filter(a => !a.done);
    if (doneN) list.append(h('button', { class: 'link small done-toggle', onclick: () => { showDone = !showDone; rerender(); } }, showDone ? `Hide ${doneN} done already` : `${doneN} done already · show`));
    if (!items.length && doneN && !showDone) list.append(h('p', { class: 'empty' }, trayScope === 'week' ? 'Everything for this week is done already. Auto-plan will carry on with the next topics, or choose Whole term.' : 'Everything this term is done already.'));
    else if (!items.length) list.append(h('p', { class: 'empty' }, trayScope === 'week' ? `No ATP topics for term ${tw.term} week ${tw.week}. Try Whole term, or check the ATP on the Subjects page.` : 'No ATP topics for this term yet.'));
    for (const a of items) list.append(atpCard(a, tw));
  }
  box.append(list, h('p', { class: 'tray-tip muted' }, 'Drag a topic onto a period, or tap it and then tap a period. Double-click an empty period for a lesson that isn’t in the ATP. Drag a lesson back here to unplan it.'));
  return box;
}

function atpCard(a, tw) {
  const s = subjectById(a.subjectId);
  const planned = state.lessons.filter(l => l.atpId === a.id && l.date).length;
  const card = h('div', { class: 'card' + (picked?.atpId === a.id ? ' picked' : '') + (a.done ? ' is-done' : ''), 'data-atp': a.id, tabindex: 0, role: 'button', style: { '--subj': s?.colour || '#777' }, 'aria-label': `${s?.name}: ${a.topic}. ${planned} lessons planned. Press Enter to pick up.` },
    h('div', { class: 'c-top' }, h('span', { class: 'c-subj' }, subjectLabel(s)), h('span', { class: 'c-week' }, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}`)),
    h('div', { class: 'c-topic' }, a.topic),
    a.details ? h('div', { class: 'c-details' }, a.details.split('\n').slice(0, 2).join(' · ')) : null,
    h('div', { class: 'c-foot' },
      h('span', { class: 'c-count' + (planned ? ' has' : '') }, a.done ? 'Done already' : planned ? `${planned} lesson${planned > 1 ? 's' : ''} planned` : 'Not planned yet'),
      a.done
        ? h('button', { class: 'c-act no-drag', onclick: () => setTopicDone(a, false) }, 'Not done')
        : h('button', { class: 'c-act no-drag', title: 'Covered already (e.g. revision done earlier). Its lessons come off the plan and the next ones move up.', onclick: () => setTopicDone(a, true) }, icon('check', 14), 'Done already')),
  );
  makeDraggable(card, { atpId: a.id });
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picked = picked?.atpId === a.id ? null : { atpId: a.id }; rerender(); } });
  return card;
}

async function setTopicDone(a, done) {
  if (!done) { a.done = false; await saveAtpItem(a); toast(`“${a.topic}” is back in the list to plan.`); return; }
  const lessons = state.lessons.filter(l => l.atpId === a.id && !l.done);
  a.done = true; await saveAtpItem(a);
  const onUndo = async () => { a.done = false; await saveAtpItem(a); };
  if (lessons.length) await markDone(lessons, { label: `“${a.topic}” done already`, onUndo });
  else toast(`“${a.topic}” marked as done already. Auto-plan will skip it.`, 'ok', { action: { label: 'Undo', run: async () => { await onUndo(); toast('Undone.'); } } });
}

function pickedLabel() {
  if (picked?.atpId) return atpById(picked.atpId)?.topic || 'topic';
  if (picked?.lessonId) { const l = state.lessons.find(x => x.id === picked.lessonId); return l?.title || 'lesson'; }
  return '';
}

// ---------- Drag and drop (pointer events: works with mouse, pen and touch) ----------
function makeDraggable(el, payload) {
  let start = null, ghost = null, over = null, pid = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.no-drag')) return;
    start = { x: e.clientX, y: e.clientY }; pid = e.pointerId;
  });
  el.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== pid) return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (!ghost && dist > 6) {
      el.setPointerCapture(pid);
      const r = el.getBoundingClientRect();
      ghost = el.cloneNode(true); ghost.classList.add('drag-ghost');
      Object.assign(ghost.style, { width: r.width + 'px', left: 0, top: 0 });
      document.body.append(ghost); el.classList.add('dragging'); document.body.classList.add('is-dragging');
    }
    if (ghost) {
      e.preventDefault();
      ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 16}px) rotate(-1.5deg)`;
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.slot, [data-tray], .tray');
      if (t !== over) { over?.classList.remove('drop-over'); over = t; over?.classList.add('drop-over'); }
      autoScroll(e);
    }
  });
  const end = e => {
    if (!start) return;
    const wasDrag = !!ghost;
    ghost?.remove(); ghost = null; el.classList.remove('dragging'); document.body.classList.remove('is-dragging');
    over?.classList.remove('drop-over');
    const target = over; over = null; start = null;
    if (wasDrag && e.type === 'pointerup' && target) {
      if (target.classList.contains('slot')) dropOnSlot(payload, target.dataset.date, target.dataset.period);
      else if (payload.lessonId) unplan(payload.lessonId);
    } else if (!wasDrag && e.type === 'pointerup') {
      if (payload.lessonId) openLesson(payload.lessonId);
      else { picked = picked?.atpId === payload.atpId ? null : payload; rerender(); }
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.style.touchAction = 'none';
}

function autoScroll(e) {
  const sc = document.querySelector('.grid-scroll');
  if (!sc) return;
  const r = sc.getBoundingClientRect();
  if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 14);
  else if (e.clientY < 60) window.scrollBy(0, -14);
  if (e.clientX > r.right - 40) sc.scrollLeft += 14; else if (e.clientX < r.left + 40) sc.scrollLeft -= 14;
}

async function placePicked(date, periodId) {
  if (!picked) return;
  const p = picked; picked = null;
  await dropOnSlot(p, date, periodId);
  rerender();
}

async function dropOnSlot(payload, date, periodId) {
  if (periodBlocked(date, periodId)) { const ev = blockingEventFor(date, periodId); toast(`No lessons then${ev ? ': ' + ev.title : ''}. Pick another period.`, 'warn'); return; }
  const existing = state.lessons.find(l => l.date === date && l.periodId === periodId);
  const tt = ttCellAt(date, periodId);
  if (payload.atpId) {
    const a = atpById(payload.atpId);
    if (existing) {
      if (existing.atpId === a.id) return;
      existing.atpId = a.id; existing.subjectId = a.subjectId; existing.title = a.topic;
      await saveLesson(existing); toast(`Changed the topic to “${a.topic}”.`);
      return;
    }
    const cls = tt && tt.subjectId === a.subjectId ? tt.cls : '';
    if (tt?.subjectId && tt.subjectId !== a.subjectId) toast(`Placed, but your timetable has ${classLabel(subjectById(tt.subjectId), tt.cls)} in that period.`, 'warn');
    await saveLesson({ date, periodId, subjectId: a.subjectId, atpId: a.id, title: a.topic, subtopic: nextPart(a), cls, notes: '', content: null, materialIds: [], done: false });
  } else if (payload.lessonId) {
    const l = state.lessons.find(x => x.id === payload.lessonId);
    if (!l || (l.date === date && l.periodId === periodId)) return;
    const from = { date: l.date, pid: l.periodId };
    const ttFrom = from.date ? ttCellAt(from.date, from.pid) : null;
    const fits = (x, cell) => !!cell && cell.subjectId === x.subjectId && (!cell.cls || !x.cls || cell.cls === x.cls);
    const before = [l, existing].filter(Boolean).map(x => ({ x, date: x.date, pid: x.periodId, cls: x.cls }));
    if (existing) { existing.date = from.date; existing.periodId = from.pid; }
    l.date = date; l.periodId = periodId;
    if (tt && tt.subjectId === l.subjectId && tt.cls && !l.cls) l.cls = tt.cls; // only fill in a missing class, never relabel one
    await saveLessons(existing ? [existing, l] : [l]);
    const undoMoves = async () => { for (const b of before) { b.x.date = b.date; b.x.periodId = b.pid; b.x.cls = b.cls; } await saveLessons(before.map(b => b.x)); };
    if (!existing) {
      if (tt?.subjectId && !fits(l, tt)) toast(`Moved, but your timetable has ${classLabel(subjectById(tt.subjectId), tt.cls)} in that period.`, 'warn', { action: { label: 'Undo', run: undoMoves } });
      return;
    }
    // Two classes swapped on the same day: swap those periods on that day's timetable too, so everything matches.
    const busy = new Set(swapsOn(date).flat());
    if (from.date === date && !fits(l, tt) && !fits(existing, ttFrom) && fits(l, ttFrom) && fits(existing, tt) && !busy.has(from.pid) && !busy.has(periodId)) {
      const swaps = { ...(state.timetable.swaps || {}) };
      swaps[date] = [...(swaps[date] || []), [from.pid, periodId]];
      await saveTimetable({ swaps });
      const lab = id => 'P' + (state.timetable.periods.find(x => x.id === id)?.label ?? '?');
      toast(`Swapped. ${fmt(date, { weekday: 'long' })}’s timetable now has ${lab(from.pid)} ⇄ ${lab(periodId)}.`, 'ok', { action: { label: 'Undo', run: async () => {
        const sw = { ...(state.timetable.swaps || {}) };
        sw[date] = (sw[date] || []).filter(([x, y]) => !(x === from.pid && y === periodId)); if (!sw[date].length) delete sw[date];
        await undoMoves(); await saveTimetable({ swaps: sw }); toast('Undone.');
      } } });
      return;
    }
    const mismatch = !fits(l, tt) || (ttFrom && !fits(existing, ttFrom));
    toast(mismatch ? 'Swapped, but each lesson is now in a period your timetable gives to the other class.' : 'Swapped the two lessons.', mismatch ? 'warn' : 'ok', { action: { label: 'Undo', run: undoMoves } });
  }
}

// The next part of an ATP topic (from its weekly content) that no lesson covers yet.
function nextPart(a, extra = []) {
  const parts = partsOf(a);
  if (parts.length < 2) return '';
  const used = new Set([...state.lessons, ...extra].filter(l => l.atpId === a.id).map(l => l.subtopic));
  return parts.find(p => !used.has(p)) || '';
}

async function unplan(lessonId) {
  const l = state.lessons.find(x => x.id === lessonId);
  if (!l) return;
  if (l.content || l.materialIds?.length) {
    if (!await confirmBox(`Remove “${l.title}” from the planner? Its lesson materials will be deleted too.`, 'Remove lesson')) return;
  }
  await deleteLesson(lessonId); toast('Lesson removed from the planner.');
}

// Fill this week’s timetable slots with the ATP topics for this term-week, per subject and class.
async function autoPlan() {
  const days = weekDays();
  const created = [];
  const groups = new Map(); // `${subjectId}|${cls}` -> [{date, periodId}]
  for (const d of days) {
    if (!inTerm(d.date) || noTeachingOn(d.date)) continue;
    for (const p of state.timetable.periods) {
      const tt = ttCellAt(d.date, p.id);
      if (!tt?.subjectId) continue;
      if (periodBlocked(d.date, p.id) || state.lessons.some(l => l.date === d.date && l.periodId === p.id)) continue;
      const k = `${tt.subjectId}|${tt.cls || ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ date: d.date, periodId: p.id, cls: tt.cls || '', subjectId: tt.subjectId });
    }
  }
  if (!groups.size) { toast('No free timetable periods this week. Set up your timetable first, or this week is already planned.', 'warn'); return; }
  let missing = [];
  for (const [, slots] of groups) {
    const { subjectId } = slots[0];
    const twFirst = termWeekOf(slots[0].date);
    let items = state.atp.filter(a => a.subjectId === subjectId && a.term === twFirst.term && twFirst.week >= a.week && twFirst.week <= (a.weekEnd || a.week));
    const weekHad = items.length;
    items = items.filter(a => !a.done);
    if (!items.length && weekHad) {
      // This week's work is done already: carry on with the next topics that aren't.
      const next = state.atp.filter(a => a.subjectId === subjectId && a.term === twFirst.term && !a.done && a.week > twFirst.week).sort((x, y) => x.week - y.week || (x.order || 0) - (y.order || 0));
      if (next.length) items = next.filter(a => a.week === next[0].week);
    }
    if (!items.length) { missing.push(subjectById(subjectId)?.name); continue; }
    // Continue from what this class already has planned this week.
    slots.forEach((s, i) => {
      const per = Math.max(1, Math.round(slots.length / items.length));
      const a = items[Math.min(items.length - 1, Math.floor(i / per))];
      created.push({ date: s.date, periodId: s.periodId, subjectId, atpId: a.id, title: a.topic, subtopic: nextPart(a, created), cls: s.cls, notes: '', content: null, materialIds: [], done: false });
    });
  }
  if (created.length) await saveLessons(created);
  missing = [...new Set(missing.filter(Boolean))];
  toast(created.length ? `Planned ${created.length} lesson${created.length > 1 ? 's' : ''}.${missing.length ? ' No ATP topics this week for ' + missing.join(', ') + '.' : ''}` : `No ATP topics found for this week (${missing.join(', ')}).`, created.length ? 'ok' : 'warn');
}

function onboarding() {
  const s = state.settings;
  const steps = [
    { done: !!(s.teacherName || s.school), label: 'Add your name and school', href: '#settings' },
    { done: state.subjects.length > 0, label: 'Add your subjects', href: '#subjects' },
    { done: state.atp.length > 0, label: 'Upload an ATP', href: '#subjects' },
    { done: Object.keys(state.timetable.cells).length + Object.keys(state.timetable.cellsB || {}).length > 0, label: 'Set up your timetable', href: '#timetable' },
    { done: state.lessons.length > 0, label: 'Drag a topic into a period', href: '#planner' },
  ];
  const allDone = steps.every(x => x.done);
  if (allDone) { import('../state.js').then(m => m.saveSettings({ onboarded: true })); }
  return h('section', { class: 'onboard' },
    h('h2', {}, 'Set up your planner'),
    h('ol', {}, steps.map(st => h('li', { class: st.done ? 'done' : '' }, st.done ? icon('check', 16) : h('span', { class: 'bullet' }), st.done ? h('span', {}, st.label) : h('a', { href: st.href }, st.label)))),
  );
}
