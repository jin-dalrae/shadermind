import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExampleContext,
  buildPreferenceMemory,
  extractCodeFeatures,
  ratingValue,
  selectLearningExamples,
  shaderSimilarity
} from "../lib/learning.js";

const RADIAL_SHADER = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float ring = sin(length(p) * 8.0 - u_time);
  gl_FragColor = vec4(vec3(ring), 1.0);
}`;

const NOISE_SHADER = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
float hash(vec2 p) { return fract(sin(dot(p, vec2(1.0))) * 4.0); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  gl_FragColor = vec4(vec3(hash(uv + u_time)), 1.0);
}`;

function sketch(overrides = {}) {
  return {
    id: "example",
    title: "Example",
    generation: 1,
    rated: true,
    rating: 5,
    ratingSource: "explicit",
    dna: ["radial", "calm"],
    glsl: RADIAL_SHADER,
    compile: { success: true },
    ...overrides
  };
}

test("extractCodeFeatures finds understandable GLSL traits", () => {
  const features = extractCodeFeatures(RADIAL_SHADER);

  assert.ok(features.techniques.includes("radial coordinates"));
  assert.ok(features.motion.includes("sinusoidal"));
  assert.ok(features.composition.includes("centered"));
});

test("ratingValue accepts 1–5 and maps legacy binary ratings", () => {
  assert.equal(ratingValue(3), 3);
  assert.equal(ratingValue("5"), 5);
  assert.equal(ratingValue("good"), 5);
  assert.equal(ratingValue("bad"), 1);
  assert.equal(ratingValue(6), null);
});

test("preference memory separates high and low 1–5 ratings", () => {
  const memory = buildPreferenceMemory([
    sketch({ id: "good-1", dna: ["radial"] }),
    sketch({ id: "good-2", dna: ["radial"] }),
    sketch({ id: "low-1", rating: 1, dna: ["flicker"], glsl: NOISE_SHADER }),
    sketch({ id: "low-2", rating: 2, dna: ["flicker"], glsl: NOISE_SHADER })
  ]);

  assert.ok(memory.prefer.some(item => item.rule.includes("radial")));
  assert.ok(memory.avoid.some(item => item.rule.includes("flicker")));
  assert.equal(memory.version, 1);
});

test("defaulted low ratings carry less confidence than explicit choices", () => {
  const memory = buildPreferenceMemory([
    sketch({ id: "implicit-1", rating: 1, ratingSource: "defaulted", dna: ["untouched"] }),
    sketch({ id: "implicit-2", rating: 1, ratingSource: "defaulted", dna: ["untouched"] })
  ]);

  assert.ok(!memory.avoid.some(item => item.rule.includes("untouched")));
});

test("retrieval favors relevant examples and excludes known compile failures", () => {
  const db = {
    sketches: [
      sketch({ id: "radial-good", generation: 4 }),
      sketch({ id: "noise-good", generation: 4, dna: ["noise"], glsl: NOISE_SHADER }),
      sketch({
        id: "radial-broken",
        generation: 5,
        compile: { success: false }
      })
    ]
  };

  const examples = selectLearningExamples(
    db,
    { title: "Quiet rings", hypothesis: "soft circles", dna: ["radial"] },
    { limit: 2, currentGeneration: 6 }
  );

  assert.equal(examples[0].id, "radial-good");
  assert.ok(!examples.some(item => item.id === "radial-broken"));
});

test("missing compile evidence remains eligible but is not treated as confirmed", () => {
  const db = { sketches: [sketch({ id: "legacy", compile: undefined })] };
  const examples = selectLearningExamples(db, { dna: ["radial"] }, { currentGeneration: 2 });

  assert.equal(examples[0].id, "legacy");
});

test("legacy good and bad ratings remain readable", () => {
  const memory = buildPreferenceMemory([
    sketch({ id: "legacy-good-1", rating: "good", dna: ["legacy-favorite"] }),
    sketch({ id: "legacy-good-2", rating: "good", dna: ["legacy-favorite"] }),
    sketch({ id: "legacy-bad-1", rating: "bad", dna: ["legacy-reject"] }),
    sketch({ id: "legacy-bad-2", rating: "bad", dna: ["legacy-reject"] })
  ]);

  assert.ok(memory.prefer.some(item => item.rule.includes("legacy-favorite")));
  assert.ok(memory.avoid.some(item => item.rule.includes("legacy-reject")));
});

test("example context obeys its hard character budget", () => {
  const context = buildExampleContext([sketch()], 500);
  assert.ok(context.length <= 500);
  assert.match(context, /REFERENCE 1/);
});

test("shader similarity catches copies and distinguishes other structures", () => {
  assert.equal(shaderSimilarity(RADIAL_SHADER, RADIAL_SHADER), 1);
  assert.ok(shaderSimilarity(RADIAL_SHADER, NOISE_SHADER) < 0.82);
});
