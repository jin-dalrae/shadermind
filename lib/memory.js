import { truncateGlsl } from "./glsl.js";
import { ratingValue } from "./learning/features.js";

export function assembleWorkingMemory(db, { userOpinion } = {}) {
  const rollup = (db.memoryRollups || []).at(-1);
  const goodSeeds = db.sketches
    .filter(s => ratingValue(s.rating) >= 4)
    .slice(-3)
    .map(s => ({
      title: s.title,
      dna: s.dna,
      glsl: truncateGlsl(s.glsl, 80)
    }));

  return {
    currentStrategy: db.currentStrategy,
    heuristics: (db.heuristics || []).slice(0, 5),
    rollupSummary: rollup?.summary?.slice(0, 2000) || null,
    remixSeeds: goodSeeds,
    userOpinion: userOpinion || db.lastHumanOpinion || null
  };
}

export function buildRemixSection(db) {
  const previousGoodSketches = db.sketches
    .filter(s => ratingValue(s.rating) >= 4)
    .slice(-3);

  if (previousGoodSketches.length === 0) return "";

  let remixSection = `\nPrevious high-rated sketches — remix these; change ONE thing per sketch (Lieberman: everyday practice, small delta from the last, toward what we love):\n`;
  previousGoodSketches.forEach((s, idx) => {
    const dna = Array.isArray(s.dna) ? s.dna.join(", ") : String(s.dna || "");
    const note = s.hypothesis || s.poetic_statement || "";
    remixSection += `\n--- SOURCE TEMPLATE #${idx + 1}: "${s.title}" ---\nWhat it does: ${note}\nDNA: ${dna}\nGLSL Code:\n${truncateGlsl(s.glsl, 80)}\n`;
  });
  return remixSection;
}

export async function consolidateMemory(db, runInferenceFn, { fromGen, toGen }) {
  const recentTimeline = (db.strategyTimeline || []).filter(
    t => t.generation >= fromGen && t.generation <= toGen
  );
  const recentHeuristics = db.heuristics || [];

  const systemPrompt = `You are ShaderMind's memory consolidator (PLUS-style preference summarization).
Compress recent generation history into one interpretable aesthetic genome document.
Respond with valid JSON only:
{
  "summary": "Consolidated aesthetic genome (max 800 words)",
  "heuristics": ["rule with approval context", "..."],
  "keyLearnings": ["insight 1", "insight 2"]
}`;

  const userPrompt = `Consolidate generations ${fromGen}–${toGen}.
Recent reflections: ${JSON.stringify(recentTimeline.map(t => ({ gen: t.generation, notes: t.notes })))}
Current heuristics: ${JSON.stringify(recentHeuristics)}
Current strategy excerpt: ${(db.currentStrategy || "").slice(0, 1500)}`;

  const raw = await runInferenceFn(systemPrompt, userPrompt, {
    task: "consolidation",
    jsonMode: true,
    retriesPerModel: 3,
    label: `memory consolidation ${fromGen}-${toGen}`
  });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    parsed = { summary: raw.slice(0, 2000), heuristics: db.heuristics || [], keyLearnings: [] };
  }

  const rollup = {
    fromGeneration: fromGen,
    toGeneration: toGen,
    summary: parsed.summary || "",
    heuristics: parsed.heuristics || [],
    keyLearnings: parsed.keyLearnings || [],
    createdAt: new Date().toISOString()
  };

  db.memoryRollups = db.memoryRollups || [];
  db.memoryRollups.push(rollup);
  if (rollup.heuristics?.length) {
    db.heuristics = rollup.heuristics;
  }
  db.lastConsolidationGen = toGen;

  return rollup;
}