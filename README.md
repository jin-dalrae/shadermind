# ShaderMind

Autonomous **WebGL GLSL** shader artist with **continual learning** — Gemini generates batches, humans curate with 1–5 ratings, the agent evolves strategy and memory.

**Hackathon:** 2026 AI Engineer World's Fair · Continual Learning track

---

## For AI agents — read this first

| Step | Document |
|------|----------|
| 1 | **[AGENTS.md](./AGENTS.md)** — handoff, repo map, API, env, **open bugs** |
| 2 | **[agents-learning-model.md](./agents-learning-model.md)** — LEARNING branch memory model |
| 3 | **[work/learning-feature.md](./work/learning-feature.md)** — spec + remaining work |

**Active branch:** `LEARNING` (`git checkout LEARNING && git pull`)

**Top open bug:** Chrome grid shows black shader cells — see [AGENTS.md § grid rendering](./AGENTS.md#known-open-bug-grid-rendering-still-failing).

---

## Quick start

```bash
git checkout LEARNING
cp .env.example .env          # only if .env missing — do not overwrite existing key
# Edit .env: GEMINI_API_KEY=your_key
npm install
npm run dev
# → http://localhost:8080/?v=5
npm test
```

Kill port 8080 if needed: `lsof -ti :8080 | xargs kill -9`

Set `AUTOPILOT=false` in `.env` to browse saved art without generating.

---

## Stack

Node.js · Express · vanilla JS · WebGL 1.0 · Google Gemini · SQLite + `database.json`

No build step. No frontend bundler.
