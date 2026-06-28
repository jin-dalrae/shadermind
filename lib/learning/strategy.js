/** Banned strategy/heuristic jargon — keeps genome concrete and GLSL-focused. */
export const STRATEGY_BANNED_RE = /\b(systemic|cognition|emergence|directive|morphology|friction|heuristic|anticipatory|intentional|predictive|coherence|evolutionary|distributed|intelligence|novelty|profound|serenity|unwavering|pioneering|architect|aesthetic|modeling|adjustment|progression|intentionality|manifesto|genome|emergent|self-organiz|self-correct|non-local|anticipatory)\b/i;

export const STRATEGY_MAX_WORDS = 120;
export const STRATEGY_STORE_MAX = 700;
export const STRATEGY_PROMPT_MAX = 500;
export const HEURISTIC_MAX_CHARS = 100;

export function strategyForPrompt(strategy) {
  return sanitizeEvolvedStrategy(strategy, STRATEGY_PROMPT_MAX);
}

export function sanitizeHeuristics(items) {
  return (Array.isArray(items) ? items : [])
    .map(h => String(h).trim().replace(/\s*→\s*\d+%.*$/i, ""))
    .map(h => h.replace(STRATEGY_BANNED_RE, "").replace(/\s+/g, " ").trim())
    .filter(h => h && h.split(/\s+/).length <= 14)
    .map(h => h.slice(0, HEURISTIC_MAX_CHARS))
    .filter(Boolean)
    .slice(0, 4);
}

export function sanitizeEvolvedStrategy(text, maxChars = STRATEGY_STORE_MAX) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const sentences = raw.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const kept = [];

  for (const sentence of sentences) {
    if (STRATEGY_BANNED_RE.test(sentence)) continue;
    if (sentence.length > 220) continue;
    kept.push(sentence.replace(STRATEGY_BANNED_RE, "").replace(/\s+/g, " ").trim());
  }

  let result = (kept.length ? kept.join(" ") : raw.replace(STRATEGY_BANNED_RE, "").replace(/\s+/g, " "))
    .trim();

  const words = result.split(/\s+/).filter(Boolean);
  if (words.length > STRATEGY_MAX_WORDS) {
    result = words.slice(0, STRATEGY_MAX_WORDS).join(" ");
  }

  if (result.length > maxChars) {
    result = `${result.slice(0, maxChars).replace(/\s+\S*$/, "")}...`;
  }
  return result;
}

export function validateStrategyOutput({ evolvedStrategy, heuristics, analysis }) {
  const strategy = sanitizeEvolvedStrategy(evolvedStrategy);
  const cleanHeuristics = sanitizeHeuristics(heuristics);
  const cleanAnalysis = String(analysis || "").trim().replace(STRATEGY_BANNED_RE, "").slice(0, 500);

  if (!strategy) {
    return { valid: false, reason: "empty strategy" };
  }
  if (STRATEGY_BANNED_RE.test(String(evolvedStrategy || ""))) {
    return { valid: false, reason: "strategy jargon" };
  }
  if (strategy.split(/\s+/).length > STRATEGY_MAX_WORDS + 5) {
    return { valid: false, reason: "strategy too long" };
  }
  if (!cleanHeuristics.length) {
    return { valid: false, reason: "no heuristics" };
  }

  return {
    valid: true,
    evolvedStrategy: strategy,
    heuristics: cleanHeuristics,
    analysis: cleanAnalysis || "Strategy updated from latest ratings."
  };
}