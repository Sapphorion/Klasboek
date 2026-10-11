// Keeps the plan in order when teaching time changes.
//
// When periods are lost (Spring School, prize giving…) the lessons planned there move to that class's
// next free period, and the lessons after them shift along until a free period absorbs the shift.
// When those periods come back, the shift is undone. Lessons that don't fit before the end of term
// wait in "Needs a period" on the planner.
import { state, saveLessons, saveSettings } from './state.js';
import { addDays, inTerm, parse, fmt } from './dates.js';
import { ttCellAt } from './ttday.js';
import { periodBlocked } from './events.js';
import { h, modal, toast } from './ui.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = (date, pid) => `${date}|${pid}`;

function termEndAfter(date) {
  for (const t of state.settings.terms || []) if (t.end && t.end >= date) return t.end;
  return addDays(date, 70);
}
function positions(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!inTerm(d) || !state.timetable.days.includes(WEEK[(parse(d).getDay() + 6) % 7])) continue;
    for (const p of state.timetable.periods) out.push({ date: d, pid: p.id });
  }
  return out;
}
const sameStream = (l, s) => l.subjectId === s.subjectId && (!l.cls || !s.cls || l.cls === s.cls);
function streamSlot(p, s) {
  const c = ttCellAt(p.date, p.pid);
  return !!c && c.subjectId === s.subjectId && (!c.cls || !s.cls || c.cls === s.cls);
}
function streamsOf(list) {
  const m = new Map();
  for (const l of list) if (l.subjectId) m.set(`${l.subjectId}|${l.cls || ''}`, { subjectId: l.subjectId, cls: l.cls || '' });
  return [...m.values()];
}

// Lessons sitting in periods that are now blocked get pushed forward.
function push(sim, from) {
  const to = termEndAfter(from);
  const pos = positions(from, to);
  const occ = new Map(sim.filter(l => l.date).map(l => [key(l.date, l.periodId), l]));
  const hit = sim.filter(l => l.date && l.date >= from && l.date <= to && periodBlocked(l.date, l.periodId));
  for (const s of streamsOf(hit)) {
    const queue = [];
    for (const p of pos) {
      const L = occ.get(key(p.date, p.pid));
      const mine = !!L && sameStream(L, s);
      const slot = streamSlot(p, s);
      if (!slot && !mine) continue;
      if (periodBlocked(p.date, p.pid)) { if (mine) { queue.push(L); occ.delete(key(p.date, p.pid)); } continue; }
      if (!slot || (L && !mine) || !queue.length) continue;
      if (mine) { queue.push(L); occ.delete(key(p.date, p.pid)); }
      const next = queue.shift();
      next.date = p.date; next.periodId = p.pid; occ.set(key(p.date, p.pid), next);
    }
    for (const l of queue) { l.date = ''; l.periodId = ''; }
  }
}

// Periods that became free again pull the following lessons back, until a gap is reached.
function pull(sim, from, until) {
  const to = termEndAfter(from);
  const pos = positions(from, to);
  const occ = new Map(sim.filter(l => l.date).map(l => [key(l.date, l.periodId), l]));
  const affected = sim.filter(l => (l.date && l.date >= from && l.date <= to) || !l.date);
  for (const s of streamsOf(affected)) {
    const frees = [];
    let stopped = false;
    for (const p of pos) {
      if (periodBlocked(p.date, p.pid) || !streamSlot(p, s)) continue;
      const L = occ.get(key(p.date, p.pid));
      if (L && !sameStream(L, s)) continue;
      if (!L) {
        if (p.date <= until) frees.push(p);
        else if (frees.length) { stopped = true; break; } // a real gap: the earlier shift ends here
        continue;
      }
      if (!frees.length) continue;
      const f = frees.shift();
      occ.delete(key(p.date, p.pid)); L.date = f.date; L.periodId = f.pid; occ.set(key(f.date, f.pid), L);
      frees.push(p);
    }
    // Lessons waiting for a period come back into whatever is free.
    if (!stopped || frees.length) {
      const waiting = sim.filter(l => !l.date && sameStream(l, s));
      for (const l of waiting) { const f = frees.shift(); if (!f) break; l.date = f.date; l.periodId = f.pid; }
    }
  }
}

// Work out the moves without changing anything yet.
export function planAdjust({ blocked = [], freed = [] }) {
  const sim = state.lessons.map(l => ({ ...l }));
  for (const r of blocked) push(sim, r.from);
  for (const r of freed) pull(sim, r.from, r.to || r.from);
  const byId = new Map(state.lessons.map(l => [l.id, l]));
  return sim.filter(l => { const o = byId.get(l.id); return o && (o.date !== l.date || o.periodId !== l.periodId); })
    .map(l => ({ lesson: byId.get(l.id), from: { date: byId.get(l.id).date, pid: byId.get(l.id).periodId }, to: { date: l.date, pid: l.periodId } }));
}

async function applyMoves(moves) {
  const before = moves.map(m => ({ l: m.lesson, date: m.lesson.date, pid: m.lesson.periodId }));
  for (const m of moves) { m.lesson.date = m.to.date; m.lesson.periodId = m.to.pid; }
  await saveLessons(moves.map(m => m.lesson));
  return async () => { for (const b of before) { b.l.date = b.date; b.l.periodId = b.pid; } await saveLessons(before.map(b => b.l)); toast('Lessons are back where they were.'); };
}

const where = p => p.date ? `${fmt(p.date, { weekday: 'short', day: 'numeric', month: 'short' })} P${state.timetable.periods.find(x => x.id === p.pid)?.label ?? '?'}` : 'Needs a period';
const lessonName = l => { const s = state.subjects.find(x => x.id === l.subjectId); return `${s?.name || 'Lesson'}${l.cls ? ' ' + l.cls : ''}: ${l.title || ''}`; };

// Call after the calendar changes. Asks first unless the teacher chose "always".
export async function afterTeachingChange(change, reason = '') {
  const moves = planAdjust(change);
  if (!moves.length) return;
  const off = moves.filter(m => !m.to.date).length;
  const summary = `${moves.length} lesson${moves.length > 1 ? 's' : ''} moved${off ? `, ${off} need${off > 1 ? '' : 's'} a period` : ''}.`;
  if (state.settings.autoAdjust) {
    const undo = await applyMoves(moves);
    toast(`Planner adjusted: ${summary}`, 'ok', { action: { label: 'Undo', run: undo } });
    return;
  }
  return new Promise(res => {
    let always = false;
    const m = modal('Adjust the planner?', [
      h('p', {}, reason ? `${reason} ` : '', `These lessons would move to the next free period for the same class, keeping their order:`),
      h('div', { class: 'table-wrap short' }, h('table', { class: 'mini' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Lesson'), h('th', {}, 'From'), h('th', {}, 'To'))),
        h('tbody', {}, moves.map(mv => h('tr', { class: mv.to.date ? '' : 'warn-row' }, h('td', {}, lessonName(mv.lesson)), h('td', {}, where(mv.from)), h('td', {}, where(mv.to))))))),
      off ? h('p', { class: 'warn small' }, `${off} lesson${off > 1 ? 's don’t' : ' doesn’t'} fit before the end of term. ${off > 1 ? 'They' : 'It'} will wait under “Needs a period” on the planner.`) : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => always = e.target.checked }), 'Always adjust without asking (you can change this in Settings)'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res(false); } }, 'Leave the lessons'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (always) await saveSettings({ autoAdjust: true });
          const undo = await applyMoves(moves); m.close();
          toast(`Planner adjusted: ${summary}`, 'ok', { action: { label: 'Undo', run: undo } }); res(true);
        } }, 'Move them')),
    ], { wide: true });
  });
}

// Before/after effect of an event, as date ranges that lost or regained teaching time.
export const effectOf = e => !e ? 'normal' : e.noTeaching ? 'none' : (e.blockedPeriods || []).length ? 'periods' : 'normal';
export function rangeOf(e) { return { from: e.date, to: e.endDate || e.date }; }
export function changeFor(before, after) {
  const blocked = [], freed = [];
  if (after && effectOf(after) !== 'normal') blocked.push(rangeOf(after));
  if (before && effectOf(before) !== 'normal') freed.push(rangeOf(before));
  return { blocked, freed };
}
