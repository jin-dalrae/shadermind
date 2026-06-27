# ShaderMind — Code-Aware Learning Feature Plan

> Status: core feature implemented on branch `LEARNING`; snippet memory and tuning remain planned  
> Scope: learn from rated shader code without cloning past work  
> Principle: retrieve strong examples, distill reusable lessons, and preserve exploration

## 1. Goal

Use human ratings and working GLSL as learning signals for future generations.

Each new batch should learn from:

- a small set of relevant, high-rated shader examples;
- concise preference rules distilled from 1–5 ratings;
- technical outcomes such as compile success or failure;
- an explicit novelty requirement that prevents near-copies.

The feature should improve visual quality over time while keeping ShaderMind capable of surprise.

## 2. Current Baseline

ShaderMind already has an early form of example memory:

- `buildRemixSection()` selects the last three sketches rated `good`;
- it injects their complete GLSL, DNA tags, and descriptions into metadata generation;
- `evolveStrategyInternal()` rewrites the strategy and heuristics after feedback.

The current path has important limits:

- selection is based only on recency, not relevance or quality;
- full shaders are inserted without a size budget;
- raw GLSL is sent to metadata planning but not to the per-shader GLSL writer;
- compile success is visible in the browser but is not persisted;
- critique exists at the batch level, not per sketch;
- there is no similarity check or diversity guard;
- unrated sketches defaulted to `bad`, losing useful preference detail.

This plan replaces the current remix behavior; it does not add a second competing memory path.

## 3. Learning Model

Use two complementary memory types.

### 3.1 Example memory

Stores concrete shader evidence:

- GLSL source;
- generation prompt and focus;
- human rating;
- DNA/style tags;
- compile result and error summary;
- concise agent critique;
- derived code features;
- source generation and timestamp.

Example memory answers: **Which past techniques are worth revisiting for this concept?**

### 3.2 Rule memory

Stores short, interpretable lessons distilled across examples:

- preferred motion, composition, palette, and complexity;
- disliked visual or technical patterns;
- estimated support, based on rated examples;
- confidence and last-updated generation.

Rule memory answers: **What has the curator consistently preferred or rejected?**

## 4. Data Model Changes

Extend each sketch in `database.json` without requiring MongoDB first:

```javascript
{
  // Existing fields remain unchanged.
  generationFocus: String,
  prompt: String,
  rating: 1 | 2 | 3 | 4 | 5 | null,
  ratingSource: "explicit|defaulted|autonomous|null",
  compile: {
    success: Boolean | null,
    error: String | null,
    reportedAt: String | null
  },
  critique: {
    strengths: [String],
    weaknesses: [String],
    reusablePatterns: [String],
    avoidPatterns: [String]
  },
  codeFeatures: {
    functions: [String],
    techniques: [String],
    palette: [String],
    motion: [String],
    composition: [String],
    complexity: "low|medium|high|null"
  }
}
```

Add versioned rule memory at the database root:

```javascript
{
  preferenceMemory: {
    version: Number,
    updatedAtGeneration: Number,
    prefer: [{ rule: String, support: Number, confidence: Number }],
    avoid: [{ rule: String, support: Number, confidence: Number }]
  }
}
```

All new fields must be optional so existing `database.json` records continue to load.

## 5. Feedback Capture

### Human rating

Use a required 1–5 rating for every shader:

- `1` — strong dislike;
- `2` — dislike;
- `3` — neutral or mixed;
- `4` — like;
- `5` — strong like.

Do not invent scores for unrated shaders. Existing `good` and `bad` archive records map to `5` and `1` for backward compatibility.

### Compile result

Add a lightweight client report after `ShaderRenderer.compileWhenReady()` reaches a final success or failure state.

Recommended endpoint:

```text
POST /api/sketches/:id/compile-result
```

Payload:

```json
{
  "success": true,
  "error": null
}
```

Requirements:

- reports are idempotent;
- errors are truncated and sanitized;
- temporary zero-size-canvas retries are not stored as compile failures;
- compile failure excludes a shader from positive example retrieval, even if it was rated `4` or `5`.

### Per-sketch critique

After feedback, use one batched Gemini call to critique the rated sketches and extract reusable patterns. Do not add ten independent critique calls.

The critique response should be structured JSON and stored on each sketch. If critique generation fails, feedback persistence and strategy evolution must still succeed.

## 6. Retrieval

Add `selectLearningExamples(db, targetConcept, options)` as the only entry point for raw-code retrieval.

### Candidate filter

A positive example must:

- have a rating of `4` or `5`;
- not have `compile.success === false`;
- contain usable GLSL;
- not be the current sketch or batch;
- fit within the configured context budget.

### Ranking

Rank candidates using deterministic local signals before considering embeddings or a database migration:

```text
score =
  0.40 * tag similarity
  + 0.20 * technique similarity
  + 0.15 * curator confidence
  + 0.15 * recency
  + 0.10 * compile confidence
```

Notes:

- explicit human feedback receives more weight than autonomous feedback;
- missing compile data is neutral, not equal to success;
- repeated examples receive a cooldown penalty;
- final selection uses maximal marginal relevance so the chosen examples are relevant to the target but different from one another.

Start with normalized DNA/tag overlap and extracted code features. Add embeddings only after this baseline can be evaluated.

### Retrieval size

- metadata planner: rule summary only; no full GLSL;
- evolutionary GLSL writers: up to two relevant examples;
- directive GLSL writers: zero or one example when it matches the user focus;
- mutation GLSL writers: no raw examples by default, only avoid rules and a novelty brief.

Set both a per-example character limit and a total context limit. Truncate at function boundaries where possible, never in the middle of a GLSL token.

## 7. Snippet Extraction

Full-shader retrieval is the first safe milestone. Snippet extraction follows after retrieval quality is measurable.

Extract reusable units such as:

- palette functions;
- noise or signed-distance functions;
- coordinate transforms;
- radial or symmetry composition;
- time and mouse modulation.

Each snippet should carry its source sketch ID, technique label, and dependency list. If a snippet depends on undeclared helpers or globals, include its dependencies or fall back to the full compact shader.

Do not assemble snippets from different shaders automatically in the first version. Ask Gemini to learn from the selected snippets while writing a complete, self-contained shader.

## 8. Preference Distillation

Replace unsupported approval-rate prose with rating averages derived from stored evidence.

After each rated batch:

1. combine 1–5 ratings, critiques, DNA tags, and code features;
2. compare average ratings and support for each pattern;
3. update a small set of `prefer` and `avoid` rules;
4. attach support and confidence values;
5. pass the evidence summary into strategy evolution.

Example:

```text
Prefer:
- Slow sinusoidal motion with centered radial structure (4.4/5 average, 8 rated)

Avoid:
- High-frequency time modulation that produces flicker (1.7/5 average, 7 rated)
```

Keep the active prompt block short: at most five preference rules and three avoid rules. Historical rules remain in storage but are not all injected.

## 9. Prompt Assembly

Replace `buildRemixSection()` with separate, budgeted helpers:

```javascript
buildPreferenceSummary(db)
selectLearningExamples(db, targetConcept, options)
buildExampleContext(examples, budget)
buildNoveltyBrief(targetConcept, examples)
```

### Metadata prompt

Include:

- current strategy;
- distilled preference and avoid rules;
- compact descriptions of relevant examples;
- batch diversity requirements.

Do not include raw GLSL.

### Per-shader GLSL prompt

Include:

- the selected concept and DNA;
- relevant examples or snippets according to sketch type;
- an instruction to reuse principles, not exact structure;
- a novelty brief naming patterns that must differ;
- GLSL ES 1.0 constraints.

Example instruction:

```text
Study the references for motion quality, composition, and color relationships.
Create a distinct shader. Do not reproduce their constants, function structure,
coordinate pipeline, or palette sequence verbatim.
```

## 10. Exploitation and Exploration

Preserve the existing 5–3–2 batch structure and interpret it as an 80/20 learning policy:

| Batch slots | Role | Memory use |
|-------------|------|------------|
| 5 evolutionary | Exploit proven patterns | Rules + relevant examples |
| 3 directive | Apply curator focus | Rules + optional example |
| 2 mutation | Explore unfamiliar space | Avoid rules + novelty brief |

Mutation slots should intentionally use underrepresented tags or techniques. Their failure should be treated as useful exploration evidence, not as a reason to remove exploration from later batches.

## 11. Diversity and Anti-Copy Guard

Before accepting generated GLSL:

1. normalize whitespace and comments;
2. compare token shingles with retrieved and archived shaders;
3. compare extracted features and DNA overlap;
4. reject or regenerate outputs above the configured similarity threshold.

Initial guardrails:

- exact normalized-code match: always reject;
- high token similarity to any source example: regenerate once with a stronger novelty brief;
- repeated title, palette constants, or function layout: apply a novelty penalty;
- repeated regeneration failure: keep the valid shader but mark it `similarityWarning: true` for evaluation.

Use a local deterministic comparison first. Do not require another model call solely to judge novelty.

## 12. Implementation Phases

### Phase 1 — Evidence capture

- [x] Extend `DEFAULT_DB` and sketch normalization for optional learning fields.
- [x] Save generation focus and prompt context with every sketch.
- [x] Capture required explicit 1–5 ratings.
- [x] Persist final WebGL compile results.
- [x] Add one batched per-sketch critique call after feedback.

### Phase 2 — Budgeted example retrieval

- [x] Replace `buildRemixSection()` with `selectLearningExamples()`.
- [x] Add deterministic feature extraction and ranking.
- [x] Add example cooldown and diversity selection.
- [x] Remove raw GLSL from metadata generation.
- [x] Inject up to two selected examples into relevant GLSL generation calls.
- [x] Add prompt character budgets and retrieval diagnostics.

### Phase 3 — Rule memory

- [x] Derive preference evidence from 1–5 ratings.
- [x] Store versioned `preferenceMemory`.
- [x] Limit active rules by confidence and support.
- [x] Feed evidence-backed rules into metadata, GLSL, and evolution prompts.

### Phase 4 — Novelty enforcement

- [x] Add normalized GLSL fingerprinting.
- [x] Add token-shingle similarity checks.
- [x] Regenerate high-similarity results once.
- [x] Store similarity score, source IDs, and warning state.
- [ ] Track diversity across each 10-sketch batch.

### Phase 5 — Snippet memory

- [ ] Extract self-contained functions and technique blocks.
- [ ] Validate snippet dependencies.
- [ ] Rank snippets independently from full shaders.
- [ ] Prefer snippets when they use less context without losing meaning.

### Phase 6 — Evaluate and tune

- [ ] Compare learned retrieval against the existing last-three-good baseline.
- [ ] Tune ranking weights and context limits from observed results.
- [ ] Review whether mutation outputs remain meaningfully distinct.
- [ ] Decide whether embeddings are justified by measured retrieval failures.

## 13. Diagnostics

Record learning decisions for every generated sketch:

```javascript
{
  learningContext: {
    preferenceMemoryVersion: Number,
    exampleIds: [String],
    retrievalScores: [Number],
    contextCharacters: Number,
    policy: "exploit|directive|explore",
    similarityScore: Number | null,
    similarityWarning: Boolean
  }
}
```

Expose only a compact summary in existing API responses. Keep enough detail in storage to answer:

- which examples influenced this shader;
- which rules were active;
- why an example was selected;
- whether the result was too similar;
- whether the learning policy improves approval over time.

## 14. Testing Strategy

Add Node tests for pure learning helpers before testing Gemini behavior:

- candidate filtering excludes ratings below 4 and known-broken shaders;
- retrieval favors relevant tags without returning near-duplicate examples;
- missing compile data remains eligible but neutral;
- context builders obey hard size limits;
- old database records load with defaults;
- human and autonomous ratings receive different confidence weights;
- novelty checks catch copied code and allow structurally distinct shaders;
- 5–3–2 generation preserves eight exploit/directive and two explore slots.

Use fixed fixture sketches so ranking and similarity tests are deterministic.

For an end-to-end smoke test:

1. generate a batch;
2. rate every shader from 1 to 5;
3. confirm compile and critique evidence is saved;
4. generate the next batch;
5. confirm only relevant examples are injected;
6. verify mutation slots receive no raw example code;
7. verify a deliberate near-copy is rejected or flagged.

## 15. Success Metrics

Track metrics over rolling generations rather than judging a single batch:

| Metric | Desired direction |
|--------|-------------------|
| Human approval rate | Increase |
| Compile success rate | Increase or remain high |
| Average prompt context size | Remain within budget |
| Duplicate/similarity warnings | Decrease |
| Unique DNA and technique coverage | Remain stable or increase |
| Mutation approval rate | Informative, not necessarily maximal |
| Retrieval reuse concentration | No single example dominates |

The feature is successful when approval improves without collapsing technique diversity or repeatedly selecting the same source shaders.

## 16. Rollout and Safety

Add a temporary feature flag:

```bash
CODE_AWARE_LEARNING=false
```

When disabled, generation uses strategy and heuristics without raw-code retrieval. When enabled, diagnostics record all selections and similarity scores.

Rollout order:

1. capture evidence without changing prompts;
2. run retrieval in shadow mode and inspect selections;
3. enable example context for evolutionary slots;
4. enable rule memory for all slots;
5. enable novelty regeneration;
6. add snippet retrieval only after the full-shader path is stable.

This work should remain compatible with the planned storage abstraction. Learning helpers should accept plain data objects so `database.json` can later be replaced by MongoDB without rewriting the learning policy.

## 17. Definition of Done

- Rated sketches persist prompt, rating-source, compile, critique, and feature evidence.
- Retrieval selects two to four relevant high-quality references per batch, within a hard context budget.
- Raw GLSL is used only by the per-shader writer when appropriate.
- Preference and avoid rules are evidence-backed and interpretable.
- The 5–3–2 batch keeps two explicit exploration slots.
- Near-copy detection rejects or flags overly similar results.
- Existing databases load without migration failures.
- Pure retrieval, budgeting, and similarity helpers have deterministic tests.
- Diagnostics make each generation's learning context inspectable.
