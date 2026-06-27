/**
 * ShaderRenderer — WebGL 1.0 quad renderer for GLSL ES fragment shaders.
 * Injects u_time, u_resolution, u_mouse uniforms.
 */
export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true
    }) || canvas.getContext("experimental-webgl");
    this.program = null;
    this.positionLocation = -1;
    this.animationFrameId = null;
    this.startTime = Date.now();
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    this.targetMouseX = 0.5;
    this.targetMouseY = 0.5;
    this.error = null;
    this.resizeObserver = null;

    if (!this.gl) {
      this.error = "WebGL not supported.";
      this.showError(this.error);
      return;
    }

    this.initGeometry();
    this.setupMouseListeners();
  }

  initGeometry() {
    const gl = this.gl;
    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
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
      cleaned = `precision mediump float;\n${cleaned}`;
    }
    return cleaned;
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
    return rect.width >= 48 && rect.height >= 48;
  }

  compile(fragmentShaderSource) {
    this.stop();
    this.error = null;
    this.hideError();

    const gl = this.gl;
    if (!gl) return false;

    if (!this.isLayoutReady()) {
      return false;
    }

    const { width, height } = this.ensureCanvasSize();
    if (width < 48 || height < 48) return false;

    const glslSource = this.sanitizeGlslSource(fragmentShaderSource);
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, this.getVertexShaderSource());
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, glslSource);

    if (!vertexShader || !fragmentShader) {
      this.showError(this.error || "Shader compilation failed.");
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

    if (this.program) {
      gl.deleteProgram(this.program);
    }
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "position");

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.start();
    return true;
  }

  compileWhenReady(fragmentShaderSource) {
    const source = this.sanitizeGlslSource(fragmentShaderSource);
    let attempts = 0;
    const maxAttempts = 30;

    const tryCompile = () => {
      attempts += 1;
      if (this.compile(source)) {
        this.disconnectResizeObserver();
        return true;
      }
      return false;
    };

    if (tryCompile()) return true;

    this.disconnectResizeObserver();
    const parent = this.canvas.parentElement;
    if (parent && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (tryCompile()) this.disconnectResizeObserver();
      });
      this.resizeObserver.observe(parent);
    }

    const poll = () => {
      if (tryCompile()) return;
      if (attempts < maxAttempts) {
        requestAnimationFrame(poll);
      } else {
        this.showError(this.error || "Shader failed to compile.");
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(poll));

    return false;
  }

  disconnectResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
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
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
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
    if (posLoc < 0) return;

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
    console.error("ShaderRenderer:", message);
    const container = this.canvas.parentElement;
    if (!container) return;
    const errEl = container.querySelector(".shader-error");
    if (errEl) {
      const short = message.length > 200 ? `${message.slice(0, 200)}…` : message;
      errEl.textContent = short.replace(/\n/g, " ");
      errEl.classList.add("active");
    }
    const gl = this.gl;
    if (gl) {
      const { width, height } = this.ensureCanvasSize();
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.06, 0.02, 0.02, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  hideError() {
    const container = this.canvas.parentElement;
    const errEl = container?.querySelector(".shader-error");
    if (errEl) {
      errEl.classList.remove("active");
      errEl.textContent = "";
    }
  }
}