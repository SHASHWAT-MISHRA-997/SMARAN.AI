import React, { useEffect, useRef } from 'react';
import { X, ExternalLink, Sparkles, Globe, UserCheck, Boxes, Mic, Search, FileText, Gauge, Terminal, Languages, ShieldCheck, ArrowUpRight, ChevronRight, Hand, Smartphone } from 'lucide-react';

/* Each entry describes a code path that exists in this build. Nothing here
   claims that an optional runtime or provider is currently connected. */
const highlights = [
  {
    title: 'Hands-Free Voice Assistant',
    detail: 'Say the wake phrase and talk. The reply streams back as speech, and spoken commands drive the workspace itself.',
    icon: Mic,
    accent: 'text-cyan-400',
    ring: 'group-hover:border-cyan-400/50',
  },
  {
    title: 'Gesture Control',
    detail: 'Nine hand gestures read by the camera on this device. No frame is uploaded and none is stored.',
    icon: Hand,
    accent: 'text-sky-400',
    ring: 'group-hover:border-sky-400/50',
  },
  {
    title: 'Desktop & OS Control',
    detail: 'Sixty vetted machine actions: open apps and folders, read the battery and network, capture the screen.',
    icon: Terminal,
    accent: 'text-violet-400',
    ring: 'group-hover:border-violet-400/50',
  },
  {
    title: 'Phone & Tablet Companion',
    detail: 'Scan a QR code to link a phone. Conversations merge both ways, and neither side has to be online.',
    icon: Smartphone,
    accent: 'text-indigo-400',
    ring: 'group-hover:border-indigo-400/50',
  },
  {
    title: 'Speaks Your Language',
    detail: 'No language menu. It answers in whatever you speak to it, including mixed speech, and switches when you do.',
    icon: Languages,
    accent: 'text-fuchsia-400',
    ring: 'group-hover:border-fuchsia-400/50',
  },
  {
    title: 'Sixty-Three Local Models',
    detail: 'Text, vision, video, audio, code and reasoning models, each checked to exist and sized against your hardware.',
    icon: Boxes,
    accent: 'text-orange-400',
    ring: 'group-hover:border-orange-400/50',
  },
  {
    title: 'Uploaded-File RAG',
    detail: 'Uploaded documents are indexed and source-restricted while RAG mode is active.',
    icon: FileText,
    accent: 'text-emerald-400',
    ring: 'group-hover:border-emerald-400/50',
  },
  {
    title: 'Live Web Search',
    detail: 'Web mode calls the search pipeline and returns the source URLs it actually reached.',
    icon: Search,
    accent: 'text-blue-400',
    ring: 'group-hover:border-blue-400/50',
  },
  {
    title: 'Honest Telemetry',
    detail: 'Every metric is labelled with its source. Values that cannot be read are never estimated.',
    icon: Gauge,
    accent: 'text-amber-400',
    ring: 'group-hover:border-amber-400/50',
  },
  {
    title: 'Standalone Desktop App',
    detail: 'Runs as a single application with its own local engine. No container, no server, no sign-in.',
    icon: Boxes,
    accent: 'text-rose-400',
    ring: 'group-hover:border-rose-400/50',
  },
  {
    title: 'Private By Default',
    detail: 'Chats, files and model keys stay on this machine. There is no account and nothing is phoned home.',
    icon: ShieldCheck,
    accent: 'text-teal-400',
    ring: 'group-hover:border-teal-400/50',
  },
];

const DeveloperModal = ({ isOpen, onClose }) => {
  const contentRef = useRef(null);
  useEffect(() => { if (isOpen) contentRef.current?.scrollTo({ top: 0 }); }, [isOpen]);
  if (!isOpen) return null;

  return (
    <div className="developer-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="developer-modal-card w-full max-w-2xl bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-left cyber-rainbow-card">
        <header className="relative px-6 py-5 border-b border-zinc-800/80 bg-gradient-to-r from-indigo-950/50 via-zinc-900 to-purple-950/40 backdrop-blur-xl flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 p-0.5 shadow-[0_0_25px_rgba(99,102,241,.35)]"><div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center"><UserCheck className="w-6 h-6 text-indigo-400" /></div></div>
            <div className="min-w-0"><h2 className="text-xl font-black text-white tracking-wide break-words">About the Developer</h2><p className="text-xs text-zinc-400 mt-0.5">SMARAN.AI Creator</p></div>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer" aria-label="Close developer details"><X className="w-5 h-5" /></button>
        </header>

        <div ref={contentRef} className="developer-modal-scroll p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          <section className="relative p-5 rounded-2xl bg-gradient-to-br from-zinc-900/90 via-indigo-950/25 to-zinc-900/50 border border-indigo-500/20 shadow-xl">
            <h3 className="text-2xl font-black text-white tracking-tight">SHASHWAT MISHRA</h3>
            <p className="text-xs font-bold text-indigo-400 tracking-wide uppercase mt-1">Creator of SMARAN.AI</p>
            <p className="text-xs text-zinc-300 leading-relaxed mt-3">Created SMARAN.AI. The highlights below describe code paths present in this build; they do not claim that an optional runtime or provider is currently connected.</p>
            <div className="pt-4 flex flex-wrap gap-3">
              <a href="https://www.linkedin.com/in/sm980/" target="_blank" rel="noopener noreferrer" className="dev-link dev-link-linkedin group backdrop-blur-md"><span className="dev-link-sheen" aria-hidden="true" />LinkedIn <ExternalLink className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></a>
              <a href="https://shashwatmishra-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer" className="dev-link dev-link-portfolio group backdrop-blur-md"><span className="dev-link-sheen" aria-hidden="true" /><Globe className="w-4 h-4 transition-transform duration-500 group-hover:rotate-[20deg]" /> Portfolio <ExternalLink className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></a>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="developer-highlight-heading text-xs font-black uppercase tracking-[0.18em] flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="cyber-text">Available in this build</span>
              <span className="flex-1 h-px bg-gradient-to-r from-indigo-500/50 via-purple-500/30 to-transparent" />
            </h4>
            <div className="developer-highlight-grid grid grid-cols-1 md:grid-cols-2 gap-3">
              {highlights.map(({ title, detail, icon: Icon, accent, ring }, index) => (
                <div
                  key={title}
                  style={{ animationDelay: `${index * 55}ms` }}
                  className={`group runtime-extension-card developer-highlight-card highlight-card-enter glass-deep sheen hover-lift relative overflow-hidden rounded-2xl border border-white/10 p-3.5 transition-colors ${ring} ${
                    // Eleven cards in two columns leaves the last one alone beside an
                    // empty half-row. The odd one out takes the whole width instead.
                    highlights.length % 2 === 1 && index === highlights.length - 1
                      ? 'md:col-span-2' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`shrink-0 mt-0.5 grid place-items-center w-8 h-8 rounded-xl bg-white/5 border border-white/10 ${accent} transition-transform duration-300 group-hover:scale-110`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-xs font-black text-white">
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${accent} transition-transform duration-300 group-hover:translate-x-0.5`} />
                        <span className="break-words">{title}</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-relaxed mt-1.5 break-words">{detail}</p>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-600 opacity-0 -translate-y-0.5 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0 group-hover:text-zinc-300" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="px-6 py-4 bg-zinc-900/70 border-t border-zinc-800/80 flex items-center justify-between"><span className="text-xs text-zinc-500">Designed by <strong className="text-zinc-300">Shashwat Mishra</strong></span><button onClick={onClose} className="px-5 py-2.5 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer">Close</button></footer>
      </div>
    </div>
  );
};

export default DeveloperModal;
