export { SHADER_PATTERNS, getAllPatterns, getPatternById } from "./patterns.js";
export {
  EMPTY_PATTERN_STATS,
  detectPatternIds,
  updatePatternStats,
  getPatternScore,
  rankPatterns,
  buildLibraryFeedbackSummary
} from "./stats.js";
export {
  selectPatternsForBatch,
  buildBatchPatternPrompt,
  attachPatternToSketch
} from "./selection.js";