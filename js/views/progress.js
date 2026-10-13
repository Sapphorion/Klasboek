// Term progress: for each class, which ATP topics this term are taught, planned, not planned yet or behind,
// plus printing the whole term's lesson plans (and worksheets or notes) in one go.
import { state, onChange, subjectById, classLabel } from '../state.js';
import { h, icon, modal, toast } from '../ui.js';
import { today, fmt, termWeekOf } from '../dates.js';
import { openPrint, lessonDocHtml } from '../exporters.js';
import { openLesson } from './lesson.js';

export function classesOf(s) {
  const tt = state.timetable;
  const set = new Set();
  for (const cells of [tt.cells || {}, (tt.cycle || 1) === 2 ? tt.cellsB || {} : {}]) for (const c of Object.values(cells)) if (c?.subjectId === s.id) set.add(c.cls || '');
  if (!set.size) state.lessons.filter(l => l.subjectId === s.id).forEach(l => set.add(l.cls || ''));
  const list = [...set];
  if (list.length > 1) return list.filter(Boolean).sort();
  return list.length ? list : [''];
}
const forClass = (l, s, cls) => l.subjectId === s.id && (classesOf(s).length <= 1 || (l.cls || '') === cls);

export function topicsFor(s, cls, term) {
  return state.atp.filter(a => a.subjectId === s.id && +a.term === +term).sort((a, b) => (a.week || 0) - (b.week || 0) || (a.order || 0) - (b.order || 0)).map(a => {
    const lessons = state.lessons.filter(l => l.atpId === a.id && l.date && forClass(l, s, cls)).sort((x, y) => x.date.localeCompare(y.date));
    const taught = lessons.filter(l => l.done);
    const status = a.done ? 'done' : lessons.length && taught.length === lessons.length ? 'taught' : taught.length ? 'started' : lessons.length ? 'planned' : 'none';
    return { a, lessons, taught, status };
  });
}
export function progressFor(s, cls, term, week) {
  const rows = topicsFor(s, cls, term);
  const covered = rows.filter(r => r.status === 'done' || r.status === 'taught').length;
  const due = rows.filter(r => (r.a.weekEnd || r.a.week || 99) < week);
  return { total: rows.length, covered, dueByNow: due.length, behind: due.filter(r => r.status !== 'done' && r.status !== 'taught').length };
}

const STATUS = { done: ['Done already', 'ok'], taught: ['Taught', 'ok'], started: ['Busy', 'info'], planned: ['Planned', 'info'], none: ['Not planned', ''] };

let rootEl = null, term = 0;
export function renderProgress(root, [t] = []) {
  rootEl = root;
  term = +t || termWeekOf(today())?.term || term || 1;
  const off = onChange(w => { if (['lessons', 'atp', 'subjects', 'timetable', 'settings'].includes(w)) draw(); });
  draw();
  return () => { off(); rootEl = null; };
}
function draw() { if (rootEl) rootEl.replaceChildren(view()); }

function view() {
  const tw = termWeekOf(today());
  const curWeek = tw?.term === term ? tw.week : tw && tw.term > term ? 99 : 0;
  const page = h('div', { class: 'page progress-page' });
  page.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, `Term ${term} progress`), h('p', { class: 'muted' }, 'Which ATP topics each class has covered, and what still needs planning.')),
    h('div', { class: 'row wrap' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Term' }, ...[1, 2, 3, 4].map(n => h('button', { 'aria-pressed': String(n === term), onclick: () => { location.hash = 'progress/' + n; } }, `Term ${n}`))),
      h('button', { class: 'btn ghost', onclick: printReport }, icon('print', 16), 'Print report'),
      h('button', { class: 'btn', onclick: openPrintTerm }, icon('print', 16), 'Print term’s lessons'))));

  const subs = state.subjects;
  if (!subs.length) { page.append(h('p', { class: 'muted' }, 'Add subjects and their ATPs first.')); return page; }
  for (const s of subs) for (const cls of classesOf(s)) {
    const rows = topicsFor(s, cls, term);
    const p = progressFor(s, cls, term, curWeek);
    const sec = h('section', { class: 'card-sec prog-sec', style: { '--subj': s.colour } },
      h('div', { class: 'row between wrap' }, h('h2', {}, classLabel(s, cls)),
        rows.length ? h('span', { class: 'muted small' }, `${p.covered} of ${p.total} topics covered` + (p.behind ? ` · ${p.behind} behind` : '')) : null));
    if (!rows.length) { sec.append(h('p', { class: 'muted small' }, `No ATP topics for Term ${term}. `, h('a', { href: '#subjects' }, 'Upload the ATP'))); page.append(sec); continue; }
    sec.append(h('div', { class: 'bar big' }, h('span', { style: { width: Math.round(100 * p.covered / p.total) + '%' } })));
    sec.append(h('div', { class: 'table-wrap' }, h('table', { class: 'prog-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Week'), h('th', {}, 'Topic'), h('th', {}, 'Lessons'), h('th', {}, 'Status'))),
      h('tbody', {}, ...rows.map(r => {
        const behind = curWeek && (r.a.weekEnd || r.a.week || 99) < curWeek && !['done', 'taught'].includes(r.status);
        const [lab, cls2] = behind ? [r.status === 'none' ? 'Behind: not planned' : 'Behind', 'warn'] : STATUS[r.status];
        return h('tr', { class: behind ? 'behind' : '' },
          h('td', {}, r.a.weekEnd && r.a.weekEnd !== r.a.week ? `${r.a.week}–${r.a.weekEnd}` : r.a.week || ''),
          h('td', {}, r.a.topic),
          h('td', { class: 'small' }, r.lessons.length ? h('span', { class: 'row wrap tight' }, ...r.lessons.slice(0, 6).map(l => h('button', { class: 'chip sm' + (l.done ? ' on' : ''), title: l.title || '', onclick: () => openLesson(l.id) }, fmt(l.date))), r.lessons.length > 6 ? `+${r.lessons.length - 6}` : null) : h('span', { class: 'muted' }, '–')),
          h('td', {}, h('span', { class: 'tag ' + cls2 }, lab)));
      })))));
    page.append(sec);
  }
  return page;
}

const esc = t => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function printReport() {
  const tw = termWeekOf(today());
  const curWeek = tw?.term === term ? tw.week : tw && tw.term > term ? 99 : 0;
  let body = `<h1>Term ${term} ATP coverage</h1><p class="sub">${esc(state.settings.teacherName || '')} · ${fmt(today(), { day: 'numeric', month: 'long', year: 'numeric' })}</p>`;
  for (const s of state.subjects) for (const cls of classesOf(s)) {
    const rows = topicsFor(s, cls, term); if (!rows.length) continue;
    const p = progressFor(s, cls, term, curWeek);
    body += `<h2>${esc(classLabel(s, cls))}: ${p.covered}/${p.total} covered</h2><table><tr class="hd"><th>Week</th><th>Topic</th><th>Dates taught or planned</th><th>Status</th></tr>${rows.map(r => {
      const behind = curWeek && (r.a.weekEnd || r.a.week || 99) < curWeek && !['done', 'taught'].includes(r.status);
      return `<tr><td>${r.a.week || ''}</td><td>${esc(r.a.topic)}</td><td>${r.lessons.map(l => fmt(l.date) + (l.done ? ' ✓' : '')).join(', ')}</td><td>${behind ? '<b>Behind</b>' : STATUS[r.status][0]}</td></tr>`;
    }).join('')}</table>`;
  }
  openPrint(body, `Term ${term} ATP coverage`);
}

function openPrintTerm() {
  const t = state.settings.terms?.[term - 1];
  if (!t?.start) { toast('Set the term dates in Settings first.', 'warn'); return; }
  const opts = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, key: s.id + '|' + cls })));
  const pick = { key: opts[0]?.key || '', plan: true, worksheet: false, notes: false, from: t.start, to: t.end };
  const count = () => lessonsFor(pick).length;
  const info = h('p', { class: 'muted small' });
  const upd = () => { const all = lessonsFor({ ...pick, any: true }).length, n = count(); info.textContent = `${n} prepared lesson${n === 1 ? '' : 's'} to print` + (all > n ? ` (${all - n} not prepared yet are listed at the end).` : '.'); };
  const body = h('div', {},
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Class'), h('select', { onchange: e => { pick.key = e.target.value; upd(); } },
      h('option', { value: '*' }, 'All my classes'), ...opts.map(o => h('option', { value: o.key, selected: o.key === pick.key }, classLabel(o.s, o.cls))))),
    h('div', { class: 'row wrap' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'From'), h('input', { type: 'date', value: pick.from, onchange: e => { pick.from = e.target.value; upd(); } })),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'To'), h('input', { type: 'date', value: pick.to, onchange: e => { pick.to = e.target.value; upd(); } }))),
    h('p', { class: 'lbl' }, 'Include'),
    ...[['plan', 'Lesson plans'], ['worksheet', 'Worksheets with memos'], ['notes', 'Learner notes']].map(([k, l]) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pick[k], onchange: e => { pick[k] = e.target.checked; } }), l)),
    info,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn', onclick: () => { if (!pick.plan && !pick.worksheet && !pick.notes) { toast('Tick at least one thing to include.', 'warn'); return; } m.close(); printTerm(pick); } }, icon('print', 16), 'Print or save as PDF')));
  const m = modal(`Print Term ${term} lessons`, body);
  upd();
}
function lessonsFor(pick) {
  return state.lessons.filter(l => l.date && l.date >= pick.from && l.date <= pick.to && (pick.any || l.content) && (pick.key === '*' || (() => {
    const [sid, cls] = pick.key.split('|'); const s = subjectById(sid); return s && forClass(l, s, cls);
  })())).sort((a, b) => a.date.localeCompare(b.date) || a.periodId.localeCompare(b.periodId));
}
function printTerm(pick) {
  const ready = lessonsFor(pick);
  const missing = lessonsFor({ ...pick, any: true }).filter(l => !l.content);
  const parts = [];
  for (const l of ready) {
    if (pick.plan) parts.push(lessonDocHtml(l, 'plan'));
    if (pick.notes && l.content.notes) parts.push(lessonDocHtml(l, 'notes'));
    if (pick.worksheet && l.content.worksheet?.questions?.length) parts.push(lessonDocHtml(l, 'worksheet+memo'));
  }
  const title = pick.key === '*' ? `Term ${term} lessons` : `${classLabel(subjectById(pick.key.split('|')[0]), pick.key.split('|')[1])}: Term ${term}`;
  const contents = `<h1>${esc(title)}</h1><p class="sub">${fmt(pick.from)} to ${fmt(pick.to)} · ${ready.length} lessons</p><table><tr class="hd"><th>Date</th><th>Class</th><th>Lesson</th></tr>${ready.map(l => `<tr><td>${fmt(l.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${esc(classLabel(subjectById(l.subjectId), l.cls))}</td><td>${esc(l.content.title || l.title)}</td></tr>`).join('')}</table>` +
    (missing.length ? `<h2>Not prepared yet</h2><ul>${missing.map(l => `<li>${fmt(l.date)}: ${esc(classLabel(subjectById(l.subjectId), l.cls))}, ${esc(l.title || '')}</li>`).join('')}</ul>` : '');
  const body = [contents, ...parts].map((p, i) => `<section${i ? ' style="page-break-before:always"' : ''}>${p}</section>`).join('');
  openPrint(body, title);
}
