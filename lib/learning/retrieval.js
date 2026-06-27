import {
  extractCodeFeatures,
  learningLabels,
  normalizeDna,
  ratingValue,
  ratingWeight
} from "./features.js";

const DEFAULT_CONTEXT_BUDGET = 9000;

/** Select relevant 4–5 rated shaders while avoiding repetitive references. */
export function selectLearningExamples(db, targetConcept, options = {}) {
  const {
    limit = 2,
    currentGeneration = Number.MAX_SAFE_INTEGER,
    excludedIds = []
  } = options;
  const excluded = new Set(excludedIds);
  const targetLabels = new Set(textLabels(targetConcept));

  const candidates = (db.sketches || [])
    .filter(sketch => ratingValue(sketch.rating) >= 4)
    .filter(sketch => sketch.compile?.success !== false)
    .filter(sketch => typeof sketch.glsl === "string" && sketch.glsl.includes("gl_FragColor"))
    .filter(sketch => !excluded.has(sketch.id))
    .filter(sketch => (Number(sketch.generation) || 0) < currentGeneration)
    .map(sketch => scoreCandidate(sketch, targetLabels, currentGeneration))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  while (selected.length < limit && candidates.length) {
    const bestIndex = findMostDiverseCandidate(candidates, selected);
    selected.push(candidates.splice(bestIndex, 1)[0]);
  }

  return selected.map(({ sketch, score }) => ({ ...sketch, retrievalScore: score }));
}

/** Metadata planning gets descriptions, never raw GLSL. */
export function buildExampleDescriptions(examples) {
  if (!examples?.length) return "No relevant past examples were selected.";
  return examples.map(example => {
    const features = example.codeFeatures || extractCodeFeatures(example.glsl);
    const labels = [
      ...normalizeDna(example.dna),
      ...(features.techniques || []),
      ...(features.motion || [])
    ].slice(0, 8);
    return `- ${example.title}: ${labels.join(", ")}`;
  }).join("\n");
}

/** GLSL writing gets a strictly budgeted block of source references. */
export function buildExampleContext(examples, budget = DEFAULT_CONTEXT_BUDGET) {
  if (!examples?.length || budget <= 0) return "";
  const sections = [];
  let remaining = budget;

  examples.forEach((example, index) => {
    if (remaining < 300) return;
    const heading = [
      `REFERENCE ${index + 1}: ${example.title}`,
      `Source: ${example.id}`,
      `DNA: ${normalizeDna(example.dna).join(", ")}`,
      "GLSL:"
    ].join("\n");
    const roomForCode = Math.max(0, remaining - heading.length - 2);
    const code = truncateAtLine(example.glsl, roomForCode);
    const section = `${heading}\n${code}`;
    sections.push(section);
    remaining -= section.length + 2;
  });

  return sections.join("\n\n");
}

export function buildNoveltyBrief(examples) {
  if (!examples?.length) {
    return "Explore a technique or composition that is underrepresented in previous work.";
  }
  const sourceNames = examples.map(example => `"${example.title}"`).join(", ");
  return `Learn from ${sourceNames}, but change the constants, function structure, coordinate pipeline, and palette sequence. Do not copy source code verbatim.`;
}

function scoreCandidate(sketch, targetLabels, currentGeneration) {
  const labels = new Set(learningLabels(sketch));
  const relevance = overlap(targetLabels, labels);
  const techniqueSimilarity = overlap(
    new Set([...targetLabels].filter(label => label.startsWith("technique:"))),
    labels
  );
  const age = Math.max(0, currentGeneration - (Number(sketch.generation) || 0));
  const recency = 1 / (1 + age / 8);
  const compileConfidence = sketch.compile?.success === true ? 1 : 0.5;
  const cooldown = Math.min(0.25, (sketch.learningUseCount || 0) * 0.04);
  const score = 0.4 * relevance
    + 0.2 * techniqueSimilarity
    + 0.15 * ratingWeight(sketch.ratingSource)
    + 0.15 * recency
    + 0.1 * compileConfidence
    - cooldown;

  return { sketch, labels, score: round(score) };
}

function findMostDiverseCandidate(candidates, selected) {
  let bestIndex = 0;
  let bestScore = -Infinity;

  candidates.forEach((candidate, index) => {
    const duplicatePenalty = selected.length
      ? Math.max(...selected.map(item => overlap(candidate.labels, item.labels)))
      : 0;
    const diverseScore = 0.75 * candidate.score - 0.25 * duplicatePenalty;
    if (diverseScore > bestScore) {
      bestScore = diverseScore;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function textLabels(value) {
  if (typeof value === "object" && value) {
    const dna = normalizeDna(value.dna).map(tag => `tag:${tag}`);
    const words = wordsFromText(`${value.title || ""} ${value.hypothesis || ""}`)
      .map(word => `tag:${word}`);
    return unique([...dna, ...words]);
  }
  return wordsFromText(String(value || "")).map(word => `tag:${word}`);
}

function wordsFromText(text) {
  return text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
}

function overlap(first, second) {
  if (!first.size || !second.size) return 0;
  let shared = 0;
  first.forEach(value => {
    if (second.has(value)) shared += 1;
  });
  return shared / Math.max(first.size, second.size);
}

function truncateAtLine(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, Math.max(0, maxLength - 18));
  const lineBreak = shortened.lastIndexOf("\n");
  return `${shortened.slice(0, lineBreak > 0 ? lineBreak : shortened.length)}\n// …truncated`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value) {
  return Number(value.toFixed(3));
}
