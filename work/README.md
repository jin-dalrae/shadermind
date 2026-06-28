# Work docs

Planning and specs for ShaderMind. **Agents:** start at [../AGENTS.md](../AGENTS.md), not here.

| File | Status | Purpose |
|------|--------|---------|
| [learning-feature.md](./learning-feature.md) | Mostly implemented on `LEARNING` | Code-aware learning: retrieval, preference memory, similarity |
| [implementation.md](./implementation.md) | Implemented (Phases 1–5) | MongoDB storage, `LEARNING_MODE`, tiered memory, consolidation |
| [innovation-list.md](./innovation-list.md) | Living backlog | Shipped innovations, prioritized next steps, architectural cleanups, open bugs |

**Current branch work:** `LEARNING` — see [agents-learning-model.md](../agents-learning-model.md) for what's done vs planned.

**Quick commands:**

```bash
npm test                         # Run all unit tests (55 tests across 3 suites)
npm run sanitize:strategy        # Migrate stored currentStrategy + heuristics[] in DB
npm run sanitize:strategy:dry    # Preview changes without writing
npm run migrate:mongo            # JSON → MongoDB Atlas one-time migration
npm run repair:glsl              # Bulk-validate + repair GLSL in stored sketches
```
