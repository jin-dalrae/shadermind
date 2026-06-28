import {
  getAllChapters,
  getFragmentApplicableChapters,
  getCurriculumStats
} from "./curriculum.js";
import { LEARNOPENGL_SOURCE } from "./constants.js";

/**
 * Rotate through the full curriculum so each generation sees fresh LearnOpenGL context.
 */
export function selectChaptersForBatch(genNum, count = 4, focus = "") {
  const pool = getFragmentApplicableChapters();
  if (!pool.length) return [];

  const focusLower = (focus || "").toLowerCase();
  const scored = pool.map((chapter, idx) => {
    let score = 0;
    const hay = [
      chapter.title,
      chapter.summary,
      chapter.fragmentNotes,
      ...chapter.keyConcepts,
      ...chapter.keywords
    ].join(" ").toLowerCase();

    if (focusLower) {
      for (const word of focusLower.split(/\s+/).filter(w => w.length > 3)) {
        if (hay.includes(word)) score += 3;
      }
    }
    // Spread coverage: prefer chapters not recently rotated to front
    score += ((genNum + idx) % pool.length) * 0.01;
    return { chapter, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  const used = new Set();
  const start = Math.abs(genNum) % pool.length;

  // Round-robin anchor so we walk the whole book over time
  for (let i = 0; i < pool.length && picked.length < count; i++) {
    const ch = pool[(start + i) % pool.length];
    if (!used.has(ch.id)) {
      picked.push(ch);
      used.add(ch.id);
    }
  }

  // Boost focus-related chapters into the set
  for (const { chapter } of scored) {
    if (picked.length >= count) break;
    if (!used.has(chapter.id)) {
      picked.push(chapter);
      used.add(chapter.id);
    }
  }

  return picked.slice(0, count);
}

function formatChapterLine(ch) {
  const concepts = ch.keyConcepts.slice(0, 3).join(", ");
  return `- ${ch.section} / ${ch.title} (${ch.url}): ${ch.fragmentNotes} [${concepts}]`;
}

/** Compact overview injected into every batch prompt. */
export const LEARNOPENGL_CURRICULUM_COMPACT = `
LearnOpenGL full curriculum (${LEARNOPENGL_SOURCE}) — not just shaders:
Getting started (pipeline, textures, transforms, camera) → Lighting (Phong, materials, light types) →
Advanced GL (depth, blending, FBO, cubemaps, instancing, AA) → Advanced lighting (gamma, shadows, normal/parallax, HDR, bloom, SSAO) →
PBR (metallic-roughness, GGX, IBL) → In Practice (particles, postprocess) + guest techniques (OIT, CSM, area lights).
In ShaderMind: borrow concepts in 2D fragment shaders — height-field normals, multi-light, gamma, faux shadows, bloom threshold.
Prefer full-frame procedural fields over isolated circle masks.
`.trim();

/**
 * Per-generation slice of chapters for metadata / GLSL prompts.
 */
export function buildCurriculumPrompt(genNum, focus = "", count = 4) {
  const chapters = selectChaptersForBatch(genNum, count, focus);
  if (!chapters.length) return LEARNOPENGL_CURRICULUM_COMPACT;

  const lines = chapters.map(formatChapterLine);
  const stats = getCurriculumStats();

  return `
LearnOpenGL curriculum slice (gen ${genNum}, ${stats.totalChapters} chapters, ${stats.fragmentApplicable} fragment-adaptable):
${lines.join("\n")}
Draw from these ideas — cite techniques, not URLs in GLSL. Full book: ${LEARNOPENGL_SOURCE}
`.trim();
}

/** API-friendly summary for Settings / shader-library endpoint. */
export function getCurriculumSummary() {
  const stats = getCurriculumStats();
  return {
    source: LEARNOPENGL_SOURCE,
    ...stats,
    chapters: getAllChapters().map(c => ({
      id: c.id,
      section: c.section,
      title: c.title,
      url: c.url,
      fragmentApplicable: c.fragmentApplicable,
      keywords: c.keywords
    }))
  };
}