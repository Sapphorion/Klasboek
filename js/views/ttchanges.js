// "Timetable changes" for one week: which timetable day the week starts on, one-day changes,
// and period swaps. Swapping periods also swaps lessons already planned in them.
import { state, saveTimetable, saveLessons } from '../state.js';
import { h, icon, toast, modal } from '../ui.js';
import { addDays, fmt, fmtLong, inTerm } from '../dates.js';
import { ttDayFor, defaultPos, allPositions, posLabel, samePos, swapsOn, isTeachingDay } from '../ttday.js';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = p => `${p.week}|${p.day}`;
const unkey = k => { const [w, d] = k.split('|').map(Number); return { week: w, day: d }; };

export function openTtChanges(weekStart) {
  const body = h('div', { class: 'ttc' });
  const m = modal(`Timetable changes · week of ${fmt(weekStart, { day: 'numeric', month: 'long' })}`, body, { wide: true });
  const draw = () => body.replaceChildren(...content(weekStart, draw));
  draw();
}

function content(weekStart, draw) {
  const tt = state.timetable;
  const dates = tt.days.map(d => addDays(weekStart, Math.max(0, WEEK.indexOf(d))));
  const positions = allPositions();
  const weekAnchor = (tt.anchors || []).find(a => dates.includes(a.date));
  const firstDay = dates.find(isTeachingDay) || dates[0];
  const cur = ttDayFor(firstDay);

  // ---------- Week start ----------
  let scope = weekAnchor?.scope || 'week';
  const startSel = h('select', { 'aria-label': 'This week starts on' },
    h('option', { value: '' }, `As normal (${posLabel(defaultPos(firstDay)) || '—'})`),
    positions.map(p => h('option', { value: key(p), selected: !!weekAnchor && samePos(p, weekAnchor) }, posLabel(p))));
  const scopeSel = h('select', { 'aria-label': 'For how long', onchange: e => scope = e.target.value },
    h('option', { value: 'week', selected: scope === 'week' }, 'Just this week'),
    h('option', { value: 'onwards', selected: scope === 'onwards' }, 'From now on (the cycle carries on, skipping holidays)'));
  const applyStart = async () => {
    const anchors = (tt.anchors || []).filter(a => !dates.includes(a.date));
    if (startSel.value) anchors.push({ date: dates[0], ...unkey(startSel.value), scope });
    await saveTimetable({ anchors });
    toast(startSel.value ? `This week now starts on ${posLabel(unkey(startSel.value))}.` : 'This week follows the normal timetable.');
    draw();
  };
  const onwardsBefore = (tt.anchors || []).filter(a => a.scope === 'onwards' && a.date < dates[0]).sort((a, b) => a.date.localeCompare(b.date)).at(-1);

  const startSec = h('section', { class: 'ttc-sec' },
    h('h3', {}, 'This week starts on'),
    h('p', { class: 'muted small' }, 'Use this when the school says “this week starts on Day 3”, or when the day cycle has shifted after a holiday or no-school day.',
      onwardsBefore ? ` A change from ${fmt(onwardsBefore.date)} is carrying on into this week.` : ''),
    h('div', { class: 'row wrap' }, startSel, scopeSel, h('button', { class: 'btn primary', onclick: applyStart }, 'Apply')),
    cur ? h('p', { class: 'small' }, `${fmt(firstDay, { weekday: 'long' })} follows `, h('strong', {}, posLabel(cur)), '.') : null);

  // ---------- Each day ----------
  const periods = tt.periods;
  const days = h('div', { class: 'ttc-days' }, dates.map((date, i) => {
    const p = ttDayFor(date);
    const ov = tt.dayOverrides?.[date];
    const school = isTeachingDay(date);
    const follow = h('select', { 'aria-label': `${tt.days[i]} ${fmt(date)} follows`, disabled: !p, onchange: async e => {
      const dayOverrides = { ...(tt.dayOverrides || {}) };
      if (e.target.value) dayOverrides[date] = unkey(e.target.value); else delete dayOverrides[date];
      await saveTimetable({ dayOverrides });
      toast(e.target.value ? `${fmtLong(date)} follows ${posLabel(unkey(e.target.value))}. Lessons already planned stay where they are.` : 'Back to the normal day.');
      draw();
    } },
      h('option', { value: '' }, ov ? 'Normal' : `Normal (${posLabel(p)})`),
      positions.map(q => h('option', { value: key(q), selected: !!ov && samePos(q, ov) }, posLabel(q))));

    const swaps = swapsOn(date);
    const a = h('select', { 'aria-label': 'Swap period' }, periods.map(x => h('option', { value: x.id }, `Period ${x.label}`)));
    const b = h('select', { 'aria-label': 'with period' }, periods.map((x, k) => h('option', { value: x.id, selected: k === 1 }, `Period ${x.label}`)));
    const label = id => `P${periods.find(x => x.id === id)?.label ?? '?'}`;
    return h('div', { class: 'ttc-day' + (school ? '' : ' off') },
      h('div', { class: 'ttc-date' }, h('strong', {}, tt.days[i]), h('span', { class: 'muted small' }, fmt(date)), !inTerm(date) ? h('span', { class: 'muted small' }, 'holiday') : !school ? h('span', { class: 'muted small' }, 'no school') : null),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Follows'), follow),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Period swaps'),
        swaps.length ? h('div', { class: 'chips' }, swaps.map(([x, y], k) => h('span', { class: 'chip' }, `${label(x)} ⇄ ${label(y)}`,
          h('button', { class: 'icon-btn tiny', 'aria-label': `Undo swap ${label(x)} and ${label(y)}`, onclick: () => setSwap(date, k, null, draw) }, icon('x', 12))))) : null,
        h('div', { class: 'row wrap' }, a, h('span', {}, '⇄'), b, h('button', { class: 'btn ghost sm', disabled: periods.length < 2, onclick: () => {
          if (a.value === b.value) { toast('Pick two different periods.', 'error'); return; }
          if (swaps.some(([x, y]) => [x, y].includes(a.value) || [x, y].includes(b.value))) { toast('One of those periods is already swapped. Undo that swap first.', 'error'); return; }
          setSwap(date, -1, [a.value, b.value], draw);
        } }, 'Swap'))),
    );
  }));

  const anyThisWeek = weekAnchor || dates.some(d => tt.dayOverrides?.[d] || swapsOn(d).length);
  return [
    startSec,
    h('section', { class: 'ttc-sec' }, h('h3', {}, 'Day by day'), h('p', { class: 'muted small' }, 'Change one day (“Monday follows Thursday’s timetable”) or swap periods. Swapping also swaps lessons you’ve already planned in those periods.'), days),
    h('div', { class: 'row between' },
      anyThisWeek ? h('button', { class: 'btn ghost danger sm', onclick: async () => {
        const dayOverrides = { ...(tt.dayOverrides || {}) }; const swapsAll = { ...(tt.swaps || {}) };
        for (const d of dates) { delete dayOverrides[d]; if (swapsAll[d]) { await swapLessons(d, swapsAll[d]); delete swapsAll[d]; } }
        await saveTimetable({ anchors: (tt.anchors || []).filter(x => !dates.includes(x.date)), dayOverrides, swaps: swapsAll });
        toast('This week is back to the normal timetable.'); draw();
      } }, 'Undo all changes this week') : h('span'),
      h('a', { class: 'small', href: '#timetable', onclick: () => document.querySelector('dialog.modal')?.close() }, 'See all timetable changes')),
  ];
}

// Add (pair) or remove (index) a swap on a date, moving planned lessons to match.
async function setSwap(date, removeIndex, pair, draw) {
  const swaps = { ...(state.timetable.swaps || {}) };
  const list = [...(swaps[date] || [])];
  let changed;
  if (pair) { list.push(pair); changed = pair; } else { changed = list.splice(removeIndex, 1)[0]; }
  if (list.length) swaps[date] = list; else delete swaps[date];
  await swapLessons(date, [changed]);
  await saveTimetable({ swaps });
  toast(pair ? 'Periods swapped. Planned lessons moved with them.' : 'Swap undone.');
  draw();
}

async function swapLessons(date, pairs) {
  const moved = [];
  for (const [a, b] of pairs) {
    for (const l of state.lessons.filter(l => l.date === date && (l.periodId === a || l.periodId === b))) {
      l.periodId = l.periodId === a ? b : a; moved.push(l);
    }
  }
  if (moved.length) await saveLessons(moved);
}

// For the Timetable page: every change, with a way to remove it.
export function changesList() {
  const tt = state.timetable;
  const rows = [];
  for (const a of (tt.anchors || []).slice().sort((x, y) => x.date.localeCompare(y.date))) {
    rows.push({ date: a.date, text: `Week of ${fmt(a.date)} starts on ${posLabel(a)}${a.scope === 'onwards' ? ', and carries on from there' : ' (that week only)'}`,
      remove: () => saveTimetable({ anchors: tt.anchors.filter(x => x !== a) }) });
  }
  for (const [d, p] of Object.entries(tt.dayOverrides || {})) {
    rows.push({ date: d, text: `${fmtLong(d)} follows ${posLabel(p)}`, remove: () => { const o = { ...tt.dayOverrides }; delete o[d]; return saveTimetable({ dayOverrides: o }); } });
  }
  for (const [d, list] of Object.entries(tt.swaps || {})) {
    const lab = id => `P${tt.periods.find(x => x.id === id)?.label ?? '?'}`;
    rows.push({ date: d, text: `${fmtLong(d)}: ${list.map(([a, b]) => `${lab(a)} ⇄ ${lab(b)}`).join(', ')}`,
      remove: async () => { await swapLessons(d, list); const s = { ...tt.swaps }; delete s[d]; return saveTimetable({ swaps: s }); } });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return h('section', { class: 'card-sec wide tt-changes' },
    h('h2', {}, 'Timetable changes'),
    h('p', { class: 'muted small' }, 'Made from the planner with “Timetable changes”: weeks that start on a different day, days that follow another day’s timetable, and period swaps.'),
    rows.length ? h('ul', { class: 'ev-list' }, rows.map(r => h('li', { class: 'row between' }, h('span', {}, r.text), h('button', { class: 'btn ghost sm', onclick: r.remove }, 'Remove'))))
      : h('p', { class: 'muted' }, 'None. The planner follows the timetable as normal.'));
}
