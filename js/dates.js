// Date helpers. Dates are stored as local 'YYYY-MM-DD' strings to avoid time-zone drift.
import { state } from './state.js';

export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = () => iso(new Date());
export const mondayOf = s => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); };
export const weekdayIndex = s => (parse(s).getDay() + 6) % 7; // Mon=0
export const fmt = (s, opts = { day: 'numeric', month: 'short' }) => parse(s).toLocaleDateString('en-ZA', opts);
export const fmtLong = s => fmt(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Which term and week of term a date falls in (week 1 = the week containing the first school day).
export function termWeekOf(s) {
  const terms = state.settings.terms || [];
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (!t.start || !t.end) continue;
    const startMon = mondayOf(t.start);
    if (s >= startMon && s <= t.end) {
      const week = Math.floor((parse(mondayOf(s)) - parse(startMon)) / (7 * 864e5)) + 1;
      return { term: i + 1, week };
    }
  }
  return null;
}

export function termWeeks(termNo) {
  const t = state.settings.terms?.[termNo - 1];
  if (!t?.start || !t?.end) return 0;
  return Math.floor((parse(mondayOf(t.end)) - parse(mondayOf(t.start))) / (7 * 864e5)) + 1;
}

export function mondayOfTermWeek(term, week) {
  const t = state.settings.terms?.[term - 1];
  if (!t?.start) return null;
  return addDays(mondayOf(t.start), (week - 1) * 7);
}

export const inTerm = s => {
  const tw = termWeekOf(s);
  if (!tw) return false;
  const t = state.settings.terms[tw.term - 1];
  return s >= t.start && s <= t.end;
};

export function minutesBetween(a, b) {
  if (!a || !b) return 45;
  const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number);
  const m = (h2 * 60 + m2) - (h1 * 60 + m1);
  return m > 0 ? m : 45;
}
