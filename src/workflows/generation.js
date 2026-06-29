// Cloudflare Workflow for batch generation.
// Triggered by POST /api/generate. Each step is a durable unit that
// can be retried independently. The 1-3 minute batch run is split into
// many small steps (one AI call per step) so each stays within limits.
//
// The prompt is grounded in real math, color theory, motion theory,
// and composition theory — not a keyword list. The technique picker
// assigns a specific named technique to each of the 3 slots so the
// batch varies (not three "domain warp + symmetry" shaders).

import { WorkflowEntrypoint } from "cloudflare:workers";
import { callGemini } from "../gemini.js";
import { loadDB, saveDB } from "../storage.js";
import { MATH_COOKBOOK } from "../math-cookbook.js";
import { COLOR_THEORY_GUIDANCE } from "../color-theory.js";
import { MOTION_THEORY_GUIDANCE } from "../motion-theory.js";
import { COMPOSITION_THEORY } from "../composition.js";
import { pickTechniques, formatTechniqueBlock } from "../technique-picker.js";

const BATCH_SIZE_DEFAULT = 3;
const RETRY = { retries: { limit: 2, delay: "30 second", backoff: "exponential" } };
const SLOT_TYPES = ["evolutionary", "directive", "mutation"];

function buildSystemPrompt() {
  return `You are ShaderMind, a GLSL ES 1.0 fragment shader artist with deep grounding in mathematics, color theory, motion theory, and composition.

You write shaders that feel intentional, not improvised. Every choice — the math, the color palette, the motion speed, the framing — has a reason grounded in the theory below.

Output a JSON array of exactly {N} distinctive compile-ready shaders. Each item:
{
  "id": "sketch-gen{G}-{i}",
  "title": "short evocative title",
  "type": "evolutionary" | "directive" | "mutation",
  "hypothesis": "one-line artistic hypothesis grounded in the technique",
  "dna": ["3-5 lowercase tags: math-technique, color-family, motion-profile, composition"],
  "glsl": "precision mediump float;\\nuniform float u_time;\\nuniform vec2 u_resolution;\\nuniform vec2 u_mouse;\\n\\n// your shader\\n\\nvoid main() { gl_FragColor = vec4(...); }"
}

Hard rules:
- WebGL 1.0 only (gl_FragColor, texture2D, no out vec4, no texture())
- Must compile (void main, gl_FragColor, balanced braces and parens)
- Declare and use u_time, u_resolution, u_mouse
- Under 55 lines of GLSL
- No lazy circle-on-black placeholders
- Reference the math cookbook functions directly (copy them into your shader)
- Pick one named color palette and commit to it
- Use harmonic motion ratios, not random speeds
- Follow the composition rules for your slot

Output ONLY the JSON array. No markdown fences. No commentary.`;
}

function buildUserPrompt(gen, N, slotTechniques, db, userFocus) {
  const strategy = (db.currentStrategy || "").trim();
  const heuristics = (db.heuristics || []).slice(0, 4);

  const parts = [
    `Generation #${gen}. ${N} distinctive compile-ready shaders.`,
    userFocus ? `\nCurator focus for this batch: ${userFocus}` : "",
    strategy ? `\nCurrent strategy: ${strategy}` : "",
    heuristics.length ? `\nHeuristics:\n${heuristics.map(h => `- ${h}`).join("\n")}` : "",
    "\nThe following theory applies to every shader in this batch:",
    "\n## MATH COOKBOOK (copy these functions into your shaders)",
    MATH_COOKBOOK,
    "\n## COLOR THEORY",
    COLOR_THEORY_GUIDANCE,
    "\n## MOTION THEORY",
    MOTION_THEORY_GUIDANCE,
    "\n## COMPOSITION THEORY",
    COMPOSITION_THEORY,
    "\n## PER-SLOT TECHNIQUE CONSTRAINTS",
    "Each of the 3 slots has a different technique. Follow the constraints exactly.",
    slotTechniques.map(t => formatTechniqueBlock(t)).join("\n\n"),
    "\nGenerate one shader per slot, following each slot's constraints.",
    "Output JSON array only."
  ];
  return parts.filter(Boolean).join("\n");
}

export class GenerationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { genNum, focus, batchSize } = event.payload || {};
    const N = Math.min(10, Math.max(1, Number(batchSize) || BATCH_SIZE_DEFAULT));
    const gen = Number(genNum) || 0;
    const userFocus = String(focus || "").slice(0, 2000);

    const slotTypes = Array.from({ length: N }, (_, i) => SLOT_TYPES[i % SLOT_TYPES.length]);

    await step.do("mark-generating", RETRY, async () => {
      const db = await loadDB(env);
      db.autopilot = { ...(db.autopilot || {}), phase: "generating", currentGeneration: gen, lastStartedAt: new Date().toISOString() };
      await saveDB(env, db);
    });

    const slotTechniques = pickTechniques(N, slotTypes);

    const planResult = await step.do("plan-and-generate-batch", { ...RETRY, timeout: "10 minutes" }, async () => {
      const t0 = Date.now();
      const db = await loadDB(env);
      const systemPrompt = buildSystemPrompt().replace("{N}", String(N)).replace("{G}", String(gen));
      const userPrompt = buildUserPrompt(gen, N, slotTechniques, db, userFocus);
      const result = await callGemini(env, systemPrompt + "\n\n" + userPrompt, {
        temperature: 0.92,
        maxOutputTokens: 16000,
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
      const cleaned = parsed.slice(0, N).map((s, i) => {
        const technique = slotTechniques[i] || {};
        return {
          id: s.id || `sketch-gen${gen}-${i + 1}`,
          title: String(s.title || `Untitled ${i + 1}`).slice(0, 120),
          type: ["evolutionary", "directive", "mutation"].includes(s.type) ? s.type : (slotTypes[i] || "directive"),
          hypothesis: String(s.hypothesis || "").slice(0, 500),
          dna: Array.isArray(s.dna) ? s.dna.slice(0, 6).map(t => String(t).toLowerCase().slice(0, 30)) : [],
          glsl: String(s.glsl || "").trim(),
          generation: gen,
          generationFocus: userFocus || null,
          technique: technique.id || null,
          techniqueName: technique.name || null,
          rated: false,
          rating: null,
          prompt: buildUserPrompt(gen, N, slotTechniques, { currentStrategy: "", heuristics: [] }, userFocus).slice(0, 8000),
          createdAt: now,
          provider: "gemini",
          model: env.AI_MODEL || "gemini-3.5-flash",
          inferenceTimestamp: now,
          inferenceUsage: planResult.usage,
          inferenceLatencyMs: planResult.latencyMs,
          compile: { success: null }
        };
      });

      const db = await loadDB(env);
      db.sketches = db.sketches || [];
      db.generationCount = Math.max(db.generationCount || 0, gen);
      db.totalSketches = Math.max(db.totalSketches || 0, db.sketches.length + cleaned.length);
      db.sketches = [...db.sketches, ...cleaned];
      db.activeBatch = cleaned.map(s => ({ id: s.id, title: s.title, type: s.type, hypothesis: s.hypothesis, generation: gen, generationFocus: userFocus, dna: s.dna, glsl: s.glsl, technique: s.technique, techniqueName: s.techniqueName }));
      db.autopilot = { ...(db.autopilot || {}), phase: "awaiting_human", currentGeneration: gen, awaitingHuman: true, currentBatch: db.activeBatch, lastSlotTechniques: slotTechniques };
      await saveDB(env, db);
      return { saved: cleaned.length, total: db.sketches.length };
    });

    await step.do("mark-ready", RETRY, async () => {
      const db = await loadDB(env);
      db.autopilot = { ...(db.autopilot || {}), phase: "awaiting_human", lastCompletedAt: new Date().toISOString() };
      await saveDB(env, db);
    });

    return { gen, saved: sketches.saved, total: sketches.total, slotTechniques: slotTechniques.map(t => t.id), usage: planResult.usage, latencyMs: planResult.latencyMs };
  }
}
