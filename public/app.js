import { ShaderRenderer } from "./shader-renderer.js?v=13";
import { getSharedGridRenderer } from "./shared-grid-renderer.js?v=7";
import { VoiceCurator } from "./voice-curator.js?v=1";

const THUMB_SIZE = 96;
const THUMB_TIME = 1.25;
const THUMB_QUALITY = 0.65;

const PHASE_LABELS = {
  idle: "ready",
  generating: "generating batch…",
  planning: "planning batch…",
  awaiting_human: "awaiting your curation",
  evolving: "updating strategy…",
  waiting: "generating next batch…",
  error: "error · retrying"
};

const PAGES = ["studio", "gallery", "settings"];

class ShaderMindUI {
  constructor() {
    this.renderers = new Map();
    this.timelineRenderers = [];
    this.dialogRenderer = null;
    this.dialogOwnedRenderer = false;
    this.displayedGeneration = null;
    this.displayedBatchKey = null;
    this.lastGen = -1;
    this.sketches = [];
    this.activeBatch = null;
    this.userRatings = {};
    this.compileResults = {};
    this.thumbBackfillQueue = [];
    this.thumbBackfillBusy = false;
    this.thumbBackfillAttempted = new Set();
    this.thumbBackfillSeedKey = null;
    this.timelineKey = null;
    this.pollTimer = null;
    this.pollIntervalMs = 3000;
    this.currentPage = "studio";
    this.galleryPage = 1;
    this.galleryLimit = 20;
    this.galleryPages = 1;
    this.galleryItems = [];
    this.galleryKey = null;
    this.lastState = null;
    this.lastAutopilot = null;
    this.sharedGridSuspended = false;
    this.dialogSketchId = null;
    this.bodyScrollLocked = false;
    this.savedScrollY = 0;
    this.voiceCurator = new VoiceCurator(this);

    this.els = {
      navTabs: [...document.querySelectorAll(".nav-tab")],
      pages: {
        studio: document.getElementById("pageStudio"),
        gallery: document.getElementById("pageGallery"),
        settings: document.getElementById("pageSettings")
      },
      statGen: document.getElementById("statGen"),
      statSketches: document.getElementById("statSketches"),
      statFavor: document.getElementById("statFavor"),
      autopilotPill: document.getElementById("autopilotPill"),
      pillText: document.getElementById("pillText"),
      studioStatus: document.getElementById("studioStatus"),
      statusMessage: document.getElementById("statusMessage"),
      batchLabel: document.getElementById("batchLabel"),
      voicePanel: document.getElementById("voicePanel"),
      btnVoiceConnect: document.getElementById("btnVoiceConnect"),
      voiceStatus: document.getElementById("voiceStatus"),
      btnGenerateNext: document.getElementById("btnGenerateNext"),
      btnRegenerateBatch: document.getElementById("btnRegenerateBatch"),
      shaderGrid: document.getElementById("shaderGrid"),
      emptyState: document.getElementById("emptyState"),
      curationPanel: document.getElementById("curationPanel"),
      userOpinion: document.getElementById("userOpinion"),
      btnSubmitFeedback: document.getElementById("btnSubmitFeedback"),
      curationHint: document.getElementById("curationHint"),
      archiveGrid: document.getElementById("archiveGrid"),
      galleryEmpty: document.getElementById("galleryEmpty"),
      galleryPagination: document.getElementById("galleryPagination"),
      galleryPrev: document.getElementById("galleryPrev"),
      galleryNext: document.getElementById("galleryNext"),
      galleryPageInfo: document.getElementById("galleryPageInfo"),
      gallerySub: document.getElementById("gallerySub"),
      galleryFilterGen: document.getElementById("galleryFilterGen"),
      galleryFilterRating: document.getElementById("galleryFilterRating"),
      reflectionText: document.getElementById("reflectionText"),
      strategyText: document.getElementById("strategyText"),
      timelineList: document.getElementById("timelineList"),
      heuristicsList: document.getElementById("heuristicsList"),
      preferList: document.getElementById("preferList"),
      avoidList: document.getElementById("avoidList"),
      systemInfo: document.getElementById("systemInfo"),
      autopilotInfo: document.getElementById("autopilotInfo"),
      btnAutopilotStart: document.getElementById("btnAutopilotStart"),
      btnAutopilotStop: document.getElementById("btnAutopilotStop"),
      btnAutopilotKick: document.getElementById("btnAutopilotKick"),
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
      dialogRating: document.getElementById("dialogRating"),
      dialogRerate: document.getElementById("dialogRerate"),
      dialogRateActions: document.getElementById("dialogRateActions"),
      dialogRerateHint: document.getElementById("dialogRerateHint"),
      dialogHypothesis: document.getElementById("dialogHypothesis"),
      dialogStatement: document.getElementById("dialogStatement"),

      dialogCode: document.getElementById("dialogCode")
    };

    this.els.dialogClose.addEventListener("click", () => this.closeDialog());
    this.els.shaderDialog.addEventListener("click", (e) => {
      if (e.target === this.els.shaderDialog) this.closeDialog();
    });
    this.els.shaderDialog.addEventListener("close", () => this.onDialogClosed());
    this.els.btnMonologue.addEventListener("click", () => this.fetchMonologue());
    this.els.btnSubmitFeedback.addEventListener("click", () => this.submitFeedback());
    this.els.btnGenerateNext.addEventListener("click", () => this.generateNextBatch());
    this.els.btnRegenerateBatch?.addEventListener("click", () => this.regenerateBatch());
    this.els.navTabs.forEach(tab => {
      tab.addEventListener("click", () => this.setPage(tab.dataset.page));
    });
    this.els.galleryPrev.addEventListener("click", () => this.changeGalleryPage(-1));
    this.els.galleryNext.addEventListener("click", () => this.changeGalleryPage(1));
    this.els.galleryFilterGen.addEventListener("change", () => {
      this.galleryPage = 1;
      this.galleryKey = null;
      this.updateGallerySubcopy();
      this.loadGalleryPage();
    });
    this.els.galleryFilterRating.addEventListener("change", () => {
      this.galleryPage = 1;
      this.galleryKey = null;
      this.loadGalleryPage();
    });
    this.els.btnAutopilotStart.addEventListener("click", () => this.autopilotAction("start"));
    this.els.btnAutopilotStop.addEventListener("click", () => this.autopilotAction("stop"));
    this.els.btnAutopilotKick.addEventListener("click", () => this.autopilotAction("kick"));
    this.els.btnVoiceConnect?.addEventListener("click", () => this.toggleVoice());

    this.voiceCurator.onStatusChange = (status) => this.updateVoiceStatus(status);
    this.initVoicePanel();

    window.addEventListener("hashchange", () => this.syncPageFromHash());
    this.syncPageFromHash(true);

    this.poll();
    this.schedulePoll();
  }

  pageFromHash() {
    const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
    return PAGES.includes(hash) ? hash : "studio";
  }

  syncPageFromHash(initial = false) {
    const page = this.pageFromHash();
    if (initial && page === "studio" && !location.hash) return;
    this.setPage(page, false);
  }

  setPage(page, updateHash = true) {
    if (!PAGES.includes(page)) page = "studio";
    if (this.currentPage === page) return;

    const leavingStudio = this.currentPage === "studio" && page !== "studio";
    this.currentPage = page;

    this.els.navTabs.forEach(tab => {
      tab.classList.toggle("is-active", tab.dataset.page === page);
    });
    for (const [name, el] of Object.entries(this.els.pages)) {
      if (!el) continue;
      const active = name === page;
      el.hidden = !active;
      el.classList.toggle("is-active", active);
    }

    if (updateHash && location.hash.replace("#", "") !== page) {
      history.replaceState(null, "", `#${page}`);
    }

    if (leavingStudio) {
      getSharedGridRenderer().clearByPrefix("");
      if (this.voiceCurator.connected) {
        this.voiceCurator.disconnect().catch(() => {});
      }
    }

    if (page === "studio" && this.lastAutopilot) {
      this.displayedBatchKey = null;
      this.updateStudio(this.lastAutopilot, this.lastState || {});
    }

    if (page === "gallery") {
      this.updateGallerySubcopy();
      this.loadGalleryPage();
      if (this.lastState) this.updateTimeline(this.lastState);
    }
  }

  galleryQueryParams() {
    const gen = this.els.galleryFilterGen.value;
    const rating = this.els.galleryFilterRating.value;
    const limit = gen ? 50 : this.galleryLimit;
    const params = new URLSearchParams({
      page: String(this.galleryPage),
      limit: String(limit)
    });
    if (gen) params.set("generation", gen);
    if (rating) params.set("rating", rating);
    return params;
  }

  async loadGalleryPage() {
    try {
      const res = await fetch(`/api/sketches?${this.galleryQueryParams()}`);
      if (!res.ok) throw new Error("Failed to load gallery");
      const data = await res.json();
      this.galleryItems = data.items || data;
      this.galleryPages = data.pages || 1;
      this.galleryPage = data.page || this.galleryPage;
      this.renderGalleryGrid();
    } catch (err) {
      console.error(err);
      this.els.galleryEmpty.hidden = false;
      this.els.galleryEmpty.textContent = "Could not load gallery.";
    }
  }

  changeGalleryPage(delta) {
    const next = this.galleryPage + delta;
    if (next < 1 || next > this.galleryPages) return;
    this.galleryPage = next;
    this.galleryKey = null;
    this.loadGalleryPage();
  }

  renderGalleryGrid() {
    const items = this.galleryItems || [];
    const key = `${this.galleryPage}:${items.map(s => s.id).join(",")}`;
    if (key === this.galleryKey) return;
    this.galleryKey = key;

    this.els.archiveGrid.innerHTML = "";
    this.els.galleryEmpty.hidden = items.length > 0;
    this.els.galleryPagination.hidden = this.galleryPages <= 1;

    if (!items.length) return;

    items.forEach(sketch => {
      const cell = document.createElement("article");
      cell.className = "archive-cell";
      cell.dataset.id = sketch.id;

      const thumb = document.createElement("div");
      thumb.className = "archive-thumb";
      if (sketch.thumbnail) {
        const img = document.createElement("img");
        img.src = sketch.thumbnail;
        img.alt = sketch.title || "";
        img.loading = "lazy";
        thumb.appendChild(img);
      } else {
        thumb.classList.add("archive-thumb-pending");
        this.queueThumbnailBackfill(sketch);
      }

      const score = this.ratingValue(sketch.rating);
      if (score) cell.classList.add(`rating-${score}`);

      const caption = document.createElement("div");
      caption.className = "archive-caption";
      caption.innerHTML = `
        <h4>${this.esc(sketch.title || "Untitled")}</h4>
        <div class="archive-meta">
          <span>Gen ${sketch.generation}</span>
          <span class="archive-score">${score ? `${score}/5` : "—"}</span>
        </div>
      `;

      cell.appendChild(thumb);
      cell.appendChild(caption);
      cell.appendChild(this.buildRateActions(sketch, (id, r) => this.updateSketchRating(id, r)));
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".btn-rate")) return;
        this.openDialog(sketch, window.scrollY, { allowRerate: true });
      });
      this.els.archiveGrid.appendChild(cell);
    });

    this.els.galleryPageInfo.textContent = `Page ${this.galleryPage} of ${this.galleryPages}`;
    this.els.galleryPrev.disabled = this.galleryPage <= 1;
    this.els.galleryNext.disabled = this.galleryPage >= this.galleryPages;
  }

  updateGalleryFilters(state) {
    const gen = state.generationCount || 0;
    const select = this.els.galleryFilterGen;
    const current = select.value;
    const options = ['<option value="">All</option>'];
    for (let g = gen; g >= 1; g--) {
      options.push(`<option value="${g}">Gen ${g}</option>`);
    }
    select.innerHTML = options.join("");
    if (current && Number(current) <= gen) select.value = current;
    this.updateGallerySubcopy();
  }

  updateGallerySubcopy() {
    if (!this.els.gallerySub) return;
    const gen = this.els.galleryFilterGen.value;
    this.els.gallerySub.textContent = gen
      ? `Generation ${gen} — click a sketch to review, or change 1–5 ratings inline.`
      : "Saved sketches and strategy milestones across generations. Filter by generation to re-rate a past batch.";
  }

  buildRateActions(sketch, onRate) {
    const actions = document.createElement("div");
    actions.className = "rate-actions";
    const current = this.ratingValue(sketch.rating);

    [1, 2, 3, 4, 5].forEach(score => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn-rate rate-${score}${current === score ? " is-selected" : ""}`;
      button.textContent = score;
      button.title = this.ratingLabel(score);
      button.setAttribute("aria-label", `${score} out of 5 — ${this.ratingLabel(score)}`);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        onRate(sketch.id, score);
      });
      actions.appendChild(button);
    });

    return actions;
  }

  patchSketchRating(sketchId, rating) {
    const patch = { rated: true, rating, ratingSource: "explicit" };
    const apply = (list) => {
      if (!Array.isArray(list)) return;
      const item = list.find(s => s.id === sketchId);
      if (item) Object.assign(item, patch);
    };
    apply(this.sketches);
    apply(this.galleryItems);
    apply(this.activeBatch);
  }

  applyRatingUi(sketchId, rating) {
    for (const root of [this.els.shaderGrid, this.els.archiveGrid]) {
      if (!root) continue;
      const cell = root.querySelector(`[data-id="${sketchId}"]`);
      if (!cell) continue;

      cell.classList.remove("rating-1", "rating-2", "rating-3", "rating-4", "rating-5");
      cell.classList.add(`rating-${rating}`);

      cell.querySelectorAll(".btn-rate").forEach(btn => {
        btn.classList.toggle("is-selected", btn.classList.contains(`rate-${rating}`));
      });

      const scoreEl = cell.querySelector(".archive-score");
      if (scoreEl) scoreEl.textContent = `${rating}/5`;
    }

    if (this.dialogSketchId === sketchId) {
      this.els.dialogRating.hidden = false;
      this.els.dialogRating.textContent = `${rating} / 5`;
      this.els.dialogRateActions?.querySelectorAll(".btn-rate").forEach(btn => {
        btn.classList.toggle("is-selected", btn.classList.contains(`rate-${rating}`));
      });
    }
  }

  async updateSketchRating(sketchId, rating) {
    try {
      const res = await fetch(`/api/sketches/${encodeURIComponent(sketchId)}/rating`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update rating");

      this.patchSketchRating(sketchId, rating);
      this.applyRatingUi(sketchId, rating);

      if (this.userRatings[sketchId] !== undefined) {
        this.userRatings[sketchId] = rating;
        this.updateSubmitState();
      }

      if (this.lastState) {
        this.lastState.successRate = data.successRate;
        this.lastState.preferenceMemory = data.preferenceMemory;
        this.updateHeader(this.lastState, this.lastAutopilot || {});
        if (this.currentPage === "settings") {
          this.updateSettings(this.lastState, this.lastAutopilot || {});
        }
      }

      const sketch = this.sketches.find(s => s.id === sketchId)
        || this.galleryItems.find(s => s.id === sketchId);
      if (sketch && rating >= 4 && !sketch.thumbnail) {
        this.thumbBackfillAttempted.delete(sketchId);
        this.queueThumbnailBackfill(sketch);
      }

      if (this.els.dialogRerateHint) {
        this.els.dialogRerateHint.textContent = `Saved · ${rating}/5`;
      }
    } catch (err) {
      alert(`Rating error: ${err.message}`);
    }
  }

  async autopilotAction(action) {
    const paths = {
      start: "/api/autopilot/start",
      stop: "/api/autopilot/stop",
      kick: "/api/autopilot/kick"
    };
    const btn = { start: this.els.btnAutopilotStart, stop: this.els.btnAutopilotStop, kick: this.els.btnAutopilotKick }[action];
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(paths[action], { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      await this.poll();
    } catch (err) {
      alert(err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
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
    const good = this.sketches.filter(s => this.ratingValue(s.rating) >= 4);
    const withThumb = good.filter(s => s.thumbnail).length;
    return `${state.generationCount}:${(state.strategyTimeline || []).length}:${good.length}:${withThumb}`;
  }

  sketchNeedsThumbnail(sketch) {
    if (!sketch?.id || sketch.thumbnail) return false;
    if (this.ratingValue(sketch.rating) < 4) return false;
    if (this.thumbBackfillAttempted.has(sketch.id)) return false;
    if (sketch.compile?.success === false) return false;
    return true;
  }

  seedThumbnailBackfill() {
    const pending = this.sketches.filter(s => this.sketchNeedsThumbnail(s));
    const seedKey = `${pending.length}:${pending.map(s => s.id).join(",")}`;
    if (seedKey === this.thumbBackfillSeedKey) return;
    this.thumbBackfillSeedKey = seedKey;
    pending.forEach(s => this.queueThumbnailBackfill(s));
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
      this.lastState = state;
      this.lastAutopilot = autopilot;

      this.els.autopilotPill.classList.remove("is-error");
      this.updateHeader(state, autopilot);
      if (this.currentPage === "studio") {
        this.updateStudio(autopilot, state);
      }
      if (stateRes.ok) {
        this.updateSettings(state, autopilot);
        this.updateGalleryFilters(state);
      }

      if (stateRes.ok) {
        const fp = this.timelineFingerprint(state);
        if (fp !== this.timelineKey) {
          this.timelineKey = fp;
          if (this.currentPage === "gallery") this.updateTimeline(state);
        }
        if (state.generationCount !== this.lastGen) {
          this.lastGen = state.generationCount;
        }
      }

      if (this.currentPage === "gallery") {
        this.seedThumbnailBackfill();
      }

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
    if (this.els.btnRegenerateBatch) {
      this.els.btnRegenerateBatch.disabled = busy;
    }

    if (batchKey !== this.displayedBatchKey) {
      this.displayedBatchKey = batchKey;
      this.displayedGeneration = gen;
      this.activeBatch = batch;
      this.userRatings = {};
      this.compileResults = {};
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
      const hypothesis = sketch.hypothesis
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

      cell.addEventListener("click", (e) => {
        if (e.target.closest(".btn-rate")) return;
        this.openDialog(sketch, window.scrollY);
      });
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

  retryFailedRenderers(batch) {
    batch.forEach((sketch) => {
      getSharedGridRenderer().register(
        sketch.id,
        this.els.shaderGrid.querySelector(`[data-id="${sketch.id}"] canvas`),
        sketch.glsl,
        null
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

  async initVoicePanel() {
    const cfg = await this.voiceCurator.loadConfig();
    if (!cfg.enabled || !this.els.voicePanel) return;
    this.els.voicePanel.hidden = false;
  }

  updateVoiceStatus(status) {
    if (!this.els.btnVoiceConnect) return;
    const live = status === "live";
    const connecting = status === "connecting";
    this.els.btnVoiceConnect.classList.toggle("is-live", live);
    this.els.btnVoiceConnect.setAttribute("aria-pressed", live ? "true" : "false");
    this.els.btnVoiceConnect.textContent = live
      ? "End voice session"
      : connecting
        ? "Connecting…"
        : "Talk to ShaderMind";
    this.els.btnVoiceConnect.disabled = connecting;

    if (this.els.voiceStatus) {
      const show = live || connecting;
      this.els.voiceStatus.hidden = !show;
      this.els.voiceStatus.textContent = live
        ? "voice curator live"
        : connecting
          ? "joining room…"
          : "";
    }
  }

  async toggleVoice() {
    if (!this.els.btnVoiceConnect) return;
    try {
      if (this.voiceCurator.connected) {
        await this.voiceCurator.disconnect();
      } else {
        await this.voiceCurator.connect();
      }
    } catch (err) {
      alert(`Voice error: ${err.message}`);
      this.updateVoiceStatus("idle");
    }
  }

  resolveSketchRef({ index, sketchId }) {
    const batch = this.activeBatch || [];
    if (sketchId) {
      const byId = batch.find(s => s.id === sketchId);
      if (!byId) throw new Error(`Shader ${sketchId} is not in the current batch.`);
      return byId;
    }
    if (!index || index < 1 || index > batch.length) {
      throw new Error(`Shader index must be between 1 and ${batch.length || 0}.`);
    }
    return batch[index - 1];
  }

  applyVoiceRating({ index, sketchId, rating }) {
    const sketch = this.resolveSketchRef({ index, sketchId });
    const score = Number(rating);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error("Rating must be an integer from 1 to 5.");
    }
    this.rateSketch(sketch.id, score);
    return {
      ok: true,
      sketchId: sketch.id,
      title: sketch.title,
      rating: score,
      progress: this.getVoiceCurationProgress()
    };
  }

  applyVoiceOpinion(notes) {
    const text = String(notes || "").trim();
    if (!text) throw new Error("Notes cannot be empty.");
    this.els.userOpinion.value = text;
    return { ok: true, notes: text };
  }

  getVoiceCurationProgress() {
    const total = this.activeBatch?.length || 0;
    const rated = Object.keys(this.userRatings).length;
    const sketches = (this.activeBatch || []).map((sketch, i) => ({
      index: i + 1,
      id: sketch.id,
      title: sketch.title,
      rating: this.userRatings[sketch.id] ?? null
    }));
    return {
      total,
      rated,
      readyToSubmit: total > 0 && rated === total,
      sketches
    };
  }

  async submitVoiceCuration() {
    const progress = this.getVoiceCurationProgress();
    if (!progress.readyToSubmit) {
      throw new Error(`Only ${progress.rated} of ${progress.total} shaders are rated.`);
    }
    await this.submitFeedback();
    return {
      ok: true,
      submitted: true,
      generation: this.activeBatch?.[0]?.generation ?? null
    };
  }

  rateSketch(sketchId, rating) {
    this.userRatings[sketchId] = rating;

    if (rating >= 4) {
      window.setTimeout(async () => {
        const sketch = this.activeBatch?.find(s => s.id === sketchId);
        if (!sketch || sketch.thumbnail) return;
        const thumb = await this.captureSketchThumbnail(sketch);
        if (thumb) sketch.thumbnail = thumb;
      }, 250);
    }

    this.applyRatingUi(sketchId, rating);
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

  async captureSketchThumbnail(sketch) {
    const grid = getSharedGridRenderer();
    if (grid.hasCell(sketch.id)) {
      const fromGrid = grid.captureCellThumbnail(sketch.id, THUMB_SIZE, THUMB_TIME, THUMB_QUALITY);
      if (fromGrid) return fromGrid;
    }
    return this.renderOffscreenThumbnail(sketch);
  }

  async ensureBatchThumbnails(batch, ratings) {
    const thumbnails = {};
    for (const sketch of batch) {
      if (this.ratingValue(ratings[sketch.id]) < 4) continue;
      let thumb = sketch.thumbnail || null;
      if (!thumb) {
        thumb = await this.captureSketchThumbnail(sketch);
        if (thumb) sketch.thumbnail = thumb;
      }
      if (thumb) thumbnails[sketch.id] = thumb;
    }
    return thumbnails;
  }

  queueThumbnailBackfill(sketch) {
    if (!this.sketchNeedsThumbnail(sketch)) return;
    if (this.thumbBackfillQueue.some(s => s.id === sketch.id)) return;
    this.thumbBackfillQueue.push(sketch);
    this.drainThumbnailBackfill();
  }

  async drainThumbnailBackfill() {
    if (this.thumbBackfillBusy || !this.thumbBackfillQueue.length) return;
    if (this.els.shaderDialog?.open) return;
    this.thumbBackfillBusy = true;

    while (this.thumbBackfillQueue.length) {
      if (this.els.shaderDialog?.open) break;

      const sketch = this.thumbBackfillQueue.shift();
      if (!sketch || !this.sketchNeedsThumbnail(sketch)) continue;

      const thumb = await this.captureSketchThumbnail(sketch);
      this.thumbBackfillAttempted.add(sketch.id);
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
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    canvas.style.cssText = `position:fixed;left:-9999px;width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;pointer-events:none;`;
    document.body.appendChild(canvas);

    const renderer = new ShaderRenderer(canvas, { silent: true });
    try {
      const ok = await renderer.compile(sketch.glsl);
      if (!ok) return null;
      return renderer.captureThumbnail(THUMB_SIZE, THUMB_TIME, THUMB_QUALITY);
    } finally {
      renderer.destroy();
      canvas.remove();
    }
  }

  refreshTimelineThumb(sketchId, thumbnail) {
    const btn = this.els.timelineList.querySelector(`[data-sketch-id="${sketchId}"]`);
    if (btn) {
      const existing = btn.querySelector("img");
      if (existing) {
        existing.src = thumbnail;
      } else {
        btn.classList.remove("timeline-thumb-pending");
        btn.style.background = "";
        delete btn.dataset.pending;
        const img = document.createElement("img");
        img.src = thumbnail;
        img.alt = "";
        img.loading = "lazy";
        btn.appendChild(img);
      }
    }

    const archiveCell = this.els.archiveGrid?.querySelector(`[data-id="${sketchId}"] .archive-thumb`);
    if (archiveCell) {
      archiveCell.classList.remove("archive-thumb-pending");
      if (!archiveCell.querySelector("img")) {
        const img = document.createElement("img");
        img.src = thumbnail;
        img.alt = "";
        img.loading = "lazy";
        archiveCell.appendChild(img);
      }
    }
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
      thumb.classList.add("timeline-thumb-pending");
      thumb.dataset.pending = "1";
      this.queueThumbnailBackfill(sketch);
    }

    thumb.addEventListener("click", () => this.openDialog(sketch, window.scrollY));
    container.appendChild(thumb);
  }

  async regenerateBatch() {
    const focus = this.els.userOpinion.value.trim();
    this.els.btnRegenerateBatch.disabled = true;
    this.els.btnRegenerateBatch.textContent = "regenerating…";

    try {
      const res = await fetch("/api/autopilot/regenerate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus || undefined })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Regenerate failed");
      this.userRatings = {};
      this.compileResults = {};
      this.displayedBatchKey = null;
      await this.poll();
    } catch (err) {
      alert(`Regenerate error: ${err.message}`);
    } finally {
      this.els.btnRegenerateBatch.disabled = false;
      this.els.btnRegenerateBatch.textContent = "Regenerate batch";
    }
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
    const explicitRatingIds = Object.keys(this.userRatings);
    this.els.btnSubmitFeedback.disabled = true;
    this.els.btnSubmitFeedback.textContent = "Capturing thumbnails…";
    const thumbnails = await this.ensureBatchThumbnails(this.activeBatch, ratings);

    this.els.btnSubmitFeedback.textContent = "Saving…";

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: gen,
          ratings,
          explicitRatingIds,
          compileResults: this.compileResults,
          thumbnails,
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
      this.displayedBatchKey = null;
      this.activeBatch = null;
      this.els.curationPanel.hidden = true;
      this.els.reflectionText.textContent = result.evolutionPending
        ? `${result.highRatedCount} high · ${result.lowRatedCount} low — next batch generating…`
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

  updateSettings(state, autopilot = {}) {
    const timeline = state.strategyTimeline || [];
    const latest = timeline[timeline.length - 1];
    if (latest?.notes && this.els.btnSubmitFeedback.disabled) {
      this.els.reflectionText.textContent = latest.notes;
    } else if (!latest?.notes) {
      this.els.reflectionText.textContent = "Waiting for the first batch.";
    }
    this.els.strategyText.textContent = state.currentStrategy || "";

    const heuristics = state.heuristics || [];
    this.els.heuristicsList.innerHTML = heuristics.length
      ? heuristics.map(h => `<li>${this.esc(h)}</li>`).join("")
      : "<li>Awaiting your first curation.</li>";

    this.els.logFeed.innerHTML = [...timeline].reverse().map(t => `
      <div class="log-entry">
        <strong>Gen ${t.generation}</strong>
        <span> · ${new Date(t.timestamp).toLocaleString()}</span>
        <p>${this.esc(t.notes || "")}</p>
      </div>
    `).join("");

    const memory = state.preferenceMemory || { prefer: [], avoid: [] };
    this.els.preferList.innerHTML = (memory.prefer || []).length
      ? memory.prefer.map(item => `
          <li>${this.esc(item.rule)}
            <span class="memory-meta">avg ${item.averageRating} · support ${item.support}</span>
          </li>`).join("")
      : "<li>No prefer rules yet.</li>";
    this.els.avoidList.innerHTML = (memory.avoid || []).length
      ? memory.avoid.map(item => `
          <li>${this.esc(item.rule)}
            <span class="memory-meta">avg ${item.averageRating} · support ${item.support}</span>
          </li>`).join("")
      : "<li>No avoid rules yet.</li>";

    const phase = autopilot.phase || "idle";
    this.els.autopilotInfo.innerHTML = `
      <dt>Phase</dt><dd>${this.esc(phase)}</dd>
      <dt>Running</dt><dd>${autopilot.running ? "yes" : "no"}</dd>
      <dt>Cycles</dt><dd>${autopilot.cyclesCompleted ?? 0}</dd>
      ${autopilot.lastError ? `<dt>Last error</dt><dd>${this.esc(autopilot.lastError)}</dd>` : ""}
    `;
    this.els.btnAutopilotStart.disabled = autopilot.running;
    this.els.btnAutopilotStop.disabled = !autopilot.running;

    this.els.systemInfo.innerHTML = `
      <dt>Storage</dt><dd>${this.esc(state.storage || "—")}</dd>
      <dt>Rating scale</dt><dd>${this.esc(state.ratingScale || "1-5")}</dd>
      <dt>Learning mode</dt><dd>${this.esc(state.learningMode || "—")}</dd>
      <dt>Code-aware</dt><dd>${state.codeAwareLearning ? "on" : "off"}</dd>
      <dt>Model</dt><dd>${this.esc(state.aiProvider?.model || "—")}</dd>
    `;
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
        good.slice(0, 4).forEach(s => this.mountTimelineThumb(container, s));
      }
    });
  }

  async fetchMonologue() {
    this.els.btnMonologue.disabled = true;
    this.els.btnMonologue.textContent = "summarizing…";
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
      this.els.btnMonologue.textContent = "Summarize learning so far";
    }
  }

  resolveSketch(sketch) {
    if (!sketch?.id) return sketch;
    const cached = this.sketches.find(s => s.id === sketch.id)
      || this.activeBatch?.find(s => s.id === sketch.id)
      || this.galleryItems?.find(s => s.id === sketch.id);
    if (!cached) return sketch;
    return { ...cached, ...sketch, glsl: sketch.glsl || cached.glsl };
  }

  suspendSharedGrid() {
    if (this.sharedGridSuspended) return;
    getSharedGridRenderer().suspend();
    this.sharedGridSuspended = true;
  }

  resumeSharedGrid() {
    if (!this.sharedGridSuspended) return;
    getSharedGridRenderer().resume();
    this.sharedGridSuspended = false;
  }

  disposeDialogRenderer() {
    if (this.dialogOwnedRenderer && this.dialogRenderer) {
      this.dialogRenderer.destroy();
    }
    this.dialogRenderer = null;
    this.dialogOwnedRenderer = false;
    this.dialogSketchId = null;
    this.resumeSharedGrid();
    this.drainThumbnailBackfill();
  }

  lockBodyScroll(scrollY = null) {
    if (this.bodyScrollLocked) return;
    this.savedScrollY = scrollY ?? window.scrollY ?? document.documentElement.scrollTop ?? 0;
    // Set top BEFORE position:fixed — otherwise one frame shows the page top.
    document.body.style.top = `-${this.savedScrollY}px`;
    document.documentElement.classList.add("dialog-open");
    document.body.classList.add("dialog-open");
    this.bodyScrollLocked = true;
  }

  unlockBodyScroll() {
    if (!this.bodyScrollLocked) return;
    const y = this.savedScrollY;
    document.documentElement.classList.remove("dialog-open");
    document.body.classList.remove("dialog-open");
    document.body.style.top = "";
    this.bodyScrollLocked = false;
    this.savedScrollY = 0;
    window.scrollTo(0, y);
  }

  onDialogClosed() {
    this.disposeDialogRenderer();
    this.unlockBodyScroll();
  }

  waitForDialogLayout() {
    return new Promise((resolve) => {
      const wrap = this.els.dialogCanvas.parentElement;
      let attempts = 0;

      const ready = () => {
        const rect = wrap?.getBoundingClientRect();
        return rect && rect.width >= 32 && rect.height >= 32;
      };

      const finish = () => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };

      if (ready()) {
        finish();
        return;
      }

      const poll = () => {
        attempts += 1;
        if (ready() || attempts >= 40) {
          finish();
          return;
        }
        requestAnimationFrame(poll);
      };

      if (wrap && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          if (!ready()) return;
          observer.disconnect();
          finish();
        });
        observer.observe(wrap);
        requestAnimationFrame(poll);
        return;
      }

      requestAnimationFrame(poll);
    });
  }

  mountDialogRerate(sketch, allowRerate) {
    if (!this.els.dialogRerate || !this.els.dialogRateActions) return;
    const show = Boolean(allowRerate && sketch?.id);
    this.els.dialogRerate.hidden = !show;
    if (!show) {
      this.els.dialogRateActions.innerHTML = "";
      return;
    }

    this.els.dialogRateActions.innerHTML = "";
    this.els.dialogRateActions.appendChild(
      this.buildRateActions(sketch, (id, r) => this.updateSketchRating(id, r))
    );
    if (this.els.dialogRerateHint) {
      this.els.dialogRerateHint.textContent = "Changes save immediately and update learned taste.";
    }
  }

  async openDialog(sketch, scrollY = null, { allowRerate = false } = {}) {
    const openScrollY = scrollY ?? window.scrollY ?? document.documentElement.scrollTop ?? 0;

    const resolved = this.resolveSketch(sketch);
    if (!resolved?.glsl) {
      alert("Shader source unavailable for this sketch.");
      return;
    }

    if (this.els.shaderDialog.open) {
      this.closeDialog();
    }

    this.dialogSketchId = resolved.id;
    const score = this.ratingValue(resolved.rating);

    this.els.dialogEyebrow.textContent = `Gen ${resolved.generation} · ${resolved.type || "sketch"}`;
    this.els.dialogTitle.textContent = resolved.title || "Untitled";
    this.els.dialogHypothesis.textContent = resolved.hypothesis || "";
    this.els.dialogHypothesis.hidden = !resolved.hypothesis;

    if (score) {
      this.els.dialogRating.hidden = false;
      this.els.dialogRating.textContent = `${score} / 5`;
    } else {
      this.els.dialogRating.hidden = true;
      this.els.dialogRating.textContent = "";
    }

    if (this.els.dialogStatement) {
      this.els.dialogStatement.textContent = "";
      this.els.dialogStatement.hidden = true;
    }
    this.els.dialogCode.textContent = resolved.glsl || "";
    this.mountDialogRerate(resolved, allowRerate || this.currentPage === "gallery");

    this.els.dialogError.hidden = true;
    this.els.dialogError.textContent = "";
    this.els.dialogLoading.hidden = false;
    this.els.dialogHint.hidden = true;
    this.els.dialogCanvas.hidden = false;

    this.suspendSharedGrid();
    this.lockBodyScroll(openScrollY);
    this.els.shaderDialog.showModal();
    if (typeof this.els.shaderDialog.focus === "function") {
      this.els.shaderDialog.focus({ preventScroll: true });
    }

    await this.waitForDialogLayout();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    if (this.dialogSketchId !== resolved.id || !this.els.shaderDialog.open) return;

    this.dialogRenderer = new ShaderRenderer(this.els.dialogCanvas, {
      errorEl: this.els.dialogError,
      loadingEl: this.els.dialogLoading,
      hintEl: this.els.dialogHint
    });
    this.dialogOwnedRenderer = true;
    this.dialogRenderer.compileWhenReady(resolved.glsl);
  }

  closeDialog() {
    if (!this.els.shaderDialog.open) {
      this.disposeDialogRenderer();
      this.unlockBodyScroll();
      return;
    }
    this.els.shaderDialog.close();
  }

  clearTimelineRenderers() {
    this.timelineRenderers.forEach(r => r.destroy());
    this.timelineRenderers = [];
  }

  clearRenderers() {
    getSharedGridRenderer().clearByPrefix("");
    this.renderers.forEach(r => r.destroy());
    this.renderers.clear();
    this.clearTimelineRenderers();
  }

  ratingLabel(score) {
    return {
      1: "strong rejection",
      2: "weak rejection",
      3: "neutral",
      4: "preference",
      5: "exceptional"
    }[score] || "rating";
  }

  ratingValue(rating) {
    if (rating === "good") return 5;
    if (rating === "bad") return 1;
    const value = Number(rating);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
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