export {
  LEARNOPENGL_SOURCE,
  LEARNOPENGL_GLSL_RULES,
  LEARNOPENGL_LIGHTING_COOKBOOK
} from "./constants.js";

export {
  LEARNOPENGL_CURRICULUM,
  LEARNOPENGL_CHAPTERS,
  getChapterById,
  getAllChapters,
  getFragmentApplicableChapters,
  getChaptersBySection,
  getCurriculumStats
} from "./curriculum.js";

export {
  selectChaptersForBatch,
  buildCurriculumPrompt,
  LEARNOPENGL_CURRICULUM_COMPACT,
  getCurriculumSummary
} from "./prompt.js";