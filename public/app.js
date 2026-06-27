import { ShaderRenderer } from "./shader-renderer.js";

const PHASE_LABELS = {
  idle: "ready",
  generating: "generating batch…",
  planning: "planning batch…",
  awaiting_human: "awaiting your curation",
  evolving: "evolving from your feedback…",
  waiting: "preparing next batch…",
  error: "error · retrying"
};

class ShaderMindUI {
  constructor() {
    this.renderers = new Map();
    this.dialogRenderer = null;
    this.displayedGeneration = null;
    this.lastGen = -1;
    this.sketches = [];
    this.activeBatch = null;
    this.userRatings = {};
    this.compileResults = {};

    this.els = {
      statGen: document.getElementById("statGen"),
      statSketches: document.getElementById("statSketches"),
      statFavor: document.getElementById("statFavor"),
      autopilotPill: document.getElementById("autopilotPill"),
      pillText: document.getElementById("pillText"),
      studioStatus: document.getElementById("studioStatus"),
      statusMessage: document.getElementById("statusMessage"),
      batchLabel: document.getElementById("batchLabel"),
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

    this.poll();
    setInterval(() => this.poll(), 3000);
  }

  async poll() {
    try {
      const [stateRes, autopilotRes, sketchesRes] = await Promise.all([
        fetch("/api/state"),
        fetch("/api/autopilot/status"),
        fetch("/api/sketches")
      ]);

      const state = await stateRes.json();
      const autopilot = await autopilotRes.json();
      this.sketches = await sketchesRes.json();

      this.updateHeader(state, autopilot);
      this.updateStudio(autopilot);
      this.updateReflection(state);
      this.updateMind(state);

      if (state.generationCount !== this.lastGen) {
        this.lastGen = state.generationCount;
        this.updateTimeline(state);
      }
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

  updateStudio(autopilot) {
    const busy = ["generating", "evolving"].includes(autopilot.phase);
    this.els.studioStatus.hidden = !busy;
    if (busy) {
      const progress = autopilot.generationProgress
        ? ` · ${autopilot.generationProgress}`
        : "";
      this.els.statusMessage.textContent = (PHASE_LABELS[autopilot.phase] || "working…") + progress;
    }

    const batch = autopilot.currentBatch;
    if (!batch?.length) {
      if (!busy) {
        this.els.emptyState.hidden = false;
        this.els.curationPanel.hidden = true;
      }
      return;
    }

    this.els.emptyState.hidden = true;
    const gen = batch[0]?.generation;
    const awaiting = autopilot.phase === "awaiting_human" || autopilot.awaitingHuman;

    this.els.batchLabel.textContent = gen
      ? `Gen ${gen}${awaiting ? " · your turn" : ""}`
      : "—";

    this.els.curationPanel.hidden = !awaiting;

    if (gen !== this.displayedGeneration) {
      this.displayedGeneration = gen;
      this.activeBatch = batch;
      this.userRatings = {};
      this.compileResults = {};
      this.buildGrid(batch, awaiting);
    }

    this.updateSubmitState();
  }

  buildGrid(batch, awaitingHuman) {
    this.clearRenderers();
    this.els.shaderGrid.innerHTML = "";

    batch.forEach(sketch => {
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

      const renderer = new ShaderRenderer(canvas, {
        onCompileResult: awaitingHuman
          ? result => this.reportCompileResult(sketch.id, result)
          : null
      });
      this.renderers.set(sketch.id, renderer);
      renderer.compileWhenReady(sketch.glsl);
    });
  }

  reportCompileResult(sketchId, result) {
    this.compileResults[sketchId] = result;

    const sketch = this.activeBatch?.find(item => item.id === sketchId);
    if (sketch) sketch.compile = result;

    fetch(`/api/sketches/${encodeURIComponent(sketchId)}/compile-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    }).catch(err => console.warn("Compile result was not reported:", err.message));
  }

  rateSketch(sketchId, rating) {
    this.userRatings[sketchId] = rating;

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

  async submitFeedback() {
    if (!this.activeBatch?.length) return;

    const gen = this.activeBatch[0].generation;
    const ratings = { ...this.userRatings };
    const explicitRatingIds = Object.keys(this.userRatings);

    this.activeBatch.forEach(s => {
      if (!ratings[s.id]) ratings[s.id] = "bad";
    });

    this.els.btnSubmitFeedback.disabled = true;
    this.els.btnSubmitFeedback.textContent = "Evolving…";
    this.els.curationPanel.hidden = true;

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: gen,
          ratings,
          explicitRatingIds,
          compileResults: this.compileResults,
          userOpinion: this.els.userOpinion.value.trim(),
          newSketches: this.activeBatch
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Feedback failed");

      this.els.userOpinion.value = "";
      this.userRatings = {};
      this.compileResults = {};
      this.displayedGeneration = null;
      this.els.reflectionText.textContent = result.analysis || "Strategy evolved.";
      await this.poll();
    } catch (err) {
      alert(`Feedback error: ${err.message}`);
      this.els.curationPanel.hidden = false;
    } finally {
      this.els.btnSubmitFeedback.disabled = false;
      this.els.btnSubmitFeedback.textContent = "Submit & evolve";
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
        good.forEach(s => {
          const thumb = document.createElement("div");
          thumb.className = "timeline-thumb";
          const canvas = document.createElement("canvas");
          thumb.appendChild(canvas);
          thumb.addEventListener("click", () => this.openDialog(s));
          const renderer = new ShaderRenderer(canvas);
          renderer.compileWhenReady(s.glsl);
          thumb.addEventListener("mouseenter", () => renderer.start());
          thumb.addEventListener("mouseleave", () => renderer.stop());
          container.appendChild(thumb);
        });
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

  openDialog(sketch) {
    if (this.dialogRenderer) {
      this.dialogRenderer.stop();
      this.dialogRenderer = null;
    }

    const dna = Array.isArray(sketch.dna) ? sketch.dna : [];
    this.els.dialogEyebrow.textContent = `Gen ${sketch.generation} · ${sketch.type || "sketch"}`;
    this.els.dialogTitle.textContent = sketch.title || "Untitled";
    this.els.dialogHypothesis.textContent = sketch.hypothesis || "";
    this.els.dialogHypothesis.hidden = !sketch.hypothesis;
    this.els.dialogStatement.textContent = sketch.poetic_statement || "";
    this.els.dialogTags.innerHTML = dna.map(t => `<span>#${this.esc(t)}</span>`).join("");
    this.els.dialogCode.textContent = sketch.glsl || "";

    this.els.dialogError.classList.remove("active");
    this.els.dialogError.textContent = "";

    this.dialogRenderer = new ShaderRenderer(this.els.dialogCanvas);
    this.els.shaderDialog.showModal();
    this.dialogRenderer.compileWhenReady(sketch.glsl);
  }

  closeDialog() {
    this.els.shaderDialog.close();
    if (this.dialogRenderer) {
      this.dialogRenderer.stop();
      this.dialogRenderer = null;
    }
  }

  clearRenderers() {
    this.renderers.forEach(r => r.stop());
    this.renderers.clear();
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
