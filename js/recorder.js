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
 * - **Audio is opt-in and asked for separately.** The camera is still opened
 *   video-only, because getUserMedia asks for the camera and the microphone
 *   in one prompt or not at all, and a mic prompt in front of someone who
 *   only wants to see themselves through a shader is a bad trade. The
 *   microphone is a second, later getUserMedia call made only when the sound
 *   button is switched on - so nobody is asked for a mic until they have
 *   said, in as many words, that they want one.
 *
 *   The canvas capture stream carries video and nothing else, so a take with
 *   sound is a third MediaStream built from the canvas's video track and the
 *   microphone's audio track. The mic track outlives the take: it belongs to
 *   the Microphone below and is reused, never stopped by the recorder.
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

/*
 * The same list again, with an audio codec named in each entry.
 *
 * It has to be a second list rather than a suffix, because isTypeSupported
 * answers about the *pair*: a browser may support avc1 and refuse
 * avc1,mp4a.40.2. Asking the video-only question and then handing the recorder
 * an audio track anyway produces a silent track, or no file, depending on the
 * browser - and a take you cannot repeat is the worst place to find that out.
 * mp4a.40.2 is AAC-LC, which is what anything that plays H.264 expects; Opus
 * is the only sensible partner for VP8/VP9.
 */
const CODECS_WITH_AUDIO = [
  ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
  ["video/mp4", "mp4"],
  ["video/webm;codecs=vp9,opus", "webm"],
  ["video/webm;codecs=vp8,opus", "webm"],
  ["video/webm", "webm"],
];

function pickCodec(withAudio = false) {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mimeType, extension] of (withAudio ? CODECS_WITH_AUDIO : CODECS)) {
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

/**
 * Turn a microphone getUserMedia rejection into something worth reading.
 *
 * Separate from the camera's version in camera.js on purpose: the DOM names
 * overlap but the fixes do not, and "check that a camera is attached" put in
 * front of someone whose microphone is muted is worse than no message at all.
 */
function describeMic(exc) {
  const name = exc && exc.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (!window.isSecureContext) {
      return "Microphone access needs a secure page - https:// or localhost.";
    }
    return "Microphone permission was refused. Allow it for this site (the "
      + "icon at the left of the address bar) and switch sound back on.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone answered. Check that one is attached, then try again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is attached but could not be opened - usually "
      + "because another application already has it.";
  }
  return "Could not open the microphone: " + (exc && exc.message ? exc.message : exc);
}

/**
 * The microphone, held open only while sound is switched on.
 *
 * Deliberately not part of Camera. The camera is opened when the app starts
 * and its permission is the price of the app working at all; the microphone
 * is opened only when someone asks for sound and released the moment they
 * stop asking. Keeping the two apart is what makes that possible - one
 * getUserMedia call for both would mean one prompt for both, for everyone,
 * forever.
 *
 * The track is held between takes rather than acquired per take. Acquiring it
 * when the record button is pressed would put a permission prompt - and, on a
 * cold device, a tenth of a second of hardware startup - in the middle of the
 * one gesture that has to be instant. The cost is that the browser shows its
 * microphone indicator for as long as sound is armed, which is honest: the
 * microphone really is open.
 */
export class Microphone {
  constructor() {
    this.stream = null;
    this.error = null;
  }

  get armed() { return this.stream !== null; }

  get track() {
    return this.stream ? this.stream.getAudioTracks()[0] || null : null;
  }

  /** True once the mic is live; throws with a readable message if it is not. */
  async arm() {
    if (this.armed) return true;
    this.error = null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = "This browser has no microphone API.";
      throw new Error(this.error);
    }
    try {
      // The processing browsers apply by default suits a person talking,
      // which is what a camera app records. It is the wrong choice for music,
      // and that is a trade being made here rather than an oversight.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (exc) {
      this.error = describeMic(exc);
      throw new Error(this.error);
    }
    return true;
  }

  disarm() {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }
}

export class Recorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.extension = "webm";
    this.hasAudio = false;
    // Held for as long as a take runs. See the note in start().
    this.stream = null;
  }

  static get available() { return pickCodec() !== null; }

  get recording() {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  /** Seconds into the current take, for the readout. */
  get elapsed() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /**
   * Begin a take.
   *
   * `audioTrack` is optional and belongs to the caller - it is added to the
   * recorded stream and deliberately never stopped here, so one live
   * microphone survives take after take.
   */
  start({ audioTrack = null, bitsPerSecond = null } = {}) {
    if (this.recording) return false;
    // A track that has already ended - mic unplugged, or seized by another
    // app - would be muxed as silence and quietly turn a take with sound into
    // a take without one. Better to record video alone and pick the codec
    // that says so.
    const audio = audioTrack && audioTrack.readyState === "live" ? audioTrack : null;
    const codec = pickCodec(!!audio);
    if (!codec) throw new Error("This browser cannot record video from a canvas.");

    // captureStream(fps) asks the canvas to publish a frame at most that often;
    // the render loop is free-running at the display's rate above it.
    //
    // The audio track is *added to this stream* rather than combined with the
    // canvas's video track into a new MediaStream, and that is load-bearing.
    // Building a new stream and handing it to MediaRecorder leaves nothing
    // holding the CanvasCaptureMediaStream itself - only its track has been
    // carried across. A few seconds later the collector takes it, the canvas
    // stops publishing frames, and the take freezes on whatever happened to
    // be on screen while the audio, owned by the Microphone and so still
    // referenced, carries on to the end. The result is a video that stops and
    // a soundtrack that does not.
    //
    // Keeping the capture stream as the recorded stream restores the lifetime
    // that video-only takes always had - MediaRecorder holds its own stream -
    // and this.stream is a second reference held for the same reason.
    const stream = this.canvas.captureStream(this.fps);
    if (audio) stream.addTrack(audio);
    this.stream = stream;
    this.chunks = [];
    this.extension = codec.extension;
    this.hasAudio = !!audio;
    this.recorder = new MediaRecorder(stream, {
      mimeType: codec.mimeType,
      videoBitsPerSecond: bitsPerSecond
        || bitrateFor(this.canvas.width, this.canvas.height, this.fps),
      // Speech through a laptop or phone mic: well past transparent for that,
      // and negligible beside the video bitrate either way.
      ...(audio ? { audioBitsPerSecond: 128000 } : {}),
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
        this.releaseStream();
        resolve(await save(blob, downloadName(this.extension), type));
      };
      this.recorder.stop();
    });
  }

  /**
   * Let go of the take's stream, stopping the canvas capture but never the
   * microphone - that one belongs to the Microphone and has to survive for
   * the next take.
   */
  releaseStream() {
    if (!this.stream) return;
    for (const track of this.stream.getVideoTracks()) track.stop();
    this.stream = null;
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
