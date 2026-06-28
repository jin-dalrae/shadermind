# Hackathon Pitch & Presentation Guide: ShaderMind

> **Hook:**
> *"An agent that draws. You steer. It learns your taste — until you become the artist you wanted to be."*

> **Document status:** Updated 2026-06-28 to match the implementation on `LEARNING` branch. Earlier revisions claimed Gemini-only inference and a fixed 5-3-2/10-shader batch. The runtime is multi-model (DigitalOcean primary with Gemini fallback) with a configurable batch. Voice curator and pattern library added since the original pitch.

---

## Slide 1: The Problem — One Reward Model for Everyone

* **RLHF's blind spot:** Standard alignment treats all users as one population — a single reward model, one taste ([Bradley-Terry limitation](https://arxiv.org/abs/2507.13579)).
* **Creative tools today:** Prompt → image. No memory, no evolving judgment, no inspectable preference model.
* **Our question:** Can an agent *summarize what it has learned about taste* and use that summary to get better over time?

---

## Slide 2: Research Inspiration — PLUS

**[Learning to summarize user information for personalized RLHF](https://arxiv.org/abs/2507.13579)** (Nam et al., arXiv:2507.13579)

* PLUS learns **text summaries of user preferences** and uses them to condition a reward model.
* Summarizer and reward model **co-adapt online** — neither is frozen.
* Result: **11–77% better reward accuracy**, interpretable user representations, robust personalization.

**ShaderMind applies the same architecture to generative art, with extra layers:**

| PLUS | ShaderMind |
|---|---|
| User preference summary | **Heuristic memory + strategy genome + `preferenceMemory` (prefer/avoid)** |
| Conditions reward model | Conditions **multi-model shader prompts** (DO pools + Gemini fallback) |
| Co-adaptation loop | Generate → curate → **critique → preference memory → reflect → evolve** |
| Single text summary | **Plus a curated pattern library** ranked by rating × usage |
| Static user representation | Inspectable strategy timeline + per-shetch critique + voice curator |

---

## Slide 3: The Solution — ShaderMind

* **What it is:** An **agentic drawing tool** for shader art — it writes GLSL; the human steers with 1–5 ratings and becomes the artist.
* **Human-in-the-loop (default):** You don't prompt-and-pray. You curate batches, the agent learns your taste, remixes the last good sketch with one small change. Autonomous and hybrid modes available.
* **Lieberman spirit:** [everyday sketches](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d) — change a little from the previous one, toward what you love. **3,650** is the north-star count, not a calendar.
* **Readable learning:** Heuristics, preference memory, reflection notes, per-sketch critique — taste you can inspect, not a black-box score.
* **Voice curator:** Talk to ShaderMind in a LiveKit room — the agent joins, asks about your taste, and submits ratings on your behalf.

---

## Slide 4: The Adaptive Engine — Multi-Model Inference + Adaptive Batch

* **Per-task model pools on DigitalOcean Inference:**
  * GLSL → `qwen3-coder-flash → glm-5.2 → llama3.3-70b-instruct`
  * Planning → `qwen3-coder-flash → llama3.3-70b-instruct → mistral-3-14B`
  * Evolution → `deepseek-4-flash → llama-4-maverick → llama3.3-70b-instruct`
  * Curation / Narrative / Consolidation → task-specific pools
* **Gemini fallback** (opt-in): `gemini-3.5-flash` only when `ALLOW_GEMINI_FALLBACK=true` AND the DO pool exhausts. Demo runs on DO by default; toggle on for a Gemini-pure path.
* **Adaptive batch composition** — `getBatchDistribution(BATCH_SIZE)`:
  * Default `BATCH_SIZE=3` → 1 evolutionary / 1 directive / 1 mutation (fast demo cadence)
  * `BATCH_SIZE=10` → the canonical 5 evolutionary / 3 directive / 2 mutation
  * Each slot: evolutionary remixes from a prior approved shader; directive aligns to latest opinion; mutation tests a stated hypothesis
* **Pipeline modes:** `fast` (one multi-shader inference + repair pool) or `staged` (plan → N parallel GLSL calls → similarity novelty retry).
* **Validation pipeline:** decode → sanitize ES 1.0 → length/main/gl_FragColor/banned-pattern/low-effort check → similarity guard → fallback template.

---

## Slide 5: Continual Learning Proof (for judges)

1. Open the gallery — live shader grid animates.
2. Hit **Talk to ShaderMind** — voice curator joins, asks about your taste, submits ratings.
3. Show **Mind** — heuristics, **`preferenceMemory.prefer[]` / `avoid[]`**, pattern library rank.
4. Show **Evolution** — Gen 1 vs Gen 2 strategy genome shift, per-shetch critique diff.
5. Show **Latest reflection** — agent self-criticism after curation.
6. Hit **Explain artistic evolution** — coherent monologue over the arc.

*The artifact isn't a single pretty shader. It's the readable preference model getting sharper — and the inspection path stays open.*

---

## Slide 6: Code-Aware Learning (the PLUS-extension)

ShaderMind doesn't just track your ratings — it learns from your code.

* **Ranked example retrieval** — top 2 high-rated shaders (rating ≥ 4, compiled successfully, prior generation) injected as GLSL context for evolutionary slots; 1 for directive; 0 for mutation.
* **Preference memory with evidence** — `prefer[]` / `avoid[]` rules built from weighted ratings (explicit > autonomous > defaulted) and compiled-feedback. Compile-failed shaders can't masquerade as good examples.
* **Similarity guard** — Jaccard 5-shingle check at 0.82 threshold forces novelty retry when results drift too close to archive.
* **Per-sketch critique** — batched Gemini call after each batch returns `strengths / weaknesses / reusablePatterns / avoidPatterns` per sketch, feeding next cycle's evidence.
* **Curated pattern library** — `GET /api/shader-library` exposes reusable patterns (FBM, polar, ripple, mouse-reactive flow) ranked by rating × usage, surfaced into the prompt so the agent knows which techniques are working.

---

## Slide 7: Production-Ready Plumbing

* **Multi-instance safe:** `pendingBatch` round-trips through MongoDB Atlas; `generationLock` ensures only one instance generates at a time. Deploy to DO App Platform and connect a local dev Studio to the same Atlas — they share state.
* **Three storage backends:** MongoDB Atlas (production, fails fast — no silent JSON fallback), SQLite + JSON mirror (local dev with `USE_SQLITE=true`), JSON-only (default dev).
* **Compile evidence loop:** Browser reports compile success/failure during curation → server excludes compile-failed sketches from positive example retrieval, even at 4–5 stars.
* **Async evolution:** Submit feedback → server returns immediately; strategy evolves in the background; the next batch reads updated memory.

---

## 🎬 60-Second Demo Script

1. **0:00–0:12 | Hook**
   * *Visual:* Full-width dark gallery, shader grid animating.
   * *Script:* "ShaderMind is an autonomous artist inspired by PLUS — it learns a text summary of aesthetic taste and uses it to generate better shaders every cycle."

2. **0:12–0:30 | The Loop (no clicks needed)**
   * *Visual:* Autopilot pill shows *generating → awaiting human → evolving*.
   * *Script:* "Watch: DigitalOcean inference writes GLSL, the human rates 1–5, the agent critiques each sketch, rebuilds preference memory, and rewrites its own strategy genome."

3. **0:30–0:45 | Code-Aware Inheritance (PLUS parallel)**
   * *Visual:* Mind panel showing top heuristics + `preferenceMemory.prefer[]` + pattern library rank.
   * *Script:* "Like PLUS, the preference model is explicit text you can read — plus the agent retrieves your best-rated shaders as concrete references for the next batch."

4. **0:45–1:00 | Voice Curator + Proof**
   * *Visual:* Click **Talk to ShaderMind** — LiveKit room opens, agent speaks. Then Evolution timeline — Gen 1 rejected chaotic noise, Gen 2 favors damped organic flow.
   * *Script:* "Talk to ShaderMind in a LiveKit room — the curator asks about your taste and submits ratings for you. The next batch is already different. That's continual learning."

---

## Citation (for slides / README)

```
Nam, H., Wan, Y., Liu, M., Ahnn, P., Lian, J., & Jaques, N. (2025/2026).
Learning to summarize user information for personalized reinforcement
learning from human feedback. arXiv:2507.13579.
https://arxiv.org/abs/2507.13579

DigitalOcean Inference — https://docs.digitalocean.com/products/gradient-ai-platform/how-to/use-serverless-inference/
```