// Which timetable day a calendar date follows, and which periods are swapped.
//
// Normally Monday follows Monday's timetable (in Week A or B for a two-week cycle). Schools change this:
//  - "This week starts on Day 3" (just this week, or from now on). "From now on" counts teaching days
//    only, so a Day 1–10 cycle that skips public holidays stays in step.
//  - "Monday follows Thursday's timetable" for a single day.
//  - "Periods 2 and 5 are swapped today."
import { state, onChange } from './state.js';
import { cycleWeekOf, mondayOf, addDays, inTerm, parse, cellsFor } from './dates.js';
import { noTeachingOn } from './events.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const tt = () => state.timetable;
const perWeek = () => tt().days.length;
export const cycleLen = () => perWeek() * (tt().cycle || 1);

let memo = new Map();
onChange(w => { if (['timetable', 'events', 'settings'].includes(w)) memo = new Map(); });

// Positions run 0 … cycleLen-1: Week A Mon = 0, … Week B Fri = 9.
const toPos = p => (p.week - 1) * perWeek() + p.day;
const fromPos = n => { const L = cycleLen(); const k = ((n % L) + L) % L; return { week: Math.floor(k / perWeek()) + 1, day: k % perWeek() }; };

export function posLabel(p) {
  if (!p) return '';
  const name = tt().days[p.day] || '?';
  return (tt().cycle || 1) === 2 ? `Day ${toPos(p) + 1} · ${p.week === 2 ? 'B' : 'A'} ${name}` : name;
}
export const allPositions = () => Array.from({ length: cycleLen() }, (_, i) => fromPos(i));
export const samePos = (a, b) => !!a && !!b && a.week === b.week && a.day === b.day;

// What the calendar alone says (no changes applied).
export function defaultPos(date) {
  const di = tt().days.indexOf(WEEK[(parse(date).getDay() + 6) % 7]);
  return di < 0 ? null : { week: cycleWeekOf(date), day: di };
}
export const isTeachingDay = date => defaultPos(date) !== null && inTerm(date) && !noTeachingOn(date);

export function ttDayFor(date) {
  if (memo.has(date)) return memo.get(date);
  const r = compute(date);
  memo.set(date, r);
  return r;
}

function compute(date) {
  const base = defaultPos(date);
  if (!base) return null;
  const ov = tt().dayOverrides?.[date];
  if (ov) return { week: ov.week, day: ov.day, source: 'day' };
  const anchor = (tt().anchors || [])
    .filter(a => a.date <= date && (a.scope === 'onwards' || mondayOf(a.date) === mondayOf(date)))
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!anchor) return { ...base, source: '' };
  // Count teaching days from the anchor up to (not including) this date.
  let n = 0;
  for (let d = anchor.date; d < date; d = addDays(d, 1)) if (isTeachingDay(d)) n++;
  return { ...fromPos(toPos(anchor) + n), source: anchor.scope === 'onwards' ? 'onwards' : 'week' };
}

export function swapsOn(date) { return tt().swaps?.[date] || []; }
function swapMap(date) {
  const m = {};
  for (const [a, b] of swapsOn(date)) { m[a] = b; m[b] = a; }
  return m;
}

// The timetable slot that applies to this date and period, after all changes.
export function ttCellAt(date, periodId) {
  const p = ttDayFor(date);
  if (!p) return null;
  const pid = swapMap(date)[periodId] || periodId;
  return cellsFor(p.week)[`${p.day}|${pid}`] || null;
}

export const changedOn = date => { const p = ttDayFor(date); return !!(p && p.source) || swapsOn(date).length > 0; };
