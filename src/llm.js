import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ModelUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.cause = cause;
  }
}

export function getConfig() {
  return {
    provider: (process.env.LLM_PROVIDER || 'local').toLowerCase(),
    localModel: process.env.LOCAL_MODEL || 'onnx-community/Qwen2.5-0.5B-Instruct',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:3b',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1',
    openaiModel: process.env.OPENAI_MODEL || 'llama-3.1-8b-instant',
    timeoutMs: Number(process.env.MODEL_TIMEOUT_MS || 60000),
    simulateFailure: process.env.SIMULATE_MODEL_FAILURE === '1',
  };
}

export function describeModel(cfg = getConfig()) {
  switch (cfg.provider) {
    case 'local': return `local:${cfg.localModel}`;
    case 'ollama': return `ollama:${cfg.ollamaModel}`;
    case 'openai': return `openai-compatible:${cfg.openaiModel}`;
    case 'mock': return 'MOCK (not a real language model)';
    default: return cfg.provider;
  }
}

/** Sends chat messages to the configured provider. Throws ModelUnavailableError on any failure. */
export async function chat(messages, { simulateFailure = false } = {}) {
  const cfg = getConfig();
  if (simulateFailure || cfg.simulateFailure) {
    throw new ModelUnavailableError('Simulated model failure (test mode).');
  }
  try {
    return await withTimeout(callProvider(cfg, messages), cfg.timeoutMs);
  } catch (err) {
    if (err instanceof ModelUnavailableError) throw err;
    throw new ModelUnavailableError(`Model call failed (${describeModel(cfg)}): ${err.message}`, err);
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ModelUnavailableError(`Model did not respond within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function callProvider(cfg, messages) {
  switch (cfg.provider) {
    case 'local': return callLocal(cfg, messages);
    case 'ollama': return callOllama(cfg, messages);
    case 'openai': return callOpenAICompatible(cfg, messages);
    case 'mock': return callMock(messages);
    default: throw new ModelUnavailableError(`Unknown LLM_PROVIDER "${cfg.provider}".`);
  }
}

let localGenerator;
function loadLocal(cfg) {
  if (!localGenerator) {
    localGenerator = import('@huggingface/transformers').then(({ pipeline, env }) => {
      env.cacheDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.model-cache');
      return pipeline('text-generation', cfg.localModel, { dtype: 'q4' });
    });
    localGenerator.catch(() => { localGenerator = undefined; });
  }
  return localGenerator;
}

/** Downloads/loads the local model up front so the per-question timeout only covers answering. */
export async function warmUp() {
  const cfg = getConfig();
  if (cfg.provider !== 'local') return;
  try {
    await loadLocal(cfg);
  } catch (err) {
    console.error(`Could not load local model ${cfg.localModel}: ${err.message}`);
  }
}

async function callLocal(cfg, messages) {
  const generator = await loadLocal(cfg);
  const out = await generator(messages, { max_new_tokens: 160, do_sample: false });
  return out[0].generated_text.at(-1).content.trim();
}

async function callOllama(cfg, messages) {
  const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.ollamaModel, messages, stream: false, options: { temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message.content.trim();
}

async function callOpenAICompatible(cfg, messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModelUnavailableError('OPENAI_API_KEY is not set.');
  const res = await fetch(`${cfg.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: cfg.openaiModel, messages, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// MOCK: echoes the first supporting sentence it was given. Proves the plumbing, not answer quality.
function callMock(messages) {
  const user = messages.at(-1).content;
  const match = user.match(/\[(Doc \d+)[^\]]*\]\n([^\n]+)/);
  if (!match) return 'NOT_FOUND';
  return `[MOCK] ${match[2]}\nSOURCE: ${match[1]}`;
}
