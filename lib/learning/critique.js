import { ratingValue } from "./features.js";

function normalizePattern(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

/** Labels derived from per-sketch critique fields (after evolution critique step). */
export function critiqueLabels(sketch) {
  if (!sketch?.critique) return [];

  const score = ratingValue(sketch.rating);
  if (score === null) return [];

  const labels = [];
  if (score >= 4) {
    for (const pattern of sketch.critique.reusablePatterns || []) {
      const normalized = normalizePattern(pattern);
      if (normalized) labels.push(`reuse:${normalized}`);
    }
  }
  if (score <= 2) {
    for (const pattern of sketch.critique.avoidPatterns || []) {
      const normalized = normalizePattern(pattern);
      if (normalized) labels.push(`avoid:${normalized}`);
    }
  }
  return labels;
}

/**
 * Compact block for generation/evolution prompts from recent critique evidence.
 */
export function buildCritiqueSummary(sketches, { maxGenerations = 3, limit = 8 } = {}) {
  const rated = (sketches || []).filter(s => s.rated && s.critique);
  if (!rated.length) return "";

  const latestGen = Math.max(...rated.map(s => Number(s.generation) || 0));
  const recent = rated.filter(s => latestGen - (Number(s.generation) || 0) < maxGenerations);

  const reuse = new Map();
  const avoid = new Map();

  for (const sketch of recent) {
    const score = ratingValue(sketch.rating);
    const weight = score >= 4 ? 1 : score <= 2 ? 1 : 0.4;

    for (const pattern of sketch.critique.reusablePatterns || []) {
      const key = normalizePattern(pattern);
      if (!key || score < 4) continue;
      reuse.set(key, (reuse.get(key) || 0) + weight);
    }
    for (const pattern of sketch.critique.avoidPatterns || []) {
      const key = normalizePattern(pattern);
      if (!key || score > 2) continue;
      avoid.set(key, (avoid.get(key) || 0) + weight);
    }
  }

  const topReuse = [...reuse.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const topAvoid = [...avoid.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.ceil(limit / 2));

  if (!topReuse.length && !topAvoid.length) return "";

  const lines = ["Critique lessons from recent rated batches:"];
  if (topReuse.length) {
    lines.push("Reuse:");
    topReuse.forEach(([pattern]) => lines.push(`- ${pattern}`));
  }
  if (topAvoid.length) {
    lines.push("Avoid:");
    topAvoid.forEach(([pattern]) => lines.push(`- ${pattern}`));
  }
  return lines.join("\n");
}