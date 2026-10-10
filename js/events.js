// School calendar helpers: event types, what's on a day, what's coming up.
import { state } from './state.js';
import { inTerm, addDays, today } from './dates.js';

export const EVENT_TYPES = [
  { id: 'exam', label: 'Exam', colour: '#C8372D' },
  { id: 'test', label: 'Test or task', colour: '#2747A8' },
  { id: 'deadline', label: 'Deadline', colour: '#9A6200' },
  { id: 'holiday', label: 'Holiday or no school', colour: '#2E7D4F' },
  { id: 'meeting', label: 'Meeting', colour: '#8E44AD' },
  { id: 'event', label: 'School event', colour: '#1E3B33' },
  { id: 'reminder', label: 'Reminder or note', colour: '#B8336A' },
];
export const typeOf = id => EVENT_TYPES.find(t => t.id === id) || EVENT_TYPES.at(-1);
const order = id => EVENT_TYPES.findIndex(t => t.id === id);
export const byDateThenType = (a, b) => a.date.localeCompare(b.date) || order(a.type) - order(b.type) || (a.time || '').localeCompare(b.time || '');

export const covers = (e, date) => e.date <= date && (e.endDate || e.date) >= date;

// Open moderation notices show on the calendar and planner: on the due date and on each reminder day.
export function noticeEvents() {
  const out = [];
  for (const n of state.notices || []) {
    if (!n.due || n.submitted) continue;
    const items = n.items || [];
    const ready = items.filter(i => i.done).length;
    out.push({ id: 'notice-due-' + n.id, notice: n.id, date: n.due, type: 'deadline', title: `Moderation due: ${n.title}`, time: '', notes: items.length ? `${ready} of ${items.length} items ready` : '' });
    for (const d of n.remind || []) {
      if (!d) continue;
      out.push({ id: `notice-rem-${n.id}-${d}`, notice: n.id, date: addDays(n.due, -d), type: 'reminder', title: `Reminder: ${n.title} due in ${d} day${d > 1 ? 's' : ''}`, time: '' });
    }
  }
  return out;
}
export const allEvents = () => state.events.concat(noticeEvents());
export const eventsOn = date => allEvents().filter(e => covers(e, date)).sort(byDateThenType);
export const noTeachingOn = date => state.events.some(e => e.noTeaching && covers(e, date));
export const isSchoolDay = date => inTerm(date) && !noTeachingOn(date);

// Tests, exams and deadlines that belong to one of the teacher's subjects.
export const isMine = e => !!e.subjectId && state.subjects.some(s => s.id === e.subjectId);
export const isAssessment = e => e.type === 'test' || e.type === 'exam';

export function upcoming({ from = today(), days = 21, limit = 6 } = {}) {
  const until = addDays(from, days);
  return allEvents()
    .filter(e => !(e.notice && e.type === 'reminder') || e.date === from)
    .filter(e => (e.endDate || e.date) >= from && e.date <= until)
    .filter(e => !isAssessment(e) || isMine(e) || !e.subjectId)
    .sort(byDateThenType).slice(0, limit);
}

// Tests or exams for this lesson's subject on the lesson's own day.
export const assessmentsForLesson = l => state.events.filter(e => isAssessment(e) && e.subjectId === l.subjectId && covers(e, l.date));

// The next test or exam for a subject after a date (for revision hints).
export function nextAssessment(subjectId, from, days = 21) {
  const until = addDays(from, days);
  return state.events.filter(e => isAssessment(e) && e.subjectId === subjectId && e.date >= from && e.date <= until).sort(byDateThenType)[0] || null;
}

export function eventLabel(e) {
  return [e.time, e.title].filter(Boolean).join(' ');
}

// Notices due within `days` (or overdue) that aren't submitted yet.
export function noticesDueSoon(days = 7) {
  const until = addDays(today(), days);
  return (state.notices || []).filter(n => !n.submitted && n.due && n.due <= until).sort((a, b) => a.due.localeCompare(b.due));
}
