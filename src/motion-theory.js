// Motion theory — harmonic frequency ratios, easing, Lissajous curves,
// period guidance, and phase relationships. The generation prompt
// includes these so Gemini picks motion parameters that create visual
// harmony instead of arbitrary speeds.

export const HARMONIC_RATIOS = [
  { ratio: "1:1", name: "unison", use: "synchronized motion, breathing" },
  { ratio: "1:2", name: "octave", use: "subtle pulsation, two layers" },
  { ratio: "2:3", name: "perfect fifth", use: "musical harmony, two layers" },
  { ratio: "3:5", name: "major sixth", use: "Fibonacci-like, organic" },
  { ratio: "5:8", name: "minor sixth", use: "Fibonacci, natural" },
  { ratio: "1:1.618", name: "golden ratio", use: "asymmetric, pleasing to eye" },
  { ratio: "1:2.618", name: "Fibonacci", use: "deep organic rhythm" }
];

// GLSL snippet: parametric Lissajous motion with harmonic frequency ratio.
// Use for organic, non-circular motion paths.
export const LISSAJOUS_SNIPPET = `
// Lissajous curve: x = sin(a*t), y = sin(b*t + phase)
// The a/b ratio determines the shape. Use HARMONIC_RATIOS for visual harmony.
vec2 lissajous(float t, float a, float b, float phase) {
  return vec2(sin(a * t), sin(b * t + phase));
}

// Smooth periodic motion: combines two harmonics for a non-trivial period.
// Returns a value in [0, 1] that loops smoothly.
float smoothPeriodic(float t, float speed1, float speed2) {
  return 0.5 + 0.5 * sin(speed1 * t) * cos(speed2 * t * 0.5);
}
`;

export const MOTION_THEORY_GUIDANCE = `
Motion theory — use these principles, not arbitrary u_time multipliers:

HARMONIC FREQUENCY RATIOS — when two things move, their speed ratio matters:
${HARMONIC_RATIOS.map(r => `  - ${r.ratio} (${r.name}): ${r.use}`).join("\n")}

When you have multiple moving elements, pick ratios from this list. Random
ratios (e.g. 1:1.7, 1:2.3) look chaotic. Harmonic ratios look intentional.

PERIOD RECOMMENDATIONS — how long should one cycle take?
  - Breathing/pulse: 3-5 seconds (u_time * 0.628 to u_time * 2.094)
  - Slow flow: 8-12 seconds (u_time * 0.524 to u_time * 0.785)
  - Ambient drift: 20-40 seconds (u_time * 0.157 to u_time * 0.314)
  - Active/energetic: 1-2 seconds (u_time * 3.14 to u_time * 6.28)
  - For "slow liquid" aesthetics: 8-15 seconds is the sweet spot.
  - For "vibrant" aesthetics: 1-3 seconds.

EASING — when animating a value from 0→1, don't use linear interpolation:
  - smoothstep(t) — C1 continuous, natural acceleration/deceleration
  - smootherstep(t) — C2 continuous, even smoother
  - easeInOut(t) — dramatic pause in the middle
  - For loops: use sin/cos for natural oscillation (no easing needed).
  - For one-shot animations: always use smoothstep or smootherstep.

PHASE RELATIONSHIPS — when two things oscillate, their phase offset matters:
  - 0 (in phase): synchronized, feels like one thing
  - π/2 (90°): perpendicular, creates circular or orbital motion
  - π (180°): anti-phase, creates pulsing/breathing
  - π/4 (45°): subtle offset, creates flowing motion
  - For "breathing" aesthetics: use π phase (anti-phase) for inhale/exhale.
  - For "flowing" aesthetics: use π/2 or π/4.

LISSAJOUS CURVES — for parametric motion paths:
${LISSAJOUS_SNIPPET}

AVOID:
  - Linear time (u_time * 1.0) — feels mechanical.
  - Too-fast motion (u_time * 10+) — feels frantic, not meditative.
  - Multiple elements all moving at the same speed — feels static.
  - No motion at all — feels like a screenshot, not a sketch.
`;
