/**
 * Pipeline viewer — non-rotating, artifact-first view of the shader
 * generation pipeline for the selected sketch.
 *
 * Renders 7 stage cards inline as a flat, static row. Every card shows
 * the *real artifact* from that step (curator focus text, working memory
 * snapshot, the actual prompt sent to the model, inference provenance,
 * compile result, detected patterns, output shader). Nothing is hidden
 * behind a click — clicking a card just highlights it.
 *
 * Replaces the prior Three.js CNN-style diagram (which rotated constantly
 * and showed empty colored boxes with no labels).
 *
 * Public API (unchanged so app.js doesn't need to change):
 *   window.PipelineViewer.openInline(sketch, containerEl, layerPanelEl)
 *   window.PipelineViewer.setSketch(sketch)
 *   window.PipelineViewer.close()
 *   window.PipelineViewer.relayoutInline()
 */

const STAGES = [
  { id: "focus",      name: "Curator Focus",  color: "#6a8caf", number: 1, render: renderFocus },
  { id: "memory",     name: "Working Memory", color: "#8a9bb8", number: 2, render: renderMemory },
  { id: "prompt",     name: "Prompt",         color: "#b0a070", number: 3, render: renderPrompt },
  { id: "inference",  name: "Inference",      color: "#c97a5b", number: 4, render: renderInference },
  { id: "validation", name: "Validation",     color: "#8caa6a", number: 5, render: renderValidation },
  { id: "pattern",    name: "Pattern Match",  color: "#9a7ab8", number: 6, render: renderPattern },
  { id: "output",     name: "Output Shader",  color: "#d0a85a", number: 7, render: renderOutput }
];

let state = null;

// ---------- helpers ----------

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortNumber(n) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function pill(text, cls = "") {
  return `<span class="pv-pill ${cls}">${escapeHtml(text)}</span>`;
}

function kv(rows) {
  return `<dl class="pv-kv">${rows
    .filter(r => r.value !== null && r.value !== undefined && r.value !== "")
    .map(r => `<dt>${escapeHtml(r.label)}</dt><dd>${r.html || escapeHtml(r.value)}</dd>`)
    .join("")}</dl>`;
}

async function fetchState() {
  try {
    const [stateRes, sketchesRes] = await Promise.all([
      fetch("/api/state"),
      fetch("/api/sketches")
    ]);
    const stateJson = await stateRes.json();
    const sketchesJson = await sketchesRes.json();
    return { state: stateJson, sketches: Array.isArray(sketchesJson) ? sketchesJson : [] };
  } catch (err) {
    return { state: null, sketches: [], error: err.message };
  }
}

// ---------- per-stage renderers ----------

// Stage 1 — Curator Focus
function renderFocus(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const focus = sketch.generationFocus || sketch.lastHumanOpinion || null;
  const focusHtml = focus
    ? `<div class="pv-focus-text">${escapeHtml(focus)}</div>`
    : `<div class="pv-missing">(no focus recorded for this batch — autopilot used default heuristics)</div>`;
  return `
    <div class="pv-card-body">
      <div class="pv-label">Focus text</div>
      ${focusHtml}
      ${kv([
        { label: "Generation", value: sketch.generation ?? "?" },
        { label: "Sketch ID", value: sketch.id || "?" },
        { label: "Type", value: sketch.type || "?" }
      ])}
    </div>`;
}

// Stage 2 — Working Memory (strategy + heuristics + remix parents)
function renderMemory(sketch, ctx) {
  if (!ctx || !ctx.state) {
    return `<div class="pv-empty">Loading memory…</div>`;
  }
  const strategy = (ctx.state.currentStrategy || "").trim();
  const strategyTrimmed = strategy.length > 280 ? strategy.slice(0, 280) + "…" : strategy;
  const heuristics = (ctx.state.heuristics || []).slice(0, 4);
  const all = ctx.sketches || [];
  const remixParents = all
    .filter(x => x.rating && x.rating >= 4 && x.id !== sketch?.id)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 4);

  return `
    <div class="pv-card-body">
      <div class="pv-label">Strategy genome</div>
      ${strategyTrimmed
        ? `<div class="pv-strategy">${escapeHtml(strategyTrimmed)}</div>`
        : `<div class="pv-missing">(no strategy)</div>`}
      ${heuristics.length ? `
        <div class="pv-label">Heuristics (top ${heuristics.length})</div>
        <ul class="pv-heuristics">${heuristics.map(h => `<li>${escapeHtml(h)}</li>`).join("")}</ul>
      ` : ""}
      ${remixParents.length ? `
        <div class="pv-label">Top-rated remix parents</div>
        <ul class="pv-remix">${remixParents.map(p => `
          <li>
            <span class="pv-remix-title">${escapeHtml(p.title || p.id)}</span>
            <span class="pv-pill pv-pill-rate">${escapeHtml(String(p.rating))}/5</span>
            <span class="pv-remix-dna">${escapeHtml((p.dna || []).slice(0, 3).join(" · "))}</span>
          </li>`).join("")}</ul>
      ` : `<div class="pv-missing">No 4+ rated sketches yet.</div>`}
    </div>`;
}

// Stage 3 — Prompt (verbatim user prompt sent to the model)
function renderPrompt(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const prompt = sketch.prompt;
  if (!prompt) {
    return `<div class="pv-card-body">
      <div class="pv-missing">Prompt not recorded for this sketch. Inference provenance (prompt + tokens + latency) was added in a later version — only batches generated after that include the actual prompt sent to the model.</div>
      ${kv([
        { label: "Title", value: sketch.title || "?" },
        { label: "Type", value: sketch.type || "?" },
        { label: "DNA", value: (sketch.dna || []).join(", ") || "(none)" }
      ])}
    </div>`;
  }
  return `
    <div class="pv-card-body">
      <div class="pv-label">User prompt sent to model</div>
      <pre class="pv-prompt">${escapeHtml(prompt)}</pre>
    </div>`;
}

// Stage 4 — Inference provenance
function renderInference(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const hasProv = !!(sketch.provider || sketch.model || sketch.inferenceLatencyMs != null || sketch.inferenceUsage);
  if (!hasProv) {
    return `<div class="pv-card-body">
      <div class="pv-missing">Inference provenance not recorded for this sketch (added in a later version). Hypothesis is still available:</div>
      ${kv([
        { label: "Hypothesis", value: sketch.hypothesis || "(none)" }
      ])}
    </div>`;
  }
  const usage = sketch.inferenceUsage || {};
  const rows = [
    { label: "Provider", value: sketch.provider || "?" },
    { label: "Model", value: sketch.model || "?", html: `<span class="pv-mono">${escapeHtml(sketch.model || "?")}</span>` },
    { label: "Latency", value: sketch.inferenceLatencyMs != null ? `${sketch.inferenceLatencyMs} ms` : "—" },
    {
      label: "Tokens (prompt / completion / total)",
      html: `<span class="pv-mono">${shortNumber(usage.promptTokens)} / ${shortNumber(usage.completionTokens)} / ${shortNumber(usage.totalTokens)}</span>`
    },
    { label: "Timestamp", value: sketch.inferenceTimestamp || "?" }
  ];
  return `
    <div class="pv-card-body">
      ${kv(rows)}
      <div class="pv-label">Hypothesis</div>
      <div class="pv-hypothesis">${escapeHtml(sketch.hypothesis || "(none)")}</div>
    </div>`;
}

// Stage 5 — Validation (compile result + static checks derived from this sketch's GLSL)
function renderValidation(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const compile = sketch.compile || {};
  const success = compile.success === true;
  const failed = compile.success === false;
  const unknown = compile.success == null;
  const status = success ? "PASS" : failed ? "FAIL" : "UNKNOWN";
  const statusCls = success ? "pv-status-ok" : failed ? "pv-status-fail" : "pv-status-unknown";

  const glsl = sketch.glsl || "";
  const checks = [
    { label: "Length ≥ 80 chars", pass: glsl.length >= 80 },
    { label: "void main() present", pass: /void\s+main\s*\(/.test(glsl) },
    { label: "gl_FragColor present", pass: /gl_FragColor/.test(glsl) },
    { label: "WebGL 1.0 (no `out vec4`, no `texture()`)", pass: !/\bout\s+vec4/.test(glsl) && !/\btexture\s*\(/.test(glsl) },
    { label: "Balanced braces", pass: (glsl.match(/\{/g) || []).length === (glsl.match(/\}/g) || []).length },
    { label: "Balanced parens", pass: (glsl.match(/\(/g) || []).length === (glsl.match(/\)/g) || []).length }
  ];

  return `
    <div class="pv-card-body">
      <div class="pv-status-row">
        <span class="pv-status ${statusCls}">${status}</span>
        ${compile.reportedAt ? `<span class="pv-timestamp">${escapeHtml(new Date(compile.reportedAt).toLocaleString())}</span>` : ""}
      </div>
      ${failed && compile.error ? `
        <div class="pv-label">Compile error</div>
        <pre class="pv-error">${escapeHtml(compile.error)}</pre>
      ` : ""}
      <div class="pv-label">Static checks (from this sketch's GLSL)</div>
      <ul class="pv-checks">${checks.map(c =>
        `<li class="${c.pass ? "pv-check-ok" : "pv-check-fail"}"><span class="pv-check-mark">${c.pass ? "✓" : "✗"}</span>${escapeHtml(c.label)}</li>`
      ).join("")}</ul>
    </div>`;
}

// Stage 6 — Pattern Match (patternIds + codeFeatures breakdown)
function renderPattern(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const ids = sketch.patternIds || [];
  const features = sketch.codeFeatures || {};
  const fns = features.functions || [];
  const tech = features.techniques || [];

  return `
    <div class="pv-card-body">
      <div class="pv-label">Detected pattern IDs</div>
      ${ids.length
        ? `<div class="pv-pills">${ids.map(id => pill(id, "pv-pill-pattern")).join("")}</div>`
        : `<div class="pv-missing">(no pattern ids detected)</div>`}
      ${fns.length ? `
        <div class="pv-label">Functions called in shader</div>
        <div class="pv-pills">${fns.map(fn => pill(fn + "()", "pv-pill-fn")).join("")}</div>
      ` : ""}
      ${tech.length ? `
        <div class="pv-label">Techniques</div>
        <div class="pv-pills">${tech.map(t => pill(t, "pv-pill-tech")).join("")}</div>
      ` : ""}
      ${(features.motion || features.composition || features.palette || features.complexity) ? `
        <div class="pv-label">Features</div>
        ${kv([
          features.motion?.length ? { label: "Motion", value: features.motion.join(", ") } : null,
          features.composition?.length ? { label: "Composition", value: features.composition.join(", ") } : null,
          features.palette?.length ? { label: "Palette", value: features.palette.join(", ") } : null,
          features.complexity ? { label: "Complexity", value: features.complexity } : null
        ].filter(Boolean))}
      ` : ""}
    </div>`;
}

// Stage 7 — Output Shader (title/type/DNA + thumbnail or placeholder)
function renderOutput(sketch /*, ctx */) {
  if (!sketch) return `<div class="pv-empty">No sketch selected.</div>`;
  const dna = sketch.dna || [];
  const thumb = sketch.thumbnail;
  const previewHtml = thumb
    ? `<img class="pv-preview-img" src="${escapeHtml(thumb)}" alt="Rendered preview of ${escapeHtml(sketch.title || sketch.id || "")}" loading="lazy" />`
    : `<div class="pv-preview-placeholder">
         <div class="pv-preview-icon">▶</div>
         <div class="pv-preview-text">Live preview in dialog only — rate this shader 4+ to capture a thumbnail.</div>
       </div>`;

  return `
    <div class="pv-card-body">
      <div class="pv-label">Title</div>
      <div class="pv-output-title">${escapeHtml(sketch.title || "Untitled")}</div>
      ${kv([
        { label: "Type", value: sketch.type || "?" },
        sketch.rating ? { label: "Your rating", value: `${sketch.rating}/5` } : null,
        sketch.compile?.success === false ? { label: "Compile", value: "FAILED", html: `<span class="pv-status pv-status-fail">FAILED</span>` } : null
      ].filter(Boolean))}
      ${dna.length ? `
        <div class="pv-label">DNA</div>
        <div class="pv-pills">${dna.map(t => pill(t, "pv-pill-dna")).join("")}</div>
      ` : ""}
      <div class="pv-label">Preview</div>
      <div class="pv-preview">${previewHtml}</div>
    </div>`;
}

// ---------- composition + lifecycle ----------

function renderCard(stage, sketch, ctx, selected) {
  const body = stage.render(sketch, ctx);
  const cls = selected ? "pv-card pv-card-selected" : "pv-card";
  return `
    <article class="${cls}" data-stage="${stage.id}" style="--stage-color:${stage.color}">
      <header class="pv-card-head">
        <span class="pv-card-num">${stage.number}</span>
        <span class="pv-card-name">${stage.name}</span>
      </header>
      ${body}
    </article>`;
}

function renderTrack(sketch, ctx, selectedIndex) {
  return STAGES.map((s, i) => renderCard(s, sketch, ctx, i === selectedIndex)).join("");
}

function rerenderTrack() {
  if (!state) return;
  const track = state.container.querySelector(".pv-track");
  if (!track) return;
  track.innerHTML = renderTrack(state.currentSketch, state.ctx, state.selectedIndex);
  // Re-bind click handlers (innerHTML replaces them).
  state.container.querySelectorAll(".pv-card").forEach(el => {
    const idx = STAGES.findIndex(s => s.id === el.dataset.stage);
    if (idx >= 0) {
      el.addEventListener("click", () => selectStage(idx));
    }
  });
}

function selectStage(idx) {
  if (!state) return;
  state.selectedIndex = idx;
  rerenderTrack();
}

export async function openInline(sketch, containerEl, layerPanelEl) {
  if (!containerEl) return;
  if (state) close();

  containerEl.classList.add("pv-container");
  containerEl.innerHTML = `
    <div class="pv-track-wrap">
      <div class="pv-track">${renderTrack(sketch, { state: null, sketches: [] }, 3)}</div>
    </div>
    <p class="pv-hint">Click a card to highlight it. Every stage shows the real artifact for this sketch — no rotation, no hidden data.</p>
  `;

  // Legacy layer panel is unused in this design — hide it.
  if (layerPanelEl) {
    layerPanelEl.hidden = true;
    layerPanelEl.style.display = "none";
  }

  state = {
    container: containerEl,
    layerPanel: layerPanelEl,
    currentSketch: sketch,
    selectedIndex: 3,
    ctx: { state: null, sketches: [] },
    closed: false
  };

  rerenderTrack();

  // Fetch live state for memory card. Re-render when ready.
  const fetched = await fetchState();
  if (!state || state.closed) return;
  state.ctx.state = fetched.state;
  state.ctx.sketches = fetched.sketches;
  rerenderTrack();
}

export function setSketch(sketch) {
  if (!state) return;
  state.currentSketch = sketch;
  state.selectedIndex = 3;
  rerenderTrack();
}

export function close() {
  if (!state) return;
  state.closed = true;
  if (state.container) state.container.innerHTML = "";
  state.container = null;
  state.layerPanel = null;
  state = null;
}

export function relayoutInline() {
  // CSS is responsive — nothing to recalc.
}

window.PipelineViewer = { openInline, setSketch, close, relayoutInline };