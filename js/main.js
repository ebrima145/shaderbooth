/*
 * main.js
 *
 * The window: it owns the camera, the chain, the renderer and the input, and
 * it is the only file that touches the DOM.
 *
 * The render loop is free-running on requestAnimationFrame rather than tied to
 * the camera's frame rate, and it uploads the <video> every tick whether or
 * not a new frame has arrived. That looks wasteful and isn't: half the effects
 * are animated by u_time and the feedback family advances its own history
 * every pass, so a 30fps camera through Echo Trails still has to be redrawn 60
 * times a second or the trails move in visible steps. The upload of an
 * unchanged frame is a texture copy the driver is very good at.
 *
 * Nothing is uploaded anywhere. The camera goes to the GPU and to the canvas
 * and stops there; the recorder writes through the browser's own download
 * path. There is no server side to this app at all, which is also why the
 * whole of it can be a folder of static files.
 */

import { EffectLibrary, loadShaderSources } from "./effects.js";
import { EffectChain, MAX_LAYERS } from "./chain.js";
import { Renderer } from "./renderer.js";
import { Camera, RESOLUTIONS } from "./camera.js";
import { Recorder } from "./recorder.js";

const el = (id) => document.getElementById(id);

const dom = {
  app: el("app"),
  canvas: el("output"),
  video: el("feed"),
  message: el("message"),
  status: el("title-status"),
  readout: el("readout"),
  device: el("device"),
  resolution: el("resolution"),
  effect: el("effect"),
  amount: el("amount"),
  amountValue: el("amount-value"),
  chips: el("chips"),
  play: el("btn-play"),
  prev: el("btn-prev"),
  next: el("btn-next"),
  mirror: el("btn-mirror"),
  rec: el("btn-rec"),
  snap: el("btn-snap"),
  add: el("btn-add"),
  del: el("btn-del"),
  down: el("btn-down"),
  up: el("btn-up"),
  full: el("btn-full"),
  help: el("help"),
  helpOpen: el("btn-help"),
  helpClose: el("help-close"),
};

const STORE_KEY = "camera-player";

const app = {
  library: null,
  chain: null,
  renderer: null,
  camera: new Camera(dom.video),
  recorder: null,
  startedAt: performance.now(),
  frames: 0,
  fpsAt: performance.now(),
  fps: 0,
  toast: "",
  toastUntil: 0,
};

// --- messages over the picture ---------------------------------------------

function message(text, isError = false) {
  dom.message.hidden = !text;
  dom.message.classList.toggle("error", isError);
  dom.message.firstElementChild.textContent = text || "";
}

/** A line in the readout that fades back to the resolution after a moment. */
function toast(text, seconds = 2.5) {
  app.toast = text;
  app.toastUntil = performance.now() + seconds * 1000;
}

// --- the saved / shared look -----------------------------------------------

/*
 * A look is a stack, and a stack is short enough to live in the URL - which is
 * the whole trick for sharing one. "#VHS:0.7,Halftone:0.9" is a link that
 * opens this page with that stack already built, so a look travels as a URL
 * rather than as a screen recording and an explanation.
 *
 * localStorage holds the same thing for the next visit, but the hash wins when
 * both are present: someone who followed a link came for what is in the link.
 */

function encodeLook(chain, mirror) {
  const parts = chain.layers.map(
    (layer) => layer.effect.name + ":" + layer.amount.toFixed(2));
  return "#" + encodeURIComponent(parts.join(",")) + (mirror ? "&m=1" : "&m=0");
}

function decodeLook(text) {
  if (!text) return null;
  const [stack, ...rest] = text.replace(/^#/, "").split("&");
  const mirrorFlag = rest.find((p) => p.startsWith("m="));
  const layers = decodeURIComponent(stack).split(",").filter(Boolean).map((part) => {
    const at = part.lastIndexOf(":");
    const name = at < 0 ? part : part.slice(0, at);
    const amount = at < 0 ? null : parseFloat(part.slice(at + 1));
    return { name, amount: Number.isFinite(amount) ? amount : null };
  });
  if (!layers.length) return null;
  return { layers, mirror: mirrorFlag ? mirrorFlag === "m=1" : null };
}

function loadLook() {
  const fromHash = decodeLook(location.hash);
  if (fromHash) return fromHash;
  try {
    return decodeLook(localStorage.getItem(STORE_KEY));
  } catch {
    return null;   // private mode, or storage turned off - not worth an error
  }
}

function saveLook() {
  const text = encodeLook(app.chain, app.renderer.mirror);
  try { localStorage.setItem(STORE_KEY, text); } catch { /* see loadLook */ }
  // replaceState rather than assigning location.hash, which would push a
  // history entry for every nudge of the intensity slider.
  history.replaceState(null, "", text);
}

function applyLook(look) {
  if (!look) return;
  const layers = [];
  for (const entry of look.layers) {
    const effect = app.library.byName(entry.name);
    if (effect && effect.ok) layers.push({ effect, amount: entry.amount });
  }
  if (!layers.length) return;
  app.chain = new EffectChain(app.library, layers.map((l) => l.effect.name));
  layers.forEach((l, i) => {
    if (l.amount !== null && app.chain.layers[i]) app.chain.layers[i].amount = l.amount;
  });
  app.chain.active = 0;
  if (look.mirror !== null) app.renderer.mirror = look.mirror;
}

// --- widgets ----------------------------------------------------------------

function buildEffectMenu() {
  dom.effect.innerHTML = "";
  for (const [heading, effects] of app.library.groups) {
    const group = document.createElement("optgroup");
    group.label = heading;
    for (const effect of effects) {
      const option = document.createElement("option");
      option.value = effect.name;
      option.textContent = effect.name;
      // A shader that failed to build stays in the list, greyed out: an effect
      // that has silently vanished from the menu is a worse bug report than
      // one that is visibly broken.
      option.disabled = !effect.ok;
      if (!effect.ok) option.textContent += "  (failed)";
      group.appendChild(option);
    }
    dom.effect.appendChild(group);
  }
}

function buildDeviceMenu() {
  const devices = app.camera.devices;
  dom.device.innerHTML = "";
  if (!devices.length) {
    const option = document.createElement("option");
    option.textContent = "No camera found";
    dom.device.appendChild(option);
    dom.device.disabled = true;
    return;
  }
  dom.device.disabled = false;
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label;
    dom.device.appendChild(option);
  }
  dom.device.value = app.camera.deviceId || devices[0].deviceId;
  dom.prev.disabled = dom.next.disabled = devices.length < 2;
}

function buildResolutionMenu() {
  dom.resolution.innerHTML = "";
  for (const [label, width, height] of RESOLUTIONS) {
    const option = document.createElement("option");
    option.value = width + "x" + height;
    option.textContent = label;
    dom.resolution.appendChild(option);
  }
  dom.resolution.value = app.camera.width + "x" + app.camera.height;
}

function refresh() {
  const chain = app.chain;

  dom.chips.innerHTML = "";
  chain.layers.forEach((layer, index) => {
    const chip = document.createElement("button");
    chip.className = "chip"
      + (index === chain.active ? " active" : "")
      + (layer.effect.name !== "None" ? " busy" : "");
    chip.textContent = String(index + 1);
    chip.title = "Layer " + (index + 1) + ": " + layer.effect.name
      + " @ " + layer.amount.toFixed(2);
    chip.addEventListener("click", () => {
      if (chain.select(index)) refresh();
    });
    dom.chips.appendChild(chip);
  });

  dom.effect.value = chain.effect.name;
  dom.amount.value = Math.round(chain.amount * 100);
  dom.amountValue.textContent = chain.amount.toFixed(2);

  dom.add.disabled = chain.length >= MAX_LAYERS;
  dom.del.disabled = chain.length <= 1;
  dom.down.disabled = chain.active === 0;
  dom.up.disabled = chain.active === chain.length - 1;

  dom.mirror.classList.toggle("on", app.renderer.mirror);
  dom.play.classList.toggle("playing", app.camera.live);
  dom.rec.classList.toggle("on", app.recorder && app.recorder.recording);

  dom.status.textContent = chain.describe();
  saveLook();
}

/** Wipe the feedback history and reseed it from the live picture. */
function reseed() {
  const seed = app.library.byName("None");
  app.renderer.clearFeedback(app.chain.layers, seed && seed.ok ? seed : null);
}

function editStack(action) {
  if (!action()) return;
  reseed();
  refresh();
}

// --- the camera -------------------------------------------------------------

async function startCamera(deviceId = null) {
  message("Waiting for the camera…");
  try {
    const [width, height] = dom.resolution.value.split("x").map(Number);
    await app.camera.open(deviceId, width, height);
  } catch (exc) {
    message(String(exc.message || exc), true);
    app.renderer.clear();
    refresh();
    return false;
  }
  message("");
  buildDeviceMenu();
  refresh();
  return true;
}

function stopCamera() {
  app.camera.stop();
  app.renderer.clear();
  message("Camera stopped. Press Play to start it again.");
  refresh();
}

async function stepCamera(delta) {
  const next = app.camera.nextDevice(delta);
  if (next) await startCamera(next);
}

// --- the loop ---------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);

  const now = performance.now();
  app.frames += 1;
  if (now - app.fpsAt >= 500) {
    app.fps = Math.round((app.frames * 1000) / (now - app.fpsAt));
    app.frames = 0;
    app.fpsAt = now;
  }

  if (app.camera.live) {
    if (app.renderer.uploadVideo(dom.video)) {
      // A new resolution means new buffers, holding nothing - seed them from
      // the picture so the feedback effects don't restart from black.
      reseed();
    }
    app.renderer.render(app.chain.layers, (now - app.startedAt) / 1000);
  }
  app.renderer.present();
  updateReadout(now);
}

function updateReadout(now) {
  if (app.recorder && app.recorder.recording) {
    const seconds = app.recorder.elapsed;
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
    dom.readout.textContent = "● REC  " + mm + ":" + ss;
    return;
  }
  if (app.toast && now < app.toastUntil) {
    dom.readout.textContent = app.toast;
    return;
  }
  app.toast = "";
  const [width, height] = app.renderer.sourceSize;
  dom.readout.textContent = width
    ? width + " x " + height + "  " + app.fps + "fps"
    : "–";
}

// --- input ------------------------------------------------------------------

function wire() {
  dom.play.addEventListener("click", () => {
    if (app.camera.live) stopCamera(); else startCamera(dom.device.value || null);
  });
  dom.prev.addEventListener("click", () => stepCamera(-1));
  dom.next.addEventListener("click", () => stepCamera(1));

  dom.mirror.addEventListener("click", () => {
    app.renderer.mirror = !app.renderer.mirror;
    reseed();
    refresh();
  });

  dom.device.addEventListener("change", () => startCamera(dom.device.value));
  dom.resolution.addEventListener("change", () => {
    if (app.camera.live) startCamera(dom.device.value || null);
  });

  dom.effect.addEventListener("change", () => {
    editStack(() => app.chain.setEffect(app.library.byName(dom.effect.value)));
  });

  dom.amount.addEventListener("input", () => {
    app.chain.setAmount(dom.amount.value / 100);
    dom.amountValue.textContent = app.chain.amount.toFixed(2);
    saveLook();
  });

  dom.add.addEventListener("click", () => editStack(() => app.chain.add()));
  dom.del.addEventListener("click", () => editStack(() => app.chain.remove()));
  dom.down.addEventListener("click", () => editStack(() => app.chain.move(-1)));
  dom.up.addEventListener("click", () => editStack(() => app.chain.move(1)));

  dom.rec.addEventListener("click", toggleRecording);
  dom.snap.addEventListener("click", takeSnapshot);

  dom.full.addEventListener("click", toggleFullscreen);
  dom.helpOpen.addEventListener("click", () => { dom.help.hidden = false; });
  dom.helpClose.addEventListener("click", () => { dom.help.hidden = true; });
  dom.help.addEventListener("click", (event) => {
    if (event.target === dom.help) dom.help.hidden = true;
  });

  // Clicking the picture when nothing is running is the obvious way to start
  // it, and on a phone it is a much bigger target than the play button.
  dom.message.addEventListener("click", () => {
    if (!app.camera.live) startCamera(dom.device.value || null);
  });

  // A camera can be unplugged, or taken by another app, mid-session.
  navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    await app.camera.listDevices();
    buildDeviceMenu();
  });

  window.addEventListener("keydown", onKey);
  window.addEventListener("beforeunload", () => app.camera.stop());
}

async function toggleRecording() {
  if (!app.recorder) return;
  if (app.recorder.recording) {
    const filename = await app.recorder.stop();
    toast("saved " + (filename || ""), 3);
  } else {
    if (!app.renderer.hasOutput) return toast("nothing to record", 2);
    try {
      app.recorder.start();
    } catch (exc) {
      return message(String(exc.message || exc), true);
    }
  }
  refresh();
}

async function takeSnapshot() {
  if (!app.renderer.hasOutput) return toast("nothing to save", 2);
  const filename = await app.recorder.snapshot();
  toast("saved " + (filename || ""), 3);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else dom.app.requestFullscreen?.().catch(() => toast("fullscreen refused", 2));
}

function onKey(event) {
  // Typing in a widget belongs to the widget: "s" in the effect list jumps to
  // Sepia, and stealing it to save a still would be maddening.
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") {
    if (event.key !== "Escape") return;
  }
  if (event.metaKey || event.altKey) return;

  const chain = app.chain;
  const key = event.key;

  if (key === "Escape") {
    if (!dom.help.hidden) dom.help.hidden = true;
    else if (document.fullscreenElement) document.exitFullscreen();
    else document.activeElement?.blur?.();
  } else if (key === " ") {
    if (app.camera.live) stopCamera(); else startCamera(dom.device.value || null);
  } else if (key === "Tab") {
    stepCamera(1);
  } else if (event.ctrlKey && (key === "ArrowLeft" || key === "ArrowRight")) {
    stepCamera(key === "ArrowLeft" ? -1 : 1);
  } else if (event.ctrlKey) {
    return;   // leave the browser's own Ctrl shortcuts alone
  } else if (key === "[" || key === "]") {
    editStack(() => chain.stepEffect(key === "[" ? -1 : 1));
  } else if (key === "-" || key === "_") {
    chain.setAmount(chain.amount - 0.05);
    refresh();
  } else if (key === "+" || key === "=") {
    chain.setAmount(chain.amount + 0.05);
    refresh();
  } else if (key === "0") {
    chain.resetAmount();
    refresh();
  } else if (key >= "1" && key <= "6") {
    if (chain.select(Number(key) - 1)) refresh();
  } else if (key === "a" || key === "A") {
    editStack(() => chain.add());
  } else if (key === "d" || key === "D") {
    editStack(() => chain.remove());
  } else if (key === "," || key === "<") {
    editStack(() => chain.move(-1));
  } else if (key === "." || key === ">") {
    editStack(() => chain.move(1));
  } else if (key === "m" || key === "M") {
    dom.mirror.click();
  } else if (key === "r" || key === "R") {
    toggleRecording();
  } else if (key === "s" || key === "S") {
    takeSnapshot();
  } else if (key === "f" || key === "F") {
    toggleFullscreen();
  } else {
    return;
  }
  event.preventDefault();
}

// --- boot -------------------------------------------------------------------

async function boot() {
  message("Compiling shaders…");

  try {
    app.renderer = new Renderer(dom.canvas);
  } catch (exc) {
    return message(
      String(exc.message || exc)
      + " Every browser released since 2021 has it; if this is a desktop machine, "
      + "hardware acceleration may be turned off in the browser's settings.", true);
  }

  let sources;
  try {
    sources = await loadShaderSources();
  } catch (exc) {
    return message(
      "Could not load the shaders (" + (exc.message || exc) + "). If you opened "
      + "this from a file:// path, that is why - the page has to be served over "
      + "http. Use the single-file build instead, or run a local server.", true);
  }

  app.library = new EffectLibrary(app.renderer.gl, sources);
  app.chain = new EffectChain(app.library);
  app.recorder = new Recorder(dom.canvas, 30);

  buildEffectMenu();
  buildResolutionMenu();
  buildDeviceMenu();
  applyLook(loadLook());
  wire();
  refresh();

  if (!Recorder.available) {
    dom.rec.disabled = true;
    dom.rec.title = "This browser cannot record video from a canvas";
  }

  requestAnimationFrame(frame);

  // The camera is not opened until asked for. Opening it on load would put a
  // permission prompt in front of someone who has not yet seen what the page
  // is, which is the fastest way to be denied it.
  message("Press Play, or click here, to start the camera.\n"
    + "Nothing you see leaves this page.");
}

boot();
