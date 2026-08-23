import React from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React Error Boundary]', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 font-sans relative overflow-hidden transition-colors duration-300">
          {/* Subtle glowing neon mesh background */}
          <div className="absolute w-[450px] h-[450px] bg-rose-500/5 dark:bg-rose-500/10 rounded-full filter blur-[120px] -top-12 -left-12 pointer-events-none" />
          <div className="absolute w-[450px] h-[450px] bg-amber-500/5 dark:bg-amber-500/10 rounded-full filter blur-[120px] -bottom-12 -right-12 pointer-events-none" />

          {/* Premium Glass Panel Card */}
          <div className="w-full max-w-md bg-white/70 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200 dark:border-zinc-800/80 rounded-3xl shadow-2xl p-8 relative z-10 text-center transition-all duration-300">
            {/* Warning Icon Container */}
            <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-500/10 dark:bg-rose-500/20 border border-rose-500/20 dark:border-rose-500/30 flex items-center justify-center text-rose-500 mb-6 shadow-lg">
              <ShieldAlert className="w-8 h-8" />
            </div>

            {/* Error Message */}
            <h1 className="text-xl font-black text-zinc-950 dark:text-white tracking-wide mb-3">
              Oops! Something went wrong.
            </h1>
            <p className="text-sm text-zinc-650 dark:text-zinc-400 leading-relaxed font-bold mb-4">
              It looks like we hit a small snag. Our team is already looking into it to get you back on track as quickly as possible.
            </p>

            {this.state.error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-left overflow-x-auto max-h-32 text-[11px] font-mono text-rose-400">
                <span className="font-bold text-rose-300 block mb-1">{String(this.state.error?.message || this.state.error)}</span>
                <span className="text-[10px] text-zinc-400 block whitespace-pre-wrap">{this.state.error?.stack}</span>
              </div>
            )}

            {/* Note */}
            <p className="text-[11px] text-zinc-400 dark:text-zinc-550 font-extrabold uppercase tracking-wider mb-6">
              Thank you for bearing with us!
            </p>

            {/* Action button */}
            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-zinc-900 to-zinc-800 dark:from-zinc-100 dark:to-zinc-250 dark:text-zinc-950 text-white font-black text-xs uppercase tracking-wider rounded-2xl py-3.5 shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer border border-zinc-700/20"
            >
              <RefreshCw className="w-4 h-4 animate-spin-slow" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
