// School years: open another year, or start the next one.
import { state, subjectLabel } from '../state.js';
import { h, icon, modal, toast, busy } from '../ui.js';
import { knownYears, switchYear, startYear, termsFor } from '../years.js';
import { fmt } from '../dates.js';

export function yearSwitch({ compact = false } = {}) {
  const years = knownYears();
  const cur = +state.settings.year;
  const next = Math.max(...years) + 1;
  const sel = h('select', { class: 'sm year-pick', 'aria-label': 'School year', onchange: async e => {
    const v = e.target.value;
    if (v === 'new') { e.target.value = String(cur); openNewYear(next); return; }
    try { await switchYear(+v); toast(`${v} is open.`); location.hash = 'planner'; } catch (err) { toast(err.message, 'error'); e.target.value = String(cur); }
  } }, years.map(y => h('option', { value: y, selected: y === cur }, compact ? String(y) : `${y} school year`)), h('option', { value: 'new' }, `+ Start planning ${next}`));
  return sel;
}

export function yearsSection() {
  const cur = +state.settings.year, years = knownYears(), next = Math.max(...years) + 1;
  return h('section', { class: 'card-sec' }, h('h2', {}, 'School years'),
    h('p', { class: 'muted small' }, `You’re working in ${cur}. Each year has its own subjects, ATPs, timetable and term dates. Lessons, the calendar, the diary and your materials stay, so you can look back at any time.`),
    h('div', { class: 'row wrap' }, yearSwitch(),
      h('button', { class: 'btn', onclick: () => openNewYear(next) }, icon('plus'), `Start planning ${next}`)));
}

export function openNewYear(year) {
  const t0 = termsFor(year);
  const terms = (t0.length ? t0 : [1, 2, 3, 4].map(() => ({ start: '', end: '' })));
  const rows = state.subjects.map(s => ({ id: s.id, name: s.name, grade: s.grade || '', keep: true, atp: true, atpCount: state.atp.filter(a => a.subjectId === s.id).length }));
  let timetable = true;
  const body = h('div', { class: 'stack new-year' });
  const m = modal(`Start planning ${year}`, body, { wide: true });
  const draw = () => body.replaceChildren(
    h('p', {}, `${state.settings.year} stays exactly as it is. You can switch back to it any time (the year at the top of the planner or in Settings).`),
    h('h3', {}, 'Subjects you’ll teach'),
    h('p', { class: 'muted small' }, 'Change the grade if you move up with a class. Untick subjects you won’t teach. You can add new subjects in Subjects & ATPs afterwards.'),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'mini ny-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Teach it'), h('th', {}, 'Subject'), h('th', {}, `Grade in ${year}`), h('th', {}, 'Bring the ATP'))),
      h('tbody', {}, rows.map(r => h('tr', { class: r.keep ? '' : 'off' },
        h('td', {}, h('input', { type: 'checkbox', checked: r.keep, 'aria-label': 'Teach ' + r.name, onchange: e => { r.keep = e.target.checked; draw(); } })),
        h('td', {}, h('strong', {}, r.name)),
        h('td', {}, h('input', { class: 'num', value: r.grade, 'aria-label': 'Grade', disabled: !r.keep, oninput: e => { r.grade = e.target.value.trim(); } })),
        h('td', {}, r.atpCount ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.atp && r.keep, disabled: !r.keep, onchange: e => { r.atp = e.target.checked; } }), `${r.atpCount} topics`) : h('span', { class: 'muted small' }, 'none yet'))))))) : h('p', { class: 'muted' }, 'No subjects yet; add them after starting the year.'),
    h('p', { class: 'hint' }, 'DBE often updates ATPs. If the grade changes or a new ATP comes out, untick it and upload the new one in Subjects & ATPs.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: timetable, onchange: e => { timetable = e.target.checked; } }), 'Start with my current timetable (periods and classes). I can change it later.'),
    h('h3', {}, `${year} term dates`),
    h('p', { class: 'muted small' }, t0.length ? 'The public school calendar. Change any date if your school differs.' : `I don’t have the ${year} public school calendar yet. Fill in the dates when you have them (you can also do this later in Settings).`),
    h('div', { class: 'terms-grid' }, terms.map((t, i) => h('div', { class: 'row wrap' }, h('strong', {}, `Term ${i + 1}`),
      h('input', { type: 'date', value: t.start, 'aria-label': `Term ${i + 1} start`, onchange: e => t.start = e.target.value }), h('span', {}, 'to'),
      h('input', { type: 'date', value: t.end, 'aria-label': `Term ${i + 1} end`, onchange: e => t.end = e.target.value })))),
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      (() => { const b = h('button', { class: 'btn primary' }, `Start ${year}`); b.onclick = async () => {
        const done = busy(b, 'Setting up…');
        try { await startYear({ year, terms, subjects: rows, timetable }); m.close(); toast(`${year} is ready. Plan away; switch back to ${year - 1} at the top of the planner.`); location.hash = 'planner/week/' + (terms[0]?.start || `${year}-01-15`); }
        catch (e) { toast(e.message, 'error'); } finally { done(); }
      }; return b; })()));
  draw();
}
