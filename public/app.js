import { ShaderRenderer } from "./shader-renderer.js";

// Global Application State Coordinator
class App {
  constructor() {
    this.activeTab = "generate";
    this.activeBatch = null; // Current generation sketches
    this.ratings = {}; // { [sketchId]: "good" | "bad" }
    this.renderers = []; // Live renderers in active workspace
    this.modalRenderer = null;
    this.timelineRenderers = {}; // { [sketchId]: ShaderRenderer }
    this.state = null; // Copy of backend state
    this.autopilotSyncing = false;
    this.lastSyncedBatchId = null;
    this.pollTimer = null;
    this.lastTimelineGen = -1;
    this.lastMindGen = -1;

    this.initDOMRefs();
    this.bindEvents();
    this.loadState();
    this.startAutopilotPolling();
  }

  // Cache essential DOM elements
  initDOMRefs() {
    // Navigation
    this.tabs = document.querySelectorAll(".nav-tab");
    this.views = document.querySelectorAll(".tab-content");

    // Liveness Header Stats
    this.lblDailyCount = document.getElementById("lblDailyCount");
    this.lblGenCount = document.getElementById("lblGenCount");
    this.lblSuccessRate = document.getElementById("lblSuccessRate");
    this.lblStreakDays = document.getElementById("lblStreakDays");
    this.pbJourney = document.getElementById("pbJourney");
    this.autopilotBanner = document.getElementById("autopilotBanner");
    this.autopilotStatusText = document.getElementById("autopilotStatusText");
    this.loaderTitle = document.getElementById("loaderTitle");
    this.loaderDesc = document.getElementById("loaderDesc");

    // Generate Workspace Elements
    this.lblCurrentStrategy = document.getElementById("lblCurrentStrategy");
    this.lblCriticLog = document.getElementById("lblCriticLog");
    this.txtUserFocus = document.getElementById("txtUserFocus");
    this.frmGenerate = document.getElementById("frmGenerate");
    this.lblActiveGen = document.getElementById("lblActiveGen");
    this.btnSubmitGenerate = document.getElementById("btnSubmitGenerate");
    this.btnSubmitFeedback = document.getElementById("btnSubmitFeedback");
    this.btnRemixBaseline = document.getElementById("btnRemixBaseline");

    this.workspaceLoader = document.getElementById("workspaceLoader");
    this.workspaceEmpty = document.getElementById("workspaceEmpty");
    this.shaderGrid = document.getElementById("shaderGrid");

    // Timeline Elements
    this.timelineContainer = document.getElementById("timelineContainer");

    // Mind Elements
    this.lblMindSketches = document.getElementById("lblMindSketches");
    this.lblMindGenerations = document.getElementById("lblMindGenerations");
    this.lblMindAccuracy = document.getElementById("lblMindAccuracy");
    this.lblHeuristicsList = document.getElementById("lblHeuristicsList");
    this.terminalReflectionConsole = document.getElementById("terminalReflectionConsole");
    this.btnExplainEvolution = document.getElementById("btnExplainEvolution");
    this.narrativeOutputBox = document.getElementById("narrativeOutputBox");
    this.narrativePlaceholder = document.getElementById("narrativePlaceholder");
    this.narrativeTextContainer = document.getElementById("narrativeTextContainer");
    this.narrativeText = document.getElementById("narrativeText");

    // Modal elements
    this.fullscreenModal = document.getElementById("fullscreenModal");
    this.modalCanvas = document.getElementById("modalCanvas");
    this.modalClose = document.getElementById("modalClose");
    this.modalGenTag = document.getElementById("modalGenTag");
    this.modalTitle = document.getElementById("modalTitle");
    this.modalDnaTags = document.getElementById("modalDnaTags");
    this.modalStatement = document.getElementById("modalStatement");
    this.modalCodeView = document.getElementById("modalCodeView");
    this.btnCopyShader = document.getElementById("btnCopyShader");

    // Toast
    this.appToast = document.getElementById("appToast");
  }

  // Bind UI interactive event listeners
  bindEvents() {
    // Tab Toggling
    this.tabs.forEach(btn => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        this.switchTab(targetTab);
      });
    });

    // Form Generate Batch Submission
    this.frmGenerate.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.generateBatch();
    });

    // Feedback Submission
    this.btnSubmitFeedback.addEventListener("click", async () => {
      await this.submitFeedback();
    });

    // Reset Baseline
    this.btnRemixBaseline.addEventListener("click", () => {
      if (confirm("Are you sure you want to reset the agent's artistic strategy baseline? Your history will be preserved but the prompt strategy restarts.")) {
        this.resetBaseline();
      }
    });

    // Narrative Speech Trigger
    if (this.btnExplainEvolution) {
      this.btnExplainEvolution.addEventListener("click", () => {
        this.explainEvolution();
      });
    }

    // Modal Close
    this.modalClose.addEventListener("click", () => {
      this.closeModal();
    });

    // Click outside modal content to close
    this.fullscreenModal.addEventListener("click", (e) => {
      if (e.target === this.fullscreenModal) {
        this.closeModal();
      }
    });

    // Copy Shader code in modal
    this.btnCopyShader.addEventListener("click", () => {
      navigator.clipboard.writeText(this.modalCodeView.textContent);
      this.showToast("Shader code copied!");
    });
  }

  // Tab View Routing Swapper
  switchTab(tabId) {
    this.activeTab = tabId;
    
    // Toggle navigation button styles
    this.tabs.forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });

    // Toggle view visibility
    this.views.forEach(view => {
      const isTarget = view.id === `view${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`;
      view.classList.toggle("active", isTarget);
      if (isTarget) {
        // Trigger tab specific entry animations or content loaders
        if (tabId === "timeline") {
          this.loadTimeline();
        } else if (tabId === "mind") {
          this.loadMind();
        }
      }
    });

    // Pause offscreen renderers to optimize performance
    if (tabId !== "generate") {
      this.renderers.forEach(r => r.stop());
    } else if (this.activeBatch) {
      this.renderers.forEach(r => r.start());
    }

    // Stop timeline renderers when leaving the timeline tab
    if (tabId !== "timeline") {
      Object.values(this.timelineRenderers).forEach(r => r.stop());
    }
  }

  // Fetch state on startup or update
  async loadState() {
    try {
      const res = await fetch("/api/state");
      const data = await res.json();
      this.state = data;
      this.updateLivenessWidgets(data);
    } catch (err) {
      console.error("Error loading application state:", err);
    }
  }

  // Update Left Panel liveness metrics and progress
  updateLivenessWidgets(data) {
    // Stat strings
    this.lblDailyCount.textContent = `${data.totalSketches} / 3,650`;
    this.lblGenCount.textContent = data.generationCount;
    this.lblSuccessRate.textContent = `${data.successRate}%`;
    this.lblStreakDays.textContent = `${data.streakDays || 0} day${(data.streakDays || 0) === 1 ? "" : "s"}`;
    this.lblActiveGen.textContent = `#${data.generationCount}`;

    // Strategy panels
    this.lblCurrentStrategy.textContent = data.currentStrategy;
    
    // Grab latest self reflection log
    if (data.strategyTimeline && data.strategyTimeline.length > 0) {
      const latest = data.strategyTimeline[data.strategyTimeline.length - 1];
      this.lblCriticLog.textContent = latest.notes || "Awaiting your evaluations to self-improve.";
    }

    // Progress bar towards Zach's 3650 sketching everyday goal (10 year goal)
    const ratio = Math.min((data.totalSketches / 3650) * 100, 100);
    this.pbJourney.style.width = `${ratio}%`;
  }

  startAutopilotPolling() {
    this.pollAutopilot();
    this.pollTimer = setInterval(() => this.pollAutopilot(), 3000);
  }

  async pollAutopilot() {
    try {
      const [statusRes, stateRes] = await Promise.all([
        fetch("/api/autopilot/status"),
        fetch("/api/state")
      ]);

      const status = await statusRes.json();
      const state = await stateRes.json();
      this.state = state;
      this.updateLivenessWidgets(state);
      this.updateAutopilotBanner(status);

      const activePhases = ["generating", "curating", "evolving", "waiting"];
      if (activePhases.includes(status.phase) && !this.activeBatch) {
        this.showAutopilotLoader(status.phase);
      }

      if (status.currentBatch && status.currentBatch.length > 0) {
        const batchKey = status.currentBatch.map(s => s.id).join(",");
        if (batchKey !== this.lastSyncedBatchId) {
          this.lastSyncedBatchId = batchKey;
          this.autopilotSyncing = true;
          this.activeBatch = status.currentBatch;
          this.syncAutopilotRatings(status.currentBatch);
          this.renderBatchGrid(status.currentBatch, true);
          this.workspaceLoader.classList.add("hidden");
          this.workspaceEmpty.classList.add("hidden");
          this.autopilotSyncing = false;
        } else if (status.phase === "idle" && this.shaderGrid.classList.contains("hidden")) {
          this.renderBatchGrid(status.currentBatch, true);
          this.workspaceLoader.classList.add("hidden");
          this.workspaceEmpty.classList.add("hidden");
        }
      }

      if (this.activeTab === "timeline" && state.generationCount !== this.lastTimelineGen) {
        this.lastTimelineGen = state.generationCount;
        this.loadTimeline();
      } else if (this.activeTab === "mind" && state.generationCount !== this.lastMindGen) {
        this.lastMindGen = state.generationCount;
        this.loadMind();
      }
    } catch (err) {
      console.error("Autopilot poll error:", err);
    }
  }

  updateAutopilotBanner(status) {
    const phaseLabels = {
      idle: "Autonomous mode active — studio self-curates and evolves",
      generating: "Generating batch of 10 via Google Gemini...",
      curating: "Autonomous aesthetic curation in progress...",
      evolving: "Evolving strategy genome from curation feedback...",
      waiting: "Resting between autonomous cycles...",
      error: `Autopilot error: ${status.lastError || "unknown"} — retrying...`
    };

    const label = phaseLabels[status.phase] || "Autonomous mode active";
    const cycles = status.cyclesCompleted > 0 ? ` · ${status.cyclesCompleted} cycles` : "";
    this.autopilotStatusText.textContent = `${label}${cycles}`;
    this.autopilotBanner.classList.toggle("is-error", status.phase === "error");
    this.autopilotBanner.classList.toggle("is-busy", ["generating", "curating", "evolving"].includes(status.phase));
  }

  showAutopilotLoader(phase) {
    this.workspaceEmpty.classList.add("hidden");
    this.shaderGrid.classList.add("hidden");
    this.workspaceLoader.classList.remove("hidden");

    const titles = {
      generating: "ShaderMind is generating via Gemini...",
      curating: "ShaderMind is curating aesthetics...",
      evolving: "ShaderMind is evolving its genome...",
      waiting: "ShaderMind is resting between cycles..."
    };

    this.loaderTitle.textContent = titles[phase] || "ShaderMind is working...";
    this.loaderDesc.textContent = "No input required — the autonomous loop generates, rates, and evolves strategy continuously.";
  }

  syncAutopilotRatings(sketches) {
    this.ratings = {};
    sketches.forEach(s => {
      if (s.rating) {
        this.ratings[s.id] = s.rating;
      }
    });
  }

  // Trigger POST /api/generate (optional manual override)
  async generateBatch() {
    const focus = this.txtUserFocus.value.trim() || "Something organic and flowy";
    
    // Clear any previous active WebGL loops
    this.clearWorkspaceRenderers();

    // Toggle loader states
    this.workspaceEmpty.classList.add("hidden");
    this.shaderGrid.classList.add("hidden");
    this.workspaceLoader.classList.remove("hidden");
    this.btnSubmitGenerate.disabled = true;
    this.btnSubmitFeedback.disabled = true;
    this.ratings = {};

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus })
      });

      if (!response.ok) {
        const errDetails = await response.json();
        throw new Error(errDetails.error || "Batch generation failed.");
      }

      const result = await response.json();
      this.activeBatch = result.sketches;
      this.renderBatchGrid(result.sketches);
    } catch (err) {
      alert(`ShaderMind generation error: ${err.message}`);
      this.workspaceEmpty.classList.remove("hidden");
    } finally {
      this.workspaceLoader.classList.add("hidden");
      this.btnSubmitGenerate.disabled = false;
    }
  }

  // Clear workspace animation rendering loops to free GPU memory
  clearWorkspaceRenderers() {
    this.renderers.forEach(r => r.stop());
    this.renderers = [];
  }

  typeLabel(type) {
    const labels = {
      evolutionary: "EVO",
      directive: "DIR",
      mutation: "MUT"
    };
    return labels[type] || "ART";
  }

  // Render the 10 generated shaders into the Workspace panel grid
  renderBatchGrid(sketches, fromAutopilot = false) {
    this.clearWorkspaceRenderers();
    this.shaderGrid.innerHTML = "";
    this.shaderGrid.classList.remove("hidden");

    if (sketches.length > 0) {
      this.lblActiveGen.textContent = `#${sketches[0].generation}`;
    }

    sketches.forEach(sketch => {
      // 1. Create outer card wrapper
      const card = document.createElement("div");
      card.className = "shader-card";
      card.id = `card-${sketch.id}`;

      // 2. WebGL canvas wrapper
      const canvasWrapper = document.createElement("div");
      canvasWrapper.className = "canvas-wrapper";

      const canvas = document.createElement("canvas");
      canvas.id = `canvas-${sketch.id}`;
      canvasWrapper.appendChild(canvas);

      // Embedded error boundary overlay inside card
      const errOverlay = document.createElement("div");
      errOverlay.className = "shader-error-overlay";
      canvasWrapper.appendChild(errOverlay);

      // Poetic statement hover overlay
      const hoverOverlay = document.createElement("div");
      hoverOverlay.className = "statement-overlay";
      hoverOverlay.innerHTML = `
        <span class="tag">SELF-EVALUATION</span>
        <p class="overlay-desc">${sketch.poetic_statement}</p>
      `;
      canvasWrapper.appendChild(hoverOverlay);
      card.appendChild(canvasWrapper);

      // 3. Card detail section (Info & Rate controls)
      const details = document.createElement("div");
      details.className = "shader-card-details";
      
      const info = document.createElement("div");
      info.className = "sketch-info";
      const hypothesisBlock = sketch.type === "mutation" && sketch.hypothesis
        ? `<p class="hypothesis-line" title="${sketch.hypothesis}">↳ ${sketch.hypothesis}</p>`
        : sketch.hypothesis
          ? `<p class="hypothesis-line muted-hypothesis">${sketch.hypothesis}</p>`
          : "";

      info.innerHTML = `
        <div class="sketch-title-row">
          <h4>${sketch.title}</h4>
          <span class="type-badge type-${sketch.type}">${this.typeLabel(sketch.type)}</span>
        </div>
        ${hypothesisBlock}
        <div class="flex-row gap-xs margin-t-xs">
          ${(Array.isArray(sketch.dna) ? sketch.dna : []).slice(0, 3).map(tag => `<span class="badge" style="font-size: 8px; border:none; background: rgba(255,255,255,0.03); color: var(--muted); padding: 1px 4px;">#${tag}</span>`).join("")}
        </div>
      `;
      details.appendChild(info);

      // Feedback button controls
      const feedback = document.createElement("div");
      feedback.className = "feedback-actions";
      
      const btnGood = document.createElement("button");
      btnGood.className = "btn-rate rate-good";
      btnGood.textContent = "✓ Good";
      btnGood.addEventListener("click", () => this.rateSketch(sketch.id, "good"));

      const btnBad = document.createElement("button");
      btnBad.className = "btn-rate rate-bad";
      btnBad.textContent = "✗ Bad";
      btnBad.addEventListener("click", () => this.rateSketch(sketch.id, "bad"));

      feedback.appendChild(btnGood);
      feedback.appendChild(btnBad);
      details.appendChild(feedback);
      card.appendChild(details);

      // Append card to DOM Grid
      this.shaderGrid.appendChild(card);

      if (fromAutopilot && sketch.rating) {
        card.classList.add(sketch.rating === "good" ? "is-good" : "is-bad");
      }

      // 4. Compile GLSL and drive WebGL engine
      const renderer = new ShaderRenderer(canvas);
      this.renderers.push(renderer);
      renderer.compile(sketch.glsl);

      // Fullscreen interactive modal trigger on canvas click
      canvasWrapper.addEventListener("click", (e) => {
        // Prevent click if hovering buttons or clicking modal close
        if (e.target.tagName !== "BUTTON" && !e.target.closest(".feedback-actions")) {
          this.openModal(sketch);
        }
      });
    });

    this.btnSubmitFeedback.disabled = fromAutopilot;
  }

  // Handle Good/Bad card selection
  rateSketch(sketchId, rating) {
    const card = document.getElementById(`card-${sketchId}`);
    
    // Toggle selection visual states
    if (rating === "good") {
      card.classList.remove("is-bad");
      card.classList.add("is-good");
      this.ratings[sketchId] = "good";
    } else {
      card.classList.remove("is-good");
      card.classList.add("is-bad");
      this.ratings[sketchId] = "bad";
    }

    // Enable feedback submission since user has rated at least one sketch
    this.btnSubmitFeedback.disabled = false;
  }

  // Submit batch ratings to backend & trigger self-reflection
  async submitFeedback() {
    const gen = this.activeBatch && this.activeBatch.length > 0 ? this.activeBatch[0].generation : null;
    if (!gen) return;

    // Fill in default "bad" rating for unrated sketches in the batch
    this.activeBatch.forEach(sketch => {
      if (!this.ratings[sketch.id]) {
        this.ratings[sketch.id] = "bad";
      }
    });

    this.btnSubmitFeedback.disabled = true;
    this.btnSubmitFeedback.textContent = "Evolving Strategy...";

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation: gen,
          ratings: this.ratings,
          userOpinion: this.txtUserFocus.value.trim(),
          newSketches: this.activeBatch
        })
      });

      const result = await res.json();
      if (result.success) {
        this.showToast("Artistic strategy evolved successfully!");
        
        // Reset generate workspace empty state, clear loops
        this.clearWorkspaceRenderers();
        this.shaderGrid.classList.add("hidden");
        this.workspaceEmpty.classList.remove("hidden");
        this.activeBatch = null;
        this.ratings = {};
        this.txtUserFocus.value = "";

        // Reload fresh state with mutated Strategy & Internal critic log
        await this.loadState();
      }
    } catch (err) {
      alert("Error evolving strategy: " + err.message);
      this.btnSubmitFeedback.disabled = false;
    } finally {
      this.btnSubmitFeedback.textContent = "Submit Feedback & Evolve Genome ⤳";
    }
  }

  // Reset Strategy Baseline
  async resetBaseline() {
    try {
      await fetch("/api/reset-baseline", { method: "POST" });
      await this.loadState();
      this.showToast("Strategy baseline reset. History preserved.");
    } catch (err) {
      alert("Reset failed: " + err.message);
    }
  }

  // Chronological journey vertical scroll timeline loader
  async loadTimeline() {
    // Clear and stop existing timeline renderers to preserve GPU context
    Object.values(this.timelineRenderers).forEach(r => r.stop());
    this.timelineRenderers = {};

    this.timelineContainer.innerHTML = "";

    try {
      // Load current state to get strategy timeline and sketches
      await this.loadState();
      const res = await fetch("/api/sketches");
      const sketches = await res.json();

      const timelineData = this.state.strategyTimeline || [];

      if (timelineData.length === 0) {
        this.timelineContainer.innerHTML = `<p class="muted">Awaiting your first batch curated results to generate the timeline...</p>`;
        return;
      }

      // 1. Build the active user-driven generations
      // Sort in reverse order (newest on top) to represent a chronological feed
      const activeTimeline = [...timelineData].reverse();

      activeTimeline.forEach((t, index) => {
        const milestone = document.createElement("div");
        milestone.className = "timeline-milestone";
        milestone.style.setProperty("--delay", index * 0.1);

        const dot = document.createElement("div");
        dot.className = "milestone-dot";
        milestone.appendChild(dot);

        const card = document.createElement("div");
        card.className = "milestone-card";

        const header = document.createElement("div");
        header.className = "milestone-card-header";
        header.innerHTML = `
          <h3 class="milestone-title">Generation #${t.generation} — Strategy Evolution</h3>
          <span class="milestone-time">${new Date(t.timestamp).toLocaleString()}</span>
        `;
        card.appendChild(header);

        if (t.strategy) {
          const notes = document.createElement("p");
          notes.className = "milestone-notes";
          notes.textContent = `"${t.notes || "System self-adaptation node."}"`;
          card.appendChild(notes);

          const strategy = document.createElement("div");
          strategy.className = "panel-desc font-mono";
          strategy.style.fontSize = "11px";
          strategy.style.background = "rgba(0,0,0,0.2)";
          strategy.style.padding = "10px";
          strategy.style.borderRadius = "6px";
          strategy.style.color = "var(--accent)";
          strategy.style.border = "1px solid rgba(111,224,237,0.04)";
          strategy.textContent = `Evolving Prompt Rules: ${t.strategy}`;
          card.appendChild(strategy);
        }

        // Filter good sketches for this generation
        const goodSketches = sketches.filter(s => s.generation === t.generation && s.rating === "good");

        const gridHeader = document.createElement("h4");
        gridHeader.style.fontSize = "12px";
        gridHeader.style.fontWeight = "700";
        gridHeader.style.color = "var(--ink)";
        gridHeader.style.marginTop = "10px";
        gridHeader.textContent = "Aesthetic Masterpieces Voted Good:";
        card.appendChild(gridHeader);

        if (goodSketches.length > 0) {
          const grid = document.createElement("div");
          grid.className = "milestone-sketches-grid";

          goodSketches.forEach(sketch => {
            const item = document.createElement("div");
            item.className = "milestone-sketch-item";

            const canvasWrapper = document.createElement("div");
            canvasWrapper.className = "canvas-wrapper";

            const canvas = document.createElement("canvas");
            canvas.id = `timeline-canvas-${sketch.id}`;
            canvasWrapper.appendChild(canvas);

            // Statement hover
            const hoverOverlay = document.createElement("div");
            hoverOverlay.className = "statement-overlay";
            hoverOverlay.innerHTML = `
              <span class="tag">SELF-EVALUATION</span>
              <p class="overlay-desc" style="font-size: 10px;">${sketch.poetic_statement}</p>
            `;
            canvasWrapper.appendChild(hoverOverlay);
            item.appendChild(canvasWrapper);

            const details = document.createElement("div");
            details.className = "sketch-info";
            details.innerHTML = `
              <h4>${sketch.title}</h4>
              <div class="flex-row gap-xs" style="margin-top: 4px;">
                ${sketch.dna.slice(0, 2).map(tag => `<span class="badge" style="font-size: 8px; border:none; background: rgba(255,255,255,0.03); color: var(--muted); padding: 1px 4px;">#${tag}</span>`).join("")}
              </div>
            `;
            item.appendChild(details);
            grid.appendChild(item);

            // Hover compiling loop logic
            let renderer = null;
            canvasWrapper.addEventListener("mouseenter", () => {
              if (!renderer) {
                renderer = new ShaderRenderer(canvas);
                this.timelineRenderers[sketch.id] = renderer;
                renderer.compile(sketch.glsl);
              } else {
                renderer.start();
              }
            });

            canvasWrapper.addEventListener("mouseleave", () => {
              if (renderer) renderer.stop();
            });

            canvasWrapper.addEventListener("click", () => {
              this.openModal(sketch);
            });
          });

          card.appendChild(grid);
        } else {
          const emptyText = document.createElement("p");
          emptyText.className = "panel-desc";
          emptyText.style.fontStyle = "italic";
          emptyText.style.color = "var(--muted)";
          emptyText.style.marginTop = "6px";
          emptyText.textContent = "No sketches in this generation were curated as 'Good'. The agent's feedback system triggered complete coordinate restructuring to search for your aesthetic bounds.";
          card.appendChild(emptyText);
        }

        milestone.appendChild(card);
        this.timelineContainer.appendChild(milestone);
      });

    } catch (err) {
      console.error("Error drawing Artistic Journey Timeline Scroll:", err);
    }
  }

  // Load and populate the heuristics matrix and command line logs inside The Mind
  async loadMind() {
    await this.loadState();
    const data = this.state;
    if (!data) return;

    // Populate core stats header inside The Mind view
    this.lblMindSketches.textContent = data.totalSketches;
    this.lblMindGenerations.textContent = data.generationCount;
    this.lblMindAccuracy.textContent = `${data.successRate}%`;

    // Populate Active Heuristics
    this.lblHeuristicsList.innerHTML = "";
    const heuristics = data.heuristics || [];
    if (heuristics.length > 0) {
      heuristics.forEach(h => {
        const item = document.createElement("div");
        item.className = "heuristic-item";
        item.innerHTML = `
          <span class="heuristic-glyph">✦</span>
          <div>${h}</div>
        `;
        this.lblHeuristicsList.appendChild(item);
      });
    } else {
      this.lblHeuristicsList.innerHTML = `
        <p class="muted" style="padding: 10px 0;">No active math heuristics extracted yet.</p>
        <p class="panel-desc">Generate a batch of sketches in <strong>The Studio</strong>, rate successful formulas 'Good', and submit ratings to trigger deep heuristics analysis.</p>
      `;
    }

    // Populate Self-Reflection Terminal Log Console
    this.terminalReflectionConsole.innerHTML = `
      <div class="terminal-line system-line">[SYS] Connection successful. Fetching neural log stream...</div>
      <div class="terminal-line text-accent">[OK] Total recorded history nodes: ${data.strategyTimeline.length}</div>
    `;

    if (data.strategyTimeline && data.strategyTimeline.length > 0) {
      data.strategyTimeline.forEach(t => {
        const sysLine = document.createElement("div");
        sysLine.className = "terminal-line system-line";
        sysLine.textContent = `[SYS-GEN-${t.generation}] Strategy Optimization recorded on ${new Date(t.timestamp).toLocaleDateString()}:`;
        this.terminalReflectionConsole.appendChild(sysLine);

        const stratLine = document.createElement("div");
        stratLine.className = "terminal-line text-accent";
        stratLine.textContent = `> Genome: ${t.strategy}`;
        this.terminalReflectionConsole.appendChild(stratLine);

        const noteLine = document.createElement("div");
        noteLine.className = "terminal-line";
        noteLine.style.color = "var(--accent-warm)";
        noteLine.textContent = `[ANALYSIS] "${t.notes || "No analysis details."}"`;
        this.terminalReflectionConsole.appendChild(noteLine);
      });
    }

    // Auto scroll terminal console to the very bottom
    this.terminalReflectionConsole.scrollTop = this.terminalReflectionConsole.scrollHeight;
  }

  // Synthesis and stream character-by-character or word-by-word typing narrative of artistic evolution
  async explainEvolution() {
    this.btnExplainEvolution.disabled = true;
    this.btnExplainEvolution.textContent = "🧠 Synthesizing...";

    // Hide placeholder and clear target narrative
    this.narrativePlaceholder.classList.add("hidden");
    this.narrativeTextContainer.classList.remove("hidden");
    this.narrativeText.textContent = "";

    try {
      const response = await fetch("/api/narrative");
      if (!response.ok) {
        throw new Error("Failed to compile narrative monologue.");
      }
      const data = await response.json();
      const monologue = data.monologue || "I have no speech synthesized.";

      this.btnExplainEvolution.textContent = "🎙 Streaming Monologue...";

      // Word-by-word streaming typography animation to preserve UI thread
      const words = monologue.split(" ");
      let wordIndex = 0;

      const typeWord = () => {
        if (wordIndex < words.length) {
          this.narrativeText.textContent += (wordIndex === 0 ? "" : " ") + words[wordIndex];
          wordIndex++;
          // auto scroll the monologue box to keep typing point in view
          this.narrativeOutputBox.scrollTop = this.narrativeOutputBox.scrollHeight;
          setTimeout(typeWord, 45); // perfectly paced, smooth reading flow
        } else {
          // Typing complete
          this.btnExplainEvolution.disabled = false;
          this.btnExplainEvolution.textContent = "🧠 Explain Evolution";
          this.showToast("Artistic speech streamed fully!");
        }
      };

      typeWord();

    } catch (err) {
      this.narrativePlaceholder.classList.remove("hidden");
      this.narrativePlaceholder.textContent = `Matrix Connection Failure: ${err.message}`;
      this.btnExplainEvolution.disabled = false;
      this.btnExplainEvolution.textContent = "🧠 Explain Evolution";
    }
  }

  // Fullscreen interactive popup modal open
  openModal(sketch) {
    this.fullscreenModal.classList.add("active");
    
    // Clear and build high resolution modal renderer
    if (this.modalRenderer) {
      this.modalRenderer.stop();
      this.modalRenderer = null;
    }

    this.modalGenTag.textContent = `GENERATION #${sketch.generation} · ${this.typeLabel(sketch.type)}`;
    this.modalTitle.textContent = sketch.title;
    const hypothesisNote = sketch.hypothesis ? `\n\nHypothesis: ${sketch.hypothesis}` : "";
    this.modalStatement.textContent = sketch.poetic_statement + hypothesisNote;
    this.modalCodeView.textContent = sketch.glsl;

    // DNA Badges list
    this.modalDnaTags.innerHTML = "";
    (Array.isArray(sketch.dna) ? sketch.dna : []).forEach(tag => {
      const tagBadge = document.createElement("span");
      tagBadge.className = "tag";
      tagBadge.textContent = `#${tag}`;
      this.modalDnaTags.appendChild(tagBadge);
    });

    // Set WebGL viewport compile
    const canvas = this.modalCanvas;
    this.modalRenderer = new ShaderRenderer(canvas);
    this.modalRenderer.compile(sketch.glsl);
  }

  // Fullscreen interactive popup modal close
  closeModal() {
    this.fullscreenModal.classList.remove("active");
    if (this.modalRenderer) {
      this.modalRenderer.stop();
      this.modalRenderer = null;
    }
  }

  // Show customized action toast notifications
  showToast(message) {
    this.appToast.textContent = message;
    this.appToast.classList.add("show");
    setTimeout(() => {
      this.appToast.classList.remove("show");
    }, 2000);
  }
}

// Instantiate single page application on DOM complete
document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
});
