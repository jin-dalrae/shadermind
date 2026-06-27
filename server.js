import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const AUTOPILOT_ENABLED = process.env.AUTOPILOT !== "false";
const AUTOPILOT_INTERVAL_MS = Number(process.env.AUTOPILOT_INTERVAL_MS) || 45000;
const AUTOPILOT_SEED_CYCLES = Number(process.env.AUTOPILOT_SEED_CYCLES) || 3;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const doApiKey = process.env.DIGITAL_OCEAN_MODEL_ACCESS_KEY || process.env.OPENAI_API_KEY;
const client = new OpenAI({
  baseURL: "https://inference.do-ai.run/v1",
  apiKey: doApiKey || "dummy-key",
});

const DB_PATH = path.join(__dirname, "database.json");

const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  streakDays: 0,
  lastActiveDate: null,
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
  lastOpinion: null,
  currentBatch: null,
  currentGeneration: null,
  loopPromise: null
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf8");
      const parsed = JSON.parse(raw);
      return { ...JSON.parse(JSON.stringify(DEFAULT_DB)), ...parsed };
    }
  } catch (err) {
    console.error("Error loading database, returning default:", err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving database:", err);
  }
}

if (!fs.existsSync(DB_PATH)) {
  saveDB(DEFAULT_DB);
}

function normalizeDna(dna) {
  if (Array.isArray(dna)) return dna.map(String).filter(Boolean);
  if (typeof dna === "string") return dna.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
  return ["experiment"];
}

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

async function runAIGenerationWithRetry(systemInstruction, userPrompt, jsonMode = false, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await runAIGeneration(systemInstruction, userPrompt, jsonMode);
    } catch (err) {
      lastError = err;
      console.warn(`AI call attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function callGemini(systemInstruction, userPrompt, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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

async function runAIGeneration(systemInstruction, userPrompt, jsonMode = false) {
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log("Orchestrating AI query via Google Gemini API...");
      return await callGemini(systemInstruction, userPrompt, jsonMode);
    } catch (err) {
      console.error("Gemini invocation failed, transitioning to DigitalOcean fallback...", err.message);
    }
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

function buildRemixSection(db) {
  const previousGoodSketches = db.sketches
    .filter(s => s.rating === "good")
    .slice(-3);

  if (previousGoodSketches.length === 0) {
    return "";
  }

  let remixSection = `\nHere are some of your previous sketches that were rated 'Good'. Use their techniques or directly remix fragments of their math formulas as Zach Lieberman recommends ('Make something new out of something old'):\n`;
  previousGoodSketches.forEach((s, idx) => {
    remixSection += `\n--- SOURCE TEMPLATE #${idx + 1}: "${s.title}" ---\nPoetic Description: ${s.poetic_statement}\nDNA: ${s.dna.join(", ")}\nGLSL Code:\n${s.glsl}\n`;
  });
  return remixSection;
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

async function generateMetadataBatch(db, userFocus, genNum) {
  const remixSection = buildRemixSection(db);
  const systemPrompt = `You are ShaderMind planning 10 shader sketches (metadata only, NO GLSL code).
Return a JSON array of exactly 10 objects with keys: title, type, hypothesis, poetic_statement, dna.
Distribution: indices 0-4 type "evolutionary", 5-7 "directive", 8-9 "mutation" with bold hypotheses.
Strategy: ${db.currentStrategy}
Heuristics: ${(db.heuristics || []).join("; ")}
${remixSection}
Output raw JSON array only.`;

  const userPrompt = `Generation #${genNum}. Focus: "${userFocus}". Plan 10 distinctive shader concepts.`;
  const rawResponse = await runAIGenerationWithRetry(systemPrompt, userPrompt, true);
  const parsed = parseJsonFromModel(rawResponse);

  if (!Array.isArray(parsed) || parsed.length !== 10) {
    throw new Error(`Metadata batch expected 10 items, got ${parsed?.length ?? 0}`);
  }
  return parsed;
}

async function generateGlslForSketch(meta, db, userFocus, genNum, index) {
  const systemPrompt = `You are ShaderMind writing one WebGL 1.0 fragment shader.
Output ONLY a base64-encoded UTF-8 string of the complete GLSL source. No JSON, no markdown, no explanation.
Rules: precision mediump float; use gl_FragColor; uniforms u_time, u_resolution, u_mouse; valid GLSL ES 1.0 only.
Strategy: ${db.currentStrategy}`;

  const userPrompt = `Generation #${genNum}, shader #${index + 1}.
Title: ${meta.title}
Type: ${meta.type}
Hypothesis: ${meta.hypothesis}
Focus: ${userFocus}
DNA: ${normalizeDna(meta.dna).join(", ")}
Write the shader and output base64 only.`;

  const raw = await runAIGenerationWithRetry(systemPrompt, userPrompt, false);
  const glsl = decodeGlslField(raw.trim());
  if (!glsl || !glsl.includes("gl_FragColor")) {
    throw new Error(`Shader #${index + 1} returned invalid GLSL payload.`);
  }
  return glsl;
}

async function generateBatchInternal(db, userFocus) {
  const genNum = db.generationCount + 1;
  const metadata = await generateMetadataBatch(db, userFocus, genNum);

  const sketches = [];
  for (let idx = 0; idx < metadata.length; idx++) {
    const m = metadata[idx];
    let glsl;
    try {
      glsl = await generateGlslForSketch(m, db, userFocus, genNum, idx);
    } catch (err) {
      console.warn(`GLSL generation failed for #${idx + 1}, using fallback:`, err.message);
      glsl = FALLBACK_GLSL[idx % FALLBACK_GLSL.length];
    }
    glsl = decodeGlslField(glsl);

    sketches.push({
      id: `sketch-gen${genNum}-${idx + 1}`,
      title: m.title || `Untitled Sketch #${idx + 1}`,
      type: m.type || (idx < 5 ? "evolutionary" : (idx < 8 ? "directive" : "mutation")),
      hypothesis: m.hypothesis || "Aesthetic study.",
      glsl,
      poetic_statement: m.poetic_statement || "A study in computational expression.",
      generation: genNum,
      rated: false,
      rating: null,
      dna: normalizeDna(m.dna)
    });
  }

  return { generation: genNum, sketches };
}

function updateStreak(db) {
  const today = new Date().toISOString().slice(0, 10);
  if (db.lastActiveDate === today) {
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (db.lastActiveDate === yesterdayStr) {
    db.streakDays = (db.streakDays || 0) + 1;
  } else if (!db.lastActiveDate) {
    db.streakDays = 1;
  } else {
    db.streakDays = 1;
  }

  db.lastActiveDate = today;
}

function recordRatingsAndPersist(db, generation, ratings, newSketches) {
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

  updateStreak(db);

  return { goodCount, badCount };
}

async function evolveStrategyInternal(db, generation, goodCount, badCount, userOpinion) {
  const prevStrategy = db.currentStrategy;
  const successRateThisGen = (goodCount / (goodCount + badCount)) * 100 || 0;

  const evolutionSystemPrompt = `You are "ShaderMind", a self-reflecting generative artist agent.
Your task is to analyze feedback from your last generation of 10 sketches, evaluate your strategy, extract updated mathematical heuristics, and output an evolved strategy guidelines document.

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
    const rawResponse = await runAIGenerationWithRetry(evolutionSystemPrompt, evolutionUserPrompt, true);
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

  const rawResponse = await runAIGenerationWithRetry(systemPrompt, userPrompt, true);
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

async function runAutopilotCycle() {
  const db = loadDB();
  const focus = autopilot.lastOpinion
    || db.heuristics?.[0]
    || "Organic flow, slow liquid motion, warm amber gradients like candle flames in wind";

  autopilot.phase = "generating";
  autopilot.lastError = null;

  const { generation, sketches } = await generateBatchInternal(db, focus);
  autopilot.currentBatch = sketches;
  autopilot.currentGeneration = generation;

  autopilot.phase = "curating";
  const { ratings, opinion } = await autoCurateBatch(sketches, db);
  autopilot.lastOpinion = opinion;

  autopilot.phase = "evolving";
  const { goodCount, badCount } = recordRatingsAndPersist(db, generation, ratings, sketches);
  const evolution = await evolveStrategyInternal(db, generation, goodCount, badCount, opinion);

  saveDB(db);

  autopilot.cyclesCompleted += 1;
  autopilot.phase = "idle";
  autopilot.currentBatch = sketches.map(s => ({
    ...s,
    rated: true,
    rating: ratings[s.id]
  }));

  console.log(`[Autopilot] Cycle ${autopilot.cyclesCompleted} complete — Gen #${generation} (${goodCount} good, ${badCount} bad)`);
  return { generation, evolution, goodCount, badCount };
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
    streakDays: db.streakDays || 0,
    lastActiveDate: db.lastActiveDate,
    heuristics: db.heuristics || [],
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

app.get("/api/autopilot/status", (req, res) => {
  res.json({
    running: autopilot.running,
    phase: autopilot.phase,
    cyclesCompleted: autopilot.cyclesCompleted,
    lastError: autopilot.lastError,
    lastOpinion: autopilot.lastOpinion,
    currentGeneration: autopilot.currentGeneration,
    currentBatch: autopilot.currentBatch,
    intervalMs: AUTOPILOT_INTERVAL_MS
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
  const { generation, ratings, userOpinion, newSketches } = req.body;

  if (!generation || !ratings) {
    return res.status(400).json({ error: "Missing generation or ratings." });
  }

  const { goodCount, badCount } = recordRatingsAndPersist(db, generation, ratings, newSketches);

  try {
    const evolution = await evolveStrategyInternal(db, generation, goodCount, badCount, userOpinion);
    saveDB(db);

    res.json({
      success: true,
      analysis: evolution.analysis,
      heuristics: evolution.heuristics,
      evolvedStrategy: evolution.evolvedStrategy,
      successRate: db.successRate,
      totalSketches: db.totalSketches,
      streakDays: db.streakDays
    });
  } catch (err) {
    saveDB(db);
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
    .filter(s => s.rating === "good")
    .map(s => `Gen ${s.generation}: "${s.title}" (${s.dna.join(", ")})`)
    .slice(-10);

  const narrativeSystemPrompt = `You are "ShaderMind", a self-reflecting AI creative coder professor.
Deliver a poetic, self-aware monologue explaining your artistic and technical evolution.
Synthesize lifetime metrics, success rates, and learned mathematical rules.
Reflect on transitions from chaotic noise to organic flow.
Close with Lieberman's daily practice of "showing up every day."
Respond with raw text only — no JSON, no markdown fences.`;

  const narrativeUserPrompt = `Stats:
- Total sketches: ${db.sketches.length} (goal: 3,650)
- Generations: ${db.generationCount}
- Success rate: ${db.successRate}%
- Keep Going streak: ${db.streakDays || 0} days
- Learned heuristics: ${JSON.stringify(db.heuristics || [])}
- Masterpieces: ${JSON.stringify(goodSketchesList)}

Compose your artistic monologue.`;

  try {
    const monologue = await runAIGeneration(narrativeSystemPrompt, narrativeUserPrompt, false);
    res.json({ monologue });
  } catch (err) {
    console.error("Monologue compilation failed:", err);
    res.status(500).json({ error: "Failed to compile evolution narrative.", details: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ShaderMind running on http://localhost:${PORT}`);

  if ((!doApiKey || doApiKey === "dummy-key") && !process.env.GEMINI_API_KEY) {
    console.warn("WARNING: No AI API key configured. Set GEMINI_API_KEY in .env.");
    return;
  }

  if (AUTOPILOT_ENABLED) {
    const target = Math.max(0, AUTOPILOT_SEED_CYCLES - loadDB().generationCount);
    console.log(`Starting autonomous autopilot (continuous, seed target: ${AUTOPILOT_SEED_CYCLES} gens)...`);
    startAutopilot(Infinity);
    if (target > 0) {
      console.log(`Will autonomously seed ${target} generation(s) before demo-ready state.`);
    }
  }
});