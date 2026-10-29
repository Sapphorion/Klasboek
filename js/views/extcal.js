// Google Calendar and Outlook: send Teacher’s Desk’s calendar out as a file, or bring theirs in.
import { state } from '../state.js';
import { h, icon, modal, toast, dropZone, download, shareFile } from '../ui.js';
import { today, addDays, fmt } from '../dates.js';
import { buildIcs, parseIcs, icsTextsFrom } from '../ics.js';
import { reviewEvents } from './calendar.js';

function ranges() {
  const t = today();
  const terms = (state.settings.terms || []).filter(x => x.start && x.end);
  const cur = terms.find(x => x.end >= t) || terms.at(-1);
  const yearEnd = terms.at(-1)?.end || `${t.slice(0, 4)}-12-31`;
  return [
    { id: 'term', label: cur ? `The rest of this term (to ${fmt(cur.end)})` : 'The next 10 weeks', from: t, to: cur?.end || addDays(t, 70) },
    { id: 'year', label: `The rest of the year (to ${fmt(yearEnd)})`, from: t, to: yearEnd },
    { id: 'all', label: 'The whole school year', from: terms[0]?.start || `${t.slice(0, 4)}-01-01`, to: yearEnd },
  ];
}

export function openExternalCalendars() {
  const R = ranges();
  const opt = { range: 'year', lessons: false };
  const status = h('div', { 'aria-live': 'polite' });
  const m = modal('Google Calendar and Outlook', [], { wide: true });
  const body = m.el.querySelector('.modal-body');

  const make = () => { const r = R.find(x => x.id === opt.range); const { text, count } = buildIcs({ from: r.from, to: r.to, lessons: opt.lessons }); return { blob: new Blob([text], { type: 'text/calendar' }), name: 'Teacher’s Desk.ics', count }; };
  const send = h('section', { class: 'card-sec ext-sec' },
    h('h3', {}, icon('upload', 18), ' Put Teacher’s Desk on your Google or Outlook calendar'),
    h('p', { class: 'muted small' }, 'Tests, exams, holidays, meetings, deadlines and diary entries you put on the calendar. Download the file, then import it once (steps below). When things change, send it again.'),
    h('div', { class: 'row wrap' },
      h('select', { 'aria-label': 'Which dates', onchange: e => opt.range = e.target.value }, R.map(r => h('option', { value: r.id, selected: r.id === opt.range }, r.label))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => opt.lessons = e.target.checked }), 'Include my lessons (at their period times)')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => { const f = make(); if (!f.count) { toast('Nothing on the calendar for those dates yet.', 'warn'); return; } download(f.blob, f.name); toast(`Downloaded ${f.count} item${f.count > 1 ? 's' : ''} as Teacher’s Desk.ics.`); } }, icon('download'), 'Download Teacher’s Desk.ics'),
      navigator.canShare ? h('button', { class: 'btn ghost', onclick: () => { const f = make(); shareFile(f, 'Teacher’s Desk calendar'); } }, icon('paper'), 'Share / open in…') : null),
    h('details', { class: 'ext-steps' }, h('summary', {}, 'How to import it into Google Calendar'),
      h('ol', {},
        h('li', {}, 'On a computer or in the browser (not the app), open ', h('a', { href: 'https://calendar.google.com', target: '_blank', rel: 'noopener' }, 'calendar.google.com'), '.'),
        h('li', {}, 'Best first time: Settings (⚙) → Add calendar → Create new calendar, name it “Teacher’s Desk”. Then you can delete and re-import it cleanly when things change.'),
        h('li', {}, 'Settings (⚙) → Import & export → Import → choose Teacher’s Desk.ics → pick the “Teacher’s Desk” calendar → Import.'),
        h('li', {}, 'It shows on your phone’s Google Calendar app too.'))),
    h('details', { class: 'ext-steps' }, h('summary', {}, 'How to import it into Outlook'),
      h('ol', {},
        h('li', {}, 'Outlook on the web (', h('a', { href: 'https://outlook.live.com/calendar', target: '_blank', rel: 'noopener' }, 'outlook.com'), ' or Microsoft 365): Calendar → Add calendar → Upload from file → choose Teacher’s Desk.ics and a calendar → Import.'),
        h('li', {}, 'Outlook on Windows: File → Open & Export → Import/Export → Import an iCalendar (.ics) file.'),
        h('li', {}, 'On Android or a Fire tablet you can also open the file and choose your calendar app, if it offers to add the events.'))));

  const bring = h('section', { class: 'card-sec ext-sec' },
    h('h3', {}, icon('download', 18), ' Bring your Google or Outlook events into Teacher’s Desk'),
    h('p', { class: 'muted small' }, 'Meetings, sports, functions… You check them before they’re added, and anything marked as no school or a holiday moves your lessons along.'),
    dropZone({ accept: '.ics,.zip,text/calendar', label: 'Upload a calendar file', hint: '.ics, or the .zip Google gives you', onFiles: ([f]) => bringIn(f, status, m) }),
    status,
    h('details', { class: 'ext-steps' }, h('summary', {}, 'How to get the file from Google Calendar'),
      h('ol', {},
        h('li', {}, 'In the browser, open calendar.google.com → Settings (⚙).'),
        h('li', {}, 'Easiest: click your calendar on the left under “Settings for my calendars” → scroll to “Secret address in iCal format” → open that address. A .ics file downloads.'),
        h('li', {}, 'Or: Import & export → Export. You get a .zip; upload it here as it is.'))),
    h('details', { class: 'ext-steps' }, h('summary', {}, 'How to get the file from Outlook'),
      h('ol', {},
        h('li', {}, 'Outlook on the web: Settings → Calendar → Shared calendars → Publish a calendar → choose the calendar and “Can view all details” → Publish.'),
        h('li', {}, 'Open the ICS link it gives you. A .ics file downloads; upload it here.'),
        h('li', {}, 'Outlook on Windows: click the calendar → File → Save Calendar → save as .ics.'))),
    h('p', { class: 'muted small' }, 'Upload again any time: events you already have are left unticked, so nothing doubles up.'));

  body.append(send, bring,
    h('p', { class: 'muted small' }, 'This works with files, so nothing needs a password and it works on any device. A live link that updates by itself needs Teacher’s Desk registered with Google and Microsoft first; ask if you want it set up.'));
}

async function bringIn(file, status, m) {
  status.replaceChildren(h('span', { class: 'spinner' }), ` Reading ${file.name}…`);
  try {
    const R = ranges();
    const from = addDays(today(), -14), to = R[1].to > addDays(today(), 120) ? R[1].to : addDays(today(), 365);
    const src = /google/i.test(file.name) ? 'Google Calendar' : /outlook|calendar\.ics/i.test(file.name) ? 'Outlook' : 'Calendar file';
    const events = [];
    for (const t of await icsTextsFrom(file)) events.push(...parseIcs(t, { from, to, source: src === 'Calendar file' ? 'Calendar file (Google/Outlook)' : src }));
    status.replaceChildren();
    if (!events.length) { status.append(h('p', { class: 'warn' }, `No events between ${fmt(from)} and ${fmt(to)} in that file.`)); return; }
    m.close();
    reviewEvents(file, events, 'external');
  } catch (e) { status.replaceChildren(h('p', { class: 'error' }, e.message)); }
}
