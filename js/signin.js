// Signing in and out with Google, and what happens to the data on this device when you do.
import { state, loadState, emit } from './state.js';
import { clearAll } from './db.js';
import { googleSignIn, googleSignOut, fbUser } from './fbauth.js';
import { syncNow, syncOwner, setSyncOwner, resetSyncState } from './sync.js';
import { h, modal, toast, confirmBox } from './ui.js';

const hasLocal = () => state.subjects.length + state.lessons.length + state.events.length + state.diary.length + state.creations.length > 0;
const STORES = ['settings', 'timetable', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events', 'notices', 'creations', 'diary', 'stock', 'attendance'];
async function wipe() { await clearAll(); await loadState(); STORES.forEach(emit); }

export async function signInFlow() {
  const u = await googleSignIn();
  if (!u) return null; // cancelled, or the page is going to Google and back
  return afterSignIn(u);
}
// Make sure one person's Teacher’s Desk never ends up in someone else's account.
export async function afterSignIn(u) {
  const owner = syncOwner();
  if (owner && owner !== u.uid) {
    if (hasLocal()) {
      const ok = await confirmBox(`This device has a Teacher’s Desk that belongs to another account. Remove it from this device and open yours (${u.email})? Their work is still safe in their own account.`, 'Open mine');
      if (!ok) { await googleSignOut(); toast('Signed out. Nothing was changed.'); return null; }
    }
    const ed = state.settings.edition;
    await wipe();
    if (ed) { const { saveSettings } = await import('./state.js'); await saveSettings({ edition: ed }); window.dispatchEvent(new Event('klasboek-edition')); }
    resetSyncState();
  } else if (!owner) resetSyncState();
  setSyncOwner(u.uid, u.email);
  window.dispatchEvent(new Event('klasboek-connected'));
  window.dispatchEvent(new Event('klasboek-sync'));
  try {
    const r = await syncNow({ quiet: false });
    toast(r === 'pulled' ? `Welcome back, ${u.name || u.email}. Your Teacher’s Desk is loaded.` : r === 'pushed' ? `Signed in. Your work is saved to ${u.email}.` : `Signed in as ${u.email}.`);
  } catch (e) { toast(e.message, 'error'); }
  return u;
}

export function signOutFlow() {
  const u = fbUser();
  return new Promise(res => {
    let wipeToo = false;
    const m = modal('Sign out', [
      h('p', {}, `Sign out of ${u?.email || 'your account'} on this device? Your work stays saved in your account.`),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { wipeToo = e.target.checked; } }), 'Also remove my Teacher’s Desk from this device (for a shared or borrowed computer)'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          m.close();
          try { await syncNow({ quiet: true }); } catch {}
          await googleSignOut();
          if (wipeToo) { await wipe(); resetSyncState(); } else setSyncOwner(u?.uid || '', u?.email || '');
          window.dispatchEvent(new Event('klasboek-sync'));
          toast(wipeToo ? 'Signed out and removed from this device.' : 'Signed out.');
          res(true);
        } }, 'Sign out')),
    ]);
  });
}
