/**
 * GPU Shader Tutorial concepts for ShaderMind fragment shaders.
 * Source: https://shader-tutorial.dev (basics + mathematics chapters)
 */

export const SHADER_TUTORIAL_SOURCE = "https://shader-tutorial.dev";

export const SHADER_TUTORIAL_MATH_COMPACT = `
Shader-Tutorial math (fragment adaptation — https://shader-tutorial.dev/basics/mathematics/):
Vectors: treat vec2 uv as position from center; vec3(lightDir) as direction (normalize before dot).
Matrices: 2D rotate/scale via mat2(cos,sin); translate with uv -= center before mat2, add after.
Trigonometry: sin/cos drive smooth waves; pulse scale with 0.5 + 0.5*cos(u_time*k); ripples sin(r*f - u_time).
Pattern functions: floor/fract for cells; abs for symmetry; pow for contrast; smoothstep for soft edges (AA intuition).
Interpolate colors with mix() across uv or radial distance — barycentric-style gradients without a vertex stage.
`.trim();

export const SHADER_TUTORIAL_FRAGMENT_COMPACT = `
Shader-Tutorial fragment role (https://shader-tutorial.dev/basics/fragment-shader/):
Each pixel = one main(); gl_FragColor sets fragment color. Uniforms (u_time, u_resolution, u_mouse) are not interpolated.
Use clamp(col, 0.0, 1.0) after arithmetic; cos/sin time shifts for pulsing palettes.
Fill the framebuffer — not edge-only line loops; anti-alias with smoothstep on SDF edges not hard step().
`.trim();