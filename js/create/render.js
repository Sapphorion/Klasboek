// Renders a created material to themed HTML. The same HTML drives the live preview and print / PDF,
// so what the teacher sees is what prints.
import { state, subjectById } from '../state.js';
import { esc } from '../ui.js';
import { numberBlocks, sectionTotals, totalMarks, cogGrid, isBlockDoc } from './model.js';
import { checkFor, trapHtml } from '../aicheck.js';
import { graphSvg } from './graph.js';

export const THEMES = [
  { id: 'classic', label: 'Classic', note: 'Formal, for tests and exams' },
  { id: 'modern', label: 'Modern', note: 'Clean, in your school colour' },
  { id: 'bright', label: 'Bright', note: 'Friendly, for younger grades' },
  { id: 'ink', label: 'Ink saver', note: 'Black and white, thin lines' },
];

export function themeCss() {
  const b = state.settings.brandColour || '#1E3B33';
  return `
.paper{--b:${b};--line:#9aa3a0;background:#fff;color:#1b1f1e;width:794px;padding:56px 58px 64px;box-sizing:border-box;font:14px/1.5 Arial,Helvetica,sans-serif;position:relative}
.paper *{box-sizing:border-box}
.paper.s-large{font-size:16.5px}
.paper h1{font-size:1.9em;margin:0 0 .15em;line-height:1.15}
.paper h2{font-size:1.25em;margin:1.1em 0 .4em;line-height:1.2}
.paper p{margin:0 0 .6em}
.paper ul,.paper ol{margin:0 0 .7em;padding-left:1.4em}
.paper table{border-collapse:collapse;width:100%;margin:.4em 0 .9em}
.paper th,.paper td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.paper .school{display:flex;align-items:center;gap:10px;font-weight:700;font-size:.85em;padding-bottom:8px;margin-bottom:14px;border-bottom:2px solid var(--b);color:var(--b)}
.paper .school img{height:34px}
.paper .sub{color:#4f5856;margin:0 0 .8em}
.paper .meta{display:flex;gap:1.5em;flex-wrap:wrap;font-weight:700;margin:.2em 0 .8em}
.paper .learner{display:grid;grid-template-columns:auto 1fr auto 9em;gap:8px 10px;align-items:end;margin:.4em 0 1em}
.paper .learner span{font-weight:700}
.paper .learner i{border-bottom:1px solid #333;height:1.4em;display:block}
.paper .instr{border:1px solid var(--line);padding:10px 14px;margin:0 0 1em}
.paper .instr h3{margin:0 0 .3em;font-size:1em}
.paper .sec{margin:1.3em 0 .5em;break-after:avoid}
.paper .sec h2{margin:0}
.paper .sec p{margin:.25em 0 0;font-style:italic}
.paper .sec-total{text-align:right;font-weight:700;margin:.2em 0 .8em}
.paper .q{display:grid;grid-template-columns:3em 1fr auto;gap:0 .4em;margin:.7em 0 .2em;break-inside:avoid}
.paper .q .n{font-weight:700}
.paper .q .mk{font-weight:700;white-space:nowrap}
.paper .q .body{white-space:pre-wrap}
.paper .opts{display:grid;grid-template-columns:1fr 1fr;gap:.2em 1.5em;margin:.3em 0 0}
.paper .opts span b{margin-right:.5em}
.paper .ln{border-bottom:1px solid #8c9592;height:2.05em;margin-left:3.4em}
.paper .ln.full{margin-left:0}
.paper .total{text-align:right;font-weight:800;font-size:1.1em;margin-top:1em;border-top:2px solid #333;padding-top:.4em}
.paper .box{border:2px solid var(--b);border-radius:8px;padding:10px 14px;margin:.8em 0;break-inside:avoid}
.paper .box h3{margin:0 0 .3em;font-size:1em;color:var(--b)}
.paper .box.info{border-color:#2747a8}.paper .box.info h3{color:#2747a8}
.paper .box.warn{border-color:#c8372d}.paper .box.warn h3{color:#c8372d}
.paper figure{margin:.8em auto;text-align:center;break-inside:avoid}
.paper figure img{max-width:100%;height:auto}
.paper figure svg{width:100%;height:auto;display:block}
.paper .details{width:100%;margin:.2em 0 .9em}
.paper .details th{background:#f1f4f2;width:16%;font-size:.9em}
.paper .details td{width:17%}
.paper figcaption{font-size:.85em;color:#4f5856;margin-top:.3em}
.paper .ph{border:2px dashed #b8c2be;color:#7a8582;padding:2em;text-align:center;border-radius:6px}
.paper .pb{border-top:2px dashed #c4ccc8;margin:2em -58px;position:relative;height:0}
.paper .pb:after{content:'Page break';position:absolute;right:58px;top:-.8em;background:#fff;color:#8c9592;font-size:11px;padding:0 6px}
.paper .memo-title{margin-top:0}
.paper .lvl-ok{color:#2e7d4f}.paper .lvl-off{color:#b0281f;font-weight:700}
.paper .cover{min-height:900px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.6em;padding-top:40px}
.paper .cover img{height:90px}
.paper .cover .big{font-size:2.3em;font-weight:800;margin:.4em 0 0}
.paper .cover table{max-width:520px;margin-top:1.5em}
.paper .cover .instr{text-align:left;max-width:600px;width:100%;margin-top:1.5em}
.paper .rubric th{background:#eef2f0}
.paper .rubric td.cr{font-weight:700;width:18%}
.paper .cards{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:225px;border-left:1px dashed #999;border-top:1px dashed #999}
.paper .cards div{border-right:1px dashed #999;border-bottom:1px dashed #999;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;font-size:1.25em}
.paper .cards.front div{font-weight:800;font-size:1.55em;color:var(--b)}
.paper .ws{border-collapse:collapse;margin:0 auto 1em;width:auto}
.paper .ws td{width:2em;height:2em;text-align:center;font-weight:700;font-size:1.05em;border:1px solid #c9cfcd;padding:0;font-family:'Courier New',monospace}
.paper .ws td.hit{background:#ffe680}
.paper .words{columns:3;list-style:none;padding:0;font-weight:700}
.paper .slide{aspect-ratio:16/9;border:1px solid #ccd3d0;position:relative;overflow:hidden;margin-bottom:12px;break-inside:avoid;background:#fff;font-size:18px;line-height:1.35}
.paper .slide .bar{position:absolute;left:0;top:0;bottom:0;width:10px;background:var(--b)}
.paper .slide .in{position:absolute;inset:6% 6% 8% 7%;display:flex;flex-direction:column}
.paper .slide h2{margin:0 0 .5em;color:var(--b);font-size:1.35em}
.paper .slide ul{font-size:1em}
.paper .slide li{margin-bottom:.45em}
.paper .slide.title{background:var(--b);color:#fff}
.paper .slide.title h2{color:#fff;font-size:1.75em;margin-top:auto}
.paper .slide.img .in{flex-direction:row;gap:4%}
.paper .slide.img .in>div{flex:1}
.paper .slide img{max-width:44%;max-height:100%;object-fit:contain}
.paper .slide .num{position:absolute;right:10px;bottom:6px;font-size:.75em;color:#7a8582}
.paper .notes{font-size:.85em;color:#4f5856;margin:-6px 0 14px;white-space:pre-wrap}

/* Classic: formal headings, black rules */
.paper.t-classic{--b:#111}
.paper.t-classic h1,.paper.t-classic h2{font-family:Georgia,'Times New Roman',serif}
.paper.t-classic .sec h2{text-transform:uppercase;letter-spacing:.02em;border-bottom:2px solid #111;padding-bottom:3px}
.paper.t-classic .school{color:#111;border-color:#111}
/* Modern: school colour */
.paper.t-modern h1{color:var(--b)}
.paper.t-modern h2{color:var(--b)}
.paper.t-modern .sec h2{border-left:6px solid var(--b);padding-left:10px}
/* Bright: friendly, rounded */
.paper.t-bright{font-family:Verdana,Geneva,sans-serif}
.paper.t-bright h1{color:var(--b);font-size:2.1em}
.paper.t-bright h2{background:var(--b);color:#fff;display:inline-block;padding:4px 14px;border-radius:999px}
.paper.t-bright .sec h2{display:block}
.paper.t-bright .box{background:color-mix(in srgb,var(--b) 8%,#fff);border-width:3px;border-radius:14px}
.paper.t-bright th{background:color-mix(in srgb,var(--b) 15%,#fff)}
/* Ink saver: no colour, thin lines */
.paper.t-ink{--b:#333}
.paper.t-ink .school{border-bottom-width:1px}
.paper.t-ink .box{border-width:1px}
.paper.t-ink .slide.title{background:#fff;color:#111;border:2px solid #111}
.paper.t-ink .slide.title h2{color:#111}
@media print{.paper{width:auto;padding:0}.paper .pb{border:0;margin:0;break-after:page}.paper .pb:after{display:none}.paper .cover{min-height:0;break-after:page}.paper .page{break-after:page}}
`;
}

const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
const paras = s => String(s || '').split(/\n\s*\n/).filter(x => x.trim()).map(p => `<p>${md(p.trim())}</p>`).join('');
const autoLines = b => b.kind === 'mcq' ? 0 : b.lines != null && b.lines !== '' ? +b.lines : Math.min(10, Math.max(1, Math.ceil((+b.marks || 1) * 1.5)));
const linesHtml = (n, full) => Array.from({ length: Math.max(0, n) }, () => `<div class="ln${full ? ' full' : ''}"></div>`).join('');

function schoolBar() {
  const s = state.settings;
  if (!s.school && !s.logo) return '';
  return `<div class="school">${s.logo ? `<img src="${s.logo}" alt="">` : ''}<span>${esc(s.school || '')}</span></div>`;
}
function subLine(c) {
  const subj = subjectById(c.subjectId);
  return [subj?.name, c.grade ? `Grade ${c.grade}` : ''].filter(Boolean).join(' · ');
}
function learnerBox(total) {
  return `<div class="learner"><span>Name:</span><i></i><span>Class:</span><i></i><span>Date:</span><i></i><span>${total ? 'Total:' : ''}</span>${total ? `<i style="border:0;text-align:right;font-weight:700">&nbsp;&nbsp;&nbsp;&nbsp;/ ${total}</i>` : '<i style="border:0"></i>'}</div>`;
}

// data-i lets the designer link a preview block back to its editor.
export function renderCreation(c, { forPrint = false } = {}) {
  const cls = `paper t-${c.design?.theme || 'modern'} s-${c.design?.size || 'normal'}`;
  let body = '';
  if (isBlockDoc(c)) body = renderDoc(c);
  else if (c.type === 'slides') body = renderSlides(c, forPrint);
  else if (c.type === 'rubric') body = renderRubric(c);
  else if (c.type === 'cards') body = renderCards(c);
  return `<div class="${cls}">${body}</div>`;
}

function renderDoc(c) {
  const blocks = c.blocks || [];
  const nums = numberBlocks(blocks);
  const secTot = sectionTotals(blocks);
  const total = totalMarks(blocks);
  const assess = c.type !== 'notes';
  const d = c.design || {};
  let h = '';
  if (c.type === 'test' && d.cover) {
    const s = state.settings;
    h += `<div class="cover">${s.logo ? `<img src="${s.logo}" alt="">` : ''}<div>${esc(s.school || '')}</div>
      <div class="big">${esc(subLine(c) || 'Subject')}</div><h1>${esc(c.title)}</h1>
      <table><tr><th>Date</th><td></td><th>Time</th><td>${c.meta?.time ? c.meta.time + ' minutes' : ''}</td></tr><tr><th>Marks</th><td>${total}</td><th>Examiner</th><td>${esc(s.teacherName || '')}</td></tr></table>
      ${learnerBox(0)}
      ${(c.meta?.instructions || []).length ? `<div class="instr"><h3>Instructions</h3><ol>${c.meta.instructions.map(i => `<li>${esc(i)}</li>`).join('')}</ol></div>` : ''}</div><div class="pb"></div>`;
  } else {
    h += schoolBar();
    h += `<h1>${esc(c.title)}</h1>`;
    const sub = subLine(c);
    if (sub) h += `<p class="sub">${esc(sub)}</p>`;
    if (c.type === 'test') {
      const subj = subjectById(c.subjectId);
      h += `<table class="details"><tr><th>Subject</th><td>${esc(subj?.name || '')}</td><th>Grade</th><td>${esc(c.grade || '')}</td><th>Date</th><td></td></tr><tr><th>Time</th><td>${c.meta?.time ? c.meta.time + ' min' : ''}</td><th>Marks</th><td>${total}</td><th>Teacher</th><td>${esc(state.settings.teacherName || '')}</td></tr></table>`;
    }
    if (d.header && assess) h += learnerBox(total);
    if (c.type === 'test' && (c.meta?.instructions || []).length) h += `<div class="instr"><h3>Instructions</h3><ol>${c.meta.instructions.map(i => `<li>${esc(i)}</li>`).join('')}</ol></div>`;
  }
  const chk = assess ? checkFor(c) : null;
  if (chk?.on) h += `<div>${trapHtml(chk)}</div>`;
  let openSec = -1;
  const closeSec = () => { if (openSec >= 0 && assess) h += `<div class="sec-total">[${secTot.get(openSec)}]</div>`; openSec = -1; };
  blocks.forEach((b, i) => {
    const at = ` data-i="${i}"`;
    switch (b.type) {
      case 'heading': h += `<h2${at}>${esc(b.text)}</h2>`; break;
      case 'text': h += `<div${at}>${paras(b.text) || '<p class="ph">Empty paragraph</p>'}</div>`; break;
      case 'list': h += `<ul${at}>${(b.items || []).filter(Boolean).map(x => `<li>${md(x)}</li>`).join('')}</ul>`; break;
      case 'box': h += `<div class="box ${esc(b.style || 'key')}"${at}>${b.title ? `<h3>${esc(b.title)}</h3>` : ''}${paras(b.text)}</div>`; break;
      case 'vocab': h += `<table${at}><tr><th style="width:30%">Term</th><th>Meaning</th></tr>${(b.items || []).map(v => `<tr><td><strong>${esc(v.term)}</strong></td><td>${md(v.meaning)}</td></tr>`).join('')}</table>`; break;
      case 'section':
        closeSec(); openSec = i;
        h += `<div class="sec"${at}><h2>${assess ? nums.get(i) + (b.title ? ': ' : '') : ''}${esc(b.title || '')}</h2>${b.text ? `<p>${md(b.text)}</p>` : ''}</div>`; break;
      case 'question': {
        const opts = b.kind === 'mcq' ? `<div class="opts">${(b.options || []).map((o, k) => `<span><b>${'ABCDEF'[k]}</b>${md(o) || '&nbsp;'}</span>`).join('')}</div>` : '';
        h += `<div${at}><div class="q"><span class="n">${nums.get(i)}</span><div><div class="body">${md(b.q) || '<span class="ph" style="display:block;padding:.4em">Type the question</span>'}</div>${opts}</div><span class="mk">(${+b.marks || 0})</span></div>${linesHtml(autoLines(b))}</div>`;
        break;
      }
      case 'graph': h += `<figure${at} style="width:${b.width || 60}%">${graphSvg(b)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`; break;
      case 'diagram': h += `<figure${at} style="width:${b.width || 60}%">${b.svg || `<div class="ph">Diagram: ${esc(b.prompt || 'describe it and tap Draw it')}</div>`}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`; break;
      case 'image': h += `<figure${at} style="width:${b.width || 60}%">${b.src ? `<img src="${b.src}" alt="${esc(b.caption || '')}">` : '<div class="ph">Add a picture</div>'}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`; break;
      case 'table': h += `<table${at}>${(b.rows || []).map((r, ri) => `<tr>${r.map(cell => ri === 0 ? `<th>${esc(cell)}</th>` : `<td>${md(cell)}</td>`).join('')}</tr>`).join('')}</table>`; break;
      case 'lines': h += `<div${at}>${linesHtml(+b.count || 0, true)}</div>`; break;
      case 'pagebreak': h += `<div class="pb"${at}></div>`; break;
    }
  });
  closeSec();
  if (c.type === 'test') h += `<div class="total">TOTAL: ${total}${trapHtml(chk)}</div>`;
  else if (chk?.on) h += `<div>${trapHtml(chk)}</div>`;
  if (assess && d.memo) h += renderMemo(c, nums, total);
  return h;
}

function renderMemo(c, nums, total) {
  const blocks = c.blocks || [];
  const names = c.meta?.levelNames || [];
  let h = `<div class="pb"></div><h1 class="memo-title">Memorandum</h1><p class="sub">${esc(c.title)}${subLine(c) ? ' · ' + esc(subLine(c)) : ''}</p>`;
  if (c.aiCheck?.on) h += `<p class="sub" style="font-size:.8em;font-style:italic">AI check: the learner pages hide an instruction for AI tools. If “${esc(c.aiCheck.word)}” turns up in answers (about ${c.aiCheck.n} times), the questions were probably pasted into an AI tool. Talk to the learner before drawing conclusions.</p>`;
  h += `<table><tr><th style="width:4.5em">No.</th><th>Answer</th><th style="width:4em">Marks</th>${c.type === 'test' ? '<th style="width:9em">Level</th>' : ''}</tr>`;
  blocks.forEach((b, i) => {
    if (b.type === 'section') h += `<tr><th colspan="${c.type === 'test' ? 4 : 3}">${nums.get(i)}${b.title ? ': ' + esc(b.title) : ''}</th></tr>`;
    if (b.type === 'question') h += `<tr><td>${nums.get(i)}</td><td>${md(b.answer) || '&nbsp;'}</td><td>${+b.marks || 0}</td>${c.type === 'test' ? `<td>${esc(names[(+b.cog || 1) - 1] || 'Level ' + (b.cog || 1))}</td>` : ''}</tr>`;
  });
  h += `<tr><th></th><th>Total</th><th>${total}</th>${c.type === 'test' ? '<th></th>' : ''}</tr></table><p class="sub" style="font-size:.85em">✓ = 1 mark</p>`;
  if (c.type === 'test' && c.design?.grid) {
    h += `<h2>Cognitive level analysis</h2><table><tr><th>Level</th><th>Marks</th><th>% of paper</th><th>Target %</th></tr>`;
    for (const r of cogGrid(c)) {
      const off = Math.abs(r.pct - r.target) > 5;
      h += `<tr><td>${r.level}. ${esc(r.name)}</td><td>${r.marks}</td><td class="${off ? 'lvl-off' : 'lvl-ok'}">${r.pct}%</td><td>${r.target}%</td></tr>`;
    }
    h += `<tr><th>Total</th><th>${total}</th><th>100%</th><th></th></tr></table><p class="sub" style="font-size:.85em">Targets are set in the designer. Check them against your subject’s CAPS and Programme of Assessment requirements.</p>`;
  }
  return h;
}

function renderSlides(c, forPrint) {
  const slides = c.slides || [];
  const subj = subLine(c);
  let h = `<div class="slide title"><div class="bar"></div><div class="in"><h2>${esc(c.title)}</h2><p>${esc(subj)}</p><p style="opacity:.8">${esc(state.settings.teacherName || '')}${state.settings.school ? ' · ' + esc(state.settings.school) : ''}</p></div></div>`;
  slides.forEach((s, i) => {
    const bl = (s.bullets || []).filter(Boolean);
    const img = s.image ? `<img src="${s.image}" alt="">` : '';
    h += `<div class="slide${img ? ' img' : ''}" data-i="${i}"><div class="bar"></div><div class="in"><div><h2>${esc(s.title)}</h2>${bl.length ? `<ul>${bl.map(b => `<li>${md(b)}</li>`).join('')}</ul>` : ''}</div>${img}</div><span class="num">${i + 2}</span></div>`;
    if (forPrint && s.notes) h += `<div class="notes">${esc(s.notes)}</div>`;
  });
  return h;
}

export const rubricMax = c => {
  const top = Math.max(0, ...(c.rubric?.levels || []).map(l => Math.max(...String(l.marks).match(/\d+(?:\.\d+)?/g)?.map(Number) || [0])));
  return top * (c.rubric?.criteria || []).length;
};
function renderRubric(c) {
  const r = c.rubric || { levels: [], criteria: [] };
  let h = schoolBar() + `<h1>${esc(c.title)}</h1>`;
  const sub = subLine(c); if (sub) h += `<p class="sub">${esc(sub)}</p>`;
  if (c.design?.header) h += learnerBox(rubricMax(c));
  if (r.task) h += `<div class="instr"><h3>Task</h3>${paras(r.task)}</div>`;
  h += `<table class="rubric"><tr><th>Criteria</th>${r.levels.map(l => `<th>${esc(l.label)}${l.marks ? ` (${esc(l.marks)})` : ''}</th>`).join('')}<th style="width:4.5em">Mark</th></tr>`;
  r.criteria.forEach((cr, i) => { h += `<tr data-i="${i}"><td class="cr">${esc(cr.name)}</td>${r.levels.map((_, k) => `<td>${md(cr.descriptors?.[k] || '')}</td>`).join('')}<td></td></tr>`; });
  h += `<tr><th colspan="${r.levels.length + 1}" style="text-align:right">Total</th><th>/ ${rubricMax(c)}</th></tr></table>`;
  return h;
}

function renderCards(c) {
  const cards = (c.cards || []).filter(x => x.term || x.meaning);
  const layout = c.design?.layout || 'cards';
  let h = '';
  if (layout === 'glossary') {
    h += schoolBar() + `<h1>${esc(c.title)}</h1>` + (subLine(c) ? `<p class="sub">${esc(subLine(c))}</p>` : '');
    h += `<table><tr><th style="width:32%">Term</th><th>Meaning</th></tr>${cards.map((x, i) => `<tr data-i="${i}"><td><strong>${esc(x.term)}</strong></td><td>${md(x.meaning)}</td></tr>`).join('')}</table>`;
    return h;
  }
  if (layout === 'wordsearch') {
    const words = cards.map(x => x.term);
    const ws = wordSearch(words, c.meta?.seed || 1);
    const grid = (hits) => `<table class="ws">${ws.grid.map((row, r) => `<tr>${row.map((ch, k) => `<td${hits && hits.has(r + ',' + k) ? ' class="hit"' : ''}>${ch}</td>`).join('')}</tr>`).join('')}</table>`;
    h += schoolBar() + `<h1>${esc(c.title)}</h1>` + (subLine(c) ? `<p class="sub">${esc(subLine(c))}</p>` : '');
    if (c.design?.header) h += learnerBox(0);
    h += `<p>Find these words. They go across, down or diagonally.</p>` + grid(null);
    h += `<ul class="words">${ws.placed.map(p => `<li>${esc(p.word)}</li>`).join('')}</ul>`;
    if (ws.skipped.length) h += `<p class="sub">Left out (too long or wouldn’t fit): ${ws.skipped.map(esc).join(', ')}</p>`;
    h += `<div class="pb"></div><h1>Answers</h1>` + grid(new Set(ws.placed.flatMap(p => p.cells)));
    return h;
  }
  // Cut-out cards: fronts, then backs mirrored for double-sided printing.
  for (let p = 0; p < Math.max(1, Math.ceil(cards.length / 8)); p++) {
    const page = cards.slice(p * 8, p * 8 + 8);
    while (page.length % 2) page.push({ term: '', meaning: '' });
    h += `<div class="cards front">${page.map(x => `<div>${esc(x.term)}</div>`).join('')}</div><div class="pb"></div>`;
    const backs = []; for (let k = 0; k < page.length; k += 2) backs.push(page[k + 1], page[k]);
    h += `<div class="cards">${backs.map(x => `<div>${md(x.meaning)}</div>`).join('')}</div>`;
    if (p < Math.ceil(cards.length / 8) - 1) h += '<div class="pb"></div>';
  }
  return h;
}

// ---------- Word search ----------
function rng(seed) { let s = seed >>> 0 || 7; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; }; }
export function wordSearch(words, seed) {
  const rand = rng(seed);
  const clean = [...new Set(words.map(w => String(w).toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 3))];
  const size = Math.min(16, Math.max(10, ...clean.map(w => w.length + 1)));
  const fit = clean.filter(w => w.length <= size);
  const skipped = clean.filter(w => w.length > size).concat(words.filter(w => String(w).replace(/[^a-z]/gi, '').length < 3 && String(w).trim()));
  const grid = Array.from({ length: size }, () => Array(size).fill(''));
  const dirs = [[0, 1], [1, 0], [1, 1], [-1, 1]];
  const placed = [];
  for (const w of fit.sort((a, b) => b.length - a.length)) {
    let ok = false;
    for (let t = 0; t < 300 && !ok; t++) {
      const [dr, dc] = dirs[Math.floor(rand() * dirs.length)];
      const r0 = Math.floor(rand() * size), c0 = Math.floor(rand() * size);
      const cells = [];
      for (let k = 0; k < w.length; k++) {
        const r = r0 + dr * k, cc = c0 + dc * k;
        if (r < 0 || r >= size || cc >= size || (grid[r][cc] && grid[r][cc] !== w[k])) { cells.length = 0; break; }
        cells.push([r, cc]);
      }
      if (cells.length === w.length) { cells.forEach(([r, cc], k) => grid[r][cc] = w[k]); placed.push({ word: w, cells: cells.map(([r, cc]) => r + ',' + cc) }); ok = true; }
    }
    if (!ok) skipped.push(w);
  }
  const A = 'ABCDEFGHIJKLMNOPRSTUVWY';
  for (const row of grid) for (let k = 0; k < size; k++) if (!row[k]) row[k] = A[Math.floor(rand() * A.length)];
  placed.sort((a, b) => a.word.localeCompare(b.word));
  return { grid, placed, skipped };
}

export function printCreation(c) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to print.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>@page{size:A4;margin:14mm 14mm 16mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:10px Arial,sans-serif;color:#666}}body{margin:0}${themeCss()}</style></head><body>${renderCreation(c, { forPrint: true })}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
