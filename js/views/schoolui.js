// Klasboek's side of "Connect to my school" (Skool Huis): the Settings section,
// moderation mark sheets from the school mark book, and the school inventory.
import { state, saveModeration, deleteStock } from '../state.js';
import { h, icon, toast, modal, busy, confirmBox } from '../ui.js';
import { today } from '../dates.js';
import {
  school, connect, disconnect, chooseSchool, pullSchool, markSheets, markSheet, inventory, adjustStock, saveItem, toSchoolItem, schoolLink,
} from '../school.js';
import { areaOf } from './stock.js';

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
const when = iso => iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not yet';

// ---------- Settings ----------
export function schoolSection() {
  const sec = h('section', { class: 'card-sec', id: 'school' });
  const draw = () => {
    const s = school();
    if (!s) {
      const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@school.co.za' });
      const pw = h('input', { type: 'password', autocomplete: 'current-password' });
      const msg = h('p', { class: 'error', hidden: true });
      const go = h('button', { class: 'btn', onclick: async () => {
        msg.hidden = true;
        const done = busy(go, 'Connecting…');
        try {
          await connect(email.value, pw.value);
          const r = await pullSchool();
          toast(`Connected to ${school().school.name}.${r.events ? ` ${r.events} calendar events brought in.` : ''}${r.terms ? ' Term dates updated.' : ''}`);
          draw();
        } catch (e) { msg.textContent = e.message; msg.hidden = false; }
        finally { done(); }
      } }, icon('link', 16), 'Connect');
      sec.replaceChildren(h('h2', {}, 'Your school'),
        h('p', { class: 'muted small' }, 'If your school uses Skool Huis, sign in with your Skool Huis teacher account. Klasboek then brings in the term dates and the school calendar, makes moderation mark sheets from your Skool Huis mark book, and shows the school’s lab stock and equipment. Learner names are only fetched when you need them and aren’t kept in your Klasboek sync.'),
        h('div', { class: 'form-grid' }, field('Skool Huis email', email), field('Password', pw)),
        msg, h('div', { class: 'row' }, go));
      return;
    }
    const pullBtn = h('button', { class: 'btn ghost sm', onclick: async () => {
      const done = busy(pullBtn, 'Bringing in…');
      try {
        const r = await pullSchool();
        toast(r.events || r.terms ? `${r.events} calendar ${r.events === 1 ? 'change' : 'changes'}${r.terms ? ', term dates updated' : ''}.` : 'Already up to date.');
        draw();
      } catch (e) { toast(e.message, 'error'); }
      finally { done(); }
    } }, icon('refresh', 16), 'Bring in now');
    sec.replaceChildren(h('h2', {}, 'Your school'),
      h('p', {}, 'Connected to ', h('strong', {}, s.school.name), ` as ${s.email} (${s.role === 'admin' ? 'office' : 'teacher'}).`),
      s.schools.length > 1 ? field('School', h('select', { onchange: e => { chooseSchool(e.target.value); draw(); } },
        s.schools.map(x => h('option', { value: x.id, selected: x.id === s.school.id }, x.name)))) : null,
      h('p', { class: 'muted small' }, `Term dates and the school calendar last brought in: ${when(s.pulledAt)}. It happens by itself every few hours while Klasboek is open.`),
      h('div', { class: 'row wrap' }, pullBtn,
        h('a', { class: 'btn ghost sm', href: schoolLink(), target: '_blank', rel: 'noopener' }, icon('external', 16), 'Open Skool Huis'),
        h('button', { class: 'btn ghost sm', onclick: async () => {
          if (!await confirmBox('Disconnect this device from your school? The school calendar events are removed from Klasboek; everything else stays.', 'Disconnect')) return;
          await disconnect(); toast('Disconnected.'); draw();
        } }, 'Disconnect')));
  };
  draw();
  return sec;
}

// ---------- Moderation from the mark book ----------
export function markBookButton(onMade) {
  if (!school()) return null;
  return h('button', { class: 'btn ghost sm', onclick: () => pickFromMarkBook(onMade) }, icon('download', 16), 'From the Skool Huis mark book');
}

async function pickFromMarkBook(onMade) {
  const body = h('div', {}, h('p', {}, h('span', { class: 'spinner' }), ' Loading your mark sheets…'));
  const md = modal('From the Skool Huis mark book', body, { wide: true });
  let sheets;
  try { sheets = await markSheets(); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
  if (!sheets?.length) { body.replaceChildren(h('p', {}, 'You have no mark sheets in Skool Huis yet. Set one up there under Mark book.')); return; }
  body.replaceChildren(h('p', { class: 'muted' }, 'Choose the subject and class, then the task. Its captured marks become the red column.'),
    h('ul', { class: 'pick-list' }, sheets.map(s => h('li', {}, h('button', { class: 'btn ghost', onclick: () => pickTask(s) },
      h('strong', {}, `${s.subject} · ${s.class}`), h('span', { class: 'muted small' }, ` ${s.learners} learners · ${s.captured} marks captured`))))));

  async function pickTask(s) {
    body.replaceChildren(h('p', {}, h('span', { class: 'spinner' }), ' Loading…'));
    let sh;
    try { sh = await markSheet(s.id); } catch (e) { body.replaceChildren(h('p', { class: 'error' }, e.message)); return; }
    const byTerm = [1, 2, 3, 4].map(t => [t, sh.tasks.filter(x => x.term === t)]).filter(([, l]) => l.length);
    body.replaceChildren(h('p', {}, h('strong', {}, `${sh.subject} · ${sh.class}`), ` · ${sh.learners.length} learners`),
      ...byTerm.map(([t, list]) => h('div', {}, h('h3', {}, `Term ${t}`), h('div', { class: 'row wrap' }, list.map(task => {
        const n = sh.marks.filter(m => m.task_id === task.id && (m.mark != null || m.absent)).length;
        return h('button', { class: 'btn ghost sm', onclick: () => make(sh, task) }, `${task.name} (/${task.out_of}) · ${n} marks`);
      })))));
  }

  async function make(sh, task) {
    const subj = state.subjects.find(x => sh.subject.toLowerCase().startsWith(x.name.toLowerCase()) && (!x.grade || sh.subject.includes(`Gr ${x.grade}`)))
      || state.subjects.find(x => sh.subject.toLowerCase().includes(x.name.toLowerCase()));
    const rows = sh.learners.map(l => {
      const m = sh.marks.find(x => x.task_id === task.id && x.learner_id === l.id);
      return { name: l.name, red: m?.absent ? 'AB' : m?.mark ?? '', green: '', orange: '', purple: '', note: '' };
    });
    const m = await saveModeration({ kind: 'colours', title: task.name, subjectId: subj?.id || '', cls: sh.class, teacher: sh.teacher || state.settings.teacherName,
      total: +task.out_of, purple: false, tolerance: state.settings.modTolerance, source: 'Skool Huis mark book', date: today(), stages: {}, rows });
    md.close();
    onMade?.(m);
    location.hash = 'moderation/' + m.id;
    toast(`Mark sheet ready with ${rows.filter(r => r.red !== '').length} marks from Skool Huis.`);
  }
}

// ---------- School inventory on the stock page ----------
const TABS = [['lab', 'Lab stock'], ['equipment', 'Equipment'], ['textbook', 'Textbooks'], ['other', 'Other']];
let tab = 'lab';

export function schoolStock(page, rerender) {
  const box = h('div', { class: 'school-stock' }, h('p', {}, h('span', { class: 'spinner' }), ' Loading the school inventory…'));
  page.append(
    h('p', { class: 'muted small' }, 'The school’s inventory in Skool Huis, shared with the other staff. Record use and new stock here; add items, issue textbooks and equipment, or print labels in Skool Huis.'),
    h('div', { class: 'tabs-row', role: 'tablist' }, TABS.map(([id, label]) => h('button', { role: 'tab', class: 'chip' + (tab === id ? ' on' : ''), 'aria-selected': tab === id, onclick: () => { tab = id; rerender(); } }, label))),
    box);
  if (state.stock.length) page.append(moveBanner(rerender));

  inventory(tab).then(items => {
    if (!items.length) { box.replaceChildren(h('p', { class: 'empty' }, 'Nothing here yet. ', h('a', { href: schoolLink(`inventory?tab=${tab}`), target: '_blank', rel: 'noopener' }, 'Add items in Skool Huis'), '.')); return; }
    box.replaceChildren(h('ul', { class: 'school-items' }, items.map(it => itemRow(it, rerender))),
      h('p', {}, h('a', { href: schoolLink(`inventory?tab=${tab}`), target: '_blank', rel: 'noopener' }, icon('external', 14), ' Open in Skool Huis')));
  }).catch(e => box.replaceChildren(h('p', { class: 'error' }, e.message)));
}

function itemRow(it, rerender) {
  const flags = [it.low && h('span', { class: 'tag warn' }, 'Low'), it.expiring && h('span', { class: 'tag warn' }, 'Expires soon'), it.overdue > 0 && h('span', { class: 'tag warn' }, `${it.overdue} overdue`)].filter(Boolean);
  const meta = [it.area, it.category, it.subject, it.grade != null ? `Gr ${it.grade}` : null, it.location].filter(Boolean).join(' · ');
  const amount = h('input', { type: 'number', step: 'any', min: 0, placeholder: it.unit || 'amount', 'aria-label': `Amount of ${it.name}`, class: 'qty-in' });
  const change = sign => async e => {
    const n = +amount.value;
    if (!(n > 0)) { amount.focus(); return; }
    const done = busy(e.currentTarget, '…');
    try { await adjustStock(it.id, sign * n, sign < 0 ? 'Used' : 'New stock'); toast(`${it.name}: ${sign < 0 ? '−' : '+'}${n} ${it.unit || ''}`); rerender(); }
    catch (err) { toast(err.message, 'error'); }
    finally { done(); }
  };
  return h('li', {},
    h('div', { class: 'si-main' }, h('strong', {}, it.name), meta ? h('span', { class: 'muted small' }, meta) : null, flags.length ? h('span', { class: 'row' }, flags) : null),
    it.numbered
      ? h('div', { class: 'si-count' }, h('strong', {}, `${it.available} of ${it.copies}`), h('span', { class: 'muted small' }, ' in'))
      : h('div', { class: 'si-count' }, h('strong', {}, `${+it.quantity} ${it.unit || ''}`),
        h('div', { class: 'row' }, amount, h('button', { class: 'btn ghost sm', onclick: change(-1) }, '− Used'), h('button', { class: 'btn ghost sm', onclick: change(1) }, '+ New'))));
}

function moveBanner(rerender) {
  const n = state.stock.length;
  const btn = h('button', { class: 'btn sm', onclick: async () => {
    if (!await confirmBox(`Move your ${n} lab stock ${n === 1 ? 'item' : 'items'} into the school inventory, so all staff share one list? Each is removed from your own list once it’s in.`, 'Move them')) return;
    const done = busy(btn, 'Moving…');
    let moved = 0;
    try {
      for (const it of [...state.stock]) {
        await saveItem(toSchoolItem(it, areaOf(it)));
        await deleteStock(it.id);
        moved++;
      }
      toast(`Moved ${moved} ${moved === 1 ? 'item' : 'items'} to the school inventory.`);
    } catch (e) {
      toast(`${moved} moved, then: ${e.message}`, 'error');
    } finally { done(); rerender(); }
  } }, 'Move them to the school');
  return h('div', { class: 'school-banner' }, h('p', {}, `You still have ${n} ${n === 1 ? 'item' : 'items'} in your own lab stock list on this device.`), btn,
    h('a', { href: '#stock/mine', class: 'link small' }, 'See my own list'));
}

