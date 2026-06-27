/**
 * Pure learning helpers.
 *
 * This module does not read files, call Gemini, or know about Express. Keeping
 * it free of side effects makes the ranking rules easy to understand and test.
 */
const DEFAULT_CONTEXT_BUDGET = 9000;

export const EMPTY_PREFERENCE_MEMORY = {
  version: 0,
  updatedAtGeneration: 0,
  prefer: [],
  avoid: []
};

const FEATURE_PATTERNS = {
  techniques: {
    noise: /\b(?:noise|fbm|hash|random)\b/i,
    "signed distance fields": /\b(?:sdf|sdCircle|sdBox|smoothstep)\b/i,
    "radial coordinates": /\b(?:atan|length\s*\()/i,
    symmetry: /\b(?:abs|mod)\s*\(/i,
    "coordinate warping": /\b(?:warp|rotate|rotation)\b|\bp\s*[+\-]=/i,
    glow: /\b(?:glow|exp\s*\()/i
  },
  motion: {
    sinusoidal: /\b(?:sin|cos)\s*\([^;]*u_time/i,
    pulsing: /\b(?:pulse|fract)\s*\([^;]*u_time/i,
    rotating: /\b(?:atan|rotate|rotation)\b[\s\S]{0,160}u_time/i,
    interactive: /\bu_mouse\b/i
  },
  composition: {
    centered: /gl_FragCoord\.xy\s*-\s*0\.5\s*\*\s*u_resolution/i,
    radial: /\blength\s*\(/i,
    tiled: /\b(?:fract|mod)\s*\(/i,
    mirrored: /\babs\s*\(/i
  },
  palette: {
    gradients: /\bmix\s*\(/i,
    cosine: /\bcos\s*\([^;]*(?:vec3|color|col)/i,
    warm: /vec3\s*\(\s*(?:0\.[7-9]|1\.0)\s*,\s*0\.[3-8]\s*,\s*0\.[0-4]/i,
    cool: /vec3\s*\(\s*0\.[0-4]\s*,\s*0\.[3-9]\s*,\s*(?:0\.[6-9]|1\.0)/i
  }
};

export function normalizeDna(dna) {
  if (Array.isArray(dna)) return dna.map(String).map(cleanText).filter(Boolean);
  if (typeof dna === "string") return dna.split(/[,;|]/).map(cleanText).filter(Boolean);
  return ["experiment"];
}

export function extractCodeFeatures(glsl = "") {
  const source = String(glsl);
  const features = {};

  for (const [group, patterns] of Object.entries(FEATURE_PATTERNS)) {
    features[group] = Object.entries(patterns)
      .filter(([, pattern]) => pattern.test(source))
      .map(([name]) => name);
  }

  features.functions = [...source.matchAll(/\b(?:float|vec[234]|mat[234])\s+(\w+)\s*\(/g)]
    .map(match => match[1])
    .filter(name => name !== "main")
    .slice(0, 12);

  const meaningfulLines = source.split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("//"));

  features.complexity = meaningfulLines.length < 25
    ? "low"
    : meaningfulLines.length < 55 ? "medium" : "high";

  return features;
}

export function buildPreferenceMemory(sketches, previousMemory = EMPTY_PREFERENCE_MEMORY) {
  const evidence = new Map();
  let latestGeneration = previousMemory.updatedAtGeneration || 0;

  for (const sketch of sketches || []) {
    if (!sketch?.rated || !["good", "bad"].includes(sketch.rating)) continue;
    if (sketch.compile?.success === false) continue;

    latestGeneration = Math.max(latestGeneration, Number(sketch.generation) || 0);
    const weight = ratingWeight(sketch.ratingSource);
    const labels = learningLabels(sketch);

    for (const label of labels) {
      const item = evidence.get(label) || { good: 0, bad: 0, count: 0 };
      item[sketch.rating] += weight;
      item.count += weight;
      evidence.set(label, item);
    }
  }

  const ranked = [...evidence.entries()]
    .filter(([, item]) => item.count >= 1.5)
    .map(([label, item]) => {
      const approval = item.good / item.count;
      return {
        rule: humanizeLabel(label),
        support: round(item.count),
        confidence: round(Math.min(1, item.count / 6)),
        approval: round(approval)
      };
    });

  const prefer = ranked
    .filter(item => item.approval >= 0.6)
    .sort(sortPreference)
    .slice(0, 8);

  const avoid = ranked
    .filter(item => item.approval <= 0.35)
    .sort(sortPreference)
    .slice(0, 6);

  const changed = JSON.stringify({ prefer, avoid }) !== JSON.stringify({
    prefer: previousMemory.prefer || [],
    avoid: previousMemory.avoid || []
  });

  return {
    version: (previousMemory.version || 0) + (changed ? 1 : 0),
    updatedAtGeneration: latestGeneration,
    prefer,
    avoid
  };
}

export function buildPreferenceSummary(memory = EMPTY_PREFERENCE_MEMORY) {
  const prefer = (memory.prefer || []).slice(0, 5);
  const avoid = (memory.avoid || []).slice(0, 3);

  if (!prefer.length && !avoid.length) {
    return "No evidence-backed preference rules yet. Preserve variety and learn from this batch.";
  }

  const lines = [];
  if (prefer.length) {
    lines.push("Observed preferences:");
    prefer.forEach(item => lines.push(`- ${item.rule} (${formatEvidence(item)})`));
  }
  if (avoid.length) {
    lines.push("Avoid when possible:");
    avoid.forEach(item => lines.push(`- ${item.rule} (${formatEvidence(item)})`));
  }
  return lines.join("\n");
}

export function selectLearningExamples(db, targetConcept, options = {}) {
  const {
    limit = 2,
    currentGeneration = Number.MAX_SAFE_INTEGER,
    excludedIds = []
  } = options;
  const excluded = new Set(excludedIds);
  const targetLabels = new Set(textLabels(targetConcept));

  const candidates = (db.sketches || [])
    .filter(sketch => sketch.rating === "good")
    .filter(sketch => sketch.compile?.success !== false)
    .filter(sketch => typeof sketch.glsl === "string" && sketch.glsl.includes("gl_FragColor"))
    .filter(sketch => !excluded.has(sketch.id))
    .filter(sketch => (Number(sketch.generation) || 0) < currentGeneration)
    .map(sketch => {
      const labels = new Set(learningLabels(sketch));
      const relevance = overlap(targetLabels, labels);
      const techniqueSimilarity = overlap(
        new Set([...targetLabels].filter(label => label.startsWith("technique:"))),
        labels
      );
      const curatorConfidence = ratingWeight(sketch.ratingSource);
      const age = Math.max(0, currentGeneration - (Number(sketch.generation) || 0));
      const recency = 1 / (1 + age / 8);
      const compileConfidence = sketch.compile?.success === true ? 1 : 0.5;
      const cooldown = Math.min(0.25, (sketch.learningUseCount || 0) * 0.04);
      const score = 0.4 * relevance
        + 0.2 * techniqueSimilarity
        + 0.15 * curatorConfidence
        + 0.15 * recency
        + 0.1 * compileConfidence
        - cooldown;

      return { sketch, labels, score: round(score) };
    })
    .sort((a, b) => b.score - a.score);

  const selected = [];
  while (selected.length < limit && candidates.length) {
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

    selected.push(candidates.splice(bestIndex, 1)[0]);
  }

  return selected.map(({ sketch, score }) => ({ ...sketch, retrievalScore: score }));
}

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

export function findMostSimilarShader(glsl, sketches, excludedIds = []) {
  const excluded = new Set(excludedIds);
  let best = { id: null, score: 0 };

  for (const sketch of sketches || []) {
    if (!sketch?.glsl || excluded.has(sketch.id)) continue;
    const score = shaderSimilarity(glsl, sketch.glsl);
    if (score > best.score) best = { id: sketch.id, score };
  }

  return { ...best, score: round(best.score) };
}

export function shaderSimilarity(first, second) {
  const firstTokens = tokenShingles(normalizeGlsl(first));
  const secondTokens = tokenShingles(normalizeGlsl(second));
  if (!firstTokens.size || !secondTokens.size) return 0;

  let shared = 0;
  firstTokens.forEach(token => {
    if (secondTokens.has(token)) shared += 1;
  });
  const union = firstTokens.size + secondTokens.size - shared;
  return union ? shared / union : 0;
}

export function normalizeGlsl(glsl = "") {
  return String(glsl)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function learningLabels(sketch) {
  const features = sketch.codeFeatures || extractCodeFeatures(sketch.glsl);
  return unique([
    ...normalizeDna(sketch.dna).map(tag => `tag:${tag}`),
    ...(features.techniques || []).map(value => `technique:${value}`),
    ...(features.motion || []).map(value => `motion:${value}`),
    ...(features.composition || []).map(value => `composition:${value}`),
    ...(features.palette || []).map(value => `palette:${value}`),
    features.complexity ? `complexity:${features.complexity}` : null
  ]);
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

function tokenShingles(source, size = 5) {
  const tokens = source.match(/[A-Za-z_]\w*|#|[-+*/=<>()[\]{},.;]/g) || [];
  const shingles = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

function ratingWeight(source) {
  if (source === "defaulted") return 0.35;
  if (source === "autonomous") return 0.7;
  return 1;
}

function overlap(first, second) {
  if (!first.size || !second.size) return 0;
  let shared = 0;
  first.forEach(value => {
    if (second.has(value)) shared += 1;
  });
  return shared / Math.max(first.size, second.size);
}

function sortPreference(a, b) {
  return (b.confidence * Math.abs(b.approval - 0.5))
    - (a.confidence * Math.abs(a.approval - 0.5));
}

function formatEvidence(item) {
  return `${Math.round(item.approval * 100)}% approval, ${item.support} weighted examples`;
}

function humanizeLabel(label) {
  const [group, value] = label.split(":");
  const prefix = {
    tag: "Use",
    technique: "Use",
    motion: "Favor",
    composition: "Favor",
    palette: "Favor",
    complexity: "Favor"
  }[group] || "Use";
  return `${prefix} ${value}`;
}

function truncateAtLine(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, Math.max(0, maxLength - 18));
  const lineBreak = shortened.lastIndexOf("\n");
  return `${shortened.slice(0, lineBreak > 0 ? lineBreak : shortened.length)}\n// …truncated`;
}

function cleanText(value) {
  return String(value).trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value) {
  return Number(value.toFixed(3));
}
