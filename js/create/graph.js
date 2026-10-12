// Graphs (functions and points on a Cartesian plane) and drawn diagrams (SVG), for tests, worksheets and notes.
// Everything is drawn as SVG, so it's sharp on screen and in print, and turned into a picture for Word.

// ---------- Safe maths expressions ----------
// Accepts what teachers type: y = 2x + 1, f(x) = x² − 4, y = 3sin x, y = 2^x, y = 1/(x-1) + 2, y = -½x
const FUNCS = { sin: 'S', cos: 'C', tan: 'T', sqrt: 'Q', abs: 'A', log: 'L', ln: 'N' };
export function compile(expr) {
  let s = String(expr || '').trim();
  const name = (s.match(/^\s*([a-zA-Z]\s*(?:\(\s*x\s*\))?)\s*=/) || [])[1] || '';
  s = s.replace(/^\s*[a-zA-Z]\s*(\(\s*x\s*\))?\s*=\s*/, '');
  s = s.replace(/[−–]/g, '-').replace(/×|·/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/½/g, '(1/2)').replace(/¼/g, '(1/4)').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([\dx.]+)/g, 'sqrt($1)').replace(/\s+/g, '');
  s = s.toLowerCase();
  // Words to single-letter tokens so implicit multiplication is easy to add.
  s = s.replace(/sqrt|sin|cos|tan|abs|log|ln/g, m => FUNCS[m]).replace(/pi/g, 'P');
  if (/[^0-9x.+\-*/^()SCTQALNPe]/.test(s.replace(/e/g, ''))) throw new Error(`I can't draw “${expr}”. Use x, numbers, + − × ÷ ^ ( ), sin, cos, tan, √.`);
  // implicit multiplication: 2x, x(, )(, 2(, )x, x S, 2S, )S, xP, 2P
  s = s.replace(/(\d|x|\)|P)(?=[x(SCTQALNP])/g, '$1*').replace(/(x|\)|P)(?=\d)/g, '$1*');
  // f(x)-style function application: S(…) or S x
  s = s.replace(/([SCTQALN])(?!\()([\d.]*x|[\d.]+|P)/g, '$1($2)');
  // ^ → ** (right associative), with a leading minus kept as -(a**b)
  s = s.replace(/\^/g, '**').replace(/(^|[(*/+-])-(\d+(?:\.\d+)?|x|P)\*\*/g, '$1-1*$2**');
  const js = s.replace(/S\(/g, 'Math.sin(d*').replace(/C\(/g, 'Math.cos(d*').replace(/T\(/g, 'Math.tan(d*').replace(/Q\(/g, 'Math.sqrt(').replace(/A\(/g, 'Math.abs(').replace(/L\(/g, 'Math.log10(').replace(/N\(/g, 'Math.log(').replace(/P/g, 'Math.PI');
  let f;
  try { f = new Function('x', 'd', `"use strict"; return (${js});`); f(1, Math.PI / 180); }
  catch { throw new Error(`I can't read “${expr}”. Check the brackets.`); }
  return { f, name: name.replace(/\s/g, '') || 'y' };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = v => { const r = Math.round(v * 100) / 100; return String(r).replace('-', '−'); };

export function graphDefaults() {
  return { type: 'graph', fns: ['y = 2x + 1'], points: [], xmin: -5, xmax: 5, ymin: -5, ymax: 5, grid: true, labels: true, degrees: false, caption: '', width: 60 };
}

// Returns an SVG string. W×H is fixed (the page scales it); errors are shown on the graph, never thrown.
export function graphSvg(b) {
  const W = 480, H = 480, pad = 28;
  const xmin = +b.xmin, xmax = +b.xmax, ymin = +b.ymin, ymax = +b.ymax;
  const ok = isFinite(xmin) && isFinite(xmax) && isFinite(ymin) && isFinite(ymax) && xmax > xmin && ymax > ymin;
  const [x0, x1, y0, y1] = ok ? [xmin, xmax, ymin, ymax] : [-5, 5, -5, 5];
  const sx = x => pad + (x - x0) / (x1 - x0) * (W - 2 * pad);
  const sy = y => H - pad - (y - y0) / (y1 - y0) * (H - 2 * pad);
  const step = span => { const raw = span / 10; const p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 5, 10].map(m => m * p).find(v => v >= raw) || raw; };
  const xs = step(x1 - x0), ys = step(y1 - y0);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif" font-size="14">`;
  out += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  if (b.grid !== false) {
    for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) out += `<line x1="${sx(x)}" y1="${sy(y0)}" x2="${sx(x)}" y2="${sy(y1)}" stroke="#e3e7e5"/>`;
    for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) out += `<line x1="${sx(x0)}" y1="${sy(y)}" x2="${sx(x1)}" y2="${sy(y)}" stroke="#e3e7e5"/>`;
  }
  // Axes through the origin when it's in view, otherwise along the edge.
  const ax = Math.min(Math.max(0, y0), y1), ay = Math.min(Math.max(0, x0), x1);
  out += `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#222"/></marker></defs>`;
  out += `<line x1="${sx(x0) - 6}" y1="${sy(ax)}" x2="${sx(x1) + 6}" y2="${sy(ax)}" stroke="#222" stroke-width="1.4" marker-end="url(#ar)"/>`;
  out += `<line x1="${sx(ay)}" y1="${sy(y0) + 6}" x2="${sx(ay)}" y2="${sy(y1) - 6}" stroke="#222" stroke-width="1.4" marker-end="url(#ar)"/>`;
  out += `<text x="${sx(x1) + 4}" y="${sy(ax) - 8}" font-style="italic" font-size="14" text-anchor="end">x</text><text x="${sx(ay) + 8}" y="${sy(y1) + 4}" font-style="italic" font-size="14">y</text>`;
  if (b.labels !== false) {
    for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) if (Math.abs(x) > 1e-9) out += `<line x1="${sx(x)}" y1="${sy(ax) - 3}" x2="${sx(x)}" y2="${sy(ax) + 3}" stroke="#222"/><text x="${sx(x)}" y="${sy(ax) + 15}" text-anchor="middle" fill="#444">${nice(x)}</text>`;
    for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) if (Math.abs(y) > 1e-9) out += `<line x1="${sx(ay) - 3}" y1="${sy(y)}" x2="${sx(ay) + 3}" y2="${sy(y)}" stroke="#222"/><text x="${sx(ay) - 6}" y="${sy(y) + 4}" text-anchor="end" fill="#444">${nice(y)}</text>`;
    if (x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0) out += `<text x="${sx(0) - 6}" y="${sy(0) + 15}" text-anchor="end" fill="#444">0</text>`;
  }
  out += `<clipPath id="cp"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}"/></clipPath><g clip-path="url(#cp)">`;
  const dashes = ['', '7 4', '2 3', '10 3 2 3'];
  const errors = [];
  const labelsAt = [];
  (b.fns || []).filter(s => String(s).trim()).forEach((expr, k) => {
    let fn;
    try { fn = compile(expr); } catch (e) { errors.push(e.message); return; }
    const d = (b.degrees || (x1 - x0) > 40) ? Math.PI / 180 : 1; // SA trig graphs are in degrees
    let path = '', pen = false, last = null;
    const N = 600;
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * i / N;
      let y; try { y = fn.f(x, d); } catch { y = NaN; }
      const bad = !isFinite(y) || Math.abs(y) > 1e6 || (last != null && Math.abs(y - last) > (y1 - y0) * 3);
      if (bad) { pen = false; last = isFinite(y) ? y : null; continue; }
      path += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(Math.max(y0 - (y1 - y0), Math.min(y1 + (y1 - y0), y))).toFixed(1)}`;
      pen = true; last = y;
    }
    out += `<path d="${path}" fill="none" stroke="#111" stroke-width="2" stroke-dasharray="${dashes[k % dashes.length]}"/>`;
    // Label the curve near its right end, inside the view.
    // Each curve is labelled at a different place along it so labels don't pile up.
    const startFrac = [0.9, 0.7, 0.5, 0.3][k % 4];
    for (let j = 0; j <= 60; j++) {
      const x = x0 + (x1 - x0) * Math.min(0.97, Math.max(0.03, startFrac + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.012));
      let y; try { y = fn.f(x, d); } catch { y = NaN; }
      if (isFinite(y) && y > y0 + (y1 - y0) * 0.05 && y < y1 - (y1 - y0) * 0.05) {
        let ly = sy(y) - 10;
        while (labelsAt.some(l => Math.abs(l.y - ly) < 16 && Math.abs(l.x - sx(x)) < 60)) ly += 18;
        labelsAt.push({ x: sx(x), y: ly, t: fn.name === 'y' && (b.fns || []).filter(v => String(v).trim()).length > 1 ? String(expr).trim().replace(/\s+/g, ' ') : fn.name }); break;
      }
    }
  });
  (b.points || []).forEach(p => {
    if (!isFinite(+p.x) || !isFinite(+p.y)) return;
    out += `<circle cx="${sx(+p.x)}" cy="${sy(+p.y)}" r="4" fill="#111"/>`;
    if (p.label) out += `<text x="${sx(+p.x) + 7}" y="${sy(+p.y) - 7}" font-weight="bold">${esc(p.label)}</text>`;
  });
  out += '</g>';
  labelsAt.forEach(l => { out += `<text x="${Math.min(W - pad - 4, l.x + 8)}" y="${l.y}" font-style="italic" font-weight="bold" font-size="16" text-anchor="start" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(l.t)}</text>`; });
  if (errors.length) out += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#b0281f" font-size="14">${esc(errors[0]).slice(0, 80)}</text>`;
  if (!ok) out += `<text x="${W / 2}" y="18" text-anchor="middle" fill="#b0281f">Check the axis ranges</text>`;
  return out + '</svg>';
}

// ---------- Drawn diagrams (SVG from the AI or pasted) ----------
// Only plain drawing elements survive: no scripts, links, external pictures or event handlers.
const ALLOWED = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'defs', 'marker', 'title', 'desc', 'clipPath', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'use', 'symbol']);
export function cleanSvg(svg) {
  const doc = new DOMParser().parseFromString(String(svg || ''), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg' || doc.querySelector('parsererror')) return '';
  const walk = el => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.nodeName)) { child.remove(); continue; }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) || v.includes('javascript:') || (n === 'style' && /url\(\s*['"]?(?!#)/.test(v))) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  for (const a of [...root.attributes]) if (a.name.toLowerCase().startsWith('on')) root.removeAttribute(a.name);
  walk(root);
  if (!root.getAttribute('viewBox')) { const w = parseFloat(root.getAttribute('width')) || 400, hh = parseFloat(root.getAttribute('height')) || 300; root.setAttribute('viewBox', `0 0 ${w} ${hh}`); }
  root.removeAttribute('width'); root.removeAttribute('height');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

// SVG → PNG data URL (for Word and PowerPoint).
export function svgToPng(svg, width = 1200) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1]?.split(/[\s,]+/).map(Number) || [0, 0, img.width || 400, img.height || 300];
      const h = Math.round(width * vb[3] / vb[2]);
      const cv = document.createElement('canvas'); cv.width = width; cv.height = h;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, width, h); g.drawImage(img, 0, 0, width, h);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Couldn’t turn the drawing into a picture.')); };
    img.src = url;
  });
}

// Graphs and diagrams become ordinary pictures for export.
export async function rasterise(c) {
  if (!c.blocks?.some(b => b.type === 'graph' || b.type === 'diagram')) return c;
  const copy = JSON.parse(JSON.stringify(c));
  for (let i = 0; i < copy.blocks.length; i++) {
    const b = copy.blocks[i];
    const svg = b.type === 'graph' ? graphSvg(b) : b.type === 'diagram' ? b.svg : null;
    if (svg) copy.blocks[i] = { type: 'image', src: await svgToPng(svg), caption: b.caption || '', width: b.width || 60 };
  }
  return copy;
}
