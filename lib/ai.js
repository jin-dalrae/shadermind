import { OpenAI } from "openai";

const MINIMAX_API_BASE = process.env.MINIMAX_API_BASE || "https://api.minimax.io/v1";
const MINIMAX_INFERENCE_MODEL = process.env.MINIMAX_INFERENCE_MODEL || "minimax-m3";
const MINIMAX_TIMEOUT_MS = Number(process.env.MINIMAX_TIMEOUT_MS) || 5000;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 30000;
const DO_BASE_URL = "https://inference.do-ai.run/v1";
const DO_ROUTER = process.env.DO_INFERENCE_ROUTER || "";
const ALLOW_GEMINI_FALLBACK = process.env.ALLOW_GEMINI_FALLBACK === "true";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_GLSL_MODEL = process.env.GEMINI_GLSL_MODEL || GEMINI_MODEL;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;

function isLogInferenceEnabled() {
  return process.env.LOG_INFERENCE === "true";
}
function inferenceLogCap() {
  return Number(process.env.INFERENCE_LOG_CAP) || 200;
}

function resolveGeminiModel(task) {
  return task === "glsl" ? GEMINI_GLSL_MODEL : GEMINI_MODEL;
}

// Single global model name; DO_MODELS_<TASK> env overrides one task at a time.
const DEFAULT_MODEL = process.env.DO_INFERENCE_MODEL || "claude-opus-4.8";

const TASK_MODELS = {
  planning: parseModelList(process.env.DO_MODELS_PLANNING, [DEFAULT_MODEL]),
  glsl: parseModelList(process.env.DO_MODELS_GLSL, [DEFAULT_MODEL]),
  evolution: parseModelList(process.env.DO_MODELS_EVOLUTION, [DEFAULT_MODEL]),
  curation: parseModelList(process.env.DO_MODELS_CURATION, [DEFAULT_MODEL]),
  narrative: parseModelList(process.env.DO_MODELS_NARRATIVE, [DEFAULT_MODEL]),
  consolidation: parseModelList(process.env.DO_MODELS_CONSOLIDATION, [DEFAULT_MODEL])
};

let doClient = null;
let minimaxClient = null;
let sessionAffinity = null;
let lastRoutedModel = null;
let lastInferenceMetadata = null;
const inferenceCalls = [];

function parseModelList(raw, defaults) {
  if (!raw?.trim()) return defaults;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDoClient() {
  if (!doClient) {
    const apiKey = process.env.DIGITAL_OCEAN_MODEL_ACCESS_KEY;
    if (!apiKey) {
      throw new Error("DIGITAL_OCEAN_MODEL_ACCESS_KEY is required for DigitalOcean Inference.");
    }
    doClient = new OpenAI({ baseURL: DO_BASE_URL, apiKey });
  }
  return doClient;
}

function getMinimaxClient() {
  if (!minimaxClient) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new Error("MINIMAX_API_KEY is required for MiniMax inference.");
    }
    minimaxClient = new OpenAI({ baseURL: MINIMAX_API_BASE, apiKey });
  }
  return minimaxClient;
}

export function setSessionAffinity(id) {
  sessionAffinity = id || null;
}

export function getLastRoutedModel() {
  return lastRoutedModel;
}

export function getLastInferenceMetadata() {
  return lastInferenceMetadata ? { ...lastInferenceMetadata } : null;
}

export function getAIConfig() {
  return {
    provider: "digitalocean",
    minimaxApiBase: MINIMAX_API_BASE,
    minimaxModel: MINIMAX_INFERENCE_MODEL,
    minimaxTimeoutMs: MINIMAX_TIMEOUT_MS,
    router: DO_ROUTER || null,
    taskModels: TASK_MODELS,
    geminiFallback: ALLOW_GEMINI_FALLBACK,
    geminiModel: GEMINI_MODEL,
    geminiGlslModel: GEMINI_GLSL_MODEL,
    aiTimeoutMs: AI_TIMEOUT_MS,
    batchSize: Number(process.env.BATCH_SIZE) || 3,
    glslConcurrency: Number(process.env.GLSL_CONCURRENCY) || 3,
    logInference: isLogInferenceEnabled(),
    inferenceLogCap: inferenceLogCap()
  };
}

function resolveModels(task, overrideModels) {
  if (overrideModels?.length) return overrideModels;
  if (DO_ROUTER) return [`router:${DO_ROUTER}`];
  return TASK_MODELS[task] || TASK_MODELS.planning;
}

function buildSystemPrompt(systemInstruction, jsonMode) {
  if (!jsonMode) return systemInstruction;
  return `${systemInstruction}\n\nRespond with valid JSON only. No markdown fences, no commentary outside the JSON.`;
}

function recordInferenceCall(entry) {
  inferenceCalls.push(entry);
  const cap = inferenceLogCap();
  if (inferenceCalls.length > cap) {
    inferenceCalls.splice(0, inferenceCalls.length - cap);
  }
  if (isLogInferenceEnabled()) {
    const usage = entry.usage || {};
    const tokenStr = usage.totalTokens != null
      ? ` tokens=${usage.totalTokens} (prompt=${usage.promptTokens ?? "?"} completion=${usage.completionTokens ?? "?"})`
      : " tokens=?";
    console.log(
      `[inference] task=${entry.task} model=${entry.model} attempt=${entry.attempt}` +
      ` latency=${entry.latencyMs ?? "?"}ms success=${entry.success}${tokenStr}` +
      `${entry.error ? ` error=${entry.error}` : ""} label=${entry.label}`
    );
  }
}

async function callDigitalOcean(systemInstruction, userPrompt, {
  model,
  maxTokens = 8000,
  jsonMode = false,
  label = "request",
  timeoutMs = AI_TIMEOUT_MS
}) {
  const client = getDoClient();
  const requestOptions = sessionAffinity
    ? { headers: { "X-Model-Affinity": sessionAffinity } }
    : undefined;

  const start = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(systemInstruction, jsonMode) },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_completion_tokens: maxTokens
      },
      { ...requestOptions, signal: AbortSignal.timeout(timeoutMs) }
    );
  } catch (err) {
    const elapsed = Date.now() - start;
    const timedOut = err.name === "AbortError" || /timed?\s*out/i.test(err.message || "");
    throw Object.assign(new Error(`[DO-router ${model}] ${label}: ${timedOut ? `timed out after ${timeoutMs}ms` : err.message}`), {
      _provider: "digitalocean-router",
      _model: model,
      _timedOut: timedOut,
      _elapsedMs: elapsed,
      _timeoutMs: timeoutMs
    });
  }
  const latencyMs = Date.now() - start;

  const routed = completion.model || model;
  lastRoutedModel = routed;
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`[DO-router ${model}] ${label}: empty response`);
  }
  const usage = completion.usage
    ? {
        promptTokens: completion.usage.prompt_tokens ?? null,
        completionTokens: completion.usage.completion_tokens ?? null,
        totalTokens: completion.usage.total_tokens ?? null
      }
    : null;
  return { text, model: routed, usage, latencyMs };
}

async function callGeminiFallback(systemInstruction, userPrompt, { jsonMode, maxTokens, label, model, timeoutMs }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini fallback unavailable: GEMINI_API_KEY not set.");
  }

  const geminiModel = model || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [{ parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: buildSystemPrompt(systemInstruction, jsonMode) }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxTokens
    }
  };

  if (jsonMode) {
    requestBody.generationConfig.responseMimeType = "application/json";
  }

  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs || GEMINI_TIMEOUT_MS)
    });
  } catch (err) {
    const timedOut = err.name === "AbortError" || /timed?\s*out/i.test(err.message || "");
    throw Object.assign(new Error(`[Gemini] ${label}: ${timedOut ? `timed out after ${timeoutMs}ms` : err.message}`), {
      _provider: "gemini",
      _model: geminiModel,
      _timedOut: timedOut,
      _elapsedMs: Date.now() - start,
      _timeoutMs: timeoutMs
    });
  }
  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini fallback failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error(`[Gemini] ${label}: empty response`);
  }

  lastRoutedModel = geminiModel;
  console.log(`[Gemini ${geminiModel}] ${label} (fallback) latency=${latencyMs}ms`);
  const meta = data.usageMetadata;
  const usage = meta
    ? {
        promptTokens: meta.promptTokenCount ?? null,
        completionTokens: meta.candidatesTokenCount ?? null,
        totalTokens: meta.totalTokenCount ?? null
      }
    : null;
  return { text, model: geminiModel, usage, latencyMs };
}

async function callMinimax(systemInstruction, userPrompt, {
  model,
  maxTokens = 8000,
  jsonMode = false,
  label = "request",
  timeoutMs = MINIMAX_TIMEOUT_MS
}) {
  const client = getMinimaxClient();
  const start = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(systemInstruction, jsonMode) },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_completion_tokens: maxTokens
      },
      { signal: AbortSignal.timeout(timeoutMs) }
    );
  } catch (err) {
    const elapsed = Date.now() - start;
    const timedOut = err.name === "AbortError" || /timed?\s*out/i.test(err.message || "");
    throw Object.assign(new Error(`[MiniMax ${model}] ${label}: ${timedOut ? `timed out after ${timeoutMs}ms` : err.message}`), {
      _provider: "minimax",
      _model: model,
      _timedOut: timedOut,
      _elapsedMs: elapsed,
      _timeoutMs: timeoutMs
    });
  }
  const latencyMs = Date.now() - start;

  const routed = completion.model || model;
  lastRoutedModel = routed;
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`[MiniMax ${model}] ${label}: empty response`);
  }
  const usage = completion.usage
    ? {
        promptTokens: completion.usage.prompt_tokens ?? null,
        completionTokens: completion.usage.completion_tokens ?? null,
        totalTokens: completion.usage.total_tokens ?? null
      }
    : null;
  return { text, model: routed, usage, latencyMs };
}

function isRouterModel(model) {
  return typeof model === "string" && model.startsWith("router:");
}

function isMinimaxModel(model) {
  return typeof model === "string" && model.startsWith("minimax-");
}

function providerForModel(model) {
  if (isRouterModel(model)) return "digitalocean-router";
  if (isMinimaxModel(model)) return "minimax";
  return "digitalocean";
}

function timeoutForModel(model) {
  if (isMinimaxModel(model)) return MINIMAX_TIMEOUT_MS;
  return AI_TIMEOUT_MS;
}

async function dispatchCall(systemInstruction, userPrompt, opts) {
  const { model } = opts;
  if (isMinimaxModel(model)) {
    return { provider: "minimax", result: await callMinimax(systemInstruction, userPrompt, opts) };
  }
  return { provider: "digitalocean", result: await callDigitalOcean(systemInstruction, userPrompt, opts) };
}

export async function runInference(systemInstruction, userPrompt, {
  task = "planning",
  jsonMode = false,
  models,
  retriesPerModel = 2,
  label = "request",
  maxTokens = 8000
} = {}) {
  const modelList = resolveModels(task, models);
  let lastError = null;

  for (const model of modelList) {
    const timeoutMs = timeoutForModel(model);
    for (let attempt = 0; attempt <= retriesPerModel; attempt++) {
      try {
        const { provider, result } = await dispatchCall(systemInstruction, userPrompt, {
          model, maxTokens, jsonMode, label, timeoutMs
        });
        if (result.model !== model) {
          console.log(`[${provider}] ${label} routed to ${result.model}`);
        }
        recordInferenceCall({
          task,
          provider,
          model: result.model,
          label,
          attempt,
          latencyMs: result.latencyMs,
          usage: result.usage,
          success: true,
          error: null,
          timedOut: false,
          timestamp: new Date().toISOString()
        });
        lastInferenceMetadata = {
          provider,
          model: result.model,
          latencyMs: result.latencyMs,
          usage: result.usage,
          timedOut: false,
          timestamp: new Date().toISOString()
        };
        return result.text;
      } catch (err) {
        lastError = err;
        console.warn(`[${isRouterModel(model) ? "DO-router" : "MiniMax"} ${model}] ${label} failed: ${err.message}`);
        recordInferenceCall({
          task,
          provider: providerForModel(model),
          model,
          label,
          attempt,
          latencyMs: err._elapsedMs ?? null,
          usage: null,
          success: false,
          error: err.message,
          timedOut: Boolean(err._timedOut),
          timestamp: new Date().toISOString()
        });
        if (attempt < retriesPerModel && !err._timedOut) {
          await sleep(1200 * (attempt + 1));
        } else if (err._timedOut) {
          break;
        }
      }
    }
  }

  if (ALLOW_GEMINI_FALLBACK && process.env.GEMINI_API_KEY) {
    try {
      const result = await callGeminiFallback(systemInstruction, userPrompt, {
        jsonMode,
        maxTokens,
        model: resolveGeminiModel(task),
        label: `${label} (gemini fallback)`,
        timeoutMs: timeoutForModel(modelList[0]) || GEMINI_TIMEOUT_MS
      });
      recordInferenceCall({
        task,
        provider: "gemini",
        model: result.model,
        label: `${label} (gemini fallback)`,
        attempt: 0,
        latencyMs: result.latencyMs,
        usage: result.usage,
        success: true,
        error: null,
        timedOut: false,
        timestamp: new Date().toISOString()
      });
      return result.text;
    } catch (err) {
      lastError = err;
      recordInferenceCall({
        task,
        provider: "gemini",
        model: resolveGeminiModel(task),
        label: `${label} (gemini fallback)`,
        attempt: 0,
        latencyMs: err._elapsedMs ?? null,
        usage: null,
        success: false,
        error: err.message,
        timedOut: Boolean(err._timedOut),
        timestamp: new Date().toISOString()
      });
    }
  }

  throw lastError || new Error(`DigitalOcean inference failed for ${label}.`);
}

export function getTaskModels(task) {
  return [...(TASK_MODELS[task] || TASK_MODELS.planning)];
}

export function getInferenceCalls() {
  return [...inferenceCalls];
}

export function clearInferenceCalls() {
  const dropped = inferenceCalls.length;
  inferenceCalls.length = 0;
  return dropped;
}

export function _recordInferenceCall(entry) {
  recordInferenceCall(entry);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function getInferenceMetrics({ task = null, since = null } = {}) {
  const filtered = inferenceCalls.filter((c) => {
    if (task && c.task !== task) return false;
    if (since && c.timestamp < since) return false;
    return true;
  });

  const totals = {
    calls: filtered.length,
    successes: filtered.filter((c) => c.success).length,
    errors: filtered.filter((c) => !c.success).length,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    latencySamples: 0,
    avgLatencyMs: 0,
    p50LatencyMs: percentile(filtered.filter((c) => c.latencyMs != null).map((c) => c.latencyMs), 50),
    p95LatencyMs: percentile(filtered.filter((c) => c.latencyMs != null).map((c) => c.latencyMs), 95)
  };

  for (const c of filtered) {
    if (c.usage) {
      totals.totalTokens += c.usage.totalTokens || 0;
      totals.promptTokens += c.usage.promptTokens || 0;
      totals.completionTokens += c.usage.completionTokens || 0;
    }
    if (c.latencyMs != null) {
      totals.latencyMs += c.latencyMs;
      totals.latencySamples += 1;
    }
  }
  if (totals.latencySamples > 0) {
    totals.avgLatencyMs = Math.round(totals.latencyMs / totals.latencySamples);
  }

  const byTask = {};
  const byModel = {};
  for (const c of filtered) {
    if (c.task) {
      byTask[c.task] = byTask[c.task] || { calls: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0, latencySamples: 0 };
      const t = byTask[c.task];
      t.calls += 1;
      if (c.success) t.successes += 1; else t.errors += 1;
      if (c.usage) {
        t.totalTokens += c.usage.totalTokens || 0;
        t.promptTokens += c.usage.promptTokens || 0;
        t.completionTokens += c.usage.completionTokens || 0;
      }
      if (c.latencyMs != null) {
        t.latencyMs += c.latencyMs;
        t.latencySamples += 1;
      }
    }
    if (c.model) {
      byModel[c.model] = byModel[c.model] || { calls: 0, successes: 0, errors: 0, totalTokens: 0, latencyMs: 0, latencySamples: 0 };
      const m = byModel[c.model];
      m.calls += 1;
      if (c.success) m.successes += 1; else m.errors += 1;
      if (c.usage) m.totalTokens += c.usage.totalTokens || 0;
      if (c.latencyMs != null) {
        m.latencyMs += c.latencyMs;
        m.latencySamples += 1;
      }
    }
  }

  for (const t of Object.values(byTask)) {
    t.avgLatencyMs = t.latencySamples > 0 ? Math.round(t.latencyMs / t.latencySamples) : 0;
  }
  for (const m of Object.values(byModel)) {
    m.avgLatencyMs = m.latencySamples > 0 ? Math.round(m.latencyMs / m.latencySamples) : 0;
  }

  return {
    cap: inferenceLogCap(),
    bufferSize: inferenceCalls.length,
    filter: { task: task || null, since: since || null },
    totals,
    byTask,
    byModel,
    recent: filtered.slice(-20).reverse()
  };
}

export async function runInferenceBatch(systemInstruction, userPrompt, jsonMode = false, label = "batch step", {
  retriesPerModel = Number(process.env.PLANNING_RETRIES) || 1,
  maxTokens = Number(process.env.PLANNING_MAX_TOKENS) || 4000
} = {}) {
  return runInference(systemInstruction, userPrompt, {
    task: "planning",
    jsonMode,
    retriesPerModel,
    label,
    maxTokens
  });
}