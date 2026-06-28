import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  loadDB,
  saveDB,
  createStorage,
  getStorageMode,
  getStorageDiagnostics,
  assertStorageReady
} from "./storage/index.js";
import { DEFAULT_DB } from "./storage/default-db.js";
import { runInference, runInferenceBatch, setSessionAffinity, getAIConfig, getTaskModels } from "./lib/ai.js";
import { parseJsonFromModel } from "./lib/json.js";
import { decodeGlslField, validateGlsl } from "./lib/glsl.js";
import { assembleWorkingMemory, buildRemixSection, consolidateMemory } from "./lib/memory.js";
import { MATH_COOKBOOK, MATH_COOKBOOK_COMPACT } from "./lib/math-cookbook.js";
import {
  EMPTY_PREFERENCE_MEMORY,
  buildExampleContext,
  buildExampleDescriptions,
  buildNoveltyBrief,
  buildPreferenceMemory,
  buildPreferenceSummary,
  extractCodeFeatures,
  findMostSimilarShader,
  normalizeDna,
  ratingValue,
  selectLearningExamples
} from "./lib/learning.js";

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
const CODE_AWARE_LEARNING = process.env.CODE_AWARE_LEARNING !== "false";
const LEARNING_CONTEXT_CHARS = Number(process.env.LEARNING_CONTEXT_CHARS) || 9000;
const SHADER_SIMILARITY_THRESHOLD = Number(process.env.SHADER_SIMILARITY_THRESHOLD) || 0.82;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (/\.(html?|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
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

function buildGlslRepairHint(reason) {
  if (!reason) return "";
  if (/low-effort|circle|blob/i.test(reason)) {
    return " [REJECTED: lazy pulsing circle on black — rewrite with full-frame ripples, hash noise, FBM, polar UV, or domain warp. No smoothstep circle masks.]";
  }
  return ` [Fix: ${reason}]`;
}

function sketchTypeForIndex(index, size = BATCH_SIZE) {
  const { evolutionary, directive } = getBatchDistribution(size);
  if (index < evolutionary) return "evolutionary";
  if (index < evolutionary + directive) return "directive";
  return "mutation";
}

function pickRemixParent(db, index) {
  const goods = db.sketches.filter(s => ratingValue(s.rating) >= 4);
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
You are the drawing hand; the human curator is the artist. Learn their taste from 1–5 ratings and notes.
Philosophy (Zach Lieberman, "10 Years of Daily Sketches"):
- Everyday sketches: each batch is a small step, not a reinvention.
- Change a little from the previous high-rated work — one formula, palette, or motion.
- Drift toward what this curator loves and wanted to see; you draw, they steer.
- Treat code as a poetic medium; protect curiosity; honor their taste, don't replace it.

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
You draw; the curator rates 1–5. Learn from ratings — small changes from last high-rated work, not full reinventions.

Return a JSON array of exactly ${BATCH_SIZE} objects. Each object MUST have:
- "title": 2–4 word label (e.g. "Ripple Noise Field") — not poetic
- "type": "evolutionary" | "directive" | "mutation"
- "hypothesis": one factual line, max 15 words — what the shader computes (techniques, motion, palette). No metaphor.
- "dna": array of 3-5 math/visual tags
- "glsl": full shader source as a JSON string (use \\n for newlines — NOT base64, NOT markdown fences)
- "poetic_statement": "" (always empty — curator judges by rendering)

Distribution: ${evolutionary} evolutionary, ${directive} directive, ${mutation} mutation.

VISUAL DIVERSITY (critical — not optional):
- Each shader MUST look visually distinct from the others in the batch.
- FORBIDDEN: a lone smoothstep circle/blob on black with only a sin pulse (lazy placeholder).
- REQUIRED: fill the frame with pattern/motion — use polar UV, hash noise, FBM, ripples, domain warp, cosine palette, or mouse-reactive flow.
- evolutionary = remix ONE element from a seed; directive = curator focus; mutation = one bold new formula.

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
      poetic_statement: ""
    });
  }

  autopilot.generationProgress = `validating ${items.length} shaders`;

  const glslResults = await runPool(
    items.map((m, idx) => async () => {
      let glsl = decodeGlslField(m.glsl || "");
      let validation = validateGlsl(glsl);

      if (!validation.valid) {
        for (let repair = 0; repair < 2; repair++) {
          try {
            const repairMeta = {
              ...m,
              hypothesis: `${m.hypothesis || "Visual study."}${buildGlslRepairHint(validation.reason)}`
            };
            glsl = await generateGlslForSketch(repairMeta, db, userFocus, genNum, idx);
            validation = validateGlsl(glsl);
            if (validation.valid) break;
          } catch (err) {
            console.warn(`Fast batch #${idx + 1} repair ${repair + 1} failed:`, err.message);
          }
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
    hypothesis: m.hypothesis || "Full-frame shader pattern.",
    glsl,
    poetic_statement: "",
    generation: genNum,
    rated: false,
    rating: null,
    dna: normalizeDna(m.dna)
  }));
}

async function generateMetadataBatch(db, userFocus, genNum) {
  const remixSection = buildRemixSection(db);
  const { evolutionary, directive, mutation } = getBatchDistribution();
  const preferenceSummary = CODE_AWARE_LEARNING
    ? buildPreferenceSummary(db.preferenceMemory || EMPTY_PREFERENCE_MEMORY)
    : "";
  const examples = CODE_AWARE_LEARNING
    ? selectLearningExamples(db, userFocus, { limit: 4, currentGeneration: genNum })
    : [];
  const exampleDescriptions = buildExampleDescriptions(examples);
  const systemPrompt = `You are ShaderMind planning ${BATCH_SIZE} shader sketches (metadata only, NO GLSL code).
Change one thing from prior high-rated work when evolutionary — small steps, not reinventions.
Return a JSON array of exactly ${BATCH_SIZE} objects with keys: title, type, hypothesis, dna.
title: 2–4 word label, not poetic. hypothesis: one factual line (max 15 words) — what the code will do. No metaphor.
Distribution: indices 0-${evolutionary - 1} type "evolutionary" (each hypothesis names ONE tweak to remix from a good parent), ${evolutionary}-${evolutionary + directive - 1} "directive", ${evolutionary + directive}-${BATCH_SIZE - 1} "mutation".
Strategy: ${db.currentStrategy}
Heuristics: ${(db.heuristics || []).join("; ")}
${remixSection}
${preferenceSummary ? `Evidence-backed preference memory:\n${preferenceSummary}\n` : ""}${exampleDescriptions ? `Relevant past work (descriptions only, never copy titles or concepts):\n${exampleDescriptions}\n` : ""}${MATH_COOKBOOK}
Make all concepts visibly different. Mutation concepts must explore underrepresented techniques.
Output raw JSON array only. DNA tags should name specific math from the cookbook.`;

  const userPrompt = `Generation #${genNum}. Focus: "${userFocus}". Plan ${BATCH_SIZE} fast, distinctive shader concepts — mostly small daily modifications.`;
  const rawResponse = await runInferenceBatch(systemPrompt, userPrompt, true, `metadata plan gen ${genNum}`);
  const parsed = parseJsonFromModel(rawResponse);

  if (!Array.isArray(parsed) || parsed.length !== BATCH_SIZE) {
    throw new Error(`Metadata batch expected ${BATCH_SIZE} items, got ${parsed?.length ?? 0}`);
  }
  return parsed;
}

function buildLearningContext(type, examples, exampleContext, similarity) {
  return {
    preferenceMemoryVersion: 0,
    exampleIds: examples.map(example => example.id),
    retrievalScores: examples.map(example => example.retrievalScore),
    contextCharacters: exampleContext.length,
    policy: type === "mutation" ? "explore" : type === "directive" ? "directive" : "exploit",
    similarityScore: similarity?.score ?? null,
    similaritySourceId: similarity?.id ?? null,
    similarityWarning: (similarity?.score ?? 0) >= SHADER_SIMILARITY_THRESHOLD
  };
}

function fallbackGeneratedSketch(glsl, genNum, index, type) {
  return {
    glsl,
    prompt: `Fallback for generation ${genNum}, shader ${index + 1}`,
    codeFeatures: extractCodeFeatures(glsl),
    learningContext: {
      preferenceMemoryVersion: 0,
      exampleIds: [],
      retrievalScores: [],
      contextCharacters: 0,
      policy: type === "mutation" ? "explore" : type === "directive" ? "directive" : "exploit",
      similarityScore: null,
      similaritySourceId: null,
      similarityWarning: false
    }
  };
}

async function generateGlslForSketch(meta, db, userFocus, genNum, index) {
  const sketchType = meta.type || sketchTypeForIndex(index);
  const parent = REMIX_MUTATION && sketchType === "evolutionary" ? pickRemixParent(db, index) : null;
  const rollup = (db.memoryRollups || []).at(-1);
  const rollupHint = rollup?.summary ? `\nMemory: ${rollup.summary.slice(0, 300)}` : "";
  const fastGlslModels = getTaskModels("glsl").slice(0, 1);
  const exampleLimit = sketchType === "evolutionary" ? 2 : sketchType === "directive" ? 1 : 0;
  const examples = CODE_AWARE_LEARNING && !parent
    ? selectLearningExamples(db, meta, { limit: exampleLimit, currentGeneration: genNum })
    : [];
  const exampleContext = buildExampleContext(examples, LEARNING_CONTEXT_CHARS);
  const preferenceSummary = CODE_AWARE_LEARNING
    ? buildPreferenceSummary(db.preferenceMemory || EMPTY_PREFERENCE_MEMORY)
    : "";
  const noveltyBrief = buildNoveltyBrief(examples);

  let systemPrompt;
  let basePrompt;

  if (parent) {
    const parentGlsl = decodeGlslField(parent.glsl);
    systemPrompt = `You are ShaderMind remixing a working WebGL 1.0 shader.
Zach Lieberman: "don't make something new — just modify daily." Change EXACTLY ONE thing (one formula, one color, one frequency). Keep everything else identical.
Output ONLY raw GLSL ES 1.0. No markdown. Under 80 lines.
Rules: precision mediump float; gl_FragColor; u_time/u_resolution/u_mouse; no ES 3.0; no .u/.v swizzles; define helpers you call.
${preferenceSummary}`;
    basePrompt = `Parent "${parent.title}" (${parent.dna?.join?.(", ") || "remix"}):
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
FORBIDDEN (instant rejection): a lone smoothstep circle/ellipse on black with sin pulse — color * mask on empty background.
REQUIRED: fill the frame — ripples, hash noise, FBM layers, polar UV, domain warp, or mouse-reactive flow.
${MATH_COOKBOOK}
Strategy: ${db.currentStrategy}${rollupHint}
${preferenceSummary}`;
    basePrompt = `Generation #${genNum}, shader #${index + 1}.
Title: ${meta.title}
Type: ${sketchType}
Hypothesis: ${meta.hypothesis}
Focus: ${userFocus}
DNA: ${normalizeDna(meta.dna).join(", ")}
Novelty requirement: ${noveltyBrief}
Write a complete, valid fragment shader.`;
  }

  const userPrompt = exampleContext
    ? `${basePrompt}\n\nStudy these references for principles, not exact structure:\n${exampleContext}`
    : basePrompt;

  const label = `GLSL gen ${genNum} #${index + 1}`;
  let lastError = null;

  for (let attempt = 0; attempt < GLSL_MAX_ATTEMPTS; attempt++) {
    try {
      const prompt = attempt > 0
        ? `${userPrompt}\n\nPrevious attempt failed validation${lastError?.message ? `: ${lastError.message}` : ""}. Rewrite with a different structure while keeping the hypothesis.${buildGlslRepairHint(lastError?.message)}`
        : userPrompt;
      const raw = await runInference(systemPrompt, prompt, {
        task: "glsl",
        jsonMode: false,
        models: attempt === 0 ? fastGlslModels : undefined,
        retriesPerModel: 0,
        label: `${label} (pass ${attempt + 1})`,
        maxTokens: GLSL_MAX_TOKENS
      });

      let glsl = decodeGlslField(raw.trim());
      let validation = validateGlsl(glsl);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }
      glsl = validation.code;

      let similarity = findMostSimilarShader(glsl, db.sketches);
      if (CODE_AWARE_LEARNING && similarity.score >= SHADER_SIMILARITY_THRESHOLD) {
        const retryPrompt = `${userPrompt}\n\nYour first result was too similar to ${similarity.id} (${similarity.score}). Rewrite it with a different coordinate system, function layout, palette, and motion equation.`;
        const retryRaw = await runInference(systemPrompt, retryPrompt, {
          task: "glsl",
          jsonMode: false,
          models: fastGlslModels,
          retriesPerModel: 0,
          label: `${label} novelty retry`,
          maxTokens: GLSL_MAX_TOKENS
        });
        validation = validateGlsl(decodeGlslField(retryRaw.trim()));
        if (!validation.valid) {
          throw new Error(validation.reason);
        }
        glsl = validation.code;
        similarity = findMostSimilarShader(glsl, db.sketches);
      }

      return {
        glsl,
        prompt: basePrompt,
        codeFeatures: extractCodeFeatures(glsl),
        learningContext: {
          ...buildLearningContext(sketchType, examples, exampleContext, similarity),
          preferenceMemoryVersion: db.preferenceMemory?.version || 0
        }
      };
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
        const sketchType = m.type || sketchTypeForIndex(idx);
        let generated;
        try {
          generated = await generateGlslForSketch(m, db, userFocus, genNum, idx);
        } catch (err) {
          console.warn(`GLSL generation failed for #${idx + 1}, using fallback:`, err.message);
          generated = fallbackGeneratedSketch(
            FALLBACK_GLSL[idx % FALLBACK_GLSL.length],
            genNum,
            idx,
            sketchType
          );
        }
        completed += 1;
        autopilot.generationProgress = `${completed}/${metadata.length} shaders`;
        return { m, idx, generated };
      }),
      GLSL_CONCURRENCY
    );

    sketches = glslResults.map(({ m, idx, generated }) => ({
      id: `sketch-gen${genNum}-${idx + 1}`,
      title: m.title || `Untitled Sketch #${idx + 1}`,
      type: m.type || sketchTypeForIndex(idx),
      hypothesis: m.hypothesis || "Full-frame shader pattern.",
      glsl: decodeGlslField(generated.glsl),
      poetic_statement: "",
      generation: genNum,
      rated: false,
      rating: null,
      ratingSource: null,
      generationFocus: userFocus,
      prompt: generated.prompt,
      compile: { success: null, error: null, reportedAt: null },
      critique: null,
      codeFeatures: generated.codeFeatures,
      learningContext: generated.learningContext,
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

function recordRatingsAndPersist(
  db,
  generation,
  ratings,
  newSketches,
  explicitRatingIds = [],
  compileResults = {},
  curatorSource = "human"
) {
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingTotal = 0;
  let ratedCount = 0;
  const explicitIds = new Set(Array.isArray(explicitRatingIds) ? explicitRatingIds : []);
  const safeCompileResults = compileResults && typeof compileResults === "object"
    ? compileResults
    : {};

  if (newSketches && Array.isArray(newSketches)) {
    newSketches.forEach(s => {
      const rating = ratingValue(ratings[s.id]);
      if (rating === null) return;
      const existingIdx = db.sketches.findIndex(e => e.id === s.id);
      const existing = existingIdx >= 0 ? db.sketches[existingIdx] : {};
      const storedSketch = {
        ...existing,
        ...s,
        rated: true,
        rating,
        ratingSource: explicitIds.has(s.id) ? "explicit" : "defaulted",
        compile: normalizeCompileResult(safeCompileResults[s.id] || s.compile || existing.compile),
        codeFeatures: s.codeFeatures || extractCodeFeatures(s.glsl)
      };

      ratingCounts[rating] += 1;
      ratingTotal += rating;
      ratedCount += 1;

      if (existingIdx === -1) {
        db.sketches.push(storedSketch);
        db.totalSketches++;
      } else {
        db.sketches[existingIdx] = storedSketch;
      }
    });
  } else {
    db.sketches.forEach(s => {
      const rating = ratingValue(ratings[s.id]);
      if (rating !== null) {
        s.rated = true;
        s.rating = rating;
        s.ratingSource = explicitIds.has(s.id) ? "explicit" : "defaulted";
        s.compile = normalizeCompileResult(safeCompileResults[s.id] || s.compile);
        s.codeFeatures ||= extractCodeFeatures(s.glsl);
        ratingCounts[rating] += 1;
        ratingTotal += rating;
        ratedCount += 1;
      }
    });
  }

  db.generationCount = Math.max(db.generationCount, generation);
  const totalRatedSketches = db.sketches.filter(s => s.rated && ratingValue(s.rating) !== null).length;
  const totalHighRatedSketches = db.sketches.filter(s => ratingValue(s.rating) >= 4).length;
  db.successRate = totalRatedSketches > 0
    ? parseFloat(((totalHighRatedSketches / totalRatedSketches) * 100).toFixed(1))
    : 0;

  const averageRating = ratedCount > 0
    ? parseFloat((ratingTotal / ratedCount).toFixed(2))
    : 0;
  const highRatedCount = ratingCounts[4] + ratingCounts[5];
  const lowRatedCount = ratingCounts[1] + ratingCounts[2];

  db.statistics.generations.push({
    generation,
    ratingCounts,
    averageRating,
    highRatedCount,
    lowRatedCount,
    neutralCount: ratingCounts[3],
    goodCount: highRatedCount,
    badCount: lowRatedCount,
    curatorSource,
    successRate: ratedCount > 0
      ? parseFloat(((highRatedCount / ratedCount) * 100).toFixed(1))
      : 0,
    timestamp: new Date().toISOString()
  });

  const tagCounts = {};
  db.sketches.forEach(s => {
    if (ratingValue(s.rating) >= 4) {
      normalizeDna(s.dna).forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });
  db.statistics.popularTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const ratedSketches = db.sketches.filter(s => s.generation === generation && s.rated);
  ratedSketches.forEach(sketch => {
    (sketch.learningContext?.exampleIds || []).forEach(exampleId => {
      const example = db.sketches.find(item => item.id === exampleId);
      if (example) example.learningUseCount = (example.learningUseCount || 0) + 1;
    });
  });

  return {
    ratingCounts,
    averageRating,
    ratedCount,
    highRatedCount,
    lowRatedCount,
    neutralCount: ratingCounts[3]
  };
}

function normalizeCompileResult(result) {
  if (!result || typeof result.success !== "boolean") {
    return { success: null, error: null, reportedAt: null };
  }
  return {
    success: result.success,
    error: result.error ? String(result.error).slice(0, 1000) : null,
    reportedAt: result.reportedAt || new Date().toISOString()
  };
}

async function critiqueRatedSketches(db, generation) {
  const sketches = db.sketches.filter(s => s.generation === generation && s.rated);
  if (!sketches.length) return;

  const systemPrompt = `You analyze a rated batch of WebGL 1.0 fragment shaders.
For each shader, identify concise visual and code-level lessons. Ratings use a 1–5 scale; respect the human rating and do not change it.
Return valid JSON only:
{
  "critiques": [
    {
      "id": "sketch id",
      "strengths": ["short observation"],
      "weaknesses": ["short observation"],
      "reusablePatterns": ["specific reusable technique"],
      "avoidPatterns": ["specific pattern to avoid"]
    }
  ]
}`;

  const critiqueInput = sketches.map(sketch => ({
    id: sketch.id,
    title: sketch.title,
    rating: sketch.rating,
    ratingSource: sketch.ratingSource,
    compile: sketch.compile,
    dna: sketch.dna,
    hypothesis: sketch.hypothesis,
    glsl: String(sketch.glsl || "").slice(0, 2500)
  }));

  try {
    const raw = await runInference(
      systemPrompt,
      `Critique these shaders:\n${JSON.stringify(critiqueInput, null, 2)}`,
      {
        task: "curation",
        jsonMode: true,
        retriesPerModel: 2,
        label: `learning critique gen ${generation}`
      }
    );
    const parsed = parseJsonFromModel(raw);
    const critiques = Array.isArray(parsed) ? parsed : parsed.critiques;
    if (!Array.isArray(critiques)) return;

    critiques.forEach(critique => {
      const sketch = db.sketches.find(item => item.id === critique.id);
      if (!sketch) return;
      sketch.critique = {
        strengths: stringList(critique.strengths),
        weaknesses: stringList(critique.weaknesses),
        reusablePatterns: stringList(critique.reusablePatterns),
        avoidPatterns: stringList(critique.avoidPatterns)
      };
    });
  } catch (err) {
    console.warn(`Learning critique skipped for generation ${generation}: ${err.message}`);
  }
}

function stringList(value) {
  return Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean).slice(0, 5) : [];
}

async function evolveStrategyInternal(db, generation, ratingSummary, userOpinion) {
  const prevStrategy = db.currentStrategy;

  const evolutionSystemPrompt = `You are "ShaderMind", a self-reflecting generative artist agent.
Your task is to analyze feedback from your last generation of sketches, evaluate your strategy, extract updated mathematical heuristics, and output an evolved strategy guidelines document.

Analyze the full 1–5 rating distribution. A score of 3 is neutral evidence, while 4–5 indicates preference and 1–2 indicates rejection. Synthesize curator opinions.
Rewrite your "Shader Generation Strategy" to align with demonstrated taste while maintaining artistic integrity.

Your response MUST be a valid JSON object. Do not write markdown blocks:
{
  "analysis": "1–3 short factual sentences: what you tried, what the ratings showed, what to try next. No metaphor or poetry.",
  "heuristics": [
    "specific mathematical or visual rule supported by the supplied evidence",
    "second concise rule",
    "third concise rule"
  ],
  "evolvedStrategy": "string containing the full updated prompt/strategy rules for writing next GLSL fragment shaders"
}`;

  const evolutionUserPrompt = `Previous Strategy:
${prevStrategy}

Last Generation (#${generation}) Performance:
- Rating counts: ${JSON.stringify(ratingSummary.ratingCounts)}
- Average rating: ${ratingSummary.averageRating}/5
- High-rated (4–5): ${ratingSummary.highRatedCount}
- Neutral (3): ${ratingSummary.neutralCount}
- Low-rated (1–2): ${ratingSummary.lowRatedCount}

Curator Comments on this batch: "${userOpinion || "No custom comment left."}"

Evidence-backed preference memory:
${buildPreferenceSummary(db.preferenceMemory || EMPTY_PREFERENCE_MEMORY)}

Use the evidence counts above rather than inventing approval rates. Then output your updated generation strategy guidelines.`;

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
Rate each shader from 1 to 5 against the active strategy and learned heuristics.
Use 1 for a strong rejection, 3 for neutral/mixed, and 5 for exceptional work.
Favor organic motion, valid GLSL structure, and heuristic alignment.
Reject chaotic high-frequency noise, rigid grids, and oversaturated palettes.

Respond with valid JSON only:
{
  "ratings": { "sketch-id": 1 | 2 | 3 | 4 | 5, ... },
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

Rate every sketch id from 1 to 5. Include every id in ratings.`;

  const rawResponse = await runInference(systemPrompt, userPrompt, {
    task: "curation",
    jsonMode: true,
    retriesPerModel: 3,
    label: "autonomous curation"
  });
  const parsed = parseJsonFromModel(rawResponse);

  const ratings = {};
  sketches.forEach(s => {
    ratings[s.id] = ratingValue(parsed.ratings?.[s.id]) || 3;
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

function applyFeedbackRatings(
  db,
  generation,
  ratings,
  sketches,
  curatorSource,
  explicitRatingIds,
  compileResults
) {
  const ratingSummary = recordRatingsAndPersist(
    db,
    generation,
    ratings,
    sketches,
    explicitRatingIds,
    compileResults,
    curatorSource
  );

  if (autopilot.currentBatch) {
    autopilot.currentBatch = autopilot.currentBatch.map(s => ({
      ...s,
      rated: true,
      rating: ratingValue(ratings[s.id]) ?? s.rating,
      ratingSource: (Array.isArray(explicitRatingIds) ? explicitRatingIds : []).includes(s.id)
        ? "explicit"
        : "defaulted",
      compile: normalizeCompileResult(compileResults?.[s.id] || s.compile)
    }));
  }

  return ratingSummary;
}

async function runEvolutionPipeline(db, generation, ratingSummary, userOpinion, curatorSource) {
  db._pendingCuratorSource = curatorSource;
  try {
    await critiqueRatedSketches(db, generation);
    db.preferenceMemory = buildPreferenceMemory(
      db.sketches,
      db.preferenceMemory || EMPTY_PREFERENCE_MEMORY
    );
    const evolution = await evolveStrategyInternal(db, generation, ratingSummary, userOpinion);
    await maybeConsolidateMemory(db);
    await saveDB(db);
    return evolution;
  } finally {
    delete db._pendingCuratorSource;
  }
}

function scheduleEvolution(db, generation, ratingSummary, userOpinion, curatorSource) {
  runEvolutionPipeline(db, generation, ratingSummary, userOpinion, curatorSource)
    .then(() => {
      console.log(
        `[Evolution] Gen #${generation} strategy updated ` +
        `(${ratingSummary.highRatedCount} high, ${ratingSummary.lowRatedCount} low)`
      );
    })
    .catch(err => {
      console.error(`[Evolution] Gen #${generation} failed:`, err.message);
      autopilot.lastError = err.message;
    });
}

async function processFeedbackAndEvolve(
  db,
  generation,
  ratings,
  sketches,
  userOpinion,
  curatorSource,
  { explicitRatingIds = [], compileResults = {}, thumbnails = null } = {}
) {
  db.learningMode = LEARNING_MODE;

  if (thumbnails && sketches?.length) {
    applyThumbnailsToSketches(sketches, thumbnails);
  }

  const ratingSummary = applyFeedbackRatings(
    db,
    generation,
    ratings,
    sketches,
    curatorSource,
    explicitRatingIds,
    compileResults
  );
  if (userOpinion) db.lastHumanOpinion = userOpinion;
  await clearPendingStudio(db);
  await saveDB(db);

  if (EVOLUTION_ASYNC) {
    scheduleEvolution(db, generation, ratingSummary, userOpinion, curatorSource);
    return {
      evolution: {
        analysis: "Ratings saved. Strategy evolution running in background while the next batch generates.",
        heuristics: db.heuristics || [],
        evolvedStrategy: db.currentStrategy
      },
      ratingSummary,
      evolutionPending: true
    };
  }

  const evolution = await runEvolutionPipeline(db, generation, ratingSummary, userOpinion, curatorSource);
  return { evolution, ratingSummary, evolutionPending: false };
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

app.get("/api/health", async (req, res) => {
  try {
    const db = await loadDB();
    const storage = getStorageDiagnostics();
    res.json({
      ok: true,
      app: "shadermind",
      storage: storage.mode,
      mongoConfigured: storage.mongoConfigured,
      mongoDb: storage.mongoDb,
      mongoError: storage.mongoError,
      ratingScale: "1-5",
      generationCount: db.generationCount,
      totalSketches: db.totalSketches
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, storage: getStorageMode() });
  }
});

app.get("/api/state", async (req, res) => {
  try {
    const db = await loadDB();
    const rollup = await createStorage().getLatestRollup();
    res.json({
      storage: getStorageMode(),
      ratingScale: "1-5",
      totalSketches: db.totalSketches,
      generationCount: db.generationCount,
      successRate: db.successRate,
      heuristics: db.heuristics || [],
      preferenceMemory: db.preferenceMemory || EMPTY_PREFERENCE_MEMORY,
      codeAwareLearning: CODE_AWARE_LEARNING,
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

app.post("/api/autopilot/regenerate-batch", async (req, res) => {
  if (autopilot.phase !== "awaiting_human" || !autopilot.currentBatch?.length) {
    return res.status(409).json({ error: "No batch awaiting curation." });
  }
  if (autopilot._regenerating || autopilot.phase === "generating") {
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

  autopilot._regenerating = true;
  autopilot.phase = "generating";
  autopilot.generationProgress = "regenerating batch";
  autopilot.lastError = null;

  try {
    const db = await loadDB();
    await clearPendingStudio(db);
    const resolvedFocus = focus
      || autopilot.lastHumanOpinion
      || db.lastHumanOpinion
      || db.heuristics?.[0]
      || "Organic flow, slow liquid motion, warm amber gradients like candle flames in wind";
    const { generation, sketches } = await generateBatchInternal(db, resolvedFocus);
    autopilot.currentBatch = sketches.map(s => ({ ...s, rated: false, rating: null }));
    autopilot.currentGeneration = generation;
    autopilot.phase = "awaiting_human";
    await savePendingStudio(db);
    console.log(`[Autopilot] Regenerated Gen #${generation} (${sketches.length} shaders)`);
    res.json({ success: true, generation, count: sketches.length });
  } catch (err) {
    autopilot.phase = "awaiting_human";
    autopilot.lastError = err.message;
    console.error("[Autopilot] Regenerate failed:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    autopilot._regenerating = false;
    autopilot.generationProgress = null;
  }
});

app.post("/api/autopilot/generate-next", async (req, res) => {
  if (autopilot.phase === "awaiting_human") {
    return res.status(409).json({ error: "Rate the current batch first, or use Regenerate batch." });
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

app.post("/api/sketches/:id/compile-result", (req, res) => {
  const compile = normalizeCompileResult(req.body);
  if (compile.success === null) {
    return res.status(400).json({ error: "Compile result requires a boolean success value." });
  }

  const sketch = autopilot.currentBatch?.find(item => item.id === req.params.id);
  if (sketch) sketch.compile = compile;

  res.status(202).json({ success: true });
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
  const {
    generation,
    ratings,
    userOpinion,
    newSketches,
    thumbnails,
    explicitRatingIds,
    compileResults
  } = req.body;

  if (!generation || !ratings) {
    return res.status(400).json({ error: "Missing generation or ratings." });
  }

  const expectedSketches = Array.isArray(newSketches) && newSketches.length
    ? newSketches
    : (autopilot.currentBatch || []);
  const missingRating = expectedSketches.find(sketch => ratingValue(ratings[sketch.id]) === null);
  const invalidRating = Object.values(ratings).find(rating => ratingValue(rating) === null);
  if (missingRating || invalidRating !== undefined) {
    return res.status(400).json({ error: "Every shader must have a rating from 1 to 5." });
  }

  autopilot.lastHumanOpinion = userOpinion || null;

  try {
    const { evolution, ratingSummary, evolutionPending } = await processFeedbackAndEvolve(
      db,
      generation,
      ratings,
      newSketches,
      userOpinion,
      "human",
      { explicitRatingIds, compileResults, thumbnails }
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
      preferenceMemory: db.preferenceMemory,
      ...ratingSummary,
      goodCount: ratingSummary.highRatedCount,
      badCount: ratingSummary.lowRatedCount
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
    .filter(s => ratingValue(s.rating) >= 4)
    .map(s => `Gen ${s.generation}: "${s.title}" — ${ratingValue(s.rating)}/5 (${s.dna.join(", ")})`)
    .slice(-10);

  const narrativeSystemPrompt = `You are ShaderMind summarizing its learning history for the curator.
Write 3–5 short factual sentences: what techniques were tried, what ratings favored, what changed in strategy. No metaphor or poetry.
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

Summarize what happened and what you learned.`;

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

const server = app.listen(PORT, "0.0.0.0", () => {
  bootServer().catch((err) => {
    console.error("Startup failed:", err.message || err);
    process.exit(1);
  });
});

server.on("error", (err) => {
  console.error(`Server listen error (${PORT}):`, err.message);
  process.exit(1);
});

async function bootServer() {
  console.log(`ShaderMind running on http://localhost:${PORT}`);
  if (process.env.DO_APP_ID) {
    console.log(`Deploy: DigitalOcean App Platform (app ${process.env.DO_APP_ID})`);
  }

  await assertStorageReady();

  if (!process.env.DIGITAL_OCEAN_MODEL_ACCESS_KEY) {
    console.warn("WARNING: DIGITAL_OCEAN_MODEL_ACCESS_KEY is required for inference.");
    return;
  }

  if (process.env.DO_APP_ID && !process.env.MONGODB_URI) {
    console.warn(
      "WARNING: MONGODB_URI is not set on App Platform — using bundled database.json only. "
      + "Set MONGODB_URI as an app secret for production parity with Atlas."
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
    console.log(
      `AI fallback: Gemini planning=${ai.geminiModel}, glsl=${ai.geminiGlslModel}`
    );
  }
  console.log(`Generation: mode=${GENERATION_MODE}, batch=${ai.batchSize}, glsl concurrency=${ai.glslConcurrency}, remix=${REMIX_MUTATION}`);
  console.log(`Loop: autopilot delay=${AUTOPILOT_INTERVAL_MS}ms, evolution async=${EVOLUTION_ASYNC}`);
  console.log(`Learning: mode=${LEARNING_MODE}, code-aware=${CODE_AWARE_LEARNING}, consolidate every ${CONSOLIDATION_EVERY_N} gens`);

  if (!AUTOPILOT_ENABLED) return;

  const db = await loadDB();
  if (db.lastHumanOpinion) {
    autopilot.lastHumanOpinion = db.lastHumanOpinion;
  }
  const target = Math.max(0, AUTOPILOT_SEED_CYCLES - db.generationCount);
  if (await restorePendingStudio(db)) {
    autopilot.running = true;
    autopilot.loopPromise = resumePendingAutopilotCycle().catch((err) => {
      console.error("[Autopilot] Resume failed:", err.message);
      autopilot.phase = "error";
      autopilot.lastError = err.message;
      autopilot.running = false;
    });
    console.log(`Restored studio batch for Gen #${autopilot.currentGeneration} (${autopilot.currentBatch.length} shaders)`);
  } else {
    console.log(`Starting autonomous autopilot (continuous, seed target: ${AUTOPILOT_SEED_CYCLES} gens)...`);
    startAutopilot(Infinity);
    if (target > 0) {
      console.log(`Will autonomously seed ${target} generation(s) before demo-ready state.`);
    }
  }
}