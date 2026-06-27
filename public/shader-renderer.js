/**
 * ShaderRenderer
 * Highly robust WebGL compiler and quad renderer for GLSL ES 1.0.
 * Injects u_time, u_resolution, and u_mouse uniforms.
 * Catches compilation errors and renders them visually in the canvas.
 */
export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    this.program = null;
    this.animationFrameId = null;
    this.startTime = Date.now();
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    this.targetMouseX = 0.5;
    this.targetMouseY = 0.5;
    this.error = null;
    this.isHovered = false;

    if (!this.gl) {
      this.error = "WebGL not supported by this browser.";
      this.drawErrorState(this.error);
      return;
    }

    this.initGeometry();
    this.setupMouseListeners();
  }

  initGeometry() {
    const gl = this.gl;
    
    // Simple 2D Quad (two triangles covering the viewport)
    const vertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  setupMouseListeners() {
    // Keep track of normalized mouse position inside canvas
    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.targetMouseX = (e.clientX - rect.left) / rect.width;
      this.targetMouseY = 1.0 - ((e.clientY - rect.top) / rect.height); // Flip Y to match WebGL Cartesian coordinates
    });

    this.canvas.addEventListener("mouseenter", () => {
      this.isHovered = true;
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.isHovered = false;
      this.targetMouseX = 0.5;
      this.targetMouseY = 0.5;
    });
  }

  // Baseline standard vertex shader
  getVertexShaderSource() {
    return `
      attribute vec2 position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = position * 0.5 + 0.5;
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
    if (!cleaned.includes("precision")) {
      cleaned = `precision mediump float;\n${cleaned}`;
    }
    return cleaned;
  }

  compile(fragmentShaderSource) {
    this.stop();
    this.error = null;

    const gl = this.gl;
    if (!gl) return false;

    const glslSource = this.sanitizeGlslSource(fragmentShaderSource);

    // Create shader program
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, this.getVertexShaderSource());
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, glslSource);

    if (!vertexShader || !fragmentShader) {
      this.drawErrorState(this.error || "Shader compilation failed.");
      return false;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.error = `Program Link Error: ${gl.getProgramInfoLog(program)}`;
      gl.deleteProgram(program);
      this.drawErrorState(this.error);
      return false;
    }

    this.program = program;
    
    // Clean up individual shaders as they are now linked
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    this.ensureCanvasSize();
    this.start();
    return true;
  }

  ensureCanvasSize() {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const w = Math.max(2, Math.floor(rect?.width || this.canvas.clientWidth || 300));
    const h = Math.max(2, Math.floor(rect?.height || this.canvas.clientHeight || 300));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.gl) this.gl.viewport(0, 0, w, h);
    }
  }

  compileWhenReady(fragmentShaderSource) {
    const source = this.sanitizeGlslSource(fragmentShaderSource);
    const attempt = () => this.compile(source);

    if (attempt()) return true;

    const parent = this.canvas.parentElement;
    if (!parent) return false;

    const observer = new ResizeObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(parent);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (attempt()) observer.disconnect();
      });
    });

    return false;
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeName = type === gl.VERTEX_SHADER ? "Vertex" : "Fragment";
      const infoLog = gl.getShaderInfoLog(shader) || gl.getProgramInfoLog(shader);
      const detail = (infoLog && infoLog.trim()) ? infoLog.trim() : "unknown error (no driver log)";
      this.error = `${typeName} shader failed: ${detail}`;
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  start() {
    this.startTime = Date.now();
    const renderLoop = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };
    this.animationFrameId = requestAnimationFrame(renderLoop);
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    // Handle mouse easing
    const easing = 0.1;
    this.mouseX += (this.targetMouseX - this.mouseX) * easing;
    this.mouseY += (this.targetMouseY - this.mouseY) * easing;

    this.ensureCanvasSize();
    const width = this.canvas.width;
    const height = this.canvas.height;

    gl.useProgram(this.program);

    // Bind buffer attributes
    const positionLocation = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set Uniforms
    const timeLocation = gl.getUniformLocation(this.program, "u_time");
    if (timeLocation !== null) {
      const elapsedSeconds = (Date.now() - this.startTime) / 1000.0;
      gl.uniform1f(timeLocation, elapsedSeconds);
    }

    const resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
    if (resolutionLocation !== null) {
      gl.uniform2f(resolutionLocation, this.canvas.width, this.canvas.height);
    }

    const mouseLocation = gl.getUniformLocation(this.program, "u_mouse");
    if (mouseLocation !== null) {
      gl.uniform2f(mouseLocation, this.mouseX, this.mouseY);
    }

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawErrorState(errorMessage) {
    this.stop();
    const gl = this.gl;
    if (!gl) return;

    // Renders a beautiful cyberpunk compilation fail error directly inside the canvas using 2D fallback or canvas clear colors
    console.error("WebGL Renderer Error boundary caught compiler crash:", errorMessage);

    // Simple visual error: Clear canvas to flat terminal warning red/black scanline color
    this.ensureCanvasSize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.04, 0.0, 0.0, 1.0); // very dark red
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Let's overlay an HTML error message in the parent card node!
    const container = this.canvas.parentElement;
    if (container) {
      const errOverlay = container.querySelector(".shader-error, .shader-error-overlay");
      if (errOverlay) {
        const short = errorMessage.length > 180 ? `${errorMessage.slice(0, 180)}…` : errorMessage;
        errOverlay.textContent = short.replace(/\n/g, " ");
        errOverlay.classList.add("active");
      }
    }
  }
}
