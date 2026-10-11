// Turns lesson content into files: Word (.docx), PowerPoint (.pptx) and print-ready pages.
import { state, subjectById, atpById } from './state.js';
import { loadScript, download, safeName, esc } from './ui.js';
import { fmt, fmtLong } from './dates.js';
import { labelsFor, lessonContext } from './generate.js';
import { eventsOn } from './events.js';
import { checkFor, trapHtml, trapRun } from './aicheck.js';

const loadDocx = () => loadScript('vendor/docx.iife.js').then(() => window.docx);
const loadPptx = () => loadScript('vendor/pptxgen.bundle.js').then(() => window.PptxGenJS);

const brand = () => (state.settings.brandColour || '#1E3B33').replace('#', '').toUpperCase();
const FONT = 'Arial';

function logoBytes() {
  const d = state.settings.logo;
  if (!d) return null;
  const [meta, b64] = d.split(',');
  const type = /png/.test(meta) ? 'png' : /jpe?g/.test(meta) ? 'jpg' : null;
  if (!type) return null;
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { type, data: u };
}

// Answer lines as a ruled table: separate bordered paragraphs get merged into one box by Word.
export function ruledLines(D, n, { indent = 0, width = 9360 } = {}) {
  if (!(n > 0)) return [];
  const line = { style: D.BorderStyle.SINGLE, size: 4, color: '8C9592' };
  const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return [new D.Table({
    width: { size: width - indent, type: D.WidthType.DXA }, columnWidths: [width - indent], indent: { size: indent, type: D.WidthType.DXA },
    borders: { top: none, left: none, right: none, bottom: line, insideHorizontal: line, insideVertical: none },
    rows: Array.from({ length: n }, () => new D.TableRow({ height: { value: 440, rule: D.HeightRule.EXACT }, children: [new D.TableCell({ width: { size: width - indent, type: D.WidthType.DXA }, children: [new D.Paragraph('')] })] })),
  }), new D.Paragraph({ children: [], spacing: { after: 60 } })];
}

// ---------- DOCX building blocks ----------
async function docKit() {
  const D = await loadDocx();
  const B = brand();
  const run = (text, o = {}) => new D.TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 22, bold: o.bold, italics: o.italics, color: o.color });
  const p = (text, o = {}) => new D.Paragraph({ children: Array.isArray(text) ? text : [run(text, o)], spacing: { after: o.after ?? 100, before: o.before ?? 0 }, alignment: o.align, keepNext: o.keepNext });
  const multi = (text, o = {}) => String(text || '').split('\n').filter(s => s.trim()).map(l => p(l, o));
  const heading = text => new D.Paragraph({ children: [run(text, { bold: true, size: 26, color: B })], spacing: { before: 240, after: 100 }, keepNext: true, border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: B, space: 2 } } });
  const bullets = items => (items || []).filter(Boolean).map(t => new D.Paragraph({ children: [run(t)], bullet: { level: 0 }, spacing: { after: 60 } }));
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'B8C2BE' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (content, o = {}) => new D.TableCell({
    children: (Array.isArray(content) ? content : multi(content, o)).length ? (Array.isArray(content) ? content : multi(content, o)) : [p('')],
    width: o.w ? { size: o.w, type: D.WidthType.DXA } : undefined,
    shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 }, borders, columnSpan: o.span,
  });
  const table = (widths, rows) => new D.Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: widths, rows });
  const row = (cells, o = {}) => new D.TableRow({ children: cells, tableHeader: o.header, cantSplit: o.cantSplit });
  const lines = (n, w = 9360) => ruledLines(D, n, { width: w });

  function header() {
    const kids = [];
    const logo = logoBytes();
    if (logo) kids.push(new D.ImageRun({ type: logo.type, data: logo.data, transformation: { width: 40, height: 40 } }), run('   '));
    kids.push(run(state.settings.school || '', { bold: true, size: 20, color: B }));
    return new D.Header({ children: [new D.Paragraph({ children: kids, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: B, space: 4 } } })] });
  }
  function footer() {
    const left = [state.settings.teacherName, state.settings.footer].filter(Boolean).join('  ·  ');
    return new D.Footer({ children: [new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9360 }], children: [run(left, { size: 16, color: '666666' }), new D.TextRun({ children: ['\t', D.PageNumber.CURRENT], font: FONT, size: 16, color: '666666' })] })] });
  }
  async function toBlob(children, name, { landscape = false } = {}) {
    const doc = new D.Document({
      creator: state.settings.teacherName || 'Klasboek', title: name,
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      numbering: undefined,
      sections: [{
        properties: { page: { size: landscape ? { width: 16838, height: 11906, orientation: D.PageOrientation.LANDSCAPE } : { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100, header: 500, footer: 500 } } },
        headers: { default: header() }, footers: { default: footer() }, children,
      }],
    });
    return { blob: await D.Packer.toBlob(doc), name: safeName(name) + '.docx' };
  }
  async function save(children, name, opts) { const f = await toBlob(children, name, opts); download(f.blob, f.name); }
  return { D, B, run, p, multi, heading, bullets, cell, table, row, lines, save, toBlob };
}

const metaRows = (k, pairs, w = [1700, 2980, 1700, 2980]) => {
  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const [a, b] = [pairs[i], pairs[i + 1] || ['', '']];
    rows.push(k.row([k.cell(a[0], { bold: true, fill: 'EEF2F0', w: w[0] }), k.cell(a[1], { w: w[1] }), k.cell(b[0], { bold: true, fill: 'EEF2F0', w: w[2] }), k.cell(b[1], { w: w[3] })]));
  }
  return k.table(w, rows);
};

// ---------- Lesson plan ----------
export async function exportLessonPlanDocx(lesson, { get = false } = {}) {
  const k = await docKit();
  const c = lesson.content; const ctx = lessonContext(lesson); const subj = subjectById(lesson.subjectId); const L = labelsFor(subj);
  const kids = [
    k.p(L.lessonPlan, { bold: true, size: 36, color: k.B, after: 60 }),
    k.p(c.title, { size: 28, after: 200 }),
    metaRows(k, [[L.subject, ctx.subject], [L.grade, ctx.grade + (ctx.cls ? ` (${ctx.cls})` : '')], [L.date, fmtLong(lesson.date)], [L.duration, `${ctx.minutes} min`], [L.teacher, state.settings.teacherName || ''], [`${L.term} / ${L.week}`, ctx.term ? `${ctx.term} / ${ctx.week}` : '']]),
    k.heading(L.objectives), k.p(L.objIntro, { italics: true }), ...k.bullets(c.objectives),
  ];
  if (ctx.details) kids.push(k.heading(L.atpContent), ...k.multi(ctx.details, { size: 20 }));
  if (c.priorKnowledge) kids.push(k.heading(L.prior), ...k.multi(c.priorKnowledge));
  if (c.vocabulary?.length) kids.push(k.heading(L.vocab), k.table([2600, 6760], c.vocabulary.map(v => k.row([k.cell(v.term, { bold: true, w: 2600 }), k.cell(v.meaning, { w: 6760 })]))));
  if (c.resources?.length) kids.push(k.heading(L.resources), ...k.bullets(c.resources));
  kids.push(k.heading(L.phases), k.table([1700, 700, 3480, 3480], [
    k.row([L.phase, L.minutes, L.teacherActs, L.learnerActs].map((t, i) => k.cell(t, { bold: true, fill: k.B, color: 'FFFFFF', w: [1700, 700, 3480, 3480][i] })), { header: true }),
    ...(c.phases || []).map(ph => k.row([k.cell(ph.name, { bold: true, w: 1700 }), k.cell(String(ph.minutes ?? ''), { w: 700 }), k.cell(ph.teacher, { w: 3480 }), k.cell(ph.learners, { w: 3480 })], { cantSplit: true })),
  ]));
  if (c.assessment) kids.push(k.heading(L.assessment), ...k.multi(c.assessment));
  if (c.differentiation?.support || c.differentiation?.extension) kids.push(k.heading(L.differentiation), k.table([1800, 7560], [k.row([k.cell(L.support, { bold: true, fill: 'EEF2F0', w: 1800 }), k.cell(c.differentiation.support || '', { w: 7560 })]), k.row([k.cell(L.extension, { bold: true, fill: 'EEF2F0', w: 1800 }), k.cell(c.differentiation.extension || '', { w: 7560 })])]));
  if (c.homework) kids.push(k.heading(L.homework), ...k.multi(c.homework));
  kids.push(k.heading(L.reflection));
  for (const q of L.reflectQ) kids.push(k.p(q, { bold: true, before: 80, keepNext: true }), ...k.lines(2));
  const name = `${L.lessonPlan} - ${ctx.subject} ${ctx.grade} - ${c.title} - ${lesson.date}`;
  if (get) return k.toBlob(kids, name);
  await k.save(kids, name);
}

// ---------- Activity (worksheet) + memo ----------
// mode: 'learner' (learner copy, with the hidden AI check if on), 'memo' (teacher copy), 'both'
export async function buildWorksheetDocx(lesson, mode = 'both') {
  const k = await docKit();
  const D = k.D;
  const c = lesson.content; const ws = c.worksheet || { questions: [] }; const ctx = lessonContext(lesson); const L = labelsFor(subjectById(lesson.subjectId));
  const total = ws.questions.reduce((a, q) => a + (+q.marks || 0), 0);
  const chk = checkFor(lesson);
  const kids = [];
  if (mode !== 'memo') {
    kids.push(
      k.p(ws.title || c.title, { bold: true, size: 32, color: k.B, after: 60 }),
      k.p(`${ctx.subject}${ctx.grade ? ' · ' + L.grade + ' ' + ctx.grade : ''}`, { size: 22, color: '555555', after: 160 }),
      k.table([1400, 4560, 1400, 2000], [k.row([k.cell(L.name + ':', { bold: true, w: 1400 }), k.cell('', { w: 4560 }), k.cell(L.cls + ':', { bold: true, w: 1400 }), k.cell(ctx.cls || '', { w: 2000 })]), k.row([k.cell(L.date + ':', { bold: true, w: 1400 }), k.cell('', { w: 4560 }), k.cell(L.total + ':', { bold: true, w: 1400 }), k.cell(`     / ${total}`, { w: 2000 })])]));
    kids.push(new D.Paragraph({ spacing: { before: 160, after: 100 }, children: [k.run(ws.instructions || '', { italics: true }), trapRun(D, chk)].filter(Boolean) }));
    let section = null, n = 0;
    for (const q of ws.questions) {
      if (q.section && q.section !== section) { section = q.section; kids.push(k.heading(section)); }
      n++;
      kids.push(new D.Paragraph({ keepNext: true, spacing: { before: 140, after: 60 }, tabStops: [{ type: D.TabStopType.RIGHT, position: 9360 }], children: [k.run(`${n}. `, { bold: true }), k.run(q.q), k.run(`\t(${q.marks})`, { bold: true })] }));
      kids.push(...k.lines(Math.max(1, q.lines || Math.min(8, Math.ceil((+q.marks || 1) * 1.5)))));
    }
    kids.push(new D.Paragraph({ alignment: D.AlignmentType.RIGHT, spacing: { before: 200 }, children: [k.run(`[${total}]`, { bold: true }), trapRun(D, chk)].filter(Boolean) }));
  }
  if (mode !== 'learner') {
    kids.push(new D.Paragraph({ children: [k.run(`${L.memo}: ${ws.title || c.title}`, { bold: true, size: 32, color: k.B })], pageBreakBefore: mode === 'both', spacing: { after: 120 } }));
    if (chk.on) kids.push(k.p(`AI check: the learner copy hides an instruction for AI tools. If “${chk.word}” turns up in answers (about ${chk.n} times), the questions were probably pasted into an AI tool. Talk to the learner before drawing conclusions.`, { italics: true, size: 18, color: '666666', after: 160 }));
    kids.push(k.table([600, 3900, 3960, 900], [
      k.row(['#', L.question, L.memo, L.marks].map((t, i) => k.cell(t, { bold: true, fill: k.B, color: 'FFFFFF', w: [600, 3900, 3960, 900][i] })), { header: true }),
      ...ws.questions.map((q, i) => k.row([k.cell(String(i + 1), { w: 600 }), k.cell(q.q, { w: 3900, size: 20 }), k.cell(q.answer || '', { w: 3960 }), k.cell(String(q.marks), { w: 900 })], { cantSplit: true })),
      k.row([k.cell('', { w: 600 }), k.cell(L.total, { bold: true, w: 3900 }), k.cell('', { w: 3960 }), k.cell(String(total), { bold: true, w: 900 })]),
    ]));
  }
  const label = mode === 'memo' ? L.memo : mode === 'learner' ? L.worksheet : `${L.worksheet} + ${L.memo}`;
  return k.toBlob(kids, `${label} - ${ctx.subject} ${ctx.grade} - ${ws.title || c.title}`);
}
export async function exportWorksheetDocx(lesson, { memo = true } = {}) {
  const f = await buildWorksheetDocx(lesson, memo ? 'both' : 'learner'); download(f.blob, f.name);
}

// ---------- Learner notes ----------
export async function buildNotesDocx(lesson) {
  const k = await docKit();
  const c = lesson.content; const n = c.notes || {}; const ctx = lessonContext(lesson); const L = labelsFor(subjectById(lesson.subjectId));
  const kids = [
    k.p(n.title || c.title, { bold: true, size: 34, color: k.B, after: 60 }),
    k.p(`${ctx.subject}${ctx.grade ? ' · ' + L.grade + ' ' + ctx.grade : ''}`, { size: 22, color: '555555', after: 200 }),
  ];
  if (n.intro) kids.push(...k.multi(n.intro));
  for (const sct of n.sections || []) {
    kids.push(k.heading(sct.heading || ''));
    if (sct.text) String(sct.text).split(/\n\s*\n/).forEach(pp => kids.push(...k.multi(pp)));
    if ((sct.bullets || []).filter(Boolean).length) kids.push(...k.bullets(sct.bullets));
  }
  if ((n.keyPoints || []).filter(Boolean).length) {
    const bb = { style: k.D.BorderStyle.SINGLE, size: 12, color: k.B };
    kids.push(k.p(''), k.table([9360], [k.row([new k.D.TableCell({ borders: { top: bb, bottom: bb, left: bb, right: bb }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, width: { size: 9360, type: k.D.WidthType.DXA },
      children: [k.p(L.keyPoints || 'Key points', { bold: true, color: k.B }), ...k.bullets(n.keyPoints)] })])]));
  }
  if ((c.vocabulary || []).length) kids.push(k.heading(L.vocab), k.table([2600, 6760], c.vocabulary.map(v => k.row([k.cell(v.term, { bold: true, w: 2600 }), k.cell(v.meaning, { w: 6760 })]))));
  return k.toBlob(kids, `${L.notes || 'Notes'} - ${ctx.subject} ${ctx.grade} - ${n.title || c.title}`);
}

// ---------- Slides ----------
export async function exportSlidesPptx(lesson) {
  const Pptx = await loadPptx();
  const c = lesson.content; const ctx = lessonContext(lesson);
  const B = brand(); const logo = state.settings.logo;
  const pres = new Pptx(); pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.author = state.settings.teacherName || ''; pres.title = c.title;
  pres.defineSlideMaster({
    title: 'CONTENT', background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: B } } },
      { text: { text: `${ctx.subject}${ctx.grade ? ' · Gr ' + ctx.grade : ''}`, options: { x: 0.6, y: 6.95, w: 8, h: 0.35, fontSize: 12, color: '6B7772', fontFace: FONT } } },
      ...(logo ? [{ image: { data: logo, x: 12.35, y: 6.85, w: 0.5, h: 0.5, sizing: { type: 'contain', w: 0.5, h: 0.5 } } }] : []),
    ],
    slideNumber: { x: 11.6, y: 6.95, w: 0.6, h: 0.35, fontSize: 12, color: '6B7772', fontFace: FONT },
  });
  const t = pres.addSlide();
  t.background = { color: B };
  t.addText(c.title, { x: 0.8, y: 2.1, w: 11.7, h: 1.8, fontSize: 44, bold: true, color: 'FFFFFF', fontFace: FONT, valign: 'bottom', fit: 'shrink' });
  t.addText(`${ctx.subject}${ctx.grade ? '  ·  Grade ' + ctx.grade : ''}${ctx.cls ? '  ·  ' + ctx.cls : ''}`, { x: 0.8, y: 4.05, w: 11.7, h: 0.6, fontSize: 22, color: 'E8F0EC', fontFace: FONT });
  t.addText([state.settings.teacherName, fmt(lesson.date, { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean).join('  ·  '), { x: 0.8, y: 4.65, w: 11.7, h: 0.5, fontSize: 16, color: 'C9D8D1', fontFace: FONT });
  if (logo) t.addImage({ data: logo, x: 11.6, y: 0.5, w: 1.2, h: 1.2, sizing: { type: 'contain', w: 1.2, h: 1.2 } });
  for (const s of c.slides || []) {
    const sl = pres.addSlide({ masterName: 'CONTENT' });
    sl.addText(s.title, { x: 0.7, y: 0.4, w: 11.9, h: 1.0, fontSize: 34, bold: true, color: B, fontFace: FONT, fit: 'shrink' });
    const bl = (s.bullets || []).filter(Boolean);
    if (bl.length) sl.addText(bl.map(b => ({ text: b, options: { bullet: { indent: 28 }, breakLine: true } })), { x: 0.7, y: 1.55, w: 11.9, h: 5.2, fontSize: bl.length > 5 ? 22 : 26, color: '1F2A26', fontFace: FONT, valign: 'top', paraSpaceAfter: 14, fit: 'shrink' });
    if (s.notes) sl.addNotes(s.notes);
  }
  const blob = await pres.write({ outputType: 'blob' });
  download(blob, safeName(`Slides - ${ctx.subject} ${ctx.grade} - ${c.title}`) + '.pptx');
}

// ---------- HTML (preview in the app, and print → PDF) ----------
// what: 'plan' | 'notes' | 'worksheet' (learner copy) | 'memo' | 'worksheet+memo'
export function lessonDocHtml(lesson, what = 'plan') {
  const c = lesson.content; const ctx = lessonContext(lesson); const L = labelsFor(subjectById(lesson.subjectId));
  const list = a => (a || []).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
  const para = s => String(s || '').split('\n').filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('');
  if (what === 'plan') return `<h1>${esc(L.lessonPlan)}</h1><p class="sub">${esc(c.title)}</p>
    <table class="meta"><tr><th>${L.subject}</th><td>${esc(ctx.subject)}</td><th>${L.grade}</th><td>${esc(ctx.grade)} ${esc(ctx.cls)}</td></tr><tr><th>${L.date}</th><td>${lesson.date ? esc(fmtLong(lesson.date)) : ''}</td><th>${L.duration}</th><td>${ctx.minutes} min</td></tr></table>
    <h2>${L.objectives}</h2><p><em>${L.objIntro}</em></p><ul>${list(c.objectives)}</ul>
    ${c.priorKnowledge ? `<h2>${L.prior}</h2>${para(c.priorKnowledge)}` : ''}
    ${c.vocabulary?.length ? `<h2>${L.vocab}</h2><table>${c.vocabulary.map(v => `<tr><th>${esc(v.term)}</th><td>${esc(v.meaning)}</td></tr>`).join('')}</table>` : ''}
    ${c.resources?.length ? `<h2>${L.resources}</h2><ul>${list(c.resources)}</ul>` : ''}
    <h2>${L.phases}</h2><table><tr class="hd"><th>${L.phase}</th><th>${L.minutes}</th><th>${L.teacherActs}</th><th>${L.learnerActs}</th></tr>${(c.phases || []).map(p => `<tr><th>${esc(p.name)}</th><td>${p.minutes ?? ''}</td><td>${para(p.teacher)}</td><td>${para(p.learners)}</td></tr>`).join('')}</table>
    ${c.assessment ? `<h2>${L.assessment}</h2>${para(c.assessment)}` : ''}
    ${c.differentiation?.support || c.differentiation?.extension ? `<h2>${L.differentiation}</h2><table><tr><th>${L.support}</th><td>${para(c.differentiation.support)}</td></tr><tr><th>${L.extension}</th><td>${para(c.differentiation.extension)}</td></tr></table>` : ''}
    ${c.homework ? `<h2>${L.homework}</h2>${para(c.homework)}` : ''}
    <h2>${L.reflection}</h2>${L.reflectQ.map(q => `<p><strong>${q}</strong></p><div class="ln"></div><div class="ln"></div>`).join('')}`;
  if (what === 'notes') {
    const n = c.notes || {};
    return `<h1>${esc(n.title || c.title)}</h1><p class="sub">${esc(ctx.subject)}${ctx.grade ? ' · ' + L.grade + ' ' + esc(ctx.grade) : ''}</p>
    ${para(n.intro)}
    ${(n.sections || []).map(s => `<h2>${esc(s.heading)}</h2>${String(s.text || '').split(/\n\s*\n/).map(para).join('')}${(s.bullets || []).filter(Boolean).length ? `<ul>${list(s.bullets)}</ul>` : ''}`).join('')}
    ${(n.keyPoints || []).filter(Boolean).length ? `<div class="keybox"><strong>${esc(L.keyPoints || 'Key points')}</strong><ul>${list(n.keyPoints)}</ul></div>` : ''}
    ${c.vocabulary?.length ? `<h2>${L.vocab}</h2><table>${c.vocabulary.map(v => `<tr><th>${esc(v.term)}</th><td>${esc(v.meaning)}</td></tr>`).join('')}</table>` : ''}`;
  }
  const ws = c.worksheet || { questions: [] };
  const total = ws.questions.reduce((a, q) => a + (+q.marks || 0), 0);
  const chk = checkFor(lesson);
  let sec = null;
  const learner = `<h1>${esc(ws.title || c.title)}</h1><p class="sub">${esc(ctx.subject)} · ${L.grade} ${esc(ctx.grade)}</p>
    <table class="meta"><tr><th>${L.name}</th><td style="width:50%"></td><th>${L.cls}</th><td>${esc(ctx.cls)}</td></tr><tr><th>${L.date}</th><td></td><th>${L.total}</th><td>&nbsp;&nbsp;&nbsp;&nbsp;/ ${total}</td></tr></table>
    <p><em>${esc(ws.instructions)}</em>${trapHtml(chk)}</p>
    ${ws.questions.map((q, i) => `${q.section && q.section !== sec ? `<h2>${esc(sec = q.section)}</h2>` : ''}<div class="q"><span>${i + 1}. ${esc(q.q)}</span><b>(${q.marks})</b></div>${'<div class="ln"></div>'.repeat(Math.max(1, q.lines || Math.ceil((+q.marks || 1) * 1.5)))}`).join('')}
    <p style="text-align:right"><b>[${total}]</b>${trapHtml(chk)}</p>`;
  const memo = `<h1${what === 'worksheet+memo' ? ' style="page-break-before:always"' : ''}>${L.memo}: ${esc(ws.title || c.title)}</h1>
    ${chk.on ? `<p class="aic-note">AI check: the learner copy hides an instruction for AI tools. If “${esc(chk.word)}” turns up in answers (about ${chk.n} times), the questions were probably pasted into an AI tool. Talk to the learner before drawing conclusions.</p>` : ''}
    <table><tr class="hd"><th>#</th><th>${L.question}</th><th>${L.memo}</th><th>${L.marks}</th></tr>${ws.questions.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.q)}</td><td>${para(q.answer)}</td><td>${q.marks}</td></tr>`).join('')}<tr><th></th><th>${L.total}</th><th></th><th>${total}</th></tr></table>`;
  return what === 'worksheet' ? learner : what === 'memo' ? memo : learner + memo;
}

export function printLesson(lesson, what = 'plan') {
  openPrint(lessonDocHtml(lesson, what), lesson.content.title);
}

// Shared document styles: scope '' for the print window, or e.g. '.doc-preview' for the in-app preview.
export function docCss(B = '#' + brand(), scope = '') {
  const S = sel => sel.split(',').map(x => `${scope} ${x}`.trim()).join(',');
  return `${scope || 'body'}{font:11pt/1.45 Arial,sans-serif;color:#1d2522}
  ${S('header')}{display:flex;align-items:center;gap:10px;border-bottom:2px solid ${B};padding-bottom:6px;margin-bottom:14px;font-weight:bold;color:${B}}
  ${S('header img')}{height:34px}${S('h1')}{color:${B};font-size:20pt;margin:0 0 2px;line-height:1.2}${S('h2')}{color:${B};font-size:13pt;border-bottom:1px solid ${B};padding-bottom:2px;margin:18px 0 6px;break-after:avoid}
  ${S('.sub')}{font-size:14pt;margin:0 0 12px}${S('table')}{border-collapse:collapse;width:100%;margin:6px 0}${S('th,td')}{border:1px solid #b8c2be;padding:5px 7px;text-align:left;vertical-align:top}${S('th')}{background:#eef2f0;width:18%}
  ${S('tr.hd th')}{background:${B};color:#fff}${S('td p,th p')}{margin:0 0 4px}${S('.meta th')}{width:14%}${S('.ln')}{border-bottom:1px solid #999;height:26px}${S('.q')}{display:flex;justify-content:space-between;gap:12px;margin-top:12px;break-after:avoid}
  ${S('tr')}{break-inside:avoid}${S('.keybox')}{border:2px solid ${B};border-radius:8px;padding:8px 14px;margin:14px 0}${S('.keybox strong')}{color:${B}}${S('.aic-note')}{font-style:italic;color:#666;font-size:9pt}`;
}

export function openPrint(body, title, B = '#' + brand()) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:A4;margin:16mm 15mm}body{margin:0}${docCss(B)}</style></head><body><header>${state.settings.logo ? `<img src="${state.settings.logo}">` : ''}${esc(state.settings.school || '')}</header>${body}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

// Plain text of an activity, for sending as a message (no hidden check: plain text can't hide anything).
export function activityText(lesson) {
  const c = lesson.content; const ws = c.worksheet || { questions: [] }; const ctx = lessonContext(lesson);
  const total = ws.questions.reduce((a, q) => a + (+q.marks || 0), 0);
  let sec = null;
  const lines = [`*${ws.title || c.title}*`, `${ctx.subject}${ctx.grade ? ' · Grade ' + ctx.grade : ''}${ctx.cls ? ' · ' + ctx.cls : ''}`, ''];
  if (ws.instructions) lines.push(ws.instructions, '');
  ws.questions.forEach((q, i) => { if (q.section && q.section !== sec) { sec = q.section; lines.push(`*${sec}*`); } lines.push(`${i + 1}. ${q.q} (${q.marks})`); });
  lines.push('', `Total: ${total}`);
  return lines.join('\n');
}

// ---------- Weekly plan (all lessons in a week) ----------
export async function exportWeekPlanDocx(mondayIso, days) {
  const k = await docKit();
  const periods = state.timetable.periods;
  const kids = [k.p(`Weekly plan: week of ${fmt(mondayIso, { day: 'numeric', month: 'long', year: 'numeric' })}`, { bold: true, size: 32, color: k.B, after: 200 })];
  const widths = [1100, ...days.map(() => Math.floor((14600 - 1100) / days.length))];
  const header = k.row([k.cell('', { w: widths[0], fill: k.B }), ...days.map((d, i) => k.cell(`${d.label}\n${fmt(d.date)}${eventsOn(d.date).map(e => '\n• ' + e.title).join('')}`, { bold: true, color: 'FFFFFF', fill: k.B, w: widths[i + 1] }))], { header: true });
  const rows = periods.map(p => k.row([
    k.cell(`${p.label}\n${p.start || ''}`, { bold: true, fill: 'EEF2F0', w: widths[0], size: 18 }),
    ...days.map((d, i) => {
      const ls = state.lessons.filter(l => l.date === d.date && l.periodId === p.id);
      const txt = ls.map(l => { const s = subjectById(l.subjectId); return `${s?.name || ''} ${s?.grade ? 'Gr ' + s.grade : ''} ${l.cls || ''}\n${l.title || atpById(l.atpId)?.topic || ''}`; }).join('\n');
      return k.cell(txt, { w: widths[i + 1], size: 18 });
    }),
  ], { cantSplit: true }));
  kids.push(k.table(widths, [header, ...rows]));
  await k.save(kids, `Weekly plan ${mondayIso}`, { landscape: true });
}

export { docKit, metaRows };
