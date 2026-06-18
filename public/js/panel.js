// panel.js — renders a tool's controlSchema into the "Edit Controllers" panel.
//
// Sections are collapsible. Every widget re-syncs whenever any control value changes
// (so chat-driven edits and Reset are reflected live in the panel).

import { buildField, el } from './widgets.js';

export function renderPanel(container, def, controls) {
  container.innerHTML = '';
  const syncs = [];

  def.controlSchema.forEach((section, i) => {
    const sec = el('section', { class: 'panel-section' });
    const head = el('button', { class: 'section-head', type: 'button' }, [
      el('span', { class: 'section-title' }, section.title),
      el('span', { class: 'section-chevron' }, '⌄')
    ]);
    const body = el('div', { class: 'section-body' });
    section.fields.forEach((field) => {
      const built = buildField(field, controls);
      body.appendChild(built.node);
      syncs.push(built.sync);
    });
    head.addEventListener('click', () => sec.classList.toggle('is-collapsed'));
    sec.appendChild(head);
    sec.appendChild(body);
    container.appendChild(sec);
  });

  // Re-sync all widgets when values change elsewhere (chat, reset, drag-driven writes).
  const unsub = controls.onAny(() => { for (const s of syncs) { try { s(); } catch (_) {} } });
  return () => unsub();
}
