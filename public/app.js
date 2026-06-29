import { ShaderRenderer } from "./shader-renderer.js?v=15";
import { getSharedGridRenderer } from "./shared-grid-renderer.js?v=8";
import { VoiceCurator } from "./voice-curator.js?v=1";
import {
  THUMB_CAPTURE_SIZE,
  THUMB_CAPTURE_VERSION,
  THUMB_LEGACY_MAX_CHARS,
  THUMB_QUALITY,
  THUMB_TIME,
  galleryThumbMigrationKey
} from "./thumbnail-config.js?v=3";

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
    this.detailRenderer = null;
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
    this.thumbObserver = null;
    this.thumbMigrationWatch = null;
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
      gridStatusBanner: document.getElementById("gridStatusBanner"),
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
      galleryRefreshThumbs: document.getElementById("galleryRefreshThumbs"),
      reflectionText: document.getElementById("reflectionText"),
      strategyText: document.getElementById("strategyText"),
      timelineList: document.getElementById("timelineList"),
      heuristicsList: document.getElementById("heuristicsList"),
      preferList: document.getElementById("preferList"),
      patternLibraryList: document.getElementById("patternLibraryList"),
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
      studioDetail: document.getElementById("studioDetail"),
      detailTitle: document.getElementById("detailTitle"),
      detailSub: document.getElementById("detailSub"),
      detailClose: document.getElementById("detailClose"),
      detailCanvas: document.getElementById("detailCanvas"),
      detailError: document.getElementById("detailError"),
      detailPipelineStage: document.getElementById("detailPipelineStage"),
      detailPipelinePanel: document.createElement("aside"),
      detailProvenance: document.getElementById("detailProvenance"),
      detailCode: document.getElementById("detailCode")
    };

    this.detailSketch = null;
    this.detailRenderer = null;
    this.detailCanvasListeners = null;
    this.detailListenId = 0;

    this.els.detailClose?.addEventListener("click", () => this.closeDetailPane());
    window.addEventListener("resize", () => {
      if (this.detailRenderer?.gl) this.detailRenderer.relayout();
       if (window.PipelineViewer?.relayoutInline) window.PipelineViewer.relayoutInline();
    });
    this.els.btnMonologue.addEventListener("click", () => this.fetchMonologue());
    this.els.btnSubmitFeedback.addEventListener("click", () => this.submitFeedback());
    this.els.btnGenerateNext.addEventListener("click", () => this.generateNextBatch());
    this.els.btnRegenerateBatch?.addEventListener("click", () => this.regenerateBatch());
    this.els.navTabs.forEach(tab => {
      tab.addEventListener("click", () => this.setPage(tab.dataset.page));
    });
    this.els.galleryPrev.addEventListener("click", () => this.changeGalleryPage(-1));
    this.els.galleryNext.addEventListener("click", () => this.changeGalleryPage(1));
    const onGalleryFilterChange = () => {
      this.galleryPage = 1;
      this.galleryKey = null;
      this.updateGallerySubcopy();
      this.loadGalleryPage();
    };
    if (this.els.galleryFilterGen) {
      this.els.galleryFilterGen.addEventListener("change", onGalleryFilterChange);
    }
    if (this.els.galleryFilterRating) {
      this.els.galleryFilterRating.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", onGalleryFilterChange);
      });
    }
    if (this.els.galleryRefreshThumbs) {
      this.els.galleryRefreshThumbs.addEventListener("click", () => this.refreshGalleryThumbnails());
    }
    this.els.btnAutopilotStart.addEventListener("click", () => this.autopilotAction("start"));
    this.els.btnAutopilotStop.addEventListener("click", () => this.autopilotAction("stop"));
    this.els.btnAutopilotKick.addEventListener("click", () => this.autopilotAction("kick"));
    this.els.btnVoiceConnect?.addEventListener("click", () => this.toggleVoice());

    this.voiceCurator.onStatusChange = (status) => this.updateVoiceStatus(status);
    this.initVoicePanel();

    getSharedGridRenderer().onStatusChange((status) => this.updateGridStatusBanner(status));

    window.addEventListener("hashchange", () => this.syncPageFromHash());
    this.syncPageFromHash(true);

    this.poll();
    this.schedulePoll();
    window.setTimeout(() => this.runGalleryThumbnailMigrationOnce(), 2500);
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
      this.loadGalleryPage().then(() => this.runGalleryThumbnailMigrationOnce());
      if (this.lastState) this.updateTimeline(this.lastState);
    }
  }

  getSelectedFilters(fieldsetId) {
    const fieldset = document.getElementById(fieldsetId);
    if (!fieldset) return [];
    return Array.from(fieldset.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
  }

  setSelectedFilters(fieldsetId, values) {
    const fieldset = document.getElementById(fieldsetId);
    if (!fieldset) return;
    const set = new Set(values);
    fieldset.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = set.has(cb.value);
    });
  }

  populateGenerationFilter() {
    const container = this.els.galleryFilterGen;
    if (!container) return;
    const generations = new Set();
    for (const s of this.sketches || []) {
      if (s.generation != null) generations.add(s.generation);
    }
    for (const s of this.galleryItems || []) {
      if (s.generation != null) generations.add(s.generation);
    }
    const sorted = [...generations].sort((a, b) => b - a);
    if (!sorted.length) {
      container.innerHTML = '<span class="filter-empty">No generations yet</span>';
      return;
    }
    container.innerHTML = "";
    for (const gen of sorted) {
      const label = document.createElement("label");
      label.className = "filter-chip";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(gen);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` Gen ${gen}`));
      container.appendChild(label);
    }
    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        this.galleryPage = 1;
        this.galleryKey = null;
        this.updateGallerySubcopy();
        this.loadGalleryPage();
      });
    });
  }

  galleryQueryParams() {
    const gens = this.getSelectedFilters("galleryFilterGenField");
    const ratings = this.getSelectedFilters("galleryFilterRatingField");
    const limit = gens.length ? 100 : this.galleryLimit;
    const params = new URLSearchParams({
      page: String(this.galleryPage),
      limit: String(limit)
    });
    for (const g of gens) params.append("generation", g);
    for (const r of ratings) params.append("rating", r);
    return params;
  }

  updateGallerySubcopy() {
    if (!this.els.gallerySub) return;
    const gens = this.getSelectedFilters("galleryFilterGenField");
    const ratings = this.getSelectedFilters("galleryFilterRatingField");
    const parts = [];
    if (gens.length) parts.push(`Gen ${gens.join(", ")}`);
    if (ratings.length) parts.push(`Rating ${ratings.join(", ")}`);
    parts.length = parts.length;
    this.els.gallerySub.textContent = parts.length
      ? `Filtered by ${parts.join(" · ")}`
      : "Saved sketches and strategy milestones across generations.";
  }

  async refreshGalleryThumbnails() {
    if (!this.els.galleryRefreshThumbs) return;
    const btn = this.els.galleryRefreshThumbs;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Refreshing…";
    try {
      const items = await this.runGalleryThumbnailMigrationNow();
      const missing = items.filter((s) => !s.thumbnail || s.thumbnail.length < 100).length;
      const captured = items.length - missing;
      btn.textContent = missing === 0
        ? `Done · ${captured}/${items.length}`
        : `Captured ${captured}, ${missing} pending`;
      window.setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2500);
    } catch (err) {
      console.error("Refresh thumbnails failed:", err);
      btn.textContent = "Failed — try again";
      window.setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 2500);
    }
  }

  async deleteGallerySketch(sketchId) {
    if (!sketchId) return;
    const confirmed = window.confirm(`Delete sketch ${sketchId}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/sketches/${encodeURIComponent(sketchId)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      this.sketches = (this.sketches || []).filter((s) => s.id !== sketchId);
      this.galleryItems = (this.galleryItems || []).filter((s) => s.id !== sketchId);
      this.galleryKey = null;
      this.renderGalleryGrid();
      this.updateGallerySubcopy();
      if (this.lastState) this.updateTimeline(this.lastState);
    } catch (err) {
      console.error("Delete failed:", err);
      window.alert(`Could not delete ${sketchId}: ${err.message}`);
    }
  }

  async loadGalleryPage() {
    try {
      const res = await fetch(`/api/sketches?${this.galleryQueryParams()}`);
      if (!res.ok) throw new Error("Failed to load gallery");
      const data = await res.json();
      this.galleryItems = data.items || data;
      this.galleryPages = data.pages || 1;
      this.galleryPage = data.page || this.galleryPage;
      this.populateGenerationFilter();
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
        thumb.dataset.sketchId = sketch.id;
        this.observeThumbnailPending(thumb, sketch);
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

      const actions = document.createElement("div");
      actions.className = "archive-actions";
      const modelTag = sketch.model ? document.createElement("span") : null;
      if (modelTag) {
        modelTag.className = "archive-model-tag";
        modelTag.textContent = sketch.model;
        modelTag.title = `Provider: ${sketch.provider || "unknown"} · Generated: ${sketch.inferenceTimestamp || "unknown"}`;
        actions.appendChild(modelTag);
      }
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "archive-delete-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.title = `Delete ${sketch.id}`;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteGallerySketch(sketch.id);
      });
      actions.appendChild(deleteBtn);
      cell.appendChild(actions);

      cell.addEventListener("click", (e) => {
        if (e.target.closest(".btn-rate")) return;
        if (e.target.closest(".archive-delete-btn")) return;
        this.selectSketch(sketch, { allowRerate: true });
      });
      this.els.archiveGrid.appendChild(cell);
    });

    this.els.galleryPageInfo.textContent = `Page ${this.galleryPage} of ${this.galleryPages}`;
    this.els.galleryPrev.disabled = this.galleryPage <= 1;
    this.els.galleryNext.disabled = this.galleryPage >= this.galleryPages;
  }

  updateGalleryFilters(state) {
    this.populateGenerationFilter();
    this.updateGallerySubcopy();
  }

  updateGallerySubcopy() {
    if (!this.els.gallerySub) return;
    const gens = this.getSelectedFilters("galleryFilterGenField");
    const ratings = this.getSelectedFilters("galleryFilterRatingField");
    const parts = [];
    if (gens.length) parts.push(`Gen ${gens.join(", ")}`);
    if (ratings.length) parts.push(`Rating ${ratings.join(", ")}`);
    this.els.gallerySub.textContent = parts.length
      ? `Filtered by ${parts.join(" · ")} — click a sketch to review.`
      : "Saved sketches and strategy milestones across generations.";
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

    if (this.detailSketch?.id === sketchId) {
      this.els.detailSub.textContent = this.els.detailSub.textContent.replace(/ · \d\/5$/, ` · ${rating}/5`);
      this.populateDetailProvenance(this.detailSketch);
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

      if (this.els.detailSub) {
        this.els.detailSub.textContent = this.els.detailSub.textContent.replace(/ · \d\/5$/, ` · ${rating}/5`);
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

  thumbnailNeedsUpgrade(sketchOrThumb) {
    if (sketchOrThumb && typeof sketchOrThumb === "object") {
      const thumb = sketchOrThumb.thumbnail;
      const version = Number(sketchOrThumb.thumbnailVersion) || 0;
      if (!thumb) return true;
      if (version >= THUMB_CAPTURE_VERSION) return false;
      if (version > 0) return true;
      return thumb.length < THUMB_LEGACY_MAX_CHARS;
    }
    const thumb = sketchOrThumb;
    return !thumb || thumb.length < THUMB_LEGACY_MAX_CHARS;
  }

  sketchNeedsThumbnail(sketch) {
    if (!sketch?.id || !sketch?.glsl) return false;
    if (this.thumbBackfillAttempted.has(sketch.id)) return false;
    if (!this.thumbnailNeedsUpgrade(sketch)) return false;
    // Stale compile failures (pre-GLSL-patch) must not block HD thumbnail retries.
    if (sketch.compile?.success === false && sketch.thumbnail) return false;
    return true;
  }

  async fetchAllGallerySketches() {
    const items = [];
    let page = 1;
    let pages = 1;
    while (page <= pages) {
      const res = await fetch(`/api/sketches?limit=50&page=${page}`);
      if (!res.ok) break;
      const data = await res.json();
      pages = data.pages || 1;
      items.push(...(data.items || []));
      page += 1;
    }
    return items;
  }

  watchGalleryThumbMigrationComplete() {
    if (this.thumbMigrationWatch) return;
    const key = galleryThumbMigrationKey();

    const tick = () => {
      if (this.thumbBackfillBusy || this.thumbBackfillQueue.length > 0) {
        this.thumbMigrationWatch = window.setTimeout(tick, 600);
        return;
      }
      localStorage.setItem(key, "done");
      this.thumbMigrationWatch = null;
      this.galleryKey = null;
      if (this.currentPage === "gallery") {
        this.loadGalleryPage();
        if (this.lastState) this.updateTimeline(this.lastState);
      }
    };

    this.thumbMigrationWatch = window.setTimeout(tick, 600);
  }

  async runGalleryThumbnailMigrationOnce() {
    const sketches = await this.fetchAllGallerySketches();
    const needsUpgrade = sketches.filter(s => this.sketchNeedsThumbnail(s));
    if (!needsUpgrade.length) {
      localStorage.setItem(galleryThumbMigrationKey(), "done");
      return;
    }

    this.thumbBackfillAttempted.clear();
    this.galleryKey = null;

    for (const sketch of needsUpgrade) {
      const local = this.sketches.find(s => s.id === sketch.id);
      if (local) {
        local.thumbnail = sketch.thumbnail;
        local.thumbnailVersion = sketch.thumbnailVersion;
      }
      this.queueThumbnailBackfill(sketch);
    }

    this.watchGalleryThumbMigrationComplete();
  }

  async runGalleryThumbnailMigrationNow() {
    this.thumbBackfillAttempted.clear();
    this.galleryKey = null;
    localStorage.removeItem(galleryThumbMigrationKey());
    this.galleryPage = 1;
    await this.loadGalleryPage();
    await this.runGalleryThumbnailMigrationOnce();
    return this.fetchAllGallerySketches();
  }

  ensureThumbObserver() {
    if (this.thumbObserver || typeof IntersectionObserver === "undefined") return;
    this.thumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const sketchId = entry.target.dataset.sketchId;
        const sketch = this.sketches.find(s => s.id === sketchId)
          || this.galleryItems.find(s => s.id === sketchId);
        if (sketch) this.queueThumbnailBackfill(sketch);
        this.thumbObserver.unobserve(entry.target);
      }
    }, { rootMargin: "100px", threshold: 0.08 });
  }

  observeThumbnailPending(element, sketch) {
    if (!element || !this.sketchNeedsThumbnail(sketch)) return;
    element.dataset.sketchId = sketch.id;
    this.ensureThumbObserver();
    if (this.thumbObserver) {
      this.thumbObserver.observe(element);
      return;
    }
    this.queueThumbnailBackfill(sketch);
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
        this.selectSketch(sketch);
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

  updateGridStatusBanner(status) {
    const banner = this.els.gridStatusBanner;
    if (!banner) return;

    if (!status.webglAvailable) {
      banner.hidden = false;
      banner.classList.remove("context-lost");
      banner.textContent =
        "WebGL is unavailable in this browser. Enable hardware acceleration " +
        "(chrome://settings/system → Use graphics acceleration when available), " +
        "or open DevTools → Application → Clear storage and reload. " +
        "Shaders cannot render until WebGL is restored.";
      return;
    }

    if (status.contextLost) {
      banner.hidden = false;
      banner.classList.add("context-lost");
      banner.textContent = "WebGL context lost. Renderer is attempting recovery.";
      return;
    }

    banner.hidden = true;
    banner.textContent = "";
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

  async captureSketchThumbnail(sketch, { preferDetail = false } = {}) {
    if (preferDetail && this.detailRenderer?.program && this.detailSketch?.id === sketch.id) {
      const fromDetail = this.detailRenderer.captureThumbnail(THUMB_CAPTURE_SIZE, THUMB_TIME, THUMB_QUALITY);
      if (fromDetail) return fromDetail;
    }

    const grid = getSharedGridRenderer();
    if (grid.hasCell(sketch.id)) {
      const fromGrid = grid.captureCellThumbnail(
        sketch.id,
        THUMB_CAPTURE_SIZE,
        THUMB_TIME,
        THUMB_QUALITY
      );
      if (fromGrid) return fromGrid;
    }
    return this.renderOffscreenThumbnail(sketch);
  }

  async persistSketchThumbnail(sketch, thumbnail) {
    if (!sketch?.id || !thumbnail) return false;
    sketch.thumbnail = thumbnail;

    const local = this.sketches.find(s => s.id === sketch.id);
    if (local) local.thumbnail = thumbnail;

    const batch = this.activeBatch?.find(s => s.id === sketch.id);
    if (batch) batch.thumbnail = thumbnail;

    try {
      const res = await fetch("/api/sketches/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sketch.id,
          thumbnail,
          thumbnailVersion: THUMB_CAPTURE_VERSION
        })
      });
      if (!res.ok) return false;
      sketch.thumbnailVersion = THUMB_CAPTURE_VERSION;
      this.thumbBackfillAttempted.add(sketch.id);
      this.galleryKey = null;
      this.refreshTimelineThumb(sketch.id, thumbnail);
      this.refreshGalleryThumb(sketch.id, thumbnail);
      if (this.currentPage === "gallery") {
        this.renderGalleryGrid();
      }
      if (this.detailSketch?.id === sketch.id && this.els.detailCanvas) {
        this.detailRenderer?.canvas && (this.detailRenderer.canvas.style.opacity = "1");
      }
      return true;
    } catch (err) {
      console.warn("Thumbnail upload failed:", err.message);
      return false;
    }
  }

  async ensureBatchThumbnails(batch, ratings) {
    const thumbnails = {};
    for (const sketch of batch) {
      if (this.ratingValue(ratings[sketch.id]) < 4) continue;
      let thumb = sketch.thumbnail || null;
      if (this.thumbnailNeedsUpgrade(sketch)) {
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
    this.thumbBackfillBusy = true;

    while (this.thumbBackfillQueue.length) {

      const sketch = this.thumbBackfillQueue.shift();
      if (!sketch || !this.sketchNeedsThumbnail(sketch)) continue;

      const thumb = await this.captureSketchThumbnail(sketch);
      if (!thumb) {
        this.thumbBackfillAttempted.add(sketch.id);
        this.markGalleryThumbFailed(sketch.id);
        continue;
      }

      await this.persistSketchThumbnail(sketch, thumb);
      await new Promise(r => window.setTimeout(r, 350));
    }

    this.thumbBackfillBusy = false;
  }

  markGalleryThumbFailed(sketchId) {
    const cell = this.els.archiveGrid?.querySelector(`[data-id="${sketchId}"] .archive-thumb`);
    if (!cell) return;
    cell.classList.remove("archive-thumb-pending");
  }

  refreshGalleryThumb(sketchId, thumbnail) {
    const cell = this.els.archiveGrid?.querySelector(`[data-id="${sketchId}"] .archive-thumb`);
    if (!cell || !thumbnail) return;
    cell.classList.remove("archive-thumb-pending");
    let img = cell.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.loading = "lazy";
      cell.appendChild(img);
    }
    img.src = thumbnail;
    img.alt = "";
  }

  async renderOffscreenThumbnail(sketch) {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_CAPTURE_SIZE;
    canvas.height = THUMB_CAPTURE_SIZE;
    canvas.style.cssText = `position:fixed;left:-9999px;width:${THUMB_CAPTURE_SIZE}px;height:${THUMB_CAPTURE_SIZE}px;pointer-events:none;`;
    document.body.appendChild(canvas);

    const renderer = new ShaderRenderer(canvas, {
      silent: true,
      fixedSize: THUMB_CAPTURE_SIZE
    });
    try {
      const ok = await renderer.compile(sketch.glsl);
      if (!ok) return null;
      return renderer.captureThumbnail(THUMB_CAPTURE_SIZE, THUMB_TIME, THUMB_QUALITY);
    } finally {
      renderer.destroy();
      canvas.remove();
    }
  }

  showDialogPoster() {}

  hideDialogPoster() {}

  clearDialogPoster() {}

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
      thumb.dataset.sketchId = sketch.id;
      this.observeThumbnailPending(thumb, sketch);
    }

    thumb.addEventListener("click", () => this.selectSketch(sketch));
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

    const lib = state.patternLibrary || {};
    const topRated = lib.topRated || [];
    const avoidPatterns = lib.avoid || [];
    if (this.els.patternLibraryList) {
      const rows = [
        ...topRated.map(p => `<li><strong>${this.esc(p.name)}</strong>
          <span class="memory-meta">avg ${p.averageRating} · uses ${p.uses}</span></li>`),
        ...avoidPatterns.map(p => `<li>${this.esc(p.name)}
          <span class="memory-meta">avoid · avg ${p.averageRating}</span></li>`)
      ];
      this.els.patternLibraryList.innerHTML = rows.length
        ? rows.join("")
        : `<li>${lib.patternCount || 20} patterns · ${lib.curriculumChapters || 60}+ LearnOpenGL chapters inform prompts — rate batches to rank shapes.</li>`;
    }

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

  ensureDetailRenderer() {
    if (this.detailRenderer) return;
    if (!this.els.detailCanvas) return;
    this.els.detailError.hidden = true;
    this.els.detailError.textContent = "";
    this.detailRenderer = new ShaderRenderer(this.els.detailCanvas, {
      errorEl: this.els.detailError,
      silent: true
    });
  }

  populateDetailProvenance(sketch) {
    if (!this.els.detailProvenance) return;
    const model = sketch.model || "(model not recorded)";
    const provider = sketch.provider || "unknown";
    const latency = sketch.inferenceLatencyMs != null ? `${sketch.inferenceLatencyMs} ms` : "(not recorded)";
    const usage = sketch.inferenceUsage || {};
    const totalTok = usage.totalTokens != null ? usage.totalTokens : "?";
    const promptTok = usage.promptTokens != null ? usage.promptTokens : "?";
    const completionTok = usage.completionTokens != null ? usage.completionTokens : "?";
    const ts = sketch.inferenceTimestamp || "(not recorded)";
    const dna = (sketch.dna || []).join(", ") || "(none)";
    const patterns = (sketch.patternIds || []).join(", ") || "(none)";
    this.els.detailProvenance.innerHTML = `
      <div class="prov-row">
        <span class="prov-label">Title</span><span class="prov-value">${this.esc(sketch.title || "Untitled")}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Type</span><span class="prov-value">${this.esc(sketch.type || "—")}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Generation</span><span class="prov-value">${this.esc(String(sketch.generation ?? "—"))}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">DNA</span><span class="prov-value">${this.esc(dna)}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Patterns</span><span class="prov-value">${this.esc(patterns)}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Provider · Model</span><span class="prov-value">${this.esc(provider)} · ${this.esc(model)}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Latency</span><span class="prov-value">${this.esc(latency)}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Tokens (total / prompt / completion)</span><span class="prov-value">${this.esc(String(totalTok))} / ${this.esc(String(promptTok))} / ${this.esc(String(completionTok))}</span>
      </div>
      <div class="prov-row">
        <span class="prov-label">Generated at</span><span class="prov-value">${this.esc(ts)}</span>
      </div>
      ${sketch.hypothesis ? `<div class="prov-row"><span class="prov-label">Hypothesis</span><span class="prov-value">${this.esc(sketch.hypothesis)}</span></div>` : ""}
    `;
  }

  selectSketch(sketch, { allowRerate = false } = {}) {
    const resolved = this.resolveSketch(sketch);
    if (!resolved?.glsl) {
      console.warn("selectSketch: no GLSL available", resolved);
      return;
    }

    this.detailSketch = resolved;
    this.detailListenId = (this.detailListenId || 0) + 1;
    const listenId = this.detailListenId;

    this.els.studioDetail.hidden = false;
    this.els.detailTitle.textContent = resolved.title || "Untitled";
    const score = this.ratingValue(resolved.rating);
    const ratingLabel = score ? ` · ${score}/5` : "";
    this.els.detailSub.textContent = `Gen ${resolved.generation} · ${resolved.type || "sketch"}${ratingLabel}`;

    this.els.detailCode.textContent = resolved.glsl || "";
    this.populateDetailProvenance(resolved);

    this.ensureDetailRenderer();
    if (this.detailRenderer) {
      this.detailRenderer.compileWhenReady(resolved.glsl);
    }

    if (window.PipelineViewer?.setSketch && this.els.detailPipelineStage) {
      if (!this.els.detailPipelinePanel) {
        this.els.detailPipelinePanel = document.createElement("aside");
        this.els.detailPipelinePanel.className = "pipeline-panel-inline";
        this.els.detailPipelinePanel.innerHTML = `
          <div class="pipeline-panel-head">
            <h3 data-pipeline-header>Layer</h3>
            <p class="pipeline-layer-hint">click a 3D box to see details</p>
          </div>
          <div class="pipeline-panel-body" data-pipeline-body></div>
        `;
        this.els.detailPipelineStage.parentNode.insertBefore(
          this.els.detailPipelinePanel,
          this.els.detailPipelineStage.nextSibling
        );
      }
      if (!this.pipelineViewerMounted) {
        window.PipelineViewer.openInline(
          resolved,
          this.els.detailPipelineStage,
          this.els.detailPipelinePanel
        );
        this.pipelineViewerMounted = true;
      } else {
        window.PipelineViewer.setSketch(resolved);
      }
    }

    if (this.sketchNeedsThumbnail(resolved) || this.thumbnailNeedsUpgrade(resolved)) {
      this.captureSketchThumbnail(resolved, { preferDetail: true })
        .then((thumb) => {
          if (thumb && this.detailListenId === listenId) {
            this.persistSketchThumbnail(resolved, thumb);
          }
        })
        .catch(() => {});
    }

    requestAnimationFrame(() => {
      this.els.studioDetail?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  closeDetailPane() {
    this.els.studioDetail.hidden = true;
    this.detailSketch = null;
    if (window.PipelineViewer?.close) window.PipelineViewer.close();
  }

  ensureDialogLayout() { /* kept for compatibility — no-op in inline mode */ }

  showDialogPoster() {}
  hideDialogPoster() {}
  clearDialogPoster() {}

  openPipelineForCurrentDialog() {
    if (!this.detailSketch) return;
    const stage = this.els.detailPipelineStage;
    if (!stage) return;
    if (!this.pipelineViewerMounted && window.PipelineViewer?.openInline) {
      window.PipelineViewer.openInline(
        this.detailSketch,
        stage,
        this.els.detailPipelinePanel
      );
      this.pipelineViewerMounted = true;
    } else if (stage.hidden !== false) {
      this.els.studioDetail.hidden = false;
      if (window.PipelineViewer?.setSketch) window.PipelineViewer.setSketch(this.detailSketch);
    }
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