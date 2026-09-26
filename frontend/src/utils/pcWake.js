import { openMicrophone } from './voiceSettings.js';
/**
 * "Hey Jarvis" on the computer: the microphone, streamed to the local backend.
 *
 * openWakeWord runs in the backend (app/pc_wake.py) - a detector trained for
 * the phrase, which the browser's speech recognition is not. This sends 16 kHz
 * mono PCM over /ws/wake and calls onWake when the backend hears it. Audio is
 * scored and dropped there; nothing is recorded.
 */

const socketUrl = (apiBase) => {
  if (apiBase) return `${apiBase.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/wake`;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws/wake`;
};

/** Float samples (-1..1) as little-endian 16-bit PCM. */
export function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

/**
 * Start listening. Returns stop(). Fails quietly (onError) if the microphone
 * or the backend's detector is unavailable - the browser's own wake phrase
 * listener still runs alongside.
 */
export function startPcWake({ apiBase = '', onWake, onError, onReady } = {}) {
  let stopped = false;
  let socket = null;
  let stream = null;
  let context = null;
  let processor = null;
  let retry = null;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(socketUrl(apiBase));
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.wake) onWake?.(message.wake);
        else if (message.ready) onReady?.(message.phrases || []);
        else if (message.error) onError?.(message.error);
      } catch { /* not JSON: ignore */ }
    };
    // The backend restarts with the app; reconnect rather than go deaf.
    socket.onclose = () => {
      if (!stopped) retry = window.setTimeout(connect, 3000);
    };
  };

  (async () => {
    try {
      stream = await openMicrophone({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      context = new AudioCtx({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(toPcm16(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      connect();
    } catch (error) {
      onError?.(String(error?.message || error));
    }
  })();

  return () => {
    stopped = true;
    if (retry) window.clearTimeout(retry);
    try { socket?.close(); } catch { /* already closed */ }
    try { processor?.disconnect(); } catch { /* already */ }
    try { context?.close(); } catch { /* already */ }
    stream?.getTracks().forEach((t) => t.stop());
  };
}
