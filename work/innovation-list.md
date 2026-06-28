# ShaderMind Innovation List

> **Status:** Living backlog for the `LEARNING` branch and beyond. Updated 2026-06-28.
> **Source:** Innovations surfaced during the PRD / pitch / README alignment pass, plus open issues captured in `prd.md §8 Open Issues`.

This document captures what's already shipped (and worth documenting), what's high-leverage to do next, and what the longer-term architectural cleanups look like. Each item is tagged with **impact** (high / medium / low) and **effort** (S = <1h, M = half-day, L = 1+ day) so it can be triaged.

---

## 1. Shipped Innovations (already in code, now documented)

These landed during the LEARNING branch and were just surfaced into PRD / pitch / README. **No action needed** — celebrating them so they don't get lost.

| Innovation | Where it lives | Doc reference |
|---|---|---|
| **1–5 human rating** with required contract (no defaults to neutral) | `server.js` `recordRatingsAndPersist`, `public/app.js` | prd §2, prd §6.1 |
| **Code-aware retrieval** with weighted scoring (40/20/15/15/10) + MMR diversity + cooldown | `lib/learning/retrieval.js` | prd §6.1, README "Code-aware learning" |
| **`preferenceMemory`** with rating-source weighting (explicit 1.0, autonomous 0.7, defaulted 0.35) | `lib/learning/memory.js` | prd §6.2 |
| **Similarity guard** (Jaccard 5-shingle, 0.82 threshold, novelty retry) | `lib/learning/similarity.js` | prd §6.5 |
| **Strategy sanitizer + banned jargon blocklist** | `lib/learning/strategy.js` | prd §6.6 |
| **Per-shetch critique** (batched Gemini call, failures don't abort loop) | `lib/learning/critique.js`, `server.js` `critiqueRatedSketches` | prd §6.4 |
| **Compile evidence loop** — browser reports compile success/failure, excluded from positive retrieval | `POST /api/sketches/:id/compile-result`, `public/shader-renderer.js` | prd §6.3, README "Validation pipeline" |
| **Curated pattern library** with rating × usage ranking | `lib/shader-library/`, `/api/shader-library` | prd §6.7, README |
| **LearnOpenGL + shader-tutorial curriculum injection** | `lib/learnopengl/`, `lib/shader-tutorial/` | prd §6.8, README |
| **LiveKit voice curator** with MiniMax TTS — "Talk to ShaderMind" button | `lib/livekit.js`, `public/voice-curator.js`, `agent/` | prd §3, prd §5 LiveKit, README |
| **Multi-instance coordination** via `generationLock` and shared `pendingBatch` | `storage/index.js`, `storage/mongo-storage.js` | prd §5 Storage, README Storage backends |
| **3-tier storage factory** (MongoDB fail-fast → SQLite + JSON mirror → JSON-only) | `storage/index.js` | prd §5 Storage, README |
| **`LEARNING_MODE`** (human / autonomous / hybrid) | `server.js` `waitForHumanOrTimeout` | prd §2, README |
| **`GENERATION_MODE`** (fast / staged) | `server.js` `generateBatchInternal` | prd §2, README |
| **Shared WebGL grid renderer** with `readPixels` blit (Chrome-safe in principle) | `public/shared-grid-renderer.js` | prd §3, README |
| **Claude Opus 4.8 via DigitalOcean Inference** as the default model across all six per-task pools (planning, glsl, evolution, curation, narrative, consolidation); Gemini 3.5 Flash opt-in fallback when `ALLOW_GEMINI_FALLBACK=true` | `lib/ai.js` `TASK_MODELS`, `.env.example` | prd §5 AI provider, README AI section |

---

## 2. High-impact next steps

These are the items that move the product meaningfully forward with low risk. Each can be tackled in an afternoon or less.

### 2.1 Sanitize legacy `currentStrategy` in `database.json` (run once)
- **Impact:** High — the running DB has `currentStrategy` containing banned words ("pioneering", "self-organizing", "emergent", "systemic", "distributed intelligence", "cognition"). The new sanitizer is in the LEARNING branch path but legacy data pre-dates it. A judge reading `/api/state` would see banned words despite the validation claim.
- **Effort:** S — single script using existing `sanitizeEvolvedStrategy` + `sanitizeHeuristics`.
- **Deliverable:** `scripts/sanitize-strategy.js` — reads `database.json`, sanitizes `currentStrategy` and `heuristics[]`, writes back. Logs removed banned words. Idempotent. Already in this PR.

### 2.2 Delete dead `buildGenerationPrompts()` from `server.js`
- **Impact:** Medium — removes 50+ lines of dead code whose prompt references a 10-shader / 5-3-2 distribution that contradicts the default `BATCH_SIZE=3`. A grep `buildGenerationPrompts` shows it defined but never called.
- **Effort:** S — straight deletion.
- **Risk:** Zero (never invoked).
- **Status:** Done in this PR.

### 2.3 Regression test for strategy sanitizer
- **Impact:** Medium — locks the sanitizer's contract. The current `validateStrategyOutput` checks banned-word presence but never tests the boundary conditions (mixed content, oversized input, all-banned input).
- **Effort:** S — fixture-driven test cases.
- **Deliverable:** `test/strategy.test.js` asserting: (a) banned words removed, (b) sentence-drop when fully banned, (c) word cap at 120, (d) char cap at 700, (e) heuristics sanitize preserves content where possible.
- **Status:** Done in this PR.

### 2.4 Replace `buildRemixSection` with `selectLearningExamples` in `generateMetadataBatch`
- **Impact:** Medium — `buildRemixSection` (lib/memory.js:24) is still injected into metadata planning (server.js:532). The new `selectLearningExamples` does the same job with scoring, MMR, cooldown. Staging migration was done for `generateGlslForSketch` but missed here.
- **Effort:** S — swap one function call.
- **Risk:** Low — semantically equivalent output, possibly tighter.

### 2.5 Wire `assembleWorkingMemory.remixSeeds` to include truncated GLSL (40 lines)
- **Impact:** Medium — fast mode currently sends only title + DNA for remix seeds. Staged mode injects full 80-line parent. Lifting fast-mode to ~40 lines would improve inheritance without changing fast-mode's call count.
- **Effort:** S — change `lib/memory.js` to include truncated `glsl` in remixSeeds.
- **Risk:** Low — slightly longer prompts, same retry/fallback paths.

### 2.6 Loosen `SHADER_SIMILARITY_THRESHOLD` from 0.82 → 0.92
- **Impact:** High — current 0.82 actively punishes inheritance. "Change EXACTLY ONE thing" evolutionary prompts frequently score above 0.82 and get force-rewritten into something less similar to the parent. The system fights itself.
- **Effort:** S — one env var default change.
- **Risk:** Low — at 0.92, only near-duplicate code triggers novelty retry. Document the rationale.
- **Suggested companion:** raise the threshold only for slots that have a picked remix parent (`pickRemixParent` → skip similarity check against that specific parent).

### 2.7 Add visible debug overlay to grid cells when shader fails
- **Impact:** High — Chrome grid still renders black. Currently silent. One debug line per cell (`WebGL ok / compile error / context lost`) would unblock debugging.
- **Effort:** S — small change in `shared-grid-renderer.js` `paintCell` to always surface compile errors as visible overlay (instead of silent black).
- **Risk:** None.

---

## 3. Architectural cleanups (medium effort, do after demo)

### 3.1 Extract `lib/autopilot.js` from `server.js`
- **Impact:** High — `server.js` is 2,274 lines. The autopilot state machine (`autopilot` object, `waitForHumanFeedback`, `releaseHumanGate`, `waitForHumanOrTimeout`, `runAutopilotCycle`, `autopilotLoop`, `startAutopilot`, `stopAutopilot`, `resumePendingAutopilotCycle`, `touchGenerationLock`, `lockIsActive`) is ~150 lines that don't need to be in the main file.
- **Effort:** M — extract to `lib/autopilot.js`, export state object + functions.
- **Risk:** Medium — autopilot is the demo's main loop; bugs here are visible.

### 3.2 Extract `lib/api-routes.js` from `server.js`
- **Impact:** High — 12 routes + ~400 lines of HTTP handling. Should not be in the main server file.
- **Effort:** M — extract routes to `lib/api-routes.js`, register via `app.use()`.
- **Risk:** Medium — requires careful middleware ordering check.

### 3.3 Extract `lib/feedback.js` from `server.js`
- **Impact:** High — `processFeedbackAndEvolve`, `applyFeedbackRatings`, `scheduleEvolution`, `runEvolutionPipeline`, `critiqueRatedSketches`, `evolveStrategyInternal` is ~150 lines of the core learning loop. Belongs in its own module.
- **Effort:** M — clean module boundary; should be pure functions over `db` + helpers.

### 3.4 Collapse `lib/memory.js` and `lib/learning/memory.js`
- **Impact:** Medium — two files with overlapping exports (`buildRemixSection` legacy vs `buildPreferenceMemory` new). Migrate `buildRemixSection` callers to `selectLearningExamples` (see 2.4), then delete `lib/memory.js`.
- **Effort:** M.

### 3.5 Fix Chrome grid bug properly (or replace with static thumbnails)
- **Impact:** Critical for demo — the showpiece is black on Chrome.
- **Three viable approaches:**
  - **(a) Debug overlay** (item 2.7) → diagnose, then targeted fix in `paintCell` robustness
  - **(b) Server-rendered thumbnails** in `<img>` cells, no live WebGL grid → bypass Chrome's WebGL grid entirely
  - **(c) Revert to per-canvas WebGL contexts** with `webgl-queue.js` slot management (dialog already uses this)
- **Effort:** (a) S, (b) M, (c) L.
- **Recommendation:** Option (b) is the most demo-safe. Static thumbnails captured at generation time, dialog opens live WebGL. Already have `captureCellThumbnail` in shared renderer.

---

## 4. Open bugs

| Priority | Bug | File | Notes |
|---|---|---|---|
| **High** | Chrome grid still renders black cells despite shared renderer rewrite | `public/shared-grid-renderer.js` | See prd §8. Debug overlay is item 2.7. |
| **Medium** | `currentStrategy` in `database.json` contains banned jargon (legacy data) | `database.json` | Fixed by item 2.1. |
| **Medium** | `fallbackGeneratedSketch` hardcodes `preferenceMemoryVersion: 0` | `server.js:587` | Real path at line 720 reads `db.preferenceMemory?.version`. One-line fix. |
| **Low** | `buildRemixSection` still called from `generateMetadataBatch` (migrated elsewhere) | `server.js:532` | Fixed by item 2.4. |
| **Low** | Dead `buildGenerationPrompts()` referenced in `server.js` | `server.js:309-359` | Fixed by item 2.2. |
| **Low** | `AGENTS.md` still claims Gemini-only / `GEMINI_API_KEY` / 4 gens · 40 sketches / single test file | `AGENTS.md` | Separate doc-sync task. |
| **Low** | `work/implementation.md` marked "Not built" but most items are built | `work/implementation.md` | Doc-sync task. |
| **Low** | `work/README.md` row for `implementation.md` says "Not built" | `work/README.md` | Updated by item in this PR. |

---

## 5. Aspirational / not-yet-built

Captured from `work/learning-feature.md §12 Implementation Phases` and PRD §6 surfaces that aren't shipped yet.

| Idea | Phase | Source |
|---|---|---|
| Snippet-level memory (extract reusable palette / noise / SDF functions, ranked independently from full shaders) | Phase 5 | `work/learning-feature.md §7` |
| Track diversity across each batch (count unique DNA × technique combos; reject batches that collapse diversity) | Phase 4 (last unchecked item) | `work/learning-feature.md §11` |
| Shadow-mode retrieval diagnostics UI | Diagnostics | `agents-learning-model.md §13` |
| MongoDB snapshot recovery (rollback if a generation regresses) | — | implied by `push-mongo-snapshot.js` |
| Multi-tenant curator accounts | — | explicitly out of scope per prd §5 |
| Time-series telemetry of `preferenceMemory.prefer[]` drift per generation | — | implied by `statistics.generations[]` schema |

---

## 6. Recommended order (next 2 days)

1. ✅ Create `work/innovation-list.md` (this doc) — done
2. ✅ `scripts/sanitize-strategy.js` + run it once — done in this PR
3. ✅ Delete `buildGenerationPrompts` — done in this PR
4. ✅ Add `test/strategy.test.js` regression — done in this PR
5. **Next sprint:** items 2.4, 2.5, 2.6, 2.7 (all ≤S effort, all high-impact)
6. **Before demo:** item 3.5 — pick (a/b/c) for Chrome grid
7. **After demo:** items 3.1, 3.2, 3.3, 3.4 (server.js split)

---

## 7. Doc-sync backlog

- [ ] `AGENTS.md` — rewrite to align with `prd.md` (AI provider, required key, batch size, test count, hidden features like LiveKit / pattern library / LearnOpenGL)
- [ ] `work/implementation.md` — re-mark phases that are now built, add Phase 7 for snippet memory
- [ ] `work/README.md` — refresh status column (done in this PR)
- [ ] `agents-learning-model.md` — add new "Hidden features" subsection referencing voice curator, pattern library, curriculum injection
- [ ] `README.md` §"Open bugs" link out to `work/innovation-list.md §4` so reviewers find them