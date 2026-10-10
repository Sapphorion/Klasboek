import { state, onChange, saveSettings, DEFAULT_TERMS, loadState, emit } from '../state.js';
import { h, icon, toast, busy, download, confirmBox } from '../ui.js';
import { MODELS, testKey } from '../ai.js';
import { exportBackup, importBackup } from '../db.js';
import { termWeeks } from '../dates.js';

export function renderSettings(root) {
  const draw = () => root.replaceChildren(view());
  draw();
  return null;
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);

function view() {
  const s = state.settings;
  const page = h('div', { class: 'page settings' }, h('header', { class: 'page-head' }, h('h1', {}, 'Settings')));

  // ---------- You & school ----------
  const logoImg = h('img', { class: 'logo-prev', alt: 'School logo', src: s.logo || '', hidden: !s.logo });
  const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, onchange: async () => {
    const f = logoIn.files[0]; if (!f) return;
    const url = await shrink(f, 300);
    await saveSettings({ logo: url }); logoImg.src = url; logoImg.hidden = false; toast('Logo saved. It appears on documents and slides.');
  } });
  page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'You and your school'), h('p', { class: 'muted small' }, 'Shown on every lesson plan, worksheet, slide deck and report.'),
    h('div', { class: 'form-grid' },
      field('Your name', h('input', { value: s.teacherName, placeholder: 'e.g. Mr S. Botha', onchange: e => saveSettings({ teacherName: e.target.value.trim() }) })),
      field('School', h('input', { value: s.school, placeholder: 'e.g. Walmer High School', onchange: e => saveSettings({ school: e.target.value.trim() }) })),
      field('Footer text', h('input', { value: s.footer, placeholder: 'e.g. Department of Mathematics', onchange: e => saveSettings({ footer: e.target.value.trim() }) })),
      field('Document colour', h('input', { type: 'color', value: s.brandColour, onchange: e => saveSettings({ brandColour: e.target.value }) }), 'Headings, table headers and the slide bar.'),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'School logo'), h('div', { class: 'row' }, logoImg, h('button', { class: 'btn ghost sm', onclick: () => logoIn.click() }, icon('upload', 16), s.logo ? 'Replace' : 'Upload PNG or JPG'), s.logo ? h('button', { class: 'btn ghost sm', onclick: async () => { await saveSettings({ logo: '' }); logoImg.hidden = true; } }, 'Remove') : null, logoIn)),
    )));

  // ---------- Term dates ----------
  const termsBox = h('div', { class: 'terms' });
  const drawTerms = () => termsBox.replaceChildren(...s.terms.map((t, i) => h('div', { class: 'term-row' },
    h('strong', {}, `Term ${i + 1}`),
    h('input', { type: 'date', value: t.start, 'aria-label': `Term ${i + 1} start`, onchange: e => { t.start = e.target.value; saveSettings({ terms: s.terms }); drawTerms(); } }),
    h('span', {}, 'to'),
    h('input', { type: 'date', value: t.end, 'aria-label': `Term ${i + 1} end`, onchange: e => { t.end = e.target.value; saveSettings({ terms: s.terms }); drawTerms(); } }),
    h('span', { class: 'muted small' }, termWeeks(i + 1) ? `${termWeeks(i + 1)} weeks` : ''))));
  drawTerms();
  page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'School calendar'),
    h('p', { class: 'muted small' }, 'Term dates decide which ATP week each calendar week is. Defaults are the public school calendar; change them if your school differs.'),
    h('div', { class: 'row wrap' }, field('Year', h('select', { onchange: e => { const y = +e.target.value; const t = DEFAULT_TERMS[y]; saveSettings({ year: y, terms: t ? t.map(([start, end]) => ({ start, end })) : s.terms }); s.terms = state.settings.terms; drawTerms(); } },
      Object.keys(DEFAULT_TERMS).map(y => h('option', { value: y, selected: +y === s.year }, y))), 'Picking a year loads its public school dates.')),
    termsBox));

  // ---------- AI ----------
  const keyIn = h('input', { type: 'password', value: s.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off', onchange: e => saveSettings({ apiKey: e.target.value.trim() }) });
  const testBtn = h('button', { class: 'btn ghost sm' }, 'Test the key');
  testBtn.onclick = async () => { await saveSettings({ apiKey: keyIn.value.trim() }); const done = busy(testBtn, 'Testing…'); try { const r = await testKey(); toast('Key works: ' + r); } catch (e) { toast(e.message, 'error'); } finally { done(); } };
  page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'AI writing (Claude)'),
    h('p', { class: 'muted small' }, 'AI writes full lesson plans, slides and worksheets with memos, and reads hard-to-parse ATPs and timetable photos. It needs internet and a Claude API key from console.anthropic.com (you pay per use). Without it, templates still work offline.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.aiEnabled, onchange: e => saveSettings({ aiEnabled: e.target.checked }) }), 'Use AI when online'),
    h('div', { class: 'form-grid' },
      field('Claude API key', h('div', { class: 'row' }, keyIn, testBtn), 'Stored only on this device and never included in backups.'),
      field('Model', h('select', { onchange: e => saveSettings({ model: e.target.value }) }, MODELS.map(m => h('option', { value: m.id, selected: m.id === s.model }, m.label)))))));

  // ---------- Backup ----------
  const restoreIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = restoreIn.files[0]; if (!f) return;
    if (!await confirmBox('Restoring replaces everything in Klasboek on this device with the backup.', 'Restore backup')) return;
    try { await importBackup(f); await loadState(); ['settings', 'timetable', 'subjects', 'atp', 'lessons', 'materials', 'moderations', 'events'].forEach(emit); toast('Backup restored.'); location.hash = 'planner'; }
    catch (e) { toast(e.message, 'error'); }
  } });
  const backupBtn = h('button', { class: 'btn' }, icon('download'), 'Download backup');
  backupBtn.onclick = async () => { const done = busy(backupBtn, 'Packing…'); try { download(await exportBackup(), `klasboek-backup-${new Date().toISOString().slice(0, 10)}.json`); } finally { done(); } };
  page.append(h('section', { class: 'card-sec' }, h('h2', {}, 'Backup'),
    h('p', { class: 'muted small' }, 'Everything is saved in this browser on this device. Download a backup regularly (and before clearing your browser), and restore it to move to another device.'),
    h('div', { class: 'row wrap' }, backupBtn, h('button', { class: 'btn ghost', onclick: () => restoreIn.click() }, icon('upload'), 'Restore from backup'), restoreIn)));
  return page;
}

function shrink(file, max) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}
