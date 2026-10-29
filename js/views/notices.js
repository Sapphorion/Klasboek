// Moderation notices: what's due, by when, what to hand in, with reminders on the planner
// and an option to put the deadline (with alarms) into the tablet's own calendar.
import { state, saveNotice, deleteNotice, noticeById, subjectById, subjectLabel, addMaterial, moderationById } from '../state.js';
import { h, icon, toast, confirmBox, dropZone, busy, download, safeName } from '../ui.js';
import { readNoticeFile, matchSubject, kindOf } from '../importers.js';
import { aiReadNotice, aiReady, aiUnavailableReason } from '../ai.js';
import { today, fmt, fmtLong, parse } from '../dates.js';
import { shrinkImage } from './timetable.js';

const REMIND_CHOICES = [14, 7, 3, 1];
const COMMON_ITEMS = [
  'Teacher file', 'Learner scripts (moderation sample)', 'Signed mark sheet', 'Assessment task',
  'Memorandum / marking guideline', 'Cognitive level analysis grid', 'Pre-moderation report', 'Completed moderation tool',
];

export const daysUntil = date => Math.round((parse(date) - parse(today())) / 864e5);
export function dueText(n) {
  if (!n.due) return 'No due date';
  const d = daysUntil(n.due);
  if (n.submitted) return `Submitted${n.submittedOn ? ' ' + fmt(n.submittedOn) : ''}`;
  if (d < 0) return `Overdue by ${-d} day${d < -1 ? 's' : ''} (${fmt(n.due)})`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${fmt(n.due, { weekday: 'short', day: 'numeric', month: 'short' })} · in ${d} days`;
}
const progress = n => { const it = n.items || []; return { done: it.filter(i => i.done).length, total: it.length }; };

// ---------- List ----------
export function noticesTab() {
  const wrap = h('div', { class: 'notices' });
  const status = h('div', { 'aria-live': 'polite' });
  wrap.append(h('div', { class: 'mod-start' },
    h('div', { class: 'notice-add' },
      dropZone({ accept: '.pdf,.docx,.xlsx,.txt,image/*', label: 'Upload a moderation notice', hint: 'PDF, Word, or a photo of the circular. The due date and what to submit are filled in for you.', onFiles: ([f]) => importNotice(f, status) }),
      h('button', { class: 'btn', onclick: async () => { const n = await saveNotice(blankNotice()); location.hash = 'moderation/notice/' + n.id; } }, icon('plus'), 'Add a notice by hand')),
    status));

  const open = state.notices.filter(n => !n.submitted).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = state.notices.filter(n => n.submitted).sort((a, b) => (b.due || '').localeCompare(a.due || ''));
  wrap.append(h('h2', {}, 'To do'));
  if (!open.length) wrap.append(h('p', { class: 'empty' }, 'No open moderation notices. Upload one when your HOD or district sends it.'));
  else wrap.append(h('ul', { class: 'notice-list' }, open.map(noticeCard)));
  if (done.length) wrap.append(h('details', { class: 'sources' }, h('summary', {}, `Submitted (${done.length})`), h('ul', { class: 'notice-list' }, done.map(noticeCard))));
  return wrap;
}

function noticeCard(n) {
  const { done, total } = progress(n);
  const d = n.due ? daysUntil(n.due) : null;
  const urgency = n.submitted ? 'done' : d == null ? '' : d < 0 ? 'overdue' : d <= 3 ? 'soon' : d <= 7 ? 'near' : '';
  const s = subjectById(n.subjectId);
  return h('li', {}, h('a', { class: 'notice-card ' + urgency, href: '#moderation/notice/' + n.id },
    h('div', { class: 'nc-main' },
      h('strong', {}, n.title || 'Untitled notice'),
      h('span', { class: 'muted small' }, [n.level && n.level + ' moderation', s ? subjectLabel(s) : (n.grade ? 'Grade ' + n.grade : '')].filter(Boolean).join(' · ')),
      total ? h('div', { class: 'nc-progress', role: 'img', 'aria-label': `${done} of ${total} ready` }, h('span', { style: { width: (done / total * 100) + '%' } })) : null),
    h('div', { class: 'nc-side' }, h('span', { class: 'nc-due' }, dueText(n)), total ? h('span', { class: 'muted small' }, `${done} of ${total} ready`) : null)));
}

function blankNotice(extra = {}) {
  return { title: 'Moderation notice', level: 'School', subjectId: '', grade: '', due: '', remind: [7, 1], items: [], notes: '', fileId: '', moderationId: '', submitted: false, ...extra };
}

const toBase64 = file => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });

async function importNotice(file, status) {
  const year = state.settings.year || new Date().getFullYear();
  status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
  try {
    let r, ai = false;
    try { r = await readNoticeFile(file, year); }
    catch (err) {
      if (!err.needsAi) throw err;
      if (!aiReady()) {
        r = { title: file.name.replace(/\.[^.]+$/, ''), due: '', items: [], level: '', grade: '' };
        toast(`${err.message} ${aiUnavailableReason()} Fill in the details yourself.`, 'warn');
      } else {
        status.replaceChildren(h('span', { class: 'spinner' }), ' Claude is reading the notice…');
        const image = kindOf(file) === 'image' ? await shrinkImage(file, 2000) : null;
        r = await aiReadNotice(image ? { image } : { pdf: await toBase64(file) }, year); ai = true;
      }
    }
    const pool = state.subjects.filter(s => !r.grade || !s.grade || String(s.grade) === String(r.grade));
    const subj = matchSubject(r.subject || r.title + ' ' + (r.text || '').slice(0, 2000), pool);
    const mat = await addMaterial(file, { kind: 'notice', subjectId: subj?.id || '' });
    const n = await saveNotice(blankNotice({
      title: r.title, level: r.level || 'School', grade: r.grade || subj?.grade || '', subjectId: subj?.id || '', due: r.due || '',
      items: (r.items || []).map(text => ({ text, done: false })), notes: r.notes || '', fileId: mat.id, text: r.text || '',
    }));
    status.replaceChildren();
    location.hash = 'moderation/notice/' + n.id;
    toast(n.due ? `Notice added, due ${fmt(n.due)}${ai ? ' (read by AI)' : ''}. Check the details.` : 'Notice added. No due date was found, so add one.', n.due ? 'ok' : 'warn');
  } catch (err) { status.replaceChildren(h('p', { class: 'error' }, err.message)); }
}

// ---------- Detail ----------
export function noticeDetail(n) {
  const save = () => saveNotice(n);
  const quiet = () => saveNotice(n, { silent: true });
  const file = state.materials.find(m => m.id === n.fileId);
  const { done, total } = progress(n);
  const page = h('div', { class: 'page notice-detail' });

  page.append(h('header', { class: 'page-head' },
    h('a', { href: '#moderation', class: 'back' }, icon('left', 16), 'All notices'),
    h('input', { class: 'title-input', value: n.title, 'aria-label': 'Notice title', onchange: e => { n.title = e.target.value.trim() || 'Moderation notice'; save(); } }),
    h('div', { class: 'row wrap between' },
      h('p', { class: 'nc-due big ' + (n.submitted ? 'done' : n.due && daysUntil(n.due) <= 3 ? 'soon' : '') }, dueText(n), total ? ` · ${done} of ${total} ready` : ''),
      h('div', { class: 'row wrap' },
        n.due ? h('button', { class: 'btn', onclick: () => { download(new Blob([icsFor(n)], { type: 'text/calendar' }), safeName('Moderation - ' + n.title) + '.ics'); toast('Open the downloaded file to add it to your calendar with the reminders.'); } }, icon('calendar'), 'Add to my phone calendar') : null,
        h('button', { class: 'btn ' + (n.submitted ? 'ghost' : 'primary'), onclick: () => { n.submitted = !n.submitted; n.submittedOn = n.submitted ? today() : ''; save(); toast(n.submitted ? 'Marked as submitted. Its reminders are off.' : 'Reopened.'); } }, icon('check'), n.submitted ? 'Reopen' : 'Mark as submitted'),
        h('button', { class: 'btn ghost danger', 'aria-label': 'Delete notice', onclick: async () => { if (await confirmBox(`Delete “${n.title}”? The uploaded file stays in Materials.`)) { await deleteNotice(n.id); location.hash = 'moderation'; } } }, icon('trash', 16)))),
  ));

  // Details
  const remind = new Set(n.remind || []);
  page.append(h('section', { class: 'card-sec wide' },
    h('div', { class: 'form-grid' },
      fld('Due date', h('input', { type: 'date', value: n.due || '', onchange: e => { n.due = e.target.value; save(); } }), 'When the work must be handed in, or moderation takes place.'),
      fld('Level', h('select', { onchange: e => { n.level = e.target.value; quiet(); } }, ['School', 'Cluster', 'District', 'Provincial'].map(l => h('option', { selected: l === n.level }, l)))),
      fld('Subject', h('select', { onchange: e => { n.subjectId = e.target.value; quiet(); } }, h('option', { value: '' }, '—'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === n.subjectId }, subjectLabel(s))))),
      fld('Grade', h('input', { value: n.grade || '', placeholder: 'e.g. 10', onchange: e => { n.grade = e.target.value.trim(); quiet(); } })),
    ),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Remind me on the planner'),
      h('div', { class: 'chips' }, REMIND_CHOICES.map(d => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: remind.has(d), onchange: e => { e.target.checked ? remind.add(d) : remind.delete(d); n.remind = [...remind].sort((a, b) => b - a); save(); } }), d === 1 ? '1 day before' : d === 7 ? '1 week before' : d === 14 ? '2 weeks before' : `${d} days before`))),
      h('span', { class: 'hint' }, 'Reminders show on those days in the planner and calendar. "Add to my phone calendar" gives you real alerts on your tablet.')),
  ));

  // Checklist
  const addIn = h('input', { placeholder: 'Add something to hand in or prepare…', 'aria-label': 'New item', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { (n.items ||= []).push({ text: e.target.value.trim(), done: false }); save(); } } });
  const missing = COMMON_ITEMS.filter(c => !(n.items || []).some(i => i.text.toLowerCase() === c.toLowerCase()));
  page.append(h('section', { class: 'checklist notice-items' },
    h('div', { class: 'row between' }, h('h2', {}, 'What to hand in'), total ? h('span', { class: 'muted small' }, `${done} of ${total} ready`) : null),
    (n.items || []).length ? h('ol', {}, n.items.map((it, i) => h('li', { class: 'item-row' + (it.done ? ' done' : '') },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.done, onchange: e => { it.done = e.target.checked; save(); } }), h('span', { class: 'sr' }, 'Ready')),
      h('input', { class: 'item-text', value: it.text, 'aria-label': 'Item', onchange: e => { it.text = e.target.value; quiet(); } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove ' + it.text, onclick: () => { n.items.splice(i, 1); save(); } }, icon('x', 14))))) : h('p', { class: 'muted' }, 'Nothing listed yet. Add what the notice asks for.'),
    addIn,
    missing.length ? h('div', { class: 'chips quick' }, h('span', { class: 'muted small' }, 'Quick add:'), missing.map(c => h('button', { class: 'chip', onclick: () => { (n.items ||= []).push({ text: c, done: false }); save(); } }, '+ ' + c))) : null,
  ));

  // Marks + notes + file
  const mods = [...state.moderations].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const linked = moderationById(n.moderationId);
  page.append(h('section', { class: 'card-sec wide' },
    h('h2', {}, 'Marks and scripts'),
    h('p', { class: 'muted small' }, 'Link the marksheet moderation for this task: the sample of scripts, moderator marks and checklists.'),
    h('div', { class: 'row wrap' },
      h('select', { 'aria-label': 'Linked marksheet moderation', onchange: e => { n.moderationId = e.target.value; save(); } }, h('option', { value: '' }, 'Not linked'), mods.map(m => h('option', { value: m.id, selected: m.id === n.moderationId }, `${m.title || 'Task'}${m.cls ? ' · ' + m.cls : ''}`))),
      linked ? h('a', { class: 'btn ghost', href: '#moderation/' + linked.id }, 'Open marksheet moderation') : h('a', { class: 'btn ghost', href: '#moderation/marks' }, icon('upload', 16), 'Upload a marksheet'))));

  page.append(h('section', { class: 'card-sec wide' },
    h('h2', {}, 'Notes'),
    h('textarea', { rows: 4, placeholder: 'Venue, who to give it to, what the HOD said…', oninput: e => { n.notes = e.target.value; debounce(quiet); } }, n.notes || ''),
    h('h3', {}, 'The notice'),
    file ? h('div', { class: 'row wrap' }, icon('clip', 16), h('button', { class: 'link', onclick: () => download(file.blob, file.name) }, file.name),
      aiReady() ? (() => { const b = h('button', { class: 'btn ghost sm' }, icon('spark', 16), 'Fill in from the notice with AI'); b.onclick = () => aiFill(n, file, b); return b; })() : null)
      : h('div', {}, h('p', { class: 'muted small' }, 'No file attached.'), dropZone({ accept: '.pdf,.docx,.txt,image/*', label: 'Attach the notice', onFiles: async ([f]) => { const m = await addMaterial(f, { kind: 'notice', subjectId: n.subjectId }); n.fileId = m.id; save(); } })),
  ));
  return page;
}

async function aiFill(n, file, btn) {
  const done = busy(btn, 'Reading… up to a minute');
  try {
    const year = state.settings.year || new Date().getFullYear();
    const k = kindOf(file);
    const r = await aiReadNotice(k === 'image' ? { image: await shrinkImage(file.blob, 2000) } : k === 'pdf' ? { pdf: await toBase64(file.blob) } : { text: n.text || '' }, year);
    if (r.title) n.title = r.title;
    if (r.due) n.due = r.due;
    if (r.level) n.level = r.level;
    if (r.grade) n.grade = r.grade;
    const have = new Set((n.items || []).map(i => i.text.toLowerCase()));
    n.items = [...(n.items || []), ...r.items.filter(t => !have.has(t.toLowerCase())).map(text => ({ text, done: false }))];
    if (r.notes && !(n.notes || '').includes(r.notes)) n.notes = [n.notes, r.notes].filter(Boolean).join('\n');
    if (r.subject && !n.subjectId) n.subjectId = matchSubject(r.subject, state.subjects)?.id || '';
    await saveNotice(n); toast('Filled in from the notice. Check it.');
  } catch (e) { toast(e.message, 'error'); } finally { done(); }
}

let debT; const debounce = fn => { clearTimeout(debT); debT = setTimeout(fn, 500); };
const fld = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);

// ---------- Calendar file (.ics) with alarms ----------
export function icsFor(n) {
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
  const d = n.due.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const s = subjectById(n.subjectId);
  const desc = [s ? subjectLabel(s) : '', n.level ? n.level + ' moderation' : '', ...(n.items || []).map(i => `${i.done ? '[x]' : '[ ]'} ${i.text}`), n.notes].filter(Boolean).join('\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teachers Desk//Moderation//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${n.id}@klasboek`, `DTSTAMP:${stamp}`, `DTSTART:${d}T070000`, `DTEND:${d}T073000`,
    `SUMMARY:${esc('Moderation due: ' + n.title)}`, `DESCRIPTION:${esc(desc)}`];
  for (const days of [...(n.remind || []), 0]) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(days ? `${n.title}: due in ${days} day${days > 1 ? 's' : ''}` : `${n.title}: due today`)}`, `TRIGGER:${days ? '-P' + days + 'D' : '-PT0M'}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
