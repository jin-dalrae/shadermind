# ShaderMind

**An agent that draws. You become the artist.**

ShaderMind is a drawing tool — but the hand holding the pen is an agent. It generates live GLSL sketches; **you** steer with 1–5 ratings and short notes. It learns **your** taste over time and nudges each new batch a little closer to what you love and wanted to see.

Like a sketchbook that remembers: everyday shaders, **small changes from the last**, not reinventions. Inspired by [Zach Lieberman's daily code sketches](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d). The **3,650** count is a north-star metaphor for that practice — not a calendar.

Under the hood, preference memory follows [PLUS](https://arxiv.org/abs/2507.13579): your taste compressed into readable text that sharpens every batch.

**Hackathon:** 2026 AI Engineer World's Fair · Continual Learning track

---

## For AI agents — read this first

| Step | Document |
|------|----------|
| 1 | **[AGENTS.md](./AGENTS.md)** — handoff, repo map, API, env, open bugs |
| 2 | **[agents-learning-model.md](./agents-learning-model.md)** — code-aware learning memory model |
| 3 | **[work/learning-feature.md](./work/learning-feature.md)** — spec + remaining work |

---

## Why it exists

| Problem | ShaderMind's answer |
|---|---|
| AI art does the creating *for* you | **You** curate; the **agent** draws — you grow into the artist |
| One-size-fits-all taste | Learns **your** preference memory + strategy genome |
| Prompt → image, then forget | Everyday sketches; each batch changes a bit from the last |
| Opaque tools | 1–5 ratings, reflection log, evolution timeline you can read |

---

## See it in 30 seconds

1. Open the **Studio** — live WebGL shaders animate with `u_time`, `u_resolution`, `u_mouse`.
2. Rate every shader **1–5**, add an optional note, hit **Submit & next batch**.
3. Scroll **Mind** — heuristics distilled from your rating distribution.
4. Scroll **Evolution** — generation milestones with thumbnails of high-rated work.
5. Click **Explain artistic evolution** — the agent narrates its own arc.

The artifact isn't one pretty shader. It's **you**, learning taste through a tool that draws — sketch by sketch, change by change.

---

## Continual learning loop

```mermaid
flowchart LR
  A[Generate GLSL batch] --> B[Human rates 1–5]
  B --> C[Save ratings + compile results + thumbnails]
  C --> D[Build preference memory + evolve strategy]
  D --> E[Update heuristics]
  E --> A
```

**Human-in-the-loop by default** — the agent never auto-rates your batch unless you switch to autonomous/hybrid mode.

**Fast path** — one inference call writes a full batch of compile-ready shaders; strategy evolution runs in the background so the next batch starts immediately.

**Code-aware learning** — retrieval over past shaders, similarity checks, and preference memory inform staged generation and evolution.

---

## Interface

| Region | What you get |
|---|---|
| **Studio** | Current batch in a full-width gallery; click any cell for detail view |
| **Latest reflection** | Agent self-criticism after your last curation |
| **Evolution** | Real milestones per generation — notes + thumbnails of 4–5 rated shaders |
| **Mind** | Learned heuristics, reflection log, artistic monologue |

Batch composition (configurable, default **3**): evolutionary remixes from approved shaders, directive responses to your notes, and mutation sketches with an explicit hypothesis on the card.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, shared WebGL grid renderer, editorial gallery UI |
| Backend | Node.js + Express |
| AI | **DigitalOcean Inference** (primary) — per-task model pools; optional Gemini fallback |
| Storage | **MongoDB Atlas** in production; optional **SQLite** locally; `database.json` for dev / failover / mirror |
| Deploy | DigitalOcean App Platform or Docker (`8080`) |

### Generation pipeline (summary)

1. **Fast mode** (default) — one inference call returns metadata + inline GLSL for the whole batch
2. **Staged mode** — plan concepts, then one GLSL call per shader with retrieval context
3. **Validate & patch** — WebGL 1.0 sanitizer, lazy-shader rejection, optional repair retries
4. **Human curation** — 1–5 ratings persisted; thumbnails on 4–5
5. **Async evolution** — critique, preference memory, heuristics + strategy genome update

---

## GLSL generation (exact logic)

This section documents what the code actually does today (`server.js`, `lib/glsl.js`, `lib/ai.js`, `lib/learning/`). Implementation lives in `generateBatchInternal()` → `generateBatchFast()` or staged `generateMetadataBatch()` + `generateGlslForSketch()`.

### When generation runs

| Trigger | Function |
|---------|----------|
| Autopilot loop | `runAutopilotCycle()` after human feedback (or on boot if `pendingBatch` exists) |
| Manual | `POST /api/autopilot/generate-next` or `POST /api/generate` |
| Regenerate | `POST /api/autopilot/regenerate-batch` (replaces current awaiting batch) |

**Generation number:** `genNum = db.generationCount + 1`  
**Sketch IDs:** `sketch-gen{genNum}-{1..BATCH_SIZE}` (default `BATCH_SIZE=3`)

**Curator focus string** (injected into every prompt), in priority order:

1. `autopilot.lastHumanOpinion` (from last submit / regenerate focus)
2. `db.lastHumanOpinion` (persisted)
3. First learned heuristic
4. Default: *"Organic flow, slow liquid motion, warm amber gradients like candle flames in wind"*

**Session affinity:** `setSessionAffinity("shadermind-gen-{genNum}")` — pins a batch to one DO Inference route via `X-Model-Affinity`.

**Shared Mongo coordination:** when localhost and production share Atlas, a MongoDB `generationLock` ensures only one instance generates; `/api/autopilot/status` reads `pendingBatch` from the database so both UIs show the same Studio batch.

### Mode switch: `GENERATION_MODE`

| Value | Path | Inference calls per batch |
|-------|------|---------------------------|
| `fast` (default) | `generateBatchFast()` | **1** GLSL call (+ up to 2 repair calls per invalid shader) |
| `staged` | `generateMetadataBatch()` then `generateGlslForSketch()` × N | **1** planning call + **N** GLSL calls (parallel, `GLSL_CONCURRENCY`) |

Set in `.env`: `GENERATION_MODE=fast` or `GENERATION_MODE=staged`.

### Batch composition (5-3-2 scaled to `BATCH_SIZE`)

`getBatchDistribution(size)` splits each batch:

| Type | Share | Index rule | Intent |
|------|-------|------------|--------|
| **evolutionary** | 50% (min 1) | First slice | Small remix from high-rated past work — change **one** thing |
| **directive** | 30% (min 1) | Middle slice | Respond to curator focus / heuristics |
| **mutation** | remainder (min 1) | Last slice | One bold new formula; hypothesis names the experiment |

With `BATCH_SIZE=3` (production default): **1 evolutionary, 1 directive, 1 mutation**.

Each sketch also gets **DNA tags**: 2–4 lowercase words for concrete math/color only (`sin`, `fbm`, `polar`, `amber`) — no hashtags, no sentences.

### AI provider & models

**Primary:** DigitalOcean Inference (`https://inference.do-ai.run/v1`) via `lib/ai.js`.

| Task | Env override | Default model pool |
|------|--------------|-------------------|
| GLSL (fast batch + per-shader) | `DO_MODELS_GLSL` | `qwen3-coder-flash` → `glm-5.2` → `llama3.3-70b-instruct` |
| Metadata planning (staged) | `DO_MODELS_PLANNING` | `qwen3-coder-flash` → `llama3.3-70b-instruct` → `mistral-3-14B` |

**Fast batch** uses only the **first** GLSL model (`getTaskModels("glsl").slice(0, 1)`).  
**Per-shader** uses first model on attempt 1; later attempts fall through the full pool.  
**Optional fallback:** `ALLOW_GEMINI_FALLBACK=true` + `GEMINI_API_KEY` → Gemini (`GEMINI_GLSL_MODEL`, default `gemini-3.5-flash`) after DO pool exhaustion.

Other knobs: `GLSL_MAX_TOKENS` (default 5000), `GLSL_MAX_ATTEMPTS` (default 2 per shader), `GLSL_CONCURRENCY` (default 3 parallel workers).

---

### Fast mode (`generateBatchFast`) — step by step

```mermaid
flowchart TD
  A[assembleWorkingMemory] --> B[Single DO inference: JSON array of N shaders]
  B --> C[decodeGlslField per item]
  C --> D{validateGlsl}
  D -->|valid| E[Store shader]
  D -->|invalid| F[Up to 2× generateGlslForSketch repair]
  F --> G{still invalid?}
  G -->|yes| H[FALLBACK_GLSL template]
  G -->|no| E
```

**1. Assemble prompt context** (`assembleWorkingMemory`):

- `currentStrategy` (trimmed to 400 chars in prompt)
- Top 3 heuristics
- Last memory rollup summary (250 chars) if present
- **Remix seeds:** last 3 sketches rated ≥ 4 — title + DNA only (not full GLSL in fast prompt)
- Curator focus string

Plus `MATH_COOKBOOK_COMPACT` — one-line technique reminder (polar UV, hash noise, FBM, cosine palette, etc.).

**2. Single inference call**

- System prompt demands a JSON array of exactly `BATCH_SIZE` objects.
- Each object: `title`, `type`, `hypothesis`, `dna`, `glsl` (raw source with `\n`, **not** base64), `poetic_statement: ""`.
- Hard rules in prompt: WebGL 1.0 only, `precision mediump float;`, `gl_FragColor`, uniforms `u_time` / `u_resolution` / `u_mouse`, under 55 lines, no lazy circle-on-black placeholders.
- `jsonMode: true`, `maxTokens: min(GLSL_MAX_TOKENS × BATCH_SIZE, 14000)`.

**3. Pad short responses**

If the model returns fewer than `BATCH_SIZE` items, missing slots are filled with built-in `FALLBACK_GLSL` templates (warm wave + ripple shaders).

**4. Parallel validation pool** (`runPool`, concurrency `GLSL_CONCURRENCY`)

For each shader:

1. `decodeGlslField()` — strip markdown fences, optional base64 decode, `sanitizeGlsl()`
2. `validateGlsl()` — see [Validation pipeline](#validation-pipeline) below
3. If invalid → up to **2** repair passes calling `generateGlslForSketch()` with the failed metadata + repair hint appended to hypothesis
4. If still invalid → substitute `FALLBACK_GLSL[idx % 2]`

**5. Output sketch records**

Plain objects with `id`, `title`, `type`, `hypothesis`, `glsl`, `generation`, `dna`, `rated: false`. Staged-only fields (`codeFeatures`, `learningContext`, `prompt`) are omitted in fast mode.

---

### Staged mode — step by step

#### Phase A: `generateMetadataBatch()` (planning only, no GLSL)

One `runInferenceBatch()` call (`task: planning`, JSON mode) returns exactly `BATCH_SIZE` metadata objects: `title`, `type`, `hypothesis`, `dna`.

Context injected:

| Source | Used for |
|--------|----------|
| `strategyForPrompt(db.currentStrategy)` | Aesthetic genome (max 500 chars) |
| `db.heuristics` (up to 4) | Learned rules |
| `buildRemixSection(db)` | Last 3 rated ≥ 4 — title, hypothesis, DNA, **truncated GLSL** (80 lines) |
| `buildPreferenceSummary(preferenceMemory)` | Evidence-backed prefer/avoid rules (if `CODE_AWARE_LEARNING`) |
| `selectLearningExamples()` + `buildExampleDescriptions()` | 4 past sketches — **descriptions only**, no raw GLSL in planning |
| `MATH_COOKBOOK` | Full technique menu |

Planning prompt enforces visible diversity; mutation slots must explore underrepresented techniques.

#### Phase B: `generateGlslForSketch()` per metadata row (parallel pool)

Each metadata item becomes one shader. Two prompt branches:

**Branch 1 — Evolutionary remix** (when `REMIX_MUTATION=true` and type is `evolutionary`):

- `pickRemixParent(db, index)` selects from sketches rated ≥ 4 (round-robin by index).
- System prompt: *"Change EXACTLY ONE thing… keep everything else identical."*
- User prompt embeds the **full parent GLSL** + hypothesis + focus.
- No retrieval examples (parent replaces them).

**Branch 2 — Fresh shader** (directive, mutation, or evolutionary without parent):

- System prompt: raw GLSL only, WebGL 1.0 rules, `MATH_COOKBOOK`, strategy, rollup hint, preference summary.
- User prompt: title, type, hypothesis, focus, DNA, `buildNoveltyBrief(examples)`.
- If `CODE_AWARE_LEARNING`: `selectLearningExamples()` with type-specific limits (evolutionary: 2, directive: 1, mutation: 0), then `buildExampleContext()` — up to `LEARNING_CONTEXT_CHARS` (default 9000) of reference GLSL.

**Per-shader retry loop** (up to `GLSL_MAX_ATTEMPTS`, default 2):

1. `runInference()` → `decodeGlslField()` → `validateGlsl()`
2. On failure: sleep `400 × attempt`, retry with validation error in prompt + `buildGlslRepairHint()`
3. On success: `findMostSimilarShader()` against archive
4. If similarity ≥ `SHADER_SIMILARITY_THRESHOLD` (default **0.82**): one **novelty retry** with different structure request
5. Return `{ glsl, prompt, codeFeatures, learningContext }` or throw

**Failure:** `fallbackGeneratedSketch(FALLBACK_GLSL[idx], …)` — same two built-in templates as fast mode.

Staged output adds `generationFocus`, `prompt`, `compile: { success: null }`, `codeFeatures`, `learningContext` per sketch.

---

### Validation pipeline

All GLSL passes through `lib/glsl.js` before storage or display.

**Decode (`decodeGlslField`)**

1. Strip ` ```glsl ` fences
2. If already looks like GLSL (`precision` / `gl_FragColor`), sanitize
3. Else try base64 decode (legacy path)
4. Always end in `sanitizeGlsl()`

**Sanitize (`sanitizeGlsl`)**

- Strip ES 3.0: `out vec4 FragColor` → `gl_FragColor`
- `texture()` → `texture2D()`
- Ensure `precision mediump float;` at top
- Reject if `void main` exists but no `gl_FragColor`
- Run `patchGlslForWebGL()` (`public/glsl-patch.js`) — injects Ashima `mod289`/`permute` helpers when models call `permute`/`snoise` without defining them

**Validate (`validateGlsl`)** — must pass all checks:

| Check | Reject reason |
|-------|---------------|
| Length &lt; 80 chars | Too short |
| No `void main()` | Missing entry point |
| No `gl_FragColor` | Missing output |
| `out vec4` present | GLSL ES 3.0 syntax |
| `.u` / `.v` swizzles | Invalid WebGL 1.0 |
| Matches `FALLBACK_GLSL` signatures | Placeholder detected |
| Bad precision qualifier (e.g. `mediour`) | Typo |
| Unbalanced `{ }` or `( )` | Syntax |
| Undefined function calls | Missing helper definitions |
| `isLowEffortGlsl()` | Lazy pulsing circle/blob on black without full-frame technique |

**Low-effort detector** rejects shaders that are mostly a `smoothstep` radial mask + `sin(u_time)` pulse on a dark background, unless the code also uses full-frame techniques (FBM, hash noise, polar UV, domain warp, etc.).

**Client compile evidence:** during curation the browser reports `POST /api/sketches/:id/compile-result`; failures inform learning retrieval (compile-failed shaders are excluded from examples).

---

### Runtime uniforms (not in generated code)

The frontend renderer (`public/shader-renderer.js`, `public/shared-grid-renderer.js`) injects:

```glsl
uniform float u_time;      // elapsed seconds
uniform vec2 u_resolution;   // canvas pixel size
uniform vec2 u_mouse;      // normalized 0–1, eased
```

Generated shaders must declare these uniforms and write only to `gl_FragColor` inside `main()`.

---

### What changes the *next* batch (learning → generation)

Generation prompts read persisted state from MongoDB / `database.json`:

| Field | Role in GLSL prompts |
|-------|---------------------|
| `currentStrategy` | Long aesthetic genome — trimmed per prompt |
| `heuristics[]` | Short rules with approval context |
| `preferenceMemory` | Prefer/avoid rules from 1–5 ratings (`buildPreferenceSummary`) |
| `memoryRollups[]` | Compressed history every `CONSOLIDATION_EVERY_N` gens (default 25) |
| Sketches rated ≥ 4 | Remix parents, retrieval examples, fast-mode seed titles |
| `lastHumanOpinion` | Curator note → directive focus |

After you submit ratings, `processFeedbackAndEvolve()` updates strategy/heuristics/preference memory (async when `EVOLUTION_ASYNC=true`, default). The **next** `generateBatchInternal()` call reads the updated DB — evolution does not rewrite shaders already in the current batch.

---

### Environment variables (generation-specific)

| Variable | Default | Effect |
|----------|---------|--------|
| `GENERATION_MODE` | `fast` | `fast` or `staged` pipeline |
| `BATCH_SIZE` | `3` | Shaders per generation |
| `GLSL_CONCURRENCY` | `3` | Parallel validation / per-shader workers |
| `GLSL_MAX_ATTEMPTS` | `2` | Retries per shader in staged/repair paths |
| `GLSL_MAX_TOKENS` | `5000` | Max completion tokens per GLSL call |
| `REMIX_MUTATION` | `true` | Evolutionary shaders remix full parent GLSL |
| `CODE_AWARE_LEARNING` | `true` | Retrieval + preference memory in staged mode |
| `LEARNING_CONTEXT_CHARS` | `9000` | Max reference GLSL chars per shader |
| `SHADER_SIMILARITY_THRESHOLD` | `0.82` | Near-copy triggers novelty retry |
| `DO_MODELS_GLSL` | see above | Comma-separated GLSL model pool |
| `ALLOW_GEMINI_FALLBACK` | `false` | Gemini after DO exhaustion |

---

## Quick start

### Prerequisites

- Node.js 20+
- [DigitalOcean Model Access Key](https://docs.digitalocean.com/products/gradient-ai-platform/how-to/use-serverless-inference/)
- MongoDB Atlas URI (recommended for production)

### Run locally

```bash
git clone https://github.com/jin-dalrae/shadermind.git
cd shadermind
npm install
cp .env.example .env
# Edit .env — set DIGITAL_OCEAN_MODEL_ACCESS_KEY (and MONGODB_URI for production parity)
npm start
```

Open **http://localhost:8080**

```bash
npm test
```

Set `AUTOPILOT=false` in `.env` to browse saved art without generating.

### Migrate local JSON → MongoDB

```bash
npm run migrate:mongo
```

### Deploy (DigitalOcean App Platform)

1. Connect this repo; set `run_command` to `node server.js`
2. Add secrets: `DIGITAL_OCEAN_MODEL_ACCESS_KEY`, `MONGODB_URI`
3. Without `MONGODB_URI`, deploy falls back to bundled `database.json` — your Atlas history won't appear in production

See `.do/app.yaml` and `Dockerfile` for reference configs.

---

## Configuration highlights

| Variable | Default | Purpose |
|---|---|---|
| `LEARNING_MODE` | `human` | `human` · `autonomous` · `hybrid` |
| `GENERATION_MODE` | `fast` | `fast` (1 call) or `staged` (plan + N GLSL calls) |
| `BATCH_SIZE` | `3` | Shaders per generation |
| `CODE_AWARE_LEARNING` | `true` | Retrieval + preference memory in generation |
| `USE_SQLITE` | `false` | Local SQLite with optional JSON mirror |
| `AUTOPILOT_INTERVAL_MS` | `0` | Delay after submit before next batch |
| `EVOLUTION_ASYNC` | `true` | Strategy update in background |

Full list in [`.env.example`](.env.example).

---

## Hackathon alignment

**Theme: Continual Learning** — ShaderMind adapts *how* it generates from real curation feedback: memory rollups, preference memory, heuristic extraction, strategy rewrites, and remix seeds from high-rated shaders.

**Research tie-in: PLUS** — Like PLUS's preference summaries, ShaderMind compresses curation history into interpretable text that conditions the next generation — not a frozen reward model.

**Prizes**

- **DigitalOcean** — Inference-native stack, App Platform deploy, lightweight Node server
- **Gemini** — Optional fallback path (`ALLOW_GEMINI_FALLBACK=true`)

---

## Project structure

```
shadermind/
├── server.js              # Express API, autopilot loop, generation
├── lib/                   # AI routing, GLSL validation, memory, learning engine
├── public/                # Gallery UI, shared grid renderer, shader patcher
├── storage/               # MongoDB + SQLite + JSON adapters
├── test/                  # Learning engine tests
├── scripts/               # migrate:mongo, repair:glsl
└── work/                  # Agent handoff docs
```

---

## References

- Nam, H., Wan, Y., Liu, M., Ahnn, P., Lian, J., & Jaques, N. (2025/2026). *Learning to summarize user information for personalized reinforcement learning from human feedback.* [arXiv:2507.13579](https://arxiv.org/abs/2507.13579)
- Lieberman, Z. — [*I spent 10 years making a sketch in code every day*](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d) — everyday sketches, small deltas from the last, learning toward what you love (3,650 north star)

---

## License

Hackathon prototype — see repository for usage terms.