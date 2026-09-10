import React, { useState } from 'react';
import {
  Sparkles, Plus, Code2, ArrowUp, FileText, Smartphone,
  Presentation, LayoutGrid, Film, Monitor, User, Box,
  Search, Mail, Palette, Star, List, Grid, BookOpen,
  ChevronDown, X, Check, Eye
} from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

export const DESIGN_SYSTEMS = [
  { id: 'modernist', name: 'Modernist', description: 'Bold typography, high contrast, clean grid layout' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', description: 'Dark backgrounds, electric cyan & magenta accents, glowing borders' },
  { id: 'minimal', name: 'Minimal Clean', description: 'Understated elegance, generous whitespace, subtle borders' },
  { id: 'nordic', name: 'Nordic SaaS', description: 'Soft slate tones, rounded corners, modern app aesthetic' },
  { id: 'glassmorphism', name: 'Glassmorphism', description: 'Frosted blur overlays, translucent panels, luminous gradient depth' },
];

export const DESIGN_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    icon: FileText,
    prompt: 'Create a clean, bespoke web design from scratch with semantic structure and modern typography.',
  },
  {
    id: 'mobile_app',
    name: 'Mobile app design',
    icon: Smartphone,
    prompt: 'Design an intuitive mobile application UI with bottom navigation, responsive cards, and fluid touch interactions.',
  },
  {
    id: 'slides',
    name: 'Slides',
    icon: Presentation,
    prompt: 'Create an interactive presentation slide deck with high-impact visuals, speaker notes, and smooth transitions.',
  },
  {
    id: 'document',
    name: 'Document',
    icon: FileText,
    prompt: 'Format a publication-grade technical document with structured headings, callout alerts, and code snippets.',
  },
  {
    id: 'wireframe',
    name: 'Wireframe',
    icon: LayoutGrid,
    prompt: 'Construct a low-fidelity wireframe layout mapping user flows, content hierarchy, and key calls-to-action.',
  },
  {
    id: 'animation',
    name: 'Animation',
    icon: Film,
    prompt: 'Build dynamic CSS and SVG micro-animations with staggered keyframes and responsive interaction states.',
  },
  {
    id: 'ui_mockups',
    name: 'UI mockups',
    icon: Monitor,
    prompt: 'Generate realistic interactive dashboard mockups featuring metrics cards, real-time charts, and data tables.',
  },
  {
    id: 'resume',
    name: 'Résumé',
    icon: User,
    prompt: 'Design a modern executive resume with timeline milestones, skill tags, and crisp typography.',
  },
  {
    id: '3d_object',
    name: '3D object',
    icon: Box,
    prompt: 'Implement a Three.js interactive 3D viewport displaying a rendered geometry with orbit controls and ambient lighting.',
  },
  {
    id: 'research',
    name: 'Research',
    icon: Search,
    prompt: 'Synthesize a deep-dive research paper layout with executive summary, methodology, data tables, and citations.',
  },
  {
    id: 'html_email',
    name: 'HTML email',
    icon: Mail,
    prompt: 'Code a responsive, cross-client HTML email template with bulletin hero, CTA buttons, and bulletproof table formatting.',
  },
  {
    id: 'typography',
    name: 'Color + type pairing',
    icon: Palette,
    prompt: 'Curate a cohesive design token system specifying primary/accent palettes, WCAG AAA contrast scales, and font pairings.',
  },
];

export default function SmaranDesignView({ onEnsureSession, onNavigate }) {
  const [prompt, setPrompt] = useState('');
  const [selectedSystem, setSelectedSystem] = useState(DESIGN_SYSTEMS[0]);
  const [isSystemOpen, setIsSystemOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Auto');
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  const [activeTab, setActiveTab] = useState('templates'); // 'projects' | 'systems' | 'templates'
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSelectTemplate = (tpl) => {
    setSelectedTemplate(tpl);
    setPrompt(tpl.prompt);
  };

  const handleCreate = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const session = await onEnsureSession?.();
      const finalPrompt = `[SMARAN Design: System=${selectedSystem.name}, Mode=${codeMode ? 'Code' : 'Design'}]\n\n${prompt.trim()}`;
      // Switch back to chat with the design task loaded
      window.dispatchEvent(new CustomEvent('smaran:send-prompt', { detail: { prompt: finalPrompt, sessionId: session?.id } }));
      if (onNavigate) onNavigate('chat');
    } catch (err) {
      console.error('Failed to create design task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredTemplates = DESIGN_TEMPLATES.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#141517] text-zinc-100 overflow-y-auto select-none">
      {/* Top Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-zinc-800/80 bg-[#17181c]/90 backdrop-blur shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-tight text-white">SMARAN Design</h1>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-zinc-800 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
              Beta
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300">
            S
          </div>
        </div>
      </header>

      {/* Hero Center Section */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 flex flex-col items-center justify-center">
        <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-white mb-6 text-center">
          What should we create?
        </h2>

        {/* Main Floating Prompt Card */}
        <div className="w-full bg-[#1e2024] border border-zinc-800/90 rounded-2xl p-4 shadow-2xl relative mb-8 focus-within:border-zinc-700 transition-all">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Attach a file, link your design system, or describe what you want to make"
            rows={3}
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none resize-none leading-relaxed"
          />

          {/* Prompt card action row */}
          <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/60 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="w-8 h-8 rounded-xl border border-zinc-700/80 hover:border-zinc-600 bg-zinc-800/60 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Attach design references, screenshots, or SVGs"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Design System Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsSystemOpen(!isSystemOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-700/80 hover:border-zinc-600 bg-zinc-800/60 hover:bg-zinc-800 text-xs text-zinc-300 transition cursor-pointer"
                >
                  <div className="w-3.5 h-3.5 rounded bg-gradient-to-tr from-amber-400 to-rose-500" />
                  <span className="text-[11px] text-zinc-400">Design system</span>
                  <span className="font-semibold text-white">{selectedSystem.name}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                </button>

                {isSystemOpen && (
                  <div className="absolute top-full mt-1.5 left-0 w-64 bg-[#1a1b1e] border border-zinc-700 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                    {DESIGN_SYSTEMS.map((sys) => (
                      <button
                        key={sys.id}
                        onClick={() => {
                          setSelectedSystem(sys);
                          setIsSystemOpen(false);
                        }}
                        className={`w-full text-left p-2 rounded-lg text-xs transition flex items-start gap-2 ${
                          selectedSystem.id === sys.id ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-800/80'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="font-bold text-white flex items-center justify-between">
                            <span>{sys.name}</span>
                            {selectedSystem.id === sys.id && <Check className="w-3 h-3 text-indigo-400" />}
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-0.5">{sys.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Code Toggle Button */}
              <button
                type="button"
                onClick={() => setCodeMode(!codeMode)}
                className={`p-1.5 rounded-xl border text-xs transition cursor-pointer flex items-center gap-1 ${
                  codeMode
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                    : 'border-zinc-700/80 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                }`}
                title="Toggle Code inspection mode"
              >
                <Code2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Model Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsModelOpen(!isModelOpen)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-700/80 bg-zinc-800/60 text-xs text-zinc-300 transition cursor-pointer"
                >
                  <span className="text-[10px] text-zinc-500">Model</span>
                  <span className="font-semibold text-white">{selectedModel}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                </button>

                {isModelOpen && (
                  <div className="absolute top-full mt-1.5 right-0 w-36 bg-[#1a1b1e] border border-zinc-700 rounded-xl shadow-2xl p-1 z-50">
                    {['Auto', 'SMARAN Core', 'Director AI', 'Opus 5'].map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setSelectedModel(m);
                          setIsModelOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition ${
                          selectedModel === m ? 'bg-indigo-600 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Arrow */}
              <button
                type="button"
                onClick={handleCreate}
                disabled={!prompt.trim() || submitting}
                className="w-8 h-8 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white flex items-center justify-center transition cursor-pointer shadow-md shadow-orange-600/30"
              >
                <ArrowUp className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </div>

        {/* CHOOSE A TEMPLATE Section */}
        <div className="w-full mb-6">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-[11px] font-black uppercase tracking-widest text-zinc-400">
              Choose a template
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {filteredTemplates.map((t) => {
              const Icon = t.icon;
              const isSelected = selectedTemplate?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTemplate(t)}
                  className={`p-3 rounded-2xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer group relative min-h-[96px] ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-600/15 shadow-md shadow-indigo-500/20'
                      : 'border-zinc-800/80 bg-[#1b1c20] hover:bg-zinc-800/60 hover:border-zinc-700'
                  }`}
                >
                  <div className="w-7 h-7 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-400 group-hover:text-indigo-400 group-hover:scale-110 transition mb-2">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-200 group-hover:text-white leading-tight">
                    {t.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Bottom Dock Navigation matching Screenshot 5 */}
      <footer className="mt-auto px-6 py-3 border-t border-zinc-800/80 bg-[#17181c] shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          {[
            { id: 'projects', label: 'Projects' },
            { id: 'systems', label: 'Design systems' },
            { id: 'templates', label: 'Templates' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-zinc-800 text-white shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-8 pr-3 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-700 w-36 sm:w-48"
            />
          </div>

          <button
            type="button"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition cursor-pointer"
            title="Favorites"
          >
            <Star className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
            title="Toggle view"
          >
            {viewMode === 'grid' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
          </button>
        </div>

        {/* Tutorial Banner */}
        <div className="w-full flex items-center justify-between py-1.5 px-3 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span>Learn about SMARAN Design</span>
          </div>
          <button
            onClick={() => setShowTutorial(true)}
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
          >
            Quick tutorial
          </button>
        </div>
      </footer>

      {/* Tutorial Modal */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1b1c20] border border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" /> SMARAN Design Studio
              </h3>
              <button
                onClick={() => setShowTutorial(false)}
                className="text-zinc-500 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <p>
                <strong>1. Choose a Template:</strong> Select from 12 pre-built design patterns ranging from mobile apps and animations to interactive slides and 3D objects.
              </p>
              <p>
                <strong>2. Pick a Design System:</strong> Apply tokens from Modernist, Cyberpunk, or Minimal Clean to style your layout automatically.
              </p>
              <p>
                <strong>3. Full Artifact Generation:</strong> SMARAN compiles interactive HTML/CSS/JS web applications, wireframes, and live previews ready to export or deploy.
              </p>
            </div>
            <button
              onClick={() => setShowTutorial(false)}
              className="mt-6 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
