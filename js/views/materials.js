// Library of teaching files stored on the device.
import { state, onChange, addMaterial, deleteMaterial, saveMaterial, subjectById, subjectLabel, lessonById } from '../state.js';
import { h, icon, toast, confirmBox, dropZone, download } from '../ui.js';
import { sizeOf, openLesson } from './lesson.js';
import { fmt } from '../dates.js';

let filter = '', query = '';

export function renderMaterials(root) {
  const draw = () => root.replaceChildren(view());
  const off = onChange(w => { if (['materials', 'subjects', 'lessons'].includes(w)) draw(); });
  draw();
  return off;
}

function view() {
  const page = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', {}, 'Materials'), h('p', { class: 'muted' }, 'Readings, past papers, rubrics and anything else you teach with. Files stay on this device and open offline.')));
  page.append(dropZone({ accept: '*/*', multiple: true, label: 'Add files', hint: 'Drop several at once. Tag them with a subject below.', onFiles: async files => {
    for (const f of files) await addMaterial(f, { subjectId: filter });
    toast(`Added ${files.length} file${files.length > 1 ? 's' : ''}.`);
  } }));
  page.append(h('div', { class: 'row wrap filters' },
    h('input', { type: 'search', placeholder: 'Search files', value: query, 'aria-label': 'Search files', oninput: e => { query = e.target.value; const l = document.querySelector('.mat-list'); l?.replaceWith(listEl()); } }),
    h('select', { 'aria-label': 'Subject', onchange: e => { filter = e.target.value; document.querySelector('.mat-list')?.replaceWith(listEl()); } }, h('option', { value: '' }, 'All subjects'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === filter }, subjectLabel(s))))));
  page.append(listEl());
  return page;
}

function listEl() {
  const items = state.materials.filter(m => (!filter || m.subjectId === filter) && (!query || m.name.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => b.added.localeCompare(a.added));
  if (!items.length) return h('p', { class: 'empty mat-list' }, state.materials.length ? 'No files match.' : 'No files yet. Add the resources you use most.');
  return h('ul', { class: 'mat-list' }, items.map(m => {
    const usedIn = state.lessons.filter(l => l.materialIds?.includes(m.id));
    return h('li', {},
      h('span', { class: 'ext' }, (m.name.split('.').pop() || '').slice(0, 4).toUpperCase()),
      h('div', { class: 'mat-main' },
        h('button', { class: 'link strong', onclick: () => download(m.blob, m.name) }, m.name),
        h('span', { class: 'muted small' }, `${sizeOf(m.size)} · added ${fmt(m.added.slice(0, 10))}`, usedIn.length ? [' · used in ', ...usedIn.slice(0, 3).flatMap((l, i) => [i ? ', ' : '', h('button', { class: 'link', onclick: () => openLesson(l.id) }, l.title)])] : '')),
      h('select', { 'aria-label': 'Subject for ' + m.name, onchange: e => { m.subjectId = e.target.value; saveMaterial(m); } }, h('option', { value: '' }, 'No subject'), state.subjects.map(s => h('option', { value: s.id, selected: s.id === m.subjectId }, subjectLabel(s)))),
      h('button', { class: 'icon-btn', 'aria-label': 'Download ' + m.name, onclick: () => download(m.blob, m.name) }, icon('download', 16)),
      h('button', { class: 'icon-btn', 'aria-label': 'Delete ' + m.name, onclick: async () => { if (await confirmBox(`Delete ${m.name}${usedIn.length ? ` (attached to ${usedIn.length} lesson${usedIn.length > 1 ? 's' : ''})` : ''}?`)) deleteMaterial(m.id); } }, icon('trash', 16)));
  }));
}
