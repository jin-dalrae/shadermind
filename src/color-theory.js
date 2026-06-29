// Color theory — specific cosine palette parameters, harmonic
// relationships, and temperature guidance. The generation prompt
// includes these so Gemini can choose a named aesthetic instead of
// improvising color choices.

// Famous cosine palettes from Iñigo Quilez (https://iquilezles.org/articles/palettes/).
// Each entry: { name, a, b, c, d, mood } — these are the four vec3
// parameters for cosPalette(t, a, b, c, d).
export const NAMED_PALETTES = [
  {
    name: "amber_glow",
    mood: "warm, candlelit, intimate",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 0.5],
    d: [0.0, 0.10, 0.20]
  },
  {
    name: "deep_ocean",
    mood: "cool, vast, mysterious",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [2.0, 1.0, 1.0],
    d: [0.50, 0.20, 0.25]
  },
  {
    name: "sunset_fire",
    mood: "saturated, dramatic, high-contrast",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.33, 0.67]
  },
  {
    name: "iridescent",
    mood: "shifting, pearlescent, oil-on-water",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 0.7, 0.4],
    d: [0.0, 0.15, 0.20]
  },
  {
    name: "bioluminescent",
    mood: "dark with glowing accents, deep-sea",
    a: [0.0, 0.3, 0.5],
    b: [0.3, 0.5, 0.3],
    c: [0.5, 1.0, 1.0],
    d: [0.6, 0.4, 0.3]
  },
  {
    name: "pastel_dawn",
    mood: "soft, airy, low-saturation",
    a: [0.7, 0.6, 0.6],
    b: [0.2, 0.2, 0.2],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.10, 0.20]
  },
  {
    name: "ember",
    mood: "dark with hot core, charcoal and flame",
    a: [0.3, 0.2, 0.1],
    b: [0.6, 0.4, 0.2],
    c: [1.0, 1.0, 0.5],
    d: [0.0, 0.25, 0.45]
  },
  {
    name: "monochrome_warm",
    mood: "sepia, single-hue, photographic",
    a: [0.5, 0.4, 0.3],
    b: [0.3, 0.3, 0.2],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.08, 0.15]
  }
];

// Color temperature in Kelvin → linear RGB.
// Tanner Helland's approximation. Range: 1000K (candle) to 40000K (blue sky).
export function kelvinToRgb(k) {
  const temp = k / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }
  return {
    r: Math.round(Math.max(0, Math.min(255, r))),
    g: Math.round(Math.max(0, Math.min(255, g))),
    b: Math.round(Math.max(0, Math.min(255, b))),
    name: k < 3000 ? "warm" : k < 5500 ? "neutral" : "cool"
  };
}

// Color theory guidance block — included in the generation prompt.
export const COLOR_THEORY_GUIDANCE = `
Color theory — use these principles, not random RGB:

PALETTE SELECTION — choose one NAMED palette per shader and commit to it:
${NAMED_PALETTES.map(p => `  - ${p.name}: ${p.mood}`).join("\n")}

COSINE PALETTE USAGE:
  - The parameter 'c' controls color cycle frequency. c=1.0 = one full hue
    rotation across t∈[0,1]. c=2.0 = two rotations (more variation).
  - The parameter 'd' shifts the hue. d=[0, 0, 0] = starts at the a+b peak.
  - Low b = muted/desaturated. High b = vivid/saturated.
  - For "dark mode" aesthetics, set a to a low value (e.g. [0.1, 0.1, 0.1])
    so the palette never reaches full brightness.

COLOR TEMPERATURE — Kelvin temperature affects mood:
  - 1800K-2700K: candle/tungsten — amber, orange, warm
  - 3000K-4000K: warm white — cream, soft yellow
  - 5000K-6500K: daylight — neutral white
  - 8000K-10000K: overcast sky — cool blue
  - Use temperature consistently within a shader: don't mix 3000K and 10000K.

VALUE STRUCTURE (not just hue):
  - 60-30-10 rule: 60% of pixels in the dominant value, 30% in secondary,
    10% in accent. Don't use all values equally.
  - High-contrast shaders need at least 20% pure dark and 20% pure bright.
  - Low-contrast shaders should stay in a 40%-70% value range.

HARMONIC RELATIONSHIPS — pick one and stick to it:
  - Complementary: 180° apart on the color wheel. High tension, use sparingly.
  - Triadic: 120° apart. Balanced, vibrant.
  - Analogous: 30° apart. Harmonious, calm.
  - Split-complementary: 180° ± 30°. Softer than pure complementary.
  - Monochromatic: single hue, vary saturation and value. Safest, most cohesive.

AVOID:
  - Pure red (#FF0000), pure green, pure blue — they vibrate and look digital.
  - Equal-saturation rainbow gradients — they look like a 1990s screensaver.
  - The same RGB triplet appearing in multiple shaders in a batch — vary it.
`;
