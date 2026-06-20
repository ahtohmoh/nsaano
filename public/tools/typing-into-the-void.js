// tools/typing-into-the-void.js
//
// "Typing Into The Void" — a faithful recreation of the BRIK keyboard-typing engine,
// repackaged as a Nsaano tool module. The rendering logic (skins, gallery, overlays,
// glow) is ported 1:1 from the reference export so behaviour matches; the wrapper around
// it (controlSchema, lifecycle) is what makes it a pluggable tool.

const KEYBOARD_LAYOUT = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/']
];

const KEY_MAP = {};
KEYBOARD_LAYOUT.forEach((rowArr, rowIndex) => {
  rowArr.forEach((key, colIndex) => { KEY_MAP[key] = { row: rowIndex, col: colIndex, label: key }; });
});
KEY_MAP[' '] = { row: -1, col: -1, label: ' ' };
KEY_MAP['\n'] = { row: -1, col: -1, label: 'ENTER' };

function hexToRgb(hex) {
  if (!hex) return { r: 255, g: 255, b: 255 };
  const shorthand = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const full = hex.replace(shorthand, (m, r, g, b) => r + r + g + g + b + b);
  const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(full);
  return res ? { r: parseInt(res[1], 16), g: parseInt(res[2], 16), b: parseInt(res[3], 16) } : { r: 0, g: 0, b: 0 };
}

function applyCasing(str, casing) {
  if (!str) return '';
  if (casing === 'All Caps') return str.toUpperCase();
  if (casing === 'Lowercase') return str.toLowerCase();
  if (casing === 'Sentence Case') return str.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  if (casing === 'Title Case') return str.replace(/\b\w/g, (l) => l.toUpperCase());
  return str;
}

function getFontStylePrefix(style) {
  if (style === 'Bold') return 'bold ';
  if (style === 'Italic') return 'italic ';
  if (style === 'Bold Italic') return 'bold italic ';
  return '';
}

const HANDLE_SIZE = 14;

// Time source: prefer the studio clock (set by app.js) so the video exporter can step
// frames at exact times; fall back to performance.now() (e.g. in the standalone export,
// where the global is absent) so the animation still runs in real time.
function clockNow() { const c = (typeof window !== 'undefined') && window.__nsaanoClock; return c ? c.now() : performance.now(); }
function clockManual() { const c = (typeof window !== 'undefined') && window.__nsaanoClock; return !!(c && c.isManual()); }

// ─── control schema (drives panel UI, AI tool spec, and export) ──────────────
const controlSchema = [
  { title: 'Mode & Layout', fields: [
    { key: 'displayMode', type: 'segmented', label: 'Display Mode', options: ['Keyboard', 'Gallery'] },
    { key: 'layoutMode', type: 'segmented', label: 'Layout Mode', options: ['Compact', 'Spread'] },
    { key: 'canvasRatio', type: 'select', label: 'Canvas Aspect Ratio', options: [
      'Responsive', 'Portrait: 1080 x 1350 (4:5)', 'Square: 1080 x 1080 (1:1)',
      'Landscape: 1920 x 1080 (16:9)', 'Stories: 1080 x 1920 (9:16)', 'Custom'
    ] },
    { key: 'keySkin', type: 'select', label: 'Key Skin', options: ['Classic', 'Cyber Hack', 'Fingerprint', 'Hologram', 'Terminal', 'Neon Arcade'] },
    { key: 'keyMaterial', type: 'select', label: 'Key Material', options: ['Glass', 'Plastic', 'Metal', 'Matte'] },
    { key: 'keyFillType', type: 'select', label: 'Key Fill Type', options: ['Plain', 'Gradient'] },
    { key: 'keyShape', type: 'select', label: 'Key Shape', options: ['Rounded', 'Square', 'Circle'] },
    { key: 'keyScale', type: 'slider', label: 'Key Scale (Size)', min: 0.2, max: 2, step: 0.05 },
    { key: 'keySpacing', type: 'slider', label: 'Key Spacing', min: 0, max: 60, step: 1 },
    { key: 'keyAspectRatio', type: 'slider', label: 'Key Aspect Ratio', min: 0.5, max: 2, step: 0.05 },
    { key: 'keyRoundness', type: 'slider', label: 'Key Roundness', min: 0, max: 40, step: 1 }
  ] },
  { title: 'Text Settings', fields: [
    { key: 'keyFontSize', type: 'slider', label: 'Key Font Size', min: 8, max: 60, step: 1 },
    { key: 'keyFontWeight', type: 'slider', label: 'Key Font Weight', min: 100, max: 900, step: 100 },
    { key: 'fontColor', type: 'color', label: 'Key Text Color' },
    { key: 'showFill', type: 'toggle', label: 'Show Fill' },
    { key: 'fillColor', type: 'color', label: 'Fill Color' },
    { key: 'showStroke', type: 'toggle', label: 'Show Stroke' },
    { key: 'strokeColor', type: 'color', label: 'Stroke Color' },
    { key: 'showGlow', type: 'toggle', label: 'Show Glow' },
    { key: 'glow', type: 'slider', label: 'Glow', min: 0, max: 60, step: 1 },
    { key: 'glowColor', type: 'color', label: 'Glow Color' },
    { key: 'cpm', type: 'slider', label: 'Typing Speed (cpm)', min: 60, max: 1500, step: 10 },
    { key: 'jitter', type: 'slider', label: 'Rhythm Jitter', min: 0, max: 1, step: 0.05 },
    { key: 'persistence', type: 'slider', label: 'Key Persistence (s)', min: 0.2, max: 8, step: 0.1 },
    { key: 'keysPosX', type: 'slider', label: 'Keys Position X', min: -400, max: 400, step: 1 },
    { key: 'keysPosY', type: 'slider', label: 'Keys Position Y', min: -400, max: 400, step: 1 },
    { key: 'keyRandomness', type: 'slider', label: 'Key Randomness', min: 0, max: 30, step: 1 }
  ] },
  { title: 'Text Content', fields: [
    { key: 'text', type: 'textarea', label: 'Text Content', rows: 4, placeholder: 'What does Piqabu want to say?' },
    { key: 'textCase', type: 'select', label: 'Text Casing', options: ['Original', 'All Caps', 'Lowercase', 'Title Case', 'Sentence Case'] },
    { key: 'textStyle', type: 'select', label: 'Text Style', options: ['Normal', 'Bold', 'Italic', 'Bold Italic'] },
    { key: 'textUnderline', type: 'toggle', label: 'Underline Text' },
    { key: 'showTextLine', type: 'toggle', label: 'Show Text Line' },
    { key: 'lineFontSize', type: 'slider', label: 'Line Font Size', min: 8, max: 80, step: 1 },
    { key: 'lineFontWeight', type: 'slider', label: 'Line Weight', min: 100, max: 900, step: 50 },
    { key: 'textLineColor', type: 'color', label: 'Text Line Color' },
    { key: 'fontFamily', type: 'font', label: 'Font Family' }
  ] },
  { title: 'Overlays & Draggable Text', fields: [
    { key: 'textOverlayInput', type: 'text', label: 'Overlay Text', placeholder: '#Piqabu #NowhereElse' },
    { key: 'textOverlayType', type: 'select', label: 'Overlay Type', options: ['Static', 'Animated (Typing)'] },
    { key: 'textOverlayColor', type: 'color', label: 'Overlay Color' },
    { key: 'textOverlayCase', type: 'select', label: 'Overlay Casing', options: ['Original', 'All Caps', 'Lowercase', 'Title Case'] },
    { key: 'textOverlayStyle', type: 'select', label: 'Overlay Style', options: ['Normal', 'Bold', 'Italic', 'Bold Italic'] },
    { key: 'textOverlayUnderline', type: 'toggle', label: 'Overlay Underline' },
    { key: 'textOverlayCpm', type: 'slider', label: 'Overlay Typing (cpm)', min: 60, max: 1500, step: 10 },
    { type: 'action', label: 'Add Text Overlay', action: 'addTextOverlay' },
    { key: 'lottieUrl', type: 'text', label: 'Media URL', placeholder: 'image / video / lottie url' },
    { type: 'action', label: 'Add Media By URL', action: 'addLottieUrl' },
    { key: 'overlayAssets', type: 'images', label: 'Upload Overlay Media' },
    { type: 'action', label: 'Clear Overlays', action: 'clearOverlays' },
    { key: 'snapEnabled', type: 'toggle', label: 'Snap & Guides' },
    { type: 'note', text: 'Drag text on the canvas to position it — guides snap to center & edges. Double-click a text overlay to edit it. Select one, then align:' },
    { type: 'actions', label: 'Align Selected', items: [
      { label: 'Left', action: 'alignLeft' }, { label: 'Center H', action: 'alignCenterH' }, { label: 'Right', action: 'alignRight' },
      { label: 'Top', action: 'alignTop' }, { label: 'Middle V', action: 'alignCenterV' }, { label: 'Bottom', action: 'alignBottom' }
    ] }
  ] },
  { title: 'Gallery', fields: [
    { key: 'galleryImages', type: 'images', label: 'Gallery Media' },
    { key: 'galleryFullscreen', type: 'toggle', label: 'Fullscreen Grid' },
    { key: 'galleryCols', type: 'slider', label: 'Columns', min: 1, max: 12, step: 1 },
    { key: 'galleryRows', type: 'slider', label: 'Rows', min: 1, max: 12, step: 1 },
    { key: 'galleryGap', type: 'slider', label: 'Gap', min: 0, max: 40, step: 1 },
    { key: 'galleryRevealSpeed', type: 'slider', label: 'Reveal Speed', min: 60, max: 2000, step: 20 },
    { key: 'galleryPersistence', type: 'slider', label: 'Persistence (s)', min: 0.5, max: 10, step: 0.5 },
    { key: 'galleryFit', type: 'select', label: 'Fit', options: ['cover', 'contain'] }
  ] },
  { title: 'Video Background', fields: [
    { key: 'useBgVideo', type: 'toggle', label: 'Enable Video Background' },
    { key: 'bgVideoUrl', type: 'text', label: 'Video URL', placeholder: 'https://…/clip.mp4' }
  ] },
  { title: 'Ambient Canvas Glow', fields: [
    { key: 'canvasGlowActive', type: 'toggle', label: 'Enable Canvas Glow' },
    { key: 'canvasGlowColor', type: 'color', label: 'Glow Color' },
    { key: 'canvasGlowIntensity', type: 'slider', label: 'Glow Intensity', min: 0, max: 150, step: 1 },
    { key: 'canvasGlowPulseSpeed', type: 'slider', label: 'Pulse Speed', min: 0, max: 5, step: 0.1 }
  ] },
  { title: 'Key Colors', fields: [
    { key: 'randomKeyColors', type: 'toggle', label: 'Random Key Colors' },
    { key: 'paletteA', type: 'color', label: 'Palette A' },
    { key: 'paletteB', type: 'color', label: 'Palette B' },
    { key: 'paletteC', type: 'color', label: 'Palette C' },
    { key: 'paletteD', type: 'color', label: 'Palette D' },
    { key: 'paletteE', type: 'color', label: 'Palette E' }
  ] },
  { title: 'Background', fields: [
    { key: 'bgMode', type: 'segmented', label: 'Background', options: ['None', 'Solid', 'Image'] },
    { key: 'bgColor', type: 'color', label: 'Background Color' },
    { key: 'bgImage', type: 'image', label: 'Background Image' },
    { key: 'bgFit', type: 'select', label: 'Image Fit', options: ['cover', 'contain', 'fill'] }
  ] },
  { title: 'Playback', fields: [
    { key: 'playing', type: 'toggle', label: 'Animate' },
    { type: 'action', label: 'Reset Animation', action: 'reset' }
  ] }
];

const defaults = {
  displayMode: 'Keyboard', layoutMode: 'Compact', canvasRatio: 'Portrait: 1080 x 1350 (4:5)',
  canvasWidth: 1080, canvasHeight: 1350,
  keySkin: 'Classic', keyMaterial: 'Glass', keyFillType: 'Plain', keyShape: 'Rounded',
  keyScale: 0.95, keySpacing: 15, keyAspectRatio: 1, keyRoundness: 6,
  keyFontSize: 20, keyFontWeight: 700, fontColor: '#000000',
  showFill: true, fillColor: '#FFFFFF', showStroke: true, strokeColor: '#FFFFFF',
  showGlow: true, glow: 19, glowColor: '#FFFFFF',
  cpm: 500, jitter: 0.1, persistence: 1, keysPosX: 66, keysPosY: -1, keyRandomness: 0,
  text: 'Privacy, made quiet.\nConversations that live in two minds and nowhere else.',
  textCase: 'Title Case', textStyle: 'Normal', textUnderline: false,
  showTextLine: true, lineFontSize: 26, lineFontWeight: 200, textLineColor: '#FFFFFF',
  fontFamily: 'system-ui',
  textOverlayInput: '#Piqabu #NowhereElse', textOverlayType: 'Static', textOverlayCpm: 500,
  textOverlayCase: 'Original', textOverlayStyle: 'Normal', textOverlayUnderline: false, textOverlayColor: '#FFFFFF',
  lottieUrl: '', overlayAssets: [],
  galleryImages: [], galleryFullscreen: true, galleryCols: 6, galleryRows: 4, galleryGap: 6,
  galleryRevealSpeed: 600, galleryPersistence: 4, galleryFit: 'cover',
  useBgVideo: false, bgVideoUrl: '',
  canvasGlowActive: true, canvasGlowColor: '#FFFFFF', canvasGlowIntensity: 60, canvasGlowPulseSpeed: 1.2,
  randomKeyColors: false, paletteA: '#FF3B30', paletteB: '#FFCC00', paletteC: '#34C759', paletteD: '#007AFF', paletteE: '#AF52DE',
  playing: true, snapEnabled: true,
  bgMode: 'Solid', bgColor: '#000000', bgImage: '', bgFit: 'cover',
  // seeded composition: one hashtag overlay, no heavy embedded media
  overlayState: { version: 3, items: [
    { id: 'o_seedhash', kind: 'text', text: '#Piqabu #NowhereElse', color: '#FFFFFF', fontSize: 32,
      x: 383, y: 1187, w: 327, h: 38, textType: 'Static', casing: 'Original', style: 'Normal', underline: false, cpm: 500, typingIndex: 20 }
  ], library: [] },
  textLinePos: null
};

// ─── the tool ────────────────────────────────────────────────────────────────
export default {
  id: 'typing-into-the-void',
  name: 'Typing Into The Void',
  description: 'A keyboard-typing animation: text types itself across a glowing keyboard, with overlays, a gallery mode, and ambient glow. Tuned for Piqabu social posts.',
  controlSchema,
  defaults,

  init(host) {
    const { canvas, ctx, controls, runtime } = host;
    const self = this;
    this._host = host;
    const unsubs = [];

    // ── per-instance state ──
    let typedChars = [];
    let typingIndex = 0;
    let nextTypeTime = 0;
    let resetScheduled = false;

    let revealedFrames = [];
    let galleryRevealIndex = 0;
    let nextRevealTime = 0;
    const mediaCache = new Map();

    let textLinePos = null;
    let isDraggingText = false;
    let dragOffset = { x: 0, y: 0 };
    let lastTextBounds = null;
    let hoveringText = false;

    let overlayItems = [];
    let overlayLibrary = [];
    const assetCache = new Map();
    let draggingOverlay = null;
    let hoveringOverlayId = null;
    let selectedOverlayId = null;
    let editingOverlayId = null;
    let activeGuides = [];
    let lottieHostContainer = null;

    let bgVideoEl = null;
    let bgVideoReady = false;
    let lastBgVideoUrl = '';

    // ── canvas sizing ──
    function updateCanvasSize() {
      const area = canvas.parentElement;
      if (!area) return;
      const ratioMode = controls.get('canvasRatio') || 'Responsive';
      if (ratioMode === 'Responsive') {
        canvas.width = area.clientWidth;
        canvas.height = area.clientHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        return;
      }
      let w, h;
      if (ratioMode === 'Custom') { w = controls.get('canvasWidth') || 1080; h = controls.get('canvasHeight') || 1350; }
      else if (ratioMode.includes('Portrait')) { w = 1080; h = 1350; }
      else if (ratioMode.includes('Square')) { w = 1080; h = 1080; }
      else if (ratioMode.includes('Landscape')) { w = 1920; h = 1080; }
      else if (ratioMode.includes('Stories')) { w = 1080; h = 1920; }
      else { w = 1080; h = 1350; }
      canvas.width = w; canvas.height = h;
      const areaAspect = area.clientWidth / area.clientHeight;
      const canvasAspect = w / h;
      if (areaAspect > canvasAspect) { canvas.style.height = '100%'; canvas.style.width = 'auto'; }
      else { canvas.style.width = '100%'; canvas.style.height = 'auto'; }
    }
    this._updateCanvasSize = updateCanvasSize;
    const onResize = () => updateCanvasSize();
    window.addEventListener('resize', onResize);
    unsubs.push(() => window.removeEventListener('resize', onResize));
    unsubs.push(controls.onChange('canvasRatio', updateCanvasSize));
    unsubs.push(controls.onChange('canvasWidth', updateCanvasSize));
    unsubs.push(controls.onChange('canvasHeight', updateCanvasSize));

    // ── background wiring ──
    function syncBackground() {
      const mode = (controls.get('bgMode') || 'None').toLowerCase();
      runtime.setBackground({ mode, color: controls.get('bgColor') || '#000000', image: controls.get('bgImage') || '', fit: controls.get('bgFit') || 'cover' });
    }
    ['bgMode', 'bgColor', 'bgImage', 'bgFit'].forEach((k) => unsubs.push(controls.onChange(k, syncBackground)));
    syncBackground();

    // ── video background ──
    function updateBgVideo() {
      const useBgVideo = controls.get('useBgVideo');
      const url = controls.get('bgVideoUrl');
      if (!useBgVideo || !url) { if (bgVideoEl) bgVideoEl.pause(); return; }
      if (url === lastBgVideoUrl && bgVideoEl) { if (bgVideoEl.paused) bgVideoEl.play().catch(() => {}); return; }
      lastBgVideoUrl = url;
      bgVideoReady = false;
      if (bgVideoEl) { bgVideoEl.pause(); bgVideoEl.src = ''; }
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous';
      v.addEventListener('loadeddata', () => { bgVideoReady = true; v.play().catch(() => {}); });
      bgVideoEl = v;
    }
    unsubs.push(controls.onChange('useBgVideo', updateBgVideo));
    unsubs.push(controls.onChange('bgVideoUrl', updateBgVideo));
    updateBgVideo();

    // ── reset / replay ──
    function reset() {
      typingIndex = 0; typedChars = []; nextTypeTime = clockNow(); resetScheduled = false;
      revealedFrames = []; galleryRevealIndex = 0; nextRevealTime = clockNow();
      overlayItems.forEach((item) => {
        if (item.kind === 'text' && item.textType === 'Animated (Typing)') { item.typingIndex = 0; item.nextTypeTime = clockNow(); }
      });
    }
    unsubs.push(controls.onAction('reset', reset));
    ['text', 'displayMode', 'galleryImages', 'galleryCols', 'galleryRows'].forEach((k) => unsubs.push(controls.onChange(k, reset)));

    // ── overlay assets ──
    function detectAssetKind(url) {
      if (!url) return 'image';
      const u = url.toLowerCase().split('?')[0];
      if (/\.(mp4|webm|mov|m4v|ogv)$/.test(u) || url.startsWith('data:video')) return 'video';
      if (/\.svg$/.test(u)) return 'svg';
      if (/\.json$/.test(u) || u.includes('lottie')) return 'lottie';
      return 'image';
    }
    function ensureLottieHost() {
      if (lottieHostContainer) return lottieHostContainer;
      lottieHostContainer = document.createElement('div');
      lottieHostContainer.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
      document.body.appendChild(lottieHostContainer);
      return lottieHostContainer;
    }
    function loadAsset(assetId, url, kind) {
      if (assetCache.has(assetId)) return assetCache.get(assetId);
      const entry = { kind, ready: false, el: null, lottieAnim: null };
      if (kind === 'video') {
        const v = document.createElement('video');
        v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous';
        v.addEventListener('loadeddata', () => { entry.ready = true; v.play().catch(() => {}); });
        entry.el = v;
      } else if (kind === 'lottie' && typeof window.lottie !== 'undefined') {
        const host2 = ensureLottieHost();
        const div = document.createElement('div'); div.style.cssText = 'width:512px;height:512px;'; host2.appendChild(div);
        try {
          const anim = window.lottie.loadAnimation({ container: div, renderer: 'canvas', loop: true, autoplay: true, path: url });
          anim.addEventListener('DOMLoaded', () => { const c = div.querySelector('canvas'); if (c) { entry.el = c; entry.ready = true; } });
          entry.lottieAnim = anim;
        } catch (e) { entry.kind = 'image'; }
      } else {
        const img = new Image();
        if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => { entry.ready = true; };
        img.onerror = () => { entry.ready = false; };
        img.src = url; entry.el = img; entry.kind = 'image';
      }
      assetCache.set(assetId, entry);
      return entry;
    }
    function makeId() { return 'o_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

    function persistOverlays() {
      controls.set('overlayState', {
        version: 3,
        items: overlayItems.map((it) => ({
          id: it.id, assetId: it.assetId, kind: it.kind, text: it.text, color: it.color, fontSize: it.fontSize,
          x: it.x, y: it.y, w: it.w, h: it.h, textType: it.textType, casing: it.casing, style: it.style,
          underline: it.underline, cpm: it.cpm, typingIndex: it.typingIndex
        })),
        library: overlayLibrary.map((a) => ({ id: a.id, url: a.url, kind: a.kind }))
      });
    }
    function applyOverlayState(s) {
      if (!s || !Array.isArray(s.items)) { overlayItems = []; overlayLibrary = []; return; }
      overlayLibrary = Array.isArray(s.library) ? s.library.map((a) => ({ id: a.id, url: a.url, kind: a.kind })) : [];
      overlayItems = s.items.map((it) => ({
        id: it.id, assetId: it.assetId, kind: it.kind, text: it.text, color: it.color, fontSize: it.fontSize,
        x: it.x, y: it.y, w: it.w, h: it.h, textType: it.textType || 'Static', casing: it.casing || 'Original',
        style: it.style || 'Normal', underline: !!it.underline, cpm: it.cpm || 500,
        typingIndex: typeof it.typingIndex === 'number' ? it.typingIndex : (it.text ? it.text.length : 0),
        nextTypeTime: clockNow()
      }));
      overlayLibrary.forEach((a) => loadAsset(a.id, a.url, a.kind));
    }
    applyOverlayState(controls.get('overlayState'));
    // Note: we intentionally don't re-subscribe applyOverlayState to its own writes (persistOverlays),
    // which would clobber live drag state.

    function syncOverlayAssets(urls) {
      if (!Array.isArray(urls)) return;
      let changed = false;
      urls.forEach((url) => {
        if (!url) return;
        if (overlayLibrary.find((a) => a.url === url)) return;
        const id = makeId();
        const kind = detectAssetKind(url);
        overlayLibrary.push({ id, url, kind });
        loadAsset(id, url, kind);
        const cw = canvas.width || 800; const ch = canvas.height || 600;
        const w = Math.min(240, cw * 0.25); const h = w;
        overlayItems.push({ id: makeId(), assetId: id, kind: 'media',
          x: cw / 2 - w / 2 + (Math.random() - 0.5) * 80, y: ch / 2 - h / 2 + (Math.random() - 0.5) * 80, w, h });
        changed = true;
      });
      if (changed) persistOverlays();
    }
    unsubs.push(controls.onChange('overlayAssets', syncOverlayAssets));
    syncOverlayAssets(controls.get('overlayAssets') || []);

    unsubs.push(controls.onAction('addLottieUrl', () => {
      const url = (controls.get('lottieUrl') || '').trim();
      if (!url) return;
      const kind = detectAssetKind(url);
      const existing = overlayLibrary.find((a) => a.url === url);
      let assetId;
      if (existing) { assetId = existing.id; }
      else { assetId = makeId(); overlayLibrary.push({ id: assetId, url, kind }); loadAsset(assetId, url, kind); }
      const cw = canvas.width || 800; const ch = canvas.height || 600;
      const w = Math.min(240, cw * 0.25); const h = w;
      overlayItems.push({ id: makeId(), assetId, kind: 'media',
        x: cw / 2 - w / 2 + (Math.random() - 0.5) * 80, y: ch / 2 - h / 2 + (Math.random() - 0.5) * 80, w, h });
      persistOverlays();
    }));

    unsubs.push(controls.onAction('addTextOverlay', () => {
      const textVal = (controls.get('textOverlayInput') || '').trim();
      if (!textVal) return;
      const textType = controls.get('textOverlayType') || 'Static';
      const cw = canvas.width || 800; const ch = canvas.height || 600;
      overlayItems.push({
        id: makeId(), kind: 'text', textType, text: textVal,
        color: controls.get('textOverlayColor') || '#FFFFFF', fontSize: 32,
        casing: controls.get('textOverlayCase') || 'Original', style: controls.get('textOverlayStyle') || 'Normal',
        underline: controls.get('textOverlayUnderline') || false, cpm: controls.get('textOverlayCpm') || 500,
        typingIndex: textType === 'Animated (Typing)' ? 0 : textVal.length, nextTypeTime: clockNow(),
        x: cw / 2 - 100 + (Math.random() - 0.5) * 80, y: ch / 2 - 20 + (Math.random() - 0.5) * 80, w: 200, h: 40
      });
      persistOverlays();
    }));

    unsubs.push(controls.onAction('clearOverlays', () => { overlayItems = []; selectedOverlayId = null; persistOverlays(); }));

    // ── text-line position ──
    function applyTextLineState(s) { textLinePos = (s && typeof s.x === 'number' && typeof s.y === 'number') ? { x: s.x, y: s.y } : null; }
    applyTextLineState(controls.get('textLinePos'));

    // ── helpers ──
    function getSafeFontFamily() {
      const f = controls.get('fontFamily') || 'monospace';
      const family = typeof f === 'string' ? f : (f.family || 'monospace');
      return family.includes(' ') ? `'${family}'` : family;
    }
    function applyFontVariation(c, prefix) {
      const wght = controls.get(prefix + 'Weight') || 400;
      const settings = `'wght' ${wght}, 'wdth' 100`;
      if ('fontVariationSettings' in c) c.fontVariationSettings = settings;
      else c.canvas.style.fontVariationSettings = settings;
    }
    function getKeyJitter(row, col, scale) {
      if (scale === 0) return { dx: 0, dy: 0, angle: 0 };
      const h1 = Math.sin(row * 12.9898 + col * 78.233) * 43758.5453; const r1 = (h1 - Math.floor(h1)) * 2 - 1;
      const h2 = Math.sin(row * 26.19 + col * 41.13) * 43758.5453; const r2 = (h2 - Math.floor(h2)) * 2 - 1;
      const h3 = Math.sin(row * 57.12 + col * 19.84) * 43758.5453; const r3 = (h3 - Math.floor(h3)) * 2 - 1;
      return { dx: r1 * scale * 0.5, dy: r2 * scale * 0.5, angle: r3 * scale * 0.015 };
    }
    function getKeyColor(row, col, fallback) {
      if (!controls.get('randomKeyColors')) return fallback;
      const palette = [controls.get('paletteA'), controls.get('paletteB'), controls.get('paletteC'), controls.get('paletteD'), controls.get('paletteE')].filter(Boolean);
      if (palette.length === 0) return fallback;
      const h = Math.sin(row * 91.13 + col * 47.31) * 43758.5453;
      const idx = Math.floor(Math.abs(h - Math.floor(h)) * palette.length) % palette.length;
      return palette[idx];
    }
    function buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness) {
      c.beginPath();
      const lx = -kw / 2, ly = -kh / 2;
      if (keyShape === 'Circle' && !isSpace) c.arc(0, 0, Math.min(kw, kh) / 2, 0, Math.PI * 2);
      else if (keyShape === 'Square') c.rect(lx, ly, kw, kh);
      else { const rr = keyShape === 'Rounded' ? keyRoundness : 0; c.roundRect(lx, ly, kw, kh, rr); }
    }
    function drawUnderline(c, text, x, y, fontSize, align, baseline) {
      const width = c.measureText(text).width;
      let startX = x;
      if (align === 'center') startX = x - width / 2; else if (align === 'right') startX = x - width;
      let startY = y;
      if (baseline === 'top') startY = y + fontSize; else if (baseline === 'middle') startY = y + fontSize / 2; else startY = y + 2;
      c.beginPath(); c.moveTo(startX, startY); c.lineTo(startX + width, startY);
      c.lineWidth = Math.max(1, fontSize / 15); c.strokeStyle = c.fillStyle; c.stroke();
    }
    function loadMedia(url) {
      if (!url) return null;
      if (mediaCache.has(url)) return mediaCache.get(url);
      const isVideo = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url) || url.startsWith('data:video');
      const entry = { type: isVideo ? 'video' : 'image', ready: false, el: null };
      if (isVideo) {
        const v = document.createElement('video');
        v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = 'anonymous';
        v.addEventListener('loadeddata', () => { entry.ready = true; v.play().catch(() => {}); });
        entry.el = v;
      } else {
        const img = new Image();
        if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => { entry.ready = true; }; img.src = url; entry.el = img;
      }
      mediaCache.set(url, entry);
      return entry;
    }
    function drawMediaCover(c, entry, x, y, w, h, fit) {
      if (!entry || !entry.ready) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, y, w, h); return; }
      const elm = entry.el;
      const sw = entry.type === 'video' ? elm.videoWidth : (elm.naturalWidth || elm.width);
      const sh = entry.type === 'video' ? elm.videoHeight : (elm.naturalHeight || elm.height);
      if (!sw || !sh) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, y, w, h); return; }
      const srcR = sw / sh, dstR = w / h;
      let dx = x, dy = y, dw = w, dh = h;
      if (fit === 'contain') {
        if (srcR > dstR) { dh = w / srcR; dy = y + (h - dh) / 2; } else { dw = h * srcR; dx = x + (w - dw) / 2; }
        c.drawImage(elm, dx, dy, dw, dh);
      } else {
        let sx = 0, sy = 0, sCropW = sw, sCropH = sh;
        if (srcR > dstR) { sCropW = sh * dstR; sx = (sw - sCropW) / 2; } else { sCropH = sw / dstR; sy = (sh - sCropH) / 2; }
        c.drawImage(elm, sx, sy, sCropW, sCropH, x, y, w, h);
      }
    }

    // ── skins (ported 1:1) ──
    const SKIN_RENDERERS = makeSkinRenderers(buildKeyPath);

    function drawKeyClassic(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
      const { keyShape, keyRoundness, fillColor, strokeColor, fontColor, safeFont, keyFontSize, showStroke, showFill, keyMaterial, keyFillType } = opts;
      const lx = -kw / 2, ly = -kh / 2;
      buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness);
      if (showFill) {
        const rgb = hexToRgb(fillColor); let fillStyle;
        if (keyFillType === 'Plain') {
          if (keyMaterial === 'Glass') fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
          else if (keyMaterial === 'Plastic') fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`;
          else if (keyMaterial === 'Metal') fillStyle = `rgba(${rgb.r * 0.8}, ${rgb.g * 0.8}, ${rgb.b * 0.8}, 1.0)`;
          else fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1.0)`;
        } else {
          const grad = c.createLinearGradient(0, ly, 0, ly + kh);
          if (keyMaterial === 'Glass') {
            grad.addColorStop(0, 'rgba(255,255,255,0.65)'); grad.addColorStop(0.15, `rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`);
            grad.addColorStop(0.48, `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`); grad.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.1)`);
            grad.addColorStop(0.52, `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`); grad.addColorStop(0.85, `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`);
            grad.addColorStop(1, 'rgba(255,255,255,0.2)');
          } else if (keyMaterial === 'Plastic') {
            grad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 40)},${Math.min(255, rgb.g + 40)},${Math.min(255, rgb.b + 40)},0.95)`);
            grad.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)`);
            grad.addColorStop(1, `rgba(${Math.max(0, rgb.r - 40)},${Math.max(0, rgb.g - 40)},${Math.max(0, rgb.b - 40)},0.85)`);
          } else if (keyMaterial === 'Metal') {
            grad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 80)},${Math.min(255, rgb.g + 80)},${Math.min(255, rgb.b + 80)},1.0)`);
            grad.addColorStop(0.25, `rgba(${Math.max(0, rgb.r - 30)},${Math.max(0, rgb.g - 30)},${Math.max(0, rgb.b - 30)},1.0)`);
            grad.addColorStop(0.5, `rgba(${Math.min(255, rgb.r + 50)},${Math.min(255, rgb.g + 50)},${Math.min(255, rgb.b + 50)},1.0)`);
            grad.addColorStop(0.75, `rgba(${Math.max(0, rgb.r - 50)},${Math.max(0, rgb.g - 50)},${Math.max(0, rgb.b - 50)},1.0)`);
            grad.addColorStop(1, `rgba(${Math.min(255, rgb.r + 20)},${Math.min(255, rgb.g + 20)},${Math.min(255, rgb.b + 20)},1.0)`);
          } else {
            grad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 10)},${Math.min(255, rgb.g + 10)},${Math.min(255, rgb.b + 10)},1.0)`);
            grad.addColorStop(1, `rgba(${Math.max(0, rgb.r - 10)},${Math.max(0, rgb.g - 10)},${Math.max(0, rgb.b - 10)},1.0)`);
          }
          fillStyle = grad;
        }
        c.fillStyle = fillStyle; c.fill();
      }
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
      if (showStroke) {
        const strokeRgb = hexToRgb(strokeColor); let strokeStyle;
        if (keyMaterial === 'Glass') {
          const sg = c.createLinearGradient(lx, ly, lx + kw, ly + kh);
          sg.addColorStop(0, 'rgba(255,255,255,0.8)'); sg.addColorStop(0.3, `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.6)`);
          sg.addColorStop(0.7, `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.2)`); sg.addColorStop(1, 'rgba(255,255,255,0.1)');
          strokeStyle = sg;
        } else if (keyMaterial === 'Plastic') { strokeStyle = `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.4)`; }
        else if (keyMaterial === 'Metal') {
          const sg = c.createLinearGradient(0, ly, 0, ly + kh);
          sg.addColorStop(0, 'rgba(255,255,255,0.9)'); sg.addColorStop(0.5, `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.5)`); sg.addColorStop(1, 'rgba(0,0,0,0.6)');
          strokeStyle = sg;
        } else { strokeStyle = `rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},0.2)`; }
        c.strokeStyle = strokeStyle; c.lineWidth = 1.5; c.stroke();
      }
      if (showFill && (keyMaterial === 'Glass' || keyMaterial === 'Plastic')) {
        c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip();
        const highlightHeight = keyMaterial === 'Glass' ? kh * 0.45 : kh * 0.3;
        const hg = c.createLinearGradient(0, ly, 0, ly + highlightHeight);
        hg.addColorStop(0, 'rgba(255,255,255,0.5)'); hg.addColorStop(1, 'rgba(255,255,255,0.0)');
        c.fillStyle = hg; c.fillRect(lx, ly, kw, highlightHeight); c.restore();
      }
      c.fillStyle = fontColor; c.font = `${keyFontSize}px ${safeFont}, sans-serif`;
      c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 2; c.shadowOffsetY = 1;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(keyChar, 0, 0);
    }

    function drawGallery(c, timestamp) {
      const w = canvas.width, h = canvas.height;
      const images = controls.get('galleryImages') || [];
      const cols = Math.max(1, Math.floor(controls.get('galleryCols') || 6));
      const rows = Math.max(1, Math.floor(controls.get('galleryRows') || 4));
      const gap = controls.get('galleryGap') || 0;
      const fullscreen = controls.get('galleryFullscreen');
      const fit = controls.get('galleryFit') || 'cover';
      const persistence = (controls.get('galleryPersistence') || 4) * 1000;
      const cpm = controls.get('galleryRevealSpeed') || 600;
      const showStroke = controls.get('showStroke');
      const strokeColor = controls.get('strokeColor');
      const keyRoundness = controls.get('keyRoundness');
      const keyShape = controls.get('keyShape');
      const keyRandomness = controls.get('keyRandomness') || 0;
      const showGlow = controls.get('showGlow');
      const glow = controls.get('glow');
      const glowColor = controls.get('glowColor');
      const totalCells = cols * rows;

      if (controls.get('playing') && galleryRevealIndex < totalCells && timestamp > nextRevealTime) {
        revealedFrames.push({ cellIndex: galleryRevealIndex, time: timestamp });
        galleryRevealIndex++;
        const baseDelay = (60 / cpm) * 1000;
        const jitter = controls.get('jitter') || 0;
        const jitterAmount = baseDelay * jitter * (Math.random() - 0.5) * 2;
        nextRevealTime = timestamp + Math.max(20, baseDelay + jitterAmount);
      }
      revealedFrames = revealedFrames.filter((f) => timestamp - f.time < persistence);
      if (galleryRevealIndex >= totalCells && revealedFrames.length === 0 && images.length > 0) galleryRevealIndex = 0;

      let areaX, areaY, areaW, areaH;
      if (fullscreen) { areaX = 0; areaY = 0; areaW = w; areaH = h; }
      else { const margin = Math.min(w, h) * 0.06; areaX = margin; areaY = margin; areaW = w - margin * 2; areaH = h - margin * 2; }
      const cellW = (areaW - gap * (cols - 1)) / cols;
      const cellH = (areaH - gap * (rows - 1)) / rows;

      revealedFrames.forEach((frame) => {
        const r = Math.floor(frame.cellIndex / cols); const col = frame.cellIndex % cols;
        const x = areaX + col * (cellW + gap); const y = areaY + r * (cellH + gap);
        const alpha = Math.max(0, 1 - (timestamp - frame.time) / persistence);
        if (alpha <= 0) return;
        const imgUrl = images.length > 0 ? images[frame.cellIndex % images.length] : null;
        const entry = imgUrl ? loadMedia(imgUrl) : null;
        c.save(); c.globalAlpha = alpha;
        const jitterVal = getKeyJitter(r, col, keyRandomness);
        c.translate(x + cellW / 2 + jitterVal.dx, y + cellH / 2 + jitterVal.dy); c.rotate(jitterVal.angle);
        const lx = -cellW / 2, ly = -cellH / 2;
        c.save(); buildKeyPath(c, keyShape, cellW, cellH, false, keyRoundness); c.clip();
        if (showGlow && glow > 0) { c.shadowBlur = glow * alpha; c.shadowColor = glowColor; }
        if (!entry) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(lx, ly, cellW, cellH); }
        else drawMediaCover(c, entry, lx, ly, cellW, cellH, fit);
        c.restore();
        if (showStroke) {
          buildKeyPath(c, keyShape, cellW, cellH, false, keyRoundness);
          const sRgb = hexToRgb(strokeColor);
          c.strokeStyle = `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 0.6)`; c.lineWidth = 1.5; c.stroke();
        }
        c.restore();
      });
    }

    function drawKeyboard(c, timestamp) {
      const w = canvas.width, h = canvas.height;
      const layoutMode = controls.get('layoutMode') || 'Compact';
      const keySpacing = controls.get('keySpacing');
      const keySpacingVal = (keySpacing == null) ? 8 : keySpacing;
      const keyScale = controls.get('keyScale') || 1.0;
      const keysPosX = controls.get('keysPosX') || 0;
      const keysPosY = controls.get('keysPosY') || 0;
      const keyAspectRatio = controls.get('keyAspectRatio') || 1.0;
      const strokeColor = controls.get('strokeColor');
      const fillColor = controls.get('fillColor');
      const fontColor = controls.get('fontColor');
      const safeFont = getSafeFontFamily();
      const showStroke = controls.get('showStroke');
      const showFill = controls.get('showFill');
      const showGlow = controls.get('showGlow');
      const glow = controls.get('glow');
      const glowColor = controls.get('glowColor');
      const persistence = controls.get('persistence') * 1000;
      const keyRoundness = controls.get('keyRoundness');
      const keyShape = controls.get('keyShape');
      const keyFontSize = (controls.get('keyFontSize') || 20) * keyScale;
      const keyMaterial = controls.get('keyMaterial') || 'Glass';
      const keyFillType = controls.get('keyFillType') || 'Plain';
      const keyRandomness = controls.get('keyRandomness') || 0;
      const keySkin = controls.get('keySkin') || 'Classic';

      function pressProgressFor(activeInstance) {
        if (!activeInstance) return 0;
        const age = timestamp - activeInstance.time;
        const pressDuration = Math.min(persistence * 0.35, 500);
        if (age >= pressDuration) return 0;
        return 1 - (age / pressDuration);
      }

      let kbWidth, startX, startY, rowOffsetScale;
      if (layoutMode === 'Spread') {
        kbWidth = w; startX = keysPosX; rowOffsetScale = 0;
        const maxKeysInRow = Math.max(...KEYBOARD_LAYOUT.map((r) => r.length));
        const tentativeKeyW = ((kbWidth - (maxKeysInRow - 1) * keySpacingVal) / maxKeysInRow) * keyScale;
        const tentativeKeyH = tentativeKeyW / keyAspectRatio;
        const totalH = KEYBOARD_LAYOUT.length * tentativeKeyH + (KEYBOARD_LAYOUT.length - 1) * keySpacingVal;
        startY = (h - totalH) / 2 + keysPosY;
      } else {
        kbWidth = Math.min(w * 0.9, 1000); startX = (w - kbWidth) / 2 + keysPosX; startY = (h / 2) + keysPosY; rowOffsetScale = 20;
      }

      const skinOpts = { keyShape, keyRoundness, fillColor, strokeColor, fontColor, safeFont, keyFontSize, showStroke, showFill, showGlow, glow, glowColor, keyMaterial, keyFillType };
      const maxKeysInRow = Math.max(...KEYBOARD_LAYOUT.map((r) => r.length));
      const uniformKeyW = ((kbWidth - (maxKeysInRow - 1) * keySpacingVal) / maxKeysInRow) * keyScale;
      const uniformKeyH = uniformKeyW / keyAspectRatio;

      KEYBOARD_LAYOUT.forEach((rowArr, r) => {
        const keysInRow = rowArr.length;
        const rowOffset = layoutMode === 'Spread' ? 0 : r * rowOffsetScale;
        const rowContentW = keysInRow * uniformKeyW + (keysInRow - 1) * keySpacingVal;
        const rowStartX = startX + rowOffset + (kbWidth - rowOffset - rowContentW) / 2;
        rowArr.forEach((key, col) => {
          const kw = uniformKeyW, kh = uniformKeyH;
          const x = rowStartX + col * (uniformKeyW + keySpacingVal);
          const y = startY + r * (uniformKeyH + keySpacingVal);
          const activeInstance = typedChars.find((tc) => tc.key === key && timestamp - tc.time < persistence);
          const alpha = activeInstance ? Math.max(0, 1 - (timestamp - activeInstance.time) / persistence) : 0;
          if (alpha <= 0) return;
          const pressProgress = pressProgressFor(activeInstance);
          const isSpace = key === 'SPACE'; const displayChar = isSpace ? '' : key;
          c.save(); c.globalAlpha = alpha;
          const jitterVal = getKeyJitter(r, col, keyRandomness);
          c.translate(x + kw / 2 + jitterVal.dx, y + kh / 2 + jitterVal.dy); c.rotate(jitterVal.angle);
          if (keySkin === 'Classic') {
            if (activeInstance && showGlow && glow > 0) { c.shadowBlur = glow * alpha; c.shadowColor = glowColor; c.shadowOffsetY = 2 * alpha; }
            else { c.shadowBlur = 6 * alpha; c.shadowColor = 'rgba(0,0,0,0.15)'; c.shadowOffsetY = 3 * alpha; }
            const perKeyOpts = Object.assign({}, skinOpts, { fillColor: getKeyColor(r, col, fillColor) });
            drawKeyClassic(c, kw, kh, isSpace, displayChar, alpha, pressProgress, perKeyOpts);
          } else {
            const renderer = SKIN_RENDERERS[keySkin];
            const perKeyOpts = Object.assign({}, skinOpts, { fillColor: getKeyColor(r, col, fillColor) });
            if (renderer) renderer(c, kw, kh, isSpace, displayChar, alpha, pressProgress, perKeyOpts);
            else drawKeyClassic(c, kw, kh, isSpace, displayChar, alpha, pressProgress, skinOpts);
          }
          c.restore();
        });
      });
    }

    function drawOverlays(c) {
      overlayItems.forEach((item) => {
        if (item.kind === 'text') {
          c.save(); c.fillStyle = item.color || '#ffffff';
          const safeFont = getSafeFontFamily();
          c.font = `${getFontStylePrefix(item.style)}${item.fontSize || 24}px ${safeFont}`;
          c.textAlign = 'left'; c.textBaseline = 'top';
          const fullText = applyCasing(item.text, item.casing);
          const displayText = item.textType === 'Animated (Typing)' ? fullText.substring(0, item.typingIndex) : fullText;
          if (item.id !== editingOverlayId) c.fillText(displayText, item.x, item.y); // hidden while its inline editor is open
          if (item.underline && item.id !== editingOverlayId) drawUnderline(c, displayText, item.x, item.y, item.fontSize || 24, 'left', 'top');
          const metrics = c.measureText(displayText || 'M');
          item.w = Math.max(metrics.width, 20); item.h = (item.fontSize || 24) * 1.2;
          c.restore();
        } else {
          const asset = overlayLibrary.find((a) => a.id === item.assetId);
          if (!asset) return;
          const entry = assetCache.get(asset.id) || loadAsset(asset.id, asset.url, asset.kind);
          if (!entry) return;
          c.save(); c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 12; c.shadowOffsetY = 4;
          drawMediaCover(c, entry, item.x, item.y, item.w, item.h, 'contain'); c.restore();
        }
        const isSelected = selectedOverlayId === item.id;
        const isHovering = hoveringOverlayId === item.id;
        if (isSelected || isHovering) {
          c.save();
          c.strokeStyle = isSelected ? 'rgba(0,122,255,0.95)' : 'rgba(255,255,255,0.5)';
          c.lineWidth = isSelected ? 1.5 : 1; c.setLineDash(isSelected ? [] : [4, 4]);
          c.strokeRect(item.x, item.y, item.w, item.h); c.setLineDash([]);
          if (isSelected) {
            const hx = item.x + item.w - HANDLE_SIZE / 2, hy = item.y + item.h - HANDLE_SIZE / 2;
            c.fillStyle = '#FFFFFF'; c.strokeStyle = 'rgba(0,122,255,0.95)'; c.lineWidth = 1.5;
            c.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE); c.strokeRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
          }
          c.restore();
        }
      });
    }

    function drawTextLine(c, timestamp) {
      const rawText = controls.get('text') || '';
      const text = applyCasing(rawText, controls.get('textCase') || 'Original');
      if (!controls.get('showTextLine')) { lastTextBounds = null; return; }
      const textStyle = controls.get('textStyle') || 'Normal';
      const textUnderline = controls.get('textUnderline') || false;
      const textLineColor = controls.get('textLineColor');
      const safeFont = getSafeFontFamily();
      const lineFontSize = controls.get('lineFontSize') || 20;
      c.save(); c.fillStyle = textLineColor; c.globalAlpha = 0.85;
      applyFontVariation(c, 'lineFont');
      c.font = `${getFontStylePrefix(textStyle)}${lineFontSize}px ${safeFont}`;
      const displayLimit = 60;
      const start = Math.max(0, typingIndex - displayLimit);
      const displayText = text.substring(start, typingIndex);
      const px = textLinePos ? textLinePos.x : canvas.width / 2;
      const py = textLinePos ? textLinePos.y : canvas.height / 2 - 175;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(displayText, px, py);
      if (textUnderline) drawUnderline(c, displayText, px, py, lineFontSize, 'center', 'middle');
      if (Math.floor(timestamp / 500) % 2) {
        const textWidth = c.measureText(displayText).width; c.textAlign = 'left'; c.fillText('_', px + textWidth / 2, py);
      }
      const metrics = c.measureText(displayText || 'M');
      const tw = Math.max(metrics.width, lineFontSize * 1.5), th = lineFontSize * 1.4;
      lastTextBounds = { x: px - tw / 2 - 8, y: py - th / 2, w: tw + 16, h: th };
      if (hoveringText || isDraggingText) {
        c.globalAlpha = isDraggingText ? 0.5 : 0.25; c.strokeStyle = textLineColor; c.lineWidth = 1; c.setLineDash([4, 4]);
        c.strokeRect(lastTextBounds.x, lastTextBounds.y, lastTextBounds.w, lastTextBounds.h); c.setLineDash([]);
      }
      c.restore();
    }

    function drawInnerGlow(c, w, h, color, intensity, pulse) {
      c.save();
      const blur = intensity * (0.5 + pulse * 0.5) * 1.5;
      if (blur <= 0) { c.restore(); return; }
      c.beginPath(); c.rect(0, 0, w, h); c.clip();
      c.beginPath(); c.rect(-blur * 2, -blur * 2, w + blur * 4, h + blur * 4); c.rect(w, 0, -w, h);
      c.shadowColor = color; c.shadowBlur = blur; c.fillStyle = 'rgba(0,0,0,1)'; c.fill('evenodd');
      const rgb = hexToRgb(color);
      c.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.15 + pulse * 0.15})`; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
      c.restore();
    }

    // ── pointer interaction ──
    const pointInBounds = (p, b) => !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const pointInRect = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
    function findOverlayAt(pos) { for (let i = overlayItems.length - 1; i >= 0; i--) { const it = overlayItems[i]; if (pointInRect(pos, it.x, it.y, it.w, it.h)) return it; } return null; }
    function overlayResizeHandleHit(item, pos) {
      if (!item) return false;
      return pointInRect(pos, item.x + item.w - HANDLE_SIZE / 2, item.y + item.h - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }

    // ── alignment: snapping + guides ──
    function snapTargets(W, H) {
      const margin = Math.round(Math.min(W, H) * 0.05);
      return { x: [0, margin, W / 2, W - margin, W], y: [0, margin, H / 2, H - margin, H], thr: Math.max(6, Math.round(Math.min(W, H) * 0.013)) };
    }
    // Snap a box (top-left x,y,w,h); returns snapped {x,y} and the guide lines to draw.
    function snapBox(x, y, w, h) {
      if (!controls.get('snapEnabled')) return { x, y, guides: [] };
      const W = canvas.width, H = canvas.height; const T = snapTargets(W, H); const guides = [];
      const axis = (val, offsets, targets) => {
        let best = null;
        for (const t of targets) for (const off of offsets) { const d = Math.abs((val + off) - t); if (d < T.thr && (!best || d < best.d)) best = { d, snapped: t - off, guide: t }; }
        return best;
      };
      const bx = axis(x, [0, w / 2, w], T.x); let nx = x; if (bx) { nx = bx.snapped; guides.push({ axis: 'x', pos: bx.guide }); }
      const by = axis(y, [0, h / 2, h], T.y); let ny = y; if (by) { ny = by.snapped; guides.push({ axis: 'y', pos: by.guide }); }
      return { x: nx, y: ny, guides };
    }
    // Snap a centre point (for the centred text line).
    function snapCenter(cx, cy) {
      if (!controls.get('snapEnabled')) return { x: cx, y: cy, guides: [] };
      const W = canvas.width, H = canvas.height; const T = snapTargets(W, H); const guides = [];
      const pick = (val, targets) => { let best = null; for (const t of targets) { const d = Math.abs(val - t); if (d < T.thr && (!best || d < best.d)) best = { d, t }; } return best; };
      const bx = pick(cx, T.x); let nx = cx; if (bx) { nx = bx.t; guides.push({ axis: 'x', pos: bx.t }); }
      const by = pick(cy, T.y); let ny = cy; if (by) { ny = by.t; guides.push({ axis: 'y', pos: by.t }); }
      return { x: nx, y: ny, guides };
    }
    function drawGuides(c) {
      if (!activeGuides.length) return;
      c.save(); c.strokeStyle = 'rgba(255,45,85,0.9)'; c.lineWidth = 1; c.setLineDash([7, 6]);
      for (const g of activeGuides) { c.beginPath(); if (g.axis === 'x') { c.moveTo(g.pos, 0); c.lineTo(g.pos, canvas.height); } else { c.moveTo(0, g.pos); c.lineTo(canvas.width, g.pos); } c.stroke(); }
      c.setLineDash([]); c.restore();
    }
    // Align the selected overlay (or the text line if none selected) to the canvas.
    function alignSelected(kind) {
      const W = canvas.width, H = canvas.height; const margin = Math.round(Math.min(W, H) * 0.05);
      const it = overlayItems.find((o) => o.id === selectedOverlayId);
      if (it) {
        if (kind === 'left') it.x = margin; else if (kind === 'cx') it.x = W / 2 - it.w / 2; else if (kind === 'right') it.x = W - margin - it.w;
        else if (kind === 'top') it.y = margin; else if (kind === 'cy') it.y = H / 2 - it.h / 2; else if (kind === 'bottom') it.y = H - margin - it.h;
        persistOverlays(); return;
      }
      if (controls.get('showTextLine')) {
        const cur = textLinePos || { x: W / 2, y: H / 2 - 175 };
        const hw = lastTextBounds ? lastTextBounds.w / 2 : 0, hh = lastTextBounds ? lastTextBounds.h / 2 : 0;
        const p = { x: cur.x, y: cur.y };
        if (kind === 'left') p.x = margin + hw; else if (kind === 'cx') p.x = W / 2; else if (kind === 'right') p.x = W - margin - hw;
        else if (kind === 'top') p.y = margin + hh; else if (kind === 'cy') p.y = H / 2; else if (kind === 'bottom') p.y = H - margin - hh;
        textLinePos = p; controls.set('textLinePos', p);
      }
    }
    unsubs.push(controls.onAction('alignLeft', () => alignSelected('left')));
    unsubs.push(controls.onAction('alignCenterH', () => alignSelected('cx')));
    unsubs.push(controls.onAction('alignRight', () => alignSelected('right')));
    unsubs.push(controls.onAction('alignTop', () => alignSelected('top')));
    unsubs.push(controls.onAction('alignCenterV', () => alignSelected('cy')));
    unsubs.push(controls.onAction('alignBottom', () => alignSelected('bottom')));

    // ── inline text editing (double-click a text overlay) ──
    function positionEditor(ta, item) {
      const rect = canvas.getBoundingClientRect();
      const host = canvas.parentElement; const areaRect = host.getBoundingClientRect();
      const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
      ta.style.left = ((rect.left - areaRect.left) + item.x * sx) + 'px';
      ta.style.top = ((rect.top - areaRect.top) + item.y * sy) + 'px';
      ta.style.fontSize = Math.max(10, (item.fontSize || 24) * sy) + 'px';
      ta.style.fontFamily = getSafeFontFamily();
      ta.style.fontWeight = (item.style === 'Bold' || item.style === 'Bold Italic') ? '700' : '400';
      ta.style.fontStyle = (item.style === 'Italic' || item.style === 'Bold Italic') ? 'italic' : 'normal';
      ta.style.color = item.color || '#fff';
      ta.style.width = Math.max(90, (item.w || 120) * sx + 28) + 'px';
    }
    function closeTextEditor() {
      const ed = canvas.parentElement && canvas.parentElement.querySelector('.nsaano-overlay-edit');
      if (ed) ed.remove();
      if (editingOverlayId) { editingOverlayId = null; persistOverlays(); }
    }
    function openTextEditor(item) {
      closeTextEditor();
      editingOverlayId = item.id;
      const ta = document.createElement('textarea');
      ta.className = 'nsaano-overlay-edit';
      ta.value = item.text || '';
      ta.spellcheck = false;
      ta.style.cssText = 'position:absolute;z-index:6;margin:0;padding:3px 6px;border:1px solid rgba(0,122,255,0.95);border-radius:6px;background:rgba(10,10,10,0.82);outline:none;resize:none;overflow:hidden;line-height:1.2;white-space:pre;box-shadow:0 6px 24px rgba(0,0,0,0.5);';
      positionEditor(ta, item);
      ta.addEventListener('input', () => {
        item.text = ta.value;
        if (item.textType === 'Animated (Typing)') item.typingIndex = applyCasing(item.text, item.casing).length;
        positionEditor(ta, item);
      });
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if ((ev.key === 'Enter' && !ev.shiftKey) || ev.key === 'Escape') { ev.preventDefault(); ta.blur(); }
      });
      ta.addEventListener('blur', () => closeTextEditor());
      canvas.parentElement.appendChild(ta);
      ta.focus(); ta.select();
    }
    function onDblClick(e) {
      const pos = runtime.getMousePos(e);
      const hit = findOverlayAt(pos);
      if (hit && hit.kind === 'text') { selectedOverlayId = hit.id; openTextEditor(hit); e.preventDefault(); }
    }
    canvas.addEventListener('dblclick', onDblClick);
    unsubs.push(() => { canvas.removeEventListener('dblclick', onDblClick); closeTextEditor(); });

    function onMove(e) {
      const pos = runtime.getMousePos(e);
      if (draggingOverlay) {
        const it = overlayItems.find((o) => o.id === draggingOverlay.id);
        if (it) {
          if (draggingOverlay.mode === 'move') {
            const snap = snapBox(pos.x - draggingOverlay.offsetX, pos.y - draggingOverlay.offsetY, it.w, it.h);
            it.x = snap.x; it.y = snap.y; activeGuides = snap.guides;
          } else if (draggingOverlay.mode === 'resize') {
            activeGuides = [];
            if (it.kind === 'text') { it.fontSize = Math.max(10, draggingOverlay.startFontSize + (pos.y - draggingOverlay.startMy)); }
            else { const aspect = draggingOverlay.startW / draggingOverlay.startH; const newW = Math.max(20, draggingOverlay.startW + (pos.x - draggingOverlay.startMx)); it.w = newW; it.h = newW / aspect; }
          }
        }
        canvas.style.cursor = draggingOverlay.mode === 'resize' ? 'nwse-resize' : 'grabbing';
        e.preventDefault(); return;
      }
      if (isDraggingText) {
        const snap = snapCenter(pos.x - dragOffset.x, pos.y - dragOffset.y);
        textLinePos = { x: snap.x, y: snap.y }; activeGuides = snap.guides;
        canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
      }
      const selectedItem = overlayItems.find((o) => o.id === selectedOverlayId);
      if (selectedItem && overlayResizeHandleHit(selectedItem, pos)) { hoveringOverlayId = selectedItem.id; canvas.style.cursor = 'nwse-resize'; return; }
      const hit = findOverlayAt(pos);
      if (hit) { hoveringOverlayId = hit.id; canvas.style.cursor = 'grab'; hoveringText = false; return; }
      hoveringOverlayId = null;
      hoveringText = pointInBounds(pos, lastTextBounds);
      canvas.style.cursor = hoveringText ? 'grab' : 'default';
    }
    function onDown(e) {
      const pos = runtime.getMousePos(e);
      const selectedItem = overlayItems.find((o) => o.id === selectedOverlayId);
      if (selectedItem && overlayResizeHandleHit(selectedItem, pos)) {
        draggingOverlay = { id: selectedItem.id, mode: 'resize', startW: selectedItem.w, startH: selectedItem.h, startX: selectedItem.x, startY: selectedItem.y, startMx: pos.x, startMy: pos.y, startFontSize: selectedItem.fontSize || 24 };
        canvas.style.cursor = 'nwse-resize'; e.preventDefault(); return;
      }
      const hit = findOverlayAt(pos);
      if (hit) {
        selectedOverlayId = hit.id;
        overlayItems = overlayItems.filter((o) => o.id !== hit.id).concat(hit);
        draggingOverlay = { id: hit.id, mode: 'move', offsetX: pos.x - hit.x, offsetY: pos.y - hit.y };
        canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
      }
      if (pointInBounds(pos, lastTextBounds)) {
        isDraggingText = true;
        const cx = lastTextBounds.x + lastTextBounds.w / 2, cy = lastTextBounds.y + lastTextBounds.h / 2;
        dragOffset = { x: pos.x - cx, y: pos.y - cy }; canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
      }
      selectedOverlayId = null;
    }
    function endDrag() {
      if (draggingOverlay) { draggingOverlay = null; persistOverlays(); canvas.style.cursor = 'default'; }
      if (isDraggingText) {
        isDraggingText = false; canvas.style.cursor = hoveringText ? 'grab' : 'default';
        if (textLinePos) controls.set('textLinePos', { x: textLinePos.x, y: textLinePos.y });
      }
      activeGuides = [];
    }
    function onKeyDown(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedOverlayId) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        overlayItems = overlayItems.filter((o) => o.id !== selectedOverlayId); selectedOverlayId = null; persistOverlays();
      }
    }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchend', endDrag);
    window.addEventListener('keydown', onKeyDown);
    unsubs.push(() => {
      canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseup', endDrag); canvas.removeEventListener('mouseleave', endDrag);
      canvas.removeEventListener('touchmove', onMove); canvas.removeEventListener('touchstart', onDown);
      canvas.removeEventListener('touchend', endDrag); window.removeEventListener('keydown', onKeyDown);
    });

    // ── per-frame draw (the shell drives RAF and calls this) ──
    this._draw = function draw(timestamp) {
      const glowActive = controls.get('canvasGlowActive');
      if (glowActive) {
        const glowColor = controls.get('canvasGlowColor') || '#007AFF';
        const glowIntensity = controls.get('canvasGlowIntensity') || 40;
        const pulseSpeed = controls.get('canvasGlowPulseSpeed') || 1;
        const pulse = Math.sin(timestamp * 0.001 * pulseSpeed) * 0.5 + 0.5;
        const currentBlur = glowIntensity * (0.5 + pulse * 0.5);
        const currentSpread = currentBlur * 0.2;
        const rgb = hexToRgb(glowColor);
        canvas.style.boxShadow = `0 0 ${currentBlur}px ${currentSpread}px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6), inset 0 0 ${currentBlur * 0.5}px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;
        canvas.style.border = `1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
      } else { canvas.style.boxShadow = 'none'; canvas.style.border = 'none'; }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (controls.get('useBgVideo') && bgVideoEl && bgVideoReady) runtime.drawImage(ctx, bgVideoEl, 0, 0, canvas.width, canvas.height, 'cover');

      const text = applyCasing(controls.get('text') || '', controls.get('textCase') || 'Original');
      const cpm = controls.get('cpm');
      const jitter = controls.get('jitter');
      const persistence = controls.get('persistence') * 1000;
      const mode = controls.get('displayMode') || 'Keyboard';

      if (controls.get('playing') && typingIndex < text.length && timestamp > nextTypeTime) {
        const char = text[typingIndex];
        const keyData = KEY_MAP[char.toUpperCase()] || KEY_MAP[' '];
        if (keyData) typedChars.push({ key: keyData.label, time: timestamp });
        typingIndex++;
        const baseDelay = (60 / cpm) * 1000;
        nextTypeTime = timestamp + Math.max(30, baseDelay + baseDelay * jitter * (Math.random() - 0.5) * 2);
      }

      overlayItems.forEach((item) => {
        if (item.kind === 'text' && item.textType === 'Animated (Typing)') {
          const fullText = applyCasing(item.text, item.casing);
          if (controls.get('playing') && item.typingIndex < fullText.length && timestamp > item.nextTypeTime) {
            const char = fullText[item.typingIndex];
            const keyData = KEY_MAP[char.toUpperCase()] || KEY_MAP[' '];
            if (keyData) typedChars.push({ key: keyData.label, time: timestamp });
            item.typingIndex++;
            const baseDelay = (60 / item.cpm) * 1000;
            item.nextTypeTime = timestamp + Math.max(30, baseDelay + baseDelay * jitter * (Math.random() - 0.5) * 2);
          }
          if (item.typingIndex >= fullText.length && timestamp > item.nextTypeTime + 1500) { item.typingIndex = 0; item.nextTypeTime = timestamp + 500; }
        }
      });

      typedChars = typedChars.filter((tc) => timestamp - tc.time < persistence);

      if (mode === 'Gallery') drawGallery(ctx, timestamp); else drawKeyboard(ctx, timestamp);
      drawOverlays(ctx);
      drawTextLine(ctx, timestamp);
      if ((draggingOverlay || isDraggingText) && activeGuides.length) drawGuides(ctx);

      if (glowActive) {
        const pulse = Math.sin(timestamp * 0.001 * (controls.get('canvasGlowPulseSpeed') || 1)) * 0.5 + 0.5;
        drawInnerGlow(ctx, canvas.width, canvas.height, controls.get('canvasGlowColor') || '#007AFF', controls.get('canvasGlowIntensity') || 40, pulse);
      }

      if (mode === 'Keyboard' && typingIndex >= text.length && typedChars.length === 0 && text.length > 0 && !resetScheduled && !clockManual()) {
        resetScheduled = true; setTimeout(reset, 1000);
      }
    };

    this._dispose = function dispose() {
      unsubs.forEach((u) => { try { u(); } catch (_) {} });
      if (bgVideoEl) { try { bgVideoEl.pause(); bgVideoEl.src = ''; } catch (_) {} }
      assetCache.forEach((e) => { if (e.kind === 'video' && e.el) { try { e.el.pause(); } catch (_) {} } if (e.lottieAnim) { try { e.lottieAnim.destroy(); } catch (_) {} } });
      if (lottieHostContainer && lottieHostContainer.parentElement) lottieHostContainer.parentElement.removeChild(lottieHostContainer);
      canvas.style.boxShadow = 'none'; canvas.style.border = 'none'; canvas.style.background = '';
    };

    reset();
    updateCanvasSize();
  },

  draw(timestamp) { if (this._draw) this._draw(timestamp); },
  dispose() { if (this._dispose) this._dispose(); }
};

// Skins extracted to keep init() readable. Ported 1:1 from the reference.
function makeSkinRenderers(buildKeyPath) {
  function drawSkinCyberHack(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
    const { keyShape, keyRoundness, fillColor, strokeColor, showFill, showStroke, showGlow, glow, glowColor, keyFontSize, safeFont } = opts;
    const lx = -kw / 2, ly = -kh / 2;
    const neonRgb = hexToRgb(strokeColor || '#00FFFF');
    const fillRgb = hexToRgb(fillColor || '#001A1A');
    if (showFill) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.fillStyle = `rgba(${Math.min(20, fillRgb.r * 0.1)}, ${Math.min(30, fillRgb.g * 0.15)}, ${Math.min(40, fillRgb.b * 0.2)}, 0.9)`; c.fill(); }
    c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip(); c.globalAlpha = 0.18 * alpha;
    for (let sy = ly; sy < ly + kh; sy += 3) { c.fillStyle = `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, 1)`; c.fillRect(lx, sy, kw, 1); } c.restore();
    if (pressProgress > 0) {
      c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip();
      const sweepY = ly + kh * (1 - pressProgress);
      const g = c.createLinearGradient(0, sweepY - 10, 0, sweepY + 10);
      g.addColorStop(0, `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, 0)`); g.addColorStop(0.5, `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, ${pressProgress * 0.7})`); g.addColorStop(1, `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, 0)`);
      c.fillStyle = g; c.fillRect(lx, ly, kw, kh); c.restore();
    }
    if (showStroke) {
      buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness);
      if (showGlow && glow > 0) { c.shadowColor = glowColor || `rgb(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b})`; c.shadowBlur = (glow + 4 + pressProgress * 12) * alpha; }
      c.strokeStyle = `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, ${0.9 + pressProgress * 0.1})`; c.lineWidth = 1.5 + pressProgress * 0.5; c.stroke(); c.shadowBlur = 0;
    }
    c.font = `${keyFontSize}px ${safeFont}, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (pressProgress > 0.05) { const off = 1.5 + pressProgress * 3; c.fillStyle = `rgba(255,50,80,${0.6 * pressProgress})`; c.fillText(keyChar, -off, 0); c.fillStyle = `rgba(50,220,255,${0.6 * pressProgress})`; c.fillText(keyChar, off, 0); }
    c.fillStyle = `rgb(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b})`; c.shadowColor = `rgba(${neonRgb.r}, ${neonRgb.g}, ${neonRgb.b}, 0.8)`; c.shadowBlur = 4; c.fillText(keyChar, 0, 0); c.shadowBlur = 0;
  }
  function drawSkinFingerprint(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
    const { keyShape, keyRoundness, fillColor, strokeColor, showFill, showStroke, fontColor, keyFontSize, safeFont } = opts;
    const accentRgb = hexToRgb(strokeColor || '#00E5FF'); const bodyAlpha = 1 - pressProgress * 0.85;
    if (showFill && bodyAlpha > 0.02) { c.save(); c.globalAlpha *= bodyAlpha; buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); const fillRgb = hexToRgb(fillColor); c.fillStyle = `rgba(${Math.min(255, fillRgb.r * 0.15)}, ${Math.min(255, fillRgb.g * 0.18)}, ${Math.min(255, fillRgb.b * 0.22)}, 0.92)`; c.fill(); c.restore(); }
    c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip(); c.globalAlpha = 0.25 * bodyAlpha * alpha; c.strokeStyle = `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`; c.lineWidth = 0.6;
    const maxR = Math.min(kw, kh) * 0.42;
    for (let i = 0; i < 7; i++) { const r = maxR * (0.25 + i * 0.11); c.beginPath(); c.arc((i % 2 ? 2 : -2), 0, r, Math.PI * 0.2 + i * 0.1, Math.PI * 1.7 + i * 0.1); c.stroke(); } c.restore();
    if (pressProgress > 0) { const ringR = Math.min(kw, kh) * 0.5 * (1 - pressProgress * 0.7); c.save(); c.globalAlpha = (1 - pressProgress) * alpha; c.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.95)`; c.lineWidth = 2; c.shadowColor = `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`; c.shadowBlur = 12; c.beginPath(); c.arc(0, 0, ringR, 0, Math.PI * 2); c.stroke(); c.shadowBlur = 0; c.restore(); }
    if (showStroke && bodyAlpha > 0.02) { c.save(); c.globalAlpha *= bodyAlpha; buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.55)`; c.lineWidth = 1; c.stroke(); c.restore(); }
    if (bodyAlpha > 0.02) { c.save(); c.globalAlpha *= bodyAlpha; c.font = `${keyFontSize}px ${safeFont}, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = fontColor || '#FFFFFF'; c.fillText(keyChar, 0, 0); c.restore(); }
  }
  function drawSkinHologram(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
    const { keyShape, keyRoundness, showFill, showStroke, fontColor, keyFontSize, safeFont } = opts; const lx = -kw / 2, ly = -kh / 2;
    if (showFill) {
      c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip();
      const grad = c.createLinearGradient(lx, ly, lx + kw, ly + kh); const shift = pressProgress * 0.5;
      grad.addColorStop(0, `rgba(255,100,200,${0.25 + shift * 0.3})`); grad.addColorStop(0.33, `rgba(100,220,255,${0.3 + shift * 0.3})`); grad.addColorStop(0.66, `rgba(180,255,180,${0.3 + shift * 0.3})`); grad.addColorStop(1, `rgba(255,230,100,${0.25 + shift * 0.3})`);
      c.fillStyle = grad; c.fillRect(lx, ly, kw, kh);
      const hg = c.createLinearGradient(0, ly, 0, ly + kh * 0.5); hg.addColorStop(0, 'rgba(255,255,255,0.45)'); hg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = hg; c.fillRect(lx, ly, kw, kh * 0.5); c.restore();
    }
    if (showStroke) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); const eg = c.createLinearGradient(lx, ly, lx + kw, ly + kh); eg.addColorStop(0, 'rgba(255,100,200,0.9)'); eg.addColorStop(0.5, 'rgba(100,220,255,0.9)'); eg.addColorStop(1, 'rgba(180,255,180,0.9)'); c.strokeStyle = eg; c.lineWidth = 1.2 + pressProgress * 1.5; c.stroke(); }
    c.font = `${keyFontSize}px ${safeFont}, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (pressProgress > 0.05) { c.fillStyle = `rgba(255,100,200,${pressProgress * 0.7})`; c.fillText(keyChar, -2, 0); c.fillStyle = `rgba(100,220,255,${pressProgress * 0.7})`; c.fillText(keyChar, 2, 0); }
    c.fillStyle = fontColor || '#FFFFFF'; c.fillText(keyChar, 0, 0);
  }
  function drawSkinTerminal(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
    const { keyShape, keyRoundness, showFill, showStroke, keyFontSize, safeFont } = opts; const lx = -kw / 2, ly = -kh / 2;
    const phosphor = '#00FF66'; const pRgb = hexToRgb(phosphor);
    if (showFill) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); const bright = 8 + pressProgress * 30; c.fillStyle = `rgb(${bright * 0.3}, ${bright}, ${bright * 0.4})`; c.fill(); }
    c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip(); c.globalAlpha = 0.22 * alpha;
    for (let sy = ly; sy < ly + kh; sy += 2) { c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(lx, sy, kw, 1); } c.restore();
    if (showStroke) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.strokeStyle = `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, ${0.7 + pressProgress * 0.3})`; c.shadowColor = phosphor; c.shadowBlur = 4 + pressProgress * 10; c.lineWidth = 1; c.stroke(); c.shadowBlur = 0; }
    c.font = `${keyFontSize}px ${safeFont}, "Courier New", monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = phosphor; c.shadowColor = phosphor; c.shadowBlur = 3 + pressProgress * 8; c.fillText(keyChar, 0, 0); c.shadowBlur = 0;
  }
  function drawSkinNeonArcade(c, kw, kh, isSpace, keyChar, alpha, pressProgress, opts) {
    const { keyShape, keyRoundness, fillColor, strokeColor, showFill, showStroke, showGlow, glow, glowColor, fontColor, keyFontSize, safeFont } = opts;
    const sRgb = hexToRgb(strokeColor || '#FF00FF'); const fRgb = hexToRgb(fillColor || '#1A0033'); const gColor = glowColor || strokeColor || '#FF00FF';
    if (showFill) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.fillStyle = `rgba(${fRgb.r * 0.4}, ${fRgb.g * 0.4}, ${fRgb.b * 0.4}, 0.88)`; c.fill(); }
    if (pressProgress > 0) {
      c.save(); buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.clip();
      const burstR = Math.max(kw, kh) * (0.6 + pressProgress * 0.6); const burst = c.createRadialGradient(0, 0, 0, 0, 0, burstR);
      burst.addColorStop(0, `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, ${0.7 * pressProgress})`); burst.addColorStop(0.5, `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, ${0.3 * pressProgress})`); burst.addColorStop(1, `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 0)`);
      c.fillStyle = burst; c.fillRect(-kw, -kh, kw * 2, kh * 2); c.restore();
    }
    if (showStroke) { buildKeyPath(c, keyShape, kw, kh, isSpace, keyRoundness); c.shadowColor = gColor; c.shadowBlur = (showGlow ? glow : 12) + 6 + pressProgress * 20; c.strokeStyle = `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 1)`; c.lineWidth = 2 + pressProgress * 1; c.stroke(); c.shadowBlur = 0; }
    c.font = `${keyFontSize}px ${safeFont}, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = fontColor || '#FFFFFF'; c.shadowColor = gColor; c.shadowBlur = 6 + pressProgress * 10; c.fillText(keyChar, 0, 0); c.shadowBlur = 0;
  }
  return { 'Cyber Hack': drawSkinCyberHack, Fingerprint: drawSkinFingerprint, Hologram: drawSkinHologram, Terminal: drawSkinTerminal, 'Neon Arcade': drawSkinNeonArcade };
}
