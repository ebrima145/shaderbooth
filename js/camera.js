/*
 * camera.js
 *
 * The capture device, read through getUserMedia into a hidden <video>.
 *
 * The browser does all the work the desktop player needed a capture thread
 * for: the <video> element is decoding on its own, and reading it is a texture
 * upload rather than a blocking driver call, so there is nothing here that can
 * stall the render loop.
 *
 * Two things about device enumeration are worth knowing, because both look
 * like bugs the first time.
 *
 * Labels are withheld until the user has granted camera permission at least
 * once - before that, enumerateDevices() returns the right *number* of
 * cameras with empty names. So the list is only populated after a stream has
 * been opened, and start() opens the default device first and enumerates
 * second, rather than asking the user to pick from "camera 1, camera 2".
 *
 * And deviceIds are per-origin and reset when site data is cleared, so a saved
 * deviceId is a hint rather than a handle: open() falls back to the default
 * camera when the id it is given no longer exists, instead of failing.
 */

// What we ask for. The browser will hand back the nearest thing the device can
// actually do, which is why these are `ideal` rather than `exact` - `exact` on
// a camera that tops out at 640x480 is an OverconstrainedError and no picture
// at all, where `ideal` is 640x480 and a working app.
export const RESOLUTIONS = [
  ["640 x 480", 640, 480],
  ["1280 x 720", 1280, 720],
  ["1920 x 1080", 1920, 1080],
  ["2560 x 1440", 2560, 1440],
  ["3840 x 2160", 3840, 2160],
];

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.devices = [];        // [{deviceId, label}, ...]
    this.deviceId = null;
    // "user" | "environment" | null. Phones report it; most desktop webcams
    // do not, which is the signal this app uses to tell the two apart.
    this.facing = null;
    this.width = 1280;
    this.height = 720;
    this.error = null;
  }

  /** True when we know we are looking at the person holding the device. */
  get isFrontFacing() { return this.facing === "user"; }

  get live() {
    return this.stream !== null && this.video.readyState >= 2;
  }

  /** The label of whatever is currently open. */
  get label() {
    const found = this.devices.find((d) => d.deviceId === this.deviceId);
    return found ? found.label : "Camera";
  }

  /** The resolution actually granted, which is rarely the one asked for. */
  get size() {
    return [this.video.videoWidth, this.video.videoHeight];
  }

  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || "Camera " + (i + 1),
      }));
    return this.devices;
  }

  /**
   * Open a device and wait until it is actually producing frames.
   *
   * Resolving on loadedmetadata rather than on the getUserMedia promise
   * matters: the promise settles as soon as the track exists, which is before
   * videoWidth is anything but zero - and a renderer sized from a zero-width
   * video allocates nothing and shows black.
   */
  async open({ deviceId = null, facing = null, width = null, height = null } = {}) {
    this.error = null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "This browser has no camera API. On a phone or an older browser that "
        + "usually means the page is not being served over HTTPS.");
    }

    if (width) this.width = width;
    if (height) this.height = height;

    const video = { width: { ideal: this.width }, height: { ideal: this.height } };
    // facingMode wins over deviceId when both are offered. On a phone the two
    // disagree constantly - Android enumerates the wide, ultrawide and depth
    // sensors as separate devices, so cycling ids lands on lenses nobody asked
    // for, while "front" and "back" is the only distinction anyone means.
    if (facing) video.facingMode = { ideal: facing };
    else if (deviceId) video.deviceId = { ideal: deviceId };

    this.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (exc) {
      this.error = describe(exc);
      throw new Error(this.error);
    }

    this.stream = stream;
    this.video.srcObject = stream;
    const settings = stream.getVideoTracks()[0].getSettings();
    this.deviceId = settings.deviceId || deviceId || null;
    this.facing = settings.facingMode || facing || null;

    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        this.video.addEventListener("loadedmetadata", resolve, { once: true });
      });
    }

    await this.listDevices();
    return this;
  }

  /**
   * The other side of the phone.
   *
   * Returns the facing to ask for next, flipping from whatever is open. When
   * the current camera does not report a facing at all - most desktop webcams
   * - this assumes it is the front one, because a device with a single
   * unlabelled camera pointed at you is overwhelmingly the common case.
   */
  otherFacing() {
    return this.facing === "environment" ? "user" : "environment";
  }

  /** The next device in the list, wrapping - what Tab does. */
  nextDevice(delta = 1) {
    if (this.devices.length < 2) return null;
    const at = this.devices.findIndex((d) => d.deviceId === this.deviceId);
    const n = this.devices.length;
    return this.devices[(((at < 0 ? 0 : at) + delta) % n + n) % n].deviceId;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}

/**
 * Turn a getUserMedia rejection into something worth putting on screen.
 *
 * The DOM names are precise and useless - "NotAllowedError" is both "you
 * clicked Block" and "this page isn't on HTTPS", which are entirely different
 * problems with entirely different fixes, and the second one is the one that
 * catches people the first time they open this from a file:// path or over a
 * LAN address.
 */
function describe(exc) {
  const name = exc && exc.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (!window.isSecureContext) {
      return "Camera access needs a secure page. Open this over https:// or "
        + "from http://localhost - a plain http:// address on the network "
        + "will always be refused, whatever you click.";
    }
    return "Camera permission was refused. Allow it for this site (the icon at "
      + "the left of the address bar) and reload.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera answered. Check that one is attached and not in use by "
      + "another app, then try again.";
  }
  if (name === "NotReadableError") {
    return "The camera is attached but could not be opened - usually because "
      + "another application already has it.";
  }
  return "Could not open the camera: " + (exc && exc.message ? exc.message : exc);
}
