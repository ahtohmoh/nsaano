// registry.js — the tool registry.
//
// Holds tool definitions (built-in + installed), owns one control store per tool, and
// handles activating / installing / remixing. Installed tools are stored as source so
// they survive reloads (re-imported as blob modules). Each activation tears down the
// previous tool cleanly before mounting the next.

import { createControls } from './controls.js';
import typingTool from '../tools/typing-into-the-void.js';

const INSTALLED_KEY = 'nsaano:installed';
const ACTIVE_KEY = 'nsaano:activeTool';

function validateTool(def) {
  if (!def || typeof def !== 'object') throw new Error('Tool module must default-export an object.');
  for (const k of ['id', 'name', 'controlSchema', 'defaults', 'init', 'draw']) {
    if (!(k in def)) throw new Error(`Tool is missing "${k}".`);
  }
  if (typeof def.init !== 'function' || typeof def.draw !== 'function') throw new Error('Tool init/draw must be functions.');
  return def;
}

export function createRegistry({ canvas, ctx, runtime }) {
  const tools = new Map();              // id -> { def, source|null, builtin }
  const controlsByTool = new Map();     // id -> controls store
  const changeCbs = new Set();

  let activeId = null;
  let activeDef = null;
  let activeControls = null;

  function register(def, { source = null, builtin = false, filePath = null } = {}) {
    validateTool(def);
    let id = def.id;
    // avoid id collisions for installs/remixes
    if (tools.has(id) && !builtin) { let n = 2; while (tools.has(`${id}-${n}`)) n++; id = `${id}-${n}`; def = Object.assign({}, def, { id }); }
    tools.set(id, { def, source, builtin, filePath });
    return id;
  }

  // Return the module source for a tool (installed tools carry it; built-ins are fetched).
  async function sourceFor(id) {
    const t = tools.get(id);
    if (!t) throw new Error(`No such tool: ${id}`);
    if (t.source) return t.source;
    if (t.filePath) { const res = await fetch(t.filePath); return res.text(); }
    throw new Error('No source available for tool.');
  }

  function emit() { const a = getActive(); for (const cb of changeCbs) { try { cb(a); } catch (e) { console.error(e); } } }

  function getActive() { return { id: activeId, def: activeDef, controls: activeControls }; }

  function list() {
    return [...tools.entries()].map(([id, t]) => ({ id, name: t.def.name, description: t.def.description || '', builtin: t.builtin, active: id === activeId }));
  }

  function controlsFor(id) {
    if (!controlsByTool.has(id)) {
      const def = tools.get(id).def;
      controlsByTool.set(id, createControls(def.defaults, { storageKey: `nsaano:controls:${id}` }));
    }
    return controlsByTool.get(id);
  }

  function activate(id) {
    if (!tools.has(id)) throw new Error(`No such tool: ${id}`);
    if (activeDef && typeof activeDef.dispose === 'function') { try { activeDef.dispose(); } catch (e) { console.error(e); } }
    const def = tools.get(id).def;
    const controls = controlsFor(id);
    runtime.setCanvas(canvas);
    def.init({ canvas, ctx, controls, runtime });
    activeId = id; activeDef = def; activeControls = controls;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch (_) {}
    emit();
    return getActive();
  }

  async function installFromSource(source, { activate: doActivate = true } = {}) {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let mod;
    try { mod = await import(/* @vite-ignore */ url); }
    finally { URL.revokeObjectURL(url); }
    const id = register(validateTool(mod.default), { source, builtin: false });
    persistInstalled();
    if (doActivate) activate(id);
    return id;
  }

  // Remix the active tool: a fresh copy with its own id + control state seeded from the
  // current values, so you can diverge settings without touching the original.
  function remixActive() {
    if (!activeDef) return null;
    const liveValues = activeControls.getAll();
    const clone = Object.assign({}, activeDef, {
      id: activeDef.id + '-remix',
      name: activeDef.name + ' (remix)',
      defaults: Object.assign({}, activeDef.defaults, liveValues)
    });
    // strip per-instance state copied by Object.assign so init() starts clean
    delete clone._draw; delete clone._dispose; delete clone._host; delete clone._updateCanvasSize;
    const src = tools.get(activeId).source;
    const id = register(clone, { source: src, builtin: false });
    persistInstalled();
    activate(id);
    return id;
  }

  function persistInstalled() {
    const installed = [...tools.values()].filter((t) => !t.builtin && t.source).map((t) => ({ source: t.source }));
    try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(installed)); } catch (_) {}
  }

  async function restoreInstalled() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]'); } catch (_) {}
    for (const entry of saved) {
      if (!entry || !entry.source) continue;
      try { await installFromSource(entry.source, { activate: false }); } catch (e) { console.warn('Failed to restore installed tool:', e); }
    }
  }

  function onChange(cb) { changeCbs.add(cb); return () => changeCbs.delete(cb); }

  // bootstrap
  register(typingTool, { builtin: true, filePath: './tools/typing-into-the-void.js' });

  async function init() {
    await restoreInstalled();
    let startId = null;
    try { startId = localStorage.getItem(ACTIVE_KEY); } catch (_) {}
    if (!startId || !tools.has(startId)) startId = typingTool.id;
    activate(startId);
  }

  return { list, activate, installFromSource, remixActive, getActive, controlsFor, sourceFor, onChange, init };
}
