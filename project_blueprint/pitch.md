# Hackathon Pitch & Presentation Guide: ShaderMind

> **Hook:**
> *"Most AI art tools assume everyone wants the same thing. ShaderMind doesn't. It learns a readable model of aesthetic taste — and keeps rewriting it."*

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

**ShaderMind applies the same architecture to generative art:**

| PLUS | ShaderMind |
|---|---|
| User preference summary | **Heuristic memory + strategy genome** |
| Conditions reward model | Conditions **Gemini shader prompts** |
| Co-adaptation loop | Generate → curate → reflect → evolve |

---

## Slide 3: The Solution — ShaderMind

* **What it is:** An autonomous GLSL artist that runs continuously — generates 10 shaders, curates them, extracts heuristics, rewrites its strategy, repeats.
* **No input required** — autopilot drives the full loop. The gallery updates live.
* **Lieberman metaphor:** 3,650 sketches as a creative north star (Zach Lieberman's 10-year daily practice) — a **count metaphor**, not a calendar.
* **Output you can read:** Every generation leaves a trace — heuristics with approval rates, reflection notes, timeline milestones.

---

## Slide 4: The 5-3-2 Engine + Gemini

* **5 evolutionary** — remix code from prior approved shaders.
* **3 directive** — align to latest aesthetic opinion.
* **2 mutation** — test a stated hypothesis (*"polar coords + Voronoi ribbons?"*).
* **Gemini throughout:** Flash for planning/curation/evolution, Pro for GLSL code — no silent fallback to other models.

---

## Slide 5: Continual Learning Proof (for judges)

1. Open the gallery — 10 live shaders rendering.
2. Show **Mind** — heuristics like *"organic flow → 75% approval"*.
3. Show **Evolution** — Gen 1 vs Gen 2 strategy genome shift.
4. Show **Latest reflection** — agent self-criticism after curation.
5. Hit **Explain artistic evolution** — coherent monologue over the arc.

*The artifact isn't a single pretty shader. It's the readable preference model getting sharper.*

---

## 🎬 60-Second Demo Script

1. **0:00–0:12 | Hook**
   * *Visual:* Full-width dark gallery, 10 shaders animating.
   * *Script:* "ShaderMind is an autonomous artist inspired by PLUS — it learns a text summary of aesthetic taste and uses it to generate better shaders every cycle."

2. **0:12–0:30 | The Loop (no clicks needed)**
   * *Visual:* Autopilot pill shows *generating → curating → evolving*.
   * *Script:* "Watch: Gemini plans 10 sketches, writes GLSL, curates good and bad, then rewrites its own strategy genome."

3. **0:30–0:45 | Interpretability (PLUS parallel)**
   * *Visual:* Scroll to Mind — heuristics list + reflection log.
   * *Script:* "Like PLUS, the preference model is explicit text you can read — not a black-box score."

4. **0:45–1:00 | Proof**
   * *Visual:* Evolution timeline — Gen 1 rejected chaotic noise, Gen 2 favors damped organic flow.
   * *Script:* "The next batch is already different. That's continual learning — powered entirely by Gemini."

---

## Citation (for slides / README)

```
Nam, H., Wan, Y., Liu, M., Ahnn, P., Lian, J., & Jaques, N. (2025/2026).
Learning to summarize user information for personalized reinforcement
learning from human feedback. arXiv:2507.13579.
https://arxiv.org/abs/2507.13579
```