// panel.js — renders a tool's controlSchema into the "Edit Controllers" panel.
//
// Sections are collapsible. Every widget re-syncs whenever any control value changes
// (so chat-driven edits and Reset are reflected live in the panel).

import { buildField, el } from './widgets.js';

export function renderPanel(container, def, controls) {
  container.innerHTML = '';
  const syncs = [];

  renderPresets(container, def, controls);

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

// One-click looks: built-in presets shipped by the tool + save-your-own (localStorage).
function renderPresets(container, def, controls) {
  const KEY = 'nsaano:presets:' + def.id;
  const loadUser = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const saveUser = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) { alert('Could not save the preset — browser storage is full.'); } };
  const builtin = def.presets || [];
  if (!builtin.length && !loadUser().length) return; // nothing to show

  const sel = el('select', { class: 'select preset-select' });
  const saveBtn = el('button', { class: 'btn-ghost preset-save', type: 'button', title: 'Save the current look' }, 'Save');
  const delBtn = el('button', { class: 'btn-ghost preset-del', type: 'button', title: 'Delete saved look' }, '✕');
  delBtn.disabled = true;

  function rebuild() {
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, 'Presets…'));
    builtin.forEach((p, i) => sel.appendChild(el('option', { value: 'b' + i }, p.name)));
    loadUser().forEach((p, i) => sel.appendChild(el('option', { value: 'u' + i }, '★ ' + p.name)));
  }
  rebuild();

  sel.addEventListener('change', () => {
    const v = sel.value;
    delBtn.disabled = !(v && v[0] === 'u');
    if (!v) return;
    const p = v[0] === 'b' ? builtin[+v.slice(1)] : loadUser()[+v.slice(1)];
    if (p && p.values) controls.apply(p.values);
  });
  saveBtn.addEventListener('click', () => {
    const name = (prompt('Name this look:') || '').trim();
    if (!name) return;
    const list = loadUser(); list.push({ name, values: controls.getAll() }); saveUser(list);
    rebuild(); sel.value = 'u' + (list.length - 1); delBtn.disabled = false;
  });
  delBtn.addEventListener('click', () => {
    const v = sel.value; if (!v || v[0] !== 'u') return;
    const list = loadUser(); list.splice(+v.slice(1), 1); saveUser(list);
    rebuild(); sel.value = ''; delBtn.disabled = true;
  });

  container.appendChild(el('div', { class: 'panel-presets' }, [
    el('span', { class: 'preset-label' }, 'Presets'),
    sel, saveBtn, delBtn
  ]));
}
