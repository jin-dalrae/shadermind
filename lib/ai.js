import { OpenAI } from "openai";

const DO_BASE_URL = "https://inference.do-ai.run/v1";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120000;
const DO_ROUTER = process.env.DO_INFERENCE_ROUTER || "";
const ALLOW_GEMINI_FALLBACK = process.env.ALLOW_GEMINI_FALLBACK === "true";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_GLSL_MODEL = process.env.GEMINI_GLSL_MODEL || GEMINI_MODEL;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;

function resolveGeminiModel(task) {
  return task === "glsl" ? GEMINI_GLSL_MODEL : GEMINI_MODEL;
}

const TASK_MODELS = {
  planning: parseModelList(process.env.DO_MODELS_PLANNING, [
    "qwen3-coder-flash",
    "llama3.3-70b-instruct",
    "mistral-3-14B"
  ]),
  glsl: parseModelList(process.env.DO_MODELS_GLSL, [
    "qwen3-coder-flash",
    "glm-5.2",
    "llama3.3-70b-instruct"
  ]),
  evolution: parseModelList(process.env.DO_MODELS_EVOLUTION, [
    "deepseek-4-flash",
    "llama-4-maverick",
    "llama3.3-70b-instruct"
  ]),
  curation: parseModelList(process.env.DO_MODELS_CURATION, [
    "llama3.3-70b-instruct",
    "mistral-3-14B",
    "deepseek-4-flash"
  ]),
  narrative: parseModelList(process.env.DO_MODELS_NARRATIVE, [
    "llama-4-maverick",
    "deepseek-4-flash",
    "llama3.3-70b-instruct"
  ]),
  consolidation: parseModelList(process.env.DO_MODELS_CONSOLIDATION, [
    "deepseek-4-flash",
    "llama3.3-70b-instruct"
  ])
};

let doClient = null;
let sessionAffinity = null;
let lastRoutedModel = null;

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
      throw new Error("DIGITAL_OCEAN_MODEL_ACCESS_KEY is required.");
    }
    doClient = new OpenAI({ baseURL: DO_BASE_URL, apiKey });
  }
  return doClient;
}

export function setSessionAffinity(id) {
  sessionAffinity = id || null;
}

export function getLastRoutedModel() {
  return lastRoutedModel;
}

export function getAIConfig() {
  return {
    provider: "digitalocean",
    router: DO_ROUTER || null,
    taskModels: TASK_MODELS,
    geminiFallback: ALLOW_GEMINI_FALLBACK,
    geminiModel: GEMINI_MODEL,
    geminiGlslModel: GEMINI_GLSL_MODEL,
    batchSize: Number(process.env.BATCH_SIZE) || 3,
    glslConcurrency: Number(process.env.GLSL_CONCURRENCY) || 3
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

async function callDigitalOcean(systemInstruction, userPrompt, {
  model,
  maxTokens = 8000,
  jsonMode = false,
  label = "request"
}) {
  const client = getDoClient();
  const requestOptions = sessionAffinity
    ? { headers: { "X-Model-Affinity": sessionAffinity } }
    : undefined;

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(systemInstruction, jsonMode) },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_completion_tokens: maxTokens
    },
    requestOptions
  );

  const routed = completion.model || model;
  lastRoutedModel = routed;
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`[DO ${model}] ${label}: empty response`);
  }
  return { text, model: routed };
}

async function callGeminiFallback(systemInstruction, userPrompt, { jsonMode, maxTokens, label, model }) {
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

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });

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
  console.log(`[Gemini ${geminiModel}] ${label} (fallback)`);
  return { text, model: geminiModel };
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
    for (let attempt = 0; attempt <= retriesPerModel; attempt++) {
      try {
        console.log(`[DO ${model}] ${label} (attempt ${attempt + 1})`);
        const result = await callDigitalOcean(systemInstruction, userPrompt, {
          model,
          maxTokens,
          jsonMode,
          label
        });
        if (result.model !== model) {
          console.log(`[DO] ${label} routed to ${result.model}`);
        }
        return result.text;
      } catch (err) {
        lastError = err;
        console.warn(`[DO ${model}] ${label} failed: ${err.message}`);
        if (attempt < retriesPerModel) {
          await sleep(1200 * (attempt + 1));
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
        label: `${label} (gemini fallback)`
      });
      return result.text;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`DigitalOcean inference failed for ${label}.`);
}

export function getTaskModels(task) {
  return [...(TASK_MODELS[task] || TASK_MODELS.planning)];
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