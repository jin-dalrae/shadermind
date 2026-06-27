# agents-learning-model.md — LEARNING Branch Guide

> **Branch:** `LEARNING`  
> **Audience:** AI agents and contributors extending ShaderMind's continual-learning system  
> **Companion doc:** [AGENTS.md](./AGENTS.md) (general repo guide)

This document explains **what the LEARNING branch adds**, **how learning works end-to-end**, and **how to use or extend it safely**.

---

## Pick up here (session state)

**Branch:** `LEARNING` on `origin/LEARNING` (collaborator push access works as of 2026-06-27)

**Archive state** (in committed `database.json`):
- `generationCount: 4`, `totalSketches: 40`
- `preferenceMemory` active — rules built from prior rated batches
- Next autopilot cycle would be **generation 5**

**You are continuing work that:**
1. Replaced Good/Bad with **1–5 ratings** (all 10 required)
2. Added **code-aware learning** in `lib/learning/`
3. Added **SQLite + JSON mirror** in `storage/`
4. Fixed **Chrome WebGL context exhaustion** via shared grid renderer — **grid still black on Chrome; bug open**
5. Documented everything in this file + [AGENTS.md](./AGENTS.md)

**Immediate next steps** (if no other direction from user):
- Open PR: `LEARNING` → `main`
- Rate gen 4 batch / run gen 5 to validate learning loop end-to-end
- Expand tests or implement snippet memory per [work/learning-feature.md](./work/learning-feature.md)

**Run tests:** `npm test` (covers retrieval, memory, similarity, features in `test/learning.test.js`)

---

## Known open bug: grid rendering (STILL FAILING)

🔴 **Chrome studio grid shows black/empty cells** — not fixed as of 2026-06-27.

Full write-up: [AGENTS.md § Known open bug: grid rendering](./AGENTS.md#known-open-bug-grid-rendering-still-failing)

**Summary for agents picking up render work:**

| | |
|---|---|
| **Broken** | Live 10-cell grid + likely timeline thumbnails in Chrome |
| **May work** | Cursor embedded browser; possibly dialog fullscreen (`shader-renderer.js`) |
| **Unaffected** | Generation, 1–5 curation, learning loop, DB persistence |
| **Attempted fix** | `public/shared-grid-renderer.js` — single WebGL context, `readPixels` blit, `?v=5` cache bust |
| **User verified** | Still black after incognito + `/?v=5` |
| **Next step** | Debug overlay on cells, or Option B: `<img>` snapshots instead of live WebGL grid |

Do not close this issue without human confirmation on Chrome.

---

## What LEARNING adds (vs `main`)

| Area | `main` | `LEARNING` |
|------|--------|------------|
| Human feedback | Good / Bad | **1–5 rating** (required for every shader in a batch) |
| Example memory | Last 3 `"good"` shaders, full GLSL dump | **Ranked retrieval** (2 per evolutionary, 1 per directive, 0 for mutation) |
| Rule memory | Heuristics + strategy genome only | **`preferenceMemory`** — evidence-backed prefer/avoid rules |
| Code signals | None | **`codeFeatures`**, compile results, per-sketch critique |
| Similarity guard | None | **Jaccard shingle check** + optional Gemini retry if too similar |
| Storage | `database.json` only | **SQLite + JSON mirror** via `storage/` |
| Grid rendering | Per-cell WebGL (context limit bug) | **Shared grid renderer** (`public/shared-grid-renderer.js`) |
| Learning code | Inline in `server.js` | **`lib/learning/`** pure helpers |

**Still human-gated:** autopilot pauses at `awaiting_human` until `POST /api/feedback`. Autonomous curation exists but is not wired.

---

## The learning model (two memories)

ShaderMind on LEARNING uses **PLUS-inspired** dual memory:

```
┌─────────────────────────────────────────────────────────┐
│ EXAMPLE MEMORY (concrete shaders)                       │
│ • GLSL source, DNA, compile result, critique            │
│ • Retrieved by selectLearningExamples()                 │
│ • Injected into GLSL writer (budgeted), not metadata    │
└─────────────────────────────────────────────────────────┘
                          +
┌─────────────────────────────────────────────────────────┐
│ RULE MEMORY (compressed preferences)                      │
│ • preferenceMemory.prefer / .avoid                      │
│ • Built by buildPreferenceMemory() from all ratings     │
│ • Injected as text into metadata + GLSL prompts         │
└─────────────────────────────────────────────────────────┘
                          +
┌─────────────────────────────────────────────────────────┐
│ STRATEGY GENOME (existing)                              │
│ • currentStrategy + heuristics                          │
│ • Rewritten by evolveStrategyInternal() after feedback  │
└─────────────────────────────────────────────────────────┘
```

### Example memory — *which past code to reference?*

**Module:** `lib/learning/retrieval.js` → `selectLearningExamples(db, targetConcept, options)`

**Positive candidates must:**
- Have rating **≥ 4** (legacy `"good"` maps to 5)
- Not have `compile.success === false`
- Contain valid GLSL (`gl_FragColor`)
- Be from a **prior generation** (not current batch)

**Ranking score (deterministic, no embeddings):**
```
0.40 × tag/label relevance
0.20 × technique overlap
0.15 × rating source weight (explicit > autonomous > defaulted)
0.15 × recency
0.10 × compile confidence
− cooldown if example overused (learningUseCount)
```

**Diversity:** maximal marginal relevance — picks relevant examples that differ from each other.

**Usage by shader type (5-3-2 batch):**

| Slot | Type | Example limit | Raw GLSL in writer? |
|------|------|---------------|---------------------|
| 1–5 | evolutionary | 2 | Yes (budgeted) |
| 6–8 | directive | 1 | Yes (budgeted) |
| 9–10 | mutation | 0 | No — explore only |

Metadata planning gets **descriptions only** via `buildExampleDescriptions()`.  
GLSL writing gets **truncated source** via `buildExampleContext(examples, LEARNING_CONTEXT_CHARS)`.

### Rule memory — *what does the curator consistently like?*

**Module:** `lib/learning/memory.js`

After each feedback cycle, `buildPreferenceMemory(sketches, previousMemory)`:

1. Collects **learning labels** from each rated sketch (DNA tags + extracted code features)
2. Weighted by **1–5 rating** and **ratingSource** (`explicit` = 1.0, `defaulted` = 0.35)
3. Skips compile failures
4. Emits rules with `averageRating`, `support`, `confidence`, `approval`
5. **prefer:** rules with average ≥ 4  
   **avoid:** rules with average ≤ 2

`buildPreferenceSummary()` formats top rules for Gemini prompts.

Stored at DB root:
```javascript
preferenceMemory: {
  version: 3,
  updatedAtGeneration: 4,
  prefer: [{ rule, support, confidence, approval, averageRating }],
  avoid: [{ rule, support, confidence, approval, averageRating }]
}
```

### Code features — *explainable traits without AI*

**Module:** `lib/learning/features.js` → `extractCodeFeatures(glsl)`

Regex-based detection of techniques, motion, composition, palette, complexity.  
Used for retrieval ranking and preference rule labels. **Deterministic** — same shader → same features.

---

## End-to-end learning loop

```
1. GENERATE (Gemini)
   ├── Plan 10 concepts (metadata) — uses preferenceSummary + example descriptions
   └── Write 10 GLSL shaders — uses preferenceSummary + budgeted example GLSL + novelty brief
       └── Similarity check → retry if too close to archive (SHADER_SIMILARITY_THRESHOLD)

2. RENDER (browser)
   └── Shared grid renderer + compile reports to POST /api/sketches/:id/compile-result

3. CURATE (human)
   └── Rate every shader 1–5 + optional aesthetic note

4. FEEDBACK (POST /api/feedback)
   ├── recordRatingsAndPersist() — saves ratings, compile, codeFeatures
   ├── critiqueRatedSketches() — batched Gemini per-sketch critique JSON
   ├── buildPreferenceMemory() — updates preferenceMemory
   └── evolveStrategyInternal() — rewrites heuristics + strategy genome

5. REPEAT — next generation uses updated memory
```

---

## Human curation (1–5 scale)

| Score | Meaning |
|-------|---------|
| 1 | Strong dislike |
| 2 | Dislike |
| 3 | Neutral / mixed |
| 4 | Like |
| 5 | Strong like |

**Rules:**
- **Every shader in the batch must be rated** before submit (server returns 400 otherwise)
- Legacy archive records: `"good"` → 5, `"bad"` → 1
- `successRate` in UI = % of rated sketches with score **≥ 4**
- Timeline thumbnails show shaders rated **≥ 4**

**UI:** `public/app.js` — five buttons per cell during `awaiting_human`.

---

## Compile evidence

During curation, `ShaderRenderer` reports compile success/failure:

```
POST /api/sketches/:id/compile-result
{ "success": true, "error": null }
```

- Stored on sketch as `compile: { success, error, reportedAt }`
- **Compile failures excluded** from positive example retrieval even if rated 4–5
- Included in feedback payload as `compileResults` map

---

## Per-sketch critique

After feedback, one batched Gemini call (`critiqueRatedSketches`) returns structured JSON per shader:

```javascript
critique: {
  strengths: ["..."],
  weaknesses: ["..."],
  reusablePatterns: ["..."],
  avoidPatterns: ["..."]
}
```

If critique fails, ratings and strategy evolution **still persist**.

---

## Sketch schema (LEARNING extensions)

Each sketch in `database.json` / SQLite may include:

```javascript
{
  id, title, type, hypothesis, glsl, poetic_statement, dna[], generation,
  rated, rating,                    // 1–5 or legacy "good"/"bad"
  ratingSource,                     // "explicit" | "defaulted" | "autonomous" | null
  generationFocus, prompt,
  compile: { success, error, reportedAt },
  critique: { strengths, weaknesses, reusablePatterns, avoidPatterns },
  codeFeatures: { techniques, motion, composition, palette, complexity, functions },
  learningContext: {                // set at generation time
    preferenceMemoryVersion,
    exampleIds, retrievalScores,
    contextCharacters, policy,
    similarityScore, similaritySourceId, similarityWarning
  },
  learningUseCount                  // incremented when used as example
}
```

All new fields are **optional** — old records load with defaults.

---

## Environment variables (learning-specific)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CODE_AWARE_LEARNING` | `true` | Set `false` to disable retrieval, similarity retry, preference injection |
| `LEARNING_CONTEXT_CHARS` | `9000` | Max chars for example GLSL injected per shader |
| `SHADER_SIMILARITY_THRESHOLD` | `0.82` | Triggers novelty retry if new GLSL too similar to archive |
| `USE_SQLITE` | — | Enable SQLite storage |
| `SQLITE_PATH` | `./shadermind.db` | SQLite file path |
| `JSON_MIRROR` | `true` | Keep `database.json` synced when using SQLite |

See also [`.env.example`](./.env.example) and [AGENTS.md](./AGENTS.md#environment-variables).

---

## Key files (read in this order)

| File | Responsibility |
|------|----------------|
| [`lib/learning.js`](./lib/learning.js) | Public re-exports |
| [`lib/learning/retrieval.js`](./lib/learning/retrieval.js) | Example selection + context builders |
| [`lib/learning/memory.js`](./lib/learning/memory.js) | `preferenceMemory` build + summary |
| [`lib/learning/features.js`](./lib/learning/features.js) | Code feature extraction, rating helpers |
| [`lib/learning/similarity.js`](./lib/learning/similarity.js) | Near-copy detection |
| [`server.js`](./server.js) | `generateMetadataBatch`, `generateGlslForSketch`, `/api/feedback` |
| [`public/app.js`](./public/app.js) | 1–5 UI, compile reporting, archive batch fallback |
| [`storage/`](./storage/) | SQLite + JSON persistence |
| [`work/learning-feature.md`](./work/learning-feature.md) | Full spec + planned follow-ups |

---

## API changes on LEARNING

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/feedback` | Requires **all** ratings 1–5; accepts `explicitRatingIds`, `compileResults` |
| POST | `/api/sketches/:id/compile-result` | Client compile evidence during curation |
| GET | `/api/state` | Includes `preferenceMemory`, `codeAwareLearning` |

**Feedback body:**
```json
{
  "generation": 5,
  "ratings": { "sketch-gen5-1": 4, "...": 3 },
  "explicitRatingIds": ["sketch-gen5-1", "..."],
  "compileResults": { "sketch-gen5-1": { "success": true, "error": null } },
  "userOpinion": "warmer, slower motion",
  "newSketches": [ /* current batch */ ]
}
```

---

## How to run locally

```bash
git checkout LEARNING
cp .env.example .env
# Set GEMINI_API_KEY=
npm install
npm run dev
# → http://localhost:8080/?v=5  (use versioned URL in Chrome to avoid cache)
```

**Kill and restart:**
```bash
lsof -ti :8080 | xargs kill -9 2>/dev/null
npm run dev
```

**View-only (no new generation):** set `AUTOPILOT=false` in `.env`. Studio loads latest saved batch from DB.

---

## How to use as a curator (demo flow)

1. Wait for **Gen N · your turn** in Studio (10 live shaders)
2. **Rate every shader 1–5** (all required)
3. Optionally add an aesthetic note
4. Click **Submit & evolve**
5. Watch **Latest reflection** and **Mind → heuristics** update
6. Next batch reflects `preferenceMemory` + retrieved examples + evolved strategy

Inspect learning on a sketch: click cell → dialog shows GLSL; check `learningContext` in `database.json`.

---

## How to extend (agent guidelines)

### Safe changes
- Tune ranking weights in `scoreCandidate()` (`retrieval.js`)
- Add feature patterns in `FEATURE_PATTERNS` (`features.js`)
- Adjust `exampleLimit` by shader type in `generateGlslForSketch()` (`server.js`)
- Add diagnostics to `/api/state` (e.g. last retrieval ids)

### Do not
- Add a second retrieval path — use `selectLearningExamples()` only
- Inject full archive GLSL into metadata planning
- Skip compile-failure filter for positive examples
- Break the **all-10-rated** feedback contract without updating UI + server
- Store embeddings in `database.json` before storage abstraction is ready

### Feature flag
```bash
CODE_AWARE_LEARNING=false
```
Disables retrieval, similarity retry, and preference injection. Strategy/heuristic evolution still runs.

---

## What's implemented vs planned

### ✅ Implemented on LEARNING
- 1–5 rating UI + server validation
- `preferenceMemory` (prefer/avoid rules)
- Ranked example retrieval with context budget
- Code feature extraction
- Compile result capture
- Per-sketch batched critique
- Similarity check + novelty retry
- `learningContext` on generated sketches
- SQLite storage + JSON mirror
- Chrome-safe shared grid renderer — **implemented but grid still black on Chrome (open bug)**
- Archive batch display when autopilot idle

### ⏳ Planned (see [`work/learning-feature.md`](./work/learning-feature.md))
- More unit tests beyond `test/learning.test.js` (integration / smoke)
- Snippet-level memory (not just full-shader references)
- Shadow-mode retrieval diagnostics UI
- `LEARNING_MODE` = human | autonomous | hybrid
- MongoDB storage abstraction
- Paginated sketch API

---

## Debugging learning behavior

**Check preference rules:**
```bash
curl -s http://localhost:8080/api/state | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['preferenceMemory'], indent=2))"
```

**Inspect a sketch's learning context:**
```bash
curl -s http://localhost:8080/api/sketches | python3 -c "
import sys,json
for s in json.load(sys.stdin):
  if s.get('learningContext'):
    print(s['id'], s['learningContext'])
"
```

**Disable learning to isolate generation bugs:**
```env
CODE_AWARE_LEARNING=false
```

**Chrome render (OPEN BUG):** Grid thumbnails fail on Chrome despite `shared-grid-renderer.js`. Full details: [AGENTS.md § Known open bug](./AGENTS.md#known-open-bug-grid-rendering-still-failing). Do not assume `/?v=5` fixes it.

---

## Related docs

- [AGENTS.md](./AGENTS.md) — repo map, API, env vars, conventions
- [work/learning-feature.md](./work/learning-feature.md) — full feature spec + rollout plan
- [work/implementation.md](./work/implementation.md) — MongoDB + tiered memory roadmap
- [project_blueprint/prd.md](./project_blueprint/prd.md) — product intent + PLUS alignment
