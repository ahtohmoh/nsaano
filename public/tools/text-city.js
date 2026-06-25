// tools/text-city.js
//
// "Text City" — a word-brick light-sweep. Words are tiled across the canvas as rounded
// blocks; a soft moving light reveals them as it sweeps across. Ported from a BRIK React
// export (remix-mqk7db04) to the Nsaano tool contract: controlSchema + init/draw/dispose.

const RATIO_OPTIONS = [
  'Responsive', 'Landscape: 1200 x 800 (3:2)', 'Landscape: 1920 x 1080 (16:9)',
  'Portrait: 1080 x 1350 (4:5)', 'Square: 1080 x 1080 (1:1)', 'Stories: 1080 x 1920 (9:16)', 'Custom'
];

function seededRandom(seed) { const x = Math.sin(seed) * 10000; return x - Math.floor(x); }

function drawRoundedRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// canvas globalCompositeOperation names; 'Normal' → source-over, 'Additive' → lighter.
function blendOp(name) {
  const n = String(name || 'Normal');
  if (n === 'Normal') return 'source-over';
  if (n === 'Additive') return 'lighter';
  return n.toLowerCase().replace(/\s+/g, '-');
}

const controlSchema = [
  { title: 'Mode & Layout', fields: [
    { key: 'canvasRatio', type: 'select', label: 'Canvas Aspect Ratio', options: RATIO_OPTIONS },
    { key: 'playing', type: 'toggle', label: 'Animate' },
    { key: 'animSpeed', type: 'slider', label: 'Sweep Speed', min: 1, max: 100, step: 1 },
    { key: 'lightDir', type: 'select', label: 'Light Direction', options: ['Left to Right', 'Right to Left', 'Top to Bottom', 'Diagonal'] },
    { key: 'lightWidth', type: 'slider', label: 'Light Width', min: 40, max: 800, step: 1 },
    { key: 'lightSoftness', type: 'slider', label: 'Light Softness', min: 1, max: 100, step: 1 },
    { key: 'fadeGamma', type: 'slider', label: 'Fade Gamma', min: 0.5, max: 6, step: 0.1 }
  ] },
  { title: 'Text Content', fields: [
    { key: 'text', type: 'textarea', label: 'Words', rows: 5, placeholder: 'One word per line or space-separated' },
    { key: 'fontFamily', type: 'font', label: 'Font Family' },
    { key: 'fontWeight', type: 'slider', label: 'Font Weight', min: 100, max: 900, step: 100 },
    { key: 'textColor', type: 'color', label: 'Text Color' },
    { key: 'textAlpha', type: 'slider', label: 'Text Opacity', min: 0, max: 100, step: 1 },
    { key: 'textBlend', type: 'select', label: 'Text Blend', options: ['Normal', 'Screen', 'Overlay', 'Multiply', 'Soft Light', 'Additive', 'Difference'] }
  ] },
  { title: 'Blocks', fields: [
    { key: 'rowHeight', type: 'slider', label: 'Row Height', min: 16, max: 160, step: 1 },
    { key: 'minScale', type: 'slider', label: 'Min Block Scale', min: 10, max: 200, step: 1 },
    { key: 'maxScale', type: 'slider', label: 'Max Block Scale', min: 10, max: 300, step: 1 },
    { key: 'minRadius', type: 'slider', label: 'Min Corner Radius', min: 0, max: 60, step: 1 },
    { key: 'maxRadius', type: 'slider', label: 'Max Corner Radius', min: 0, max: 60, step: 1 },
    { key: 'blockBaseOpacity', type: 'slider', label: 'Block Opacity', min: 0, max: 100, step: 1 },
    { key: 'blockColorMode', type: 'segmented', label: 'Block Color', options: ['Single', 'Palette'] },
    { key: 'blockColorSingle', type: 'color', label: 'Single Color' },
    { key: 'color1', type: 'color', label: 'Palette 1' },
    { key: 'color2', type: 'color', label: 'Palette 2' },
    { key: 'color3', type: 'color', label: 'Palette 3' },
    { key: 'color4', type: 'color', label: 'Palette 4' },
    { key: 'color5', type: 'color', label: 'Palette 5' }
  ] },
  { title: 'Block Texture', fields: [
    { key: 'blockTexType', type: 'segmented', label: 'Type', options: ['None', 'Grain'] },
    { key: 'blockTexAmount', type: 'slider', label: 'Amount', min: 0, max: 100, step: 1 },
    { key: 'blockTexScale', type: 'slider', label: 'Scale', min: 1, max: 20, step: 1 },
    { key: 'blockTexOpacity', type: 'slider', label: 'Opacity', min: 0, max: 100, step: 1 },
    { key: 'blockTexBlend', type: 'select', label: 'Blend', options: ['Multiply', 'Overlay', 'Soft Light', 'Screen'] }
  ] },
  { title: 'Pixel Layer', fields: [
    { key: 'pixelMode', type: 'select', label: 'Mode', options: ['Off', 'Pixel Noise', 'Pixel Gradient'] },
    { key: 'pixelSize', type: 'slider', label: 'Pixel Size', min: 2, max: 48, step: 1 },
    { key: 'pixelSpeed', type: 'slider', label: 'Speed', min: 0, max: 100, step: 1 },
    { key: 'pixelIntensity', type: 'slider', label: 'Intensity', min: 0, max: 100, step: 1 },
    { key: 'pixelOpacity', type: 'slider', label: 'Opacity', min: 0, max: 100, step: 1 },
    { key: 'pixelBlend', type: 'select', label: 'Blend', options: ['Overlay', 'Soft Light', 'Multiply', 'Screen'] },
    { key: 'pixelColor1', type: 'color', label: 'Pixel 1' },
    { key: 'pixelColor2', type: 'color', label: 'Pixel 2' },
    { key: 'pixelColor3', type: 'color', label: 'Pixel 3' },
    { key: 'pixelColor4', type: 'color', label: 'Pixel 4' }
  ] },
  { title: 'Background', fields: [
    { key: 'bgMode', type: 'segmented', label: 'Background', options: ['None', 'Solid', 'Image'] },
    { key: 'bgColor', type: 'color', label: 'Background Color' },
    { key: 'bgImage', type: 'image', label: 'Background Image' },
    { key: 'bgFit', type: 'select', label: 'Image Fit', options: ['Cover', 'Contain'] },
    { key: 'bgDim', type: 'slider', label: 'Dim', min: 0, max: 100, step: 1 }
  ] },
  { title: 'Background Texture', fields: [
    { key: 'bgTexType', type: 'select', label: 'Type', options: ['None', 'Grain', 'Dots', 'Lines'] },
    { key: 'bgTexAmount', type: 'slider', label: 'Amount', min: 0, max: 100, step: 1 },
    { key: 'bgTexScale', type: 'slider', label: 'Scale', min: 1, max: 12, step: 1 },
    { key: 'bgTexOpacity', type: 'slider', label: 'Opacity', min: 0, max: 100, step: 1 },
    { key: 'bgTexBlend', type: 'select', label: 'Blend', options: ['Multiply', 'Overlay', 'Soft Light', 'Screen'] }
  ] }
];

const defaults = {
  canvasRatio: 'Landscape: 1200 x 800 (3:2)', canvasWidth: 1200, canvasHeight: 800,
  text: 'TEXT CITY\n*\nINFORMATION\n.\nWALL\nBRICK\nBY\nBRICK\nLIGHT\nSWEEP\n/\nGENERATIVE\nSYSTEM',
  playing: true, animSpeed: 14,
  lightDir: 'Diagonal', lightWidth: 277, lightSoftness: 84, fadeGamma: 3.3,
  fontFamily: 'monospace', fontWeight: 400, textColor: '#FFFFFF', textAlpha: 100, textBlend: 'Difference',
  rowHeight: 47, minScale: 47, maxScale: 132, minRadius: 0, maxRadius: 15, blockBaseOpacity: 90,
  blockColorMode: 'Single', blockColorSingle: '#FFFFFF',
  color1: '#F44736', color2: '#3BE4FF', color3: '#D7FF5F', color4: '#B861FF', color5: '#FF9A3C',
  blockTexType: 'Grain', blockTexAmount: 0, blockTexScale: 5, blockTexOpacity: 38, blockTexBlend: 'Multiply',
  pixelMode: 'Off', pixelSize: 8, pixelSpeed: 14, pixelIntensity: 100, pixelOpacity: 27, pixelBlend: 'Overlay',
  pixelColor1: '#60DDFF', pixelColor2: '#FFFFFF', pixelColor3: '#5C5C5C', pixelColor4: '#0000FF',
  bgMode: 'Solid', bgColor: '#080808', bgImage: '', bgFit: 'Cover', bgDim: 5,
  bgTexType: 'None', bgTexAmount: 55, bgTexScale: 2, bgTexOpacity: 49, bgTexBlend: 'Overlay'
};

export default {
  id: 'text-city',
  name: 'Text City',
  description: 'Word "bricks" tiled across the canvas, revealed by a soft moving light sweep. A generative information-wall.',
  controlSchema,
  defaults,

  init(host) {
    const { canvas, ctx, controls } = host;
    const unsubs = [];
    let bricks = [];
    let lastW = 0, lastH = 0, needsLayout = true;
    let phase = 0, lastTs = null;
    const imgCache = new Map();

    function loadImg(url) {
      if (!url) return null;
      if (imgCache.has(url)) return imgCache.get(url);
      const e = { el: new Image(), ready: false };
      if (!url.startsWith('data:')) e.el.crossOrigin = 'anonymous';
      e.el.onload = () => { e.ready = true; };
      e.el.onerror = () => { e.ready = false; };
      e.el.src = url;
      imgCache.set(url, e);
      return e;
    }

    function updateCanvasSize() {
      const area = canvas.parentElement; if (!area) return;
      const ratio = controls.get('canvasRatio') || 'Responsive';
      if (ratio === 'Responsive') { canvas.width = area.clientWidth; canvas.height = area.clientHeight; canvas.style.width = '100%'; canvas.style.height = '100%'; needsLayout = true; return; }
      let w, h;
      if (ratio === 'Custom') { w = controls.get('canvasWidth') || 1200; h = controls.get('canvasHeight') || 800; }
      else if (ratio.includes('1200')) { w = 1200; h = 800; }
      else if (ratio.includes('1920')) { w = 1920; h = 1080; }
      else if (ratio.includes('Portrait')) { w = 1080; h = 1350; }
      else if (ratio.includes('Square')) { w = 1080; h = 1080; }
      else if (ratio.includes('Stories')) { w = 1080; h = 1920; }
      else { w = 1200; h = 800; }
      canvas.width = w; canvas.height = h;
      const aA = area.clientWidth / area.clientHeight, cA = w / h;
      if (aA > cA) { canvas.style.height = '100%'; canvas.style.width = 'auto'; } else { canvas.style.width = '100%'; canvas.style.height = 'auto'; }
      needsLayout = true;
    }
    this._updateCanvasSize = updateCanvasSize;
    const onResize = () => updateCanvasSize();
    window.addEventListener('resize', onResize);
    unsubs.push(() => window.removeEventListener('resize', onResize));
    ['canvasRatio', 'canvasWidth', 'canvasHeight'].forEach((k) => unsubs.push(controls.onChange(k, updateCanvasSize)));

    // layout-affecting controls → rebuild the brick grid
    ['text', 'rowHeight', 'minScale', 'maxScale', 'minRadius', 'maxRadius', 'fontFamily', 'fontWeight',
      'blockColorMode', 'blockColorSingle', 'color1', 'color2', 'color3', 'color4', 'color5'
    ].forEach((k) => unsubs.push(controls.onChange(k, () => { needsLayout = true; })));

    function reset() { phase = 0; lastTs = null; needsLayout = true; }
    unsubs.push(controls.onAction('reset', reset));

    function fontFamily() { const f = controls.get('fontFamily') || 'monospace'; const fam = typeof f === 'string' ? f : (f.family || 'monospace'); return fam.includes(' ') ? `'${fam}'` : fam; }

    function initLayout() {
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) return;
      const text = controls.get('text') || 'TEXT CITY';
      const words = text.split(/\s+/).filter((x) => x.length > 0);
      if (words.length === 0) words.push('TEXT');
      const rowHeight = controls.get('rowHeight');
      const minScale = controls.get('minScale') / 100, maxScale = controls.get('maxScale') / 100;
      const minRadius = controls.get('minRadius'), maxRadius = controls.get('maxRadius');
      const weight = controls.get('fontWeight') || 400;
      bricks = []; let wordIdx = 0, rowIdx = 0;
      ctx.font = `${weight} ${rowHeight * 0.5}px ${fontFamily()}`;
      const single = controls.get('blockColorMode') === 'Single';
      const palette = [controls.get('color1'), controls.get('color2'), controls.get('color3'), controls.get('color4'), controls.get('color5')].filter(Boolean);
      for (let y = 0; y < h + rowHeight; y += rowHeight) {
        let x = (rowIdx % 2 === 0) ? 0 : -rowHeight * 0.5;
        while (x < w + rowHeight) {
          const word = words[wordIdx % words.length];
          const metrics = ctx.measureText(word);
          const seed = rowIdx * 1000 + x;
          const scale = minScale + seededRandom(seed) * (maxScale - minScale);
          const bw = (metrics.width + rowHeight * 0.8) * scale;
          const bh = rowHeight * 0.9;
          const radius = minRadius + seededRandom(seed + 1) * (maxRadius - minRadius);
          let color = single ? (controls.get('blockColorSingle') || '#fff') : (palette.length ? palette[Math.floor(seededRandom(seed + 2) * palette.length)] : '#fff');
          bricks.push({ x, y, w: bw, h: bh, text: word, color, radius, scale, id: seed });
          x += bw + 2; wordIdx++;
        }
        rowIdx++;
      }
      lastW = w; lastH = h; needsLayout = false;
    }

    function drawBackground() {
      const w = canvas.width, h = canvas.height;
      if ((typeof window !== 'undefined') && window.__nsaanoExportTransparent) { ctx.clearRect(0, 0, w, h); return; }
      const mode = controls.get('bgMode');
      if (mode === 'Solid') { ctx.fillStyle = controls.get('bgColor') || '#000'; ctx.fillRect(0, 0, w, h); }
      else if (mode === 'Image') {
        const e = loadImg(controls.get('bgImage'));
        if (e && e.ready && e.el.naturalWidth > 0) {
          const fit = (controls.get('bgFit') || 'Cover').toLowerCase();
          const iw = e.el.naturalWidth, ih = e.el.naturalHeight;
          const sc = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
          const dw = iw * sc, dh = ih * sc; ctx.drawImage(e.el, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } else { ctx.fillStyle = controls.get('bgColor') || '#000'; ctx.fillRect(0, 0, w, h); }
      } else { ctx.clearRect(0, 0, w, h); }
      const dim = (controls.get('bgDim') || 0) / 100;
      if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, w, h); }
    }

    function drawBackgroundTexture() {
      const type = controls.get('bgTexType'); if (type === 'None') return;
      const w = canvas.width, h = canvas.height;
      const opacity = controls.get('bgTexOpacity') / 100, amount = controls.get('bgTexAmount') / 100, scale = controls.get('bgTexScale');
      ctx.save(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blendOp(controls.get('bgTexBlend'));
      if (type === 'Grain') {
        for (let i = 0; i < 5000 * amount; i++) { const x = seededRandom(i) * w, y = seededRandom(i + 1) * h, s = seededRandom(i + 2) * scale; ctx.fillStyle = seededRandom(i + 3) > 0.5 ? '#fff' : '#000'; ctx.fillRect(x, y, s, s); }
      } else if (type === 'Dots') {
        const step = scale * 4; for (let x = 0; x < w; x += step) for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.arc(x, y, scale * amount, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
      } else if (type === 'Lines') {
        const step = scale * 4; ctx.lineWidth = scale * amount; ctx.strokeStyle = '#fff'; for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      }
      ctx.restore();
    }

    function drawPixelLayer(t) {
      const mode = controls.get('pixelMode'); if (mode === 'Off') return;
      const w = canvas.width, h = canvas.height;
      const size = controls.get('pixelSize'), speed = controls.get('pixelSpeed') / 100, intensity = controls.get('pixelIntensity') / 100, opacity = controls.get('pixelOpacity') / 100;
      const palette = [controls.get('pixelColor1'), controls.get('pixelColor2'), controls.get('pixelColor3'), controls.get('pixelColor4')].filter(Boolean);
      ctx.save(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blendOp(controls.get('pixelBlend'));
      const cols = Math.ceil(w / size), rows = Math.ceil(h / size);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const n = (Math.sin(i * 0.2 + t * speed) + Math.cos(j * 0.2 - t * speed)) * 0.5 + 0.5;
        if (mode === 'Pixel Noise') { const v = Math.floor(n * 255 * intensity); ctx.fillStyle = `rgb(${v},${v},${v})`; }
        else { const idx = palette.length ? Math.floor(n * palette.length * intensity) % palette.length : 0; ctx.fillStyle = palette[idx] || '#fff'; }
        ctx.fillRect(i * size, j * size, size, size);
      }
      ctx.restore();
    }

    function drawBrickTexture(b, alpha) {
      const type = controls.get('blockTexType'); if (type === 'None') return;
      const amount = controls.get('blockTexAmount') / 100, scale = controls.get('blockTexScale'), opacity = (controls.get('blockTexOpacity') / 100) * alpha;
      ctx.save(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = blendOp(controls.get('blockTexBlend'));
      for (let i = 0; i < 100 * amount; i++) { const rx = seededRandom(b.id + i) * b.w, ry = seededRandom(b.id + i + 1) * b.h, rs = seededRandom(b.id + i + 2) * scale; ctx.fillStyle = seededRandom(b.id + i + 3) > 0.5 ? '#fff' : '#000'; ctx.fillRect(b.x + rx, b.y + ry, rs, rs); }
      ctx.restore();
    }

    this._draw = function draw(timestamp) {
      const playing = controls.get('playing');
      if (lastTs != null && playing) phase += (timestamp - lastTs);
      lastTs = timestamp;
      const t = phase * 0.001;
      const w = canvas.width, h = canvas.height;
      if (w !== lastW || h !== lastH || needsLayout) initLayout();

      drawBackground();
      drawBackgroundTexture();
      drawPixelLayer(t);

      const animSpeed = controls.get('animSpeed') / 100;
      const loopT = (t * animSpeed) % 1.0;
      const lightWidth = controls.get('lightWidth');
      const softness = controls.get('lightSoftness') / 100;
      const gamma = controls.get('fadeGamma');
      const dir = controls.get('lightDir');
      const baseOpacity = controls.get('blockBaseOpacity') / 100;

      let lightX = 0, lightY = 0;
      const rangeX = w + lightWidth * 2, rangeY = h + lightWidth * 2;
      if (dir === 'Left to Right') lightX = -lightWidth + loopT * rangeX;
      else if (dir === 'Right to Left') lightX = w + lightWidth - loopT * rangeX;
      else if (dir === 'Top to Bottom') lightY = -lightWidth + loopT * rangeY;
      else if (dir === 'Diagonal') { lightX = -lightWidth + loopT * rangeX; lightY = -lightWidth + loopT * rangeY; }

      const textColor = controls.get('textColor');
      const textAlpha = controls.get('textAlpha') / 100;
      const textBlend = blendOp(controls.get('textBlend'));
      const weight = controls.get('fontWeight') || 400;
      const fam = fontFamily();
      const rowHeight = controls.get('rowHeight');

      bricks.forEach((b) => {
        let dist = 0;
        if (dir === 'Left to Right' || dir === 'Right to Left') dist = Math.abs(b.x + b.w / 2 - lightX) / lightWidth;
        else if (dir === 'Top to Bottom') dist = Math.abs(b.y + b.h / 2 - lightY) / lightWidth;
        else { const proj = (b.x + b.w / 2 + b.y + b.h / 2) / Math.sqrt(2); const lp = (lightX + lightY) / Math.sqrt(2); dist = Math.abs(proj - lp) / lightWidth; }
        const lightVal = Math.exp(-Math.pow(dist / (softness || 0.01), 2));
        const visibility = Math.pow(Math.max(0, Math.min(1, lightVal)), gamma);
        if (visibility < 0.001) return;
        const alpha = baseOpacity * visibility;

        ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = b.color;
        drawRoundedRect(ctx, b.x, b.y, b.w, b.h, b.radius); ctx.fill();
        drawBrickTexture(b, alpha); ctx.restore();

        ctx.save(); ctx.globalAlpha = visibility * textAlpha; ctx.globalCompositeOperation = textBlend;
        ctx.fillStyle = textColor; ctx.font = `${weight} ${rowHeight * 0.4 * b.scale}px ${fam}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.text, b.x + b.w / 2, b.y + b.h / 2); ctx.restore();
      });
    };

    this._dispose = function dispose() {
      unsubs.forEach((u) => { try { u(); } catch (_) {} });
      canvas.style.background = '';
    };

    reset();
    updateCanvasSize();
  },

  draw(timestamp) { if (this._draw) this._draw(timestamp); },
  dispose() { if (this._dispose) this._dispose(); },

  // one light-sweep loop = 1 / animSpeed seconds (animSpeed is a percent)
  getNaturalDuration(controls) {
    const sp = (controls.get('animSpeed') || 14) / 100;
    return Math.max(1, Math.min(60, 1 / Math.max(0.001, sp)));
  }
};
