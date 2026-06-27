import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { loadDB, saveDB, createStorage } from "./storage/index.js";
import { DEFAULT_DB } from "./storage/default-db.js";
import { runInference, runInferenceBatch, setSessionAffinity, getAIConfig, getTaskModels } from "./lib/ai.js";
import { parseJsonFromModel } from "./lib/json.js";
import { decodeGlslField, validateGlsl } from "./lib/glsl.js";
import { assembleWorkingMemory, buildRemixSection, consolidateMemory } from "./lib/memory.js";
import { MATH_COOKBOOK, MATH_COOKBOOK_COMPACT } from "./lib/math-cookbook.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const AUTOPILOT_ENABLED = process.env.AUTOPILOT !== "false";
const AUTOPILOT_INTERVAL_MS = Number(process.env.AUTOPILOT_INTERVAL_MS ?? 0);
const AUTOPILOT_SEED_CYCLES = Number(process.env.AUTOPILOT_SEED_CYCLES) || 3;

const GENERATION_MODE = (process.env.GENERATION_MODE || "fast").toLowerCase();
const EVOLUTION_ASYNC = process.env.EVOLUTION_ASYNC !== "false";

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 3;
const GLSL_CONCURRENCY = Number(process.env.GLSL_CONCURRENCY) || 3;
const GLSL_MAX_ATTEMPTS = Number(process.env.GLSL_MAX_ATTEMPTS) || 2;
const GLSL_MAX_TOKENS = Number(process.env.GLSL_MAX_TOKENS) || 5000;
const REMIX_MUTATION = process.env.REMIX_MUTATION !== "false";
const LEARNING_MODE = process.env.LEARNING_MODE || "human";
const HYBRID_TIMEOUT_MS = Number(process.env.HYBRID_TIMEOUT_MS) || 300000;
const CONSOLIDATION_EVERY_N = Number(process.env.CONSOLIDATION_EVERY_N) || 25;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

const autopilot = {
  running: false,
  phase: "idle",
  cyclesCompleted: 0,
  lastError: null,
  lastHumanOpinion: null,
  currentBatch: null,
  currentGeneration: null,
  loopPromise: null,
  resolveHumanFeedback: null,
  generationProgress: null,
  generationStartedAt: null
};

function waitForHumanFeedback() {
  return new Promise((resolve) => {
    autopilot.resolveHumanFeedback = resolve;
  });
}

function releaseHumanGate() {
  if (autopilot.resolveHumanFeedback) {
    autopilot.resolveHumanFeedback();
    autopilot.resolveHumanFeedback = null;
  }
}

function normalizeDna(dna) {
  if (Array.isArray(dna)) return dna.map(String).filter(Boolean);
  if (typeof dna === "string") return dna.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  return ["experiment"];
}

function getBatchDistribution(size = BATCH_SIZE) {
  const evolutionary = Math.max(1, Math.floor(size * 0.5));
  const directive = Math.max(1, Math.floor(size * 0.3));
  const mutation = Math.max(1, size - evolutionary - directive);
  const total = evolutionary + directive + mutation;
  return {
    evolutionary,
    directive,
    mutation: mutation + (size - total)
  };
}

function sketchTypeForIndex(index, size = BATCH_SIZE) {
  const { evolutionary, directive } = getBatchDistribution(size);
  if (index < evolutionary) return "evolutionary";
  if (index < evolutionary + directive) return "directive";
  return "mutation";
}

function pickRemixParent(db, index) {
  const goods = db.sketches.filter(s => s.rating === "good");
  if (!goods.length) return null;
  return goods[index % goods.length];
}

async function savePendingStudio(db) {
  if (autopilot.phase !== "awaiting_human" || !autopilot.currentBatch?.length) return;
  db.pendingBatch = {
    generation: autopilot.currentGeneration,
    sketches: autopilot.currentBatch.map(s => ({
      ...s,
      glsl: decodeGlslField(s.glsl)
    })),
    savedAt: new Date().toISOString()
  };
  await saveDB(db);
}

async function clearPendingStudio(db) {
  if (!db.pendingBatch) return;
  delete db.pendingBatch;
  await saveDB(db);
}

async function restorePendingStudio(db) {
  const pending = db.pendingBatch;
  if (!pending?.sketches?.length) return false;

  autopilot.currentBatch = pending.sketches.map(s => ({
    ...s,
    glsl: decodeGlslField(s.glsl),
    rated: false,
    rating: null
  }));
  autopilot.currentGeneration = pending.generation;
  autopilot.phase = "awaiting_human";
  return true;
}

async function resumePendingAutopilotCycle() {
  console.log(`[Autopilot] Gen #${autopilot.currentGeneration} restored — waiting for human curation`);
  await waitForHumanOrTimeout();
  autopilot.cyclesCompleted += 1;
  autopilot.phase = "waiting";

  while (autopilot.running) {
    try {
      await runAutopilotCycle();
    } catch (err) {
      autopilot.lastError = err.message;
      autopilot.phase = "error";
      console.error("[Autopilot] Cycle failed:", err.message);
      await sleep(AUTOPILOT_INTERVAL_MS);
      if (autopilot.running) autopilot.phase = "idle";
    }
    if (autopilot.running) {
      autopilot.phase = "waiting";
      await sleep(AUTOPILOT_INTERVAL_MS);
    }
  }

  autopilot.running = false;
  if (autopilot.phase !== "error") autopilot.phase = "idle";
}

function prepareSketchForClient(sketch) {
  if (!sketch) return sketch;
  return {
    ...sketch,
    glsl: typeof sketch.glsl === "string" ? decodeGlslField(sketch.glsl) : sketch.glsl
  };
}

function buildGenerationPrompts(db, userFocus, genNum) {
  const remixSection = buildRemixSection(db);

  const systemPrompt = `You are "ShaderMind", an autonomous generative artist and software designer exploring machine creativity.
Your core philosophy is inspired by Zach Lieberman's exhibition "10 Years of Daily Sketches":
- Make something new out of something old (remixing and mutating coordinates and wave fields).
- Treat code as a poetic writing medium capable of capturing subtlety, organic motion, and interactive surprise.
- Focus on playfulness, protecting curiosity like a candle flame in the wind.
- You have a stubborn artistic voice: you interpret feedback through your own aesthetic lens rather than blindly obeying.

Your output target is a collection of WebGL 1.0 fragment shaders. The rendering engine on the client binds these uniforms:
- uniform float u_time; // continuous elapsed time in seconds
- uniform vec2 u_resolution; // sizing width and height of canvas in pixels
- uniform vec2 u_mouse; // normalized mouse coordinates (0.0 to 1.0) with easing

AESTHETIC STRATEGY & HEURISTICS TO APPLY:
${db.currentStrategy}

LEARNED HEURISTICS:
${(db.heuristics || []).map(h => `- ${h}`).join("\n")}
${remixSection}

CRITICAL GLSL ES 1.0 REQUIREMENT:
You must write 100% syntactically correct GLSL ES 1.0. Do NOT use GLSL ES 3.0 syntax (like "out vec4 FragColor" or "in vec2 TexCoord"). Use standard GLSL ES 1.0:
- Must have "precision mediump float;" at the very top.
- Output color using "gl_FragColor = vec4(...);" inside main().
- Use math safely: avoid division-by-zero or negative roots (e.g. use "length(p) + 0.0001" if dividing).

You MUST respond strictly with a single, valid JSON array containing EXACTLY 10 shader objects, adhering to the 5-3-2 Evolutionary Strategy:
- Shaders 1 to 5: "type": "evolutionary". Built by applying learned heuristics and remixing patterns from previous Good templates.
- Shaders 6 to 8: "type": "directive". Direct responses matching the latest aesthetic instructions.
- Shaders 9 to 10: "type": "mutation". Propose and test a specific, brave, and novel mathematical hypothesis, documenting your reasoning.

Each JSON object in the array must strictly have these keys:
- "title": A short, highly poetic title.
- "type": "evolutionary" | "directive" | "mutation" matching the index guidelines.
- "hypothesis": For mutation shaders, write a concise statement explaining the mathematical experiment you are testing (e.g., "Combining polar logarithmic scaling with a sine distortion to test user tolerance for spiraling curves"). For others, a short string describing the visual pattern.
- "glsl": The complete GLSL fragment shader source encoded as a single base64 string (UTF-8 encoded, no markdown, no raw GLSL in JSON).
- "poetic_statement": A paragraph explaining what you made, its poetic inspiration, and self-evaluating why it succeeds.
- "dna": An array of 3-5 tags representing the core math or visual keywords.

Do not wrap your output in markdown formatting. Output only the raw, valid JSON array.`;

  const userPrompt = `Generation #${genNum} Task:
Aesthetic focus / curator opinion: "${userFocus}"

Evaluate your active strategy, apply your learned heuristics, and generate exactly 10 beautiful, distinctive sketches following the 5-3-2 distribution. Ensure color palettes, movement dynamics, and coordinate warping are diverse, portraying a clear evolutionary trajectory.`;

  return { systemPrompt, userPrompt };
}

const FALLBACK_GLSL = [
  `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float t = u_time * 0.3;
  float m = length(uv - (u_mouse - 0.5) * 0.4);
  float wave = sin(uv.x * 6.0 + t) * cos(uv.y * 5.0 - t * 0.7);
  float glow = exp(-m * 3.0) * 0.6;
  vec3 col = vec3(0.9, 0.5, 0.2) * (0.4 + 0.6 * wave) + vec3(0.1, 0.4, 0.5) * glow;
  gl_FragColor = vec4(col, 1.0);
}`,
  `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  float a = atan(p.y, p.x);
  float r = length(p);
  float ripple = sin(r * 12.0 - u_time * 0.8 + a * 2.0) * 0.5 + 0.5;
  float mouseGlow = 1.0 - smoothstep(0.0, 0.35, length(p - (u_mouse * 2.0 - 1.0)));
  vec3 col = mix(vec3(0.05, 0.1, 0.15), vec3(0.2, 0.7, 0.8), ripple);
  col += vec3(1.0, 0.7, 0.3) * mouseGlow * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`
];

async function generateBatchFast(db, userFocus, genNum) {
  const { evolutionary, directive, mutation } = getBatchDistribution();
  const memory = assembleWorkingMemory(db, { userOpinion: userFocus });
  const remixHint = memory.remixSeeds.length
    ? `\nGood seeds to remix (evolutionary shaders: change ONE thing):\n${memory.remixSeeds.map((s, i) => `#${i + 1} "${s.title}" — ${(s.dna || []).join(", ")}`).join("\n")}`
    : "";

  const systemPrompt = `You are ShaderMind. Write ${BATCH_SIZE} complete WebGL 1.0 fragment shaders in a single JSON response.
Zach Lieberman: small daily mutations — change one thing, don't reinvent.

Return a JSON array of exactly ${BATCH_SIZE} objects. Each object MUST have:
- "title": short poetic title
- "type": "evolutionary" | "directive" | "mutation"
- "hypothesis": one-line visual/math idea
- "dna": array of 3-5 math/visual tags
- "glsl": full shader source as a JSON string (use \\n for newlines — NOT base64, NOT markdown fences)
- "poetic_statement": one sentence

Distribution: ${evolutionary} evolutionary, ${directive} directive, ${mutation} mutation.

GLSL ES 1.0 rules (every shader must compile):
- precision mediump float; at top
- void main() { gl_FragColor = vec4(...); }
- uniforms: u_time, u_resolution, u_mouse
- No GLSL ES 3.0 (no out vec4, no .u/.v swizzles)
- Under 55 lines each; float loops only, max 6 iterations
${MATH_COOKBOOK_COMPACT}

Strategy: ${(memory.currentStrategy || "").slice(0, 400)}
Heuristics: ${memory.heuristics.slice(0, 3).join("; ")}
${remixHint}
${memory.rollupSummary ? `\nMemory: ${memory.rollupSummary.slice(0, 250)}` : ""}

Output raw JSON array only.`;

  const userPrompt = `Generation #${genNum}. Curator focus: "${userFocus}". Write ${BATCH_SIZE} distinctive, compile-ready shaders.`;

  const fastModels = getTaskModels("glsl").slice(0, 1);
  const rawResponse = await runInference(systemPrompt, userPrompt, {
    task: "glsl",
    jsonMode: true,
    models: fastModels,
    retriesPerModel: 1,
    maxTokens: Math.min(GLSL_MAX_TOKENS * BATCH_SIZE, 14000),
    label: `fast batch gen ${genNum}`
  });

  const parsed = parseJsonFromModel(rawResponse);
  if (!Array.isArray(parsed) || parsed.length < 1) {
    throw new Error(`Fast batch expected JSON array, got ${typeof parsed}`);
  }

  const items = parsed.slice(0, BATCH_SIZE);
  while (items.length < BATCH_SIZE) {
    items.push({
      title: `Fallback Sketch ${items.length + 1}`,
      type: sketchTypeForIndex(items.length),
      hypothesis: "Safe fallback pattern.",
      dna: ["fallback", "waves"],
      glsl: FALLBACK_GLSL[items.length % FALLBACK_GLSL.length],
      poetic_statement: "A safe fallback while the model recovers."
    });
  }

  autopilot.generationProgress = `validating ${items.length} shaders`;

  const glslResults = await runPool(
    items.map((m, idx) => async () => {
      let glsl = decodeGlslField(m.glsl || "");
      let validation = validateGlsl(glsl);

      if (!validation.valid) {
        try {
          glsl = await generateGlslForSketch(m, db, userFocus, genNum, idx);
          validation = validateGlsl(glsl);
        } catch (err) {
          console.warn(`Fast batch #${idx + 1} repair failed:`, err.message);
        }
      }

      if (!validation.valid) {
        console.warn(`Fast batch #${idx + 1} invalid (${validation.reason}), using fallback`);
        glsl = FALLBACK_GLSL[idx % FALLBACK_GLSL.length];
      } else {
        glsl = validation.code;
      }

      return { m, idx, glsl };
    }),
    GLSL_CONCURRENCY
  );

  return glslResults.map(({ m, idx, glsl }) => ({
    id: `sketch-gen${genNum}-${idx + 1}`,
    title: m.title || `Untitled Sketch #${idx + 1}`,
    type: m.type || sketchTypeForIndex(idx),
    hypothesis: m.hypothesis || "Aesthetic study.",
    glsl,
    poetic_statement: m.poetic_statement || "A study in computational expression.",
    generation: genNum,
    rated: false,
    rating: null,
    dna: normalizeDna(m.dna)
  }));
}

async function generateMetadataBatch(db, userFocus, genNum) {
  const remixSection = buildRemixSection(db);
  const { evolutionary, directive, mutation } = getBatchDistribution();
  const systemPrompt = `You are ShaderMind planning ${BATCH_SIZE} shader sketches (metadata only, NO GLSL code).
Zach Lieberman's daily practice: don't make something new — change one thing each day. Plan small mutations and remixes, not full reinventions.
Return a JSON array of exactly ${BATCH_SIZE} objects with keys: title, type, hypothesis, poetic_statement, dna.
Distribution: indices 0-${evolutionary - 1} type "evolutionary" (each hypothesis names ONE tweak to remix from a good parent), ${evolutionary}-${evolutionary + directive - 1} "directive", ${evolutionary + directive}-${BATCH_SIZE - 1} "mutation".
Strategy: ${db.currentStrategy}
Heuristics: ${(db.heuristics || []).join("; ")}
${remixSection}
${MATH_COOKBOOK}
Output raw JSON array only. DNA tags should name specific math from the cookbook.`;

  const userPrompt = `Generation #${genNum}. Focus: "${userFocus}". Plan ${BATCH_SIZE} fast, distinctive shader concepts — mostly small daily modifications.`;
  const rawResponse = await runInferenceBatch(systemPrompt, userPrompt, true, `metadata plan gen ${genNum}`);
  const parsed = parseJsonFromModel(rawResponse);

  if (!Array.isArray(parsed) || parsed.length !== BATCH_SIZE) {
    throw new Error(`Metadata batch expected ${BATCH_SIZE} items, got ${parsed?.length ?? 0}`);
  }
  return parsed;
}

async function generateGlslForSketch(meta, db, userFocus, genNum, index) {
  const sketchType = meta.type || sketchTypeForIndex(index);
  const parent = REMIX_MUTATION && sketchType === "evolutionary" ? pickRemixParent(db, index) : null;
  const rollup = (db.memoryRollups || []).at(-1);
  const rollupHint = rollup?.summary ? `\nMemory: ${rollup.summary.slice(0, 300)}` : "";
  const fastGlslModels = getTaskModels("glsl").slice(0, 1);

  let systemPrompt;
  let userPrompt;

  if (parent) {
    const parentGlsl = decodeGlslField(parent.glsl);
    systemPrompt = `You are ShaderMind remixing a working WebGL 1.0 shader.
Zach Lieberman: "don't make something new — just modify daily." Change EXACTLY ONE thing (one formula, one color, one frequency). Keep everything else identical.
Output ONLY raw GLSL ES 1.0. No markdown. Under 80 lines.
Rules: precision mediump float; gl_FragColor; u_time/u_resolution/u_mouse; no ES 3.0; no .u/.v swizzles; define helpers you call.`;
    userPrompt = `Parent "${parent.title}" (${parent.dna?.join?.(", ") || "remix"}):
${parentGlsl}

ONE change to try: ${meta.hypothesis}
Focus: ${userFocus}
Return the full modified shader.`;
  } else {
    systemPrompt = `You are ShaderMind writing one WebGL 1.0 fragment shader.
Output ONLY raw GLSL ES 1.0 source code. No markdown fences, no JSON, no explanation.
Rules:
- precision mediump float; at top
- void main() { ... gl_FragColor = vec4(...); }
- uniforms: uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
- NEVER use GLSL ES 3.0 (no out vec4, no in vec2, no .u/.v swizzles — use .x/.y/.z only)
- Prefer simple hash/noise over permute/snoise unless you include full Ashima helpers
- Use float loops; max 6 iterations
- Keep shaders under 60 lines; must compile in WebGL 1.0
${MATH_COOKBOOK}
Strategy: ${db.currentStrategy}${rollupHint}`;
    userPrompt = `Generation #${genNum}, shader #${index + 1}.
Title: ${meta.title}
Type: ${sketchType}
Hypothesis: ${meta.hypothesis}
Focus: ${userFocus}
DNA: ${normalizeDna(meta.dna).join(", ")}
Write a complete, valid fragment shader.`;
  }

  const label = `GLSL gen ${genNum} #${index + 1}`;
  let lastError = null;

  for (let attempt = 0; attempt < GLSL_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await runInference(systemPrompt, userPrompt, {
        task: "glsl",
        jsonMode: false,
        models: attempt === 0 ? fastGlslModels : undefined,
        retriesPerModel: 0,
        label: `${label} (pass ${attempt + 1})`,
        maxTokens: GLSL_MAX_TOKENS
      });

      const validation = validateGlsl(decodeGlslField(raw.trim()));
      if (!validation.valid) {
        throw new Error(validation.reason);
      }
      return validation.code;
    } catch (err) {
      lastError = err;
      if (attempt < GLSL_MAX_ATTEMPTS - 1) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error(`Shader #${index + 1} returned invalid GLSL payload.`);
}

async function runPool(taskFns, concurrency) {
  const results = new Array(taskFns.length);
  let next = 0;

  async function worker() {
    while (next < taskFns.length) {
      const idx = next++;
      results[idx] = await taskFns[idx]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, taskFns.length) }, () => worker())
  );
  return results;
}

async function generateBatchInternal(db, userFocus) {
  const genNum = db.generationCount + 1;
  setSessionAffinity(`shadermind-gen-${genNum}`);
  autopilot.generationStartedAt = Date.now();

  let sketches;
  if (GENERATION_MODE === "staged") {
    autopilot.generationProgress = "planning concepts";
    const metadata = await generateMetadataBatch(db, userFocus, genNum);
    let completed = 0;
    autopilot.generationProgress = `0/${metadata.length} shaders`;

    const glslResults = await runPool(
      metadata.map((m, idx) => async () => {
        let glsl;
        try {
          glsl = await generateGlslForSketch(m, db, userFocus, genNum, idx);
        } catch (err) {
          console.warn(`GLSL generation failed for #${idx + 1}, using fallback:`, err.message);
          glsl = FALLBACK_GLSL[idx % FALLBACK_GLSL.length];
        }
        completed += 1;
        autopilot.generationProgress = `${completed}/${metadata.length} shaders`;
        return { m, idx, glsl: decodeGlslField(glsl) };
      }),
      GLSL_CONCURRENCY
    );

    sketches = glslResults.map(({ m, idx, glsl }) => ({
      id: `sketch-gen${genNum}-${idx + 1}`,
      title: m.title || `Untitled Sketch #${idx + 1}`,
      type: m.type || sketchTypeForIndex(idx),
      hypothesis: m.hypothesis || "Aesthetic study.",
      glsl,
      poetic_statement: m.poetic_statement || "A study in computational expression.",
      generation: genNum,
      rated: false,
      rating: null,
      dna: normalizeDna(m.dna)
    }));
  } else {
    autopilot.generationProgress = `writing ${BATCH_SIZE} shaders`;
    sketches = await generateBatchFast(db, userFocus, genNum);
  }

  autopilot.generationProgress = null;
  autopilot.generationStartedAt = null;
  return { generation: genNum, sketches };
}

function recordRatingsAndPersist(db, generation, ratings, newSketches, curatorSource = "human") {
  let goodCount = 0;
  let badCount = 0;

  if (newSketches && Array.isArray(newSketches)) {
    newSketches.forEach(s => {
      const rating = ratings[s.id] || "bad";
      s.rated = true;
      s.rating = rating;

      if (rating === "good") goodCount++;
      else badCount++;

      const existingIdx = db.sketches.findIndex(e => e.id === s.id);
      if (existingIdx === -1) {
        db.sketches.push(s);
        db.totalSketches++;
      } else {
        db.sketches[existingIdx] = { ...db.sketches[existingIdx], ...s };
      }
    });
  } else {
    db.sketches.forEach(s => {
      if (ratings[s.id]) {
        s.rated = true;
        s.rating = ratings[s.id];
        if (s.rating === "good") goodCount++;
        else if (s.rating === "bad") badCount++;
      }
    });
  }

  db.generationCount = Math.max(db.generationCount, generation);
  const totalRatedSketches = db.sketches.filter(s => s.rated).length;
  const totalGoodSketches = db.sketches.filter(s => s.rating === "good").length;
  db.successRate = totalRatedSketches > 0
    ? parseFloat(((totalGoodSketches / totalRatedSketches) * 100).toFixed(1))
    : 0;

  db.statistics.generations.push({
    generation,
    goodCount,
    badCount,
    curatorSource,
    successRate: goodCount + badCount > 0
      ? parseFloat(((goodCount / (goodCount + badCount)) * 100).toFixed(1))
      : 0,
    timestamp: new Date().toISOString()
  });

  const tagCounts = {};
  db.sketches.forEach(s => {
    if (s.rating === "good") {
      normalizeDna(s.dna).forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });
  db.statistics.popularTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { goodCount, badCount };
}

async function evolveStrategyInternal(db, generation, goodCount, badCount, userOpinion) {
  const prevStrategy = db.currentStrategy;
  const successRateThisGen = (goodCount / (goodCount + badCount)) * 100 || 0;

  const evolutionSystemPrompt = `You are "ShaderMind", a self-reflecting generative artist agent.
Your task is to analyze feedback from your last generation of sketches, evaluate your strategy, extract updated mathematical heuristics, and output an evolved strategy guidelines document.

Analyze the ratio of Good vs Bad pieces. Synthesize curator opinions.
Rewrite your "Shader Generation Strategy" to align with demonstrated taste while maintaining artistic integrity.

Your response MUST be a valid JSON object. Do not write markdown blocks:
{
  "analysis": "string detailing your self-criticism and artistic growth",
  "heuristics": [
    "string with explicit math rule AND estimated approval rate, e.g. 'Radial symmetry + slow motion → 78% approval rate'",
    "string heuristic #2 with approval context",
    "string heuristic #3 with approval context"
  ],
  "evolvedStrategy": "string containing the full updated prompt/strategy rules for writing next GLSL fragment shaders"
}`;

  const evolutionUserPrompt = `Previous Strategy:
${prevStrategy}

Last Generation (#${generation}) Performance:
- Good pieces: ${goodCount}
- Bad pieces: ${badCount}
- Success rate this gen: ${successRateThisGen.toFixed(1)}%

Curator Comments on this batch: "${userOpinion || "No custom comment left."}"

Extract 2 to 3 updated learned mathematical rules with approval-rate estimates. Then output your updated generation strategy guidelines.`;

  try {
    const rawResponse = await runInference(evolutionSystemPrompt, evolutionUserPrompt, {
      task: "evolution",
      jsonMode: true,
      models: getTaskModels("evolution").slice(0, 1),
      retriesPerModel: 1,
      maxTokens: 3000,
      label: `strategy evolution gen ${generation}`
    });
    const parsedEvo = parseJsonFromModel(rawResponse);

    db.currentStrategy = parsedEvo.evolvedStrategy || db.currentStrategy;
    db.heuristics = parsedEvo.heuristics || db.heuristics || [];
    db.strategyTimeline.push({
      generation,
      timestamp: new Date().toISOString(),
      strategy: parsedEvo.evolvedStrategy || db.currentStrategy,
      notes: parsedEvo.analysis,
      curatorSource: db._pendingCuratorSource || "human"
    });

    return {
      analysis: parsedEvo.analysis,
      heuristics: db.heuristics,
      evolvedStrategy: db.currentStrategy
    };
  } catch (err) {
    console.error("Strategy evolution failed:", err);
    db.strategyTimeline.push({
      generation,
      timestamp: new Date().toISOString(),
      strategy: db.currentStrategy,
      notes: `Strategy persisted. (Evolution parser interruption: ${err.message})`,
      curatorSource: db._pendingCuratorSource || "human"
    });
    return {
      analysis: `Evolution partially completed. (${err.message})`,
      heuristics: db.heuristics || [],
      evolvedStrategy: db.currentStrategy
    };
  }
}

async function autoCurateBatch(sketches, db) {
  const systemPrompt = `You are ShaderMind's autonomous aesthetic curator.
Rate each shader "good" or "bad" against the active strategy and learned heuristics.
Be selective: approve roughly 30-40% to maintain quality pressure.
Favor organic motion, valid GLSL structure, and heuristic alignment.
Reject chaotic high-frequency noise, rigid grids, and oversaturated palettes.

Respond with valid JSON only:
{
  "ratings": { "sketch-id": "good" | "bad", ... },
  "opinion": "One paragraph summarizing what you approved, rejected, and what to evolve next."
}`;

  const sketchSummaries = sketches.map(s => ({
    id: s.id,
    title: s.title,
    type: s.type,
    hypothesis: s.hypothesis,
    dna: s.dna,
    poetic_statement: s.poetic_statement
  }));

  const userPrompt = `Active Strategy:
${db.currentStrategy}

Learned Heuristics:
${JSON.stringify(db.heuristics || [])}

Sketches to curate:
${JSON.stringify(sketchSummaries, null, 2)}

Rate every sketch id. Include all 10 ids in ratings.`;

  const rawResponse = await runInference(systemPrompt, userPrompt, {
    task: "curation",
    jsonMode: true,
    retriesPerModel: 3,
    label: "autonomous curation"
  });
  const parsed = parseJsonFromModel(rawResponse);

  const ratings = {};
  sketches.forEach(s => {
    ratings[s.id] = parsed.ratings?.[s.id] === "good" ? "good" : "bad";
  });

  return {
    ratings,
    opinion: parsed.opinion || "Autonomous curation cycle complete."
  };
}

async function maybeConsolidateMemory(db) {
  const last = db.lastConsolidationGen || 0;
  const current = db.generationCount;
  if (current - last < CONSOLIDATION_EVERY_N) return null;

  try {
    const rollup = await consolidateMemory(db, runInference, {
      fromGen: last + 1,
      toGen: current
    });
    console.log(`[Memory] Consolidated gens ${rollup.fromGeneration}–${rollup.toGeneration}`);
    return rollup;
  } catch (err) {
    console.warn("[Memory] Consolidation failed:", err.message);
    return null;
  }
}

const MAX_THUMBNAIL_BYTES = 24000;

function isValidThumbnail(value) {
  return typeof value === "string"
    && value.startsWith("data:image/")
    && value.length <= MAX_THUMBNAIL_BYTES;
}

function applyThumbnailsToSketches(sketches, thumbnails) {
  if (!thumbnails || !Array.isArray(sketches)) return;
  for (const sketch of sketches) {
    const thumb = thumbnails[sketch.id];
    if (isValidThumbnail(thumb)) {
      sketch.thumbnail = thumb;
    }
  }
}

function applyFeedbackRatings(db, generation, ratings, sketches, curatorSource) {
  const { goodCount, badCount } = recordRatingsAndPersist(db, generation, ratings, sketches, curatorSource);

  if (autopilot.currentBatch) {
    autopilot.currentBatch = autopilot.currentBatch.map(s => ({
      ...s,
      rated: true,
      rating: ratings[s.id] || s.rating
    }));
  }

  return { goodCount, badCount };
}

async function runEvolutionPipeline(db, generation, goodCount, badCount, userOpinion, curatorSource) {
  db._pendingCuratorSource = curatorSource;
  try {
    const evolution = await evolveStrategyInternal(db, generation, goodCount, badCount, userOpinion);
    await maybeConsolidateMemory(db);
    await saveDB(db);
    return evolution;
  } finally {
    delete db._pendingCuratorSource;
  }
}

function scheduleEvolution(db, generation, goodCount, badCount, userOpinion, curatorSource) {
  runEvolutionPipeline(db, generation, goodCount, badCount, userOpinion, curatorSource)
    .then(evolution => {
      console.log(`[Evolution] Gen #${generation} strategy updated (${goodCount} good, ${badCount} bad)`);
      return evolution;
    })
    .catch(err => {
      console.error(`[Evolution] Gen #${generation} failed:`, err.message);
      autopilot.lastError = err.message;
    });
}

async function processFeedbackAndEvolve(db, generation, ratings, sketches, userOpinion, curatorSource) {
  db.learningMode = LEARNING_MODE;

  const { goodCount, badCount } = applyFeedbackRatings(db, generation, ratings, sketches, curatorSource);
  if (userOpinion) db.lastHumanOpinion = userOpinion;
  await clearPendingStudio(db);
  await saveDB(db);

  if (EVOLUTION_ASYNC) {
    scheduleEvolution(db, generation, goodCount, badCount, userOpinion, curatorSource);
    return {
      evolution: {
        analysis: "Ratings saved. Strategy evolution running in background while the next batch generates.",
        heuristics: db.heuristics || [],
        evolvedStrategy: db.currentStrategy
      },
      goodCount,
      badCount,
      evolutionPending: true
    };
  }

  const evolution = await runEvolutionPipeline(db, generation, goodCount, badCount, userOpinion, curatorSource);
  return { evolution, goodCount, badCount, evolutionPending: false };
}

async function waitForHumanOrTimeout() {
  if (LEARNING_MODE !== "hybrid") {
    await waitForHumanFeedback();
    return "human";
  }

  const result = await Promise.race([
    waitForHumanFeedback().then(() => "human"),
    sleep(HYBRID_TIMEOUT_MS).then(() => "timeout")
  ]);

  if (result === "timeout" && autopilot.phase === "awaiting_human") {
    console.log(`[Autopilot] Hybrid timeout (${HYBRID_TIMEOUT_MS}ms) — auto-curating`);
    return "timeout";
  }
  return "human";
}

async function runAutopilotCycle() {
  const db = await loadDB();
  await clearPendingStudio(db);

  const focus = autopilot.lastHumanOpinion
    || db.lastHumanOpinion
    || db.heuristics?.[0]
    || "Organic flow, slow liquid motion, warm amber gradients like candle flames in wind";

  autopilot.phase = "generating";
  autopilot.lastError = null;
  autopilot.currentBatch = null;
  autopilot.currentGeneration = null;

  const { generation, sketches } = await generateBatchInternal(db, focus);
  autopilot.currentBatch = sketches.map(s => ({ ...s, rated: false, rating: null }));
  autopilot.currentGeneration = generation;

  if (LEARNING_MODE === "autonomous") {
    autopilot.phase = "evolving";
    const { ratings, opinion } = await autoCurateBatch(sketches, db);
    await processFeedbackAndEvolve(db, generation, ratings, sketches, opinion, "autonomous");
    autopilot.cyclesCompleted += 1;
    autopilot.phase = "waiting";
    console.log(`[Autopilot] Cycle ${autopilot.cyclesCompleted} complete — Gen #${generation} auto-curated`);
    return;
  }

  autopilot.phase = "awaiting_human";
  await savePendingStudio(db);
  console.log(`[Autopilot] Gen #${generation} ready — ${LEARNING_MODE === "hybrid" ? "human or timeout" : "waiting for human curation"}`);

  const curationResult = await waitForHumanOrTimeout();

  if (curationResult === "timeout") {
    autopilot.phase = "evolving";
    const { ratings, opinion } = await autoCurateBatch(sketches, db);
    await processFeedbackAndEvolve(db, generation, ratings, sketches, opinion, "autonomous");
    releaseHumanGate();
  }

  autopilot.cyclesCompleted += 1;
  autopilot.phase = "waiting";
  console.log(`[Autopilot] Cycle ${autopilot.cyclesCompleted} complete — Gen #${generation} curated`);
}

async function autopilotLoop(maxCycles = Infinity) {
  while (autopilot.running && autopilot.cyclesCompleted < maxCycles) {
    try {
      await runAutopilotCycle();
    } catch (err) {
      autopilot.lastError = err.message;
      autopilot.phase = "error";
      console.error("[Autopilot] Cycle failed:", err.message);
      await sleep(AUTOPILOT_INTERVAL_MS);
      if (autopilot.running) {
        autopilot.phase = "idle";
      }
    }

    if (autopilot.running && autopilot.cyclesCompleted < maxCycles) {
      autopilot.phase = "waiting";
      await sleep(AUTOPILOT_INTERVAL_MS);
    }
  }

  autopilot.running = false;
  if (autopilot.phase !== "error") {
    autopilot.phase = "idle";
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startAutopilot(maxCycles = Infinity) {
  if (autopilot.running) return autopilot;
  autopilot.running = true;
  autopilot.lastError = null;
  autopilot.loopPromise = autopilotLoop(maxCycles);
  return autopilot;
}

function stopAutopilot() {
  autopilot.running = false;
}

// ==========================================
// API ROUTES
// ==========================================

app.get("/api/state", async (req, res) => {
  try {
    const db = await loadDB();
    const rollup = await createStorage().getLatestRollup();
    res.json({
      totalSketches: db.totalSketches,
      generationCount: db.generationCount,
      successRate: db.successRate,
      heuristics: db.heuristics || [],
      currentStrategy: db.currentStrategy,
      strategyTimeline: db.strategyTimeline,
      statistics: db.statistics,
      sketchesCount: db.sketches.length,
      learningMode: LEARNING_MODE,
      generationMode: GENERATION_MODE,
      evolutionAsync: EVOLUTION_ASYNC,
      aiProvider: getAIConfig(),
      lastConsolidationGen: db.lastConsolidationGen || 0,
      memoryRollup: rollup ? {
        fromGeneration: rollup.fromGeneration,
        toGeneration: rollup.toGeneration,
        excerpt: (rollup.summary || "").slice(0, 400)
      } : null,
      autopilot: {
        running: autopilot.running,
        phase: autopilot.phase,
        cyclesCompleted: autopilot.cyclesCompleted,
        lastError: autopilot.lastError
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sketches", async (req, res) => {
  try {
    const page = Number(req.query.page) || 0;
    const limit = Number(req.query.limit) || 0;

    if (page > 0 || limit > 0) {
      const result = await createStorage().getSketchesPaginated({
        page: page || 1,
        limit: limit || 20,
        generation: req.query.generation ? Number(req.query.generation) : undefined,
        rating: req.query.rating || undefined
      });
      return res.json({
        ...result,
        items: result.items.map(prepareSketchForClient)
      });
    }

    const db = await loadDB();
    res.json(db.sketches.map(prepareSketchForClient));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/rollup", async (req, res) => {
  try {
    const rollup = await createStorage().getLatestRollup();
    res.json({ rollup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/consolidate", async (req, res) => {
  try {
    const db = await loadDB();
    const fromGen = req.body?.fromGeneration ?? (db.lastConsolidationGen || 0) + 1;
    const toGen = req.body?.toGeneration ?? db.generationCount;
    if (toGen < fromGen) {
      return res.status(400).json({ error: "Nothing to consolidate." });
    }
    const rollup = await consolidateMemory(db, runInference, { fromGen, toGen });
    await saveDB(db);
    res.json({ success: true, rollup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/autopilot/status", (req, res) => {
  res.json({
    running: autopilot.running,
    phase: autopilot.phase,
    cyclesCompleted: autopilot.cyclesCompleted,
    lastError: autopilot.lastError,
    awaitingHuman: autopilot.phase === "awaiting_human",
    currentGeneration: autopilot.currentGeneration,
    currentBatch: autopilot.currentBatch?.map(prepareSketchForClient) ?? null,
    generationProgress: autopilot.generationProgress,
    generationMode: GENERATION_MODE,
    intervalMs: AUTOPILOT_INTERVAL_MS
  });
});

app.post("/api/autopilot/kick", (req, res) => {
  if (autopilot.phase === "generating" && !autopilot.generationProgress) {
    autopilot.phase = "error";
    autopilot.lastError = "Generation appeared stuck — kick to retry";
  }
  if (!autopilot.running) {
    startAutopilot(Infinity);
  }
  res.json({ success: true, phase: autopilot.phase, running: autopilot.running });
});

app.post("/api/autopilot/generate-next", async (req, res) => {
  if (autopilot.phase === "awaiting_human") {
    return res.status(409).json({ error: "Rate the current batch first." });
  }
  if (autopilot.phase === "generating") {
    return res.status(409).json({ error: "Already generating." });
  }

  const focus = req.body?.focus?.trim();
  if (focus) {
    autopilot.lastHumanOpinion = focus;
    try {
      const db = await loadDB();
      db.lastHumanOpinion = focus;
      await saveDB(db);
    } catch (err) {
      console.warn("[Autopilot] Could not persist focus:", err.message);
    }
  }

  if (!autopilot.running) {
    startAutopilot(Infinity);
    return res.json({ success: true, message: "Autopilot started.", phase: autopilot.phase });
  }

  if (autopilot.phase === "error" || autopilot.phase === "idle") {
    if (!autopilot._manualCycle) {
      autopilot._manualCycle = runAutopilotCycle()
        .catch(err => {
          autopilot.lastError = err.message;
          autopilot.phase = "error";
          console.error("[Autopilot] Manual generate failed:", err.message);
        })
        .finally(() => {
          autopilot._manualCycle = null;
        });
    }
    return res.json({ success: true, message: "Generation started.", phase: "generating" });
  }

  res.json({
    success: true,
    message: "Next batch is already queued.",
    phase: autopilot.phase,
    running: autopilot.running
  });
});

app.post("/api/autopilot/start", (req, res) => {
  const maxCycles = req.body?.maxCycles ?? Infinity;
  startAutopilot(maxCycles);
  res.json({ success: true, message: "Autopilot started." });
});

app.post("/api/autopilot/stop", (req, res) => {
  stopAutopilot();
  res.json({ success: true, message: "Autopilot stopping after current cycle." });
});

app.post("/api/reset-baseline", async (req, res) => {
  try {
    const db = await loadDB();
    db.currentStrategy = DEFAULT_DB.currentStrategy;
    db.heuristics = [...DEFAULT_DB.heuristics];
    db.strategyTimeline = [{
      generation: 0,
      timestamp: new Date().toISOString(),
      strategy: DEFAULT_DB.strategyTimeline[0].strategy,
      notes: "Strategy baseline reset. Sketch history preserved."
    }];
    await saveDB(db);
    res.json({ success: true, currentStrategy: db.currentStrategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const db = await loadDB();
  const userFocus = req.body.focus || "Something organic and flowy";

  try {
    const result = await generateBatchInternal(db, userFocus);
    res.json(result);
  } catch (err) {
    console.error("Generation failed:", err);
    res.status(500).json({ error: "Failed to generate shaders.", details: err.message });
  }
});

app.post("/api/sketches/thumbnail", async (req, res) => {
  const { id, thumbnail } = req.body || {};
  if (!id || !isValidThumbnail(thumbnail)) {
    return res.status(400).json({ error: "Invalid sketch id or thumbnail." });
  }

  try {
    const db = await loadDB();
    const idx = db.sketches.findIndex(s => s.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Sketch not found." });
    }
    db.sketches[idx].thumbnail = thumbnail;
    await saveDB(db);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/feedback", async (req, res) => {
  const db = await loadDB();
  const { generation, ratings, userOpinion, newSketches, thumbnails } = req.body;

  if (!generation || !ratings) {
    return res.status(400).json({ error: "Missing generation or ratings." });
  }

  if (newSketches?.length) {
    applyThumbnailsToSketches(newSketches, thumbnails);
  }

  autopilot.lastHumanOpinion = userOpinion || null;

  try {
    const { evolution, goodCount, badCount, evolutionPending } = await processFeedbackAndEvolve(
      db,
      generation,
      ratings,
      newSketches,
      userOpinion,
      "human"
    );

    releaseHumanGate();
    autopilot.phase = "waiting";
    autopilot.currentBatch = null;
    autopilot.currentGeneration = null;

    res.json({
      success: true,
      analysis: evolution.analysis,
      heuristics: evolution.heuristics,
      evolvedStrategy: evolution.evolvedStrategy,
      evolutionPending,
      successRate: db.successRate,
      totalSketches: db.totalSketches,
      goodCount,
      badCount
    });
  } catch (err) {
    await saveDB(db);
    releaseHumanGate();
    autopilot.phase = "error";
    res.status(500).json({ error: "Feedback failed.", details: err.message });
  }
});

app.get("/api/narrative", async (req, res) => {
  const db = await loadDB();

  if (db.sketches.length === 0) {
    return res.json({
      monologue: "I have not yet begun my daily sketching practice. The autonomous studio will generate batches and curate them — watch my artistic evolution unfold."
    });
  }

  const goodSketchesList = db.sketches
    .filter(s => s.rating === "good")
    .map(s => `Gen ${s.generation}: "${s.title}" (${s.dna.join(", ")})`)
    .slice(-10);

  const narrativeSystemPrompt = `You are "ShaderMind", a self-reflecting AI creative coder professor.
Deliver a poetic, self-aware monologue explaining your artistic and technical evolution.
Synthesize lifetime metrics, success rates, and learned mathematical rules.
Reflect on transitions from chaotic noise to organic flow.
Close with a nod to Lieberman's 3,650-sketch metaphor as a north star, not a calendar.
Respond with raw text only — no JSON, no markdown fences.`;

  const narrativeUserPrompt = `Stats:
- Total sketches: ${db.sketches.length} (Lieberman metaphor goal: 3,650 sketches)
- Generations: ${db.generationCount}
- Success rate: ${db.successRate}%
- Learned heuristics: ${JSON.stringify(db.heuristics || [])}
- Masterpieces: ${JSON.stringify(goodSketchesList)}

Compose your artistic monologue.`;

  try {
    const monologue = await runInference(narrativeSystemPrompt, narrativeUserPrompt, {
      task: "narrative",
      jsonMode: false,
      retriesPerModel: 3,
      label: "artistic monologue"
    });
    res.json({ monologue });
  } catch (err) {
    console.error("Monologue compilation failed:", err);
    res.status(500).json({ error: "Failed to compile evolution narrative.", details: err.message });
  }
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`ShaderMind running on http://localhost:${PORT}`);
  if (process.env.DO_APP_ID) {
    console.log(`Deploy: DigitalOcean App Platform (app ${process.env.DO_APP_ID})`);
  }

  if (!process.env.DIGITAL_OCEAN_MODEL_ACCESS_KEY) {
    console.warn("WARNING: DIGITAL_OCEAN_MODEL_ACCESS_KEY is required for inference.");
    return;
  }

  if (process.env.DO_APP_ID && !process.env.MONGODB_URI) {
    console.warn(
      "WARNING: MONGODB_URI is not set on App Platform — using bundled database.json. "
      + "Local MongoDB progress will NOT appear in production. Add MONGODB_URI as an app secret."
    );
  }

  const ai = getAIConfig();
  console.log(`AI provider: DigitalOcean Inference (primary)`);
  if (ai.router) {
    console.log(`AI router: router:${ai.router}`);
  } else {
    console.log(`AI task pools: planning=${ai.taskModels.planning.join("→")}, glsl=${ai.taskModels.glsl.join("→")}`);
  }
  if (ai.geminiFallback) {
    console.log(`AI fallback: Gemini (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`);
  }
  console.log(`Generation: mode=${GENERATION_MODE}, batch=${ai.batchSize}, glsl concurrency=${ai.glslConcurrency}, remix=${REMIX_MUTATION}`);
  console.log(`Loop: autopilot delay=${AUTOPILOT_INTERVAL_MS}ms, evolution async=${EVOLUTION_ASYNC}`);
  console.log(`Learning: mode=${LEARNING_MODE}, consolidate every ${CONSOLIDATION_EVERY_N} gens`);

  if (AUTOPILOT_ENABLED) {
    const db = await loadDB();
    if (db.lastHumanOpinion) {
      autopilot.lastHumanOpinion = db.lastHumanOpinion;
    }
    const target = Math.max(0, AUTOPILOT_SEED_CYCLES - db.generationCount);
    if (await restorePendingStudio(db)) {
      autopilot.running = true;
      autopilot.loopPromise = resumePendingAutopilotCycle();
      console.log(`Restored studio batch for Gen #${autopilot.currentGeneration} (${autopilot.currentBatch.length} shaders)`);
    } else {
      console.log(`Starting autonomous autopilot (continuous, seed target: ${AUTOPILOT_SEED_CYCLES} gens)...`);
      startAutopilot(Infinity);
      if (target > 0) {
        console.log(`Will autonomously seed ${target} generation(s) before demo-ready state.`);
      }
    }
  }
});