// runtime.js — the canvas runtime (port of the reference `CanvasRuntimeAPI`).
//
// Handles: background modes (none / solid / image), export sizing, pointer->canvas
// coordinate mapping (mouse + touch), and cover/contain image drawing. The shell owns
// the canvas element and passes it in, so we skip the reference's auto-detection.

// Mobile perf: cap devicePixelRatio so canvases allocate fewer pixels.
(function capDPR() {
  if (window.innerWidth <= 768) {
    const capped = Math.min(1.5, window.devicePixelRatio || 1);
    try {
      Object.defineProperty(window, 'devicePixelRatio', { get: () => capped, configurable: true });
    } catch (_) { /* already defined */ }
  }
})();

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function createRuntime(canvas) {
  let _canvas = canvas;
  let _exportMode = 'auto';
  let _exportWidth = 0;
  let _exportHeight = 0;
  const _bg = { mode: 'none', color: '#ffffff', imageEl: null, imageDataURL: null, fit: 'cover' };

  function applyBgCSS() {
    if (!_canvas) return;
    if (_bg.mode === 'none') {
      _canvas.style.background = '';
    } else if (_bg.mode === 'solid') {
      _canvas.style.background = _bg.color;
    } else if (_bg.mode === 'image') {
      if (_bg.imageDataURL) {
        const fitCss = _bg.fit === 'fill' ? '100% 100%' : _bg.fit;
        _canvas.style.backgroundColor = _bg.color;
        _canvas.style.backgroundImage = `url("${_bg.imageDataURL}")`;
        _canvas.style.backgroundSize = fitCss;
        _canvas.style.backgroundPosition = 'center';
        _canvas.style.backgroundRepeat = 'no-repeat';
      } else {
        _canvas.style.backgroundImage = '';
        _canvas.style.backgroundColor = _bg.color;
      }
    }
  }

  const api = {
    setCanvas(el) { _canvas = el; if (_bg.mode !== 'none') applyBgCSS(); },

    setBackground(state) {
      state = state || {};
      _bg.mode = state.mode || 'none';
      _bg.color = state.color || '#ffffff';
      _bg.fit = state.fit || 'cover';
      const img = state.image || state.imageDataURL || null;
      if (img && img !== _bg.imageDataURL) {
        _bg.imageDataURL = img;
        _bg.imageEl = null;
        applyBgCSS();
        const im = new Image();
        if (!img.startsWith('data:')) im.crossOrigin = 'anonymous';
        im.onload = () => { if (_bg.imageDataURL === img) _bg.imageEl = im; };
        im.src = img;
      } else if (!img) {
        _bg.imageEl = null;
        _bg.imageDataURL = null;
      }
      applyBgCSS();
    },
    getBackground() { return { mode: _bg.mode, color: _bg.color, fit: _bg.fit, image: _bg.imageDataURL }; },

    setExportDimensions(w, h) {
      _exportMode = 'fixed';
      _exportWidth = Math.max(1, Math.round(w || 1));
      _exportHeight = Math.max(1, Math.round(h || 1));
      if (_canvas) { _canvas.width = _exportWidth; _canvas.height = _exportHeight; }
      window.dispatchEvent(new Event('resize'));
    },
    clearExportDimensions() { _exportMode = 'auto'; },
    getExportDimensions() {
      if (_exportMode === 'fixed') return { width: _exportWidth, height: _exportHeight, mode: 'fixed' };
      return { width: _canvas ? _canvas.width : 0, height: _canvas ? _canvas.height : 0, mode: 'auto' };
    },
    isFixedExportMode() { return _exportMode === 'fixed'; },

    getMousePos(event) {
      if (!_canvas) return { x: 0, y: 0 };
      const rect = _canvas.getBoundingClientRect();
      const scaleX = _canvas.width / rect.width;
      const scaleY = _canvas.height / rect.height;
      const touch = (event.touches && event.touches[0]) ||
        (event.changedTouches && event.changedTouches[0]) || null;
      const clientX = touch ? touch.clientX : event.clientX;
      const clientY = touch ? touch.clientY : event.clientY;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    },

    drawImage(ctx, img, x, y, w, h, fit) {
      if (!img || !img.width || !img.height) return;
      fit = fit || 'cover';
      const ar = img.width / img.height;
      const car = w / h;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      let dx = x, dy = y, dw = w, dh = h;
      if (fit === 'cover') {
        if (ar > car) { sw = img.height * car; sx = (img.width - sw) / 2; }
        else { sh = img.width / car; sy = (img.height - sh) / 2; }
      } else if (fit === 'contain') {
        if (ar > car) { dh = w / ar; dy = y + (h - dh) / 2; }
        else { dw = h * ar; dx = x + (w - dw) / 2; }
      }
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  };

  return api;
}

export { hexToRgb };
