import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  Lock,
  AlertCircle,
  Mail,
  User,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
  ChevronLeft,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { registerPlugin } from '@capacitor/core';
import { API_BASE } from '../context/AuthContext';

export const GOOGLE_STORAGE_KEY = 'smaran_google_user';
const ACCOUNTS_STORAGE_KEY = 'smaran_auth_accounts';
const OTP_STORAGE_PREFIX = 'smaran_reset_otp_';

/**
 * Check if there is an active authenticated user session (Google or Email)
 */
export const getSavedGoogleUser = () => {
  try {
    const raw = localStorage.getItem(GOOGLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.provider === 'google' || parsed.provider === 'email') &&
      typeof parsed.email === 'string' &&
      parsed.email.includes('@') &&
      parsed.id !== 'local' &&
      parsed.id !== 'local_guest'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearSavedGoogleUser = () => {
  try {
    localStorage.removeItem(GOOGLE_STORAGE_KEY);
  } catch {}
};

/**
 * Local Account Store Helpers
 */
const getStoredAccounts = () => {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveStoredAccounts = (accounts) => {
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch {}
};

/**
 * SHA-256 password hasher with salt
 */
const hashPassword = async (password) => {
  const salted = password + '_smaran_salt_2026';
  try {
    if (window.crypto?.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(salted);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // Fallback simple deterministic hash
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    hash = (hash << 5) - hash + salted.charCodeAt(i);
    hash |= 0;
  }
  return 'hash_' + Math.abs(hash);
};

/**
 * Format auth errors from FastAPI / Pydantic responses into friendly messages
 */
const formatAuthError = (data, defaultMsg) => {
  if (!data) return defaultMsg;
  const detail = data.detail || data.message;
  if (!detail) return defaultMsg;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (typeof d === 'string') return d;
        if (d?.msg) return d.msg.replace(/^Value error,\s*/i, '');
        return d?.message || JSON.stringify(d);
      })
      .join('; ');
  }
  if (typeof detail === 'object') {
    return (detail.msg || detail.message || JSON.stringify(detail)).replace(/^Value error,\s*/i, '');
  }
  return String(detail);
};

/**
 * Load Google Identity Services script dynamically
 */
let googleScriptPromise;
const loadGoogleScript = () => {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    let script = document.getElementById('gsi-client');
    const finish = (error) => {
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) {
        script.remove();
        googleScriptPromise = null;
        reject(error);
      } else resolve(window.google);
    };
    const onLoad = () => window.google?.accounts?.oauth2
      ? finish() : onError();
    const onError = () => finish(new Error('Google could not load. Check your connection and try again.'));
    const timer = setTimeout(onError, 12000);
    if (!script) {
      script = document.createElement('script');
      script.id = 'gsi-client';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
  });
  return googleScriptPromise;
};

// Client ID populated from .env SMARAN_GOOGLE_CLIENT_ID
const DEFAULT_CLIENT_ID = '656427300466-jqr94suucdutmjerm0i096i87p1cpctf.apps.googleusercontent.com';
/* /ingest, not /api/ingest. Everything under /api/ is the dashboard's own
   reader: it demands the dashboard key, which is deliberately never shipped,
   and answers no CORS preflight - so this POST was rejected by the browser
   before it left the machine and not one sign-in was ever recorded. The
   backend's own reporter has always used /ingest; only this call was wrong. */
const INGEST_URL = 'https://smaran-analytics.netlify.app/ingest';
const INGEST_KEY = 'lYZFdOrxV90mCKl6DHP53YTJuU0pFOja';

/* The collector accepts a fixed vocabulary and answers anything else with
   400. This used to send event "desktop_app_signin" on platform
   "desktop_app", neither of which is in it, so even once the address was
   right the event would have been thrown away on arrival. */
const analyticsPlatform = () => {
  if (window.Capacitor?.isNativePlatform?.()) return 'android';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
};

const sendSignInAnalytics = (user) => {
  if (!window.fetch) return;
  try {
    const installId =
      localStorage.getItem('sm_install_id') ||
      'desk_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('sm_install_id', installId);
    fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-key': INGEST_KEY,
      },
      body: JSON.stringify({
        install_id: installId,
        event: user.provider === 'google' ? 'google_signin' : 'login',
        platform: analyticsPlatform(),
        app_version: import.meta.env.VITE_APP_VERSION,
        user_email: user.email || '',
        user_name: user.name || '',
      }),
    }).catch(() => {});
  } catch {}
};

const GoogleAuthGate = ({ children, onUserChange }) => {
  const [currentUser, setCurrentUser] = useState(getSavedGoogleUser);
  const [isGoogleConnecting, setIsGoogleConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOtpSending, setIsOtpSending] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const googleAttempt = useRef(0);
  const [googleLoadAttempt, setGoogleLoadAttempt] = useState(0);

  // Mode: 'signin' | 'register' | 'forgot_password'
  const [authMode, setAuthMode] = useState('signin');
  // Forgot Password step: 'request_otp' | 'verify_otp'
  const [forgotStep, setForgotStep] = useState('request_otp');

  const switchMode = (mode) => {
    setAuthMode(mode);
    setError('');
    setSuccessMsg('');
    setIsGoogleConnecting(false);
    setIsSubmitting(false);
    setIsOtpSending(false);
    if (mode === 'forgot_password') {
      setForgotStep('request_otp');
    }
  };

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP Fields
  const [otpValue, setOtpValue] = useState('');
  // Fetch configured Google client ID from backend if available
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/auth/google/config`, { signal: AbortSignal.timeout(10000) })
      .then((r) => r.json())
      .then((cfg) => {
        if (!cancelled && cfg?.client_id) {
          setClientId(cfg.client_id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Notify parent on mount or change
  useEffect(() => {
    if (currentUser) {
      onUserChange?.(currentUser);
    }
  }, [currentUser, onUserChange]);

  // Handle successful sign-in
  const handleSignInSuccess = (userData) => {
    const user = {
      id: userData.id || userData.sub || 'user_' + Date.now(),
      name: userData.name || userData.displayName || 'SMARAN User',
      email: (userData.email || 'user@smaran.ai').toLowerCase().trim(),
      avatar: userData.picture || userData.avatar || null,
      provider: userData.provider || 'google',
      signedInAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GOOGLE_STORAGE_KEY, JSON.stringify(user));
      localStorage.removeItem('sm_auth_logged_out');
      if (userData.access_token) {
        localStorage.setItem('sm_session_token', userData.access_token);
      }
    } catch {}
    setCurrentUser(user);
    onUserChange?.(user);
    setIsGoogleConnecting(false);
    setIsSubmitting(false);
    setIsOtpSending(false);
    sendSignInAnalytics(user);
  };

  const tokenClientRef = useRef(null);
  const nativeGoogle = Boolean(window.Capacitor?.isNativePlatform?.());

  const completeGoogleSignIn = async (credential, accessToken, nativeProfile) => {
    const response = await fetch(`${API_BASE}/api/auth/google`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential ? { credential } : { access_token: accessToken }),
      signal: AbortSignal.timeout(15000),
    }).catch((err) => {
      if (API_BASE || !nativeGoogle) throw err;
      return null;
    });
    if (response?.headers.get('content-type')?.includes('application/json')) {
      const data = await response.json();
      if (!response.ok) throw new Error(formatAuthError(data, 'Google sign-in could not be verified.'));
      handleSignInSuccess({ ...data.user, name: data.user?.username,
        access_token: data.access_token, provider: 'google' });
      return;
    }
    // An unpaired Android app has no Python server. Credential Manager has
    // authenticated this profile; it grants only this device's local session.
    if (nativeGoogle && !API_BASE && credential && nativeProfile?.email) {
      handleSignInSuccess({ ...nativeProfile, provider: 'google' });
      return;
    }
    throw new Error('The sign-in server is unavailable. Check the desktop connection and retry.');
  };

  useEffect(() => {
    if (currentUser || nativeGoogle) return;
    let cancelled = false;
    loadGoogleScript().then((gsi) => {
      if (cancelled) return;
      tokenClientRef.current = gsi.accounts.oauth2.initTokenClient({
        client_id: clientId || DEFAULT_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (response) => {
          try {
            if (response.error || !response.access_token) throw new Error(response.error_description || 'Google sign-in was cancelled.');
            await completeGoogleSignIn(null, response.access_token);
          } catch (err) { setError(err.message || 'Google sign-in failed.'); }
          finally { setIsGoogleConnecting(false); }
        },
        error_callback: (error) => {
          setIsGoogleConnecting(false);
          setError(error.type === 'popup_closed'
            ? 'Google sign-in was cancelled. Tap Continue with Google to retry.'
            : 'Allow the Google sign-in popup in your browser, then retry.');
        },
      });
    }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; tokenClientRef.current = null; };
  }, [currentUser, clientId, nativeGoogle, googleLoadAttempt]);

  useEffect(() => {
    if (!isGoogleConnecting) return;
    const timer = setTimeout(() => {
      googleAttempt.current += 1;
      setIsGoogleConnecting(false);
      setError('Google sign-in timed out. Please try again.');
    }, 120000);
    return () => clearTimeout(timer);
  }, [isGoogleConnecting]);

  const handleGoogleSignInClick = async () => {
    if (isGoogleConnecting) return;
    setError('');
    setSuccessMsg('');
    const attempt = ++googleAttempt.current;
    if (nativeGoogle) {
      setIsGoogleConnecting(true);
      try {
        const result = await registerPlugin('SmaranDevice').chooseGoogleAccount({ clientId });
        if (attempt !== googleAttempt.current) return;
        if (!result?.credential) throw new Error('Google did not return a verified sign-in credential.');
        await completeGoogleSignIn(result.credential, null, result);
      } catch (err) { setError(err.message || 'Google sign-in was cancelled.'); }
      finally { if (attempt === googleAttempt.current) setIsGoogleConnecting(false); }
      return;
    }
    if (!tokenClientRef.current) {
      setError('Google sign-in is still loading. Check your connection and tap again.');
      // Retry a previously failed script without losing the next click gesture.
      setGoogleLoadAttempt((value) => value + 1);
      return;
    }
    try {
      setIsGoogleConnecting(true);
      tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      setIsGoogleConnecting(false);
      setError(err.message || 'Google sign-in could not open.');
    }
  };

  // Manual Sign In
  const handleManualSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Try Backend Login API first
      let networkError = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(`${API_BASE || ''}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: cleanEmail, password, remember_me: true }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        let data = null;
        try {
          data = await res.json();
        } catch {}

        if (res.ok && data) {
          handleSignInSuccess({
            id: data.user?.id || 'usr_' + Date.now(),
            name: data.user?.username || cleanEmail.split('@')[0],
            email: cleanEmail,
            access_token: data.access_token,
            provider: 'email',
          });
          return;
        } else if (res.status === 401) {
          setError('Invalid email or password. Please try again.');
          setIsSubmitting(false);
          return;
        } else if (res.status === 429) {
          setError(data?.detail || 'Too many attempts. Please try again later.');
          setIsSubmitting(false);
          return;
        } else if (data) {
          setError(formatAuthError(data, 'Login failed. Please check your credentials.'));
          setIsSubmitting(false);
          return;
        }
      } catch {
        networkError = true;
      }

      // 2. Offline / Local fallback ONLY if network failed
      if (networkError) {
        const accounts = getStoredAccounts();
        const existingAccount = accounts.find((acc) => acc.email === cleanEmail);
        const computedHash = await hashPassword(password);

        if (existingAccount) {
          if (existingAccount.passwordHash === computedHash) {
            handleSignInSuccess({
              id: existingAccount.id,
              name: existingAccount.name || cleanEmail.split('@')[0],
              email: existingAccount.email,
              provider: 'email',
            });
            return;
          } else {
            setError('Incorrect password for local offline account.');
            setIsSubmitting(false);
            return;
          }
        }
      }

      setError('Invalid email or password. Please try again or create an account.');
    } catch (err) {
      setError(err.message || 'Failed to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Manual Register
  const handleManualRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanName = (name || '').trim() || cleanEmail.split('@')[0];

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Backend Registration
      let networkError = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(`${API_BASE || ''}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: cleanEmail, password, username: cleanName }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        let data = null;
        try {
          data = await res.json();
        } catch {}

        if (res.ok && data) {
          const userObj = {
            id: data.user?.id || 'usr_' + Date.now(),
            name: data.user?.username || cleanName,
            email: cleanEmail,
            access_token: data.access_token,
            provider: 'email',
          };
          // Sync with local storage
          const accounts = getStoredAccounts();
          const computedHash = await hashPassword(password);
          saveStoredAccounts([
            ...accounts.filter((a) => a.email !== cleanEmail),
            {
              id: userObj.id,
              name: userObj.name,
              email: cleanEmail,
              passwordHash: computedHash,
              createdAt: new Date().toISOString(),
            },
          ]);

          setSuccessMsg('Account created successfully! Signing in...');
          setTimeout(() => {
            handleSignInSuccess(userObj);
          }, 500);
          return;
        } else if (data) {
          const errDetail = formatAuthError(data, 'Registration failed. Please try again.');
          setError(errDetail);
          setIsSubmitting(false);
          return;
        }
      } catch {
        networkError = true;
      }

      // 2. Offline Fallback if backend is not reachable
      if (networkError) {
        const accounts = getStoredAccounts();
        if (accounts.some((acc) => acc.email === cleanEmail)) {
          setError('An account with this email already exists locally. Please Sign In.');
          setIsSubmitting(false);
          return;
        }

        const computedHash = await hashPassword(password);
        const newAcc = {
          id: 'usr_' + Math.random().toString(36).slice(2, 10),
          name: cleanName,
          email: cleanEmail,
          passwordHash: computedHash,
          createdAt: new Date().toISOString(),
        };
        saveStoredAccounts([...accounts, newAcc]);

        setSuccessMsg('Offline account created! Signing in...');
        setTimeout(() => {
          handleSignInSuccess({
            id: newAcc.id,
            name: newAcc.name,
            email: newAcc.email,
            provider: 'email',
          });
        }, 500);
        return;
      }

      setError('Registration failed. Please check your details and try again.');
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Forgot Password: Step 1 - Send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address to receive OTP.');
      return;
    }

    setIsOtpSending(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${API_BASE || ''}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const ct = res.headers.get('content-type') || '';
      let data = {};
      if (ct.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.detail || 'The verification code could not be sent. Open Settings > Account > Email delivery (SMTP) and add a mail server, then try again.');
      }

      if (data.email_dispatched) {
        setForgotStep('verify_otp');
        setSuccessMsg(`6-digit verification code sent to ${cleanEmail}! Please check your email inbox (and Spam folder).`);
        return;
      }

      /* No mail server. The backend hands the code straight back only when
         the request came from the machine SMARAN is running on - the person
         at that keyboard already owns the database - so filling it in here
         strands nobody and reveals nothing. A request from the phone over
         the LAN gets no code, and lands in the branch below instead. */
      if (data.reset_token) {
        setOtpValue(String(data.reset_token));
        setForgotStep('verify_otp');
        setSuccessMsg(
          'No mail server is set up, so the code is filled in below because you '
          + 'are on this machine. Choose a new password to finish.',
        );
        return;
      }

      throw new Error(data.delivery_error || 'The verification code could not be sent. Open Settings > Account > Email delivery (SMTP) and add a mail server, then try again.');
    } catch (err) {
      setError(err.message || 'Failed to send OTP.');
    } finally {
      setIsOtpSending(false);
    }
  };

  // Forgot Password: Step 2 - Verify OTP & Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otpValue || '').trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      setError('Please enter the complete 6-digit OTP verification code.');
      return;
    }
    if (password.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Verify OTP and reset password via Backend
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${API_BASE || ''}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: cleanOtp,
          email: cleanEmail,
          new_password: password,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const ct = res.headers.get('content-type') || '';
      let data = {};
      if (ct.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.detail || 'Invalid or expired OTP code. Please check your email and enter the latest 6-digit code.');
      }

      // Update Local Account
      const computedHash = await hashPassword(password);
      const accounts = getStoredAccounts();
      const userIndex = accounts.findIndex((acc) => acc.email === cleanEmail);

      let updatedUser;
      if (userIndex >= 0) {
        accounts[userIndex].passwordHash = computedHash;
        updatedUser = accounts[userIndex];
        saveStoredAccounts(accounts);
      } else {
        updatedUser = {
          id: 'usr_' + Math.random().toString(36).slice(2, 10),
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
          passwordHash: computedHash,
          createdAt: new Date().toISOString(),
        };
        saveStoredAccounts([...accounts, updatedUser]);
      }

      // Clear used OTP
      localStorage.removeItem(OTP_STORAGE_PREFIX + cleanEmail);

      setSuccessMsg('Password reset successfully! Logging you in...');
      setTimeout(() => {
        handleSignInSuccess({
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          provider: 'email',
        });
      }, 900);
    } catch (err) {
      setError(err.message || 'Password reset failed.');
      setIsSubmitting(false);
    }
  };

  // If already authenticated, render protected children
  if (currentUser) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050508] text-zinc-100 overflow-y-auto select-none font-sans py-6">
      {/* Zero-lag atmospheric ambient lighting */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full opacity-20 blur-[90px]"
          style={{
            background: 'radial-gradient(circle, #ef4444 0%, #7f1d1d 60%, transparent 80%)',
          }}
        />
        <div
          className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[380px] h-[380px] rounded-full opacity-15 blur-[80px]"
          style={{
            background: 'radial-gradient(circle, #dc2626 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Main Authentication Card */}
      <div className="relative z-10 w-full max-w-[460px] mx-4 my-auto">
        {/* Glow border container */}
        <div className="relative rounded-2xl border border-red-500/25 bg-zinc-950/95 p-7 sm:p-8 shadow-[0_0_60px_rgba(239,68,68,0.18)] backdrop-blur-md">
          {/* HUD corner accents */}
          <span className="pointer-events-none absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-red-500/60 rounded-tl-xl" />
          <span className="pointer-events-none absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-red-500/60 rounded-tr-xl" />
          <span className="pointer-events-none absolute left-0 bottom-0 h-4 w-4 border-l-2 border-b-2 border-red-500/60 rounded-bl-xl" />
          <span className="pointer-events-none absolute right-0 bottom-0 h-4 w-4 border-r-2 border-b-2 border-red-500/60 rounded-br-xl" />

          {/* Logo & Brand Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3 flex items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 via-red-700 to-zinc-900 p-[1.5px] shadow-[0_0_25px_rgba(239,68,68,0.4)]">
                <div className="w-full h-full rounded-[14px] bg-zinc-950 flex items-center justify-center overflow-hidden">
                  {/* There is no logo.png - the file shipped in public/ is
                      smaran-logo.png - so the sign-in screen 404'd on every
                      load and fell back to the plain "S" behind it. */}
                  <img
                    src="/smaran-logo.png"
                    alt="SMARAN.AI Logo"
                    className="w-10 h-10 object-contain drop-shadow-[0_0_10px_rgba(239,68,68,0.6)]"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <span className="text-xl font-black tracking-tight text-white">S</span>
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 ring-4 ring-zinc-950">
                <Lock className="h-2.5 w-2.5 text-white" />
              </div>
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span>SMARAN</span>
              <span className="text-red-500">.</span>
              <span>AI</span>
            </h1>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-0.5 text-[11px] font-semibold text-red-300">
              <Sparkles className="h-3 w-3 text-red-400" />
              <span>Autonomous Intelligence Runtime</span>
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}


          {/* SECTION 1: GOOGLE 1-CLICK AUTH */}
          <div className="space-y-3">
            <button
              type="button"
              id="googleSignInBtn"
              onClick={handleGoogleSignInClick}
              disabled={isGoogleConnecting}
              className="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700/80 bg-zinc-900/90 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:border-red-500/50 hover:bg-zinc-800 hover:shadow-[0_0_20px_rgba(239,68,68,0.25)] active:scale-[0.98] cursor-pointer"
            >
              {isGoogleConnecting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-red-500 shrink-0" />
                  <span className="text-zinc-200">Connecting... (Tap to cancel)</span>
                </>
              ) : (
                <>
                  {/* Google 4-Color Icon */}
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 48 48">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                  <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-red-400" />
                </>
              )}
            </button>

          </div>

          {/* SECTION 2: DIVIDER */}
          <div className="relative my-5 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800/80" />
            </div>
            <span className="relative bg-zinc-950 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              or continue with email
            </span>
          </div>

          {/* SECTION 3: MODE SWITCHER / FORGOT PASSWORD BACK */}
          {authMode !== 'forgot_password' ? (
            <div className="mb-4 flex rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  authMode === 'signin'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  authMode === 'register'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>
          ) : (
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Back to Sign In</span>
              </button>
              <span className="text-xs font-bold text-red-400">Password Recovery</span>
            </div>
          )}

          {/* SECTION 4: FORMS */}

          {/* 4A: SIGN IN FORM */}
          {authMode === 'signin' && (
            <form onSubmit={handleManualSignIn} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => switchMode('forgot_password')}
                    className="text-[11px] font-medium text-red-400 hover:text-red-300 transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-10 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSubmitting ? 'Signing in...' : 'Sign In to SMARAN.AI'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {/* 4B: REGISTER (SIGN UP) FORM */}
          {authMode === 'register' && (
            <form onSubmit={handleManualRegister} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Full Name
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                    required
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Password (min. 6 characters)
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a secure password"
                    required
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-10 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-10 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSubmitting ? 'Creating account...' : 'Create Account & Sign In'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {/* 4C: FORGOT PASSWORD (OTP FLOW) */}
          {authMode === 'forgot_password' && forgotStep === 'request_otp' && (
            <form onSubmit={handleSendOtp} className="space-y-3.5">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
                Enter your account email. We will generate a 6-digit OTP verification code for you to reset your password.
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Your Account Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    autoFocus
                    autoComplete="email"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-3.5 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isOtpSending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isOtpSending ? 'Generating OTP...' : 'Send 6-Digit OTP'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {authMode === 'forgot_password' && forgotStep === 'verify_otp' && (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    6-Digit OTP Verification Code
                  </label>
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={isOtpSending}
                    className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Resend OTP</span>
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    maxLength={6}
                    value={otpValue}
                    onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 6 digits (e.g. 123456)"
                    required
                    autoFocus
                    className="w-full rounded-xl border border-red-500/40 bg-zinc-900/90 py-2.5 pl-10 pr-3.5 font-mono text-center text-sm font-bold tracking-widest text-white placeholder-zinc-600 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  New Password (min. 6 characters)
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-10 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-10 pr-10 text-xs text-white placeholder-zinc-500 transition-colors focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSubmitting ? 'Updating password...' : 'Verify OTP & Reset Password'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

        </div>
      </div>


    </div>
  );
};

export default GoogleAuthGate;
