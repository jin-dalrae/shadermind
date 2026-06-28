import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

const INDEX_HTML = new URL("../public/index.html", import.meta.url);
const APP_JS = new URL("../public/app.js", import.meta.url);
const PIPELINE_JS = new URL("../public/pipeline-viewer.js", import.meta.url);
const CSS = new URL("../public/index.css", import.meta.url);

test("public/vendor/three.module.min.js exists (local Three.js, no CDN)", () => {
  assert.ok(fs.existsSync(new URL("../public/vendor/three.module.min.js", import.meta.url)),
    "three.module.min.js must be vendored locally to avoid CDN dependency");
  assert.ok(fs.existsSync(new URL("../public/vendor/three.core.min.js", import.meta.url)),
    "three.core.min.js must be vendored (peer of three.module.min.js)");
});

test("public/index.html does NOT load Three.js from a CDN", () => {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  assert.ok(!/unpkg\.com/.test(html), "no unpkg.com CDN reference");
  assert.ok(!/cdn\.jsdelivr\.net/.test(html), "no jsdelivr CDN reference");
  assert.ok(!/skypack\.dev/.test(html), "no skypack CDN reference");
  assert.ok(!/esm\.sh/.test(html), "no esm.sh CDN reference");
});

test("public/index.html exposes the inline studio-detail scaffold", () => {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  assert.ok(/id="studioDetail"/.test(html), "studio detail section must exist");
  assert.ok(/id="detailTitle"/.test(html), "detail title element must exist");
  assert.ok(/id="detailCanvas"/.test(html), "inline detail canvas must exist");
  assert.ok(/id="detailPipelineStage"/.test(html), "inline pipeline 3D stage must exist");
  assert.ok(/id="detailProvenance"/.test(html), "provenance block must exist");
  assert.ok(/id="detailCode"/.test(html), "GLSL code block must exist");
  assert.ok(/id="detailClose"/.test(html), "detail close button must exist");
  assert.ok(/class="studio-detail"/.test(html), "studio-detail section class must be present");
});

test("public/index.html does NOT have the old fullscreen shader dialog", () => {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  assert.ok(!/class="shader-dialog"/.test(html), "old shader-dialog modal must be removed");
  assert.ok(!/class="pipeline-viewer"/.test(html), "old fullscreen pipeline-viewer overlay must be removed");
  assert.ok(!/id="dialogCanvas"/.test(html), "old dialog canvas must be removed");
  assert.ok(!/id="dialogPipelineBtn"/.test(html), "old dialog pipeline button must be removed");
});

test("public/pipeline-viewer.js uses ESM import for Three.js (not global)", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/import \* as THREE from "\.\/vendor\/three\.module\.min\.js"/.test(src),
    "must import THREE from local vendor file");
  assert.ok(!/window\.THREE/.test(src), "must not depend on window.THREE global");
});

test("public/pipeline-viewer.js defines the 7 layers in correct order", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  const layerIds = ["focus", "memory", "prompt", "inference", "validation", "pattern", "output"];
  const positions = layerIds.map((id) => src.indexOf(`id: "${id}"`));
  for (let i = 0; i < positions.length; i += 1) {
    assert.ok(positions[i] > -1, `layer ${layerIds[i]} must be defined`);
  }
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `layer ${layerIds[i]} must come after ${layerIds[i - 1]}`);
  }
});

test("public/pipeline-viewer.js defines provenance-aware body for inference layer", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/sketch\.inferenceLatencyMs/.test(src), "inference panel must show latency from sketch record");
  assert.ok(/sketch\.inferenceUsage/.test(src), "inference panel must show usage from sketch record");
  assert.ok(/sketch\.model/.test(src), "inference panel must show model from sketch record");
  assert.ok(/sketch\.prompt/.test(src), "inference panel must show user prompt");
  assert.ok(/sketch\.provider/.test(src), "inference panel must show provider");
});

test("public/pipeline-viewer.js defines provenance-aware body for output layer", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/sketch\.glsl/.test(src), "output panel must show GLSL source");
  assert.ok(/sketch\.dna/.test(src), "output panel must show DNA tags");
  assert.ok(/sketch\.compile/.test(src), "output panel must show compile status");
});

test("public/pipeline-viewer.js connects layers with ArrowHelper in a loop", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/THREE\.ArrowHelper/.test(src), "must use ArrowHelper for inter-layer arrows");
  assert.ok(/if \(i < LAYER_DEFS\.length - 1\)/.test(src),
    "arrows must be created in a loop bounded by layer count (one per inter-layer gap)");
  assert.ok(/new THREE\.Vector3\(1, 0, 0\)/.test(src),
    "arrows must use a direction vector for proper orientation");
});

test("public/pipeline-viewer.js exposes inline API via window.PipelineViewer", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/window\.PipelineViewer/.test(src), "must expose window.PipelineViewer API");
  assert.ok(/openInline/.test(src), "PipelineViewer must have openInline method");
  assert.ok(/setSketch/.test(src), "PipelineViewer must have setSketch method");
  assert.ok(/close/.test(src), "PipelineViewer must have close method");
  assert.ok(/relayoutInline/.test(src), "PipelineViewer must have relayoutInline method for resize handling");
});

test("public/pipeline-viewer.js uses a single shared renderer (not per-call) to avoid context exhaustion", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  const rendererCreations = (src.match(/new THREE\.WebGLRenderer\(/g) || []).length;
  assert.equal(rendererCreations, 1,
    `expected exactly 1 WebGL renderer construction (not per-call), found ${rendererCreations}`);
  assert.ok(/function setSketch/.test(src),
    "must have setSketch to update sketch without creating new renderer");
});

test("public/app.js wires selectSketch to populate inline detail pane (not modal)", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  assert.ok(/selectSketch\(/.test(src), "app.js must define selectSketch method");
  assert.ok(/this\.els\.studioDetail/.test(src), "selectSketch must use the studioDetail element");
  assert.ok(/this\.els\.detailCanvas/.test(src), "selectSketch must populate detailCanvas");
  assert.ok(/this\.els\.detailPipelineStage/.test(src), "selectSketch must populate detailPipelineStage");
  assert.ok(/window\.PipelineViewer\?\.openInline/.test(src),
    "selectSketch must call PipelineViewer.openInline (NOT open)");
  assert.ok(/window\.PipelineViewer\?\.setSketch/.test(src),
    "selectSketch must call PipelineViewer.setSketch to reuse the renderer");
  assert.ok(/selectSketch\(/.test(src) && /scrollIntoView/.test(src),
    "selectSketch must scroll the detail pane into view");
});

test("public/app.js has no remaining references to removed dialog DOM elements", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  for (const removed of [
    "els.dialogCanvas",
    "els.dialogTitle",
    "els.dialogPipelineBtn",
    "els.dialogHypothesis",
    "els.dialogRating",
    "els.dialogCode",
    "els.dialogError",
    "els.dialogLoading",
    "els.dialogHint",
    "els.dialogStatement",
    "els.dialogRerate.",
    "els.dialogRerate?",
    "els.dialogRerate ",
    "els.dialogRateActions",
    "els.dialogRerateHint",
    "els.dialogPoster",
    "els.shaderDialog",
    "dialogSketchId",
    "dialogRenderer",
    "dialogOwnedRenderer"
  ]) {
    assert.ok(!src.includes(removed), `app.js must not reference removed ${removed}`);
  }
});

test("public/index.css styles the inline studio-detail + inline pipeline panel", () => {
  const css = fs.readFileSync(CSS, "utf8");
  assert.ok(/\.studio-detail/.test(css), "studio-detail class must be styled");
  assert.ok(/\.studio-detail-grid/.test(css), "studio-detail-grid must be styled (2-col layout)");
  assert.ok(/\.studio-detail-canvas-wrap/.test(css), "detail canvas wrap must be styled");
  assert.ok(/\.studio-detail-pipeline/.test(css), "detail pipeline stage must be styled");
  assert.ok(/\.studio-detail-provenance/.test(css), "provenance block must be styled");
  assert.ok(/\.prov-row/.test(css), "provenance row class must be styled");
  assert.ok(/\.pipeline-panel-inline/.test(css), "inline pipeline panel must be styled");
});

test("public/pipeline-viewer.js escapes HTML in layer body to prevent injection", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/function escapeHtml/.test(src), "escapeHtml helper must exist");
  assert.ok(/&amp;/.test(src) || /&lt;/.test(src), "escapeHtml must perform HTML entity replacement");
});

test("public/pipeline-viewer.js calls relayout() on resize to keep 3D scene sized correctly", () => {
  const src = fs.readFileSync(PIPELINE_JS, "utf8");
  assert.ok(/function resize\(\)/.test(src), "resize function must exist");
  assert.ok(/addEventListener\("resize"/.test(src), "must listen to window resize event");
  assert.ok(/setSize\(w, h, false\)/.test(src), "resize must update renderer size");
});

test("public/app.js selectSketch compiles the shader in the inline detail canvas", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  assert.ok(/compileWhenReady/.test(src),
    "selectSketch must call compileWhenReady on the detail renderer");
  assert.ok(/ShaderRenderer/.test(src),
    "app.js must instantiate ShaderRenderer for the detail canvas");
});

test("public/app.js uses a single detailRenderer (not per-sketch) to avoid WebGL context exhaustion", () => {
  const src = fs.readFileSync(APP_JS, "utf8");
  const persistentMatches = (src.match(/this\.(?:detail)?Renderer\s*=\s*new ShaderRenderer\(/g) || []).length;
  assert.ok(persistentMatches <= 1,
    `expected ≤ 1 persistent ShaderRenderer assignment, found ${persistentMatches}`);
});