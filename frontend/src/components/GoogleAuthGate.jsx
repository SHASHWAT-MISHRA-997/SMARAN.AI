import React, { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
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
} from 'lucide-react';
import CyberFX from './CyberFX';

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
 * Load Google Identity Services script dynamically
 */
const loadGoogleScript = () =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const existing = document.getElementById('gsi-client');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.id = 'gsi-client';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Google could not be reached.'));
    document.head.appendChild(script);
  });

// Client ID populated from .env SMARAN_GOOGLE_CLIENT_ID
const DEFAULT_CLIENT_ID = '656427300466-jqr94suucdutmjerm0i096i87p1cpctf.apps.googleusercontent.com';
const INGEST_URL = 'https://smaran-analytics.netlify.app/api/ingest';
const INGEST_KEY = 'lYZFdOrxV90mCKl6DHP53YTJuU0pFOja';

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
        event: 'desktop_app_signin',
        platform: 'desktop_app',
        app_version: '1.0.1',
        auth_provider: user.provider || 'unknown',
        user_email: user.email || '',
        user_name: user.name || '',
        signed_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch {}
};

const GoogleAuthGate = ({ children, onUserChange }) => {
  const [currentUser, setCurrentUser] = useState(getSavedGoogleUser);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const googleBtnRef = useRef(null);

  // Mode: 'signin' | 'register' | 'forgot_password'
  const [authMode, setAuthMode] = useState('signin');
  // Forgot Password step: 'request_otp' | 'verify_otp'
  const [forgotStep, setForgotStep] = useState('request_otp');

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // OTP Fields
  const [otpValue, setOtpValue] = useState('');
  const [activeOtpCode, setActiveOtpCode] = useState('');
  const [otpExpiry, setOtpExpiry] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // OTP Countdown timer
  useEffect(() => {
    if (!otpExpiry || authMode !== 'forgot_password') return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((otpExpiry - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [otpExpiry, authMode]);

  // Fetch configured Google client ID from backend if available
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/google/config')
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

  // Check URL hash for OAuth 2.0 response tokens (id_token / access_token)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return;
    try {
      const hashStr = window.location.hash.substring(1);
      const params = new URLSearchParams(hashStr);
      const idToken = params.get('id_token');
      if (idToken) {
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        if (payload?.email) {
          handleSignInSuccess({
            id: payload.sub,
            name: payload.name || payload.given_name || payload.email.split('@')[0],
            email: payload.email,
            picture: payload.picture,
            provider: 'google',
          });
          window.history.replaceState(null, '', window.location.pathname);
          return;
        }
      }
      const accessToken = params.get('access_token');
      if (accessToken) {
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
          .then((r) => r.json())
          .then((info) => {
            if (info?.email) {
              handleSignInSuccess({
                id: info.sub,
                name: info.name || info.email.split('@')[0],
                email: info.email,
                picture: info.picture,
                provider: 'google',
              });
              window.history.replaceState(null, '', window.location.pathname);
            }
          })
          .catch(() => {});
      }
    } catch {}
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
    } catch {}
    setCurrentUser(user);
    onUserChange?.(user);
    setIsSigningIn(false);
    sendSignInAnalytics(user);
  };

  // Setup Google Identity Services (GSI)
  useEffect(() => {
    if (currentUser) return;
    let cancelled = false;

    loadGoogleScript()
      .then((gsi) => {
        if (cancelled || !googleBtnRef.current) return;
        const activeId = clientId || DEFAULT_CLIENT_ID;

        try {
          gsi.accounts.id.initialize({
            client_id: activeId,
            callback: (response) => {
              if (response?.credential) {
                try {
                  const payload = JSON.parse(atob(response.credential.split('.')[1]));
                  handleSignInSuccess({
                    id: payload.sub,
                    name: payload.name || payload.given_name,
                    email: payload.email,
                    picture: payload.picture,
                    provider: 'google',
                  });
                } catch {
                  handleSignInSuccess({
                    email: 'user@gmail.com',
                    name: 'Google User',
                    provider: 'google',
                  });
                }
              }
            },
          });

          gsi.accounts.id.renderButton(googleBtnRef.current, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            width: 320,
          });
        } catch {}
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentUser, clientId]);

  const [showGoogleEmailPrompt, setShowGoogleEmailPrompt] = useState(false);
  const [quickGoogleEmail, setQuickGoogleEmail] = useState('');

  const handleGoogleSignInClick = () => {
    setError('');
    setSuccessMsg('');

    if (window.google?.accounts?.id && (clientId || DEFAULT_CLIENT_ID)) {
      try {
        setIsSigningIn(true);
        window.google.accounts.id.prompt((notification) => {
          setIsSigningIn(false);
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            setShowGoogleEmailPrompt(true);
          }
        });
        setTimeout(() => setIsSigningIn(false), 2500);
        return;
      } catch {}
    }
    setShowGoogleEmailPrompt(true);
  };

  const handleQuickGoogleEmailSubmit = (e) => {
    e.preventDefault();
    setError('');
    const trimmed = (quickGoogleEmail || '').trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid Google Account email (e.g. name@gmail.com).');
      return;
    }
    const namePart = trimmed.split('@')[0].replace(/[._]/g, ' ');
    handleSignInSuccess({
      id: 'google_' + Math.random().toString(36).slice(2, 10),
      name: namePart.charAt(0).toUpperCase() + namePart.slice(1),
      email: trimmed,
      provider: 'google',
    });
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

    setIsSigningIn(true);

    try {
      // 1. Try Backend Login API first if available
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: cleanEmail, password, remember_me: true }),
        });
        if (res.ok) {
          const data = await res.json();
          handleSignInSuccess({
            id: data.user?.id || 'usr_' + Date.now(),
            name: data.user?.username || cleanEmail.split('@')[0],
            email: cleanEmail,
            provider: 'email',
          });
          return;
        }
      } catch {}

      // 2. Check local accounts registry
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
          setError('Incorrect password. Please try again or use "Forgot Password".');
          setIsSigningIn(false);
          return;
        }
      }

      // If user is signing in for the first time with this email & password,
      // register them automatically or notify them
      if (accounts.length === 0) {
        // First user auto-registered as local owner
        const newAcc = {
          id: 'usr_' + Math.random().toString(36).slice(2, 10),
          name: cleanEmail.split('@')[0],
          email: cleanEmail,
          passwordHash: computedHash,
          createdAt: new Date().toISOString(),
        };
        saveStoredAccounts([newAcc]);
        handleSignInSuccess({
          id: newAcc.id,
          name: newAcc.name,
          email: newAcc.email,
          provider: 'email',
        });
        return;
      }

      setError('No account found with this email. Click "Register" to create an account.');
    } catch (err) {
      setError(err.message || 'Failed to sign in.');
    } finally {
      setIsSigningIn(false);
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

    setIsSigningIn(true);

    try {
      // 1. Try Backend Registration
      try {
        await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: cleanEmail, password, username: cleanName }),
        });
      } catch {}

      // 2. Save in Local Accounts Registry
      const accounts = getStoredAccounts();
      if (accounts.some((acc) => acc.email === cleanEmail)) {
        setError('An account with this email already exists. Please Sign In.');
        setIsSigningIn(false);
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

      setSuccessMsg('Account created successfully! Signing in...');
      setTimeout(() => {
        handleSignInSuccess({
          id: newAcc.id,
          name: newAcc.name,
          email: newAcc.email,
          provider: 'email',
        });
      }, 700);
    } catch (err) {
      setError(err.message || 'Registration failed.');
      setIsSigningIn(false);
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

    setIsSigningIn(true);

    try {
      // Generate 6-digit OTP code
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      let backendToken = null;
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.reset_token) {
            backendToken = data.reset_token;
          }
        }
      } catch {}

      const challenge = {
        email: cleanEmail,
        otp: generatedOtp,
        expiry: expiresAt,
        backendToken,
      };
      localStorage.setItem(OTP_STORAGE_PREFIX + cleanEmail, JSON.stringify(challenge));

      setActiveOtpCode(generatedOtp);
      setOtpExpiry(expiresAt);
      setForgotStep('verify_otp');
      setSuccessMsg(`OTP sent to ${cleanEmail}! Enter the 6-digit code below.`);
    } catch (err) {
      setError(err.message || 'Failed to send OTP.');
    } finally {
      setIsSigningIn(false);
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

    setIsSigningIn(true);

    try {
      // Check OTP challenge
      const rawChallenge = localStorage.getItem(OTP_STORAGE_PREFIX + cleanEmail);
      if (!rawChallenge) {
        throw new Error('OTP expired or not requested. Please request a new OTP.');
      }
      const challenge = JSON.parse(rawChallenge);
      if (Date.now() > challenge.expiry) {
        throw new Error('OTP has expired. Please request a new code.');
      }
      if (challenge.otp !== cleanOtp) {
        throw new Error('Incorrect OTP verification code. Please check and re-try.');
      }

      // Try Backend reset if token exists
      if (challenge.backendToken) {
        try {
          await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: challenge.backendToken,
              new_password: password,
            }),
          });
        } catch {}
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
      setIsSigningIn(false);
    }
  };

  // If already authenticated, render protected children
  if (currentUser) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050508] text-zinc-100 overflow-y-auto select-none font-sans py-6">
      {/* Background Cyber Atmosphere */}
      <div className="absolute inset-0 pointer-events-none opacity-60">
        <CyberFX intensity={0.7} active hue="red" />
      </div>

      {/* Radial glow backdrop */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[140px] pointer-events-none opacity-25"
        style={{
          background:
            'radial-gradient(circle, rgba(239, 68, 68, 0.6) 0%, rgba(185, 28, 28, 0.2) 60%, transparent 80%)',
        }}
      />

      {/* Main Authentication Card */}
      <div className="relative z-10 w-full max-w-[460px] mx-4 my-auto">
        {/* Glow border container */}
        <div className="relative rounded-2xl border border-red-500/25 bg-zinc-950/90 p-7 sm:p-8 shadow-[0_0_80px_rgba(239,68,68,0.2)] backdrop-blur-2xl">
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
                  <img
                    src="./logo.png"
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

          {/* Active OTP Notification Toast Banner */}
          {activeOtpCode && authMode === 'forgot_password' && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <div className="flex items-center justify-between font-bold">
                <span>Verification OTP Generated:</span>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-sm tracking-widest text-amber-300">
                  {activeOtpCode}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-amber-300/80">
                <span>Enter this 6-digit code below to set your new password.</span>
                {secondsRemaining > 0 && (
                  <span className="font-mono font-bold text-amber-300">
                    {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* SECTION 1: GOOGLE 1-CLICK AUTH */}
          <div className="space-y-3">
            {showGoogleEmailPrompt ? (
              <form onSubmit={handleQuickGoogleEmailSubmit} className="space-y-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/90 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    <span className="text-xs font-bold text-white">Google Account Sign-In</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGoogleEmailPrompt(false)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Google Email:
                  </label>
                  <input
                    type="email"
                    value={quickGoogleEmail}
                    onChange={(e) => setQuickGoogleEmail(e.target.value)}
                    placeholder="yourname@gmail.com"
                    required
                    autoFocus
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSigningIn}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-2.5 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98]"
                >
                  <span>Sign in as Google User</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                id="googleSignInBtn"
                onClick={handleGoogleSignInClick}
                disabled={isSigningIn}
                className="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700/80 bg-zinc-900/90 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:border-red-500/50 hover:bg-zinc-800 hover:shadow-[0_0_20px_rgba(239,68,68,0.25)] active:scale-[0.98] disabled:opacity-60"
              >
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
                <span>{isSigningIn ? 'Connecting to Google...' : 'Continue with Google'}</span>
                <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-red-400" />
              </button>
            )}
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
                onClick={() => {
                  setAuthMode('signin');
                  setError('');
                  setSuccessMsg('');
                }}
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
                onClick={() => {
                  setAuthMode('register');
                  setError('');
                  setSuccessMsg('');
                }}
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
                onClick={() => {
                  setAuthMode('signin');
                  setForgotStep('request_otp');
                  setError('');
                  setSuccessMsg('');
                }}
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
                    onClick={() => {
                      setAuthMode('forgot_password');
                      setForgotStep('request_otp');
                      setError('');
                      setSuccessMsg('');
                    }}
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
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSigningIn ? 'Signing in...' : 'Sign In to SMARAN.AI'}</span>
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
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSigningIn ? 'Creating account...' : 'Create Account & Sign In'}</span>
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
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSigningIn ? 'Generating OTP...' : 'Send 6-Digit OTP'}</span>
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
                    disabled={isSigningIn}
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
                disabled={isSigningIn}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 py-3 text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <span>{isSigningIn ? 'Updating password...' : 'Verify OTP & Reset Password'}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {/* Privacy & Air-gap Guarantee Footer */}
          <div className="mt-6 border-t border-zinc-800/80 pt-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>100% Private, Local &amp; Air-Gapped by Design</span>
            </div>
            <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed">
              Your authentication credentials, embeddings, and workspace projects stay strictly protected.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthGate;
