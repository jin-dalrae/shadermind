# AGENTS.md — ShaderMind

Guide for AI agents and contributors working on this repository.

---

## What this project is

**ShaderMind** is a hackathon prototype (2026 AI Engineer World's Fair) that generates **WebGL GLSL fragment shaders** using **Google Gemini**, learns aesthetic taste through **human good/bad curation**, and rewrites its own **strategy genome** and **heuristics** after each batch.

- **Theme:** Continual Learning (PLUS-inspired preference summaries)
- **Stack:** Node.js + Express backend, vanilla HTML/CSS/JS frontend, WebGL 1.0 renderer
- **Persistence:** Flat `database.json` (MongoDB planned but **not implemented**)
- **North star:** 3,650 sketches (Lieberman metaphor — not a calendar)

---

## Repository map

```
shadermind/
├── server.js              # Entire backend: API, Gemini calls, autopilot, persistence
├── database.json          # All agent memory + sketch archive (committed, ~100KB+)
├── public/
│   ├── index.html         # Single-page UI shell
│   ├── index.css          # Editorial gallery styling
│   ├── app.js             # ShaderMindUI — polling, curation, timeline
│   └── shader-renderer.js # WebGL compile/render (u_time, u_resolution, u_mouse)
├── project_blueprint/     # PRD, pitch, hackathon criteria (design docs)
├── work/implementation.md # Planned MongoDB + tiered memory (NOT built yet)
├── .env.example           # Env template (may drift from user .env)
├── Dockerfile             # Copies database.json as seed data
└── .do/app.yaml           # DigitalOcean App Platform template
```

There is **no** `README.md`, **no** tests, **no** build step, **no** frontend bundler.

---

## Runtime architecture

```
Browser (public/app.js)
    │ poll every 3s
    ▼
Express (server.js)
    ├── loadDB() / saveDB()  →  database.json
    ├── Gemini REST API     →  generativelanguage.googleapis.com
    └── Autopilot loop      →  generate → await human → evolve → repeat
```

### Learning loop (current — human-gated)

1. **Autopilot** starts on boot if `AUTOPILOT !== "false"` and `GEMINI_API_KEY` is set.
2. **Generate** 10 shaders (5 evolutionary / 3 directive / 2 mutation).
3. **Pause** at phase `awaiting_human` until `POST /api/feedback`.
4. **Evolve** strategy + heuristics via Gemini; persist to `database.json`.
5. **Wait** `AUTOPILOT_INTERVAL_MS` (default 45s), then repeat.

`autoCurateBatch()` exists for autonomous curation but is **not wired** into the autopilot loop. See `work/implementation.md` for planned `LEARNING_MODE` flag.

### Generation pipeline (two-phase)

| Step | Function | Model | Output |
|------|----------|-------|--------|
| 1. Plan metadata | `generateMetadataBatch()` | `GEMINI_MODEL` | JSON array of 10 concepts |
| 2. Write GLSL | `generateGlslForSketch()` × 10 | `GEMINI_GLSL_MODEL` (parallel, `GLSL_CONCURRENCY`) | Raw GLSL per shader |
| 3. Fallback | `FALLBACK_GLSL` | — | Used if individual GLSL gen fails |

**Dead code:** `buildGenerationPrompts()` — older monolithic prompt that asked Gemini for all 10 shaders + base64 GLSL in one JSON response. Replaced by the two-phase pipeline above. Do not revive without removing the new path.

---

## Frontend behavior

`ShaderMindUI` (`public/app.js`):

- Polls `/api/state`, `/api/autopilot/status`, `/api/sketches` every **3 seconds**.
- Renders current batch in `#shaderGrid` when `autopilot.currentBatch` is set.
- Shows curation panel only when `phase === "awaiting_human"`.
- Unrated shaders default to **bad** on submit.
- Opens fullscreen `<dialog>` with live canvas + GLSL source on cell click.

`ShaderRenderer` (`public/shader-renderer.js`):

- WebGL 1.0 only. Requires `precision mediump float;` and `gl_FragColor`.
- Injects uniforms: `u_time`, `u_resolution`, `u_mouse` (eased).
- Uses `compileWhenReady()` + `ResizeObserver` to handle zero-size canvases at first paint.
- Compilation errors render as `.shader-error` overlay on the cell.

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Stats, strategy, heuristics, timeline, autopilot summary |
| GET | `/api/sketches` | Full sketch array (no pagination yet) |
| GET | `/api/autopilot/status` | Phase, current batch, generation progress |
| POST | `/api/autopilot/start` | Start loop (`maxCycles` optional) |
| POST | `/api/autopilot/stop` | Stop after current cycle |
| POST | `/api/autopilot/kick` | Unstick + restart if idle |
| POST | `/api/generate` | Manual batch (`{ focus: string }`) |
| POST | `/api/feedback` | Ratings + optional opinion → evolve + release autopilot gate |
| GET | `/api/narrative` | Gemini monologue over lifetime stats |
| POST | `/api/reset-baseline` | Reset strategy/heuristics; **keeps** sketch history |

Static files served from `public/` at `/`.

---

## Environment variables

**Read by `server.js` today:**

| Variable | Default | Notes |
|----------|---------|-------|
| `GEMINI_API_KEY` | — | **Required.** Server warns and skips autopilot if missing |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Metadata, curation, evolution, narrative |
| `GEMINI_GLSL_MODEL` | `gemini-2.5-flash` | Per-shader GLSL (`.env.example` says `gemini-2.5-pro`) |
| `GEMINI_ONLY` | `true` | If true, no DigitalOcean fallback |
| `ALLOW_DO_FALLBACK` | `false` | Enables Llama 3.3 via DO Inference |
| `DIGITAL_OCEAN_MODEL_ACCESS_KEY` | — | DO fallback API key |
| `PORT` | `8080` | |
| `AUTOPILOT` | enabled | Set `"false"` to disable auto-start |
| `AUTOPILOT_INTERVAL_MS` | `45000` | Pause between cycles |
| `AUTOPILOT_SEED_CYCLES` | `3` | Logged only; loop runs indefinitely |
| `GEMINI_TIMEOUT_MS` | `90000` | Per-request timeout |
| `GLSL_CONCURRENCY` | `3` | Parallel GLSL generation workers |

**In user `.env` but NOT used by code:**

- `MONGODB_URI`, `MONGODB_DB` — planned in `work/implementation.md`
- `ALLOW_GEMINI_FALLBACK` — wrong name; server expects `ALLOW_DO_FALLBACK`
- `DO_INFERENCE_ROUTER` — not referenced

**Critical:** Node loads `.env` only at process start. After editing `.env`, restart `npm run dev`.

---

## `database.json` schema

Singleton file merged with `DEFAULT_DB` on load:

```javascript
{
  totalSketches, generationCount, successRate,
  currentStrategy,           // long "genome" string injected into Gemini prompts
  heuristics[],              // short rules with approval-rate estimates
  strategyTimeline[],        // { generation, timestamp, strategy, notes }
  sketches[],                // { id, title, type, hypothesis, glsl, poetic_statement, dna[], generation, rated, rating }
  statistics: {
    generations[],           // per-gen good/bad counts
    popularTags[]            // from good-rated DNA tags
  }
}
```

Sketch IDs: `sketch-gen{N}-{1-10}`.

**Remix context:** Last 3 `rating === "good"` sketches' full GLSL is injected into generation prompts via `buildRemixSection()`.

---

## Audit findings (as of 2026-06-27)

### Working

- Gemini two-phase batch generation with retries and concurrency pool
- Human-in-the-loop curation UI and feedback → strategy evolution
- WebGL live rendering with error boundaries
- Autopilot state machine (`idle` → `generating` → `awaiting_human` → `evolving` → `waiting`)
- Docker + DO App Platform configs present
- `.env` gitignored

### Gaps / drift

| Issue | Severity | Detail |
|-------|----------|--------|
| MongoDB in `.env` but not in code | Medium | `work/implementation.md` is a plan only |
| `autoCurateBatch` unused | Medium | PRD mentions autonomous mode; loop is human-only |
| `buildGenerationPrompts` dead code | Low | ~50 lines; safe to delete when refactoring |
| `.env.example` vs code defaults | Low | GLSL model default differs from example |
| User `.env` var names | Medium | `ALLOW_GEMINI_FALLBACK` has no effect |
| No `README.md` | Low | Onboarding relies on AGENTS.md / blueprint |
| No tests | Medium | Manual verification only |
| `database.json` in git | Medium | Grows with every generation; bloats repo |
| Full sketch load on client | Medium | `/api/sketches` returns entire archive |
| No auth / rate limits | Low | Acceptable for hackathon demo |
| DO app.yaml repo placeholder | Low | `your-org/shadermind` needs updating |

### Operational gotchas

1. **Server started before `.env` exists** → permanent "GEMINI_API_KEY required" until restart.
2. **Port 8080 in use** → kill old process before restart.
3. **GLSL sometimes stored with markdown fences** — `decodeGlslField()` and `sanitizeGlslSource()` handle this.
4. **Generation takes 1–3 minutes** — 10 sequential-ish Gemini calls; UI shows `generationProgress`.

---

## Conventions for agents

### Do

- Keep backend changes in `server.js` unless implementing the planned `storage/` module from `work/implementation.md`.
- Match existing style: ES modules, no TypeScript, minimal dependencies.
- Preserve GLSL ES 1.0 constraints in all generation prompts (`gl_FragColor`, not `out vec4`).
- Use `runGeminiWithRetry` / `runGeminiBatch` for new Gemini calls.
- Test locally: `npm install && npm run dev`, then check `/api/autopilot/status`.
- Restart server after env changes.

### Don't

- Commit `.env`, credentials, or MongoDB URIs.
- Add React, Vite, or heavy frameworks without explicit request — this is intentionally vanilla.
- Wire MongoDB without implementing the storage abstraction described in `work/implementation.md`.
- Enable autonomous curation without adding `LEARNING_MODE` and updating the UI copy (currently says "human-in-the-loop").
- Break the autopilot human gate (`waitForHumanFeedback` / `releaseHumanGate`) without replacing the curation path.
- Assume `database.json` scales — paginate before loading 1000+ sketches.

### Safe refactor targets

- Extract Gemini client → `lib/gemini.js`
- Extract storage → `storage/json.js` (then `storage/mongo.js`)
- Delete `buildGenerationPrompts()` once confirmed unused
- Wire `autoCurateBatch()` behind `LEARNING_MODE=autonomous`
- Add `README.md` pointing here

---

## Local development

```bash
cp .env.example .env
# Set GEMINI_API_KEY=your_key   (Google AI Studio key, usually starts with AIza)
npm install
npm run dev
# → http://localhost:8080
```

Verify:

```bash
curl -s http://localhost:8080/api/autopilot/status | python3 -m json.tool
# phase should move: generating → awaiting_human
```

---

## Deployment

- **Docker:** `docker build -t shadermind . && docker run -p 8080:8080 -e GEMINI_API_KEY=... shadermind`
- **DigitalOcean App Platform:** `.do/app.yaml` — set `GEMINI_API_KEY` secret, fix GitHub repo path.
- **Persistence on DO:** Ephemeral filesystem unless you add MongoDB or mounted volume. `database.json` writes will be lost on redeploy without external storage.

---

## Planned work (see `work/implementation.md`)

1. **Phase 1:** MongoDB storage abstraction + migration from JSON
2. **Phase 2:** `LEARNING_MODE` = human | autonomous | hybrid
3. **Phase 3:** Tiered memory in prompts (rollup, truncated remix GLSL)
4. **Phase 4:** Consolidation job every N generations
5. **Phase 5:** Paginated gallery/timeline API + UI

Do not mark these as done in docs until implemented in code.

---

## Hackathon alignment

| Criterion | Status |
|-----------|--------|
| Continual learning via memory + feedback | ✅ Heuristics + strategy genome evolve per generation |
| Gemini special prize | ✅ All batch steps use Gemini REST API |
| DigitalOcean deploy | ✅ Dockerfile + app.yaml |
| Not a simple wrapper | ✅ Stateful WebGL playground with evolving prompts |
| Interpretable preference model | ✅ Heuristics + timeline visible in UI |
| Autonomous / minimal intervention | ⚠️ Human curation required today |

---

## Key files to read first

1. `server.js` — lines 466–507 (`generateBatchInternal`), 688–708 (`runAutopilotCycle`), 844–888 (`/api/feedback`)
2. `public/app.js` — `poll()`, `submitFeedback()`, `buildGrid()`
3. `public/shader-renderer.js` — `compile()`, `render()`
4. `work/implementation.md` — roadmap for next features
5. `project_blueprint/prd.md` — product intent (some sections describe planned autonomous mode)
