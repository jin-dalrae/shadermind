import { SHADER_TUTORIAL_SOURCE } from "./constants.js";

export const SHADER_TUTORIAL_CURRICULUM = [
  {
    id: "introduction",
    section: "Basics",
    title: "Introduction",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/introduction`,
    summary: "GPU shaders overview and why vertex + fragment stages exist.",
    keyConcepts: ["gpu", "shader stages", "primitives"],
    fragmentApplicable: false,
    fragmentNotes: "ShaderMind runs fragment-only; borrow the per-pixel coloring mindset.",
    keywords: ["intro", "overview"]
  },
  {
    id: "render-pipeline",
    section: "Basics",
    title: "GPU Render Pipeline",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/render-pipeline`,
    summary: "Vertex spec → VS → rasterize → fragment shader → blend → framebuffer.",
    keyConcepts: ["rasterization", "fragments", "framebuffer", "depth test"],
    fragmentApplicable: true,
    fragmentNotes: "We are the fragment stage: one invocation per pixel; depth/blend faked with layered smoothstep.",
    keywords: ["pipeline", "raster", "fragment"]
  },
  {
    id: "mathematics",
    section: "Basics",
    title: "Mathematics Primer",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/mathematics`,
    summary: "Vectors, matrices, trigonometry, and pattern functions for shader math.",
    keyConcepts: ["vectors", "matrices", "trigonometry", "floor", "abs", "pow"],
    fragmentApplicable: true,
    fragmentNotes: "Core toolkit: normalize directions, mat2 rotate UV, sin/cos waves, fract/floor tiling.",
    snippet: "float w = 0.5 + 0.5 * cos(u_time); uv = mat2(c,a,-a,c) * uv; float cell = floor(uv.x * 8.0);",
    keywords: ["math", "vector", "matrix", "sin", "cos"]
  },
  {
    id: "vertex-shader",
    section: "Basics",
    title: "Vertex Shader",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/vertex-shader`,
    summary: "Transforms vertices to clip space; passes varyings to fragment shader.",
    keyConcepts: ["gl_Position", "varying", "attribute", "interpolation"],
    fragmentApplicable: true,
    fragmentNotes: "Fake varyings: mix colors by uv.y or radial barycentric weights inside main().",
    keywords: ["vertex", "varying", "interpolate"]
  },
  {
    id: "color",
    section: "Basics",
    title: "Color",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/color`,
    summary: "RGB components, clamping, and shifting color over time.",
    keyConcepts: ["rgb", "clamp", "color shift", "vec3"],
    fragmentApplicable: true,
    fragmentNotes: "vec3 col = clamp(base + shift, 0.0, 1.0); shift from cos(u_time).",
    keywords: ["color", "rgb", "clamp"]
  },
  {
    id: "fragment-shader",
    section: "Basics",
    title: "Fragment Shader",
    url: `${SHADER_TUTORIAL_SOURCE}/basics/fragment-shader`,
    summary: "Per-fragment color; interpolation from vertices; uniforms vs varyings.",
    keyConcepts: ["gl_FragColor", "fragment", "uniform", "interpolation", "anti-aliasing"],
    fragmentApplicable: true,
    fragmentNotes: "All work in main(); uniforms global; smoothstep edges ≈ multi-sample AA lesson.",
    keywords: ["fragment", "gl_FragColor", "uniform"]
  }
];

const MAP = new Map(SHADER_TUTORIAL_CURRICULUM.map(c => [c.id, c]));

export function getShaderTutorialChapter(id) {
  return MAP.get(id) || null;
}

export function getShaderTutorialStats() {
  return {
    totalChapters: SHADER_TUTORIAL_CURRICULUM.length,
    fragmentApplicable: SHADER_TUTORIAL_CURRICULUM.filter(c => c.fragmentApplicable).length,
    source: SHADER_TUTORIAL_SOURCE
  };
}