// Builds lesson content. Offline: a structured draft from the ATP (template).
// Online with a key: Claude writes full content in the same shape (see ai.js CONTENT_SCHEMA).
import { state, subjectById, atpById } from './state.js';
import { minutesBetween } from './dates.js';
import { aiLessonContent, aiReady } from './ai.js';
import { nextAssessment } from './events.js';

export const LABELS = {
  English: {
    lessonPlan: 'Lesson plan', worksheet: 'Worksheet', memo: 'Memorandum', subject: 'Subject', grade: 'Grade', cls: 'Class', date: 'Date', duration: 'Duration', teacher: 'Teacher', topic: 'Topic', term: 'Term', week: 'Week',
    objectives: 'Lesson objectives', objIntro: 'By the end of the lesson learners should be able to:', prior: 'Prior knowledge', vocab: 'Key vocabulary', resources: 'Resources', phases: 'Lesson phases', phase: 'Phase', minutes: 'Min', teacherActs: 'Teacher', learnerActs: 'Learners',
    assessment: 'Assessment', differentiation: 'Differentiation', support: 'Support', extension: 'Extension', homework: 'Homework', reflection: 'Reflection (after the lesson)', reflectQ: ['What went well?', 'What would I change?', 'Learners needing follow-up:'],
    name: 'Name', total: 'Total', marks: 'marks', today: 'Today we will', recap: 'Recap', activity: 'Activity', question: 'Question', atpContent: 'ATP content', weekPlan: 'Weekly plan',
  },
  Afrikaans: {
    lessonPlan: 'Lesplan', worksheet: 'Werkkaart', memo: 'Memorandum', subject: 'Vak', grade: 'Graad', cls: 'Klas', date: 'Datum', duration: 'Duur', teacher: 'Onderwyser', topic: 'Onderwerp', term: 'Kwartaal', week: 'Week',
    objectives: 'Lesdoelwitte', objIntro: 'Aan die einde van die les behoort leerders te kan:', prior: 'Voorkennis', vocab: 'Sleutelwoordeskat', resources: 'Hulpbronne', phases: 'Lesfases', phase: 'Fase', minutes: 'Min', teacherActs: 'Onderwyser', learnerActs: 'Leerders',
    assessment: 'Assessering', differentiation: 'Differensiasie', support: 'Ondersteuning', extension: 'Verryking', homework: 'Huiswerk', reflection: 'Refleksie (na die les)', reflectQ: ['Wat het goed gegaan?', 'Wat sal ek verander?', 'Leerders wat opvolg nodig het:'],
    name: 'Naam', total: 'Totaal', marks: 'punte', today: 'Vandag gaan ons', recap: 'Opsomming', activity: 'Aktiwiteit', question: 'Vraag', atpContent: 'JOP-inhoud', weekPlan: 'Weeklikse beplanning',
  },
};
export const labelsFor = subject => LABELS[subject?.language] || LABELS.English;

// Everything a generator needs to know about one scheduled lesson.
export function lessonContext(lesson) {
  const subject = subjectById(lesson.subjectId);
  const atp = atpById(lesson.atpId);
  const period = state.timetable.periods.find(p => p.id === lesson.periodId);
  const minutes = lesson.minutes || minutesBetween(period?.start, period?.end);
  const siblings = atp ? state.lessons.filter(l => l.atpId === atp.id).sort((a, b) => (a.date + a.periodId).localeCompare(b.date + b.periodId)) : [];
  const n = siblings.findIndex(l => l.id === lesson.id) + 1;
  return {
    subject: subject?.name || 'Lesson', grade: subject?.grade || '', language: subject?.language || 'English',
    cls: lesson.cls || '', minutes, topic: lesson.title || atp?.topic || '', details: atp?.details || '',
    term: atp?.term, week: atp?.week, notes: lesson.notes || '',
    lessonOfWeek: siblings.length > 1 && n ? { n, total: siblings.length } : null,
    worksheetMarks: 20,
    upcomingTest: (() => { const e = nextAssessment(lesson.subjectId, lesson.date, 21); return e ? { date: e.date, title: e.title, type: e.type, sameDay: e.date === lesson.date } : null; })(),
  };
}

function split(n, parts) { // minutes for 4 phases
  const raw = parts.map(p => Math.round(n * p));
  raw[raw.length - 1] += n - raw.reduce((a, b) => a + b, 0);
  return raw;
}

export function templateContent(ctx) {
  const L = LABELS[ctx.language] || LABELS.English;
  const af = ctx.language === 'Afrikaans';
  const META = /^(resources|hulpbronne|informal assessment|formal assessment|sba|assessment|assessering|requisite pre-?knowledge|pre-?knowledge|voorkennis)\b[^:]*:\s*/i;
  const all = ctx.details.split('\n').map(s => s.trim()).filter(Boolean);
  const lines = all.filter(l => !META.test(l));
  const extraResources = all.filter(l => /^(resources|hulpbronne)/i.test(l)).map(l => l.replace(META, '')).filter(Boolean);
  const focus = lines.length ? lines : [ctx.topic];
  const [m1, m2, m3, m4] = split(ctx.minutes, [0.15, 0.35, 0.35, 0.15]);
  const objectives = focus.slice(0, 4).map(l => (af ? 'Verduidelik en toepas: ' : 'Explain and apply: ') + l.replace(/[.;:]$/, ''));
  const chunk = (arr, n) => arr.reduce((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);
  const slides = [
    { title: L.today, bullets: objectives.map(o => o.replace(/^(Explain and apply|Verduidelik en toepas): /, '')), notes: af ? 'Stel die doelwitte en skryf dit op die bord.' : 'Share the objectives and write them on the board.' },
    { title: af ? 'Wat weet ons reeds?' : 'What do we already know?', bullets: [af ? `Wat onthou jy van ${ctx.topic}?` : `What do you remember about ${ctx.topic}?`, af ? 'Bespreek met jou maat (2 minute)' : 'Discuss with your partner (2 minutes)'], notes: af ? 'Kort basislynvraag om voorkennis te aktiveer.' : 'Quick baseline question to activate prior knowledge.' },
    ...chunk(focus, 3).map((group, i) => ({ title: chunk(focus, 3).length > 1 ? `${ctx.topic} (${i + 1})` : ctx.topic, bullets: group, notes: af ? 'Verduidelik met ’n uitgewerkte voorbeeld op die bord.' : 'Explain with a worked example on the board.' })),
    { title: L.activity, bullets: [af ? 'Voltooi vrae 1–3 op die werkkaart' : 'Complete questions 1–3 on the worksheet', af ? 'Werk in pare' : 'Work in pairs', `${m3} ${af ? 'minute' : 'minutes'}`], notes: af ? 'Beweeg deur die klas; ondersteun leerders wat sukkel.' : 'Circulate; support learners who are stuck.' },
    { title: L.recap, bullets: focus.slice(0, 3).map(l => (af ? 'Verduidelik: ' : 'Explain: ') + l.replace(/[.;:]$/, '')), notes: af ? 'Uitgangskaartjie: elke leerder beantwoord een vraag.' : 'Exit ticket: each learner answers one question.' },
  ];
  const questions = [];
  focus.slice(0, 5).forEach((l, i) => {
    const short = l.replace(/[.;:]$/, '');
    questions.push({ section: af ? 'Afdeling A: Kennis' : 'Section A: Knowledge', q: (af ? 'Definieer of beskryf: ' : 'Define or describe: ') + short, marks: 2, answer: '', lines: 2 });
    if (i < 3) questions.push({ section: af ? 'Afdeling B: Toepassing' : 'Section B: Application', q: (af ? 'Verduidelik met ’n voorbeeld: ' : 'Explain, using an example: ') + short, marks: 4, answer: '', lines: 4 });
  });
  questions.sort((a, b) => a.section.localeCompare(b.section));
  return {
    source: 'template',
    title: ctx.topic,
    objectives,
    priorKnowledge: '',
    vocabulary: [],
    resources: [...extraResources, af ? 'Bord en kryt/merkers' : 'Board and chalk/markers', L.worksheet],
    phases: [
      { name: af ? 'Inleiding' : 'Introduction', minutes: m1, teacher: af ? `Groet, stel doelwitte. Vra ’n vraag oor ${ctx.topic} om voorkennis te aktiveer.` : `Greet, share the objectives. Ask a question about ${ctx.topic} to activate prior knowledge.`, learners: af ? 'Beantwoord, bespreek met ’n maat.' : 'Answer, discuss with a partner.' },
      { name: af ? 'Onderrig' : 'Development', minutes: m2, teacher: (af ? 'Verduidelik en demonstreer: ' : 'Explain and model: ') + focus.slice(0, 3).join('; '), learners: af ? 'Luister, maak notas, vra vrae.' : 'Listen, take notes, ask questions.' },
      { name: af ? 'Leerderaktiwiteit' : 'Learner activity', minutes: m3, teacher: af ? 'Deel werkkaart uit; beweeg en ondersteun.' : 'Hand out the worksheet; circulate and support.', learners: af ? 'Voltooi die werkkaart in pare.' : 'Complete the worksheet in pairs.' },
      { name: af ? 'Konsolidasie' : 'Consolidation', minutes: m4, teacher: af ? 'Bespreek antwoorde; uitgangskaartjie.' : 'Go through answers; exit ticket.', learners: af ? 'Merk eie werk; beantwoord uitgangsvraag.' : 'Mark own work; answer the exit question.' },
    ],
    assessment: af ? 'Informele assessering: vraag-en-antwoord en werkkaart.' : 'Informal assessment: questioning and worksheet.',
    differentiation: { support: '', extension: '' },
    homework: '',
    slides,
    worksheet: { title: `${ctx.topic}`, instructions: af ? 'Beantwoord al die vrae. Toon alle bewerkings.' : 'Answer all questions. Show all working.', questions },
  };
}

export async function buildContent(lesson, { useAi } = {}) {
  const ctx = lessonContext(lesson);
  if (useAi && aiReady()) {
    const c = await aiLessonContent(ctx);
    return { ...c, source: 'ai', generated: new Date().toISOString() };
  }
  return { ...templateContent(ctx), generated: new Date().toISOString() };
}
