/**
 * Public entry point for ShaderMind's learning engine.
 *
 * The implementation is split by responsibility in `lib/learning/`. Importing
 * from this file keeps server.js and tests simple.
 */
export {
  extractCodeFeatures,
  normalizeDna,
  ratingValue
} from "./learning/features.js";

export {
  EMPTY_PREFERENCE_MEMORY,
  buildPreferenceMemory,
  buildPreferenceSummary
} from "./learning/memory.js";

export {
  buildCritiqueSummary,
  critiqueLabels
} from "./learning/critique.js";

export {
  STRATEGY_BANNED_RE,
  sanitizeEvolvedStrategy,
  sanitizeHeuristics,
  strategyForPrompt,
  validateStrategyOutput
} from "./learning/strategy.js";

export {
  buildExampleContext,
  buildExampleDescriptions,
  buildNoveltyBrief,
  selectLearningExamples
} from "./learning/retrieval.js";

export {
  findMostSimilarShader,
  normalizeGlsl,
  shaderSimilarity
} from "./learning/similarity.js";
