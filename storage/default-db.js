export const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  learningMode: "human",
  lastConsolidationGen: 0,
  memoryRollups: [],
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
      notes: "Starting point inspired by Zach Lieberman's daily sketches survey."
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
    memoryRollups: parsed.memoryRollups || []
  };
}