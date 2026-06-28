import test from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGY_BANNED_RE,
  STRATEGY_MAX_WORDS,
  STRATEGY_STORE_MAX,
  HEURISTIC_MAX_CHARS,
  sanitizeEvolvedStrategy,
  sanitizeHeuristics,
  strategyForPrompt,
  validateStrategyOutput
} from "../lib/learning/strategy.js";

const DIRTY_STRATEGY = `The ShaderMind's evolved strategy now intensely focuses on pioneering truly novel, self-organizing, and adaptively emergent organic patterns, specifically by architecting systems that demonstrate advanced forms of systemic 'cognition' and 'distributed intelligence.' It prioritizes the exploration of unprecedented systemic behaviors and the discovery of new forms of complexity, maintaining an aesthetic of profound tranquility and low visual friction.

1.  **Pioneering Advanced Systemic Cognition & Deep Emergence:** Design shaders to implement profoundly innovative, multi-layered feedback architectures that explicitly explore *advanced temporal dynamics*, *predictive feedback loops*, and *non-local interactions*.

2.  **Foundational Drivers for Systemic Intelligence:** Employ harmonic waves, low-frequency Simplex Noise, and other foundational mathematical functions as integral, *dynamic drivers* that initiate and sustain complex feedback architectures.

3.  **Unwavering Serenity & Low Visual Friction:** Maintain an unwavering commitment to micro-animations, gentle transitions, and soft gradient attenuation.

4.  **Elegant Mathematics & Robust WebGL Compliance:** Uphold the highest standards of clean, efficient, and valid WebGL 1.0 GLSL fragment shader code.`;

const CLEAN_STRATEGY = `Focus on fundamental machine creativity and mathematical beauty:
1. Curves that bend and flow using harmonic waves and 2D Simplex Noise.
2. Organic, living movement mimicking natural phenomena.
3. Subtlety, micro-animations, and soft gradient attenuation.
4. Clean, valid WebGL 1.0 GLSL fragment shader code with proper precision.`;

test("STRATEGY_BANNED_RE matches the documented jargon list", () => {
  for (const word of [
    "emergent",
    "emergence",
    "systemic",
    "cognition",
    "pioneering",
    "self-organizing",
    "novelty",
    "profound",
    "heuristic",
    "anticipatory",
    "architect"
  ]) {
    STRATEGY_BANNED_RE.lastIndex = 0;
    assert.ok(STRATEGY_BANNED_RE.test(word), `should match banned word: ${word}`);
  }
});

test("STRATEGY_BANNED_RE does NOT match common non-jargon words", () => {
  for (const word of ["use", "fbm", "harmonics", "patterns", "shader", "warm", "amber"]) {
    assert.equal(STRATEGY_BANNED_RE.test(word), false, `should NOT match benign word: ${word}`);
  }
});

test("sanitizeEvolvedStrategy removes banned words from a heavily polluted strategy", () => {
  const out = sanitizeEvolvedStrategy(DIRTY_STRATEGY);
  assert.ok(!STRATEGY_BANNED_RE.test(out), `output should be free of banned words, got: ${out.slice(0, 200)}`);
});

test("sanitizeEvolvedStrategy preserves key content from a clean strategy", () => {
  const out = sanitizeEvolvedStrategy(CLEAN_STRATEGY);
  assert.ok(!STRATEGY_BANNED_RE.test(out), `output should be free of banned words`);
  for (const phrase of [
    "machine creativity",
    "harmonic waves",
    "Simplex Noise",
    "WebGL 1.0"
  ]) {
    assert.ok(out.includes(phrase), `output should preserve phrase "${phrase}", got: ${out}`);
  }
});

test("sanitizeEvolvedStrategy caps output at STRATEGY_MAX_WORDS", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const out = sanitizeEvolvedStrategy(long);
  const wordCount = out.split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount <= STRATEGY_MAX_WORDS, `expected ≤ ${STRATEGY_MAX_WORDS} words, got ${wordCount}`);
});

test("sanitizeEvolvedStrategy caps output at the maxChars argument", () => {
  const out = sanitizeEvolvedStrategy(CLEAN_STRATEGY, 50);
  assert.ok(out.length <= 55, `expected ≤ ~55 chars with ellipsis, got ${out.length}: ${out}`);
});

test("sanitizeEvolvedStrategy returns empty string for empty/blank input", () => {
  assert.equal(sanitizeEvolvedStrategy(""), "");
  assert.equal(sanitizeEvolvedStrategy("   \n\t  "), "");
  assert.equal(sanitizeEvolvedStrategy(null), "");
});

test("sanitizeEvolvedStrategy drops entire sentences that contain any banned word", () => {
  const out = sanitizeEvolvedStrategy("Clean sentence one. Pioneering new emergence in cognition. Clean sentence two.");
  assert.ok(out.includes("Clean sentence one."), `should keep first sentence, got: ${out}`);
  assert.ok(out.includes("Clean sentence two."), `should keep last sentence, got: ${out}`);
  assert.ok(!out.toLowerCase().includes("pioneering"));
  assert.ok(!out.toLowerCase().includes("emergence"));
});

test("strategyForPrompt caps at STRATEGY_PROMPT_MAX chars", () => {
  const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
  const out = strategyForPrompt(long);
  assert.ok(out.length <= 600, `expected ≤ ~600 chars (500 + ellipsis overhead), got ${out.length}`);
});

test("sanitizeHeuristics strips approval-rate suffixes and collapses whitespace", () => {
  const in_ = [
    "Use fbm for layered noise → 85% approval rate",
    "Spaced   heuristics  → 70% "
  ];
  const out = sanitizeHeuristics(in_);
  assert.equal(out.length, 2);
  out.forEach(h => {
    assert.ok(!/→\s*\d+%/.test(h), `heuristic should not contain approval-rate suffix, got: ${h}`);
    assert.ok(!/\s{2,}/.test(h), `heuristic should collapse internal whitespace, got: ${h}`);
    assert.ok(h.length <= HEURISTIC_MAX_CHARS, `heuristic too long: ${h.length} chars`);
  });
  assert.equal(out[0], "Use fbm for layered noise");
});

test("sanitizeHeuristics drops entries that become empty after banned-word removal", () => {
  const out = sanitizeHeuristics([
    "Pioneering", // single banned word → "" after strip → filtered
    "Use sin for slow oscillation"
  ]);
  assert.equal(out.length, 1);
  assert.ok(out[0].includes("sin"));
});

test("sanitizeHeuristics caps at 4 entries", () => {
  const in_ = Array.from({ length: 10 }, (_, i) => `rule number ${i} about something specific`);
  const out = sanitizeHeuristics(in_);
  assert.equal(out.length, 4);
});

test("sanitizeHeuristics returns clean output for all-banned input", () => {
  const out = sanitizeHeuristics([
    "Pioneering emergent cognition",
    "Novelty pioneering systemic",
    "Use sin for slow waves"
  ]);
  assert.equal(out.length, 1);
  assert.ok(out[0].includes("sin"));
});

test("validateStrategyOutput rejects evolvedStrategy that becomes empty after sanitizing banned words", () => {
  const result = validateStrategyOutput({
    evolvedStrategy: "Pioneering emergent systemic cognition",
    heuristics: ["Use sin for slow waves"],
    analysis: "Notes here"
  });
  assert.equal(result.valid, false);
  assert.ok(["empty strategy", "strategy jargon"].includes(result.reason), `unexpected reason: ${result.reason}`);
});

test("validateStrategyOutput rejects evolvedStrategy with banned words even when salvageable content exists", () => {
  const result = validateStrategyOutput({
    evolvedStrategy: "Pioneering new emergence. Clean content about fbm and noise.",
    heuristics: ["Use sin"],
    analysis: ""
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "strategy jargon");
});

test("validateStrategyOutput accepts clean strategy and produces clean heuristics", () => {
  const result = validateStrategyOutput({
    evolvedStrategy: CLEAN_STRATEGY,
    heuristics: ["Use sin", "Use fbm", "Pioneering emergence direction"],
    analysis: "Notes about what worked."
  });
  assert.equal(result.valid, true, `should be valid, got: ${result.reason}`);
  assert.ok(!STRATEGY_BANNED_RE.test(result.evolvedStrategy));
  result.heuristics.forEach(h => assert.ok(!STRATEGY_BANNED_RE.test(h), `clean heuristic required, got: ${h}`));
});

test("validateStrategyOutput rejects empty heuristics list", () => {
  const result = validateStrategyOutput({
    evolvedStrategy: CLEAN_STRATEGY,
    heuristics: ["Pioneering emergence cognition", "Novelty systemic directive"],
    analysis: ""
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "no heuristics");
});

test("validateStrategyOutput trims oversized strategy to STRATEGY_MAX_WORDS and accepts it", () => {
  const oversized = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
  const result = validateStrategyOutput({
    evolvedStrategy: oversized,
    heuristics: ["Use sin"],
    analysis: ""
  });
  // Sanitizer pre-trims to STRATEGY_MAX_WORDS (120); validator allows up to STRATEGY_MAX_WORDS + 5 (125) as buffer.
  assert.equal(result.valid, true);
  assert.ok(result.evolvedStrategy.split(/\s+/).length <= 125);
});

test("strategy in DEFAULT_DB passes validation", async () => {
  const { DEFAULT_DB } = await import("../storage/default-db.js");
  const result = validateStrategyOutput({
    evolvedStrategy: DEFAULT_DB.currentStrategy,
    heuristics: DEFAULT_DB.heuristics,
    analysis: "Initial baseline setup."
  });
  assert.equal(result.valid, true, `DEFAULT_DB should validate clean, got: ${result.reason}`);
});

test("STRATEGY_STORE_MAX < heuristic count cap × HEURISTIC_MAX_CHARS (sanity)", () => {
  assert.ok(STRATEGY_STORE_MAX < 1000);
  assert.ok(HEURISTIC_MAX_CHARS >= 80);
});