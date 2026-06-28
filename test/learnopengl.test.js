import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEARNOPENGL_CHAPTERS,
  LEARNOPENGL_CURRICULUM,
  LEARNOPENGL_GLSL_RULES,
  LEARNOPENGL_LIGHTING_COOKBOOK,
  LEARNOPENGL_SOURCE,
  buildCurriculumPrompt,
  getCurriculumStats,
  getCurriculumSummary,
  selectChaptersForBatch
} from "../lib/learnopengl.js";
import { MATH_COOKBOOK, MATH_COOKBOOK_COMPACT } from "../lib/math-cookbook.js";

describe("learnopengl curriculum", () => {
  it("exports full chapter map with learnopengl URLs", () => {
    assert.ok(LEARNOPENGL_CURRICULUM.length >= 40);
    assert.ok(LEARNOPENGL_CHAPTERS.length === LEARNOPENGL_CURRICULUM.length);
    assert.ok(LEARNOPENGL_CHAPTERS.every(c => c.url.startsWith(LEARNOPENGL_SOURCE)));
  });

  it("covers major LearnOpenGL sections", () => {
    const stats = getCurriculumStats();
    const names = stats.sections.map(s => s.name);
    assert.ok(names.includes("Getting started"));
    assert.ok(names.includes("Lighting"));
    assert.ok(names.includes("Advanced OpenGL"));
    assert.ok(names.includes("Advanced Lighting"));
    assert.ok(names.includes("PBR"));
    assert.ok(stats.fragmentApplicable >= 30);
  });

  it("rotates chapter slices per generation", () => {
    const a = selectChaptersForBatch(1, 4, "bloom");
    const b = selectChaptersForBatch(9, 4, "bloom");
    assert.equal(a.length, 4);
    assert.equal(b.length, 4);
    assert.ok(a.every(c => c.fragmentApplicable));
    const prompt = buildCurriculumPrompt(3, "shadow", 3);
    assert.match(prompt, /LearnOpenGL curriculum slice/i);
    assert.match(prompt, /learnopengl\.com/);
  });

  it("summarizes curriculum for API", () => {
    const summary = getCurriculumSummary();
    assert.equal(summary.totalChapters, LEARNOPENGL_CURRICULUM.length);
    assert.ok(summary.chapters.every(c => c.id && c.url));
  });

  it("math cookbook embeds learnopengl lighting and gamma", () => {
    assert.match(MATH_COOKBOOK, /Gamma correction LAST/i);
    assert.match(MATH_COOKBOOK, /Lambert/i);
    assert.match(MATH_COOKBOOK_COMPACT, /LearnOpenGL/i);
    assert.match(MATH_COOKBOOK_COMPACT, /PBR/i);
    assert.match(LEARNOPENGL_GLSL_RULES, /gl_FragColor/i);
    assert.match(LEARNOPENGL_LIGHTING_COOKBOOK, /pow\(max\(lit/i);
  });
});