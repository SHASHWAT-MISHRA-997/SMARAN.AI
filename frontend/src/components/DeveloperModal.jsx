import React from 'react';
import { X, ExternalLink, Code2, Cpu, ShieldCheck, Sparkles, Globe, UserCheck, Boxes } from 'lucide-react';

const LinkedInIcon = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
  </svg>
);

const DeveloperModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-left">
        
        {/* Header */}
        <div className="relative px-6 py-6 border-b border-zinc-800/80 bg-gradient-to-r from-indigo-950/40 via-zinc-900 to-purple-950/30 backdrop-blur-sm flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
                <UserCheck className="w-6 h-6 text-indigo-400" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-wide flex items-center gap-2">
                About the Developer
                <span className="text-[10px] uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Creator
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                The mind behind SMARAN.AI
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          
          {/* Main Developer Profile Card */}
          <div className="relative p-6 rounded-2xl bg-gradient-to-b from-zinc-900/90 to-zinc-900/40 border border-zinc-800 flex flex-col md:flex-row items-center gap-6 shadow-xl">
            <div className="relative shrink-0">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 p-1 shadow-xl shadow-indigo-500/20 flex items-center justify-center">
                <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center text-3xl font-black text-indigo-400">
                  SM
                </div>
              </div>
            </div>

            <div className="space-y-2 text-center md:text-left flex-1">
              <div>
                <h3 className="text-2xl font-black text-white tracking-tight">
                  SHASHWAT MISHRA
                </h3>
                <p className="text-xs font-bold text-indigo-400 tracking-wide uppercase mt-0.5">
                  AI Engineer & Robotics Engineer
                </p>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Built the entire <strong className="text-white">SMARAN.AI</strong> enterprise platform — integrating zero-latency vLLM local inference, hybrid vector RAG retrieval, and real-time GPU engine optimization, and the Model Catalog & Matrix.
              </p>

              {/* Social Action Links */}
              <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                <a
                  href="https://www.linkedin.com/in/sm980/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm hover:scale-105"
                >
                  <LinkedInIcon className="w-4 h-4 text-cyan-400" />
                  <span>LinkedIn Profile</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>

                <a
                  href="https://shashwatmishra-portfolio.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm hover:scale-105"
                >
                  <Globe className="w-4 h-4" />
                  <span>Portfolio Website</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Genuine Platform Highlights
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                  <Globe className="w-4 h-4 text-rose-400" />
                  <span>Multi-URL YouTube Intelligence</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Paste multiple YouTube links at once — each video gets its own transcript extraction, preview card, and grounded answer.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span>8-Language Regional Support</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Auto-translate input and responses in Hindi, Gujarati, Punjabi, Marathi, Tamil, Telugu, Malayalam, and Kannada.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-400">
                  <Boxes className="w-4 h-4 text-indigo-400" />
                  <span>Expanded Enterprise Model Catalog</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Verified local and cloud model catalog with hardware-fit indicators, provider selection, capability filters, and transparent execution-source labels.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span>Auto-Vision Model Routing</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Automatically selects a vision-capable model for image/PDF analysis, preventing text-only model errors.
                </p>
              </div>

              <div className="p-3.5 md:col-span-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Local Hardware Telemetry</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Shows real local GPU/CPU/RAM telemetry. Cloud provider infrastructure metrics are not represented as local measurements.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-900/60 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium">
            Designed by <strong className="text-zinc-300">Shashwat Mishra</strong>
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

export default DeveloperModal;
