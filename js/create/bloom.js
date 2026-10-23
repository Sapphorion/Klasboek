// The school's taxonomy levels sheet (Bloom sheet): one row per question with its marks under its
// cognitive level, then totals, actual % and desired %. The same layout on screen, in print, in Word,
// and as the Excel sheet itself (filled into the school's own template, so it looks exactly the same).
import { state, subjectById } from '../state.js';
import { numberBlocks, totalMarks, questionMarks, standardiseLevels, STANDARD_LEVELS } from './model.js';
import { readZip, writeZip } from '../docxfill.js';
import { download, safeName } from '../ui.js';

export function bloomSheet(c) {
  standardiseLevels(c);
  const blocks = c.blocks || [];
  const nums = numberBlocks(blocks);
  const names = (c.meta?.levelNames || STANDARD_LEVELS.names).slice(0, 4);
  const desired = (c.meta?.levelTargets || STANDARD_LEVELS.targets).slice(0, 4);
  const marks = totalMarks(blocks);
  const rows = [];
  blocks.forEach((b, i) => {
    if (b.type !== 'question') return;
    const lv = Math.min(4, Math.max(1, +b.cog || 1));
    const m = questionMarks(b);
    rows.push({ q: String(nums.get(i) || ''), levels: [0, 1, 2, 3].map(k => (k === lv - 1 ? m : null)), total: m });
  });
  const totals = [0, 1, 2, 3].map(k => rows.reduce((a, r) => a + (r.levels[k] || 0), 0));
  const actual = totals.map(t => (marks ? Math.round(t / marks * 100) : 0));
  const subj = subjectById(c.subjectId);
  const year = (c.meta?.date || '').slice(0, 4) || String(state.settings.year || new Date().getFullYear());
  const grade = c.grade || subj?.grade || '';
  return {
    head: ['TAXONOMY LEVELS', grade ? `GRADE ${grade}` : '', (subj?.name || '').toUpperCase(), `${(c.title || '').toUpperCase()}${year ? ' - ' + year : ''}`],
    names: names.map(n => n.toUpperCase()), desired, marks, rows, totals, actual,
  };
}

// ---------- On the page (print and the preview) ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function bloomHtml(c) {
  const b = bloomSheet(c);
  const cell = v => (v == null ? '' : esc(v));
  return `<table class="bloom">
  ${b.head.map(t => `<tr><th colspan="6" class="g">${esc(t)}</th></tr>`).join('')}
  <tr class="mk"><th class="g" colspan="3" style="text-align:right">MARKS:</th><th class="g" colspan="3" style="text-align:left">${b.marks}</th></tr>
  <tr class="hd"><th class="g">QUESTION</th>${b.names.map(n => `<th class="g">${esc(n)}</th>`).join('')}<th class="g">TOTAL</th></tr>
  <tr><th class="g">DESIRED %</th>${b.desired.map(d => `<th class="g">${d}%</th>`).join('')}<th class="g">100%</th></tr>
  ${b.rows.map(r => `<tr><td>${esc(r.q)}</td>${r.levels.map(v => `<td>${cell(v)}</td>`).join('')}<td>${r.total}</td></tr>`).join('')}
  <tr><th class="g">Total</th>${b.totals.map(t => `<th class="g">${t}</th>`).join('')}<th class="g">${b.marks}</th></tr>
  <tr><th class="g">Actual %</th>${b.actual.map(a => `<th class="g">${a}</th>`).join('')}<th class="g">${b.marks ? 100 : 0}</th></tr>
  <tr><th class="g">Desired %</th>${b.desired.map(d => `<th class="g">${d}%</th>`).join('')}<th class="g">100</th></tr>
</table>`;
}
export const BLOOM_CSS = `.paper table.bloom{border-collapse:collapse;width:auto;min-width:60%;margin:.6em 0;font-family:Calibri,Carlito,Arial,sans-serif;font-size:10pt}
.paper table.bloom th,.paper table.bloom td{border:2px solid #000;padding:2px 8px;text-align:center;vertical-align:middle;font-weight:400}
.paper table.bloom th.g{background:#D9D9D9;font-weight:700;color:#000}
.paper table.bloom tr.hd th{height:3.2em;width:6.5em}
.paper table.bloom tr.mk th{border-left:0;border-right:0}.paper table.bloom tr.mk th:first-child{border-left:2px solid #000}.paper table.bloom tr.mk th:last-child{border-right:2px solid #000}`;

// ---------- Word ----------
export function bloomDocx(k, c) {
  const b = bloomSheet(c);
  const D = k.D;
  const W = [1500, 1680, 1680, 1680, 1680, 1100];
  const line = { style: D.BorderStyle.SINGLE, size: 12, color: '000000' };
  const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cell = (t, w, o = {}) => new D.TableCell({
    width: { size: w, type: D.WidthType.DXA }, columnSpan: o.span,
    shading: o.grey ? { fill: 'D9D9D9', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
    verticalAlign: D.VerticalAlign.CENTER,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    borders: { top: line, bottom: line, left: o.noLeft ? none : line, right: o.noRight ? none : line },
    children: [new D.Paragraph({ alignment: o.align || D.AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new D.TextRun({ text: t == null ? '' : String(t), bold: !!o.grey, size: 20, font: 'Calibri' })] })],
  });
  const row = (cells, o = {}) => new D.TableRow({ children: cells, tableHeader: o.header, cantSplit: true });
  const all = W.reduce((x, y) => x + y, 0);
  const g = (t, i) => cell(t, W[i], { grey: true });
  return new D.Table({ width: { size: all, type: D.WidthType.DXA }, columnWidths: W, rows: [
    ...b.head.map(t => row([cell(t, all, { grey: true, span: 6 })])),
    row([cell('MARKS:', W[0] + W[1] + W[2], { grey: true, span: 3, align: D.AlignmentType.RIGHT, noRight: true }), cell(b.marks, W[3] + W[4] + W[5], { grey: true, span: 3, align: D.AlignmentType.LEFT, noLeft: true })]),
    row([g('QUESTION', 0), ...b.names.map((t, i) => g(t, i + 1)), g('TOTAL', 5)], { header: true }),
    row([g('DESIRED %', 0), ...b.desired.map((d, i) => g(d + '%', i + 1)), g('100%', 5)]),
    ...b.rows.map(r => row([cell(r.q, W[0]), ...r.levels.map((v, i) => cell(v, W[i + 1])), cell(r.total, W[5])])),
    row([g('Total', 0), ...b.totals.map((t, i) => g(t, i + 1)), g(b.marks, 5)]),
    row([g('Actual %', 0), ...b.actual.map((a, i) => g(a, i + 1)), g(b.marks ? 100 : 0, 5)]),
    row([g('Desired %', 0), ...b.desired.map((d, i) => g(d + '%', i + 1)), g(100, 5)]),
  ] });
}

// ---------- Excel: the school's own template, filled in ----------
const xesc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ROW = (r, cells, ht = '15.75') => `<row r="${r}" spans="1:6" ht="${ht}" thickBot="1" x14ac:dyDescent="0.3">${cells.join('')}</row>`;
const str = (ref, s, t) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xesc(t)}</t></is></c>`;
const num = (ref, s, v) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
const fml = (ref, s, f, v) => `<c r="${ref}" s="${s}"><f>${f}</f><v>${v}</v></c>`;
const blank = (ref, s) => `<c r="${ref}" s="${s}"/>`;

export function bloomSheetXml(c, shell) {
  const b = bloomSheet(c);
  const rows = [];
  // Title block (merged across A:F in the template)
  b.head.forEach((t, i) => rows.push(ROW(i + 1, [str(`A${i + 1}`, 14, t), ...['B', 'C', 'D', 'E'].map(x => blank(`${x}${i + 1}`, 15)), blank(`F${i + 1}`, 16)])));
  rows.push(ROW(5, [blank('A5', 1), blank('B5', 2), str('C5', 3, 'MARKS:'), num('D5', 4, b.marks), blank('E5', 2), blank('F5', 5)]));
  rows.push(ROW(6, [str('A6', 6, 'QUESTION'), ...b.names.map((n, i) => str(`${COLS[i + 1]}6`, 7, n)), str('F6', 7, 'TOTAL')], '39'));
  rows.push(ROW(7, [str('A7', 8, 'DESIRED %'), ...b.desired.map((d, i) => num(`${COLS[i + 1]}7`, 9, d / 100)), num('F7', 9, 1)]));
  const first = 8;
  b.rows.forEach((r, k) => {
    const n = first + k;
    rows.push(ROW(n, [str(`A${n}`, 17, r.q), ...r.levels.map((v, i) => (v == null ? blank(`${COLS[i + 1]}${n}`, 12) : num(`${COLS[i + 1]}${n}`, 12, v))), fml(`F${n}`, 12, `SUM(B${n}:E${n})`, r.total)]));
  });
  const last = Math.max(first, first + b.rows.length - 1);
  const tot = first + Math.max(1, b.rows.length), act = tot + 1, des = tot + 2;
  if (!b.rows.length) rows.push(ROW(first, [blank(`A${first}`, 17), ...['B', 'C', 'D', 'E', 'F'].map(x => blank(`${x}${first}`, 12))]));
  rows.push(ROW(tot, [str(`A${tot}`, 8, 'Total'), ...b.totals.map((t, i) => fml(`${COLS[i + 1]}${tot}`, 11, `SUM(${COLS[i + 1]}${first}:${COLS[i + 1]}${last})`, t)), fml(`F${tot}`, 10, `SUM(F${first}:F${last})`, b.marks)]));
  rows.push(ROW(act, [str(`A${act}`, 8, 'Actual %'), ...b.totals.map((t, i) => fml(`${COLS[i + 1]}${act}`, 11, `${COLS[i + 1]}${tot}/$D$5*100`, b.marks ? t / b.marks * 100 : 0)), fml(`F${act}`, 11, `SUM(B${act}:E${act})`, b.marks ? 100 : 0)]));
  rows.push(ROW(des, [str(`A${des}`, 8, 'Desired %'), ...b.desired.map((d, i) => num(`${COLS[i + 1]}${des}`, 9, d / 100)), num(`F${des}`, 10, 100)]));
  return shell.replace('<sheetData/>', `<sheetData>${rows.join('')}</sheetData>`).replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:F${des}"/>`);
}

export async function bloomXlsxBlob(c) {
  const res = await fetch('vendor/bloom-template.xlsx');
  if (!res.ok) throw new Error('Couldn’t load the taxonomy sheet template. Open Klasboek online once, then try again.');
  const files = await readZip(new Uint8Array(await res.arrayBuffer()));
  const dec = new TextDecoder();
  files.set('xl/worksheets/sheet1.xml', bloomSheetXml(c, dec.decode(files.get('xl/worksheets/sheet1.xml'))));
  return writeZip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
export async function downloadBloomXlsx(c) {
  const blob = await bloomXlsxBlob(c);
  download(blob, safeName(`Taxonomy levels - ${c.title || 'test'}`) + '.xlsx');
}
