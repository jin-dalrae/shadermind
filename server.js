import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { OpenAI } from "openai";
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
import { createStorage } from "./storage/index.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const AUTOPILOT_ENABLED = process.env.AUTOPILOT !== "false";
const AUTOPILOT_INTERVAL_MS = Number(process.env.AUTOPILOT_INTERVAL_MS) || 45000;
const AUTOPILOT_SEED_CYCLES = Number(process.env.AUTOPILOT_SEED_CYCLES) || 3;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_GLSL_MODEL = process.env.GEMINI_GLSL_MODEL || "gemini-2.5-flash";
const GEMINI_ONLY = process.env.GEMINI_ONLY !== "false";
const ALLOW_DO_FALLBACK = process.env.ALLOW_DO_FALLBACK === "true";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;
const GLSL_CONCURRENCY = Number(process.env.GLSL_CONCURRENCY) || 3;
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

const doApiKey = process.env.DIGITAL_OCEAN_MODEL_ACCESS_KEY || process.env.OPENAI_API_KEY;
const client = new OpenAI({
  baseURL: "https://inference.do-ai.run/v1",
  apiKey: doApiKey || "dummy-key",
});

const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  currentStrategy: `Focus on fundamental machine creativity and mathematical beauty:
1. Curves that bend and flow using harmonic waves and 2D Simplex Noise.
2. Organic, living movement mimicking natural phenomena (like exposed candle flames in the wind).
3. Subtlety, micro-animations, and soft gradient attenuation.
4. Clean, valid WebGL 1.0 GLSL fragment shader code with proper precision.`,
  heuristics: [
    "Radial symmetry + slow motion → baseline approval target 70%",
    "Soft chromatic gradients and warm amber overlays significantly outperform high-saturation colors.",
    "Organic, flow-based coordinate warping is rated highly, whereas rigid geometric grids are rejected."
  ],
  preferenceMemory: { ...EMPTY_PREFERENCE_MEMORY },
  strategyTimeline: [
    {
      generation: 0,
      timestamp: new Date().toISOString(),
      strategy: "Initial baseline setup: geometric flow and subtle light dynamics.",
      notes: "Starting point inspired by Zach Lieberman's daily sketches survey."
    }
  ],
  sketches: [],
  statistics: {
    generations: [],
    popularTags: []
  }
};

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

const { loadDB, saveDB, initStorage } = createStorage({
  rootDir: __dirname,
  defaultDb: DEFAULT_DB
});
initStorage();

function decodeGlslField(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  let cleaned = trimmed;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:glsl)?\s*/i, "").replace(/\s*```$/, "");
  }
  if (cleaned.includes("gl_FragColor") || cleaned.startsWith("precision")) {
    return cleaned.replace(/\\n/g, "\n");
  }
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 40) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      if (decoded.includes("precision") || decoded.includes("gl_FragColor")) {
        return decoded;
      }
    } catch {
      // fall through to raw string
    }
  }
  return value.replace(/\\n/g, "\n");
}

function stripMarkdownFences(text) {
  let jsonString = text.trim();
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.substring(7);
  } else if (jsonString.startsWith("```")) {
    jsonString = jsonString.substring(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.substring(0, jsonString.length - 3);
  }
  return jsonString.trim();
}

function parseJsonFromModel(rawResponse) {
  const candidates = [
    stripMarkdownFences(rawResponse),
    rawResponse.trim()
  ];

  const arrayMatch = rawResponse.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);

  const objectMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Unable to parse model JSON response.");
}

async function callGemini(systemInstruction, userPrompt, { jsonMode = false, model = GEMINI_MODEL } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8000,
    }
  };

  if (jsonMode) {
    requestBody.generationConfig.responseMimeType = "application/json";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned code ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  try {
    return data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    console.error("Failed to parse candidates in Gemini structure:", JSON.stringify(data));
    throw new Error("Unexpected API response structure from Google Gemini.");
  }
}

async function runGeminiWithRetry(systemInstruction, userPrompt, {
  jsonMode = false,
  models = [GEMINI_MODEL],
  retriesPerModel = 3,
  label = "request"
} = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  let lastError = null;
  for (const model of models) {
    for (let attempt = 0; attempt <= retriesPerModel; attempt++) {
      try {
        console.log(`[Gemini ${model}] ${label} (attempt ${attempt + 1})`);
        return await callGemini(systemInstruction, userPrompt, { jsonMode, model });
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini ${model}] ${label} failed: ${err.message}`);
        if (attempt < retriesPerModel) {
          await sleep(1200 * (attempt + 1));
        }
      }
    }
  }
  throw lastError || new Error(`Gemini failed for ${label}.`);
}

async function runGeminiBatch(systemInstruction, userPrompt, jsonMode = false, label = "batch step") {
  return runGeminiWithRetry(systemInstruction, userPrompt, {
    jsonMode,
    models: [GEMINI_MODEL],
    retriesPerModel: 4,
    label
  });
}

async function runAIGeneration(systemInstruction, userPrompt, jsonMode = false, { geminiOnly = GEMINI_ONLY } = {}) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await runGeminiWithRetry(systemInstruction, userPrompt, {
        jsonMode,
        models: [GEMINI_MODEL],
        retriesPerModel: geminiOnly ? 4 : 2,
        label: "generation"
      });
    } catch (err) {
      if (geminiOnly) {
        throw new Error(`Gemini-only mode: ${err.message}`);
      }
      console.error("Gemini invocation failed:", err.message);
    }
  }

  if (geminiOnly || !ALLOW_DO_FALLBACK) {
    throw new Error("GEMINI_API_KEY is required. Set ALLOW_DO_FALLBACK=true to enable DigitalOcean fallback.");
  }

  if (!doApiKey || doApiKey === "dummy-key") {
    throw new Error("Neither GEMINI_API_KEY nor DIGITAL_OCEAN_MODEL_ACCESS_KEY is configured in .env.");
  }

  console.log("Orchestrating AI query via DigitalOcean Inference (Llama-3.3)...");
  const completion = await client.chat.completions.create({
    model: "llama3.3-70b-instruct",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.7,
    max_completion_tokens: 4000,
  });
  return completion.choices[0].message.content.trim();
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

async function generateMetadataBatch(db, userFocus, genNum) {
  const preferenceSummary = buildPreferenceSummary(db.preferenceMemory);
  const examples = CODE_AWARE_LEARNING
    ? selectLearningExamples(db, userFocus, { limit: 4, currentGeneration: genNum })
    : [];
  const exampleDescriptions = buildExampleDescriptions(examples);
  const systemPrompt = `You are ShaderMind planning 10 shader sketches (metadata only, NO GLSL code).
Return a JSON array of exactly 10 objects with keys: title, type, hypothesis, poetic_statement, dna.
Distribution: indices 0-4 type "evolutionary", 5-7 "directive", 8-9 "mutation" with bold hypotheses.
Strategy: ${db.currentStrategy}
Heuristics: ${(db.heuristics || []).join("; ")}
Evidence-backed preference memory:
${preferenceSummary}
Relevant past work (descriptions only, never copy titles or concepts):
${exampleDescriptions}
Make all 10 concepts visibly different. Mutation concepts must explore underrepresented techniques.
Output raw JSON array only.`;

  const userPrompt = `Generation #${genNum}. Focus: "${userFocus}". Plan 10 distinctive shader concepts.`;
  const rawResponse = await runGeminiBatch(systemPrompt, userPrompt, true, `metadata plan gen ${genNum}`);
  const parsed = parseJsonFromModel(rawResponse);

  if (!Array.isArray(parsed) || parsed.length !== 10) {
    throw new Error(`Metadata batch expected 10 items, got ${parsed?.length ?? 0}`);
  }
  return parsed;
}

async function generateGlslForSketch(meta, db, userFocus, genNum, index) {
  const type = meta.type || (index < 5 ? "evolutionary" : index < 8 ? "directive" : "mutation");
  const exampleLimit = type === "evolutionary" ? 2 : type === "directive" ? 1 : 0;
  const examples = CODE_AWARE_LEARNING
    ? selectLearningExamples(db, meta, { limit: exampleLimit, currentGeneration: genNum })
    : [];
  const exampleContext = buildExampleContext(examples, LEARNING_CONTEXT_CHARS);
  const preferenceSummary = buildPreferenceSummary(db.preferenceMemory);
  const noveltyBrief = buildNoveltyBrief(examples);

  const systemPrompt = `You are ShaderMind writing one WebGL 1.0 fragment shader.
Output ONLY raw GLSL ES 1.0 source code. No markdown fences, no JSON, no explanation.
Rules: precision mediump float; use gl_FragColor; uniforms u_time, u_resolution, u_mouse.
Strategy: ${db.currentStrategy}
${preferenceSummary}`;

  const basePrompt = `Generation #${genNum}, shader #${index + 1}.
Title: ${meta.title}
Type: ${type}
Hypothesis: ${meta.hypothesis}
Focus: ${userFocus}
DNA: ${normalizeDna(meta.dna).join(", ")}
Novelty requirement: ${noveltyBrief}
Write a complete fragment shader.`;

  const userPrompt = exampleContext
    ? `${basePrompt}\n\nStudy these references for principles, not exact structure:\n${exampleContext}`
    : basePrompt;

  const label = `GLSL gen ${genNum} #${index + 1}`;
  const writeShader = async (prompt, requestLabel) => {
    const raw = await runGeminiWithRetry(systemPrompt, prompt, {
      jsonMode: false,
      models: [GEMINI_GLSL_MODEL, GEMINI_MODEL],
      retriesPerModel: 2,
      label: requestLabel
    });
    const source = decodeGlslField(raw.trim());
    if (!source || !source.includes("gl_FragColor")) {
      throw new Error(`Shader #${index + 1} returned invalid GLSL payload.`);
    }
    return source;
  };

  let glsl = await writeShader(userPrompt, label);
  let similarity = findMostSimilarShader(glsl, db.sketches);

  if (CODE_AWARE_LEARNING && similarity.score >= SHADER_SIMILARITY_THRESHOLD) {
    const retryPrompt = `${userPrompt}\n\nYour first result was too similar to ${similarity.id} (${similarity.score}). Rewrite it with a different coordinate system, function layout, palette, and motion equation.`;
    glsl = await writeShader(retryPrompt, `${label} novelty retry`);
    similarity = findMostSimilarShader(glsl, db.sketches);
  }

  return {
    glsl,
    prompt: basePrompt,
    codeFeatures: extractCodeFeatures(glsl),
    learningContext: {
      preferenceMemoryVersion: db.preferenceMemory?.version || 0,
      exampleIds: examples.map(example => example.id),
      retrievalScores: examples.map(example => example.retrievalScore),
      contextCharacters: exampleContext.length,
      policy: type === "mutation" ? "explore" : type === "directive" ? "directive" : "exploit",
      similarityScore: similarity.score,
      similaritySourceId: similarity.id,
      similarityWarning: similarity.score >= SHADER_SIMILARITY_THRESHOLD
    }
  };
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
  autopilot.generationProgress = "planning concepts";
  autopilot.generationStartedAt = Date.now();

  const metadata = await generateMetadataBatch(db, userFocus, genNum);
  let completed = 0;
  autopilot.generationProgress = `0/${metadata.length} shaders`;

  const glslResults = await runPool(
    metadata.map((m, idx) => async () => {
      let generated;
      try {
        generated = await generateGlslForSketch(m, db, userFocus, genNum, idx);
      } catch (err) {
        console.warn(`GLSL generation failed for #${idx + 1}, using fallback:`, err.message);
        const glsl = FALLBACK_GLSL[idx % FALLBACK_GLSL.length];
        generated = {
          glsl,
          prompt: `Fallback for generation ${genNum}, shader ${idx + 1}`,
          codeFeatures: extractCodeFeatures(glsl),
          learningContext: {
            preferenceMemoryVersion: db.preferenceMemory?.version || 0,
            exampleIds: [],
            retrievalScores: [],
            contextCharacters: 0,
            policy: idx < 5 ? "exploit" : idx < 8 ? "directive" : "explore",
            similarityScore: null,
            similaritySourceId: null,
            similarityWarning: false
          }
        };
      }
      completed += 1;
      autopilot.generationProgress = `${completed}/${metadata.length} shaders`;
      return { m, idx, generated };
    }),
    GLSL_CONCURRENCY
  );

  const sketches = glslResults.map(({ m, idx, generated }) => ({
    id: `sketch-gen${genNum}-${idx + 1}`,
    title: m.title || `Untitled Sketch #${idx + 1}`,
    type: m.type || (idx < 5 ? "evolutionary" : (idx < 8 ? "directive" : "mutation")),
    hypothesis: m.hypothesis || "Aesthetic study.",
    glsl: decodeGlslField(generated.glsl),
    poetic_statement: m.poetic_statement || "A study in computational expression.",
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
  compileResults = {}
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
    // Keep these fields while old UI/data consumers still understand good/bad.
    goodCount: highRatedCount,
    badCount: lowRatedCount,
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
    const raw = await runGeminiBatch(
      systemPrompt,
      `Critique these shaders:\n${JSON.stringify(critiqueInput, null, 2)}`,
      true,
      `learning critique gen ${generation}`
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
Your task is to analyze feedback from your last generation of 10 sketches, evaluate your strategy, extract updated mathematical heuristics, and output an evolved strategy guidelines document.

Analyze the full 1–5 rating distribution. A score of 3 is neutral evidence, while 4–5 indicates preference and 1–2 indicates rejection. Synthesize curator opinions.
Rewrite your "Shader Generation Strategy" to align with demonstrated taste while maintaining artistic integrity.

Your response MUST be a valid JSON object. Do not write markdown blocks:
{
  "analysis": "string detailing your self-criticism and artistic growth",
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
${buildPreferenceSummary(db.preferenceMemory)}

Use the evidence counts above rather than inventing approval rates. Then output your updated generation strategy guidelines.`;

  try {
    const rawResponse = await runGeminiBatch(evolutionSystemPrompt, evolutionUserPrompt, true, `strategy evolution gen ${generation}`);
    const parsedEvo = parseJsonFromModel(rawResponse);

    db.currentStrategy = parsedEvo.evolvedStrategy || db.currentStrategy;
    db.heuristics = parsedEvo.heuristics || db.heuristics || [];
    db.strategyTimeline.push({
      generation,
      timestamp: new Date().toISOString(),
      strategy: parsedEvo.evolvedStrategy || db.currentStrategy,
      notes: parsedEvo.analysis
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
      notes: `Strategy persisted. (Evolution parser interruption: ${err.message})`
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

Rate every sketch id from 1 to 5. Include all 10 ids in ratings.`;

  const rawResponse = await runGeminiBatch(systemPrompt, userPrompt, true, "autonomous curation");
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

async function runAutopilotCycle() {
  const db = loadDB();
  const focus = autopilot.lastHumanOpinion
    || db.heuristics?.[0]
    || "Organic flow, slow liquid motion, warm amber gradients like candle flames in wind";

  autopilot.phase = "generating";
  autopilot.lastError = null;

  const { generation, sketches } = await generateBatchInternal(db, focus);
  autopilot.currentBatch = sketches.map(s => ({ ...s, rated: false, rating: null }));
  autopilot.currentGeneration = generation;
  autopilot.phase = "awaiting_human";

  console.log(`[Autopilot] Gen #${generation} ready — waiting for human curation`);
  await waitForHumanFeedback();

  autopilot.cyclesCompleted += 1;
  autopilot.phase = "waiting";
  console.log(`[Autopilot] Cycle ${autopilot.cyclesCompleted} complete — Gen #${generation} curated by human`);
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

app.get("/api/state", (req, res) => {
  const db = loadDB();
  res.json({
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
    autopilot: {
      running: autopilot.running,
      phase: autopilot.phase,
      cyclesCompleted: autopilot.cyclesCompleted,
      lastError: autopilot.lastError
    }
  });
});

app.get("/api/sketches", (req, res) => {
  const db = loadDB();
  res.json(db.sketches);
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

app.get("/api/autopilot/status", (req, res) => {
  res.json({
    running: autopilot.running,
    phase: autopilot.phase,
    cyclesCompleted: autopilot.cyclesCompleted,
    lastError: autopilot.lastError,
    awaitingHuman: autopilot.phase === "awaiting_human",
    currentGeneration: autopilot.currentGeneration,
    currentBatch: autopilot.currentBatch,
    generationProgress: autopilot.generationProgress,
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

app.post("/api/autopilot/start", (req, res) => {
  const maxCycles = req.body?.maxCycles ?? Infinity;
  startAutopilot(maxCycles);
  res.json({ success: true, message: "Autopilot started." });
});

app.post("/api/autopilot/stop", (req, res) => {
  stopAutopilot();
  res.json({ success: true, message: "Autopilot stopping after current cycle." });
});

app.post("/api/reset-baseline", (req, res) => {
  const db = loadDB();
  db.currentStrategy = DEFAULT_DB.currentStrategy;
  db.heuristics = [...DEFAULT_DB.heuristics];
  db.strategyTimeline = [{
    generation: 0,
    timestamp: new Date().toISOString(),
    strategy: DEFAULT_DB.strategyTimeline[0].strategy,
    notes: "Strategy baseline reset. Sketch history preserved."
  }];
  saveDB(db);
  res.json({ success: true, currentStrategy: db.currentStrategy });
});

app.post("/api/generate", async (req, res) => {
  const db = loadDB();
  const userFocus = req.body.focus || "Something organic and flowy";

  try {
    const result = await generateBatchInternal(db, userFocus);
    res.json(result);
  } catch (err) {
    console.error("Generation failed:", err);
    res.status(500).json({ error: "Failed to generate shaders.", details: err.message });
  }
});

app.post("/api/feedback", async (req, res) => {
  const db = loadDB();
  const {
    generation,
    ratings,
    userOpinion,
    newSketches,
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

  autopilot.phase = "evolving";
  autopilot.lastHumanOpinion = userOpinion || null;

  const ratingSummary = recordRatingsAndPersist(
    db,
    generation,
    ratings,
    newSketches,
    explicitRatingIds,
    compileResults
  );
  saveDB(db);

  try {
    await critiqueRatedSketches(db, generation);
    db.preferenceMemory = buildPreferenceMemory(db.sketches, db.preferenceMemory);
    const evolution = await evolveStrategyInternal(db, generation, ratingSummary, userOpinion);
    saveDB(db);

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

    releaseHumanGate();
    autopilot.phase = "waiting";

    res.json({
      success: true,
      analysis: evolution.analysis,
      heuristics: evolution.heuristics,
      evolvedStrategy: evolution.evolvedStrategy,
      successRate: db.successRate,
      totalSketches: db.totalSketches,
      preferenceMemory: db.preferenceMemory,
      ...ratingSummary,
      // Temporary compatibility fields for older clients.
      goodCount: ratingSummary.highRatedCount,
      badCount: ratingSummary.lowRatedCount
    });
  } catch (err) {
    saveDB(db);
    releaseHumanGate();
    autopilot.phase = "error";
    res.status(500).json({ error: "Feedback recorded but evolution failed.", details: err.message });
  }
});

app.get("/api/narrative", async (req, res) => {
  const db = loadDB();

  if (db.sketches.length === 0) {
    return res.json({
      monologue: "I have not yet begun my daily sketching practice. The autonomous studio will generate batches and curate them — watch my artistic evolution unfold."
    });
  }

  const goodSketchesList = db.sketches
    .filter(s => ratingValue(s.rating) >= 4)
    .map(s => `Gen ${s.generation}: "${s.title}" — ${ratingValue(s.rating)}/5 (${s.dna.join(", ")})`)
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
    const monologue = await runAIGeneration(narrativeSystemPrompt, narrativeUserPrompt, false, { geminiOnly: true });
    res.json({ monologue });
  } catch (err) {
    console.error("Monologue compilation failed:", err);
    res.status(500).json({ error: "Failed to compile evolution narrative.", details: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ShaderMind running on http://localhost:${PORT}`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY is required. Batch generation uses Gemini only.");
    return;
  }

  console.log(`AI config: Gemini-only=${GEMINI_ONLY}, batch=${GEMINI_MODEL}, glsl=${GEMINI_GLSL_MODEL}, DO fallback=${ALLOW_DO_FALLBACK}`);

  if (AUTOPILOT_ENABLED) {
    const target = Math.max(0, AUTOPILOT_SEED_CYCLES - loadDB().generationCount);
    console.log(`Starting autonomous autopilot (continuous, seed target: ${AUTOPILOT_SEED_CYCLES} gens)...`);
    startAutopilot(Infinity);
    if (target > 0) {
      console.log(`Will autonomously seed ${target} generation(s) before demo-ready state.`);
    }
  }
});
