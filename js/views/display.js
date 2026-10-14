// Display size for this device only (not synced): the tablet and the PC can each have their own.
import { h, toast } from '../ui.js';

const KEY = 'klasboek.uiScale';
export const SIZES = [['0.85', 'Smaller'], ['0.93', 'Small'], ['1', 'Normal'], ['1.1', 'Large'], ['1.22', 'Larger']];
export const uiScale = () => { try { return localStorage.getItem(KEY) || '1'; } catch { return '1'; } };
export function setUiScale(v) {
  try { if (v === '1') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch {}
  document.documentElement.style.setProperty('--ui-scale', v);
}

// Colours and menu position, also per device.
export const THEMES = [
  ['chalk', 'Chalkboard', 'Dark green menu, white pages. The original.'],
  ['light', 'Light', 'White menu and soft colours. Calm and airy.'],
  ['night', 'Night', 'Dark everywhere, easy on the eyes in the evening.'],
];
export const MENUS = [
  ['auto', 'Automatic', 'Names on a big screen, icons on a tablet, a bottom bar on small screens.'],
  ['side', 'Side menu with names', 'Menu down the left with names, on every screen.'],
  ['icons', 'Icons only', 'A narrow menu, so pages get more room.'],
  ['top', 'Across the top', 'Menu along the top. The planner gets the full width.'],
];
const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
export const currentTheme = () => get('klasboek.theme', 'chalk');
export const currentMenu = () => get('klasboek.menu', 'auto');
export function setLook(kind, v) {
  const key = 'klasboek.' + kind, def = kind === 'theme' ? 'chalk' : 'auto';
  try { if (v === def) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch {}
  const d = document.documentElement;
  if (v === def) delete d.dataset[kind]; else d.dataset[kind] = v;
  if (kind === 'theme') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v === 'light' ? '#FFFFFF' : v === 'night' ? '#0F1413' : '#1E3B33');
}

// A tiny picture of each choice, so it's clear before you tap it.
function mini(theme, menu) {
  const cls = `mini t-${theme} m-${menu}`;
  return h('span', { class: cls, 'aria-hidden': 'true' },
    h('span', { class: 'mini-rail' }, h('i'), h('i'), h('i'), h('i')),
    h('span', { class: 'mini-page' }, h('b'), h('span', { class: 'mini-row' }, h('i', { class: 'c1' }), h('i', { class: 'c2' }), h('i')), h('span', { class: 'mini-row' }, h('i'), h('i', { class: 'c3' }), h('i', { class: 'c1' }))));
}

export function lookSection() {
  const sec = h('section', { class: 'card-sec' });
  const draw = () => {
    const t = currentTheme(), m = currentMenu();
    const card = (kind, [id, label, hint], on, pic) => h('button', { class: 'look-card', role: 'radio', 'aria-checked': String(on),
      onclick: () => { setLook(kind, id); draw(); toast(`${label} on this device.`); } }, pic, h('strong', {}, label), h('span', { class: 'muted small' }, hint));
    sec.replaceChildren(
      h('h2', {}, 'Layout and colours on this device'),
      h('p', { class: 'muted small' }, 'Try them: everything changes straight away and nothing else is affected. Each device keeps its own, so the tablet can use one layout and the PC another.'),
      h('h3', {}, 'Colours'),
      h('div', { class: 'look-grid', role: 'radiogroup', 'aria-label': 'Colours' }, THEMES.map(x => card('theme', x, x[0] === t, mini(x[0], m)))),
      h('h3', {}, 'Menu'),
      h('div', { class: 'look-grid', role: 'radiogroup', 'aria-label': 'Menu' }, MENUS.map(x => card('menu', x, x[0] === m, mini(t, x[0])))),
      h('p', { class: 'muted small' }, 'On a phone the menu always sits along the bottom, where your thumb can reach it.'),
      h('p', { class: 'muted small' }, `This screen is ${window.innerWidth} points wide${window.innerWidth < 600 ? ', so it counts as a phone and the menu stays at the bottom.' : '.'}`));
  };
  draw();
  return sec;
}

export function displaySection() {
  const sec = h('section', { class: 'card-sec' });
  const draw = () => {
    const cur = uiScale();
    sec.replaceChildren(
      h('h2', {}, 'Display size on this device'),
      h('p', { class: 'muted small' }, 'Each device keeps its own size, so the tablet and the PC can look right at the same time. This isn’t synced.'),
      h('div', { class: 'seg size-seg', role: 'radiogroup', 'aria-label': 'Display size' }, SIZES.map(([v, label]) =>
        h('button', { role: 'radio', 'aria-checked': String(cur === v), style: { fontSize: `calc(.95rem * ${v} / ${cur})` }, onclick: () => { setUiScale(v); draw(); toast(`Display size: ${label}.`); } }, label))),
      h('details', { class: 'ext-steps' }, h('summary', {}, 'Still too big or too small?'),
        h('ul', {},
          h('li', {}, h('strong', {}, 'PC: '), 'the browser may be zoomed. Press Ctrl and 0 (zero) to reset it, or Ctrl and minus / plus to change it. Windows display scaling (Settings › Display › Scale) also makes everything bigger.'),
          h('li', {}, h('strong', {}, 'Fire tablet (Silk): '), 'open the Silk menu and turn off “Request desktop site” (or “Desktop view”), then reload. Desktop mode makes everything tiny.'),
          h('li', {}, h('strong', {}, 'Android (Chrome): '), 'untick “Desktop site” in the ⋮ menu. Chrome’s own text size is under ⋮ › Settings › Accessibility.'))));
  };
  draw();
  return sec;
}
