import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHADER_TUTORIAL_CURRICULUM,
  SHADER_TUTORIAL_MATH_COMPACT,
  SHADER_TUTORIAL_SOURCE,
  buildShaderTutorialPrompt,
  getShaderTutorialStats
} from "../lib/shader-tutorial.js";
import { MATH_COOKBOOK } from "../lib/math-cookbook.js";

describe("shader-tutorial curriculum", () => {
  it("includes mathematics chapter from shader-tutorial.dev", () => {
    const math = SHADER_TUTORIAL_CURRICULUM.find(c => c.id === "mathematics");
    assert.ok(math);
    assert.equal(math.url, `${SHADER_TUTORIAL_SOURCE}/basics/mathematics`);
    assert.ok(math.keyConcepts.includes("trigonometry"));
  });

  it("builds prompt slice with math material", () => {
    const prompt = buildShaderTutorialPrompt(4, "ripple sin", 3);
    assert.match(prompt, /shader-tutorial\.dev/i);
    assert.match(prompt, /mat2|sin|cos/i);
  });

  it("math cookbook embeds shader-tutorial blocks", () => {
    assert.match(MATH_COOKBOOK, /Shader-Tutorial math/i);
    assert.match(MATH_COOKBOOK, /fragment adaptation/i);
    assert.match(SHADER_TUTORIAL_MATH_COMPACT, /Trigonometry/i);
  });

  it("summarizes curriculum for API", () => {
    const stats = getShaderTutorialStats();
    assert.ok(stats.totalChapters >= 6);
    assert.ok(stats.fragmentApplicable >= 4);
  });
});