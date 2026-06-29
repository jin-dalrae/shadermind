// Default DB shape for ShaderMind on Cloudflare Workers.

export const EMPTY_PREFERENCE_MEMORY = {
  version: 1,
  updatedAtGeneration: 0,
  prefer: [],
  avoid: []
};

const DEFAULT_STRATEGY = `Ground every shader in real math, not visual noise.

MATH — prefer these techniques (and combine them deliberately):
1. Value noise (vnoise) and FBM (5 octaves, lacunarity 2.0, gain 0.5) for organic fields.
2. Iterated domain warp (warp2) for flowing, marbled, organic distortion — the most versatile single technique.
3. Cosine palette (Iñigo Quilez) for all color — never hand-pick RGB, always parameterize.
4. Polar coordinates (toPolar/fromPolar) for radial, mandala, and kaleidoscopic patterns.
5. Ridge FBM (fridge) for terrain, cracks, and geological forms.
6. Lissajous curves with harmonic frequency ratios (1:2, 2:3, 5:8) for parametric motion.

COLOR — commit to one cosine palette per shader:
- amber_glow (1800K-2700K) for candlelit, intimate, warm.
- deep_ocean (6500K-10000K) for cool, vast, mysterious.
- sunset_fire (3500K) for saturated, dramatic, high-contrast.
- bioluminescent for dark backgrounds with glowing accents.
- pastel_dawn (4500K) for soft, airy, low-saturation.
- ember for charcoal with hot core.
Use the 60-30-10 rule for value structure. Stay in one harmonic relationship per shader (complementary, triadic, analogous, or monochromatic). No pure RGB, no rainbow gradients.

MOTION — all motion uses harmonic ratios and easing:
- Period: 8-12 seconds for "slow liquid" aesthetics, 1-3 for "energetic".
- Speed ratios: 1:1, 1:2, 2:3, 3:5, or 1:φ (golden) — never random.
- Easing: smoothstep or smootherstep for one-shot, sin/cos for loops.
- Phase offsets: π/2 for orbital, π for breathing, π/4 for flowing.
- Lissajous: use harmonic frequency ratios, not arbitrary sin/cos.

COMPOSITION — the eye needs structure:
- Rule of thirds: focal points at intersections, not center.
- Golden ratio: focal point at (0.618, 0.618) for organic subjects.
- Visual weight: 60-30-10 distribution of value/density.
- Negative space: 30-50% of the frame should be quiet.
- Symmetry choice: bilateral for formal, radial for mandala, asymmetric for organic.
- Depth: foreground (sharp) + midground (medium) + background (soft, desaturated).

VARY the batch — don't produce three "domain warp + symmetry" shaders. Use different techniques across the 3 slots (evolutionary, directive, mutation) so each batch explores distinct territory.`;

const DEFAULT_HEURISTICS = [
  "Domain warp (warp2) with cosine palette consistently outperforms hand-coded color in curator ratings — parameterize color, don't pick it.",
  "Motion period 8-12 seconds hits the 'meditative' sweet spot; periods under 3 seconds feel frantic, over 20 feel static.",
  "Focal point at golden ratio (0.618, 0.618) is rated higher than center placement for non-symmetric subjects.",
  "Ridge FBM (fridge) and billowed FBM (fbillowed) are underused — they produce distinctive textures that stand out from standard FBM clouds."
];

export const DEFAULT_DB = {
  totalSketches: 0,
  generationCount: 0,
  successRate: 0,
  learningMode: "human",
  lastConsolidationGen: 0,
  memoryRollups: [],
  preferenceMemory: { ...EMPTY_PREFERENCE_MEMORY },
  patternStats: {},
  currentStrategy: DEFAULT_STRATEGY,
  heuristics: DEFAULT_HEURISTICS,
  strategyTimeline: [
    {
      generation: 0,
      timestamp: new Date(0).toISOString(),
      strategy: DEFAULT_STRATEGY,
      notes: "Initial baseline grounded in math, color, motion, and composition theory."
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
