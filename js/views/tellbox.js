// The "Tell the planner" box and its confirm step.
import { state, saveEvents } from '../state.js';
import { h, icon, toast, modal, busy } from '../ui.js';
import { addDays, fmt } from '../dates.js';
import { parseTell, describeDays } from '../tell.js';
import { aiTell, aiReady } from '../ai.js';
import { afterTeachingChange } from '../adjust.js';
import { EVENT_TYPES } from '../events.js';

export function tellBox(weekStart, days, { onDone } = {}) {
  const input = h('input', { placeholder: 'Tell the planner what’s happening, e.g. “Monday Spring School, Wednesday and Thursday prize giving”', 'aria-label': 'Tell the planner what’s happening this week', onkeydown: e => { if (e.key === 'Enter') go.click(); } });
  const go = h('button', { class: 'btn' }, icon('wand'), 'Update the week');
  go.onclick = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const year = +weekStart.slice(0, 4);
    let r = parseTell(text, weekStart, year);
    if (!r.items.length && !r.normal.length && aiReady()) {
      const done = busy(go, 'Reading…');
      try {
        const items = await aiTell(text, days.map(d => ({ label: d.label, date: d.date })), state.timetable.periods, year);
        r = { normal: items.filter(i => i.effect === 'normal').map(i => i.date), unknown: [], items: items.filter(i => i.effect !== 'normal').map(i => ({
          date: i.date, endDate: i.endDate && i.endDate > i.date ? i.endDate : '', title: i.title, type: 'event', effect: i.effect,
          periods: (i.periods || []).map(lbl => state.timetable.periods.find(p => String(p.label) === String(lbl))?.id).filter(Boolean) })) };
      } catch (e) { toast(e.message, 'error'); } finally { done(); }
    }
    if (!r.items.length && !r.normal.length) { toast('I couldn’t find any days in that. Try “Monday prize giving” or “14 Oct sports day”.', 'warn'); return; }
    confirmTell(r, () => { input.value = ''; onDone?.(); });
  };
  return h('div', { class: 'tell-box' }, icon('pen', 18), input, go);
}

function confirmTell(r, onDone) {
  const rows = r.items.map(i => ({ ...i, keep: true }));
  const body = h('div', {});
  const m = modal('Is this right?', body, { wide: true });
  const P = state.timetable.periods;
  const draw = () => body.replaceChildren(
    rows.length ? h('p', {}, 'I’ll add these to the calendar and adjust the planner:') : null,
    rows.length ? h('div', { class: 'tell-rows' }, rows.map(it => h('div', { class: 'tell-row' + (it.keep ? '' : ' off') },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.keep, 'aria-label': 'Include ' + it.title, onchange: e => { it.keep = e.target.checked; draw(); } })),
      h('div', { class: 'stack' },
        h('div', { class: 'row wrap' },
          h('input', { type: 'date', value: it.date, 'aria-label': 'Date', onchange: e => it.date = e.target.value }),
          h('span', { class: 'muted small' }, 'to'),
          h('input', { type: 'date', value: it.endDate || '', 'aria-label': 'Until', onchange: e => it.endDate = e.target.value }),
          h('input', { class: 'tell-title', value: it.title, 'aria-label': 'What', oninput: e => it.title = e.target.value })),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Effect on lessons' }, [['none', 'No lessons'], ['periods', 'Some periods lost'], ['note', 'Lessons as normal (note only)']].map(([k, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(it.effect === k), onclick: () => { it.effect = k; if (k === 'periods' && !it.periods.length) it.periods = P.slice(-3).map(p => p.id); draw(); } }, l))),
        it.effect === 'periods' ? h('div', { class: 'chips' }, P.map(p => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: it.periods.includes(p.id), onchange: e => { it.periods = e.target.checked ? [...it.periods, p.id] : it.periods.filter(x => x !== p.id); } }), `P${p.label}`))) : null)))) : null,
    r.normal.length ? h('p', { class: 'muted small' }, `Normal school: ${describeDays(r.normal)}. Nothing changes on ${r.normal.length > 1 ? 'those days' : 'that day'}.`) : null,
    r.unknown.length ? h('p', { class: 'warn small' }, `I didn’t understand: “${r.unknown.join('”, “')}”. Add ${r.unknown.length > 1 ? 'them' : 'it'} on the calendar if needed.`) : null,
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      rows.length ? h('button', { class: 'btn primary', onclick: async () => {
        const list = rows.filter(x => x.keep && x.date && x.title.trim()).map(x => ({
          date: x.date, endDate: x.endDate && x.endDate > x.date ? x.endDate : '', title: x.title.trim(),
          type: EVENT_TYPES.some(t => t.id === x.type) ? x.type : 'event', time: '', subjectId: '', grade: '', cls: '', notes: '',
          noTeaching: x.effect === 'none', blockedPeriods: x.effect === 'periods' ? x.periods : [], source: 'Told the planner',
        }));
        if (!list.length) { m.close(); return; }
        await saveEvents(list); m.close(); onDone();
        toast(`Added ${list.length} event${list.length > 1 ? 's' : ''} to the calendar.`);
        const blocked = list.filter(e => e.noTeaching || e.blockedPeriods.length).map(e => ({ from: e.date, to: e.endDate || e.date }));
        if (blocked.length) afterTeachingChange({ blocked });
      } }, 'Add and adjust the planner') : h('button', { class: 'btn primary', onclick: () => { m.close(); onDone(); } }, 'OK')),
  );
  draw();
}

// The same box in a pop-up, opened from the planner toolbar.
export function openTell(weekStart, days) {
  let m;
  const box = tellBox(weekStart, days, { onDone: () => m.close() });
  m = modal('Tell the planner', [
    h('p', { class: 'muted' }, 'Say what’s different in plain words. Lessons that lose their period move along to the next one.'),
    box,
    h('ul', { class: 'tell-examples muted small' },
      ['Monday Spring School, Tuesday normal, Wednesday and Thursday prize giving', 'Friday half day', '14 Oct sports day', 'Lose P6 and P7 on Thursday for assembly'].map(t =>
        h('li', {}, h('button', { class: 'link', onclick: () => { const i = box.querySelector('input'); i.value = t; i.focus(); } }, `“${t}”`)))),
  ], { wide: true });
  requestAnimationFrame(() => box.querySelector('input')?.focus());
}
