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
 * - **WebM, not MP4.** captureStream + MediaRecorder gives VP9 or VP8 in a
 *   WebM container on every browser that supports it; Safari is the exception
 *   and produces MP4/H.264. The codec list below is tried in order and the
 *   first one the browser admits to is used, so the file extension follows
 *   from what was actually negotiated rather than being assumed. WebM plays in
 *   every browser and in VLC/Resolve/Premiere; if you need it in something
 *   fussier, remux it - `ffmpeg -i in.webm -c copy out.mp4` is usually enough.
 *
 * The blob is assembled in memory and only written out when you stop, because
 * a page has no incremental write to disk without asking for a directory
 * handle first. At 1080p/8Mbps that is about a megabyte per second, so a long
 * take is real memory - which is what the running duration in the readout is
 * there to make visible.
 */

// Tried in order; the first the browser supports wins.
const CODECS = [
  ["video/webm;codecs=vp9", "webm"],
  ["video/webm;codecs=vp8", "webm"],
  ["video/webm", "webm"],
  ["video/mp4;codecs=avc1", "mp4"],   // Safari
  ["video/mp4", "mp4"],
];

function pickCodec() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mimeType, extension] of CODECS) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  }
  return null;
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
    + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
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

  start(bitsPerSecond = 12000000) {
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
      videoBitsPerSecond: bitsPerSecond,
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

  /** Stop and save. Resolves with the filename written. */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") return resolve(null);
      this.recorder.onstop = () => {
        const type = this.recorder.mimeType || "video/webm";
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this.recorder = null;
        const filename = "camera-" + stamp() + "." + this.extension;
        download(blob, filename);
        resolve(filename);
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
      this.canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const filename = "camera-" + stamp() + ".png";
        download(blob, filename);
        resolve(filename);
      }, "image/png");
    });
  }
}
