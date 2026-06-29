// ShaderMind — Cloudflare Worker entry point.
// Serves the static frontend (public/) and a JSON API backed by D1.
// Generation runs as a Cloudflare Workflow (long-running, multi-step,
// each step is a single Gemini call).

import { loadDB, saveDB } from "./storage.js";
import { callGemini } from "./gemini.js";
import { GenerationWorkflow } from "./workflows/generation.js";

export { GenerationWorkflow };

const STUB_MSG = "Endpoint not implemented on free tier.";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    ...init
  });
}

function notFound() {
  return json({ error: "Not found" }, { status: 404 });
}

function stub() {
  return json({ error: STUB_MSG, generationEnabled: false }, { status: 503 });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getStorageMode(env) {
  return "d1";
}

function getRatingValue(r) {
  const n = Number(r);
  if (n >= 1 && n <= 5 && Math.floor(n) === n) return n;
  return null;
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("Request body too large");
  if (!text) return {};
  return JSON.parse(text);
}

// ─── Health ──────────────────────────────────────────────────────────────

async function handleHealth(env) {
  try {
    const db = await loadDB(env);
    return json({
      ok: true,
      app: "shadermind",
      storage: "d1",
      environment: env.ENVIRONMENT || "production",
      generationEnabled: env.GENERATION_ENABLED === "true",
      ratingScale: env.RATING_SCALE || "1-5",
      aiProvider: env.AI_PROVIDER || "gemini",
      aiModel: env.AI_MODEL || "gemini-3.5-flash",
      generationCount: db.generationCount,
      totalSketches: db.totalSketches
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, { status: 500 });
  }
}

// ─── State ───────────────────────────────────────────────────────────────

async function handleGetState(env) {
  const db = await loadDB(env);
  return json({
    storage: getStorageMode(env),
    ratingScale: env.RATING_SCALE || "1-5",
    totalSketches: db.totalSketches,
    generationCount: db.generationCount,
    successRate: db.successRate,
    heuristics: db.heuristics || [],
    preferenceMemory: db.preferenceMemory || { version: 1, prefer: [], avoid: [] },
    currentStrategy: db.currentStrategy,
    memoryRollups: db.memoryRollups || [],
    strategyTimeline: db.strategyTimeline || [],
    statistics: db.statistics || { generations: [], popularTags: [] }
  });
}

// ─── Sketches ────────────────────────────────────────────────────────────

async function handleGetSketches(request, env, url) {
  const db = await loadDB(env);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const requestedLimit = Math.max(1, Number(url.searchParams.get("limit")) || 20);
  const limit = Math.min(100, requestedLimit);
  const ratingFilter = url.searchParams.getAll("rating").map(Number).filter(n => n >= 1 && n <= 5);
  const genFilter = url.searchParams.getAll("generation").map(Number).filter(n => n > 0);
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();

  let items = (db.sketches || []).slice();
  if (ratingFilter.length) {
    items = items.filter(s => ratingFilter.includes(s.rating));
  }
  if (genFilter.length) {
    items = items.filter(s => genFilter.includes(s.generation));
  }
  if (search) {
    items = items.filter(s =>
      (s.title || "").toLowerCase().includes(search) ||
      (s.id || "").toLowerCase().includes(search)
    );
  }
  items.sort((a, b) => (b.generation || 0) - (a.generation || 0) || (b.id || "").localeCompare(a.id || ""));

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const sliced = items.slice(start, start + limit);

  return json({ items: sliced, page, pages, total, limit });
}

async function handlePatchRating(request, env, sketchId) {
  const body = await readJson(request);
  const rating = getRatingValue(body.rating);
  if (rating == null) {
    return json({ error: "Invalid rating. Must be integer 1-5." }, { status: 400 });
  }
  const db = await loadDB(env);
  const idx = (db.sketches || []).findIndex(s => s.id === sketchId);
  if (idx === -1) {
    return json({ error: "Sketch not found" }, { status: 404 });
  }
  db.sketches[idx].rating = rating;
  db.sketches[idx].rated = true;
  db.sketches[idx].ratingSource = "explicit";
  // Recompute successRate
  const rated = db.sketches.filter(s => s.rating);
  const good = rated.filter(s => s.rating >= 4).length;
  db.successRate = rated.length ? Math.round((good / rated.length) * 1000) / 10 : 0;
  await saveDB(env, db);
  return json({
    success: true,
    id: sketchId,
    rating,
    successRate: db.successRate,
    preferenceMemory: db.preferenceMemory
  });
}

async function handleCompileResult(request, env, sketchId) {
  const body = await readJson(request);
  const db = await loadDB(env);
  const idx = (db.sketches || []).findIndex(s => s.id === sketchId);
  if (idx === -1) {
    return json({ error: "Sketch not found" }, { status: 404 });
  }
  db.sketches[idx].compile = {
    success: body.success === true,
    error: body.error || null,
    reportedAt: new Date().toISOString()
  };
  await saveDB(env, db);
  return json({ success: true, id: sketchId, compile: db.sketches[idx].compile });
}

async function handleDeleteSketch(env, sketchId) {
  const db = await loadDB(env);
  const idx = (db.sketches || []).findIndex(s => s.id === sketchId);
  if (idx === -1) {
    return json({ error: "Sketch not found" }, { status: 404 });
  }
  const [removed] = db.sketches.splice(idx, 1);
  db.totalSketches = Math.max(0, (db.totalSketches || 0) - 1);
  await saveDB(env, db);
  return json({ success: true, id: removed.id, deleted: { id: removed.id, title: removed.title, generation: removed.generation } });
}

async function handleThumbnailUpload(request, env) {
  const body = await readJson(request, 300 * 1024);
  const { id, thumbnail, thumbnailVersion } = body || {};
  if (!id || typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/")) {
    return json({ error: "Invalid sketch id or thumbnail." }, { status: 400 });
  }
  if (thumbnail.length > 200000) {
    return json({ error: "Thumbnail too large (max 200KB)" }, { status: 400 });
  }
  const version = Number(thumbnailVersion) || 3;
  const db = await loadDB(env);
  const idx = (db.sketches || []).findIndex(s => s.id === id);
  if (idx === -1) {
    return json({ error: "Sketch not found" }, { status: 404 });
  }
  db.sketches[idx].thumbnail = thumbnail;
  db.sketches[idx].thumbnailVersion = version;
  await saveDB(env, db);
  return json({ success: true, id, thumbnailVersion: version });
}

// ─── Feedback (ratings batch) ────────────────────────────────────────────

async function handleFeedback(request, env) {
  const body = await readJson(request);
  const { generation, ratings, userOpinion, thumbnails } = body || {};
  if (!generation || !ratings) {
    return json({ error: "Missing generation or ratings." }, { status: 400 });
  }
  const db = await loadDB(env);
  let changed = 0;
  for (const [sketchId, rating] of Object.entries(ratings)) {
    const r = getRatingValue(rating);
    if (r == null) continue;
    const idx = (db.sketches || []).findIndex(s => s.id === sketchId);
    if (idx === -1) continue;
    db.sketches[idx].rating = r;
    db.sketches[idx].rated = true;
    db.sketches[idx].ratingSource = "explicit";
    changed++;
  }
  if (thumbnails && typeof thumbnails === "object") {
    for (const [sketchId, thumb] of Object.entries(thumbnails)) {
      if (typeof thumb !== "string" || !thumb.startsWith("data:image/")) continue;
      if (thumb.length > 200000) continue;
      const idx = db.sketches.findIndex(s => s.id === sketchId);
      if (idx === -1) continue;
      db.sketches[idx].thumbnail = thumb;
      db.sketches[idx].thumbnailVersion = 3;
    }
  }
  if (userOpinion) {
    db.lastHumanOpinion = String(userOpinion).slice(0, 2000);
  }
  // Recompute successRate
  const rated = db.sketches.filter(s => s.rating);
  const good = rated.filter(s => s.rating >= 4).length;
  db.successRate = rated.length ? Math.round((good / rated.length) * 1000) / 10 : 0;
  // Increment generation count
  db.generationCount = Math.max(db.generationCount || 0, Number(generation) || 0);

  db.activeBatch = null;
  db.autopilot = {
    ...(db.autopilot || {}),
    phase: "idle",
    currentBatch: null,
    currentGeneration: null,
    awaitingHuman: false
  };

  await saveDB(env, db);
  return json({
    success: true,
    generation: db.generationCount,
    ratingsApplied: changed,
    successRate: db.successRate,
    preferenceMemory: db.preferenceMemory
  });
}

// ─── Autopilot / Generation ────────────────────────────────────────────

async function handleAutopilotStatus(env) {
  const db = await loadDB(env);
  const ap = db.autopilot || {};
  return json({
    running: ap.phase === "generating",
    phase: ap.phase || "idle",
    cyclesCompleted: ap.cyclesCompleted || 0,
    lastError: ap.lastError || null,
    awaitingHuman: ap.phase === "awaiting_human",
    currentGeneration: ap.currentGeneration || db.generationCount || 0,
    currentBatch: ap.currentBatch || db.activeBatch || [],
    message: ap.message || null,
    generationEnabled: env.GENERATION_ENABLED === "true"
  });
}

async function handleGenerate(request, env) {
  if (env.GENERATION_ENABLED !== "true") {
    return json({ error: "Generation disabled (GENERATION_ENABLED=false)" }, { status: 503 });
  }
  if (!env.GEMINI_API_KEY) {
    return json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
  }
  let body = {};
  try { body = await readJson(request); } catch (e) { body = {}; }
  const focus = String(body.focus || "").slice(0, 2000);
  const batchSize = Math.min(10, Math.max(1, Number(body.batchSize) || Number(env.BATCH_SIZE) || 3));

  const db = await loadDB(env);
  const genNum = (db.generationCount || 0) + 1;

  let instance;
  try {
    instance = await env.GENERATION.create({
      params: { genNum, focus, batchSize }
    });
  } catch (err) {
    return json({ error: `Failed to start workflow: ${err.message}` }, { status: 500 });
  }

  db.autopilot = {
    ...(db.autopilot || {}),
    phase: "generating",
    currentGeneration: genNum,
    lastStartedAt: new Date().toISOString(),
    lastInstanceId: instance.id
  };
  db.lastHumanOpinion = focus || db.lastHumanOpinion || null;
  await saveDB(env, db);

  return json({
    started: true,
    instanceId: instance.id,
    generation: genNum,
    batchSize,
    focus
  });
}

async function handleEvolve(request, env) {
  if (env.GENERATION_ENABLED !== "true") {
    return json({ error: "Generation disabled" }, { status: 503 });
  }
  let body = {};
  try { body = await readJson(request); } catch (e) { body = {}; }
  const userOpinion = String(body.userOpinion || "").slice(0, 2000);
  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
  const lastBatch = Array.isArray(body.lastBatch) ? body.lastBatch : [];

  const db = await loadDB(env);
  const ratedSketches = (db.sketches || []).filter(s => s.rating);
  const good = ratedSketches.filter(s => s.rating >= 4);
  const bad = ratedSketches.filter(s => s.rating <= 2);

  const summary = ratedSketches.map(s =>
    `- ${s.id} (${s.rating}/5): ${(s.title || "").slice(0, 60)} — ${(s.dna || []).slice(0, 3).join(", ")}`
  ).join("\n");

  const systemPrompt = `You are ShaderMind's strategy evolution module.
Review the curator's ratings and evolve the agent's strategy for the next batch.
Output a JSON object:
{
  "currentStrategy": "new strategy text (3-6 short rules)",
  "heuristics": ["3-4 short rules with rating-outcome context"],
  "reflection": "one-line curator-facing reflection"
}`;

  const userPrompt = `Current strategy:
${db.currentStrategy || "(none)"}

Heuristics:
${(db.heuristics || []).map(h => `- ${h}`).join("\n") || "(none)"}

Curator opinion: ${userOpinion || "(none)"}

Recent rated sketches (${ratedSketches.length} total, ${good.length} good, ${bad.length} bad):
${summary.slice(0, 6000)}

Output JSON only.`;

  const result = await callGemini(env, systemPrompt + "\n\n" + userPrompt, {
    temperature: 0.7,
    maxOutputTokens: 2000,
    responseMimeType: "application/json"
  });

  let evolved;
  try {
    evolved = JSON.parse(result.text);
  } catch (e) {
    const m = result.text.match(/\{[\s\S]*\}/);
    evolved = m ? JSON.parse(m[0]) : null;
  }
  if (!evolved) {
    return json({ error: "Failed to parse evolution response", raw: result.text.slice(0, 500) }, { status: 500 });
  }

  const now = new Date().toISOString();
  if (typeof evolved.currentStrategy === "string") {
    db.currentStrategy = evolved.currentStrategy.slice(0, 2000);
  }
  if (Array.isArray(evolved.heuristics)) {
    db.heuristics = evolved.heuristics.slice(0, 8).map(h => String(h).slice(0, 300));
  }
  db.strategyTimeline = db.strategyTimeline || [];
  db.strategyTimeline.push({
    generation: db.generationCount || 0,
    timestamp: now,
    strategy: db.currentStrategy,
    notes: evolved.reflection || userOpinion || "evolved",
    usage: result.usage
  });
  db.autopilot = {
    ...(db.autopilot || {}),
    phase: "idle",
    cyclesCompleted: (db.autopilot?.cyclesCompleted || 0) + 1,
    lastCompletedAt: now
  };
  await saveDB(env, db);

  return json({
    evolved: true,
    strategy: db.currentStrategy,
    heuristics: db.heuristics,
    reflection: evolved.reflection || null,
    usage: result.usage,
    latencyMs: result.latencyMs
  });
}

async function handleInferenceMetrics(env) {
  const db = await loadDB(env);
  const calls = (db.inferenceLog || []).slice(-200);
  const totals = calls.reduce((acc, c) => {
    acc.calls++;
    if (c.success) acc.successes++; else acc.errors++;
    acc.totalTokens += c.usage?.totalTokens || 0;
    acc.promptTokens += c.usage?.promptTokens || 0;
    acc.completionTokens += c.usage?.completionTokens || 0;
    acc.latencySum += c.latencyMs || 0;
    return acc;
  }, { calls: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, latencySum: 0 });
  return json({
    cap: 200,
    bufferSize: calls.length,
    totals: {
      ...totals,
      avgLatencyMs: totals.calls ? Math.round(totals.latencySum / totals.calls) : 0
    },
    byTask: {},
    byModel: {},
    recent: calls.slice(-20)
  });
}

async function handleNarrative(env) {
  const db = await loadDB(env);
  const total = (db.sketches || []).length;
  const rated = (db.sketches || []).filter(s => s.rating).length;
  const good = (db.sketches || []).filter(s => s.rating >= 4).length;
  return json({
    text: `${total} sketches across ${db.generationCount || 0} generations. ${rated} rated (${good} at 4+). Current strategy: ${(db.currentStrategy || "").slice(0, 200)}...`,
    stats: { total, rated, good, generationCount: db.generationCount || 0 }
  });
}

// ─── Router ──────────────────────────────────────────────────────────────

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // GET routes
  if (method === "GET") {
    if (path === "/api/health") return handleHealth(env);
    if (path === "/api/state") return handleGetState(env);
    if (path === "/api/sketches") return handleGetSketches(request, env, url);
    if (path === "/api/autopilot/status") return handleAutopilotStatus(env);
    if (path === "/api/inference/metrics") return handleInferenceMetrics(env);
    if (path === "/api/narrative") return handleNarrative(env);
  }

  // PATCH /api/sketches/:id/rating
  let m = path.match(/^\/api\/sketches\/([^\/]+)\/rating$/);
  if (m && method === "PATCH") return handlePatchRating(request, env, m[1]);

  // POST /api/sketches/:id/compile-result
  m = path.match(/^\/api\/sketches\/([^\/]+)\/compile-result$/);
  if (m && method === "POST") return handleCompileResult(request, env, m[1]);

  // DELETE /api/sketches/:id
  m = path.match(/^\/api\/sketches\/([^\/]+)$/);
  if (m && method === "DELETE") return handleDeleteSketch(env, m[1]);

  // POST /api/sketches/thumbnail
  if (path === "/api/sketches/thumbnail" && method === "POST") return handleThumbnailUpload(request, env);

  // POST /api/feedback
  if (path === "/api/feedback" && method === "POST") return handleFeedback(request, env);

  if (path === "/api/generate" && method === "POST") return handleGenerate(request, env);
  if (path === "/api/evolve" && method === "POST") return handleEvolve(request, env);

  if (path === "/api/autopilot/start" && method === "POST") return handleGenerate(request, env);
  if (path === "/api/autopilot/kick" && method === "POST") return handleGenerate(request, env);
  if (path === "/api/autopilot/regenerate-batch" && method === "POST") return handleGenerate(request, env);
  if (path === "/api/autopilot/generate-next" && method === "POST") return handleGenerate(request, env);

  if (path === "/api/autopilot/stop" && method === "POST") {
    const db = await loadDB(env);
    db.autopilot = { ...(db.autopilot || {}), phase: "idle" };
    await saveDB(env, db);
    return json({ stopped: true });
  }

  if (path === "/api/reset-baseline" && method === "POST") return stub();
  if (path === "/api/inference/clear" && method === "POST") return json({ cleared: true });

  return notFound();
}

// ─── Entry point ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      // All other requests go to the static assets binding.
      return await env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, { status: 500 });
    }
  }
};
