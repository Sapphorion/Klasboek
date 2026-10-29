// Moderation mark sheets: upload a mark sheet or class register and get a form with a column for the
// teacher's red marks, then green, orange and (if wanted) purple moderation. Print it in colour, or
// download it for Word or Excel.
import { state, saveModeration, deleteModeration, saveSettings, subjectById, subjectLabel } from '../state.js';
import { markBookButton } from './schoolui.js';
import { h, icon, toast, modal, confirmBox, dropZone, esc, busy, download, loadScript, safeName } from '../ui.js';
import { readMarksheet, toNumber } from '../importers.js';
import { selectSample } from '../moderation-core.js';
import { today, fmtLong } from '../dates.js';
import { docKit, openPrint } from '../exporters.js';

export const PENS = [
  { key: 'red', colour: '#C62828', label: 'Red', who: 'Teacher' },
  { key: 'green', colour: '#2E7D32', label: 'Green', who: 'School moderation (HOD)' },
  { key: 'orange', colour: '#E26A00', label: 'Orange', who: 'Cluster / district moderation' },
  { key: 'purple', colour: '#6A1B9A', label: 'Purple', who: 'Provincial moderation' },
];
export const isSheet = m => m?.kind === 'colours';
const pensOf = m => PENS.filter(p => p.key !== 'purple' || m.purple);
const stage = (m, key) => (m.stages ||= {})[key] ||= { name: '', date: '', label: '' };
const whoOf = (m, p) => stage(m, p.key).label || p.who;
const val = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
// The mark that counts: the last moderation that was entered, otherwise the teacher's.
export const finalOf = (m, r) => { for (const p of [...pensOf(m)].reverse()) if (val(r[p.key]) != null) return { mark: val(r[p.key]), pen: p }; return null; };
const pct = (m, v) => m.total ? Math.round(v / m.total * 1000) / 10 : null;
const tol = m => m.tolerance ?? state.settings.modTolerance ?? 5;
const off = (m, r, key) => key !== 'red' && val(r[key]) != null && val(r.red) != null && m.total && Math.abs(val(r[key]) - val(r.red)) / m.total * 100 > tol(m);

// ---------- The tab ----------
export function sheetsTab(page) {
  const status = h('div', { 'aria-live': 'polite' });
  page.append(h('div', { class: 'mod-start' },
    h('p', { class: 'muted' }, 'Upload a mark sheet or a class register. Teacher’s Desk makes a form with a column for your red marks, then green and orange moderation, and purple if you need it. Type the marks in and print or download it in colour.'),
    dropZone({ accept: '.xlsx,.xls,.csv,.docx,.pdf', label: 'Upload a mark sheet or register', hint: 'Excel, CSV, Word table or a text PDF (e.g. an SA-SAMS class list).', onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try { const sheet = await readMarksheet(file); status.replaceChildren(); setupSheet(sheet, file.name); }
      catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    } }),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn ghost sm', onclick: () => setupSheet(null, '') }, icon('pen', 16), 'Type or paste the names instead'), markBookButton()),
    status));
  const list = state.moderations.filter(isSheet).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  page.append(h('h2', {}, 'Your moderation mark sheets'));
  if (!list.length) page.append(h('p', { class: 'empty' }, 'None yet. Upload a mark sheet or register to make one.'));
  else page.append(h('ul', { class: 'mod-list' }, list.map(m => {
    const subj = subjectById(m.subjectId);
    const done = pensOf(m).map(p => `${p.label} ${m.rows.filter(r => val(r[p.key]) != null).length}`).join(' · ');
    return h('li', {}, h('a', { href: '#moderation/' + m.id, style: { '--subj': subj?.colour || '#777' } },
      h('strong', {}, m.title || 'Untitled task'),
      h('span', { class: 'muted small' }, [subj ? subjectLabel(subj) : '', m.cls, `${m.rows.length} learners`, done].filter(Boolean).join(' · ')),
      h('span', { class: 'pen-dots' }, pensOf(m).map(p => h('i', { style: { background: p.colour }, title: p.label })))));
  })));
  return page;
}

// ---------- Setting one up ----------
function setupSheet(sheet, fileName) {
  const f = {
    nameCols: sheet ? sheet.nameCols.slice(0, 2) : [], markCol: sheet?.markCols[0] ?? -1, pasted: '',
    total: '', title: '', subjectId: state.subjects[0]?.id || '', cls: '', teacher: state.settings.teacherName || '', purple: false,
  };
  const guess = () => {
    if (!sheet || f.markCol < 0) return '';
    if (sheet.totals[f.markCol]) return sheet.totals[f.markCol];
    const max = Math.max(0, ...sheet.rows.map(r => toNumber(r[f.markCol])).filter(n => n != null));
    return max ? [10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 100, 120, 150, 200, 300].find(t => t >= max) || Math.ceil(max) : '';
  };
  const clean = t => String(t || '').replace(/\s*[([]?\s*(?:\/|out of|uit|max\.?)?\s*\d{1,3}\s*[)\]]?\s*$/i, '').trim();
  if (sheet) { f.total = guess(); if (f.markCol >= 0) f.title = clean(sheet.headers[f.markCol]); }
  const body = h('div', {});
  const md = modal('Make a moderation mark sheet', body, { wide: true });
  const rowsNow = () => sheet ? sheet.rows.map(r => ({
      name: f.nameCols.map(i => String(r[i] ?? '').trim()).filter(Boolean).join(' '),
      red: f.markCol >= 0 ? markOrBlank(r[f.markCol]) : '',
    })).filter(l => l.name && !/^\d+$/.test(l.name))
    : f.pasted.split('\n').map(t => t.replace(/^\s*\d+[.)]?\s+/, '').trim()).filter(Boolean).map(name => ({ name, red: '' }));
  const draw = () => {
    const rows = rowsNow();
    body.replaceChildren(
      sheet ? h('p', { class: 'muted' }, `From ${fileName}: ${sheet.rows.length} rows, ${sheet.headers.length} columns.`) : null,
      h('div', { class: 'form-grid' },
        sheet ? h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', { class: 'lbl' }, 'Learner name column(s)'), h('div', { class: 'chips' }, sheet.headers.map((hd, i) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: f.nameCols.includes(i), onchange: e => { f.nameCols = e.target.checked ? [...f.nameCols, i].sort((a, b) => a - b) : f.nameCols.filter(x => x !== i); draw(); } }), hd))))
          : h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', { class: 'lbl' }, 'Learners (one per line)'), h('textarea', { rows: 8, placeholder: 'Abrahams, Lee\nBotha, Anri\n…', oninput: e => { f.pasted = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => { const a = document.activeElement, p = a?.selectionStart; draw(); const t = body.querySelector('textarea'); if (t) { t.focus(); t.setSelectionRange(p, p); } }, 500); } }, f.pasted)),
        sheet ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Red marks already in the file?'), h('select', { onchange: e => { f.markCol = +e.target.value; f.total = guess() || f.total; if (f.markCol >= 0 && !f.title) f.title = clean(sheet.headers[f.markCol]); draw(); } },
          h('option', { value: -1, selected: f.markCol < 0 }, 'No, I’ll type them in'),
          sheet.headers.map((hd, i) => sheet.markCols.includes(i) ? h('option', { value: i, selected: i === f.markCol }, 'Yes: ' + hd) : null))) : null,
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Total marks for the task'), h('input', { type: 'number', min: 1, value: f.total, placeholder: 'e.g. 50', oninput: e => f.total = +e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Task name'), h('input', { value: f.title, placeholder: 'e.g. Term 3 Control Test', oninput: e => f.title = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('select', { onchange: e => f.subjectId = e.target.value }, h('option', { value: '' }, '—'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === f.subjectId }, subjectLabel(s))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Class'), h('input', { value: f.cls, placeholder: 'e.g. 10A', oninput: e => f.cls = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Teacher'), h('input', { value: f.teacher, oninput: e => f.teacher = e.target.value })),
        h('label', { class: 'check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: f.purple, onchange: e => f.purple = e.target.checked }), 'Add a purple (provincial) column')),
      h('div', { class: 'pen-legend' }, PENS.map(p => h('span', { style: { '--pen': p.colour } }, h('i'), `${p.label}: ${p.who}`))),
      h('h3', {}, 'Preview'),
      h('p', { class: 'muted small' }, `${rows.length} learners.`),
      rows.length ? h('div', { class: 'table-wrap short' }, h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Learner'), h('th', { style: { color: PENS[0].colour } }, 'Red'))),
        h('tbody', {}, rows.slice(0, 8).map((l, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, l.name), h('td', { style: { color: PENS[0].colour } }, l.red)))))) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => md.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          const list = rowsNow();
          if (!list.length) { toast(sheet ? 'Choose the column with the learners’ names.' : 'Type or paste the learners’ names.', 'error'); return; }
          if (!(+f.total > 0)) { toast('Enter the total marks for the task.', 'error'); return; }
          const m = await saveModeration({ kind: 'colours', title: f.title || 'Moderation mark sheet', subjectId: f.subjectId, cls: f.cls, teacher: f.teacher, total: +f.total, purple: f.purple,
            tolerance: state.settings.modTolerance, source: fileName, date: today(), stages: {}, rows: list.map(l => ({ name: l.name, red: l.red, green: '', orange: '', purple: '', note: '' })) });
          md.close(); location.hash = 'moderation/' + m.id; toast('Mark sheet ready. Type the marks straight in.');
        } }, 'Make the mark sheet')));
  };
  draw();
}
const markOrBlank = v => { const s = String(v ?? '').trim(); if (!s) return ''; if (/^(ab|a|abs|absent|afw)$/i.test(s)) return 'AB'; const n = toNumber(s); return n == null ? '' : n; };

// ---------- The form ----------
export function sheetDetail(m) {
  const quiet = () => saveModeration(m, { silent: true });
  const save = () => saveModeration(m);
  let t; const later = () => { clearTimeout(t); t = setTimeout(() => { quiet(); refreshSums(); }, 400); };
  const subj = subjectById(m.subjectId);
  const pens = pensOf(m);
  const page = h('div', { class: 'page mod-detail mark-form' });
  page.append(h('header', { class: 'page-head' },
    h('a', { href: '#moderation/sheets', class: 'back' }, icon('left', 16), 'All moderation mark sheets'),
    h('div', { class: 'row between wrap' },
      h('input', { class: 'title-input h1', value: m.title || '', 'aria-label': 'Task name', oninput: e => { m.title = e.target.value; later(); } }),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => printSheet(m) }, icon('print'), 'Print / PDF'),
        (() => { const b = h('button', { class: 'btn ghost' }, icon('doc'), 'Word'); b.onclick = async () => { const d = busy(b, 'Building…'); try { await sheetDocx(m); } catch (e) { toast(e.message, 'error'); } finally { d(); } }; return b; })(),
        (() => { const b = h('button', { class: 'btn ghost' }, icon('sheet'), 'Excel'); b.onclick = async () => { const d = busy(b, 'Building…'); try { await sheetXlsx(m); } catch (e) { toast(e.message, 'error'); } finally { d(); } }; return b; })(),
        h('button', { class: 'btn ghost danger', 'aria-label': 'Delete this mark sheet', onclick: async () => { if (await confirmBox('Delete this mark sheet?')) { await deleteModeration(m.id); location.hash = 'moderation/sheets'; } } }, icon('trash', 16)))),
    h('p', { class: 'muted' }, [subj ? subjectLabel(subj) : '', m.cls, `Out of ${m.total}`, m.teacher ? 'Teacher: ' + m.teacher : '', m.source].filter(Boolean).join(' · '))));

  // Who moderated, and when
  page.append(h('section', { class: 'pen-stages' }, pens.map(p => {
    const s = stage(m, p.key);
    return h('div', { class: 'pen-stage', style: { '--pen': p.colour } },
      h('div', { class: 'pen-name' }, h('i'), h('strong', {}, p.label), h('input', { class: 'pen-who', value: whoOf(m, p), 'aria-label': `${p.label} column: who`, oninput: e => { s.label = e.target.value.trim() === p.who ? '' : e.target.value.trim(); later(); } })),
      h('div', { class: 'row' },
        h('input', { value: p.key === 'red' ? (s.name || m.teacher || '') : s.name, placeholder: p.key === 'red' ? 'Teacher' : 'Moderator’s name', 'aria-label': `${p.label}: name`, oninput: e => { s.name = e.target.value; if (p.key === 'red') m.teacher = e.target.value; later(); } }),
        h('input', { type: 'date', value: s.date || '', 'aria-label': `${p.label}: date`, onchange: e => { s.date = e.target.value; quiet(); } })));
  }),
  h('div', { class: 'pen-opts' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!m.purple, onchange: async e => { if (!e.target.checked && m.rows.some(r => val(r.purple) != null) && !await confirmBox('Remove the purple column? The purple marks will be kept in case you switch it back on.', 'Remove')) { e.target.checked = true; return; } m.purple = e.target.checked; save(); } }), 'Purple (provincial) column'),
    h('label', { class: 'inline' }, 'Out of', h('input', { type: 'number', min: 1, value: m.total, style: { width: '5rem' }, onchange: e => { if (+e.target.value > 0) { m.total = +e.target.value; save(); } } })),
    h('label', { class: 'inline' }, 'Flag changes over', h('input', { type: 'number', min: 0, max: 50, value: tol(m), style: { width: '4rem' }, onchange: e => { m.tolerance = Math.max(0, +e.target.value || 0); save(); } }), '% of the total'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!m.onlySample, onchange: e => { m.onlySample = e.target.checked; save(); } }), 'Show only the moderation sample'),
    h('button', { class: 'btn ghost sm', onclick: () => pickSample(m, save) }, m.rows.some(r => r.sampled) ? 'Pick a new sample' : 'Pick a sample for moderation'))));

  // The table
  const sums = h('tfoot', {});
  const inputs = [];
  const shown = m.rows.map((r, i) => [r, i]).filter(([r]) => !m.onlySample || r.sampled);
  const cellIn = (r, i, p, rowIx, colIx) => {
    const inp = h('input', { class: 'pen-in', inputmode: 'decimal', value: r[p.key] ?? '', style: { color: p.colour }, 'aria-label': `${p.label} mark for ${r.name}`, 'data-r': rowIx, 'data-c': colIx,
      oninput: e => { const v = e.target.value.trim(); r[p.key] = /^ab/i.test(v) ? 'AB' : v === '' ? '' : (toNumber(v) ?? v); bad(e.target, r, p); markRow(); later(); },
      onkeydown: e => {
        const go = (dr, dc) => { const n = page.querySelector(`.pen-in[data-r="${rowIx + dr}"][data-c="${colIx + dc}"]`); if (n) { e.preventDefault(); n.focus(); n.select(); } };
        if (e.key === 'Enter' || e.key === 'ArrowDown') go(1, 0); else if (e.key === 'ArrowUp') go(-1, 0);
        else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) go(0, 1); else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) go(0, -1);
      } });
    const tr = () => inp.closest('tr');
    const markRow = () => { const row = tr(); if (!row) return; const fin = finalOf(m, r); row.querySelector('.fin').replaceChildren(fin ? h('span', { style: { color: fin.pen.colour } }, fmtN(fin.mark)) : '', fin && val(r.red) != null && fin.pen.key !== 'red' && fin.mark !== val(r.red) ? h('small', {}, ` (${fin.mark > val(r.red) ? '+' : ''}${fmtN(fin.mark - val(r.red))})`) : ''); row.classList.toggle('off-tol', pens.some(q => off(m, r, q.key))); };
    bad(inp, r, p);
    inputs.push(inp);
    return h('td', { class: 'pen-td' }, inp);
  };
  const tbody = h('tbody', {}, shown.map(([r, i], rowIx) => {
    const fin = finalOf(m, r);
    return h('tr', { class: pens.some(q => off(m, r, q.key)) ? 'off-tol' : '' },
      h('td', { class: 'num muted' }, i + 1),
      h('td', {}, h('input', { class: 'name-in', value: r.name, 'aria-label': 'Learner name', oninput: e => { r.name = e.target.value; later(); } }), r.sampled ? h('span', { class: 'sample-dot', title: r.reason || 'In the moderation sample' }) : null),
      pens.map((p, c) => cellIn(r, i, p, rowIx, c)),
      h('td', { class: 'num fin' }, fin ? h('span', { style: { color: fin.pen.colour } }, fmtN(fin.mark)) : '', fin && val(r.red) != null && fin.pen.key !== 'red' && fin.mark !== val(r.red) ? h('small', {}, ` (${fin.mark > val(r.red) ? '+' : ''}${fmtN(fin.mark - val(r.red))})`) : ''),
      h('td', {}, h('input', { class: 'note-in', value: r.note || '', placeholder: 'Note', 'aria-label': `Note for ${r.name}`, oninput: e => { r.note = e.target.value; later(); } })),
      h('td', {}, h('button', { class: 'icon-btn', 'aria-label': `Remove ${r.name}`, onclick: async () => { if (await confirmBox(`Remove ${r.name} from this mark sheet?`, 'Remove')) { m.rows.splice(i, 1); save(); } } }, icon('x', 14))));
  }));
  const refreshSums = () => sums.replaceChildren(
    h('tr', {}, h('td'), h('th', {}, 'Marks entered'), pens.map(p => h('td', { class: 'num', style: { color: p.colour } }, String(m.rows.filter(r => val(r[p.key]) != null).length))), h('td', { class: 'num' }, String(m.rows.filter(r => finalOf(m, r)).length)), h('td'), h('td')),
    h('tr', {}, h('td'), h('th', {}, 'Average'), pens.map(p => h('td', { class: 'num', style: { color: p.colour } }, avg(m, r => val(r[p.key])))), h('td', { class: 'num' }, avg(m, r => finalOf(m, r)?.mark)), h('td'), h('td')));
  refreshSums();
  page.append(h('section', {},
    h('div', { class: 'table-wrap' }, h('table', { class: 'data pen-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Learner'), pens.map(p => h('th', { class: 'pen-th', style: { '--pen': p.colour } }, p.label, h('small', {}, whoOf(m, p)))), h('th', {}, 'Final', h('small', {}, 'last moderation')), h('th', {}, 'Note'), h('th', {}, h('span', { class: 'sr' }, 'Remove')))),
      tbody, sums)),
    m.onlySample && !shown.length ? h('p', { class: 'muted' }, 'No sample picked yet. Tap “Pick a sample for moderation”.') : null,
    h('p', { class: 'muted small' }, `Type “AB” for absent. Enter or ↓ moves down a column. Rows turn pink when a moderated mark differs from the red mark by more than ${tol(m)}% of the total.`),
    addRow(m, save)));

  page.append(h('section', {}, h('h2', {}, 'Comments'),
    h('div', { class: 'form-grid' }, pens.filter(p => p.key !== 'red').map(p => h('label', { class: 'field' }, h('span', { class: 'lbl', style: { color: p.colour } }, `${p.label} moderator’s comments`), h('textarea', { rows: 3, oninput: e => { stage(m, p.key).comment = e.target.value; later(); } }, stage(m, p.key).comment || ''))))));
  return page;
}
const fmtN = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
function avg(m, get) { const v = m.rows.map(get).filter(x => x != null); if (!v.length) return '–'; const a = v.reduce((s, x) => s + x, 0) / v.length; return `${fmtN(Math.round(a * 10) / 10)} (${pct(m, a)}%)`; }
function bad(inp, r, p) { const v = r[p.key]; inp.classList.toggle('bad', v !== '' && v != null && v !== 'AB' && (isNaN(+v) || +v < 0)); }
function addRow(m, save) {
  const inp = h('input', { placeholder: 'Add a learner…', 'aria-label': 'Add a learner', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { m.rows.push({ name: e.target.value.trim(), red: '', green: '', orange: '', purple: '', note: '' }); save(); } } });
  return h('div', { class: 'row' }, inp);
}
function pickSample(m, save) {
  const learners = m.rows.map(r => ({ name: r.name, mark: val(r.red) }));
  if (!learners.some(l => l.mark != null)) { toast('Enter the red marks first, so the sample can cover high, middle and low marks.', 'warn'); return; }
  const s = state.settings;
  const res = selectSample(learners, { total: m.total, percent: s.modPercent, min: s.modMin, borderline: s.modBorderline, seed: Date.now() % 2147483647 });
  res.learners.forEach((l, i) => { m.rows[i].sampled = !!l.sampled; m.rows[i].reason = l.reason || ''; });
  m.onlySample = m.onlySample ?? false;
  save(); toast(`${res.learners.filter(l => l.sampled).length} learners marked for moderation (•). Tick “Show only the moderation sample” to see just them.`);
}

// ---------- Print, Word, Excel ----------
const rowsFor = m => m.rows.filter(r => !m.onlySample || r.sampled);
function headLine(m) {
  const subj = subjectById(m.subjectId);
  return [['Subject', subj ? subjectLabel(subj) : ''], ['Class', m.cls || ''], ['Task', m.title || ''], ['Total', String(m.total)]];
}
function printSheet(m) {
  const pens = pensOf(m);
  const cellTxt = v => v === '' || v == null ? '' : esc(String(v));
  const body = `<style>.pen th.p{color:#fff}.pen td.c{text-align:center;font-weight:700;font-size:13pt}.pen td.n{text-align:center;color:#666}.sig td{height:34px}</style>
  <h1>Moderation mark sheet</h1>
  <table class="meta">${headLine(m).map(([k, v], i) => `${i % 2 ? '' : '<tr>'}<th>${k}</th><td>${esc(v)}</td>${i % 2 ? '</tr>' : ''}`).join('')}</table>
  <table class="pen"><tr class="hd"><th>#</th><th>Learner</th>${pens.map(p => `<th class="p" style="background:${p.colour}">${p.label}<br><small>${esc(whoOf(m, p))}</small></th>`).join('')}<th>Final</th></tr>
  ${rowsFor(m).map(r => { const i = m.rows.indexOf(r); const f = finalOf(m, r); return `<tr><td class="n">${i + 1}</td><td>${esc(r.name)}</td>${pens.map(p => `<td class="c" style="color:${p.colour}">${cellTxt(r[p.key])}</td>`).join('')}<td class="c"${f ? ` style="color:${f.pen.colour}"` : ''}>${f ? fmtN(f.mark) : ''}</td></tr>`; }).join('')}</table>
  <h2>Sign-off</h2><table class="sig"><tr class="hd"><th></th><th>Name</th><th>Signature</th><th>Date</th></tr>
  ${pens.map(p => { const s = stage(m, p.key); return `<tr><th style="color:${p.colour}">${p.label}: ${esc(whoOf(m, p))}</th><td>${esc(p.key === 'red' ? (s.name || m.teacher || '') : s.name)}</td><td></td><td>${s.date ? esc(fmtLong(s.date)) : ''}</td></tr>`; }).join('')}</table>
  ${pens.filter(p => p.key !== 'red' && stage(m, p.key).comment).map(p => `<h2 style="color:${p.colour}">${p.label} moderator’s comments</h2><p>${esc(stage(m, p.key).comment).replace(/\n/g, '<br>')}</p>`).join('')}`;
  openPrint(body, `Moderation mark sheet - ${m.title || ''}`);
}
async function sheetDocx(m) {
  const k = await docKit();
  const pens = pensOf(m);
  const hex = c => c.replace('#', '');
  const W = [600, 3400, ...pens.map(() => Math.floor(4300 / (pens.length + 1))), Math.floor(4300 / (pens.length + 1))];
  const kids = [
    k.p('Moderation mark sheet', { bold: true, size: 36, color: k.B, after: 120 }),
    k.table([1600, 3080, 1600, 3080], [0, 2].map(i => { const L = headLine(m); return k.row([k.cell(L[i][0], { bold: true, fill: 'EEF2F0', w: 1600 }), k.cell(L[i][1], { w: 3080 }), k.cell(L[i + 1][0], { bold: true, fill: 'EEF2F0', w: 1600 }), k.cell(L[i + 1][1], { w: 3080 })]); })),
    k.p('', { after: 120 }),
    k.table(W, [
      k.row([k.cell('#', { bold: true, fill: 'EEF2F0', w: W[0], size: 18 }), k.cell('Learner', { bold: true, fill: 'EEF2F0', w: W[1], size: 18 }),
        ...pens.map((p, j) => k.cell(`${p.label}\n${whoOf(m, p)}`, { bold: true, fill: hex(p.colour), color: 'FFFFFF', w: W[2 + j], size: 16 })),
        k.cell('Final', { bold: true, fill: 'EEF2F0', w: W.at(-1), size: 18 })], { header: true }),
      ...rowsFor(m).map(r => { const f = finalOf(m, r); return k.row([k.cell(String(m.rows.indexOf(r) + 1), { w: W[0], size: 18, color: '666666' }), k.cell(r.name, { w: W[1], size: 20 }),
        ...pens.map((p, j) => k.cell(r[p.key] === '' || r[p.key] == null ? '' : String(r[p.key]), { w: W[2 + j], size: 22, bold: true, color: hex(p.colour), align: 'center' })),
        k.cell(f ? fmtN(f.mark) : '', { w: W.at(-1), size: 22, bold: true, color: f ? hex(f.pen.colour) : undefined })], { cantSplit: true }); }),
    ]),
    k.heading('Sign-off'),
    k.table([3000, 2400, 2160, 1800], [
      k.row(['', 'Name', 'Signature', 'Date'].map((t, i) => k.cell(t, { bold: true, fill: 'EEF2F0', w: [3000, 2400, 2160, 1800][i] }))),
      ...pens.map(p => { const s = stage(m, p.key); return k.row([k.cell(`${p.label}: ${whoOf(m, p)}`, { bold: true, color: hex(p.colour), w: 3000 }), k.cell(p.key === 'red' ? (s.name || m.teacher || '') : s.name || '', { w: 2400 }), k.cell('\n', { w: 2160 }), k.cell(s.date ? fmtLong(s.date) : '', { w: 1800 })]); }),
    ]),
  ];
  for (const p of pens.filter(p => p.key !== 'red' && stage(m, p.key).comment)) kids.push(k.heading(`${p.label} moderator’s comments`), ...k.multi(stage(m, p.key).comment));
  await k.save(kids, `Moderation mark sheet - ${m.title || ''} - ${m.cls || ''}`);
}
async function sheetXlsx(m) {
  await loadScript('vendor/xlsx.full.min.js');
  const X = window.XLSX;
  const pens = pensOf(m);
  const aoa = [
    ...headLine(m).map(([k, v]) => [k, v]), [],
    ['#', 'Learner', ...pens.map(p => `${p.label} (${whoOf(m, p)})`), 'Final', 'Note'],
    ...rowsFor(m).map(r => { const f = finalOf(m, r); return [m.rows.indexOf(r) + 1, r.name, ...pens.map(p => r[p.key] === '' ? null : r[p.key]), f ? f.mark : null, r.note || '']; }),
    [], ['', 'Moderator', ...pens.map(p => { const s = stage(m, p.key); return p.key === 'red' ? (s.name || m.teacher || '') : s.name || ''; })],
    ['', 'Date', ...pens.map(p => stage(m, p.key).date || '')],
  ];
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 5 }, { wch: 30 }, ...pens.map(() => ({ wch: 16 })), { wch: 9 }, { wch: 30 }];
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Mark sheet');
  download(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeName(`Moderation mark sheet - ${m.title || ''} - ${m.cls || ''}`) + '.xlsx');
}
