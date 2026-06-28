/**
 * One shared WebGL context renders all grid thumbnails.
 * Copies pixels via readPixels (Chrome-safe; drawImage from WebGL canvas is flaky).
 */
import { patchGlslForWebGL } from "./glsl-patch.js?v=10";

const MAX_PROGRAMS = 24;
const RENDER_SIZE = 512;

function sanitizeGlslSource(source) {
  if (typeof source !== "string") return "";
  let cleaned = source.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:glsl)?\s*/i, "").replace(/\s*```$/m, "");
  }
  cleaned = cleaned.replace(/\\n/g, "\n");
  cleaned = cleaned.replace(/\bout\s+vec4\s+FragColor\s*;/g, "");
  cleaned = cleaned.replace(/\bFragColor\s*=/g, "gl_FragColor =");
  cleaned = cleaned.replace(/\btexture\s*\(/g, "texture2D(");
  if (!/\bprecision\s+(lowp|mediump|highp)\s+float/.test(cleaned)) {
    if (/\bprecision\s+\w+\s+float/.test(cleaned)) {
      cleaned = cleaned.replace(/\bprecision\s+\w+\s+float\s*;/g, "precision mediump float;");
    } else {
      cleaned = `precision mediump float;\n${cleaned}`;
    }
  }
  return patchGlslForWebGL(cleaned);
}

class SharedGridRenderer {
  constructor() {
    this.offscreen = document.createElement("canvas");
    this.offscreen.width = RENDER_SIZE;
    this.offscreen.height = RENDER_SIZE;
    this.snapCanvas = document.createElement("canvas");
    this.snapCanvas.width = RENDER_SIZE;
    this.snapCanvas.height = RENDER_SIZE;
    this.snapCtx = this.snapCanvas.getContext("2d", { willReadFrequently: true });
    this.pixelScratch = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
    this.imageData = this.snapCtx.createImageData(RENDER_SIZE, RENDER_SIZE);

    this.gl = null;
    this.cells = new Map();
    this.programs = new Map();
    this.buffer = null;
    this.animationFrameId = null;
    this.startTime = Date.now();
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    this.initGl();
  }

  initGl() {
    this.gl =
      this.offscreen.getContext("webgl", {
        preserveDrawingBuffer: true,
        antialias: false,
        alpha: false
      }) ||
      this.offscreen.getContext("experimental-webgl", {
        preserveDrawingBuffer: true,
        antialias: false,
        alpha: false
      });

    this.programs.clear();
    this.buffer = null;

    if (this.gl) {
      this.initGeometry();
      if (!this.animationFrameId) this.start();
    } else {
      console.error("SharedGridRenderer: WebGL unavailable — enable hardware acceleration in Chrome.");
    }
  }

  initGeometry() {
    const gl = this.gl;
    if (!gl) return;

    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  getVertexShaderSource() {
    return `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
  }

  compileProgram(glsl) {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) {
      this.initGl();
      if (!this.gl) return { ok: false, error: "WebGL context unavailable." };
    }

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.getVertexShaderSource());
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(vs) || "Vertex shader failed.";
      gl.deleteShader(vs);
      return { ok: false, error };
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, sanitizeGlslSource(glsl));
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(fs) || "Fragment shader failed.";
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return { ok: false, error };
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return { ok: false, error: gl.getProgramInfoLog(program) || "Program link failed." };
    }

    return { ok: true, program };
  }

  ensureProgram(id, glsl) {
    const cleaned = sanitizeGlslSource(glsl);
    const cached = this.programs.get(id);
    if (cached?.source === cleaned && cached.program) return cached;

    if (cached?.program) {
      this.gl?.deleteProgram(cached.program);
    }

    const compiled = this.compileProgram(cleaned);
    const entry = {
      source: cleaned,
      program: compiled.ok ? compiled.program : null,
      error: compiled.ok ? null : compiled.error
    };
    this.programs.set(id, entry);

    if (this.programs.size > MAX_PROGRAMS) {
      const oldest = this.programs.keys().next().value;
      const old = this.programs.get(oldest);
      if (old?.program) this.gl?.deleteProgram(old.program);
      this.programs.delete(oldest);
    }

    return entry;
  }

  getCellSize(wrap) {
    if (!wrap) return 300;
    // padding-bottom square boxes: offsetWidth is reliable in Chrome
    return Math.max(2, Math.floor(wrap.offsetWidth || wrap.getBoundingClientRect().width || 300));
  }

  register(id, displayCanvas, glsl, onCompileResult = null) {
    const ctx2d = displayCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx2d) {
      console.error(`SharedGridRenderer: 2D context unavailable for ${id}`);
      return;
    }

    const entry = this.ensureProgram(id, glsl);
    if (onCompileResult) {
      onCompileResult({
        success: Boolean(entry.program),
        error: entry.error,
        reportedAt: new Date().toISOString()
      });
    }

    const cellEntry = {
      displayCanvas,
      glsl,
      ctx2d,
      errEl: displayCanvas.parentElement?.querySelector(".shader-error")
    };
    this.cells.set(id, cellEntry);

    const wrap = displayCanvas.parentElement;
    if (wrap) {
      const observer = new ResizeObserver(() => this.paintCell(id));
      observer.observe(wrap);
      cellEntry._resizeObserver = observer;
    }

    // Defer first paint until layout has dimensions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.paintCell(id));
    });
  }

  unregister(id) {
    const cellEntry = this.cells.get(id);
    if (cellEntry?._resizeObserver) {
      cellEntry._resizeObserver.disconnect();
    }
    this.cells.delete(id);
    const cached = this.programs.get(id);
    if (cached?.program) this.gl?.deleteProgram(cached.program);
    this.programs.delete(id);
  }

  clear() {
    for (const id of [...this.cells.keys()]) {
      this.unregister(id);
    }
  }

  clearByPrefix(prefix) {
    for (const id of [...this.cells.keys()]) {
      if (id.startsWith(prefix)) this.unregister(id);
    }
  }

  setMouse(x, y) {
    this.mouseX = x;
    this.mouseY = y;
  }

  blitGlToSnap() {
    const gl = this.gl;
    gl.readPixels(0, 0, RENDER_SIZE, RENDER_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, this.pixelScratch);

    const rowBytes = RENDER_SIZE * 4;
    for (let y = 0; y < RENDER_SIZE; y++) {
      const srcRow = (RENDER_SIZE - y - 1) * rowBytes;
      this.imageData.data.set(
        this.pixelScratch.subarray(srcRow, srcRow + rowBytes),
        y * rowBytes
      );
    }

    this.snapCtx.putImageData(this.imageData, 0, 0);
  }

  blitGlTo2d(ctx2d, w, h) {
    this.blitGlToSnap();
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.drawImage(this.snapCanvas, 0, 0, w, h);
  }

  hasCell(id) {
    return this.cells.has(id);
  }

  drawCellFrame(id, time, resolutionW, resolutionH) {
    const gl = this.gl;
    const cell = this.cells.get(id);
    if (!gl || !cell) return null;

    if (gl.isContextLost()) {
      this.initGl();
      if (!this.gl) return null;
    }

    const entry = this.ensureProgram(id, cell.glsl);
    if (!entry.program) return entry;

    gl.viewport(0, 0, RENDER_SIZE, RENDER_SIZE);
    gl.useProgram(entry.program);

    const positionLocation = gl.getAttribLocation(entry.program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(entry.program, "u_time");
    if (timeLoc !== null) gl.uniform1f(timeLoc, time);

    const resLoc = gl.getUniformLocation(entry.program, "u_resolution");
    if (resLoc !== null) gl.uniform2f(resLoc, resolutionW, resolutionH);

    const mouseLoc = gl.getUniformLocation(entry.program, "u_mouse");
    if (mouseLoc !== null) gl.uniform2f(mouseLoc, this.mouseX, this.mouseY);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return entry;
  }

  captureCellThumbnail(id, size = 96, time = 1.25, quality = 0.65) {
    const entry = this.drawCellFrame(id, time, RENDER_SIZE, RENDER_SIZE);
    if (!entry?.program) return null;

    try {
      this.blitGlToSnap();
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = size;
      thumbCanvas.height = size;
      const ctx = thumbCanvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(this.snapCanvas, 0, 0, size, size);
      const dataUrl = thumbCanvas.toDataURL("image/jpeg", quality);
      return dataUrl && dataUrl.length > 100 ? dataUrl : null;
    } catch (err) {
      console.warn("SharedGridRenderer: captureCellThumbnail failed", err);
      return null;
    }
  }

  paintCell(id) {
    const gl = this.gl;
    const cell = this.cells.get(id);
    if (!cell) return;

    if (!gl || gl.isContextLost()) {
      this.initGl();
      if (!this.gl) return;
    }

    const wrap = cell.displayCanvas.parentElement;
    const size = this.getCellSize(wrap);
    const w = size;
    const h = size;

    if (cell.displayCanvas.width !== w || cell.displayCanvas.height !== h) {
      cell.displayCanvas.width = w;
      cell.displayCanvas.height = h;
    }

    const ctx2d = cell.ctx2d;
    const time = (Date.now() - this.startTime) / 1000;
    const entry = this.drawCellFrame(id, time, w, h);

    if (cell.errEl) {
      if (entry?.error) {
        cell.errEl.textContent = `Fragment Shader Compile Error:\n${entry.error}`;
        cell.errEl.classList.add("active");
      } else {
        cell.errEl.textContent = "";
        cell.errEl.classList.remove("active");
      }
    }

    if (!entry?.program) {
      ctx2d.fillStyle = "#1a0808";
      ctx2d.fillRect(0, 0, w, h);
      return;
    }

    this.blitGlTo2d(ctx2d, w, h);
  }

  start() {
    const loop = () => {
      for (const id of this.cells.keys()) {
        this.paintCell(id);
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /** Pause rendering and release WebGL so the dialog can claim a context. */
  suspend() {
    this.stop();
    if (!this.gl) return;

    const gl = this.gl;
    for (const entry of this.programs.values()) {
      if (entry?.program) gl.deleteProgram(entry.program);
    }
    this.programs.clear();

    if (this.buffer) {
      gl.deleteBuffer(this.buffer);
      this.buffer = null;
    }

    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    this.gl = null;
  }

  /** Re-acquire WebGL after the dialog closes and repaint registered cells. */
  resume() {
    if (!this.gl) this.initGl();
    if (!this.gl) return;

    if (this.cells.size && !this.animationFrameId) this.start();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const id of this.cells.keys()) this.paintCell(id);
      });
    });
  }
}

let instance = null;

export function getSharedGridRenderer() {
  if (!instance) instance = new SharedGridRenderer();
  return instance;
}

// Eager init after DOM is ready (module may load before layout exists)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => getSharedGridRenderer());
} else {
  getSharedGridRenderer();
}
