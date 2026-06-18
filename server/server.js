// server.js — Express server: serves the Nsaano studio and proxies model calls.
//
// Keys live here (loaded from .env) and never reach the browser. The frontend posts a
// provider-agnostic request to /api/chat; providers.js adapts it per model vendor.

import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, availableProviders } from './providers.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

// Which providers have a key configured (so the UI can flag the rest).
app.get('/api/models', (req, res) => {
  res.json(availableProviders());
});

// Proxy a chat turn to the selected provider.
app.post('/api/chat', async (req, res) => {
  const { provider, model, system, messages, tools } = req.body || {};
  if (!provider || !model) return res.status(400).json({ error: 'provider and model are required' });
  try {
    const result = await chat({ provider, model, system, messages, tools });
    res.json(result);
  } catch (err) {
    console.error('[chat]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  const av = availableProviders();
  const ready = Object.entries(av).filter(([, v]) => v).map(([k]) => k);
  console.log(`\n  Nsaano → http://localhost:${PORT}`);
  console.log(`  Providers with keys: ${ready.length ? ready.join(', ') : 'none (chat disabled — add keys to .env)'}\n`);
});
