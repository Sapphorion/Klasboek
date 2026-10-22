// Programme of Assessment: the formal tasks for a subject and grade (term, marks, time, weighting,
// content, cognitive levels, format). Kept on the subject, so it syncs with everything else.
export const TASK_KINDS = [['test', 'Test'], ['exam', 'Exam'], ['practical', 'Practical'], ['investigation', 'Investigation'], ['assignment', 'Assignment'], ['project', 'Project'], ['oral', 'Oral'], ['other', 'Other']];
export const kindLabel = k => (TASK_KINDS.find(x => x[0] === k) || TASK_KINDS.at(-1))[1];
export const poaTasks = s => (s?.poa?.tasks || []).slice().sort((a, b) => (a.term || 0) - (b.term || 0));
export const taskById = (s, id) => (s?.poa?.tasks || []).find(t => t.id === id) || null;
export function taskLine(t) {
  return [t.marks ? `${t.marks} marks` : '', t.minutes ? `${t.minutes} min` : '', t.weight || ''].filter(Boolean).join(' · ');
}
// What the AI is told about the task, word for word from the PoA.
export function describeTask(s, t) {
  const lv = (t.levelPercents || []).length ? `Cognitive levels (lowest first): ${t.levelPercents.join('% / ')}%.` : '';
  return [
    `This is for the Programme of Assessment task "${t.name}" (Term ${t.term}${t.kind ? ', ' + kindLabel(t.kind).toLowerCase() : ''}).`,
    t.marks ? `Total: ${t.marks} marks.` : '', t.minutes ? `Time: ${t.minutes} minutes.` : '', t.weight ? `Weighting: ${t.weight}.` : '',
    (t.topicList || []).length ? `Content it must cover: ${t.topicList.join('; ')}.` : '', lv,
    t.format ? `Format and requirements from the PoA: ${t.format}` : '',
    s?.poa?.general ? `General PoA rules for this subject: ${s.poa.general}` : '',
    'Follow these requirements exactly.',
  ].filter(Boolean).join(' ');
}
