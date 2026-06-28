import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCritiqueSummary,
  buildPreferenceMemory,
  critiqueLabels,
  sanitizeEvolvedStrategy,
  sanitizeHeuristics,
  validateStrategyOutput
} from "../lib/learning.js";

test("critique labels flow into preference memory", () => {
  const memory = buildPreferenceMemory([
    {
      id: "a",
      rated: true,
      rating: 5,
      ratingSource: "explicit",
      generation: 2,
      glsl: "void main(){ gl_FragColor = vec4(1.0); }",
      dna: ["fbm"],
      critique: {
        reusablePatterns: ["layered fbm ripples"],
        avoidPatterns: []
      }
    },
    {
      id: "b",
      rated: true,
      rating: 1,
      ratingSource: "explicit",
      generation: 2,
      glsl: "void main(){ gl_FragColor = vec4(1.0); }",
      dna: ["circle"],
      critique: {
        reusablePatterns: [],
        avoidPatterns: ["smoothstep circle mask"]
      }
    }
  ]);

  assert.ok(memory.prefer.some(item => /fbm ripples/i.test(item.rule)));
  assert.ok(memory.avoid.some(item => /circle mask/i.test(item.rule)));
});

test("buildCritiqueSummary surfaces recent reuse and avoid lessons", () => {
  const summary = buildCritiqueSummary([
    {
      id: "a",
      rated: true,
      rating: 5,
      generation: 4,
      critique: { reusablePatterns: ["polar uv ripples"], avoidPatterns: [] }
    },
    {
      id: "b",
      rated: true,
      rating: 1,
      generation: 4,
      critique: { reusablePatterns: [], avoidPatterns: ["lone circle blob"] }
    }
  ]);

  assert.match(summary, /Reuse:/i);
  assert.match(summary, /polar uv ripples/i);
  assert.match(summary, /Avoid:/i);
  assert.match(summary, /circle blob/i);
});

test("critiqueLabels only emits reuse on high ratings and avoid on low", () => {
  const high = critiqueLabels({
    rated: true,
    rating: 5,
    critique: { reusablePatterns: ["hash noise"], avoidPatterns: ["grid"] }
  });
  const low = critiqueLabels({
    rated: true,
    rating: 1,
    critique: { reusablePatterns: ["hash noise"], avoidPatterns: ["grid"] }
  });

  assert.deepEqual(high, ["reuse:hash noise"]);
  assert.deepEqual(low, ["avoid:grid"]);
});

test("strategy validation rejects jargon-heavy genome output", () => {
  const invalid = validateStrategyOutput({
    evolvedStrategy: "Pioneer systemic cognition through distributed intelligence and emergent serenity across anticipatory feedback.",
    heuristics: ["Use fbm layers", "Favor warm palette", "Avoid circle masks"],
    analysis: "Too abstract."
  });

  assert.equal(invalid.valid, false);

  const valid = validateStrategyOutput({
    evolvedStrategy: "Favor polar UV with 3-octave FBM. Keep motion slow. Use amber cosine palette. Mouse-reactive diffuse lighting.",
    heuristics: ["Use polar UV + fbm", "Slow sin motion only", "Gamma correct output"],
    analysis: "Ripples rated high; circle blobs rejected."
  });

  assert.equal(valid.valid, true);
  assert.ok(!/systemic/i.test(valid.evolvedStrategy));
  assert.equal(sanitizeHeuristics(["Use fbm → 85% approval"]).length, 1);
  assert.ok(sanitizeEvolvedStrategy("Pioneer systemic cognition. Use hash noise fields.").includes("hash noise"));
});