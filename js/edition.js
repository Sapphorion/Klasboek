// Teacher’s Desk for schools, or for university lecturers. The lecturer edition shows only the pages a lecturer
// needs (with Attendance) and speaks university: modules, lectures, students, year of study.
import { state } from './state.js';

export const isUni = () => state.settings.edition === 'uni';

// Words on screen, school → university. Longer phrases first so they win over single words.
const UNI = [
  [/Subjects & ATPs/g, 'Modules & outlines'],
  [/Annual Teaching Plans?/g, 'course outline'],
  [/\bATPs\b/g, 'course outlines'], [/\bATP\b/g, 'course outline'],
  [/\bSchool calendar\b/g, 'Academic calendar'], [/\bschool calendar\b/g, 'academic calendar'],
  [/\bSchool holiday\b/g, 'Recess'], [/\bschool holiday\b/g, 'recess'],
  [/\bno school\b/g, 'no lectures'], [/\bNo school\b/g, 'No lectures'],
  [/\byour school’s\b/g, 'your university’s'], [/\bthe school’s\b/g, 'the university’s'],
  [/\bYou and your school\b/g, 'You and your university'],
  [/^School$/g, 'University'], [/\bSchool logo\b/g, 'University logo'], [/e\.g\. Walmer High School/g, 'e.g. Nelson Mandela University'], [/\bschool name\b/g, 'university name'],
  [/\bschool week\b/g, 'teaching week'], [/\bschool day\b/g, 'lecture day'], [/\bschool year\b/g, 'academic year'], [/\bSchool year\b/g, 'Academic year'], [/\bSchool years\b/g, 'Academic years'],
  [/\bSubjects\b/g, 'Modules'], [/\bsubjects\b/g, 'modules'], [/\bSubject\b/g, 'Module'], [/\bsubject\b/g, 'module'],
  [/\bGrades\b/g, 'Years'], [/\bgrades\b/g, 'years'], [/\bGrade\b/g, 'Year'], [/\bgrade\b/g, 'year'], [/\bGr (?=\d)/g, 'Yr '],
  [/\bLearners\b/g, 'Students'], [/\blearners\b/g, 'students'], [/\bLearner\b/g, 'Student'], [/\blearner\b/g, 'student'],
  [/\bTeachers\b/g, 'Lecturers'], [/\bteachers\b/g, 'lecturers'], [/\bTeacher\b/g, 'Lecturer'], [/\bteacher\b/g, 'lecturer'],
  [/\bLesson plans\b/g, 'Lecture plans'], [/\blesson plans\b/g, 'lecture plans'], [/\bLesson plan\b/g, 'Lecture plan'], [/\blesson plan\b/g, 'lecture plan'],
  [/\bLessons\b/g, 'Lectures'], [/\blessons\b/g, 'lectures'], [/\bLesson\b/g, 'Lecture'], [/\blesson\b/g, 'lecture'],
  [/\bclassroom\b/g, 'lecture hall'], [/\bteaching time\b/g, 'lecture time'],
];
export function uniText(t) { let s = String(t); for (const [re, to] of UNI) s = s.replace(re, to); return s; }

// Keep the page in university words while the lecturer edition is on. Documents, typed text and
// the attendance pages are left exactly as they are.
const SKIP = 'textarea, input, select, code, pre, iframe, [data-raw], [contenteditable], .doc-preview, .preview-paper, .school-pv, .slide-preview';
let observer = null;
function fixNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement; if (!p || p.closest(SKIP)) return;
    const v = n.nodeValue; if (!v || !/[A-Za-z]{2}/.test(v)) return;
    const u = uniText(v); if (u !== v) n.nodeValue = u;
    return;
  }
  if (n.nodeType !== 1 || n.closest?.(SKIP) && !n.matches?.('input, textarea')) return;
  for (const a of ['placeholder', 'title', 'aria-label']) { const v = n.getAttribute?.(a); if (v) { const u = uniText(v); if (u !== v) n.setAttribute(a, u); } }
  if (n.matches?.(SKIP)) return;
  for (const c of n.childNodes) fixNode(c);
}
export function applyEdition() {
  document.documentElement.dataset.edition = isUni() ? 'uni' : 'school';
  if (isUni() && !observer) {
    observer = new MutationObserver(list => {
      observer.disconnect();
      for (const m of list) { if (m.type === 'characterData') fixNode(m.target); else m.addedNodes.forEach(fixNode); }
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    fixNode(document.body);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  } else if (!isUni() && observer) { observer.disconnect(); observer = null; }
}

// What the AI is told, for a university module instead of a school class.
export function uniPrompt(text) {
  if (!isUni() || typeof text !== 'string') return text;
  return text
    .replace(/South African teacher/g, 'South African university lecturer')
    .replace(/CAPS-aligned/g, 'university-level, aligned to the module outcomes')
    .replace(/follow CAPS cognitive levels \(mix of knowledge, routine, complex\)/g, 'use a mix of cognitive levels (recall, application, analysis and evaluation)')
    .replace(/CAPS cognitive levels/g, 'cognitive levels (Bloom)')
    .replace(/a real classroom of 30-45 learners with limited resources/g, 'a real lecture with 50 to 300 undergraduate students')
    .replace(/South African CAPS Annual Teaching Plans \(ATPs\)/g, 'university module outlines and study guides')
    .replace(/\bATP content\b/g, 'Course outline content').replace(/\bATP\b/g, 'course outline')
    .replace(/\blearner notes\b/g, 'student notes').replace(/\blearners\b/g, 'students').replace(/\blearner\b/g, 'student')
    .replace(/\bclassroom\b/g, 'lecture').replace(/\bthe back of (the|a) class\b/g, 'the back of a lecture hall')
    .replace(/^Grade: /gm, 'Year of study (university): ').replace(/\bGrade: /g, 'Year of study (university): ')
    .replace(/Pitch language and difficulty at the grade given\./g, 'Pitch it at undergraduate level for the year of study given.')
    .replace(/at the right level for the grade/g, 'at the right level for the year of study');
}
export const UNI_NOTE = ' This is for a university module, not a school: write for undergraduate students at the year of study given, and do not mention CAPS, ATPs, grades or learners.';
