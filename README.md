# Nsaano

A creative-content studio for **Piqabu** — built in the Piqabu / AhTohMoh visual language.

Nsaano is a *shell* that hosts **tools**. Each tool is a small canvas engine with its own controls.
You drive a tool two ways:

1. **The control panel** ("Edit Controllers") — every knob, live, re-renders instantly.
2. **Direct manipulation** — drag text and overlays right on the canvas. **Alignment guides** snap
   them to the centre and edges, and you can **double-click a text overlay to edit it in place**.
   Select an item and use the **Align** buttons (left / centre / right / top / middle / bottom).

You can **install** new tools, **switch** between them, **remix** them, and **export** any composition
as an image (PNG/JPEG), video (MP4/WebM, with a frame-perfect "studio" H.264 encoder), or a
standalone, re-importable HTML file.

The first built-in tool is **Typing Into The Void** — a faithful recreation of the keyboard-typing
animation engine.

> A `/api/chat` proxy for Claude / OpenAI / Gemini still ships in `server/` (keys via `.env`), but the
> in-app chat console has been removed — the studio is driven entirely by the panel and the canvas.

---

## Run it

Requires Node 18+.

```bash
cd nsaano
npm install
npm start
```

Open <http://localhost:3000>. No keys or config are needed — the whole studio (panel, canvas, drag
editing, alignment, and export) runs without them.

## Deploy to Render

Nsaano has a small Node server (the model proxy), so it deploys as a **Web Service** — not a static
site. Render runs the server, keeps your API keys server-side, and gives you a public URL.

1. Push this folder to a GitHub repo (e.g. under the AhTohMoh org).
2. In Render: **New → Blueprint**, pick the repo. It reads [`render.yaml`](render.yaml) and provisions a
   free Web Service (`npm install` → `npm start`).
3. In the service's **Environment** tab, paste whichever keys you have:
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. They are *not* in the repo — Render injects
   them at runtime. The server already binds `process.env.PORT`, so nothing else needs configuring.

> If Nsaano is a **subfolder** of a bigger repo, move `render.yaml` to that repo's root and uncomment
> the `rootDir: nsaano` line — or skip the blueprint and create the Web Service manually with
> **Root Directory** = `nsaano`, build `npm install`, start `npm start`.

Notes: the **free** plan sleeps after inactivity, so the first request after idle takes ~30s to wake.
The keys are only needed for the Chat Console — the studio, canvas, and export work without them.

## How it's wired

```
server/server.js     Express — serves the studio + proxies model calls (/api/chat)
server/providers.js  Adapters for Anthropic / OpenAI / Gemini -> one normalized shape
public/              The studio (vanilla ES modules, no build step)
  js/controls.js     Reactive control store (get/set/onChange/onAction)
  js/runtime.js      Canvas runtime (background, export sizing, pointer mapping)
  js/panel.js        Renders a tool's controlSchema into the panel
  js/chat.js         Chat Console; applies the model's structured edits
  js/registry.js     Tool registry — switch / install / remix
  js/export.js       Serialize a tool to standalone HTML
  tools/             Tool modules (the typing engine lives here)
```

### Writing a tool

A tool is an ES module that default-exports a `Tool` object: `id`, `name`, `controlSchema`,
`defaults`, and lifecycle `init({ canvas, ctx, controls, runtime })` / `draw(t)` / `dispose()`.
The single `controlSchema` drives the panel UI, what the AI is allowed to change, and export.
See `public/tools/typing-into-the-void.js` for the reference implementation.

---

Made for Piqabu. Design sensibility by AhTohMoh.
