import { state } from './state.js';
// Match a lesson's ATP topic to the Siyavula open textbook chapter for that subject and grade.
import { SIYAVULA_BOOKS } from './siyavula-data.js';

const BASE = 'https://www.siyavula.com/read/za/';
const SUBJECT = {
  'mathematics': 'mathematics', 'maths': 'mathematics', 'wiskunde': 'mathematics', 'math': 'mathematics',
  'physical sciences': 'physical sciences', 'physical science': 'physical sciences', 'fisiese wetenskappe': 'physical sciences',
  'life sciences': 'life sciences', 'life science': 'life sciences', 'lewenswetenskappe': 'life sciences',
  'natural sciences': 'natural sciences', 'natural science': 'natural sciences', 'natuurwetenskappe': 'natural sciences',
  'mathematical literacy': 'mathematical literacy', 'maths literacy': 'mathematical literacy', 'wiskundige geletterdheid': 'mathematical literacy',
};
const STOP = new Set('the and of a an to in on for with its their what how why is are by from using use part revision introduction grade term week lesson'.split(' '));
const words = t => String(t || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''));

export function bookFor(subject) {
  if (!subject) return null;
  const key = SUBJECT[String(subject.name || '').trim().toLowerCase()];
  if (!key || !subject.grade) return null;
  const b = SIYAVULA_BOOKS[`${key}|${subject.grade}`];
  return b ? { ...b, url: BASE + b.ch[0][2].split('/').slice(0, 2).join('/') } : null;
}

export const chapterUrl = ch => BASE + ch[2];
const chapterOf = (book, path) => book.ch.find(c => c[2] === path);

// Best chapter (and the sections that fit best) for a topic; null when nothing matches.
export function siyavulaFor(subject, topic, details = '', chosenPath = '') {
  if (state.settings?.edition === 'uni') return null; // school textbooks only
  const book = bookFor(subject);
  if (!book) return null;
  const pack = (c, score) => {
    const want = new Set(words(topic + ' ' + details));
    const secs = c[3].split(' ; ').filter(s => s && s !== '(none)');
    const ranked = secs.map(s => ({ s, n: words(s).filter(w => want.has(w)).length })).filter(x => x.n).sort((a, b) => b.n - a.n).map(x => x.s);
    return { book: book.title, bookUrl: book.url, chapter: `Chapter ${c[0]}: ${c[1]}`, title: c[1], path: c[2], url: chapterUrl(c), sections: secs, focus: ranked.slice(0, 3), score, chosen: !!chosenPath };
  };
  if (chosenPath) { const c = chapterOf(book, chosenPath); if (c) return pack(c, 99); }
  const tw = words(topic), dw = words(details);
  if (!tw.length && !dw.length) return null;
  let best = null, bestScore = 0;
  for (const c of book.ch) {
    const cw = new Set(words(c[1])), sw = new Set(words(c[3]));
    let sc = 0;
    for (const w of tw) { if (cw.has(w)) sc += 4; else if (sw.has(w)) sc += 1.5; }
    for (const w of dw) { if (cw.has(w)) sc += 1; else if (sw.has(w)) sc += .5; }
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best && bestScore >= 2 ? pack(best, bestScore) : null;
}

export const chaptersOf = subject => bookFor(subject)?.ch || [];
