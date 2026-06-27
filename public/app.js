import { ShaderRenderer } from "./shader-renderer.js?v=10";

const PHASE_LABELS = {
  idle: "ready",
  generating: "generating batch…",
  planning: "planning batch…",
  awaiting_human: "awaiting your curation",
  evolving: "updating strategy…",
  waiting: "generating next batch…",
  error: "error · retrying"
};

class ShaderMindUI {
  constructor() {
    this.renderers = new Map();
    this.timelineRenderers = [];
    this.dialogRenderer = null;
    this.dialogReparent = null;
    this.dialogOwnedRenderer = false;
    this.suspendedGridIds = [];
    this.displayedGeneration = null;
    this.displayedBatchKey = null;
    this.lastGen = -1;
    this.sketches = [];
    this.activeBatch = null;
    this.userRatings = {};
    this.thumbBackfillQueue = [];
    this.thumbBackfillBusy = false;
    this.thumbBackfillSeen = new Set();
    this.timelineKey = null;
    this.pollTimer = null;
    this.pollIntervalMs = 3000;

    this.els = {
      statGen: document.getElementById("statGen"),
      statSketches: document.getElementById("statSketches"),
      statFavor: document.getElementById("statFavor"),
      autopilotPill: document.getElementById("autopilotPill"),
      pillText: document.getElementById("pillText"),
      studioStatus: document.getElementById("studioStatus"),
      statusMessage: document.getElementById("statusMessage"),
      batchLabel: document.getElementById("batchLabel"),
      btnGenerateNext: document.getElementById("btnGenerateNext"),
      shaderGrid: document.getElementById("shaderGrid"),
      emptyState: document.getElementById("emptyState"),
      curationPanel: document.getElementById("curationPanel"),
      userOpinion: document.getElementById("userOpinion"),
      btnSubmitFeedback: document.getElementById("btnSubmitFeedback"),
      curationHint: document.getElementById("curationHint"),
      reflectionText: document.getElementById("reflectionText"),
      strategyText: document.getElementById("strategyText"),
      timelineList: document.getElementById("timelineList"),
      heuristicsList: document.getElementById("heuristicsList"),
      btnMonologue: document.getElementById("btnMonologue"),
      monologueOutput: document.getElementById("monologueOutput"),
      monologueText: document.getElementById("monologueText"),
      logFeed: document.getElementById("logFeed"),
      shaderDialog: document.getElementById("shaderDialog"),
      dialogClose: document.getElementById("dialogClose"),
      dialogCanvas: document.getElementById("dialogCanvas"),
      dialogError: document.getElementById("dialogError"),
      dialogLoading: document.getElementById("dialogLoading"),
      dialogHint: document.getElementById("dialogHint"),
      dialogEyebrow: document.getElementById("dialogEyebrow"),
      dialogTitle: document.getElementById("dialogTitle"),
      dialogHypothesis: document.getElementById("dialogHypothesis"),
      dialogStatement: document.getElementById("dialogStatement"),
      dialogTags: document.getElementById("dialogTags"),
      dialogCode: document.getElementById("dialogCode")
    };

    this.els.dialogClose.addEventListener("click", () => this.closeDialog());
    this.els.shaderDialog.addEventListener("click", (e) => {
      if (e.target === this.els.shaderDialog) this.closeDialog();
    });
    this.els.btnMonologue.addEventListener("click", () => this.fetchMonologue());
    this.els.btnSubmitFeedback.addEventListener("click", () => this.submitFeedback());
    this.els.btnGenerateNext.addEventListener("click", () => this.generateNextBatch());

    this.poll();
    this.schedulePoll();
  }

  schedulePoll() {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => this.poll(), this.pollIntervalMs);
  }

  setPollInterval(ms) {
    if (this.pollIntervalMs === ms) return;
    this.pollIntervalMs = ms;
    this.schedulePoll();
  }

  timelineFingerprint(state) {
    const good = this.sketches.filter(s => s.rating === "good");
    const withThumb = good.filter(s => s.thumbnail).length;
    return `${state.generationCount}:${(state.strategyTimeline || []).length}:${good.length}:${withThumb}`;
  }

  seedThumbnailBackfill() {
    this.sketches
      .filter(s => s.rating === "good" && !s.thumbnail)
      .forEach(s => this.queueThumbnailBackfill(s));
  }

  async poll() {
    try {
      const [stateRes, autopilotRes, sketchesRes] = await Promise.all([
        fetch("/api/state"),
        fetch("/api/autopilot/status"),
        fetch("/api/sketches?limit=200")
      ]);

      const autopilot = await autopilotRes.json();
      let state = { generationCount: 0, successRate: 0, totalSketches: 0, strategyTimeline: [], heuristics: [], currentStrategy: "" };
      if (stateRes.ok) {
        state = await stateRes.json();
      }
      let sketchData = [];
      if (sketchesRes.ok) {
        sketchData = await sketchesRes.json();
      }
      this.sketches = Array.isArray(sketchData) ? sketchData : (sketchData.items || []);

      this.els.autopilotPill.classList.remove("is-error");
      this.updateHeader(state, autopilot);
      this.updateStudio(autopilot, state);
      if (stateRes.ok) {
        this.updateReflection(state);
        this.updateMind(state);
      }

      if (stateRes.ok) {
        const fp = this.timelineFingerprint(state);
        if (fp !== this.timelineKey) {
          this.timelineKey = fp;
          this.updateTimeline(state);
        }
        if (state.generationCount !== this.lastGen) {
          this.lastGen = state.generationCount;
        }
      }

      this.seedThumbnailBackfill();

      const busy = ["generating", "waiting"].includes(autopilot.phase);
      this.setPollInterval(busy ? 1200 : 3000);
    } catch (err) {
      console.error(err);
      this.els.pillText.textContent = "connection lost";
      this.els.autopilotPill.classList.add("is-error");
    }
  }

  updateHeader(state, autopilot) {
    this.els.statGen.textContent = state.generationCount;
    this.els.statSketches.textContent = `${state.totalSketches} / 3,650`;
    this.els.statFavor.textContent = `${state.successRate}%`;

    const phase = autopilot.phase || "idle";
    let label = PHASE_LABELS[phase] || phase;
    if (phase === "generating" && autopilot.generationProgress) {
      label = `generating · ${autopilot.generationProgress}`;
    }
    this.els.pillText.textContent = label;
    this.els.autopilotPill.classList.remove("is-active", "is-busy", "is-error");
    if (phase === "error") this.els.autopilotPill.classList.add("is-error");
    else if (["generating", "evolving"].includes(phase)) {
      this.els.autopilotPill.classList.add("is-busy");
    } else if (phase === "awaiting_human") {
      this.els.autopilotPill.classList.add("is-active");
    } else {
      this.els.autopilotPill.classList.add("is-active");
    }
  }

  updateStudio(autopilot, state = {}) {
    const busy = ["generating", "evolving"].includes(autopilot.phase);
    const awaiting = autopilot.phase === "awaiting_human" || autopilot.awaitingHuman;
    const canManualGenerate = !awaiting && autopilot.phase !== "generating"
      && (autopilot.phase === "error" || (!autopilot.running && autopilot.phase !== "waiting"));

    if (this.els.btnGenerateNext) {
      this.els.btnGenerateNext.hidden = !canManualGenerate;
      this.els.btnGenerateNext.disabled = busy;
      this.els.btnGenerateNext.title = autopilot.phase === "error"
        ? "Retry generation after an error"
        : "Start the next batch now";
    }

    this.els.studioStatus.hidden = !busy;
    if (busy && !awaiting) {
      const progress = autopilot.generationProgress
        ? ` · ${autopilot.generationProgress}`
        : "";
      this.els.statusMessage.textContent = (PHASE_LABELS[autopilot.phase] || "working…") + progress;
      this.els.batchLabel.textContent = autopilot.generationProgress
        ? `Gen ${(autopilot.currentGeneration || this.lastGen + 1)} · generating`
        : "Generating…";
    }

    const batch = autopilot.currentBatch;
    if (!batch?.length) {
      if (busy && !awaiting) {
        this.els.emptyState.hidden = false;
        this.els.emptyState.querySelector("p").textContent = autopilot.generationProgress
          ? `Generating batch… ${autopilot.generationProgress}`
          : "Generating batch…";
        this.els.shaderGrid.innerHTML = "";
        this.clearRenderers();
        this.els.curationPanel.hidden = true;
      } else if (!busy) {
        this.els.emptyState.hidden = false;
        const msg = autopilot.phase === "error"
          ? `Generation error — ${autopilot.lastError || "retry with Generate next batch"}`
          : autopilot.phase === "waiting"
            ? "Next batch generating…"
            : "Waiting for the first batch.";
        this.els.emptyState.querySelector("p").textContent = msg;
        this.els.curationPanel.hidden = true;
      }
      return;
    }

    this.els.emptyState.hidden = true;
    const gen = batch[0]?.generation;
    const batchKey = batch.map(s => s.id).join("|");

    if (!awaiting) {
      this.els.batchLabel.textContent = gen ? `Gen ${gen}` : "—";
    } else {
      this.els.batchLabel.textContent = gen ? `Gen ${gen} · your turn` : "—";
    }

    this.els.curationPanel.hidden = !awaiting;

    if (batchKey !== this.displayedBatchKey) {
      this.displayedBatchKey = batchKey;
      this.displayedGeneration = gen;
      this.activeBatch = batch;
      this.userRatings = {};
      this.buildGrid(batch, awaiting);
    } else {
      this.retryFailedRenderers(batch);
    }

    this.updateSubmitState();
  }

  buildGrid(batch, awaitingHuman) {
    this.clearRenderers();
    this.els.shaderGrid.innerHTML = "";

    batch.forEach((sketch, index) => {
      const cell = document.createElement("article");
      cell.className = "shader-cell";
      cell.dataset.id = sketch.id;

      const wrap = document.createElement("div");
      wrap.className = "shader-canvas-wrap";

      const canvas = document.createElement("canvas");
      const errEl = document.createElement("div");
      errEl.className = "shader-error";
      wrap.appendChild(canvas);
      wrap.appendChild(errEl);

      const caption = document.createElement("div");
      caption.className = "shader-caption";
      const typeClass = sketch.type || "evolutionary";
      const hypothesis = sketch.type === "mutation" && sketch.hypothesis
        ? `<p class="shader-hypothesis">${this.esc(sketch.hypothesis)}</p>`
        : "";

      caption.innerHTML = `
        <h4>${this.esc(sketch.title)}</h4>
        <div class="shader-meta">
          <span class="type-tag ${typeClass}">${typeClass}</span>
        </div>
        ${hypothesis}
      `;

      if (awaitingHuman) {
        const actions = document.createElement("div");
        actions.className = "rate-actions";

        const btnGood = document.createElement("button");
        btnGood.type = "button";
        btnGood.className = "btn-rate rate-good";
        btnGood.textContent = "Good";
        btnGood.addEventListener("click", (e) => {
          e.stopPropagation();
          this.rateSketch(sketch.id, "good");
        });

        const btnBad = document.createElement("button");
        btnBad.type = "button";
        btnBad.className = "btn-rate rate-bad";
        btnBad.textContent = "Bad";
        btnBad.addEventListener("click", (e) => {
          e.stopPropagation();
          this.rateSketch(sketch.id, "bad");
        });

        actions.appendChild(btnGood);
        actions.appendChild(btnBad);
        caption.appendChild(actions);
      } else if (sketch.rating) {
        const badge = document.createElement("span");
        badge.className = `rating-badge ${sketch.rating}`;
        badge.textContent = sketch.rating;
        wrap.appendChild(badge);
        cell.classList.add(sketch.rating === "good" ? "is-good" : "is-bad");
      }

      cell.appendChild(wrap);
      cell.appendChild(caption);
      this.els.shaderGrid.appendChild(cell);

      wrap.addEventListener("click", () => this.openDialog(sketch));

      const renderer = new ShaderRenderer(canvas);
      this.renderers.set(sketch.id, renderer);
      window.setTimeout(() => {
        renderer.compileWhenReady(sketch.glsl);
      }, index * 120);
    });
  }

  retryFailedRenderers(batch) {
    batch.forEach((sketch) => {
      const renderer = this.renderers.get(sketch.id);
      if (!renderer) return;
      if (!renderer.isRunning() && (renderer.needsCompile() || renderer.error)) {
        renderer.error = null;
        renderer.compileWhenReady(sketch.glsl);
      }
    });
  }

  rateSketch(sketchId, rating) {
    this.userRatings[sketchId] = rating;

    if (rating === "good") {
      window.setTimeout(() => {
        const thumb = this.captureThumbnailForSketch(sketchId);
        if (!thumb) return;
        const sketch = this.activeBatch?.find(s => s.id === sketchId);
        if (sketch) sketch.thumbnail = thumb;
      }, 500);
    }

    const cell = this.els.shaderGrid.querySelector(`[data-id="${sketchId}"]`);
    if (!cell) return;

    cell.classList.remove("is-good", "is-bad");
    cell.classList.add(rating === "good" ? "is-good" : "is-bad");

    cell.querySelectorAll(".btn-rate").forEach(btn => {
      btn.classList.remove("is-selected");
    });
    const selected = cell.querySelector(`.btn-rate.rate-${rating}`);
    if (selected) selected.classList.add("is-selected", rating);

    this.updateSubmitState();
  }

  updateSubmitState() {
    const count = Object.keys(this.userRatings).length;
    this.els.btnSubmitFeedback.disabled = count === 0;
    this.els.curationHint.textContent = count === 0
      ? "Rate at least one shader"
      : `${count} rated — unrated will count as Bad`;
  }

  captureThumbnailForSketch(sketchId) {
    const renderer = this.renderers.get(sketchId);
    if (!renderer?.isRunning()) return null;
    return renderer.captureThumbnail(64, 1.25, 0.55);
  }

  collectBatchThumbnails(batch, ratings) {
    const thumbnails = {};
    for (const sketch of batch) {
      if (ratings[sketch.id] !== "good") continue;
      const thumb = sketch.thumbnail || this.captureThumbnailForSketch(sketch.id);
      if (thumb) {
        thumbnails[sketch.id] = thumb;
        sketch.thumbnail = thumb;
      }
    }
    return thumbnails;
  }

  queueThumbnailBackfill(sketch) {
    if (!sketch?.id || sketch.thumbnail || this.thumbBackfillSeen.has(sketch.id)) return;
    if (this.thumbBackfillQueue.some(s => s.id === sketch.id)) return;
    this.thumbBackfillQueue.push(sketch);
    this.drainThumbnailBackfill();
  }

  async drainThumbnailBackfill() {
    if (this.thumbBackfillBusy || !this.thumbBackfillQueue.length) return;
    this.thumbBackfillBusy = true;

    while (this.thumbBackfillQueue.length) {
      const sketch = this.thumbBackfillQueue.shift();
      if (!sketch || sketch.thumbnail || this.thumbBackfillSeen.has(sketch.id)) continue;
      this.thumbBackfillSeen.add(sketch.id);

      const thumb = await this.renderOffscreenThumbnail(sketch);
      if (!thumb) continue;

      sketch.thumbnail = thumb;
      const local = this.sketches.find(s => s.id === sketch.id);
      if (local) local.thumbnail = thumb;

      try {
        await fetch("/api/sketches/thumbnail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sketch.id, thumbnail: thumb })
        });
        this.refreshTimelineThumb(sketch.id, thumb);
      } catch (err) {
        console.warn("Thumbnail upload failed:", err.message);
      }

      await new Promise(r => window.setTimeout(r, 200));
    }

    this.thumbBackfillBusy = false;
  }

  async renderOffscreenThumbnail(sketch) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    canvas.style.cssText = "position:fixed;left:-9999px;width:64px;height:64px;pointer-events:none;";
    document.body.appendChild(canvas);

    const renderer = new ShaderRenderer(canvas);
    try {
      const ok = await renderer.compile(sketch.glsl);
      if (!ok) return null;
      return renderer.captureThumbnail(64, 1.25, 0.55);
    } finally {
      renderer.destroy();
      canvas.remove();
    }
  }

  refreshTimelineThumb(sketchId, thumbnail) {
    const btn = this.els.timelineList.querySelector(`[data-sketch-id="${sketchId}"]`);
    if (!btn || btn.querySelector("img")) return;
    btn.style.background = "";
    const img = document.createElement("img");
    img.src = thumbnail;
    img.alt = "";
    img.loading = "lazy";
    btn.appendChild(img);
  }

  mountTimelineThumb(container, sketch) {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "timeline-thumb timeline-thumb-static";
    thumb.dataset.sketchId = sketch.id;
    thumb.title = sketch.title || "View sketch";

    if (sketch.thumbnail) {
      const img = document.createElement("img");
      img.src = sketch.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.style.background = this.thumbGradient(sketch);
      this.queueThumbnailBackfill(sketch);
    }

    thumb.addEventListener("click", () => this.openDialog(sketch));
    container.appendChild(thumb);
  }

  async generateNextBatch() {
    const focus = this.els.userOpinion.value.trim();
    this.els.btnGenerateNext.disabled = true;
    this.els.btnGenerateNext.textContent = "starting…";

    try {
      const res = await fetch("/api/autopilot/generate-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus || undefined })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Generate failed");
      if (focus) this.els.userOpinion.value = "";
      await this.poll();
    } catch (err) {
      alert(`Generate error: ${err.message}`);
    } finally {
      this.els.btnGenerateNext.disabled = false;
      this.els.btnGenerateNext.textContent = "Generate next batch";
    }
  }

  async submitFeedback() {
    if (!this.activeBatch?.length) return;

    const gen = this.activeBatch[0].generation;
    const ratings = { ...this.userRatings };

    this.activeBatch.forEach(s => {
      if (!ratings[s.id]) ratings[s.id] = "bad";
    });

    const thumbnails = this.collectBatchThumbnails(this.activeBatch, ratings);

    this.els.btnSubmitFeedback.disabled = true;
    this.els.btnSubmitFeedback.textContent = "Saving…";

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: gen,
          ratings,
          thumbnails,
          userOpinion: this.els.userOpinion.value.trim(),
          newSketches: this.activeBatch
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Feedback failed");

      this.els.userOpinion.value = "";
      this.userRatings = {};
      this.displayedGeneration = null;
      this.displayedBatchKey = null;
      this.activeBatch = null;
      this.els.curationPanel.hidden = true;
      this.els.reflectionText.textContent = result.evolutionPending
        ? `${result.goodCount} good · ${result.badCount} bad — next batch generating…`
        : (result.analysis || "Ratings saved.");
      await this.poll();
    } catch (err) {
      alert(`Feedback error: ${err.message}`);
      this.els.curationPanel.hidden = false;
    } finally {
      this.els.btnSubmitFeedback.disabled = false;
      this.els.btnSubmitFeedback.textContent = "Submit & next batch";
    }
  }

  updateReflection(state) {
    const timeline = state.strategyTimeline || [];
    const latest = timeline[timeline.length - 1];
    if (latest?.notes && !this.els.btnSubmitFeedback.disabled) {
      this.els.reflectionText.textContent = latest.notes;
    }
    this.els.strategyText.textContent = state.currentStrategy || "";
  }

  updateMind(state) {
    const heuristics = state.heuristics || [];
    this.els.heuristicsList.innerHTML = heuristics.length
      ? heuristics.map(h => `<li>${this.esc(h)}</li>`).join("")
      : "<li>Awaiting your first curation.</li>";

    const timeline = state.strategyTimeline || [];
    this.els.logFeed.innerHTML = timeline.map(t => `
      <div class="log-entry">
        <strong>Gen ${t.generation}</strong>
        <span> · ${new Date(t.timestamp).toLocaleString()}</span>
        <p>${this.esc(t.notes || "")}</p>
      </div>
    `).join("");
  }

  updateTimeline(state) {
    const timeline = [...(state.strategyTimeline || [])].reverse().filter(t => t.generation > 0);
    this.els.timelineList.innerHTML = "";

    if (!timeline.length) {
      this.els.timelineList.innerHTML = "<li class='timeline-item'><p class='timeline-note'>No evolution milestones yet.</p></li>";
      return;
    }

    timeline.forEach(entry => {
      const li = document.createElement("li");
      li.className = "timeline-item";

      const good = this.sketches.filter(
        s => s.generation === entry.generation && s.rating === "good"
      );

      li.innerHTML = `
        <h3>Generation ${entry.generation}</h3>
        <p class="timeline-time">${new Date(entry.timestamp).toLocaleString()}</p>
        <p class="timeline-note">${this.esc(entry.notes || "")}</p>
        ${good.length ? `<div class="timeline-sketches"></div>` : ""}
      `;

      this.els.timelineList.appendChild(li);

      if (good.length) {
        const container = li.querySelector(".timeline-sketches");
        good.slice(0, 4).forEach(s => this.mountTimelineThumb(container, s));
      }
    });
  }

  async fetchMonologue() {
    this.els.btnMonologue.disabled = true;
    this.els.btnMonologue.textContent = "synthesizing…";
    this.els.monologueOutput.hidden = true;

    try {
      const res = await fetch("/api/narrative");
      const data = await res.json();
      this.els.monologueText.textContent = data.monologue || "";
      this.els.monologueOutput.hidden = false;
    } catch (err) {
      this.els.monologueText.textContent = `Failed: ${err.message}`;
      this.els.monologueOutput.hidden = false;
    } finally {
      this.els.btnMonologue.disabled = false;
      this.els.btnMonologue.textContent = "Explain artistic evolution";
    }
  }

  restoreDialogCanvas() {
    if (!this.dialogReparent) return;

    const { gridWrap, gridCanvas, placeholder, anchor, renderer } = this.dialogReparent;
    const dialogWrap = placeholder.parentElement;
    if (gridCanvas.parentElement === dialogWrap) {
      gridWrap.insertBefore(gridCanvas, anchor);
    }
    placeholder.hidden = false;
    renderer?.bindUi({ errorEl: null, loadingEl: null, hintEl: null });
    renderer?.relayout();
    this.dialogReparent = null;
  }

  suspendGridRenderers() {
    this.suspendedGridIds = [];
    for (const [id, renderer] of this.renderers) {
      if (!renderer.isRunning() && !renderer.gl) continue;
      renderer.destroy();
      this.suspendedGridIds.push(id);
    }
  }

  resumeGridRenderers() {
    if (!this.suspendedGridIds.length || !this.activeBatch?.length) {
      this.suspendedGridIds = [];
      return;
    }
    for (const id of this.suspendedGridIds) {
      const renderer = this.renderers.get(id);
      const sketch = this.activeBatch.find(s => s.id === id);
      if (renderer && sketch?.glsl) {
        renderer.compileWhenReady(sketch.glsl);
      }
    }
    this.suspendedGridIds = [];
  }

  disposeDialogRenderer() {
    this.restoreDialogCanvas();
    if (this.dialogOwnedRenderer && this.dialogRenderer) {
      this.dialogRenderer.destroy();
    }
    this.dialogRenderer = null;
    this.dialogOwnedRenderer = false;
    this.resumeGridRenderers();
  }

  waitForDialogOpen() {
    return new Promise((resolve) => {
      if (this.els.shaderDialog.open) {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
        return;
      }
      this.els.shaderDialog.addEventListener("open", () => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }, { once: true });
    });
  }

  openDialog(sketch) {
    this.disposeDialogRenderer();

    const dna = Array.isArray(sketch.dna) ? sketch.dna : [];
    this.els.dialogEyebrow.textContent = `Gen ${sketch.generation} · ${sketch.type || "sketch"}`;
    this.els.dialogTitle.textContent = sketch.title || "Untitled";
    this.els.dialogHypothesis.textContent = sketch.hypothesis || "";
    this.els.dialogHypothesis.hidden = !sketch.hypothesis;
    this.els.dialogStatement.textContent = sketch.poetic_statement || "";
    this.els.dialogTags.innerHTML = dna.map(t => `<span>#${this.esc(t)}</span>`).join("");
    this.els.dialogCode.textContent = sketch.glsl || "";

    this.els.dialogError.hidden = true;
    this.els.dialogError.textContent = "";
    this.els.dialogLoading.hidden = false;
    this.els.dialogHint.hidden = true;
    this.els.dialogCanvas.hidden = false;

    this.els.shaderDialog.showModal();

    const dialogWrap = this.els.dialogCanvas.parentElement;
    const gridRenderer = this.renderers.get(sketch.id);
    const gridCell = this.els.shaderGrid.querySelector(`[data-id="${sketch.id}"]`);
    const gridWrap = gridCell?.querySelector(".shader-canvas-wrap");
    const gridCanvas = gridWrap?.querySelector("canvas");
    const gridErr = gridWrap?.querySelector(".shader-error");

    if (gridRenderer?.isRunning() && gridCanvas && gridWrap) {
      this.dialogReparent = {
        sketchId: sketch.id,
        gridWrap,
        gridCanvas,
        placeholder: this.els.dialogCanvas,
        anchor: gridErr || null,
        renderer: gridRenderer
      };
      this.els.dialogCanvas.hidden = true;
      dialogWrap.insertBefore(gridCanvas, this.els.dialogLoading);
      gridRenderer.bindUi({
        errorEl: this.els.dialogError,
        loadingEl: this.els.dialogLoading,
        hintEl: this.els.dialogHint
      });
      this.dialogRenderer = gridRenderer;
      this.dialogOwnedRenderer = false;
      this.els.dialogLoading.hidden = true;
      this.els.dialogHint.hidden = false;
      requestAnimationFrame(() => gridRenderer.relayout());
      return;
    }

    const glsl = sketch.glsl || "";
    this.suspendGridRenderers();
    this.waitForDialogOpen().then(() => {
      this.dialogRenderer = new ShaderRenderer(this.els.dialogCanvas, {
        errorEl: this.els.dialogError,
        loadingEl: this.els.dialogLoading,
        hintEl: this.els.dialogHint
      });
      this.dialogOwnedRenderer = true;
      this.dialogRenderer.compileWhenReady(glsl);
    });
  }

  closeDialog() {
    this.disposeDialogRenderer();
    this.els.shaderDialog.close();
  }

  clearTimelineRenderers() {
    this.timelineRenderers.forEach(r => r.destroy());
    this.timelineRenderers = [];
  }

  thumbGradient(sketch) {
    const seed = [...(sketch.id || "sketch")].reduce((n, c) => n + c.charCodeAt(0), 0);
    const h1 = seed % 360;
    const h2 = (h1 + 47) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 42%, 28%), hsl(${h2}, 55%, 52%))`;
  }

  clearRenderers() {
    this.renderers.forEach(r => r.destroy());
    this.renderers.clear();
    this.clearTimelineRenderers();
  }

  esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ShaderMindUI();
});