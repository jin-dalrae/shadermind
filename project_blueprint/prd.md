# Product Requirement Document (PRD): ShaderMind

## Project Name: ShaderMind
### *An Autonomous Research Prototype on Machine Creativity*

---

## 1. Executive Summary
ShaderMind is an experiment in machine creativity — an autonomous AI artist that doesn’t just generate GLSL shader art, but actively develops its own artistic taste, heuristics, and generative strategies through continual learning.

Rather than simple retrieval from "good" examples, ShaderMind builds and refines artistic principles over time. It hypothesizes new techniques, maintains evolving rules about user preferences, and periodically rewrites parts of its own creative persona. The visible output is beautiful real-time shader art, but the real artifact is the learning process itself.

### Hackathon Strategic Alignment:
* **Theme Alignment:** **Continual Learning**. The system improves *how* it generates art, not just *what* it generates, through a dynamic, human-in-the-loop meta-learning policy loop.
* **Special Prize Target:** **Google Gemini Special Prize**. Direct usage of Gemini (e.g. `gemini-2.5-flash` or `gemini-2.5-pro`) to perform structured code synthesis, self-reflection logging, and prompt strategy evolution.

---

## 2. Core Concept Shift
* **Old Framing:** Self-improving shader generator.
* **New Framing:** **Research prototype on machine creativity — an AI that develops aesthetic judgment, artistic heuristics, and self-reflective generation strategies.**

This reframing moves the project away from a "novelty toy" or utility dashboard and positions it as a sophisticated, intellectually compelling AI research demo.

---

## 3. The 3-Page System Specifications

### Page 1: The Studio (Generate)
* **Real-time 10-Shader Grid:** Lightweight WebGL canvases compiling and rendering GLSL fragment shaders on the fly using standard interactive uniforms (`u_time`, `u_resolution`, `u_mouse`).
* **Binary Curation & Opinions:** Users rate each of the 10 shaders as **"Good"** (Approved) or **"Bad"** (Rejected) and can provide optional textual aesthetic directives.
* **The 5-3-2 Evolutionary Strategy (Enhanced):**
  * **5 Evolutionary Shaders:** Built by applying current learned heuristics, successful patterns, and "code from yesterday."
  * **3 Directive Shaders:** Direct, high-alignment responses to the user's latest text feedback.
  * **2 Mutation / Hypothesis Shaders:** The agent proposes and tests a specific artistic hypothesis (e.g., *"What if we combine Voronoi with logarithmic polar coordinates to create ribbon-like rotational motion?"*), testing its boundary and documenting its expectations.

### Page 2: Evolution Timeline
*This page replaces the standard statistics dashboard, providing a visually compelling and immediate proof of continual learning:*
* **Artistic Journey Scroll:** A vertical timeline chronicling the agent's growth across generation epochs:
  * **Gen 1 → Early Chaotic Attempts:** Raw geometric structures, default color coordinates, high-frequency noise.
  * **Gen 24 → Emerging Patterns:** Fluid curves, basic lighting coordination, emerging user-favored color palettes.
  * **Gen 120 → Refined Techniques:** Symmetric coordination, complex noise blending, smooth interactive feedback loops.
  * **Gen 310+ → Gallery-Quality Work:** Masterful mathematical compositions with a highly recognizable, cohesive artistic signature.
* **Milestone Inspection:** Each timeline milestone showcases representative sketches, their compilation states, and the specific **key learned principles** discovered during that generation block.

### Page 3: The Mind (Reflection & Learning)
* **Current Learned Heuristics Console:** Displays a clean list of explicit mathematical rules the agent has extracted from user votes, such as:
  * `"Radial symmetry + slow motion → 78% approval rate"`
  * `"User favors monochrome gradients over high-frequency primary color saturation"`
  * `"High-frequency fractional Brownian motion is consistently rejected"`
* **Self-Reflection Log Console:** Streams a scrolling, real-time command-line log of the agent's internal thought processes during strategy updates.
* **"Explain Your Artistic Evolution" (The Killer Feature):** A button prompting the agent to deliver a structured, highly coherent narrative monologue summarizing how its taste, mathematical techniques, and creative goals have shifted across its lifecycle (e.g., *"In my early generations, I overused unattenuated Perlin noise, which resulted in chaotic rejection. My success rate improved from 22% to 84% once I synthesized rotational wave harmony..."*).

---

## 4. Continual Learning Mechanisms

```
[ User Curation & Opinion ] ──► [ Good/Bad Votes ]
                                       │
                                       ▼
                         [ Policy Update Step (Gemini) ]
                                       │
       ┌───────────────────────────────┴───────────────────────────────┐
       ▼                               ▼                               ▼
[ Heuristic Memory ]       [ Persona Prompt Evolution ]     [ Hypothesis-Driven Mutation ]
- Extract rules on math    - Periodic self-rewrite of       - Propose & justify new GLSL
  patterns & preferences     system generation prompts        formula combinations
```

1. **Heuristic Memory:** Instead of just caching raw shaders, the backend extracts and indexes abstract rules about what mathematical techniques work (e.g. noise types, color maps, movement speeds) based on preference matrices.
2. **Dynamic Persona Prompt Evolution:** The agent periodically conducts a meta-analysis on its history, rewriting sections of its system prompt/manifesto (stored dynamically in the database) to reduce random noise and bias towards user-favored aesthetic standards.
3. **Hypothesis-Driven Mutation:** Instead of throwing random math at the wall, mutation shaders are designed under an explicit hypothesis written by the model, proving systematic curiosity.
4. **Policy Update Step:** Following each batch, the agent reflections update the database state, evolving the strategy guide used to prompt the next 10-piece generation.

---

## 5. Technical Architecture

* **Frontend:** Vanilla HTML5 + CSS3 (glassmorphic dark cybernetic design) + WebGL shader renderer with full-screen quad compilation.
* **Backend:** Node.js + Express.
* **Storage:** Persistent local JSON state database (`database.json`), keeping the application lightweight, container-independent, and lightning-fast.
* **AI Orchestration:** Official Gemini API SDK.

### Out of Scope (Hackathon Constraints):
* Vision-based screenshot analysis at runtime (bypassed for latency and stability; client compilation error reporting handles code quality seamlessly).
* Multi-user account infrastructure.
* Complex machine learning models running locally (replaced by high-efficiency heuristic mapping via Gemini).

---

## 6. Success Metrics & Demo Proof
* **Visual Evolution:** Clear, visible advancement in shader complexity and color harmony over generations.
* **Narrative Sophistication:** A moving, cohesive "Artistic Evolution" monologue that wows judges.
* **Proof of Concept:** Shows the agent correcting itself in real-time (the very next batch) when the user rejects a specific visual pattern.
