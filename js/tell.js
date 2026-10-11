// "Tell the planner": turn a sentence like
//   "Monday – Spring School, Tuesday normal, Wednesday and Thursday prize giving, Friday normal"
// into calendar events for the week on screen. Works offline; Claude helps when the wording is unusual.
import { state } from './state.js';
import { addDays, fmt, today } from './dates.js';
import { findDates, classifyEvent } from './importers.js';

const DAY_WORDS = [
  ['monday', 'mon', 'maandag'], ['tuesday', 'tues', 'tue', 'dinsdag'], ['wednesday', 'wed', 'woensdag'], ['thursday', 'thurs', 'thur', 'thu', 'donderdag'],
  ['friday', 'fri', 'vrydag'], ['saturday', 'sat', 'saterdag'], ['sunday', 'sun', 'sondag'],
];
const DAY_RE = new RegExp(`\\b(${DAY_WORDS.flat().sort((a, b) => b.length - a.length).join('|')})\\b\\.?`, 'gi');
const dayIndex = w => DAY_WORDS.findIndex(list => list.includes(w.toLowerCase().replace('.', '')));
const NORMAL = /^(?:it'?s |was |is |will be )?(?:a )?(?:normal|ordinary|gewone|normale|as usual|soos gewoonlik|regular)\b|^school as normal$|^nothing$/i;
const FILLER = /^(?:and|&|en|to|tot|-|–|—|:|is|was|will be|it's|it is|on|op|has|had|we have|we had|there is|there was|the)\b\s*/i;

export function parseTell(text, weekStart, year) {
  const items = [], normal = [], unknown = [];
  const periods = state.timetable.periods;
  const segments = String(text).split(/[,;\n]+|\.\s+/).map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    let rest = seg;
    const dates = [];
    // Weekday names → dates in the week on screen.
    rest = rest.replace(DAY_RE, (m, w) => { const i = dayIndex(w); if (i >= 0) dates.push(addDays(weekStart, i)); return ' '; });
    rest = rest.replace(/\b(today|vandag)\b/gi, () => { dates.push(today()); return ' '; });
    rest = rest.replace(/(?:\btomorrow\b|môre)/gi, () => { dates.push(addDays(today(), 1)); return ' '; });
    for (const d of findDates(rest, year).reverse()) {
      for (let x = d.start; x <= d.end; x = addDays(x, 1)) dates.push(x);
      rest = rest.slice(0, d.from) + ' ' + rest.slice(d.to);
    }
    if (dates.length >= 2 && /\b(to|until|tot|-|–)\b/.test(seg) && !/\b(and|&|en)\b/.test(seg)) {
      // "Monday to Wednesday" → every day in between
      const [a, b] = [dates[0], dates.at(-1)].sort();
      dates.length = 0; for (let x = a; x <= b; x = addDays(x, 1)) dates.push(x);
    }
    let title = rest.replace(/\s+/g, ' ').trim();
    for (let k = 0; k < 6; k++) title = title.replace(/^[\s\-–—:.,]+/, '').replace(FILLER, '').replace(/[\s\-–—:]+$/, '').trim();
    if (!dates.length) { if (title) unknown.push(seg); continue; }
    const uniq = [...new Set(dates)].sort();
    if (!title || NORMAL.test(title)) { normal.push(...uniq); continue; }

    // Which periods? "periods 5-7", "P5 and P6", "after break", "last two periods", "half day"
    let lost = [];
    const range = title.match(/\b(?:periods?|periodes?|p)\s*(\d{1,2})\s*(?:-|–|to|tot|and|&|en)\s*(?:p\s*)?(\d{1,2})\b/i);
    const list = [...title.matchAll(/\bp(?:eriod)?\s*(\d{1,2})\b/gi)].map(m => m[1]);
    const idx = lbl => periods.findIndex(p => String(p.label) === String(lbl));
    if (range) { const a = idx(range[1]), b = idx(range[2]); if (a >= 0 && b >= a) lost = periods.slice(a, b + 1).map(p => p.id); }
    else if (list.length) lost = list.map(idx).filter(i => i >= 0).map(i => periods[i].id);
    else if (/after (?:first )?break|na pouse/i.test(title)) lost = periods.slice(breakIndex(periods)).map(p => p.id);
    else if (/before (?:first )?break|voor pouse/i.test(title)) lost = periods.slice(0, breakIndex(periods)).map(p => p.id);
    else if (/half(?:- | )?day|halwe dag|early closing|vroeg uit/i.test(title)) lost = periods.slice(Math.ceil(periods.length / 2)).map(p => p.id);
    else { const m = title.match(/\blast (one|two|three|four|\d) periods?\b/i); if (m) { const n = { one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] || +m[1]; lost = periods.slice(-n).map(p => p.id); } }
    title = title.replace(/\b(?:in |during )?(?:periods?|p)\s*\d{1,2}(?:\s*(?:-|–|to|and|&)\s*(?:p\s*)?\d{1,2})?\b/gi, '').replace(/\s+/g, ' ').trim();
    const stripped = title.replace(/\b(?:after|before|na|voor) (?:first )?(?:break|pouse)\b|\blast (?:one|two|three|four|\d) periods?\b/gi, '').replace(/\s+/g, ' ').trim();
    if (stripped) title = stripped;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const kind = classifyEvent(title, 'event');
    const effect = lost.length ? 'periods' : ['meeting', 'test', 'deadline'].includes(kind) ? 'note' : 'none';
    // Consecutive days become one event; separate days become separate events.
    let run = [uniq[0]];
    const flush = () => items.push({ date: run[0], endDate: run.length > 1 ? run.at(-1) : '', title, type: kind === 'event' ? 'event' : kind, effect, periods: lost });
    for (let i = 1; i < uniq.length; i++) { if (uniq[i] === addDays(run.at(-1), 1)) run.push(uniq[i]); else { flush(); run = [uniq[i]]; } }
    flush();
  }
  return { items, normal: [...new Set(normal)].sort(), unknown };
}

// The first break is the first gap between periods (by their times); otherwise halfway.
function breakIndex(periods) {
  const m = s => { const [a, b] = String(s || '').split(':').map(Number); return a * 60 + (b || 0); };
  for (let i = 1; i < periods.length; i++) if (periods[i].start && periods[i - 1].end && m(periods[i].start) - m(periods[i - 1].end) >= 10) return i;
  return Math.ceil(periods.length / 2);
}

export const describeDays = dates => dates.map(d => fmt(d, { weekday: 'long', day: 'numeric', month: 'short' })).join(', ');
