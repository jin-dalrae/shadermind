# ShaderMind — Long Memory & Learning Loop Implementation Plan

> Status: **planned** (not yet implemented)  
> Target: Continual Learning theme + Gemini Special Prize + DigitalOcean deploy  
> Reference: [PLUS arXiv:2507.13579](https://arxiv.org/abs/2507.13579)

---

## 1. Problem Statement

### Current storage (`database.json`)

Works for hackathon demo scale (~40 sketches, ~4 generations) but **will not scale** to the metaphorical 3,650-sketch arc:

| Issue | Impact at scale |
|-------|-----------------|
| Single monolithic JSON file | Slow reads/writes, deploy/git bloat |
| Full GLSL stored inline per sketch | 50–200 MB+ at 3,650 sketches |
| Full strategy genome duplicated per generation | Redundant timeline entries |
| Heuristics overwritten each cycle | Historical rules lost |
| No pagination | Gallery/timeline loads everything |
| No explicit learning mode | Human vs autonomous not first-class |

### Hackathon requirement ([`hackathon_info.md`](../project_blueprint/hackathon_info.md))

> Continual learning through **memory**, user feedback, prompt optimization, self-reflection — adapting in production with minimal intervention.

Judges need **tiered, interpretable memory** (PLUS-aligned), not prompt-stuffing of raw history.

---

## 2. Memory Architecture (4 Tiers)

Inspired by **Preference Learning Using Summarization (PLUS)**: compress preference history into **readable text summaries** that condition the next policy step.

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1 — Working Memory (always injected into Gemini)       │
│ • currentStrategy (latest genome)                           │
│ • top 5 active heuristics (with approval rates)             │
│ • last 3 "good" GLSL snippets (remix seeds)                 │
│ • latest human opinion (if any)                             │
├─────────────────────────────────────────────────────────────┤
│ TIER 2 — Episodic Memory (per generation)                   │
│ • generation #, timestamp, good/bad counts                  │
│ • curator source: human | autonomous                        │
│ • reflection analysis (Gemini self-criticism)               │
│ • strategy delta (what changed this gen)                    │
├─────────────────────────────────────────────────────────────┤
│ TIER 3 — Semantic Memory (compressed rollups)               │
│ • periodic Gemini consolidation every N generations         │
│ • "Aesthetic genome v12" — replaces stale heuristics        │
│ • interpretable, judge-friendly                             │
├─────────────────────────────────────────────────────────────┤
│ TIER 4 — Archive (sketch vault)                             │
│ • full GLSL + metadata per sketch                           │
│ • paginated gallery/timeline queries only                   │
│ • never loaded wholesale into generation prompt             │
└─────────────────────────────────────────────────────────────┘
```

### PLUS ↔ ShaderMind mapping

| PLUS (personalized RLHF) | ShaderMind |
|--------------------------|------------|
| User preference summary | Heuristic memory + strategy genome |
| Summary conditions reward model | Summary conditions Gemini generation prompts |
| Online co-adaptation loop | Generate → curate → reflect → evolve |
| Interpretable user representation | Heuristics, timeline, reflection log |

### Consolidation job (Tier 2 → Tier 3)

Trigger every **N generations** (default: 25):

1. Gather heuristics + reflections from last N generations
2. Gemini produces consolidated `memory_rollup` document
3. Replace redundant strategy timeline entries with rollup reference
4. Prune superseded heuristics; keep version history

---

## 3. Dual-Mode Learning Loop

Single pipeline, two curation sources. Controlled by `LEARNING_MODE` env var.

```
                    ┌─── GENERATE (Gemini) ───┐
                    ▼                         │
              [ Batch of 10 ]                 │
                    │                         │
         ┌──────────┴──────────┐              │
         ▼                     ▼              │
   HUMAN mode            AUTONOMOUS mode       │
   phase: awaiting_human  Gemini autoCurate    │
         │                     │              │
         └──────────┬──────────┘              │
                    ▼                         │
            [ EVOLVE strategy ]  ◄────────────┘
                    │
            [ CONSOLIDATE memory ]  (every N gens)
                    │
            [ NEXT GENERATION ]
```

| Mode | Env | Curation | Use case |
|------|-----|----------|----------|
| **human** | `LEARNING_MODE=human` | User Good/Bad + opinion | Hackathon 60s demo video |
| **autonomous** | `LEARNING_MODE=autonomous` | Gemini self-curate | Overnight / unattended runs |
| **hybrid** | `LEARNING_MODE=hybrid` | Human first; auto after timeout | Production fallback |

### Current implementation (pre-MongoDB)

- **human mode** is implemented: autopilot generates → pauses at `awaiting_human` → user submits `/api/feedback` → evolves → next batch
- **autonomous** curation code exists (`autoCurateBatch`) but is bypassed in human-gated loop
- **hybrid** not yet implemented (needs timeout + mode flag)

---

## 4. MongoDB Atlas Schema

### Collections

#### `agent_state` (singleton document)

```javascript
{
  _id: "shadermind",
  generationCount: Number,
  totalSketches: Number,
  successRate: Number,
  currentStrategy: String,
  heuristics: [String],           // Tier 1
  learningMode: "human|autonomous|hybrid",
  lastConsolidationGen: Number,
  metaphorGoal: 3650,             // Lieberman north star (not calendar)
  updatedAt: ISODate
}
```

#### `generations`

```javascript
{
  generation: Number,             // unique index
  timestamp: ISODate,
  goodCount: Number,
  badCount: Number,
  successRate: Number,
  curatorSource: "human|autonomous",
  userOpinion: String,
  reflection: String,           // Gemini analysis
  strategySnapshot: String,       // genome at this gen
  strategyDelta: String,          // optional diff summary
  memoryRollupId: ObjectId        // null until consolidated
}
```

#### `sketches`

```javascript
{
  id: String,                     // unique index e.g. sketch-gen5-3
  generation: Number,
  title: String,
  type: "evolutionary|directive|mutation",
  hypothesis: String,
  glsl: String,
  poetic_statement: String,
  dna: [String],
  rated: Boolean,
  rating: "good|bad|null",
  createdAt: ISODate
}
```

Indexes:

- `sketches`: `{ generation: 1 }`, `{ rating: 1, generation: -1 }`, `{ id: 1 }` unique
- `generations`: `{ generation: 1 }` unique
- `heuristics_history`: `{ version: 1 }`

#### `heuristics_history`

```javascript
{
  version: Number,
  generation: Number,
  heuristics: [String],
  approvalContext: String,
  createdAt: ISODate
}
```

#### `memory_rollups` (Tier 3)

```javascript
{
  fromGeneration: Number,
  toGeneration: Number,
  summary: String,                // consolidated aesthetic genome
  heuristics: [String],
  keyLearnings: [String],
  createdAt: ISODate
}
```

---

## 5. Storage Abstraction Layer

### Interface (`storage/` module)

```javascript
// storage/index.js — factory
export function createStorage() {
  if (process.env.MONGODB_URI) return new MongoStorage(process.env.MONGODB_URI);
  return new JsonStorage("./database.json");  // local dev fallback
}
```

### Required methods

| Method | Purpose |
|--------|---------|
| `getAgentState()` | Tier 1 working memory |
| `saveAgentState(partial)` | Update strategy/heuristics |
| `getGoodSketchesForRemix(limit=3)` | Tier 1 remix seeds |
| `insertGeneration(doc)` | Tier 2 episodic |
| `insertSketches(docs[])` | Tier 4 archive |
| `getSketchesPaginated({ gen, rating, page, limit })` | Gallery |
| `getStrategyTimeline({ limit, skip })` | Evolution view |
| `insertHeuristicsVersion(doc)` | Version history |
| `getLatestRollup()` | Tier 3 semantic |
| `insertRollup(doc)` | After consolidation |

### Migration script

`scripts/migrate-json-to-mongo.js`:

1. Read `database.json`
2. Upsert `agent_state`
3. Bulk insert `sketches`, `generations` (from `strategyTimeline` + `statistics.generations`)
4. Verify counts match

---

## 6. Prompt Context Budget (Tier 1 assembly)

Before each `/api/generate` call, assemble context:

```
1. currentStrategy (from agent_state)
2. top 5 heuristics
3. latest memory_rollup.summary (if exists, max 500 tokens)
4. last 3 good GLSL (truncated to ~80 lines each)
5. userOpinion or lastHumanOpinion
```

**Never** inject full sketch archive or full timeline into generation prompt.

---

## 7. Environment Variables

```bash
# Required
GEMINI_API_KEY=

# Storage
MONGODB_URI=                      # Atlas connection string
MONGODB_DB=shadermind

# Learning loop
LEARNING_MODE=human               # human | autonomous | hybrid
HYBRID_TIMEOUT_MS=300000          # 5 min before auto-curate in hybrid
CONSOLIDATION_EVERY_N=25

# Gemini (existing)
GEMINI_MODEL=gemini-2.5-flash
GEMINI_GLSL_MODEL=gemini-2.5-flash
GEMINI_ONLY=true
GEMINI_TIMEOUT_MS=90000
GLSL_CONCURRENCY=3

# Autopilot
AUTOPILOT=true
AUTOPILOT_INTERVAL_MS=45000
```

---

## 8. API Changes (planned)

| Endpoint | Change |
|----------|--------|
| `GET /api/sketches?page=1&limit=20` | Paginated archive |
| `GET /api/memory/rollup` | Latest Tier 3 summary |
| `POST /api/memory/consolidate` | Manual trigger consolidation |
| `GET /api/state` | Include `learningMode`, `memoryRollup` excerpt |
| `POST /api/feedback` | Record `curatorSource: "human"` |
| Autopilot cycle | Record `curatorSource: "autonomous"` when applicable |

---

## 9. Implementation Phases

### Phase 1 — Storage layer (blocked on Atlas credentials)

- [ ] Add `mongodb` npm dependency
- [ ] Implement `MongoStorage` + `JsonStorage`
- [ ] Migration script from `database.json`
- [ ] Swap `loadDB`/`saveDB` in `server.js` for storage abstraction
- [ ] **User provides `MONGODB_URI`**

### Phase 2 — Learning modes

- [ ] `LEARNING_MODE` env flag
- [ ] Wire autonomous path when `autonomous`
- [ ] Hybrid: `awaiting_human` with timeout → `autoCurateBatch` → evolve
- [ ] Record `curatorSource` on every generation

### Phase 3 — Tiered memory in prompts

- [ ] `assembleWorkingMemory()` helper
- [ ] Limit remix GLSL injection size
- [ ] Load latest rollup into generation + evolution prompts

### Phase 4 — Consolidation job

- [ ] `consolidateMemory()` Gemini call every N gens
- [ ] Write to `memory_rollups`
- [ ] Update `agent_state.lastConsolidationGen`
- [ ] Optional manual `/api/memory/consolidate`

### Phase 5 — Paginated UI

- [ ] Gallery loads current batch + paginated history
- [ ] Timeline fetches generations with limit/skip
- [ ] No full 3,650 load on client

### Phase 6 — Deploy

- [ ] DigitalOcean App Platform env: `MONGODB_URI`, `GEMINI_API_KEY`
- [ ] Atlas network access for DO egress
- [ ] Remove `database.json` from production writes (keep as dev fallback only)

---

## 10. MongoDB Atlas Setup Checklist (user action required)

- [ ] Create Atlas cluster (M0 free tier sufficient for hackathon)
- [ ] Create database user with read/write on `shadermind`
- [ ] Network Access: allow deploy IP or `0.0.0.0/0` for dev
- [ ] Copy connection string → `MONGODB_URI` in `.env`
- [ ] Confirm: migrate existing data or start fresh?
- [ ] Confirm: default `LEARNING_MODE` (recommend `human` for demo video)

**Connection string format:**

```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/shadermind?retryWrites=true&w=majority
```

Never commit `MONGODB_URI` to git. Use `.env` locally and platform secrets in production.

---

## 11. Hackathon Alignment Summary

| Criterion | How this plan delivers |
|-----------|------------------------|
| Continual Learning | Tiered memory + consolidation + dual-mode feedback loop |
| Gemini Special Prize | Gemini for generate, curate, evolve, consolidate, narrate |
| DigitalOcean | Express on App Platform; Atlas as managed persistence |
| Demo video | `LEARNING_MODE=human` — live curation + visible reflection |
| Not a wrapper | Stateful WebGL playground with evolving genome |
| 3,650 metaphor | Count toward north star; not calendar/streak mechanics |

---

## 12. Current Codebase Baseline (as of this doc)

| Component | Status |
|-----------|--------|
| Gemini-only batch pipeline | ✅ Implemented |
| Human-gated autopilot | ✅ Implemented |
| Gallery WebGL rendering | ✅ Fixed (padding-box + compileWhenReady) |
| `database.json` persistence | ✅ Active (to be replaced) |
| MongoDB | ❌ Not started |
| Learning mode flag | ❌ Not started |
| Memory consolidation | ❌ Not started |
| Paginated API | ❌ Not started |

---

## 13. Open Questions for User

1. **MongoDB Atlas URI** — ready to paste into `.env`?
2. **Migrate** existing 40 sketches / 4 generations or fresh Atlas DB?
3. **Default mode** — `human`, `autonomous`, or `hybrid`?
4. **Git remote** — GitHub repo URL for `git push`?
5. **Consolidation interval** — 25 generations acceptable?

---

*Document owner: ShaderMind / 2026 AI Engineer World's Fair*  
*Next action: user provides MongoDB Atlas `MONGODB_URI` → implement Phase 1*