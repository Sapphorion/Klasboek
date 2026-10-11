import { h, modal, toast, dropZone } from '../ui.js';
import { countWord } from '../aicheck.js';
import { extractText } from '../importers.js';

// ---------- AI check: count the trap word in a learner's answers ----------
export function openChecker(chk) {
  const out = h('div', { 'aria-live': 'polite' });
  const ta = h('textarea', { rows: 8, placeholder: 'Paste the learner’s answers here, or upload their file below.' });
  const run = () => {
    const n = countWord(ta.value, chk.word);
    if (!ta.value.trim()) { out.replaceChildren(); return; }
    out.replaceChildren(n
      ? h('div', { class: 'aic-result hit' }, h('strong', {}, `“${chk.word}” appears ${n} time${n > 1 ? 's' : ''}.`), h('p', {}, `The hidden note asked AI tools for ${chk.n}. This suggests the questions were pasted into an AI tool. Talk to the learner and ask them to explain their answers before deciding anything.`))
      : h('div', { class: 'aic-result' }, h('strong', {}, `“${chk.word}” doesn’t appear.`), h('p', {}, 'No sign of the check. That doesn’t prove the work is the learner’s own: they may have typed the questions out or used a tool that ignores hidden text.')));
  };
  ta.addEventListener('input', run);
  modal('Check a learner’s answers', [
    h('p', { class: 'muted small' }, `Looking for “${chk.word}” (and its plural). Nothing leaves this device.`),
    ta,
    dropZone({ accept: '.docx,.pdf,.txt', label: 'Or upload their answers', hint: 'Word, PDF or text', onFiles: async ([f]) => { try { ta.value = await extractText(f); run(); } catch (e) { toast(e.message, 'error'); } } }),
    out,
  ]);
}

