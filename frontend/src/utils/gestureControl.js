/**
 * Hand-gesture control.
 *
 * Runs MediaPipe's gesture recogniser on the camera feed entirely on this
 * device — the WASM runtime and the model are served from the app itself, so
 * no frame ever leaves the machine and it works with no network.
 *
 * Two layers of recognition:
 *   1. MediaPipe's own labels (open palm, fist, point, victory, thumbs).
 *   2. Landmark geometry on top of those, for pinch and for swipes, which the
 *      built-in set does not cover.
 *
 * A gesture only fires once it has been held steady for a moment. Without that
 * the hand triggers three commands on its way to making one shape.
 */

const WASM_ROOT = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/models/gesture_recognizer.task';

/** How long a shape must be held before it counts, in milliseconds. */
const HOLD_MS = 420;
/** Minimum gap between two fired gestures, so one hand pose is not spammed. */
const COOLDOWN_MS = 900;
/** MediaPipe's confidence below which a label is ignored. */
const MIN_SCORE = 0.55;

/** Landmark indices, from MediaPipe's hand model. */
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const PINKY_TIP = 20;

export const GESTURES = {
  OPEN_PALM: 'open_palm',
  FIST: 'fist',
  POINT: 'point',
  VICTORY: 'victory',
  THUMB_UP: 'thumb_up',
  THUMB_DOWN: 'thumb_down',
  PINCH: 'pinch',
  SWIPE_LEFT: 'swipe_left',
  SWIPE_RIGHT: 'swipe_right',
  // Vertical swipes are new. The tracker only watched the horizontal axis, so
  // a hand moved up or down did nothing at all - and moving your hand up and
  // down is the obvious way to scroll.
  SWIPE_UP: 'swipe_up',
  SWIPE_DOWN: 'swipe_down',
};

/** What each gesture is for.
 *
 * Two meanings per gesture, because there are two jobs: `action` is what it
 * does inside SMARAN.AI, and `desktop` is the key it sends to whatever has
 * focus when "Control PC" is switched on. Only the first existed before, so
 * the legend promised "Previous character" for a swipe that, with desktop
 * control on, skips a track.
 */
export const GESTURE_LEGEND = [
  { id: GESTURES.OPEN_PALM, glyph: '🖐', label: 'Open palm', action: 'Wake / stop speaking', desktop: 'Play or pause' },
  { id: GESTURES.FIST, glyph: '✊', label: 'Fist', action: 'End session', desktop: 'Turn PC control off' },
  { id: GESTURES.THUMB_UP, glyph: '👍', label: 'Thumbs up', action: 'Confirm', desktop: 'Volume up' },
  { id: GESTURES.THUMB_DOWN, glyph: '👎', label: 'Thumbs down', action: 'Cancel', desktop: 'Volume down' },
  { id: GESTURES.PINCH, glyph: '🤏', label: 'Pinch', action: 'Toggle ambience', desktop: 'Mute or unmute' },
  { id: GESTURES.SWIPE_UP, glyph: '↑', label: 'Hand up', action: '—', desktop: 'Scroll up' },
  { id: GESTURES.SWIPE_DOWN, glyph: '↓', label: 'Hand down', action: '—', desktop: 'Scroll down' },
  { id: GESTURES.SWIPE_LEFT, glyph: '⇠', label: 'Swipe left', action: 'Previous character', desktop: 'Previous' },
  { id: GESTURES.SWIPE_RIGHT, glyph: '⇢', label: 'Swipe right', action: 'Next character', desktop: 'Next' },
  { id: GESTURES.POINT, glyph: '☝', label: 'Point up', action: 'Start listening', desktop: 'Scroll up' },
  { id: GESTURES.VICTORY, glyph: '✌', label: 'Victory', action: 'Toggle the camera', desktop: 'Scroll down' },
];

const MEDIAPIPE_LABELS = {
  Open_Palm: GESTURES.OPEN_PALM,
  Closed_Fist: GESTURES.FIST,
  Pointing_Up: GESTURES.POINT,
  Victory: GESTURES.VICTORY,
  Thumb_Up: GESTURES.THUMB_UP,
  Thumb_Down: GESTURES.THUMB_DOWN,
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/**
 * Pinch: thumb and index tips touching while the other fingers stay out.
 * Measured against hand size so it holds at any distance from the camera.
 */
const isPinching = (landmarks) => {
  const span = distance(landmarks[WRIST], landmarks[MIDDLE_TIP]) || 1;
  const gap = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / span;
  const pinkyOut = distance(landmarks[WRIST], landmarks[PINKY_TIP]) / span > 0.7;
  return gap < 0.22 && pinkyOut;
};

export class GestureController {
  constructor({ onGesture, onHands, onStatus, onError } = {}) {
    this.onGesture = onGesture;
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.onError = onError;

    this.recognizer = null;
    this.stream = null;
    this.video = null;
    this.frameId = null;
    this.running = false;

    this.candidate = null;
    this.candidateSince = 0;
    this.lastFiredAt = 0;
    this.trail = [];
  }

  static isSupported() {
    return typeof window !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof WebAssembly === 'object';
  }

  async start() {
    if (this.running) return true;
    if (!GestureController.isSupported()) {
      this.onError?.('This device cannot run gesture tracking.');
      return false;
    }

    this.onStatus?.('loading');
    try {
      const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        this.recognizer = await GestureRecognizer.createFromOptions(vision, options('GPU'));
      } catch (gpuError) {
        // The packaged desktop window does not always expose a usable WebGL
        // context to the model runtime, and the GPU delegate then stalls
        // rather than failing loudly. CPU is slower but always available.
        this.onStatus?.('loading-cpu');
        this.recognizer = await GestureRecognizer.createFromOptions(vision, options('CPU'));
      }
    } catch (error) {
      this.onError?.(`Gesture tracking could not start: ${error?.message || 'model unavailable'}`);
      this.onStatus?.('error');
      return false;
    }

    // The model is loaded; the camera is the remaining step. Saying so keeps
    // the panel from sitting on 'loading the hand model' after it is loaded.
    this.onStatus?.('camera');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
    } catch (error) {
      this.onError?.(
        error?.name === 'NotAllowedError'
          ? 'Camera access is needed for gesture control.'
          : `The camera could not be opened: ${error?.message || 'unavailable'}`,
      );
      this.onStatus?.('error');
      return false;
    }

    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    this.video = video;

    this.running = true;
    this.onStatus?.('running');
    this._loop();
    return true;
  }

  _loop() {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(() => this._loop());

    const video = this.video;
    if (!video || !video.videoWidth || !this.recognizer) return;

    let result;
    try {
      result = this.recognizer.recognizeForVideo(video, performance.now());
    } catch {
      return; // A dropped frame is not worth reporting.
    }

    const landmarks = result?.landmarks || [];
    this.onHands?.(landmarks);

    if (!landmarks.length) {
      this.candidate = null;
      this.trail = [];
      return;
    }

    const primary = landmarks[0];
    this._trackSwipe(primary);

    // MediaPipe's label first, then the geometric gestures it does not cover.
    let detected = null;
    const category = result?.gestures?.[0]?.[0];
    if (category && category.score >= MIN_SCORE) {
      detected = MEDIAPIPE_LABELS[category.categoryName] || null;
    }
    if (isPinching(primary)) detected = GESTURES.PINCH;

    this._considerGesture(detected);
  }

  /** Travel of the wrist over the last handful of frames, on either axis.
   *
   * Only the horizontal was tracked, so a hand moved up or down did nothing.
   * Moving your hand up and down is the obvious way to scroll, and it needed
   * the vertical too. Whichever axis moved further wins, so a diagonal wave
   * resolves to one gesture instead of firing both.
   *
   * The vertical threshold is lower than the horizontal because a camera sees
   * less vertical room than horizontal - a comfortable up-and-down movement
   * covers less of the frame than a sideways one.
   */
  _trackSwipe(landmarks) {
    const now = performance.now();
    this.trail.push({ x: landmarks[WRIST].x, y: landmarks[WRIST].y, at: now });
    this.trail = this.trail.filter((point) => now - point.at < 400);
    if (this.trail.length < 6) return;

    const first = this.trail[0];
    const last = this.trail[this.trail.length - 1];
    const across = last.x - first.x;
    const vertical = last.y - first.y;

    if (Math.abs(across) < 0.28 && Math.abs(vertical) < 0.22) return;

    if (Math.abs(across) >= Math.abs(vertical)) {
      // The camera image is mirrored, so a rightward move on screen is the
      // user's own left.
      this._fire(across > 0 ? GESTURES.SWIPE_LEFT : GESTURES.SWIPE_RIGHT);
    } else {
      // y grows downward in the image, so a smaller y means a raised hand.
      this._fire(vertical < 0 ? GESTURES.SWIPE_UP : GESTURES.SWIPE_DOWN);
    }
    this.trail = [];
  }

  /** Require a shape to be held before accepting it. */
  _considerGesture(detected) {
    const now = performance.now();
    if (!detected) {
      this.candidate = null;
      return;
    }
    if (this.candidate !== detected) {
      this.candidate = detected;
      this.candidateSince = now;
      return;
    }
    if (now - this.candidateSince < HOLD_MS) return;
    this._fire(detected);
    this.candidate = null;
  }

  _fire(gesture) {
    const now = performance.now();
    if (now - this.lastFiredAt < COOLDOWN_MS) return;
    this.lastFiredAt = now;
    this.onGesture?.(gesture);
  }

  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = null;

    try { this.stream?.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ }
    this.stream = null;

    if (this.video) {
      try { this.video.pause(); } catch { /* fine */ }
      this.video.srcObject = null;
      this.video = null;
    }
    try { this.recognizer?.close(); } catch { /* already closed */ }
    this.recognizer = null;

    this.candidate = null;
    this.trail = [];
    this.onStatus?.('idle');
  }
}
