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
export async function writeZip(files) {
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
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
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

// ---------- Reading the Word XML ----------
const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name);
const textOf = el => [...el.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('');
const cellText = tc => kids(tc, 'p').map(textOf).join('\n');
const isEmpty = t => !String(t).replace(/[\s_.…\-–:]/g, '');
const isLabel = t => { const x = String(t).trim(); return x.length >= 2 && x.length <= 70 && /[A-Za-zÀ-ÿ]/.test(x) && !isEmpty(x); };
const INLINE = /^(.{2,60}?)\s*[:：]\s*[_.…\s]*$/; // "Topic: ________"
const WEEKDAY = /^(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|maandag|dinsdag|woensdag|donderdag|vrydag|saterdag|ma|di|wo|do|vr|sa)\.?$/i;
const DAYIDX = { mon: 0, maa: 0, ma: 0, tue: 1, din: 1, di: 1, wed: 2, woe: 2, wo: 2, thu: 3, don: 3, do: 3, fri: 4, vry: 4, vr: 4, sat: 5, sa: 5 };
const dayOf = t => { const x = String(t).trim().toLowerCase(); if (!WEEKDAY.test(x)) return -1; return DAYIDX[x.slice(0, 3)] ?? DAYIDX[x.slice(0, 2)] ?? -1; };

function parseDoc(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Klasboek couldn’t read the inside of that Word file.');
  return doc;
}
const bodyOf = doc => doc.getElementsByTagNameNS(W, 'body')[0];
const allTables = doc => [...doc.getElementsByTagNameNS(W, 'tbl')];
const rowsOf = tbl => kids(tbl, 'tr');
const cellsOf = tr => kids(tr, 'tc');
// Paragraphs that aren't inside a table.
const loneParas = doc => [...bodyOf(doc).getElementsByTagNameNS(W, 'p')].filter(p => { for (let e = p.parentNode; e; e = e.parentNode) if (e.localName === 'tc') return false; return true; });

// Find the blanks in a form. Slots point at places by position, so the same file can be filled again and again.
export function analyse(xml) {
  const doc = parseDoc(xml);
  const slots = [], tables = [], used = new Set();
  allTables(doc).forEach((tbl, ti) => {
    const rows = rowsOf(tbl).map(tr => cellsOf(tr).map(cellText));
    // A planning table: a header row of labels, then empty rows (or rows that start with a weekday).
    for (let r = 0; r < rows.length - 1; r++) {
      const hdr = rows[r];
      if (hdr.length < 2 || !hdr.every(t => isLabel(t) && !INLINE.test(t.trim()) || isEmpty(t))) continue;
      if (hdr.filter(isLabel).length < 2) continue;
      const body = [];
      for (let k = r + 1; k < rows.length; k++) {
        const row = rows[k];
        const rest = row.slice(1).every(isEmpty);
        if (row.every(isEmpty) || (rest && (WEEKDAY.test(row[0].trim()) || /^\d{1,2}$/.test(row[0].trim())))) body.push(k); else break;
      }
      if (!body.length) continue;
      const dayRows = body.every(k => WEEKDAY.test(rows[k][0].trim()));
      const cols0 = hdr.map((t, c) => ({ c, label: t.trim(), field: isLabel(t) ? (c === 0 && dayRows ? 'day' : guessField(t)) : '' }));
      const many = dayRows || cols0.some(c => ['day', 'date', 'class', 'topic', 'title', 'subtopic', 'week'].includes(c.field));
      tables.push({ ti, header: r, body, dayRows, many, cols: cols0 });
      for (let k = r; k <= body.at(-1); k++) used.add(`${ti}:${k}`);
      break;
    }
    // Label → value pairs in the rest of the table.
    rows.forEach((row, r) => {
      if (used.has(`${ti}:${r}`)) return;
      row.forEach((t, c) => {
        const x = t.trim();
        const m = x.match(INLINE);
        const rightFree = c + 1 < row.length && isEmpty(row[c + 1]) && !used.has(`${ti}:${r}:${c + 1}`);
        if (m && x.length < 80 && isEmpty(x.slice(m[1].length)) && (/[_.…]{3,}/.test(x) || !rightFree)) { slots.push({ kind: 'inline', ti, r, c, label: m[1].trim(), field: guessField(m[1]) }); used.add(`${ti}:${r}:${c}`); return; }
        if (!isLabel(x) || used.has(`${ti}:${r}:${c}`)) return;
        const right = c + 1 < row.length && isEmpty(row[c + 1]) && !used.has(`${ti}:${r}:${c + 1}`) ? [r, c + 1] : null;
        const below = !right && r + 1 < rows.length && rows[r + 1][c] !== undefined && isEmpty(rows[r + 1][c]) && !used.has(`${ti}:${r + 1}:${c}`) && !used.has(`${ti}:${r + 1}`) ? [r + 1, c] : null;
        const at = right || below;
        if (!at) return;
        used.add(`${ti}:${at[0]}:${at[1]}`); used.add(`${ti}:${r}:${c}`);
        slots.push({ kind: 'cell', ti, r: at[0], c: at[1], label: x.replace(/[:：]\s*$/, ''), field: guessField(x) });
      });
    });
  });
  loneParas(doc).forEach((p, pi) => {
    const x = textOf(p).trim();
    const m = x.match(INLINE);
    if (m && isEmpty(x.slice(m[1].length))) slots.push({ kind: 'para', pi, label: m[1].trim(), field: guessField(m[1]) });
  });
  // {{topic}} style tags typed into the form.
  const tags = [...new Set((xml.replace(/<[^>]+>/g, '').match(/\{\{\s*[^}]{1,40}\s*\}\}/g) || []).map(t => t.replace(/[{}\s]/g, '').toLowerCase()))];
  tags.forEach(t => slots.push({ kind: 'tag', tag: t, label: `{{${t}}}`, field: FIELDS.find(f => f.id.toLowerCase() === t)?.id || guessField(t) }));
  return { slots, tables, kind: tables.some(t => t.many) ? 'table' : 'lesson' };
}

// ---------- Writing ----------
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
function setCell(doc, tc, text, styleFrom) {
  let ps = kids(tc, 'p');
  if (!ps.length) { const p = doc.createElementNS(W, 'w:p'); tc.appendChild(p); ps = [p]; }
  const rPr = runProps(tc) || runProps(styleFrom);
  const p = ps[0];
  for (const n of [...p.childNodes]) if (n.nodeType === 1 && n.localName !== 'pPr') p.removeChild(n);
  // Drop the empty lines that only made the box tall, if the text needs the room anyway.
  if (String(text).split('\n').length > 1) ps.slice(1).forEach(x => { if (isEmpty(textOf(x))) tc.removeChild(x); });
  if (text) p.appendChild(makeRun(doc, text, rPr));
}
// "Topic: ______" → "Topic: Electric circuits", keeping the label's formatting.
function fillAfterColon(doc, p, text) {
  const runs = [...p.getElementsByTagNameNS(W, 'r')];
  let found = -1;
  for (let i = 0; i < runs.length && found < 0; i++) {
    const ts = [...runs[i].getElementsByTagNameNS(W, 't')];
    for (const t of ts) { const k = t.textContent.search(/[:：]/); if (k >= 0) { t.textContent = t.textContent.slice(0, k + 1) + ' '; t.setAttributeNS(XMLNS, 'xml:space', 'preserve'); found = i; break; } }
  }
  if (found < 0) return;
  runs.slice(found + 1).forEach(r => r.parentNode.removeChild(r));
  const after = runs[found];
  after.parentNode.insertBefore(makeRun(doc, text, runProps(after)), after.nextSibling);
}
function fillTags(doc, values, map) {
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')]) {
    const full = textOf(p);
    if (!/\{\{/.test(full)) continue;
    const ts = [...p.getElementsByTagNameNS(W, 't')];
    const replaced = full.replace(/\{\{\s*([^}]{1,40}?)\s*\}\}/g, (_, k) => { const key = k.replace(/\s/g, '').toLowerCase(); return values[map[key] ?? key] ?? ''; });
    const first = ts[0]; const run = first.parentNode;
    ts.forEach(t => { t.textContent = ''; });
    run.parentNode.insertBefore(makeRun(doc, replaced, runProps(run)), run);
    ts.forEach(t => { const r = t.parentNode; if (r && !textOf(r) && !r.getElementsByTagNameNS(W, 'drawing').length) r.parentNode?.removeChild(r); });
  }
}
function fillSlots(doc, format, valueOf) {
  const tbls = allTables(doc), paras = loneParas(doc);
  const tagMap = {};
  for (const s of format.slots) {
    if (!s.field) continue;
    if (s.kind === 'tag') { tagMap[s.tag] = s.field; continue; }
    const v = valueOf(s.field);
    if (s.kind === 'para') { const p = paras[s.pi]; if (p) fillAfterColon(doc, p, v); continue; }
    const tr = tbls[s.ti] && rowsOf(tbls[s.ti])[s.r];
    const tc = tr && cellsOf(tr)[s.c];
    if (!tc) continue;
    if (s.kind === 'inline') { const p = kids(tc, 'p').find(x => /[:：]/.test(textOf(x))); if (p) fillAfterColon(doc, p, v); }
    else setCell(doc, tc, v, tr);
  }
  const values = {}; for (const f of FIELDS) if (f.id) values[f.id] = valueOf(f.id);
  for (const s of format.slots) if (s.kind === 'tag' && s.field) values[s.tag] = valueOf(s.field);
  fillTags(doc, values, {});
}
function fillTable(doc, tdef, lessons) {
  const tbl = allTables(doc)[tdef.ti]; if (!tbl) return;
  const rows = rowsOf(tbl);
  const cols = tdef.cols.filter(c => c.field);
  const fillRow = (tr, ls) => { const cs = cellsOf(tr); for (const col of cols) { if (tdef.dayRows && col.c === 0) continue; if (cs[col.c]) setCell(doc, cs[col.c], joinValues(ls, col.field), rows[tdef.header]); } };
  if (tdef.dayRows) {
    for (const k of tdef.body) {
      const d = dayOf(textOf(rows[k]).trim() || cellText(cellsOf(rows[k])[0]));
      const ls = lessons.filter(l => l.date && weekdayIndex(l.date) === d);
      if (ls.length) fillRow(rows[k], ls);
    }
    return;
  }
  const bodyRows = tdef.body.map(k => rows[k]);
  const spare = bodyRows.at(-1).cloneNode(true);
  let last = bodyRows.at(-1);
  lessons.forEach((l, i) => {
    let tr = bodyRows[i];
    if (!tr) { tr = spare.cloneNode(true); last.parentNode.insertBefore(tr, last.nextSibling); }
    last = tr;
    fillRow(tr, [l]);
  });
}

// Fill a format: one page per lesson for lesson-plan forms; one document for planning tables.
export async function fillFormat(format, lessons) {
  const files = await readZip(b64bytes(format.file));
  const xml = new TextDecoder().decode(files.get('word/document.xml'));
  const sorted = lessons.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.periodId || '').localeCompare(b.periodId || ''));
  let out;
  if (format.kind === 'table') {
    const doc = parseDoc(xml);
    fillSlots(doc, format, f => joinValues(sorted, f));
    for (const t of format.tables || []) fillTable(doc, t, sorted);
    out = doc;
  } else {
    const docs = sorted.map(l => { const d = parseDoc(xml); const v = valuesFor(l); fillSlots(d, format, f => v[f] ?? ''); for (const t of format.tables || []) fillTable(d, t, [l]); return d; });
    out = docs[0] || parseDoc(xml);
    const body = bodyOf(out);
    const sect = kids(body, 'sectPr')[0];
    for (const d of docs.slice(1)) {
      const br = out.createElementNS(W, 'w:p'); const r = out.createElementNS(W, 'w:r'); const b = out.createElementNS(W, 'w:br'); b.setAttributeNS(W, 'w:type', 'page'); r.appendChild(b); br.appendChild(r);
      body.insertBefore(br, sect || null);
      for (const n of [...bodyOf(d).childNodes]) if (!(n.nodeType === 1 && n.localName === 'sectPr')) body.insertBefore(out.importNode(n, true), sect || null);
    }
  }
  files.set('word/document.xml', new XMLSerializer().serializeToString(out));
  return writeZip(files);
}

export const b64bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export async function fileToB64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function readFormatFile(file) {
  if (/\.doc$/i.test(file.name)) throw new Error('That is an old Word file (.doc). Open it in Word and use Save As → Word Document (.docx), then upload that.');
  if (!/\.docx$/i.test(file.name)) throw new Error('Upload the Word version of the form (.docx). For a PDF, ask for the Word file or open it in Word and save it as .docx.');
  const file64 = await fileToB64(file);
  const files = await readZip(b64bytes(file64));
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('That doesn’t look like a Word document.');
  return { file: file64, ...analyse(new TextDecoder().decode(xml)) };
}
// A plain-text look at the form for the setup screen.
export async function formatOutline(format) {
  const files = await readZip(b64bytes(format.file));
  const doc = parseDoc(new TextDecoder().decode(files.get('word/document.xml')));
  return allTables(doc).length;
}
