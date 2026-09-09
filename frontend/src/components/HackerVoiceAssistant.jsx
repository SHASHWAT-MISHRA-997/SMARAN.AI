import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Mic,
  MicOff,
  PictureInPicture2,
  X,
  Zap,
  Send,
  RefreshCw,
  Cpu,
  UserRound,
  Monitor,
  Camera,
  Hand,
  Phone as PhoneIcon,
  Music2,
} from 'lucide-react';
import { LiveVoiceSession } from '../utils/liveVoice';
import { Ambience } from '../utils/ambience';
import * as nativeSpeech from '../utils/nativeSpeech';
import { isNativeApp, loadLink } from '../utils/hostLink';
import { isPhone, micIsBlockedByOrigin, MIC_BLOCKED_REASON } from '../utils/device';

/** No computer behind the phone: the live session these controls need. */
const noBackend = () => isNativeApp() && !loadLink()?.url;
import EnergyCore from './EnergyCore';
import { resolveCoreState } from '../utils/coreStates';
import GestureHUD from './GestureHUD';
import CyberFX from './CyberFX';
import { GESTURES } from '../utils/gestureControl';
import { isDesktopApp } from './RightPanel';
import AvatarVideo, { AVATAR_CHARACTERS } from './AvatarVideo';
import AvatarMMD, { MMD_CHARACTERS, loadUserCharacters } from './AvatarMMD';
import AvatarVega, { VEGA_CHARACTER } from './AvatarVega';
import CyberStage from './CyberStage';
import { classifyTranscriptionFailure, pollFinalTranscript, silenceWindowMs, voiceOutcomeKind } from '../utils/voiceStatus';
import { captionScrollTop, captionSplit } from '../utils/spokenProgress';

/* Prebuilt Gemini Live voices, grouped so a user can simply pick male or
   female. The service decides the exact timbre; these are its own voices. */
/**
 * One round control in the call bar.
 *
 * Circular with the label underneath, the way a phone shows mute and
 * speaker: the shape carries the meaning, so seven of them read as a set
 * rather than as seven competing buttons.
 */
const CallToggle = ({ icon: Icon, label, active = false, disabled = false, danger = false, muted = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    className="group flex w-[52px] flex-col items-center gap-1.5 disabled:opacity-25 sm:w-[58px]"
  >
    <span
      className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all
        group-active:scale-90 group-hover:shadow-[0_0_18px_rgba(239,68,68,.35)] sm:h-12 sm:w-12 ${
        danger
          ? 'border-rose-400/50 bg-rose-500/20 text-rose-300'
          : active
            ? 'border-red-300/80 bg-white text-zinc-900 shadow-[0_0_22px_rgba(248,113,113,.55)]'
            : muted
              ? 'border-white/10 bg-white/[.04] text-zinc-500 group-hover:text-zinc-300'
              : 'border-white/12 bg-white/[.07] text-zinc-200 group-hover:bg-white/[.13]'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
    <span className={`text-[10px] font-medium leading-none ${active ? 'text-white' : 'text-zinc-500'}`}>
      {label}
    </span>
  </button>
);

const LIVE_VOICES = [
  { id: 'Aoede', label: 'Aoede — warm', gender: 'female' },
  { id: 'Kore', label: 'Kore — clear', gender: 'female' },
  { id: 'Leda', label: 'Leda — bright', gender: 'female' },
  { id: 'Puck', label: 'Puck — lively', gender: 'male' },
  { id: 'Charon', label: 'Charon — deep', gender: 'male' },
  { id: 'Fenrir', label: 'Fenrir — strong', gender: 'male' },
  { id: 'Orus', label: 'Orus — steady', gender: 'male' },
];

const isMobileVoiceDevice = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

/**
 * 3D Holographic Iron Man Mark-LXXXV & JARVIS Cyber Arc Reactor Canvas
 * Features:
 * - 180-degree smooth orbital oscillating rotation with 3D perspective projection
 * - Glowing neon visor HUD eyes (reactive to audio frequency & AI thinking/speaking state)
 * - Holographic HUD rings, reticles, particle starfield, and laser audio equalizer
 */
/**
 * IRIS-style AI Core — a particle sphere with orbital rings.
 *
 * Points are distributed over a sphere with the Fibonacci lattice, projected in
 * 3D and rendered with additive blending. The shell breathes with the user's
 * microphone level and pulses while the assistant speaks, shifting from the
 * idle neon green to cyan as it becomes active.
 */




/* ==========================================================================
   IRIS-style dashboard pieces
   Neon-on-black glass panels that report live host telemetry. Every number
   comes from the telemetry feed; anything the host does not report is shown as
   unavailable rather than invented.
   ========================================================================== */



/** Green through amber to red as a load approaches its limit. */




/** A labelled bar whose colour tracks the load it is showing. */


/** A short boot log, so the panel has something to say before data arrives. */


export const HackerVoiceAssistant = ({ isOpen, onClose, onSendQuery, isSpeakingAudio, speechProgress, stopSpeaking, speakText, selectedLanguage = 'hi', voiceAiResponse = '', activeModelDisplay = 'Auto Model', API_BASE, token, audioEnabled, autoSpeakEnabled }) => {
  const [voiceState, setVoiceState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  /* How long the call has been running.
   *
   * "You cannot tell when the call started or ended" was the report, and a
   * colour and a word were the only signals: red means end, green means
   * start, and neither says whether anything is happening right now. Every
   * phone answers this the same way, with a clock that is running or is not
   * there at all. */
  const [callSeconds, setCallSeconds] = useState(0);
  const [chatHistory, setChatHistory] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [micVolume, setMicVolume] = useState(0);
   // 'jarvis' | 'cyberpunk' | 'quantum'
  // Picture-in-picture shrinks and pins the real desktop window, so you can
  // use another application while this keeps listening. A panel drawn inside
  // the page would only float over the page, which helps nobody trying to
  // work elsewhere. Asked of the backend rather than assumed: in a browser
  // there is no window to pin and the control is not offered.
  const [pipAvailable, setPipAvailable] = useState(false);
  const [pipOn, setPipOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/window/status`, { credentials: 'include' });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) {
          setPipAvailable(Boolean(data?.available));
          setPipOn(Boolean(data?.pinned));
        }
      } catch  { /* leave the control hidden */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Spoken "turn on camera" and "share my screen" arrive here. The live
  // session owns the video sources, and it is in this component, so the
  // command is carried the last step by an event rather than by reaching
  // across from the chat.
  useEffect(() => {
    const apply = (event) => {
      const { mode, on } = event.detail || {};
      const session = liveSessionRef.current;
      if (!session) return;
      if (on) session.startVision(mode);
      else session.stopVision();
    };
    window.addEventListener('smaran:vision', apply);
    return () => window.removeEventListener('smaran:vision', apply);
  }, []);

  const togglePip = useCallback(async () => {
    const next = !pipOn;
    try {
      const res = await fetch(`${API_BASE}/api/window/pip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // From here it is always picture-in-picture: this button lives inside
        // the assistant, and picture-in-picture is the assistant. Floating the
        // whole app is a different control in the main window.
        body: JSON.stringify({ on: next, mode: 'pip' }),
      });
      if (res.ok) {
        setPipOn(next);
        // Shrinking the window is only half of it. At 420x560 the full
        // interface is squeezed rather than adapted, which is why it looked
        // wrong - so the page is told, and lays itself out for the size it is
        // actually being shown at.
        document.documentElement.classList.toggle('sm-pip', next);
      }
    } catch  { /* the window stays as it is */ }
  }, [pipOn]);

  // If the window was already pinned when this mounted - reopened while in
  // picture-in-picture - the class has to match.
  useEffect(() => {
    document.documentElement.classList.toggle('sm-pip', pipOn);
  }, [pipOn]);

  // Scrolled to its newest line by the effect further down, once the line it
  // follows has been worked out.
  const captionRef = useRef(null);
  // A zero-width marker sitting exactly between the spoken and unspoken text,
  // so the scroll can find the voice without measuring characters.
  const spokenEdgeRef = useRef(null);

  // Whether there is a network at all. The core had no way to show this, so
  // with the connection gone it went on drawing a healthy cyan idle core while
  // nothing could be reached - the one indicator on this screen saying the
  // opposite of the truth.
  const [online, setOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  ));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Ending the call has to end the voice too. The red handset stopped the
  // live session and closed the screen but never stopped playback, so she went
  // on talking to a screen that was no longer there - and so did the X, the
  // back gesture, and every other way out. Done here, where all of them meet.
  useEffect(() => {
    if (!isOpen) stopSpeaking?.();
  }, [isOpen, stopSpeaking]);

  // The call screen already has a character on it. The desktop companion is
  // fixed to the window rather than to the page, so she stayed put and floated
  // over the call - on a phone, directly across the status line under Amarya.
  // Two characters on one screen was never intended; the companion stands down
  // while the call is up.
  useEffect(() => {
    document.documentElement.classList.toggle('sm-voice-open', isOpen);
    return () => document.documentElement.classList.remove('sm-voice-open');
  }, [isOpen]);

  /* Maximising the window is a way of saying "give me the whole thing back",
     and it was being ignored: the window grew and the page stayed in its
     pinned layout, so a full-screen window showed a picture-in-picture. The
     pinned size is 320 wide, so anything comfortably past it means the window
     has been pulled back out by hand, and the app should agree rather than
     wait to be told twice. */
  useEffect(() => {
    if (!pipOn) return undefined;
    const onResize = () => {
      if (window.innerWidth > 520) {
        fetch(`${API_BASE}/api/window/pip`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ on: false }),
        }).catch(() => {});
        setPipOn(false);
        document.documentElement.classList.remove('sm-pip');
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pipOn]);

  const [micStatus, setMicStatus] = useState('idle');
  // Bumped by the "Try again" button so the microphone effect below runs
  // a second time. Nothing else reads it.
  const [micRetry, setMicRetry] = useState(0);
  const [recognizerStatus, setRecognizerStatus] = useState('idle');
  const [recorderStatus, setRecorderStatus] = useState('idle');
  const [vadStatus, setVadStatus] = useState('idle');

  // How the room is measured before anything is called speech.
  const CALIBRATION_FRAMES = 30;
  // How far above the room tone a sound has to be before it counts as someone
  // talking, and the lowest that bar is ever allowed to fall.
  const SPEECH_MARGIN = 4;
  const SPEECH_FLOOR = 6;
  const noiseFloorRef = useRef(null);
  const calibrationRef = useRef([]);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [voiceIssue, setVoiceIssue] = useState('');
  /* Set when a turn ended with no words, cleared the moment anything is heard.
   *
   * Hearing nothing is an ordinary outcome of listening - the room was quiet,
   * or the words did not carry. It is not a fault, and it needs its own line
   * in the status bar, because the alternative was falling through to the
   * failure branch and telling somebody their microphone did not work when it
   * had just been recording them. */
  const [heardNothing, setHeardNothing] = useState(false);

  // Real-time streaming voice (Gemini Live). When active it replaces the
  // record-then-transcribe path with a continuous two-way audio stream, which
  // also works in the packaged desktop window where SpeechRecognition does not.
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const liveActiveRef = useRef(false);
  useEffect(() => { liveActiveRef.current = liveActive; }, [liveActive]);
  const [liveState, setLiveState] = useState('idle');
  const liveSessionRef = useRef(null);
  const [speechBus, setSpeechBus] = useState(null);
  const [visionMode, setVisionMode] = useState('off');

  // Character and speaking voice are the user's choice and are remembered.
  const [avatarId, setAvatarId] = useState(() => {
    const saved = localStorage.getItem('sm_avatar_id');
    // A character that no longer exists leaves the picker showing a blank and
    // the panel rendering nothing. Riyo was removed, so anyone who had it
    // selected is moved back to a character that is still here.
    // A user-supplied model is known by its prefix; the folder list arrives
    // after this runs, and re-checking it here would blank the picker on every
    // start before the request came back.
    const known = saved === 'core'
      || saved === VEGA_CHARACTER.id
      || String(saved || '').startsWith('user:')
      || MMD_CHARACTERS.some((c) => c.id === saved)
      || AVATAR_CHARACTERS.some((c) => c.id === saved);
    return known ? saved : 'anime-girl';
  });
  // Models the user has added themselves. Fetched once the call opens rather
  // than at module load, because a standalone phone has no backend to ask and
  // the request would fail on every start for nothing.
  const [userCharacters, setUserCharacters] = useState([]);
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    loadUserCharacters(API_BASE).then((found) => {
      if (!cancelled) setUserCharacters(found);
    });
    return () => { cancelled = true; };
  }, [isOpen, API_BASE]);

  // Background ambience. Each character has its own synthesised room tone,
  // and it ducks while the assistant speaks so it never sits over words.
  const [ambienceOn, setAmbienceOn] = useState(
    () => localStorage.getItem('sm_ambience') !== 'off',
  );
  const ambienceRef = useRef(null);

  // Gesture Mode: hand control, tracked on this device only.
  const [gestureMode, setGestureMode] = useState(false);


  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('sm_voice_name') || 'Aoede');
  const [showAvatar, setShowAvatar] = useState(() => localStorage.getItem('sm_show_avatar') !== 'false');

  // Start and switch the bed with the workspace and the chosen character.
  useEffect(() => {
    localStorage.setItem('sm_ambience', ambienceOn ? 'on' : 'off');
    if (!isOpen || !ambienceOn) {
      ambienceRef.current?.stop();
      ambienceRef.current = null;
      return undefined;
    }
    if (!Ambience.isSupported()) return undefined;
    const profile = showAvatar ? (avatarId === 'evelyn' ? 'myraa' : 'myra') : 'core';
    const ambience = ambienceRef.current || new Ambience();
    ambienceRef.current = ambience;
    ambience.start(profile);
    return undefined;
  }, [isOpen, ambienceOn, showAvatar, avatarId]);

  // Tear the bed down when the workspace closes for good.
  useEffect(() => () => {
    ambienceRef.current?.stop();
    ambienceRef.current = null;
  }, []);

  // Duck under the assistant's own voice.
  useEffect(() => {
    ambienceRef.current?.duck(Boolean(isSpeakingAudio));
  }, [isSpeakingAudio]);
  useEffect(() => {
    localStorage.setItem('sm_avatar_id', avatarId);
    // The offline speech engine has no idea who is on screen; record the
    // character's gender so it does not answer in the wrong voice.
    // The drawn characters carry their own gender; the abstract core is given
    // the male voice so both options are available without a second picker.
    const character =
      (avatarId === VEGA_CHARACTER.id ? VEGA_CHARACTER : null) ||
      MMD_CHARACTERS.find((c) => c.id === avatarId) ||
      AVATAR_CHARACTERS.find((c) => c.id === avatarId) ||
      // A model the user added. It carries no gender - we have no idea who
      // someone else's model is meant to be - so this falls through to the
      // default voice below rather than guessing from a folder name.
      userCharacters.find((c) => c.id === avatarId);
    const gender = showAvatar && character?.gender ? character.gender : 'male';
    localStorage.setItem('sm_voice_gender', gender);

    // Reconcile the speaking voice with the character every time, not only when
    // the picker is touched: a saved pairing could otherwise leave a male
    // character answering in a woman's voice.
    setVoiceName((current) => {
      const currentVoice = LIVE_VOICES.find((v) => v.id === current);
      if (currentVoice && currentVoice.gender === gender) return current;
      return (LIVE_VOICES.find((v) => v.gender === gender) || {}).id || current;
    });
    // userCharacters is a dependency because the list arrives after the first
    // render: without it, a saved user model would be resolved once against an
    // empty list and keep whatever voice that produced.
  }, [avatarId, showAvatar, userCharacters]);
  useEffect(() => { localStorage.setItem('sm_voice_name', voiceName); }, [voiceName]);
  useEffect(() => { localStorage.setItem('sm_show_avatar', String(showAvatar)); }, [showAvatar]);
  const [recognizerIssue, setRecognizerIssue] = useState('');

  const recognitionRef = useRef(null);
  /* Set once the browser's speech service has proved unusable, so it is not
     tried again for the rest of the session. Without this the error handler
     restarted it half a second later, forever.

     True from the start in the packaged desktop window: WebView2 exposes
     webkitSpeechRecognition with nothing behind it, so trying it there only
     ever costs a failed attempt and the flicker that goes with it. */
  const speechServiceUnusableRef = useRef(isDesktopApp());

  /* Where the current conversation starts in the chat history. Captured each
     time the session opens, so nothing said before it can be mistaken for
     something said during it. */
  /* Set when starting a live call failed, so it is not retried on a loop. */
  const liveStartFailedRef = useRef(false);
  /* Whether the panel was open on the previous run, so "it just opened"
     can be told apart from "this effect ran again". */
  const wasOpenRef = useRef(false);
  const sessionHistoryBaseRef = useRef(0);
  useEffect(() => {
    if (isOpen) sessionHistoryBaseRef.current = chatHistory.length;
    // chatHistory is deliberately not a dependency: this records where the
    // session began, and must not move as the conversation grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const micStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const transcriptionInFlightRef = useRef(false);
  const autoSendInFlightRef = useRef(false);
  /* Why the recorded-audio fallback last produced nothing.
   *
   * '' when it has not run or it worked, 'unreachable' when there was no
   * transcription endpoint to talk to - which is the ordinary case for a phone
   * that has never been paired with a desktop - 'empty' when it ran and heard
   * nothing, and 'failed' when a server answered and refused.
   *
   * These are three different sentences to say to somebody, and they used to
   * be one. */
  const fallbackReasonRef = useRef('');
  const soundStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(Date.now());
  const hasSpokenRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const voiceStateRef = useRef('idle');
  const isMutedRef = useRef(false);
  /* Whether the call is still on screen, readable from callbacks that were
   * created once and outlive a close - the delayed restarts and the wait for a
   * final transcript both continue running after the screen has gone
   * otherwise. */
  const isOpenRef = useRef(isOpen);
  const transcriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const lastSentQueryRef = useRef({ text: '', at: 0 });
  const resumeListeningRef = useRef(() => {});
  const chatScrollRef = useRef(null);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, voiceAiResponse, interimTranscript, transcript]);

  // Sync latest AI response into conversation bubble stream
  useEffect(() => {
    if (voiceAiResponse) {
      setChatHistory((prev) => {
        if (prev.length === 0) {
          return [{ role: 'assistant', text: voiceAiResponse }];
        }
        const last = prev[prev.length - 1];
        if (last.role === 'assistant') {
          return [...prev.slice(0, -1), { role: 'assistant', text: voiceAiResponse }];
        }
        return [...prev, { role: 'assistant', text: voiceAiResponse }];
      });
      // The response text can arrive before audio generation starts. Let the
      // real audio onplay event move the HUD to `speaking`; otherwise a failed
      // autoplay/TTS request would leave the assistant stuck forever.
      if (voiceStateRef.current === 'thinking' && (!autoSpeakEnabled || !audioEnabled)) {
        setVoiceState('idle');
        voiceStateRef.current = 'idle';
        hasSpokenRef.current = false;
        resumeListeningRef.current();
      }
    }
    if (!voiceAiResponse || !autoSpeakEnabled || !audioEnabled) return undefined;
    const recoveryTimer = window.setTimeout(() => {
      if (voiceStateRef.current === 'thinking' && !isSpeakingRef.current && isOpen && !isMutedRef.current) {
        setVoiceState('idle');
        voiceStateRef.current = 'idle';
        resumeListeningRef.current();
      }
    }, 8000);
    return () => window.clearTimeout(recoveryTimer);
  }, [audioEnabled, autoSpeakEnabled, isOpen, voiceAiResponse]);

  // =========================================================================
  // CONTINUOUS HANDS-FREE VOICE RECOGNITION LOOP (Genspark / Speakly Style)
  // =========================================================================
  /** The phone's own recogniser, when one is listening. */
  const nativeStopRef = useRef(null);
  const nativeRestartTimeoutRef = useRef(null);
  const nativeSessionCountRef = useRef(0);
  // How many native sessions in a row ended instantly having heard
  // nothing. Reset by the first word heard.
  const nativeEndRunRef = useRef(0);

  const stopRecognition = useCallback(() => {
    if (nativeRestartTimeoutRef.current) {
      clearTimeout(nativeRestartTimeoutRef.current);
      nativeRestartTimeoutRef.current = null;
    }
    if (nativeStopRef.current) {
      const end = nativeStopRef.current;
      nativeStopRef.current = null;
      if (typeof end.cancel === 'function') {
        try { end.cancel(); } catch {}
      } else {
        Promise.resolve(end()).catch(() => {});
      }
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch  {}
      recognitionRef.current = null;
    }
  }, []);

  const getRecognitionLang = (langCode) => {
    const map = {
      // Match Dictate's Indian-English locale and native bilingual recognition.
      en: 'en-IN',
      hi: 'hi-IN',
      gu: 'gu-IN',
      pa: 'pa-IN',
      mr: 'mr-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      ml: 'ml-IN',
      kn: 'kn-IN',
      bn: 'bn-IN',
    };
    return map[langCode] || 'en-US';
  };

  const startFreshRecorder = useCallback(() => {
    if (isNativeApp()) return null;
    const stream = micStreamRef.current;
    if (!isOpen || isMutedRef.current || !stream) return null;
    if (!window.MediaRecorder) {
      setRecorderStatus('unavailable');
      return null;
    }
    if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      setRecorderStatus('error');
      setVoiceIssue('The granted microphone stream is no longer active.');
      return null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      setRecorderStatus('recording');
      return mediaRecorderRef.current;
    }

    try {
      setRecorderStatus('starting');
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) audioChunksRef.current.push(event.data);
      };
      // Do not use a timeslice here. Stopping the recorder finalizes a complete,
      // decodable container for the local Whisper fallback.
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecorderStatus('recording');
      return recorder;
    } catch (error) {
      console.warn('Local voice recorder could not start:', error);
      setRecorderStatus('error');
      setVoiceIssue(`Audio recorder could not start: ${error?.message || 'unsupported recorder'}`);
      return null;
    }
  }, [isOpen]);

  const finalizeRecordedAudio = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;

    if (recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        recorder.addEventListener('stop', finish, { once: true });
        try {
          recorder.stop();
        } catch  {
          finish();
        }
        window.setTimeout(finish, 2000);
      });
    }

    if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
    setRecorderStatus('stopped');
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];
    if (!chunks.length) return null;
    const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
    return new Blob(chunks, { type: mimeType });
  }, []);

  const startRecognition = useCallback(() => {
    if (!isOpen || isMutedRef.current) return;
    stopRecognition();

    /* There is no microphone on this origin. SpeechRecognition is still
       defined here, so every check below concludes it can listen - which is
       how this ended on "voice input unavailable" with a Try again button for
       something retrying cannot change. */
    if (micIsBlockedByOrigin()) {
      setRecognizerStatus('unavailable');
      setRecognizerIssue(MIC_BLOCKED_REASON);
      return;
    }

    // Android WebView repeatedly tears down its hosted SpeechRecognition
    // service, producing the audible mic on/off loop. Mobile already has the
    // local MediaRecorder + VAD + Whisper path below, which is more reliable.
    //
    // The desktop window is the same story and was not covered. WebView2
    // exposes webkitSpeechRecognition without any speech service behind it,
    // so it fails with 'network', the handler below restarted it half a
    // second later, and it failed again - a loop that took the microphone
    // with it. That is why a voice call went green and dropped straight away
    // and why nothing spoken ever reached the assistant. Once the service has
    // shown it cannot work, this session stops asking.
    /* Ask the phone itself.
     *
     * The branch below says speech is "transcribed locally" and on a phone
     * with no computer linked that was not true: it recorded, posted the audio
     * to a backend that is not there, got this app's own index.html back, and
     * the call sat on "waiting" having heard nothing. Android has its own
     * recogniser; it feeds the same transcript the rest of this screen reads,
     * so the silence watchdog and auto-send work unchanged.
     *
     * The recorder still runs alongside it - that is where the level meter and
     * the silence detection come from, not the words. */
    if (isNativeApp()) {
      const sessionId = ++nativeSessionCountRef.current;
      (async () => {
        if (!(await nativeSpeech.available())) {
          if (sessionId !== nativeSessionCountRef.current) return;
          setRecognizerStatus('unavailable');
          setRecognizerIssue('This phone has no speech recogniser available.');
          return;
        }
        if (sessionId !== nativeSessionCountRef.current || !isOpen || isMutedRef.current) return;
        const startedAt = Date.now();
        let heardAnything = false;
        try {
          const stopListening = await nativeSpeech.listen({
            language: getRecognitionLang(selectedLanguage),
            continuous: true,
            onText: (heard) => {
              if (sessionId !== nativeSessionCountRef.current) return;
              heardAnything = true;
              nativeEndRunRef.current = 0;
              setTranscript(heard);
              transcriptRef.current = heard;
              hasSpokenRef.current = true;
              lastSpeechTimeRef.current = Date.now();
              if (voiceStateRef.current === 'idle' || voiceStateRef.current === 'vad-ready') {
                setVoiceState('listening');
                voiceStateRef.current = 'listening';
              }
            },
            /* Android stops listening on its own, and nothing was told.
             *
             * Android's recogniser ends a session after a pause - that is
             * its normal behaviour, not a fault. The plugin reports it,
             * and dictation acts on it; this passed no onEnd at all, so
             * the session died and the screen went on saying 'Listening'.
             * Nothing more was ever heard. Pausing mid-sentence was
             * enough to do it, which is why Speak on the phone looked
             * like it simply did not work.
             *
             * The Web Speech path below has restarted itself on 'end'
             * since the beginning. This is the same thing, for the
             * recogniser the phone actually uses. */
            onEnd: ({ reason, message } = {}) => {
              if (sessionId !== nativeSessionCountRef.current) return;
              nativeStopRef.current = null;
              if (reason === 'cancelled' || reason === 'manual') return;
              if (message) {
                setRecognizerStatus('unavailable');
                setRecognizerIssue(message);
                return;
              }
              // A session that ends at once, having heard nothing, is a
              // recogniser that cannot run - usually Google's speech
              // service disabled or a missing language pack. Restarting
              // it forever would hold the microphone and drain the
              // battery to no purpose, which is the loop the Web Speech
              // path already had to learn its way out of.
              if (!heardAnything && Date.now() - startedAt < 1200) {
                nativeEndRunRef.current += 1;
              } else {
                nativeEndRunRef.current = 0;
              }
              if (nativeEndRunRef.current >= 3) {
                setRecognizerStatus('unavailable');
                setRecognizerIssue('This phone stops listening the moment it starts. '
                  + 'On most Android phones that is Google’s speech service '
                  + 'being disabled, or the language pack for this language '
                  + 'not being installed.');
                return;
              }
              const canListen = isOpen && !isMutedRef.current
                && voiceStateRef.current !== 'thinking'
                && voiceStateRef.current !== 'speaking';
              if (!canListen) {
                // Say what is true. Claiming 'active' while nothing is
                // listening is how this hid for so long.
                setRecognizerStatus('idle');
                return;
              }
              if (nativeRestartTimeoutRef.current) {
                clearTimeout(nativeRestartTimeoutRef.current);
              }
              nativeRestartTimeoutRef.current = setTimeout(() => {
                nativeRestartTimeoutRef.current = null;
                if (isOpen && !isMutedRef.current
                    && voiceStateRef.current !== 'thinking'
                    && voiceStateRef.current !== 'speaking') {
                  startRecognition();
                }
              }, 300);
            },
          });
          if (sessionId !== nativeSessionCountRef.current || !isOpen || isMutedRef.current) {
            if (typeof stopListening?.cancel === 'function') stopListening.cancel();
            return;
          }
          nativeStopRef.current = stopListening;
          setMicStatus('granted');
          setVoiceState('listening');
          voiceStateRef.current = 'listening';
          setRecognizerStatus('active');
          setRecognizerIssue('');
        } catch (error) {
          if (sessionId !== nativeSessionCountRef.current) return;
          const message = String(error?.message || '').toLowerCase();
          if (message.includes('no match')
              || message.includes("didn't understand")
              || message.includes('no speech')
              || message.includes('client side error')) {
            // A quiet test interval is an ordinary recognition outcome. The
            // native wrapper normally converts it into onEnd; keep this
            // guard for plugin versions that reject before that conversion.
            setRecognizerStatus('idle');
            setRecognizerIssue('No speech was heard; listening again.');
            if (isOpen && !isMutedRef.current
                && voiceStateRef.current !== 'thinking'
                && voiceStateRef.current !== 'speaking') {
              if (nativeRestartTimeoutRef.current) {
                clearTimeout(nativeRestartTimeoutRef.current);
              }
              nativeRestartTimeoutRef.current = setTimeout(() => {
                nativeRestartTimeoutRef.current = null;
                if (isOpen && !isMutedRef.current
                    && voiceStateRef.current !== 'thinking'
                    && voiceStateRef.current !== 'speaking') {
                  startRecognition();
                }
              }, 300);
            }
            return;
          }
          setRecognizerStatus('unavailable');
          setRecognizerIssue(error?.message || 'The phone would not start listening.');
        }
      })();
      return;
    }

    if (isMobileVoiceDevice() || speechServiceUnusableRef.current) {
      setRecognizerStatus('local');
      setRecognizerIssue('Listening on this device; speech is transcribed locally.');
      startFreshRecorder();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognizerStatus('unavailable');
      setRecognizerIssue('Live recognition is unavailable; recorded audio will be transcribed locally instead.');
      return;
    }

    try {
      setRecognizerStatus('starting');
      setRecognizerIssue('');
      const recognition = new SpeechRecognition();
      recognition.lang = getRecognitionLang(selectedLanguage);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setRecognizerStatus('active');
        setRecognizerIssue('');
        setVoiceIssue('');
        setHeardNothing(false);
        setVoiceState('listening');
        voiceStateRef.current = 'listening';
      };

      recognition.onresult = (event) => {
        if (voiceStateRef.current !== 'listening') return;

        let newFinalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            newFinalText += result[0].transcript + ' ';
          } else {
            interimText += result[0].transcript;
          }
        }
        if (newFinalText.trim()) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${newFinalText}`.trim();
        }
        const finalText = finalTranscriptRef.current;
        interimText = interimText.trim();

        if (finalText || interimText) {
          setVadStatus('speech-detected');
          // Something was heard, so the previous turn's "I did not catch that"
          // has stopped being true and must stop being displayed.
          setHeardNothing(false);
          hasSpokenRef.current = true;
          lastSpeechTimeRef.current = Date.now();
        }

        setTranscript(finalText);
        transcriptRef.current = finalText;
        setInterimTranscript(interimText);
        interimTranscriptRef.current = interimText;
      };

      recognition.onerror = (e) => {
        if (e.error === 'aborted') {
          setRecognizerStatus('stopped');
          return;
        }
        if (e.error === 'no-speech') {
          setRecognizerStatus('active');
          if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
            setTimeout(() => {
              if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
                startRecognition();
              }
            }, isMobileVoiceDevice() ? 900 : 300);
          }
          return;
        }
        // These three mean the hosted speech service is unusable, not that
        // the microphone is. Retrying only produced the same failure again.
        // 'service-not-allowed' was being reported as a denied microphone,
        // which sent people to check a permission that was already granted.
        if (['network', 'service-not-allowed', 'language-not-supported'].includes(e.error)) {
          speechServiceUnusableRef.current = true;
          setRecognizerStatus('local');
          setRecognizerIssue('Listening on this device; speech is transcribed locally.');
          startFreshRecorder();
          return;
        }

        const permissionError = e.error === 'not-allowed';
        setRecognizerStatus(permissionError ? 'denied' : 'error');
        setRecognizerIssue(permissionError
          ? 'Microphone permission was denied. Allow it, then try again.'
          : `Speech recognition error: ${e.error || 'unknown error'}.`);
        if (permissionError && mediaRecorderRef.current?.state !== 'recording') {
          setVoiceState('error');
          voiceStateRef.current = 'error';
        }
        if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
          setTimeout(() => {
            if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
              startRecognition();
            }
          }, isMobileVoiceDevice() ? 1000 : 500);
        }
      };

      recognition.onend = () => {
        // onerror fires first and onend follows it, so without this the
        // restart it just decided against happened anyway.
        if (speechServiceUnusableRef.current) return;
        setRecognizerStatus((current) => current === 'denied' || current === 'error' ? current : 'active');
        if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
          setTimeout(() => {
            if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') {
              startRecognition();
            }
          }, isMobileVoiceDevice() ? 900 : 250);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      setRecognizerStatus('error');
      setRecognizerIssue(`Speech recognition could not start: ${error?.message || 'unknown error'}.`);
      setTimeout(() => {
        if (isOpen && !isMutedRef.current && voiceStateRef.current !== 'thinking' && voiceStateRef.current !== 'speaking') startRecognition();
      }, 500);
    }
  }, [isOpen, selectedLanguage, stopRecognition, startFreshRecorder]);

  resumeListeningRef.current = () => {
    // The live stream owns the microphone while it is running. Taking it here
    // is what made "Start talking" end the moment it began: the session
    // closed, this grabbed the device, the session restarted, could not get
    // the device, errored, and closed again.
    if (liveActiveRef.current || liveSessionRef.current) return;
    setUploadStatus('idle');
    const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
    setVadStatus(vadReady ? 'ready' : 'unavailable');
    setVoiceState(vadReady ? 'vad-ready' : 'idle');
    voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
    startFreshRecorder();
    startRecognition();
  };

  // When AI finishes speaking -> automatically restart listening loop for perpetual conversation
  const wasSpeakingRef = useRef(false);
  useEffect(() => {
    const previouslySpeaking = wasSpeakingRef.current;
    wasSpeakingRef.current = isSpeakingAudio;
    isSpeakingRef.current = isSpeakingAudio;
    if (isSpeakingAudio) {
      setVoiceState('speaking');
      voiceStateRef.current = 'speaking';
      stopRecognition();
      finalizeRecordedAudio().catch(() => {});
    } else if (previouslySpeaking || voiceStateRef.current === 'speaking') {
      setVoiceState('idle');
      voiceStateRef.current = 'idle';
      hasSpokenRef.current = false;
      setTranscript('');
      setInterimTranscript('');
      transcriptRef.current = '';
      interimTranscriptRef.current = '';
      setTimeout(() => {
        if (isOpen && !isMutedRef.current) {
          startFreshRecorder();
          startRecognition();
        }
      }, 150);
    }
  }, [isSpeakingAudio, isOpen, finalizeRecordedAudio, startFreshRecorder, startRecognition, stopRecognition]);

  // Backend Audio Transcription Fallback (Whisper)
  const transcribeBackendAudio = useCallback(async () => {
    if (transcriptionInFlightRef.current) return '';
    if (isNativeApp() && noBackend()) {
      fallbackReasonRef.current = 'unreachable';
      setUploadStatus('unavailable');
      return '';
    }
    transcriptionInFlightRef.current = true;
    try {
      const audioBlob = await finalizeRecordedAudio();
      if (!audioBlob) return '';
      if (audioBlob.size < 400) return '';

      setUploadStatus('uploading');
      setVoiceState('uploading');
      voiceStateRef.current = 'uploading';
      setVoiceIssue('');

      const formData = new FormData();
      const extension = audioBlob.type.includes('mp4') ? 'm4a' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      formData.append('file', audioBlob, `voice_query.${extension}`);
      // Detect speech independently of the desired reply language.
      formData.append('language', 'auto');
      formData.append('request_id', window.crypto?.randomUUID?.() || `${Date.now()}`);
      const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        const backendTranscript = (data?.transcript || '').trim();
        setUploadStatus(backendTranscript ? 'complete' : 'empty');
        fallbackReasonRef.current = backendTranscript ? '' : 'empty';
        return backendTranscript;
      }
      // A phone that was never paired serves the app shell and nothing else,
      // so the transcription route is simply not there. That is a missing
      // option, not a broken microphone.
      const httpReason = classifyTranscriptionFailure(null, res.status);
      if (httpReason === 'unreachable') {
        fallbackReasonRef.current = 'unreachable';
        setUploadStatus('unavailable');
        return '';
      }
      throw new Error(`Local transcription returned HTTP ${res.status}`);
    } catch (error) {
      console.warn('Local voice transcription failed:', error);
      // fetch rejects rather than resolving when there is nothing listening,
      // which is what happens on a standalone phone with no desktop paired.
      const unreachable = classifyTranscriptionFailure(error) === 'unreachable';
      fallbackReasonRef.current = unreachable ? 'unreachable' : 'failed';
      setUploadStatus(unreachable ? 'unavailable' : 'error');
      if (!unreachable) {
        setVoiceIssue(`Recorded-audio transcription failed: ${error?.message || 'transcription service refused the request'}`);
      }
      return '';
    } finally {
      transcriptionInFlightRef.current = false;
    }
  }, [API_BASE, finalizeRecordedAudio, selectedLanguage, token]);

  /* How long to wait for a final result once the audio has gone quiet.
   *
   * The watchdog has already waited 850 ms, so this is on top of that. It is
   * an upper bound and is usually not reached: the recogniser commits as soon
   * as it is sure, and this returns the moment it does. */
  const FINAL_TRANSCRIPT_GRACE_MS = 900;

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  const waitForFinalTranscript = useCallback(async () => {
    const deadline = Date.now() + FINAL_TRANSCRIPT_GRACE_MS;
    const quietSince = lastSpeechTimeRef.current;
    for (;;) {
      // The precedence lives in pollFinalTranscript, where it is unit tested.
      const decision = pollFinalTranscript({
        finalText: transcriptRef.current,
        lastSpeechAt: lastSpeechTimeRef.current,
        quietSince,
        muted: isMutedRef.current,
        open: isOpenRef.current,
        expired: Date.now() >= deadline,
      });
      if (decision !== 'wait') return decision;
      await new Promise((resolve) => { window.setTimeout(resolve, 60); });
    }
  }, []);

  // Trigger send when user stops talking (0.85s silence detected)
  const triggerAutoSend = useCallback(async () => {
    // The live session owns the conversation when it is running. Without
    // this the old record-transcribe-send path fired as well, so one spoken
    // sentence went down two routes at once: the slow one answered second
    // and overwrote the live reply, and consecutive sentences ran together.
    if (liveActiveRef.current) return;
    if (autoSendInFlightRef.current || voiceStateRef.current === 'thinking' || voiceStateRef.current === 'speaking' || isMutedRef.current) return;
    autoSendInFlightRef.current = true;

    try {
      fallbackReasonRef.current = '';
      let finalQuery = (transcriptRef.current || '').trim();

      /* Give the recogniser its last word before committing the turn.
       *
       * The silence watchdog fires 850 ms after the audio stops. Android's
       * recogniser commits its final result some hundreds of milliseconds
       * after that, so at the moment this ran there was often only interim
       * text - and taking it sent half a sentence and discarded the rest when
       * it arrived. That is the "it cuts my sentences" report.
       *
       * Waiting is bounded, and the interim is still used if nothing final
       * turns up: losing the tail of a sentence is bad, losing the whole turn
       * is worse.
       *
       * If the user simply started talking again, the pause was inside a
       * sentence rather than the end of one, and there is nothing to send. */
      if (!finalQuery && (interimTranscriptRef.current || '').trim()) {
        const outcome = await waitForFinalTranscript();
        // Resumed speech is mid-sentence; a closed or muted call has nobody to
        // answer. Neither is a turn.
        if (outcome === 'resumed' || outcome === 'cancelled') return;
        finalQuery = (transcriptRef.current || interimTranscriptRef.current || '').trim();
      }

      if (!finalQuery) {
        if (!isNativeApp()) {
          const backendText = await transcribeBackendAudio();
          if (backendText) finalQuery = backendText.trim();
        }
      } else {
        // Native SpeechRecognition already supplied the text. Discard its parallel
        // recording so a later fallback cannot repeat an older utterance.
        await finalizeRecordedAudio();
      }

      if (!finalQuery || finalQuery.length < 2) {
        // Say so. This reset the state and went back to listening
        // without a word, which is indistinguishable from the app
        // having ignored you - and it is the likeliest outcome when the
        // recogniser is running against a language it does not have.
        const nothingHeard = selectedLanguage === 'hi'
          ? 'मैंने कुछ सुना नहीं। थोड़ा पास आकर दोबारा कहिए।'
          : 'I did not catch that. Say it again, a little closer to the microphone.';
        setVoiceIssue(nothingHeard);
        setHeardNothing(true);
        setChatHistory((prev) => [...prev, { role: 'assistant', text: nothingHeard }]);
        const willSpeak = Boolean(autoSpeakEnabled && audioEnabled && speakText);
        if (willSpeak) {
          setVoiceState('speaking');
          voiceStateRef.current = 'speaking';
          speakText(nothingHeard, selectedLanguage);
        }
        hasSpokenRef.current = false;

        /* Go back to listening, unconditionally.
         *
         * This used to be guarded by `voiceStateRef.current !== 'error'`, and
         * the fallback above set exactly that state whenever it could not
         * reach a transcription endpoint. On a phone with no paired desktop
         * that is every turn, so the first silence put Speak into an error it
         * could never leave: the reset was skipped, the state stayed 'error',
         * and every following turn skipped the reset too.
         *
         * Nothing above this line is a reason not to keep listening. A real
         * fault - a denied microphone, a recogniser that will not start - is
         * carried by micStatus and recognizerStatus, which are not touched
         * here and still stop the call on their own.
         */
        const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
        if (!willSpeak) {
          setVoiceState(vadReady ? 'vad-ready' : 'idle');
          voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
        }
        setVadStatus(vadReady ? 'ready' : 'unavailable');
        // An upload that failed on the way to this point has been accounted
        // for; leaving it set would keep the failure branch lit afterwards.
        setUploadStatus((previous) => (previous === 'error' ? 'idle' : previous));
        startFreshRecorder();
        if (!willSpeak) {
          startRecognition();
        }
        return;
      }

      const normalizedQuery = finalQuery.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
      const now = Date.now();
      if (lastSentQueryRef.current.text === normalizedQuery && now - lastSentQueryRef.current.at < 12000) {
        // Shown, not spoken. Repeating a sentence usually means the
        // first one was not heard, and answering that with a spoken
        // complaint every time would be worse than the silence - but
        // the silence itself read as the app being broken.
        setVoiceIssue(selectedLanguage === 'hi'
          ? 'यही बात अभी-अभी पूछी गई थी, इसलिए दोबारा नहीं भेजी।'
          : 'That was the same as the last question, so it was not sent again.');
        hasSpokenRef.current = false;
        finalTranscriptRef.current = '';
        startFreshRecorder();
        return;
      }
      lastSentQueryRef.current = { text: normalizedQuery, at: now };

      // Add user message to conversation list
      setChatHistory((prev) => [...prev, { role: 'user', text: finalQuery }]);
      setUploadStatus('idle');
      setVoiceState('thinking');
      voiceStateRef.current = 'thinking';
      hasSpokenRef.current = false;

      setTranscript('');
      setInterimTranscript('');
      transcriptRef.current = '';
      interimTranscriptRef.current = '';
      finalTranscriptRef.current = '';
      stopRecognition();

      if (onSendQuery) {
        await onSendQuery(finalQuery);
      }
    } catch (error) {
      console.warn('Voice query failed:', error);
      setVoiceIssue(`Voice query failed: ${error?.message || 'model request unavailable'}`);
      setVoiceState('error');
      voiceStateRef.current = 'error';
      startFreshRecorder();
      startRecognition();
    } finally {
      autoSendInFlightRef.current = false;
    }
  }, [audioEnabled, autoSpeakEnabled, finalizeRecordedAudio, onSendQuery, selectedLanguage,
      speakText, startFreshRecorder, startRecognition, stopRecognition, transcribeBackendAudio,
      waitForFinalTranscript]);

  // Silence watchdog. The window is not fixed: it starts at 850 ms for a short
  // reply and stretches toward two seconds once enough has been said that this
  // is plainly dictation, whose sentences have longer gaps between them. The
  // rule lives in silenceWindowMs, where it is unit tested.
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      if (['listening', 'capturing', 'vad-ready'].includes(voiceStateRef.current) && hasSpokenRef.current && !isMutedRef.current) {
        const elapsed = Date.now() - lastSpeechTimeRef.current;
        const spoken = (transcriptRef.current || interimTranscriptRef.current || '').length;
        if (elapsed > silenceWindowMs({ spokenChars: spoken })) {
          triggerAutoSend();
        }
      }
    }, 120);

    return () => clearInterval(interval);
  }, [isOpen, triggerAutoSend]);

  // Setup Microphone & AudioContext metering
  useEffect(() => {
    if (!isOpen) return;
    // The live stream owns the microphone when it is running. Letting the
    // turn-based recorder start as well made both compete for the device, and
    // the slow upload-and-transcribe path answered instead of the live one.
    if (liveActive || liveAvailable) {
      // Clear any half-finished request from a previous pass. Without this the
      // status stayed on 'requesting' forever: the first run asked for the
      // microphone, liveAvailable resolved while that prompt was open, and the
      // re-run bailed out here leaving the old status stranded on screen even
      // though permission had in fact been granted.
      setMicStatus((current) => (current === 'requesting' ? 'idle' : current));
      setVoiceState((current) => (current === 'permission' ? 'idle' : current));
      if (voiceStateRef.current === 'permission') voiceStateRef.current = 'idle';
      return;
    }
    let isMounted = true;

    const initMicrophone = async () => {
      try {
        setMicStatus('requesting');
        setRecognizerStatus('idle');
        setRecorderStatus('idle');
        setVadStatus('idle');
        setUploadStatus('idle');
        setVoiceIssue('');
        setHeardNothing(false);
        setRecognizerIssue('');
        setVoiceState('permission');
        voiceStateRef.current = 'permission';

        // Android's recognizer owns microphone capture. Opening a WebView
        // recorder at the same time can silence the recognizer on devices
        // that do not share input streams. Native text events drive the
        // existing silence watchdog; a second recorder is unnecessary here.
        if (isNativeApp()) {
          setMicStatus('idle');
          startRecognition();
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          // Capacitor can expose no WebView media device on a particular
          // Android/WebView build even though Android's native recogniser is
          // available and RECORD_AUDIO is granted.  Do not turn that WebView
          // limitation into “Voice input unavailable”; start the native path
          // directly and let it report its own service/permission result.
          if (isNativeApp()) {
            setMicStatus('idle');
            setVoiceIssue('WebView microphone capture is unavailable; using Android speech input.');
            startRecognition();
            return;
          }
          setMicStatus('unavailable');
          setVoiceIssue('This browser does not expose microphone capture to the application.');
          setVoiceState('error');
          voiceStateRef.current = 'error';
          return;
        }

        if (micStreamRef.current) {
          try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch  {}
        }
        if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch  {}
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          // Permission was granted; do not leave the label claiming otherwise.
          setMicStatus((current) => (current === 'requesting' ? 'idle' : current));
          return;
        }
        micStreamRef.current = stream;
        setMicStatus('granted');

        startFreshRecorder();

        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          source.connect(analyser);
          analyserRef.current = analyser;
          setVadStatus('ready');
          setVoiceState('vad-ready');
          voiceStateRef.current = 'vad-ready';

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          // A new microphone session is a new room: measure it again rather
          // than trusting a baseline from somewhere the person no longer is.
          noiseFloorRef.current = null;
          calibrationRef.current = [];
          const updateVolume = () => {
            if (!isMounted) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            setMicVolume(Math.min(100, Math.round(avg * 1.6)));
            // Always run local volume/silence detection. Chromium-derived
            // browsers may expose SpeechRecognition while its hosted service is
            // unavailable; in that case this path still sends recorded audio to
            // the bundled local faster-whisper endpoint.
            // Speech is louder than THIS room, not louder than 14.
            //
            // This used to be `avg >= 14` against the raw average - a fixed
            // number, with no idea what the room sounds like. Any microphone
            // whose resting hum sits above 14 reads as speech the instant it
            // opens, which is why 'Speech detected' appeared before anyone had
            // said anything and then stayed. autoGainControl above makes it
            // likelier, not less: in a quiet room the browser turns the gain up
            // until the room tone itself is loud.
            //
            // So the first moments after the microphone opens are spent
            // listening rather than judging, and the room's own level becomes
            // the baseline everything is measured against. The median is used
            // rather than the mean so one cough during calibration cannot set
            // the bar for the rest of the session. This is the ordinary
            // energy-based approach: a floor estimated from the signal itself,
            // and a margin above it.
            //
            // The bar is never lowered below the old 14. In a quiet room this
            // behaves exactly as before; it only rises where the old number was
            // being cleared by nothing but noise.
            const floor = noiseFloorRef.current;
            if (floor === null) {
              const collected = calibrationRef.current;
              collected.push(avg);
              if (collected.length >= CALIBRATION_FRAMES) {
                const sorted = [...collected].sort((a, b) => a - b);
                noiseFloorRef.current = sorted[Math.floor(sorted.length / 2)];
              }
              // Nothing is called speech while the room is still being measured.
              soundStartTimeRef.current = 0;
            } else if (['listening', 'capturing', 'vad-ready'].includes(voiceStateRef.current) && !isMutedRef.current) {
              const speakAt = Math.max(SPEECH_FLOOR, floor + SPEECH_MARGIN);
              const quietAt = Math.max(SPEECH_FLOOR / 2, floor + SPEECH_MARGIN / 2);
              if (avg >= speakAt) {
                if (!soundStartTimeRef.current) soundStartTimeRef.current = Date.now();
                if (Date.now() - soundStartTimeRef.current >= 140) {
                  if (!hasSpokenRef.current) {
                    setVadStatus('speech-detected');
                    setHeardNothing(false);
                    if (voiceStateRef.current !== 'listening') {
                      setVoiceState('capturing');
                      voiceStateRef.current = 'capturing';
                    }
                  }
                  hasSpokenRef.current = true;
                  lastSpeechTimeRef.current = Date.now();
                }
              } else if (avg < quietAt) {
                soundStartTimeRef.current = 0;
                // A room does not stay as loud as it was when it was measured -
                // a fan stops, a window shuts. Following it slowly, and only
                // while nothing is being said, keeps the baseline honest without
                // letting a long sentence drag it upward.
                noiseFloorRef.current = floor * 0.99 + avg * 0.01;
              }
            }
            requestAnimationFrame(updateVolume);
          };
          updateVolume();
        } catch (error) {
          setVadStatus('unavailable');
          setVoiceIssue(`Audio level detection is unavailable: ${error?.message || 'AudioContext could not start'}`);
        }

        startRecognition();
      } catch (error) {
        if (!isMounted) return;
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setMicStatus(denied ? 'denied' : 'error');
        setRecorderStatus('idle');
        setVadStatus('idle');

        /* On a phone, this failure does not mean voice input is gone.
         *
         * startRecognition() is the last line of the try above, so
         * anything that threw before it - getUserMedia, the recorder,
         * the audio context - meant it never ran. On Android that is the
         * one path that would have worked: the phone's own recogniser
         * captures its own audio and never touches getUserMedia. The
         * screen then said "Voice input unavailable", which was true only
         * because the app had stopped trying.
         *
         * What is actually lost here is the level meter and the silence
         * detection, both of which come from the audio graph. Listening
         * does not depend on them. */
        // Capacitor's WebView can reject getUserMedia even when Android has
        // granted RECORD_AUDIO (the WebView origin is not the Android app
        // origin).  That failure only removes the level meter/recorder; it
        // must never stop us from asking Android's SpeechRecognizer, which
        // owns its microphone permission separately.
        if (isNativeApp()) {
          setVoiceIssue(`The audio meter could not start (${error?.name || 'error'}: `
            + `${error?.message || 'no detail'}), so this phone's own recogniser is `
            + 'being used instead.');
          startRecognition();
          return;
        }

        setRecognizerStatus('idle');
        // The name as well as the message. "Microphone initialization
        // failed" on its own is the same sentence for a missing device, a
        // busy device and a WebView that refused, and a screenshot of it
        // tells nobody which.
        setVoiceIssue(denied
          ? 'Microphone permission was denied. Allow microphone access to use voice input.'
          : `Microphone initialization failed - ${error?.name || 'Error'}: `
            + `${error?.message || 'no input device available'}`);
        setVoiceState('error');
        voiceStateRef.current = 'error';
      }
    };

    initMicrophone();

    return () => {
      isMounted = false;
      stopRecognition();
      if (micStreamRef.current) {
        try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch  {}
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch  {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch  {}
      }
      setRecorderStatus('stopped');
      setRecognizerStatus('stopped');
      setVadStatus('idle');
    };
  }, [isOpen, liveActive, liveAvailable, startFreshRecorder, startRecognition, stopRecognition]);

  const handleManualTextSubmit = async (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const query = textInput.trim();
    setTextInput('');
    setChatHistory((prev) => [...prev, { role: 'user', text: query }]);
    setVoiceState('thinking');
    voiceStateRef.current = 'thinking';
    stopSpeaking();
    stopRecognition();

    try {
      if (onSendQuery) {
        await onSendQuery(query);
      }
    } catch (error) {
      setVoiceIssue(`Typed voice-session request failed: ${error?.message || 'model request unavailable'}`);
      setVoiceState('error');
      voiceStateRef.current = 'error';
    }
  };

  // Is a real-time voice key configured on this install?
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/voice/live/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLiveAvailable(Boolean(data?.available) && !isMobileVoiceDevice());
      } catch  {
        /* leave real-time voice switched off */
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, API_BASE, token, micRetry]);

  // Set when the person hangs up, cleared when the panel is opened again.
   // Without it there is no way to tell "no session yet" from "deliberately
   // ended", and the auto-start effect cannot respect the difference.
  const endedByUserRef = useRef(false);

  // Which source to share is asked once, from the one Vision button.
  const [visionMenuOpen, setVisionMenuOpen] = useState(false);

  // Which engine serves a live call. Remembered, because someone running
  // without a key wants local every time, not once.
  const [voiceEngine] = useState(
    () => localStorage.getItem('sm_voice_engine') || 'local',
  );
  useEffect(() => { localStorage.setItem('sm_voice_engine', voiceEngine); }, [voiceEngine]);

  useEffect(() => {
    if (!liveActive) { setCallSeconds(0); return undefined; }
    setCallSeconds(0);
    const started = Date.now();
    const timer = setInterval(
      () => setCallSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [liveActive]);

  const stopLiveSession = useCallback(async () => {
    const session = liveSessionRef.current;
    liveSessionRef.current = null;
    endedByUserRef.current = true;
    // Silence her first. Hanging up released the microphone but left the
    // reply already in flight still playing, so she kept talking after the
    // call had visibly ended. This runs before anything else so the voice
    // stops on the same click rather than after the teardown.
    stopSpeaking?.();
    setLiveActive(false);
    setLiveState('idle');
    // Clear what was being said as well as the flags. Without this the
    // last utterance stayed on screen after the session ended, and was
    // still sitting there when the next one started.
    setTranscript('');
    setInterimTranscript('');
    transcriptRef.current = '';
    interimTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    if (session) await session.stop();
  }, [stopSpeaking]);

  const startLiveSession = useCallback(async () => {
    // The turn-based recogniser and the live stream must not hold the
    // microphone at the same time.
    stopRecognition();
    try { await finalizeRecordedAudio(); } catch  { /* nothing recorded */ }
    if (micStreamRef.current) {
      try { micStreamRef.current.getTracks().forEach((t) => t.stop()); } catch  {}
      micStreamRef.current = null;
    }

    setRecognizerStatus('idle');
    setRecorderStatus('idle');
    setVadStatus('idle');
    setUploadStatus('idle');

    const session = new LiveVoiceSession({
      engine: voiceEngine,
      onStateChange: (state) => {
        setLiveState(state);
        if (state === 'speaking') {
          setVoiceState('speaking');
        } else if (state === 'listening') {
          setVoiceState('listening');
        } else if (state === 'closed' || state === 'error') {
          liveSessionRef.current = null;
          setLiveActive(false);
          setVoiceState('idle');
          voiceStateRef.current = 'idle';
          window.setTimeout(() => resumeListeningRef.current(), 250);
        }
      },
      onLevel: (level) => setMicVolume(level),
      onText: (text) => {
        setChatHistory((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + text }];
          }
          return [...prev, { role: 'assistant', text, streaming: true }];
        });
      },
      onError: (message) => {
        setVoiceIssue(message);
        setLiveState('error');
        liveSessionRef.current = null;
        setLiveActive(false);
        window.setTimeout(() => resumeListeningRef.current(), 250);
      },
      onSpeechBus: (busNode, busContext) => setSpeechBus({ node: busNode, context: busContext }),
      onVisionChange: (mode) => setVisionMode(mode),
    });

    liveSessionRef.current = session;
    setLiveActive(true);
    setVoiceIssue('');
    liveStartFailedRef.current = false;
    const started = await session.start({
      apiBase: API_BASE,
      // No language is forced: the model answers in whatever the user speaks.
      language: 'auto',
      voice: voiceName,
      // The character's own gender, read the same way the rest of the app
      // reads it. The energy core has no character, and is male.
      gender: (showAvatar
        && (MMD_CHARACTERS.find((c) => c.id === avatarId)
          || AVATAR_CHARACTERS.find((c) => c.id === avatarId))?.gender)
        || 'male',
      // Which character is on screen decides how the voice is directed:
      // pitch, pacing and manner differ per persona, not just the timbre.
      persona: showAvatar ? (avatarId === 'evelyn' ? 'myraa' : 'myra') : 'core',
    });
    if (!started) {
      liveStartFailedRef.current = true;
      await stopLiveSession();
    }
  }, [API_BASE, selectedLanguage, voiceName, finalizeRecordedAudio, stopRecognition, stopLiveSession, showAvatar, avatarId]);

  // Always release the microphone and socket when the panel closes.
  useEffect(() => {
    if (!isOpen && liveSessionRef.current) stopLiveSession();
    // Only when the panel actually opens - not every time this effect runs.
    // stopLiveSession is a dependency and is rebuilt when hanging up, so this
    // re-ran immediately after a hang-up and cleared the very flag that
    // records the hang-up. The auto-start effect then started the call again,
    // which is why pressing the red button appeared to do nothing at all.
    if (isOpen && !wasOpenRef.current) {
      endedByUserRef.current = false;
      liveStartFailedRef.current = false;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, stopLiveSession]);

  // Opening the panel starts the conversation. Requiring a second click on
  // "Go Live" before the assistant would listen made it feel switched off.
  useEffect(() => {
    if (!isOpen || !liveAvailable || liveSessionRef.current) return;
    // Only until the person hangs up. This effect re-runs whenever
    // startLiveSession is rebuilt - which happens on a character, language or
    // voice change - so ending a call and then changing any of those started
    // it again on its own, and the red button appeared to do nothing.
    if (endedByUserRef.current) return;
    // A start that already failed will fail again the same way. Retrying it
    // on a timer produced a call that looked like it ended the instant it
    // began, over and over, with nothing explaining why. One attempt, and the
    // reason stays on screen.
    if (liveStartFailedRef.current) return;
    startLiveSession();
  }, [isOpen, liveAvailable, startLiveSession]);

  // The speaking voice is fixed when a session opens, so switching character
  // mid-call left a male character still answering in the previous voice.
  // Reconnect when the voice changes so the two always agree.
  const activeVoiceRef = useRef(voiceName);
  useEffect(() => {
    if (activeVoiceRef.current === voiceName) return;
    activeVoiceRef.current = voiceName;
    if (!isOpen || !liveSessionRef.current) return;
    (async () => {
      await stopLiveSession();
      await startLiveSession();
    })();
  }, [voiceName, isOpen, startLiveSession, stopLiveSession]);

  // Every character that can be on screen, in picker order, so a swipe
  // steps through the same list the dropdown shows.
  const characterCycle = useMemo(
    () => [...MMD_CHARACTERS.map((c) => c.id), ...AVATAR_CHARACTERS.map((c) => c.id), 'core'],
    [],
  );

  const stepCharacter = useCallback((delta) => {
    const current = showAvatar ? avatarId : 'core';
    const index = characterCycle.indexOf(current);
    const next = characterCycle[(index + delta + characterCycle.length) % characterCycle.length];
    if (next === 'core') { setShowAvatar(false); return; }
    setShowAvatar(true);
    setAvatarId(next);
  }, [characterCycle, showAvatar, avatarId]);

  // A gesture stands in for the control it names; nothing here does
  // anything the on-screen buttons cannot already do.
  const handleGestureAction = useCallback((gesture) => {
    switch (gesture) {
      case GESTURES.OPEN_PALM:
        stopSpeaking?.();
        break;
      case GESTURES.FIST:
        setGestureMode(false);
        onClose?.();
        break;
      case GESTURES.POINT:
        if (!liveActive) startLiveSession();
        break;
      case GESTURES.VICTORY: {
        const session = liveSessionRef.current;
        if (!session) break;
        if (visionMode === 'camera') session.stopVision();
        else session.startVision('camera');
        break;
      }
      case GESTURES.THUMB_UP:
        onSendQuery?.('yes');
        break;
      case GESTURES.THUMB_DOWN:
        onSendQuery?.('no, cancel that');
        break;
      case GESTURES.PINCH:
        setAmbienceOn((value) => !value);
        break;
      case GESTURES.SWIPE_LEFT:
        stepCharacter(-1);
        break;
      case GESTURES.SWIPE_RIGHT:
        stepCharacter(1);
        break;
      default:
        break;
    }
  }, [stopSpeaking, onClose, liveActive, startLiveSession, visionMode, onSendQuery, stepCharacter]);
  const toggleMute = () => {
    if (isMuted) {
      isMutedRef.current = false;
      setIsMuted(false);
      setVoiceIssue('');
      setHeardNothing(false);
      const vadReady = Boolean(analyserRef.current && audioContextRef.current?.state !== 'closed');
      setVadStatus(vadReady ? 'ready' : 'unavailable');
      setVoiceState(vadReady ? 'vad-ready' : 'idle');
      voiceStateRef.current = vadReady ? 'vad-ready' : 'idle';
      startFreshRecorder();
      startRecognition();
    } else {
      isMutedRef.current = true;
      setIsMuted(true);
      stopRecognition();
      finalizeRecordedAudio().catch(() => {});
      setVoiceState('muted');
      voiceStateRef.current = 'muted';
      setVadStatus('idle');
    }
  };

  const liveVoiceStatus = (() => {
    // Ahead of everything except the microphone conditions below it, which are
    // local and remain true offline. Without this the line went on reporting
    // that it was waiting for a model response that could not arrive.
    if (!online && micStatus !== 'denied' && voiceState !== 'muted') {
      return {
        label: 'Offline',
        detail: 'No network connection, so nothing can be sent or answered. '
          + 'Reconnect and this picks up where it left off.',
        tone: 'rose',
        icon: 'error',
      };
    }
    if (isSpeakingAudio || voiceState === 'speaking') {
      return {
        label: 'Playing response audio',
        detail: 'Assistant audio playback is active.',
        tone: 'amber',
        icon: 'speaking',
      };
    }
    if (voiceState === 'thinking') {
      return {
        label: 'Waiting for model response',
        detail: 'The captured prompt was sent; no response timing is assumed.',
        tone: 'cyan',
        icon: 'loading',
      };
    }
    if (uploadStatus === 'uploading' || voiceState === 'uploading') {
      return {
        label: 'Uploading recorded audio',
        detail: 'Recorded audio is being sent to the configured transcription endpoint.',
        tone: 'cyan',
        icon: 'loading',
      };
    }
    if (isMuted || voiceState === 'muted') {
      return {
        label: 'Microphone muted',
        detail: 'Voice capture is paused by the user.',
        tone: 'zinc',
        icon: 'muted',
      };
    }
    if (micStatus === 'requesting' || voiceState === 'permission') {
      return {
        label: 'Waiting for microphone permission',
        detail: 'The browser has not granted microphone access yet.',
        tone: 'amber',
        icon: 'loading',
      };
    }
    const nativeRecognizerFailed = isNativeApp()
      && (recognizerStatus === 'unavailable' || recognizerStatus === 'error' || recognizerStatus === 'denied');
    /* Which failure-shaped condition is actually true, decided in one place.
     *
     * The ordering used to fold uploadStatus === 'error' in with a denied
     * microphone, so a missing transcription endpoint - the ordinary state of
     * an unpaired phone - reported "Voice input unavailable" over a working
     * microphone. voiceOutcomeKind is unit tested for exactly that case. */
    const outcome = voiceOutcomeKind({
      micStatus, voiceState, uploadStatus, heardNothing, nativeRecognizerFailed,
    });
    if (outcome === 'mic-denied' || outcome === 'voice-unavailable') {
      return {
        label: outcome === 'mic-denied' ? 'Microphone permission denied' : 'Voice input unavailable',
        detail: voiceIssue || recognizerIssue || 'No working voice-input path is currently reported.',
        tone: 'rose',
        icon: 'error',
      };
    }
    // Heard nothing. Ordinary, recoverable, and still listening - so it says
    // that, rather than borrowing the language of a failure.
    if (outcome === 'no-speech') {
      return {
        label: 'No speech detected',
        detail: uploadStatus === 'unavailable'
          ? `${voiceIssue} Recorded-audio transcription is not available on this device, `
            + 'so only the on-device recogniser is in use.'
          : voiceIssue || 'Nothing was heard in the last turn. Still listening.',
        tone: 'amber',
        icon: 'listening',
      };
    }
    // The fallback route is missing or refused. Worth saying, because it is a
    // reduced capability, but the call is still running on the recogniser.
    if (outcome === 'transcriber-unavailable') {
      return {
        label: 'Recorded-audio transcription unavailable',
        detail: voiceIssue
          || 'No transcription endpoint answered. The on-device recogniser is still active.',
        tone: 'amber',
        icon: 'listening',
      };
    }
    if (vadStatus === 'speech-detected' || voiceState === 'capturing') {
      return {
        label: 'Speech detected',
        detail: recognizerStatus === 'active'
          ? 'Listening — waiting for you to finish speaking.'
          : 'Local audio capture detected speech and is waiting for silence before transcription.',
        tone: 'emerald',
        icon: 'listening',
      };
    }
    if (recognizerStatus === 'active' && voiceState === 'listening') {
      return {
        label: 'Listening',
        detail: `Microphone granted; recognition locale ${getRecognitionLang(selectedLanguage)} is active.`,
        tone: 'emerald',
        icon: 'listening',
      };
    }
    if (recorderStatus === 'recording') {
      const vadReady = vadStatus === 'ready';
      return {
        label: vadReady ? 'Local recorder and VAD ready' : 'Local audio recorder active',
        detail: vadReady
          ? (recognizerStatus === 'unavailable' || recognizerStatus === 'error' || recognizerStatus === 'denied'
              ? (recognizerIssue || 'Live recognition is unavailable; recorded audio is transcribed locally instead.')
              : 'Microphone capture and local speech detection are active.')
          : (voiceIssue || 'Audio is recording, but automatic speech/silence detection is unavailable.'),
        tone: vadReady ? 'emerald' : 'amber',
        icon: vadReady ? 'listening' : 'error',
      };
    }
    if (micStatus === 'granted') {
      return {
        label: 'Microphone access granted',
        detail: voiceIssue || recognizerIssue || 'Voice capture components are initializing.',
        tone: voiceIssue || recognizerIssue ? 'amber' : 'cyan',
        icon: voiceIssue || recognizerIssue ? 'error' : 'loading',
      };
    }
    return {
      label: 'Voice session idle',
      detail: 'No active microphone capture or recognition has been reported.',
      tone: 'zinc',
      icon: 'idle',
    };
  })();

  // Capture state changes many times a second, so the label is held briefly
  // before it switches. Without this the status text visibly flickers
  // between "Listening" and "Speech detected" while the user is talking.
  const [shownVoiceStatus, setShownVoiceStatus] = useState(liveVoiceStatus);
  useEffect(() => {
    if (liveVoiceStatus.label === shownVoiceStatus.label
        && liveVoiceStatus.detail === shownVoiceStatus.detail) return undefined;
    // Problems and playback are shown at once; everything else settles first.
    const immediate = liveVoiceStatus.icon === 'error' || liveVoiceStatus.icon === 'speaking';
    if (immediate) {
      setShownVoiceStatus(liveVoiceStatus);
      return undefined;
    }
    const timer = window.setTimeout(() => setShownVoiceStatus(liveVoiceStatus), 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVoiceStatus.label]);

  const currentVoiceStatus = shownVoiceStatus;

  // Being offline outranks whatever the call thinks it is doing, except for
  // the microphone conditions, which are local and still the thing to act on.
  const coreState = resolveCoreState({ voiceState, online });

  // The caption grows while she talks. Kept scrolled to its newest line, so a
  // long answer reads like subtitles rather than stopping wherever the box
  // ended. Left alone once the user has scrolled up to read something they
  // missed: yanking it back to the bottom mid-sentence is worse than not
  // following at all.
  //
  // Above the early return below, and watching the values the caption is
  // built from rather than the caption itself, because that is computed after
  // it. A hook placed after a conditional return runs on some renders and not
  // others, which React rejects outright.
  useEffect(() => {
    const box = captionRef.current;
    if (!box) return;
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom < 48) box.scrollTop = box.scrollHeight;
  }, [transcript, interimTranscript, voiceAiResponse, chatHistory]);

  // Follow the voice down a long answer.
  //
  // The effect above only fires when the text changes, and while a reply is
  // being spoken it does not change at all - so the highlight walked out of
  // the visible area and kept going, which is exactly what was reported. This
  // watches the spoken position instead, and moves the box only once the
  // boundary has left a comfortable band, so it steps rather than jitters.
  //
  // Above the early return for the same reason as the effect above it: a hook
  // that runs on some renders and not others is rejected by React, and putting
  // one below the return has already caused error #310 on the device here.
  useEffect(() => {
    const box = captionRef.current;
    const edge = spokenEdgeRef.current;
    if (!box || !edge) return;
    // Measured against the box rather than through offsetTop, because the
    // marker's offsetParent is the paragraph, not the scrolling element.
    const boxRect = box.getBoundingClientRect();
    const edgeRect = edge.getBoundingClientRect();
    const edgeOffset = (edgeRect.top - boxRect.top) + box.scrollTop;
    const target = captionScrollTop({
      boxHeight: box.clientHeight,
      boxScrollTop: box.scrollTop,
      scrollHeight: box.scrollHeight,
      edgeOffset,
    });
    if (target === null) return;
    const gentle = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (typeof box.scrollTo === 'function') {
      box.scrollTo({ top: target, behavior: gentle ? 'auto' : 'smooth' });
    } else {
      box.scrollTop = target;
    }
  }, [speechProgress?.charIndex, speechProgress?.spokenText]);

  if (!isOpen) return null;

  const currentSpeakingText = transcript || interimTranscript;

  // The line shown large over the character: what the assistant last said, or
  // the words being picked up while the user is talking.
  // Only lines from this session. Reading the whole history meant the last
  // thing said in a previous conversation was put back on screen the moment
  // a new one opened, as though she had just said it - and it stayed there
  // after the call ended, and came back after closing and reopening.
  const lastAssistantLine = chatHistory
    .slice(sessionHistoryBaseRef.current)
    .filter((m) => m.role === 'assistant')
    .slice(-1)[0]?.text || '';
  // Only while a conversation is actually running. Once it ends the line
  // is history, and leaving it up made an ended session look live.
  // Listing the resting states rather than the busy ones: 'capturing' and
  // 'uploading' are also mid-conversation, and a whitelist would have
  // silently dropped the caption during them.
  const RESTING = ['idle', 'error', 'muted', 'permission'];
  const conversing = liveActive || !RESTING.includes(voiceState);
  const latestSpokenLine = conversing
    ? (currentSpeakingText || voiceAiResponse || lastAssistantLine)
    : '';

  // Split at wherever the voice has reached. The engine reports its position in
  // the stripped text it was given, not in this line, so the two are matched up
  // by word; see utils/spokenProgress.js.
  const { spoken: spokenSoFar, pending: spokenAhead } = captionSplit({
    displayText: latestSpokenLine,
    spokenText: speechProgress?.spokenText || '',
    charIndex: speechProgress?.charIndex ?? -1,
  });


  const statusToneClasses = {
    amber: 'text-amber-400',
    cyan: 'text-emerald-400',
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    zinc: 'text-zinc-400',
  };
  const statusDotClasses = {
    amber: 'bg-amber-400',
    cyan: 'bg-emerald-400',
    emerald: 'bg-emerald-400',
    rose: 'bg-rose-400',
    zinc: 'bg-zinc-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-zinc-100 animate-in fade-in duration-200 overflow-hidden font-sans">

      {/* The room the character stands in: grid floor, motes, scan sweep,
          brackets and vignette. It reacts to her voice, so the space feels
          part of the conversation rather than a looping wallpaper. */}
      <CyberFX
        intensity={liveState === 'speaking' || voiceState === 'speaking' ? 1 : liveActive ? 0.55 : 0.3}
        active={liveActive}
        hue="red"
      />

      {/* Top Cyberpunk JARVIS HUD Header */}
      <div className="voice-header relative z-10 flex items-center justify-between px-3 sm:px-8 py-2.5 sm:py-3.5 border-b border-emerald-500/20 bg-zinc-950/80 backdrop-blur-xl">
        {/* The title used to sit on the same line as a "Real-Time
            Conversation" badge, both at full size, beside three pickers and
            two buttons. Below about 1200px there was not room: the name broke
            across two lines, the badge wrapped under it, and everything
            collided. min-w-0 and truncate let this side give way instead of
            pushing, the badge only appears where there is room for it, and
            the name stays on one line. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-0.5 shadow-[0_0_18px_rgba(0,255,65,0.2)]">
            <div className="w-full h-full bg-black rounded-[10px] flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 animate-pulse" />
            </div>
          </div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-widest text-white">
              <span className="truncate whitespace-nowrap text-emerald-400 drop-shadow-[0_0_10px_rgba(0,255,65,0.5)]">
                SMARAN.AI Jarvis
              </span>
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-zinc-400 sm:text-[10px]">
              <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${statusDotClasses[currentVoiceStatus.tone]} ${currentVoiceStatus.icon === 'loading' || currentVoiceStatus.icon === 'listening' ? 'animate-pulse' : ''}`} />
              <span className="truncate">{currentVoiceStatus.label}</span>
            </p>
          </div>
        </div>

        {/* Never squeezed: this side keeps its size and the title side gives way. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Active Model */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px] font-bold text-zinc-300 font-mono shadow-inner">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>{activeModelDisplay}</span>
          </div>

          {/* The voice-engine picker stood here reading "Local - no key",
              immediately beside the model chip reading "LOCAL - Auto Router".
              Two controls, near-identical words, and most people have no
              Gemini key for the one they were being asked to choose between.
              voiceEngine still exists and still decides who answers; it is
              simply not a second badge in this header. */}
          {/* Character picker */}
          <div className="flex items-center gap-1 bg-zinc-900/90 border border-emerald-500/30 rounded-xl px-2 py-1 shadow-sm max-w-[130px] sm:max-w-none" title="Choose who you are speaking with">
            <UserRound className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={showAvatar ? avatarId : 'core'}
              onChange={(e) => {
                if (e.target.value === 'core') { setShowAvatar(false); return; }
                setShowAvatar(true);
                setAvatarId(e.target.value);
              }}
              className="bg-transparent text-[11px] font-black text-zinc-200 outline-none cursor-pointer truncate w-full"
            >
              {MMD_CHARACTERS.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-white font-bold">
                  🌸 {c.name}
                </option>
              ))}
              {AVATAR_CHARACTERS.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-white font-bold">
                  ✨ {c.name}
                </option>
              ))}
              {/* Drawn entirely in code, so she ships everywhere the app
                  ships without anyone else's licence attached to her. */}
              <option value={VEGA_CHARACTER.id} className="bg-zinc-900 text-white font-bold">
                ◈ {VEGA_CHARACTER.name}
              </option>
              {/* Models the user put in their own characters folder. Listed
                  after the built-in one so a fresh install is not an empty
                  picker waiting on a request. */}
              {userCharacters.map((c) => (
                <option key={c.id} value={c.id} className="bg-zinc-900 text-white font-bold">
                  🌸 {c.name}
                </option>
              ))}
              <option value="core" className="bg-zinc-900 text-white font-bold">✦ Energy core</option>
            </select>
          </div>

          {/* Picture-in-picture. Only offered where there is a real window to
              pin: in a browser this cannot float over other applications and
              the button would be a promise nothing could keep. */}
          {pipAvailable && (
            <button
              type="button"
              onClick={togglePip}
              className={`p-1.5 sm:p-2 rounded-xl border transition-colors cursor-pointer ${
                pipOn
                  ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40'
                  : 'text-zinc-400 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800'
              }`}
              title={pipOn
                ? 'Back to the full window'
                : 'Shrink and pin above other apps, so you can work while it listens'}
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>
          )}

          {/* Close / End Session. Hidden while pinned: in a 320-wide window
              the assistant is the whole point of the window, and closing her
              there left a shrunken, pinned, empty workspace with no obvious
              way back. The way out of picture-in-picture is to come out of
              picture-in-picture - the button beside this one, or maximising
              the window. */}
          <button
            type="button"
            onClick={onClose}
            className="pip-hide p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 transition-colors cursor-pointer"
            title="Close Jarvis"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Character-first stage. The assistant fills the view and everything
          else sits over it, so the conversation feels like looking at someone
          rather than reading a dashboard. */}
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">

        {/* The room she stands in. Behind the character, the caption and the
            controls, so nothing it draws competes with them. */}
        {/* With a character on stage the room is the backdrop it was built to
            be. With no character the Energy Core is the subject, so the room
            steps back rather than competing with it at full brightness. */}
        <CyberStage voiceState={voiceState} micVolume={micVolume} dim={showAvatar ? 1 : 0.45} />

        {/* Everything in front of the room is laid out in flow rather than
            stacked on one rectangle.

            The character used to fill `absolute inset-0` while the caption sat
            absolutely at 18% and the message box at a fixed offset from the
            bottom, so the words she was saying were drawn across her face and
            the only remedy was to guess a pixel offset - which then broke at a
            different height or orientation. These are separate boxes now: the
            figure gets the room that is left after the words and the controls
            have taken theirs, so they cannot overlap at any size. */}
        <div className="voice-stage absolute inset-0 flex flex-col">
        <div className="voice-main flex-1 min-h-0 flex flex-col">

        {/* The character */}
        <div className="voice-figure relative flex-1 min-h-0">
          {!showAvatar ? (
            <div className="w-full h-full flex items-center justify-center">
              <EnergyCore
                voiceState={coreState}
                micVolume={micVolume}
                /* The assistant's own voice, so the core reacts to what it is
                   saying rather than to the room the user is sitting in. The
                   avatar already listens to this same bus. */
                speechSource={speechBus?.node || null}
                speechContext={speechBus?.context || null}
                toneText={latestSpokenLine}
              />
            </div>
          ) : avatarId === 'vega' ? (
            <AvatarVega
              speechSource={speechBus?.node || null}
              speechContext={speechBus?.context || null}
              isSpeaking={voiceState === 'speaking' || liveState === 'speaking'}
              isListening={voiceState === 'listening' || liveState === 'listening'}
              isThinking={voiceState === 'thinking' || liveState === 'connecting'}
            />
          ) : (MMD_CHARACTERS.some((c) => c.id === avatarId)
              || userCharacters.some((c) => c.id === avatarId)) ? (
            <AvatarMMD
              characterId={avatarId}
              models={userCharacters}
              speechSource={speechBus?.node || null}
              speechContext={speechBus?.context || null}
              isSpeaking={voiceState === 'speaking' || liveState === 'speaking'}
              isListening={voiceState === 'listening' || liveState === 'listening'}
              isThinking={voiceState === 'thinking' || liveState === 'connecting'}
            />
          ) : (
            <AvatarVideo
              characterId={avatarId}
              isSpeaking={voiceState === 'speaking' || liveState === 'speaking'}
              isThinking={voiceState === 'thinking' || liveState === 'connecting'}
            />
          )}
        </div>

        {/* What the assistant just said, in a box of its own beneath her.
            Always in the DOM, because a live region that is created when the
            first words arrive announces nothing; with no words it has no
            content and so takes no height, and the figure above gets the
            space back. */}
        <div
          className={`voice-caption shrink-0 px-6 sm:px-12 flex justify-center ${
            latestSpokenLine ? 'py-2' : ''
          }`}
        >
          <div
            ref={captionRef}
            className="voice-caption-scroll max-w-3xl max-h-full overflow-y-auto overscroll-contain"
          >
            <p
              aria-live="polite"
              className="text-center text-lg sm:text-2xl md:text-3xl leading-relaxed font-medium text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.9)]"
            >
              {/* The words already said, then the rest - the way a lyric line
                  fills in as it is sung. Both halves stay in one <p> so the
                  text wraps as a single paragraph; two elements would break the
                  line at the boundary, which moves as the voice advances.

                  aria-live reads the paragraph, and splitting the text does not
                  change what it contains, so a screen reader is unaffected. */}
              {spokenSoFar ? <span className="voice-caption-said">{spokenSoFar}</span> : null}
              {/* Zero-width, and where the voice currently is. The scroll
                  effect measures this rather than counting characters, so it
                  stays correct however the paragraph happens to wrap. */}
              <span ref={spokenEdgeRef} aria-hidden="true">{'​'}</span>
              <span className="voice-caption-ahead">{spokenAhead}</span>
            </p>
          </div>
        </div>

        </div>{/* /voice-main */}

        {/* Status and the message box, below both. Safe-area aware, so the
            gesture bar does not sit on the send button. */}
        <div className="voice-footer shrink-0 flex flex-col items-center gap-2 px-4 pb-2">

        {/* Live status, kept small and out of the way. */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 border border-emerald-500/25 backdrop-blur-md text-[10px] font-mono font-bold pointer-events-none">
          <span className={`${statusToneClasses[currentVoiceStatus.tone]} flex items-center gap-1.5`}>
            {currentVoiceStatus.icon === 'loading' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : currentVoiceStatus.icon === 'muted' ? (
              <MicOff className="w-3 h-3" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${statusDotClasses[currentVoiceStatus.tone]} ${currentVoiceStatus.icon === 'listening' ? 'animate-pulse' : ''}`} />
            )}
            {currentVoiceStatus.label.toUpperCase()}
          </span>
        </div>

        {/* Message box, centred under the character. Hidden while pinned:
            at 300 wide it covered her completely, and typing is what the full
            window is for - the small one is for talking. */}
        <div className="pip-hide w-full flex justify-center">
          <form onSubmit={handleManualTextSubmit} className="w-full max-w-2xl flex items-center gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 min-w-0 bg-black/55 backdrop-blur-xl border border-white/12 rounded-2xl px-5 py-3.5 text-sm sm:text-base text-white placeholder-white/40 focus:outline-none focus:border-emerald-400/60 transition-colors"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="p-3.5 rounded-2xl bg-black/55 backdrop-blur-xl border border-white/12 text-emerald-300 hover:text-white hover:border-emerald-400/60 disabled:opacity-30 transition-colors cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>

        </div>{/* /voice-footer */}
        </div>{/* /voice-stage */}
      </div>


      {/* Call bar.

          Modelled on a phone call rather than a toolbar: one large primary
          action in the middle that starts or ends the conversation, and the
          rest as small round toggles around it. The previous row of seven
          identical pills gave no sense of which control mattered. */}
      <div className="voice-callbar relative z-10 border-t border-white/8 bg-zinc-950/95 px-4 pb-4 pt-3 backdrop-blur-xl sm:px-8">

        {/* One line of status, centred above the controls. */}
        <div className="voice-callbar-status mb-3 flex justify-center">
          <span className={`flex items-center gap-2 text-[11px] font-medium ${statusToneClasses[currentVoiceStatus.tone]}`}>
            {currentVoiceStatus.icon === 'loading' ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${liveActive ? 'animate-pulse' : ''}`} />
            )}
            <span className="max-w-[70vw] truncate" title={currentVoiceStatus.detail}>
              {currentVoiceStatus.label}
            </span>
            {/* A refused microphone used to be a dead end: the message sat
                there and the only way out was to close and reopen. On Windows
                the refusal is often a race rather than a decision - the
                desktop shell grants WebView2 the microphone a second or two
                after the window appears, and a request made before that is
                denied by default. Asking again usually just works. */}
            {/* Not offered when the origin is the reason. Asking again cannot
                make http into https, and a button that will never work is
                worse than no button. */}
            {!micIsBlockedByOrigin()
              && (micStatus === 'denied' || micStatus === 'error' || micStatus === 'unavailable'
                || recognizerStatus === 'unavailable' || recognizerStatus === 'error' || recognizerStatus === 'denied') && (
              <button
                type="button"
                onClick={() => setMicRetry((n) => n + 1)}
                className="ml-1 shrink-0 rounded-md border border-white/25 px-2 py-0.5 text-[10px] font-bold text-white/90 transition hover:bg-white/10"
              >
                Try again
              </button>
            )}
          </span>
        </div>

        {currentVoiceStatus.icon === 'error' && (
          <p role="status" className="mb-3 mx-auto max-w-xl text-center text-xs leading-relaxed text-rose-200 break-words">
            {currentVoiceStatus.detail}
          </p>
        )}

        <div className="flex items-end justify-center gap-3 sm:gap-5">
          <CallToggle
            icon={isMuted ? MicOff : Mic}
            label={isMuted ? 'Unmute' : 'Mute'}
            active={!isMuted}
            danger={isMuted}
            onClick={toggleMute}
          />
          {/* Both sources, one control. Two buttons implied they could run
              together; visionMode holds a single value, so they never could.
              This is one button that opens the pair, and shows which is live. */}
          {/* Vision needs the live session, which needs a computer. On a
              phone with none it was a permanently grey button with nothing
              saying why - the same as Gesture, and gone for the same reason. */}
          {!noBackend() && !isPhone() && (
          <div className="relative">
            <CallToggle
              icon={visionMode === 'camera' ? Camera : Monitor}
              label={visionMode === 'camera' ? 'Camera' : visionMode === 'screen' ? 'Screen' : 'Vision'}
              active={visionMode === 'screen' || visionMode === 'camera'}
              disabled={!liveActive}
              onClick={() => setVisionMenuOpen((v) => !v)}
            />
            {visionMenuOpen && liveActive && (
              <div className="absolute bottom-full left-1/2 z-20 mb-3 -translate-x-1/2 rounded-xl border border-cyan-500/30 bg-zinc-950/95 p-1 shadow-xl backdrop-blur-md">
                {[['screen', 'Screen', Monitor], ['camera', 'Camera', Camera]].map(([mode, text, Icon]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      const session = liveSessionRef.current;
                      setVisionMenuOpen(false);
                      if (!session) return;
                      // Picking the source already running turns it off, so the
                      // same control both starts and stops it.
                      if (visionMode === mode) session.stopVision();
                      else session.startVision(mode);
                    }}
                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors cursor-pointer ${
                      visionMode === mode
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {text}
                    {visionMode === mode && <span className="ml-auto pl-2 text-[10px] font-mono">ON</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* The one control that is not a toggle: answer or hang up. */}
          <button
            type="button"
            onClick={async () => {
              if (isMobileVoiceDevice()) { toggleMute(); return; }
              if (!liveActive) { startLiveSession(); return; }
              /* Hanging up leaves the call, the way hanging up does.
               *
               * This ended the live session and stayed on this screen, so
               * pressing the red phone appeared to do nothing: the call was
               * over and the call screen was still there, and getting back
               * to the conversation meant finding the X in the corner. The
               * button is a handset, it rotates like one, and it says "End
               * the conversation" - every part of it promises to put you
               * back where you were. Reported as "call end nahi hota". */
              await stopLiveSession();
              onClose?.();
            }}
            className={`group relative -mb-1 flex h-16 w-16 items-center justify-center rounded-full
              transition-all duration-300 active:scale-95 sm:h-[72px] sm:w-[72px] ${
              (isMobileVoiceDevice() ? !isMuted : liveActive)
                ? 'bg-rose-600 shadow-[0_0_28px_rgba(225,29,72,.55)] hover:bg-rose-500'
                : 'bg-emerald-500 shadow-[0_0_28px_rgba(16,185,129,.5)] hover:bg-emerald-400'
            }`}
            title={isMobileVoiceDevice() ? (isMuted ? 'Resume listening' : 'Pause listening') : (liveActive ? 'End the conversation' : 'Start talking')}
          >
            {/* A ring that breathes while the call is live. */}
            {(isMobileVoiceDevice() ? !isMuted : liveActive) && (
              <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" aria-hidden="true" />
            )}
            <PhoneIcon className={`relative h-7 w-7 text-white transition-transform duration-300 ${
              (isMobileVoiceDevice() ? !isMuted : liveActive) ? 'rotate-[135deg]' : 'group-hover:scale-110'
            }`} />
          </button>

          {/* Every other control here has a word under it; this one, the only
              one that changes meaning, had nothing but a colour. Red and green
              do not say whether they describe the state or the action, so
              there was no way to tell "the call is running" from "press to
              start". The word does. */}
          <span className="pointer-events-none absolute translate-y-[3.1rem] whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-white/70">
            {isMobileVoiceDevice()
              ? (isMuted ? 'Resume' : 'Pause')
              : liveActive
                /* The clock, not the word. A number that is changing is the
                   one thing that cannot be mistaken for a label. */
                ? `End · ${String(Math.floor(callSeconds / 60)).padStart(2, '0')}:${String(callSeconds % 60).padStart(2, '0')}`
                : 'Start'}
          </span>

          {/* Pinned above everything at 420x560 there is room for the
              character, what she says, and talking to her. Gesture, ambience
              and the vision picker are hidden there - not disabled, hidden -
              so the small window is one thing you can use rather than six
              you cannot. They all come back at full size. */}
          {/* Gesture is not on the phone. It watches a camera for hand
              poses to drive the call - on a phone the camera is pointed at
              your face from six inches away and the hands holding it are not
              in frame. The HUD was already suppressed there; the button that
              turned on nothing is gone with it. */}
          {/* isPhone, not isNativeApp. The packaged app was excluded and the
              same phone in a browser was not, so Gesture came back the moment
              you paired a computer - on a device whose camera is six inches
              from your face and whose hands are holding it. */}
          {!isPhone() && (
            <span className="contents"><CallToggle icon={Hand} label="Gesture" active={gestureMode} onClick={() => setGestureMode((v) => !v)} /></span>
          )}
          {Ambience.isSupported() && (
            <span className="contents"><CallToggle icon={Music2} label="Ambience" active={ambienceOn} onClick={() => setAmbienceOn((v) => !v)} /></span>
          )}
        </div>
      </div>

      {/* Stark-workshop gesture layer, above everything but click-through. */}
      <GestureHUD
        isOpen={gestureMode && !isMobileVoiceDevice()}
        onClose={() => setGestureMode(false)}
        onAction={handleGestureAction}
      />
    </div>
  );
};

export default HackerVoiceAssistant;
