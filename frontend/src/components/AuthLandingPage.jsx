import React, { useState, useEffect, useRef } from 'react';
import { 
  Brain, Lock, Mail, User, Eye, EyeOff, ShieldCheck, 
  Sparkles, CheckCircle2, AlertCircle, ArrowRight, Zap, 
  Cpu, Layers, Globe, Shield, RefreshCw, Terminal, Activity,
  Server, HardDrive, Key
} from 'lucide-react';
import { API_BASE, loginUser, registerUser } from '../context/AuthContext';
import { SmaranLogo } from './SmaranLogo';

export default function AuthLandingPage({ onLoginSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register' | 'forgot'
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Status states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetStep, setResetStep] = useState(1); // 1 = enter email, 2 = enter new password

  // Interactive Neural Particle Canvas
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Generate glowing cyber nodes
    const particleCount = Math.min(Math.floor((width * height) / 18000), 55);
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 1.8 + 1,
      color: Math.random() > 0.6 ? '#f59e0b' : Math.random() > 0.3 ? '#6366f1' : '#00F0FF',
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw cyber circuit grid lines
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        p1.x += p1.vx;
        p1.y += p1.vy;

        if (p1.x < 0 || p1.x > width) p1.vx *= -1;
        if (p1.y < 0 || p1.y > height) p1.vy *= -1;

        // Draw particle node
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
        ctx.fillStyle = p1.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p1.color;
        ctx.fill();

        // Connect nearby nodes
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = p1.color;
            ctx.globalAlpha = (1 - dist / 130) * 0.18;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Password strength calculation
  const hasLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const hasUpperLower = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const strengthScore = [hasLength, hasNumber, hasSpecial, hasUpperLower].filter(Boolean).length;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const data = await loginUser(email, password, rememberMe);
      if (data && data.user) {
        onLoginSuccess(data.user);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } catch (err) {
      setError(typeof err.message === 'string' ? err.message : 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!email || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await registerUser(email, password, username || email.split('@')[0]);
      if (data && data.user) {
        setSuccessMsg('Account created successfully! Logging you in...');
        setTimeout(() => {
          onLoginSuccess(data.user);
        }, 800);
      } else {
        setSuccessMsg('Account created! Please sign in.');
        setTab('login');
      }
    } catch (err) {
      setError(typeof err.message === 'string' ? err.message : 'Registration failed. Email may already be in use.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!email) {
      setError('Please enter your account email.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok && data.reset_token) {
        setResetToken(data.reset_token);
        setResetStep(2);
        setSuccessMsg('Token generated! Set your new password below.');
      } else {
        const detailMsg = typeof data.detail === 'string' ? data.detail : (data.detail?.[0]?.msg || 'No account found with this email.');
        setError(detailMsg);
      }
    } catch (err) {
      setError('Connection failure. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!newPassword || newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, new_password: newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Password reset successfully! You can now sign in.');
        setResetStep(1);
        setResetToken('');
        setNewPassword('');
        setTimeout(() => { setTab('login'); setSuccessMsg('Password updated. Please sign in.'); }, 2000);
      } else {
        const detailMsg = typeof data.detail === 'string' ? data.detail : (data.detail?.[0]?.msg || 'Reset failed. Token may have expired.');
        setError(detailMsg);
      }
    } catch (err) {
      setError('Connection failure. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#07080c] text-zinc-100 flex flex-col items-center justify-between p-4 sm:p-6 relative overflow-hidden font-sans select-none">
      
      {/* Interactive Background Particle & Circuit Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" />

      {/* Cyber Ambient Radial Glows */}
      <div className="absolute top-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-amber-500/15 via-orange-600/10 to-transparent blur-[140px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-tl from-indigo-600/20 via-purple-600/15 to-transparent blur-[140px] pointer-events-none animate-pulse" style={{ animationDelay: '3s' }} />
      <div className="absolute top-[35%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-cyan-500/5 blur-[160px] pointer-events-none" />

      {/* Top Header Bar */}
      <header className="w-full max-w-5xl flex items-center justify-between z-10 pt-2 pb-4">
        <div className="flex items-center gap-3.5">
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-indigo-600 p-0.5 shadow-[0_0_30px_rgba(249,115,22,0.5)] group cursor-pointer transition-transform hover:scale-105">
            <SmaranLogo
              alt="SMARAN.AI Logo"
              className="w-full h-full rounded-[14px] object-cover bg-zinc-950"
            />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500 border border-black"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl sm:text-2xl font-black tracking-wider bg-gradient-to-r from-amber-400 via-orange-500 to-amber-300 bg-clip-text text-transparent filter drop-shadow-[0_0_12px_rgba(249,115,22,0.4)]">
                SMARAN
              </span>
              <span className="px-1.5 py-0.5 text-[11px] font-black rounded-md bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)]">
                .AI
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 font-medium tracking-wide">
              Autonomous Intelligence & Cognitive Multi-LLM Workspace
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 backdrop-blur-md shadow-lg shadow-black/40">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-[11px]">Enterprise Secure V2.5</span>
        </div>
      </header>

      {/* Center Auth Card with Production Cyberpunk Aesthetics */}
      <main className="w-full max-w-md my-auto z-10 relative">
        <div className="relative bg-[#0d0f18]/90 border border-zinc-800/90 rounded-3xl p-6 sm:p-8 shadow-[0_0_70px_rgba(0,0,0,0.9)] backdrop-blur-2xl cyber-rainbow-card overflow-hidden">
          
          {/* Subtle Circuit Glow Header */}
          <div className="text-center mb-6 relative">
            <div className="relative w-20 h-20 mx-auto mb-3 rounded-2xl p-0.5 bg-gradient-to-tr from-amber-500 via-purple-500 to-cyan-400 shadow-[0_0_30px_rgba(249,115,22,0.45)] group cursor-pointer">
              <SmaranLogo
                alt="SMARAN.AI Logo"
                className="w-full h-full rounded-[14px] object-cover bg-zinc-950 transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 rounded-2xl border border-white/20 pointer-events-none" />
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {tab === 'login' && 'Welcome Back'}
              {tab === 'register' && 'Initialize Workspace'}
              {tab === 'forgot' && 'Reset Access Token'}
            </h1>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed font-medium">
              {tab === 'login' && 'Sign in to access your local models, RAG documents, and custom MCP hubs.'}
              {tab === 'register' && 'Create your private instance account with dynamic hardware auto-sync.'}
              {tab === 'forgot' && 'Enter your registered email to reset your account password.'}
            </p>
          </div>

          {/* Form Switcher Tabs */}
          <div className="flex p-1 bg-[#090a10] rounded-2xl border border-zinc-800 mb-5 shadow-inner">
            <button
              type="button"
              onClick={() => { setTab('login'); setError(''); setSuccessMsg(''); }}
              className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer ${
                tab === 'login'
                  ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setTab('register'); setError(''); setSuccessMsg(''); }}
              className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer ${
                tab === 'register'
                  ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Register
            </button>
          </div>

          {/* Alert Message Box */}
          {error && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span className="font-semibold">{String(error)}</span>
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span className="font-semibold">{String(successMsg)}</span>
            </div>
          )}

          {/* SIGN IN FORM */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@smaran.ai"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setTab('forgot'); setError(''); setSuccessMsg(''); }}
                    className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-11 py-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-white cursor-pointer transition-colors"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                  />
                  <span className="text-xs text-zinc-400 font-medium">Keep session active (HttpOnly)</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black uppercase tracking-wider shadow-[0_0_25px_rgba(99,102,241,0.45)] hover:shadow-[0_0_35px_rgba(99,102,241,0.7)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Authenticating...
                  </>
                ) : (
                  <>
                    Sign In to SMARAN.AI <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* REGISTER FORM */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Username (Optional)
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Workspace admin"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@smaran.ai"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Password * (Min 8 Characters)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-11 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-white cursor-pointer transition-colors"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password Strength Meter */}
                {password && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1 h-1.5">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className={`flex-1 rounded-full transition-all duration-300 ${
                            strengthScore >= step
                              ? strengthScore <= 2
                                ? 'bg-amber-500'
                                : strengthScore === 3
                                ? 'bg-indigo-500'
                                : 'bg-emerald-500'
                              : 'bg-zinc-800'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-500 font-medium">
                      <span>Strength: {strengthScore <= 1 ? 'Weak' : strengthScore === 2 ? 'Fair' : strengthScore === 3 ? 'Good' : 'Strong'}</span>
                      <span>{hasLength ? '✓ 8+ chars' : '8+ chars needed'}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Confirm Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-11 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-white cursor-pointer transition-colors"
                    title={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black uppercase tracking-wider shadow-[0_0_25px_rgba(99,102,241,0.45)] hover:shadow-[0_0_35px_rgba(99,102,241,0.7)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Creating Account...
                  </>
                ) : (
                  <>
                    Create Verified Account <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {tab === 'forgot' && (
            <>
              {resetStep === 1 ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@smaran.ai"
                        className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-black uppercase tracking-wider shadow-[0_0_25px_rgba(99,102,241,0.45)] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Account...
                      </>
                    ) : (
                      <>
                        Generate Reset Token <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setTab('login'); setError(''); setSuccessMsg(''); setResetStep(1); }}
                      className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>Account verified for <strong className="text-white">{email}</strong>. Set your new password below.</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 characters, 1 uppercase, 1 number, 1 special"
                        className="w-full bg-[#08090f] border border-zinc-800 rounded-xl pl-10 pr-11 py-3 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:shadow-[0_0_18px_rgba(99,102,241,0.35)] transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-white cursor-pointer transition-colors"
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || newPassword.length < 8}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Resetting Password...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" /> Reset Password & Sign In
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setResetStep(1); setResetToken(''); setNewPassword(''); setError(''); setSuccessMsg(''); }}
                      className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                      ← Start Over
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </main>

      {/* Feature Ticker & Security Guarantee Footer */}
      <footer className="w-full max-w-5xl z-10 py-3 border-t border-zinc-800/80 flex flex-col md:flex-row items-center justify-between gap-3 text-[11px] text-zinc-500">
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 font-bold">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Zap className="w-3.5 h-3.5 text-amber-400" /> 19 OmniRoute Strategies
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Headroom 60-90% Compression
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Globe className="w-3.5 h-3.5 text-indigo-400" /> 21st.dev MCP Ecosystem
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Shield className="w-3.5 h-3.5 text-cyan-400" /> STRIX Pentest Engine
          </span>
        </div>

        <div className="flex items-center gap-3 font-semibold text-zinc-400">
          <span>Developed by <a href="https://www.linkedin.com/in/sm980/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-bold">SHASHWAT MISHRA</a></span>
          <span className="text-zinc-700">|</span>
          <a href="https://shashwatmishra-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline font-bold">Portfolio</a>
        </div>
      </footer>
    </div>
  );
}
