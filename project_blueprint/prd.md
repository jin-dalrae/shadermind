# Product Requirement Document (PRD): ShaderMind

## Project Name: ShaderMind
### *An Autonomous Research Prototype on Machine Creativity*

> **Document status:** Updated 2026-06-28 to reflect the codebase as shipped on `LEARNING` branch. Earlier revisions of this PRD assumed a Gemini-primary, autonomous-by-default, 10-shader/5-3-2 design. The implementation evolved toward a multi-model DigitalOcean primary pipeline with optional Gemini fallback, a human-gated 1–5 rating loop, and a configurable batch size. This revision aligns the spec to the running system.

---

## 1. Executive Summary

ShaderMind is an **agentic drawing tool** for shader art: the agent writes GLSL; the **user** steers with 1–5 ratings and short notes, and over everyday sketches **becomes the artist**. It learns the user's taste — not a global average — and nudges each batch a small step from the last toward what they love and wanted to see.

Rather than prompt-and-forget generation, ShaderMind builds preference memory, a strategy genome, and a curated pattern library from human curation. The visible output is live shader art; the real artifact is the user's sharpening eye and the agent's learned model of their taste — inspectable as text, not buried in a black-box reward model.

### Research Grounding — PLUS (arXiv:2507.13579)

ShaderMind is conceptually aligned with **Preference Learning Using Summarization (PLUS)** ([Nam et al., 2025/2026](https://arxiv.org/abs/2507.13579)):

| PLUS (personalized RLHF) | ShaderMind (creative continual learning) |
|---|---|
| Text summaries of user preferences | **Heuristic memory + strategy genome + `preferenceMemory`** |
| Summaries condition a reward model | Summaries condition **multi-model shader prompts** |
| Online co-adaptation (summarizer ↔ reward) | Online co-adaptation (curation ↔ critique ↔ reflection ↔ next batch) |
| Interpretable user representation | Inspectable heuristics, timeline, reflection logs, per-shetch critique |
| Rejects one-size-fits-all Bradley-Terry reward | Rejects static prompt — taste **evolves per generation** |

PLUS shows that compressing preference history into explicit, readable summaries outperforms monolithic reward models. ShaderMind applies the same insight to **generative art**: the agent's "user model" is its evolving aesthetic manifesto, plus a curated pattern library that improves with each rating.

### Hackathon Strategic Alignment

* **Theme:** **Continual Learning** — the system improves *how* it generates, not just *what*, through a self-reflective policy loop with three memory tiers.
* **DigitalOcean deployment:** Express server on `8080`, deployable via App Platform, Docker, or droplet. Inference uses DO model pools by default.
* **Gemini integration:** Optional fallback when `ALLOW_GEMINI_FALLBACK=true` and `GEMINI_API_KEY` is set. A separate LiveKit agent (`agent/` subdir) uses Gemini for the voice curator path.

---

## 2. Core Concept

**Framing:** Research prototype on machine creativity — an AI that develops aesthetic judgment, artistic heuristics, and self-reflective generation strategies.

**Lieberman spirit:** Learn from everyday sketches — each generation changes a bit from the last approved work, steering toward what the curator loves and wanted to see ([essay](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d)). The 3,650 count is a *north-star metaphor* for that arc — not a calendar, streak tracker, or day counter.

**Rating contract:** Every shader in a batch receives a **1–5 rating** before the next batch can start. Legacy `good`/`bad` archive records are mapped to 5 and 1 for backward compatibility. Skipping or defaulting to a neutral value is not allowed — unrated shaders block the loop.

**Learning mode:** The autopilot runs in one of three modes (env: `LEARNING_MODE`):

| Mode | Behavior | Use case |
|---|---|---|
| `human` | Pause at `awaiting_human` until `POST /api/feedback` with all 1–5 ratings | Hackathon demo, supervised personalization |
| `autonomous` | Gemini self-curates each batch (`autoCurateBatch`) before evolution | Overnight / unattended runs |
| `hybrid` | Wait for human; auto-curate after `HYBRID_TIMEOUT_MS` (default 5 min) | Production fallback when humans go idle |

**Generation mode:** The pipeline has two implementations (env: `GENERATION_MODE`):

| Mode | Pipeline | Calls per batch |
|---|---|---|
| `fast` (default) | One multi-shader inference call + per-shader repair pool | 1 call + up to 2×N repair calls |
| `staged` | One planning call + N parallel GLSL calls + similarity retry | 1 + N + repair calls |

Batch size is controlled by `BATCH_SIZE` (default 3). Distribution is computed by `getBatchDistribution(size) = floor(0.5) / floor(0.3) / remainder` — at `BATCH_SIZE=3` this yields 1 evolutionary / 1 directive / 1 mutation; at `BATCH_SIZE=10` it yields the canonical 5-3-2.

---

## 3. System Views (Current Implementation)

The app is a single scrolling experience with four primary regions, plus three backend surfaces exposed via API and a voice interface.

### Studio (Gallery)
* **Full-width shader grid** — `BATCH_SIZE` live WebGL canvases per batch (default 3) using `u_time`, `u_resolution`, `u_mouse` uniforms.
* **Shared WebGL renderer** (`public/shared-grid-renderer.js`) — one offscreen WebGL context, pixel copy via `readPixels` + `putImageData` (no `drawImage` from WebGL canvas). Per-cell `ResizeObserver` triggers repaint when layout settles.
* **Cell click → fullscreen `<dialog>`** with live canvas (separate context via `public/shader-renderer.js` + `webgl-queue.js`) and the GLSL source.
* **Compile evidence** — each cell reports compile success/failure to `POST /api/sketches/:id/compile-result` during curation. Failed-compile shaders are excluded from positive example retrieval even when rated 4–5.
* **Archive fallback** — when autopilot is idle and no live batch exists, the Studio shows the latest saved batch from DB, labelled `Gen N · saved batch`.

### Latest Reflection
* Most recent self-criticism from the policy update step (after the last batch was rated and `evolveStrategyInternal` completed).
* Collapsible **active strategy genome** — the PLUS-analogue preference summary, sanitized against a banned-jargon blocklist (no "emergence", "cognition", "systemic", "distributed intelligence", etc.).
* Collapsible **preference memory** — top prefer/avoid rules with average rating, support, and confidence.

### Evolution Timeline
* Real milestones only — one entry per generation with strategy notes, curator source (`human` / `autonomous`), and rating distribution.
* No placeholder/fake epochs. Strategy `consolidation` rolls the last `CONSOLIDATION_EVERY_N` generations (default 25) into a compressed semantic-memory rollup.

### Mind
* **Learned heuristics** with rating-summary context (not invented approval rates — only rating counts and averages from real evidence).
* **Reflection log** — chronological strategy mutations per generation.
* **Shader pattern library** — `GET /api/shader-library` exposes a curated catalog of patterns (FBM, polar, ripple, mouse-reactive flow, etc.) ranked by usage × average rating. Top-rated and avoid-patterns surface here.
* **Preference memory (raw)** — `prefer[]` / `avoid[]` rules with `support`, `confidence`, `averageRating`, `approval`.
* **Explain artistic evolution** — Gemini-generated monologue over lifetime metrics (`GET /api/narrative`).

### Voice Curator (LiveKit)
* **Talk to ShaderMind** button in Studio opens a LiveKit room named `shadermind-gen-{N}`.
* The agent (`agent/` subdir, sibling project) joins as `shadermind-curator`, holds a Gemini conversation about the current batch, and submits ratings on the user's behalf via the same `POST /api/feedback` endpoint.
* Token issuance: `POST /api/livekit/token` returns a participant JWT and the configured LiveKit URL.
* TTS via **MiniMax** (`MINIMAX_API_KEY`, default model `speech-02-turbo`).

### Backend Surfaces (not in UI)
* `GET /api/shader-library` — pattern catalog with rating-aware ranking.
* `GET /api/memory/rollup` — latest consolidated semantic memory.
* `POST /api/memory/consolidate` — manual consolidation trigger.
* `POST /api/livekit/token` — voice curator session bootstrap.

---

## 4. Continual Learning Mechanisms

```
                     ┌──────────────────────────────────────┐
                     │   Working Memory (always injected)   │
                     │   • currentStrategy (≤120 words)     │
                     │   • top heuristics (≤4)              │
                     │   • preferenceSummary (prefer/avoid) │
                     │   • pattern library block            │
                     │   • LearnOpenGL + tutorial curricula │
                     │   • remix seeds (title + DNA)        │
                     │   • curator focus (lastHumanOpinion) │
                     └──────────────┬───────────────────────┘
                                    │
   ┌────────────┐   infer (DO/Gemini)   ┌──────────────┐
   │  autopilot │ ────────────────────► │  validation  │ ──► FALLBACK_GLSL if invalid
   │  generate  │                       │  + repair    │
   └────┬───────┘                       │  + similarity│
        │                               │  + novelty   │
        │                               └──────────────┘
        ▼
   ┌────────────┐  client compile        ┌─────────────────┐
   │  awaiting  │ ──────reports─────────►│   Studio batch  │
   │  _human    │                        │   (10 canvases) │
   └────┬───────┘                        └─────────────────┘
        │ POST /api/feedback (1–5 ratings, opinion, compileResults)
        ▼
   ┌────────────────────────────────────────────────────┐
   │            Evolution pipeline (async)               │
   │  1. critiqueRatedSketches  (Gemini, batched)        │
   │  2. buildPreferenceMemory  (weighted by source)     │
   │  3. evolveStrategyInternal (sanitize banned jargon) │
   │  4. maybeConsolidateMemory (every N gens)           │
   └────────────────────────┬───────────────────────────┘
                            │
                            ▼
                  next batch reads updated memory
```

### Four learning layers

| Layer | Where it lives | Update trigger |
|---|---|---|
| **Working memory** | `currentStrategy`, `heuristics[]`, `preferenceMemory`, pattern library rank | Every evolution cycle |
| **Episodic memory** | `statistics.generations[]`, `strategyTimeline[]` | Every feedback submission |
| **Semantic memory** | `memoryRollups[]` | `maybeConsolidateMemory` every `CONSOLIDATION_EVERY_N` gens (default 25) |
| **Archive** | `sketches[]` (full GLSL + DNA + codeFeatures + critique + learningContext) | Append-only after rating |

### Code-aware learning (PLUS analogue, in code)

1. **Heuristic memory (PLUS analogue):** Sanitized, human-readable rules derived from `prefer`/`avoid` evidence with average rating, support, and confidence.
2. **Strategy genome evolution:** `currentStrategy` rewritten each batch — max 120 words, no banned jargon, with a retry loop that re-invokes the model if jargon slips through.
3. **Hypothesis-driven mutation:** Mutation shaders ship with an explicit, inspectable hypothesis string in their metadata.
4. **Preference memory (v1):** Weighted by `ratingSource` — `explicit` (1.0), `autonomous` (0.7), `defaulted` (0.35). Compile-failed sketches are excluded from positive evidence.
5. **Code-aware retrieval:** `selectLearningExamples` ranks candidates by tag relevance (40%), technique overlap (20%), curator confidence (15%), recency (15%), compile confidence (10%), minus a cooldown for overused examples. Diversity via maximal marginal relevance.
6. **Similarity guard:** `findMostSimilarShader` (Jaccard 5-shingle over normalized tokens) flags results at or above `SHADER_SIMILARITY_THRESHOLD` (default 0.82) for novelty retry. Compile-failed candidates and same-generation sketches are excluded from example retrieval.
7. **Per-sketch critique:** Batched Gemini call after every rated batch returns strengths / weaknesses / reusablePatterns / avoidPatterns per sketch; failures do not block feedback persistence.
8. **Shared studio coordination (multi-instance):** `generationLock` in MongoDB prevents multiple instances from generating the same generation. Studio state (`pendingBatch`) is shared so dev and prod UI show the same batch.
9. **Autonomous autopilot:** Server-side loop — generate → curate (human or auto) → critique → preference memory → evolve → wait → repeat.

---

## 5. Technical Architecture

| Layer | Stack |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, editorial gallery UI, shared WebGL grid renderer, dialog renderer, WebGL slot queue |
| Backend | Node.js + Express, ES modules |
| Storage | **MongoDB Atlas** primary when `MONGODB_URI` is set (fails fast — no JSON fallback in prod); **SQLite** + JSON mirror optional for local dev (`USE_SQLITE=true`); **JSON-only** when neither is configured |
| Inference (primary) | **DigitalOcean Inference** (`https://inference.do-ai.run/v1`) — per-task model pools |
| Inference (fallback) | **Google Gemini** REST API (`gemini-3.5-flash` default for both planning and GLSL), opt-in via `ALLOW_GEMINI_FALLBACK=true` |
| Voice | **LiveKit** server SDK + LiveKit agent in `agent/` subdir (Gemini conversation + MiniMax TTS) |
| Deploy | DigitalOcean App Platform (`8080`) / Docker |

### Per-task model pools (DigitalOcean primary)

| Task | Env override | Default pool |
|---|---|---|
| GLSL | `DO_MODELS_GLSL` | `qwen3-coder-flash → glm-5.2 → llama3.3-70b-instruct` |
| Planning | `DO_MODELS_PLANNING` | `qwen3-coder-flash → llama3.3-70b-instruct → mistral-3-14B` |
| Evolution | `DO_MODELS_EVOLUTION` | `deepseek-4-flash → llama-4-maverick → llama3.3-70b-instruct` |
| Curation | `DO_MODELS_CURATION` | `llama3.3-70b-instruct → mistral-3-14B → deepseek-4-flash` |
| Narrative | `DO_MODELS_NARRATIVE` | `llama-4-maverick → deepseek-4-flash → llama3.3-70b-instruct` |
| Consolidation | `DO_MODELS_CONSOLIDATION` | `deepseek-4-flash → llama3.3-70b-instruct` |
| Routing | `DO_INFERENCE_ROUTER` | All tasks route through `router:{name}` if set |

Each pool is tried in order, with `retriesPerModel + 1` attempts before falling through. The first model is also used for the "fast" single-call batch path (`getTaskModels("glsl").slice(0, 1)`).

### Gemini fallback (opt-in)

When `ALLOW_GEMINI_FALLBACK=true` AND `GEMINI_API_KEY` is set, every exhausted model in the DO pool falls back to Gemini REST at `generativelanguage.googleapis.com/v1beta`. The Gemini model is configurable: `GEMINI_MODEL` (default `gemini-3.5-flash`) for planning/curation/evolution/narrative; `GEMINI_GLSL_MODEL` (default same) for GLSL. JSON mode is enabled for structured-output tasks.

### Generation pipeline (current — fast mode default)

```
1. Plan + write (single inference call)
   System prompt assembles:
     - currentStrategy (sanitized, ≤500 chars in prompt)
     - top 3 heuristics
     - preferenceSummary (top 5 prefer, top 3 avoid)
     - critiqueBlock (recent strengths/weaknesses from prior batch)
     - LearnOpenGL discipline block
     - shader-tutorial block (curriculum-sourced)
     - MATH_COOKBOOK_COMPACT (technique reminders)
     - DNA prompt rule (2–4 lowercase tags, no fluff words)
     - pattern library block (ranked patterns assigned to slots)
     - remix seeds (last 3 rated ≥4 — title + DNA only)
     - userFocus / lastHumanOpinion
   Returns JSON array of BATCH_SIZE objects with: title, type, hypothesis,
   dna, glsl (raw source with \n, not base64), poetic_statement: "".

2. Parallel validation pool (concurrency = GLSL_CONCURRENCY)
   For each shader:
     a. decodeGlslField (strip fences, sanitize)
     b. validateGlsl (length, void main, gl_FragColor, ES 1.0 syntax,
        banned patterns, low-effort detector)
     c. If invalid → up to 2× repair passes via generateGlslForSketch()
        with repair hint appended to hypothesis
     d. findMostSimilarShader → if similarity ≥ threshold, novelty retry
     e. Extract codeFeatures (techniques, motion, composition, palette,
        complexity) via regex; deterministic
     f. detectPatternIds via lib/shader-library
     g. If still invalid after all retries → FALLBACK_GLSL template

3. Persist sketches
   Each sketch records: id, title, type, hypothesis, glsl, generation,
   dna, codeFeatures, patternIds, learningContext (exampleIds,
   retrievalScores, contextCharacters, similarityScore, similarityWarning,
   preferenceMemoryVersion), compile: { success: null, error: null,
   reportedAt: null }, critique: null, rating: null, rated: false.

4. Save pendingBatch to storage (shared Mongo for multi-instance visibility)
```

### Continual learning pipeline (after feedback)

```
1. recordRatingsAndPersist(db, generation, ratings, newSketches, ...)
   - Stores 1–5 rating + ratingSource (explicit | defaulted | autonomous)
   - Normalizes compile result (success / error / reportedAt)
   - Computes successRate, averageRating, popularTags
   - Increments learningUseCount on each example that influenced this sketch

2. critiqueRatedSketches(db, generation)
   - One batched Gemini call returns strengths/weaknesses/reusablePatterns
     /avoidPatterns per sketch
   - Persisted to sketch.critique; failure does not abort the loop

3. buildPreferenceMemory(db.sketches, db.preferenceMemory)
   - Iterates all rated sketches, weights by ratingSource
   - Builds learningLabels (dna + extracted code features)
   - Aggregates evidence; emits top 8 prefer rules (avg ≥4) and top 6
     avoid rules (avg ≤2)
   - Increments version only when prefer/avoid sets change

4. evolveStrategyInternal(db, generation, ratingSummary, userOpinion)
   - Sends Gemini: previous strategy + rating summary + preferenceSummary
     + critiqueBlock
   - Expected JSON: { analysis, heuristics[≤4], evolvedStrategy[≤120 words] }
   - sanitizeEvolvedStrategy strips banned jargon (STRATEGY_BANNED_RE);
     on failure, retries once, then keeps the prior strategy
   - Pushes a strategyTimeline entry with curatorSource

5. maybeConsolidateMemory(db)
   - Every CONSOLIDATION_EVERY_N generations (default 25)
   - Builds a memory rollup via Gemini (PLUS-style compression)
   - Replaces stale heuristics if rollup provides them
   - Updates db.lastConsolidationGen

6. saveDB(db) — applies to active storage (Mongo / SQLite / JSON)
```

### LiveKit voice curator

* `POST /api/livekit/token` issues a participant JWT for room `shadermind-gen-{N}`.
* `agent/` (sibling project) hosts the `shadermind-curator` agent. It:
  * Connects to the same room via LiveKit
  * Holds a Gemini conversation about the current batch's titles, DNA, and hypothesis strings
  * Submits 1–5 ratings and a free-form opinion via `POST /api/feedback`
  * Speaks via **MiniMax TTS** (`MINIMAX_API_KEY`, `speech-02-turbo`)
* Configuration: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME`, `SHADERMIND_PUBLIC_URL`, `SHADERMIND_API_URL`.
* Disabled silently when any required LiveKit env var is missing.

### Out of scope

* Vision / screenshot analysis at runtime (shader evaluation is text-based via code features + critique).
* Multi-user accounts (single-user prototype).
* Local ML training (Gemini heuristic mapping instead).
* Calendar / streak / day tracking (the 3,650 count is a metaphor, not a timer).

---

## 6. Learning Surfaces (feature catalog)

### 6.1 Code-aware retrieval — `lib/learning/retrieval.js`

* Positive candidates must have rating ≥ 4, `compile.success !== false`, contain `gl_FragColor`, and be from a prior generation.
* Ranking weights: 40% tag / 20% technique / 15% curator confidence / 15% recency / 10% compile, minus cooldown.
* Diversity: maximal marginal relevance so selected examples differ from each other.
* Per-slot example budget: evolutionary = 2, directive = 1, mutation = 0 (no raw examples — explore only).

### 6.2 Preference memory — `lib/learning/memory.js`

* `version`, `updatedAtGeneration`, `prefer[]`, `avoid[]` at DB root.
* Each rule: `{ rule, support, confidence, approval, averageRating }`.
* Source-weighted (explicit > autonomous > defaulted) so the same 4-star rating from a one-tap default counts less than an actively clicked 4.
* Compile-failed sketches are excluded from positive evidence even when rated 4–5.

### 6.3 Compile evidence — `POST /api/sketches/:id/compile-result`

* Browser-side compile success/failure reported during curation.
* Stored as `sketch.compile = { success, error, reportedAt }`.
* Excluded from positive example retrieval; informs `compile.success === false` filter.

### 6.4 Per-sketch critique — `lib/learning/critique.js`

* Batched Gemini call after each rated batch.
* Returns `strengths[]`, `weaknesses[]`, `reusablePatterns[]`, `avoidPatterns[]` per sketch.
* Critique-only patterns become evidence labels (`reuse:`, `avoid:`) that feed `buildPreferenceMemory` on the next cycle.

### 6.5 Similarity guard — `lib/learning/similarity.js`

* Normalize GLSL (strip comments, replace numeric tokens with `#`, collapse whitespace).
* Tokenize to 5-shingles (alphabetic + numeric + operators).
* Jaccard similarity; flag results ≥ `SHADER_SIMILARITY_THRESHOLD` (default 0.82) for novelty retry.

### 6.6 Strategy sanitizer — `lib/learning/strategy.js`

* `STRATEGY_BANNED_RE` blocks emergence-jargon vocabulary: systemic, cognition, emergence, distributed intelligence, heuristic, evolutionary, novelty, pioneering, coherence, etc.
* `sanitizeEvolvedStrategy` strips banned words, caps at 120 words and 700 storage chars (500 in prompt).
* `validateStrategyOutput` rejects outputs that exceed limits or contain banned words; the evolve loop retries once before falling back to the prior strategy.

### 6.7 Shader pattern library — `lib/shader-library/`

* Curated catalog of reusable patterns (FBM noise, polar coords, ripple, mouse-reactive flow, etc.) with category, tags, and source attribution.
* `selectPatternsForBatch` assigns patterns per slot type using weighted scoring against user focus + heuristics + popularity.
* `rankPatterns` orders the catalog by usage × average rating.
* Surfaced via `GET /api/shader-library` and `/api/state.patternLibrary`.

### 6.8 Curriculum injection

* **LearnOpenGL** (`lib/learnopengl/`) injects "LearnOpenGL discipline: linear lighting math, then gamma once at end" into every GLSL prompt.
* **Shader tutorial** (`lib/shader-tutorial/`) adds another textbook prompt block, capped per request via `curriculumCount`.
* Both are deterministic — same focus string produces the same curriculum block, no AI call.

### 6.9 Voice curator — see §5 LiveKit voice curator.

---

## 7. Success Metrics & Demo Proof

* **Visual evolution** — shader quality and coherence improve across generations; success rate trends upward over rolling windows.
* **Interpretable preference model** — judges can read heuristics, strategy genome, and `preferenceMemory.prefer[]` / `avoid[]` (PLUS-style transparency).
* **Self-correction** — next batch visibly shifts after rejection patterns (e.g. less high-frequency noise after avoid rule emerges).
* **Code-aware inheritance** — evolutionary slots reference up to 2 high-rated examples via budgeted GLSL injection; remix seeds appear in fast mode as title + DNA hints.
* **Narrative depth** — "Explain artistic evolution" monologue synthesizes the arc convincingly.
* **Multi-model inference log** — boot log lists DO task pools and Gemini fallback config so judges see the inference chain.
* **Shared studio proof** — `pendingBatch` round-trips through MongoDB so a deployed instance and a local dev instance show the same Studio state.

---

## 8. Open Issues

| Priority | Issue | Where |
|---|---|---|
| **High** | Chrome grid still renders black cells despite the shared renderer rewrite (works in Cursor browser, fails in Chrome incl. incognito + cache-bust `?v=5`) | `public/shared-grid-renderer.js` |
| **Medium** | `currentStrategy` baseline contains banned jargon ("emergent", "systemic", "distributed intelligence") — `sanitizeEvolvedStrategy` only runs on new evolution output | `database.json` (seed), `lib/learning/strategy.js` |
| **Medium** | Two `memory.js` files overlap (`lib/memory.js` vs `lib/learning/memory.js`); `buildRemixSection` still called from `generateMetadataBatch` | `server.js:532`, `lib/memory.js:24` |
| **Medium** | `server.js` is 2,274 lines — autopilot + generation + evolution + feedback + all API routes in one file | `server.js` |
| **Medium** | Dead `buildGenerationPrompts()` carries prompt text referencing 10-shader / 5-3-2 distribution that contradicts the default `BATCH_SIZE=3` | `server.js:309-359` |
| **Low** | `fallbackGeneratedSketch` hardcodes `preferenceMemoryVersion: 0` | `server.js:587` |
| **Low** | Docs (`AGENTS.md`, `prd.md`) drifted from runtime — AI provider story, required key, test count, batch size; revised in this PRD revision | `AGENTS.md`, this file |

---

## 9. References

* Nam, H., Wan, Y., Liu, M., Ahnn, P., Lian, J., & Jaques, N. (2025/2026). *Learning to summarize user information for personalized reinforcement learning from human feedback.* arXiv:2507.13579. https://arxiv.org/abs/2507.13579
* Lieberman, Z. — [*I spent 10 years making a sketch in code every day*](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d) (metaphorical framing for 3,650 sketch goal)
* DigitalOcean Inference API — https://docs.digitalocean.com/products/gradient-ai-platform/how-to/use-serverless-inference/
* Google Gemini REST API — https://ai.google.dev/gemini-api/docs
* LiveKit Agents — https://docs.livekit.io/agents/