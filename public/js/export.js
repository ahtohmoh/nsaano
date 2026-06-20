// export.js — the Export modal: image (PNG/JPEG), video (MP4/WebM), and code (standalone HTML).
//
// Stills are re-rendered at the chosen scale for true high-res output (not upscaled).
// Video is captured from the live canvas via MediaRecorder at the canvas's native
// resolution, with a bitrate derived from resolution × fps × quality — and prefers
// H.264 MP4 when the browser supports it, falling back to WebM (VP9) otherwise.

import { el } from './widgets.js';

const JPEG_QUALITY = { Low: 0.5, Standard: 0.72, Medium: 0.85, High: 0.95 };
// bits per pixel per frame — higher = crisper video, larger file
const VIDEO_BPP = { Low: 0.04, Standard: 0.07, Medium: 0.11, High: 0.18 };

function canvasEl() { return document.getElementById('canvas'); }

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function ratioLabel(w, h) { const g = gcd(w, h) || 1; return `${w / g}:${h / g}`; }
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ─── stills ──────────────────────────────────────────────────────────────────
function bgColorFor(controls) {
  const mode = controls.has('bgMode') ? controls.get('bgMode') : 'None';
  if (mode === 'Solid' && controls.has('bgColor')) return controls.get('bgColor');
  return '#FFFFFF'; // sensible opaque backing when there's no solid bg
}

// Re-render the active tool at `scale`× its current resolution, composite a background
// if requested, and return a data URL.
function captureStill(registry, { scale, format, transparent, quality }) {
  const canvas = canvasEl();
  const { def, controls } = registry.getActive();
  const baseW = canvas.width, baseH = canvas.height;
  const w = Math.round(baseW * scale), h = Math.round(baseH * scale);

  canvas.width = w; canvas.height = h;
  try { def.draw(performance.now()); } catch (e) { console.error(e); }

  const out = el('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d');
  if (!(format === 'png' && transparent)) {
    octx.fillStyle = bgColorFor(controls);
    octx.fillRect(0, 0, w, h);
  }
  octx.drawImage(canvas, 0, 0);

  // restore live resolution
  canvas.width = baseW; canvas.height = baseH;
  try { def.draw(performance.now()); } catch (e) { console.error(e); }

  return format === 'jpeg' ? out.toDataURL('image/jpeg', quality) : out.toDataURL('image/png');
}

// ─── video ───────────────────────────────────────────────────────────────────
function pickMime(format) {
  const cands = format === 'mp4'
    ? ['video/mp4;codecs=avc1.640029', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (!window.MediaRecorder) return null;
  return cands.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

function computeBitrate(w, h, fps, quality) {
  const bpp = VIDEO_BPP[quality] ?? VIDEO_BPP.Medium;
  return Math.max(1_000_000, Math.min(40_000_000, Math.round(w * h * fps * bpp)));
}

async function recordVideo(registry, { format, fps, durationSec, quality, onProgress }) {
  const canvas = canvasEl();
  let mime = pickMime(format);
  let actualFormat = format;
  if (!mime && format === 'mp4') { mime = pickMime('webm'); actualFormat = 'webm'; } // graceful fallback
  if (!mime) throw new Error('This browser cannot record video.');

  const stream = canvas.captureStream(fps);
  const videoBitsPerSecond = computeBitrate(canvas.width, canvas.height, fps, quality);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });

  // start the take from a clean first keystroke
  const { controls } = registry.getActive();
  controls.set('playing', true);
  controls.triggerAction('reset');

  rec.start(); // no timeslice — the MP4 muxer emits nothing on a timeslice in some browsers
  const start = performance.now();
  await new Promise((res) => {
    const tick = () => {
      const elapsed = performance.now() - start;
      if (onProgress) onProgress(Math.min(1, elapsed / (durationSec * 1000)));
      if (elapsed >= durationSec * 1000) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime });
  if (!blob.size) throw new Error('Recording produced no data — try WebM, or lower the FPS/quality.');
  return { blob, format: actualFormat, fellBack: actualFormat !== format };
}

// ─── studio video (deterministic frames + WebCodecs H.264 + mp4-muxer) ─────────
// Renders every frame at an exact time (t = i/fps) instead of capturing in real time,
// then encodes each frame with the platform's hardware H.264 encoder (WebCodecs
// VideoEncoder) at a fixed bitrate and muxes to MP4 — frame-perfect, no dropped frames,
// no encoder variance, no big download. Needs WebCodecs (Chrome/Edge/Brave/Safari 16.4+).
const STUDIO_MAX_FRAMES = 1200;
// studio bitrate is generous (bits per pixel per frame) for broadcast-grade output
const STUDIO_BPP = { Low: 0.06, Standard: 0.10, Medium: 0.16, High: 0.24 };

export function studioSupported() { return !!(typeof window !== 'undefined' && window.__nsaanoClock && window.VideoEncoder && window.VideoFrame); }

async function pickH264Codec(width, height, bitrate, framerate) {
  // try High → Main → Baseline at a permissive level until the platform accepts one
  for (const codec of ['avc1.640033', 'avc1.4D4033', 'avc1.42E033', 'avc1.42E01E']) {
    for (const extra of [{ bitrateMode: 'constant' }, {}]) {
      try {
        const cfg = { codec, width, height, bitrate, framerate, ...extra };
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s && s.supported) return cfg;
      } catch (_) { /* try next */ }
    }
  }
  return null;
}

async function renderStudioVideo(registry, { fps, durationSec, quality, onProgress, onStatus }) {
  if (!studioSupported()) throw new Error('Frame-perfect export needs WebCodecs (Chrome, Edge, Brave, or Safari 16.4+).');
  if (onStatus) onStatus('Preparing encoder…');
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm');

  const canvas = canvasEl();
  const { def, controls } = registry.getActive();
  const clock = window.__nsaanoClock;
  const W = canvas.width, H = canvas.height;

  let frames = Math.round(durationSec * fps);
  const clamped = frames > STUDIO_MAX_FRAMES;
  if (clamped) frames = STUDIO_MAX_FRAMES;

  const bitrate = Math.max(1_000_000, Math.min(60_000_000, Math.round(W * H * fps * (STUDIO_BPP[quality] ?? STUDIO_BPP.High))));
  const config = await pickH264Codec(W, H, bitrate, fps);
  if (!config) throw new Error('No H.264 encoder configuration is supported for this canvas size.');

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; }
  });
  encoder.configure(config);

  if (onStatus) onStatus('Rendering frames…');
  controls.set('playing', true);
  clock.manual = 0;
  controls.triggerAction('reset'); // reset() reads clockNow() === 0
  const gop = Math.max(1, Math.round(fps * 2)); // keyframe every ~2s
  try {
    for (let i = 0; i < frames; i++) {
      if (encodeError) throw encodeError;
      const t = (i / fps) * 1000;
      clock.manual = t;
      try { def.draw(t); } catch (e) { console.error(e); }
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();
      if (onProgress) onProgress(0.92 * ((i + 1) / frames));
      if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r)); // backpressure
    }
  } finally {
    clock.manual = null; // resume the live RAF loop no matter what
  }

  if (onStatus) onStatus('Finalizing MP4…');
  await encoder.flush();
  if (encodeError) throw encodeError;
  muxer.finalize();
  if (onProgress) onProgress(1);

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  if (!blob.size) throw new Error('Encoding produced no data.');
  return { blob, frames, clamped };
}

// ─── standalone HTML (Code tab) ────────────────────────────────────────────────
async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error('Failed to fetch ' + url); return r.text(); }

function buildHtmlDoc({ title, controlsSrc, runtimeSrc, toolSrc, values }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${String(title).replace(/</g, '&lt;')}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"><\/script>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:#080808;overflow:hidden;font-family:system-ui,-apple-system,sans-serif}
  .stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative}
  canvas{display:block;border-radius:16px}
</style>
</head>
<body>
  <div class="stage"><canvas id="canvas"></canvas></div>
  <script type="module">
    const CONTROLS_SRC = ${JSON.stringify(controlsSrc)};
    const RUNTIME_SRC  = ${JSON.stringify(runtimeSrc)};
    const TOOL_SRC     = ${JSON.stringify(toolSrc)};
    const BAKED        = ${JSON.stringify(values)};
    const mk = (src) => import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const [controlsMod, runtimeMod, toolMod] = await Promise.all([mk(CONTROLS_SRC), mk(RUNTIME_SRC), mk(TOOL_SRC)]);
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = BAKED.canvasWidth || 1080;
    canvas.height = BAKED.canvasHeight || 1350;
    const runtime = runtimeMod.createRuntime(canvas);
    const controls = controlsMod.createControls(BAKED);
    const tool = toolMod.default;
    tool.init({ canvas, ctx, controls, runtime });
    function loop(t) { tool.draw(t); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  <\/script>
</body>
</html>`;
}

export async function buildStandaloneHtml(registry) {
  const { id, def, controls } = registry.getActive();
  if (!def) throw new Error('No active tool.');
  const [controlsSrc, runtimeSrc, toolSrc] = await Promise.all([
    fetchText('./js/controls.js'),
    fetchText('./js/runtime.js'),
    registry.sourceFor(id)
  ]);
  return buildHtmlDoc({ title: def.name, controlsSrc, runtimeSrc, toolSrc, values: controls.getAll() });
}

// ─── the modal ─────────────────────────────────────────────────────────────────
const FORMATS = {
  png: { group: 'Image', label: 'PNG', blurb: 'Lossless raster image with transparent-background support.' },
  jpeg: { group: 'Image', label: 'JPEG', blurb: 'Compressed raster image — smaller files, no transparency.' },
  mp4: { group: 'Video', label: 'MP4', blurb: 'Best for sharing online — H.264 where supported, broad playback.' },
  webm: { group: 'Video', label: 'WebM', blurb: 'Open video format — efficient VP9, great quality per byte.' },
  code: { group: 'Web', label: 'Code', blurb: 'Self-contained HTML you can drop into any site.' }
};

function segmented(options, value, onPick) {
  const wrap = el('div', { class: 'segmented' });
  const btns = options.map((o) => {
    const v = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? o.label : String(o);
    const b = el('button', { class: 'seg-btn', type: 'button' }, label);
    b.addEventListener('click', () => { value = v; sync(); onPick(v); });
    b._v = v; return b;
  });
  function sync() { btns.forEach((b) => b.classList.toggle('is-active', b._v === value)); }
  btns.forEach((b) => wrap.appendChild(b)); sync();
  return wrap;
}

export function openExportModal(registry) {
  const canvas = canvasEl();
  const baseW = canvas.width, baseH = canvas.height;

  const studioAvailable = studioSupported();
  const state = { format: 'png', scale: 2, transparent: false, jpegQuality: 'High', fps: 30, duration: 4, autoDuration: true, naturalDuration: 0, videoQuality: 'High', studio: studioAvailable, busy: false };
  // effective recording length: the tool's natural length in Auto mode, else the manual value
  const effDuration = () => (state.autoDuration ? (state.naturalDuration || state.duration) : state.duration);

  const main = el('div', { class: 'export-main' });
  const footer = el('div', { class: 'export-footer' });

  // sidebar
  const sidebar = el('div', { class: 'export-sidebar' });
  ['Image', 'Video', 'Web'].forEach((group) => {
    sidebar.appendChild(el('div', { class: 'export-group' }, group));
    Object.entries(FORMATS).filter(([, f]) => f.group === group).forEach(([key, f]) => {
      const item = el('button', { class: 'export-item' + (key === state.format ? ' is-active' : ''), type: 'button' }, f.label);
      item.dataset.fmt = key;
      item.addEventListener('click', () => { state.format = key; renderItems(); renderMain(); });
      sidebar.appendChild(item);
    });
  });
  function renderItems() { [...sidebar.querySelectorAll('.export-item')].forEach((b) => b.classList.toggle('is-active', b.dataset.fmt === state.format)); }

  function setFooter(text) { footer.textContent = text; }

  function renderMain() {
    main.innerHTML = '';
    const f = FORMATS[state.format];
    main.appendChild(el('div', { class: 'export-head' }, [
      el('div', { class: 'export-title' }, f.label),
      el('div', { class: 'export-blurb' }, f.blurb)
    ]));
    if (state.format === 'png' || state.format === 'jpeg') return renderImage();
    if (state.format === 'mp4' || state.format === 'webm') return renderVideo();
    return renderCode();
  }

  function field(label, control) {
    return el('div', { class: 'export-field' }, [el('label', { class: 'export-label' }, label), control]);
  }

  function renderImage() {
    const scaleOpts = [1, 1.5, 2, 3, 4, 5].map((v) => ({ value: v, label: v + '×' }));
    main.appendChild(field('Scale', segmented(scaleOpts, state.scale, (v) => { state.scale = v; updateImageFooter(); })));
    if (state.format === 'jpeg') {
      const sel = el('select', { class: 'select' });
      ['Low', 'Standard', 'Medium', 'High'].forEach((q) => sel.appendChild(el('option', { value: q }, q)));
      sel.value = state.jpegQuality;
      sel.addEventListener('change', () => { state.jpegQuality = sel.value; });
      main.appendChild(field('Quality', sel));
    } else {
      const sw = el('button', { class: 'toggle' + (state.transparent ? ' is-on' : ''), type: 'button' }, el('span', { class: 'toggle-knob' }));
      sw.addEventListener('click', () => { state.transparent = !state.transparent; sw.classList.toggle('is-on', state.transparent); });
      main.appendChild(el('div', { class: 'export-card' }, [
        el('div', {}, [el('div', { class: 'export-card-title' }, 'Transparent Background'), el('div', { class: 'export-card-sub' }, 'Export the canvas with no background fill')]),
        sw
      ]));
    }
    const btn = el('button', { class: 'btn-primary export-action', type: 'button' }, `Download ${FORMATS[state.format].label}`);
    btn.addEventListener('click', () => {
      const quality = JPEG_QUALITY[state.jpegQuality];
      const url = captureStill(registry, { scale: state.scale, format: state.format, transparent: state.transparent, quality });
      downloadDataUrl(url, `nsaano-${Date.now()}.${state.format === 'jpeg' ? 'jpg' : 'png'}`);
    });
    main.appendChild(btn);
    updateImageFooter();
  }
  function updateImageFooter() {
    const w = Math.round(baseW * state.scale), h = Math.round(baseH * state.scale);
    setFooter(`${baseW} × ${baseH} → ${w} × ${h} · ${ratioLabel(baseW, baseH)} · ${FORMATS[state.format].label}`);
  }

  function renderVideo() {
    // Auto-detect the animation's natural length from the active tool.
    const natural = Math.max(1, Math.round((registry.getActive().def.getNaturalDuration && registry.getActive().def.getNaturalDuration(registry.getActive().controls)) || state.duration));
    state.naturalDuration = natural;

    const dur = el('input', { type: 'range', class: 'slider-range', min: 1, max: Math.max(20, natural), step: 1 });
    const durVal = el('span', { class: 'export-readout' });
    const autoSw = el('button', { class: 'toggle' + (state.autoDuration ? ' is-on' : ''), type: 'button', title: 'Match the animation length automatically' }, el('span', { class: 'toggle-knob' }));
    function syncDur() {
      dur.disabled = state.autoDuration;
      dur.value = state.autoDuration ? natural : state.duration;
      durVal.textContent = state.autoDuration ? `${natural}s · auto` : `${state.duration}s`;
    }
    autoSw.addEventListener('click', () => { state.autoDuration = !state.autoDuration; autoSw.classList.toggle('is-on', state.autoDuration); syncDur(); updateVideoFooter(); });
    dur.addEventListener('input', () => { if (state.autoDuration) return; state.duration = Number(dur.value); durVal.textContent = `${state.duration}s`; updateVideoFooter(); });
    syncDur();
    main.appendChild(el('div', { class: 'export-field' }, [
      el('div', { class: 'export-field-head' }, [
        el('label', { class: 'export-label' }, 'Duration'),
        el('div', { class: 'export-auto' }, [el('span', { class: 'export-auto-label' }, 'Auto'), autoSw])
      ]),
      el('div', { class: 'slider' }, [dur, durVal])
    ]));

    const fpsSel = el('select', { class: 'select' });
    [24, 30, 60].forEach((f) => fpsSel.appendChild(el('option', { value: f }, f)));
    fpsSel.value = state.fps;
    fpsSel.addEventListener('change', () => { state.fps = Number(fpsSel.value); updateVideoFooter(); });

    const qSel = el('select', { class: 'select' });
    ['Low', 'Standard', 'Medium', 'High'].forEach((q) => qSel.appendChild(el('option', { value: q }, q)));
    qSel.value = state.videoQuality;
    qSel.addEventListener('change', () => { state.videoQuality = qSel.value; updateVideoFooter(); });
    main.appendChild(el('div', { class: 'export-row' }, [field('FPS', fpsSel), field('Quality', qSel)]));

    // Studio (frame-perfect WebCodecs H.264) — MP4 only.
    const note = el('div', { class: 'export-note' });
    if (state.format === 'mp4' && studioAvailable) {
      const sw = el('button', { class: 'toggle' + (state.studio ? ' is-on' : ''), type: 'button' }, el('span', { class: 'toggle-knob' }));
      sw.addEventListener('click', () => { state.studio = !state.studio; sw.classList.toggle('is-on', state.studio); refreshNote(); updateVideoFooter(); });
      main.appendChild(el('div', { class: 'export-card' }, [
        el('div', {}, [el('div', { class: 'export-card-title' }, 'Studio encode (frame-perfect)'), el('div', { class: 'export-card-sub' }, 'Renders every frame and encodes H.264 via WebCodecs — exact frames, no encoder variance')]),
        sw
      ]));
    }
    function refreshNote() {
      if (state.format === 'mp4' && state.studio) note.textContent = `Frame-perfect H.264 via your GPU encoder (WebCodecs) — no download. Up to ${STUDIO_MAX_FRAMES} frames.`;
      else if (!pickMime('mp4') && state.format === 'mp4') note.textContent = 'This browser has no native MP4 recorder — it will export an equivalent WebM instead.';
      else note.textContent = '';
    }
    refreshNote();
    main.appendChild(note);

    const isStudio = () => state.format === 'mp4' && state.studio && studioAvailable;
    const label = () => isStudio() ? 'Render MP4 (Studio)' : `Record ${FORMATS[state.format].label}`;
    const btn = el('button', { class: 'btn-primary export-action', type: 'button' }, label());
    const status = el('div', { class: 'export-note export-status' });
    const prog = el('div', { class: 'export-progress' });
    btn.addEventListener('click', async () => {
      if (state.busy) return; state.busy = true; btn.disabled = true;
      status.textContent = ''; main.querySelectorAll('.export-note--err').forEach((n) => n.remove());
      try {
        if (isStudio()) {
          btn.textContent = 'Rendering…';
          const { blob, frames, clamped } = await renderStudioVideo(registry, {
            fps: state.fps, durationSec: effDuration(), quality: state.videoQuality,
            onProgress: (p) => { prog.style.width = Math.round(p * 100) + '%'; },
            onStatus: (s) => { status.textContent = s; }
          });
          downloadBlob(blob, `nsaano-${Date.now()}.mp4`);
          status.textContent = `Encoded ${frames} frames${clamped ? ` (clamped to ${STUDIO_MAX_FRAMES})` : ''} · ${fmtBytes(blob.size)}`;
          btn.textContent = 'Done ✓';
        } else {
          btn.textContent = 'Recording…';
          const { blob, format, fellBack } = await recordVideo(registry, {
            format: state.format, fps: state.fps, durationSec: effDuration(), quality: state.videoQuality,
            onProgress: (p) => { prog.style.width = Math.round(p * 100) + '%'; }
          });
          downloadBlob(blob, `nsaano-${Date.now()}.${format}`);
          btn.textContent = fellBack ? 'Saved as WebM ✓' : 'Done ✓';
        }
      } catch (e) {
        btn.textContent = 'Failed'; status.textContent = '';
        main.appendChild(el('div', { class: 'export-note export-note--err' }, e.message));
      } finally {
        state.busy = false; btn.disabled = false;
        setTimeout(() => { btn.textContent = label(); prog.style.width = '0%'; }, 2000);
      }
    });
    main.appendChild(btn);
    main.appendChild(el('div', { class: 'export-progress-track' }, prog));
    main.appendChild(status);
    updateVideoFooter();
  }
  function updateVideoFooter() {
    const d = effDuration();
    const studio = state.format === 'mp4' && state.studio && studioAvailable;
    if (studio) {
      const n = Math.min(STUDIO_MAX_FRAMES, Math.round(d * state.fps));
      const bps = Math.round(baseW * baseH * state.fps * (STUDIO_BPP[state.videoQuality] ?? STUDIO_BPP.High));
      const mbps = (Math.max(1_000_000, Math.min(60_000_000, bps)) / 1_000_000).toFixed(1);
      setFooter(`${baseW} × ${baseH} · ${ratioLabel(baseW, baseH)} · ${n} frames @ ${state.fps} FPS · H.264 ${mbps} Mbps · STUDIO`);
      return;
    }
    const bps = computeBitrate(baseW, baseH, state.fps, state.videoQuality);
    const sizeBytes = (bps / 8) * d;
    setFooter(`${baseW} × ${baseH} · ${ratioLabel(baseW, baseH)} · ${d}s @ ${state.fps} FPS · ~${fmtBytes(sizeBytes)} · ${FORMATS[state.format].label.toUpperCase()}`);
  }

  function renderCode() {
    const ta = el('textarea', { class: 'export-code', readonly: 'readonly', rows: 12 }, 'Building…');
    const copyBtn = el('button', { class: 'btn-ghost export-copy', type: 'button' }, 'Copy');
    const dlBtn = el('button', { class: 'btn-primary export-action', type: 'button' }, 'Download HTML');
    main.appendChild(el('div', { class: 'export-code-head' }, copyBtn));
    main.appendChild(ta);
    main.appendChild(dlBtn);
    setFooter("A copy of the design's code, exactly as it appears now.");

    let html = '';
    buildStandaloneHtml(registry).then((h) => { html = h; ta.value = h; }).catch((e) => { ta.value = 'Error: ' + e.message; });
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(html || ta.value); copyBtn.textContent = 'Copied ✓'; }
      catch (_) { ta.select(); document.execCommand('copy'); copyBtn.textContent = 'Copied ✓'; }
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
    dlBtn.addEventListener('click', () => downloadBlob(new Blob([html || ta.value], { type: 'text/html' }), `nsaano-${registry.getActive().def.id}-${Date.now()}.html`));
  }

  function downloadDataUrl(url, filename) {
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // assemble
  const closeBtn = el('button', { class: 'export-close', type: 'button' }, '×');
  const modal = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal export-modal' }, [
      el('div', { class: 'export-modal-head' }, [el('div', { class: 'export-modal-title' }, 'Export'), closeBtn]),
      el('div', { class: 'export-body' }, [sidebar, el('div', { class: 'export-pane' }, [main, footer])])
    ])
  ]);
  const close = () => modal.remove();
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal && !state.busy) close(); });
  document.body.appendChild(modal);
  renderMain();
}
