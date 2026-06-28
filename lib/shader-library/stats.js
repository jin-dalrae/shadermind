import { ratingValue, ratingWeight } from "../learning/features.js";
import { getAllPatterns, getPatternById } from "./patterns.js";

export const EMPTY_PATTERN_STATS = {
  version: 0,
  updatedAtGeneration: 0,
  patterns: {}
};

function round(n) {
  return Math.round(n * 100) / 100;
}

export function detectPatternIds(glsl = "", assignedIds = []) {
  const source = String(glsl);
  const found = new Set(Array.isArray(assignedIds) ? assignedIds : []);

  for (const pattern of getAllPatterns()) {
    if (found.has(pattern.id)) continue;
    if (pattern.detect.some(rx => rx.test(source))) {
      found.add(pattern.id);
    }
  }

  return [...found];
}

export function updatePatternStats(db, generation) {
  const stats = { ...EMPTY_PATTERN_STATS, ...(db.patternStats || {}) };
  const patterns = { ...(stats.patterns || {}) };
  let changed = false;

  const batchSketches = (db.sketches || []).filter(s => s.generation === generation && s.rated);

  for (const sketch of batchSketches) {
    const score = ratingValue(sketch.rating);
    if (score === null) continue;

    const ids = sketch.patternIds?.length
      ? sketch.patternIds
      : detectPatternIds(sketch.glsl, sketch.libraryPattern ? [sketch.libraryPattern] : []);

    const weight = ratingWeight(sketch.ratingSource);

    for (const id of ids) {
      if (!getPatternById(id)) continue;
      const prev = patterns[id] || { uses: 0, ratingSum: 0, weightSum: 0, lastGeneration: 0 };
      patterns[id] = {
        uses: prev.uses + 1,
        ratingSum: prev.ratingSum + score * weight,
        weightSum: prev.weightSum + weight,
        lastGeneration: Math.max(prev.lastGeneration || 0, generation)
      };
      changed = true;
    }
  }

  if (!changed) return db.patternStats || EMPTY_PATTERN_STATS;

  return {
    version: (stats.version || 0) + 1,
    updatedAtGeneration: generation,
    patterns
  };
}

export function getPatternScore(stats, patternId) {
  const entry = stats?.patterns?.[patternId];
  if (!entry || entry.weightSum < 0.5) return null;
  return {
    averageRating: round(entry.ratingSum / entry.weightSum),
    uses: entry.uses,
    weightSum: round(entry.weightSum),
    lastGeneration: entry.lastGeneration || 0
  };
}

export function rankPatterns(stats = EMPTY_PATTERN_STATS) {
  return getAllPatterns().map(pattern => {
    const score = getPatternScore(stats, pattern.id);
    return {
      ...pattern,
      score,
      averageRating: score?.averageRating ?? null,
      uses: score?.uses ?? 0
    };
  }).sort((a, b) => {
    const ar = a.averageRating ?? 0;
    const br = b.averageRating ?? 0;
    if (br !== ar) return br - ar;
    return b.uses - a.uses;
  });
}

export function buildLibraryFeedbackSummary(stats = EMPTY_PATTERN_STATS) {
  const ranked = rankPatterns(stats);
  const tried = ranked.filter(p => p.uses > 0);
  const prefer = tried.filter(p => p.averageRating >= 4).slice(0, 4);
  const avoid = tried.filter(p => p.averageRating <= 2 && p.uses >= 2).slice(0, 3);
  const unexplored = ranked.filter(p => p.uses === 0).slice(0, 4);

  const lines = [];
  if (prefer.length) {
    lines.push(`High-rated shapes to reuse: ${prefer.map(p => p.name).join(", ")}.`);
  }
  if (avoid.length) {
    lines.push(`Low-rated shapes — try alternatives instead: ${avoid.map(p => p.name).join(", ")}.`);
  }
  if (unexplored.length) {
    lines.push(`Unexplored shapes worth trying: ${unexplored.map(p => p.name).join(", ")}.`);
  }
  if (!lines.length) {
    return "Pattern library: rotate through distinct shapes each batch (ripples, FBM, voronoi, flow, kaleidoscope).";
  }
  return lines.join(" ");
}