import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

const AI_JS_PATH = new URL("../lib/ai.js", import.meta.url);
const ENV_EXAMPLE_PATH = new URL("../.env.example", import.meta.url);

test("lib/ai.js default model is claude-opus-4.8 for all six task pools", async () => {
  const envVars = [
    "DO_INFERENCE_MODEL",
    "DO_MODELS_PLANNING",
    "DO_MODELS_GLSL",
    "DO_MODELS_EVOLUTION",
    "DO_MODELS_CURATION",
    "DO_MODELS_NARRATIVE",
    "DO_MODELS_CONSOLIDATION"
  ];
  const saved = {};
  for (const key of envVars) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const cacheBust = `?default-check=${Date.now()}-${Math.random()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    const config = ai.getAIConfig();
    for (const task of ["planning", "glsl", "evolution", "curation", "narrative", "consolidation"]) {
      assert.deepEqual(config.taskModels[task], ["claude-opus-4.8"], `${task} should default to claude-opus-4.8, got ${JSON.stringify(config.taskModels[task])}`);
      assert.deepEqual(ai.getTaskModels(task), ["claude-opus-4.8"]);
    }
  } finally {
    for (const key of envVars) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("DO_INFERENCE_MODEL env var overrides the single global default", async () => {
  const saved = process.env.DO_INFERENCE_MODEL;
  process.env.DO_INFERENCE_MODEL = "anthropic.claude-3-5-sonnet";
  try {
    const cacheBust = `?inference-model-check=${Date.now()}-${Math.random()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    for (const task of ["planning", "glsl", "evolution", "curation", "narrative", "consolidation"]) {
      assert.deepEqual(ai.getTaskModels(task), ["anthropic.claude-3-5-sonnet"],
        `${task} should pick up DO_INFERENCE_MODEL override`);
    }
    assert.equal(ai.getAIConfig().taskModels.glsl[0], "anthropic.claude-3-5-sonnet");
  } finally {
    if (saved === undefined) delete process.env.DO_INFERENCE_MODEL;
    else process.env.DO_INFERENCE_MODEL = saved;
  }
});

test("DO_INFERENCE_MODEL works in tandem with per-task DO_MODELS_* override", async () => {
  const savedModel = process.env.DO_INFERENCE_MODEL;
  const savedGlsl = process.env.DO_MODELS_GLSL;
  process.env.DO_INFERENCE_MODEL = "global-model";
  process.env.DO_MODELS_GLSL = "glsl-override,fallback";
  try {
    const cacheBust = `?inference-model-override-${Date.now()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    assert.deepEqual(ai.getTaskModels("glsl"), ["glsl-override", "fallback"],
      "per-task override should take precedence over the global DO_INFERENCE_MODEL");
    assert.deepEqual(ai.getTaskModels("evolution"), ["global-model"],
      "tasks without per-task override should use DO_INFERENCE_MODEL");
  } finally {
    if (savedModel === undefined) delete process.env.DO_INFERENCE_MODEL;
    else process.env.DO_INFERENCE_MODEL = savedModel;
    if (savedGlsl === undefined) delete process.env.DO_MODELS_GLSL;
    else process.env.DO_MODELS_GLSL = savedGlsl;
  }
});

test("lib/ai.js source uses DEFAULT_MODEL constant for all six TASK_MODELS entries", () => {
  const src = fs.readFileSync(AI_JS_PATH, "utf8");
  const taskDefaults = src.match(/(\w+):\s*parseModelList\(process\.env\.DO_MODELS_\w+,\s*\[([^\]]+)\]\)/g) || [];
  assert.ok(taskDefaults.length === 6, `expected 6 TASK_MODELS entries, found ${taskDefaults.length}`);
  for (const entry of taskDefaults) {
    assert.ok(
      /DEFAULT_MODEL/.test(entry),
      `every default must reference DEFAULT_MODEL (the single global model), got: ${entry}`
    );
  }
});

test("lib/ai.js source no longer hardcodes legacy non-Opus models as defaults", () => {
  const src = fs.readFileSync(AI_JS_PATH, "utf8");
  const taskDefaults = src.match(/\b\w+:\s*parseModelList\(process\.env\.DO_MODELS_\w+,\s*\[([^\]]+)\]\)/g) || [];
  for (const entry of taskDefaults) {
    assert.ok(!/qwen3-coder-flash/.test(entry), `qwen3-coder-flash should not be a default, got: ${entry}`);
    assert.ok(!/glm-5\.2/.test(entry), `glm-5.2 should not be a default, got: ${entry}`);
    assert.ok(!/llama3\.3-70b-instruct/.test(entry), `llama3.3-70b-instruct should not be a default, got: ${entry}`);
    assert.ok(!/deepseek-4-flash/.test(entry), `deepseek-4-flash should not be a default, got: ${entry}`);
    assert.ok(!/llama-4-maverick/.test(entry), `llama-4-maverick should not be a default, got: ${entry}`);
    assert.ok(!/mistral-3-14B/.test(entry), `mistral-3.14B should not be a default, got: ${entry}`);
    assert.ok(!/minimax-m3/.test(entry), `minimax-m3 should not be a default, got: ${entry}`);
    assert.ok(!/"claude-opus-4\.8"/.test(entry), `default pool should not inline "claude-opus-4.8" — it must reference DEFAULT_MODEL`);
  }
});

test("DO_MODELS_GLSL env override is honored when set (advanced escape hatch)", async () => {
  const saved = process.env.DO_MODELS_GLSL;
  process.env.DO_MODELS_GLSL = "claude-opus-4.8-fast,claude-opus-4.8";
  try {
    const cacheBust = `?override-check=${Date.now()}-${Math.random()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    const pool = ai.getTaskModels("glsl");
    assert.deepEqual(pool, ["claude-opus-4.8-fast", "claude-opus-4.8"]);
  } finally {
    if (saved === undefined) delete process.env.DO_MODELS_GLSL;
    else process.env.DO_MODELS_GLSL = saved;
  }
});

test(".env.example documents DO_INFERENCE_MODEL as the single primary knob", () => {
  const env = fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
  assert.ok(/# DO_INFERENCE_MODEL=/.test(env) || /DO_INFERENCE_MODEL=/.test(env),
    ".env.example should reference DO_INFERENCE_MODEL");
  assert.ok(/^#\s*DO_MODELS_PLANNING=/m.test(env) || /^#\s*DO_MODELS_GLSL=/m.test(env) || /^DO_MODELS_PLANNING=/m.test(env),
    ".env.example should keep per-task DO_MODELS_* entries (commented or uncommented)");
  for (const legacy of ["qwen3-coder-flash", "glm-5.2", "llama3.3-70b-instruct", "deepseek-4-flash", "llama-4-maverick", "mistral-3-14B"]) {
    assert.ok(!env.includes(legacy), `.env.example should not mention legacy model ${legacy}`);
  }
});

test("README.md explains single DO_INFERENCE_MODEL knob, not per-task pools", () => {
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(/DO_INFERENCE_MODEL/.test(readme), "README should reference DO_INFERENCE_MODEL");
  assert.ok(!/\|\s*Task\s*\|\s*Env override\s*\|\s*Default model pool[\s\S]*?\n\n/.test(readme),
    "README should no longer have the per-task model pool table");
  for (const legacy of ["qwen3-coder-flash", "glm-5.2", "llama3.3-70b-instruct", "deepseek-4-flash", "llama-4-maverick", "mistral-3-14B"]) {
    assert.ok(!readme.includes(legacy), `README should not mention legacy model ${legacy}`);
  }
});

test("prd.md explains single DO_INFERENCE_MODEL knob, not per-task pools", () => {
  const prd = fs.readFileSync(new URL("../project_blueprint/prd.md", import.meta.url), "utf8");
  assert.ok(/DO_INFERENCE_MODEL/.test(prd), "PRD should reference DO_INFERENCE_MODEL");
  for (const legacy of ["qwen3-coder-flash", "glm-5.2", "llama3.3-70b-instruct", "deepseek-4-flash", "llama-4-maverick", "mistral-3-14B"]) {
    assert.ok(!prd.includes(legacy), `PRD should not mention legacy model ${legacy}`);
  }
});

test("pitch.md no longer references minimax-m3 as a default and references Claude Opus 4.8", () => {
  const pitch = fs.readFileSync(new URL("../project_blueprint/pitch.md", import.meta.url), "utf8");
  for (const legacy of ["qwen3-coder-flash", "glm-5.2", "llama3.3-70b-instruct", "deepseek-4-flash", "llama-4-maverick", "mistral-3-14B"]) {
    assert.ok(!pitch.includes(legacy), `pitch.md should not mention legacy model ${legacy}`);
  }
  assert.ok(pitch.includes("claude-opus-4.8"), "pitch.md should reference Claude Opus 4.8");
});

test("getAIConfig reports digitalocean as primary provider with Opus 30s timeout", async () => {
  const envVars = [
    "DO_MODELS_PLANNING", "DO_MODELS_GLSL", "DO_MODELS_EVOLUTION",
    "DO_MODELS_CURATION", "DO_MODELS_NARRATIVE", "DO_MODELS_CONSOLIDATION"
  ];
  const saved = {};
  for (const key of envVars) saved[key] = process.env[key];
  for (const key of envVars) delete process.env[key];

  try {
    const cacheBust = `?config-check=${Date.now()}-${Math.random()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    const config = ai.getAIConfig();
    assert.equal(config.provider, "digitalocean");
    assert.equal(config.aiTimeoutMs, 30000, "default Opus timeout should be 30000ms (was 120000)");
    assert.equal(typeof config.geminiFallback, "boolean");
    assert.equal(typeof config.geminiModel, "string");
    assert.equal(typeof config.geminiGlslModel, "string");
    assert.equal(config.batchSize, 3);
    assert.equal(config.glslConcurrency, 3);
  } finally {
    for (const key of envVars) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("AI_TIMEOUT_MS env var overrides the default 30000ms Opus timeout", async () => {
  const saved = process.env.AI_TIMEOUT_MS;
  process.env.AI_TIMEOUT_MS = "15000";
  try {
    const cacheBust = `?timeout-check-${Date.now()}-${Math.random()}`;
    const ai = await import(`../lib/ai.js${cacheBust}`);
    assert.equal(ai.getAIConfig().aiTimeoutMs, 15000);
  } finally {
    if (saved === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = saved;
  }
});

test("provider routing: minimax-* goes to MiniMax, anything else goes to DigitalOcean", () => {
  const src = fs.readFileSync(AI_JS_PATH, "utf8");
  assert.ok(/function isMinimaxModel\(model\)/.test(src), "isMinimaxModel detector must exist");
  assert.ok(/function providerForModel\(model\)/.test(src), "providerForModel helper must exist");
  assert.ok(/function isRouterModel\(model\)/.test(src), "isRouterModel detector must exist");
  assert.ok(/function timeoutForModel\(model\)/.test(src), "per-model timeout helper must exist");
  assert.ok(/function isMinimaxModel\(model\)[\s\S]*return true/.test(src),
    "isMinimaxModel should return true for minimax-* prefixed models");
  assert.ok(/isMinimaxModel\(model\)\)[\s\S]*return "minimax"/.test(src),
    "dispatchCall should return provider 'minimax' for minimax-* models");
});

test("every provider call site applies AbortSignal.timeout with timeoutMs", () => {
  const src = fs.readFileSync(AI_JS_PATH, "utf8");
  assert.ok(/signal: AbortSignal\.timeout\(timeoutMs\)/.test(src),
    "AbortSignal.timeout must be applied per call");
  assert.ok(/timedOut:\s*Boolean\(err\._timedOut\)/.test(src),
    "timedOut flag must be recorded in metrics on failure");
});

test("getLastInferenceMetadata returns null before any call, populated after", async () => {
  const cacheBust = `?metadata-${Date.now()}`;
  const ai = await import(`../lib/ai.js${cacheBust}`);
  assert.equal(ai.getLastInferenceMetadata(), null);
});

test("lib/ai.js does NOT reference LiveKit env vars (auth surfaces are independent)", () => {
  const aiSrc = fs.readFileSync(AI_JS_PATH, "utf8");
  for (const envVar of ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL", "LIVEKIT_AGENT_NAME"]) {
    assert.ok(
      !aiSrc.includes(envVar),
      `lib/ai.js must not reference ${envVar} — Opus inference and LiveKit voice use different auth surfaces`
    );
  }
});

test("lib/livekit.js does NOT reference MiniMax inference env vars", () => {
  const livekitSrc = fs.readFileSync(new URL("../lib/livekit.js", import.meta.url), "utf8");
  for (const envVar of ["MINIMAX_API_BASE", "MINIMAX_INFERENCE_MODEL", "MINIMAX_TIMEOUT_MS"]) {
    assert.ok(
      !livekitSrc.includes(envVar),
      `lib/livekit.js must not reference ${envVar} — LiveKit voice and MiniMax inference are independent`
    );
  }
});

test("LiveKit token endpoint uses LiveKit helpers, never MiniMax or Opus keys", () => {
  const serverSrc = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const livekitEndpointBlock = serverSrc.match(/app\.(get|post)\("\/api\/livekit\/token"[\s\S]*?\n\}\);/);
  assert.ok(livekitEndpointBlock, "LiveKit token endpoint must exist in server.js");
  const block = livekitEndpointBlock[0];
  assert.ok(!/MINIMAX_API_KEY|MINIMAX_API_BASE|MINIMAX_INFERENCE_MODEL|MINIMAX_TIMEOUT_MS|DIGITAL_OCEAN_MODEL_ACCESS_KEY/.test(block),
    "LiveKit token endpoint must not touch any inference key");
  assert.ok(/getLiveKitConfig|createParticipantToken|studioRoomName/.test(block),
    "LiveKit token endpoint must use LiveKit helpers from lib/livekit.js");
});

test("server.js populates provenance fields on every sketch record", () => {
  const serverSrc = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  for (const field of ["provider", "model", "inferenceTimestamp", "inferenceLatencyMs"]) {
    assert.ok(serverSrc.includes(field),
      `server.js must attach ${field} to each sketch record`);
  }
  assert.ok(/sanitizeSketchTitle/.test(serverSrc),
    "server.js must sanitize sketch titles");
  assert.ok(/STRATEGY_BANNED_RE/.test(serverSrc),
    "server.js must reference the banned-jargon blocklist");
  assert.ok(/getLastInferenceMetadata/.test(serverSrc),
    "server.js must read per-call inference metadata for provenance");
});