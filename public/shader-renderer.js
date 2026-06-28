import { patchGlslForWebGL } from "./glsl-patch.js?v=9";
import { acquireWebGLSlot } from "./webgl-queue.js?v=9";

/**
 * ShaderRenderer — WebGL 1.0 quad renderer for GLSL ES fragment shaders.
 */
export class ShaderRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.errorEl = options.errorEl || null;
    this.loadingEl = options.loadingEl || null;
    this.hintEl = options.hintEl || null;
    this.onCompileResult = options.onCompileResult || null;
    this.compileResultReported = false;
    this.gl = null;
    this.releaseSlot = null;
    this.program = null;
    this.buffer = null;
    this.positionLocation = -1;
    this.animationFrameId = null;
    this.startTime = Date.now();
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    this.targetMouseX = 0.5;
    this.targetMouseY = 0.5;
    this.error = null;
    this.resizeObserver = null;
    this.compileGeneration = 0;
    this.releasingContext = false;
    this.onContextLost = null;
    this.setupMouseListeners();
  }

  setupMouseListeners() {
    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0) return;
      this.targetMouseX = (e.clientX - rect.left) / rect.width;
      this.targetMouseY = 1.0 - (e.clientY - rect.top) / rect.height;
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.targetMouseX = 0.5;
      this.targetMouseY = 0.5;
    });
  }

  getVertexShaderSource() {
    return `
      precision mediump float;
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
  }

  sanitizeGlslSource(source) {
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

  ensureCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { width: w, height: h };
  }

  isLayoutReady() {
    const rect = this.canvas.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }

  async ensureGL() {
    if (this.gl) return true;

    if (!this.releaseSlot) {
      this.releaseSlot = await acquireWebGLSlot();
    }

    const gl =
      this.canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false
      }) ||
      this.canvas.getContext("experimental-webgl", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true
      });

    if (!gl) {
      this.error = "WebGL unavailable (too many contexts or not supported).";
      this.showError(this.error);
      return false;
    }

    this.gl = gl;
    this.onContextLost = (e) => {
      e.preventDefault();
      this.stop();
      if (this.releasingContext) return;
      this.error = "WebGL context lost.";
      this.showError(this.error);
    };
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);

    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    return true;
  }

  async compile(fragmentShaderSource) {
    this.stop();
    this.error = null;
    this.hideError();

    if (!this.isLayoutReady()) {
      this.error = this.error || "Canvas not ready (zero size).";
      return false;
    }

    const gen = ++this.compileGeneration;
    const hasGL = await this.ensureGL();
    if (!hasGL || gen !== this.compileGeneration) return false;

    const gl = this.gl;
    const { width, height } = this.ensureCanvasSize();
    if (width < 4 || height < 4) return false;

    const glslSource = this.sanitizeGlslSource(fragmentShaderSource);
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, this.getVertexShaderSource());
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, glslSource);

    if (!vertexShader || !fragmentShader) {
      this.showError(this.error || "Shader compilation failed.");
      this.reportCompileResult(false);
      return false;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.error = `Link error: ${gl.getProgramInfoLog(program) || "unknown"}`;
      gl.deleteProgram(program);
      this.showError(this.error);
      return false;
    }

    if (this.program) gl.deleteProgram(this.program);
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "position");

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.render();
    this.start();
    this.setUiState("running");
    this.reportCompileResult(true);
    return true;
  }

  bindUi({ errorEl, loadingEl, hintEl } = {}) {
    if (errorEl !== undefined) this.errorEl = errorEl;
    if (loadingEl !== undefined) this.loadingEl = loadingEl;
    if (hintEl !== undefined) this.hintEl = hintEl;
  }

  setUiState(state) {
    if (this.loadingEl) this.loadingEl.hidden = state !== "loading";
    if (this.hintEl) this.hintEl.hidden = state !== "running";
    if (this.errorEl) this.errorEl.hidden = state !== "error";
  }

  relayout() {
    if (!this.gl || !this.program) return;
    const { width, height } = this.ensureCanvasSize();
    this.gl.viewport(0, 0, width, height);
    this.render();
  }

  compileWhenReady(fragmentShaderSource) {
    const source = fragmentShaderSource;
    let attempts = 0;
    const maxAttempts = 60;
    this.compileResultReported = false;
    this.setUiState("loading");

    const tryCompile = async () => {
      attempts += 1;
      if (await this.compile(source)) {
        this.disconnectResizeObserver();
        return true;
      }
      if (attempts >= maxAttempts) {
        this.reportCompileResult(false);
      }
      return false;
    };

    const poll = async () => {
      if (await tryCompile()) return;
      if (attempts < maxAttempts) {
        requestAnimationFrame(() => poll());
      } else {
        this.showError(this.error || "Shader failed to compile.");
      }
    };

    tryCompile().then((ok) => {
      if (ok) return;
      this.disconnectResizeObserver();
      const parent = this.canvas.parentElement;
      if (parent && typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          tryCompile().then((success) => {
            if (success) this.disconnectResizeObserver();
          });
        });
        this.resizeObserver.observe(parent);
      }
      requestAnimationFrame(() => requestAnimationFrame(poll));
    });

    return false;
  }

  disconnectResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  reportCompileResult(success) {
    if (!this.onCompileResult || this.compileResultReported) return;
    this.compileResultReported = true;
    this.onCompileResult({
      success,
      error: success ? null : (this.error || "Shader compilation failed."),
      reportedAt: new Date().toISOString()
    });
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeName = type === gl.VERTEX_SHADER ? "Vertex" : "Fragment";
      const log = gl.getShaderInfoLog(shader);
      this.error = `${typeName} shader: ${(log && log.trim()) || "compile failed"}`;
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  start() {
    this.startTime = Date.now();
    const loop = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  destroy() {
    this.stop();
    this.disconnectResizeObserver();
    this.compileGeneration += 1;
    this.releasingContext = true;

    if (this.gl) {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      const ext = this.gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
      this.gl = null;
      this.program = null;
      this.buffer = null;
    }

    if (this.onContextLost) {
      this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      this.onContextLost = null;
    }

    if (this.releaseSlot) {
      this.releaseSlot();
      this.releaseSlot = null;
    }
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    const { width, height } = this.ensureCanvasSize();
    if (width < 2 || height < 2) return;

    const easing = 0.1;
    this.mouseX += (this.targetMouseX - this.mouseX) * easing;
    this.mouseY += (this.targetMouseY - this.mouseY) * easing;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    const posLoc = this.positionLocation;
    if (posLoc === -1) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const tLoc = gl.getUniformLocation(this.program, "u_time");
    if (tLoc !== null) {
      gl.uniform1f(tLoc, (Date.now() - this.startTime) / 1000.0);
    }

    const rLoc = gl.getUniformLocation(this.program, "u_resolution");
    if (rLoc !== null) {
      gl.uniform2f(rLoc, width, height);
    }

    const mLoc = gl.getUniformLocation(this.program, "u_mouse");
    if (mLoc !== null) {
      gl.uniform2f(mLoc, this.mouseX, this.mouseY);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  showError(message) {
    if (this.releasingContext) return;
    console.warn("ShaderRenderer:", message);
    this.setUiState("error");
    const short = message.length > 400 ? `${message.slice(0, 400)}…` : message;
    const text = short.replace(/\n/g, " ");

    if (this.errorEl) {
      this.errorEl.textContent = text;
      this.errorEl.hidden = false;
    } else {
      const container = this.canvas.parentElement;
      const errEl = container?.querySelector(".shader-error");
      if (errEl) {
        errEl.textContent = text;
        errEl.classList.add("active");
      }
    }

    if (this.gl) {
      const { width, height } = this.ensureCanvasSize();
      this.gl.viewport(0, 0, width, height);
      this.gl.clearColor(0.06, 0.02, 0.02, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  hideError() {
    if (this.errorEl) {
      this.errorEl.hidden = true;
      this.errorEl.textContent = "";
    } else {
      const container = this.canvas.parentElement;
      const errEl = container?.querySelector(".shader-error");
      if (errEl) {
        errEl.classList.remove("active");
        errEl.textContent = "";
      }
    }
  }

  isRunning() {
    return Boolean(this.program && this.animationFrameId);
  }

  needsCompile() {
    return !this.program && !this.error;
  }

  captureThumbnail(size = 64, time = 1.25, quality = 0.55) {
    const gl = this.gl;
    if (!gl || !this.program || !this.buffer) return null;

    try {
      const wasAnimating = Boolean(this.animationFrameId);
      this.stop();

      const prevW = this.canvas.width;
      const prevH = this.canvas.height;
      this.canvas.width = size;
      this.canvas.height = size;

      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);

      const posLoc = this.positionLocation;
      if (posLoc === -1) return null;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const tLoc = gl.getUniformLocation(this.program, "u_time");
      if (tLoc !== null) gl.uniform1f(tLoc, time);

      const rLoc = gl.getUniformLocation(this.program, "u_resolution");
      if (rLoc !== null) gl.uniform2f(rLoc, size, size);

      const mLoc = gl.getUniformLocation(this.program, "u_mouse");
      if (mLoc !== null) gl.uniform2f(mLoc, 0.5, 0.5);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      const dataUrl = this.canvas.toDataURL("image/jpeg", quality);

      this.canvas.width = prevW;
      this.canvas.height = prevH;

      if (wasAnimating) {
        this.start();
      } else if (prevW > 0 && prevH > 0) {
        this.render();
      }

      return dataUrl && dataUrl.length > 100 ? dataUrl : null;
    } catch (err) {
      console.warn("ShaderRenderer: captureThumbnail failed", err);
      return null;
    }
  }
}