// Week planner: timetable periods × school days, ATP topics to drag in, lessons to open.
import { state, onChange, subjectById, atpById, saveLesson, saveLessons, deleteLesson, subjectLabel, saveTimetable } from '../state.js';
import { h, icon, toast, confirmBox } from '../ui.js';
import { today, mondayOf, addDays, fmt, termWeekOf, mondayOfTermWeek, termWeeks, inTerm, weekdayIndex, cycleWeekOf, cycleLetter, cellsFor } from '../dates.js';
import { exportWeekPlanDocx } from '../exporters.js';
import { openLesson } from './lesson.js';
import { eventsOn, noTeachingOn, assessmentsForLesson, upcoming, typeOf, eventLabel } from '../events.js';
import { editEvent } from './calendar.js';

let weekStart = mondayOf(today());
let trayScope = 'week';      // 'week' | 'term'
let traySubject = '';        // filter
let picked = null;           // tap-to-place: { atpId } or { lessonId }

let rootEl = null;
export function renderPlanner(root) {
  rootEl = root;
  const off = onChange(w => { if (['lessons', 'atp', 'subjects', 'timetable', 'settings', 'materials', 'events'].includes(w)) rerender(); });
  rerender();
  return () => { off(); rootEl = null; };
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function weekDays() {
  return state.timetable.days.map((label, i) => ({ label, date: addDays(weekStart, Math.max(0, WEEK.indexOf(label))), i }));
}
const dayIdxOf = date => state.timetable.days.indexOf(WEEK[weekdayIndex(date)]);
const cellKey = (dayIdx, pid) => `${dayIdx}|${pid}`;

function view() {
  const tw = termWeekOf(weekStart) || termWeekOf(addDays(weekStart, 4));
  const days = weekDays();
  const wrap = h('div', { class: 'planner' });
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
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: autoPlan, title: 'Place this week’s ATP topics into your timetable slots' }, icon('wand'), 'Auto-plan week'),
      h('button', { class: 'btn ghost', onclick: () => exportWeekPlanDocx(weekStart, days).catch(e => toast(e.message, 'error')) }, icon('download'), 'Week plan (.docx)'),
    ),
  ));

  wrap.append(comingUp());
  if (picked) wrap.append(h('div', { class: 'picked-bar', role: 'status' }, 'Tap an empty period to place ', h('strong', {}, pickedLabel()), '.', h('button', { class: 'btn ghost sm', onclick: () => { picked = null; rerender(); } }, 'Cancel')));

  // ---------- Grid ----------
  const grid = h('div', { class: 'week-grid', style: { gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(9rem, 1fr))` }, role: 'grid', 'aria-label': 'Week timetable' });
  grid.append(h('div', { class: 'corner' }));
  for (const d of days) {
    const isToday = d.date === today();
    const evs = eventsOn(d.date);
    grid.append(h('div', { class: 'day-head' + (isToday ? ' today' : ''), role: 'columnheader' }, h('strong', {}, d.label), h('span', {}, fmt(d.date)),
      evs.length ? h('div', { class: 'day-events' }, evs.slice(0, 3).map(e => h('button', { class: 'pill', style: { '--c': typeOf(e.type).colour }, title: eventLabel(e), onclick: () => editEvent(e) }, h('span', {}, e.title))),
        evs.length > 3 ? h('a', { class: 'more', href: '#calendar/' + d.date }, `+${evs.length - 3}`) : null) : null));
  }
  for (const p of state.timetable.periods) {
    grid.append(h('div', { class: 'period-head', role: 'rowheader' }, h('strong', {}, p.label), p.start ? h('span', {}, p.start) : null));
    for (const d of days) grid.append(slot(d, p));
  }
  if (!state.timetable.periods.length) grid.append(h('p', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'Add your periods on the Timetable page first.'));

  wrap.append(h('div', { class: 'planner-body' }, h('div', { class: 'grid-scroll' }, grid), tray(tw)));
  return wrap;
}

function rerender() {
  if (!rootEl) return;
  const sc = rootEl.querySelector('.grid-scroll')?.scrollLeft || 0;
  rootEl.replaceChildren(view());
  const g = rootEl.querySelector('.grid-scroll'); if (g) g.scrollLeft = sc;
}

function comingUp() {
  const list = upcoming({ from: today(), days: 21, limit: 5 });
  if (!list.length) return h('span');
  const rel = date => { const n = Math.round((new Date(date) - new Date(today())) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? fmt(date, { weekday: 'short' }) : fmt(date); };
  return h('div', { class: 'coming-up', 'aria-label': 'Coming up' }, h('strong', {}, 'Coming up'),
    list.map(e => h('a', { class: 'ev-chip', href: '#calendar/' + e.date, style: { '--c': typeOf(e.type).colour }, title: typeOf(e.type).label },
      h('span', { class: 'when' }, rel(e.date < today() ? today() : e.date)), h('span', {}, e.title))));
}

function cycleBadge(tw) {
  if ((state.timetable.cycle || 1) < 2 || !tw) return null;
  const w = cycleWeekOf(addDays(weekStart, 1));
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
  const sel = h('select', { class: 'sm', 'aria-label': 'Jump to term', onchange: () => { const m = mondayOfTermWeek(+sel.value, 1); if (m) { weekStart = m; rerender(); } } },
    h('option', { value: '' }, 'Jump to…'), [1, 2, 3, 4].map(t => h('option', { value: t }, `Term ${t}`)));
  return sel;
}

function slot(d, p) {
  const closed = noTeachingOn(d.date);
  const ttCell = closed ? null : cellsFor(cycleWeekOf(d.date))[cellKey(d.i, p.id)];
  const ttSubj = ttCell && subjectById(ttCell.subjectId);
  const lessons = state.lessons.filter(l => l.date === d.date && l.periodId === p.id);
  const school = inTerm(d.date);
  const el = h('div', {
    class: 'slot' + (school ? '' : ' holiday') + (closed ? ' no-teach' : '') + (ttSubj ? ' expected' : ''),
    role: 'gridcell', 'data-date': d.date, 'data-period': p.id, tabindex: lessons.length ? -1 : 0,
    style: ttSubj ? { '--subj': ttSubj.colour } : {},
    'aria-label': `${d.label} period ${p.label}${ttSubj ? ', ' + ttSubj.name : ''}${lessons.length ? '' : ', empty'}`,
  });
  if (ttSubj && !lessons.length) el.append(h('span', { class: 'expect' }, `${ttSubj.name}${ttCell.cls ? ' ' + ttCell.cls : ''}`));
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
    style: { '--subj': s?.colour || '#777' }, 'aria-label': `${s?.name || 'Lesson'}: ${l.title || a?.topic || ''}. Open lesson.`,
  },
    h('span', { class: 'l-subj' }, `${s?.name || 'Lesson'}${l.cls ? ' · ' + l.cls : ''}`),
    h('span', { class: 'l-title' }, l.title || a?.topic || 'Untitled'),
    h('span', { class: 'l-flags' }, hasContent ? h('span', { class: 'flag', title: 'Materials ready' }, icon('doc', 12), l.content.source === 'ai' ? 'AI' : 'Draft') : null, l.materialIds?.length ? h('span', { class: 'flag', title: 'Attached files' }, icon('clip', 12), l.materialIds.length) : null, l.done ? h('span', { class: 'flag' }, icon('check', 12), 'Taught') : null, ...assessmentsForLesson(l).slice(0, 1).map(e => h('span', { class: 'flag assess', title: eventLabel(e) }, icon('flag', 12), e.type === 'exam' ? 'Exam' : 'Test'))),
  );
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
  const list = h('div', { class: 'tray-list', 'data-tray': '1' });
  if (!subjects.length) list.append(h('p', { class: 'empty' }, 'Add a subject and upload its ATP to see topics here. ', h('a', { href: '#subjects' }, 'Add a subject')));
  else if (!tw) list.append(h('p', { class: 'empty' }, 'This week is a school holiday. Use Jump to choose a term.'));
  else {
    const items = state.atp.filter(a => (!traySubject || a.subjectId === traySubject) && a.term === tw.term && (trayScope === 'term' || (tw.week >= a.week && tw.week <= (a.weekEnd || a.week))));
    if (!items.length) list.append(h('p', { class: 'empty' }, trayScope === 'week' ? `No ATP topics for term ${tw.term} week ${tw.week}. Try Whole term, or check the ATP on the Subjects page.` : 'No ATP topics for this term yet.'));
    for (const a of items) list.append(atpCard(a, tw));
  }
  box.append(list, h('p', { class: 'tray-tip muted' }, 'Drag a topic onto a period, or tap it and then tap a period. Double-click an empty period for a lesson that isn’t in the ATP. Drag a lesson back here to unplan it.'));
  return box;
}

function atpCard(a, tw) {
  const s = subjectById(a.subjectId);
  const planned = state.lessons.filter(l => l.atpId === a.id).length;
  const card = h('div', { class: 'card' + (picked?.atpId === a.id ? ' picked' : ''), 'data-atp': a.id, tabindex: 0, role: 'button', style: { '--subj': s?.colour || '#777' }, 'aria-label': `${s?.name}: ${a.topic}. ${planned} lessons planned. Press Enter to pick up.` },
    h('div', { class: 'c-top' }, h('span', { class: 'c-subj' }, subjectLabel(s)), h('span', { class: 'c-week' }, `Wk ${a.week}${a.weekEnd && a.weekEnd !== a.week ? '–' + a.weekEnd : ''}`)),
    h('div', { class: 'c-topic' }, a.topic),
    a.details ? h('div', { class: 'c-details' }, a.details.split('\n').slice(0, 2).join(' · ')) : null,
    h('div', { class: 'c-count' + (planned ? ' has' : '') }, planned ? `${planned} lesson${planned > 1 ? 's' : ''} planned` : 'Not planned yet'),
  );
  makeDraggable(card, { atpId: a.id });
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picked = picked?.atpId === a.id ? null : { atpId: a.id }; rerender(); } });
  return card;
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
    if (e.button !== 0) return;
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
  const existing = state.lessons.find(l => l.date === date && l.periodId === periodId);
  const tt = cellsFor(cycleWeekOf(date))[cellKey(dayIdxOf(date), periodId)];
  if (payload.atpId) {
    const a = atpById(payload.atpId);
    if (existing) {
      if (existing.atpId === a.id) return;
      existing.atpId = a.id; existing.subjectId = a.subjectId; existing.title = a.topic;
      await saveLesson(existing); toast(`Changed the topic to “${a.topic}”.`);
      return;
    }
    const cls = tt && tt.subjectId === a.subjectId ? tt.cls : (tt && !tt.subjectId ? tt.cls : '');
    if (tt?.subjectId && tt.subjectId !== a.subjectId) toast(`Placed, but your timetable has ${subjectById(tt.subjectId)?.name} in that period.`, 'warn');
    await saveLesson({ date, periodId, subjectId: a.subjectId, atpId: a.id, title: a.topic, cls, notes: '', content: null, materialIds: [], done: false });
  } else if (payload.lessonId) {
    const l = state.lessons.find(x => x.id === payload.lessonId);
    if (!l || (l.date === date && l.periodId === periodId)) return;
    if (existing) { existing.date = l.date; existing.periodId = l.periodId; await saveLessons([existing]); }
    l.date = date; l.periodId = periodId;
    if (tt && tt.subjectId === l.subjectId && tt.cls) l.cls = tt.cls;
    await saveLesson(l);
    if (existing) toast('Swapped the two lessons.');
  }
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
      const tt = cellsFor(cycleWeekOf(d.date))[cellKey(d.i, p.id)];
      if (!tt?.subjectId) continue;
      if (state.lessons.some(l => l.date === d.date && l.periodId === p.id)) continue;
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
    const items = state.atp.filter(a => a.subjectId === subjectId && a.term === twFirst.term && twFirst.week >= a.week && twFirst.week <= (a.weekEnd || a.week));
    if (!items.length) { missing.push(subjectById(subjectId)?.name); continue; }
    // Continue from what this class already has planned this week.
    slots.forEach((s, i) => {
      const per = Math.max(1, Math.round(slots.length / items.length));
      const a = items[Math.min(items.length - 1, Math.floor(i / per))];
      created.push({ date: s.date, periodId: s.periodId, subjectId, atpId: a.id, title: a.topic, cls: s.cls, notes: '', content: null, materialIds: [], done: false });
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
