import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSketchDoc, sketchFieldsForMongo } from "../storage/mongo-sketch.js";

test("normalizeSketchDoc restores continual-learning sketch fields", () => {
  const sketch = normalizeSketchDoc({
    _id: "mongo-id",
    id: "sketch-gen3-1",
    title: "Ripple Field",
    type: "evolutionary",
    hypothesis: "FBM ripples",
    glsl: "precision mediump float; void main(){ gl_FragColor = vec4(1.0); }",
    generation: 3,
    rated: true,
    rating: 5,
    ratingSource: "explicit",
    dna: ["fbm", "ripple"],
    compile: { success: true, error: null, reportedAt: "2026-06-27T00:00:00.000Z" },
    critique: {
      strengths: ["full frame"],
      weaknesses: [],
      reusablePatterns: ["layered fbm"],
      avoidPatterns: []
    },
    codeFeatures: { techniques: ["noise"], complexity: "medium" },
    learningContext: {
      exampleIds: ["sketch-gen2-1"],
      preferenceMemoryVersion: 2
    },
    learningUseCount: 1,
    patternIds: ["fbm-layers"],
    thumbnailVersion: 2
  });

  assert.equal(sketch.id, "sketch-gen3-1");
  assert.equal(sketch.ratingSource, "explicit");
  assert.equal(sketch.compile.success, true);
  assert.deepEqual(sketch.critique.reusablePatterns, ["layered fbm"]);
  assert.equal(sketch.codeFeatures.complexity, "medium");
  assert.deepEqual(sketch.learningContext.exampleIds, ["sketch-gen2-1"]);
  assert.equal(sketch.learningUseCount, 1);
  assert.deepEqual(sketch.patternIds, ["fbm-layers"]);
  assert.equal(sketch.thumbnailVersion, 2);
  assert.equal(sketch._id, undefined);
});

test("normalizeSketchDoc restores thumbnailVersion", () => {
  const sketch = normalizeSketchDoc({
    id: "sketch-gen2-1",
    thumbnail: "data:image/jpeg;base64,abc",
    thumbnailVersion: 2
  });
  assert.equal(sketch.thumbnailVersion, 2);
});

test("sketchFieldsForMongo omits Mongo _id and keeps learning payload", () => {
  const payload = sketchFieldsForMongo({
    id: "sketch-gen1-1",
    title: "Test",
    glsl: "void main(){ gl_FragColor = vec4(1.0); }",
    generation: 1,
    critique: { reusablePatterns: ["hash noise"], avoidPatterns: [], strengths: [], weaknesses: [] }
  });

  assert.equal(payload.id, "sketch-gen1-1");
  assert.ok(payload.createdAt);
  assert.deepEqual(payload.critique.reusablePatterns, ["hash noise"]);
});