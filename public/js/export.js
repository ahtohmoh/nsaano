// export.js — serialize the active tool to a standalone, offline HTML file.
//
// The exported file embeds the control values (baked), plus the source of controls.js,
// runtime.js and the tool module. At runtime it spins those sources up as blob modules
// and runs the same engine — so the export behaves identically and is itself re-importable
// as a Nsaano tool (it's the same module source).

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error('Failed to fetch ' + url); return r.text(); }

function buildHtml({ title, controlsSrc, runtimeSrc, toolSrc, values }) {
  // JSON.stringify gives us safely-escaped JS string literals for the embedded sources.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title.replace(/</g, '&lt;')}</title>
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

export async function exportActiveTool(registry) {
  const { id, def, controls } = registry.getActive();
  if (!def) throw new Error('No active tool to export.');
  const [controlsSrc, runtimeSrc, toolSrc] = await Promise.all([
    fetchText('./js/controls.js'),
    fetchText('./js/runtime.js'),
    registry.sourceFor(id)
  ]);
  const html = buildHtml({ title: def.name, controlsSrc, runtimeSrc, toolSrc, values: controls.getAll() });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `nsaano-${def.id}-${stamp}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
