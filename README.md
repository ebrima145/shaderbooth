# Camera Player (web)

Your camera, in a browser, through up to **six stacked real-time GLSL
effects** — the same thirty-four effects as the desktop
[Universal Player](../Universal%20Player), with the file and Spout sources
taken out and nothing left but the camera, in a dark instrument-panel UI built
for looking at a lit picture.

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
| **GitHub Pages** | Push this folder, then Settings → Pages → deploy from branch |
| **Netlify / Cloudflare Pages / Vercel** | Drag the folder onto the dashboard; no build command |
| **A plain web server** | Copy the folder into the document root |

**Or as a single file.** `build.mjs` folds the whole app — HTML, CSS, the six
JavaScript modules and all thirty-six shaders — into one self-contained
`.html` you can attach to a message or drop anywhere:

```bash
node build.mjs
```

It writes `dist/camera-player.html` (about 150 KB). It still has to be
*served*, for the reason above — a single file is easier to move around, not a
way out of needing HTTPS.

**A look is a link.** The stack lives in the URL, so
`…/#VHS:0.7,Halftone:0.9&m=1` opens the page with that stack already built.
Copy the address bar after you have built something and the person you send it
to gets the look, not a screen recording and an explanation.

## Using it

Pick a camera from the left drop-down and an effect from the right one. The
**chain** on the right of the transport row is the stack, running left to
right: each node shows its position and what is in it, and a layer still
holding the pass-through is drawn hollow. Click a node to point the effect box
and the Amount slider at that layer. `+` adds a layer after the active one,
`−` deletes it, `‹` `›` move it earlier and later in the chain.

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
| `1`–`6` | Edit that layer of the chain |
| `A` / `D` | Add a layer after the active one / delete it |
| `,` / `.` | Move the active layer earlier / later in the chain |
| `M` | Mirror horizontally |
| `R` | Start / stop recording the output |
| `S` | Save a still of the output |
| `F` | Fullscreen |
| `Esc` | Close the help panel, or leave fullscreen |

## Gotchas

- **`file://` will never work.** See above. This is the single most common way
  to conclude the app is broken when it isn't.

- **Recordings are WebM, not MP4** (except on Safari, which produces MP4).
  WebM plays in every browser and in VLC, Resolve and Premiere. If you need it
  somewhere fussier, `ffmpeg -i in.webm -c copy out.mp4` is usually enough.

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

## What's here

| File | What it is |
| --- | --- |
| `index.html` | The window: title bar, stage, control bar, help panel |
| `css/style.css` | The instrument panel: palette, lamps, the chain rail |
| `js/main.js` | Owns the camera, the chain, the renderer and the input |
| `js/effects.js` | The catalogue and the GLSL compiler |
| `js/chain.js` | The stack of layers and the editing rules |
| `js/renderer.js` | The WebGL 2 passes, the ping-pong buffers, the blit |
| `js/camera.js` | getUserMedia, device enumeration, error translation |
| `js/recorder.js` | MediaRecorder for video, `toBlob` for stills |
| `shaders/` | One `.frag` per effect, plus the shared preamble |
| `build.mjs` | Folds the lot into one distributable HTML file |
| `serve.mjs` | A local static server, so the page has a `localhost` origin |

## Relationship to the desktop players

The effect files in `shaders/` are byte-for-byte the ones in [Universal
Player](../Universal%20Player). Only the shared preamble differs — it is the
GLSL ES 3.00 twin of the desktop's `#version 330 core` one, deliberately kept
line-for-line equivalent below the header so an effect written for either
compiles unchanged on the other. Write an effect here, drop it in there, and
it works. See [MANUAL.md](MANUAL.md#writing-your-own-effect).
