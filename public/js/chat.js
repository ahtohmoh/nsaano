// chat.js — the Chat Console.
//
// Sends the user's message + a description of the active tool's controls to the backend
// proxy, then applies whatever structured edits the model returns (apply_controls /
// run_action / switch_tool) and shows any prose (captions, explanations).

import { el } from './widgets.js';

const MODELS = [
  { provider: 'anthropic', model: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
  { provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { provider: 'google', model: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { provider: 'google', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
];

// Provider-agnostic tool definitions; the backend translates these per provider.
function toolSpecs(def, registry) {
  const actions = ['reset'];
  def.controlSchema.forEach((s) => s.fields.forEach((f) => { if (f.type === 'action') actions.push(f.action); }));
  const toolIds = registry.list().map((t) => t.id);
  return [
    { name: 'apply_controls', description: 'Change one or more control values for the active tool. Keys must be valid control keys.',
      input_schema: { type: 'object', properties: { changes: { type: 'object', description: 'Map of control key -> new value' } }, required: ['changes'] } },
    { name: 'run_action', description: 'Trigger a tool action (e.g. add an overlay, clear overlays, reset the animation).',
      input_schema: { type: 'object', properties: { action: { type: 'string', enum: [...new Set(actions)] } }, required: ['action'] } },
    { name: 'switch_tool', description: 'Switch to another installed tool by id. Available: ' + toolIds.join(', '),
      input_schema: { type: 'object', properties: { id: { type: 'string', enum: toolIds } }, required: ['id'] } }
  ];
}

function systemPrompt(def, controls) {
  const lines = [];
  lines.push('You are Nsaano, a creative-content copilot for Piqabu — an ephemeral, privacy-first messaging product.');
  lines.push("Piqabu's voice is quiet, intelligent, and restrained (think: monochrome, understated, a little mysterious).");
  lines.push(`The user is editing the tool "${def.name}": ${def.description || ''}`);
  lines.push('When the user asks to change the look/behaviour, call apply_controls / run_action / switch_tool. When they ask for copy or captions, reply in prose. You may do both.');
  lines.push('Only use control keys listed below, and respect each control\'s type and allowed options.');
  lines.push('');
  lines.push('CONTROLS (key · type · options/range · current value):');
  const values = controls.getAll();
  def.controlSchema.forEach((section) => {
    section.fields.forEach((f) => {
      if (f.type === 'action' || !f.key) return;
      let meta = f.type;
      if (f.options) meta += ` [${f.options.map((o) => (typeof o === 'object' ? o.value : o)).join(', ')}]`;
      if (f.min != null) meta += ` (${f.min}..${f.max})`;
      let cur = values[f.key];
      if (typeof cur === 'string' && cur.length > 40) cur = cur.slice(0, 40) + '…';
      if (cur && typeof cur === 'object') cur = '[…]';
      lines.push(`- ${f.key} · ${meta} · now: ${JSON.stringify(cur)}`);
    });
  });
  return lines.join('\n');
}

export function initChat({ root, registry }) {
  let available = { anthropic: true, openai: true, google: true };
  const history = [];

  // --- DOM ---
  const messages = el('div', { class: 'chat-messages' });
  const intro = el('div', { class: 'chat-intro' }, [
    el('p', {}, 'Tell Nsaano what to make.'),
    el('p', { class: 'chat-intro-sub' }, 'e.g. “make the keys glass and slow the typing”, or “write a launch caption about privacy”.')
  ]);
  messages.appendChild(intro);

  const ta = el('textarea', { class: 'chat-input', rows: 2, placeholder: 'Describe your vision…' });
  const modelSel = el('select', { class: 'chat-model' });
  MODELS.forEach((m, i) => modelSel.appendChild(el('option', { value: i }, m.label)));
  const sendBtn = el('button', { class: 'chat-send', type: 'button', title: 'Send' }, '↑');

  const composer = el('div', { class: 'chat-composer' }, [
    ta,
    el('div', { class: 'chat-composer-row' }, [modelSel, sendBtn])
  ]);

  root.appendChild(messages);
  root.appendChild(composer);

  function addBubble(role, text, note) {
    if (intro.parentElement) intro.remove();
    const b = el('div', { class: `bubble bubble--${role}` });
    if (text) b.appendChild(el('div', { class: 'bubble-text' }, text));
    if (note) b.appendChild(el('div', { class: 'bubble-note' }, note));
    messages.appendChild(b);
    messages.scrollTop = messages.scrollHeight;
    return b;
  }

  function typeMapFor(def) {
    const map = {};
    def.controlSchema.forEach((s) => s.fields.forEach((f) => { if (f.key) map[f.key] = f.type; }));
    return map;
  }
  function coerce(type, v) {
    if ((type === 'slider') && typeof v !== 'number') { const n = Number(v); return isNaN(n) ? v : n; }
    if (type === 'toggle' && typeof v !== 'boolean') return v === true || v === 'true' || v === 1 || v === '1';
    return v;
  }

  function applyToolCalls(calls) {
    const { def, controls } = registry.getActive();
    const tmap = typeMapFor(def);
    const notes = [];
    for (const call of calls) {
      if (call.name === 'apply_controls' && call.args && call.args.changes) {
        const changes = {};
        for (const [k, v] of Object.entries(call.args.changes)) {
          if (!controls.has(k)) { notes.push(`(ignored unknown “${k}”)`); continue; }
          changes[k] = coerce(tmap[k], v);
        }
        const changed = controls.apply(changes);
        if (changed.length) notes.push('Updated: ' + changed.join(', '));
      } else if (call.name === 'run_action' && call.args && call.args.action) {
        controls.triggerAction(call.args.action);
        notes.push('Ran: ' + call.args.action);
      } else if (call.name === 'switch_tool' && call.args && call.args.id) {
        try { registry.activate(call.args.id); notes.push('Switched tool → ' + call.args.id); }
        catch (e) { notes.push('Could not switch tool: ' + e.message); }
      }
    }
    return notes.join(' · ');
  }

  async function send() {
    const text = ta.value.trim();
    if (!text) return;
    const sel = MODELS[Number(modelSel.value)];
    if (!available[sel.provider]) {
      addBubble('system', `No API key configured for ${sel.provider}. Add one to .env and restart the server.`);
      return;
    }
    ta.value = '';
    addBubble('user', text);
    history.push({ role: 'user', content: text });

    const { def, controls } = registry.getActive();
    const pending = addBubble('assistant', '…');
    sendBtn.disabled = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: sel.provider, model: sel.model,
          system: systemPrompt(def, controls),
          messages: history.slice(-12),
          tools: toolSpecs(def, registry)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      const note = (data.toolCalls && data.toolCalls.length) ? applyToolCalls(data.toolCalls) : '';
      pending.remove();
      const shown = data.text || (note ? 'Done.' : '(no response)');
      addBubble('assistant', shown, note);
      history.push({ role: 'assistant', content: shown + (note ? `\n[${note}]` : '') });
    } catch (e) {
      pending.remove();
      addBubble('system', 'Error: ' + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', send);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  // mark models whose provider lacks a key
  fetch('/api/models').then((r) => r.json()).then((m) => {
    available = Object.assign(available, m);
    [...modelSel.options].forEach((opt) => {
      const prov = MODELS[Number(opt.value)].provider;
      if (!available[prov]) opt.textContent = MODELS[Number(opt.value)].label + ' (no key)';
    });
  }).catch(() => {});

  return { send };
}
