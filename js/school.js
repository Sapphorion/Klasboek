// Connect to my school: Klasboek signs in to Skool Huis, the school's own system,
// with the teacher's Skool Huis account.
//
// What comes in: term dates, the school calendar, the teacher's mark sheets
// (for moderation) and the school inventory. Learner names are fetched when
// needed and are not stored in Klasboek's own data, so they never go to a
// teacher's personal GitHub or Google sync.
//
// The sign-in lives in this browser's localStorage (not in Klasboek's
// database), so it is never part of a backup, a GitHub sync or a Google sync.

import { SKOOLHUIS } from './config.js';
import { state, saveSettings, saveEvents, deleteEvents } from './state.js';

const KEY = 'klasboek.school.v1';
const listeners = new Set();
export const onSchool = fn => (listeners.add(fn), () => listeners.delete(fn));
const tell = () => listeners.forEach(fn => fn());

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {}
  tell();
}

/** { school: {id, name}, role, email, pulledAt } when connected, else null. */
export function school() {
  const s = read();
  return s?.school ? { school: s.school, role: s.role, email: s.email, pulledAt: s.pulledAt || null, schools: s.schools || [] } : null;
}
export const connected = () => !!school();
export const schoolLink = (path = '') => `${SKOOLHUIS.app}/#/${path}`;

class SchoolError extends Error {}

async function auth(path, body) {
  let res;
  try {
    res = await fetch(`${SKOOLHUIS.url}/auth/v1/${path}`, {
      method: 'POST', headers: { apikey: SKOOLHUIS.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new SchoolError('Could not reach Skool Huis. Check the internet connection.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = j.error_description || j.msg || j.message || '';
    if (/invalid login|invalid_grant|credentials/i.test(m)) throw new SchoolError('That email and password don’t match a Skool Huis account.');
    if (/not confirmed/i.test(m)) throw new SchoolError('Confirm your email address first: open the email Skool Huis sent you.');
    throw new SchoolError(m || 'Skool Huis didn’t accept that.');
  }
  return j;
}

async function token() {
  const s = read();
  if (!s?.refresh_token) throw new SchoolError('Connect to your school first (Settings › Your school).');
  if (s.expires_at && s.expires_at * 1000 > Date.now() + 60_000) return s.access_token;
  try {
    const j = await auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    write({ ...s, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at });
    return j.access_token;
  } catch (e) {
    if (e instanceof SchoolError && !/reach/.test(e.message)) { write(null); throw new SchoolError('Your school sign-in has ended. Connect again in Settings.'); }
    throw e;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const t = await token();
  let res;
  try {
    res = await fetch(`${SKOOLHUIS.url}/rest/v1/${path}`, {
      method, headers: { apikey: SKOOLHUIS.key, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new SchoolError('Could not reach Skool Huis. Check the internet connection.'); }
  const text = await res.text();
  if (!res.ok) {
    let m = text; try { m = JSON.parse(text).message || text; } catch {}
    throw new SchoolError(m || `Skool Huis answered ${res.status}`);
  }
  return text ? JSON.parse(text) : null;
}
export const rpc = (fn, args = {}) => api(`rpc/${fn}`, { method: 'POST', body: args });

/** Sign in, then find the schools where this person is staff. */
export async function connect(email, password) {
  const j = await auth('token?grant_type=password', { email: email.trim(), password });
  write({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, email: j.user?.email, user: j.user?.id });
  const rows = await api(`school_members?select=role,school:schools(id,name)&user_id=eq.${j.user.id}`);
  const staff = (rows || []).filter(r => r.role === 'admin' || r.role === 'teacher');
  if (!staff.length) { write(null); throw new SchoolError('This account isn’t a teacher or office account at any school. Ask the school office to invite you in Skool Huis.'); }
  const schools = [...new Map(staff.map(r => [r.school.id, r.school])).values()];
  const pick = staff.find(r => r.role === 'teacher') || staff[0];
  write({ ...read(), school: pick.school, role: staff.filter(r => r.school.id === pick.school.id).some(r => r.role === 'admin') ? 'admin' : 'teacher', schools });
  return school();
}

export function chooseSchool(id) {
  const s = read();
  const sc = s?.schools?.find(x => x.id === id);
  if (sc) write({ ...s, school: sc, pulledAt: null });
}

/** Disconnect this device. School calendar events brought in are removed too. */
export async function disconnect() {
  const s = read();
  if (s?.access_token) fetch(`${SKOOLHUIS.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: SKOOLHUIS.key, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  write(null);
  const ours = state.events.filter(e => e.source === 'skoolhuis').map(e => e.id);
  if (ours.length) await deleteEvents(ours);
}

// ---------- Calendar and term dates ----------

const SAST = 'Africa/Johannesburg';
const dayOf = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: SAST });
const timeOf = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: SAST, hour: '2-digit', minute: '2-digit' });
const TYPE = { exam: 'exam', holiday: 'holiday', meeting: 'meeting', sport: 'event', extra_class: 'event', event: 'event' };

/** A Skool Huis calendar occurrence as a Klasboek event (or null if cancelled). */
export function toEvent(o) {
  if (o.status === 'cancelled') return null;
  const date = dayOf(o.starts_at);
  const end = o.all_day && o.ends_at ? dayOf(o.ends_at) : null;
  return {
    id: `sh_${o.event_id}_${o.occurs_on}`,
    source: 'skoolhuis',
    date,
    endDate: end && end > date ? end : undefined,
    time: o.all_day ? '' : timeOf(o.starts_at),
    title: o.title,
    type: TYPE[o.category] || 'event',
    noTeaching: o.category === 'holiday',
    notes: [o.location, o.audience_label, o.status === 'moved' ? 'Moved' : '', o.note].filter(Boolean).join(' · '),
  };
}

/** Bring in term dates and this year's school calendar. Returns what changed. */
export async function pullSchool() {
  const s = school();
  if (!s) throw new SchoolError('Connect to your school first.');
  const year = state.settings.year;
  const out = { terms: false, events: 0 };

  const terms = await api(`terms?select=year,term_number,starts_on,ends_on&school_id=eq.${s.school.id}&year=eq.${year}&order=term_number`);
  if (terms?.length === 4) {
    const next = terms.map(t => ({ start: t.starts_on, end: t.ends_on }));
    if (JSON.stringify(next) !== JSON.stringify(state.settings.terms.map(t => ({ start: t.start, end: t.end })))) {
      await saveSettings({ terms: next });
      out.terms = true;
    }
  }

  const occ = await rpc('my_calendar', { p_school: s.school.id, p_from: `${year}-01-01`, p_to: `${year}-12-31` });
  const events = (occ || []).map(toEvent).filter(Boolean);
  const keep = new Set(events.map(e => e.id));
  const stale = state.events.filter(e => e.source === 'skoolhuis' && e.date.startsWith(String(year)) && !keep.has(e.id)).map(e => e.id);
  const changed = events.filter(e => {
    const old = state.events.find(x => x.id === e.id);
    return !old || ['date', 'endDate', 'time', 'title', 'type', 'noTeaching', 'notes'].some(k => (old[k] ?? '') !== (e[k] ?? ''));
  });
  if (stale.length) await deleteEvents(stale);
  if (changed.length) await saveEvents(changed);
  out.events = changed.length + stale.length;

  write({ ...read(), pulledAt: new Date().toISOString() });
  return out;
}

/** Pull quietly at start-up when it's been a while. */
export async function pullIfDue(hours = 6) {
  const s = school();
  if (!s || !navigator.onLine) return null;
  if (s.pulledAt && Date.now() - Date.parse(s.pulledAt) < hours * 3600e3) return null;
  try { return await pullSchool(); } catch { return null; }
}

// ---------- Mark book (for moderation) ----------

export const markSheets = () => rpc('my_mark_sheets', { p_school: school().school.id });
export const markSheet = id => rpc('mark_sheet', { p_sheet: id });

// ---------- Inventory ----------

export const inventory = tab => rpc('inventory_list', { p_school: school().school.id, p_tab: tab });
export const adjustStock = (item, change, reason) => rpc('adjust_stock', { p_item: item, p_change: change, p_reason: reason || null });
export const saveItem = item => rpc('save_inventory_item', { p_school: school().school.id, p_item: item });

/** A Klasboek lab stock item as a Skool Huis lab item. */
export function toSchoolItem(it, area) {
  const n = v => (v === '' || v == null || isNaN(+v) ? null : +v);
  return {
    tab: 'lab', name: it.name, area, numbered: false,
    category: ['Chemicals', 'Glassware', 'Equipment', 'Consumables', 'Biological', 'Safety', 'Other'].includes(it.category) ? it.category : 'Other',
    quantity: n(it.qty), unit: it.unit || null, reorder_level: n(it.min), location: it.location || null, supplier: it.supplier || null,
    unit_cost: n(it.cost), bought_on: it.purchased || null, opened_on: it.opened || null, expires_on: it.expiry || null,
    hazard: it.hazard || null, formula: it.formula || null, notes: it.notes || null,
  };
}
