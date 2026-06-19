// shared/missionForm.js
// The "Start Mission" form, used by both the popup (compact) and the
// dashboard's Home view (when no mission is active). Returns a plain DOM
// node — the caller decides where to mount it and what to do once a
// mission actually starts (onStarted).

import * as missionService from '../utils/missionService.js';
import { el } from './dom.js';

const DURATION_PRESETS = [30, 60, 90, 120];

export function createMissionForm({ defaultMinutes = 60, onStarted, submitLabel = '\uD83D\uDE80 Launch Mission', autofocus = true } = {}) {
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Finish quarterly report', maxlength: 80 });
  const goalInput = el('textarea', { placeholder: 'What does success look like? (optional)', maxlength: 200 });
  const durationInput = el('input', { type: 'number', min: 5, max: 600, value: defaultMinutes });
  const errorEl = el('div', { class: 'form-error' }, ['']);

  const presetButtons = DURATION_PRESETS.map((mins) => {
    const btn = el('button', { type: 'button', class: `btn btn-ghost btn-sm${mins === defaultMinutes ? ' is-selected' : ''}` }, [`${mins}m`]);
    btn.addEventListener('click', () => {
      durationInput.value = mins;
      presetButtons.forEach((b, i) => b.classList.toggle('is-selected', DURATION_PRESETS[i] === mins));
    });
    return btn;
  });
  durationInput.addEventListener('input', () => {
    const current = Number(durationInput.value);
    presetButtons.forEach((b, i) => b.classList.toggle('is-selected', DURATION_PRESETS[i] === current));
  });

  const submitBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, [submitLabel]);
  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const minutes = Number(durationInput.value);
    if (!name) {
      errorEl.textContent = 'Give your mission a name.';
      nameInput.focus();
      return;
    }
    if (!minutes || minutes <= 0) {
      errorEl.textContent = 'Expected duration must be a positive number of minutes.';
      durationInput.focus();
      return;
    }
    errorEl.textContent = '';
    submitBtn.disabled = true;
    try {
      const mission = await missionService.startMission({ name, goal: goalInput.value, expectedDurationMinutes: minutes });
      if (typeof onStarted === 'function') onStarted(mission);
    } catch (err) {
      errorEl.textContent = 'Could not start the mission \u2014 try again.';
      submitBtn.disabled = false;
    }
  });

  const formEl = el('div', { class: 'mission-form' }, [
    el('div', { class: 'field' }, [el('label', {}, ['Mission Name']), nameInput]),
    el('div', { class: 'field' }, [el('label', {}, ['Goal (optional)']), goalInput]),
    el('div', { class: 'field' }, [
      el('label', {}, ['Expected Duration']),
      el('div', { class: 'duration-presets' }, presetButtons),
      durationInput
    ]),
    errorEl,
    submitBtn
  ]);

  if (autofocus) requestAnimationFrame(() => nameInput.focus());

  return formEl;
}
