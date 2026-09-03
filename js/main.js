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

import { EffectLibrary, HEAVY, loadShaderSources } from "./effects.js";
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
  msgTitle: el("msg-title"),
  msgBody: el("msg-body"),
  start: el("btn-start"),
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
  quickRec: el("btn-quick-rec"),
  quickSnap: el("btn-quick-snap"),
  add: el("btn-add"),
  del: el("btn-del"),
  down: el("btn-down"),
  up: el("btn-up"),
  shuffle: el("btn-shuffle"),
  looks: el("looks"),
  looksList: el("looks-list"),
  looksEmpty: el("looks-empty"),
  looksOpen: el("btn-looks"),
  looksSave: el("looks-save"),
  looksClose: el("looks-close"),
  full: el("btn-full"),
  keyFullscreen: el("key-fullscreen"),
  max: el("btn-max"),
  titlebar: el("titlebar"),
  stage: el("stage"),
  controlbar: el("controlbar"),
  settings: el("settings"),
  settingsFields: el("settings-fields"),
  settingsOpen: el("btn-settings"),
  settingsClose: el("settings-close"),
  settingsReload: el("settings-reload"),
  flash: el("flash"),
  help: el("help"),
  helpOpen: el("btn-help"),
  helpClose: el("help-close"),
};

const STORE_KEY = "shaderbooth";
// Kept apart from the look, which travels in the URL: how big your window
// is says nothing about the picture and has no business in a shared link.
const WINDOW_KEY = "shaderbooth-window";
const LOOKS_KEY = "shaderbooth-looks";
// Enough to keep the ones worth keeping, few enough that the list stays a
// list rather than an archive nobody reads.
const MAX_LOOKS = 12;

/*
 * Whether the primary input is a finger.
 *
 * "(pointer: coarse)" describes the *primary* pointer, which is what decides
 * the interface: a laptop with a touchscreen still wants the mouse-sized one.
 * Read once, because it does not change without a reload, and used for three
 * separate decisions - flip instead of cycle, share instead of download, and
 * bigger hit targets.
 */
const TOUCH = matchMedia("(pointer: coarse)").matches;

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
  // How long the frame rate has been on the floor, and whether we have already
  // said so. See noticeSlowness().
  slowSince: 0,
  warnedSlow: false,
  idleTimer: 0,
  unpinTimer: 0,
};

// How long the bars wait after your last touch before folding away. Long
// enough to line up a second adjustment without them vanishing mid-reach,
// short enough that idly watching the picture gets you the whole screen.
const CHROME_IDLE_MS = 3500;

/*
 * Gesture thresholds.
 *
 * EDGE keeps the leftmost strip out of it: iOS uses that for its own back
 * gesture, and a swipe starting there belongs to Safari whatever this app
 * thinks. TAP_SLOP is how far a finger may wander and still count as a tap,
 * because nobody lifts one off cleanly.
 */
const EDGE = 24;
const SWIPE = 45;
const TAP_SLOP = 12;
const DOUBLE_TAP_MS = 300;

// --- messages over the picture ---------------------------------------------

/*
 * The dialog over the stage, in one of three moods:
 *
 *   "start"  an invitation, with the button and the shortcut
 *   "busy"   a bare line while something is happening
 *   "error"  a headline and what to do about it, no button
 *
 * Passing no title hides it. Keeping the three in one function is what stops
 * the stage ending up with a start button sitting on top of an error.
 */
function message(title, body = "", mode = "busy") {
  dom.message.hidden = !title;
  dom.message.className = title ? mode : "";
  dom.msgTitle.textContent = title || "";
  dom.msgBody.textContent = body || "";
  dom.msgBody.hidden = !body;
}

/**
 * Say what just happened, over the picture.
 *
 * The readout does this job whenever the bars are up, so this is only for the
 * moments they are not - which on a phone is most of them.
 */
let flashTimer = 0;
function flash(text) {
  dom.flash.textContent = text;
  dom.flash.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => dom.flash.classList.remove("on"), 900);
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

/*
 * Saved looks.
 *
 * The address bar already holds the current one, and a link carries it - that
 * is genuinely most of the feature, and it is why this stays small. What a
 * link cannot do is let you keep six of them and flick between them, which is
 * the difference between a toy and something you work in.
 *
 * Stored as the same encoded string the URL uses, so a saved look and a shared
 * look are the same object and neither can drift from the other.
 *
 * Named from the chain rather than by asking. A prompt for a name is a
 * question most people answer with "asdf", and "VHS > Bloom > Halftone" says
 * more about the look than any name someone would type in a hurry.
 */
function readLooks() {
  try { return JSON.parse(localStorage.getItem(LOOKS_KEY)) || []; } catch { return []; }
}

function writeLooks(list) {
  try { localStorage.setItem(LOOKS_KEY, JSON.stringify(list)); } catch { /* see loadLook */ }
}

function saveCurrentLook() {
  const list = readLooks();
  list.unshift({
    name: app.chain.describe(),
    look: encodeLook(app.chain, app.renderer.mirror),
  });
  writeLooks(list.slice(0, MAX_LOOKS));
  buildLooks();
  toast("look saved", 2);
}

function buildLooks() {
  const list = readLooks();
  dom.looksList.innerHTML = "";
  dom.looksEmpty.hidden = list.length > 0;

  list.forEach((entry, index) => {
    const row = document.createElement("li");

    const recall = document.createElement("button");
    recall.className = "recall";
    recall.textContent = entry.name;
    recall.title = "Use this look";
    recall.addEventListener("click", () => {
      applyLook(decodeLook(entry.look));
      reseed();
      refresh();
      closeSheet(dom.looks);
    });

    const drop = document.createElement("button");
    drop.className = "drop";
    drop.textContent = "\u00d7";
    drop.title = "Forget this look";
    drop.setAttribute("aria-label", "Forget " + entry.name);
    drop.addEventListener("click", () => {
      const kept = readLooks();
      kept.splice(index, 1);
      writeLooks(kept);
      buildLooks();
    });

    row.append(recall, drop);
    dom.looksList.appendChild(row);
  });
}

/*
 * A random stack, with just enough taste to be worth pressing twice.
 *
 * Not uniformly random: the pass-through is excluded because a layer of
 * nothing is not a surprise, no effect appears twice in one stack, and at most
 * one of the expensive three gets in - six passes of Kuwahara is not a look,
 * it is a slideshow. Two to four layers, because one is barely a stack and
 * five is usually mud.
 *
 * Amounts are jittered around each effect's own default rather than picked
 * across the whole range, so every effect still arrives looking like itself.
 */
function surprise() {
  const pool = app.library.effects.filter((e) => e.ok && e.name !== "None");
  if (!pool.length) return;

  const depth = 2 + Math.floor(Math.random() * (TOUCH ? 2 : 3));
  const picked = [];
  let heavy = 0;

  for (let tries = 0; tries < 200 && picked.length < depth; tries++) {
    const effect = pool[Math.floor(Math.random() * pool.length)];
    if (picked.includes(effect)) continue;
    if (HEAVY.has(effect.name)) {
      if (heavy) continue;
      heavy += 1;
    }
    picked.push(effect);
  }
  if (!picked.length) return;

  app.chain = new EffectChain(app.library, picked.map((e) => e.name));
  for (const layer of app.chain.layers) {
    const spread = (Math.random() - 0.5) * 0.4;
    layer.amount = Math.max(0.1, Math.min(1, layer.effect.defaultAmount + spread));
  }
  app.chain.active = app.chain.layers.length - 1;
  reseed();
  refresh();
  toast(app.chain.describe(), 3);
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
      // Named rather than hidden: the cost is worth knowing before you pick,
      // and on a phone these three are the difference between 60fps and 8.
      else if (HEAVY.has(effect.name)) option.textContent += "  (heavy)";
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
      + (layer.effect.name === "None" ? " empty" : "");
    chip.title = "Layer " + (index + 1) + ": " + layer.effect.name
      + " @ " + layer.amount.toFixed(2);

    const position = document.createElement("span");
    position.className = "chip-n";
    position.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = layer.effect.name;

    chip.append(position, name);
    chip.addEventListener("click", () => {
      if (chain.select(index)) refresh();
    });
    if (!TOUCH) chip.addEventListener("pointerdown", (event) => startTabDrag(event, index));
    dom.chips.appendChild(chip);
  });

  dom.effect.value = chain.effect.name;
  syncAmount();

  dom.add.disabled = chain.length >= MAX_LAYERS;
  dom.del.disabled = chain.length <= 1;
  dom.down.disabled = chain.active === 0;
  dom.up.disabled = chain.active === chain.length - 1;

  dom.mirror.classList.toggle("on", app.renderer.mirror);
  dom.play.classList.toggle("playing", app.camera.live);
  const recording = !!(app.recorder && app.recorder.recording);
  dom.rec.classList.toggle("on", recording);
  dom.quickRec.classList.toggle("on", recording);
  // Opens the lens in the title bar while there is a picture.
  dom.app.classList.toggle("live", app.camera.live);
  // Keeps the title bar up while a take runs, so the tally never hides.
  dom.app.classList.toggle("recording", recording);

  dom.status.textContent = chain.describe();
  saveLook();
}

/**
 * Put the whole trackbar in step with the layer: the thumb, the green behind
 * it, and the number beside it.
 *
 * All three, from one place, because they were not. The thumb was set in
 * refresh() while the other two were set here, so the wheel - which calls this
 * and not that - moved the fill and the number and left the thumb standing
 * where it was. Anything that can drift apart eventually does; the fix is for
 * there to be nowhere left to update only two of the three.
 *
 * Setting `value` from a value that came out of `value` round-trips exactly,
 * so this is a no-op on the drag path rather than a fight with it.
 *
 * The green is a gradient sized by a custom property because Chromium has no
 * native progress on a range input, and without it the one control whose whole
 * job is holding a value never looks like it is holding one.
 */
function syncAmount() {
  const amount = app.chain.amount;
  dom.amount.value = Math.round(amount * 100);
  dom.amount.style.setProperty("--fill", Math.round(amount * 100) + "%");
  dom.amountValue.textContent = amount.toFixed(2);
}

/*
 * Folding the bars away, and getting them back.
 *
 * max-height has nothing to interpolate against `none`, so collapsing needs a
 * real number to animate away from. That number is taken at the moment of
 * hiding and pinned inline, then released once the bar is open again - rather
 * than being kept in a variable that then has to be maintained.
 *
 * The ordering is the entire point. Measuring after *showing* reads a bar that
 * is still a few pixels tall because its own transition has only just started,
 * pins the ceiling to that, and leaves the bar permanently stuck part-open. It
 * looks like the animation failing; it is actually the measurement being taken
 * a frame too early.
 *
 * Between hide and reveal the only thing that can change the bar's height on a
 * phone is a rotation, which is handled by simply showing the chrome again.
 */
function chromeHidden() {
  return dom.app.classList.contains("chrome-hidden");
}

/*
 * Whether the bars fold away *on their own* after a few idle seconds.
 *
 * On a phone, always - the screen is small and the chrome was half of it. On a
 * desktop, only in fullscreen, because that is the one time someone has said
 * in as many words that they want the picture and nothing else. A window
 * sitting on a desktop that quietly hid its own controls would just be losing
 * them, and you would have to discover the way back.
 *
 * Folding them *by hand* is a different question and has no such gate: see
 * toggleChrome(). Asking for it is asking for it, at any window size.
 */
function chromeAutoFolds() {
  return TOUCH || !!document.fullscreenElement;
}

function hideChrome() {
  if (chromeHidden()) return;
  clearTimeout(app.unpinTimer);
  // Pin the height it has right now, flush the layout so the browser has a
  // number to start from, then collapse.
  // Written as a custom property, not as an inline max-height: an inline
  // declaration outranks any selector, so pinning it directly would beat the
  // rule that collapses the bar and it would only ever shrink by its padding.
  dom.controlbar.style.setProperty("--pin", dom.controlbar.offsetHeight + "px");
  void dom.controlbar.offsetHeight;
  dom.app.classList.add("chrome-hidden");
}

function revealChrome() {
  if (!chromeHidden()) return;
  dom.app.classList.remove("chrome-hidden");
  // Released once it is fully open, so the bar is free to size itself again
  // when the stack grows a row. Comfortably past the 300ms collapse.
  clearTimeout(app.unpinTimer);
  app.unpinTimer = setTimeout(() => {
    if (!chromeHidden()) dom.controlbar.style.removeProperty("--pin");
  }, 360);
}

/** Bring the bars back, and restart the countdown to hiding them again. */
function showChrome() {
  clearTimeout(app.idleTimer);
  revealChrome();
  // Only armed where the bars fold on their own, and only with a picture worth
  // uncovering. A dialog counts as being mid-task, so the bars stay put behind
  // it.
  if (!chromeAutoFolds() || !app.camera.live) return;
  if (!dom.help.hidden || !dom.settings.hidden || !dom.looks.hidden) return;
  app.idleTimer = setTimeout(() => {
    if (dom.help.hidden && dom.settings.hidden && dom.looks.hidden
        && app.camera.live) hideChrome();
  }, CHROME_IDLE_MS);
}

/*
 * Maximise: the third caption button the chrome always implied.
 *
 * The window is capped at 1100x760, and on anything bigger than a laptop that
 * leaves the picture the same size while the screen around it grows. This
 * fills the browser and keeps the browser's own chrome, which is what makes it
 * a different thing from fullscreen rather than a duplicate of it.
 */
function setMaximised(on) {
  document.body.classList.toggle("maximised", on);
  dom.max.title = on ? "Restore the window" : "Maximise the window";
  dom.max.setAttribute("aria-label", dom.max.title);
  try { localStorage.setItem(WINDOW_KEY, on ? "max" : ""); } catch { /* see loadLook */ }
}

/**
 * What a click or a tap on the picture does once there is a picture.
 *
 * Works at every window size - windowed, maximised and fullscreen alike.
 * Deciding to put the controls away is a decision, and there is no reason a
 * 1100px window should refuse one that fullscreen accepts; the reveal is the
 * same click, so nothing is stranded.
 *
 * A live picture is still required. Hiding the controls over a black rectangle
 * would leave nothing to look at and nothing obvious to press.
 */
function toggleChrome() {
  if (!app.camera.live) return;
  if (chromeHidden()) return showChrome();
  clearTimeout(app.idleTimer);
  hideChrome();
}

function openSheet(sheet) {
  clearTimeout(app.idleTimer);
  showChrome();
  clearTimeout(app.idleTimer);
  sheet.hidden = false;
}

function closeSheet(sheet) {
  sheet.hidden = true;
  showChrome();
}

/*
 * Dragging a tab to a new position in the chain.
 *
 * Order is what this app is about, and rearranging it used to be two steps -
 * select the tab, then click an arrow - for the interaction the whole thing is
 * built around.
 *
 * Pointer events rather than HTML5 drag-and-drop, which cannot be styled, does
 * not report positions usefully, and drags a ghost image nobody asked for.
 *
 * Mouse only. On a phone the strip scrolls horizontally and a horizontal drag
 * cannot mean two things at once.
 */
function startTabDrag(event, from) {
  if (event.button !== 0) return;
  const strip = dom.chips;
  const chips = [...strip.children];
  const dragged = chips[from];
  // Centres captured once, from the layout before anything moved: the target
  // has to be computed against where the tabs *were*, not against positions
  // that are themselves being shifted by this drag.
  const centres = chips.map((c) => c.getBoundingClientRect().left + c.offsetWidth / 2);
  const shift = dragged.offsetWidth + 3;   // the gap between tabs, from the CSS
  const startX = event.clientX;
  let to = from;
  let moved = false;

  const onMove = (move) => {
    const dx = move.clientX - startX;
    // A few pixels of slack, so a click that wobbles is still a click.
    if (!moved && Math.abs(dx) < 5) return;
    if (!moved) {
      moved = true;
      dragged.classList.add("dragging");
      strip.classList.add("reordering");
    }

    // How many tabs, ignoring the one in hand, now sit left of the pointer.
    // That count *is* the index it would land at.
    const x = move.clientX;
    to = 0;
    centres.forEach((centre, i) => { if (i !== from && centre < x) to += 1; });

    dragged.style.transform = "translateX(" + dx + "px)";
    chips.forEach((chip, i) => {
      if (i === from) return;
      let slide = 0;
      if (from < to && i > from && i <= to) slide = -shift;
      if (from > to && i >= to && i < from) slide = shift;
      chip.style.transform = slide ? "translateX(" + slide + "px)" : "";
    });
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    strip.classList.remove("reordering");
    dragged.classList.remove("dragging");
    for (const chip of chips) chip.style.transform = "";
    if (!moved) return;

    // A drag also ends in a click, and that click is not a selection. It cannot
    // be handled with a flag on the tab, because refresh() below replaces every
    // tab before the click arrives - so the click lands on a brand new element
    // that knows nothing about the drag. Suppressing it at the container in the
    // capture phase catches it wherever it lands, and the listener removes
    // itself either way: a flag that outlives its click would silently eat the
    // next real one.
    const swallow = (click) => click.stopPropagation();
    strip.addEventListener("click", swallow, true);
    setTimeout(() => strip.removeEventListener("click", swallow, true), 250);

    if (app.chain.moveTo(from, to)) {
      reseed();
      refresh();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/*
 * The picture as a control surface.
 *
 * Three gestures, and the awkward one is the overlap between a tap and the
 * first half of a double-tap. The usual fix is to delay every tap by the
 * double-tap window, but the tap here toggles the bars - the most frequent
 * thing anyone does - and 300ms of lag on that to serve an occasional flip is
 * the wrong trade.
 *
 * So the tap acts at once, and a second tap flips the camera *and* toggles the
 * bars back, cancelling what the first one did. CSS transitions interrupt and
 * reverse smoothly, so the visible cost is the bars twitching a few pixels
 * rather than a flash of the whole control bar.
 *
 * Touch only. A mouse keeps the plain click-to-toggle: there is no swiping
 * with a mouse, and a double-click that flipped the camera would be a trap.
 */
function wireStageGestures() {
  if (!TOUCH) {
    dom.stage.addEventListener("pointerdown", (event) => {
      if (event.target === dom.canvas || event.target === dom.stage) toggleChrome();
    });
    return;
  }

  let from = null;
  let swiped = false;
  let lastTap = 0;
  let lastX = 0;
  let lastY = 0;

  const onStage = (event) =>
    event.target === dom.canvas || event.target === dom.stage;

  dom.stage.addEventListener("pointerdown", (event) => {
    if (!onStage(event) || event.clientX < EDGE) { from = null; return; }
    from = { x: event.clientX, y: event.clientY };
    swiped = false;
  });

  dom.stage.addEventListener("pointermove", (event) => {
    if (!from || swiped) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    // Has to be decisively sideways, or every slightly-diagonal drag towards
    // the shutter would change the effect on the way.
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    swiped = true;
    // One step per swipe, however far the finger keeps going: a gesture that
    // kept firing would race past whatever you were looking for.
    if (app.chain.stepEffect(dx < 0 ? 1 : -1)) {
      reseed();
      refresh();
      flash(app.chain.effect.name);
    }
  });

  const end = (event) => {
    const start = from;
    from = null;
    if (!start || swiped) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;

    const now = performance.now();
    const near = Math.hypot(event.clientX - lastX, event.clientY - lastY) < 44;
    if (now - lastTap < DOUBLE_TAP_MS && near) {
      lastTap = 0;
      toggleChrome();        // undo what the first tap of this pair just did
      // Named after the flip resolves, not before it. Announcing the camera we
      // are about to ask for would still say "Back camera" on a phone that
      // refused to give us one.
      flipCamera().then(() => {
        if (app.camera.live) flash(app.camera.isFrontFacing ? "Front camera" : "Back camera");
      });
      return;
    }
    lastTap = now;
    lastX = event.clientX;
    lastY = event.clientY;
    toggleChrome();
  };

  dom.stage.addEventListener("pointerup", end);
  dom.stage.addEventListener("pointercancel", () => { from = null; });
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

async function startCamera({ deviceId = null, facing = null } = {}) {
  message("Waiting for the camera…");
  const before = app.camera.facing;
  try {
    const [width, height] = dom.resolution.value.split("x").map(Number);
    await app.camera.open({ deviceId, facing, width, height });
  } catch (exc) {
    message("No picture", String(exc.message || exc), "error");
    app.renderer.clear();
    refresh();
    return false;
  }

  // The mirror follows the lens. A front camera should read as a mirror,
  // because that is what a person expects of their own face; a back camera
  // should read as a window, because it is pointed at the world and flipping
  // that makes text unreadable. Only on an actual change, so that a manual
  // toggle survives a resolution change or a reopen of the same camera.
  if (app.camera.facing && app.camera.facing !== before) {
    app.renderer.mirror = app.camera.isFrontFacing;
    reseed();
  }

  message("");
  buildDeviceMenu();
  refresh();
  showChrome();
  return true;
}

function stopCamera() {
  app.camera.stop();
  app.renderer.clear();
  message("Camera stopped",
          "Nothing is being captured. Start it again whenever you like.",
          "start");
  refresh();
  showChrome();
}

/**
 * Move to another camera.
 *
 * On a phone that means the other side of the device, which is the only
 * distinction anyone means; on a desktop it means the next attached camera in
 * the list.
 */
async function stepCamera(delta) {
  if (TOUCH) return flipCamera();
  const next = app.camera.nextDevice(delta);
  if (next) await startCamera({ deviceId: next });
}

async function flipCamera() {
  await startCamera({ facing: app.camera.otherFacing() });
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
  noticeSlowness(now);
}

/*
 * The readout has one slot and three things that want it, in priority order:
 * the running take, a just-saved confirmation, and otherwise what the signal
 * is. Recording outranks the rest because it is the only one you cannot
 * recover if you miss it.
 */
/**
 * Mention it once when the frame rate is on the floor.
 *
 * Measured rather than predicted: there is no way to guess from a user agent
 * string what a given phone will do with six passes of Kuwahara, so the app
 * watches what it actually gets. Sustained for two seconds before saying
 * anything, because the frames right after a camera opens or a stack changes
 * are always slow and warning about those would be noise. Once per session,
 * because the readout carries the live number anyway and repeating a complaint
 * about something you already chose to do is nagging.
 *
 * Deliberately a toast rather than the stage dialog. Being slow is not an
 * error - the picture is still there and still worth looking at - and covering
 * it with something you cannot dismiss to say so would be a worse experience
 * than the low frame rate.
 */
function noticeSlowness(now) {
  const bad = app.camera.live && app.fps > 0 && app.fps < 20;
  if (!bad) { app.slowSince = 0; return; }
  if (!app.slowSince) { app.slowSince = now; return; }
  if (app.warnedSlow || now - app.slowSince < 2000) return;

  app.warnedSlow = true;
  toast(app.fps + "fps - try a smaller size or fewer layers", 6);
}

function updateReadout(now) {
  const set = (text, tone) => {
    dom.readout.textContent = text;
    dom.readout.className = tone || "";
  };

  if (app.recorder && app.recorder.recording) {
    const seconds = app.recorder.elapsed;
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
    set("● REC  " + mm + ":" + ss, "rec");
    return;
  }
  if (app.toast && now < app.toastUntil) {
    set(app.toast);
    return;
  }
  app.toast = "";
  // Gated on the camera rather than on the buffers: the renderer keeps the
  // last source size after a stop, so reading it alone leaves a resolution on
  // screen for a picture that is no longer arriving.
  const [width, height] = app.renderer.sourceSize;
  if (!app.camera.live || !width) return set("no signal");
  set(width + " x " + height + "  " + app.fps + "fps", "live");
}

// --- input ------------------------------------------------------------------

function wire() {
  dom.play.addEventListener("click", () => {
    if (app.camera.live) stopCamera(); else startCamera({ deviceId: dom.device.value || null });
  });
  dom.prev.addEventListener("click", () => stepCamera(-1));
  dom.next.addEventListener("click", () => stepCamera(1));

  dom.mirror.addEventListener("click", () => {
    app.renderer.mirror = !app.renderer.mirror;
    reseed();
    refresh();
  });

  dom.device.addEventListener("change", () => startCamera({ deviceId: dom.device.value }));
  dom.resolution.addEventListener("change", () => {
    if (!app.camera.live) return;
    // Reopening for a new size: keep whichever side of the phone is showing,
    // rather than falling back to a deviceId that may name a different lens.
    if (TOUCH && app.camera.facing) startCamera({ facing: app.camera.facing });
    else startCamera({ deviceId: dom.device.value || null });
  });

  dom.effect.addEventListener("change", () => {
    editStack(() => app.chain.setEffect(app.library.byName(dom.effect.value)));
  });

  // Everyone tries this and nothing happened. preventDefault so the page does
  // not scroll out from under the gesture.
  dom.amount.addEventListener("wheel", (event) => {
    event.preventDefault();
    app.chain.setAmount(app.chain.amount + (event.deltaY < 0 ? 0.02 : -0.02));
    syncAmount();
    saveLook();
  }, { passive: false });

  dom.amount.addEventListener("input", () => {
    app.chain.setAmount(dom.amount.value / 100);
    syncAmount();
    saveLook();
  });

  dom.add.addEventListener("click", () => editStack(() => app.chain.add()));
  dom.del.addEventListener("click", () => editStack(() => app.chain.remove()));
  dom.down.addEventListener("click", () => editStack(() => app.chain.move(-1)));
  dom.up.addEventListener("click", () => editStack(() => app.chain.move(1)));

  dom.shuffle.addEventListener("click", surprise);

  dom.looksOpen.addEventListener("click", () => { buildLooks(); openSheet(dom.looks); });
  dom.looksClose.addEventListener("click", () => closeSheet(dom.looks));
  dom.looksSave.addEventListener("click", saveCurrentLook);
  dom.looks.addEventListener("click", (event) => {
    if (event.target === dom.looks) closeSheet(dom.looks);
  });

  dom.rec.addEventListener("click", toggleRecording);
  dom.snap.addEventListener("click", takeSnapshot);

  // The floating pair, which only exists while the bars are away. Deliberately
  // not wired to showChrome: capturing is the one thing you do *while*
  // watching, so reaching for the shutter must not put the furniture back.
  dom.quickRec.addEventListener("click", toggleRecording);
  dom.quickSnap.addEventListener("click", takeSnapshot);

  dom.full.addEventListener("click", toggleFullscreen);
  dom.max.addEventListener("click", () => {
    setMaximised(!document.body.classList.contains("maximised"));
  });

  /*
   * Entering fullscreen folds the bars at once rather than after the idle
   * wait. Pressing F is already someone saying, in as many words, that they
   * want the picture and nothing else - making them then hold still for three
   * and a half seconds to get it is answering a question they did not ask. On
   * a phone the fold is ambient and a delay is right; here it is a command.
   *
   */
  document.addEventListener("fullscreenchange", () => {
    const entering = !!document.fullscreenElement;
    if (entering && app.camera.live && dom.help.hidden && dom.settings.hidden
        && dom.looks.hidden) {
      hideChrome();
    } else {
      showChrome();
    }
  });

  /*
   * Moving the mouse deliberately does NOT bring the bars back.
   *
   * It did, which is how a video player behaves - and it was wrong here for a
   * reason specific to this layout. The bars are in flow, so revealing them
   * shrinks the stage, which moves the floating shutter that sits against its
   * bottom edge. Reaching for record therefore summoned the bars and slid the
   * button out from under the pointer on the way. The one gesture that had to
   * work in fullscreen was the one the reveal broke.
   *
   * So in fullscreen the bars stay down, and record and still stay reachable
   * on their own. Clicking the picture is the way back, which is deliberate
   * rather than incidental, and every key still works throughout.
   *
   * Hovering the bars while they *are* up keeps them up, so they cannot fold
   * out from under a hand on its way to a control. Throttled, because
   * pointermove fires per pixel and each call resets a timer.
   */
  if (!TOUCH) {
    let lastHover = 0;
    const keepUp = () => {
      // Hold an open bar, never reopen a folded one. A collapsed bar is zero
      // pixels tall and cannot be hovered in practice, but saying so here is
      // what stops this from quietly becoming the reveal-on-move it replaced.
      if (chromeHidden()) return;
      const now = performance.now();
      if (now - lastHover < 400) return;
      lastHover = now;
      showChrome();
    };
    dom.controlbar.addEventListener("pointermove", keepUp);
    dom.titlebar.addEventListener("pointermove", keepUp);
  }
  dom.settingsOpen.addEventListener("click", () => openSheet(dom.settings));
  dom.settingsClose.addEventListener("click", () => closeSheet(dom.settings));
  // The only way back from a wedged app once it is running from a home screen,
  // where there is no address bar and no reload button.
  dom.settingsReload.addEventListener("click", () => location.reload());
  dom.settings.addEventListener("click", (event) => {
    if (event.target === dom.settings) closeSheet(dom.settings);
  });

  // Touching a control is a reason to keep the bars up; touching the picture
  // is how you ask for them to go, or come back.
  for (const type of ["pointerdown", "input", "change"]) {
    dom.controlbar.addEventListener(type, showChrome);
    dom.titlebar.addEventListener(type, showChrome);
  }
  wireStageGestures();
  dom.helpOpen.addEventListener("click", () => openSheet(dom.help));
  dom.helpClose.addEventListener("click", () => closeSheet(dom.help));
  dom.help.addEventListener("click", (event) => {
    if (event.target === dom.help) closeSheet(dom.help);
  });

  dom.start.addEventListener("click", () => startCamera({ deviceId: dom.device.value || null }));

  // The dialog has a button now, but the whole overlay stays clickable: on a
  // phone it is a much bigger target than anything inside it.
  dom.message.addEventListener("click", (event) => {
    if (event.target === dom.message && !app.camera.live) {
      startCamera({ deviceId: dom.device.value || null });
    }
  });

  // A camera can be unplugged, or taken by another app, mid-session.
  navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    await app.camera.listDevices();
    buildDeviceMenu();
  });

  window.addEventListener("keydown", onKey);
  window.addEventListener("orientationchange", () => {
    dom.controlbar.style.removeProperty("--pin");
    showChrome();
  });
  window.addEventListener("beforeunload", () => app.camera.stop());
}

async function toggleRecording() {
  if (!app.recorder) return;
  if (app.recorder.recording) {
    reportSave(await app.recorder.stop());
  } else {
    if (!app.renderer.hasOutput) return toast("nothing to record", 2);
    try {
      app.recorder.start();
    } catch (exc) {
      return message("Cannot record", String(exc.message || exc), "error");
    }
  }
  refresh();
}

async function takeSnapshot() {
  if (!app.renderer.hasOutput) return toast("nothing to save", 2);
  reportSave(await app.recorder.snapshot());
}

/**
 * Say what actually happened to the file.
 *
 * Three outcomes, and claiming the wrong one is worse than saying nothing: it
 * was downloaded, it went to the share sheet and from there to wherever the
 * person chose, or they dismissed the sheet and there is no file at all.
 */
function reportSave(result) {
  if (!result) return toast("not saved", 2);
  toast((result.shared ? "shared " : "saved ") + result.name, 3);
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
    if (!dom.looks.hidden) closeSheet(dom.looks);
    else if (!dom.settings.hidden) closeSheet(dom.settings);
    else if (!dom.help.hidden) closeSheet(dom.help);
    else if (document.fullscreenElement) document.exitFullscreen();
    else document.activeElement?.blur?.();
  } else if (key === " ") {
    if (app.camera.live) stopCamera(); else startCamera({ deviceId: dom.device.value || null });
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
  } else if (key === "x" || key === "X") {
    surprise();
  } else if (key === "f" || key === "F") {
    toggleFullscreen();
  } else {
    return;
  }
  showChrome();
  event.preventDefault();
}

/**
 * What changes when the primary input is a finger.
 *
 * Only the parts that cannot be done in CSS. With two cameras "previous" and
 * "next" are the same button pressed twice, so one of them goes and the other
 * becomes a flip - the affordance every phone camera app has had for fifteen
 * years, in the place the hand already is.
 */
function applyTouchLayout() {
  document.documentElement.classList.add("touch");
  dom.prev.hidden = true;
  dom.next.title = "Switch camera";
  dom.next.setAttribute("aria-label", "Switch camera");

  // The two set-once controls move into a sheet. Moved rather than copied:
  // these are the same elements with the same listeners, just parented
  // somewhere that is not costing 76px of a 812px screen at all times.
  dom.settingsOpen.hidden = false;
  dom.settingsFields.append(dom.device.closest(".field"),
                            dom.resolution.closest(".field"));

  // The title bar was showing the effect chain, which the tab strip spells out
  // in full a few pixels below it. The readout is not a duplicate of anything,
  // so it gets the space instead.
  dom.status.hidden = true;
  dom.titlebar.insertBefore(dom.readout, el("title-buttons"));
}

// --- boot -------------------------------------------------------------------

async function boot() {
  message("Compiling shaders…");

  try {
    app.renderer = new Renderer(dom.canvas);
  } catch (exc) {
    return message("This browser cannot run the effects",
      String(exc.message || exc)
      + " Every browser released since 2021 has it; if this is a desktop machine, "
      + "hardware acceleration may be turned off in the browser's settings.", "error");
  }

  let sources;
  try {
    sources = await loadShaderSources();
  } catch (exc) {
    return message("Could not load the shaders",
      (exc.message || exc) + ". If you opened this from a file:// path, that is "
      + "why - the page has to be served over http. Run a local server, or use "
      + "the single-file build.", "error");
  }

  app.library = new EffectLibrary(app.renderer.gl, sources);
  app.chain = new EffectChain(app.library);
  app.recorder = new Recorder(dom.canvas, 30);

  /*
   * iOS only does fullscreen on a <video>, so the button is dead on an iPhone
   * and every press was answered with "fullscreen refused". Hide it there,
   * along with its row in the key list, which would otherwise document a key
   * that does nothing.
   *
   * Feature-detected rather than hidden on all touch devices: Android Chrome
   * supports it, and there the button is genuinely worth having - it takes the
   * browser's own address bar away, on top of the app folding its bars.
   */
  if (!document.fullscreenEnabled || !dom.app.requestFullscreen) {
    dom.full.hidden = true;
    dom.keyFullscreen.hidden = true;
  }

  if (TOUCH) applyTouchLayout();
  try { setMaximised(localStorage.getItem(WINDOW_KEY) === "max"); }
  catch { setMaximised(false); }

  buildEffectMenu();
  buildResolutionMenu();
  buildDeviceMenu();
  applyLook(loadLook());
  wire();
  refresh();

  if (!Recorder.available) {
    for (const button of [dom.rec, dom.quickRec]) {
      button.disabled = true;
      button.title = "This browser cannot record video from a canvas";
    }
  }

  requestAnimationFrame(frame);

  // The camera is not opened until asked for. Opening it on load would put a
  // permission prompt in front of someone who has not yet seen what the page
  // is, which is the fastest way to be denied it.
  message("Start the camera",
    "Your video stays on this device. It is never uploaded, and there is no "
    + "server behind this page.", "start");
}

boot();
