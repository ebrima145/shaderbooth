/*
 * renderer.js
 *
 * The one path the picture takes to the canvas.
 *
 * The camera arrives as a <video> element, which is uploaded to a texture once
 * per frame; from there the effect stack runs over it on the GPU and the last
 * pass is blitted to the canvas.
 *
 * Everything is rendered at the *camera's* own resolution and the canvas is
 * sized to match, with CSS doing the letterboxing into whatever space the page
 * has. That buys two things. Effects that work in pixel units - scanlines,
 * halftone cells, ASCII grids - stay a fixed size relative to the picture
 * instead of changing character every time the window is resized. And what
 * MediaRecorder captures off the canvas is then the picture that was made, at
 * the resolution it was made at, rather than a screenshot of the page.
 *
 * Each layer of the stack gets **its own pair** of buffers and swaps them
 * every frame: the layer reads the older one as `prev` and writes the newer
 * one. Two reasons the pair is not optional and the per-layer part is not
 * extravagant. Drawing into the buffer you are also sampling is undefined, so
 * one buffer per layer would not work at all. And `prev` means "what this
 * effect produced last time" - if two feedback effects in one stack shared a
 * history, each would be trailing on the other's output, which is not what
 * either of them is drawn to do.
 *
 * The buffers are keyed by the layer object rather than by its position, so
 * reordering or deleting layers carries each layer's history with it instead
 * of handing it to whoever inherits the slot.
 *
 * The last pass writes into a texture like all the others and a separate,
 * trivial blit pass puts that texture on the canvas. Letting the last layer
 * draw straight to the canvas would save one fullscreen pass and cost the top
 * layer its feedback history, which is the one place in the stack where
 * feedback is most likely to be wanted.
 */

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

const BLIT_VERT = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
    gl_Position = vec4(position, 0.0, 1.0);
    uv = position * 0.5 + 0.5;
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
out vec4 fragColor;
uniform sampler2D src;
void main() { fragColor = vec4(texture(src, uv).rgb, 1.0); }`;

class Surface {
  /** A texture and the framebuffer that draws into it. */
  constructor(gl, width, height) {
    this.gl = gl;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // texImage2D rather than texStorage2D: a texStorage texture is immutable
    // and allocated with a fixed level count, and generateMipmap on a
    // single-level immutable texture is an error. The mosaic effects need the
    // chain built on demand over whatever is feeding them, which can be any
    // of these.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, null);
    configure(gl);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                            gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  delete() {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}

/** Clamp and filter the bound texture the way every effect assumes. */
function configure(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

class LayerBuffer {
  /** The two surfaces one layer ping-pongs between. */
  constructor(gl, width, height) {
    this.pair = [new Surface(gl, width, height), new Surface(gl, width, height)];
    this.current = 0;
  }

  /** What this layer produced last frame - the `prev` sampler. */
  get previous() { return this.pair[this.current]; }
  get target() { return this.pair[1 - this.current]; }

  advance() { this.current = 1 - this.current; }

  delete() { for (const surface of this.pair) surface.delete(); }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // The recorder pulls frames off this canvas through captureStream(), and
      // a canvas whose drawing buffer is thrown away after every composite has
      // nothing to hand over on the frames the browser samples between draws.
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL 2 is not available in this browser.");
    this.gl = gl;

    this.mirror = true;   // cameras look wrong un-mirrored
    this.sourceSize = [0, 0];

    this._buffers = new Map();   // Layer -> LayerBuffer
    this._output = null;
    this._hasOutput = false;
    this._hasSource = false;

    // One quad, one VAO, shared by every program: the attribute is bound to
    // slot 0 at link time in effects.js precisely so this can be set up once.
    this._vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this._source = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._source);
    configure(gl);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this._blit = this._buildBlit();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    // The camera's first row is the top of the picture; leaving the unpack
    // flip off is what makes u_flip in the shared preamble the thing that
    // decides which way up the frame is read, on the first pass only.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  _buildBlit() {
    const gl = this.gl;
    const make = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error("blit shader: " + gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, BLIT_VERT));
    gl.attachShader(program, make(gl.FRAGMENT_SHADER, BLIT_FRAG));
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("blit program: " + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "src"), 0);
    gl.useProgram(null);
    return program;
  }

  // --- input ------------------------------------------------------------

  /**
   * Push a video frame onto the GPU. Returns true when the resolution changed,
   * which is main.js's cue to reseed the feedback buffers.
   */
  uploadVideo(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return false;

    const gl = this.gl;
    const resized = width !== this.sourceSize[0] || height !== this.sourceSize[1];
    if (resized) this._allocate(width, height);

    gl.bindTexture(gl.TEXTURE_2D, this._source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._hasSource = true;
    return resized;
  }

  get hasSource() { return this._hasSource; }
  get hasOutput() { return this._hasOutput && this._output !== null; }

  // --- allocation -------------------------------------------------------

  _allocate(width, height) {
    this._dropBuffers();
    this.sourceSize = [width, height];
    this.canvas.width = width;
    this.canvas.height = height;
    this._hasOutput = false;
    this._hasSource = false;
  }

  /** This layer's own pair of buffers, made on first use. */
  _bufferFor(layer) {
    let buffer = this._buffers.get(layer);
    if (!buffer) {
      buffer = new LayerBuffer(this.gl, this.sourceSize[0], this.sourceSize[1]);
      this._buffers.set(layer, buffer);
      this._wipe(buffer);
    }
    return buffer;
  }

  /** Free the buffers of layers that are no longer in the stack. */
  _prune(layers) {
    if (this._buffers.size === layers.length) return;
    const live = new Set(layers);
    for (const layer of [...this._buffers.keys()]) {
      if (!live.has(layer)) {
        this._buffers.get(layer).delete();
        this._buffers.delete(layer);
      }
    }
  }

  _dropBuffers() {
    for (const buffer of this._buffers.values()) buffer.delete();
    this._buffers.clear();
    this._output = null;
    this._hasOutput = false;
  }

  // --- the effect stack -------------------------------------------------

  /**
   * Run the stack: camera -> layer 1 -> layer 2 -> ... -> the canvas.
   *
   * Each layer reads what the one below it wrote, so `layers` is in
   * bottom-to-top order. `override` replaces every layer's effect for one
   * call, which is how the feedback buffers are seeded with the live picture
   * rather than with black.
   */
  render(layers, elapsed, override = null) {
    if (!this._hasSource || !layers.length) return;

    const gl = this.gl;
    const [width, height] = this.sourceSize;
    let incoming = this._source;
    let drew = false;

    gl.bindVertexArray(this._vao);

    for (const layer of layers) {
      const effect = override || layer.effect;
      // A layer that failed to compile is skipped rather than breaking the
      // stack: what came in passes through to the layer above it untouched.
      if (!effect || !effect.ok) continue;

      const buffer = this._bufferFor(layer);
      const target = buffer.target;

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, width, height);

      gl.useProgram(effect.program);
      const u = effect.uniforms;
      if (u.u_res) gl.uniform2f(u.u_res, width, height);
      if (u.u_time) gl.uniform1f(u.u_time, elapsed);
      if (u.u_amount) gl.uniform1f(u.u_amount, override ? 1.0 : layer.amount);
      // The mirror and the flip describe the incoming picture, so they apply
      // to the first pass only. By the second, the image in hand is already
      // the right way round and the right way up, and applying either again
      // would undo it.
      if (u.u_mirror) gl.uniform1f(u.u_mirror, this.mirror && !drew ? 1.0 : 0.0);
      if (u.u_flip) gl.uniform1f(u.u_flip, !drew ? 1.0 : 0.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, incoming);
      if (effect.mipmaps) this._buildMipmaps();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, buffer.previous.texture);
      gl.activeTexture(gl.TEXTURE0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (effect.mipmaps) this._dropMipmaps(incoming);

      buffer.advance();
      incoming = target.texture;
      this._output = target;
      drew = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (drew) this._hasOutput = true;
    this._prune(layers);
  }

  /**
   * Give the texture bound to unit 0 a mipmap chain, for this pass only.
   *
   * The mosaic effects read a whole cell of the picture as one colour, and a
   * mip level *is* that average - the alternative is dozens of taps per pixel
   * to compute what the hardware already has a path for. Every texture here is
   * otherwise plain LINEAR, so the chain is built on demand and the filter is
   * put back afterwards: it belongs to the effect asking for it, not to the
   * texture, which is a render target the rest of the time and whose levels
   * would be stale by the next frame anyway.
   */
  _buildMipmaps() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  _dropMipmaps(texture) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  // --- output -----------------------------------------------------------

  /** Put the last pass's texture on the canvas. */
  present() {
    const gl = this.gl;
    if (!this.hasOutput) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this._vao);
    gl.useProgram(this._blit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._output.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Wipe every layer's history. Called when the stack or the camera changes,
   * so trails left by a feedback effect don't bleed into whatever you switch
   * to.
   *
   * Pass a pass-through effect as `seed` to fill the buffers with the live
   * picture instead of black. Starting a feedback effect from black means it
   * has nothing to read for its first frames - slit-scan in particular spends
   * several seconds crawling out from a black screen - whereas starting from
   * the picture already in hand is instant.
   */
  clearFeedback(layers = [], seed = null) {
    for (const buffer of this._buffers.values()) this._wipe(buffer);
    if (seed && this._hasSource && layers.length) {
      // Twice: each pass writes one of the pair, so both end up holding the
      // frame and the swap lands back where it started.
      this.render(layers, 0.0, seed);
      this.render(layers, 0.0, seed);
    }
  }

  _wipe(buffer) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    for (const surface of buffer.pair) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, surface.fbo);
      gl.viewport(0, 0, this.sourceSize[0], this.sourceSize[1]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Blank everything - used when the camera stops. */
  clear() {
    this._hasSource = false;
    this._dropBuffers();
    this.present();
  }
}
