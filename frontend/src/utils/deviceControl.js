import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './hostLink';
import { detectDeviceCommand, describeOutcome } from './deviceCommands';

const device = registerPlugin('SmaranDevice');

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
    return Boolean((await device.startListeningService())?.listening);
  } catch {
    return false;
  }
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
  let result = { opened: false };
  // Arm auto-enter first. This alone floats the app for a launcher intent -
  // "open WhatsApp" - because that sends this task properly to the background.
  // It does not fire for every app: YouTube forwards the search intent on to
  // its own main activity, bringing an existing task forward, and this one
  // never leaves in the way auto-enter watches for.
  await armFloating();
  try {
    switch (command.action) {
      case 'app':
        result = await device.openApp({ name: command.name });
        break;
      case 'youtube':
        result = await device.openYouTube({ query: command.query || '' });
        break;
      case 'music':
        result = await device.playMusic({ query: command.query || '' });
        break;
      case 'url':
        result = await device.openUrl({ url: command.url });
        break;
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
  let floated = Boolean(result?.opened) && await isFloating();
  if (result?.opened && !floated) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      floated = Boolean((await device.enterFloating())?.floating);
    } catch {
      // Older phone, or refused. Neither is a failure of the command.
    }
  }
  return { spoken: describeOutcome(command, result), floated };
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
  const command = detectDeviceCommand(utterance);
  if (!command) return null;
  return runDeviceCommand(command);
}

export default handleIfDeviceCommand;
