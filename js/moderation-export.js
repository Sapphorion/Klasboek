// Moderation report: Word (.docx) and print-ready page.
import { state, subjectById, subjectLabel } from './state.js';
import { docKit, metaRows, openPrint } from './exporters.js';
import { stats, variance, LEVELS } from './moderation-core.js';
import { fmtLong } from './dates.js';
import { esc } from './ui.js';

function summary(m) {
  const st = stats(m.learners, m.total); const v = variance(m.learners, m.total, m.tolerance);
  const sample = m.learners.filter(l => l.sampled).sort((a, b) => b.pct - a.pct);
  const subj = subjectById(m.subjectId);
  return { st, v, sample, subj, pass: st.n ? Math.round(m.learners.filter(l => l.pct != null && l.pct >= m.borderline).length / st.n * 100) : 0 };
}

export async function exportModerationDocx(m) {
  const k = await docKit();
  const { st, v, sample, subj, pass } = summary(m);
  const kids = [
    k.p('Moderation report', { bold: true, size: 36, color: k.B, after: 60 }),
    k.p(m.title || '', { size: 28, after: 200 }),
    metaRows(k, [['Subject', subj ? subjectLabel(subj) : ''], ['Class', m.cls || ''], ['Teacher', m.teacher || ''], ['Moderator', m.moderator || ''], ['Level', m.level || ''], ['Date', m.date ? fmtLong(m.date) : ''], ['Total marks', String(m.total)], ['Tolerance', `± ${m.tolerance}% of total`]]),
    k.heading('Class results'),
    metaRows(k, [['Learners marked', String(st.n || 0)], ['Absent / no mark', String(m.learners.length - (st.n || 0))], ['Average', st.n ? st.mean.toFixed(1) + '%' : '–'], ['Median', st.n ? st.median.toFixed(1) + '%' : '–'], ['Highest', st.n ? st.max + '%' : '–'], ['Lowest', st.n ? st.min + '%' : '–'], [`At or above ${m.borderline}%`, pass + '%'], ['Sample', `${sample.length} scripts`]]),
    k.p('', { after: 80 }),
    k.table([1337, 1337, 1337, 1337, 1337, 1337, 1338], [
      k.row(LEVELS.map(L => k.cell(`Level ${L.level}\n${L.min}–${L.max}%`, { bold: true, fill: 'EEF2F0', w: 1337, size: 18 }))),
      k.row(LEVELS.map((L, i) => k.cell(`${st.levels?.[i] || 0} learners\n${sample.filter(s => s.level === L.level).length} sampled`, { w: 1337, size: 18 }))),
    ]),
    k.heading('Scripts moderated'),
    k.p(v.moderated ? `${v.moderated} of ${sample.length} scripts moderated. ${v.outside} outside the tolerance of ± ${m.tolerance}%. Average difference ${v.avgPct >= 0 ? '+' : ''}${v.avgPct.toFixed(1)}%.` : 'No moderator marks entered yet.', { italics: true }),
  ];
  const W = [1900, 1000, 700, 700, 1800, 1150, 1250, 860];
  kids.push(k.table(W, [
    k.row(['Learner', 'Teacher', '%', 'Level', 'Selected because', 'Moderator', 'Difference', 'Note'].map((t, i) => k.cell(t, { bold: true, fill: k.B, color: 'FFFFFF', w: W[i], size: 16 })), { header: true }),
    ...sample.map(l => {
      const r = v.rows.find(x => x.name === l.name && x.mark === l.mark);
      const fill = r && !r.within ? 'FBE3E1' : undefined;
      return k.row([l.name, `${l.mark}/${m.total}`, `${l.pct}`, String(l.level), l.reason, l.modMark ?? '', r ? `${r.diff > 0 ? '+' : ''}${r.diff} (${r.diffPct.toFixed(1)}%)` : '', l.note || ''].map((t, i) => k.cell(String(t), { w: W[i], size: 18, fill })), { cantSplit: true });
    }),
  ]));
  for (const [title, items] of [['Assessment task and scripts', m.scriptChecks], ['Teacher file', m.fileChecks]]) {
    const CW = [5000, 900, 3460];
    kids.push(k.heading(title), k.table(CW, [
      k.row(['Item', 'Yes/No', 'Comment'].map((t, i) => k.cell(t, { bold: true, fill: k.B, color: 'FFFFFF', w: CW[i], size: 18 })), { header: true }),
      ...(items || []).map(it => k.row([k.cell(it.text, { w: CW[0], size: 18 }), k.cell(it.answer || '', { w: CW[1], size: 18, bold: true, fill: it.answer === 'No' ? 'FBE3E1' : undefined }), k.cell(it.comment || '', { w: CW[2], size: 18 })], { cantSplit: true })),
    ]));
  }
  kids.push(k.heading('Findings'), ...(m.findings ? k.multi(m.findings) : k.lines(3)));
  kids.push(k.heading('Recommendations / follow-up'), ...(m.recommendations ? k.multi(m.recommendations) : k.lines(3)));
  kids.push(k.heading('Sign-off'), k.table([2400, 3480, 3480], [
    k.row([k.cell('', { w: 2400, fill: 'EEF2F0' }), k.cell('Teacher', { bold: true, w: 3480, fill: 'EEF2F0' }), k.cell('Moderator', { bold: true, w: 3480, fill: 'EEF2F0' })]),
    k.row([k.cell('Name', { bold: true, w: 2400 }), k.cell(m.teacher || '', { w: 3480 }), k.cell(m.moderator || '', { w: 3480 })]),
    k.row([k.cell('Signature', { bold: true, w: 2400 }), k.cell('\n\n', { w: 3480 }), k.cell('\n\n', { w: 3480 })]),
    k.row([k.cell('Date', { bold: true, w: 2400 }), k.cell('', { w: 3480 }), k.cell('', { w: 3480 })]),
  ]));
  await k.save(kids, `Moderation report - ${m.title || ''} - ${m.cls || ''}`);
}

export function printModeration(m) {
  const { st, v, sample, subj, pass } = summary(m);
  const chk = (title, items) => `<h2>${esc(title)}</h2><table><tr class="hd"><th style="width:55%">Item</th><th>Yes/No</th><th>Comment</th></tr>${(items || []).map(i => `<tr><td>${esc(i.text)}</td><td><b>${esc(i.answer)}</b></td><td>${esc(i.comment)}</td></tr>`).join('')}</table>`;
  const body = `<h1>Moderation report</h1><p class="sub">${esc(m.title)}</p>
  <table class="meta"><tr><th>Subject</th><td>${esc(subj ? subjectLabel(subj) : '')}</td><th>Class</th><td>${esc(m.cls)}</td></tr>
  <tr><th>Teacher</th><td>${esc(m.teacher)}</td><th>Moderator</th><td>${esc(m.moderator)}</td></tr>
  <tr><th>Level</th><td>${esc(m.level)}</td><th>Date</th><td>${m.date ? esc(fmtLong(m.date)) : ''}</td></tr>
  <tr><th>Total</th><td>${m.total}</td><th>Tolerance</th><td>± ${m.tolerance}%</td></tr></table>
  <h2>Class results</h2><p>${st.n} learners marked · average ${st.n ? st.mean.toFixed(1) : '–'}% · highest ${st.max ?? '–'}% · lowest ${st.min ?? '–'}% · ${pass}% at or above ${m.borderline}%</p>
  <table><tr class="hd">${LEVELS.map(L => `<th>L${L.level} (${L.min}–${L.max})</th>`).join('')}</tr><tr>${LEVELS.map((L, i) => `<td>${st.levels?.[i] || 0} (${sample.filter(s => s.level === L.level).length} sampled)</td>`).join('')}</tr></table>
  <h2>Scripts moderated</h2><p>${v.moderated ? `${v.moderated} of ${sample.length} moderated; ${v.outside} outside tolerance; average difference ${v.avgPct.toFixed(1)}%.` : 'No moderator marks entered yet.'}</p>
  <table><tr class="hd"><th>Learner</th><th>Teacher</th><th>%</th><th>Level</th><th>Selected because</th><th>Moderator</th><th>Diff</th><th>Note</th></tr>
  ${sample.map(l => { const r = v.rows.find(x => x.name === l.name && x.mark === l.mark); return `<tr${r && !r.within ? ' style="background:#fbe3e1"' : ''}><td>${esc(l.name)}</td><td>${l.mark}/${m.total}</td><td>${l.pct}</td><td>${l.level}</td><td>${esc(l.reason)}</td><td>${l.modMark ?? ''}</td><td>${r ? (r.diff > 0 ? '+' : '') + r.diff : ''}</td><td>${esc(l.note)}</td></tr>`; }).join('')}</table>
  ${chk('Assessment task and scripts', m.scriptChecks)}${chk('Teacher file', m.fileChecks)}
  <h2>Findings</h2><p>${esc(m.findings).replace(/\n/g, '<br>') || '<div class="ln"></div><div class="ln"></div>'}</p>
  <h2>Recommendations / follow-up</h2><p>${esc(m.recommendations).replace(/\n/g, '<br>') || '<div class="ln"></div><div class="ln"></div>'}</p>
  <h2>Sign-off</h2><table><tr class="hd"><th></th><th>Teacher</th><th>Moderator</th></tr><tr><th>Name</th><td>${esc(m.teacher)}</td><td>${esc(m.moderator)}</td></tr><tr><th>Signature</th><td style="height:40px"></td><td></td></tr><tr><th>Date</th><td></td><td></td></tr></table>`;
  openPrint(body, 'Moderation report');
}
