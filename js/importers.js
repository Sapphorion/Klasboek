// Reading uploaded files: ATPs (PDF / Word / Excel), timetables (Excel / Word) and marksheets.
// Everything here runs offline. The AI path in ai.js is an optional upgrade on top.
import { loadScript } from './ui.js';

// ---------- File → raw content ----------
let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}
const loadXlsx = () => loadScript('vendor/xlsx.full.min.js').then(() => window.XLSX);
const loadMammoth = () => loadScript('vendor/mammoth.browser.min.js').then(() => window.mammoth);

const ext = f => (f.name.split('.').pop() || '').toLowerCase();
export const kindOf = f => {
  const e = ext(f);
  if (e === 'pdf') return 'pdf';
  if (['docx', 'doc'].includes(e)) return 'docx';
  if (['xlsx', 'xls', 'csv', 'ods'].includes(e)) return 'sheet';
  if (['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(e) || f.type.startsWith('image/')) return 'image';
  return 'other';
};

// PDF pages as positioned text chunks.
async function pdfPages(file) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({
      str: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8,
    }));
    pages.push(chunksFromItems(items));
  }
  return pages;
}

// Merge items that sit next to each other on a line into readable chunks.
function chunksFromItems(items) {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find(l => Math.abs(l.y - it.y) < Math.max(2.5, it.h * 0.35));
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  const chunks = [];
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of l.items) {
      const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
      if (cur && gap < Math.max(4, it.h * 0.9)) {
        cur.str += (gap > it.h * 0.15 && !cur.str.endsWith(' ') ? ' ' : '') + it.str;
        cur.w = it.x + it.w - cur.x;
      } else {
        cur = { ...it }; chunks.push(cur);
      }
    }
  }
  return chunks.map(c => ({ ...c, str: c.str.replace(/\s+/g, ' ').trim() })).filter(c => c.str);
}

function pagesToText(pages) {
  return pages.map(chunks => {
    const lines = [];
    for (const c of chunks) {
      const l = lines.find(l => Math.abs(l.y - c.y) < 3);
      if (l) l.parts.push(c); else lines.push({ y: c.y, parts: [c] });
    }
    return lines.sort((a, b) => a.y - b.y).map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join('  |  ')).join('\n');
  }).join('\n\n');
}

// Tables from a .docx as 2-D arrays (merged cells repeated so columns line up).
async function docxTablesAndText(file) {
  const mammoth = await loadMammoth();
  const buf = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const dom = new DOMParser().parseFromString(html, 'text/html');
  dom.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  const tables = [...dom.querySelectorAll('table')].filter(t => !t.parentElement.closest('table'));
  const grids = tables.map(t => {
    const g = tableToGrid(t);
    // A heading such as "Term 4" just above the table tells us the term.
    let el = t.previousElementSibling, hint = null;
    for (let i = 0; el && i < 6 && !hint; i++, el = el.previousElementSibling) { if (el.tagName === 'TABLE') break; const m = el.textContent.match(TERM_RE); if (m) hint = +m[1]; }
    g.termHint = hint;
    return g;
  });
  // Paragraphs and table rows in document order (for calendars with month headings between tables).
  const ordered = [];
  const walk = el => {
    for (const ch of el.children) {
      if (ch.tagName === 'TABLE') { const i = tables.indexOf(ch); if (i >= 0) ordered.push(...grids[i]); }
      else if (/^(P|H\d|LI)$/.test(ch.tagName)) { const t = ch.textContent.trim(); if (t) ordered.push([t]); }
      else walk(ch);
    }
  };
  walk(dom.body);
  const text = dom.body.innerText || dom.body.textContent;
  return { grids, text, html, ordered };
}

function tableToGrid(table) {
  const grid = [];
  [...table.rows].forEach((row, r) => {
    grid[r] ||= [];
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c] !== undefined) c++;
      const txt = ([...cell.querySelectorAll('p, li')].map(p => p.textContent.trim()).filter(Boolean).join('\n') || cell.textContent.trim()).replace(/[ \t]*\n[ \t]*/g, '\n');
      const cs = cell.colSpan || 1, rs = cell.rowSpan || 1;
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
        grid[r + i] ||= [];
        grid[r + i][c + j] = (i === 0 && j === 0) ? txt : (j > 0 ? txt : '');
      }
      c += cs;
    }
  });
  return grid.map(r => Array.from(r, v => v ?? ''));
}

async function sheetGrids(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    // Expand merged cells so headers sit above every column they cover.
    for (const m of ws['!merges'] || []) {
      const v = ws[XLSX.utils.encode_cell(m.s)];
      if (!v) continue;
      for (let c = m.s.c; c <= m.e.c; c++) for (let r = m.s.r; r <= m.e.r; r++) {
        const a = XLSX.utils.encode_cell({ r, c });
        if (!ws[a]) ws[a] = { ...v };
      }
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    return { name, grid: rows.map(r => r.map(v => String(v ?? '').trim())) };
  });
}

export function gridToText(grid) { return grid.map(r => r.filter(Boolean).join('  |  ')).filter(Boolean).join('\n'); }

// ---------- ATP parsing ----------
const WEEK_RE = /^(?:week|weke|wk|wks|weeks)\s*(\d{1,2})(?:\s*(?:-|–|—|&|and|to|en|tot|\/)\s*(?:week\s*)?(\d{1,2}))?\b\.?:?\s*(.*)$/is;
const TERM_RE = /\b(?:term|kwartaal|kw)\s*(\d)\b/i;
const TOPIC_LABEL = /topic|onderwerp|theme|tema|content area|strand/i;

function weekMatch(s) {
  const m = String(s).trim().match(WEEK_RE);
  if (!m) return null;
  const week = +m[1], weekEnd = m[2] ? +m[2] : week;
  if (week < 1 || week > 14 || weekEnd < week) return null;
  return { week, weekEnd, rest: (m[3] || '').trim() };
}

class Collector {
  constructor() { this.map = new Map(); this.term = 1; this.lastWeek = 0; }
  setTerm(t) { if (t >= 1 && t <= 4 && t !== this.term) { this.term = t; this.lastWeek = 0; } }
  bump(week) { // Week numbers restarting means a new term even if no "Term" label was found.
    if (week < this.lastWeek - 2 && this.term < 4) this.term++;
    this.lastWeek = Math.max(this.lastWeek, week);
  }
  add(week, weekEnd, { topic = '', details = '' }) {
    const key = `${this.term}|${week}`;
    let it = this.map.get(key);
    if (!it) { it = { term: this.term, week, weekEnd, topic: '', details: [] }; this.map.set(key, it); }
    it.weekEnd = Math.max(it.weekEnd, weekEnd);
    if (topic && !it.topic) it.topic = clean(topic);
    else if (topic && !it.topic.includes(clean(topic))) it.details.push(clean(topic));
    for (const line of String(details).split(/\n+/)) { const l = clean(line); if (l && l !== it.topic) it.details.push(l); }
  }
  result() {
    return [...this.map.values()].map(it => {
      let details = [...new Set(it.details)];
      let topic = it.topic;
      if (!topic && details.length) { topic = details.shift(); }
      if (topic.length > 90) { details.unshift(topic); topic = topic.slice(0, 80).replace(/\s\S*$/, '') + '…'; }
      return { term: it.term, week: it.week, weekEnd: it.weekEnd, topic: topic || `Week ${it.week}`, details: details.join('\n') };
    }).filter(it => it.topic || it.details).sort((a, b) => a.term - b.term || a.week - b.week);
  }
}
const clean = s => String(s || '').replace(/[•●▪■◦]\s*/g, '').replace(/\s+/g, ' ').trim();

function parseAtpPages(pages) {
  const col = new Collector();
  for (const chunks of pages) {
    const marked = chunks.map(c => ({ ...c, wk: weekMatch(c.str), tm: c.str.match(TERM_RE) }));
    const markers = marked.filter(c => c.wk && c.str.length < 40);
    // Group markers into header rows.
    const rows = [];
    for (const m of markers) {
      const r = rows.find(r => Math.abs(r.y - m.y) < 6);
      if (r) r.ms.push(m); else rows.push({ y: m.y, ms: [m] });
    }
    const headerRows = rows.filter(r => r.ms.length >= 2).sort((a, b) => a.y - b.y);

    if (headerRows.length) {
      // Horizontal: weeks are column headings.
      headerRows.forEach((hr, idx) => {
        const yEnd = headerRows[idx + 1]?.y ?? Infinity;
        const termAbove = marked.filter(c => c.tm && c.y <= hr.y + 2 && (idx === 0 || c.y > headerRows[idx - 1].y)).pop();
        if (termAbove) col.setTerm(+termAbove.tm[1]);
        const ms = hr.ms.sort((a, b) => a.x - b.x);
        const centers = ms.map(m => m.x + m.w / 2);
        const spacing = centers.length > 1 ? (centers.at(-1) - centers[0]) / (centers.length - 1) : 100;
        const bounds = centers.map((c, i) => [i ? (centers[i - 1] + c) / 2 : c - spacing / 2, i < centers.length - 1 ? (c + centers[i + 1]) / 2 : c + spacing / 2]);
        col.bump(ms[0].wk.week);
        // Content below this header row, grouped into table rows by their left label.
        const body = marked.filter(c => c.y > hr.y + 2 && c.y < yEnd - 2 && !c.wk);
        const labels = body.filter(c => c.x < bounds[0][0] - 2 && c.x + c.w < bounds[0][1]).sort((a, b) => a.y - b.y);
        const isLabel = c => labels.includes(c);
        // A row label may wrap over several lines ("CORE CONCEPTS, SKILLS / AND VALUES"): merge into blocks.
        const blocks = [];
        for (const l of labels) {
          const last = blocks.at(-1);
          if (last && l.y - last.yEnd < l.h * 1.8) { last.str += ' ' + l.str; last.yEnd = l.y; } else blocks.push({ y: l.y, yEnd: l.y, str: l.str });
        }
        const labelAt = y => { let lab = ''; for (const b of blocks) if (b.y <= y + 2) lab = b.str; return lab; };
        const MAIN_LABEL = /concept|skill|content|inhoud|vaardighe|topic|onderwerp/i;
        ms.forEach((m, i) => {
          const inCol = body.filter(c => { if (isLabel(c)) return false; const cx = c.x + c.w / 2; return cx >= bounds[i][0] && cx < bounds[i][1]; }).sort((a, b) => a.y - b.y || a.x - b.x);
          let topic = '', details = [], lastLabel = null;
          for (const c of inCol) {
            const lab = labelAt(c.y);
            if (TOPIC_LABEL.test(lab) && !topic) topic = c.str;
            else if (TOPIC_LABEL.test(lab) && lastLabel === lab && details.length === 0 && topic.length < 70) topic += ' ' + c.str;
            else {
              // Rows like "Resources" or "Assessment" keep their label so they stay meaningful.
              if (lab !== lastLabel && lab && !MAIN_LABEL.test(lab)) details.push(lab.charAt(0) + lab.slice(1).toLowerCase() + ': ' + c.str);
              else details.push(c.str);
            }
            lastLabel = lab;
          }
          col.add(m.wk.week, m.wk.weekEnd, { topic: topic || m.wk.rest, details: joinWrapped(details) });
        });
      });
    } else if (markers.length) {
      // Vertical: one week per table row.
      const ms = markers.sort((a, b) => a.y - b.y);
      ms.forEach((m, i) => {
        const yEnd = ms[i + 1]?.y ?? Infinity;
        const termAbove = marked.filter(c => c.tm && c.y <= m.y + 2).pop();
        if (termAbove) col.setTerm(+termAbove.tm[1]);
        col.bump(m.wk.week);
        const inRow = marked.filter(c => c !== m && c.y >= m.y - 3 && c.y < yEnd - 3 && c.x > m.x + 2 && !c.wk).sort((a, b) => a.x - b.x || a.y - b.y);
        // First column right of the week cell is usually the topic.
        const firstX = inRow.length ? Math.min(...inRow.map(c => c.x)) : 0;
        const topicParts = inRow.filter(c => c.x < firstX + 20).sort((a, b) => a.y - b.y).map(c => c.str);
        const rest = inRow.filter(c => c.x >= firstX + 20).sort((a, b) => a.x - b.x || a.y - b.y).map(c => c.str);
        col.add(m.wk.week, m.wk.weekEnd, { topic: m.wk.rest || topicParts.join(' '), details: joinWrapped(m.wk.rest ? topicParts.concat(rest) : rest) });
      });
    } else {
      // Continuation page without week headings: attach to term marker only.
      const t = marked.find(c => c.tm); if (t) col.setTerm(+t.tm[1]);
    }
  }
  return col.result();
}

// Lines broken mid-sentence by table wrapping get re-joined; real bullet points stay separate.
function joinWrapped(parts) {
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && /[a-z,;(\-–]$/i.test(prev) && /^[a-z(]/.test(p) && !/[.:]$/.test(prev)) out[out.length - 1] = prev + ' ' + p;
    else out.push(p);
  }
  return out.join('\n');
}

function parseAtpGrids(grids) {
  const col = new Collector();
  for (const grid of grids) {
    if (grid.termHint) col.setTerm(grid.termHint);
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const rowText = row.join(' ');
      const tm = rowText.match(TERM_RE);
      const weekCols = row.map((c, i) => [i, weekMatch(c)]).filter(([, w]) => w && row[0] !== undefined);
      if (weekCols.length >= 2) {
        if (tm) col.setTerm(+tm[1]);
        col.bump(weekCols[0][1].week);
        // Rows below until the next header row belong to these weeks.
        let rr = r + 1;
        for (; rr < grid.length; rr++) {
          const body = grid[rr];
          if (body.filter(c => weekMatch(c)).length >= 2) break;
          const tmb = body.join(' ').match(TERM_RE);
          if (tmb && body.filter(Boolean).length <= 2) { break; }
          const label = body.slice(0, weekCols[0][0]).join(' ');
          weekCols.forEach(([ci, w], k) => {
            // A merged cell may span several weeks; only the first column of the span holds text.
            const v = body[ci]; if (!v) return;
            const prevSame = k > 0 && body[weekCols[k - 1][0]] === v;
            if (prevSame) { const it = col.map.get(`${col.term}|${weekCols[k - 1][1].week}`); if (it) it.weekEnd = Math.max(it.weekEnd, w.weekEnd); return; }
            if (TOPIC_LABEL.test(label)) col.add(w.week, w.weekEnd, { topic: v });
            else col.add(w.week, w.weekEnd, { details: v });
          });
        }
        r = rr - 1;
        continue;
      }
      // Vertical layout: a cell that is just "Week n".
      const wi = row.findIndex(c => { const w = weekMatch(c); return w && c.length < 25; });
      if (wi >= 0) {
        const w = weekMatch(row[wi]);
        const before = row.slice(0, wi).join(' ').match(TERM_RE);
        if (before) col.setTerm(+before[1]); else if (tm && !TERM_RE.test(row[wi])) col.setTerm(+tm[1]);
        col.bump(w.week);
        const rest = row.slice(wi + 1).filter(Boolean);
        const uniq = rest.filter((v, i) => v !== rest[i - 1]);
        col.add(w.week, w.weekEnd, { topic: w.rest || uniq[0] || '', details: (w.rest ? uniq : uniq.slice(1)).join('\n') });
      } else if (tm && row.filter(Boolean).length <= 2) {
        col.setTerm(+tm[1]);
      }
    }
  }
  return col.result();
}

function parseAtpText(text) {
  const col = new Collector();
  let cur = null;
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim(); if (!line) continue;
    const tm = line.match(TERM_RE);
    if (tm && line.length < 30) { col.setTerm(+tm[1]); continue; }
    const w = weekMatch(line);
    if (w) { col.bump(w.week); cur = w; col.add(w.week, w.weekEnd, { topic: w.rest }); continue; }
    if (cur) col.add(cur.week, cur.weekEnd, { details: line });
  }
  return col.result();
}

// Returns { items, text } — text is kept so the AI can re-read it if the teacher wants.
export async function readAtpFile(file) {
  const k = kindOf(file);
  if (k === 'pdf') {
    const pages = await pdfPages(file);
    const text = pagesToText(pages);
    if (text.replace(/\s/g, '').length < 50) throw new Error('This PDF has no readable text (it may be a scan). Use "Read with AI" or a Word/Excel version.');
    let items = parseAtpPages(pages);
    if (items.length < 2) items = parseAtpText(text);
    return { items, text };
  }
  if (k === 'docx') {
    if (ext(file) === 'doc') throw new Error('Old .doc files are not supported. Save it as .docx or PDF first.');
    const { grids, text } = await docxTablesAndText(file);
    let items = grids.length ? parseAtpGrids(grids) : [];
    if (items.length < 2) items = parseAtpText(text);
    return { items, text: grids.length ? grids.map(gridToText).join('\n\n') : text };
  }
  if (k === 'sheet') {
    const sheets = await sheetGrids(file);
    const items = parseAtpGrids(sheets.map(s => s.grid));
    return { items, text: sheets.map(s => `# ${s.name}\n` + gridToText(s.grid)).join('\n\n') };
  }
  throw new Error('Upload the ATP as a PDF, Word (.docx) or Excel file.');
}

// ---------- Timetable from Excel / Word ----------
// Handles one-week timetables, two-week cycles laid out as two tables (Week A, Week B),
// side-by-side columns ("Mon A" … "Fri B"), and numbered cycles (Day 1 … Day 10).
const WEEKDAYS = [
  ['mon', 'monday', 'ma', 'maandag'],
  ['tue', 'tues', 'tuesday', 'di', 'dinsdag'],
  ['wed', 'wednesday', 'wo', 'woensdag'],
  ['thu', 'thur', 'thurs', 'thursday', 'do', 'donderdag'],
  ['fri', 'friday', 'vr', 'vrydag'],
  ['sat', 'saturday', 'sa', 'saterdag'],
];
const TIME_RE = /(\d{1,2})[:h.](\d{2})\s*(?:-|–|to|tot)\s*(\d{1,2})[:h.](\d{2})/;
const BREAK_RE = /\b(break|pouse|interval|lunch|assembly|saal|recess)\b/i;
const BLOCK_WEEK = /\b(?:week|wk|cycle|siklus)\s*([ab12])\b|\b([ab])[\s-]*(?:week|wk)\b/i;

// "Mon" → {i:0, week:0}; "Tue B" / "B Tue" → {i:1, week:2}; "Day 7" → {i:1, week:2}
function dayInfo(s) {
  const t = String(s).toLowerCase().replace(/[.:]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 20) return null;
  const num = t.match(/^(?:day|dag|d)\s*(\d{1,2})$/);
  if (num) { const n = +num[1]; if (n >= 1 && n <= 10) return n <= 5 ? { i: n - 1, week: 1, numbered: true } : { i: n - 6, week: 2, numbered: true }; return null; }
  const idx = x => WEEKDAYS.findIndex(names => names.includes(x));
  let i = idx(t);
  if (i >= 0) return { i, week: 0 };
  let m = t.match(/^(.+?)\s*(?:\(|-|\s)\s*(?:week\s*)?([ab12])\)?$/);
  if (m && (i = idx(m[1].trim())) >= 0) return { i, week: /[a1]/.test(m[2]) ? 1 : 2 };
  m = t.match(/^(?:week\s*)?([ab])\s*(?:-|:|\s)\s*(.+)$/);
  if (m && (i = idx(m[2].trim())) >= 0) return { i, week: m[1] === 'a' ? 1 : 2 };
  return null;
}

// Days repeated in one header (Mon…Fri Mon…Fri) without A/B labels: the second set is Week B.
function resolveWeeks(infos) {
  const seen = new Set();
  return infos.map(d => {
    if (d.week) return d;
    if (seen.has(d.i)) return { ...d, week: 2 };
    seen.add(d.i); return d;
  });
}

function weekLabelNear(grid, r, prevR) {
  for (let k = r; k > Math.max(prevR, r - 4); k--) {
    const m = (grid[k] || []).join(' ').match(BLOCK_WEEK);
    if (m) return /[a1]/i.test(m[1] || m[2]) ? 1 : 2;
  }
  return 0;
}

export async function readTimetableFile(file) {
  const k = kindOf(file);
  let grids = [];
  if (k === 'sheet') grids = (await sheetGrids(file)).map(s => s.grid);
  else if (k === 'docx') grids = (await docxTablesAndText(file)).grids;
  else throw new Error('Upload an Excel or Word timetable, or a photo (read with AI).');
  // Word files often put Week A and Week B in separate tables: read them all.
  const found = grids.map((g, n) => ({ g, r: timetableFromGrid(g) })).filter(x => x.r && x.r.cells.length);
  if (!found.length) throw new Error('Could not find day names (Mon–Fri, or Day 1–10) in this file. Fill the grid by hand or use a photo with AI.');
  if (found.length >= 2 && found[0].r.cycle === 1 && found[1].r.cycle === 1) {
    const [a, b] = found;
    const bWeek = (weekLabelNear(b.g, 0, -1) || 2);
    return { periods: a.r.periods, cycle: 2, cells: [...a.r.cells.map(c => ({ ...c, week: 1 })), ...b.r.cells.map(c => ({ ...c, week: bWeek }))] };
  }
  return found[0].r;
}

function timetableFromGrid(grid) {
  // Days across the top: one or more header rows (e.g. a Week A table, then a Week B table below it).
  const headers = [];
  for (let r = 0; r < grid.length; r++) {
    const cols = grid[r].map((c, i) => [i, dayInfo(c)]).filter(([, d]) => d);
    if (cols.length >= 3) headers.push({ r, cols: resolveWeeks(cols.map(([, d]) => d)).map((d, k) => [cols[k][0], d]) });
  }
  if (headers.length) {
    const blocks = headers.map((hd, b) => ({
      week: weekLabelNear(grid, hd.r, headers[b - 1]?.r ?? -1) || (b === 1 ? 2 : 0),
      rows: grid.slice(hd.r + 1, headers[b + 1]?.r ?? grid.length).map(row => ({ head: row.slice(0, hd.cols[0][0]).join(' '), cells: hd.cols.map(([ci, d]) => [d, row[ci]]) })),
    }));
    return build(blocks);
  }
  // Days down the side.
  const width = Math.max(0, ...grid.map(r => r.length));
  for (let c = 0; c < Math.min(width, 4); c++) {
    const rows = grid.map((row, i) => [i, dayInfo(row[c] ?? '')]).filter(([, d]) => d);
    if (rows.length >= 3) {
      const days = resolveWeeks(rows.map(([, d]) => d));
      const headerRow = grid[rows[0][0] - 1] || grid[0];
      const periodCols = headerRow.map((v, i) => i).filter(i => i > c);
      return build([{ week: 0, rows: periodCols.map(pc => ({ head: headerRow[pc], cells: rows.map(([ri], k) => [days[k], grid[ri][pc]]) })) }]);
    }
  }
  return null;

  function build(blocks) {
    const periods = [], cells = [];
    blocks.forEach((blk, b) => {
      let order = 0;
      for (const pr of blk.rows) {
        const filled = pr.cells.filter(([, v]) => v);
        if (!filled.length && !pr.head) continue;
        if (BREAK_RE.test(pr.head) || (filled.length && filled.every(([, v]) => BREAK_RE.test(v)))) continue;
        if (!filled.length && BLOCK_WEEK.test(pr.head)) continue; // a "Week B" title row
        const tm = String(pr.head).match(TIME_RE);
        const label = (String(pr.head).replace(TIME_RE, '').replace(/period|periode/i, '').trim() || String(order + 1)).slice(0, 12);
        const period = { label, start: tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '', end: tm ? `${tm[3].padStart(2, '0')}:${tm[4]}` : '' };
        let pi;
        if (b === 0) { pi = periods.length; periods.push(period); }
        else {
          pi = periods.findIndex(p => p.label === label);
          if (pi < 0) pi = order;
          while (periods.length <= pi) periods.push({ label: String(periods.length + 1), start: '', end: '' });
        }
        order++;
        for (const [d, v] of pr.cells) if (v) cells.push({ dayIndex: d.i, periodIndex: pi, week: d.week || blk.week || 1, ...splitCell(v) });
      }
    });
    return { periods, cells, cycle: cells.some(c => c.week === 2) ? 2 : 1 };
  }
}

function splitCell(v) {
  const s = String(v).replace(/\s+/g, ' ').trim();
  const cls = (s.match(/\b(?:gr(?:ade)?\.?\s*)?(\d{1,2}\s?[A-Z]{1,2}\d?)\b/) || [])[1] || '';
  const room = (s.match(/\b(?:room|rm|lokaal|klas)\s*([\w-]+)/i) || [])[1] || '';
  const subject = s.replace(cls, '').replace(/\b(?:room|rm|lokaal|klas)\s*[\w-]+/i, '').replace(/\bgr(?:ade)?\b\.?/i, '').replace(/[()\-–,/|]+\s*$/, '').replace(/^\s*[()\-–,/|]+/, '').trim();
  return { subject: subject || s, cls: cls.replace(/\s/g, ''), room };
}

// Match free text like "Maths 9B" or "Wisk" to one of the teacher's subjects.
const ALIASES = { mathematics: ['maths', 'math', 'wiskunde', 'wisk', 'mat'], 'mathematical literacy': ['math lit', 'maths lit', 'ml', 'wiskundige geletterdheid'], english: ['eng', 'english hl', 'english fal', 'efal', 'ehl'], afrikaans: ['afr', 'afrikaans eat', 'afrikaans ht', 'afr eat', 'afr ht'], 'physical sciences': ['phys sci', 'physics', 'ps', 'fisiese wetenskappe', 'fis wet', 'natural sciences'], 'life sciences': ['life sci', 'ls', 'biology', 'lewenswetenskappe', 'lewenswet'], 'natural sciences': ['ns', 'nat sci', 'natuurwetenskappe'], 'life orientation': ['lo', 'lewensoriëntering'] };
export function matchSubject(text, subjects) {
  const t = String(text).toLowerCase();
  if (!t) return null;
  let best = null, score = 0;
  for (const s of subjects) {
    const n = s.name.toLowerCase();
    const names = [n, ...(ALIASES[n] || []), n.slice(0, 4)];
    for (const a of names) {
      if (!a) continue;
      const re = new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (re.test(t)) {
        let sc = a.length;
        if (s.grade && t.includes(String(s.grade))) sc += 5;
        if (sc > score) { score = sc; best = s; }
      }
    }
  }
  return best;
}

// ---------- Marksheets ----------
// Returns { headers, rows, nameCols, markCols, totals } for the column picker.
export async function readMarksheet(file) {
  const k = kindOf(file);
  let grid;
  if (k === 'sheet') {
    const sheets = await sheetGrids(file);
    grid = sheets.sort((a, b) => b.grid.length - a.grid.length)[0].grid;
  } else if (k === 'docx') {
    const { grids } = await docxTablesAndText(file);
    grid = grids.sort((a, b) => b.length - a.length)[0];
  } else if (k === 'pdf') {
    const pages = await pdfPages(file);
    grid = [];
    for (const chunks of pages) {
      const lines = [];
      for (const c of chunks) { const l = lines.find(l => Math.abs(l.y - c.y) < 3); if (l) l.parts.push(c); else lines.push({ y: c.y, parts: [c] }); }
      lines.sort((a, b) => a.y - b.y).forEach(l => grid.push(l.parts.sort((a, b) => a.x - b.x).map(p => p.str)));
    }
  } else throw new Error('Upload the marksheet as Excel, CSV, Word or a text PDF.');
  if (!grid?.length) throw new Error('No table found in this file.');

  const isNum = v => /^-?\d+(?:[.,]\d+)?%?$/.test(String(v).trim());
  // Header = the row (in the first 20) with the most text cells, followed by rows with numbers.
  let hr = 0, best = -1;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const textCells = grid[r].filter(v => v && !isNum(v)).length;
    const nextNums = (grid[r + 1] || []).filter(isNum).length;
    const sc = textCells + (nextNums ? 2 : 0);
    if (sc > best) { best = sc; hr = r; }
  }
  const width = Math.max(...grid.map(r => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(grid[hr][i] || '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(hr + 1).filter(r => r.some(Boolean));
  const colStats = headers.map((_, c) => {
    const vals = rows.map(r => String(r[c] ?? '').trim()).filter(Boolean);
    const nums = vals.filter(isNum).length;
    return { nums, text: vals.length - nums, n: vals.length };
  });
  const NAME_H = /name|surname|learner|student|leerder|naam|van\b/i;
  let nameCols = headers.map((h, i) => i).filter(i => NAME_H.test(headers[i]) && colStats[i].text > colStats[i].nums);
  if (!nameCols.length) {
    const t = colStats.map((s, i) => [i, s.text]).sort((a, b) => b[1] - a[1])[0];
    if (t) nameCols = [t[0]];
  }
  const markCols = headers.map((h, i) => i).filter(i => colStats[i].nums >= Math.max(2, colStats[i].n * 0.6) && !/^(no|nr|#|adm|admission|id|acc)/i.test(headers[i]));
  // Look for an "out of" / "max" figure in the header text, e.g. "Test 1 (50)".
  const totals = headers.map(hd => { const m = hd.match(/(?:\(|\/|out of|uit|max\.?\s*)\s*(\d{1,3})\)?\s*$/i); return m ? +m[1] : null; });
  // Drop summary rows like "Average" or "Total".
  const data = rows.filter(r => !/^(average|gemiddeld|total|totaal|class avg|max|min)\b/i.test(String(r[nameCols[0]] || '').trim()));
  return { headers, rows: data, nameCols, markCols, totals };
}
export const toNumber = v => { const n = parseFloat(String(v).replace(',', '.').replace('%', '')); return isNaN(n) ? null : n; };

// ---------- School calendar: year planners and test/exam timetables ----------
// Finds dates in rows (Excel/Word tables, PDF lines). Understands "14 Jan 2026", "14/01/2026",
// "2026-01-14", "January 14", ranges like "12–16 Oct" or "30 Jan – 3 Feb", month headings
// followed by day-only rows, year planners with months across the top and days down the side,
// and exam timetables with a column per grade. Afrikaans month and day names work too.
const MONTHS = [
  ['jan', 'january', 'januarie'], ['feb', 'febr', 'february', 'februarie'], ['mar', 'mrt', 'march', 'maart'], ['apr', 'april'],
  ['may', 'mei'], ['jun', 'june', 'junie'], ['jul', 'july', 'julie'], ['aug', 'august', 'augustus'], ['sep', 'sept', 'september'],
  ['oct', 'okt', 'october', 'oktober'], ['nov', 'november'], ['dec', 'des', 'december', 'desember'],
];
const MONTH_ALT = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
const monthIdx = s => MONTHS.findIndex(m => m.includes(String(s).toLowerCase().replace(/\.$/, '')));
const WD_ALT = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|maandag|dinsdag|woensdag|donderdag|vrydag|saterdag|sondag|thurs|tues|mon|tue|wed|thu|thur|fri|sat|sun';
const WD_RE = new RegExp(`\\b(?:${WD_ALT})\\b\\.?,?`, 'gi');
const ORD = '(?:st|nd|rd|th|ste|de)?';
const RANGE_SEP = '\\s*(?:-|–|—|to|tot|until|till|&|and|en)\\s*';
const DATE_PATTERNS = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, f: m => [+m[1], +m[2] - 1, +m[3]] },
  { re: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g, f: m => [yr(m[3]), +m[2] - 1, +m[1]] },
  { re: new RegExp(`\\b(\\d{1,2})${ORD}(?:${RANGE_SEP}(\\d{1,2})${ORD})?\\s*(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s*(\\d{4}))?\\b`, 'gi'), f: (m, y) => [m[4] ? +m[4] : y, monthIdx(m[3]), +m[1], m[2] ? +m[2] : null] },
  { re: new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})${ORD}(?:${RANGE_SEP}(\\d{1,2})${ORD})?(?:,?\\s*(\\d{4}))?\\b`, 'gi'), f: (m, y) => [m[4] ? +m[4] : y, monthIdx(m[1]), +m[2], m[3] ? +m[3] : null] },
];
const yr = s => { const n = +s; return n < 100 ? 2000 + n : n; };
const p2 = n => String(n).padStart(2, '0');
function mkDate(y, m, d) {
  if (!(m >= 0 && m < 12) || !(d >= 1 && d <= 31) || !(y > 1990 && y < 2100)) return null;
  const dt = new Date(y, m, d);
  return dt.getMonth() === m ? `${y}-${p2(m + 1)}-${p2(d)}` : null;
}

// All dates in a piece of text: [{ start, end, from, to }]
export function findDates(text, year) {
  const s = String(text || '');
  const hits = [];
  for (const { re, f } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (hits.some(h => m.index < h.to && m.index + m[0].length > h.from)) continue; // overlaps an earlier match
      const [y, mo, d, d2] = f(m, year);
      const start = mkDate(y, mo, d);
      if (!start) continue;
      const end = d2 ? mkDate(y, mo, d2) : start;
      hits.push({ start, end: end && end >= start ? end : start, from: m.index, to: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => a.from - b.from);
  // "30 Jan – 3 Feb" → one range.
  const out = [];
  for (const h of hits) {
    const prev = out.at(-1);
    if (prev && new RegExp(`^${RANGE_SEP}$`, 'i').test(s.slice(prev.to, h.from)) && h.start >= prev.start) { prev.end = h.end; prev.to = h.to; }
    else out.push({ ...h });
  }
  return out;
}

const TIME_IN = /\b(\d{1,2})[:h](\d{2})(?:\s*(?:-|–|to|tot)\s*(\d{1,2})[:h](\d{2}))?\b/;
export const gradeOf = s => { const m = String(s).match(/\b(?:gr(?:ade|aad)?|graad)\.?\s*(\d{1,2}|r)\b(?!\s*(?:-|–|&|,|and|en|to|tot)\s*\d)/i); return m ? m[1].toUpperCase() : ''; };

export function classifyEvent(title, fallback = 'event') {
  const s = title.toLowerCase();
  if (/public holiday|\bholiday|vakansie|no school|geen skool|school closed|skool gesluit|day off|learner[- ]free|pupil[- ]free|staff development day|personeelontwikkelingsdag|new year'?s day|human rights day|menseregtedag|good friday|goeie vrydag|family day|gesinsdag|freedom day|vryheidsdag|workers'? day|werkersdag|youth day|jeugdag|women'?s day|vrouedag|heritage day|erfenisdag|day of reconciliation|versoeningsdag|christmas day|kersdag|day of goodwill|welwillendheidsdag/.test(s)) return 'holiday';
  if (/\bexam|eksamen|vraestel|\bpaper\s*\d|\bp\s?\d\b|\bnsc\b|prelim|trial exam/.test(s)) return 'exam';
  if (/\btest|toets|\bsba\b|assessment|assessering|practical|prakties|investigation|ondersoek|\bquiz|\boral\b|mondeling|\bproject\b|\btask\b|\btaak\b|common paper/.test(s)) return 'test';
  if (/\bdue\b|deadline|submi(t|ssion)|inhandig|sperdatum|marks? (in|due|to)|punte (in|indien)|reports? (due|to|issued)|moderation|moderering|sa-?sams/.test(s)) return 'deadline';
  if (/meeting|vergadering|parents'? ?evening|ouer(aand|s)|\bstaff\b|personeel|briefing|workshop|training|cluster|\bsgb\b|\bagm\b/.test(s)) return 'meeting';
  return fallback;
}

function cleanTitle(t) {
  return String(t || '').replace(WD_RE, ' ').replace(/^[\s,;:|·•\-–—/]+|[\s,;:|·•\-–—/]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

function makeEvent(range, title, { grade = '', fallback = 'event' } = {}) {
  let time = '';
  const tm = title.match(TIME_IN);
  if (tm) { time = tm[3] ? `${p2(tm[1])}:${tm[2]}–${p2(tm[3])}:${tm[4]}` : `${p2(tm[1])}:${tm[2]}`; title = cleanTitle(title.replace(tm[0], ' ')); }
  const type = classifyEvent(title, fallback);
  return { date: range.start, endDate: range.end !== range.start ? range.end : '', title, time, type, grade: grade || gradeOf(title), noTeaching: type === 'holiday' };
}

const HEAD_WORD = /^(date|datum|day|dag|event|events|activity|activities|aktiwiteit|gebeurtenis|description|beskrywing|responsible|verantwoordelik|person|persoon|who|wie|venue|plek|lokaal|time|tyd|subject|vak|grade|graad|task|taak|paper|vraestel|duration|duur|notes?|notas|comments?|kommentaar)$/i;
const NOTE_COL = /responsible|verantwoordelik|person|persoon|^who$|^wie$|venue|plek|lokaal|notes?|notas|comment|kommentaar|duration|duur/i;
const WEEKDAY_CELL = new RegExp(`^(?:${WD_ALT}|ma|di|wo|do|vr|sa|so)\\.?$`, 'i');
const DAY_ONLY = new RegExp(`^(?:(?:${WD_ALT})\\.?,?\\s*)?(\\d{1,2})${ORD}(?:\\s*(?:${WD_ALT})\\.?)?$`, 'i');
const MONTH_HEAD = new RegExp(`^(${MONTH_ALT})\\.?(?:\\s+(\\d{4}))?$`, 'i');

function eventsFromRows(rows, year, fallback) {
  const out = [];
  const ctx = { year, month: null };
  let gradeCols = null, carry = null, noteCols = new Set(), gradeCol = -1;
  for (const raw of rows) {
    const row = raw.map(c => String(c ?? '').replace(/\s+/g, ' ').trim());
    const filled = row.filter(Boolean);
    if (!filled.length) { carry = null; continue; }
    const joined = filled.join(' ');
    const mh = joined.match(MONTH_HEAD);
    if (mh) { ctx.month = monthIdx(mh[1]); if (mh[2]) ctx.year = +mh[2]; carry = null; continue; }
    const yh = joined.match(/^(?:.*\b)?(20\d{2})(?:\b.*)?$/);
    if (yh && joined.length < 60 && !findDates(joined, ctx.year).length && !/\d{1,2}[:h]\d{2}/.test(joined)) ctx.year = +yh[1];
    // A header row with grade columns (exam timetables).
    const gc = row.map((c, i) => [i, c.length < 20 ? gradeOf(c) : '']).filter(([, g]) => g);
    if (gc.length >= 2 && !findDates(joined, ctx.year).length) { gradeCols = gc; carry = null; continue; }
    // A header row like "Date | Day | Event | Responsible": names go into notes, not the title.
    if (row.filter(c => HEAD_WORD.test(c)).length >= 2) {
      noteCols = new Set(row.map((c, i) => NOTE_COL.test(c) ? i : -1).filter(i => i >= 0));
      gradeCol = row.findIndex(c => /^(grade|graad|gr)$/i.test(c));
      carry = null; continue;
    }

    let range = null, dateCol = -1, rest = '';
    for (let i = 0; i < row.length && !range; i++) {
      const d = findDates(row[i], ctx.year);
      if (d.length) { range = d[0]; dateCol = i; rest = row[i].slice(0, d[0].from) + ' ' + row[i].slice(d[0].to); }
    }
    if (!range && ctx.month != null) {
      for (let i = 0; i < Math.min(row.length, 3); i++) {
        if (!row[i]) continue;
        const m = row[i].match(DAY_ONLY);
        if (m) { const dt = mkDate(ctx.year, ctx.month, +m[1]); if (dt) { range = { start: dt, end: dt }; dateCol = i; rest = ''; } }
        break;
      }
    }
    if (!range && carry && !row[carry.col]) { range = carry.range; dateCol = carry.col; rest = ''; }
    if (!range) continue;
    carry = { range, col: dateCol };

    const cell = i => { if (noteCols.has(i) || i === gradeCol) return ''; const v = i === dateCol ? rest : row[i]; return WEEKDAY_CELL.test(v.trim()) ? '' : cleanTitle(v); };
    const notes = [...noteCols].map(i => row[i]).filter(Boolean).join(' · ');
    const rowGrade = gradeCol >= 0 ? (gradeOf('gr ' + row[gradeCol]) || row[gradeCol]) : '';
    if (gradeCols) {
      const gIdx = new Set(gradeCols.map(([i]) => i));
      const shared = row.map((_, i) => i).filter(i => !gIdx.has(i)).map(cell).filter(Boolean);
      let any = false;
      for (const [ci, g] of gradeCols) {
        const t = cell(ci);
        if (!t || (ci > 0 && row[ci] === row[gradeCols.find(([c]) => c === ci - 1)?.[0]])) continue; // skip merged repeats
        any = true;
        const label = gradeOf(t) ? t : `Gr ${g} ${t}`;
        out.push({ ...makeEvent(range, [label, ...shared.filter(x => TIME_IN.test(x))].join(' '), { grade: g, fallback }), notes });
      }
      if (any) continue;
    }
    const parts = [];
    row.forEach((_, i) => { const t = cell(i); if (t && !parts.includes(t)) parts.push(t); });
    const title = parts.join(' – ');
    if (title && title.length > 1) out.push({ ...makeEvent(range, rowGrade && !gradeOf(title) ? `Gr ${rowGrade} ${title}` : title, { grade: rowGrade, fallback }), notes });
  }
  return out;
}

// Year planners laid out as a big grid: months across the top, day numbers down the side.
function eventsFromMonthGrid(grid, year) {
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const months = grid[r].map((c, i) => [i, String(c).trim().match(MONTH_HEAD)]).filter(([, m]) => m);
    if (months.length < 3) continue;
    const body = grid.slice(r + 1);
    const isDay = v => /^\d{1,2}$/.test(String(v).trim()) && +v >= 1 && +v <= 31;
    let dayCol = -1;
    for (let c = 0; c < Math.min(4, Math.max(...grid.map(x => x.length))); c++) {
      if (body.filter(row => isDay(row[c])).length >= 20) { dayCol = c; break; }
    }
    if (dayCol < 0) continue;
    const out = [];
    for (const row of body) {
      if (!isDay(row[dayCol])) continue;
      const day = +row[dayCol];
      for (const [ci, m] of months) {
        const y = m[2] ? +m[2] : year;
        // A month may span two columns (weekday letter + event): read both.
        const next = months.find(([c]) => c > ci)?.[0] ?? row.length;
        const text = cleanTitle(row.slice(ci, next).filter(v => !isDay(v)).join(' ').replace(/^\s*[mtwfs]\b\.?/i, ''));
        if (!text || text.length < 2) continue;
        const dt = mkDate(y, monthIdx(m[1]), day);
        if (dt) out.push(makeEvent({ start: dt, end: dt }, text));
      }
    }
    if (out.length) return out;
  }
  return [];
}

function dedupeEvents(list) {
  const seen = new Set();
  return list.filter(e => { const k = `${e.date}|${e.title.toLowerCase()}|${e.grade}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// kind: 'planner' (year planner) or 'assessments' (test/exam timetable)
export async function readCalendarFile(file, kind, year) {
  const k = kindOf(file);
  if (k === 'image') { const e = new Error('Photos are read with AI.'); e.needsAi = true; throw e; }
  let grids = [], lines = [], text = '';
  if (k === 'sheet') { const sheets = await sheetGrids(file); grids = sheets.map(s => s.grid); text = sheets.map(s => gridToText(s.grid)).join('\n\n'); }
  else if (k === 'docx') {
    if (ext(file) === 'doc') throw new Error('Old .doc files are not supported. Save it as .docx or PDF first.');
    const d = await docxTablesAndText(file); grids = d.grids;
    lines = d.ordered;
    text = d.text;
  } else if (k === 'pdf') {
    const pages = await pdfPages(file);
    for (const chunks of pages) {
      const ls = [];
      for (const c of chunks) { const l = ls.find(l => Math.abs(l.y - c.y) < 3); if (l) l.parts.push(c); else ls.push({ y: c.y, parts: [c] }); }
      ls.sort((a, b) => a.y - b.y).forEach(l => lines.push(l.parts.sort((a, b) => a.x - b.x).map(p => p.str)));
    }
    text = lines.map(l => l.join('  |  ')).join('\n');
    if (text.replace(/\s/g, '').length < 30) { const e = new Error('This PDF has no readable text (it may be a scan). Read it with AI instead.'); e.needsAi = true; throw e; }
  } else throw new Error('Upload a PDF, Word, Excel file or a photo.');

  const fileYear = (() => { const ys = (text.match(/\b20\d{2}\b/g) || []).map(Number); if (!ys.length) return year; const c = {}; ys.forEach(y => c[y] = (c[y] || 0) + 1); return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; })();
  const fallback = kind === 'assessments' ? (/exam|eksamen/i.test(text) ? 'exam' : 'test') : 'event';
  let events = [];
  const monthGrids = grids.map(g => eventsFromMonthGrid(g, fileYear));
  if (monthGrids.some(x => x.length)) events = monthGrids.flat();
  else if (k === 'docx') events = eventsFromRows(lines, fileYear, fallback); // document order keeps month headings
  else { for (const g of grids) events.push(...eventsFromRows(g, fileYear, fallback)); }
  if (!events.length && lines.length) events = eventsFromRows(lines, fileYear, fallback);
  return { events: dedupeEvents(events), text, year: fileYear };
}

// ---------- Moderation notices ----------
// Pulls a title, due date, subject/grade hints and the list of what to submit out of a notice.
export async function readNoticeFile(file, year) {
  const k = kindOf(file);
  if (k === 'image') { const e = new Error('Photos are read with AI.'); e.needsAi = true; throw e; }
  let text = '';
  if (k === 'pdf') {
    const pages = await pdfPages(file);
    text = pages.map(chunks => {
      const ls = [];
      for (const c of chunks) { const l = ls.find(l => Math.abs(l.y - c.y) < 3); if (l) l.parts.push(c); else ls.push({ y: c.y, parts: [c] }); }
      return ls.sort((a, b) => a.y - b.y).map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ')).join('\n');
    }).join('\n');
    if (text.replace(/\s/g, '').length < 30) { const e = new Error('This PDF has no readable text (it may be a scan).'); e.needsAi = true; throw e; }
  } else if (k === 'docx') text = (await docxTablesAndText(file)).text;
  else if (k === 'sheet') text = (await sheetGrids(file)).map(s => gridToText(s.grid)).join('\n');
  else if (/\.(txt|md)$/i.test(file.name)) text = await file.text();
  else throw new Error('Upload the notice as PDF, Word, a photo, or a text file.');
  return { ...noticeFromText(text, year), text };
}

export function noticeFromText(text, year) {
  const lines = text.split(/\n+/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Due date: a date on a line about submitting, else the last date mentioned.
  let due = '';
  const DUE = /due|submit|submission|deadline|by\b|before|no later|hand in|inhandig|voor of op|sperdatum|moderation (?:will take place|date|on)|moderering/i;
  for (const l of lines) { if (DUE.test(l)) { const d = findDates(l, year); if (d.length) { due = d[0].start; break; } } }
  if (!due) { const all = findDates(text, year); if (all.length) due = all.at(-1).start; }
  // What to submit: bulleted or numbered lines.
  const items = [];
  for (const l of lines) {
    const m = l.match(/^(?:[•●▪■◦\-–*]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+(.{3,160})$/i);
    if (m && !findDates(m[1], year).length) items.push(m[1].replace(/[.;]$/, ''));
  }
  const title = (lines.find(l => /moderat|moderer/i.test(l) && l.length < 120) || lines[0] || 'Moderation notice').replace(/^(re|subject|onderwerp)\s*:\s*/i, '').slice(0, 120);
  const levelM = text.match(/\b(provincial|provinsiaal|district|distrik|cluster|kluster|school|skool)[- ]?(?:based|level|vlak)?\s+moderat/i);
  const level = levelM ? ({ provinsiaal: 'Provincial', distrik: 'District', kluster: 'Cluster', skool: 'School' }[levelM[1].toLowerCase()] || levelM[1][0].toUpperCase() + levelM[1].slice(1).toLowerCase()) : '';
  return { title, due, items: items.slice(0, 15), level, grade: gradeOf(text) };
}
