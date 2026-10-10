// Small DOM helpers shared by every view.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, kind = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg; t.dataset.kind = kind; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

// Modal dialog. Returns { close, el }.
export function modal(title, body, { wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: 'modal' + (wide ? ' wide' : '') });
  const close = () => { dlg.close(); dlg.remove(); onClose && onClose(); };
  dlg.append(
    h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
  );
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dlg); dlg.showModal();
  return { close, el: dlg };
}

export function confirmBox(text, okLabel = 'Delete') {
  return new Promise(res => {
    let done = false;
    const m = modal('Are you sure?', [
      h('p', {}, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => { done = true; m.close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn danger', onclick: () => { done = true; m.close(); res(true); } }, okLabel)),
    ], { onClose: () => { if (!done) res(false); } });
  });
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const safeName = s => String(s || 'file').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);

const loaded = {};
export function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => {
    const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

export function busy(btn, label) {
  const old = btn.innerHTML; btn.disabled = true; btn.classList.add('busy');
  btn.innerHTML = ''; btn.append(h('span', { class: 'spinner' }), label || 'Working…');
  return () => { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = old; };
}

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  month: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="14" r="1"/><circle cx="8" cy="17.5" r="1"/><circle cx="12" cy="17.5" r="1"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h10"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4M8 20h8"/>',
  sheet: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  wand: '<path d="M4 20L16 8M14 4v3M19 9h3M18 4l-2 2M20 14l-1 1"/>',
  paper: '<path d="M21 3L3 10l7 3 3 7z"/><path d="M10 13l11-10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  offline: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11a10 10 0 0 1 2.2 1.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// Drop zone that accepts files by click or drag.
export function dropZone({ accept, label, hint, onFiles, multiple = false }) {
  const input = h('input', { type: 'file', accept, multiple, hidden: true, onchange: () => { if (input.files.length) onFiles([...input.files]); input.value = ''; } });
  const zone = h('label', { class: 'drop', tabindex: 0 },
    icon('upload', 22), h('strong', {}, label), hint ? h('span', { class: 'muted' }, hint) : null, input);
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', e => { const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : [f[0]]); });
  return zone;
}
