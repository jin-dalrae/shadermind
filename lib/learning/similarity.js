/** Find the archived shader that most closely matches new GLSL. */
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

/** Compare normalized five-token groups using Jaccard similarity. */
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

function tokenShingles(source, size = 5) {
  const tokens = source.match(/[A-Za-z_]\w*|#|[-+*/=<>()[\]{},.;]/g) || [];
  const shingles = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }
  return shingles;
}

function round(value) {
  return Number(value.toFixed(3));
}
