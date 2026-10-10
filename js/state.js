// In-memory app state, loaded from IndexedDB at start and written through on change.
import { db, uid } from './db.js';

export const SUBJECT_COLOURS = ['#2F6FDB', '#C8372D', '#2E8B57', '#8E44AD', '#D9822B', '#0E8C8C', '#B8336A', '#6B7A1F', '#5B5FC7', '#7A5230'];

// Public school calendar (gov.za). Teachers can edit these in Settings.
export const DEFAULT_TERMS = {
  2026: [['2026-01-14', '2026-03-27'], ['2026-04-08', '2026-06-26'], ['2026-07-21', '2026-09-23'], ['2026-10-06', '2026-12-11']],
  2027: [['2027-01-13', '2027-03-19'], ['2027-04-06', '2027-06-25'], ['2027-07-20', '2027-10-01'], ['2027-10-11', '2027-12-10']],
};

const defaultSettings = () => {
  const y = new Date().getFullYear();
  const t = DEFAULT_TERMS[y] || DEFAULT_TERMS[2026];
  return {
    teacherName: '', school: '', year: y,
    terms: t.map(([start, end]) => ({ start, end })),
    apiKey: '', model: 'claude-sonnet-5-5', aiEnabled: true,
    brandColour: '#1E3B33', logo: '', footer: '',
    onboarded: false,
    modPercent: 10, modMin: 5, modTolerance: 5, modBorderline: 30,
  };
};

const defaultTimetable = () => ({
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  periods: [
    { id: 'p1', label: '1', start: '07:45', end: '08:30' },
    { id: 'p2', label: '2', start: '08:30', end: '09:15' },
    { id: 'p3', label: '3', start: '09:15', end: '10:00' },
    { id: 'p4', label: '4', start: '10:20', end: '11:05' },
    { id: 'p5', label: '5', start: '11:05', end: '11:50' },
    { id: 'p6', label: '6', start: '12:10', end: '12:55' },
    { id: 'p7', label: '7', start: '12:55', end: '13:40' },
  ],
  cells: {},  // Week A (or the only week): key `${dayIndex}|${periodId}` -> { subjectId, cls, room }
  cellsB: {}, // Week B, used when cycle is 2
  cycle: 1,   // 1 = same every week, 2 = two-week cycle (Week A / Week B)
  cycleMode: 'term', // 'term' = every term starts on Week A, 'continuous' = carries on across terms
  cycleOffset: 0,    // 1 swaps A and B (set from the planner if the school is out of step)
  image: '', // optional photo of the printed timetable, shown beside the grid
});

export const state = {
  settings: defaultSettings(),
  timetable: defaultTimetable(),
  subjects: [],
  atp: [],       // { id, subjectId, term, week, weekEnd, topic, details, order }
  lessons: [],   // { id, date, periodId, subjectId, atpId, title, cls, notes, content, materialIds, done }
  materials: [], // { id, name, type, size, blob, subjectId, lessonId, added }
  moderations: [], // { id, title, subjectId, cls, task, total, learners:[{name, mark, modMark, sampled, reason}], checks:{}, fileChecks:{}, ... }
};

const listeners = new Set();
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));
export const emit = what => listeners.forEach(fn => fn(what));

export async function loadState() {
  state.settings = { ...defaultSettings(), ...(await db.get('kv', 'settings') || {}) };
  state.timetable = { ...defaultTimetable(), ...(await db.get('kv', 'timetable') || {}) };
  state.subjects = await db.all('subjects');
  state.atp = (await db.all('atp')).sort(atpSort);
  state.lessons = await db.all('lessons');
  state.materials = await db.all('materials');
  state.moderations = await db.all('moderations');
}

export const atpSort = (a, b) => a.subjectId.localeCompare(b.subjectId) || a.term - b.term || a.week - b.week || (a.order || 0) - (b.order || 0);

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.put('kv', state.settings, 'settings');
  emit('settings');
}
export async function saveTimetable(patch) {
  Object.assign(state.timetable, patch);
  await db.put('kv', state.timetable, 'timetable');
  emit('timetable');
}

// ---------- Subjects ----------
export const subjectById = id => state.subjects.find(s => s.id === id);
export const subjectLabel = s => s ? `${s.name}${s.grade ? ' · Gr ' + s.grade : ''}` : 'No subject';

export async function upsertSubject(s) {
  if (!s.id) {
    s.id = uid('s_');
    s.colour = s.colour || SUBJECT_COLOURS[state.subjects.length % SUBJECT_COLOURS.length];
    state.subjects.push(s);
  } else {
    const i = state.subjects.findIndex(x => x.id === s.id);
    state.subjects[i] = s;
  }
  await db.put('subjects', s);
  emit('subjects');
  return s;
}
export async function deleteSubject(id) {
  state.subjects = state.subjects.filter(s => s.id !== id);
  const atpIds = state.atp.filter(a => a.subjectId === id).map(a => a.id);
  state.atp = state.atp.filter(a => a.subjectId !== id);
  await db.del('subjects', id);
  await db.delMany('atp', atpIds);
  emit('subjects'); emit('atp');
}

// ---------- ATP ----------
export async function replaceAtp(subjectId, items) {
  const old = state.atp.filter(a => a.subjectId === subjectId).map(a => a.id);
  await db.delMany('atp', old);
  const rows = items.map((it, i) => ({ id: it.id || uid('a_'), subjectId, order: i, ...it, subjectId }));
  await db.putMany('atp', rows);
  state.atp = state.atp.filter(a => a.subjectId !== subjectId).concat(rows).sort(atpSort);
  emit('atp');
}
export async function saveAtpItem(item) {
  const i = state.atp.findIndex(a => a.id === item.id);
  if (i < 0) state.atp.push(item); else state.atp[i] = item;
  state.atp.sort(atpSort);
  await db.put('atp', item); emit('atp');
}
export async function deleteAtpItem(id) {
  state.atp = state.atp.filter(a => a.id !== id);
  await db.del('atp', id); emit('atp');
}
export const atpById = id => state.atp.find(a => a.id === id);

// ---------- Lessons ----------
export const lessonById = id => state.lessons.find(l => l.id === id);
export async function saveLesson(l) {
  if (!l.id) { l.id = uid('l_'); l.materialIds = l.materialIds || []; state.lessons.push(l); }
  else { const i = state.lessons.findIndex(x => x.id === l.id); if (i < 0) state.lessons.push(l); else state.lessons[i] = l; }
  await db.put('lessons', l); emit('lessons');
  return l;
}
export async function saveLessons(list) {
  for (const l of list) {
    if (!l.id) { l.id = uid('l_'); l.materialIds = l.materialIds || []; }
    const i = state.lessons.findIndex(x => x.id === l.id);
    if (i < 0) state.lessons.push(l); else state.lessons[i] = l;
  }
  await db.putMany('lessons', list); emit('lessons');
}
export async function deleteLesson(id) {
  state.lessons = state.lessons.filter(l => l.id !== id);
  await db.del('lessons', id); emit('lessons');
}

// ---------- Materials ----------
export async function addMaterial(file, extra = {}) {
  const m = { id: uid('m_'), name: file.name, type: file.type || 'application/octet-stream', size: file.size, blob: file, added: new Date().toISOString(), subjectId: '', lessonId: '', ...extra };
  state.materials.push(m);
  await db.put('materials', m); emit('materials');
  return m;
}
export async function saveMaterial(m) {
  const i = state.materials.findIndex(x => x.id === m.id); state.materials[i] = m;
  await db.put('materials', m); emit('materials');
}
export async function deleteMaterial(id) {
  state.materials = state.materials.filter(m => m.id !== id);
  for (const l of state.lessons) if (l.materialIds?.includes(id)) { l.materialIds = l.materialIds.filter(x => x !== id); await db.put('lessons', l); }
  await db.del('materials', id); emit('materials');
}

// ---------- Moderation ----------
export const moderationById = id => state.moderations.find(m => m.id === id);
export async function saveModeration(m, { silent = false } = {}) {
  if (!m.id) { m.id = uid('mod_'); m.created = new Date().toISOString(); }
  const i = state.moderations.findIndex(x => x.id === m.id);
  if (i < 0) state.moderations.push(m); else state.moderations[i] = m;
  await db.put('moderations', m); if (!silent) emit('moderations');
  return m;
}
export async function deleteModeration(id) {
  state.moderations = state.moderations.filter(m => m.id !== id);
  await db.del('moderations', id); emit('moderations');
}
