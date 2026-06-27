/**
 * Reads simple, explainable traits from GLSL source code.
 * No AI call is needed, so the same shader always produces the same features.
 */
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

export function learningLabels(sketch) {
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

export function ratingWeight(source) {
  if (source === "defaulted") return 0.35;
  if (source === "autonomous") return 0.7;
  return 1;
}

/** Convert both new 1–5 ratings and old good/bad records to one scale. */
export function ratingValue(rating) {
  if (rating === "good") return 5;
  if (rating === "bad") return 1;

  const value = Number(rating);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function cleanText(value) {
  return String(value).trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
