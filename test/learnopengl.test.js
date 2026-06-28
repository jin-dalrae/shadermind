import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEARNOPENGL_CHAPTERS,
  LEARNOPENGL_GLSL_RULES,
  LEARNOPENGL_LIGHTING_COOKBOOK,
  LEARNOPENGL_SOURCE
} from "../lib/learnopengl.js";
import { MATH_COOKBOOK, MATH_COOKBOOK_COMPACT } from "../lib/math-cookbook.js";

describe("learnopengl curriculum", () => {
  it("exports chapter map with learnopengl URLs", () => {
    assert.ok(LEARNOPENGL_CHAPTERS.length >= 5);
    assert.ok(LEARNOPENGL_CHAPTERS.every(c => c.url.startsWith(LEARNOPENGL_SOURCE)));
  });

  it("math cookbook embeds learnopengl lighting and gamma", () => {
    assert.match(MATH_COOKBOOK, /Gamma correction LAST/i);
    assert.match(MATH_COOKBOOK, /Lambert/i);
    assert.match(MATH_COOKBOOK_COMPACT, /LearnOpenGL/i);
    assert.match(LEARNOPENGL_GLSL_RULES, /gl_FragColor/i);
    assert.match(LEARNOPENGL_LIGHTING_COOKBOOK, /pow\(max\(lit/i);
  });
});