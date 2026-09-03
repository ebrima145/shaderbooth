/*
 * effects.js
 *
 * The effect catalogue and its GLSL compiler.
 *
 * Every effect is one fragment shader in shaders/. Each is compiled against a
 * shared preamble (shaders/_common.glsl) that declares the uniforms and the
 * helper vocabulary - source(), feedback(), luma(), fbm(), the HSV pair - so
 * an effect file only ever contains its main(). Adding an effect is therefore
 * a new .frag file plus one line in CATALOGUE, and nothing else.
 *
 * Compilation is eager but forgiving: a shader that fails to build is logged
 * to the console and left in the list greyed out rather than taking the app
 * down with it, so a typo in one effect doesn't cost you the other
 * thirty-three.
 *
 * The sources are fetched at startup unless SHADER_SOURCES is already on the
 * global - which is what build.mjs leaves behind when it inlines everything
 * into a single distributable HTML file. Same catalogue either way.
 */

// [display name, shader file, default intensity, needs mipmaps?], grouped
// into the headings the drop-down shows. Order here is the order in the list.
//
// The fourth field is for effects that read the picture through sourceLod():
// the mosaic family averages a whole cell at a time and gets that average from
// the mipmap chain rather than from sixty-four taps. Only the effects that ask
// for it pay for the chain being built - see Renderer.render().
export const CATALOGUE = [
  ["Basic", [
    ["None", "none.frag", 1.00],
    ["Grayscale", "grayscale.frag", 1.00],
    ["Sepia", "sepia.frag", 1.00],
    ["Invert", "invert.frag", 1.00],
    ["Posterize", "posterize.frag", 0.70],
    ["Noir", "noir.frag", 0.75],
    ["Thermal", "thermal.frag", 1.00],
  ]],
  ["Retro & Analog", [
    ["VHS", "vhs.frag", 0.70],
    ["Super 8", "super8.frag", 0.70],
    ["CRT Monitor", "crt.frag", 0.80],
    ["Chromatic Aberration", "chroma.frag", 0.60],
    ["Film Grain", "grain.frag", 0.70],
    ["Game Boy", "gameboy.frag", 0.60],
    ["Rolling Shutter", "rolling.frag", 0.60],
  ]],
  ["Light & Optics", [
    ["Bloom", "bloom.frag", 0.70],
    ["Bokeh", "bokeh.frag", 0.60],
    ["Tilt-Shift", "tiltshift.frag", 0.70],
    ["Frosted Glass", "frosted.frag", 0.65],
  ]],
  ["Generative & Feedback", [
    ["Echo Trails", "echo.frag", 0.80],
    ["Kaleidoscope", "kaleido.frag", 0.45],
    ["Plasma Field", "plasma.frag", 0.80],
    ["Warp Field", "warp.frag", 0.55],
    ["Slit-Scan", "slitscan.frag", 0.40],
    ["Ripple", "ripple.frag", 0.60],
    ["Grid Spin", "gridspin.frag", 0.55],
  ]],
  ["Edge & Abstraction", [
    ["Edge Glow", "edge.frag", 0.85],
    ["ASCII", "ascii.frag", 0.90],
    ["Halftone", "halftone.frag", 0.85],
    ["Dither", "dither.frag", 0.55],
    ["Pixel Smear", "smear.frag", 0.60],
    ["Kuwahara", "kuwahara.frag", 0.50],
    ["Quadtree", "quadtree.frag", 0.60, true],
    ["Mondrian", "mondrian.frag", 0.60, true],
    ["Stipple", "stipple.frag", 0.70, true],
  ]],
];

/*
 * The effects that cost enough per pixel to be worth warning about.
 *
 * Bokeh takes 128 taps per pixel, Kuwahara up to ~196, Frosted Glass 20. On a
 * desktop GPU that is a rounding error; on a phone it is the difference
 * between sixty frames and eight, because a tile-based mobile GPU is paying
 * for every one of those texture reads out of a much smaller memory budget.
 *
 * Marked rather than hidden or capped. The whole app is a box of expensive
 * toys and the answer to "this one is slow" is to know before you pick it,
 * not to have it quietly removed from the list.
 */
export const HEAVY = new Set(["Bokeh", "Kuwahara", "Frosted Glass"]);

// Uniforms the renderer sets every frame. An effect that doesn't mention one
// gets it optimised out by the driver, so every location lookup can come back
// null and every write has to be guarded.
export const FRAME_UNIFORMS = ["u_res", "u_time", "u_amount", "u_mirror", "u_flip"];

export class Effect {
  constructor(name, filename, amount, mipmaps = false) {
    this.name = name;
    this.filename = filename;
    this.defaultAmount = amount;
    // The last strength this effect ran at, anywhere. Picking it again - in
    // this layer or another - starts from here rather than from the default.
    this.amount = amount;
    // Reads its input through sourceLod(), so the renderer has to build a
    // mipmap chain for whatever is feeding this pass.
    this.mipmaps = mipmaps;
    this.program = null;
    this.uniforms = {};   // name -> WebGLUniformLocation | null
    this.error = null;
  }

  get ok() { return this.program !== null; }
}

function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(label + ": " + log);
  }
  return shader;
}

function linkProgram(gl, vert, frag) {
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  // Fixed attribute slot, so one shared quad VAO serves every program.
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

/**
 * Fetch every shader source, or take them from globalThis.SHADER_SOURCES if a
 * single-file build has already inlined them.
 *
 * Fetched in parallel: thirty-six sequential round trips over a slow link is a
 * visible pause on a page whose whole job is to start showing a picture.
 */
export async function loadShaderSources(dir = "shaders") {
  if (globalThis.SHADER_SOURCES) return globalThis.SHADER_SOURCES;

  const names = ["_common.glsl", "_quad.vert"];
  for (const [, entries] of CATALOGUE) for (const entry of entries) names.push(entry[1]);

  const sources = {};
  await Promise.all(names.map(async (name) => {
    const response = await fetch(dir + "/" + name, { cache: "no-cache" });
    if (!response.ok) throw new Error(name + ": HTTP " + response.status);
    sources[name] = await response.text();
  }));
  return sources;
}

export class EffectLibrary {
  /** Compiles every effect in CATALOGUE and keeps them ready to draw. */
  constructor(gl, sources) {
    this.gl = gl;
    this.effects = [];
    this.groups = [];        // [[heading, [Effect, ...]], ...]

    this._common = sources["_common.glsl"];
    // Errors from the driver are numbered against the concatenated string, so
    // knowing how much of it is preamble is what makes them usable.
    this._preambleLines = this._common.split("\n").length + 1;
    this._vert = compileShader(gl, gl.VERTEX_SHADER, sources["_quad.vert"], "_quad.vert");

    for (const [heading, entries] of CATALOGUE) {
      const built = [];
      for (const entry of entries) {
        const effect = new Effect(entry[0], entry[1], entry[2],
                                  entry.length > 3 && !!entry[3]);
        this._compile(effect, sources[entry[1]]);
        built.push(effect);
        this.effects.push(effect);
      }
      this.groups.push([heading, built]);
    }

    const broken = this.effects.filter((e) => !e.ok);
    if (broken.length) {
      console.warn("[effects] " + broken.length + " of " + this.effects.length
        + " failed to compile: " + broken.map((e) => e.name).join(", "));
    }
  }

  _compile(effect, body) {
    const gl = this.gl;
    if (body === undefined) {
      effect.error = "cannot read " + effect.filename;
      console.error("[effects] " + effect.name + ": " + effect.error);
      return;
    }

    // "#line 1 0" makes the driver number errors from the top of the effect
    // file rather than from the top of the concatenated preamble. GLSL ES
    // wants the source-string number after the line number; desktop GLSL,
    // where the same trick is spelled "#line 1", does not.
    const source = this._common + "\n#line 1 0\n" + body;

    let frag = null;
    try {
      frag = compileShader(gl, gl.FRAGMENT_SHADER, source, effect.filename);
      effect.program = linkProgram(gl, this._vert, frag);
    } catch (exc) {
      effect.error = String(exc.message || exc);
      console.error("[effects] " + effect.name + " (" + effect.filename + ") failed to"
        + " compile.\n          Line numbers below are relative to the effect file"
        + " (the shared preamble adds " + this._preambleLines + ").\n" + effect.error);
      return;
    } finally {
      // The program keeps its own reference once linked; the shader object is
      // ours to drop either way.
      if (frag) gl.deleteShader(frag);
    }

    for (const name of FRAME_UNIFORMS.concat(["src", "prev"])) {
      effect.uniforms[name] = gl.getUniformLocation(effect.program, name);
    }

    // Texture units are fixed for the life of the program: the source frame
    // on 0, the previous output on 1.
    gl.useProgram(effect.program);
    if (effect.uniforms.src) gl.uniform1i(effect.uniforms.src, 0);
    if (effect.uniforms.prev) gl.uniform1i(effect.uniforms.prev, 1);
    gl.useProgram(null);
  }

  byName(name) {
    return this.effects.find((e) => e.name === name) || null;
  }

  firstWorking() {
    return this.effects.find((e) => e.ok) || null;
  }
}
