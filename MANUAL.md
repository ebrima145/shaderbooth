# Shaderbooth — the long version

The short version is [README.md](README.md): what it is, how to run it, how to
host it, the keys, and the handful of gotchas that otherwise cost an evening.
This is everything else.

## Contents

- [What it does](#what-it-does)
- [Where the effects come from](#where-the-effects-come-from)
- [The camera](#the-camera)
- [The control bar](#the-control-bar)
- [Effects](#effects)
- [Stacking effects](#stacking-effects)
- [Shuffle, and saved looks](#shuffle-and-saved-looks)
- [Looks as links](#looks-as-links)
- [Recording](#recording)
- [Writing your own effect](#writing-your-own-effect)
- [Project structure](#project-structure)
- [How a frame gets to the screen](#how-a-frame-gets-to-the-screen)
- [The single-file build](#the-single-file-build)
- [On a phone](#on-a-phone)
- [On a desktop](#on-a-desktop)
- [The icon](#the-icon)
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

## Where the effects come from

The effects started life in a native OpenGL player, written against desktop
GLSL and a vocabulary — `source()`, `feedback()`, `u_amount` — that says
nothing about where the picture came from. That turned out to be the whole
reason they could move: a browser has had a camera API for a decade and a
shader pipeline for longer, and nothing in the effect files ever knew which
was underneath them.

So this is not a rewrite of the effects. It is the same `.frag` files with a
different preamble in front of them and a different host underneath. The
things worth carrying over came over intact — the per-layer feedback buffers,
the mirror-and-flip-on-the-first-pass rule, the pass-through-is-a-real-effect
rule, the mipmap detour for the mosaic family — because each of them was a bug
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

**Nothing needs a capture thread.** A native app has to put the driver's
blocking frame read on a worker, because calling it from the UI clock stalls
the whole window for up to a frame interval every tick. Here the `<video>`
element is decoding on its own and reading it is a texture upload, so there is
nothing in the render loop that can block.

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

## Shuffle, and saved looks

**The dice builds a random stack**, with just enough taste to be worth pressing
twice. Not uniformly random: the pass-through is excluded, because a layer of
nothing is not a surprise; no effect appears twice in one stack; and at most one
of the three marked `(heavy)` gets in, because six passes of Kuwahara is not a
look, it is a slideshow. Two to four layers — one is barely a stack and five is
usually mud.

Amounts are jittered around each effect's *own default* rather than drawn across
the whole range, so every effect still arrives looking like itself. That is the
difference between a surprise and noise.

**Saved looks** are the same encoded string the URL uses, kept in a list. The
address bar already holds the current look and a link already carries one —
that is genuinely most of the feature, and it is why this stays small. What a
link cannot do is let you keep half a dozen and flick between them, which is
the difference between a toy and something you work in.

They are named from the chain rather than by asking. A prompt for a name is a
question most people answer with "asdf", and `VHS > Bloom > Halftone` says more
about a look than any name someone types in a hurry. Newest first, capped at
twelve, so the list stays a list rather than becoming an archive nobody reads.

Because a saved look and a shared look are the same object, neither can drift
from the other: anything that can be linked can be saved, and the encoding only
has to be right once.

## Looks as links

A stack is a short list of names and numbers, which makes it small enough to
live in the URL — and that is the whole trick for sharing one.

```
https://example.com/shaderbooth/#VHS:0.70,Halftone:0.85&m=1
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

**MP4 first, WebM only as a fallback.** `recorder.js` asks for
`video/mp4;codecs=avc1` and works down a list, because MP4/H.264 is what
everything downstream actually opens — phones, editors, messaging apps,
anything that will not touch a `.webm`. Chrome, Edge and Safari all produce it.
Firefox's MediaRecorder still has no MP4 muxer, so it drops to VP9 in WebM.

`avc1` is deliberately left unqualified. Pinning a profile and level — the
`avc1.640028` kind of string — fixes the encoder to High@4.0, a ceiling of
roughly 2048×1080: fine at 720p and silently wrong at 4K. Bare `avc1` lets the
browser pick a level that fits the canvas it was handed.

**The extension follows what was negotiated, not what was asked for.** Writing
`.mp4` on a WebM blob produces a file that fails to open with a codec error,
which is a worse outcome than an honest `.webm` the person can remux.

What MediaRecorder writes is *fragmented* MP4. Browsers, VLC, Resolve and
Premiere all read it; a few older Windows tools want a faststart remux first,
which is the same one-line `ffmpeg` call.

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

`camera()` and `camuv()` are aliases of `source()` and `srcuv()`, kept because
the effects were written against those names before the source could be
anything but a camera. There is no reason for an effect to have to know it
moved.

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

**Effects written here also compile as desktop GLSL.** The preamble is the
only thing that differs between the two dialects: `#version 300 es` plus three
`precision` declarations here, `#version 330 core` and no precision qualifiers
there. Nothing below the header changes. An effect that sticks to the
vocabulary above will build in either, unmodified.

The one thing to watch is that GLSL ES is stricter about implicit conversions.
Desktop drivers will often accept `float x = 1;` where ES demands `1.0`.
Writing for ES first gets you both.

## Project structure

| File | What it does |
| --- | --- |
| `index.html` | The window: title bar, stage, control bar, help panel |
| `css/style.css` | The Luna chrome: palette, gloss and motion |
| `js/main.js` | Entry point: owns the camera, the chain, the renderer and the input, and the only file that touches the DOM |
| `js/effects.js` | The catalogue, the GLSL compiler, the shader loader |
| `js/chain.js` | The stack of layers and the rules for editing it |
| `js/renderer.js` | The WebGL 2 context, the per-layer ping-pong buffers, the passes, the blit |
| `js/camera.js` | getUserMedia, device enumeration, and error translation |
| `js/recorder.js` | MediaRecorder for video, `toBlob` for stills, the download path |
| `shaders/_common.glsl` | The preamble every effect is compiled against |
| `shaders/_quad.vert` | The fullscreen triangle strip, in clip space |
| `shaders/*.frag` | One per effect |
| `build.mjs` | Folds everything into `dist/shaderbooth.html` |
| `serve.mjs` | A local static server for developing against |

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

## On a phone

The app is responsive and the camera API is the same one, so it runs on a
phone as-is. Four things are different enough to be handled explicitly, all
keyed off `(pointer: coarse)` — the *primary* pointer, so a laptop with a
touchscreen keeps the mouse-sized interface.

**Saving goes through the share sheet.** A phone has no useful downloads
folder, and on iOS an `<a download>` tends to open a preview rather than save
anything; `navigator.share({files})` is the only route from a web page to the
camera roll, and it reaches Messages and everything else in the same step. The
capability is detected with `navigator.canShare({files})` rather than
`navigator.share`, because carrying files is a separate capability from sharing
a link and browsers exist with the second and not the first.

Dismissing the sheet throws `AbortError`, and that case deliberately does
*not* fall back to a download — the person just declined to save the file, and
saving it anyway would be the opposite of what they asked. Every other failure
does fall through to the download, which always works. That matters more than
it looks: `navigator.share` needs transient user activation, and by the time
`MediaRecorder.onstop` has flushed the last chunk, the click that stopped the
take may have aged out of the activation window. When it does, the file still
lands.

**Front and back, not device ids.** Android enumerates the wide, ultrawide and
depth sensors as separate `videoinput` devices, so cycling ids lands on lenses
nobody asked for. On touch the picker becomes a switch-camera button driving
`facingMode`, and the "previous camera" button is hidden because with two
facings it is the same button pressed twice.

**The mirror follows the lens.** Front camera mirrored, because that is what a
person expects of their own face; back camera not, because it is pointed at
the world and flipping that makes text unreadable. Applied only when the facing
actually changes, so a manual toggle survives a resolution change or a reopen
of the same camera.

**No fullscreen button on iOS.** iOS only implements fullscreen on a `<video>`
element, so on an iPhone the button was dead and every press answered with
"fullscreen refused". It is hidden by feature detection rather than on all
touch devices, because Android Chrome does support it and the button is
genuinely worth having there — it takes the browser's own address bar away, on
top of the app folding its bars. The key's row in the help list goes with it,
since documenting a key that does nothing is worse than not mentioning it.

Installing to the home screen gets an iPhone the same result by another route:
`display: standalone` launches with no browser chrome at all.

**Hit targets and viewport units.** Everything in the transport row was drawn
for a mouse — the stack buttons are 21px against a ~44px floor for a
fingertip — so the sizes lift under `(pointer: coarse)` without touching the
desktop layout. `touch-action: manipulation` removes the ~300ms a browser holds
a tap in case it becomes a double-tap zoom. The shell is `100dvh` rather than
`100%`, because iOS Safari resolves `100%` against the *largest* viewport and
puts the control bar under the browser toolbar; and the control bar carries
`env(safe-area-inset-bottom)` so it clears the home indicator.

### Room for the picture

Measured on a 375x812 screen, the chrome was taking **47%** of it: a 349px
control bar and a 29px title bar around a 434px stage. Almost half the screen
was furniture. Three changes, none of which touch the theme:

**Camera and Size moved into a sheet.** They are set-once controls that were
costing a full 38px row each, because the mobile layout gives every `.field`
its own line. The fields are *moved* rather than duplicated, so there is still
exactly one Camera select in the document with exactly one listener on it - the
sheet is just where it is parented on a phone.

**The readout moved into the title bar.** That bar was showing the effect
chain, which the tab strip now spells out in full a few pixels below it, so it
was the one piece of duplicated information in the interface. Trading it for
the resolution and the running clock frees the readout's own row.

Those two take the control bar from 349px to **224px**, and the chrome from 47%
to 31%.

**The bars fold away a few seconds after you stop touching them,** and a tap on
the picture brings them back - which is the other 31%. Collapsed with
`max-height` rather than by sliding a floating bar out of frame, so the bands
stay in flow and the picture *grows* into the space instead of being covered by
chrome sitting on top of it.

That needs a real number to animate from, because `max-height` has nothing to
interpolate against `none`. So the control bar is measured on every refresh -
its height changes when six tabs wrap where two did not - and published as
`--chrome-h`. Padding has to be zeroed in the collapsed state as well: under
`border-box` a `max-height` of 0 collapses the content box but cannot eat the
padding, which leaves a 16px strip of blue along the bottom of the screen
looking like a rendering fault.

**Capture survives the fold.** Record and still float over the picture and
appear exactly when the bars leave, because otherwise the fold costs you the
shot - reveal, then reach for record, is two taps and the bars are back up by
the time you have taken it. Using the floating pair deliberately does *not*
call `showChrome()`: capturing is the one thing you want to do while watching,
so reaching for the shutter must not put the furniture back.

Only those two. Everything else in the control bar is adjustment - which
effect, how much, which layer - and adjusting is a reason to want the bars
anyway. They are also not shown alongside the bars, because the transport row
already carries both buttons a few pixels below, and two live record buttons on
one screen is a question nobody should have to answer.

The container spans the full width so the pair can be centred, which means it
has to be `pointer-events: none` with the buttons themselves set back to
`auto`. Without that, tapping the picture anywhere level with the shutter would
hit an invisible bar instead of bringing the chrome back.

**A take in progress keeps its title bar.** That is where the tally and the
running clock live on a phone, and hiding "you are still recording" in order to
show more of the picture is the one trade this should never make. The control
bar still folds, so a running take gets everything but 29px.

### What is measured rather than guessed

Mobile GPUs are tile-based deferred renderers: every full-screen pass flushes
the tile buffer to main memory and reads it back, so a six-deep stack costs six
round-trips that are nearly free on a desktop card. On top of that, per-layer
double-buffering means six layers at 1080p is about 100 MB of texture memory
before the source frame, which is enough for iOS Safari to discard the tab.

There is no way to predict from a user agent string what a given phone will do
with that, so nothing is capped in advance. Instead the three genuinely
expensive effects are marked `(heavy)` in the list — Bokeh at 128 taps per
pixel, Kuwahara at ~196, Frosted Glass at 20 — and the render loop watches the
frame rate it actually gets. Under 20fps sustained for two seconds, it says so
once, in the readout.

Once, and as a toast rather than the stage dialog, on purpose. Being slow is
not an error: the picture is still there and still worth looking at, and
covering it with something undismissable to complain about the frame rate
would be a worse experience than the frame rate.

### Still unverified

Whether `canvas.captureStream()` works on current iOS Safari. It was missing or
buggy there for years. If it does not, recording on an iPhone is impossible
from a web page regardless of anything above, and that one fact is what would
decide whether this ever wants to be a native app. Everything else here is
already better served by the web version.

## On a desktop

Three things the phone work left behind, since all of it was gated on
`(pointer: coarse)`.

**The window maximises.** It was hard-capped at 1100x760, which on a 1440p
monitor is under a quarter of the screen and on a 4K one is a tenth — and the
picture inside it was the same size either way, which for an app whose whole
content is a picture is the worst thing about it on a large display. The middle
caption button is the third one the chrome always implied. It fills the browser
while keeping the browser's own chrome, which is what makes it a different
thing from fullscreen rather than a duplicate of it. The state is remembered in
its own storage key, deliberately apart from the look: how big your window is
says nothing about the picture and has no business in a shared link.

**Fullscreen folds the bars away, immediately.** The machinery already existed
for phones and was gated on touch; it now also opens in fullscreen, which is
the one time someone has said in as many words that they want the picture and
nothing else. A window that hid its own controls while sitting on a desktop
would just be losing them.

On a phone the fold is ambient and the idle wait is right. In fullscreen it is
a command, so the bars go the instant you enter rather than three and a half
seconds later — making someone hold still to get what they just asked for is
answering a question they did not ask. That was the first version and it was
wrong: any mouse movement in those seconds reset the timer, so in practice the
bars often never went at all.

**Moving the mouse does not bring them back**, and that is the part worth
explaining, because it is the opposite of how a video player behaves.

It did at first, copied straight from every video player. It was wrong here for
a reason specific to this layout: the bars are in flow, so revealing them
shrinks the stage, which moves the floating shutter sitting against its bottom
edge. Reaching for record therefore summoned the bars *and slid the button out
from under the pointer on the way*. The one gesture that had to keep working in
fullscreen was the one the reveal broke.

So the bars stay down, and record and still stay reachable on their own —
floating over the picture, in a fixed place, not going anywhere. Clicking the
picture is the way back, which is deliberate rather than incidental, and every
keyboard shortcut works throughout regardless.

Hovering the bars while they *are* up keeps them up, so they cannot fold out
from under a hand on its way to a control. That listener holds an open bar and
never reopens a folded one — a collapsed bar is zero pixels tall and cannot be
hovered in practice, but saying so explicitly is what stops it quietly becoming
the reveal-on-move it replaced.

**And the picture fills the screen there.** `object-fit: contain` is the honest
default everywhere else — you see exactly the frame that gets recorded, and the
leftover letterboxes. But a 16:9 camera on a 16:10 laptop still shows bars with
the chrome gone, and someone who pressed `F` asked for the screen filled, not
for an accurate preview of an aspect ratio they cannot change. So fullscreen
uses `cover`.

The crop is display only. The canvas is still the camera's own resolution and
the recording is still the whole frame, so a take made in fullscreen contains
slightly more than was on screen. That is the right way round — better to
record more than you framed than less — but it is worth knowing.

**Layer tabs drag.** Order is what this app is about, and rearranging it used to
mean selecting a tab and then clicking an arrow — two steps for the interaction
the whole thing is built around.

Pointer events rather than HTML5 drag-and-drop, which cannot be styled, does not
report positions usefully, and drags a ghost image nobody asked for. The tab
centres are captured once at the start, from the layout before anything moved:
the target has to be computed against where the tabs *were*, not against
positions this drag is itself shifting. The target index is then simply the
number of other tabs whose centre now sits left of the pointer, which is exactly
the index a splice lands at.

That is also why `EffectChain` grew `moveTo()` alongside `move()`. `move()`
swaps two positions, which is right for the `,` and `.` keys but wrong for any
drag longer than one place — it would leave everything you dragged past in the
wrong order. `moveTo()` lifts the layer out and reinserts it, so the rest closes
up by one in the direction it came from, which is what the animation shows and
therefore what you expect. The layer object itself moves either way, so its
feedback history travels with it.

Dragging is mouse-only. On a phone the tab strip scrolls horizontally, and a
horizontal drag cannot mean two things at once.

**A drag also ends in a click, and that click is not a selection.** It cannot be
suppressed with a flag on the tab, because the refresh that follows the reorder
replaces every tab before the click arrives — so the click lands on a brand new
element that knows nothing about the drag. It is caught at the container in the
capture phase instead, by a listener that removes itself after 250ms either way.
A flag that outlived its click would silently eat the next real one, which is a
bug that would surface much later and look like nothing to do with dragging.

## The icon

The mark is a camera iris: six blades around an opening, in the same Luna blue
the caption uses, so the thing on your home screen and the thing in the title
bar are one drawing.

**The blades alternate between two tones rather than one tone at two
opacities.** That was the first version, and at 40px — which is what a home
screen actually gives you — a blade at 55% over blue and a blade at 100% over
blue are close enough in value to merge, and the whole mark collapses into a
pale blob. Two explicit tones keep the blade structure legible all the way
down. It is the same shape either way; only the contrast changed.

**`icon.mjs` is the only place the mark exists.** It writes the four PNGs and
prints the SVG that serves as the inline favicon, so changing a number and
re-running moves the whole set together. An icon redrawn by hand at four sizes
is an icon that ends up subtly different at four sizes.

It rasterises by hand, in Node stdlib. Every shape in the mark is a triangle, a
circle or a rounded rectangle, so each pixel can simply be asked which of them
it is inside; sampling 4×4 within each pixel is what gives the edges their
smoothness, since there is no antialiasing to inherit when nothing is drawing
but you. PNG comes out of `zlib` — the format is a handful of length-prefixed
chunks with CRC32s, which is a smaller and more durable thing to own than a
dependency that rasterises SVG.

One bug worth recording, because it was invisible in the numbers and obvious on
screen: the corner radius was being scaled to the output size, but the
rasteriser maps every pixel back into the 128-unit design box before sampling,
so it was scaled twice. At 512 that made the radius 112 in a box 128 across,
the corner clamp inverted, and a quarter of the icon simply vanished. The
180px file looked merely a bit over-rounded, which is the kind of wrong that
ships.

**The maskable icon is squared off on purpose.** Android applies its own mask,
and a rounded tile inside that mask gets its corners clipped twice. The mark
sits well inside the safe circle either way.

**There is a manifest but no service worker.** The manifest is what makes Add
to Home Screen give you a real icon and a chrome-free launch, and it cannot go
stale. A service worker could make the app work offline, but this app needs the
network on first load regardless, and a cache serving last week's build is a
worse failure than a slow start. If offline ever matters more than that, it is
a separate decision made on purpose.

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

**The XP chrome is not a joke.** It is a real theme executed properly, and
what makes it read as XP rather than as blue rectangles is narrower than it
looks: the caption is a *multi-stop* curve, not a two-colour ramp — it
brightens sharply near the top, dips, then lifts again before the dark bottom
edge — and every bevel runs the same way round, grooves dark on the top-left
and light on the bottom-right, raised faces the reverse. Lose either and the
whole thing goes flat.

**Luna was a glossy theme, and gloss is the first thing that dies when it gets
flattened.** A dark, flat, neutral panel was tried and thrown away: it was
perfectly competent and completely lifeless, and it turned an app that is fun
to open into one that looks like configuration. So the palette here is not
muted, cooled, or "modernised" — those are the Luna stop lists exactly.

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

**The transport glyphs are inline SVG, from one sprite of eight symbols.** Not
font characters, which are at the mercy of whatever the browser substitutes —
at 27px the difference between a centred play arrow and an off-centre one is
obvious. And no longer CSS shapes either. Those avoid the substitution problem
but cost a two-pseudo-element budget per button, which is how the camera came
to read as a briefcase — an outlined box with a dot, the only hollow shape in a
row of solid ones — and why the flip was two triangles distinguished by
opacity. It also meant every size needed its own hand-tuned copy of the same
drawing: about thirty rules across two places, three copies of some.

A `viewBox` scales for free, so one definition serves the 27px bar button, the
44px touch target and the 62px shutter, and the per-size overrides collapse to
two lines setting `svg` width. Everything is drawn against `currentColor`, so a
button changes its glyph by changing its own colour — which is how the record
button goes from dark red to bright without a second gradient.

The camera is a solid silhouette with the lens knocked out through
`fill-rule="evenodd"`, so the button's own gradient shows through the barrel.
The die does the same with its pips — drawn as an outline with filled dots they
came out 0.8 device pixels across and vanished.

**Stroke weights are per-size, because a viewBox halves them.** The caption
glyphs are drawn in the same 24-unit box as everything else but rendered at
12px, so a `stroke-width` of 1.8 lands as 0.9 device pixels and reads as a
smudge on the blue. They carry their own heavier weights — 2.4 for the window
shapes, 2.8 for the fullscreen corners — set as attributes on the symbol rather
than in CSS, so the weight travels with the drawing.

The star is filled with no stroke at all. Outlining a filled shape at 12px only
fattens it unevenly, which is what made it read as a blob rather than a star.

**`[hidden]` has to outrank layout.** A UA stylesheet only says
`[hidden] { display: none }`, which any author rule beats — so giving `.round` a
`display` to centre its glyph silently un-hid every button JS had marked
hidden, and the phone got its "previous camera" back. The rule is
`!important` now, which is the one place that is not a smell.

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

**Recording produces a file that won't open.** Check the extension first. On
Firefox it is a `.webm`, because that browser cannot mux MP4 — rename-and-hope
does not work, but `ffmpeg -i in.webm -c copy out.mp4` does. If it is a `.mp4`
and something still refuses it, that tool wants a non-fragmented file:
`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`.

**Frame rate collapses with several layers.** Six layers at 1080p is six
full-resolution passes and twelve textures. Bokeh, Kuwahara and Frosted Glass
are the expensive three — they take 128, ~196 and 20 taps per pixel
respectively. Drop the size to 720p before dropping effects; the effects that
work in pixel units will look *more* like themselves, not less.

**The effect list is missing entries.** They are there, greyed out and marked
`(failed)`, at the position they belong in. The console says why.
