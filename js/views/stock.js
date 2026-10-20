// Lab stock: chemicals, glassware, equipment and consumables for Physical and Natural Sciences.
// Tracks what's on hand, where it is, when it was bought, when it expires and when to reorder.
import { state, onChange, saveStock, deleteStock, stockById } from '../state.js';
import { connected } from '../school.js';
import { schoolStock } from './schoolui.js';
import { h, icon, toast, confirmBox, modal, download, loadScript, busy, dropZone } from '../ui.js';
import { today, fmt, parse } from '../dates.js';
import { openPrint } from '../exporters.js';

export const AREAS = ['Physics', 'Chemistry', 'Biology', 'General'];
const PHYSICS = /ammeter|voltmeter|multimeter|galvanometer|resistor|rheostat|cell|batter|power supply|wire|crocodile|switch|bulb|lamp holder|magnet|compass|coil|solenoid|spring|newton ?meter|spring balance|trolley|ticker|runway|pulley|lens|mirror|prism|ray box|laser|glass block|tuning fork|slinky|oscilloscope|signal generator|stopwatch|meter ?rule|metre ?rule|vernier|micrometer|pendulum|light gate|ripple tank|electroscope|van de graaff|ohm|capacitor|diode|led\b|motor|generator|transformer|inclined plane|ball bearing/i;
// Physics, Chemistry, Biology or General: set by hand, or guessed from the category and name.
export function areaOf(it) {
  if (AREAS.includes(it.area)) return it.area;
  if (it.category === 'Biological') return 'Biology';
  if (PHYSICS.test(it.name || '')) return 'Physics';
  if (it.category === 'Chemicals' || it.category === 'Glassware') return 'Chemistry';
  return 'General';
}

export const CATEGORIES = ['Chemicals', 'Glassware', 'Equipment', 'Consumables', 'Biological', 'Safety', 'Other'];
export const HAZARDS = [
  { id: '', label: 'None' }, { id: 'flammable', label: 'Flammable' }, { id: 'corrosive', label: 'Corrosive' },
  { id: 'toxic', label: 'Toxic' }, { id: 'oxidiser', label: 'Oxidiser' }, { id: 'irritant', label: 'Irritant / harmful' },
  { id: 'environment', label: 'Harmful to the environment' }, { id: 'gas', label: 'Gas under pressure' },
];
const UNITS = ['', 'g', 'kg', 'mL', 'L', 'items', 'bottles', 'boxes', 'packs', 'sets', 'rolls', 'pairs'];
const SOON = 60; // days: "expires soon"
const hazardLabel = id => HAZARDS.find(x => x.id === id)?.label || '';
const daysTo = d => Math.round((parse(d) - parse(today())) / 864e5);
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtQty = it => it.qty == null || it.qty === '' ? '–' : `${+(+it.qty).toFixed(3)}${it.unit ? ' ' + it.unit : ''}`;

export function stockStatus(it) {
  const out = [];
  if (it.expiry) { const d = daysTo(it.expiry); if (d < 0) out.push('expired'); else if (d <= SOON) out.push('soon'); }
  const q = num(it.qty), m = num(it.min);
  if (q != null && q <= 0) out.push('out');
  else if (q != null && m != null && q <= m) out.push('low');
  return out;
}
export function stockAlerts() {
  const all = state.stock.map(it => ({ it, s: stockStatus(it) })).filter(x => x.s.length);
  return {
    expired: all.filter(x => x.s.includes('expired')).map(x => x.it),
    soon: all.filter(x => x.s.includes('soon')).map(x => x.it).sort((a, b) => a.expiry.localeCompare(b.expiry)),
    low: all.filter(x => x.s.includes('low') || x.s.includes('out')).map(x => x.it),
  };
}

let filter = 'all', area = '', cat = '', query = '', sortBy = 'name', rootEl = null;

let sub = '';
export function renderStock(root, rest = []) {
  rootEl = root;
  sub = rest[0] || '';
  const off = onChange(w => { if (w === 'stock') rerender(); });
  rerender();
  return () => { off(); rootEl = null; };
}
function rerender() {
  if (!rootEl) return;
  const keep = document.activeElement?.dataset?.keep;
  const pos = document.activeElement?.selectionStart;
  rootEl.replaceChildren(view());
  if (keep) { const el = rootEl.querySelector(`[data-keep="${keep}"]`); el?.focus(); if (pos != null) try { el.setSelectionRange(pos, pos); } catch {} }
}

function shown() {
  const q = query.trim().toLowerCase();
  let list = state.stock.filter(it => (!area || areaOf(it) === area) && (!cat || it.category === cat)
    && (!q || [it.name, it.location, it.supplier, it.notes, it.formula].some(x => (x || '').toLowerCase().includes(q))));
  if (filter !== 'all') list = list.filter(it => { const s = stockStatus(it); return filter === 'low' ? s.includes('low') || s.includes('out') : filter === 'expiring' ? s.includes('soon') || s.includes('expired') : filter === 'hazard' ? !!it.hazard : true; });
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    expiry: (a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'),
    location: (a, b) => (a.location || '~').localeCompare(b.location || '~') || a.name.localeCompare(b.name),
    area: (a, b) => AREAS.indexOf(areaOf(a)) - AREAS.indexOf(areaOf(b)) || a.name.localeCompare(b.name),
    category: (a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name),
  }[sortBy];
  return list.sort(by);
}

function view() {
  // Connected to Skool Huis: the school's shared inventory, unless the teacher opens their own list.
  if (connected() && sub !== 'mine') {
    const page = h('div', { class: 'page stock-page' }, h('header', { class: 'page-head' }, h('h1', {}, 'School inventory')));
    schoolStock(page, rerender);
    return page;
  }
  const al = stockAlerts();
  const page = h('div', { class: 'page stock-page' });
  if (connected()) page.append(h('p', {}, h('a', { href: '#stock', class: 'link' }, '‹ School inventory')));
  page.append(h('header', { class: 'page-head' }, h('h1', {}, 'Lab stock'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => editItem() }, icon('plus'), 'Add item'),
      h('button', { class: 'btn ghost', onclick: openImport }, icon('upload'), 'Import list'),
      h('button', { class: 'btn ghost', onclick: e => exportXlsx(e.currentTarget) }, icon('download'), 'Excel'),
      h('button', { class: 'btn ghost', onclick: printSheet }, icon('print'), 'Print stock sheet'))));

  if (!state.stock.length) {
    page.append(h('section', { class: 'card-sec empty-stock' },
      h('h2', {}, 'Keep track of your lab stock'),
      h('p', {}, 'Add chemicals, glassware, equipment and consumables with how much you have, where it is kept, when it was bought and when it expires. Klasboek warns you about expired chemicals and anything running low, here and on the Today page.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => editItem() }, icon('plus'), 'Add your first item'),
        h('button', { class: 'btn ghost', onclick: openImport }, icon('upload'), 'Import an Excel or CSV list'),
        h('button', { class: 'btn ghost', onclick: addStarter }, 'Start with a common Science list'))));
    return page;
  }

  const inArea = it => !area || areaOf(it) === area;
  const counts = Object.fromEntries(AREAS.map(a => [a, state.stock.filter(it => areaOf(it) === a).length]));
  page.append(h('div', { class: 'seg area-tabs', role: 'tablist', 'aria-label': 'Physics or Chemistry' },
    h('button', { role: 'tab', 'aria-selected': String(!area), onclick: () => { area = ''; rerender(); } }, 'All ', h('b', {}, state.stock.length)),
    ...AREAS.filter(a => a === 'Physics' || a === 'Chemistry' || counts[a]).map(a => h('button', { role: 'tab', 'aria-selected': String(area === a), onclick: () => { area = a; rerender(); } }, a + ' ', h('b', {}, counts[a])))));
  const chip = (id, label, n, cls = '') => h('button', { class: 'chip ' + cls, 'aria-pressed': String(filter === id), onclick: () => { filter = filter === id && id !== 'all' ? 'all' : id; rerender(); } }, label, n != null ? h('b', {}, n) : null);
  page.append(h('div', { class: 'stock-chips row wrap' },
    chip('all', 'Everything', state.stock.filter(inArea).length),
    chip('expiring', 'Expired or expiring', al.expired.filter(inArea).length + al.soon.filter(inArea).length, al.expired.some(inArea) ? 'bad' : al.soon.some(inArea) ? 'warn' : ''),
    chip('low', 'Low or out', al.low.filter(inArea).length, al.low.some(inArea) ? 'warn' : ''),
    chip('hazard', 'Hazardous', state.stock.filter(i => i.hazard && inArea(i)).length)));

  page.append(h('div', { class: 'stock-tools row wrap' },
    h('input', { type: 'search', placeholder: 'Search name, place, supplier…', value: query, 'data-keep': 'q', 'aria-label': 'Search stock', oninput: e => { query = e.target.value; rerender(); } }),
    h('select', { 'aria-label': 'Category', onchange: e => { cat = e.target.value; rerender(); } },
      h('option', { value: '' }, 'All categories'), ...CATEGORIES.map(c => h('option', { value: c, selected: c === cat }, c))),
    h('select', { 'aria-label': 'Sort by', onchange: e => { sortBy = e.target.value; rerender(); } },
      ...[['name', 'Sort: name'], ['expiry', 'Sort: expiry date'], ['location', 'Sort: where it is kept'], ['area', 'Sort: Physics / Chemistry'], ['category', 'Sort: category']].map(([v, l]) => h('option', { value: v, selected: v === sortBy }, l)))));

  const list = shown();
  if (!list.length) { page.append(h('p', { class: 'muted' }, 'Nothing matches.')); return page; }
  const table = h('table', { class: 'stock-table' },
    h('thead', {}, h('tr', {}, ...['Item', 'On hand', 'Kept in', 'Bought', 'Expires', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, ...list.map(row)));
  page.append(h('div', { class: 'table-wrap' }, table));
  return page;
}

function row(it) {
  const s = stockStatus(it);
  const exp = it.expiry ? daysTo(it.expiry) : null;
  const expText = it.expiry ? (exp < 0 ? `Expired ${fmt(it.expiry, { day: 'numeric', month: 'short', year: 'numeric' })}` : `${fmt(it.expiry, { day: 'numeric', month: 'short', year: 'numeric' })}${exp <= SOON ? ` · ${exp} day${exp === 1 ? '' : 's'}` : ''}`) : '–';
  const step = async d => {
    const q = num(it.qty) ?? 0;
    const by = it.unit && /^(g|kg|mL|L)$/.test(it.unit) ? null : 1;
    let change = d * (by || 1);
    if (!by) { const v = prompt(d < 0 ? `How much ${it.name} was used (${it.unit})?` : `How much ${it.name} was added (${it.unit})?`); const n = num(v); if (n == null) return; change = d * Math.abs(n); }
    it.qty = Math.max(0, +(q + change).toFixed(3));
    it.log = [...(it.log || []), { date: today(), change }].slice(-40);
    await saveStock(it);
  };
  return h('tr', { class: s.map(x => 'is-' + x).join(' ') },
    h('td', { class: 'st-name' },
      h('button', { class: 'link', onclick: () => editItem(it) }, it.name),
      h('span', { class: 'muted small' }, [area ? '' : areaOf(it), it.category, it.formula, it.concentration].filter(Boolean).join(' · ')),
      it.hazard ? h('span', { class: 'haz', title: 'Hazard' }, '⚠ ' + hazardLabel(it.hazard)) : null),
    h('td', { class: 'st-qty' },
      h('div', { class: 'qty-step' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Use some of ' + it.name, onclick: () => step(-1) }, '−'),
        h('span', {}, fmtQty(it)),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Add more ' + it.name, onclick: () => step(1) }, '+')),
      s.includes('out') ? h('span', { class: 'tag bad' }, 'Out') : s.includes('low') ? h('span', { class: 'tag warn' }, `Low (min ${it.min})`) : null),
    h('td', { class: 'st-loc' }, it.location || h('span', { class: 'muted' }, '–')),
    h('td', { class: 'st-buy' }, it.purchased ? fmt(it.purchased, { day: 'numeric', month: 'short', year: 'numeric' }) : h('span', { class: 'muted' }, '–')),
    h('td', { class: 'st-exp ' + (s.includes('expired') ? 'bad' : s.includes('soon') ? 'warn' : it.expiry ? '' : 'none') }, expText),
    h('td', { class: 'st-act' }, h('button', { class: 'btn ghost sm', onclick: () => editItem(it) }, 'Edit')));
}

// ---------- Add / edit ----------
export function editItem(orig) {
  const it = orig ? structuredClone(orig) : { name: '', area: area || 'Chemistry', category: area === 'Physics' ? 'Equipment' : 'Chemicals', qty: '', unit: 'g', min: '', location: '', purchased: today(), expiry: '', opened: '', supplier: '', cost: '', hazard: '', formula: '', concentration: '', notes: '' };
  const f = (label, input, hint, wide) => h('label', { class: 'field' + (wide ? ' span2' : '') }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const inp = (k, attrs = {}) => h('input', { value: it[k] ?? '', ...attrs, oninput: e => { it[k] = e.target.value; } });
  const sel = (k, opts) => h('select', { onchange: e => { it[k] = e.target.value; } }, ...opts.map(o => typeof o === 'string' ? h('option', { value: o, selected: (it[k] || '') === o }, o || '–') : h('option', { value: o.id, selected: (it[k] || '') === o.id }, o.label)));
  const body = h('div', {},
    h('div', { class: 'form-grid' },
      f('Item', inp('name', { placeholder: 'e.g. Copper(II) sulfate, 250 mL beaker', required: true }), null, true),
      f('Physics or Chemistry', h('select', { onchange: e => { it.area = e.target.value; } }, ...AREAS.map(a => h('option', { value: a, selected: areaOf(it) === a }, a)))),
      f('Category', sel('category', CATEGORIES)),
      f('Hazard', sel('hazard', HAZARDS)),
      f('Formula', inp('formula', { placeholder: 'e.g. CuSO₄·5H₂O' }), 'Optional, for chemicals.'),
      f('Concentration or size', inp('concentration', { placeholder: 'e.g. 1 mol/dm³, 250 mL' })),
      f('On hand', inp('qty', { type: 'number', step: 'any', min: 0, class: 'num' })),
      f('Unit', sel('unit', UNITS)),
      f('Reorder when at or below', inp('min', { type: 'number', step: 'any', min: 0, class: 'num' }), 'Leave empty for no low-stock warning.'),
      f('Kept in', inp('location', { placeholder: 'e.g. Lab 2, cupboard B, shelf 3', list: 'stock-locs' })),
      f('Date bought', inp('purchased', { type: 'date' })),
      f('Expiry date', inp('expiry', { type: 'date' })),
      f('Opened on', inp('opened', { type: 'date' }), 'Some chemicals go off sooner once opened.'),
      f('Supplier', inp('supplier', { list: 'stock-sups' })),
      f('Cost (R)', inp('cost', { type: 'number', step: '0.01', min: 0, class: 'num' })),
      f('Notes', h('textarea', { rows: 2, oninput: e => { it.notes = e.target.value; } }, it.notes || ''), 'Safety notes, practicals it is used for, SDS location…', true)),
    h('datalist', { id: 'stock-locs' }, ...[...new Set(state.stock.map(x => x.location).filter(Boolean))].map(v => h('option', { value: v }))),
    h('datalist', { id: 'stock-sups' }, ...[...new Set(state.stock.map(x => x.supplier).filter(Boolean))].map(v => h('option', { value: v }))),
    orig?.log?.length ? h('details', { class: 'stock-log' }, h('summary', {}, 'Used and added'),
      h('ul', {}, ...orig.log.slice().reverse().map(l => h('li', {}, `${fmt(l.date)}: ${l.change > 0 ? '+' : ''}${l.change}${it.unit ? ' ' + it.unit : ''}`)))) : null,
    h('div', { class: 'row end modal-actions' },
      orig ? h('button', { class: 'btn danger ghost', onclick: async () => { if (!await confirmBox(`Delete ${orig.name} from your stock list?`)) return; m.close(); await deleteStock(orig.id); toast('Deleted.'); } }, icon('trash', 16), 'Delete') : null,
      orig ? h('button', { class: 'btn ghost', onclick: () => { m.close(); const c = structuredClone(orig); delete c.id; delete c.log; c.purchased = today(); c.expiry = ''; editItem(c); } }, icon('copy', 16), 'New batch') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn', onclick: async () => {
        it.name = (it.name || '').trim();
        if (!it.name) { toast('Give the item a name.', 'warn'); return; }
        if (orig && num(orig.qty) !== num(it.qty)) it.log = [...(orig.log || []), { date: today(), change: +((num(it.qty) ?? 0) - (num(orig.qty) ?? 0)).toFixed(3) }].slice(-40);
        await saveStock(it); m.close(); toast(orig ? 'Saved.' : `${it.name} added.`);
      } }, 'Save')));
  const m = modal(orig?.id ? 'Edit stock item' : 'Add stock item', body, { wide: true });
  setTimeout(() => m.el.querySelector('input')?.focus(), 50);
}

// ---------- Starter list ----------
async function addStarter() {
  const starter = [
    ['Copper(II) sulfate', 'Chemicals', 'g', 'irritant', 'CuSO₄·5H₂O'], ['Sodium chloride', 'Chemicals', 'g', '', 'NaCl'],
    ['Hydrochloric acid', 'Chemicals', 'mL', 'corrosive', 'HCl'], ['Sodium hydroxide', 'Chemicals', 'g', 'corrosive', 'NaOH'],
    ['Universal indicator', 'Chemicals', 'mL', 'flammable', ''], ['Phenolphthalein', 'Chemicals', 'mL', 'flammable', ''],
    ['Magnesium ribbon', 'Chemicals', 'g', 'flammable', 'Mg'], ['Iodine solution', 'Chemicals', 'mL', 'irritant', 'I₂/KI'],
    ['Methylated spirits', 'Chemicals', 'L', 'flammable', ''], ['Limewater', 'Chemicals', 'mL', 'irritant', 'Ca(OH)₂'],
    ['Beaker 250 mL', 'Glassware', 'items', '', ''], ['Test tubes', 'Glassware', 'items', '', ''], ['Measuring cylinder 100 mL', 'Glassware', 'items', '', ''],
    ['Bunsen burner', 'Equipment', 'items', '', ''], ['Thermometer', 'Equipment', 'items', '', ''], ['Electronic balance', 'Equipment', 'items', '', ''],
    ['Ammeter', 'Equipment', 'items', '', ''], ['Resistors (assorted)', 'Equipment', 'packs', '', ''], ['Ray box', 'Equipment', 'items', '', ''], ['Bar magnets', 'Equipment', 'pairs', '', ''], ['Spring balance (newton meter)', 'Equipment', 'items', '', ''], ['Voltmeter', 'Equipment', 'items', '', ''], ['Connecting wires', 'Equipment', 'sets', '', ''], ['Cells (1.5 V)', 'Consumables', 'items', '', ''],
    ['Filter paper', 'Consumables', 'packs', '', ''], ['Safety goggles', 'Safety', 'pairs', '', ''], ['Disposable gloves', 'Safety', 'boxes', '', ''],
  ];
  for (const [name, category, unit, hazard, formula] of starter) await saveStock({ name, category, unit, hazard, formula, area: areaOf({ name, category }), qty: '', min: '', location: '', purchased: '', expiry: '', supplier: '', cost: '', notes: '' }, { silent: true });
  rerender(); toast('Added a starter list. Fill in what you have and delete what you don’t use.');
}

// ---------- Import ----------
const COLS = {
  area: /^(area|section|subject|physics ?\/ ?chemistry|discipline)/i, name: /^(item|name|description|chemical|equipment|apparatus)/i, category: /^(category|type|kind)/i, qty: /^(qty|quantity|on ?hand|amount|stock|count)/i,
  unit: /^(unit|units|uom)/i, min: /^(min|minimum|reorder)/i, location: /^(location|kept|store|storage|shelf|cupboard|room)/i,
  purchased: /^(date )?(purchased|bought|received|date)$/i, expiry: /^(expiry|expires|exp|best before|use by)/i, supplier: /^(supplier|vendor|bought from)/i,
  cost: /^(cost|price|amount paid)/i, hazard: /^(hazard|danger|ghs)/i, formula: /^(formula)/i, notes: /^(notes|comment|remarks)/i, opened: /^(opened)/i,
};
function toIso(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{1,2})[-/. ]?(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  const d = new Date(s); return isNaN(d) ? '' : toIso(d);
}
export function rowsToStock(rows) {
  if (!rows.length) return [];
  let hi = rows.findIndex(r => r.some(c => COLS.name.test(String(c || '').trim())));
  if (hi < 0) hi = 0;
  const head = rows[hi].map(c => String(c || '').trim());
  const map = {};
  for (const [k, re] of Object.entries(COLS)) { const i = head.findIndex((c, j) => re.test(c) && !Object.values(map).includes(j)); if (i >= 0) map[k] = i; }
  if (map.name == null) map.name = 0;
  return rows.slice(hi + 1).map(r => {
    const g = k => map[k] == null ? '' : r[map[k]];
    const name = String(g('name') || '').trim(); if (!name) return null;
    let qty = g('qty'), unit = String(g('unit') || '').trim();
    const qm = String(qty ?? '').match(/^\s*([\d.,]+)\s*([a-zA-Z]+)?/); if (qm) { qty = num(qm[1]); if (!unit && qm[2]) unit = qm[2]; }
    const hz = String(g('hazard') || '').toLowerCase();
    const cg = String(g('category') || '').trim();
    const ar = String(g('area') || '').toLowerCase();
    const areaGuess = /phys/.test(ar) ? 'Physics' : /chem/.test(ar) ? 'Chemistry' : /bio|life/.test(ar) ? 'Biology' : /gen/.test(ar) ? 'General' : '';
    return { name, area: areaGuess, category: CATEGORIES.find(c => c.toLowerCase() === cg.toLowerCase()) || (cg ? 'Other' : 'Chemicals'), qty: qty ?? '', unit, min: num(g('min')) ?? '',
      location: String(g('location') || '').trim(), purchased: toIso(g('purchased')), expiry: toIso(g('expiry')), opened: toIso(g('opened')), supplier: String(g('supplier') || '').trim(),
      cost: num(String(g('cost') || '').replace(/[R\s]/g, '')) ?? '', hazard: HAZARDS.find(x => x.id && hz.includes(x.id.slice(0, 5)))?.id || '', formula: String(g('formula') || '').trim(), notes: String(g('notes') || '').trim() };
  }).filter(Boolean);
}
function openImport() {
  const body = h('div', {},
    h('p', {}, 'Upload an Excel or CSV list. Klasboek looks for columns like Item, Quantity, Unit, Location, Date purchased, Expiry, Supplier and Cost. Other columns are ignored.'),
    dropZone({ accept: '.xlsx,.xls,.csv', label: 'Choose a stock list', hint: 'Excel or CSV', onFiles: async ([f]) => {
      try {
        await loadScript('vendor/xlsx.full.min.js');
        const wb = window.XLSX.read(await f.arrayBuffer(), { cellDates: true });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        const items = rowsToStock(rows);
        if (!items.length) { toast('No items found in that file.', 'warn'); return; }
        const existing = new Set(state.stock.map(x => x.name.toLowerCase()));
        const dup = items.filter(x => existing.has(x.name.toLowerCase())).length;
        m.close();
        for (const it of items) await saveStock(it, { silent: true });
        rerender();
        toast(`Imported ${items.length} item${items.length === 1 ? '' : 's'}.${dup ? ` ${dup} already had the same name; they were added as new batches.` : ''}`);
      } catch (e) { toast('Couldn’t read that file: ' + e.message, 'error'); }
    } }));
  const m = modal('Import a stock list', body);
}

// ---------- Export ----------
const HEAD = ['Item', 'Physics / Chemistry', 'Category', 'Formula', 'Concentration / size', 'On hand', 'Unit', 'Reorder at', 'Kept in', 'Date bought', 'Expiry', 'Opened', 'Supplier', 'Cost (R)', 'Hazard', 'Status', 'Notes'];
const statusText = it => stockStatus(it).map(s => ({ expired: 'Expired', soon: 'Expires soon', out: 'Out of stock', low: 'Low' }[s])).join(', ');
const asRow = it => [it.name, areaOf(it), it.category, it.formula || '', it.concentration || '', num(it.qty) ?? '', it.unit || '', num(it.min) ?? '', it.location || '', it.purchased || '', it.expiry || '', it.opened || '', it.supplier || '', num(it.cost) ?? '', hazardLabel(it.hazard), statusText(it), it.notes || ''];
async function exportXlsx(btn) {
  const done = busy(btn, 'Building…');
  try {
    await loadScript('vendor/xlsx.full.min.js');
    const X = window.XLSX;
    const COLS = HEAD.map((t, i) => ({ wch: [28, 12, 12, 14, 16, 9, 7, 9, 22, 11, 11, 11, 18, 9, 16, 14, 30][i] }));
    const sheet = rows => { const ws = X.utils.aoa_to_sheet([HEAD, ...rows.map(asRow)]); ws['!cols'] = COLS; return ws; };
    const byCat = (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    const wb = X.utils.book_new();
    // One sheet per section (Physics, Chemistry…), then everything together.
    for (const a of AREAS) { const rows = state.stock.filter(it => areaOf(it) === a).sort(byCat); if (rows.length) X.utils.book_append_sheet(wb, sheet(rows), a); }
    X.utils.book_append_sheet(wb, sheet(state.stock.slice().sort((a, b) => AREAS.indexOf(areaOf(a)) - AREAS.indexOf(areaOf(b)) || byCat(a, b))), 'All stock');
    const al = stockAlerts();
    const re = [...al.expired, ...al.soon, ...al.low.filter(x => !al.expired.includes(x) && !al.soon.includes(x))];
    if (re.length) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([HEAD, ...re.map(asRow)]), 'Needs attention');
    const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Lab stock ${today()}.xlsx`);
  } catch (e) { toast(e.message, 'error'); } finally { done(); }
}
function printSheet() {
  const s = state.settings;
  const esc = t => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Prints the section that's open (Physics, Chemistry…) or all of them, each section starting on a new page.
  const secs = (area ? [area] : AREAS).map(a => [a, CATEGORIES.map(c => [c, state.stock.filter(x => areaOf(x) === a && x.category === c).sort((p, q) => p.name.localeCompare(q.name))]).filter(([, l]) => l.length)]).filter(([, g]) => g.length);
  const table = (c, l) => `<h3>${esc(c)}</h3><table><thead><tr><th>Item</th><th>On hand</th><th>Counted</th><th>Kept in</th><th>Bought</th><th>Expires</th><th>Hazard</th></tr></thead><tbody>${
      l.map(it => `<tr${stockStatus(it).includes('expired') ? ' style="color:#b00"' : ''}><td>${esc(it.name)}${it.formula ? ` <small>(${esc(it.formula)})</small>` : ''}</td><td>${esc(fmtQty(it))}</td><td style="min-width:5em"></td><td>${esc(it.location)}</td><td>${it.purchased || ''}</td><td>${it.expiry || ''}</td><td>${esc(hazardLabel(it.hazard))}</td></tr>`).join('')}</tbody></table>`;
  const head = `<p class="meta">${esc(s.school || '')}${s.teacherName ? ' · ' + esc(s.teacherName) : ''} · ${fmt(today(), { day: 'numeric', month: 'long', year: 'numeric' })}</p>`;
  const body = secs.map(([a, g], i) => `<section${i ? ' style="page-break-before:always"' : ''}><h1>${esc(a)} stock sheet</h1>${head}${g.map(([c, l]) => table(c, l)).join('')}</section>`).join('');
  if (!body) { toast('Nothing to print in this section.', 'warn'); return; }
  openPrint(body, area ? `${area} stock sheet` : 'Lab stock sheet');
}
