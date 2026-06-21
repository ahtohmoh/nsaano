// widgets.js — control-field renderers.
//
// Each field in a tool's controlSchema maps to one of these. A widget reads its initial
// value from the control store, writes back on user input, and subscribes to onChange so
// it stays in sync when the value is changed elsewhere (chat console, reset, etc.).

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    const isText = typeof c === 'string' || typeof c === 'number';
    node.appendChild(isText ? document.createTextNode(String(c)) : c);
  }
  return node;
}

const FONT_OPTIONS = [
  'system-ui', 'Inter', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman',
  'Courier New', 'monospace', 'Verdana', 'Trebuchet MS'
];

function row(labelText, controlNode, opts = {}) {
  const r = el('div', { class: 'field' + (opts.stack ? ' field--stack' : '') });
  if (labelText) r.appendChild(el('label', { class: 'field-label' }, labelText));
  r.appendChild(controlNode);
  return r;
}

// --- individual field builders. Each returns { node, sync } -----------------

function buildSegmented(field, controls) {
  const wrap = el('div', { class: 'segmented' });
  const buttons = (field.options || []).map((opt) => {
    const value = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    const b = el('button', { class: 'seg-btn', type: 'button' }, label);
    b.addEventListener('click', () => controls.set(field.key, value));
    b._value = value;
    return b;
  });
  buttons.forEach((b) => wrap.appendChild(b));
  const sync = () => {
    const v = controls.get(field.key);
    buttons.forEach((b) => b.classList.toggle('is-active', b._value === v));
  };
  return { node: row(field.label, wrap), sync };
}

function buildSelect(field, controls) {
  const sel = el('select', { class: 'select' });
  (field.options || []).forEach((opt) => {
    const value = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    sel.appendChild(el('option', { value }, label));
  });
  sel.addEventListener('change', () => controls.set(field.key, sel.value));
  const sync = () => { sel.value = controls.get(field.key); };
  return { node: row(field.label, sel), sync };
}

function buildSlider(field, controls) {
  const wrap = el('div', { class: 'slider' });
  const range = el('input', {
    type: 'range', class: 'slider-range',
    min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1
  });
  const num = el('input', { type: 'number', class: 'slider-num', min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1 });
  const commit = (v) => {
    let n = Number(v);
    if (isNaN(n)) return;
    if (field.min != null) n = Math.max(field.min, n);
    if (field.max != null) n = Math.min(field.max, n);
    controls.set(field.key, n);
  };
  range.addEventListener('input', () => commit(range.value));
  num.addEventListener('input', () => commit(num.value));
  wrap.appendChild(range);
  wrap.appendChild(num);
  const sync = () => { const v = controls.get(field.key); range.value = v; num.value = v; };
  return { node: row(field.label, wrap), sync };
}

function buildColor(field, controls, withAlpha) {
  const wrap = el('div', { class: 'color' });
  const swatch = el('button', { class: 'color-swatch', type: 'button', title: 'Pick color' });
  const native = el('input', { type: 'color', class: 'color-native' });
  const hex = el('input', { type: 'text', class: 'color-hex', maxlength: 7 });
  swatch.appendChild(native);
  swatch.addEventListener('click', () => native.click());

  const opacity = withAlpha ? el('input', { type: 'text', class: 'color-opacity', title: 'Opacity %' }) : null;

  const setHex = (v) => {
    let h = String(v || '').trim();
    if (h && h[0] !== '#') h = '#' + h;
    if (/^#[0-9a-fA-F]{6}$/.test(h)) controls.set(field.key, h.toUpperCase());
  };
  native.addEventListener('input', () => controls.set(field.key, native.value.toUpperCase()));
  hex.addEventListener('change', () => setHex(hex.value));
  if (opacity) opacity.addEventListener('change', () => {
    let n = parseInt(opacity.value, 10);
    if (isNaN(n)) n = 100;
    controls.set(field.key + '_opacity', Math.max(0, Math.min(100, n)));
  });

  wrap.appendChild(swatch);
  wrap.appendChild(hex);
  if (opacity) wrap.appendChild(opacity);

  // Eyedropper (Chromium). Hidden where unsupported.
  if (window.EyeDropper) {
    const eye = el('button', { class: 'color-eye', type: 'button', title: 'Eyedropper' }, '⊙');
    eye.addEventListener('click', async () => {
      try { const res = await new window.EyeDropper().open(); controls.set(field.key, res.sRGBHex.toUpperCase()); }
      catch (_) { /* cancelled */ }
    });
    wrap.appendChild(eye);
  }

  const sync = () => {
    const v = controls.get(field.key) || '#000000';
    native.value = /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000';
    hex.value = v;
    swatch.style.background = v;
    if (opacity) { const o = controls.get(field.key + '_opacity'); opacity.value = (o == null ? 100 : o); }
  };
  return { node: row(field.label, wrap), sync };
}

function buildText(field, controls) {
  const input = el('input', { type: 'text', class: 'text-input', placeholder: field.placeholder || '' });
  input.addEventListener('input', () => controls.set(field.key, input.value));
  const sync = () => { if (document.activeElement !== input) input.value = controls.get(field.key) ?? ''; };
  return { node: row(field.label, input), sync };
}

function buildTextarea(field, controls) {
  const ta = el('textarea', { class: 'textarea', rows: field.rows || 4, placeholder: field.placeholder || '' });
  ta.addEventListener('input', () => controls.set(field.key, ta.value));
  const sync = () => { if (document.activeElement !== ta) ta.value = controls.get(field.key) ?? ''; };
  return { node: row(field.label, ta, { stack: true }), sync };
}

function buildToggle(field, controls) {
  const sw = el('button', { class: 'toggle', type: 'button', role: 'switch' });
  const knob = el('span', { class: 'toggle-knob' });
  sw.appendChild(knob);
  sw.addEventListener('click', () => controls.set(field.key, !controls.get(field.key)));
  const sync = () => sw.classList.toggle('is-on', !!controls.get(field.key));
  return { node: row(field.label, sw), sync };
}

function readFiles(files, cb) {
  const out = [];
  let pending = files.length;
  if (!pending) return cb(out);
  Array.from(files).forEach((f) => {
    const reader = new FileReader();
    reader.onload = () => { out.push(reader.result); if (--pending === 0) cb(out); };
    reader.onerror = () => { if (--pending === 0) cb(out); };
    reader.readAsDataURL(f);
  });
}

function buildVideo(field, controls) {
  const wrap = el('div', { class: 'imgfield' });
  const file = el('input', { type: 'file', accept: 'video/*', class: 'imgfield-input' });
  const btn = el('button', { class: 'btn-ghost imgfield-btn', type: 'button' }, 'Choose video');
  const thumb = el('div', { class: 'imgfield-thumbs' });
  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => readFiles(file.files, (arr) => { if (arr[0]) controls.set(field.key, arr[0]); }));
  wrap.appendChild(btn); wrap.appendChild(file); wrap.appendChild(thumb);
  const sync = () => {
    thumb.innerHTML = '';
    if (controls.get(field.key)) {
      const t = el('div', { class: 'thumb thumb--video' });
      const x = el('button', { class: 'thumb-x', type: 'button' }, '×');
      x.addEventListener('click', () => controls.set(field.key, ''));
      t.appendChild(x); thumb.appendChild(t);
    }
  };
  return { node: row(field.label, wrap, { stack: true }), sync };
}

function buildImage(field, controls) {
  const wrap = el('div', { class: 'imgfield' });
  const file = el('input', { type: 'file', accept: 'image/*', class: 'imgfield-input' });
  const btn = el('button', { class: 'btn-ghost imgfield-btn', type: 'button' }, 'Choose image');
  const thumb = el('div', { class: 'imgfield-thumbs' });
  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => readFiles(file.files, (arr) => { if (arr[0]) controls.set(field.key, arr[0]); }));
  wrap.appendChild(btn); wrap.appendChild(file); wrap.appendChild(thumb);
  const sync = () => {
    thumb.innerHTML = '';
    const v = controls.get(field.key);
    if (v) {
      const t = el('div', { class: 'thumb' });
      t.style.backgroundImage = `url("${v}")`;
      const x = el('button', { class: 'thumb-x', type: 'button' }, '×');
      x.addEventListener('click', () => controls.set(field.key, ''));
      t.appendChild(x); thumb.appendChild(t);
    }
  };
  return { node: row(field.label, wrap, { stack: true }), sync };
}

function buildImages(field, controls) {
  const wrap = el('div', { class: 'imgfield' });
  const file = el('input', { type: 'file', accept: 'image/*,video/*', multiple: 'multiple', class: 'imgfield-input' });
  const btn = el('button', { class: 'btn-ghost imgfield-btn', type: 'button' }, 'Add media');
  const thumbs = el('div', { class: 'imgfield-thumbs' });
  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', () => readFiles(file.files, (arr) => {
    const cur = (controls.get(field.key) || []).concat(arr);
    controls.set(field.key, cur);
  }));
  wrap.appendChild(btn); wrap.appendChild(file); wrap.appendChild(thumbs);
  const sync = () => {
    thumbs.innerHTML = '';
    const list = controls.get(field.key) || [];
    list.forEach((url, i) => {
      const t = el('div', { class: 'thumb' });
      if (!/\.(mp4|webm|mov|m4v|ogv)$/i.test(url) && !url.startsWith('data:video')) t.style.backgroundImage = `url("${url}")`;
      else t.classList.add('thumb--video');
      const x = el('button', { class: 'thumb-x', type: 'button' }, '×');
      x.addEventListener('click', () => {
        const next = (controls.get(field.key) || []).slice();
        next.splice(i, 1); controls.set(field.key, next);
      });
      t.appendChild(x); thumbs.appendChild(t);
    });
  };
  return { node: row(field.label, wrap, { stack: true }), sync };
}

function buildFont(field, controls) {
  const sel = el('select', { class: 'select' });
  FONT_OPTIONS.forEach((f) => sel.appendChild(el('option', { value: f }, f)));
  sel.addEventListener('change', () => controls.set(field.key, sel.value));
  const sync = () => {
    const v = controls.get(field.key);
    const fam = typeof v === 'string' ? v : (v && v.family) || 'system-ui';
    if (!FONT_OPTIONS.includes(fam)) sel.appendChild(el('option', { value: fam }, fam));
    sel.value = fam;
  };
  return { node: row(field.label, sel), sync };
}

function buildAction(field, controls) {
  const btn = el('button', { class: 'btn-ghost btn-action', type: 'button' }, field.label);
  btn.addEventListener('click', () => controls.triggerAction(field.action));
  return { node: row(null, btn), sync: () => {} };
}

// A compact grid of small action buttons (e.g. alignment).
function buildActions(field, controls) {
  const grid = el('div', { class: 'actionbar' });
  (field.items || []).forEach((it) => {
    const b = el('button', { class: 'actionbar-btn', type: 'button', title: it.title || it.label }, it.label);
    b.addEventListener('click', () => controls.triggerAction(it.action));
    grid.appendChild(b);
  });
  return { node: row(field.label, grid, { stack: true }), sync: () => {} };
}

// Static helper text inside the panel.
function buildNote(field) {
  return { node: el('p', { class: 'field-note' }, field.text || ''), sync: () => {} };
}

const BUILDERS = {
  segmented: buildSegmented,
  select: buildSelect,
  slider: buildSlider,
  color: (f, c) => buildColor(f, c, false),
  colorAlpha: (f, c) => buildColor(f, c, true),
  text: buildText,
  textarea: buildTextarea,
  toggle: buildToggle,
  image: buildImage,
  video: buildVideo,
  images: buildImages,
  font: buildFont,
  action: buildAction,
  actions: buildActions,
  note: buildNote
};

/**
 * Build a field widget. Returns { node, sync } where sync() refreshes the widget from
 * the control store. Unknown field types render nothing.
 */
export function buildField(field, controls) {
  const fn = BUILDERS[field.type];
  if (!fn) { console.warn('Unknown field type:', field.type); return { node: el('div'), sync: () => {} }; }
  const built = fn(field, controls);
  built.sync();
  return built;
}
