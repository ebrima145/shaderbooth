# Camera Player (web) — the long version

The short version is [README.md](README.md): what it is, how to run it, how to
host it, the keys, and the handful of gotchas that otherwise cost an evening.
This is everything else.

## Contents

- [What it does](#what-it-does)
- [The idea: the desktop stack, minus the desktop](#the-idea-the-desktop-stack-minus-the-desktop)
- [The camera](#the-camera)
- [The control bar](#the-control-bar)
- [Effects](#effects)
- [Stacking effects](#stacking-effects)
- [Looks as links](#looks-as-links)
- [Recording](#recording)
- [Writing your own effect](#writing-your-own-effect)
- [Project structure](#project-structure)
- [How a frame gets to the screen](#how-a-frame-gets-to-the-screen)
- [The single-file build](#the-single-file-build)
- [The dev server](#the-dev-server)
- [Decisions worth keeping](#decisions-worth-keeping)
- [Troubleshooting](#troubleshooting)

---

## What it does

Opens a camera through `getUserMedia`, uploads each frame to a WebGL 2
texture, runs it through an ordered stack of up to six fragment-shader passes,
and puts the result on a canvas sized to the camera's own resolution. The
canvas is what `MediaRecorder` records and what `toBlob` saves.

Thirty-four effects, in five groups. Six layers. One intensity per layer. No
network traffic after the page loads.

## The idea: the desktop stack, minus the desktop

The desktop [Universal Player](../Universal%20Player) exists to put three
kinds of picture — media files, cameras, Spout senders — through one shared
effect stack. Two thirds of that is Windows-specific: libmpv for files, Spout
for GPU texture sharing between applications. The camera third is not. A
browser has had a camera API for a decade and a shader pipeline for longer,
and the effects were written against a vocabulary (`source()`, `feedback()`,
`u_amount`) that says nothing about where the picture came from.

So this is not a rewrite of the effects. It is the same `.frag` files with a
different preamble in front of them and a different host underneath. The
things worth carrying over came over intact — the per-layer feedback buffers,
the mirror-and-flip-on-the-first-pass rule, the pass-through-is-a-real-effect
rule, the mipmap trick for the mosaic family — because each of them was a bug
first and a decision second, and re-earning them would have cost the same
evenings twice.

What is genuinely different is everything around the picture: permissions,
device enumeration, recording, and distribution. Those are the parts of this
project with their own reasoning below.

## The camera

`navigator.mediaDevices.getUserMedia({video: {...}, audio: false})`, into a
hidden `<video>`, which is uploaded to a texture once per animation frame.

Three things about the browser's camera API are worth knowing, because all
three look like bugs the first time.

**A secure context is required.** `getUserMedia` does not exist on an insecure
origin. `https://` and `http://localhost` are secure; a plain `http://`
address on your LAN and a `file://` path are not. The failure surfaces as a
`NotAllowedError`, the same exception you get when someone clicks Block — so
`camera.js` checks `window.isSecureContext` before deciding which of those two
entirely different problems to describe. Getting that message right is worth
more than it looks: "permission was refused" sends people to their browser
settings to fix something that is not there.

**Device labels are withheld until permission has been granted at least
once.** Before that, `enumerateDevices()` returns the right *number* of
cameras with empty names. There is no way to show a meaningful picker first,
which is why the app opens the default camera and fills the list afterwards
rather than asking you to choose between "camera 1" and "camera 2".

**`deviceId`s are per-origin and die with site data.** A saved id is a hint,
not a handle, so it is requested as `{ideal: id}` rather than `{exact: id}`
and a stale one quietly falls back to the default camera instead of failing.

The resolution drop-down is the same kind of request. `{ideal: 1920}` on a
camera that tops out at 640×480 gets you 640×480; `{exact: 1920}` gets you an
`OverconstrainedError` and no picture at all. The readout shows what was
actually granted, which is frequently not what was asked for.

**Nothing needs a capture thread.** The desktop player runs OpenCV's blocking
`read()` on a worker because calling it from the UI clock would stall the
whole window for up to a frame interval. Here the `<video>` element is
decoding on its own and reading it is a texture upload, so the render loop has
nothing in it that can block.

## The control bar

Two rows, in the glossy Windows-Media-Player blue.

The top row is transport and stack. Play starts and stops the camera —
stopping it genuinely releases the device, so the browser's camera indicator
goes out. Previous and next walk the attached cameras. The mirror button is on
by default, because an un-mirrored camera looks wrong to the person in front
of it and right to everyone else, and the person in front of it is the one
using the app.

Then record, snapshot, and the readout — resolution and frame rate normally, a
running clock while recording, and a short confirmation when a file is saved.

On the right, the stack: a row of tabs, bottom layer first, each carrying its
position and the name of the effect in it. A layer still holding the
pass-through is greyed and italic, so an unfilled slot reads as unfilled. The
number is not decoration — it is the `1`–`6` key that selects that layer. `+`
inserts a layer *above* the active one — the active layer is what you were just
looking at, so that is where the next one belongs — `−` deletes it, and the two
arrows move it through the stack.

The title bar carries the whole chain as one line, untruncated, which is what
the tab strip cannot do once six long names are in it.

The bottom row is the four selectors: camera, size, effect, amount.

## Effects

Intensity — the Amount slider, or the `-` / `+` keys — means something
different in each effect. It is wired to whatever knob actually matters for
that one, not to a blend against the original: it is Posterize's level count,
VHS's tape wear, Kaleidoscope's segment count. Each effect remembers its own
value, and `0` puts it back to the default.

### Basic

| Effect | What it does |
|---|---|
| None | Straight through — the reference picture |
| Grayscale | Luminance-weighted desaturation |
| Sepia | Toned monochrome, warm |
| Invert | Photographic negative |
| Posterize | Quantises each channel; intensity drives the level count down |
| Noir | High-contrast black and white with a heavy vignette |
| Thermal | False-colour heat map |

### Retro & Analog

| Effect | What it does |
|---|---|
| VHS | Head jitter, a crawling tracking band, and chroma smeared sideways |
| Super 8 | The whole pushed-Super-8 package: gate weave, dust, halation, heavy grain |
| CRT Monitor | Curved glass, phosphor stripe mask, scanlines, rolling refresh bar |
| Chromatic Aberration | Lens colour fringing that grows towards the corners |
| Film Grain | Mid-tone-weighted emulsion grain, warm print bias, vignette |
| Game Boy | Chunky pixels and the four DMG greens, with an ordered dither |
| Rolling Shutter | CMOS readout skew — rows shear along a travelling wave |

### Light & Optics

| Effect | What it does |
|---|---|
| Bloom | Highlights bleed light into what surrounds them |
| Bokeh | Every bright point becomes a hard-edged aperture disc, with rim, colour fringe and the same dust in each |
| Tilt-Shift | A sharp band across the middle, defocused above and below |
| Frosted Glass | The picture read through textured glass |

### Generative & Feedback

| Effect | What it does |
|---|---|
| Echo Trails | Video feedback; trails spiral outward and drift in hue as they age |
| Kaleidoscope | Mirrors a rotating wedge of the frame into N segments |
| Plasma Field | A demoscene plasma whose brightness you drive by moving |
| Warp Field | A drifting noise field displaces where each pixel reads from |
| Slit-Scan | Only the centre row is live; the rest is a record of time |
| Ripple | Rings spreading from the middle, the picture refracted through the surface |
| Grid Spin | The frame cut into blocks that twist on their own axes, around a spot that wanders |

### Edge & Abstraction

| Effect | What it does |
|---|---|
| Edge Glow | Sobel edges glowing, hue taken from the source colour |
| ASCII | Nine procedurally-drawn glyphs, chosen per cell by brightness |
| Halftone | Print dots on a 15-degree screen angle |
| Dither | 8x8 Bayer ordered dither down towards one bit per channel |
| Pixel Smear | Highlights drag downward frame after frame into long runs |
| Kuwahara | Painterly flattening — each pixel takes the mean of its most uniform neighbourhood |
| Quadtree | The frame split recursively wherever there is detail, each cell its own average colour |
| Mondrian | Recursive rectangles, filled with the primaries of whatever they cover |
| Stipple | Ink dots on a jittered grid, denser where the picture is dark |

The last three read the picture through `sourceLod()` and need a mipmap chain;
see [How a frame gets to the screen](#how-a-frame-gets-to-the-screen).

## Stacking effects

A layer is one full pass over the whole frame: it reads what the layer below
it produced and writes what the layer above it will read. The stack runs
bottom-to-top, from tab `1` on the left.

Order is not a detail — it is most of the expressive range. Halftone over Edge
Glow prints the edges as dots; Edge Glow over Halftone finds the outline of
the dots. Which is why the strip can reorder (`,` and `.`) rather than only
add and remove.

**Per-layer intensity.** Each layer carries its own amount rather than reading
it off the effect, so the same effect can appear twice in one stack at
different strengths. The effect object still remembers the last value it was
given, and that is what a layer starts from when you pick it: dialling VHS
back to 0.3 once and then reaching for it again gets you the 0.3 you settled
on, in the new layer, without tying the two layers together afterwards.

**A new layer is a pass-through**, not an empty slot. Adding one changes
nothing on screen until you choose what goes in it — making room and filling
it are two separate decisions — and nothing downstream has to special-case a
layer that isn't doing anything yet. The last layer can't be deleted for the
same reason: the picture has to run through something, and the pass-through is
that something.

**Each layer has its own feedback history.** `prev` means "what this effect
produced last time", so a stack with two feedback effects in it would be
nonsense if they shared one buffer — each would be trailing on the other's
output. The renderer keys the buffers off the layer object rather than its
position, so reordering or deleting layers carries each layer's history with
it instead of handing it to whoever inherits the slot.

**The mirror and the flip run on the first pass only.** They describe the
picture coming *in*; by the second pass the image in hand is already the right
way round and the right way up, and applying either again would undo it — with
an even number of layers a per-pass mirror would silently cancel itself out.

**Changing the stack wipes the feedback history, and reseeds it from the live
picture.** Trails left by an effect you just removed have no business bleeding
into the one you replaced it with. But starting from black means a feedback
effect has nothing to read for its first frames — Slit-Scan in particular
spends several seconds crawling out of a black screen — so the buffers are
filled with the current frame through the pass-through shader instead, twice,
once for each half of the ping-pong pair.

The cost is real and is why there is a cap: six layers is six full-resolution
passes per frame and twelve extra textures. That is nothing much at 1080p on a
discrete GPU, but it is not free, and past six another pass stops reading as a
deliberate choice.

## Looks as links

A stack is a short list of names and numbers, which makes it small enough to
live in the URL — and that is the whole trick for sharing one.

```
https://example.com/camera-player/#VHS:0.70,Halftone:0.85&m=1
```

opens the page with VHS at 0.70 under Halftone at 0.85, mirrored. The hash is
rewritten with `history.replaceState` on every change, so the address bar is
always current — and `replaceState` rather than assigning `location.hash`,
which would push a history entry for every nudge of the intensity slider and
turn the Back button into an undo log nobody asked for.

The same string goes into `localStorage`, so the look survives a reload. When
both are present the hash wins: someone who followed a link came for what is
in the link, not for whatever they were doing last time.

Effects in the hash that don't exist — a link made against a later version, or
a typo — are skipped rather than treated as an error, and a hash that resolves
to nothing at all falls through to the default stack.

## Recording

What gets recorded is the **output**, not the page. `canvas.captureStream()`
publishes the canvas itself, and the canvas is exactly the camera's frame
size with nothing drawn over it — the chrome around it is CSS and never
reaches the canvas. So the file is the picture you made, at the resolution you
made it at, not a screen recording of the app that made it. `S` saves one
frame of the same thing as a PNG.

**The container follows what the browser will admit to.** `recorder.js` tries
VP9, then VP8, then bare WebM, then MP4 for Safari, and the file extension
follows what was actually negotiated rather than being assumed. In practice
that is WebM everywhere except Safari.

**No audio**, deliberately. The browser asks for camera and microphone
permission together or not at all, and a microphone prompt for an app that
does nothing with sound is a bad trade for the one person in ten who would
have wanted it.

**The take is held in memory until you stop.** A page has no incremental write
to disk without a directory handle, which is its own permission prompt. The
recorder does at least ask `MediaRecorder` for a chunk a second rather than
one allocation at the end — the difference between a steady climb in memory
and a spike big enough to stall the tab — but a long 1080p take is still real
memory, at roughly a megabyte a second. The running clock in the readout is
there to make that visible.

**`preserveDrawingBuffer: true` is not optional here.** A WebGL canvas whose
drawing buffer is discarded after each composite has nothing to hand over on
the frames `captureStream` samples between draws, and the recording comes out
with black frames scattered through it. It costs a little fill rate and buys a
recording that matches what was on screen.

**The blob URL is revoked on a timer, not immediately.** Some browsers have
not finished reading the blob by the time the synthetic `click()` returns, and
revoking mid-read produces a zero-byte download with no error anywhere.

## Writing your own effect

Two steps.

**1. Write `shaders/yours.frag`.** Only the `main()` — the shared preamble
(`shaders/_common.glsl`) is prepended at compile time and declares everything
you can use:

```glsl
in  vec2 uv;                 // 0..1 across the output, y up
out vec4 fragColor;

uniform vec2  u_res;         // output size in pixels
uniform float u_time;        // seconds since start
uniform float u_amount;      // this layer's intensity, 0..1
uniform float u_mirror;      // 1.0 when the picture is mirrored
uniform float u_flip;        // 1.0 when the source is stored top-down

vec2  texel();               // 1.0 / u_res
vec3  source(vec2 p);        // the picture feeding this layer
vec3  sourceLod(vec2 p, float lod);   // ...from a chosen mip level
vec3  feedback(vec2 p);      // what THIS layer produced last frame
float luma(vec3 c);
float hash21(vec2 p);
float noise2(vec2 p);
float fbm(vec2 p);
vec3  hsv2rgb(vec3 c);
vec3  rgb2hsv(vec3 c);
mat2  rot(float a);
const float TAU;
```

`camera()` and `camuv()` exist as aliases of `source()` and `srcuv()`, kept so
that effects written for the desktop player read the same here.

**Always read through `source()`, never `texture(src, uv)` directly.** The
mirror and the flip live inside it; sample the sampler yourself and both
silently stop applying to your effect alone, which is a confusing thing to
debug when thirty-three others behave.

**2. Add one line to `CATALOGUE` in `js/effects.js`**, in whichever group it
belongs to:

```js
["My Effect", "yours.frag", 0.65],
```

The third field is the default intensity. Add a fourth, `true`, if you read
through `sourceLod()` and need the renderer to build a mipmap chain for you.

Reload. If it doesn't compile, the console says so with line numbers relative
to *your* file — the `#line 1 0` directive between preamble and body is what
buys that — and the effect stays in the menu greyed out and marked `(failed)`
rather than vanishing, because an effect that has silently disappeared is a
worse bug report than one that is visibly broken.

**Effects are portable between this and the desktop player.** The two
preambles are the same document with a different header: `#version 300 es`
plus three `precision` declarations here, `#version 330 core` there. Nothing
below the header differs. An effect that uses only the vocabulary above will
compile on both — and both projects' `shaders/` directories hold byte-identical
copies of every `.frag` today.

The one thing to watch is that GLSL ES is stricter about implicit
conversions than desktop GLSL. Desktop drivers will often accept `float x = 1;`
where ES demands `1.0`. Writing for ES first gets you both.

## Project structure

| File | What it does |
| --- | --- |
| `index.html` | The window: title bar, stage, control bar, help panel |
| `css/style.css` | The Luna chrome, transcribed from the desktop palettes |
| `js/main.js` | Entry point: owns the camera, the chain, the renderer and the input, and the only file that touches the DOM |
| `js/effects.js` | The catalogue, the GLSL compiler, the shader loader |
| `js/chain.js` | The stack of layers and the rules for editing it |
| `js/renderer.js` | The WebGL 2 context, the per-layer ping-pong buffers, the passes, the blit |
| `js/camera.js` | getUserMedia, device enumeration, and error translation |
| `js/recorder.js` | MediaRecorder for video, `toBlob` for stills, the download path |
| `shaders/_common.glsl` | The preamble every effect is compiled against |
| `shaders/_quad.vert` | The fullscreen triangle strip, in clip space |
| `shaders/*.frag` | One per effect |
| `build.mjs` | Folds everything into `dist/camera-player.html` |
| `serve.mjs` | A local static server for developing against |

`chain.js` and `effects.js` are close ports of the desktop `chain.py` and
`effects.py`; keeping them recognisably the same file is deliberate, so a fix
in one can be carried to the other by reading rather than by re-deriving.

## How a frame gets to the screen

1. `requestAnimationFrame` fires. `main.js` uploads the `<video>` element to
   the source texture with `texImage2D`, whether or not a new camera frame has
   arrived since last time.

2. If the video's dimensions changed, the canvas and every layer buffer are
   reallocated at the new size and the feedback history is reseeded from the
   live picture.

3. For each layer, bottom to top: bind that layer's *target* framebuffer, set
   the uniforms, bind the incoming picture to texture unit 0 and that layer's
   *previous* output to unit 1, and draw four vertices. The target becomes the
   incoming picture for the next layer; the pair swaps, so what was just
   written is what the layer reads as `prev` next frame.

4. A final trivial blit pass puts the last layer's texture on the canvas.

5. CSS scales the canvas into the stage with `object-fit: contain`.

**Why the loop redraws even when the camera hasn't.** Half the effects are
animated by `u_time` and the feedback family advances its own history every
pass, so a 30fps camera through Echo Trails still has to be redrawn 60 times a
second or the trails move in visible steps. Uploading an unchanged frame is a
texture copy the driver is very good at; skipping the whole pass to save it
would cost the animation.

**Why every pass renders at the camera's resolution rather than the canvas's
display size.** Effects that work in pixel units — scanlines, halftone cells,
ASCII grids — stay a fixed size relative to the picture instead of changing
character every time the window is resized. The letterboxing is CSS's problem,
and the recording is unaffected by the window at all.

**Why a separate blit pass instead of letting the last layer draw to the
canvas.** It would save one fullscreen pass and cost the top layer its
feedback history, which is the one place in a stack where feedback is most
likely to be wanted.

**The mipmap detour.** Quadtree, Mondrian and Stipple average whole cells of
the picture at a time, and a mip level *is* that average — the alternative is
dozens of taps per pixel to compute something the hardware already has a path
for. Every texture here is otherwise plain `LINEAR`, because it spends the
rest of its life as a render target whose mip levels would be stale by the
next frame anyway. So the chain is built on demand, for the one pass that asked
for it, and the filter is put back immediately afterwards. It belongs to the
effect, not to the texture.

That is also why the layer textures are allocated with `texImage2D` rather
than `texStorage2D`: a `texStorage2D` texture is immutable with a fixed level
count, and `generateMipmap` on a single-level immutable texture is an error.

## The single-file build

`build.mjs` inlines the CSS, concatenates the six ES modules and embeds all
thirty-six shaders as a `SHADER_SOURCES` object on `window`. `effects.js`
checks for that object before reaching for `fetch()`, so both builds run the
same code path.

The module concatenation is a cheat rather than a bundler: it strips the
`import` lines and the `export` keywords and relies on the six modules sharing
no top-level names. That is fragile in exactly one way, so `build.mjs` scans for
duplicate top-level declarations and refuses to write a file it cannot vouch
for — naming the two modules that clash — rather than emitting one that fails
at runtime with a `SyntaxError` pointing at a generated file nobody would
connect back to here.

It also verifies that the two tags it substitutes are still in `index.html`,
so renaming the stylesheet quietly producing a build with no styling isn't a
thing that can happen.

A single file still has to be served over HTTPS or localhost. Bundling changes
how easy the app is to move; it changes nothing about the secure-context rule.

### Why there is no package.json, and no real bundler

Both scripts are Node stdlib only and there is no `package.json`. That is a
choice, and it is the one most likely to be second-guessed, so:

**No bundler.** esbuild or Vite would do the module handling properly instead
of by regex, and would cost this project the property it is best at — there is
nothing to install, and nothing to keep alive. The regex cheat is guarded by
the collision check and fails loudly; an npm dependency tree is not guarded by
anything and has to be maintained for as long as the app is. The app is six
files of vanilla JavaScript that will still run in ten years. Its build script
should have the same shelf life.

**No `package.json`.** The scripts are `.mjs` precisely so that Node reads them
as modules without a manifest existing only to say `"type": "module"`. Adding
one would also invite `npm install` (which would do nothing) and can make some
static hosts believe there is a build step to run when there isn't.

**Node rather than Python**, which is what these two scripts were first written
in. Both are on the machine; the deciding argument is that this is a JavaScript
project, the person editing the build script is already editing shaders and
modules, and it was the only Python left in the folder. Nothing about the
output changed — the Node build is byte-identical to the Python one apart from
JSON spacing and blank lines, which was checked rather than assumed.

The one thing that did have to be said out loud in the move: Python's text mode
silently normalises CRLF on read and Node hands back exactly what is on disk,
which was worth about 3 KB of stray `\r` inside the embedded shader strings.
`readText()` in `build.mjs` does it explicitly now.

## The dev server

`serve.mjs` is sixty lines of `node:http` that exist for one reason: the app
cannot be opened from a `file://` path, so developing against it needs an
origin, and `http://localhost` is the only one available without a
certificate.

It is not for hosting anything. No compression, no ranges, no real logging.
Three things in it are load-bearing rather than incidental:

**`text/javascript` on `.js`.** A browser refuses to run an ES module served
as anything else, and the failure is a bare "disallowed MIME type" in the
console with nothing pointing at the server.

**`Cache-Control: no-store`.** Edit a shader, reload, see the shader. A dev
server that caches is a dev server that lies to you for the rest of the
afternoon.

**Path normalisation before the join.** The pathname is percent-decoded, so
`%2e%2e%2f` is a real `../` by the time it reaches the filesystem;
`normalize()` collapses it first and the result is checked to be under the
root, which is what stops the server handing out whatever is one directory up.

It prints the LAN address too, with the warning attached: that URL will load
the page and will never get a camera, because it is plain `http://` and not
`localhost`. For a phone, put it behind a tunnel or on a real host.

## Decisions worth keeping

**The camera is not opened on load.** A permission prompt in front of someone
who has not yet seen what the page is, is the fastest way to be denied it. The
stage says what the app is and what it doesn't do with your video, and opening
the camera is a click.

**Nothing leaves the page, and it is said out loud.** There is no server side
to this app; there is nowhere for the video to go. That is worth stating in
the interface rather than only in a README, because "a website that wants my
camera" is a reasonable thing to be suspicious of and the suspicion is
answerable.

**The XP chrome is not a joke about the desktop version.** It is the same
window, so a look built in one reads the same in the other, and the two
projects stay recognisably one thing. The palettes in `style.css` are the same
stop lists `xp_style.py` draws its gradients from. What makes XP chrome read
as XP is mostly the multi-stop caption curve — brightening sharply near the
top, dipping, lifting again before the dark bottom edge — and the bevels being
consistently the right way round.

**Luna was a glossy theme, and gloss is the first thing that dies when it gets
flattened.** A dark, flat, neutral panel was tried and thrown away: it was
perfectly competent and completely lifeless, and it turned an app that is fun
to open into one that looks like configuration. So the palette here is not
muted, cooled, or "modernised" — those are the desktop stop lists exactly.

**What was added instead is the movement a screenshot of XP could never show
you.** Everything that answers a pointer eases rather than snaps, on one shared
curve so nothing is out of step; the sky drifts on a two-and-a-half minute
cycle, slow enough to read as weather; the window arrives rather than
appearing; the lens in the title bar opens while a picture is live; and the
trackbar fills with the XP progress green. All of it is period-plausible — XP
animated its own chrome — and all of it is behind `prefers-reduced-motion`.

**The layer strip carries names now.** It used to be six numbered squares,
which meant the only way to find out what was in layer 4 was to hover it. A tab
strip is the period-correct control for "several things, one of them current",
and it costs nothing but width that the row already had.

**The trackbar fill was the most-missed piece of feedback.** Chromium has no
native progress on a range input, so a plain custom-styled slider shows a thumb
on an empty groove and never looks like it is holding a value — on the one
control whose entire job is holding a value.

**The transport glyphs are drawn in CSS, not typed as characters.** A play
triangle set in a font is at the mercy of whatever the browser substitutes,
and at 27px the difference between a centred arrow and an off-centre one is
obvious. The mirror glyph is the same arrowhead twice, pointing away from a
shared axis with the copy faded — two triangles being all the pseudo-element
budget allows, and clearer than the hollow outline it replaced.

**A broken shader is greyed out, not hidden.** Compilation is eager but
forgiving; one typo costs you one effect rather than the app.

**Storage failures are swallowed.** `localStorage` throws in private mode and
when site data is blocked. A look that doesn't persist is not worth an error
message, let alone a page that won't start.

**`Escape` in a widget belongs to the widget, and so does every other key.**
Typing `s` in the effect list jumps to Sepia; stealing it to save a still
would be maddening. The key handler bails out when focus is in a `select` or
an `input`, for everything except `Escape`.

## Troubleshooting

**"Camera access needs a secure page."** You are on `file://` or on a plain
`http://` LAN address. Serve it over HTTPS, or use `http://localhost`. There
is no way around this from inside the page.

**"Camera permission was refused."** The site is blocked in your browser. The
icon at the left of the address bar is where it is unblocked; reload
afterwards.

**"The camera is attached but could not be opened."** Another application has
it. On Windows that is usually Teams, Zoom or the Camera app holding the
device open in the background.

**"WebGL 2 is not available."** Every browser released since 2021 has it. On a
desktop machine this almost always means hardware acceleration is turned off
in the browser's settings, or the GPU is on a driver blocklist.

**Black picture, no error.** Check the console. An effect that failed to
compile is skipped rather than fatal, so a stack of one broken layer shows
what came in — but if the *camera* never produced a frame, the readout shows
no resolution.

**Recording produces a file that won't open.** It is WebM. Rename-and-hope
does not work; `ffmpeg -i in.webm -c copy out.mp4` does.

**Frame rate collapses with several layers.** Six layers at 1080p is six
full-resolution passes and twelve textures. Bokeh, Kuwahara and Frosted Glass
are the expensive three — they take 128, ~196 and 20 taps per pixel
respectively. Drop the size to 720p before dropping effects; the effects that
work in pixel units will look *more* like themselves, not less.

**The effect list is missing entries.** They are there, greyed out and marked
`(failed)`, at the position they belong in. The console says why.
