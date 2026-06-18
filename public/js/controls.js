// controls.js — a reactive control store.
//
// This is the working version of the `ControlsAPI` that the BRIK export stubbed out
// (its onChange/onAny/onAction were no-ops). Here they actually fire, so the panel and
// the chat console truly drive the canvas. Each tool gets its own store instance.

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function hexToRgbaCss(hex, opacity0to100) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'rgba(0,0,0,1)';
  const op = opacity0to100 != null && !isNaN(Number(opacity0to100)) ? Number(opacity0to100) : 100;
  const a = clamp(op, 0, 100) / 100;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @param {Object} defaults  initial control values
 * @param {Object} [opts]
 * @param {string} [opts.storageKey]  if given, values persist to localStorage under this key
 */
export function createControls(defaults, opts = {}) {
  const _defaults = deepClone(defaults || {});
  let _v = deepClone(_defaults);

  const storageKey = opts.storageKey || null;
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved === 'object') _v = Object.assign(_v, saved);
    } catch (_) { /* ignore corrupt storage */ }
  }

  const changeListeners = new Map();   // key -> Set<fn>
  const anyListeners = new Set();      // Set<fn(key, value)>
  const actionListeners = new Map();   // name -> Set<fn>

  function persist() {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(_v)); } catch (_) { /* quota */ }
  }

  function notify(key, value) {
    const set = changeListeners.get(key);
    if (set) for (const fn of set) { try { fn(value, key); } catch (e) { console.error(e); } }
    for (const fn of anyListeners) { try { fn(key, value); } catch (e) { console.error(e); } }
  }

  const api = {
    // --- reads ---
    get(k) { return _v[k]; },
    getAll() { return Object.assign({}, _v); },
    getDefaults() { return deepClone(_defaults); },
    getColorWithAlpha(baseKey) { return hexToRgbaCss(_v[baseKey], _v[baseKey + '_opacity']); },
    has(k) { return Object.prototype.hasOwnProperty.call(_v, k); },

    // --- writes ---
    set(k, v) {
      if (_v[k] === v) return;
      _v[k] = v;
      persist();
      notify(k, v);
    },
    // Apply many changes at once (used by the chat console). Returns the keys that changed.
    apply(changes) {
      const changed = [];
      if (!changes || typeof changes !== 'object') return changed;
      for (const [k, v] of Object.entries(changes)) {
        if (_v[k] === v) continue;
        _v[k] = v;
        changed.push(k);
      }
      if (changed.length) {
        persist();
        for (const k of changed) notify(k, _v[k]);
      }
      return changed;
    },
    reset() {
      _v = deepClone(_defaults);
      persist();
      // notify everything so the whole UI/canvas re-syncs
      for (const k of Object.keys(_v)) notify(k, _v[k]);
      this.triggerAction('reset');
    },

    // --- subscriptions ---
    onChange(key, fn) {
      if (!changeListeners.has(key)) changeListeners.set(key, new Set());
      changeListeners.get(key).add(fn);
      return () => changeListeners.get(key)?.delete(fn);
    },
    onAny(fn) {
      anyListeners.add(fn);
      return () => anyListeners.delete(fn);
    },
    onAction(name, fn) {
      if (!actionListeners.has(name)) actionListeners.set(name, new Set());
      actionListeners.get(name).add(fn);
      return () => actionListeners.get(name)?.delete(fn);
    },
    triggerAction(name) {
      const set = actionListeners.get(name);
      if (set) for (const fn of set) { try { fn(); } catch (e) { console.error(e); } }
    },

    // remove every subscription (used on tool teardown)
    clearListeners() {
      changeListeners.clear();
      anyListeners.clear();
      actionListeners.clear();
    }
  };

  return api;
}

export { hexToRgb, hexToRgbaCss };
