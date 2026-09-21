/**
 * A profile picture the person chose, kept on this machine.
 *
 * The avatar could only ever be two things: whatever Google supplied, or a
 * circle with initials in it. Somebody who signed in with an account here had
 * no way to set one at all.
 *
 * Two decisions worth stating.
 *
 * It is stored as a data URL in localStorage rather than uploaded anywhere.
 * SMARAN is local-first; a picture of someone's face is exactly the sort of
 * thing that should not leave the machine to make a UI slightly nicer, and
 * there is no server to send it to on a standalone phone anyway.
 *
 * It is re-encoded before being stored, never kept as chosen. A modern phone
 * photograph is several megabytes and localStorage gives you about five in
 * total, so storing the original would fill the quota and break unrelated
 * settings that share it. Everything is drawn square at AVATAR_PX and comes
 * out around 10 kB.
 */

const KEY = 'sm_profile_avatar';
const AVATAR_PX = 256;
const QUALITY = 0.85;

/* Anything bigger is a mistake or a stunt; decoding it costs memory on a
   phone before we ever get to resize it. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export const AVATAR_CHANGED = 'smaran:avatar-changed';

export function loadAvatar() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored && stored.startsWith('data:image/') ? stored : null;
  } catch {
    return null;
  }
}

function announce() {
  window.dispatchEvent(new CustomEvent(AVATAR_CHANGED));
}

export function clearAvatar() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  announce();
}

/** Draw the picture square, centred, without squashing it. */
function toSquareDataUrl(image) {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const context = canvas.getContext('2d');
  // Cover, not stretch: a portrait photograph squeezed into a square face is
  // the most obviously wrong thing this could do.
  const side = Math.min(image.width, image.height);
  context.drawImage(
    image,
    (image.width - side) / 2, (image.height - side) / 2, side, side,
    0, 0, AVATAR_PX, AVATAR_PX,
  );
  return canvas.toDataURL('image/jpeg', QUALITY);
}

/**
 * Take a chosen file and make it the avatar.
 *
 * Resolves with the data URL, or rejects with a message meant to be shown.
 */
export function setAvatarFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No image was chosen.'));
    if (!String(file.type || '').startsWith('image/')) {
      return reject(new Error('That file is not an image.'));
    }
    if (file.size > MAX_SOURCE_BYTES) {
      return reject(new Error('That image is too large. Please choose one under 12 MB.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That image could not be opened.'));
      image.onload = () => {
        let dataUrl;
        try {
          dataUrl = toSquareDataUrl(image);
        } catch {
          // A canvas can be tainted or simply refuse on a low-memory device.
          return reject(new Error('That image could not be processed.'));
        }
        try {
          localStorage.setItem(KEY, dataUrl);
        } catch {
          // Quota, almost always. Saying so beats a picture that silently
          // disappears on the next reload.
          return reject(new Error('There is no room left to store the picture on this device.'));
        }
        announce();
        return resolve(dataUrl);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The picture to show, in order of what the person actually chose.
 *
 * A chosen picture always wins over the provider's, because choosing one is
 * a deliberate act and Google's is only a default.
 */
export const avatarFor = (user) => loadAvatar() || user?.avatar || null;
