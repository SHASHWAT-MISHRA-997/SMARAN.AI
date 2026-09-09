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
  // Before the launch; see armFloating for why the order is not a choice.
  const floated = await armFloating();
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

  return { spoken: describeOutcome(command, result), floated: floated && Boolean(result?.opened) };
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
