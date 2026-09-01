/* Where the API is, for this launch.
 *
 * On the desktop the backend is the page's own origin and the empty string is
 * right. In the Android shell the origin is the app's own bundle of files -
 * there is no server behind it - so every request went to the local asset
 * server, which answers anything without a dot in the last path segment with
 * index.html and a 200. The app spent its whole life talking to its own HTML.
 *
 * hostLink already knew the answer: pairing stores the desktop's address on
 * this network. Nothing was reading it. This does, and it reads it
 * synchronously from storage so that the value is settled before the first
 * request goes out. Re-pairing reloads the app, which is what makes a plain
 * constant enough here.
 */
const pairedHost = () => {
  try {
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    const native = Boolean(capacitor?.isNativePlatform?.() ?? capacitor?.isNative);
    if (!native) return '';
    const raw = localStorage.getItem('sm_host_link');
    return (raw ? JSON.parse(raw)?.url : '') || '';
  } catch {
    return '';
  }
};

export const API_BASE = import.meta.env.VITE_API_BASE_URL || pairedHost() || '';

const DEVICE_ID_KEY = 'smaran_ai_device_id';
const DEVICE_FP_KEY = 'smaran_ai_device_fingerprint';

export function getDeviceFingerprint() {
  if (typeof window === 'undefined') return 'server';
  let fp = localStorage.getItem(DEVICE_FP_KEY);
  if (!fp) {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 4,
      navigator.deviceMemory || 'unknown',
    ];
    fp = btoa(components.join('|')).slice(0, 64);
    localStorage.setItem(DEVICE_FP_KEY, fp);
  }
  return fp;
}

export function getDeviceId() {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function clearDeviceSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_FP_KEY);
  }
}

export async function ensureDeviceUser() {
  const deviceId = getDeviceId();
  const deviceFingerprint = getDeviceFingerprint();
  try {
    const res = await fetch(`${API_BASE}/api/auth/device-login`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-Device-ID': deviceId, 
        'X-Device-Fingerprint': deviceFingerprint 
      },
      credentials: 'include',
      body: JSON.stringify({ device_id: deviceId, device_fingerprint: deviceFingerprint }),
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (e) {
    console.error('Device login failed:', e);
  }
  return { device_id: deviceId };
}

function formatAuthError(data, defaultMsg) {
  if (!data) return defaultMsg;
  const detail = data.detail || data.message;
  if (!detail) return defaultMsg;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => d.msg || d.message || JSON.stringify(d)).join(', ');
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
}

// Cookie-based & API auth helpers
export async function registerUser(email, password, username) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, username }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(formatAuthError(data, 'Registration failed'));
  }
  localStorage.removeItem('sm_auth_logged_out');
  return data;
}

export async function loginUser(email, password, rememberMe) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, remember_me: rememberMe }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(formatAuthError(data, 'Invalid email or password'));
  }
  localStorage.removeItem('sm_auth_logged_out');
  return data;
}

export async function logoutUser() {
  localStorage.setItem('sm_auth_logged_out', 'true');
  try {
    // Get session token from cookie
    const sessionToken = document.cookie.split('; ').find(row => row.startsWith('session_token='))?.split('=')[1];
    
    const headers = {
      'X-Device-ID': getDeviceId(),
      'X-Device-Fingerprint': getDeviceFingerprint(),
    };
    
    // Add Authorization header if we have a session token
    if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    
    const res = await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    return await res.json();
  } catch (e) {
    console.error('Logout error:', e);
    return { message: 'Logged out locally' };
  }
}

export async function getCurrentUser() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include',
      headers: {
        'X-Device-ID': getDeviceId(),
        'X-Device-Fingerprint': getDeviceFingerprint(),
      }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('getCurrentUser failed:', e);
  }
  return null;
}

export async function fetchWithAuth(url, options = {}) {
  const deviceId = getDeviceId();
  const deviceFingerprint = getDeviceFingerprint();
  const headers = {
    'X-Device-ID': deviceId,
    'X-Device-Fingerprint': deviceFingerprint,
    ...(options.headers || {}),
  };
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}
