import { getAllPatterns, getPatternById } from "./patterns.js";
import { buildLibraryFeedbackSummary, getPatternScore } from "./stats.js";
import { ratingValue } from "../learning/features.js";

const FOCUS_KEYWORDS = {
  ripple: ["damped-ripples", "polar-field", "interference-stripes"],
  wave: ["damped-ripples", "interference-stripes"],
  polar: ["polar-field", "kaleidoscope", "damped-ripples"],
  noise: ["hash-noise", "fbm-layers", "domain-warp"],
  fbm: ["fbm-layers", "domain-warp", "flow-distort"],
  flow: ["flow-distort", "domain-warp", "mouse-wake"],
  color: ["cosine-palette", "soft-vignette"],
  warm: ["cosine-palette", "damped-ripples"],
  organic: ["fbm-layers", "domain-warp", "flow-distort"],
  geometric: ["kaleidoscope", "voronoi-cells", "interference-stripes"],
  spiral: ["twist-warp", "polar-field", "flow-distort"],
  mouse: ["mouse-wake", "flow-distort"],
  symmetry: ["kaleidoscope", "voronoi-cells"],
  cell: ["voronoi-cells"],
  stripe: ["interference-stripes"],
  light: ["lo-lambert-diffuse", "lo-mouse-light", "lo-color-multiply"],
  lighting: ["lo-lambert-diffuse", "lo-blinn-specular", "lo-height-normal"],
  phong: ["lo-lambert-diffuse", "lo-blinn-specular"],
  specular: ["lo-blinn-specular"],
  gamma: ["lo-gamma-correct"],
  shaded: ["lo-height-normal", "lo-lambert-diffuse"],
  relief: ["lo-height-normal", "fbm-layers"],
  warm: ["cosine-palette", "lo-color-multiply", "damped-ripples"]
};

function patternIdsFromFocus(focus = "") {
  const text = focus.toLowerCase();
  const ids = new Set();
  for (const [word, patterns] of Object.entries(FOCUS_KEYWORDS)) {
    if (text.includes(word)) patterns.forEach(id => ids.add(id));
  }
  return [...ids];
}

function patternIdsFromDna(db) {
  const ids = new Set();
  const goods = (db.sketches || []).filter(s => ratingValue(s.rating) >= 4).slice(-6);
  for (const sketch of goods) {
    for (const tag of sketch.dna || []) {
      const key = String(tag).toLowerCase();
      for (const [word, patterns] of Object.entries(FOCUS_KEYWORDS)) {
        if (key.includes(word)) patterns.forEach(id => ids.add(id));
      }
    }
    for (const id of sketch.patternIds || []) ids.add(id);
    if (sketch.libraryPattern) ids.add(sketch.libraryPattern);
  }
  return [...ids];
}

function scorePattern(pattern, { stats, focusIds, seedIds, sketchType, usedThisBatch, genNum }) {
  let score = 0;
  const entry = getPatternScore(stats, pattern.id);

  if (entry) {
    if (entry.averageRating >= 4) score += 3 + entry.averageRating * 0.2;
    else if (entry.averageRating <= 2 && entry.uses >= 2) score -= 4;
    else score += entry.averageRating * 0.3;
    if (genNum - entry.lastGeneration < 2) score -= 1.5;
  } else {
    score += sketchType === "mutation" ? 2.5 : 1;
  }

  if (focusIds.includes(pattern.id)) score += 2.5;
  if (seedIds.includes(pattern.id)) score += sketchType === "evolutionary" ? 3 : 1;

  if (usedThisBatch.has(pattern.id)) score -= 5;

  if (sketchType === "mutation" && !entry) score += 1;
  if (sketchType === "directive" && focusIds.includes(pattern.id)) score += 2;

  return score;
}

function pickPattern(candidates, scoreFn) {
  const scored = candidates
    .map(p => ({ pattern: p, score: scoreFn(p) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score ?? -Infinity;
  const tier = scored.filter(s => s.score >= top - 0.5);
  return tier[Math.floor(Math.random() * tier.length)]?.pattern || candidates[0];
}

/**
 * Assign one primary library pattern per shader slot in the batch.
 */
export function selectPatternsForBatch(db, {
  userFocus = "",
  genNum = 1,
  batchSize = 3,
  sketchTypeForIndex = (i) => (i === 0 ? "evolutionary" : i === 1 ? "directive" : "mutation")
} = {}) {
  const stats = db.patternStats || { patterns: {} };
  const focusIds = patternIdsFromFocus(userFocus);
  const seedIds = patternIdsFromDna(db);
  const all = getAllPatterns();
  const usedThisBatch = new Set();

  const assignments = [];

  for (let i = 0; i < batchSize; i++) {
    const sketchType = sketchTypeForIndex(i);
    const scoreFn = (pattern) => scorePattern(pattern, {
      stats,
      focusIds,
      seedIds,
      sketchType,
      usedThisBatch,
      genNum
    });

    const pattern = pickPattern(all, scoreFn);
    usedThisBatch.add(pattern.id);

    const alternatives = all
      .filter(p => p.id !== pattern.id && p.category !== pattern.category)
      .map(p => ({ pattern: p, score: scoreFn(p) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(x => x.pattern.id);

    assignments.push({
      index: i,
      sketchType,
      primaryId: pattern.id,
      pattern,
      alternativeIds: alternatives,
      promptBlock: formatPatternBlock(pattern, sketchType)
    });
  }

  return {
    assignments,
    feedbackSummary: buildLibraryFeedbackSummary(stats),
    genNum
  };
}

function formatPatternBlock(pattern, sketchType) {
  const action = sketchType === "evolutionary"
    ? "Remix this logic — change ONE parameter or combine with a seed."
    : sketchType === "mutation"
      ? "Build a bold variant using this as the core shape logic."
      : "Center the shader on this shape logic.";

  return [
    `Pattern: ${pattern.name} (${pattern.id})`,
    `Shape: ${pattern.shapes.join(", ")}`,
    action,
    "Logic block (adapt into a full shader — do not paste lazily):",
    pattern.snippet
  ].join("\n");
}

export function buildBatchPatternPrompt(plan) {
  if (!plan?.assignments?.length) return "";

  const blocks = plan.assignments.map((a, i) => (
    `--- Shader #${i + 1} (${a.sketchType}) ---\n${a.promptBlock}`
  )).join("\n\n");

  return `
SHADER PATTERN LIBRARY (required — build each shader from its assigned logic block):
${plan.feedbackSummary}

${blocks}

Compose full shaders from these blocks. Each shader must look visually distinct. No lone circle/blob on black.
`.trim();
}

export function attachPatternToSketch(sketch, assignment) {
  if (!assignment) return sketch;
  return {
    ...sketch,
    libraryPattern: assignment.primaryId,
    patternIds: [assignment.primaryId, ...assignment.alternativeIds.slice(0, 1)]
  };
}