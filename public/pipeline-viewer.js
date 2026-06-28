/**
 * 3D pipeline viewer for GLSL shader generation.
 *
 * Renders a CNN-style architecture diagram inline in any container — no modal,
 * no fullscreen overlay. Click a layer box to see real provenance data from
 * the selected sketch in a small panel below the 3D scene.
 *
 * Public API:
 *   window.PipelineViewer.openInline(sketch, containerEl, layerPanelEl)
 *   window.PipelineViewer.setSketch(sketch)
 *   window.PipelineViewer.close()
 *   window.PipelineViewer.relayoutInline()
 */
import * as THREE from "./vendor/three.module.min.js";

const LAYER_DEFS = [
  { id: "focus",      name: "User Focus",         short: "What's the curator asking for this batch?",                color: 0x6a8caf },
  { id: "memory",     name: "Working Memory",     short: "Pulls strategy, heuristics, remix seeds, preference memory, and patterns into a single context blob.", color: 0x8a9bb8,
    describe: () => "Server-side, no LLM. Reads currentStrategy, top heuristics, last 3 rated \u22654 sketches, preference memory summary, critique block, rollup, and pattern plan. All concatenated into one object passed to the prompt builder." },
  { id: "prompt",     name: "Prompt Construction", short: "Concatenates system + user prompt with all context.",    color: 0xb0a070,
    describe: () => "Server-side, no LLM. Builds the system prompt (role, distribution rules, GLSL ES 1.0 constraints, math cookbook, all context) and the user prompt (Generation #N. Focus: X. Write N distinctive compile-ready shaders.)." },
  { id: "inference",  name: "LLM Inference",      short: "The single inference call that decides everything (math, color, time, motion).", color: 0xc97a5b,
    isInference: true },
  { id: "validation", name: "GLSL Validation",    short: "Local checks: length, void main, gl_FragColor, ES 1.0 syntax, low-effort detector.", color: 0x8caa6a,
    describe: () => "Server-side, no LLM. \u226580 chars, has void main, has gl_FragColor, no ES 3.0 syntax, no .u/.v swizzles, no placeholder signatures, balanced braces, no undefined functions, not a low-effort pulsing-circle." },
  { id: "pattern",    name: "Pattern Attachment", short: "Detects pattern IDs from GLSL body (FBM, polar, ripple, mouse-reactive, etc.).", color: 0x9a7ab8,
    describe: () => "Server-side, no LLM. detectPatternIds() scans the GLSL body for known technique signatures and tags the sketch with patternIds so the next batch's plan can route similar sketches to complementary techniques." },
  { id: "output",     name: "GLSL Shader (output)", short: "The final compiled shader, rendered live in the inline canvas.", color: 0xd0a85a,
    isOutput: true }
];

const BOX_W = 1.5;
const BOX_H = 0.95;
const BOX_D = 0.9;
const LAYER_GAP = 0.7;
const CAMERA_Z = 9;

let state = null;

function buildScene() {
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 2.5, CAMERA_Z);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(4, 6, 8);
  scene.add(dir);
  scene.add(new THREE.DirectionalLight(0xa0b8d8, 0.35).position.set(-6, -3, 4));

  const totalWidth = LAYER_DEFS.length * (BOX_W + LAYER_GAP) - LAYER_GAP;
  const startX = -totalWidth / 2 + BOX_W / 2;
  const layerMeshes = [];

  LAYER_DEFS.forEach((layer, i) => {
    const x = startX + i * (BOX_W + LAYER_GAP);
    const geometry = new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D);
    const material = new THREE.MeshStandardMaterial({
      color: layer.color,
      transparent: true,
      opacity: 0.88,
      roughness: 0.45,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0, 0);
    mesh.userData = { layerIndex: i, layer };
    scene.add(mesh);
    layerMeshes.push(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 })
    );
    edges.position.copy(mesh.position);
    scene.add(edges);

    if (i < LAYER_DEFS.length - 1) {
      const startXArrow = x + BOX_W / 2 + 0.04;
      const endXArrow = startXArrow + LAYER_GAP - 0.08;
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(startXArrow, 0, 0),
        endXArrow - startXArrow,
        0xe0d4b8,
        0.16,
        0.1
      );
      scene.add(arrow);
    }
  });

  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.35 })
  );
  base.position.y = -BOX_H / 2 - 0.05;
  scene.add(base);

  return { scene, camera, layerMeshes };
}

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLayerBody(layer, sketch) {
  if (layer.id === "focus") {
    if (!sketch) return `<p class="pipeline-layer-detail">No sketch data.</p>`;
    return `
      <dl class="pipeline-kv">
        <dt>Curator focus</dt><dd>${escapeHtml(sketch.generationFocus || "(not recorded)")}</dd>
        <dt>Generation</dt><dd>${escapeHtml(String(sketch.generation ?? "?"))}</dd>
        <dt>Sketch ID</dt><dd>${escapeHtml(sketch.id || "?")}</dd>
      </dl>`;
  }
  if (layer.id === "inference") {
    if (!sketch) return `<p class="pipeline-layer-detail">No sketch data.</p>`;
    const model = sketch.model || "(model not recorded)";
    const provider = sketch.provider || "unknown";
    const latency = sketch.inferenceLatencyMs != null ? `${sketch.inferenceLatencyMs} ms` : "(latency not recorded)";
    const ts = sketch.inferenceTimestamp || "(timestamp not recorded)";
    const usage = sketch.inferenceUsage || {};
    const totalTok = usage.totalTokens != null ? usage.totalTokens : "?";
    const promptTok = usage.promptTokens != null ? usage.promptTokens : "?";
    const completionTok = usage.completionTokens != null ? usage.completionTokens : "?";
    const prompt = sketch.prompt || "(prompt not recorded)";
    return `
      <dl class="pipeline-kv">
        <dt>Provider</dt><dd>${escapeHtml(provider)}</dd>
        <dt>Model</dt><dd>${escapeHtml(model)}</dd>
        <dt>Latency</dt><dd>${escapeHtml(latency)}</dd>
        <dt>Tokens (total / prompt / completion)</dt><dd>${escapeHtml(String(totalTok))} / ${escapeHtml(String(promptTok))} / ${escapeHtml(String(completionTok))}</dd>
        <dt>Timestamp</dt><dd>${escapeHtml(ts)}</dd>
      </dl>
      <details class="pipeline-prompt-details" open>
        <summary>User prompt sent to model</summary>
        <pre class="pipeline-prompt">${escapeHtml(prompt)}</pre>
      </details>`;
  }
  if (layer.id === "output") {
    if (!sketch) return `<p class="pipeline-layer-detail">No sketch data.</p>`;
    const glsl = sketch.glsl || "(no GLSL)";
    const compileStatus = sketch.compile?.success === false ? "FAILED" : "OK";
    const dna = (sketch.dna || []).join(", ") || "(none)";
    return `
      <dl class="pipeline-kv">
        <dt>Title</dt><dd>${escapeHtml(sketch.title || "Untitled")}</dd>
        <dt>Type</dt><dd>${escapeHtml(sketch.type || "?")}</dd>
        <dt>DNA</dt><dd>${escapeHtml(dna)}</dd>
        <dt>Compile</dt><dd>${escapeHtml(compileStatus)}</dd>
      </dl>
      <details class="pipeline-prompt-details" open>
        <summary>GLSL source</summary>
        <pre class="pipeline-glsl">${escapeHtml(glsl)}</pre>
      </details>`;
  }
  if (layer.id === "pattern") {
    if (!sketch) return `<p class="pipeline-layer-detail">No sketch data.</p>`;
    const ids = (sketch.patternIds || []).join(", ") || "(no pattern ids detected)";
    return `
      <dl class="pipeline-kv">
        <dt>Detected pattern IDs</dt><dd>${escapeHtml(ids)}</dd>
      </dl>
      <p class="pipeline-layer-detail">Patterns surface in the next batch's plan to route similar sketches toward complementary techniques.</p>`;
  }
  if (layer.describe) {
    return `<p class="pipeline-layer-detail">${escapeHtml(layer.describe())}</p>`;
  }
  return `<p class="pipeline-layer-detail">${escapeHtml(layer.short)}</p>`;
}

function selectLayer(idx) {
  if (!state) return;
  state.selectedIndex = idx;
  state.layerMeshes.forEach((m, i) => {
    const mat = m.material;
    if (i === idx) {
      mat.emissive = new THREE.Color(0x442211);
      mat.opacity = 1.0;
    } else {
      mat.emissive = new THREE.Color(0x000000);
      mat.opacity = 0.88;
    }
  });
  const layer = LAYER_DEFS[idx];
  if (state.layerPanel) {
    const header = state.layerPanel.querySelector("[data-pipeline-header]");
    if (header) header.textContent = `${idx + 1}. ${layer.name}`;
    const body = state.layerPanel.querySelector("[data-pipeline-body]");
    if (body) {
      body.innerHTML = `
        <p class="pipeline-layer-short">${escapeHtml(layer.short)}</p>
        ${renderLayerBody(layer, state.currentSketch)}`;
    }
  }
}

function resize() {
  if (!state || !state.container) return;
  const rect = state.container.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  state.renderer.setSize(w, h, false);
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
}

function animate() {
  if (!state || state.closed) return;
  requestAnimationFrame(animate);
  if (state.autoRotate) state.rotation += 0.004;
  state.scene.rotation.y = state.rotation;
  state.renderer.render(state.scene, state.camera);
}

function teardown() {
  if (!state) return;
  state.closed = true;
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  if (state.renderer) {
    state.renderer.dispose();
    const canvas = state.renderer.domElement;
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
  }
  state.container = null;
  state.layerPanel = null;
  state = null;
}

export function openInline(sketch, containerEl, layerPanelEl) {
  if (!containerEl) return;
  if (state) teardown();

  const { scene, camera, layerMeshes } = buildScene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  containerEl.appendChild(renderer.domElement);
  renderer.domElement.style.cursor = "grab";

  state = {
    renderer,
    scene,
    camera,
    container: containerEl,
    layerPanel: layerPanelEl,
    layerMeshes,
    currentSketch: sketch,
    selectedIndex: -1,
    rotation: 0,
    autoRotate: true,
    closed: false
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let dragX = 0;

  renderer.domElement.addEventListener("pointermove", (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    if (dragging) return;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(layerMeshes);
    layerMeshes.forEach((m) => m.scale.set(1, 1, 1));
    if (hits.length) {
      hits[0].object.scale.set(1.08, 1.12, 1.08);
      renderer.domElement.style.cursor = "pointer";
    } else {
      renderer.domElement.style.cursor = "grab";
    }
  });

  renderer.domElement.addEventListener("click", (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(layerMeshes);
    if (hits.length) {
      state.autoRotate = false;
      selectLayer(hits[0].object.userData.layerIndex);
    }
  });

  renderer.domElement.addEventListener("pointerdown", (ev) => {
    dragging = true;
    dragX = ev.clientX;
    state.autoRotate = false;
    renderer.domElement.style.cursor = "grabbing";
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
    if (renderer.domElement?.style) renderer.domElement.style.cursor = "grab";
  });
  window.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const delta = (ev.clientX - dragX) / 200;
    state.rotation += delta;
    dragX = ev.clientX;
  });

  resize();
  animate();
  selectLayer(sketch ? 3 : 0);
}

export function setSketch(sketch) {
  if (!state) return;
  state.currentSketch = sketch;
  state.selectedIndex = -1;
  state.autoRotate = true;
  state.rotation = 0;
  selectLayer(sketch ? 3 : 0);
}

export function close() {
  teardown();
}

export function relayoutInline() {
  if (state) resize();
}

window.PipelineViewer = { openInline, setSketch, close, relayoutInline };
window.addEventListener("resize", () => { if (state) resize(); });