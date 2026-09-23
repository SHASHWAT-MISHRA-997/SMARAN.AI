import { device } from './devicePlugin';
import { isNativeApp } from './hostLink';
import { detectDeviceCommand, describeOutcome, answerFollowUp, cancelledLine } from './deviceCommands';
import { ensureMicrophone } from './nativeSpeech';
import { floatsAtAll } from './floatView';


/**
 * Doing on the phone what was asked out loud.
 *
 * Sits between the detector, which is pure and tested, and the native plugin,
 * which is the only thing that can actually start an activity.
 */

/**
 * Arm the floating window before launching anything.
 *
 * Not after, and not instead. Android permits the launch because this app has
 * a visible, *non-pinned* window; a picture-in-picture window is pinned, so
 * floating first would remove the permission the launch depends on. Floating
 * after does not work either, because by then the launched app is in front and
 * this one is no longer foreground. Arming asks Android to do it at the only
 * moment that works - as this app steps aside.
 *
 * A failure to float is never a failure of the command. The app opened, which
 * is what was asked for; the window merely stayed full size behind it.
 */
/**
 * Keep listening while the app is not on screen.
 *
 * The activity is stopped the moment another app opens, and a stopped activity
 * hears nothing and runs none of this. A foreground service is not stopped, so
 * a second and third command work - which is the whole reason it exists. It
 * posts a notification that cannot be dismissed, and that is not a side effect
 * to hide: an app holding the microphone while you are elsewhere should be
 * visibly doing so, and the notification carries the button that stops it.
 */
export async function startBackgroundListening() {
  if (!isNativeApp()) return false;
  try {
    // The microphone first. Starting the service without it was the crash
    // that closed the app whenever a voice call was opened: Android refuses a
    // microphone service to an app that does not hold the microphone.
    if (!(await ensureMicrophone())) return false;
    return Boolean((await device.startListeningService())?.listening);
  } catch {
    return false;
  }
}

/** Open this app's page in Android Settings, where a blocked permission is turned back on. */
export async function openAppSettings() {
  if (!isNativeApp()) return false;
  try {
    return Boolean((await device.openAppSettings())?.opened);
  } catch {
    return false;
  }
}

/**
 * Start "Hey SMARAN" listening. `auto` marks a start nobody asked for just
 * now - the app opening with the switch on - which respects Stop pressed on
 * the notification.
 *
 * @returns {Promise<{listening: boolean, reason?: string}>}
 */
export async function startWakeListening({ auto = false } = {}) {
  if (!isNativeApp()) return { listening: false, reason: 'not-native' };
  try {
    if (!(await ensureMicrophone())) return { listening: false, reason: 'microphone-permission' };
    const result = await device.startListeningService({ auto });
    return { listening: Boolean(result?.listening), reason: result?.reason };
  } catch (error) {
    return { listening: false, reason: String(error?.message || error) };
  }
}

/** The page opened or closed its own microphone; the wake listener steps aside meanwhile. */
export async function setPageListening(listening) {
  if (!isNativeApp()) return;
  try {
    await device.setPageListening({ listening: Boolean(listening) });
  } catch {
    // an older app without the method: nothing to coordinate with
  }
}

/** A question said to "Hey SMARAN" while the app was away, or ''. Taken once. */
export async function takePendingQuery() {
  if (!isNativeApp()) return '';
  try {
    return String((await device.takePendingQuery())?.query || '').trim();
  } catch {
    return '';
  }
}

/**
 * "Hey SMARAN" heard while the app was elsewhere, which brought it forward.
 * Taken once. @returns {Promise<{woke: boolean, rest: string}>}
 */
export async function takePendingWake() {
  if (!isNativeApp()) return { woke: false, rest: '' };
  try {
    const result = await device.takePendingWake();
    return { woke: Boolean(result?.woke), rest: String(result?.rest || '').trim() };
  } catch {
    return { woke: false, rest: '' };
  }
}

/** Subscribe to an event from the native plugin. Returns the unsubscribe. */
export function onDeviceEvent(name, callback) {
  if (!isNativeApp()) return () => {};
  let handle = null;
  let removed = false;
  Promise.resolve(device.addListener(name, callback)).then((h) => {
    handle = h;
    if (removed) h?.remove?.();
  }).catch(() => {});
  return () => {
    removed = true;
    handle?.remove?.();
  };
}

export async function stopBackgroundListening() {
  if (!isNativeApp()) return false;
  try {
    await device.stopListeningService();
    return true;
  } catch {
    return false;
  }
}

/** Whether the app is already in a floating window. */
const isFloating = async () => {
  try {
    return Boolean((await device.isFloating())?.floating);
  } catch {
    return false;
  }
};

/* The question SMARAN is waiting on an answer to, if any. */
const FOLLOW_UP_MS = 60000;
let asked = null;

const armFloating = async () => {
  try {
    const result = await device.prepareFloating();
    return Boolean(result?.armed);
  } catch {
    return false;
  }
};

/**
 * Run a detected command.
 *
 * @returns {Promise<{spoken: string, floated: boolean}>}
 */
export async function runDeviceCommand(command) {
  // A question back rather than an action: nothing opens, nothing floats,
  // and the next thing said is read as the answer.
  if (command?.action === 'ask') {
    asked = { command, at: Date.now() };
    return { spoken: command.question, floated: false, startsPlayback: false, awaitsAnswer: true };
  }
  let result = { opened: false };
  // Arm auto-enter first. This alone floats the app for a launcher intent -
  // "open WhatsApp" - because that sends this task properly to the background.
  // It does not fire for every app: YouTube forwards the search intent on to
  // its own main activity, bringing an existing task forward, and this one
  // never leaves in the way auto-enter watches for.
  //
  // Not for a media key: pressing pause opens nothing, and shrinking the app
  // into a window for it would be a surprise with no reason behind it.
  //
  // Nor for anything meant to start playing. Floating into picture-in-picture
  // at the moment YouTube opened the video paused and resumed YouTube's
  // screen just as playback was due to begin, and it never began: the right
  // video sat stopped on its first frame. Launched without the float, the
  // same link played at once.
  //
  // And never when the user has turned the floating window off in Settings.
  const pressesKey = command.action === 'media' || command.action === 'music'
    || command.action === 'skip_ad'
    || (command.action === 'youtube' && Boolean(command.play))
    || !floatsAtAll();
  if (!pressesKey) await armFloating();
  try {
    switch (command.action) {
      case 'app':
        result = await device.openApp({ name: command.name });
        break;
      case 'youtube':
        result = command.play && command.query
          ? await device.playYouTube({ query: command.query })
          : await device.openYouTube({ query: command.query || '' });
        break;
      case 'music':
        result = await device.playMusic({ query: command.query || '', app: command.app || '' });
        break;
      case 'media':
        // Pressing pause is not a reason to shrink the app into a window.
        result = await device.mediaControl({ control: command.control });
        break;
      case 'url':
        result = await device.openUrl({ url: command.url });
        break;
      case 'skip_ad':
        // Nothing opens and nothing floats: a button pressed in the app in front.
        result = await device.skipAd();
        return { spoken: describeOutcome(command, result), floated: false, startsPlayback: false };
      case 'say':
        // Nothing to do on the phone, only something to say: a request to
        // pay or buy with no app named.
        return { spoken: describeOutcome(command, result), floated: false, startsPlayback: false };
      default:
        return { spoken: '', floated: false };
    }
  } catch (error) {
    console.warn('device command failed:', error);
    result = { opened: false, reason: 'refused' };
  }

  // If auto-enter did not fire, ask for the window outright.
  //
  // Auto-enter is the better mechanism where it works, because Android picks
  // the moment. Where it does not, this is the fallback: a short wait for the
  // launched app to settle, then a direct request. It is a request, not a
  // guarantee - a paused activity is refused - so the result is checked rather
  // than assumed, and a refusal only means the app stayed full size behind
  // whatever opened.
  let floated = !pressesKey && Boolean(result?.opened) && await isFloating();
  if (!pressesKey && result?.opened && !floated) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      floated = Boolean((await device.enterFloating())?.floating);
    } catch {
      // Older phone, or refused. Neither is a failure of the command.
    }
  }
  // Something began playing. The caller must not then speak over it or keep
  // a microphone open: either takes audio focus, and the song that just
  // started pauses itself - measured, four seconds in, every time.
  const startsPlayback = Boolean(result?.opened) && (
    command.action === 'music'
    || (command.action === 'youtube' && result?.mode === 'play')
    || (command.action === 'media' && ['play', 'next', 'previous'].includes(command.control)));
  return { spoken: describeOutcome(command, result), floated, startsPlayback };
}

/**
 * Handle an utterance if it is something the phone should do itself.
 *
 * Returns null when it is not, so the caller carries on to the model exactly
 * as before. Only ever acts inside the Android app: in a desktop browser the
 * plugin does not exist, and the desktop build has its own path for this
 * through the backend.
 *
 * @returns {Promise<{spoken: string, floated: boolean}|null>}
 */
export async function handleIfDeviceCommand(utterance) {
  if (!isNativeApp()) return null;
  // The answer to a question just asked - "which song?" - completes it.
  // Only the very next thing said, and only for a minute: anything later
  // is a new conversation, not a reply.
  if (asked && Date.now() - asked.at < FOLLOW_UP_MS) {
    const question = asked.command;
    asked = null;
    const answer = answerFollowUp(question, utterance);
    if (answer?.action === 'cancelled') {
      return { spoken: cancelledLine(question), floated: false, startsPlayback: false };
    }
    if (answer) return runDeviceCommand(answer);
  }
  asked = null;
  const command = detectDeviceCommand(utterance);
  if (!command) return null;
  return runDeviceCommand(command);
}

/** Forget a question nobody answered - the call ended, the chat moved on. */
export function forgetFollowUp() {
  asked = null;
}

export default handleIfDeviceCommand;
