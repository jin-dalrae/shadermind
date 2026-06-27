import { ShaderRenderer } from "./shader-renderer.js?v=5";
import { getSharedGridRenderer } from "./shared-grid-renderer.js?v=5";

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
    this.displayedBatchKey = null;
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

  getLatestBatchFromLibrary() {
    if (!this.sketches?.length) return null;
    const latestGen = Math.max(...this.sketches.map(s => s.generation || 0));
    const batch = this.sketches
      .filter(s => s.generation === latestGen)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return batch.length ? { generation: latestGen, sketches: batch } : null;
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

    const liveBatch = autopilot.currentBatch;
    const archive = !liveBatch?.length ? this.getLatestBatchFromLibrary() : null;
    const batch = liveBatch?.length ? liveBatch : archive?.sketches;
    const fromArchive = Boolean(archive && !liveBatch?.length);

    if (!batch?.length) {
      if (!busy) {
        this.els.emptyState.hidden = false;
        this.els.curationPanel.hidden = true;
        this.els.batchLabel.textContent = "—";
      }
      return;
    }

    this.els.emptyState.hidden = true;
    const gen = batch[0]?.generation;
    const awaiting = !fromArchive && (autopilot.phase === "awaiting_human" || autopilot.awaitingHuman);
    const batchKey = `${fromArchive ? "archive" : "live"}-${gen}`;

    this.els.batchLabel.textContent = gen
      ? `Gen ${gen}${awaiting ? " · your turn" : fromArchive ? " · saved batch" : ""}`
      : "—";

    this.els.curationPanel.hidden = !awaiting;

    if (batchKey !== this.displayedBatchKey) {
      this.displayedBatchKey = batchKey;
      this.displayedGeneration = gen;
      this.activeBatch = awaiting ? batch : null;
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

        [1, 2, 3, 4, 5].forEach(score => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `btn-rate rate-${score}`;
          button.textContent = score;
          button.title = this.ratingLabel(score);
          button.setAttribute("aria-label", `${score} out of 5 — ${this.ratingLabel(score)}`);
          button.addEventListener("click", (e) => {
            e.stopPropagation();
            this.rateSketch(sketch.id, score);
          });
          actions.appendChild(button);
        });
        caption.appendChild(actions);
      } else if (sketch.rating) {
        const score = this.ratingValue(sketch.rating);
        const badge = document.createElement("span");
        badge.className = `rating-badge rating-${score}`;
        badge.textContent = `${score} / 5`;
        wrap.appendChild(badge);
        cell.classList.add(`rating-${score}`);
      }

      cell.appendChild(wrap);
      cell.appendChild(caption);
      this.els.shaderGrid.appendChild(cell);

      wrap.addEventListener("click", () => this.openDialog(sketch));
      wrap.addEventListener("mousemove", (e) => {
        const rect = wrap.getBoundingClientRect();
        getSharedGridRenderer().setMouse(
          (e.clientX - rect.left) / rect.width,
          1 - (e.clientY - rect.top) / rect.height
        );
      });

      getSharedGridRenderer().register(
        sketch.id,
        canvas,
        sketch.glsl,
        awaitingHuman ? result => this.reportCompileResult(sketch.id, result) : null
      );
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

    cell.classList.remove("rating-1", "rating-2", "rating-3", "rating-4", "rating-5");
    cell.classList.add(`rating-${rating}`);

    cell.querySelectorAll(".btn-rate").forEach(btn => {
      btn.classList.remove("is-selected");
    });
    const selected = cell.querySelector(`.btn-rate.rate-${rating}`);
    if (selected) selected.classList.add("is-selected");

    this.updateSubmitState();
  }

  updateSubmitState() {
    const count = Object.keys(this.userRatings).length;
    const total = this.activeBatch?.length || 0;
    this.els.btnSubmitFeedback.disabled = count !== total;
    this.els.curationHint.textContent = total
      ? `${count} / ${total} rated · 1 low, 5 high`
      : "Rate every shader from 1 to 5";
  }

  async submitFeedback() {
    if (!this.activeBatch?.length) return;

    const gen = this.activeBatch[0].generation;
    const ratings = { ...this.userRatings };
    const explicitRatingIds = Object.keys(this.userRatings);

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
    getSharedGridRenderer().clearByPrefix("timeline-");
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
        s => s.generation === entry.generation && this.ratingValue(s.rating) >= 4
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
          getSharedGridRenderer().register(`timeline-${s.id}`, canvas, s.glsl);
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
    getSharedGridRenderer().clear();
    this.renderers.forEach(r => r.stop());
    this.renderers.clear();
  }

  ratingValue(rating) {
    if (rating === "good") return 5;
    if (rating === "bad") return 1;
    const score = Number(rating);
    return Number.isInteger(score) && score >= 1 && score <= 5 ? score : 3;
  }

  ratingLabel(score) {
    return {
      1: "Strong dislike",
      2: "Dislike",
      3: "Neutral",
      4: "Like",
      5: "Strong like"
    }[score];
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
