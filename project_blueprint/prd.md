# Product Requirement Document (PRD): ShaderMind

## Project Name: ShaderMind
### *An Autonomous Research Prototype on Machine Creativity*

---

## 1. Executive Summary

ShaderMind is an **agentic drawing tool** for shader art: the agent writes GLSL; the **user** steers with ratings and notes and, over everyday sketches, **becomes the artist**. It learns the user's taste — not a global average — and nudges each batch a small step from the last toward what they love and wanted to see.

Rather than prompt-and-forget generation, ShaderMind builds preference memory and a strategy genome from curation. The visible output is live shader art; the real artifact is the user's sharpening eye and the agent's learned model of their taste.

### Research Grounding — PLUS (arXiv:2507.13579)

ShaderMind is conceptually aligned with **Preference Learning Using Summarization (PLUS)** ([Nam et al., 2025/2026](https://arxiv.org/abs/2507.13579)):

| PLUS (personalized RLHF) | ShaderMind (creative continual learning) |
|---|---|
| Text summaries of user preferences | **Heuristic memory** + **strategy genome** |
| Summaries condition a reward model | Summaries condition **Gemini generation prompts** |
| Online co-adaptation (summarizer ↔ reward) | Online co-adaptation (curation ↔ reflection ↔ next batch) |
| Interpretable user representation | Inspectable heuristics, timeline, reflection logs |
| Rejects one-size-fits-all Bradley-Terry reward | Rejects static prompt — taste **evolves per generation** |

PLUS shows that compressing preference history into explicit, readable summaries outperforms monolithic reward models. ShaderMind applies the same insight to **generative art**: the agent's "user model" is its evolving aesthetic manifesto, not a black-box score.

### Hackathon Strategic Alignment

* **Theme:** **Continual Learning** — the system improves *how* it generates, not just *what*, through a self-reflective policy loop.
* **Special Prize:** **Google Gemini** — batch pipeline uses Gemini exclusively (`gemini-2.5-flash` for planning/curation/evolution, `gemini-2.5-pro` for GLSL synthesis).

---

## 2. Core Concept

**Framing:** Research prototype on machine creativity — an AI that develops aesthetic judgment, artistic heuristics, and self-reflective generation strategies.

**Lieberman spirit:** Learn from everyday sketches — each generation changes a bit from the last approved work, steering toward what the curator loves and wanted to see ([essay](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d)). The 3,650 count is a *north-star metaphor* for that arc — not a calendar, streak tracker, or day counter.

---

## 3. System Views (Current Implementation)

The app is a single scrolling experience with four regions:

### Studio (Gallery)
* **Full-width shader grid** — 10 live WebGL canvases per batch (`u_time`, `u_resolution`, `u_mouse`).
* **Autonomous by default** — no user input required. Autopilot generates, self-curates, and evolves continuously.
* **5-3-2 batch composition:**
  * **5 evolutionary** — remix learned heuristics + prior "good" shader code.
  * **3 directive** — respond to latest curator opinion / aesthetic focus.
  * **2 mutation** — test an explicit mathematical hypothesis (shown on card).
* Good/bad badges on each cell; click to expand fullscreen.

### Latest Reflection
* Most recent self-criticism from the policy update step.
* Collapsible **active strategy genome** (the PLUS-analogue preference summary).

### Evolution Timeline
* Real milestones only — one entry per generation with strategy notes and thumbnails of approved shaders.
* No placeholder/fake epochs.

### Mind
* **Learned heuristics** with approval-rate estimates (e.g. `→ 78% approval rate`).
* **Reflection log** — chronological strategy mutations.
* **Explain artistic evolution** — Gemini-generated monologue over lifetime metrics.

---

## 4. Continual Learning Mechanisms

```
[ Autonomous Curation (Gemini) ] ──► [ Good/Bad Votes ]
              │                              │
              │    (optional manual override) │
              ▼                              ▼
                    [ Policy Update (Gemini) ]
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
[ Heuristic Memory ]  [ Strategy Genome ]   [ Hypothesis Mutation ]
 PLUS-like summary    Persona prompt         Systematic curiosity
 of what works        rewrite for next       in 2 shaders/batch
```

1. **Heuristic Memory (PLUS analogue):** Extract abstract, human-readable rules from curation — not raw shader caching alone.
2. **Strategy Genome Evolution:** Rewrite the full generation manifesto stored in `database.json` after each batch.
3. **Hypothesis-Driven Mutation:** Mutation shaders ship with an explicit, inspectable hypothesis string.
4. **Autonomous Autopilot:** Server-side loop — generate → curate → evolve → repeat — with live UI polling.

---

## 5. Technical Architecture

| Layer | Stack |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, editorial gallery UI, WebGL 1.0 renderer |
| Backend | Node.js + Express |
| Storage | `database.json` (strategy timeline, heuristics, sketches) |
| AI | DigitalOcean Inference (primary) — per-task multi-model routing + optional Inference Router; Gemini fallback |
| Deploy | DigitalOcean App Platform / Docker on port 8080 |

### Generation pipeline (Gemini-maximized)
1. **Metadata plan** — 10 concepts as JSON (`gemini-2.5-flash`)
2. **GLSL synthesis** — per-shader code (`gemini-2.5-pro`, fallback to flash)
3. **Autonomous curation** — rate all 10 (`gemini-2.5-flash`)
4. **Strategy evolution** — update heuristics + genome (`gemini-2.5-flash`)

### Out of scope
* Vision/screenshot analysis at runtime
* Multi-user accounts
* Local ML training (Gemini heuristic mapping instead)
* Calendar/streak/day tracking

---

## 6. Success Metrics & Demo Proof

* **Visual evolution** — shader quality and coherence improve across generations.
* **Interpretable preference model** — judges can read heuristics and strategy genome (PLUS-style transparency).
* **Self-correction** — next batch visibly shifts after rejection patterns (e.g. less high-frequency noise).
* **Narrative depth** — "Explain artistic evolution" monologue synthesizes the arc convincingly.
* **Gemini centrality** — demo and logs show Gemini driving every batch step.

---

## 7. References

* Nam, H., Wan, Y., Liu, M., Ahnn, P., Lian, J., & Jaques, N. (2025/2026). *Learning to summarize user information for personalized reinforcement learning from human feedback.* arXiv:2507.13579. https://arxiv.org/abs/2507.13579
* Lieberman, Z. — [*I spent 10 years making a sketch in code every day*](https://zachlieberman.medium.com/i-spent-10-years-making-a-sketch-in-code-every-day-and-heres-what-i-learned-b845e811160d) (metaphorical framing for 3,650 sketch goal)