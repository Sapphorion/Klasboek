// Calendar files (.ics) for Google Calendar and Outlook: build one from Klasboek, read one from them.
import { state, subjectById, classLabel } from './state.js';
import { addDays, iso, parse } from './dates.js';
import { allEvents, typeOf } from './events.js';
import { classifyEvent } from './importers.js';

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
const ymd = d => d.replace(/-/g, '');
const hm = t => (t || '').replace(':', '') + '00';
// "08:00", "08:00–09:00", "8:00-9:30" → { start, end }
function timesOf(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})(?:\s*[–-]\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const p = (h, mi) => `${String(h).padStart(2, '0')}:${mi}`;
  const start = p(m[1], m[2]);
  let end = m[3] ? p(m[3], m[4]) : null;
  if (!end) { const [h, mi] = start.split(':').map(Number); const e = h * 60 + mi + 60; end = p(Math.min(23, Math.floor(e / 60)), String(e % 60).padStart(2, '0')); }
  return { start, end };
}

export const FROM_EXTERNAL = /^(Google|Outlook|Calendar file)/;

// Everything Klasboek knows from `from` to `to`: calendar events, diary entries on the calendar,
// moderation deadlines, and (optionally) your planned lessons at their period times.
export function buildIcs({ from, to, lessons = false, events = true }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Klasboek//Teacher planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Klasboek'];
  let n = 0;
  const ev = (uid, date, endDate, time, title, desc, cat) => {
    L.push('BEGIN:VEVENT', `UID:${uid}@klasboek`, `DTSTAMP:${stamp}`);
    const t = timesOf(time);
    if (t) L.push(`DTSTART:${ymd(date)}T${hm(t.start)}`, `DTEND:${ymd(date)}T${hm(t.end)}`);
    else L.push(`DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(endDate || date, 1))}`);
    L.push(`SUMMARY:${esc(title)}`);
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    if (cat) L.push(`CATEGORIES:${esc(cat)}`);
    L.push('END:VEVENT'); n++;
  };
  if (events) {
    for (const e of allEvents()) {
      if ((e.endDate || e.date) < from || e.date > to) continue;
      if (FROM_EXTERNAL.test(e.source || '')) continue; // it came from Google/Outlook: don't send it back
      if (e.notice && e.type === 'reminder') continue;
      const s = subjectById(e.subjectId);
      const desc = [s ? classLabel(s, e.cls) : (e.grade ? 'Grade ' + e.grade : ''), e.noTeaching ? 'No lessons' : '', e.notes].filter(Boolean).join('\n');
      ev(e.id, e.date, e.endDate, e.time, e.title, desc, typeOf(e.type).label);
    }
  }
  if (lessons) {
    const P = state.timetable.periods;
    for (const l of state.lessons) {
      if (!l.date || l.date < from || l.date > to) continue;
      const p = P.find(x => x.id === l.periodId);
      const s = subjectById(l.subjectId);
      ev(l.id, l.date, '', p?.start ? `${p.start}-${p.end || ''}` : '', `${classLabel(s, l.cls)}: ${l.title || 'Lesson'}`, [l.subtopic, p ? 'Period ' + p.label : ''].filter(Boolean).join('\n'), 'Lesson');
    }
  }
  L.push('END:VCALENDAR');
  return { text: L.map(fold).join('\r\n') + '\r\n', count: n };
}

// ---------- Reading .ics ----------
function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function toLocal(val, params) {
  // 20261015, 20261015T083000, 20261015T063000Z → { date, time }
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-)/.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true };
  if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { date: iso(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, allDay: false }; }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false };
}

const DAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
function expand(start, rrule, until) {
  const r = Object.fromEntries(rrule.split(';').map(x => x.split('=')));
  const out = [start];
  const end = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : until;
  const max = Math.min(+r.COUNT || 400, 400);
  const step = Math.max(1, +r.INTERVAL || 1);
  if (r.FREQ === 'DAILY') { for (let d = addDays(start, step); d <= end && out.length < max; d = addDays(d, step)) out.push(d); }
  else if (r.FREQ === 'WEEKLY') {
    const days = r.BYDAY ? r.BYDAY.split(',').map(x => DAYS[x.slice(-2)]).filter(x => x !== undefined) : [parse(start).getDay()];
    const mon = addDays(start, -((parse(start).getDay() + 6) % 7));
    for (let w = 0; out.length < max; w += step) {
      const base = addDays(mon, w * 7);
      if (base > end) break;
      for (const dd of days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const d = addDays(base, (dd + 6) % 7);
        if (d > start && d <= end && out.length < max) out.push(d);
      }
    }
  }
  return out;
}

// Returns events in Klasboek's shape, between `from` and `to`.
export function parseIcs(text, { from, to, source = 'Calendar file' } = {}) {
  const lines = unfold(text).split('\n');
  const out = [];
  let cur = null, nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; nested = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { nested++; continue; }
    if (line.startsWith('END:') && line !== 'END:VEVENT') { nested--; continue; }
    if (line === 'END:VEVENT') {
      const s = cur.DTSTART && toLocal(cur.DTSTART.v, cur.DTSTART.p);
      if (s && cur.SUMMARY && !/STATUS:CANCELLED/.test(cur.STATUS?.v || '')) {
        const e = cur.DTEND && toLocal(cur.DTEND.v, cur.DTEND.p);
        let endDate = '';
        if (e) endDate = s.allDay ? addDays(e.date, -1) : e.date;
        if (endDate <= s.date) endDate = '';
        const title = unesc(cur.SUMMARY.v).trim();
        const span = endDate ? (new Date(endDate) - new Date(s.date)) / 864e5 : 0;
        const dates = cur.RRULE ? expand(s.date, cur.RRULE.v, to) : [s.date];
        const exdates = new Set((cur.EXDATE || []).flatMap(x => x.v.split(',')).map(v => toLocal(v, '')?.date).filter(Boolean));
        for (const d of dates) {
          if (exdates.has(d)) continue;
          const ed = endDate ? addDays(d, span) : '';
          if ((ed || d) < from || d > to) continue;
          const type = classifyEvent(title, /meeting|vergadering|staff|personeel|parent|ouer/i.test(title) ? 'meeting' : 'event');
          out.push({ date: d, endDate: ed, title, type, time: s.time ? s.time + (e?.time && e.time !== s.time ? '–' + e.time : '') : '',
            subjectId: '', grade: '', cls: '', notes: [cur.LOCATION ? unesc(cur.LOCATION.v) : '', cur.DESCRIPTION ? unesc(cur.DESCRIPTION.v).slice(0, 500) : ''].filter(Boolean).join('\n'),
            noTeaching: type === 'holiday', blockedPeriods: [], source, extUid: (cur.UID?.v || '') + (dates.length > 1 ? '#' + d : '') });
        }
      }
      cur = null; continue;
    }
    if (nested) continue; // skip VALARM etc.
    const i = line.indexOf(':'); if (i < 0) continue;
    const head = line.slice(0, i), v = line.slice(i + 1);
    const [name, ...params] = head.split(';');
    if (name === 'EXDATE') (cur.EXDATE ||= []).push({ v, p: params.join(';') });
    else cur[name] = { v, p: params.join(';') };
  }
  // Klasboek's own events (sent out earlier) shouldn't come back in.
  return out.filter(e => !/@klasboek$/.test(e.extUid.split('#')[0]));
}

// Google exports a .zip of .ics files: read them without any library.
export async function icsTextsFrom(file) {
  if (!/\.zip$/i.test(file.name)) return [await file.text()];
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That zip file looks damaged.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const texts = [];
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.ics$/i.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.slice(start, start + csize);
    if (method === 0) texts.push(new TextDecoder().decode(data));
    else if (method === 8) texts.push(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
  }
  if (!texts.length) throw new Error('No calendar (.ics) files in that zip.');
  return texts;
}
