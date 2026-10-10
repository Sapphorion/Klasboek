// Word and PowerPoint exports for created materials, following the chosen theme.
import { state, subjectById } from '../state.js';
import { loadScript, download, safeName } from '../ui.js';
import { docKit, ruledLines } from '../exporters.js';
import { numberBlocks, sectionTotals, totalMarks, cogGrid, isBlockDoc } from './model.js';
import { rubricMax } from './render.js';

const brandHex = () => (state.settings.brandColour || '#1E3B33').replace('#', '').toUpperCase();
const themeColour = c => ({ classic: '111111', ink: '333333' }[c.design?.theme] || brandHex());
const headFont = c => (c.design?.theme === 'classic' ? 'Georgia' : c.design?.theme === 'bright' ? 'Verdana' : 'Arial');
const bodyFont = c => (c.design?.theme === 'bright' ? 'Verdana' : 'Arial');
const subLine = c => [subjectById(c.subjectId)?.name, c.grade ? `Grade ${c.grade}` : ''].filter(Boolean).join(' · ');

function imgSize(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = src; });
}
function dataUrlBytes(src) {
  const [meta, b64] = src.split(',');
  const type = /png/.test(meta) ? 'png' : /jpe?g/.test(meta) ? 'jpg' : /gif/.test(meta) ? 'gif' : null;
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { type, data: u };
}

export async function exportCreationDocx(c) {
  const k = await docKit();
  const D = k.D;
  const col = themeColour(c), hf = headFont(c), bf = bodyFont(c);
  const big = c.design?.size === 'large';
  const sz = n => Math.round(n * (big ? 1.18 : 1));
  // **bold** inside text → bold runs.
  const runs = (text, o = {}) => String(text || '').split(/(\*\*.+?\*\*)/).filter(Boolean).map(part => {
    const bold = /^\*\*.+\*\*$/.test(part);
    return new D.TextRun({ text: bold ? part.slice(2, -2) : part, bold: bold || o.bold, italics: o.italics, font: o.font || bf, size: sz(o.size || 22), color: o.color });
  });
  const para = (text, o = {}) => new D.Paragraph({ children: runs(text, o), spacing: { after: o.after ?? 100, before: o.before ?? 0 }, alignment: o.align, indent: o.indent, keepNext: o.keepNext });
  const paras = (text, o) => String(text || '').split('\n').filter(s => s.trim()).map(l => para(l.trim(), o));
  const heading = (text, o = {}) => new D.Paragraph({ children: [new D.TextRun({ text, bold: true, font: hf, size: sz(o.size || 28), color: col })], spacing: { before: 240, after: 100 }, keepNext: true, border: o.rule ? { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: col, space: 2 } } : undefined });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: '9AA3A0' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (children, w, o = {}) => new D.TableCell({ children: children.length ? children : [para('')], width: { size: w, type: D.WidthType.DXA }, borders: o.borders || borders, shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined, margins: { top: 80, bottom: 80, left: 120, right: 120 }, columnSpan: o.span });
  const table = (widths, rows) => new D.Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: widths, rows });
  const row = (cells, o = {}) => new D.TableRow({ children: cells, cantSplit: true, tableHeader: o.header });
  const pageBreak = () => new D.Paragraph({ children: [new D.PageBreak()] });
  const lines = (n, indent = 0) => ruledLines(D, n, { indent });
  const learner = total => table([1100, 3800, 1000, 1400, 1000, 1060], [row([
    cell([para('Name:', { bold: true })], 1100, { borders: {} }), cell([para('')], 3800, { borders: { bottom: border } }),
    cell([para('Class:', { bold: true })], 1000, { borders: {} }), cell([para('')], 1400, { borders: { bottom: border } }),
    cell([para(total ? 'Total:' : 'Date:', { bold: true })], 1000, { borders: {} }), cell([para(total ? `    / ${total}` : '')], 1060, { borders: total ? {} : { bottom: border } }),
  ])]);
  const kids = [];

  if (isBlockDoc(c)) {
    const blocks = c.blocks || [];
    const nums = numberBlocks(blocks), secTot = sectionTotals(blocks), total = totalMarks(blocks);
    const assess = c.type !== 'notes';
    const ins = c.meta?.instructions || [];
    if (c.type === 'test' && c.design?.cover) {
      kids.push(para(state.settings.school || '', { bold: true, size: 28, align: D.AlignmentType.CENTER, before: 1200 }));
      kids.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 400, after: 100 }, children: [new D.TextRun({ text: subLine(c) || 'Subject', bold: true, size: sz(52), font: hf, color: col })] }));
      kids.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 500 }, children: [new D.TextRun({ text: c.title, bold: true, size: sz(36), font: hf })] }));
      kids.push(table([2300, 2380, 2300, 2380], [
        row([cell([para('Date', { bold: true })], 2300, { fill: 'EEF2F0' }), cell([para('')], 2380), cell([para('Time', { bold: true })], 2300, { fill: 'EEF2F0' }), cell([para(c.meta?.time ? `${c.meta.time} minutes` : '')], 2380)]),
        row([cell([para('Marks', { bold: true })], 2300, { fill: 'EEF2F0' }), cell([para(String(total))], 2380), cell([para('Examiner', { bold: true })], 2300, { fill: 'EEF2F0' }), cell([para(state.settings.teacherName || '')], 2380)]),
      ]), para('', { after: 300 }), learner(0));
      if (ins.length) kids.push(heading('Instructions', { size: 24 }), ...ins.map((t, i) => para(`${i + 1}.  ${t}`)));
      kids.push(pageBreak());
    } else {
      kids.push(new D.Paragraph({ spacing: { after: 60 }, children: [new D.TextRun({ text: c.title, bold: true, size: sz(36), font: hf, color: col })] }));
      if (subLine(c)) kids.push(para(subLine(c), { color: '555555', after: 120 }));
      if (c.type === 'test') kids.push(para(`${c.meta?.time ? `Time: ${c.meta.time} minutes      ` : ''}Total: ${total} marks`, { bold: true, after: 160 }));
      if (c.design?.header && assess) kids.push(learner(total), para('', { after: 120 }));
      if (c.type === 'test' && ins.length) kids.push(table([9360], [row([cell([para('Instructions', { bold: true }), ...ins.map((t, i) => para(`${i + 1}.  ${t}`))], 9360)])]), para(''));
    }
    let open = -1;
    const closeSec = () => { if (open >= 0 && assess) kids.push(para(`[${secTot.get(open)}]`, { bold: true, align: D.AlignmentType.RIGHT })); open = -1; };
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'heading') kids.push(heading(b.text, { rule: c.design?.theme !== 'bright' }));
      else if (b.type === 'text') String(b.text || '').split(/\n\s*\n/).forEach(p => kids.push(...paras(p)));
      else if (b.type === 'list') (b.items || []).filter(Boolean).forEach(t => kids.push(new D.Paragraph({ children: runs(t), bullet: { level: 0 }, spacing: { after: 60 } })));
      else if (b.type === 'box') {
        const bc = { info: '2747A8', warn: 'C8372D' }[b.style] || col;
        const bb = { style: D.BorderStyle.SINGLE, size: 12, color: bc };
        kids.push(table([9360], [row([cell([...(b.title ? [para(b.title, { bold: true, color: bc })] : []), ...paras(b.text)], 9360, { borders: { top: bb, bottom: bb, left: bb, right: bb } })])]), para(''));
      } else if (b.type === 'vocab') {
        kids.push(table([2800, 6560], [row([cell([para('Term', { bold: true })], 2800, { fill: 'EEF2F0' }), cell([para('Meaning', { bold: true })], 6560, { fill: 'EEF2F0' })], { header: true }),
          ...(b.items || []).map(v => row([cell([para(v.term, { bold: true })], 2800), cell(paras(v.meaning), 6560)]))]), para(''));
      } else if (b.type === 'section') {
        closeSec(); open = i;
        kids.push(new D.Paragraph({ keepNext: true, spacing: { before: 280, after: 80 }, border: c.design?.theme === 'classic' ? { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: '111111', space: 2 } } : undefined,
          children: [new D.TextRun({ text: `${assess ? nums.get(i) + (b.title ? ': ' : '') : ''}${b.title || ''}`, bold: true, font: hf, size: sz(26), color: col })] }));
        if (b.text) kids.push(para(b.text, { italics: true }));
      } else if (b.type === 'question') {
        const qLines = String(b.q || '').split('\n');
        kids.push(new D.Paragraph({ keepNext: true, spacing: { before: 140, after: 60 }, indent: { left: 720, hanging: 720 }, tabStops: [{ type: D.TabStopType.LEFT, position: 720 }, { type: D.TabStopType.RIGHT, position: 9360 }],
          children: [new D.TextRun({ text: nums.get(i), bold: true, font: bf, size: sz(22) }), new D.TextRun({ text: '\t', font: bf }), ...runs(qLines[0]), new D.TextRun({ text: `\t(${+b.marks || 0})`, bold: true, font: bf, size: sz(22) })] }));
        qLines.slice(1).forEach(l => kids.push(para(l, { indent: { left: 720 }, after: 60 })));
        if (b.kind === 'mcq') (b.options || []).forEach((o, k) => kids.push(para(`${'ABCDEF'[k]}   ${o}`, { indent: { left: 1080 }, after: 40 })));
        const n = b.kind === 'mcq' ? 0 : b.lines != null && b.lines !== '' ? +b.lines : Math.min(10, Math.max(1, Math.ceil((+b.marks || 1) * 1.5)));
        kids.push(...lines(n, 720));
      } else if (b.type === 'image' && b.src) {
        const dim = await imgSize(b.src); const bytes = dataUrlBytes(b.src);
        if (dim && bytes.type) {
          const w = Math.round(624 * (b.width || 60) / 100), hgt = Math.round(w * dim.h / dim.w);
          kids.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type: bytes.type, data: bytes.data, transformation: { width: w, height: hgt } })] }));
          if (b.caption) kids.push(para(b.caption, { italics: true, align: D.AlignmentType.CENTER, color: '555555' }));
        }
      } else if (b.type === 'table') {
        const cols = Math.max(1, ...(b.rows || []).map(r => r.length)); const w = Math.floor(9360 / cols);
        kids.push(table(Array(cols).fill(w), (b.rows || []).map((r, ri) => row(Array.from({ length: cols }, (_, ci) => cell(ri === 0 ? [para(r[ci] || '', { bold: true })] : paras(r[ci] || ''), w, { fill: ri === 0 ? 'EEF2F0' : undefined })), { header: ri === 0 }))), para(''));
      } else if (b.type === 'lines') kids.push(...lines(+b.count || 0));
      else if (b.type === 'pagebreak') kids.push(pageBreak());
    }
    closeSec();
    if (c.type === 'test') kids.push(para(`TOTAL: ${total}`, { bold: true, size: 26, align: D.AlignmentType.RIGHT, before: 200 }));
    if (assess && c.design?.memo) {
      const names = c.meta?.levelNames || [];
      const W = c.type === 'test' ? [900, 5560, 900, 2000] : [900, 7560, 900];
      kids.push(pageBreak(), new D.Paragraph({ spacing: { after: 160 }, children: [new D.TextRun({ text: `Memorandum: ${c.title}`, bold: true, size: sz(32), font: hf, color: col })] }));
      const headCells = ['No.', 'Answer', 'Marks', 'Level'].slice(0, W.length).map((t, i) => cell([para(t, { bold: true, color: 'FFFFFF' })], W[i], { fill: col }));
      const rows = [row(headCells, { header: true })];
      blocks.forEach((b, i) => {
        if (b.type === 'section') rows.push(row([cell([para(`${nums.get(i)}${b.title ? ': ' + b.title : ''}`, { bold: true })], W.reduce((a, x) => a + x, 0), { span: W.length, fill: 'EEF2F0' })]));
        if (b.type === 'question') rows.push(row([cell([para(nums.get(i))], W[0]), cell(paras(b.answer), W[1]), cell([para(String(+b.marks || 0))], W[2]), ...(W[3] ? [cell([para(names[(+b.cog || 1) - 1] || '', { size: 18 })], W[3])] : [])]));
      });
      rows.push(row([cell([para('')], W[0]), cell([para('Total', { bold: true })], W[1]), cell([para(String(total), { bold: true })], W[2]), ...(W[3] ? [cell([para('')], W[3])] : [])]));
      kids.push(table(W, rows));
      if (c.type === 'test' && c.design?.grid) {
        const G = [4200, 1700, 1700, 1760];
        kids.push(heading('Cognitive level analysis', { size: 24 }), table(G, [
          row(['Level', 'Marks', '% of paper', 'Target %'].map((t, i) => cell([para(t, { bold: true })], G[i], { fill: 'EEF2F0' })), { header: true }),
          ...cogGrid(c).map(r => row([cell([para(`${r.level}. ${r.name}`)], G[0]), cell([para(String(r.marks))], G[1]), cell([para(`${r.pct}%`, { bold: Math.abs(r.pct - r.target) > 5, color: Math.abs(r.pct - r.target) > 5 ? 'B0281F' : undefined })], G[2]), cell([para(`${r.target}%`)], G[3])])),
          row([cell([para('Total', { bold: true })], G[0]), cell([para(String(total), { bold: true })], G[1]), cell([para('100%', { bold: true })], G[2]), cell([para('')], G[3])]),
        ]));
      }
    }
    await k.save(kids, `${c.title} - ${subLine(c)}`);
    return;
  }

  if (c.type === 'rubric') {
    const r = c.rubric; const nL = r.levels.length; const land = nL > 4;
    const full = land ? 14000 : 9360; const cw = Math.round(full * 0.18), mw = 800; const lw = Math.floor((full - cw - mw) / Math.max(1, nL));
    kids.push(new D.Paragraph({ spacing: { after: 60 }, children: [new D.TextRun({ text: c.title, bold: true, size: sz(36), font: hf, color: col })] }));
    if (subLine(c)) kids.push(para(subLine(c), { color: '555555', after: 120 }));
    if (c.design?.header) kids.push(learner(rubricMax(c)), para(''));
    if (r.task) kids.push(para('Task', { bold: true }), ...paras(r.task), para(''));
    const W = [cw, ...Array(nL).fill(lw), mw];
    kids.push(table(W, [
      row([cell([para('Criteria', { bold: true, color: 'FFFFFF' })], cw, { fill: col }), ...r.levels.map(l => cell([para(`${l.label}${l.marks ? ` (${l.marks})` : ''}`, { bold: true, color: 'FFFFFF' })], lw, { fill: col })), cell([para('Mark', { bold: true, color: 'FFFFFF' })], mw, { fill: col })], { header: true }),
      ...r.criteria.map(cr => row([cell([para(cr.name, { bold: true })], cw), ...r.levels.map((_, k2) => cell(paras(cr.descriptors?.[k2] || '', { size: 19 }), lw)), cell([para('')], mw)])),
      row([cell([para('Total', { bold: true })], W.slice(0, -1).reduce((a, x) => a + x, 0), { span: nL + 1 }), cell([para(`/ ${rubricMax(c)}`, { bold: true })], mw)]),
    ]));
    await k.save(kids, `Rubric - ${c.title}`, { landscape: land });
    return;
  }

  if (c.type === 'cards') {
    kids.push(new D.Paragraph({ spacing: { after: 60 }, children: [new D.TextRun({ text: c.title, bold: true, size: sz(36), font: hf, color: col })] }));
    if (subLine(c)) kids.push(para(subLine(c), { color: '555555', after: 120 }));
    kids.push(table([3000, 6360], [row([cell([para('Term', { bold: true })], 3000, { fill: 'EEF2F0' }), cell([para('Meaning', { bold: true })], 6360, { fill: 'EEF2F0' })], { header: true }),
      ...(c.cards || []).filter(x => x.term || x.meaning).map(x => row([cell([para(x.term, { bold: true })], 3000), cell(paras(x.meaning), 6360)]))]));
    await k.save(kids, `Glossary - ${c.title}`);
  }
}

export async function exportCreationPptx(c) {
  await loadScript('vendor/pptxgen.bundle.js');
  const Pptx = window.PptxGenJS;
  const theme = c.design?.theme || 'modern';
  const B = theme === 'classic' ? '111111' : theme === 'ink' ? '333333' : brandHex();
  const font = theme === 'classic' ? 'Georgia' : theme === 'bright' ? 'Verdana' : 'Arial';
  const pres = new Pptx(); pres.layout = 'LAYOUT_WIDE'; pres.title = c.title; pres.author = state.settings.teacherName || '';
  const bg = theme === 'bright' ? 'FFFBEF' : 'FFFFFF';
  pres.defineSlideMaster({
    title: 'K', background: { color: bg },
    objects: [
      ...(theme === 'ink' ? [] : [{ rect: { x: 0, y: 0, w: theme === 'bright' ? 13.33 : 0.28, h: theme === 'bright' ? 0.22 : 7.5, fill: { color: B } } }]),
      { text: { text: subLine(c), options: { x: 0.6, y: 6.95, w: 8, h: 0.35, fontSize: 12, color: '6B7772', fontFace: font } } },
      ...(state.settings.logo ? [{ image: { data: state.settings.logo, x: 12.35, y: 6.85, w: 0.5, h: 0.5, sizing: { type: 'contain', w: 0.5, h: 0.5 } } }] : []),
    ],
    slideNumber: { x: 11.6, y: 6.95, w: 0.6, h: 0.35, fontSize: 12, color: '6B7772', fontFace: font },
  });
  const t = pres.addSlide();
  t.background = { color: theme === 'ink' ? 'FFFFFF' : B };
  const tc = theme === 'ink' ? '111111' : 'FFFFFF';
  t.addText(c.title, { x: 0.8, y: 2.1, w: 11.7, h: 1.8, fontSize: 44, bold: true, color: tc, fontFace: font, valign: 'bottom', fit: 'shrink' });
  t.addText(subLine(c), { x: 0.8, y: 4.05, w: 11.7, h: 0.6, fontSize: 22, color: tc, fontFace: font });
  t.addText([state.settings.teacherName, state.settings.school].filter(Boolean).join('  ·  '), { x: 0.8, y: 4.65, w: 11.7, h: 0.5, fontSize: 16, color: tc, fontFace: font });
  for (const s of c.slides || []) {
    const sl = pres.addSlide({ masterName: 'K' });
    const hasImg = !!s.image;
    sl.addText(s.title, { x: 0.7, y: 0.4, w: hasImg ? 7.2 : 11.9, h: 1.0, fontSize: 34, bold: true, color: B, fontFace: font, fit: 'shrink' });
    const bl = (s.bullets || []).filter(Boolean);
    if (bl.length) sl.addText(bl.map(b => ({ text: b.replace(/\*\*/g, ''), options: { bullet: { indent: 28 }, breakLine: true } })), { x: 0.7, y: 1.55, w: hasImg ? 6.6 : 11.9, h: 5.2, fontSize: bl.length > 5 ? 22 : 26, color: '1F2A26', fontFace: font, valign: 'top', paraSpaceAfter: 14, fit: 'shrink' });
    if (hasImg) sl.addImage({ data: s.image, x: 7.6, y: 1.4, w: 5.2, h: 5.2, sizing: { type: 'contain', w: 5.2, h: 5.2 } });
    if (s.notes) sl.addNotes(s.notes);
  }
  download(await pres.write({ outputType: 'blob' }), safeName(`Slides - ${c.title}`) + '.pptx');
}
