import {
  SHADER_TUTORIAL_FRAGMENT_COMPACT,
  SHADER_TUTORIAL_MATH_COMPACT,
  SHADER_TUTORIAL_SOURCE
} from "./constants.js";
import { SHADER_TUTORIAL_CURRICULUM } from "./curriculum.js";

export function selectShaderTutorialChapters(genNum, count = 3, focus = "") {
  const pool = SHADER_TUTORIAL_CURRICULUM.filter(c => c.fragmentApplicable);
  const focusLower = (focus || "").toLowerCase();
  const start = Math.abs(genNum) % pool.length;

  const picked = [];
  const used = new Set();

  for (let i = 0; i < pool.length && picked.length < count; i++) {
    const ch = pool[(start + i) % pool.length];
    if (!used.has(ch.id)) {
      picked.push(ch);
      used.add(ch.id);
    }
  }

  if (focusLower) {
    for (const ch of pool) {
      if (picked.length >= count) break;
      const hay = [ch.title, ch.summary, ...ch.keyConcepts].join(" ").toLowerCase();
      if ([...focusLower.split(/\s+/)].some(w => w.length > 3 && hay.includes(w)) && !used.has(ch.id)) {
        picked.push(ch);
        used.add(ch.id);
      }
    }
  }

  return picked.slice(0, count);
}

export function buildShaderTutorialPrompt(genNum, focus = "", count = 3) {
  const chapters = selectShaderTutorialChapters(genNum, count, focus);
  const lines = chapters.map(ch =>
    `- ${ch.title} (${ch.url}): ${ch.fragmentNotes}`
  );

  return `
Shader-Tutorial.dev slice (gen ${genNum}, ${SHADER_TUTORIAL_SOURCE}):
${lines.join("\n")}
${SHADER_TUTORIAL_MATH_COMPACT}
${SHADER_TUTORIAL_FRAGMENT_COMPACT}
`.trim();
}

export function getShaderTutorialSummary() {
  return {
    source: SHADER_TUTORIAL_SOURCE,
    chapters: SHADER_TUTORIAL_CURRICULUM.map(c => ({
      id: c.id,
      section: c.section,
      title: c.title,
      url: c.url,
      fragmentApplicable: c.fragmentApplicable
    }))
  };
}