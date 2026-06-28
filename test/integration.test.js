import test from "node:test";
import assert from "node:assert/strict";
import { assembleWorkingMemory } from "../lib/memory.js";
import { selectLearningExamples } from "../lib/learning/retrieval.js";

const PASS_SHADER = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * hash(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  float n = fbm(p + u_time * 0.1);
  vec3 col = mix(vec3(0.9, 0.5, 0.2), vec3(0.2, 0.7, 0.8), n);
  gl_FragColor = vec4(col, 1.0);
}`;

const LONG_SHADER = PASS_SHADER + "\n" + "// padding line\n".repeat(60);

function makeSketch(overrides = {}) {
  return {
    id: "sketch-gen1-1",
    title: "Amber Drift",
    type: "evolutionary",
    hypothesis: "Slow amber gradients using FBM with low-frequency drift.",
    glsl: PASS_SHADER,
    dna: ["amber", "fbm", "low-frequency"],
    generation: 1,
    rated: true,
    rating: 5,
    ratingSource: "explicit",
    compile: { success: true, error: null, reportedAt: "2026-06-27T00:00:00Z" },
    ...overrides
  };
}

test("lib/memory.js no longer exports buildRemixSection", async () => {
  const memory = await import("../lib/memory.js");
  assert.equal(typeof memory.buildRemixSection, "undefined", "buildRemixSection should be removed (migrated to selectLearningExamples)");
  assert.equal(typeof memory.assembleWorkingMemory, "function");
  assert.equal(typeof memory.consolidateMemory, "function");
});

test("assembleWorkingMemory.remixSeeds includes GLSL truncated to the configured line count", () => {
  const db = {
    sketches: [makeSketch({ glsl: LONG_SHADER })],
    currentStrategy: "Test strategy",
    heuristics: [],
    memoryRollups: [],
    lastHumanOpinion: null
  };

  const memory = assembleWorkingMemory(db, { remixSeedLines: 40 });
  assert.equal(memory.remixSeeds.length, 1);
  const seed = memory.remixSeeds[0];
  assert.equal(seed.title, "Amber Drift");
  assert.ok(Array.isArray(seed.dna));
  assert.ok(seed.glsl.includes("void main"), "GLSL should be included in remixSeeds");
  assert.ok(seed.glsl.length < LONG_SHADER.length, "GLSL should be truncated, not full length");
});

test("assembleWorkingMemory respects env-configurable REMIX_SEED_LINES via explicit option", () => {
  const db = {
    sketches: [makeSketch({ glsl: LONG_SHADER })],
    currentStrategy: "Test",
    heuristics: [],
    memoryRollups: []
  };
  const small = assembleWorkingMemory(db, { remixSeedLines: 10 });
  const large = assembleWorkingMemory(db, { remixSeedLines: 200 });
  assert.ok(small.remixSeeds[0].glsl.length < large.remixSeeds[0].glsl.length, "smaller line count should produce shorter GLSL");
});

test("assembleWorkingMemory.remixSeeds only includes sketches rated >= 4", () => {
  const db = {
    sketches: [
      makeSketch({ id: "sketch-gen1-1", title: "Low", rating: 2 }),
      makeSketch({ id: "sketch-gen1-2", title: "High", rating: 5 }),
      makeSketch({ id: "sketch-gen1-3", title: "Mid", rating: 3 })
    ],
    currentStrategy: "",
    heuristics: [],
    memoryRollups: []
  };
  const memory = assembleWorkingMemory(db);
  assert.equal(memory.remixSeeds.length, 1);
  assert.equal(memory.remixSeeds[0].title, "High");
});

test("assembleWorkingMemory.remixSeeds includes hypothesis as fallback for remix guidance", () => {
  const db = {
    sketches: [makeSketch({ hypothesis: "Use FBM with amber palette and slow drift" })],
    currentStrategy: "",
    heuristics: [],
    memoryRollups: []
  };
  const memory = assembleWorkingMemory(db);
  assert.ok(memory.remixSeeds[0].hypothesis.includes("amber"), "hypothesis should be included");
});

test("server.js no longer imports buildRemixSection from lib/memory", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const url = await import("url");
  const serverPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "server.js");
  const src = fs.readFileSync(serverPath, "utf8");
  assert.ok(!/buildRemixSection/.test(src), "server.js should not reference buildRemixSection anywhere");
});

test("generateMetadataBatch uses selectLearningExamples and buildExampleDescriptions (no buildRemixSection)", async () => {
  const fs = await import("fs");
  const src = await import("fs").then(m => m.readFileSync(new URL("../server.js", import.meta.url), "utf8"));

  const metadataBatchFn = src.match(/async function generateMetadataBatch[\s\S]*?\n\}/);
  assert.ok(metadataBatchFn, "generateMetadataBatch function must exist in server.js");

  const fnSrc = metadataBatchFn[0];
  assert.ok(/selectLearningExamples\(/.test(fnSrc), "generateMetadataBatch must call selectLearningExamples");
  assert.ok(/buildExampleDescriptions\(/.test(fnSrc), "generateMetadataBatch must call buildExampleDescriptions");
  assert.ok(!/buildRemixSection/.test(fnSrc), "generateMetadataBatch must NOT call buildRemixSection (migrated to selectLearningExamples)");
  assert.ok(!/raw GLSL/i.test(fnSrc), "metadata prompt should not inject raw GLSL (descriptions only)");
});

test("server.js similarity default threshold is 0.92 (loosened from 0.82)", async () => {
  const src = await import("fs").then(m => m.readFileSync(new URL("../server.js", import.meta.url), "utf8"));
  const match = src.match(/SHADER_SIMILARITY_THRESHOLD\s*=\s*Number\(process\.env\.SHADER_SIMILARITY_THRESHOLD\)\s*\|\|\s*([\d.]+)/);
  assert.ok(match, "SHADER_SIMILARITY_THRESHOLD must be set from env with a fallback");
  assert.equal(parseFloat(match[1]), 0.92, "default threshold should be 0.92 (loosened to stop punishing inheritance)");
});

test("generateGlslForSketch excludes picked remix parent from similarity check", async () => {
  const src = await import("fs").then(m => m.readFileSync(new URL("../server.js", import.meta.url), "utf8"));
  const fn = src.match(/async function generateGlslForSketch[\s\S]*?\n\}/);
  assert.ok(fn);
  const fnSrc = fn[0];
  assert.ok(/similarityExcluded/.test(fnSrc), "must track similarityExcluded list to exclude picked parent");
  assert.ok(/findMostSimilarShader\(glsl, db\.sketches, similarityExcluded\)/.test(fnSrc),
    "findMostSimilarShader calls must pass similarityExcluded so parent is exempt");
});

test("assembleWorkingMemory respects REMIX_SEED_LINES env var when no explicit option given", () => {
  const prev = process.env.REMIX_SEED_LINES;
  process.env.REMIX_SEED_LINES = "15";
  try {
    const db = {
      sketches: [makeSketch({ glsl: LONG_SHADER })],
      currentStrategy: "",
      heuristics: [],
      memoryRollups: []
    };
    const memory = assembleWorkingMemory(db);
    const lineCount = memory.remixSeeds[0].glsl.split("\n").length;
    assert.ok(lineCount <= 18, `expected ≤ 18 lines (15 + ellipsis), got ${lineCount}`);
  } finally {
    if (prev === undefined) delete process.env.REMIX_SEED_LINES;
    else process.env.REMIX_SEED_LINES = prev;
  }
});

test("selectLearningExamples continues to work for staged metadata generation", () => {
  const target = { title: "Amber Drift", hypothesis: "warm amber", dna: ["amber", "fbm"] };
  const db = {
    sketches: [
      makeSketch({ id: "sketch-gen1-1", title: "Amber Drift", dna: ["amber", "fbm"], rating: 5 }),
      makeSketch({ id: "sketch-gen1-2", title: "Cool Wave", dna: ["wave", "polar"], rating: 4 }),
      makeSketch({ id: "sketch-gen2-1", title: "Bright Burst", dna: ["bright", "noise"], rating: 5, generation: 2 })
    ]
  };
  const examples = selectLearningExamples(db, target, { limit: 2, currentGeneration: 5 });
  assert.ok(Array.isArray(examples));
  assert.ok(examples.length >= 1, "should select at least one example");
  examples.forEach((ex) => {
    assert.ok(typeof ex.glsl === "string" && ex.glsl.includes("gl_FragColor"));
  });
});