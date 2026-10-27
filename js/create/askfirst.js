// Ask first: before Create writes something with AI, Claude asks the teacher a few short
// questions about this request (question types, difficulty, contexts, memo…), with answers to
// tick and the recommended ones already ticked. The answers go to the AI with the request.
import { h, icon, modal } from '../ui.js';
import { aiAskFirst, aiReady } from '../ai.js';
import { state, saveSettings } from '../state.js';

/** Resolves with the teacher's answers as text for the AI ('' when skipped or switched off), or null when cancelled. */
export function askFirst(type, o) {
  if (!aiReady() || state.settings.createAsk === false) return Promise.resolve('');
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (settled) return; settled = true; m.close(); resolve(v); };
    const body = h('div', { class: 'ask-first' });
    const m = modal('A few questions first', body, { wide: true, onClose: () => { if (!settled) { settled = true; resolve(null); } } });
    const skip = label => h('button', { class: 'btn ghost', onclick: () => finish('') }, label);

    body.replaceChildren(
      h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Thinking about what to ask…'),
      h('div', { class: 'row end' }, skip('Skip and make it now')));

    aiAskFirst(type, o).then(questions => {
      if (settled) return;
      if (!questions.length) { finish(''); return; }
      draw(questions);
    }).catch(e => {
      if (settled) return;
      body.replaceChildren(h('p', { class: 'error small' }, `Couldn’t get the questions: ${e.message}`),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => finish(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => finish('') }, icon('spark'), 'Make it without them')));
    });

    function draw(questions) {
      // For each question: the ticked answers and an "Other" answer.
      const picks = questions.map(q => ({ on: new Set(q.options.map((x, i) => x.recommended ? i : -1).filter(i => i >= 0).slice(0, q.multi ? 9 : 1)), other: '', otherOn: false }));
      const extra = h('textarea', { rows: 2, placeholder: 'e.g. Most of the class are English second-language speakers; keep sentences short' });
      const again = h('input', { type: 'checkbox', checked: true });

      const qBlock = (q, qi) => {
        const p = picks[qi];
        const name = `askq${qi}`;
        const kind = q.multi ? 'checkbox' : 'radio';
        const otherIn = h('input', { type: 'text', class: 'ask-other-text', placeholder: 'Type your own', 'aria-label': `Other answer: ${q.question}`,
          oninput: e => { p.other = e.target.value; const on = !!p.other.trim(); if (on !== p.otherOn) { p.otherOn = on; otherBox.checked = on; if (on && !q.multi) { p.on.clear(); boxes.forEach(b => { b.checked = false; }); } } } });
        const otherBox = h('input', { type: kind, name, onchange: e => { p.otherOn = e.target.checked; if (p.otherOn) { if (!q.multi) p.on.clear(); otherIn.focus(); } } });
        const boxes = q.options.map((x, i) => h('input', { type: kind, name, checked: p.on.has(i), onchange: e => {
          if (!q.multi) { p.on.clear(); p.otherOn = false; }
          if (e.target.checked) p.on.add(i); else p.on.delete(i);
        } }));
        return h('fieldset', { class: 'ask-q' },
          h('legend', {}, q.short ? h('span', { class: 'ask-tag' }, q.short) : null, q.question, q.multi ? h('small', { class: 'muted' }, ' Tick any') : null),
          h('div', { class: 'ask-opts' },
            q.options.map((x, i) => h('label', { class: 'ask-opt' }, boxes[i],
              h('span', {}, h('span', { class: 'ask-label' }, x.label, x.recommended ? h('span', { class: 'ask-rec' }, 'Recommended') : null),
                x.detail ? h('small', { class: 'muted' }, x.detail) : null))),
            h('label', { class: 'ask-opt ask-other' }, otherBox, h('span', { class: 'ask-label' }, 'Other'), otherIn)));
      };

      const go = h('button', { class: 'btn primary' }, icon('spark'), 'Make it');
      go.onclick = () => {
        const lines = questions.map((q, qi) => {
          const p = picks[qi];
          const chosen = [...p.on].sort((a, b) => a - b).map(i => q.options[i].label);
          if (p.otherOn && p.other.trim()) chosen.push(p.other.trim());
          return chosen.length ? `- ${q.question} ${chosen.join('; ')}` : '';
        }).filter(Boolean);
        if (extra.value.trim()) lines.push(`- Also: ${extra.value.trim()}`);
        if (!again.checked) saveSettings({ createAsk: false });
        finish(lines.length ? `Before you started, the teacher answered these questions. Follow their answers:\n${lines.join('\n')}` : '');
      };

      body.replaceChildren(
        h('p', { class: 'muted small' }, 'So it fits your class. The ticked answers are what Claude would do; change any, or type your own.'),
        ...questions.map(qBlock),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Anything else? (optional)'), extra),
        h('div', { class: 'row between wrap' },
          h('label', { class: 'check small' }, again, 'Ask me questions like these next time'),
          h('div', { class: 'row wrap' }, skip('Skip the questions'), go)));
      body.querySelector('input')?.focus();
    }
  });
}
