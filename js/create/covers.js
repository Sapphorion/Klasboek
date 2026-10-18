// The school's own cover sheet: upload it once (PDF, photo or picture), mark where the details go,
// and tests and worksheets get it as their first page, filled in.
import { state, saveSettings, subjectById } from '../state.js';
import { h, icon, modal, toast, confirmBox, dropZone } from '../ui.js';
import { getPdfjs } from '../importers.js';
import { totalMarks } from './model.js';
import { uid } from '../db.js';

export const FIELDS = [
  ['title', 'Title'], ['subject', 'Subject'], ['grade', 'Grade'], ['marks', 'Marks'], ['time', 'Time'],
  ['date', 'Date'], ['teacher', 'Teacher / examiner'], ['school', 'School'], ['term', 'Term'], ['year', 'Year'],
  ['instructions', 'Instructions'],
];
const BLOCK = new Set(['instructions']); // a wrapped box rather than one line
// The instructions on the cover: the test's own, or the cover's standard ones when the test has none.
export function coverInstructions(cover, c) {
  const own = (c.meta?.instructions || []).filter(Boolean);
  return own.length ? own : String(cover?.instructions || '').split('\n').map(t => t.trim()).filter(Boolean);
}
export const coverHasInstructions = cover => !!cover?.fields?.some(f => f.key === 'instructions');
const fieldLabel = k => FIELDS.find(f => f[0] === k)?.[1] || k;

export const covers = () => state.settings.covers || [];
export const coverById = id => covers().find(c => c.id === id);
async function saveCovers(list, patch = {}) { await saveSettings({ covers: list, ...patch }); }

export function fieldValue(key, c) {
  const subj = subjectById(c.subjectId);
  const term = (state.settings.terms || []).findIndex(t => t.start && t.end && t.start <= (c.date || new Date().toISOString().slice(0, 10)) && (c.date || new Date().toISOString().slice(0, 10)) <= t.end);
  switch (key) {
    case 'title': return c.title || '';
    case 'subject': return subj?.name || '';
    case 'grade': return c.grade || subj?.grade || '';
    case 'marks': return c.blocks ? String(totalMarks(c.blocks)) : '';
    case 'time': return c.meta?.time ? `${c.meta.time} minutes` : '';
    case 'date': return c.meta?.date ? new Date(c.meta.date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    case 'teacher': return state.settings.teacherName || '';
    case 'school': return state.settings.school || '';
    case 'term': return term >= 0 ? `Term ${term + 1}` : '';
    case 'year': return String(state.settings.year || new Date().getFullYear());
    default: return '';
  }
}
const SAMPLE = { title: 'Term 4 Controlled Test', subjectId: '', grade: '10', meta: { time: 60, instructions: [] }, blocks: [{ type: 'question', marks: 50 }] };

// ---------- Turning the upload into a page picture ----------
export async function fileToPage(file) {
  const name = file.name.toLowerCase();
  if (/\.(docx?|odt)$/.test(name)) throw new Error('Word files can’t be shown as a picture here. In Word choose File › Save as › PDF, then upload the PDF. A photo or screenshot works too.');
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const lib = await getPdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 1240 / v1.width });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { src: cv.toDataURL('image/jpeg', 0.9), w: cv.width, h: cv.height, pages: doc.numPages };
  }
  if (!file.type.startsWith('image/')) throw new Error('Upload a PDF, a photo or a picture of the cover sheet.');
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1240 / img.width);
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src); res({ src: cv.toDataURL('image/jpeg', 0.9), w: cv.width, h: cv.height, pages: 1 });
    };
    img.onerror = () => rej(new Error('Could not open that picture.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Showing it, filled in ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export function coverHtml(cover, c, { editing = false } = {}) {
  const spans = (cover.fields || []).map((f, i) => {
    if (BLOCK.has(f.key)) {
      const list = coverInstructions(cover, c);
      const items = list.length ? list : editing ? ['[The test’s instructions go here]'] : [];
      const style = `left:${f.x}%;top:${f.y}%;width:${f.w || 80}%;font-size:${f.size || 1.8}cqw;font-weight:${f.bold === true ? 700 : 400}`;
      return `<div class="uc-f uc-block${editing ? ' ed' : ''}" data-f="${i}" style="${style}">${items.length && f.heading !== false ? '<b class="uc-h">Instructions</b>' : ''}<ol>${items.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>`;
    }
    const val = fieldValue(f.key, c) || (editing ? `[${fieldLabel(f.key)}]` : '');
    return `<span class="uc-f${editing ? ' ed' : ''}" data-f="${i}" style="left:${f.x}%;top:${f.y}%;font-size:${f.size || 2.1}cqw;font-weight:${f.bold === false ? 400 : 700}">${esc(val)}</span>`;
  }).join('');
  return `<div class="ucover" style="aspect-ratio:${cover.w}/${cover.h}"><img src="${cover.src}" alt="">${spans}</div>`;
}

// Numbered, wrapped instructions drawn onto the cover picture (matches the on-screen box).
function drawBlock(g, cover, f, items) {
  if (!items.length) return;
  const px = Math.round((f.size || 1.8) / 100 * cover.w), lh = px * 1.35;
  const x0 = f.x / 100 * cover.w, maxW = (f.w || 80) / 100 * cover.w, indent = px * 1.6;
  let y = f.y / 100 * cover.h + px / 2;
  g.textBaseline = 'middle';
  if (f.heading !== false) { g.font = `700 ${px}px Arial, Helvetica, sans-serif`; g.fillText('Instructions', x0, y); y += lh * 1.15; }
  g.font = `${f.bold === true ? 700 : 400} ${px}px Arial, Helvetica, sans-serif`;
  items.forEach((t, n) => {
    g.fillText(`${n + 1}.`, x0, y);
    let line = '';
    for (const w of String(t).split(/\s+/)) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW - indent && line) { g.fillText(line, x0 + indent, y); y += lh; line = w; } else line = test;
    }
    if (line) { g.fillText(line, x0 + indent, y); y += lh; }
    y += lh * .2;
  });
}

// A flat picture of the filled-in cover, for Word.
export function coverPng(cover, c) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = cover.w; cv.height = cover.h;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cover.w, cover.h);
      g.fillStyle = '#111'; g.textBaseline = 'middle';
      for (const f of cover.fields || []) {
        if (BLOCK.has(f.key)) { drawBlock(g, cover, f, coverInstructions(cover, c)); continue; }
        const val = fieldValue(f.key, c); if (!val) continue;
        g.font = `${f.bold === false ? 400 : 700} ${Math.round((f.size || 2.1) / 100 * cover.w)}px Arial, Helvetica, sans-serif`;
        g.fillText(val, f.x / 100 * cover.w, f.y / 100 * cover.h);
      }
      res(cv.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => rej(new Error('Couldn’t prepare the cover sheet.'));
    img.src = cover.src;
  });
}

// ---------- Managing cover sheets ----------
export function coversSection(onChange = () => {}) {
  const sec = h('section', { class: 'card-sec covers-sec' });
  const draw = () => {
    const list = covers();
    sec.replaceChildren(
      h('div', { class: 'row between wrap' }, h('h2', {}, 'Cover sheets'),
        h('button', { class: 'btn', onclick: () => openCoverEditor(null, () => { draw(); onChange(); }) }, icon('upload'), 'Upload a cover sheet')),
      h('p', { class: 'muted small' }, 'Upload your school’s cover page (PDF, photo or picture), show where the subject, grade, marks and so on go, and tests start with it, filled in.'),
      list.length ? h('div', { class: 'cover-list' }, list.map(cv => h('div', { class: 'cover-item' },
        h('button', { class: 'cover-thumb', 'aria-label': 'Edit ' + cv.name, onclick: () => openCoverEditor(cv, () => { draw(); onChange(); }) }, h('img', { src: cv.src, alt: '' })),
        h('strong', {}, cv.name),
        state.settings.defaultCover === cv.id ? h('span', { class: 'badge' }, 'Default for tests') : h('button', { class: 'link small', onclick: async () => { await saveSettings({ defaultCover: cv.id }); draw(); toast(`New tests start with “${cv.name}”.`); } }, 'Make default'),
        h('button', { class: 'link small danger', onclick: async () => { if (!await confirmBox(`Delete the cover sheet “${cv.name}”?`)) return; await saveCovers(covers().filter(x => x.id !== cv.id), state.settings.defaultCover === cv.id ? { defaultCover: '' } : {}); draw(); onChange(); } }, 'Delete'))))
        : null);
  };
  draw();
  return sec;
}

export function openCoverEditor(existing, done = () => {}) {
  const cv = existing ? JSON.parse(JSON.stringify(existing)) : { id: '', name: 'School cover sheet', src: '', w: 0, h: 0, fields: [] };
  const body = h('div', { class: 'cover-editor' });
  const m = modal(existing ? 'Edit cover sheet' : 'Upload a cover sheet', body, { wide: true });
  let sel = -1, redrawPage = () => {};
  const draw = () => {
    if (!cv.src) {
      const status = h('div', { 'aria-live': 'polite' });
      body.replaceChildren(
        dropZone({ accept: '.pdf,image/*', label: 'Upload your cover sheet', hint: 'PDF (first page is used), photo or screenshot. For Word, save it as PDF first.', onFiles: async ([file]) => {
          status.replaceChildren(h('span', { class: 'spinner' }), ' Reading it…');
          try { Object.assign(cv, await fileToPage(file)); if (cv.name === 'School cover sheet') cv.name = file.name.replace(/\.[^.]+$/, ''); draw(); }
          catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
        } }), status);
      return;
    }
    const page = h('div', { class: 'uc-stage', html: coverHtml(cv, SAMPLE, { editing: true }) });
    const box = page.firstChild;
    // Redraw with the new instructions, keeping the cursor in the box being typed in.
    redrawPage = () => { const a = document.activeElement, pos = a?.selectionStart; draw(); const t = body.querySelector('.uc-fieldbar textarea'); if (t && a?.tagName === 'TEXTAREA') { t.focus(); t.setSelectionRange(pos, pos); } };
    // Drag fields to where they belong.
    box.querySelectorAll('.uc-f').forEach(el => {
      const i = +el.dataset.f;
      if (i === sel) el.classList.add('sel');
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); sel = i; el.setPointerCapture(e.pointerId);
        box.querySelectorAll('.uc-f').forEach(x => x.classList.toggle('sel', x === el));
        drawFieldBar();
        const r = box.getBoundingClientRect();
        const off = { x: e.clientX - el.getBoundingClientRect().left, y: e.clientY - (el.getBoundingClientRect().top + el.offsetHeight / 2) };
        const mv = ev => {
          cv.fields[i].x = Math.max(0, Math.min(98, (ev.clientX - off.x - r.left) / r.width * 100));
          cv.fields[i].y = Math.max(1, Math.min(99, (ev.clientY - off.y - r.top) / r.height * 100));
          el.style.left = cv.fields[i].x + '%'; el.style.top = cv.fields[i].y + '%';
        };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
    });
    const fieldBar = h('div', { class: 'uc-fieldbar' });
    const drawFieldBar = () => {
      const f = cv.fields[sel];
      if (f && BLOCK.has(f.key)) {
        fieldBar.replaceChildren(h('div', { class: 'stack' },
          h('div', { class: 'row wrap' }, h('strong', {}, 'Instructions'),
            h('label', { class: 'inline' }, 'Size', h('select', { onchange: e => { f.size = +e.target.value; draw(); } }, [[1.4, 'Small'], [1.8, 'Normal'], [2.2, 'Large']].map(([v, l]) => h('option', { value: v, selected: (f.size || 1.8) === v }, l)))),
            h('label', { class: 'inline' }, 'Width', h('select', { onchange: e => { f.w = +e.target.value; draw(); } }, [[45, 'Half the page'], [65, 'Two thirds'], [84, 'Most of the page'], [92, 'Full width']].map(([v, l]) => h('option', { value: v, selected: (f.w || 80) === v }, l)))),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.heading !== false, onchange: e => { f.heading = e.target.checked; draw(); } }), 'Show the heading “Instructions”'),
            h('button', { class: 'link small danger', onclick: () => { cv.fields.splice(sel, 1); sel = -1; draw(); } }, 'Remove')),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Standard instructions for this cover (one per line)'),
            h('textarea', { rows: 4, placeholder: 'e.g. Answer ALL the questions.\nWrite neatly in blue or black pen.\nNon-programmable calculators may be used.', oninput: e => { cv.instructions = e.target.value; clearTimeout(drawFieldBar.t); drawFieldBar.t = setTimeout(redrawPage, 400); } }, cv.instructions || '')),
          h('p', { class: 'hint' }, 'Tests use these when they don’t have their own. A test’s own instructions (Page setup › test details) always win. The test won’t repeat them on the next page.')));
        return;
      }
      fieldBar.replaceChildren(f ? h('div', { class: 'row wrap' },
        h('strong', {}, fieldLabel(f.key)),
        h('label', { class: 'inline' }, 'Size', h('select', { onchange: e => { f.size = +e.target.value; draw(); } }, [[1.5, 'Small'], [2.1, 'Normal'], [2.8, 'Large'], [3.8, 'Very large']].map(([v, l]) => h('option', { value: v, selected: (f.size || 2.1) === v }, l)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.bold !== false, onchange: e => { f.bold = e.target.checked; draw(); } }), 'Bold'),
        h('button', { class: 'link small danger', onclick: () => { cv.fields.splice(sel, 1); sel = -1; draw(); } }, 'Remove')) : h('p', { class: 'muted small' }, 'Tap a detail on the page to change its size, or drag it into place.'));
    };
    drawFieldBar();
    const used = new Set(cv.fields.map(f => f.key));
    body.replaceChildren(
      h('div', { class: 'cover-ed-grid' },
        h('div', {}, page, h('p', { class: 'muted small' }, 'Details show sample values here. On a real test they’re filled in from the test.')),
        h('div', { class: 'stack' },
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Name'), h('input', { value: cv.name, oninput: e => cv.name = e.target.value })),
          h('span', { class: 'lbl' }, 'Add details to the page'),
          h('div', { class: 'chips' }, FIELDS.map(([k, l]) => h('button', { class: 'chip' + (used.has(k) ? ' on' : ''), onclick: () => { if (BLOCK.has(k) && used.has(k)) return; cv.fields.push(BLOCK.has(k) ? { key: k, x: 8, y: 72, w: 84, size: 1.8, bold: false, heading: true } : { key: k, x: 40, y: 30 + (cv.fields.length % 10) * 5, size: k === 'title' ? 2.8 : 2.1, bold: true }); sel = cv.fields.length - 1; draw(); } }, '+ ' + l))),
          h('p', { class: 'hint' }, 'Then drag each one onto the blank line it belongs on. Leave out anything learners fill in themselves, like their name.'),
          fieldBar,
          h('button', { class: 'link small', onclick: () => { cv.src = ''; draw(); } }, 'Use a different file'))),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          const list = covers().slice();
          if (!cv.id) { cv.id = uid('cov_'); list.push(cv); } else list[list.findIndex(x => x.id === cv.id)] = cv;
          await saveCovers(list, state.settings.defaultCover ? {} : { defaultCover: cv.id });
          m.close(); toast(`Cover sheet saved.${state.settings.defaultCover === cv.id ? ' New tests will start with it.' : ''}`); done(cv);
        } }, 'Save cover sheet')));
  };
  draw();
}

// For Word: the filled-in cover as a picture on the material copy.
export async function withCover(c) {
  const cv = typeof c.design?.cover === 'string' ? coverById(c.design.cover) : null;
  if (!cv) return c;
  return { ...c, coverPng: await coverPng(cv, c), coverRatio: cv.h / cv.w, coverInstr: coverHasInstructions(cv) };
}
