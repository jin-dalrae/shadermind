import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPatternIds, updatePatternStats } from "../lib/shader-library/stats.js";
import { selectPatternsForBatch, buildBatchPatternPrompt } from "../lib/shader-library/selection.js";
import { getAllPatterns } from "../lib/shader-library/patterns.js";

const RIPPLE_GLSL = `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
  float r = length(uv);
  float wave = sin(r * 10.0 - u_time * 0.8) * 0.5 + 0.5;
  float damp = exp(-r * 1.5);
  gl_FragColor = vec4(vec3(wave * damp), 1.0);
}`;

describe("shader library", () => {
  it("catalog has distinct patterns", () => {
    const patterns = getAllPatterns();
    const ids = new Set(patterns.map(p => p.id));
    assert.ok(patterns.length >= 18);
    const lo = patterns.filter(p => p.id.startsWith("lo-"));
    assert.ok(lo.length >= 5);
    assert.equal(ids.size, patterns.length);
  });

  it("detectPatternIds finds damped ripples", () => {
    const ids = detectPatternIds(RIPPLE_GLSL);
    assert.ok(ids.includes("damped-ripples"));
    assert.ok(ids.includes("aspect-uv"));
  });

  it("updatePatternStats scores rated sketches", () => {
    const db = {
      generationCount: 2,
      patternStats: { version: 0, patterns: {} },
      sketches: [{
        id: "sketch-gen2-1",
        generation: 2,
        rated: true,
        rating: 5,
        ratingSource: "explicit",
        glsl: RIPPLE_GLSL,
        libraryPattern: "damped-ripples",
        patternIds: ["damped-ripples"]
      }]
    };
    const stats = updatePatternStats(db, 2);
    assert.ok(stats.patterns["damped-ripples"].uses === 1);
    assert.ok(stats.patterns["damped-ripples"].ratingSum >= 5);
  });

  it("selectPatternsForBatch assigns one pattern per slot", () => {
    const plan = selectPatternsForBatch({ patternStats: { patterns: {} }, sketches: [] }, {
      userFocus: "organic ripples and warm flow",
      genNum: 3,
      batchSize: 3,
      sketchTypeForIndex: (i) => (["evolutionary", "directive", "mutation"][i])
    });
    assert.equal(plan.assignments.length, 3);
    const ids = plan.assignments.map(a => a.primaryId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(buildBatchPatternPrompt(plan).includes("SHADER PATTERN LIBRARY"));
  });

  it("low-rated patterns are deprioritized", () => {
    const db = {
      patternStats: {
        patterns: {
          "damped-ripples": { uses: 4, ratingSum: 6, weightSum: 4, lastGeneration: 10 },
          "voronoi-cells": { uses: 0, ratingSum: 0, weightSum: 0, lastGeneration: 0 }
        }
      },
      sketches: []
    };
    const plan = selectPatternsForBatch(db, {
      userFocus: "mutation experiment",
      genNum: 12,
      batchSize: 3,
      sketchTypeForIndex: () => "mutation"
    });
    const picked = plan.assignments.map(a => a.primaryId);
    assert.ok(picked.includes("voronoi-cells") || !picked.includes("damped-ripples"));
  });
});