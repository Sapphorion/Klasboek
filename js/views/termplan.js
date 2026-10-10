// Upload a term planner (a department's or your own week-by-week plan for one term)
// into a subject's weekly topics for that term. Works with "Week 1, Week 2…" plans
// and with plans that use dates ("12–16 Oct: Trigonometry").
import { state, subjectLabel } from '../state.js';
import { h, toast, modal, dropZone } from '../ui.js';
import { readAtpFile, readCalendarFile } from '../importers.js';
import { termWeekOf, termWeeks } from '../dates.js';
import { reviewDialog } from './subjects.js';

export function openTermPlanUpload(currentTerm) {
  if (!state.subjects.length) { toast('Add a subject first, on the Subjects page.', 'warn'); location.hash = 'subjects'; return; }
  const f = { subjectId: state.subjects[0].id, term: currentTerm || 1 };
  const status = h('div', { 'aria-live': 'polite' });
  const m = modal('Upload a term plan', [
    h('p', { class: 'muted' }, 'A term plan lists what you teach each week of one term. It replaces that term’s topics for the subject; the ATP for the other terms stays as it is.'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('select', { onchange: e => f.subjectId = e.target.value }, state.subjects.map(s => h('option', { value: s.id }, subjectLabel(s))))),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Term'), h('select', { onchange: e => f.term = +e.target.value }, [1, 2, 3, 4].map(t => h('option', { value: t, selected: t === f.term }, `Term ${t}${termWeeks(t) ? ` (${termWeeks(t)} weeks)` : ''}`))))),
    dropZone({ accept: '.pdf,.docx,.xlsx,.xls,.csv', label: 'Upload the term plan', hint: 'PDF, Word or Excel, with week numbers or dates', onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try {
        const { items, text } = await readTermPlan(file, f.term);
        const s = state.subjects.find(x => x.id === f.subjectId);
        m.close();
        reviewDialog(s, items, file.name, text, { term: f.term, normalize: list => toTerm(list, f.term) });
      } catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    } }),
    status,
  ]);
}

// Keep the chosen term: if the file covers several terms take that term's rows, otherwise treat it all as that term.
function toTerm(items, term) {
  const mine = items.filter(i => i.term === term);
  const list = (mine.length ? mine : items).map(i => ({ ...i, term, weekEnd: i.weekEnd || i.week }));
  return list.sort((a, b) => a.week - b.week);
}

async function readTermPlan(file, term) {
  let items = [], text = '', err = null;
  try { const r = await readAtpFile(file); items = r.items; text = r.text; } catch (e) { err = e; }
  if (items.length >= 2) return { items: toTerm(items, term), text };
  // Date-based plan: turn each dated row into a week of the term.
  try {
    const r = await readCalendarFile(file, 'planner', state.settings.year || new Date().getFullYear());
    text = text || r.text;
    const byWeek = new Map();
    for (const e of r.events) {
      const a = termWeekOf(e.date), b = e.endDate ? termWeekOf(e.endDate) : a;
      if (!a || a.term !== term) continue;
      const key = a.week;
      const it = byWeek.get(key) || { term, week: a.week, weekEnd: b && b.term === term ? b.week : a.week, topic: '', details: [] };
      if (!it.topic) it.topic = e.title; else it.details.push(e.title);
      byWeek.set(key, it);
    }
    const dated = [...byWeek.values()].map(i => ({ ...i, details: i.details.join('\n') }));
    if (dated.length) return { items: dated.sort((x, y) => x.week - y.week), text };
  } catch (e) { err = err || e; }
  if (items.length) return { items: toTerm(items, term), text };
  if (err && !text) throw err;
  return { items: [], text };
}
