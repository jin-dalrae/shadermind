import { LEARNOPENGL_SOURCE } from "./constants.js";

/**
 * Full LearnOpenGL table of contents as structured knowledge.
 * fragmentApplicable = ideas we can express in a single WebGL 1.0 fragment shader.
 * fragmentNotes = how to fake or borrow the chapter in 2D (or why it's conceptual only).
 */
export const LEARNOPENGL_CURRICULUM = [
  // ——— Getting started ———
  {
    id: "introduction",
    section: "Introduction",
    title: "Introduction",
    url: `${LEARNOPENGL_SOURCE}/Introduction`,
    summary: "Graphics programming journey: C++, linear algebra, and linear chapter progression.",
    keyConcepts: ["pipeline overview", "prerequisites", "linear learning"],
    fragmentApplicable: false,
    fragmentNotes: "Borrow the discipline: one clear technique per shader, build on prior rated work.",
    keywords: ["overview", "structure"]
  },
  {
    id: "opengl",
    section: "Getting started",
    title: "OpenGL",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/OpenGL`,
    summary: "OpenGL as a state machine API: contexts, buffers, draw calls, and the graphics pipeline.",
    keyConcepts: ["state machine", "context", "pipeline", "draw call"],
    fragmentApplicable: false,
    fragmentNotes: "We only run the fragment stage; treat u_time/u_resolution/u_mouse as host-driven uniforms.",
    keywords: ["api", "pipeline", "state"]
  },
  {
    id: "creating-window",
    section: "Getting started",
    title: "Creating a window",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Creating-a-window`,
    summary: "GLFW/SDL window creation and OpenGL context initialization.",
    keyConcepts: ["GLFW", "context", "viewport"],
    fragmentApplicable: false,
    fragmentNotes: "Viewport maps to u_resolution; aspect-correct UV in fragment shader.",
    keywords: ["window", "context", "glfw"]
  },
  {
    id: "hello-window",
    section: "Getting started",
    title: "Hello Window",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Hello-Window`,
    summary: "Clear color, game loop, poll events, swap buffers.",
    keyConcepts: ["game loop", "clear color", "double buffer"],
    fragmentApplicable: true,
    fragmentNotes: "Background fill color = final gl_FragColor; animate clear via time-varying base.",
    keywords: ["loop", "clear", "animation"]
  },
  {
    id: "hello-triangle",
    section: "Getting started",
    title: "Hello Triangle",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Hello-Triangle`,
    summary: "VAO/VBO, vertex attributes, glDrawArrays — first rendered primitive.",
    keyConcepts: ["VAO", "VBO", "vertex attribute", "draw arrays"],
    fragmentApplicable: false,
    fragmentNotes: "Fake triangles with barycentric-style masks: step on three half-planes or distance to edges.",
    keywords: ["triangle", "vbo", "primitive"]
  },
  {
    id: "shaders",
    section: "Getting started",
    title: "Shaders",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Shaders`,
    summary: "Vertex and fragment stages, GLSL types, uniforms, and compilation.",
    keyConcepts: ["vertex shader", "fragment shader", "uniform", "glsl types"],
    fragmentApplicable: true,
    fragmentNotes: "All logic in main(); uniforms drive animation; precision mediump float required.",
    snippet: "uniform float u_time; void main() { gl_FragColor = vec4(0.2, 0.4, 0.8, 1.0); }",
    keywords: ["shader", "glsl", "uniform", "compile"]
  },
  {
    id: "textures",
    section: "Getting started",
    title: "Textures",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Textures`,
    summary: "Texture objects, sampling, wrapping, filtering, and UV coordinates.",
    keyConcepts: ["sampler", "UV", "wrap", "filter", "mipmap"],
    fragmentApplicable: true,
    fragmentNotes: "Procedural textures: hash noise, FBM, voronoi as stand-ins for sampled images.",
    snippet: "float n = fract(sin(dot(uv, vec2(127.1, 311.7))) * 43758.5453);",
    keywords: ["texture", "uv", "sample", "noise"]
  },
  {
    id: "transformations",
    section: "Getting started",
    title: "Transformations",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Transformations`,
    summary: "Model/view/projection matrices, TRS order, and homogeneous coordinates.",
    keyConcepts: ["matrix", "translate", "rotate", "scale", "MVP"],
    fragmentApplicable: true,
    fragmentNotes: "2D UV transforms: rotate uv with mat2, scale, translate before sampling fields.",
    snippet: "float a = u_time * 0.2; mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a)); uv = rot * uv;",
    keywords: ["transform", "matrix", "rotate", "scale"]
  },
  {
    id: "coordinate-systems",
    section: "Getting started",
    title: "Coordinate Systems",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Coordinate-Systems`,
    summary: "Local, world, view, clip, NDC, and screen space; depth buffer concept.",
    keyConcepts: ["clip space", "NDC", "depth buffer", "perspective divide"],
    fragmentApplicable: true,
    fragmentNotes: "Aspect-correct UV from gl_FragCoord; polar (r, atan); faux depth via layered smoothstep.",
    snippet: "vec2 uv = (gl_FragCoord.xy - 0.5*u_resolution) / min(u_resolution.y, u_resolution.x);",
    keywords: ["ndc", "clip", "aspect", "depth"]
  },
  {
    id: "camera",
    section: "Getting started",
    title: "Camera",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Camera`,
    summary: "Look-at matrix, Euler angles, FPS camera, and view matrix updates.",
    keyConcepts: ["lookAt", "view matrix", "camera position", "euler"],
    fragmentApplicable: true,
    fragmentNotes: "Parallax: offset UV by u_mouse; orbit light direction with sin/cos of u_time.",
    keywords: ["camera", "view", "lookAt", "parallax"]
  },
  {
    id: "getting-started-review",
    section: "Getting started",
    title: "Review",
    url: `${LEARNOPENGL_SOURCE}/Getting-started/Review`,
    summary: "Recap: pipeline, shaders, textures, transforms, coordinates, camera.",
    keyConcepts: ["recap", "pipeline", "fundamentals"],
    fragmentApplicable: true,
    fragmentNotes: "Combine UV warp + procedural texture + simple lighting in one shader.",
    keywords: ["review", "fundamentals"]
  },

  // ——— Lighting ———
  {
    id: "colors",
    section: "Lighting",
    title: "Colors",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Colors`,
    summary: "Object color vs light color; component-wise multiplication for perceived reflection.",
    keyConcepts: ["object color", "light color", "reflection", "component-wise multiply"],
    fragmentApplicable: true,
    fragmentNotes: "vec3 col = lightColor * surfaceColor; tint palettes with slow hue drift.",
    snippet: "vec3 col = vec3(1.0, 0.9, 0.7) * vec3(0.8, 0.3, 0.2);",
    keywords: ["color", "multiply", "tint", "palette"]
  },
  {
    id: "basic-lighting",
    section: "Lighting",
    title: "Basic Lighting",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Basic-Lighting`,
    summary: "Ambient, diffuse (Lambert), and specular (Phong/Blinn) with normals.",
    keyConcepts: ["ambient", "diffuse", "specular", "normal", "Lambert", "Phong"],
    fragmentApplicable: true,
    fragmentNotes: "Height-field normals + directional or point light; Blinn half-vector specular.",
    keywords: ["lighting", "phong", "normal", "diffuse"]
  },
  {
    id: "materials",
    section: "Lighting",
    title: "Materials",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Materials`,
    summary: "Structuring ambient/diffuse/specular strengths per material type.",
    keyConcepts: ["material struct", "shininess", "ambient strength", "diffuse strength"],
    fragmentApplicable: true,
    fragmentNotes: "Vary shininess and ambient/diffuse/specular weights across UV or noise regions.",
    keywords: ["material", "shininess", "strength"]
  },
  {
    id: "lighting-maps",
    section: "Lighting",
    title: "Lighting maps",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Lighting-maps`,
    summary: "Diffuse and specular maps modulate per-texel material response.",
    keyConcepts: ["diffuse map", "specular map", "per-texel"],
    fragmentApplicable: true,
    fragmentNotes: "Use FBM bands as fake diffuse map; high-freq noise channel as specular mask.",
    keywords: ["lightmap", "specular map", "mask"]
  },
  {
    id: "light-casters",
    section: "Lighting",
    title: "Light casters",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Light-casters`,
    summary: "Directional, point, and spot lights with attenuation and cone angles.",
    keyConcepts: ["directional", "point light", "spot light", "attenuation", "cone"],
    fragmentApplicable: true,
    fragmentNotes: "u_mouse as point light; fixed vec3 as directional; spot via smoothstep on angle to axis.",
    keywords: ["point", "spot", "directional", "attenuation"]
  },
  {
    id: "multiple-lights",
    section: "Lighting",
    title: "Multiple lights",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Multiple-lights`,
    summary: "Accumulate contributions from several lights in one pass.",
    keyConcepts: ["light array", "accumulation", "multiple sources"],
    fragmentApplicable: true,
    fragmentNotes: "Sum 2–3 analytic lights (fixed + mouse + oscillating) with clamped contribution.",
    keywords: ["multiple", "accumulate", "lights"]
  },
  {
    id: "lighting-review",
    section: "Lighting",
    title: "Review",
    url: `${LEARNOPENGL_SOURCE}/Lighting/Review`,
    summary: "Recap Phong lighting, materials, maps, and light types.",
    keyConcepts: ["recap", "phong", "materials"],
    fragmentApplicable: true,
    fragmentNotes: "Full Phong-ish stack: ambient + multi-light diffuse/specular + gamma.",
    keywords: ["review", "lighting"]
  },

  // ——— Model Loading ———
  {
    id: "assimp",
    section: "Model Loading",
    title: "Assimp",
    url: `${LEARNOPENGL_SOURCE}/Model-Loading/Assimp`,
    summary: "Asset import library loads meshes, materials, and scene graphs from files.",
    keyConcepts: ["assimp", "import", "scene graph", "mesh file"],
    fragmentApplicable: false,
    fragmentNotes: "Inspire layered scenes: foreground SDF-ish shapes over background fields.",
    keywords: ["assimp", "import", "asset"]
  },
  {
    id: "mesh",
    section: "Model Loading",
    title: "Mesh",
    url: `${LEARNOPENGL_SOURCE}/Model-Loading/Mesh`,
    summary: "Vertex data grouped for draw calls; encapsulate VAO setup per mesh.",
    keyConcepts: ["mesh", "vertices", "indices", "draw"],
    fragmentApplicable: false,
    fragmentNotes: "Tile repeated motifs with fract(uv * N) — instanced-looking patterns.",
    keywords: ["mesh", "geometry"]
  },
  {
    id: "model",
    section: "Model Loading",
    title: "Model",
    url: `${LEARNOPENGL_SOURCE}/Model-Loading/Model`,
    summary: "Collection of meshes with transforms composing a full object.",
    keyConcepts: ["model", "submesh", "hierarchy"],
    fragmentApplicable: false,
    fragmentNotes: "Composite distance fields: min() of several primitive SDFs for silhouette.",
    keywords: ["model", "composite", "hierarchy"]
  },

  // ——— Advanced OpenGL ———
  {
    id: "depth-testing",
    section: "Advanced OpenGL",
    title: "Depth testing",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Depth-testing`,
    summary: "Z-buffer resolves visibility; depth function and depth mask.",
    keyConcepts: ["depth test", "Z-buffer", "LESS", "depth mask"],
    fragmentApplicable: true,
    fragmentNotes: "Fake depth ordering: layer fields with smoothstep on pseudo-z from noise or radial depth.",
    keywords: ["depth", "z-buffer", "occlusion"]
  },
  {
    id: "stencil-testing",
    section: "Advanced OpenGL",
    title: "Stencil testing",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Stencil-testing`,
    summary: "Per-pixel stencil buffer masks drawing regions for outlines and mirrors.",
    keyConcepts: ["stencil", "mask", "increment", "outline"],
    fragmentApplicable: true,
    fragmentNotes: "Stencil-like masking: draw motif only inside region = step inside shape boundary.",
    keywords: ["stencil", "mask", "outline"]
  },
  {
    id: "blending",
    section: "Advanced OpenGL",
    title: "Blending",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Blending`,
    summary: "Alpha blending, draw order, and transparency sorting.",
    keyConcepts: ["alpha blend", "SRC_ALPHA", "transparency", "sorting"],
    fragmentApplicable: true,
    fragmentNotes: "Layer semi-transparent colors: mix(a, b, alpha) over dark base; soft edges via smoothstep.",
    keywords: ["blend", "alpha", "transparency"]
  },
  {
    id: "face-culling",
    section: "Advanced OpenGL",
    title: "Face culling",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Face-culling`,
    summary: "Cull back or front faces to save fill rate on closed meshes.",
    keyConcepts: ["culling", "winding order", "back face"],
    fragmentApplicable: false,
    fragmentNotes: "Asymmetric patterns: one-sided gradients mimicking lit front faces only.",
    keywords: ["cull", "winding", "face"]
  },
  {
    id: "framebuffers",
    section: "Advanced OpenGL",
    title: "Framebuffers",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Framebuffers`,
    summary: "Off-screen rendering to textures; post-processing chains.",
    keyConcepts: ["FBO", "render to texture", "post-process"],
    fragmentApplicable: true,
    fragmentNotes: "Simulate two-pass: compute raw col, then apply vignette/blur-ish neighbor sample in same main().",
    keywords: ["framebuffer", "postprocess", "rt"]
  },
  {
    id: "cubemaps",
    section: "Advanced OpenGL",
    title: "Cubemaps",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Cubemaps`,
    summary: "Six-face environment maps for skyboxes and reflection lookups.",
    keyConcepts: ["cubemap", "skybox", "environment", "reflection"],
    fragmentApplicable: true,
    fragmentNotes: "Fake sky gradient from uv angle; reflect dir from normal for env tint on specular.",
    keywords: ["cubemap", "skybox", "environment"]
  },
  {
    id: "advanced-data",
    section: "Advanced OpenGL",
    title: "Advanced Data",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Advanced-Data`,
    summary: "Interleaved vs separated vertex attributes; instancing introduction.",
    keyConcepts: ["interleaved", "stride", "instancing hint"],
    fragmentApplicable: false,
    fragmentNotes: "Grid repetition = many copies of a motif via fract tiling.",
    keywords: ["vertex", "interleaved", "instance"]
  },
  {
    id: "advanced-glsl",
    section: "Advanced OpenGL",
    title: "Advanced GLSL",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Advanced-GLSL`,
    summary: "GLSL function control flow, builtins, and interface blocks overview.",
    keyConcepts: ["glsl functions", "builtins", "interface block"],
    fragmentApplicable: true,
    fragmentNotes: "Small helper functions (hash, fbm); avoid long control flow — float loops only.",
    keywords: ["glsl", "function", "builtin"]
  },
  {
    id: "geometry-shader",
    section: "Advanced OpenGL",
    title: "Geometry Shader",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Geometry-Shader`,
    summary: "Generate or expand primitives on the GPU between vertex and fragment stages.",
    keyConcepts: ["geometry shader", "emit vertices", "expansion"],
    fragmentApplicable: false,
    fragmentNotes: "Procedural duplication: kaleidoscope / domain repeat mimics emitted copies.",
    keywords: ["geometry", "expand", "emit"]
  },
  {
    id: "instancing",
    section: "Advanced OpenGL",
    title: "Instancing",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Instancing`,
    summary: "Draw many objects in one call with per-instance attributes.",
    keyConcepts: ["instancing", "per-instance", "draw elements instanced"],
    fragmentApplicable: true,
    fragmentNotes: "Cellular grids: fract(uv * float(N)) - 0.5 per cell with hash-based variation.",
    keywords: ["instance", "grid", "repeat"]
  },
  {
    id: "anti-aliasing",
    section: "Advanced OpenGL",
    title: "Anti Aliasing",
    url: `${LEARNOPENGL_SOURCE}/Advanced-OpenGL/Anti-Aliasing`,
    summary: "MSAA, FXAA, and edge smoothing strategies.",
    keyConcepts: ["MSAA", "FXAA", "jaggies", "smooth edges"],
    fragmentApplicable: true,
    fragmentNotes: "smoothstep on SDF edges instead of step; wider feather on shape boundaries.",
    keywords: ["aa", "smoothstep", "edge"]
  },

  // ——— Advanced Lighting ———
  {
    id: "advanced-lighting",
    section: "Advanced Lighting",
    title: "Advanced Lighting",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Advanced-Lighting`,
    summary: "Blinn-Phong refinements, attenuation formulas, and light space intuition.",
    keyConcepts: ["Blinn-Phong", "attenuation", "light space"],
    fragmentApplicable: true,
    fragmentNotes: "Prefer Blinn half-vector; inverse-square attenuation for point lights.",
    keywords: ["blinn", "advanced", "attenuation"]
  },
  {
    id: "gamma-correction",
    section: "Advanced Lighting",
    title: "Gamma Correction",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Gamma-Correction`,
    summary: "Linear lighting calculations then gamma encode for display (sRGB).",
    keyConcepts: ["gamma", "linear", "sRGB", "pow 1/2.2"],
    fragmentApplicable: true,
    fragmentNotes: "All lighting in linear space; single pow(rgb, vec3(1.0/2.2)) before gl_FragColor.",
    snippet: "col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));",
    keywords: ["gamma", "linear", "srgb"]
  },
  {
    id: "shadow-mapping",
    section: "Advanced Lighting",
    title: "Shadow Mapping",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Shadows/Shadow-Mapping`,
    summary: "Render depth from light POV; compare fragment depth for shadowing.",
    keyConcepts: ["shadow map", "depth compare", "light space", "PCF"],
    fragmentApplicable: true,
    fragmentNotes: "Fake shadows: darken regions where height < neighbor or radial occluder from light dir.",
    keywords: ["shadow", "depth map", "occlusion"]
  },
  {
    id: "point-shadows",
    section: "Advanced Lighting",
    title: "Point Shadows",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Shadows/Point-Shadows`,
    summary: "Omnidirectional shadows via cubemap depth from point lights.",
    keyConcepts: ["point shadow", "omnidirectional", "depth cubemap"],
    fragmentApplicable: true,
    fragmentNotes: "Radial shadow falloff from u_mouse point light; darken behind crests of height field.",
    keywords: ["point shadow", "omni", "cubemap depth"]
  },
  {
    id: "normal-mapping",
    section: "Advanced Lighting",
    title: "Normal Mapping",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Normal-Mapping`,
    summary: "Tangent-space normal maps perturb surface normals for fine detail.",
    keyConcepts: ["normal map", "tangent space", "perturbation", "TBN"],
    fragmentApplicable: true,
    fragmentNotes: "Procedural normal perturbation: finite differences on multi-octave FBM height.",
    keywords: ["normal map", "bump", "tangent"]
  },
  {
    id: "parallax-mapping",
    section: "Advanced Lighting",
    title: "Parallax Mapping",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Parallax-Mapping`,
    summary: "Offset UV by height along view direction for depth illusion.",
    keyConcepts: ["parallax", "height map", "UV offset", "steep parallax"],
    fragmentApplicable: true,
    fragmentNotes: "Offset uv by height * viewDir.xy for relief; works well with u_mouse parallax.",
    keywords: ["parallax", "displacement", "depth illusion"]
  },
  {
    id: "hdr",
    section: "Advanced Lighting",
    title: "HDR",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/HDR`,
    summary: "High dynamic range buffers and tone mapping exposure.",
    keyConcepts: ["HDR", "exposure", "tone mapping", "reinhard"],
    fragmentApplicable: true,
    fragmentNotes: "Allow col > 1.0 in linear sum; tone map: col = col / (col + vec3(1.0)); then gamma.",
    keywords: ["hdr", "exposure", "tone map"]
  },
  {
    id: "bloom",
    section: "Advanced Lighting",
    title: "Bloom",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Bloom`,
    summary: "Extract bright pixels, blur, and add back for glow.",
    keyConcepts: ["bloom", "threshold", "blur", "glow"],
    fragmentApplicable: true,
    fragmentNotes: "Cheap bloom: add smoothstep(luminance - threshold) * warm tint to highlights in one pass.",
    keywords: ["bloom", "glow", "threshold"]
  },
  {
    id: "deferred-shading",
    section: "Advanced Lighting",
    title: "Deferred Shading",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/Deferred-Shading`,
    summary: "G-buffer stores position/normal/albedo; lighting pass decoupled.",
    keyConcepts: ["G-buffer", "deferred", "position normal albedo"],
    fragmentApplicable: false,
    fragmentNotes: "Conceptual: compute albedo + normal first variables, then lighting block — same main().",
    keywords: ["deferred", "gbuffer"]
  },
  {
    id: "ssao",
    section: "Advanced Lighting",
    title: "SSAO",
    url: `${LEARNOPENGL_SOURCE}/Advanced-Lighting/SSAO`,
    summary: "Screen-space ambient occlusion darkens creases from depth/normal neighbors.",
    keyConcepts: ["SSAO", "ambient occlusion", "kernel", "hemisphere"],
    fragmentApplicable: true,
    fragmentNotes: "Darken where local height variance is high — crease factor from neighbor height deltas.",
    keywords: ["ssao", "occlusion", "crevice"]
  },

  // ——— PBR ———
  {
    id: "pbr-theory",
    section: "PBR",
    title: "Theory",
    url: `${LEARNOPENGL_SOURCE}/PBR/Theory`,
    summary: "Microfacet theory, energy conservation, metallic-roughness workflow.",
    keyConcepts: ["PBR", "microfacet", "metallic", "roughness", "energy conservation"],
    fragmentApplicable: true,
    fragmentNotes: "Roughness modulates spec power; metallic lerps diffuse vs spec tint.",
    keywords: ["pbr", "metallic", "roughness", "microfacet"]
  },
  {
    id: "pbr-lighting",
    section: "PBR",
    title: "Lighting",
    url: `${LEARNOPENGL_SOURCE}/PBR/Lighting`,
    summary: "Cook-Torrance BRDF with GGX distribution and Schlick Fresnel.",
    keyConcepts: ["Cook-Torrance", "GGX", "Fresnel", "Schlick"],
    fragmentApplicable: true,
    fragmentNotes: "Simplified GGX: spec power from roughness; Fresnel at grazing via pow(1-dot(n,v),5).",
    keywords: ["ggx", "fresnel", "cook-torrance"]
  },
  {
    id: "ibl-diffuse",
    section: "PBR",
    title: "Diffuse irradiance",
    url: `${LEARNOPENGL_SOURCE}/PBR/IBL/Diffuse-irradiance`,
    summary: "Convolved environment map provides ambient diffuse from all directions.",
    keyConcepts: ["IBL", "irradiance", "diffuse ambient", "environment"],
    fragmentApplicable: true,
    fragmentNotes: "Constant ambient tint from normal.y (sky vs ground hemispheres).",
    keywords: ["ibl", "irradiance", "ambient"]
  },
  {
    id: "ibl-specular",
    section: "PBR",
    title: "Specular IBL",
    url: `${LEARNOPENGL_SOURCE}/PBR/IBL/Specular-IBL`,
    summary: "Prefiltered env map and BRDF LUT for specular image-based lighting.",
    keyConcepts: ["prefilter", "BRDF LUT", "specular IBL"],
    fragmentApplicable: true,
    fragmentNotes: "Fake env spec: add warm/cool tint to specular based on reflect direction angle.",
    keywords: ["ibl", "specular", "prefilter"]
  },

  // ——— In Practice ———
  {
    id: "debugging",
    section: "In Practice",
    title: "Debugging",
    url: `${LEARNOPENGL_SOURCE}/In-Practice/Debugging`,
    summary: "GL error checking, debug output, and common mistake diagnosis.",
    keyConcepts: ["glGetError", "debug output", "validation"],
    fragmentApplicable: false,
    fragmentNotes: "Write compile-safe shaders: short, no undefined helpers, mediump precision.",
    keywords: ["debug", "error", "validate"]
  },
  {
    id: "text-rendering",
    section: "In Practice",
    title: "Text Rendering",
    url: `${LEARNOPENGL_SOURCE}/In-Practice/Text-Rendering`,
    summary: "Glyph atlas and quads for HUD text.",
    keyConcepts: ["glyph", "atlas", "FreeType", "text quad"],
    fragmentApplicable: false,
    fragmentNotes: "Bitmap font patterns via step on grid cells — optional stylistic motif only.",
    keywords: ["text", "font", "glyph"]
  },
  {
    id: "breakout",
    section: "In Practice",
    title: "Breakout",
    url: `${LEARNOPENGL_SOURCE}/In-Practice/2D-Game/Breakout`,
    summary: "2D game loop integrating rendering, input, collision, particles, post-processing.",
    keyConcepts: ["2D game", "collision", "particles", "postprocess"],
    fragmentApplicable: true,
    fragmentNotes: "Arcade energy: hard edges, power-up color flashes, paddle/ball motion in UV space.",
    keywords: ["game", "2d", "arcade"]
  },
  {
    id: "particles",
    section: "In Practice",
    title: "Particles",
    url: `${LEARNOPENGL_SOURCE}/In-Practice/2D-Game/Particles`,
    summary: "GPU or CPU particle systems for sparks and debris.",
    keyConcepts: ["particle", "emitter", "lifetime", "velocity"],
    fragmentApplicable: true,
    fragmentNotes: "Many tiny bright dots: hash-based spark positions animated with u_time fract.",
    keywords: ["particle", "spark", "emitter"]
  },
  {
    id: "postprocessing",
    section: "In Practice",
    title: "Postprocessing",
    url: `${LEARNOPENGL_SOURCE}/In-Practice/2D-Game/Postprocessing`,
    summary: "Framebuffer passes for blur, powerups glow, and full-screen effects.",
    keyConcepts: ["postprocess", "framebuffer pass", "blur", "powerup glow"],
    fragmentApplicable: true,
    fragmentNotes: "Chromatic-ish fringe: sample offset RGB channels; vignette and scanlines.",
    keywords: ["postprocess", "blur", "effect"]
  },

  // ——— Guest Articles (selected) ———
  {
    id: "oit-intro",
    section: "Guest Articles",
    title: "OIT Introduction",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2020/OIT/Introduction`,
    summary: "Order-independent transparency problem and weighted blending overview.",
    keyConcepts: ["OIT", "transparency sorting", "weighted blended"],
    fragmentApplicable: true,
    fragmentNotes: "Layered transparency with accumulated alpha — soft overlapping blobs.",
    keywords: ["oit", "transparency"]
  },
  {
    id: "skeletal-animation",
    section: "Guest Articles",
    title: "Skeletal Animation",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2020/Skeletal-Animation`,
    summary: "Bone hierarchies and vertex skinning for articulated meshes.",
    keyConcepts: ["skeletal", "skinning", "bones", "animation"],
    fragmentApplicable: false,
    fragmentNotes: "Articulated motion: warp UV along sin bones / segmented twist fields.",
    keywords: ["skeletal", "skinning", "bones"]
  },
  {
    id: "csm",
    section: "Guest Articles",
    title: "CSM",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2021/CSM`,
    summary: "Cascaded shadow maps for stable outdoor sun shadows.",
    keyConcepts: ["CSM", "cascade", "shadow split", "sun shadow"],
    fragmentApplicable: true,
    fragmentNotes: "Tiered shadow softness by distance bands from a directional light.",
    keywords: ["csm", "cascade", "shadow"]
  },
  {
    id: "scene-graph",
    section: "Guest Articles",
    title: "Scene Graph",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2021/Scene/Scene-Graph`,
    summary: "Hierarchical transforms and scene organization.",
    keyConcepts: ["scene graph", "hierarchy", "transform tree"],
    fragmentApplicable: false,
    fragmentNotes: "Nested UV transforms = parent rotate then child offset motif.",
    keywords: ["scene graph", "hierarchy"]
  },
  {
    id: "tessellation-height",
    section: "Guest Articles",
    title: "Height map",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2021/Tessellation/Height-map`,
    summary: "Displacement from height textures via tessellation.",
    keyConcepts: ["height map", "displacement", "tessellation"],
    fragmentApplicable: true,
    fragmentNotes: "Strong height-driven normal + parallax — same as parallax/normal chapters.",
    keywords: ["height", "displacement", "terrain"]
  },
  {
    id: "compute-shaders",
    section: "Guest Articles",
    title: "Compute Shaders Introduction",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2022/Compute-Shaders/Introduction`,
    summary: "General-purpose GPU compute outside the raster pipeline.",
    keyConcepts: ["compute shader", "SSBO", "dispatch"],
    fragmentApplicable: false,
    fragmentNotes: "Not available in WebGL 1 fragment-only; inspire iterative feedback loops in formula.",
    keywords: ["compute", "gpgpu"]
  },
  {
    id: "phys-based-bloom",
    section: "Guest Articles",
    title: "Phys. Based Bloom",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2022/Phys.-Based-Bloom`,
    summary: "Physically-informed bloom threshold and knee for HDR glow.",
    keyConcepts: ["physically based bloom", "threshold knee", "HDR glow"],
    fragmentApplicable: true,
    fragmentNotes: "Soft knee bloom: smoothstep between threshold and threshold+knee on luminance.",
    keywords: ["bloom", "knee", "hdr"]
  },
  {
    id: "area-lights",
    section: "Guest Articles",
    title: "Area Lights",
    url: `${LEARNOPENGL_SOURCE}/Guest-Articles/2022/Area-Lights`,
    summary: "LTC and integral approximations for extended light sources.",
    keyConcepts: ["area light", "LTC", "extended source"],
    fragmentApplicable: true,
    fragmentNotes: "Soft falloff from line/rectangle analytic light — wider specular than point light.",
    keywords: ["area light", "soft", "extended"]
  }
];

const CHAPTER_MAP = new Map(LEARNOPENGL_CURRICULUM.map(c => [c.id, c]));

/** Legacy shape for tests and pattern cross-refs. */
export const LEARNOPENGL_CHAPTERS = LEARNOPENGL_CURRICULUM.map(c => ({
  id: c.id,
  title: c.title,
  url: c.url,
  section: c.section,
  topics: c.keywords,
  fragmentApplicable: c.fragmentApplicable
}));

export function getChapterById(id) {
  return CHAPTER_MAP.get(id) || null;
}

export function getAllChapters() {
  return LEARNOPENGL_CURRICULUM;
}

export function getFragmentApplicableChapters() {
  return LEARNOPENGL_CURRICULUM.filter(c => c.fragmentApplicable);
}

export function getChaptersBySection(section) {
  return LEARNOPENGL_CURRICULUM.filter(c => c.section === section);
}

export function getCurriculumStats() {
  const sections = [...new Set(LEARNOPENGL_CURRICULUM.map(c => c.section))];
  return {
    totalChapters: LEARNOPENGL_CURRICULUM.length,
    fragmentApplicable: getFragmentApplicableChapters().length,
    sections: sections.map(name => ({
      name,
      count: LEARNOPENGL_CURRICULUM.filter(c => c.section === name).length
    }))
  };
}