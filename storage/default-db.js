import { EMPTY_PREFERENCE_MEMORY } from "../lib/learning/memory.js";
import { EMPTY_PATTERN_STATS } from "../lib/shader-library/stats.js";

export const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  learningMode: "human",
  lastConsolidationGen: 0,
  memoryRollups: [],
  preferenceMemory: { ...EMPTY_PREFERENCE_MEMORY },
  patternStats: { ...EMPTY_PATTERN_STATS },
  currentStrategy: `Focus on fundamental machine creativity and mathematical beauty:
1. Curves that bend and flow using harmonic waves and 2D Simplex Noise.
2. Organic, living movement mimicking natural phenomena (like exposed candle flames in the wind).
3. Subtlety, micro-animations, and soft gradient attenuation.
4. Clean, valid WebGL 1.0 GLSL fragment shader code with proper precision.`,
  heuristics: [
    "Radial symmetry + slow motion → baseline approval target 70%",
    "Soft chromatic gradients and warm amber overlays significantly outperform high-saturation colors.",
    "Organic, flow-based coordinate warping is rated highly, whereas rigid geometric grids are rejected."
  ],
  strategyTimeline: [
    {
      generation: 0,
      timestamp: new Date().toISOString(),
      strategy: "Initial baseline setup: geometric flow and subtle light dynamics.",
      notes: "Starting point: everyday sketches, small changes from the last, learning toward what we love to see."
    }
  ],
  sketches: [],
  statistics: {
    generations: [],
    popularTags: []
  }
};

export function mergeWithDefaults(parsed) {
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_DB)),
    ...parsed,
    statistics: {
      ...DEFAULT_DB.statistics,
      ...(parsed.statistics || {})
    },
    memoryRollups: parsed.memoryRollups || [],
    preferenceMemory: {
      ...EMPTY_PREFERENCE_MEMORY,
      ...(parsed.preferenceMemory || {})
    },
    patternStats: {
      ...EMPTY_PATTERN_STATS,
      ...(parsed.patternStats || {})
    }
  };
}