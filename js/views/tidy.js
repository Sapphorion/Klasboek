// "Check grades and colours": finds classes filed under the wrong grade, subjects sharing a colour,
// and lessons sitting in another class's period, and fixes what can be fixed safely.
import { state, upsertSubject, saveLessons, saveTimetable, subjectById, subjectLabel, classGrade, classLabel, freeColour, atpById } from '../state.js';
import { h, icon, modal, toast } from '../ui.js';
import { fmt, termWeekOf } from '../dates.js';
import { ttCellAt } from '../ttday.js';

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const cellMaps = () => [['cells', state.timetable.cells || {}], ['cellsB', state.timetable.cellsB || {}]];

export function findProblems({ lessonsInPlace = true } = {}) {
  // 1. Subjects with no grade whose classes are in one or more grades.
  const noGrade = [];
  for (const s of state.subjects.filter(s => !s.grade)) {
    const grades = new Map();
    const add = cls => { const g = classGrade(cls); if (g) grades.set(g, (grades.get(g) || 0) + 1); };
    cellMaps().forEach(([, m]) => Object.values(m).filter(c => c.subjectId === s.id).forEach(c => add(c.cls)));
    state.lessons.filter(l => l.subjectId === s.id).forEach(l => add(l.cls));
    if (grades.size) noGrade.push({ s, grade: [...grades].sort((a, b) => b[1] - a[1])[0][0], grades: [...grades.keys()] });
  }
  const gradeFor = s => s.grade || noGrade.find(x => x.s === s)?.grade || '';

  // 2. Classes filed under a subject of another grade (timetable and lessons).
  const wrong = new Map(); // `${subjectId}|${grade}` -> { s, grade, classes:Set, cells, lessons }
  const note = (s, cls) => {
    const g = classGrade(cls), sg = gradeFor(s);
    if (!s || !g || !sg || g === String(sg)) return null;
    const k = `${s.id}|${g}`;
    if (!wrong.has(k)) wrong.set(k, { s, grade: g, classes: new Set(), cells: 0, lessons: [] });
    const w = wrong.get(k); w.classes.add(cls); return w;
  };
  cellMaps().forEach(([, m]) => Object.values(m).forEach(c => { const w = note(subjectById(c.subjectId), c.cls); if (w) w.cells++; }));
  state.lessons.forEach(l => { const w = note(subjectById(l.subjectId), l.cls); if (w) w.lessons.push(l); });

  // 3. Subjects sharing a colour.
  const byColour = new Map();
  state.subjects.forEach(s => { const c = (s.colour || '').toUpperCase(); byColour.set(c, [...(byColour.get(c) || []), s]); });
  const clash = [...byColour.values()].filter(list => list.length > 1);

  // 4. Lessons in a period your timetable gives to another subject or class.
  const misplaced = !lessonsInPlace ? [] : state.lessons.filter(l => {
    if (!l.date || !l.periodId) return false;
    const c = ttCellAt(l.date, l.periodId);
    if (!c?.subjectId) return false;
    if (c.subjectId !== l.subjectId) return true;
    return !!(c.cls && l.cls && c.cls !== l.cls);
  }).sort((a, b) => (a.date + a.periodId).localeCompare(b.date + b.periodId));

  return { noGrade, wrong: [...wrong.values()], clash, misplaced, count: noGrade.length + wrong.size + clash.length + misplaced.length };
}

async function fixAll(p) {
  let made = 0, movedCells = 0, movedLessons = 0, recoloured = 0;
  for (const { s, grade } of p.noGrade) { s.grade = grade; await upsertSubject(s); }
  for (const w of p.wrong) {
    let target = state.subjects.find(x => x.id !== w.s.id && sameName(x.name, w.s.name) && String(x.grade) === w.grade);
    if (!target) { target = await upsertSubject({ name: w.s.name, grade: w.grade, language: w.s.language || 'English' }); made++; }
    for (const [key, m] of cellMaps()) {
      let changed = false;
      for (const c of Object.values(m)) if (c.subjectId === w.s.id && classGrade(c.cls) === w.grade) { c.subjectId = target.id; changed = true; movedCells++; }
      if (changed) await saveTimetable({ [key]: m });
    }
    for (const l of w.lessons) {
      const a = atpById(l.atpId);
      l.subjectId = target.id;
      if (a && a.subjectId !== target.id) {
        // Link to the same week's topic in the right grade's ATP, if it has one.
        const tw = l.date ? termWeekOf(l.date) : { term: a.term, week: a.week };
        const b = tw && state.atp.find(x => x.subjectId === target.id && x.term === tw.term && tw.week >= x.week && tw.week <= (x.weekEnd || x.week));
        if (l.title === a.topic) l.title = b ? b.topic : `Choose a Gr ${target.grade} topic`;
        l.atpId = b ? b.id : '';
      }
      movedLessons++;
    }
    if (w.lessons.length) await saveLessons(w.lessons);
  }
  for (const list of p.clash) for (const s of list.slice(1)) { s.colour = freeColour(s.id); await upsertSubject(s); recoloured++; }
  return { made, movedCells, movedLessons, recoloured };
}

export function openTidy() {
  const body = h('div', { class: 'tidy' });
  const m = modal('Check grades and colours', body, { wide: true });
  const draw = () => {
    const p = findProblems();
    const kids = [];
    if (!p.count) {
      kids.push(h('p', { class: 'ok' }, icon('check', 16), ' Everything matches: every class is under the right grade, every subject has its own colour, and every lesson is in its own class’s period.'));
    }
    if (p.noGrade.length) kids.push(h('section', {}, h('h3', {}, 'Subjects without a grade'),
      h('ul', {}, p.noGrade.map(x => h('li', {}, h('strong', {}, x.s.name), ` is used for Grade ${x.grades.join(' and ')} classes. It will become Grade ${x.grade}${x.grades.length > 1 ? `, and the other grade${x.grades.length > 2 ? 's get their' : ' gets its'} own subject` : ''}.`)))));
    if (p.wrong.length) kids.push(h('section', {}, h('h3', {}, 'Classes under the wrong grade'),
      h('p', { class: 'muted small' }, 'This is why lessons of different grades share a colour and topics: they’re filed under one subject.'),
      h('ul', {}, p.wrong.map(w => {
        const exists = state.subjects.find(x => x.id !== w.s.id && sameName(x.name, w.s.name) && String(x.grade) === w.grade);
        return h('li', {}, h('strong', {}, [...w.classes].join(', ')), ` are filed under ${subjectLabel(w.s)} (${w.cells} timetable period${w.cells === 1 ? '' : 's'}, ${w.lessons.length} lesson${w.lessons.length === 1 ? '' : 's'}). They’ll move to `, h('strong', {}, exists ? subjectLabel(exists) : `${w.s.name} · Gr ${w.grade} (new subject)`), '.');
      }))));
    if (p.clash.length) kids.push(h('section', {}, h('h3', {}, 'Subjects sharing a colour'),
      h('ul', {}, p.clash.map(list => h('li', {}, h('span', { class: 'swatch', style: { background: list[0].colour } }), ' ', list.map(subjectLabel).join(', '), ` share a colour. ${list.length > 2 ? 'All but the first get' : 'The second gets'} a new one.`)))));
    const fixable = p.noGrade.length || p.wrong.length || p.clash.length;
    if (fixable) kids.push(h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
      const r = await fixAll(p);
      toast(`Fixed: ${[r.movedCells && `${r.movedCells} timetable period${r.movedCells > 1 ? 's' : ''}`, r.movedLessons && `${r.movedLessons} lesson${r.movedLessons > 1 ? 's' : ''}`, r.recoloured && `${r.recoloured} colour${r.recoloured > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'grades set'}.${r.made ? ` ${r.made} new subject${r.made > 1 ? 's' : ''} added: upload ${r.made > 1 ? 'their ATPs' : 'its ATP'} on Subjects & ATPs.` : ''}`, 'ok');
      draw();
    } }, icon('check'), 'Fix these')));
    if (p.misplaced.length) kids.push(h('section', {}, h('h3', {}, `Lessons in another class’s period (${p.misplaced.length})`),
      h('p', { class: 'muted small' }, 'Your timetable has a different class in these periods. Drag them to the right period on the planner, or leave them if that’s on purpose.'),
      h('ul', { class: 'tidy-list' }, p.misplaced.slice(0, 30).map(l => {
        const c = ttCellAt(l.date, l.periodId);
        const P = state.timetable.periods.find(x => x.id === l.periodId);
        return h('li', {}, h('a', { href: '#planner/week/' + l.date, onclick: () => m.close() }, `${fmt(l.date, { weekday: 'short', day: 'numeric', month: 'short' })} P${P?.label ?? '?'}`),
          `: ${classLabel(subjectById(l.subjectId), l.cls)} “${l.title}”, but the timetable has ${classLabel(subjectById(c.subjectId), c.cls)}`);
      })), p.misplaced.length > 30 ? h('p', { class: 'muted small' }, `…and ${p.misplaced.length - 30} more.`) : null));
    body.replaceChildren(...kids);
  };
  draw();
}
