#version 300 es

// Prepended to every effect, so an effect file is only ever its main().
// Everything below is the vocabulary the effects are written in.
//
// This is the WebGL 2 / GLSL ES 3.00 twin of the desktop player's preamble.
// The two are deliberately kept line-for-line equivalent below the header, so
// an effect written for one compiles unchanged on the other and the .frag
// files can be copied between the projects without edits.
//
// GLSL ES has no default precision for anything in a fragment shader, so the
// three declarations below are mandatory rather than tuning. sampler2D in
// particular defaults to lowp when left alone, which would quantise every
// texture read to roughly 8 bits of headroom and visibly band the effects
// that accumulate taps - bloom, bokeh, kuwahara, the feedback family.

precision highp float;
precision highp int;
precision highp sampler2D;

in  vec2 uv;          // 0..1 across the output, y up
out vec4 fragColor;

uniform sampler2D src;      // the live camera frame
uniform sampler2D prev;     // last frame's output, for feedback effects
uniform vec2      u_res;    // output size in pixels
uniform float     u_time;   // seconds since start; frozen while paused
uniform float     u_amount; // effect intensity, 0..1
uniform float     u_mirror; // 1.0 when the picture is mirrored
uniform float     u_flip;   // 1.0 when the source stores its rows top-down

const float TAU = 6.28318530718;

vec2 texel() { return 1.0 / u_res; }

// The camera texture comes from a <video> element, whose first row is the top
// of the picture, while a GL texture coordinate of 0 is the bottom - so the
// first pass has to read it upside down to put it the right way up. By the
// second pass the picture in hand is already a render target that agrees with
// GL, so the flip is a uniform the renderer clears rather than a constant.
// The horizontal mirror lives here too, which is why effects should always go
// through source() rather than sampling the sampler directly: sample it
// yourself and the mirror and the flip both silently stop applying to that
// one effect.
vec2 srcuv(vec2 p) {
    return vec2(mix(p.x, 1.0 - p.x, u_mirror), mix(p.y, 1.0 - p.y, u_flip));
}

vec3 source(vec2 p) {
    return texture(src, clamp(srcuv(p), 0.0, 1.0)).rgb;
}

// The name the effect files were written against, kept so an effect reads the
// same whether it was written for the camera or for anything else.
vec2 camuv(vec2 p)   { return srcuv(p); }
vec3 camera(vec2 p)  { return source(p); }

// The same read, from a chosen mip level. Effects that average a whole cell
// of the picture - the mosaic and stipple families - get that average for
// free from the mipmap chain instead of taking sixty-four taps by hand. The
// renderer builds the chain for the effects that ask for it; ask for a level
// without that and you simply get level 0.
vec3 sourceLod(vec2 p, float lod) {
    return textureLod(src, clamp(srcuv(p), 0.0, 1.0), lod).rgb;
}

vec3 feedback(vec2 p) {
    return texture(prev, clamp(p, 0.0, 1.0)).rgb;
}

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise2(p);
        p *= 2.02;
        a *= 0.5;
    }
    return v;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}
