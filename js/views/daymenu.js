// Tap a day on the planner: say what's different about it.
import { state, saveEvent, deleteEvents, saveTimetable } from '../state.js';
import { h, icon, toast, modal, confirmBox } from '../ui.js';
import { fmtLong, addDays } from '../dates.js';
import { eventsOn, typeOf, eventLabel } from '../events.js';
import { ttDayFor, defaultPos, allPositions, posLabel, samePos, swapsOn } from '../ttday.js';
import { afterTeachingChange, changeFor } from '../adjust.js';
import { editEvent, openEvent } from './calendar.js';
import { openTtChanges } from './ttchanges.js';

const key = p => `${p.week}|${p.day}`;
const unkey = k => { const [w, d] = k.split('|').map(Number); return { week: w, day: d }; };

export function openDayMenu(date, weekStart) {
  const body = h('div', { class: 'day-menu' });
  const m = modal(fmtLong(date), body, { wide: false });
  let form = null; // which inline form is open
  const P = state.timetable.periods;

  const draw = () => {
    const evs = eventsOn(date);
    const pos = ttDayFor(date);
    const ov = state.timetable.dayOverrides?.[date];
    const kids = [];
    if (evs.length) kids.push(h('div', { class: 'dm-existing' }, h('span', { class: 'lbl' }, 'On this day'),
      h('ul', { class: 'ev-list' }, evs.map(e => h('li', { class: 'row' },
        h('button', { class: 'ev-row', style: { '--c': typeOf(e.type).colour }, onclick: () => { m.close(); openEvent(e); } },
          h('span', { class: 'ev-type' }, typeOf(e.type).label + (e.noTeaching ? ' · no lessons' : (e.blockedPeriods || []).length ? ` · P${e.blockedPeriods.map(id => P.find(p => p.id === id)?.label).join(', P')} lost` : '')), h('strong', {}, eventLabel(e))),
        e.notice ? null : h('button', { class: 'icon-btn', 'aria-label': 'Remove ' + e.title, onclick: async () => {
          if (!await confirmBox(`Remove “${e.title}”?`, 'Remove')) return;
          await deleteEvents([e.id]); afterTeachingChange(changeFor(e, null), `“${e.title}” was removed.`); draw();
        } }, icon('trash', 16)))))));

    const choice = (id, ic, label, hint) => h('button', { class: 'dm-choice' + (form === id ? ' on' : ''), onclick: () => { form = form === id ? null : id; draw(); } }, icon(ic, 20), h('span', {}, h('strong', {}, label), h('span', { class: 'muted small' }, hint)));
    kids.push(h('div', { class: 'dm-choices' },
      choice('none', 'x', 'No school', 'Sports day, outing, public holiday…'),
      choice('half', 'grid', 'Half day', 'The second half of the day is lost'),
      choice('periods', 'grid', 'Lose some periods', 'Assembly, prize giving in P5–P7…'),
      h('button', { class: 'dm-choice', onclick: () => { m.close(); editEvent({ date, type: 'test' }); } }, icon('flag', 20), h('span', {}, h('strong', {}, 'Test or deadline'), h('span', { class: 'muted small' }, 'Shows on the lessons and in what’s coming'))),
      h('button', { class: 'dm-choice', onclick: () => { m.close(); editEvent({ date, type: 'reminder' }); } }, icon('pen', 20), h('span', {}, h('strong', {}, 'Note or reminder'), h('span', { class: 'muted small' }, 'Lessons go ahead as normal'))),
      choice('follows', 'swap', 'Different timetable day', ov ? `Follows ${posLabel(ov)}` : 'e.g. Monday follows Thursday'),
    ));

    if (form === 'none' || form === 'half' || form === 'periods') {
      const f = { title: form === 'half' ? 'Half day' : '', until: '', lost: form === 'half' ? P.slice(Math.ceil(P.length / 2)).map(p => p.id) : P.slice(-3).map(p => p.id) };
      const titleIn = h('input', { placeholder: form === 'none' ? 'What’s happening? e.g. Sports day' : 'What’s happening? e.g. Prize giving', value: f.title, oninput: e => f.title = e.target.value });
      kids.push(h('div', { class: 'dm-form' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'What’s happening'), titleIn),
        form === 'none' ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Until (if it’s more than one day)'), h('input', { type: 'date', min: date, onchange: e => f.until = e.target.value })) : null,
        form !== 'none' ? h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Periods lost'), h('div', { class: 'chips' }, P.map(p => h('label', { class: 'chip' },
          h('input', { type: 'checkbox', checked: f.lost.includes(p.id), onchange: e => { f.lost = e.target.checked ? [...f.lost, p.id] : f.lost.filter(x => x !== p.id); } }), `P${p.label}${p.start ? ' ' + p.start : ''}`)))) : null,
        h('p', { class: 'hint' }, 'Lessons in that time move to each class’s next free period, and the rest of the plan shifts along. You can undo it.'),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
          const title = f.title.trim() || (form === 'none' ? 'No school' : form === 'half' ? 'Half day' : 'Periods lost');
          if (form !== 'none' && !f.lost.length) { toast('Tick the periods that are lost.', 'error'); return; }
          const e = await saveEvent({ date, endDate: f.until && f.until > date ? f.until : '', title, type: 'event', time: '', subjectId: '', grade: '', cls: '', notes: '', noTeaching: form === 'none', blockedPeriods: form === 'none' ? [] : f.lost, source: '' });
          m.close(); toast(`${title} added.`);
          afterTeachingChange(changeFor(null, e), `${title} on ${fmtLong(date)}.`);
        } }, 'Save'))));
      requestAnimationFrame(() => titleIn.focus());
    }

    if (form === 'follows') {
      const sel = h('select', { 'aria-label': 'Follows' },
        h('option', { value: '' }, `Normal (${posLabel(defaultPos(date))})`),
        allPositions().map(p => h('option', { value: key(p), selected: !!ov && samePos(p, ov) }, posLabel(p))));
      kids.push(h('div', { class: 'dm-form' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'This day follows the timetable of'), sel),
        h('div', { class: 'row between wrap' },
          h('button', { class: 'link small', onclick: () => { m.close(); openTtChanges(weekStart); } }, 'Swap periods or change the whole week…'),
          h('button', { class: 'btn primary', onclick: async () => {
            const dayOverrides = { ...(state.timetable.dayOverrides || {}) };
            if (sel.value) dayOverrides[date] = unkey(sel.value); else delete dayOverrides[date];
            await saveTimetable({ dayOverrides }); m.close();
            toast(sel.value ? `${fmtLong(date)} follows ${posLabel(unkey(sel.value))}. Drag lessons if they need to move.` : 'Back to the normal timetable.');
          } }, 'Save'))));
    }

    const sw = swapsOn(date).length;
    kids.push(h('p', { class: 'muted small dm-status' }, pos ? `Timetable: ${posLabel(pos)}${pos.source ? ' (changed)' : ''}${sw ? ` · ${sw} period swap${sw > 1 ? 's' : ''}` : ''}` : ''));
    body.replaceChildren(...kids);
  };
  draw();
}
