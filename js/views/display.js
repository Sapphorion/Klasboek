// Display size for this device only (not synced): the tablet and the PC can each have their own.
import { h, toast } from '../ui.js';

const KEY = 'klasboek.uiScale';
export const SIZES = [['0.85', 'Smaller'], ['0.93', 'Small'], ['1', 'Normal'], ['1.1', 'Large'], ['1.22', 'Larger']];
export const uiScale = () => { try { return localStorage.getItem(KEY) || '1'; } catch { return '1'; } };
export function setUiScale(v) {
  try { if (v === '1') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch {}
  document.documentElement.style.setProperty('--ui-scale', v);
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
