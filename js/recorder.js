/*
 * recorder.js
 *
 * Writes what the effect stack produced to a video file, and saves stills.
 *
 * What gets recorded is the **output**, not the page: MediaRecorder is pointed
 * at the canvas's own capture stream, and the canvas is the size of the camera
 * frame with nothing drawn over it. So the file is the picture you made, at
 * the resolution you made it at, not a screen recording of the app that made
 * it. The chrome around it is CSS and never reaches the canvas.
 *
 * Two limitations worth knowing before you record something you can't repeat:
 *
 * - **No audio.** The camera is opened video-only, deliberately: a microphone
 *   permission prompt for an app that does nothing with sound is a bad trade,
 *   and the browser asks for both at once or not at all.
 *
 * - **MP4 where the browser can, WebM where it cannot.** MP4/H.264 is what
 *   everything downstream expects - phones, editors, messaging apps, anything
 *   that will not touch a .webm - so it is tried first. Chrome, Edge and
 *   Safari all produce it. Firefox's MediaRecorder still has no MP4 muxer, so
 *   it falls back down the list to VP9 in WebM rather than failing.
 *
 *   The extension follows what was actually negotiated rather than what was
 *   asked for. That matters: writing ".mp4" on a WebM blob produces a file
 *   that fails to open with a codec error, which is a far worse outcome than
 *   an honest .webm. If you end up with one, `ffmpeg -i in.webm -c copy
 *   out.mp4` usually remuxes it without re-encoding.
 *
 *   What MediaRecorder writes is *fragmented* MP4. Browsers, VLC, Resolve and
 *   Premiere all read it; a few older Windows tools want a faststart remux
 *   first, which is the same one-line ffmpeg call.
 *
 * The blob is assembled in memory and only written out when you stop, because
 * a page has no incremental write to disk without asking for a directory
 * handle first. At 1080p/8Mbps that is about a megabyte per second, so a long
 * take is real memory - which is what the running duration in the readout is
 * there to make visible.
 */

// Tried in order; the first the browser supports wins. MP4/H.264 leads because
// it is the format everything downstream will actually open.
//
// `avc1` is left unqualified on purpose. Pinning a profile and level - the
// avc1.640028 kind of string - fixes the encoder to High@4.0, which is a
// ceiling of about 2048x1080: fine at 720p, silently wrong at 4K. Bare avc1
// lets the browser choose a level that fits the canvas it is actually handed.
const CODECS = [
  ["video/mp4;codecs=avc1", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9", "webm"],   // Firefox, which has no MP4 muxer
  ["video/webm;codecs=vp8", "webm"],
  ["video/webm", "webm"],
];

function pickCodec() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mimeType, extension] of CODECS) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  }
  return null;
}

/**
 * What a saved take or still is called.
 *
 * Named for the app rather than for the device, so a file that has travelled
 * somewhere else still says where it came from - which is the whole point of a
 * thing people are meant to share. The timestamp is ordered
 * largest-unit-first, so a folder of them sorts chronologically by name, and
 * it goes to the second because holding the shortcut down produces several
 * stills in a hurry.
 */
const NAME_PREFIX = "shaderbooth";

function downloadName(extension) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
    + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  return NAME_PREFIX + "-" + stamp + "." + extension;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a timer rather than immediately: some browsers have not
  // finished reading the blob by the time click() returns, and a revoked URL
  // mid-read is a zero-byte download with no error anywhere.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Whether to hand the file to the system share sheet instead of downloading.
 *
 * Only on touch-primary devices, and this is the point of the whole detour: a
 * phone has no useful "downloads folder", and on iOS an `<a download>` tends
 * to open a preview rather than save anything. The share sheet is the only
 * route from a web page to the camera roll, and it is also how the file
 * reaches Messages or anywhere else in one step.
 *
 * Desktop deliberately keeps the download. A share sheet there is a worse
 * answer to "save this" than simply saving it.
 *
 * canShare rather than share: carrying files is a separate capability from
 * sharing a link, and browsers exist that have the second without the first.
 */
function preferShare(file) {
  if (!matchMedia("(pointer: coarse)").matches) return false;
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/**
 * Put the finished file somewhere the person can keep it.
 *
 * Resolves with {name, shared} so the caller can be honest about which
 * happened, or null when the share sheet was dismissed.
 */
async function save(blob, filename, type) {
  const file = new File([blob], filename, { type });

  if (preferShare(file)) {
    try {
      await navigator.share({ files: [file] });
      return { name: filename, shared: true };
    } catch (exc) {
      // AbortError is the person closing the sheet. That is a decision, and
      // quietly downloading the file anyway would save something they just
      // declined to save. Anything else - no transient activation left after
      // MediaRecorder flushed, a browser that lied about canShare - falls
      // through to the download, which always works.
      if (exc && exc.name === "AbortError") return null;
    }
  }

  download(blob, filename);
  return { name: filename, shared: false };
}

/**
 * A bitrate that suits the frame size, rather than one number for every size.
 *
 * A flat 12 Mbps was absurd at 640x480 and starved 4K. ~0.15 bits per pixel
 * per frame is a reasonable H.264 target for this kind of material, which is
 * high-motion and full of the fine noise the analog effects add - grain and
 * dither are the worst case an encoder can be handed, so this sits deliberately
 * above what a talking head would need.
 */
function bitrateFor(width, height, fps) {
  const bits = width * height * fps * 0.15;
  return Math.round(Math.min(Math.max(bits, 2e6), 40e6));
}

export class Recorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.extension = "webm";
  }

  static get available() { return pickCodec() !== null; }

  get recording() {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  /** Seconds into the current take, for the readout. */
  get elapsed() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(bitsPerSecond = null) {
    if (this.recording) return false;
    const codec = pickCodec();
    if (!codec) throw new Error("This browser cannot record video from a canvas.");

    // captureStream(fps) asks the canvas to publish a frame at most that often;
    // the render loop is free-running at the display's rate above it.
    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.extension = codec.extension;
    this.recorder = new MediaRecorder(stream, {
      mimeType: codec.mimeType,
      videoBitsPerSecond: bitsPerSecond
        || bitrateFor(this.canvas.width, this.canvas.height, this.fps),
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) this.chunks.push(event.data);
    };
    // A timeslice, so the chunks arrive as the take runs rather than as one
    // allocation at stop - which at 1080p is the difference between a steady
    // climb in memory and a spike big enough to stall the tab.
    this.recorder.start(1000);
    this.startedAt = performance.now();
    return true;
  }

  /**
   * Stop and save. Resolves with {name, shared}, or null if the take was
   * discarded at the share sheet.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") return resolve(null);
      this.recorder.onstop = async () => {
        const type = this.recorder.mimeType || "video/webm";
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this.recorder = null;
        resolve(await save(blob, downloadName(this.extension), type));
      };
      this.recorder.stop();
    });
  }

  toggle() {
    return this.recording ? this.stop() : Promise.resolve(this.start() && null);
  }

  /** A single PNG of the output, at the camera's own resolution. */
  snapshot() {
    return new Promise((resolve) => {
      this.canvas.toBlob(async (blob) => {
        if (!blob) return resolve(null);
        resolve(await save(blob, downloadName("png"), "image/png"));
      }, "image/png");
    });
  }
}
