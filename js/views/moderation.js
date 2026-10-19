// Moderation: upload a marksheet, auto-select a sample, check scripts and the teacher file, export a report.
import { state, onChange, saveModeration, deleteModeration, moderationById, saveSettings, subjectById, subjectLabel } from '../state.js';
import { h, icon, toast, modal, confirmBox, dropZone } from '../ui.js';
import { readMarksheet, toNumber } from '../importers.js';
import { selectSample, stats, variance, LEVELS, levelOf, DEFAULT_FILE_CHECKLIST, DEFAULT_SCRIPT_CHECKLIST } from '../moderation-core.js';
import { today, fmtLong } from '../dates.js';
import { exportModerationDocx, printModeration } from '../moderation-export.js';
import { noticesTab, noticeDetail } from './notices.js';
import { noticeById } from '../state.js';
import { sheetsTab, sheetDetail, isSheet } from './markform.js';

let tab = 'notices';

export function renderModeration(root, [id, sub]) {
  if (id === 'marks' || id === 'notices' || id === 'sheets') tab = id;
  const draw = () => root.replaceChildren(
    id === 'notice' && noticeById(sub) ? noticeDetail(noticeById(sub))
      : id && isSheet(moderationById(id)) ? sheetDetail(moderationById(id))
      : id && moderationById(id) ? detail(moderationById(id))
      : list());
  const off = onChange(w => { if (['moderations', 'settings', 'subjects', 'notices', 'materials'].includes(w)) draw(); });
  draw();
  return off;
}

const samples = () => state.moderations.filter(m => !isSheet(m));

// ---------- List ----------
function list() {
  const open = state.notices.filter(n => !n.submitted).length;
  const page = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Moderation'),
    h('p', { class: 'muted' }, 'Keep track of moderation notices and deadlines, moderate marks (a sample of scripts across the achievement levels, with a report), and fill in red, green, orange and purple moderation mark sheets.')));
  page.append(h('div', { class: 'tabs page-tabs', role: 'tablist' },
    h('a', { role: 'tab', href: '#moderation/notices', 'aria-selected': String(tab === 'notices') }, 'Notices and deadlines', open ? h('span', { class: 'count' }, open) : null),
    h('a', { role: 'tab', href: '#moderation/marks', 'aria-selected': String(tab === 'marks') }, 'Marksheet moderation', samples().length ? h('span', { class: 'count' }, samples().length) : null),
    h('a', { role: 'tab', href: '#moderation/sheets', 'aria-selected': String(tab === 'sheets') }, 'Moderation mark sheets', state.moderations.filter(isSheet).length ? h('span', { class: 'count' }, state.moderations.filter(isSheet).length) : null)));
  if (tab === 'notices') { page.append(noticesTab()); return page; }
  if (tab === 'sheets') return sheetsTab(page);
  return marksTab(page);
}

function marksTab(page) {
  const s = state.settings;
  const status = h('div', { 'aria-live': 'polite' });
  page.append(h('div', { class: 'mod-start' },
    dropZone({ accept: '.xlsx,.xls,.csv,.docx,.pdf', label: 'Upload a marksheet', hint: 'Excel, CSV, Word table or a text PDF (e.g. an SA-SAMS export).', onFiles: async ([file]) => {
      status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
      try { const sheet = await readMarksheet(file); status.replaceChildren(); setupDialog(sheet, file.name); }
      catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
    } }),
    status,
    h('details', { class: 'mod-rules' }, h('summary', {}, `Sample rules: ${s.modPercent}% of learners, at least ${s.modMin}, borderline ${s.modBorderline}%, tolerance ±${s.modTolerance}%`),
      h('div', { class: 'form-grid' },
        num('Sample size (% of class)', s.modPercent, v => saveSettings({ modPercent: v }), 1, 100),
        num('Minimum scripts', s.modMin, v => saveSettings({ modMin: v }), 1, 50),
        num('Pass/fail borderline (%)', s.modBorderline, v => saveSettings({ modBorderline: v }), 1, 99, 'Learners on either side of this mark are always included.'),
        num('Tolerance (± % of total)', s.modTolerance, v => saveSettings({ modTolerance: v }), 0, 50, 'Moderated marks further than this from the teacher’s mark are flagged.')),
      h('p', { class: 'muted small' }, 'Use the numbers your school or district policy sets. The highest and lowest marks are always in the sample.')),
  ));

  const mods = samples().sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  page.append(h('h2', {}, 'Your marksheet moderations'));
  if (!mods.length) page.append(h('p', { class: 'empty' }, 'None yet. Upload a marksheet to start one.'));
  else page.append(h('ul', { class: 'mod-list' }, mods.map(m => {
    const v = variance(m.learners, m.total, m.tolerance);
    const sampled = m.learners.filter(l => l.sampled).length;
    const subj = subjectById(m.subjectId);
    return h('li', {}, h('a', { href: '#moderation/' + m.id, style: { '--subj': subj?.colour || '#777' } },
      h('strong', {}, m.title || 'Untitled task'),
      h('span', { class: 'muted small' }, [subj ? subjectLabel(subj) : '', m.cls, `${sampled} scripts`, v.moderated ? `${v.moderated} moderated, ${v.outside} outside tolerance` : 'Not moderated yet'].filter(Boolean).join(' · ')),
      h('span', { class: 'status ' + (m.signedOff ? 'taught' : v.moderated ? 'planned' : '') }, m.signedOff ? 'Signed off' : v.moderated ? 'In progress' : 'To do')));
  })));
  return page;
}

function num(label, value, on, min, max, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'number', min, max, value, onchange: e => { const v = Math.max(min, Math.min(max, +e.target.value || min)); on(v); } }), hint ? h('span', { class: 'hint' }, hint) : null);
}

// ---------- Column picker ----------
function setupDialog(sheet, fileName) {
  const f = {
    nameCols: sheet.nameCols.slice(0, 2), markCol: sheet.markCols[0] ?? null,
    total: '', title: '', subjectId: state.subjects[0]?.id || '', cls: '', teacher: state.settings.teacherName || '', moderator: '', level: 'School',
  };
  const guessTotal = () => {
    if (f.markCol == null) return '';
    if (sheet.totals[f.markCol]) return sheet.totals[f.markCol];
    const vals = sheet.rows.map(r => r[f.markCol]);
    if (vals.some(v => /%/.test(v))) return 100;
    const max = Math.max(...vals.map(toNumber).filter(n => n != null));
    // Round up to a common task total.
    return [10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 100, 120, 150, 200, 300].find(t => t >= max) || Math.ceil(max);
  };
  f.total = guessTotal(); f.title = f.markCol != null ? sheet.headers[f.markCol] : '';
  const body = h('div', {});
  const m = modal('Set up the moderation', body, { wide: true });
  const draw = () => {
    const learners = buildLearners(sheet, f);
    const absent = learners.filter(l => l.mark == null).length;
    body.replaceChildren(
      h('p', { class: 'muted' }, `From ${fileName}: ${sheet.rows.length} rows, ${sheet.headers.length} columns.`),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Learner name column(s)'), h('div', { class: 'chips' }, sheet.headers.map((hd, i) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: f.nameCols.includes(i), onchange: e => { f.nameCols = e.target.checked ? [...f.nameCols, i].sort((a, b) => a - b) : f.nameCols.filter(x => x !== i); draw(); } }), hd)))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Marks column (the task to moderate)'), h('select', { onchange: e => { f.markCol = +e.target.value; f.total = guessTotal(); f.title = sheet.headers[f.markCol]; draw(); } },
          sheet.headers.map((hd, i) => h('option', { value: i, selected: i === f.markCol }, hd + (sheet.markCols.includes(i) ? '' : ' (not numbers)'))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Total marks for the task'), h('input', { type: 'number', min: 1, value: f.total, oninput: e => { f.total = +e.target.value; } }), h('span', { class: 'hint' }, 'Guessed from the marks. Check it.')),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Task name'), h('input', { value: f.title, placeholder: 'e.g. Term 3 Test', oninput: e => f.title = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('select', { onchange: e => f.subjectId = e.target.value }, h('option', { value: '' }, '—'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === f.subjectId }, subjectLabel(s))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Class'), h('input', { value: f.cls, placeholder: 'e.g. 10A', oninput: e => f.cls = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Teacher'), h('input', { value: f.teacher, oninput: e => f.teacher = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Moderator'), h('input', { value: f.moderator, placeholder: 'HOD / subject head', oninput: e => f.moderator = e.target.value })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Moderation level'), h('select', { onchange: e => f.level = e.target.value }, ['School', 'Cluster', 'District', 'Provincial'].map(x => h('option', { selected: x === f.level }, x)))),
      ),
      h('h3', {}, 'Preview'),
      h('p', { class: 'muted small' }, `${learners.length} learners${absent ? `, ${absent} without a mark (left out of the sample)` : ''}.`),
      h('div', { class: 'table-wrap short' }, h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', {}, 'Learner'), h('th', {}, 'Mark'))),
        h('tbody', {}, learners.slice(0, 8).map(l => h('tr', {}, h('td', {}, l.name), h('td', {}, l.mark ?? 'absent')))))),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (!f.nameCols.length || f.markCol == null) { toast('Choose the name and marks columns.', 'error'); return; }
          if (!(+f.total > 0)) { toast('Enter the total marks for the task.', 'error'); return; }
          const s = state.settings;
          const res = selectSample(learners, { total: +f.total, percent: s.modPercent, min: s.modMin, borderline: s.modBorderline, seed: Date.now() % 2147483647 });
          const mod = await saveModeration({
            title: f.title, subjectId: f.subjectId, cls: f.cls, teacher: f.teacher, moderator: f.moderator, level: f.level, date: today(), source: fileName,
            total: +f.total, tolerance: s.modTolerance, percent: s.modPercent, min: s.modMin, borderline: s.modBorderline, seed: res.seed,
            learners: res.learners.map(({ name, mark, pct, level, sampled, reason }) => ({ name, mark, pct, level, sampled, reason, modMark: null, note: '' })),
            scriptChecks: DEFAULT_SCRIPT_CHECKLIST.map(t => ({ text: t, answer: '', comment: '' })),
            fileChecks: DEFAULT_FILE_CHECKLIST.map(t => ({ text: t, answer: '', comment: '' })),
            findings: '', recommendations: '', signedOff: false,
          });
          m.close(); location.hash = 'moderation/' + mod.id; toast(`${res.learners.filter(l => l.sampled).length} scripts selected for moderation.`);
        } }, 'Select the sample')),
    );
  };
  draw();
}

function buildLearners(sheet, f) {
  return sheet.rows.map(r => {
    const name = f.nameCols.map(i => String(r[i] || '').trim()).filter(Boolean).join(' ');
    const raw = String(r[f.markCol] ?? '').trim();
    const absent = !raw || /^(ab|a|abs|absent|afw|-|–|x|n\/?a|inc)$/i.test(raw);
    return { name, mark: absent ? null : toNumber(raw) };
  }).filter(l => l.name && !/^\d+$/.test(l.name));
}

// ---------- Detail ----------
function detail(m) {
  const save = () => saveModeration(m);
  const quiet = () => saveModeration(m, { silent: true });
  const subj = subjectById(m.subjectId);
  const st = stats(m.learners, m.total);
  const v = variance(m.learners, m.total, m.tolerance);
  const sample = m.learners.filter(l => l.sampled);
  const page = h('div', { class: 'page mod-detail' });

  page.append(h('header', { class: 'page-head' },
    h('a', { href: '#moderation/marks', class: 'back' }, icon('left', 16), 'All marksheet moderations'),
    h('div', { class: 'row between wrap' },
      h('h1', {}, m.title || 'Moderation'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => exportModerationDocx(m).catch(e => toast(e.message, 'error')) }, icon('doc'), 'Report (.docx)'),
        h('button', { class: 'btn ghost', onclick: () => printModeration(m) }, icon('print'), 'Print / PDF'),
        h('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Delete this moderation?')) { await deleteModeration(m.id); location.hash = 'moderation/marks'; } } }, icon('trash', 16)))),
    h('p', { class: 'muted' }, [subj ? subjectLabel(subj) : '', m.cls, `${m.level} moderation`, `Total ${m.total}`, m.source].filter(Boolean).join(' · ')),
    ...state.notices.filter(n => n.moderationId === m.id).map(n => h('a', { class: 'linked-notice', href: '#moderation/notice/' + n.id }, icon('flag', 14), `For notice: ${n.title}${n.due ? ' · due ' + fmtLong(n.due) : ''}`)),
  ));

  // Stats + distribution
  const maxLevel = Math.max(1, ...(st.levels || [1]));
  page.append(h('section', { class: 'mod-stats' },
    h('dl', { class: 'stat-row' },
      stat('Learners marked', st.n), stat('Class average', st.n ? st.mean.toFixed(1) + '%' : '–'), stat('Highest / lowest', st.n ? `${st.max}% / ${st.min}%` : '–'),
      stat(`At or above ${m.borderline}%`, st.n ? Math.round(m.learners.filter(l => l.pct != null && l.pct >= m.borderline).length / st.n * 100) + '%' : '–'),
      stat('Scripts in sample', sample.length)),
    h('div', { class: 'levels', role: 'img', 'aria-label': 'Learners per achievement level, with sampled scripts marked' }, LEVELS.map((L, i) => {
      const n = st.levels?.[i] || 0; const s = sample.filter(x => x.level === L.level).length;
      return h('div', { class: 'lv' }, h('div', { class: 'lv-bar' }, h('span', { class: 'lv-all', style: { height: (n / maxLevel * 100) + '%' } }, h('span', { class: 'lv-s', style: { height: n ? (s / n * 100) + '%' : 0 } }))),
        h('strong', {}, `L${L.level}`), h('span', { class: 'small muted' }, `${n}${s ? ` (${s})` : ''}`));
    })),
    h('p', { class: 'small muted' }, 'Bars show learners per CAPS level; the dark part is the sample. Numbers in brackets are sampled scripts.'),
  ));

  // Sample table
  const outsideNote = v.moderated ? h('p', { class: v.outside ? 'warn' : 'ok' }, `${v.moderated} of ${sample.length} scripts moderated. ${v.outside ? `${v.outside} differ by more than ±${m.tolerance}% of the total.` : `All within ±${m.tolerance}%.`} Average difference ${v.avgPct >= 0 ? '+' : ''}${v.avgPct.toFixed(1)}%.`) : h('p', { class: 'muted' }, 'Enter the moderator’s mark for each script as you re-mark it.');
  page.append(h('section', {},
    h('div', { class: 'row between wrap' }, h('h2', {}, 'Scripts to moderate'),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onclick: async () => {
          if (v.moderated && !await confirmBox('Pick a new sample? Moderator marks already entered will be cleared.', 'New sample')) return;
          const res = selectSample(m.learners.map(l => ({ name: l.name, mark: l.mark })), { total: m.total, percent: m.percent, min: m.min, borderline: m.borderline, seed: Date.now() % 2147483647 });
          m.seed = res.seed; m.learners = res.learners.map(({ name, mark, pct, level, sampled, reason }) => ({ name, mark, pct, level, sampled, reason, modMark: null, note: '' }));
          save(); toast('New sample selected.');
        } }, 'Pick a new sample'))),
    outsideNote,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Learner'), h('th', {}, 'Teacher'), h('th', {}, '%'), h('th', {}, 'Level'), h('th', {}, 'Why selected'), h('th', {}, 'Moderator'), h('th', {}, 'Difference'), h('th', {}, 'Note'), h('th', {}, h('span', { class: 'sr' }, 'Remove')))),
      h('tbody', {}, sample.sort((a, b) => b.pct - a.pct).map(l => {
        const row = v.rows.find(r => r.name === l.name && r.mark === l.mark);
        return h('tr', { class: row && !row.within ? 'off-tol' : '' },
          h('td', {}, l.name), h('td', { class: 'num' }, `${l.mark}/${m.total}`), h('td', { class: 'num' }, l.pct + '%'), h('td', { class: 'num' }, l.level), h('td', { class: 'small' }, l.reason),
          h('td', {}, h('input', { type: 'number', class: 'num', min: 0, max: m.total, step: 0.5, value: l.modMark ?? '', 'aria-label': `Moderator mark for ${l.name}`, onchange: e => { l.modMark = e.target.value === '' ? null : +e.target.value; save(); } })),
          h('td', { class: 'num' }, row ? `${row.diff > 0 ? '+' : ''}${row.diff} (${row.diffPct > 0 ? '+' : ''}${row.diffPct.toFixed(1)}%)` : ''),
          h('td', {}, h('input', { value: l.note || '', placeholder: 'e.g. Q3 under-marked', 'aria-label': `Note for ${l.name}`, onchange: e => { l.note = e.target.value; quiet(); } })),
          h('td', {}, h('button', { class: 'icon-btn', 'aria-label': `Remove ${l.name} from sample`, onclick: () => { l.sampled = false; l.reason = ''; l.modMark = null; save(); } }, icon('x', 16))));
      })))),
    addLearner(m, save),
  ));

  // Checklists
  page.append(checklist('Assessment task and scripts', m.scriptChecks, save, quiet));
  page.append(checklist('Teacher file', m.fileChecks, save, quiet));

  page.append(h('section', {}, h('h2', {}, 'Findings and sign-off'),
    h('div', { class: 'form-grid' },
      field('Findings', h('textarea', { rows: 4, oninput: e => { m.findings = e.target.value; debSave(quiet); } }, m.findings || '')),
      field('Recommendations / follow-up', h('textarea', { rows: 4, oninput: e => { m.recommendations = e.target.value; debSave(quiet); } }, m.recommendations || '')),
      field('Teacher', h('input', { value: m.teacher || '', onchange: e => { m.teacher = e.target.value; quiet(); } })),
      field('Moderator', h('input', { value: m.moderator || '', onchange: e => { m.moderator = e.target.value; quiet(); } })),
      field('Date', h('input', { type: 'date', value: m.date || today(), onchange: e => { m.date = e.target.value; quiet(); } })),
      h('label', { class: 'check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: !!m.signedOff, onchange: e => { m.signedOff = e.target.checked; save(); } }), 'Moderation complete and signed off')),
  ));
  return page;
}

let debT; const debSave = fn => { clearTimeout(debT); debT = setTimeout(fn, 500); };
const stat = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input);

function addLearner(m, save) {
  const others = m.learners.filter(l => !l.sampled && l.mark != null);
  if (!others.length) return null;
  const sel = h('select', { 'aria-label': 'Add a learner to the sample' }, h('option', { value: '' }, 'Add a learner to the sample…'),
    others.sort((a, b) => b.pct - a.pct).map(l => h('option', { value: m.learners.indexOf(l) }, `${l.name} (${l.pct}%)`)));
  sel.onchange = () => { const l = m.learners[+sel.value]; if (l) { l.sampled = true; l.reason = 'Added by moderator'; save(); } };
  return h('div', { class: 'row' }, sel);
}

function checklist(title, items, save, quiet) {
  const done = items.filter(i => i.answer).length;
  const sec = h('section', { class: 'checklist' }, h('div', { class: 'row between' }, h('h2', {}, title), h('span', { class: 'muted small' }, `${done} of ${items.length} answered`)));
  const ol = h('ol', {}, items.map((it, i) => h('li', {},
    h('span', { class: 'ck-text' }, it.text),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': it.text }, ['Yes', 'No', 'N/A'].map(a => h('button', { role: 'radio', 'aria-checked': String(it.answer === a), class: 'ans-' + a.replace('/', '').toLowerCase(), onclick: () => { it.answer = it.answer === a ? '' : a; save(); } }, a))),
    h('input', { class: 'ck-comment', value: it.comment || '', placeholder: 'Comment', 'aria-label': 'Comment on: ' + it.text, onchange: e => { it.comment = e.target.value; quiet(); } }),
    h('button', { class: 'icon-btn', 'aria-label': 'Remove item', onclick: () => { items.splice(i, 1); save(); } }, icon('x', 14)),
  )));
  const add = h('input', { placeholder: 'Add a checklist item for your school…', 'aria-label': 'New checklist item', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { items.push({ text: e.target.value.trim(), answer: '', comment: '' }); save(); } } });
  sec.append(ol, add);
  return sec;
}
