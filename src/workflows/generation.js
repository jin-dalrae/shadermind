// Cloudflare Workflow for batch generation.
// Triggered by POST /api/generate. Each step is a durable unit that
// can be retried independently. The 1-3 minute batch run is split into
// many small steps (one AI call per step) so each stays within limits.

import { WorkflowEntrypoint } from "cloudflare:workers";
import { callGemini } from "../gemini.js";
import { loadDB, saveDB } from "../storage.js";

const BATCH_SIZE_DEFAULT = 3;
const RETRY = { retries: { limit: 2, delay: "30 second", backoff: "exponential" } };

const SYSTEM_PROMPT = `You are ShaderMind, a GLSL ES 1.0 fragment shader artist.
Output a JSON array of exactly {N} distinctive compile-ready shaders.

Each item:
{
  "id": "sketch-gen{G}-{i}",
  "title": "short evocative title",
  "type": "evolutionary" | "directive" | "mutation",
  "hypothesis": "one-line artistic hypothesis",
  "dna": ["3-5 lowercase tags: math/color/motion words, no hashtags"],
  "glsl": "precision mediump float;\\nuniform float u_time;\\nuniform vec2 u_resolution;\\nuniform vec2 u_mouse;\\n\\n// ... your shader ...\\n\\nvoid main() { gl_FragColor = vec4(uv, 0.5+0.5*sin(u_time), 1.0); }"
}

Hard rules:
- WebGL 1.0 only (gl_FragColor, texture2D, no out vec4)
- Must compile (void main, gl_FragColor, balanced braces)
- Use u_time, u_resolution, u_mouse
- Under 55 lines of GLSL
- No lazy circle-on-black placeholders
- Use real math: FBM, polar UV, hash noise, domain warp, cosine palette
- Vary: motion speed, color temperature, complexity, symmetry

Output ONLY the JSON array. No markdown fences. No commentary.`;

export class GenerationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { genNum, focus, batchSize } = event.payload || {};
    const N = Number(batchSize) || BATCH_SIZE_DEFAULT;
    const gen = Number(genNum) || 0;
    const userFocus = focus || "";

    await step.do("mark-generating", RETRY, async () => {
      const db = await loadDB(env);
      db.autopilot = { ...(db.autopilot || {}), phase: "generating", currentGeneration: gen, lastStartedAt: new Date().toISOString() };
      await saveDB(env, db);
    });

    const focusBlock = userFocus ? `\n\nCurator focus for this batch: ${userFocus}` : "";
    const userPrompt = `Generation #${gen}. ${N} distinctive compile-ready shaders.${focusBlock}\n\nJSON array only.`;

    const planResult = await step.do("plan-and-generate-batch", { ...RETRY, timeout: "10 minutes" }, async () => {
      const t0 = Date.now();
      const result = await callGemini(env, `${SYSTEM_PROMPT.replace("{N}", String(N)).replace("{G}", String(gen))}\n\n${userPrompt}`, {
        temperature: 0.95,
        maxOutputTokens: 14000,
        responseMimeType: "application/json"
      });
      return { text: result.text, usage: result.usage, latencyMs: result.latencyMs, wallMs: Date.now() - t0 };
    });

    const sketches = await step.do("parse-and-save-batch", RETRY, async () => {
      const raw = planResult.text || "";
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        const fenceMatch = raw.match(/\[[\s\S]*\]/);
        if (fenceMatch) {
          try { parsed = JSON.parse(fenceMatch[0]); } catch (e2) { /* fall through */ }
        }
      }
      if (!Array.isArray(parsed)) {
        throw new Error("Failed to parse Gemini response as JSON array");
      }
      const now = new Date().toISOString();
      const cleaned = parsed.slice(0, N).map((s, i) => ({
        id: s.id || `sketch-gen${gen}-${i + 1}`,
        title: String(s.title || `Untitled ${i + 1}`).slice(0, 120),
        type: ["evolutionary", "directive", "mutation"].includes(s.type) ? s.type : "directive",
        hypothesis: String(s.hypothesis || "").slice(0, 500),
        dna: Array.isArray(s.dna) ? s.dna.slice(0, 6).map(t => String(t).toLowerCase().slice(0, 30)) : [],
        glsl: String(s.glsl || "").trim(),
        generation: gen,
        generationFocus: userFocus || null,
        rated: false,
        rating: null,
        dna: Array.isArray(s.dna) ? s.dna.slice(0, 6).map(t => String(t).toLowerCase().slice(0, 30)) : [],
        prompt: userPrompt,
        createdAt: now,
        provider: "gemini",
        model: env.AI_MODEL || "gemini-3.5-flash",
        inferenceTimestamp: now,
        compile: { success: null }
      }));

      const db = await loadDB(env);
      db.sketches = db.sketches || [];
      db.generationCount = Math.max(db.generationCount || 0, gen);
      db.totalSketches = Math.max(db.totalSketches || 0, db.sketches.length + cleaned.length);
      db.sketches = [...db.sketches, ...cleaned];
      db.activeBatch = cleaned.map(s => ({ id: s.id, title: s.title, type: s.type, hypothesis: s.hypothesis, generation: gen, generationFocus: userFocus, dna: s.dna, glsl: s.glsl }));
      db.autopilot = { ...(db.autopilot || {}), phase: "awaiting_human", currentGeneration: gen, awaitingHuman: true, currentBatch: db.activeBatch };
      await saveDB(env, db);
      return { saved: cleaned.length, total: db.sketches.length };
    });

    await step.do("mark-ready", RETRY, async () => {
      const db = await loadDB(env);
      db.autopilot = { ...(db.autopilot || {}), phase: "awaiting_human", lastCompletedAt: new Date().toISOString() };
      await saveDB(env, db);
    });

    return { gen, saved: sketches.saved, total: sketches.total, usage: planResult.usage, latencyMs: planResult.latencyMs };
  }
}
