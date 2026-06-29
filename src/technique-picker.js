// Technique picker — assigns a specific math/color/composition to
// each sketch slot in a batch. Varies the techniques across the 3
// slots so a batch doesn't produce three "domain warp + symmetry"
// shaders. Each picker output is a "slot recipe" that the workflow
// prompt uses as a constraint.

const TECHNIQUE_POOL = [
  {
    id: "flow_field",
    name: "flow field",
    description: "Curl noise or flow field — particles follow a noise-driven vector field, or the field itself is rendered as a streamline visualization.",
    primaryMath: "fbm + warp2 (iterated domain warp) + hash22 (gradient)",
    colorFamily: "iridescent, deep_ocean",
    motionProfile: "slow flow, 8-12s period, harmonic 1:2 between layers",
    composition: "asymmetric, focal point at golden ratio (0.618, 0.618)",
    bestFor: ["directive", "mutation"]
  },
  {
    id: "fbm_terrain",
    name: "FBM terrain",
    description: "Height field from FBM with directional lighting. Like looking down at mountains or clouds from above.",
    primaryMath: "fbm + vnoise + fridge (ridge FBM) for peaks",
    colorFamily: "amber_glow, pastel_dawn, monochrome_warm",
    motionProfile: "ambient drift, 20-40s, sun moves slowly across the frame",
    composition: "horizon at 1/3 or 2/3 line, depth via atmospheric perspective",
    bestFor: ["evolutionary", "directive"]
  },
  {
    id: "reaction_diffusion",
    name: "reaction-diffusion",
    description: "Organic spot/stripe patterns from a Gray-Scott or Turing instability simulation. Veins, cells, spots.",
    primaryMath: "vnoise + hash21 + thresholding (step/smoothstep)",
    colorFamily: "bioluminescent, deep_ocean",
    motionProfile: "very slow, 30-60s, barely perceptible",
    composition: "rule of thirds focal, 30-50% negative space",
    bestFor: ["mutation"]
  },
  {
    id: "kaleidoscope",
    name: "kaleidoscope",
    description: "Mirror symmetry (n-fold rotational) of a base pattern. Mandala, rose window, kaleidoscope.",
    primaryMath: "toPolar + fromPolar + rot2 + floor(mod(angle*N)/N) for n-fold",
    colorFamily: "iridescent, sunset_fire, amber_glow",
    motionProfile: "slow rotation, 15-30s per revolution, harmonic with internal pulse",
    composition: "centered (symmetric), 4-fold or 6-fold rotational",
    bestFor: ["mutation", "evolutionary"]
  },
  {
    id: "ray_marched_sdf",
    name: "ray-marched SDF",
    description: "2D distance field rendering — circles, boxes, smooth unions rendered with soft shadows and glow.",
    primaryMath: "length(p - center) - radius + smin (smooth min) for unions",
    colorFamily: "ember, bioluminescent, pastel_dawn",
    motionProfile: "active/energetic, 1-3s, objects move with easing",
    composition: "rule of thirds, 2-3 objects, depth via soft shadows",
    bestFor: ["mutation"]
  },
  {
    id: "lissajous_ribbon",
    name: "Lissajous ribbon",
    description: "A ribbon following a Lissajous curve with harmonic frequency ratio, with thickness/color varying along the path.",
    primaryMath: "lissajous(t, a, b, phase) + width modulation + fbm along the path",
    colorFamily: "iridescent, sunset_fire",
    motionProfile: "the Lissajous loop period (e.g. 2π for 1:1, 4π for 1:2)",
    composition: "centered or rule of thirds, the curve defines the frame",
    bestFor: ["directive", "evolutionary"]
  },
  {
    id: "polar_noise",
    name: "polar noise",
    description: "Noise sampled in polar coordinates — creates radial patterns, sunbursts, flower-like forms.",
    primaryMath: "toPolar + fbm(polar) + angle modulation",
    colorFamily: "sunset_fire, amber_glow, pastel_dawn",
    motionProfile: "slow rotation, 10-20s, angle drifts with time",
    composition: "centered (radial), optionally with n-fold rotational",
    bestFor: ["evolutionary", "directive"]
  },
  {
    id: "domain_warp_color",
    name: "domain warp color field",
    description: "A color field (cosine palette) sampled at a domain-warped coordinate. Classic ShaderToy aesthetic.",
    primaryMath: "warp2 (iterated) + cosPalette(t, a, b, c, d)",
    colorFamily: "all palettes, but pick one and commit",
    motionProfile: "slow flow, 6-12s, t feeds into the warp offset",
    composition: "fills the frame, no focal point (wallpaper-style) or rule of thirds",
    bestFor: ["evolutionary", "directive"]
  },
  {
    id: "trigonometric_mandala",
    name: "trigonometric mandala",
    description: "Patterns from sin/cos with varying frequencies and phase offsets. Geometric, symmetric, but with organic variation from the trig functions.",
    primaryMath: "sin/cos with harmonic ratios + rot2 + toPolar/fromPolar",
    colorFamily: "iridescent, pastel_dawn",
    motionProfile: "slow phase drift, 10-20s, multiple layers at different speeds (1:2:3 ratios)",
    composition: "centered, n-fold rotational (4, 6, or 8)",
    bestFor: ["mutation", "evolutionary"]
  }
];

// Pick a technique for each slot in a batch, ensuring variety.
// If a previousBatch is provided, evolutionary slots can reference it.
export function pickTechniques(batchSize = 3, slotTypes = [], previousBatch = []) {
  const slots = [];
  for (let i = 0; i < batchSize; i++) {
    const type = slotTypes[i] || ["evolutionary", "directive", "mutation"][i % 3];
    // Filter techniques that are good for this type, then pick one
    // that hasn't been used in this batch yet.
    const candidates = TECHNIQUE_POOL.filter(t => t.bestFor.includes(type));
    const used = new Set(slots.map(s => s.id));
    const available = candidates.filter(t => !used.has(t.id));
    const pool = available.length ? available : candidates;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    slots.push({ ...pick, slotType: type, slotIndex: i });
  }
  return slots;
}

// Format a technique as a constraint block for the generation prompt.
export function formatTechniqueBlock(technique) {
  return `
SLOT TECHNIQUE: ${technique.name}
${technique.description}

Required math: ${technique.primaryMath}
Color family: ${technique.colorFamily}
Motion profile: ${technique.motionProfile}
Composition: ${technique.composition}
Slot type: ${technique.slotType} (slot ${technique.slotIndex + 1})
`.trim();
}
