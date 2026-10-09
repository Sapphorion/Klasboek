// Moderation sampling and checklists. Pure functions: no DOM, easy to test.

// CAPS 7-point achievement scale.
export const LEVELS = [
  { level: 1, min: 0, max: 29, label: 'Not achieved' },
  { level: 2, min: 30, max: 39, label: 'Elementary' },
  { level: 3, min: 40, max: 49, label: 'Moderate' },
  { level: 4, min: 50, max: 59, label: 'Adequate' },
  { level: 5, min: 60, max: 69, label: 'Substantial' },
  { level: 6, min: 70, max: 79, label: 'Meritorious' },
  { level: 7, min: 80, max: 100, label: 'Outstanding' },
];
export const levelOf = pct => (pct == null ? null : LEVELS.find(l => Math.floor(pct) >= l.min && Math.floor(pct) <= l.max)?.level ?? (pct > 100 ? 7 : 1));

export const DEFAULT_FILE_CHECKLIST = [
  'Teacher’s personal timetable and subject allocation',
  'Annual Teaching Plan (ATP) and tracker up to date',
  'Programme of Assessment (PoA) for the year',
  'Lesson planning up to date for the term',
  'Formal assessment tasks with memoranda / rubrics',
  'Cognitive level analysis grid for each formal task',
  'Evidence of pre-moderation of tasks (signed before writing)',
  'Mark sheets complete, dated and signed',
  'Marks on SA-SAMS agree with the mark sheets',
  'Records of absent learners and missed tasks, with evidence',
  'Analysis of results with an intervention / improvement plan',
  'Evidence of informal assessment',
  'Previous moderation reports and evidence of follow-up',
];

export const DEFAULT_SCRIPT_CHECKLIST = [
  'Task covers the ATP content for the term',
  'Cognitive levels are appropriate for the grade',
  'Marking follows the memorandum / rubric consistently',
  'Marks are clearly allocated per question',
  'Sub-totals and totals are added correctly',
  'Totals are transferred correctly to the mark sheet',
  'Memo changes (if any) were applied to all scripts',
  'Constructive feedback is given to learners',
  'Marking is fair across the range of learner responses',
];

// Seeded random so a sample can be re-created exactly from its seed.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}

/**
 * Choose learners for moderation.
 * learners: [{ name, mark }] — mark is a number or null (absent / not submitted).
 * opts: { total, percent=10, min=5, borderline=30, seed }
 * Returns the learners with { pct, level, sampled, reason } added, plus counts.
 */
export function selectSample(learners, { total, percent = 10, min = 5, borderline = 30, seed = Date.now() } = {}) {
  const rand = rng(seed);
  const rows = learners.map((l, idx) => {
    const pct = (l.mark == null || !total) ? null : Math.round(l.mark / total * 1000) / 10;
    return { ...l, idx, pct, level: levelOf(pct), sampled: false, reason: '' };
  });
  const marked = rows.filter(r => r.pct != null);
  const target = Math.min(marked.length, Math.max(min, Math.ceil(marked.length * percent / 100)));
  const pick = (r, reason) => { if (r && !r.sampled) { r.sampled = true; r.reason = reason; return true; } return false; };
  const count = () => marked.filter(r => r.sampled).length;

  if (marked.length) {
    const byPct = [...marked].sort((a, b) => a.pct - b.pct || a.idx - b.idx);
    // 1. The extremes and the pass/fail boundary are always checked.
    pick(byPct.at(-1), 'Highest mark');
    if (count() < target) pick(byPct[0], 'Lowest mark');
    const below = byPct.filter(r => r.pct < borderline).at(-1);
    const above = byPct.find(r => r.pct >= borderline);
    if (count() < target && below) pick(below, `Just below ${borderline}%`);
    if (count() < target && above) pick(above, `Just at/above ${borderline}%`);

    // 2. Spread the rest across the achievement levels in proportion to class results.
    const levels = LEVELS.map(L => ({ L, pool: marked.filter(r => r.level === L.level) })).filter(x => x.pool.length);
    const remaining = () => target - count();
    // Every level that has learners gets at least one script while budget allows.
    for (const { L, pool } of levels.sort((a, b) => b.pool.length - a.pool.length)) {
      if (remaining() <= 0) break;
      if (pool.some(r => r.sampled)) continue;
      const free = pool.filter(r => !r.sampled);
      pick(free[Math.floor(rand() * free.length)], `Level ${L.level} (${L.min}–${L.max}%)`);
    }
    // Then proportional fill (largest remainder).
    if (remaining() > 0) {
      const want = levels.map(({ L, pool }) => {
        const exact = target * pool.length / marked.length;
        return { L, pool, need: Math.floor(exact) - pool.filter(r => r.sampled).length, frac: exact % 1 };
      });
      let left = remaining();
      for (const w of want) { const n = Math.max(0, Math.min(w.need, left)); for (let i = 0; i < n; i++) { const free = w.pool.filter(r => !r.sampled); if (!free.length) break; pick(free[Math.floor(rand() * free.length)], `Level ${w.L.level} (${w.L.min}–${w.L.max}%)`); left--; } }
      for (const w of want.sort((a, b) => b.frac - a.frac)) { if (left <= 0) break; const free = w.pool.filter(r => !r.sampled); if (free.length) { pick(free[Math.floor(rand() * free.length)], `Level ${w.L.level} (${w.L.min}–${w.L.max}%)`); left--; } }
      // Anything still missing: random from whoever is left.
      while (left > 0) { const free = marked.filter(r => !r.sampled); if (!free.length) break; pick(free[Math.floor(rand() * free.length)], 'Random'); left--; }
    }
  }
  return { learners: rows, target, marked: marked.length, absent: rows.length - marked.length, seed };
}

export function stats(learners, total) {
  const pcts = learners.map(l => l.pct).filter(p => p != null);
  if (!pcts.length) return { n: 0 };
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const sorted = [...pcts].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const levels = LEVELS.map(L => pcts.filter(p => levelOf(p) === L.level).length);
  return { n: pcts.length, mean, median, min: sorted[0], max: sorted.at(-1), levels, total };
}

// Moderator vs teacher marks for the sampled scripts.
export function variance(learners, total, tolerance) {
  const rows = learners.filter(l => l.sampled && l.modMark != null && l.modMark !== '' && l.mark != null).map(l => {
    const diff = +l.modMark - l.mark;
    const diffPct = total ? diff / total * 100 : 0;
    return { ...l, diff, diffPct, within: Math.abs(diffPct) <= tolerance };
  });
  const out = rows.filter(r => !r.within).length;
  const avgPct = rows.length ? rows.reduce((a, r) => a + r.diffPct, 0) / rows.length : 0;
  return { rows, moderated: rows.length, outside: out, avgPct };
}
