// First open: who is Teacher’s Desk for, and do you want to sign in so your work is saved to your account?
import { state, saveSettings } from '../state.js';
import { h, icon, toast } from '../ui.js';
import { fbConfigured } from '../fbauth.js';
import { signInFlow } from '../signin.js';

export function needsWelcome() {
  if (state.settings.edition) return false;
  return !(state.subjects.length || state.lessons.length || state.settings.onboarded);
}

export function openWelcome(onDone, { edition } = {}) {
  const dlg = h('dialog', { class: 'modal welcome', 'aria-label': 'Welcome to Teacher’s Desk' });
  const body = h('div', { class: 'modal-body' });
  dlg.append(body);
  dlg.addEventListener('cancel', e => e.preventDefault());
  const finish = () => { dlg.close(); dlg.remove(); onDone?.(); };
  const card = (title, text, ic, fn) => h('button', { class: 'welcome-card', onclick: fn }, h('span', { class: 'wc-ic' }, icon(ic, 26)), h('strong', {}, title), h('span', { class: 'muted small' }, text));
  const step1 = () => body.replaceChildren(
    h('h1', {}, 'Welcome to Teacher’s Desk'),
    h('p', { class: 'muted' }, 'Planning, calendar, diary and teaching materials in one place. Who will be using it?'),
    h('div', { class: 'welcome-grid' },
      card('School teacher', 'ATPs, grades and classes, the school calendar, moderation and lab stock.', 'book', () => pick('school')),
      card('University lecturer', 'Modules, lectures and students, the academic calendar and attendance with student cards.', 'check', () => pick('uni'))),
    h('p', { class: 'muted small' }, 'You can change this later in Settings.'));
  const pick = async ed => {
    await saveSettings({ edition: ed, home: ed === 'uni' ? 'planner' : (state.settings.home || 'today') });
    window.dispatchEvent(new Event('klasboek-edition'));
    step2();
  };
  const step2 = () => body.replaceChildren(
    h('h1', {}, 'Save your work to your account'),
    h('p', {}, 'Sign in with Google and your Teacher’s Desk is saved to your account, so it’s the same on your laptop, phone and tablet, and nothing is lost if a device breaks.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn g-btn big', disabled: !fbConfigured() || !navigator.onLine, onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try { const u = await signInFlow(); if (u) finish(); } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
      } }, 'Sign in with Google'),
      !fbConfigured() ? h('p', { class: 'muted small' }, 'Google sign-in isn’t switched on for this copy of Teacher’s Desk yet. You can sign in later in Settings.') : !navigator.onLine ? h('p', { class: 'muted small' }, 'You’re offline. You can sign in later in Settings.') : null,
      h('button', { class: 'btn ghost', onclick: finish }, 'Not now: keep everything on this device')));
  if (edition) pick(edition); else step1();
  document.body.append(dlg); dlg.showModal();
}
