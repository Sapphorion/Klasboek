// School formats: read a school's own Word (.docx) planning form, find its blanks, and fill them
// from Klasboek's planning. No library: a .docx is a zip of XML files.
import { state, subjectById, atpById } from './state.js';
import { fmt, termWeekOf, mondayOf, addDays, weekdayIndex, minutesBetween } from './dates.js';
import { siyavulaFor } from './siyavula.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';

// ---------- Zip ----------
export async function readZip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file isn’t a Word .docx file (or it is damaged).');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.slice(start, start + csize);
    if (name.endsWith('/')) continue;
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    else throw new Error('This Word file uses a packing Klasboek can’t read. Open it in Word and save it again as .docx.');
  }
  return files;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
async function deflate(d) {
  try { return new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch { return null; }
}
export async function writeZip(files, type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const names = [...files.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
  for (const name of names) {
    const raw = typeof files.get(name) === 'string' ? enc.encode(files.get(name)) : files.get(name);
    const nb = enc.encode(name), crc = crc32(raw);
    const z = raw.length > 200 ? await deflate(raw) : null;
    const method = z && z.length < raw.length ? 8 : 0, data = method ? z : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, names.length, true); end.setUint16(10, names.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

// ---------- What Klasboek can fill in ----------
// Checked in this order, so "key terms" is vocabulary (not the school term) and "sub-topic" isn't "topic".
export const FIELDS = [
  { id: '', label: 'Leave blank' },
  { id: 'blank', label: 'Leave blank (signatures, HOD)', re: /sign|hod\b|h\.o\.d|head of|departmental|principal|handtekening|moderat|dept\.? head|deputy|approved|checked by|date (checked|signed)/i },
  { id: 'teacherAct', label: 'Teacher activities (all phases)', re: /teacher'?s? (activit|role|actions)|educator'?s? activit|onderwyser(s)? ?(aktiwiteit|rol)|opvoeder(s)? ?aktiwiteit/i },
  { id: 'learnerAct', label: 'Learner activities (all phases)', re: /learner'?s? (activit|role|actions)|pupil|leerder(s)? ?(aktiwiteit|rol)/i },
  { id: 'vocab', label: 'Vocabulary / key terms', re: /vocab|key ?(terms|words|concepts)|terminolog|woordeskat|kernwoord|begrippe|new words/i },
  { id: 'subtopic', label: 'Today’s part of the topic', re: /sub-? ?topic|lesson focus|focus|sub-? ?onderwerp|fokus/i },
  { id: 'title', label: 'Lesson title', re: /lesson (title|name|topic)|title of (the )?lesson|lesnaam|les ?titel|^title$/i },
  { id: 'topic', label: 'ATP topic', re: /topic|onderwerp|theme|tema|strand/i },
  { id: 'content', label: 'ATP content and skills', re: /content|concepts?,? (and )?skills|caps|inhoud|skills|kennis|core knowledge/i },
  { id: 'objectives', label: 'Objectives / aims', re: /objective|aim|outcome|doelwit|uitkoms|lesson goal|intention|success criteria|purpose/i },
  { id: 'prior', label: 'Prior knowledge', re: /prior|previous (knowledge|lesson)|voorkennis|baseline/i },
  { id: 'resources', label: 'Resources / LTSM', re: /resource|ltsm|material|apparatus|equipment|hulpbron|media|teaching aids|aids/i },
  { id: 'intro', label: 'Introduction', re: /intro|starter|start of (the )?lesson|opening|inleiding|hook|motivation|orientation/i },
  { id: 'conclusion', label: 'Conclusion / consolidation', re: /conclu|consolid|closure|plenary|summary|afsluit|slot|samevatting|wrap.?up|close/i },
  { id: 'main', label: 'Main part / development', re: /main|development|body|presentation|teaching|ontwikkeling|aanbieding|hoofdeel|lesson activit|activities|methodology|procedure|lesson steps/i },
  { id: 'support', label: 'Support (struggling learners)', re: /support|remedia|struggling|barrier|ondersteun|intervention/i },
  { id: 'extension', label: 'Extension / enrichment', re: /extension|enrich|gifted|verryking|advanced/i },
  { id: 'differentiation', label: 'Differentiation (support and extension)', re: /different|inclusiv|differensi|diverse needs|special needs/i },
  { id: 'assessment', label: 'Assessment', re: /assess|evaluat(ion)? (of learners|method)|informal|formal task|assessering|evaluering|classwork|check for understanding|evaluation/i },
  { id: 'homework', label: 'Homework', re: /home ?work|huiswerk|tuiswerk/i },
  { id: 'reflection', label: 'Reflection (how it went)', re: /reflect|refleksie|self-?evaluation|comment|remarks|opmerking|post.?lesson|how did/i },
  { id: 'textbook', label: 'Textbook (Siyavula chapter)', re: /textbook|text book|handboek|reference|page|bladsy/i },
  { id: 'notes', label: 'Lesson notes', re: /^notes?$|^nota/i },
  { id: 'duration', label: 'Duration (minutes)', re: /duration|duur|minutes|time allocat|tydstoekenning|tydsduur|length/i },
  { id: 'time', label: 'Period and time', re: /period|time|tyd|periode|slot/i },
  { id: 'teacher', label: 'Teacher’s name', re: /teacher|educator|onderwyser|opvoeder|^name|^naam/i },
  { id: 'school', label: 'School', re: /school|skool/i },
  { id: 'subject', label: 'Subject', re: /subject|learning area|vak|leerarea/i },
  { id: 'gradeClass', label: 'Grade and class (e.g. 10A)', re: /grade.{0,4}(class|klas)|(class|klas).{0,4}grade|graad.{0,4}klas|klas.{0,4}graad/i },
  { id: 'grade', label: 'Grade', re: /grade|graad|^gr\.?$/i },
  { id: 'class', label: 'Class', re: /class|klas/i },
  { id: 'weekRange', label: 'Week dates (Mon to Fri)', re: /week (of|ending|beginning|starting)|week dates|for the week|weeksdatum/i },
  { id: 'term', label: 'Term', re: /^term\b|kwartaal|^kw\b/i },
  { id: 'week', label: 'Week', re: /^week|week no|week number|weeknommer/i },
  { id: 'day', label: 'Day', re: /^day\b|^dag\b|^weekday/i },
  { id: 'date', label: 'Date', re: /date|datum/i },
];
export const fieldLabel = id => FIELDS.find(f => f.id === id)?.label || 'Leave blank';
export function guessField(label) {
  const t = String(label || '').replace(/[:：*_.…]+\s*$/, '').trim();
  if (!t) return '';
  const f = FIELDS.find(f => f.re && f.re.test(t));
  return f ? f.id : '';
}

const lines = a => (a || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean);
const phaseText = p => [p.teacher && String(p.teacher).trim(), p.learners && 'Learners: ' + String(p.learners).trim()].filter(Boolean).join('\n');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Everything one lesson can put into a form.
export function valuesFor(l) {
  const s = state.settings, subj = subjectById(l.subjectId), a = atpById(l.atpId), c = l.content || {};
  const period = state.timetable.periods.find(p => p.id === l.periodId);
  const tw = l.date ? termWeekOf(l.date) : null;
  const ph = c.phases || [];
  const isIntro = p => /intro|start|hook|inlei|orient|motiv/i.test(p.name || '');
  const isEnd = p => /conclu|consol|plenar|clos|summar|afsluit|slot|wrap|reflect/i.test(p.name || '');
  const intro = ph.find(isIntro) || (ph.length > 2 ? ph[0] : null);
  const end = ph.slice().reverse().find(isEnd) || (ph.length > 2 ? ph.at(-1) : null);
  const middle = ph.filter(p => p !== intro && p !== end);
  const tb = (() => { try { return siyavulaFor(subj, a?.topic || l.title, a?.details || '', l.siyavula); } catch { return null; } })();
  const minutes = l.minutes || minutesBetween(period?.start, period?.end);
  const mon = l.date ? mondayOf(l.date) : '';
  return {
    blank: '',
    teacher: s.teacherName || '', school: s.school || '',
    subject: subj?.name || '', grade: subj?.grade ? String(subj.grade) : '', class: l.cls || '',
    gradeClass: l.cls ? (subj?.grade && !String(l.cls).startsWith(String(subj.grade)) ? `${subj.grade} ${l.cls}` : l.cls) : subj?.grade ? `Grade ${subj.grade}` : '',
    date: l.date ? fmt(l.date, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    day: l.date ? DAYS[weekdayIndex(l.date)] : '',
    time: period ? `Period ${period.label}${period.start ? ` (${period.start}–${period.end})` : ''}` : '',
    duration: minutes ? `${minutes} minutes` : '',
    term: tw ? String(tw.term) : '', week: tw ? String(tw.week) : '',
    weekRange: mon ? `${fmt(mon)} – ${fmt(addDays(mon, 4), { day: 'numeric', month: 'short', year: 'numeric' })}` : '',
    topic: a?.topic || l.title || '', subtopic: l.subtopic || '', title: c.title || l.title || a?.topic || '',
    content: a?.details || '',
    objectives: lines(c.objectives).join('\n'),
    prior: c.priorKnowledge || '',
    vocab: (c.vocabulary || []).map(v => v.meaning ? `${v.term}: ${v.meaning}` : v.term).join('\n'),
    resources: lines(c.resources).join('\n'),
    intro: intro ? phaseText(intro) : '',
    main: middle.map(p => (middle.length > 1 ? `${p.name}${p.minutes ? ` (${p.minutes} min)` : ''}\n` : '') + phaseText(p)).join('\n\n'),
    conclusion: end ? phaseText(end) : '',
    teacherAct: ph.map(p => p.teacher ? `${p.name}${p.minutes ? ` (${p.minutes} min)` : ''}: ${String(p.teacher).trim()}` : '').filter(Boolean).join('\n'),
    learnerAct: ph.map(p => p.learners ? `${p.name}: ${String(p.learners).trim()}` : '').filter(Boolean).join('\n'),
    assessment: c.assessment || '',
    support: c.differentiation?.support || '', extension: c.differentiation?.extension || '',
    differentiation: [c.differentiation?.support && 'Support: ' + c.differentiation.support, c.differentiation?.extension && 'Extension: ' + c.differentiation.extension].filter(Boolean).join('\n'),
    homework: c.homework || '',
    reflection: l.reflection || '',
    textbook: tb ? `${tb.book}, ${tb.chapter}` : '',
    notes: l.notes || '',
  };
}
// Several lessons in one box (a weekly table row for a day, or a summary field).
function joinValues(lessons, field) {
  const vals = lessons.map(l => valuesFor(l)[field] || '').filter(Boolean);
  const uniq = [...new Set(vals)];
  if (['teacher', 'school', 'term', 'week', 'weekRange', 'day'].includes(field) || (uniq.length === 1 && vals.length === lessons.length)) return vals[0] || '';
  if (['subject', 'grade', 'class', 'gradeClass', 'date', 'topic'].includes(field) && uniq.length === 1) return uniq[0];
  if (['subject', 'grade', 'class', 'gradeClass'].includes(field)) return uniq.join(', ');
  if (lessons.length > 1 && !['day', 'date', 'time'].includes(field)) return lessons.map(l => { const v = valuesFor(l)[field]; return v ? `${valuesFor(l).class ? valuesFor(l).class + ': ' : ''}${v}` : ''; }).filter(Boolean).join('\n');
  return vals.join('\n');
}


// ---------- Shape of a form (shared by Word and Excel) ----------
const isEmpty = t => t == null ? false : !String(t).replace(/[\s_.…\-–:]/g, '');
const isLabel = t => { if (t == null) return false; const x = String(t).trim(); return x.length >= 2 && x.length <= 70 && /[A-Za-zÀ-ÿ]/.test(x) && !isEmpty(x); };
const INLINE = /^(.{2,60}?)\s*[:：]\s*[_.…\s]*$/; // "Topic: ________"
const WEEKDAY = /^(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|maandag|dinsdag|woensdag|donderdag|vrydag|saterdag|ma|di|wo|do|vr|sa)\.?$/i;
const DAYIDX = { mon: 0, maa: 0, ma: 0, tue: 1, din: 1, di: 1, wed: 2, woe: 2, wo: 2, thu: 3, don: 3, do: 3, fri: 4, vry: 4, vr: 4, sat: 5, sa: 5 };
const dayOf = t => { if (t == null) return -1; const x = String(t).trim().toLowerCase().replace(/\s*\d.*$/, ''); if (!WEEKDAY.test(x)) return -1; return DAYIDX[x.slice(0, 3)] ?? DAYIDX[x.slice(0, 2)] ?? -1; };
const PERIODISH = /^(p(er(iod)?|eriode)?\.?\s*|les\s*|lesson\s*)?\d{1,2}\b|^\d{1,2}[:h.]\d{2}/i;
const BREAKISH = /break|interval|pouse|lunch|recess|assembl|saal|register|registra|reg\.?$|tea\b|devotion|oggend/i;
export const GRID_FIELDS = ['gradeClass', 'subject', 'topic', 'subtopic', 'title', 'objectives', 'main', 'resources', 'assessment', 'homework'];

// A week grid: days across the top and periods down the side, or the other way round.
function findGrid(rows) {
  for (let r = 0; r < rows.length - 1; r++) {
    const dayCols = {};
    rows[r].forEach((t, c) => { const d = dayOf(t); if (d >= 0 && !(Object.values(dayCols).includes(d))) dayCols[c] = d; });
    const dc = Object.keys(dayCols).map(Number);
    if (dc.length < 3) continue;
    const body = [];
    for (let k = r + 1; k < rows.length; k++) {
      const rr = rows[k];
      if (!dc.every(c => rr[c] == null || isEmpty(rr[c]) || BREAKISH.test(rr[c]))) break;
      const label = rr.slice(0, Math.min(...dc)).filter(x => x != null).join(' ').trim();
      const brk = BREAKISH.test(label) || dc.every(c => rr[c] == null || BREAKISH.test(rr[c] || ''));
      body.push({ r: k, label, brk });
    }
    while (body.length && !body.at(-1).label) body.pop(); // empty rows after the last period
    if (body.filter(b => !b.brk).length >= 2) return { orient: 'cols', header: r, dayCols, rows: body };
  }
  const days = rows.map((row, k) => ({ r: k, d: dayOf(row[0]) })).filter(x => x.d >= 0);
  if (days.length >= 3) {
    for (let r = days[0].r - 1; r >= 0; r--) {
      const cols = [];
      rows[r].forEach((t, c) => { if (c > 0 && t != null && !isEmpty(t)) cols.push({ c, label: String(t).trim() }); });
      if (cols.length < 2) continue;
      const per = cols.filter(x => PERIODISH.test(x.label) || /period|periode|lesson|\bles\b/i.test(x.label) || BREAKISH.test(x.label));
      if (per.length >= 2 && per.length >= cols.length - 1 && days.every(x => per.every(p => rows[x.r][p.c] == null || isEmpty(rows[x.r][p.c]) || BREAKISH.test(rows[x.r][p.c])))) {
        return { orient: 'rows', header: r, cols: per.map(x => ({ ...x, brk: BREAKISH.test(x.label) })), days };
      }
      break;
    }
  }
  return null;
}

// Find the blanks in a form. tables: one grid of cell texts each (null = part of a merged cell).
// Slots point at places by position, so the same file can be filled again and again.
function analyseTables(tables) {
  const slots = [], defs = [], used = new Set();
  tables.forEach((rows, ti) => {
    const grid = findGrid(rows);
    if (grid) {
      defs.push({ ti, kind: 'grid', many: true, cellFields: ['gradeClass', 'topic', 'subtopic'], ...grid });
      if (grid.orient === 'cols') for (let k = grid.header; k <= grid.rows.at(-1).r; k++) used.add(`${ti}:${k}`);
      else { used.add(`${ti}:${grid.header}`); grid.days.forEach(d => used.add(`${ti}:${d.r}`)); }
    } else {
      // A planning table: a header row of labels, then empty rows (or rows that start with a weekday).
      for (let r = 0; r < rows.length - 1; r++) {
        const hdr = rows[r];
        if (hdr.length < 2 || !hdr.every(t => t == null || isEmpty(t) || (isLabel(t) && !INLINE.test(String(t).trim())))) continue;
        if (hdr.filter(isLabel).length < 2) continue;
        const body = [];
        for (let k = r + 1; k < rows.length; k++) {
          const row = rows[k];
          const rest = row.slice(1).every(t => t == null || isEmpty(t));
          if (row.every(t => t == null || isEmpty(t)) || (rest && (dayOf(row[0]) >= 0 || /^\d{1,2}$/.test(String(row[0] || '').trim())))) body.push(k); else break;
        }
        if (!body.length || body.every(k => rows[k].every(t => t == null))) continue;
        const dayRows = body.every(k => dayOf(rows[k][0]) >= 0);
        const cols = hdr.map((t, c) => ({ c, label: t == null ? '' : String(t).trim(), field: isLabel(t) ? (c === 0 && dayRows ? 'day' : guessField(t)) : '' }));
        const many = dayRows || cols.some(c => ['day', 'date', 'class', 'gradeClass', 'topic', 'title', 'subtopic', 'week'].includes(c.field));
        defs.push({ ti, kind: 'rows', header: r, body, dayRows, many, cols });
        for (let k = r; k <= body.at(-1); k++) used.add(`${ti}:${k}`);
        break;
      }
    }
    // Label → value pairs everywhere else.
    rows.forEach((row, r) => {
      if (used.has(`${ti}:${r}`)) return;
      row.forEach((t, c) => {
        if (t == null) return;
        const x = String(t).trim();
        const m = x.match(INLINE);
        let rc = c + 1; while (rc < row.length && row[rc] == null) rc++;
        const rightFree = rc < row.length && isEmpty(row[rc]) && !used.has(`${ti}:${r}:${rc}`);
        if (m && x.length < 80 && isEmpty(x.slice(m[1].length)) && (/[_.…]{3,}/.test(x) || !rightFree)) { slots.push({ kind: 'inline', ti, r, c, label: m[1].trim(), field: guessField(m[1]) }); used.add(`${ti}:${r}:${c}`); return; }
        if (!isLabel(x) || used.has(`${ti}:${r}:${c}`)) return;
        const right = rightFree ? [r, rc] : null;
        const below = !right && r + 1 < rows.length && isEmpty(rows[r + 1][c]) && !used.has(`${ti}:${r + 1}:${c}`) && !used.has(`${ti}:${r + 1}`) ? [r + 1, c] : null;
        const at = right || below;
        if (!at) return;
        used.add(`${ti}:${at[0]}:${at[1]}`); used.add(`${ti}:${r}:${c}`);
        slots.push({ kind: 'cell', ti, r: at[0], c: at[1], label: x.replace(/[:：]\s*$/, ''), field: guessField(x) });
      });
    });
  });
  return { slots, tables: defs };
}
const tagSlots = text => [...new Set((text.match(/\{\{\s*[^}]{1,40}\s*\}\}/g) || []).map(t => t.replace(/[{}\s]/g, '').toLowerCase()))]
  .map(t => ({ kind: 'tag', tag: t, label: `{{${t}}}`, field: FIELDS.find(f => f.id.toLowerCase() === t.toLowerCase())?.id || guessField(t) }));
const fillTagText = (text, valueOf, format) => String(text).replace(/\{\{\s*([^}]{1,40}?)\s*\}\}/g, (_, k) => {
  const key = k.replace(/\s/g, '').toLowerCase();
  const s = format.slots.find(x => x.kind === 'tag' && x.tag === key);
  return s?.field ? valueOf(s.field) : '';
});

// Which timetable period a grid row (or column) stands for: its number, its start time, or its place.
function periodFor(label, ordinal) {
  const P = state.timetable.periods;
  const tm = String(label).match(/(\d{1,2})[:h.](\d{2})/);
  if (tm) { const t = tm[1].padStart(2, '0') + ':' + tm[2]; const p = P.find(p => p.start === t); if (p) return p; }
  const n = String(label).match(/\d{1,2}/);
  if (n && !tm) { const p = P.find(p => String(p.label) === String(+n[0])); if (p) return p; }
  return P[ordinal] || null;
}
const gridText = (ls, fields) => ls.map(l => { const v = valuesFor(l); return fields.map(f => v[f]).filter(Boolean).join('\n'); }).filter(Boolean).join('\n\n');
// The same filling logic for Word and Excel: `w` knows how to write into its own file type.
function fillAll(w, format, lessons, valueOf) {
  for (const s of format.slots) {
    if (!s.field || s.kind === 'tag') continue;
    const v = valueOf(s.field);
    if (s.kind === 'para') w.para(s.pi, v);
    else if (s.kind === 'inline') w.inline(s.ti, s.r, s.c, v);
    else w.cell(s.ti, s.r, s.c, v);
  }
  w.tags(text => fillTagText(text, valueOf, format));
  for (const t of format.tables || []) {
    if (t.kind === 'grid') {
      const fields = t.cellFields?.length ? t.cellFields : ['gradeClass', 'topic'];
      if (t.orient === 'cols') {
        let ord = 0;
        for (const row of t.rows) {
          if (row.brk) continue;
          const p = periodFor(row.label, ord++); if (!p) continue;
          for (const [c, d] of Object.entries(t.dayCols)) {
            const ls = lessons.filter(l => l.date && weekdayIndex(l.date) === d && l.periodId === p.id);
            if (ls.length) w.cell(t.ti, row.r, +c, gridText(ls, fields));
          }
        }
      } else {
        let ord = 0;
        for (const col of t.cols) {
          if (col.brk) continue;
          const p = periodFor(col.label, ord++); if (!p) continue;
          for (const day of t.days) {
            const ls = lessons.filter(l => l.date && weekdayIndex(l.date) === day.d && l.periodId === p.id);
            if (ls.length) w.cell(t.ti, day.r, col.c, gridText(ls, fields));
          }
        }
      }
      continue;
    }
    const cols = t.cols.filter(c => c.field);
    const fillRow = (r, ls) => { for (const col of cols) { if (t.dayRows && col.c === 0) continue; w.cell(t.ti, r, col.c, joinValues(ls, col.field)); } };
    if (t.dayRows) {
      for (const k of t.body) { const d = w.dayAt(t.ti, k); const ls = lessons.filter(l => l.date && weekdayIndex(l.date) === d); if (ls.length) fillRow(k, ls); }
      continue;
    }
    lessons.forEach((l, i) => {
      let r = t.body[i];
      if (r == null) { r = w.addRow(t.ti, t.body.at(-1), i - t.body.length + 1); if (r == null) { w.note = `The form only has room for ${t.body.length} lessons, so the rest were left out.`; return; } }
      fillRow(r, [l]);
    });
  }
}

// ---------- Word ----------
const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name);
const textOf = el => [...el.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('');
const cellText = tc => kids(tc, 'p').map(textOf).join('\n');
function parseXml(xml, what = 'Word') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`Klasboek couldn’t read the inside of that ${what} file.`);
  return doc;
}
const bodyOf = doc => doc.getElementsByTagNameNS(W, 'body')[0];
const allTables = doc => [...doc.getElementsByTagNameNS(W, 'tbl')];
const rowsOf = tbl => kids(tbl, 'tr');
const cellsOf = tr => kids(tr, 'tc');
const loneParas = doc => [...bodyOf(doc).getElementsByTagNameNS(W, 'p')].filter(p => { for (let e = p.parentNode; e; e = e.parentNode) if (e.localName === 'tc') return false; return true; });

function analyseDocx(xml) {
  const doc = parseXml(xml);
  const r = analyseTables(allTables(doc).map(tbl => rowsOf(tbl).map(tr => cellsOf(tr).map(cellText))));
  loneParas(doc).forEach((p, pi) => {
    const x = textOf(p).trim();
    const m = x.match(INLINE);
    if (m && isEmpty(x.slice(m[1].length))) r.slots.push({ kind: 'para', pi, label: m[1].trim(), field: guessField(m[1]) });
  });
  r.slots.push(...tagSlots(xml.replace(/<[^>]+>/g, '')));
  return r;
}
function runProps(scope) {
  const r = scope && [...scope.getElementsByTagNameNS(W, 'rPr')][0];
  if (!r) return null;
  const c = r.cloneNode(true);
  for (const n of [...c.childNodes]) if (n.nodeType === 1 && ['b', 'bCs', 'u', 'i', 'iCs', 'highlight', 'shd', 'vanish', 'color'].includes(n.localName)) c.removeChild(n);
  return c;
}
function makeRun(doc, text, rPr) {
  const r = doc.createElementNS(W, 'w:r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  String(text).split('\n').forEach((line, i) => {
    if (i) r.appendChild(doc.createElementNS(W, 'w:br'));
    const t = doc.createElementNS(W, 'w:t'); t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); t.textContent = line; r.appendChild(t);
  });
  return r;
}
function setTc(doc, tc, text, styleFrom) {
  let ps = kids(tc, 'p');
  if (!ps.length) { const p = doc.createElementNS(W, 'w:p'); tc.appendChild(p); ps = [p]; }
  const rPr = runProps(tc) || runProps(styleFrom);
  const p = ps[0];
  for (const n of [...p.childNodes]) if (n.nodeType === 1 && n.localName !== 'pPr') p.removeChild(n);
  if (String(text).split('\n').length > 1) ps.slice(1).forEach(x => { if (isEmpty(textOf(x))) tc.removeChild(x); });
  if (text) p.appendChild(makeRun(doc, text, rPr));
}
function fillAfterColon(doc, p, text) {
  const runs = [...p.getElementsByTagNameNS(W, 'r')];
  let found = -1;
  for (let i = 0; i < runs.length && found < 0; i++) {
    for (const t of runs[i].getElementsByTagNameNS(W, 't')) { const k = t.textContent.search(/[:：]/); if (k >= 0) { t.textContent = t.textContent.slice(0, k + 1) + ' '; t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); found = i; break; } }
  }
  if (found < 0) return;
  runs.slice(found + 1).forEach(r => r.parentNode.removeChild(r));
  runs[found].parentNode.insertBefore(makeRun(doc, text, runProps(runs[found])), runs[found].nextSibling);
}
function docxWriter(doc) {
  const tbls = allTables(doc), paras = loneParas(doc);
  const rowsCache = tbls.map(t => rowsOf(t));
  const tcAt = (ti, r, c) => { const tr = rowsCache[ti]?.[r]; return tr ? [cellsOf(tr)[c], tr] : [null, null]; };
  return {
    cell(ti, r, c, v) { const [tc, tr] = tcAt(ti, r, c); if (tc) setTc(doc, tc, v, tr); },
    inline(ti, r, c, v) { const [tc] = tcAt(ti, r, c); const p = tc && kids(tc, 'p').find(x => /[:：]/.test(textOf(x))); if (p) fillAfterColon(doc, p, v); },
    para(pi, v) { if (paras[pi]) fillAfterColon(doc, paras[pi], v); },
    dayAt(ti, r) { const [tc] = tcAt(ti, r, 0); return tc ? dayOf(cellText(tc)) : -1; },
    addRow(ti, lastBody, n) {
      const rows = rowsCache[ti]; const last = rows[lastBody + n - 1] || rows[lastBody];
      const tr = rows[lastBody].cloneNode(true);
      for (const tc of cellsOf(tr)) setTc(doc, tc, '', null);
      last.parentNode.insertBefore(tr, last.nextSibling);
      rows.splice(lastBody + n, 0, tr);
      return lastBody + n;
    },
    tags(fn) {
      for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
        const full = textOf(p); if (!/\{\{/.test(full)) continue;
        const ts = [...p.getElementsByTagNameNS(W, 't')]; const run = ts[0].parentNode;
        ts.forEach(t => { t.textContent = ''; });
        run.parentNode.insertBefore(makeRun(doc, fn(full), runProps(run)), run);
        ts.forEach(t => { const r = t.parentNode; if (r && !textOf(r) && !r.getElementsByTagNameNS(W, 'drawing').length) r.parentNode?.removeChild(r); });
      }
    },
  };
}
async function fillDocx(format, files, sorted) {
  const xml = new TextDecoder().decode(files.get('word/document.xml'));
  let out, note = '';
  if (format.kind === 'table') {
    out = parseXml(xml); const w = docxWriter(out);
    fillAll(w, format, sorted, f => joinValues(sorted, f)); note = w.note || '';
  } else {
    const docs = sorted.map(l => { const d = parseXml(xml); const v = valuesFor(l); fillAll(docxWriter(d), format, [l], f => v[f] ?? ''); return d; });
    out = docs[0] || parseXml(xml);
    const body = bodyOf(out); const sect = kids(body, 'sectPr')[0];
    for (const d of docs.slice(1)) {
      const br = out.createElementNS(W, 'w:p'); const r = out.createElementNS(W, 'w:r'); const b = out.createElementNS(W, 'w:br'); b.setAttributeNS(W, 'w:type', 'page'); r.appendChild(b); br.appendChild(r);
      body.insertBefore(br, sect || null);
      for (const n of [...bodyOf(d).childNodes]) if (!(n.nodeType === 1 && n.localName === 'sectPr')) body.insertBefore(out.importNode(n, true), sect || null);
    }
  }
  files.set('word/document.xml', new XMLSerializer().serializeToString(out));
  const blob = await writeZip(files); blob.note = note; return blob;
}

// ---------- Excel ----------
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAXR = 300, MAXC = 40;
const colName = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const refRC = ref => { const m = String(ref).match(/^([A-Z]+)(\d+)$/); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [+m[2] - 1, c - 1]; };
const dec = b => new TextDecoder().decode(b);
function xlsxParts(files) {
  const wb = parseXml(dec(files.get('xl/workbook.xml')), 'Excel');
  const rels = parseXml(dec(files.get('xl/_rels/workbook.xml.rels')), 'Excel');
  const relMap = {}; for (const r of rels.getElementsByTagNameNS(PR, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [...wb.getElementsByTagNameNS(S, 'sheet')].map(s => {
    let t = relMap[s.getAttributeNS(R, 'id') || s.getAttribute('r:id')] || ''; t = t.replace(/^\/?xl\//, '').replace(/^\//, '');
    return { name: s.getAttribute('name'), path: 'xl/' + t };
  }).filter(s => files.has(s.path));
  const ss = files.has('xl/sharedStrings.xml') ? [...parseXml(dec(files.get('xl/sharedStrings.xml')), 'Excel').getElementsByTagNameNS(S, 'si')].map(si => [...si.getElementsByTagNameNS(S, 't')].map(t => t.textContent).join('')) : [];
  return { wb, rels, sheets, ss };
}
function sheetGrid(doc, ss) {
  const cells = new Map();
  let maxR = 0, maxC = 0;
  for (const c of doc.getElementsByTagNameNS(S, 'c')) {
    const rc = refRC(c.getAttribute('r')); if (!rc || rc[0] >= MAXR || rc[1] >= MAXC) continue;
    const t = c.getAttribute('t'), v = c.getElementsByTagNameNS(S, 'v')[0]?.textContent ?? '';
    const f = c.getElementsByTagNameNS(S, 'f').length;
    const text = f ? '\u0001' : t === 's' ? (ss[+v] ?? '') : t === 'inlineStr' ? [...c.getElementsByTagNameNS(S, 't')].map(x => x.textContent).join('') : v;
    cells.set(rc.join(','), text);
    if (text !== '' || c.hasAttribute('s')) { maxR = Math.max(maxR, rc[0] + 1); maxC = Math.max(maxC, rc[1] + 1); }
  }
  const covered = new Set();
  for (const m of doc.getElementsByTagNameNS(S, 'mergeCell')) {
    const [a, b] = (m.getAttribute('ref') || '').split(':').map(refRC); if (!a || !b) continue;
    for (let r = a[0]; r <= Math.min(b[0], MAXR - 1); r++) for (let c = a[1]; c <= Math.min(b[1], MAXC - 1); c++) if (r !== a[0] || c !== a[1]) covered.add(r + ',' + c);
    maxR = Math.max(maxR, Math.min(b[0] + 1, MAXR)); maxC = Math.max(maxC, Math.min(b[1] + 1, MAXC));
  }
  return Array.from({ length: maxR }, (_, r) => Array.from({ length: maxC }, (_, c) => covered.has(r + ',' + c) ? null : (cells.get(r + ',' + c) ?? '')));
}
function analyseXlsx(files) {
  const { sheets, ss } = xlsxParts(files);
  if (!sheets.length) throw new Error('That Excel file has no sheets Klasboek can read.');
  const grids = sheets.map(s => sheetGrid(parseXml(dec(files.get(s.path)), 'Excel'), ss));
  const r = analyseTables(grids);
  r.slots.push(...tagSlots(grids.flat(2).filter(x => typeof x === 'string').join('\n')));
  return r;
}
function xlsxWriter(sheetDocs, ss, styles) {
  const wrapCache = {};
  const wrapStyle = s => {
    if (!styles) return s;
    if (wrapCache[s] != null) return wrapCache[s];
    const xfs = styles.getElementsByTagNameNS(S, 'cellXfs')[0]; if (!xfs) return s;
    const list = [...xfs.getElementsByTagNameNS(S, 'xf')];
    const base = list[+s || 0];
    if (base?.getElementsByTagNameNS(S, 'alignment')[0]?.getAttribute('wrapText') === '1') return (wrapCache[s] = s);
    const xf = base ? base.cloneNode(true) : styles.createElementNS(S, 'xf');
    let al = xf.getElementsByTagNameNS(S, 'alignment')[0];
    if (!al) { al = styles.createElementNS(S, 'alignment'); xf.insertBefore(al, xf.firstChild); }
    al.setAttribute('wrapText', '1'); if (!al.getAttribute('vertical')) al.setAttribute('vertical', 'top');
    xf.setAttribute('applyAlignment', '1');
    xfs.appendChild(xf); xfs.setAttribute('count', String(list.length + 1));
    return (wrapCache[s] = String(list.length));
  };
  const cellEl = (doc, r, c, make = true) => {
    const data = doc.getElementsByTagNameNS(S, 'sheetData')[0];
    const ref = colName(c) + (r + 1);
    let row = [...kids(data, 'row')].find(x => +x.getAttribute('r') === r + 1);
    if (!row) {
      if (!make) return null;
      row = doc.createElementNS(S, 'row'); row.setAttribute('r', String(r + 1));
      const after = [...kids(data, 'row')].find(x => +x.getAttribute('r') > r + 1);
      data.insertBefore(row, after || null);
    }
    let cel = kids(row, 'c').find(x => x.getAttribute('r') === ref);
    if (!cel) {
      if (!make) return null;
      cel = doc.createElementNS(S, 'c'); cel.setAttribute('r', ref);
      const after = kids(row, 'c').find(x => (refRC(x.getAttribute('r'))?.[1] ?? 0) > c);
      row.insertBefore(cel, after || null);
      row.removeAttribute('spans');
    }
    return cel;
  };
  const write = (cel, text) => {
    for (const n of [...cel.childNodes]) cel.removeChild(n);
    if (!text) { cel.removeAttribute('t'); return; }
    const doc = cel.ownerDocument;
    cel.setAttribute('t', 'inlineStr');
    if (String(text).includes('\n')) cel.setAttribute('s', wrapStyle(cel.getAttribute('s') || '0'));
    const is = doc.createElementNS(S, 'is'), t = doc.createElementNS(S, 't');
    t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); t.textContent = text; is.appendChild(t); cel.appendChild(is);
  };
  const textAt = cel => { const t = cel.getAttribute('t'); return t === 's' ? ss[+(cel.getElementsByTagNameNS(S, 'v')[0]?.textContent)] ?? '' : [...cel.getElementsByTagNameNS(S, 't')].map(x => x.textContent).join('') || (cel.getElementsByTagNameNS(S, 'v')[0]?.textContent ?? ''); };
  return {
    cell(ti, r, c, v) { const d = sheetDocs[ti]; if (d) write(cellEl(d, r, c), v); },
    inline(ti, r, c, v) { const d = sheetDocs[ti]; const cel = d && cellEl(d, r, c, false); if (!cel) return; const x = textAt(cel); const k = x.search(/[:：]/); write(cel, (k >= 0 ? x.slice(0, k + 1) : x) + ' ' + v); },
    para() {},
    dayAt(ti, r) { const d = sheetDocs[ti]; const cel = d && cellEl(d, r, 0, false); return cel ? dayOf(textAt(cel)) : -1; },
    addRow() { return null; },
    tags(fn) { for (const d of sheetDocs) for (const cel of [...d.getElementsByTagNameNS(S, 'c')]) { if (cel.getElementsByTagNameNS(S, 'f').length) continue; const x = textAt(cel); if (/\{\{/.test(x)) write(cel, fn(x)); } },
  };
}
async function fillXlsx(format, files, sorted) {
  const { wb, rels, sheets, ss } = xlsxParts(files);
  const styles = files.has('xl/styles.xml') ? parseXml(dec(files.get('xl/styles.xml')), 'Excel') : null;
  const src = sheets.map(s => dec(files.get(s.path)));
  const ser = d => new XMLSerializer().serializeToString(d);
  let note = '';
  if (format.kind === 'table' || sorted.length <= 1) {
    const docs = src.map(x => parseXml(x, 'Excel'));
    const w = xlsxWriter(docs, ss, styles);
    if (format.kind === 'table') fillAll(w, format, sorted, f => joinValues(sorted, f));
    else { const v = sorted[0] ? valuesFor(sorted[0]) : {}; fillAll(w, format, sorted.slice(0, 1), f => v[f] ?? ''); }
    note = w.note || '';
    docs.forEach((d, i) => files.set(sheets[i].path, ser(d)));
  } else {
    // A lesson-plan form in Excel: one copy of the sheet per lesson.
    const ti = format.slots.find(s => s.ti != null)?.ti ?? format.tables?.[0]?.ti ?? 0;
    const sheetsEl = wb.getElementsByTagNameNS(S, 'sheets')[0];
    const firstEl = [...sheetsEl.getElementsByTagNameNS(S, 'sheet')][ti];
    let ct = dec(files.get('[Content_Types].xml'));
    let maxId = Math.max(0, ...[...sheetsEl.getElementsByTagNameNS(S, 'sheet')].map(s => +s.getAttribute('sheetId') || 0));
    const relsRoot = rels.documentElement;
    sorted.forEach((l, i) => {
      const docs = src.map(x => parseXml(x, 'Excel'));
      const v = valuesFor(l);
      fillAll(xlsxWriter(docs, ss, styles), { ...format, slots: format.slots.filter(s => s.ti == null || s.ti === ti), tables: (format.tables || []).filter(t => t.ti === ti) }, [l], f => v[f] ?? '');
      const d = docs[ti];
      if (i === 0) { files.set(sheets[ti].path, ser(d)); firstEl.setAttribute('name', sheetName(l, 0, sheets[ti].name)); return; }
      for (const tag of ['drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'tableParts', 'oleObjects', 'controls', 'hyperlinks']) for (const n of [...d.getElementsByTagNameNS(S, tag)]) n.parentNode.removeChild(n);
      for (const n of [...d.getElementsByTagNameNS(S, 'sheetView')]) n.removeAttribute('tabSelected');
      const path = `xl/worksheets/klasboek${i + 1}.xml`;
      files.set(path, ser(d));
      const rid = 'rIdKb' + (i + 1);
      const rel = rels.createElementNS(PR, 'Relationship'); rel.setAttribute('Id', rid); rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'); rel.setAttribute('Target', `worksheets/klasboek${i + 1}.xml`); relsRoot.appendChild(rel);
      const sh = wb.createElementNS(S, 'sheet'); sh.setAttribute('name', sheetName(l, i, sheets[ti].name)); sh.setAttribute('sheetId', String(++maxId)); sh.setAttributeNS(R, 'r:id', rid);
      sheetsEl.appendChild(sh);
      ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    });
    files.set('[Content_Types].xml', ct);
    files.set('xl/workbook.xml', ser(wb));
    files.set('xl/_rels/workbook.xml.rels', ser(rels));
  }
  if (styles) files.set('xl/styles.xml', ser(styles));
  // Excel recalculates formulas on opening; the old calculation order may no longer match.
  if (files.has('xl/calcChain.xml')) {
    files.delete('xl/calcChain.xml');
    const r2 = parseXml(dec(files.get('xl/_rels/workbook.xml.rels')), 'Excel');
    for (const n of [...r2.getElementsByTagNameNS(PR, 'Relationship')]) if (/calcChain/.test(n.getAttribute('Target'))) n.parentNode.removeChild(n);
    files.set('xl/_rels/workbook.xml.rels', ser(r2));
    const ctRaw = files.get('[Content_Types].xml');
    files.set('[Content_Types].xml', (typeof ctRaw === 'string' ? ctRaw : dec(ctRaw)).replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
  }
  const blob = await writeZip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); blob.note = note; return blob;
}
const sheetName = (l, i, base) => {
  const v = valuesFor(l);
  return `${(v.day || '').slice(0, 3)} ${l.date?.slice(5) || ''} ${v.class || ''}`.replace(/[\\/?*[\]:]/g, '-').trim().slice(0, 31) || `${base} ${i + 1}`.slice(0, 31);
};

// ---------- Fill a saved format ----------
// Lesson-plan forms: one page (Word) or sheet (Excel) per lesson. Planning tables and week grids: one document.
export async function fillFormat(format, lessons) {
  const files = await readZip(b64bytes(format.file));
  const sorted = lessons.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.periodId || '').localeCompare(b.periodId || ''));
  return format.type === 'xlsx' ? fillXlsx(format, files, sorted) : fillDocx(format, files, sorted);
}

export const b64bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export async function fileToB64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function readFormatFile(file) {
  if (/\.doc$/i.test(file.name)) throw new Error('That is an old Word file (.doc). Open it in Word and use Save As → Word Document (.docx), then upload that.');
  if (/\.xls$/i.test(file.name)) throw new Error('That is an old Excel file (.xls). Open it in Excel and use Save As → Excel Workbook (.xlsx), then upload that.');
  if (!/\.(docx|xlsx|xlsm)$/i.test(file.name)) throw new Error('Upload the Word (.docx) or Excel (.xlsx) version of the form. For a PDF, ask for the Word or Excel file, or open it in Word and save it as .docx.');
  const file64 = await fileToB64(file);
  const files = await readZip(b64bytes(file64));
  if (files.has('word/document.xml')) return { file: file64, type: 'docx', ...withKind(analyseDocx(dec(files.get('word/document.xml')))) };
  if (files.has('xl/workbook.xml')) return { file: file64, type: 'xlsx', ...withKind(analyseXlsx(files)) };
  throw new Error('That doesn’t look like a Word or Excel file.');
}
const withKind = r => ({ ...r, kind: r.tables.some(t => t.many) ? 'table' : 'lesson' });
export const analyse = xml => withKind(analyseDocx(xml));
