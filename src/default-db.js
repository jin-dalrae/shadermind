// Default DB shape for ShaderMind on Cloudflare Workers.
// Simplified from storage/default-db.js to avoid Node.js dependencies
// (no imports from lib/learning/* which need node:fs, node:path, etc).

export const EMPTY_PREFERENCE_MEMORY = {
  version: 1,
  updatedAtGeneration: 0,
  prefer: [],
  avoid: []
};

export const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  learningMode: "human",
  lastConsolidationGen: 0,
  memoryRollups: [],
  preferenceMemory: { ...EMPTY_PREFERENCE_MEMORY },
  patternStats: {},
  currentStrategy: "Focus on fundamental machine creativity and mathematical beauty.",
  heuristics: [],
  strategyTimeline: [
    {
      generation: 0,
      timestamp: new Date(0).toISOString(),
      strategy: "Initial baseline",
      notes: "Starting point."
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
    patternStats: parsed.patternStats || {}
  };
}
