// School formats: upload the school's Word planning form once, check what goes in each blank,
// then download your planning in that form whenever it has to be handed in.
import { state, saveSettings, subjectById, classLabel } from '../state.js';
import { h, icon, toast, modal, confirmBox, dropZone, download, busy, safeName, shareFile } from '../ui.js';
import { today, mondayOf, addDays, fmt } from '../dates.js';
import { FIELDS, GRID_FIELDS, fieldLabel, readFormatFile, fillFormat, previewHtml } from '../docxfill.js';
import { onChange } from '../state.js';
import { classesOf } from './progress.js';

export const formats = () => state.settings.formats || [];
const saveFormats = list => saveSettings({ formats: list });
const fill = (el, ...k) => el.replaceChildren(...k.flat().filter(Boolean));
const uid = () => 'f_' + Math.random().toString(36).slice(2, 10);
const KIND = { lesson: 'Lesson plan: one page per lesson', table: 'Weekly or term planner: several lessons in one document' };
const ext = f => f.type === 'xlsx' ? '.xlsx' : '.docx';
const app = f => f.type === 'xlsx' ? 'Excel' : 'Word';
// The weekly planner gets its own button on the planner.
export const weeklyFormat = () => { const l = formats(); return l.find(f => f.id === state.settings.weeklyFormat) || l.find(f => f.kind === 'table') || l[0]; };
export async function downloadWeekly(weekStart, btn) {
  const f = weeklyFormat(); if (!f) { openFormatDownload({ weekStart }); return; }
  const ls = lessonsIn(weekStart, addDays(weekStart, 6), '*');
  if (!ls.length) { toast('Nothing planned this week yet.', 'warn'); return; }
  const done = btn ? busy(btn, 'Filling in…') : () => {};
  try {
    const blob = await fillFormat(f, ls);
    download(blob, safeName(`${f.name} – ${fmt(weekStart)}–${fmt(addDays(weekStart, 4))}`) + ext(f));
    toast(blob.note || `Your weekly planner for ${fmt(weekStart)} is downloaded, filled in from the planner.`, blob.note ? 'warn' : 'ok', { action: { label: 'Other options', run: () => openFormatDownload({ weekStart, formatId: f.id }) } });
  } catch (e) { toast(e.message, 'error'); } finally { done(); }
}

export function formatsSection(onSaved) {
  const sec = h('section', { class: 'card-sec formats-sec' });
  const draw = () => {
    const list = formats();
    fill(sec, 
      h('h2', {}, 'School formats'),
      h('p', { class: 'muted small' }, 'Upload the Word or Excel form your school wants planning handed in on: a lesson plan form, a weekly planner (days and periods) or a term planning sheet. Keep planning in Klasboek as usual; when it’s due, download it already filled in on the school’s form.'),
      list.length ? h('ul', { class: 'format-list' }, ...list.map(f => h('li', {},
        h('span', { class: 'fl-ic' }, icon('doc', 20)),
        h('div', { class: 'fl-main' }, h('strong', {}, f.name), h('span', { class: 'muted small' }, `${app(f)} · ${KIND[f.kind] || ''} · ${filled(f)} places filled in${weeklyFormat()?.id === f.id ? ' · Weekly planner button on the planner' : ''}`)),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn sm', onclick: () => openFormatDownload({ formatId: f.id }) }, icon('download', 16), 'Download planning'),
          h('button', { class: 'btn ghost sm', onclick: () => openFormatSetup(f, false, draw) }, 'Check the blanks'),
          h('button', { class: 'link small danger', onclick: async () => { if (!await confirmBox(`Delete the school format “${f.name}”? Your planning isn’t affected.`)) return; await saveFormats(formats().filter(x => x.id !== f.id)); draw(); } }, 'Delete'))))) : null,
      dropZone({ accept: '.docx,.xlsx,.xlsm,.doc,.xls,.pdf', label: list.length ? 'Add another school format' : 'Upload your school’s planning form', hint: 'Word (.docx) or Excel (.xlsx). Klasboek finds the blanks next to labels like Topic, Date, Objectives, and week grids of days and periods.', onFiles: async ([file]) => {
        try {
          const r = await readFormatFile(file);
          const f = { id: uid(), name: file.name.replace(/\.(docx|xlsx|xlsm)$/i, ''), added: new Date().toISOString(), ...r };
          openFormatSetup(f, true, () => { draw(); onSaved?.(); });
        } catch (e) { toast(e.message, 'error'); }
      } }));
  };
  draw();
  return sec;
}
const filled = f => f.slots.filter(s => s.field && s.field !== 'blank').length + (f.tables || []).reduce((a, t) => a + (t.kind === 'grid' ? (t.orient === 'cols' ? t.rows : t.cols).filter(x => !x.brk).length * 5 : (t.cols || []).filter(c => c.field).length), 0);

// ---------- Check what goes where ----------
export function openFormatSetup(orig, isNew, onDone = () => {}) {
  const f = structuredClone(orig);
  const fieldSel = (val, onchange) => h('select', { onchange: e => onchange(e.target.value) }, ...FIELDS.map(x => h('option', { value: x.id, selected: (val || '') === x.id }, x.label)));
  const body = h('div', { class: 'format-setup' });
  const draw = () => {
    const nothing = !f.slots.length && !(f.tables || []).length;
    fill(body, 
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Name'), h('input', { value: f.name, oninput: e => { f.name = e.target.value; } })),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'This form is for'),
        h('div', { class: 'seg', role: 'radiogroup' }, ...Object.entries(KIND).map(([k, label]) => h('button', { role: 'radio', 'aria-checked': String(f.kind === k), onclick: () => { f.kind = k; draw(); } }, label))),
        h('span', { class: 'hint' }, f.kind === 'table' ? 'All the lessons you choose go into one document: a box per period, a row per lesson, or a row per day.' : f.type === 'xlsx' ? 'Each lesson gets its own sheet in one Excel file.' : 'Each lesson gets its own copy of the form, one after the other in one Word file.')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: (state.settings.weeklyFormat || weeklyFormat()?.id) === f.id || (!weeklyFormat() && true), onchange: e => { f._weekly = e.target.checked; } }), 'This is my weekly planner: show it on the planner, filled in from the week on screen'),
      nothing ? h('div', { class: 'callout warn' },
        h('p', {}, h('strong', {}, 'Klasboek couldn’t find any blanks in this form.'), ' It looks for a label (like “Topic” or “Date:”) with an empty box or line next to or under it.'),
        h('p', { class: 'small' }, 'You can also type tags into the Word form where things should go, then upload it again: ', h('code', {}, '{{topic}}'), ' ', h('code', {}, '{{date}}'), ' ', h('code', {}, '{{objectives}}'), ' and so on. The tag names are: ', FIELDS.filter(x => x.id && x.id !== 'blank').map(x => x.id).join(', '), '.')) : null,
      f.slots.length ? h('h3', {}, 'Blanks in the form') : null,
      f.slots.length ? h('p', { class: 'muted small' }, 'Klasboek guessed what goes in each one. Change any that are wrong; “Leave blank” keeps it empty (for signatures, for example).') : null,
      f.slots.length ? h('div', { class: 'slot-list' }, ...f.slots.map(s => h('div', { class: 'slot-row' + (s.field ? '' : ' unset') },
        h('span', { class: 'slot-label' }, '“' + s.label + '”'), icon('right', 16), fieldSel(s.field, v => { s.field = v; draw(); })))) : null,
      ...(f.tables || []).map((t, i) => t.kind === 'grid' ? h('div', { class: 'slot-table' },
        h('h3', {}, (f.tables.length > 1 ? `Table ${i + 1}: ` : '') + 'Week grid: ' + (t.orient === 'cols' ? 'days across the top, periods down the side' : 'days down the side, periods across the top')),
        h('p', { class: 'muted small' }, `Each lesson goes into the box for its day and period. Found ${(t.orient === 'cols' ? t.rows : t.cols).filter(x => !x.brk).length} periods` + ((t.orient === 'cols' ? t.rows : t.cols).some(x => x.brk) ? ' and skipped the breaks.' : '.')),
        h('p', { class: 'lbl' }, 'What goes in each box'),
        h('div', { class: 'row wrap' }, ...GRID_FIELDS.map(id => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: (t.cellFields || []).includes(id), onchange: e => { const set = new Set(t.cellFields || []); e.target.checked ? set.add(id) : set.delete(id); t.cellFields = GRID_FIELDS.filter(x => set.has(x)); } }), fieldLabel(id))))) : h('div', { class: 'slot-table' },
        h('h3', {}, (f.tables.length > 1 ? `Table ${i + 1}: ` : '') + (t.dayRows ? 'Planning table: one row per day' : 'Planning table: one row per lesson')),
        h('p', { class: 'muted small' }, t.dayRows ? 'Each day’s lessons go into that day’s row.' : `It has ${t.body.length} empty row${t.body.length === 1 ? '' : 's'}; more are added when there are more lessons.`),
        h('div', { class: 'slot-list' }, ...t.cols.filter(c => c.label).map(c => h('div', { class: 'slot-row' + (c.field ? '' : ' unset') },
          h('span', { class: 'slot-label' }, 'Column “' + c.label + '”'), icon('right', 16), fieldSel(c.field, v => { c.field = v; draw(); })))))),
      h('div', { class: 'row end wrap modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn ghost', onclick: e => tryIt(f, e.currentTarget) }, icon('download', 16), 'Try it with this week'),
        h('button', { class: 'btn', onclick: async () => {
          f.name = (f.name || '').trim() || 'School format';
          const weekly = f._weekly; delete f._weekly;
          const list = formats().filter(x => x.id !== f.id); list.push(f);
          await saveFormats(list);
          if (weekly === true) await saveSettings({ weeklyFormat: f.id });
          else if (weekly === false && state.settings.weeklyFormat === f.id) await saveSettings({ weeklyFormat: '' }); m.close(); onDone();
          toast(isNew ? `“${f.name}” saved. Download your planning in it from here, the planner (More) or any lesson.` : 'Saved.');
        } }, 'Save')));
  };
  const m = modal(isNew ? 'Set up the school format' : 'Check the blanks', body, { wide: true });
  draw();
}
async function tryIt(f, btn) {
  const mon = mondayOf(today());
  const ls = lessonsIn(mon, addDays(mon, 6), '*').slice(0, f.kind === 'table' ? 40 : 2);
  if (!ls.length) { toast('No lessons planned this week to try it with. Plan a few first, or save and try later.', 'warn'); return; }
  const done = busy(btn, 'Filling in…');
  try { download(await fillFormat(f, ls), `${safeName(f.name)} (try)${ext(f)}`); toast(f.kind === 'table' ? 'Downloaded with this week’s lessons. Open it to check.' : 'Downloaded with two of this week’s lessons. Open it to check.'); }
  catch (e) { toast(e.message, 'error'); } finally { done(); }
}

// ---------- Download planning in a format ----------
function lessonsIn(from, to, key) {
  return state.lessons.filter(l => l.date && l.date >= from && l.date <= to && l.subjectId && (key === '*' || (() => {
    const [sid, cls] = key.split('|'); const s = subjectById(sid);
    return l.subjectId === sid && (classesOf(s).length <= 1 || (l.cls || '') === cls);
  })())).sort((a, b) => a.date.localeCompare(b.date) || (a.periodId || '').localeCompare(b.periodId || ''));
}
export function openFormatDownload({ formatId, lesson, weekStart } = {}) {
  const list = formats();
  if (!list.length) {
    const m = modal('School formats', h('div', {}, h('p', {}, 'Upload your school’s planning form first. Klasboek fills it in from your planning whenever you need it.'), formatsSection()), { wide: true });
    return m;
  }
  const mon = weekStart || mondayOf(lesson?.date || today());
  const opts = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, key: s.id + '|' + cls })));
  const pick = {
    formatId: formatId || state.settings.lastFormat || list[0].id,
    key: lesson ? (opts.find(o => o.s.id === lesson.subjectId && (o.cls === (lesson.cls || '') || classesOf(o.s).length <= 1))?.key || '*') : '*',
    from: lesson?.date || mon, to: lesson?.date || addDays(mon, 4), only: lesson ? 'one' : 'range',
  };
  if (!list.some(x => x.id === pick.formatId)) pick.formatId = list[0].id;
  const body = h('div', { class: 'format-dl' });
  const draw = () => {
    const f = list.find(x => x.id === pick.formatId);
    const ls = pick.only === 'one' && lesson ? [lesson] : lessonsIn(pick.from, pick.to, pick.key);
    const unprepared = ls.filter(l => !l.content).length;
    fill(body, 
      list.length > 1 ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Format'), h('select', { onchange: e => { pick.formatId = e.target.value; draw(); } }, ...list.map(x => h('option', { value: x.id, selected: x.id === pick.formatId }, x.name)))) : h('p', {}, h('strong', {}, f.name), h('span', { class: 'muted small' }, ' · ' + (KIND[f.kind] || ''))),
      lesson ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Which lessons' },
        h('button', { role: 'radio', 'aria-checked': String(pick.only === 'one'), onclick: () => { pick.only = 'one'; draw(); } }, 'Just this lesson'),
        h('button', { role: 'radio', 'aria-checked': String(pick.only === 'range'), onclick: () => { pick.only = 'range'; draw(); } }, 'This class, this week')) : null,
      pick.only === 'range' ? h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Class'), h('select', { onchange: e => { pick.key = e.target.value; draw(); } },
          h('option', { value: '*', selected: pick.key === '*' }, 'All my classes'), ...opts.map(o => h('option', { value: o.key, selected: o.key === pick.key }, classLabel(o.s, o.cls))))),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'From'), h('input', { type: 'date', value: pick.from, onchange: e => { pick.from = e.target.value; draw(); } })),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'To'), h('input', { type: 'date', value: pick.to, onchange: e => { pick.to = e.target.value; draw(); } }))) : null,
      h('p', { class: 'small' }, ls.length ? `${ls.length} lesson${ls.length === 1 ? '' : 's'}${f.kind === 'lesson' && ls.length > 1 ? `, one page each` : ''}.` : 'No lessons planned in these dates.',
        unprepared ? h('span', { class: 'warn' }, ` ${unprepared} ${unprepared === 1 ? 'isn’t' : 'aren’t'} prepared yet, so only the topic, date and class go in for ${unprepared === 1 ? 'it' : 'them'} (objectives, activities and so on stay empty).`) : null),
      h('div', { class: 'row end wrap modal-actions' },
        h('button', { class: 'link small', onclick: () => { m.close(); openFormatSetup(f, false, () => {}); } }, 'Check the blanks'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost', disabled: !ls.length, onclick: async e => { const b = await build(e.currentTarget, f, ls); if (b) shareFile(b, f.name); } }, icon('paper', 16), 'Share'),
        h('button', { class: 'btn', disabled: !ls.length, onclick: async e => { const b = await build(e.currentTarget, f, ls); if (b) { download(b.blob, b.name); toast(b.blob.note || `Downloaded. Open it in ${app(f)} to check before you send it.`, b.blob.note ? 'warn' : 'ok'); } } }, icon('download', 16), `Download (${app(f)})`)));
  };
  const build = async (btn, f, ls) => {
    const done = busy(btn, 'Filling in…');
    try {
      await saveSettings({ lastFormat: f.id });
      const who = pick.only === 'one' && lesson ? `${classLabel(subjectById(lesson.subjectId), lesson.cls)} ${lesson.date}` : `${pick.key === '*' ? 'All classes' : classLabel(subjectById(pick.key.split('|')[0]), pick.key.split('|')[1])} ${fmt(pick.from)}–${fmt(pick.to)}`;
      return { blob: await fillFormat(f, ls), name: safeName(`${f.name} – ${who}`) + ext(f) };
    } catch (e) { toast(e.message, 'error'); return null; } finally { done(); }
  };
  const m = modal('Download in the school format', body);
  draw();
  return m;
}

// ---------- The weekly planner, filled in live from the planner ----------
export function openWeeklyPlanner(weekStart) {
  if (!formats().length) {
    const m = modal('Weekly planner', h('div', {}, h('p', {}, 'Upload your school’s weekly planner (Word or Excel) and it fills itself in from the planner as you plan. You see it here and download it whenever it has to be handed in.'), formatsSection(() => { m.close(); openWeeklyPlanner(weekStart); })), { wide: true });
    return m;
  }
  let mon = weekStart, key = '*', fid = weeklyFormat().id, seq = 0;
  const opts = state.subjects.flatMap(s => classesOf(s).map(cls => ({ s, cls, key: s.id + '|' + cls })));
  const pv = h('div', { class: 'school-pv', 'aria-live': 'polite' });
  const bar = h('div', { class: 'row wrap school-pv-bar' });
  const info = h('p', { class: 'muted small' });
  let blob = null;
  const draw = async () => {
    const f = formats().find(x => x.id === fid) || weeklyFormat(); fid = f.id;
    const ls = lessonsIn(mon, addDays(mon, 6), key);
    bar.replaceChildren(
      h('button', { class: 'icon-btn', 'aria-label': 'Previous week', onclick: () => { mon = addDays(mon, -7); draw(); } }, icon('left')),
      h('strong', {}, `${fmt(mon)} – ${fmt(addDays(mon, 4), { day: 'numeric', month: 'short', year: 'numeric' })}`),
      h('button', { class: 'icon-btn', 'aria-label': 'Next week', onclick: () => { mon = addDays(mon, 7); draw(); } }, icon('right')),
      formats().length > 1 ? h('select', { class: 'sm', 'aria-label': 'Form', onchange: async e => { fid = e.target.value; await saveSettings({ weeklyFormat: fid }); draw(); } }, ...formats().map(x => h('option', { value: x.id, selected: x.id === fid }, x.name))) : h('span', { class: 'muted small' }, f.name),
      h('select', { class: 'sm', 'aria-label': 'Class', onchange: e => { key = e.target.value; draw(); } }, h('option', { value: '*', selected: key === '*' }, 'All my classes'), ...opts.map(o => h('option', { value: o.key, selected: o.key === key }, classLabel(o.s, o.cls)))),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', onclick: () => openFormatSetup(f, false, draw) }, 'Check the blanks'),
      h('button', { class: 'btn ghost sm', disabled: !ls.length, onclick: () => blob && shareFile({ blob, name: fileName(f) }, f.name) }, icon('paper', 16), 'Share'),
      h('button', { class: 'btn sm', disabled: !ls.length, onclick: () => { if (blob) { download(blob, fileName(f)); toast(blob.note || `Downloaded. Open it in ${app(f)} to check before you send it.`, blob.note ? 'warn' : 'ok'); } } }, icon('download', 16), `Download (${app(f)})`));
    const unprepared = ls.filter(l => !l.content).length;
    info.textContent = ls.length ? `Filled in from ${ls.length} lesson${ls.length === 1 ? '' : 's'} on the planner. It updates as you plan.` + (f.kind === 'lesson' ? ' (This form is set up as a single lesson plan, so each lesson gets its own page.)' : '') + (unprepared && f.kind === 'lesson' ? ` ${unprepared} not prepared yet.` : '') : 'Nothing planned this week yet. As you plan lessons, they appear in the form here.';
    const my = ++seq;
    try {
      blob = await fillFormat(f, ls, { weekStart: mon });
      const html = await previewHtml(blob);
      if (my !== seq) return;
      pv.innerHTML = html;
    } catch (e) { pv.textContent = e.message; }
  };
  const fileName = f => safeName(`${f.name} – ${key === '*' ? '' : classLabel(subjectById(key.split('|')[0]), key.split('|')[1]) + ' '}${fmt(mon)}–${fmt(addDays(mon, 4))}`) + ext(f);
  const off = onChange(w => { if (['lessons', 'atp', 'subjects', 'timetable', 'settings'].includes(w)) draw(); });
  const m = modal('Weekly planner', h('div', { class: 'school-pv-wrap' }, bar, info, pv), { wide: true, onClose: off });
  draw();
  return m;
}
