// providers.js — model-provider adapters.
//
// Each adapter takes a normalized request { model, system, messages, tools } and returns
// a normalized response { text, toolCalls: [{ name, args }] }. The frontend stays
// provider-agnostic; all the per-provider wire differences live here.
//
// One consistent fetch layer across all three providers keeps the proxy dependency-free
// (just express + dotenv) and the normalization uniform. Wire formats / model IDs for the
// Anthropic path follow the claude-api skill: POST /v1/messages, header
// anthropic-version: 2023-06-01, tool_use blocks — and NO temperature/top_p on Opus 4.8
// (those return 400).

const MAX_TOKENS = 1024;

function providerKey(provider) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  if (provider === 'google') return process.env.GEMINI_API_KEY;
  return null;
}

export function availableProviders() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    google: !!process.env.GEMINI_API_KEY
  };
}

// ─── Anthropic ───────────────────────────────────────────────────────────────
async function callAnthropic({ model, system, messages, tools }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
      // No temperature/top_p — removed on Opus 4.8 (would 400).
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ name: block.name, args: block.input || {} });
  }
  return { text: text.trim(), toolCalls };
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
async function callOpenAI({ model, system, messages, tools }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      tool_choice: 'auto'
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  const msg = data.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
    return { name: tc.function.name, args };
  });
  return { text: (msg.content || '').trim(), toolCalls };
}

// ─── Google Gemini ───────────────────────────────────────────────────────────
async function callGemini({ model, system, messages, tools }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
  let text = '';
  const toolCalls = [];
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.text) text += part.text;
    else if (part.functionCall) toolCalls.push({ name: part.functionCall.name, args: part.functionCall.args || {} });
  }
  return { text: text.trim(), toolCalls };
}

const ADAPTERS = { anthropic: callAnthropic, openai: callOpenAI, google: callGemini };

export async function chat({ provider, model, system, messages, tools }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown provider: ${provider}`);
  if (!providerKey(provider)) throw new Error(`No API key configured for ${provider}. Add it to .env and restart.`);
  return adapter({ model, system, messages: messages || [], tools: tools || [] });
}
