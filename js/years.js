// School years. One year is "open" at a time: its subjects, ATPs, timetable and term dates.
// Lessons, the calendar, the diary and materials are dated, so they simply carry on across years.
// The other years' subjects, ATPs, timetables and term dates are kept in the "years" store.
import { state, loadState, emit, saveSettings, DEFAULT_TERMS } from './state.js';
import { db } from './db.js';

const ALL = ['settings', 'timetable', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events', 'notices', 'creations', 'diary', 'stock'];
const snap = () => JSON.parse(JSON.stringify({ subjects: state.subjects, atp: state.atp, timetable: state.timetable, terms: state.settings.terms }));

export const knownYears = () => [...new Set([+state.settings.year, ...(state.otherYears || []).map(y => +y.year)])].sort();
export const termsFor = y => (DEFAULT_TERMS[y] || []).map(([start, end]) => ({ start, end }));

async function writeActive(row) {
  await db.clear('subjects'); await db.putMany('subjects', row.subjects || []);
  await db.clear('atp'); await db.putMany('atp', row.atp || []);
  await db.put('kv', row.timetable, 'timetable');
}

async function reload(year) {
  await loadState();
  ALL.forEach(emit);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// Open another year that already exists.
export async function switchYear(year) {
  year = +year;
  if (year === +state.settings.year) return;
  const target = await db.get('years', String(year));
  if (!target) throw new Error(`There’s no ${year} yet.`);
  await db.put('years', { id: String(state.settings.year), year: +state.settings.year, ...snap() });
  await writeActive(target);
  await saveSettings({ year, terms: target.terms });
  await reload(year);
}

// Start a new year from this one: choose what comes along.
// opts: { year, terms, subjects: [{ id, grade, keep, atp }], timetable: bool }
export async function startYear(opts) {
  const year = +opts.year;
  if (knownYears().includes(year)) throw new Error(`${year} already exists. Switch to it instead.`);
  const keep = opts.subjects.filter(s => s.keep);
  const ids = new Set(keep.map(s => s.id));
  const subjects = keep.map(k => ({ ...state.subjects.find(s => s.id === k.id), grade: k.grade }));
  const atpIds = new Set(keep.filter(k => k.atp).map(k => k.id));
  const atp = state.atp.filter(a => atpIds.has(a.subjectId)).map(a => ({ ...a, done: false }));
  const tt = JSON.parse(JSON.stringify(state.timetable));
  if (opts.timetable) {
    for (const key of ['cells', 'cellsB']) for (const [k, c] of Object.entries(tt[key] || {})) if (!ids.has(c.subjectId)) delete tt[key][k];
  } else { tt.cells = {}; tt.cellsB = {}; }
  tt.anchors = []; tt.dayOverrides = {}; tt.swaps = {};
  // Keep this year exactly as it is, then open the new one.
  await db.put('years', { id: String(state.settings.year), year: +state.settings.year, ...snap() });
  await db.put('years', { id: String(year), year, subjects, atp, timetable: tt, terms: opts.terms });
  await writeActive({ subjects, atp, timetable: tt });
  await saveSettings({ year, terms: opts.terms });
  await reload(year);
}

// The first Monday of a year's first term (for jumping the planner there).
export function firstWeekOf() {
  const t = (state.settings.terms || [])[0];
  return t?.start || '';
}
