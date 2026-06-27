// app.js — Nsaano bootstrap. Wires the registry, canvas RAF loop, control panel,
// chat console, the stage (size controls), and the header actions together.

import { createRuntime } from './runtime.js';
import { createRegistry } from './registry.js';
import { renderPanel } from './panel.js';
import { openExportModal } from './export.js';
import { el } from './widgets.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const runtime = createRuntime(canvas);
const registry = createRegistry({ canvas, ctx, runtime });

// ── injectable clock ──
// Tools read time from this global (defensively, falling back to performance.now —
// so the standalone Code export, where it's absent, still animates in real time).
// The studio video exporter switches it to "manual" mode to step frames at exact
// times, and the RAF loop below pauses while that's happening.
window.__nsaanoClock = window.__nsaanoClock || {
  manual: null,
  now() { return this.manual == null ? performance.now() : this.manual; },
  isManual() { return this.manual != null; }
};

// ── RAF loop (draws whatever tool is active; pauses during manual/offline render) ──
let active = null;
function loop(t) {
  if (!window.__nsaanoClock.isManual() && active && active.def && typeof active.def.draw === 'function') {
    try { active.def.draw(t); } catch (e) { console.error('draw error', e); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ── panel + tool name + stage rebind on tool change ──
const panelHost = document.getElementById('panel-body');
const toolNameEl = document.getElementById('tool-name');
let panelTeardown = null;
let stageTeardown = null;

function onToolChange(a) {
  active = a;
  window.__nsaanoActive = a; // debug hook: lets tooling step a deterministic frame
  toolNameEl.textContent = a.def.name;
  if (panelTeardown) panelTeardown();
  panelTeardown = renderPanel(panelHost, a.def, a.controls);
  if (stageTeardown) stageTeardown();
  stageTeardown = bindStage(a.controls);
}
registry.onChange(onToolChange);

// ── stage size controls (bound to canvasWidth / canvasHeight / canvasRatio) ──
const wInput = document.getElementById('stage-w');
const hInput = document.getElementById('stage-h');
const ratioSel = document.getElementById('stage-ratio');

function bindStage(controls) {
  const hasSize = controls.has('canvasWidth') && controls.has('canvasHeight');
  const hasRatio = controls.has('canvasRatio');
  wInput.disabled = hInput.disabled = !hasSize;
  ratioSel.disabled = !hasRatio;

  const onW = () => { controls.set('canvasWidth', Math.max(1, parseInt(wInput.value, 10) || 1)); if (controls.has('canvasRatio')) controls.set('canvasRatio', 'Custom'); };
  const onH = () => { controls.set('canvasHeight', Math.max(1, parseInt(hInput.value, 10) || 1)); if (controls.has('canvasRatio')) controls.set('canvasRatio', 'Custom'); };
  const onR = () => controls.set('canvasRatio', ratioSel.value);
  if (hasSize) { wInput.addEventListener('change', onW); hInput.addEventListener('change', onH); }
  if (hasRatio) {
    ratioSel.innerHTML = '';
    const field = controls.has('canvasRatio') ? findRatioOptions(controls) : [];
    field.forEach((o) => ratioSel.appendChild(el('option', { value: o }, o)));
    ratioSel.addEventListener('change', onR);
  }
  const sync = () => {
    // canvas dims are updated by the tool; reflect them
    wInput.value = canvas.width; hInput.value = canvas.height;
    if (hasRatio) ratioSel.value = controls.get('canvasRatio');
  };
  const unsub = controls.onAny(sync);
  // also poll once after layout settles
  setTimeout(sync, 80);
  sync();
  return () => { unsub(); wInput.removeEventListener('change', onW); hInput.removeEventListener('change', onH); ratioSel.removeEventListener('change', onR); };
}

function findRatioOptions(controls) {
  // pull the ratio option list out of the active tool's schema
  const { def } = registry.getActive();
  for (const s of def.controlSchema) for (const f of s.fields) if (f.key === 'canvasRatio' && f.options) return f.options;
  return ['Responsive', 'Custom'];
}

// ── header actions ──
document.getElementById('btn-reset').addEventListener('click', () => registry.getActive().controls.reset());
document.getElementById('btn-export').addEventListener('click', () => {
  try { openExportModal(registry); } catch (e) { alert('Export failed: ' + e.message); }
});

// tool switcher menu
const toolBtn = document.getElementById('tool-switch');
const toolMenu = document.getElementById('tool-menu');
toolBtn.addEventListener('click', (e) => { e.stopPropagation(); buildToolMenu(); toolMenu.classList.toggle('is-open'); });
document.addEventListener('click', () => toolMenu.classList.remove('is-open'));
toolMenu.addEventListener('click', (e) => e.stopPropagation());

function buildToolMenu() {
  toolMenu.innerHTML = '';
  registry.list().forEach((t) => {
    const item = el('button', { class: 'menu-item' + (t.active ? ' is-active' : ''), type: 'button' }, [
      el('span', { class: 'menu-item-name' }, t.name),
      t.builtin ? el('span', { class: 'menu-tag' }, 'built-in') : el('span', { class: 'menu-tag' }, 'installed')
    ]);
    item.addEventListener('click', () => { registry.activate(t.id); toolMenu.classList.remove('is-open'); });
    toolMenu.appendChild(item);
  });
  toolMenu.appendChild(el('div', { class: 'menu-sep' }));
  const remix = el('button', { class: 'menu-item menu-action', type: 'button' }, '⎘  Remix current tool');
  remix.addEventListener('click', () => { registry.remixActive(); toolMenu.classList.remove('is-open'); });
  const install = el('button', { class: 'menu-item menu-action', type: 'button' }, '＋  Install a tool…');
  install.addEventListener('click', () => { toolMenu.classList.remove('is-open'); openInstallModal(); });
  toolMenu.appendChild(remix);
  toolMenu.appendChild(install);
}

// ── install modal ──
function openInstallModal() {
  const ta = el('textarea', { class: 'modal-textarea', placeholder: 'Paste a Nsaano tool module (.js) here — it must end with:  export default { id, name, controlSchema, defaults, init, draw }', rows: 12 });
  const fileBtn = el('button', { class: 'btn-ghost', type: 'button' }, 'Load .js file');
  const fileInput = el('input', { type: 'file', accept: '.js,.mjs,text/javascript', style: 'display:none' });
  fileBtn.addEventListener('click', () => fileInput.click());

  const hint = el('p', { class: 'modal-hint' }, 'A tool is a JavaScript module — not an exported PNG/MP4/HTML (those are outputs, not tools). Use “Remix current tool” to start from this one.');
  const err = el('p', { class: 'modal-err' });
  const warn = el('p', { class: 'modal-warn' }, '⚠ Installing a tool runs its code in this page. Only install code you trust.');
  const cancel = el('button', { class: 'btn-ghost', type: 'button' }, 'Cancel');
  const confirm = el('button', { class: 'btn-primary', type: 'button' }, 'Install & run');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; if (!f) return;
    if (!/\.(js|mjs)$/i.test(f.name)) { err.textContent = `“${f.name}” isn't a .js module. Pick a tool .js file.`; return; }
    err.textContent = '';
    f.text().then((t) => { ta.value = t; });
  });

  const modal = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('div', { class: 'modal-head' }, 'Install a tool'),
      el('div', { class: 'modal-row' }, [fileBtn, fileInput]),
      ta, hint, err, warn,
      el('div', { class: 'modal-foot' }, [cancel, confirm])
    ])
  ]);
  const close = () => modal.remove();
  cancel.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  confirm.addEventListener('click', async () => {
    const src = ta.value.trim();
    if (!src) { err.textContent = 'Paste a tool module first.'; return; }
    err.textContent = '';
    confirm.disabled = true; confirm.textContent = 'Installing…';
    try { await registry.installFromSource(src); close(); }
    catch (e) { err.textContent = e.message; confirm.disabled = false; confirm.textContent = 'Install & run'; }
  });
  document.body.appendChild(modal);
  ta.focus();
}

// ── go ──
registry.init().catch((e) => { console.error(e); alert('Failed to start Nsaano: ' + e.message); });
