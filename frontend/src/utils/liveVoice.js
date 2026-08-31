/**
 * Real-time streaming voice session.
 *
 * Microphone audio is streamed continuously to the backend as 16 kHz PCM while
 * the model's reply streams back as 24 kHz PCM and starts playing immediately.
 * Because both directions are open at once, the user can talk over the
 * assistant and it stops mid-sentence.
 *
 * This deliberately avoids the browser SpeechRecognition API, which is absent
 * in the packaged desktop window and made spoken input silently do nothing.
 */

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const toBase64 = (bytes) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Float samples in [-1, 1] to little-endian signed 16-bit PCM. */
const floatToPcm16 = (input) => {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(output.buffer);
};

export class LiveVoiceSession {
  /**
   * @param {object} handlers - onStateChange, onError, onLevel, onText
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    // 'gemini' or 'local'. Remembered so a reconnect does not silently
    // switch which engine is answering.
    this.engine = handlers.engine || 'gemini';
    this.socket = null;
    this.micStream = null;
    this.inputContext = null;
    this.outputContext = null;
    this.outputBus = null;
    this.processor = null;
    this.sourceNode = null;
    this.analyser = null;
    this.levelTimer = null;
    this.playbackCursor = 0;
    this.scheduled = [];
    this.visionStream = null;
    this.visionVideo = null;
    this.visionTimer = null;
    this.closed = false;
  }

  _emit(state) {
    this.handlers.onStateChange?.(state);
  }

  async start({ apiBase = '', language = 'en', voice, gender = 'female', persona = 'myra' } = {}) {
    this.closed = false;
    this._emit('connecting');

    // 1. Microphone first: without it there is nothing to stream.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      this.handlers.onError?.(
        error?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access to talk.'
          : `Microphone unavailable: ${error?.message || 'no input device'}`,
      );
      this._emit('error');
      return false;
    }

    // 2. Open the bridge to the backend.
    const base = new URL(apiBase || window.location.origin, window.location.origin);
    const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      // Two engines, one protocol. `local` is faster-whisper, a model in
      // Ollama and Kokoro, all on this machine and needing no key; `live`
      // is Gemini, which is the only one of the two that can see a screen
      // or a camera. The messages either sends are identical, so the only
      // difference here is the path.
      const path = this.engine === 'local' ? '/ws/voice/local' : '/ws/voice/live';
      this.socket = new WebSocket(`${scheme}//${base.host}${path}`);
    } catch (error) {
      this.handlers.onError?.('Could not open the real-time voice channel.');
      this._emit('error');
      return false;
    }

    this.socket.onopen = () => {
      // gender, not just voice. The local engine speaks through Kokoro, which
      // has its own voices and has never heard of 'Aoede' or 'Puck' - those
      // are Gemini's names. It reads `gender`, and the page was not sending
      // one, so every local call fell back to the default no matter which
      // character was on screen.
      this.socket.send(JSON.stringify({ type: 'start', language, voice, gender, persona }));
    };
    this.socket.onmessage = (event) => this._handleServerMessage(event);
    this.socket.onerror = () => {
      if (!this.closed) this.handlers.onError?.('The real-time voice connection failed.');
    };
    this.socket.onclose = () => {
      if (!this.closed) this._emit('closed');
    };

    this._startCapture();
    return true;
  }

  _handleServerMessage(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (payload.type) {
      case 'ready':
        this._emit('listening');
        break;
      case 'audio':
        this._playChunk(payload.data);
        this._emit('speaking');
        break;
      case 'text':
        this.handlers.onText?.(payload.text);
        break;
      case 'interrupted':
        // The user started talking: drop whatever is still queued.
        this._stopPlayback();
        this._emit('listening');
        break;
      case 'turn_complete':
        this._emit('listening');
        break;
      case 'error':
        this.handlers.onError?.(payload.message || 'Real-time voice error.');
        this._emit('error');
        break;
      default:
        break;
    }
  }

  _startCapture() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.inputContext = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE });
    this.sourceNode = this.inputContext.createMediaStreamSource(this.micStream);

    this.analyser = this.inputContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.sourceNode.connect(this.analyser);

    // ScriptProcessor is deprecated but is the one node available in every
    // engine this app ships to, including the packaged desktop window.
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
      const samples = event.inputBuffer.getChannelData(0);
      this.socket.send(JSON.stringify({ type: 'audio', data: toBase64(floatToPcm16(samples)) }));
    };
    this.sourceNode.connect(this.processor);
    this.processor.connect(this.inputContext.destination);

    const levels = new Uint8Array(this.analyser.frequencyBinCount);
    this.levelTimer = window.setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(levels);
      const average = levels.reduce((sum, value) => sum + value, 0) / levels.length;
      this.handlers.onLevel?.(Math.min(100, Math.round(average * 1.6)));
    }, 100);
  }

  _playChunk(base64Audio) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!this.outputContext) {
        this.outputContext = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });
        // Everything the assistant says passes through this node, giving the
        // avatar a signal to derive mouth shapes from.
        this.outputBus = this.outputContext.createGain();
        this.outputBus.connect(this.outputContext.destination);
        this.handlers.onSpeechBus?.(this.outputBus, this.outputContext);
      }
      const bytes = fromBase64(base64Audio);
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const buffer = this.outputContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;

      const source = this.outputContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.outputBus || this.outputContext.destination);

      // Queue chunks back to back so speech comes out continuous.
      const now = this.outputContext.currentTime;
      const startAt = Math.max(now, this.playbackCursor);
      source.start(startAt);
      this.playbackCursor = startAt + buffer.duration;

      this.scheduled.push(source);
      source.onended = () => {
        this.scheduled = this.scheduled.filter((item) => item !== source);
      };
    } catch (error) {
      this.handlers.onError?.(`Audio playback failed: ${error?.message || 'unknown error'}`);
    }
  }

  _stopPlayback() {
    this.scheduled.forEach((source) => {
      try { source.stop(); } catch { /* already finished */ }
    });
    this.scheduled = [];
    this.playbackCursor = 0;
  }

  /**
   * Share what is on screen (or the camera) with the assistant.
   *
   * Frames are sent a couple of times a second as small JPEGs — enough for the
   * model to follow along without flooding the connection.
   */
  async startVision(mode = 'screen') {
    await this.stopVision();
    try {
      this.visionStream = mode === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch (error) {
      this.handlers.onError?.(
        error?.name === 'NotAllowedError'
          ? 'Screen sharing was cancelled.'
          : `Could not capture ${mode}: ${error?.message || 'unavailable'}`,
      );
      return false;
    }

    // Stop cleanly if the user ends sharing from the browser's own control.
    this.visionStream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopVision());

    const video = document.createElement('video');
    video.srcObject = this.visionStream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    this.visionVideo = video;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    this.visionTimer = window.setInterval(() => {
      if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;
      // Downscale: the model reads these fine and it keeps the stream light.
      const scale = Math.min(1, 1024 / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      this.socket.send(JSON.stringify({
        type: 'image',
        mime: 'image/jpeg',
        data: dataUrl.split(',')[1],
      }));
    }, 500);

    this.handlers.onVisionChange?.(mode);
    return true;
  }

  async stopVision() {
    if (this.visionTimer) window.clearInterval(this.visionTimer);
    this.visionTimer = null;
    try { this.visionStream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    this.visionStream = null;
    if (this.visionVideo) {
      try { this.visionVideo.pause(); } catch { /* fine */ }
      this.visionVideo.srcObject = null;
      this.visionVideo = null;
    }
    this.handlers.onVisionChange?.('off');
  }

  sendText(text) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'text', text }));
    }
  }

  async stop() {
    this.closed = true;
    await this.stopVision();
    this._stopPlayback();
    if (this.levelTimer) window.clearInterval(this.levelTimer);
    try { this.socket?.send(JSON.stringify({ type: 'close' })); } catch { /* closing anyway */ }
    try { this.socket?.close(); } catch { /* already closed */ }
    try { this.processor?.disconnect(); } catch { /* not connected */ }
    try { this.sourceNode?.disconnect(); } catch { /* not connected */ }
    try { this.micStream?.getTracks().forEach((track) => track.stop()); } catch { /* gone */ }
    try { await this.inputContext?.close(); } catch { /* already closed */ }
    try { await this.outputContext?.close(); } catch { /* already closed */ }
    this.inputContext = null;
    this.outputContext = null;
    this._emit('idle');
  }
}
