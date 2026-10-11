// "Get the app": install Klasboek on a PC, Android phone/tablet or Amazon Fire tablet.
import { h, icon, modal, toast } from '../ui.js';

let installEvt = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; listeners.forEach(f => f()); });
window.addEventListener('appinstalled', () => { installEvt = null; listeners.forEach(f => f()); toast('Klasboek is installed. Open it from your home screen or Start menu.'); });

export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const onInstallChange = f => { listeners.add(f); return () => listeners.delete(f); };

export function deviceKind() {
  const ua = navigator.userAgent;
  if (/Silk|KF[A-Z]{2,4}\b|Kindle/i.test(ua)) return 'fire';
  if (/Android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'pc';
}

const GUIDES = {
  pc: { title: 'Windows or Mac computer', steps: [
    'Open Klasboek in Google Chrome or Microsoft Edge.',
    'Click the install icon at the right end of the address bar (a small screen with a down arrow). Or open the ⋮ / … menu and choose “Install Klasboek” (in Edge: Apps → Install this site as an app).',
    'Click Install. Klasboek opens in its own window and gets a Start menu / desktop shortcut.',
  ] },
  android: { title: 'Android phone or tablet', steps: [
    'Open Klasboek in Chrome.',
    'Tap the ⋮ menu at the top right.',
    'Tap “Install app” (on some phones it says “Add to Home screen”), then Install.',
    'Klasboek appears with your other apps and opens full screen.',
  ] },
  fire: { title: 'Amazon Fire tablet', steps: [
    'Open Klasboek in the Silk browser.',
    'Tap the menu (☰ or ⋮).',
    'Tap “Add to Home screen”, then Add.',
    'Open it once while online so everything downloads. After that it works offline too.',
  ] },
  ios: { title: 'iPad or iPhone', steps: [
    'Open Klasboek in Safari.',
    'Tap the Share button (square with an arrow).',
    'Tap “Add to Home Screen”, then Add.',
  ] },
};

export function openInstall() {
  const here = deviceKind();
  const body = h('div', { class: 'install-steps' });
  const m = modal('Get Klasboek on your devices', body, { wide: true });
  const draw = () => body.replaceChildren(
    isInstalled() ? h('p', { class: 'ok' }, icon('check', 16), ' You’re using the installed app on this device.') :
      installEvt ? h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; if (r.outcome === 'accepted') m.close(); else draw(); } }, icon('download'), 'Install on this device'), h('span', { class: 'muted small' }, 'One tap. No app store needed.')) :
      h('p', {}, 'Klasboek installs straight from the browser, no app store needed. Follow the steps for your device:'),
    ...['pc', 'android', 'fire', 'ios'].sort((a, b) => (b === here) - (a === here)).map(k => h('section', { class: k === here ? 'here' : '' },
      h('h3', {}, GUIDES[k].title, k === here ? h('span', { class: 'muted small' }, ' · this device') : null),
      h('ol', {}, GUIDES[k].steps.map(s => h('li', {}, s))))),
    h('p', { class: 'muted small' }, 'Once installed, Klasboek works offline (AI writing needs internet). Each device keeps its own copy of your planner. To move your work to another device, use Settings → Backup: download a backup here and restore it there.'),
  );
  draw();
  const off = onInstallChange(draw);
  m.el.addEventListener('close', off);
}
