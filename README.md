# Shaderbooth

Your camera, in a browser, through up to **six stacked real-time GLSL
effects**, in Windows-XP "Luna" chrome.

**[Try it →](https://ebrima145.github.io/shaderbooth/)**

Every effect runs on the GPU as a fragment shader in WebGL 2, so filters,
analog degradation, feedback and generative fields all hold 60fps at 720p and
above. They **stack up to six deep**, each layer feeding the next, and the
order is most of the expressive range: Halftone over Edge Glow prints the
edges as dots, Edge Glow over Halftone finds the outline of the dots.

It is a folder of static files. There is no server side, no build step, no
dependency to install and no account. The camera goes to your GPU and to a
canvas and stops there — **nothing is uploaded anywhere**, which is also why
the whole thing can be hosted on anything that can serve a file.

**[MANUAL.md](MANUAL.md)** covers the rest: every effect, how to write your
own, what each source file does, how a frame actually reaches the screen, and
the decisions behind it.

---

## Running it

The one rule that catches everybody: **the page has to be served over `https://`
or from `http://localhost`.** Browsers refuse camera access to any other
origin, including a `file://` path — so double-clicking `index.html` gives you
the app with a permanent "camera permission was refused" message, whatever you
click. Nothing about that is fixable from inside the page.

Locally, from this folder:

```bash
node serve.mjs
```

then open <http://localhost:8712>. That is a sixty-line stdlib static server
whose only job is to be an origin a browser will hand a camera to — any other
static server does just as well.

## Sharing it

Any static host will do, as long as it serves over HTTPS — which all of these
do by default:

| Where | How |
|---|---|
| **GitHub Pages** | Push this folder, then Settings → Pages → deploy from branch. **Keep `.nojekyll`** — see below |
| **Netlify / Cloudflare Pages / Vercel** | Drag the folder onto the dashboard; no build command |
| **A plain web server** | Copy the folder into the document root |

**`.nojekyll` is load-bearing on GitHub Pages.** Pages runs everything through
Jekyll by default, and Jekyll silently drops any file whose name starts with an
underscore — which is `shaders/_common.glsl` and `shaders/_quad.vert`, the
preamble every effect is compiled against. Without that empty file at the repo
root, the deploy looks like it worked, the page loads, and every shader fails
with a 404. The zero-byte `.nojekyll` turns Jekyll off and the files ship
verbatim. Nowhere else needs it.

**Or as a single file.** `build.mjs` folds the whole app — HTML, CSS, the six
JavaScript modules and all thirty-six shaders — into one self-contained
`.html` you can attach to a message or drop anywhere:

```bash
node build.mjs
```

It writes `dist/shaderbooth.html` (about 160 KB). It still has to be
*served*, for the reason above — a single file is easier to move around, not a
way out of needing HTTPS.

**A look is a link.** The stack lives in the URL, so
`…/#VHS:0.7,Halftone:0.9&m=1` opens the page with that stack already built.
Copy the address bar after you have built something and the person you send it
to gets the look, not a screen recording and an explanation.

## Using it

Pick a camera from the left drop-down and an effect from the right one. The
numbered tabs on the right of the transport row are the stack, bottom layer
first, and each one carries the name of the effect in it — a layer still
holding the pass-through is greyed and italic. Click a tab to point the effect
box and the Amount slider at that layer. `+` adds a layer above the active one,
`−` deletes it, `◀` `▶` move it down and up the stack.

Intensity means something different in each effect. It is wired to whatever
knob actually matters for that one, not to a blend against the original: it is
Posterize's level count, VHS's tape wear, Kaleidoscope's segment count.

The red button records the **output** — the last layer's picture, at the
camera's own resolution, with no chrome over it. The camera button beside it
saves a still.

### Keys

| Key | Does |
| --- | --- |
| `Space` | Start / stop the camera |
| `Tab` | Next camera |
| `Ctrl`+`←` / `→` | Previous / next camera |
| `[` / `]` | Previous / next effect, in the active layer |
| `-` / `+` | Effect intensity, in the active layer |
| `0` | Reset intensity to the effect's default |
| `1`–`6` | Edit that layer of the stack |
| `A` / `D` | Add a layer above the active one / delete it |
| `,` / `.` | Move the active layer down / up the stack |
| `M` | Mirror horizontally |
| `R` | Start / stop recording the output |
| `S` | Save a still of the output |
| `F` | Fullscreen |
| `Esc` | Close the help panel, or leave fullscreen |

## Gotchas

- **`file://` will never work.** See above. This is the single most common way
  to conclude the app is broken when it isn't.

- **A GitHub Pages deploy without `.nojekyll` serves a broken app.** Jekyll
  drops the two underscore-prefixed shader files and nothing warns you; the
  symptom is "Could not load the shaders — `_common.glsl`: HTTP 404" on a
  deploy that otherwise looks fine.

- **On a phone, saving goes through the share sheet, not a download.** That is
  the only route from a web page to the camera roll, and it is also how the
  file reaches Messages or anywhere else in one step. Dismissing the sheet
  saves nothing — the app says "not saved" rather than quietly downloading a
  file you just declined.

- **Recordings are MP4/H.264 in Chrome, Edge and Safari — WebM in Firefox.**
  Firefox's MediaRecorder has no MP4 muxer, so it falls back to VP9 in WebM
  rather than failing. The extension always matches what was actually
  negotiated, because a `.mp4` file that is really WebM fails to open with a
  codec error, which is worse than an honest `.webm`. To convert one:
  `ffmpeg -i in.webm -c copy out.mp4`.

- **Recordings have no audio.** The camera is opened video-only on purpose: a
  microphone permission prompt for an app that does nothing with sound is a bad
  trade, and the browser asks for both at once or not at all.

- **A recording is held in memory until you stop it.** A page cannot write to
  disk incrementally without asking for a directory first. At 1080p that is
  roughly a megabyte per second, which is what the running clock in the readout
  is there to make visible.

- **Camera names are blank until you have granted permission once.** That is
  the browser withholding them, not a bug — which is why the app opens the
  default camera first and fills the list afterwards.

- **The size drop-down is a request, not a setting.** The browser hands back
  the nearest thing the device can actually do, and the readout shows what you
  really got.

- **Safari** supports all of this but is the slowest of the three engines at
  the heavier effects (Bokeh, Kuwahara, Frosted Glass). Chrome or Firefox if
  you have the choice.

- **Integrated GPUs** will not hold 60fps with six heavy layers at 1080p. Drop
  the size to 720p before you start dropping effects.

- **Phones are slower than the layer count suggests.** Mobile GPUs are
  tile-based: every full-screen pass writes the tile buffer out to memory and
  reads it back, so a six-deep stack costs six round-trips that are nearly free
  on a desktop card. The three effects marked **(heavy)** in the list — Bokeh,
  Kuwahara, Frosted Glass — take 128, ~196 and 20 texture samples per pixel and
  are the first thing to drop. If the frame rate sits under 20 the readout says
  so, once.

- **A shutter floats over the picture while the bars are away** — record and
  still, and nothing else. Using it does not bring the bars back, because
  capturing is the one thing you want to do *while* watching. A take in
  progress still shows its tally in the title bar.

- **On a phone the bars fold away** a few seconds after you stop touching
  them, and a tap on the picture brings them back — the chrome was taking 47%
  of a 375x812 screen. A take in progress keeps its title bar, so the tally and
  the clock never hide. Camera and Size move into the **⋮** sheet, being the
  two controls nobody changes twice in a session.

- **The Camera drop-down becomes a switch-camera button on a phone**, because
  front and back is the only distinction anyone means — Android otherwise
  enumerates the wide, ultrawide and depth sensors as separate devices. The
  mirror follows the lens: on for the front camera, off for the back, so text
  you point at stays readable.

## What's here

| File | What it is |
| --- | --- |
| `index.html` | The window: title bar, stage, control bar, help panel |
| `css/style.css` | The Luna chrome, as gradients and bevels |
| `js/main.js` | Owns the camera, the chain, the renderer and the input |
| `js/effects.js` | The catalogue and the GLSL compiler |
| `js/chain.js` | The stack of layers and the editing rules |
| `js/renderer.js` | The WebGL 2 passes, the ping-pong buffers, the blit |
| `js/camera.js` | getUserMedia, device enumeration, error translation |
| `js/recorder.js` | MediaRecorder for video, `toBlob` for stills |
| `shaders/` | One `.frag` per effect, plus the shared preamble |
| `build.mjs` | Folds the lot into one distributable HTML file |
| `serve.mjs` | A local static server, so the page has a `localhost` origin |

## Adding an effect

Two steps: write `shaders/yours.frag` — just the `main()`, since the shared
preamble in `shaders/_common.glsl` declares the uniforms and the helper
vocabulary — then add one line to `CATALOGUE` in `js/effects.js`. Reload. If it
doesn't compile, the console says so with line numbers relative to your own
file, and the effect stays in the menu greyed out rather than vanishing.

[MANUAL.md](MANUAL.md#writing-your-own-effect) has the full vocabulary.
