import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';
import { Sparkles, Plus, Code2, ArrowUp, FileText, Smartphone, Presentation, LayoutGrid, Film, Monitor, User, Box, Search, Mail, Palette, BookOpen, ChevronDown, X, Check, RefreshCw, ArrowRight } from 'lucide-react';

export const DESIGN_SYSTEMS = [
  {
    id: 'modernist',
    name: 'Modernist',
    description: 'Bold typography, high contrast, clean architectural grid layout',
    colors: ['#000000', '#ffffff', '#2563eb', '#f3f4f6'],
    font: 'Inter / Helvetica',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    description: 'Dark backgrounds, electric cyan & magenta accents, glowing borders',
    colors: ['#09090e', '#00f3ff', '#ff0055', '#ffe600'],
    font: 'JetBrains Mono / Space Grotesk',
  },
  {
    id: 'minimal',
    name: 'Minimal Clean',
    description: 'Understated elegance, generous whitespace, whisper-thin borders',
    colors: ['#ffffff', '#18181b', '#71717a', '#f4f4f5'],
    font: 'Geist / SF Pro',
  },
  {
    id: 'nordic',
    name: 'Nordic SaaS',
    description: 'Soft slate tones, rounded corners, modern Scandinavian app aesthetic',
    colors: ['#0f172a', '#38bdf8', '#818cf8', '#f8fafc'],
    font: 'Outfit / Plus Jakarta Sans',
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted blur overlays, translucent panels, luminous gradient depth',
    colors: ['rgba(255,255,255,0.1)', '#6366f1', '#ec4899', '#0f172a'],
    font: 'Inter / Urbanist',
  },
  {
    id: 'neobrutalism',
    name: 'Neo-Brutalism',
    description: 'High-saturation pops, thick black outlines, raw drop shadows',
    colors: ['#ffde59', '#ff5757', '#000000', '#ffffff'],
    font: 'Cabinet Grotesk / Lexend',
  },
  {
    id: 'synthwave',
    name: 'Retro Synthwave',
    description: 'Neon sunset gradients, wireframe horizon, 80s arcade vibe',
    colors: ['#2e0854', '#f72585', '#7209b7', '#4cc9f0'],
    font: 'Orbitron / Exo 2',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Dark',
    description: 'Pure deep black, minimal slate tones, razor-sharp focus',
    colors: ['#000000', '#121212', '#27272a', '#fafafa'],
    font: 'Inter / Roboto Mono',
  },
];

export const DESIGN_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    icon: FileText,
    prompt: 'Create a clean, bespoke web design from scratch with semantic structure, responsive grid, and modern typography.',
  },
  {
    id: 'mobile_app',
    name: 'Mobile App UI',
    category: 'Mobile',
    icon: Smartphone,
    prompt: 'Design an intuitive mobile application UI with bottom navigation, responsive cards, touch gestures, and fluid micro-interactions.',
  },
  {
    id: 'slides',
    name: 'Interactive Slides',
    category: 'Presentation',
    icon: Presentation,
    prompt: 'Create an interactive presentation slide deck with high-impact visuals, speaker notes, keyboard navigation, and smooth transitions.',
  },
  {
    id: 'document',
    name: 'Technical Document',
    category: 'Docs',
    icon: FileText,
    prompt: 'Format a publication-grade technical document with structured headings, callout alerts, code snippets, and interactive table of contents.',
  },
  {
    id: 'wireframe',
    name: 'UX Wireframe',
    category: 'Design',
    icon: LayoutGrid,
    prompt: 'Construct a low-fidelity wireframe layout mapping user flows, content hierarchy, component states, and key calls-to-action.',
  },
  {
    id: 'animation',
    name: 'CSS Animation',
    category: 'Visuals',
    icon: Film,
    prompt: 'Build dynamic CSS and SVG micro-animations with staggered keyframes, physics-based springs, and responsive interaction states.',
  },
  {
    id: 'ui_mockups',
    name: 'Dashboard Mockup',
    category: 'Web',
    icon: Monitor,
    prompt: 'Generate a realistic interactive analytics dashboard featuring metrics cards, real-time chart canvas, filter bars, and data tables.',
  },
  {
    id: 'resume',
    name: 'Executive Résumé',
    category: 'Docs',
    icon: User,
    prompt: 'Design a modern executive resume with timeline milestones, skill proficiency meters, publication links, and crisp typography.',
  },
  {
    id: '3d_object',
    name: '3D Interactive Viewport',
    category: 'Visuals',
    icon: Box,
    prompt: 'Implement a Three.js interactive 3D viewport displaying a rendered geometry with orbit controls, ambient lighting, and texture maps.',
  },
  {
    id: 'research',
    name: 'Research Paper',
    category: 'Docs',
    icon: Search,
    prompt: 'Synthesize a deep-dive research paper layout with executive summary, methodology breakdown, comparative data tables, and formal citations.',
  },
  {
    id: 'html_email',
    name: 'HTML Email Bulletin',
    category: 'Marketing',
    icon: Mail,
    prompt: 'Code a responsive, cross-client HTML email template with bulletin hero, CTA buttons, card grid, and bulletproof table formatting.',
  },
  {
    id: 'typography',
    name: 'Design Token System',
    category: 'Design',
    icon: Palette,
    prompt: 'Curate a cohesive design token system specifying primary/accent palettes, WCAG AAA contrast scales, typography ladder, and spacing tokens.',
  },
];

const AVAILABLE_MODELS = [
  { id: 'Auto', name: 'Auto (Smart Route)', desc: 'Automatically picks best design engine' },
  { id: 'SMARAN Core', name: 'SMARAN Core (Llama 3.1)', desc: 'Fast local code and UI generation' },
  { id: 'Claude 3.5 Sonnet', name: 'Claude 3.5 Sonnet', desc: 'Superior design aesthetics and code' },
  { id: 'GPT-4o', name: 'GPT-4o (Omni)', desc: 'High-speed multimodal rendering' },
  { id: 'Gemini 1.5 Pro', name: 'Gemini 1.5 Pro', desc: 'Huge context for full web apps' },
  { id: 'Director AI', name: 'Director AI', desc: 'Autonomous multi-agent layout planner' }
];

// `onNavigate` and `onClose` are still passed by App but no longer read:
// generating keeps you on this screen instead of sending you to chat.
export default function SmaranDesignView({ onEnsureSession, onOpenTerminal }) {
  const [prompt, setPrompt] = useState('');
  const [selectedSystem, setSelectedSystem] = useState(DESIGN_SYSTEMS[0]);
  const [isSystemOpen, setIsSystemOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Auto');
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  const [activeTab, setActiveTab] = useState('templates'); // 'templates' | 'systems' | 'projects'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  /* The result is shown here rather than in the chat.
     Generating used to build a prompt, hand it to ChatArea and navigate away,
     so the one screen built for designing was the one screen that never showed
     a design. Everything below keeps it in place. */
  const [result, setResult] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const abortRef = useRef(null);

  const systemDropdownRef = useRef(null);
  const modelDropdownRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (systemDropdownRef.current && !systemDropdownRef.current.contains(e.target)) {
        setIsSystemOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setIsModelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelectTemplate = (tpl) => {
    setSelectedTemplate(tpl);
    setPrompt(tpl.prompt);
  };

  /* Pull the first fenced block out of a reply, so a preview can be rendered
     from what the model actually wrote rather than from the prose around it. */
  const firstCodeBlock = (text) => {
    const fenced = /```([a-zA-Z0-9+-]*)\n([\s\S]*?)```/.exec(text || '');
    return fenced ? { lang: (fenced[1] || '').toLowerCase(), code: fenced[2] } : null;
  };

  const handleCreate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setGenError('');
    setResult('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const session = await onEnsureSession?.();
      const finalPrompt =
        `[SMARAN Design: System=${selectedSystem.name}, Mode=${codeMode ? 'Code' : 'Visual'}]

`
        + `${prompt.trim()}

`
        + 'Return one complete, self-contained HTML document in a single ```html fenced block. '
        + 'Inline all CSS and JavaScript so it renders on its own with no build step and no external files. '
        + 'Do not split it across several blocks.';

      const res = await fetchWithAuth(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session?.id,
          prompt: finalPrompt,
          model: selectedModel === 'Auto' ? 'auto' : selectedModel,
          collections: [],
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setGenError(`The engine returned ${res.status}. Check the model in Settings and try again.`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.error) { setGenError(String(parsed.error)); continue; }
            if (parsed.token) { text += parsed.token; setResult(text); }
            if (parsed.translated_response) { text = parsed.translated_response; setResult(text); }
          } catch {
            /* A partial line arrives whenever a chunk splits mid-JSON; the
               remainder is already held in `buffer` for the next pass. */
          }
        }
      }
      if (!text.trim()) setGenError('The engine returned nothing. Try again, or pick a different model.');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setGenError(err?.message || 'Could not reach the local engine.');
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };

  const stopGenerating = () => abortRef.current?.abort();
  const categories = ['All', 'Web', 'Mobile', 'Presentation', 'Docs', 'Design', 'Visuals'];

  const filteredTemplates = DESIGN_TEMPLATES.filter((t) => {
    if (activeCategory !== 'All' && t.category !== activeCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-zinc-50 dark:bg-[#141517] text-zinc-900 dark:text-zinc-100 overflow-y-auto transition-colors duration-200">
      {/* Top Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 bg-white/90 dark:bg-[#17181c]/90 backdrop-blur shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-tight text-zinc-900 dark:text-white">SMARAN Design</h1>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase tracking-wider">
              Studio
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTutorial(true)}
            className="px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-300 transition cursor-pointer flex items-center gap-1.5"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden sm:inline">Guide</span>
          </button>
          {onOpenTerminal && (
            <button
              type="button"
              onClick={onOpenTerminal}
              className="p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition cursor-pointer"
              title="Open Terminal"
            >
              <Code2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Hero Center Section */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 flex flex-col items-center justify-start">
        <h2 className="text-3xl sm:text-4xl font-serif tracking-tight text-zinc-900 dark:text-white mb-6 text-center">
          What should we create?
        </h2>

        {/* Main Floating Prompt Card */}
        <div className="w-full bg-white dark:bg-[#1e2024] border border-zinc-200 dark:border-zinc-800/90 rounded-3xl p-4 shadow-xl mb-6 focus-within:border-indigo-500 dark:focus-within:border-zinc-600 transition-all">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Describe what you want to create, attach files, or pick a template below..."
            rows={3}
            className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none resize-none leading-relaxed"
          />

          {/* Prompt card action row */}
          <div className="mt-3 flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-200 dark:border-zinc-800/60 flex-wrap">
            <div className="flex items-center gap-2">
              {/* Design System Picker */}
              <div className="relative" ref={systemDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsSystemOpen(!isSystemOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700/80 hover:border-zinc-300 dark:hover:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                  title="Choose active design system"
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-black/10 dark:border-white/20 shadow-xs"
                    style={{ backgroundColor: selectedSystem.colors[2] || '#6366f1' }}
                  />
                  <span className="text-[11px] text-zinc-400 hidden sm:inline">Design system:</span>
                  <span className="font-semibold text-zinc-900 dark:text-white">{selectedSystem.name}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {isSystemOpen && (
                  <div className="absolute top-full mt-1.5 left-0 w-72 bg-white dark:bg-[#1a1b1e] border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 max-h-72 overflow-y-auto">
                    <div className="px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                      Select Design System
                    </div>
                    {DESIGN_SYSTEMS.map((sys) => (
                      <button
                        key={sys.id}
                        onClick={() => {
                          setSelectedSystem(sys);
                          setIsSystemOpen(false);
                        }}
                        className={`w-full text-left p-2 rounded-xl text-xs transition flex items-start gap-2.5 cursor-pointer ${
                          selectedSystem.id === sys.id
                            ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                        }`}
                      >
                        <div className="flex gap-1 shrink-0 mt-0.5">
                          {sys.colors.slice(0, 3).map((c, i) => (
                            <span
                              key={i}
                              className="w-2.5 h-2.5 rounded-full border border-black/10"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-zinc-900 dark:text-white flex items-center justify-between">
                            <span>{sys.name}</span>
                            {selectedSystem.id === sys.id && <Check className="w-3 h-3 text-indigo-500" />}
                          </div>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">{sys.description}</p>
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
                className={`px-2.5 py-1.5 rounded-xl border text-xs transition cursor-pointer flex items-center gap-1.5 ${
                  codeMode
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300 font-bold'
                    : 'border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
                title="Toggle Code vs Visual Preview output"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{codeMode ? 'Code Mode' : 'Visual Mode'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Model Picker */}
              <div className="relative" ref={modelDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsModelOpen(!isModelOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
                >
                  <span className="text-[10px] text-zinc-400">Model:</span>
                  <span className="font-semibold text-zinc-900 dark:text-white">{selectedModel}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {isModelOpen && (
                  <div className="absolute top-full mt-1.5 right-0 w-64 bg-white dark:bg-[#1a1b1e] border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                      Select Generation Model
                    </div>
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedModel(m.id);
                          setIsModelOpen(false);
                        }}
                        className={`w-full text-left p-2 rounded-xl text-xs transition cursor-pointer ${
                          selectedModel === m.id
                            ? 'bg-indigo-600 text-white font-bold'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{m.name}</span>
                          {selectedModel === m.id && <Check className="w-3 h-3" />}
                        </div>
                        <p className={`text-[10px] mt-0.5 truncate ${selectedModel === m.id ? 'text-indigo-200' : 'text-zinc-400'}`}>
                          {m.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Arrow */}
              <button
                type="button"
                onClick={handleCreate}
                disabled={!prompt.trim() || generating}
                className="w-8 h-8 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-40 text-white flex items-center justify-center transition cursor-pointer shadow-md shadow-orange-600/30"
                title="Generate Design (Ctrl+Enter)"
              >
                {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* ================= RESULT, SHOWN HERE =================
            The design is rendered on this screen. It used to be handed to the
            chat and this view navigated away, so the one screen built for
            designing never showed a design. */}
        {(generating || result || genError) && (
          <div className="mb-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70">
              <span className="text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                {generating ? 'Generating…' : 'Result'}
              </span>
              <div className="flex items-center gap-2">
                {generating && (
                  <button
                    type="button"
                    onClick={stopGenerating}
                    className="px-2.5 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Stop
                  </button>
                )}
                {!!result && !generating && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(firstCodeBlock(result)?.code || result)}
                    className="px-2.5 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Copy
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setResult(''); setGenError(''); }}
                  aria-label="Close result"
                  className="p-1 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {genError && (
              <p role="alert" className="px-4 py-3 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                {genError}
              </p>
            )}

            {/* Visual mode previews the HTML the model wrote; Code mode, and
                anything that is not a self-contained document, shows the text. */}
            {!genError && result && !codeMode && firstCodeBlock(result)?.code ? (
              <iframe
                title="Design preview"
                sandbox="allow-scripts"
                srcDoc={firstCodeBlock(result).code}
                className="w-full h-[520px] bg-white"
              />
            ) : (
              !genError && (
                <pre className="max-h-[520px] overflow-auto px-4 py-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                  {result || (generating ? 'Waiting for the first tokens…' : '')}
                </pre>
              )
            )}
          </div>
        )}

        {/* ================= DYNAMIC TAB CONTENT ================= */}

        {/* 1. TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div className="w-full mb-6">
            <div className="flex items-center justify-between mb-3 px-1 flex-wrap gap-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Choose a template
              </span>

              {/* Category Pills */}
              <div className="flex items-center gap-1 overflow-x-auto">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      activeCategory === cat
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
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
                    className={`p-3 rounded-2xl border flex flex-col items-center justify-center text-center transition-all cursor-pointer group relative min-h-[100px] ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-600/15 shadow-md shadow-indigo-500/20'
                        : 'border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#1b1c20] hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 flex items-center justify-center text-zinc-500 dark:text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110 transition mb-2">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-900 dark:group-hover:text-white leading-tight">
                      {t.name}
                    </span>
                    <span className="text-[9px] text-zinc-400 mt-1 uppercase font-bold">
                      {t.category}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. DESIGN SYSTEMS TAB */}
        {activeTab === 'systems' && (
          <div className="w-full mb-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Design System Library
              </span>
              <span className="text-xs text-indigo-500 font-bold">
                Active: {selectedSystem.name}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {DESIGN_SYSTEMS.map((sys) => {
                const isSelected = selectedSystem.id === sys.id;
                return (
                  <div
                    key={sys.id}
                    onClick={() => setSelectedSystem(sys)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 shadow-md ring-1 ring-indigo-500'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1b1c20] hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                        {sys.name}
                        {isSelected && <Check className="w-4 h-4 text-indigo-500" />}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">{sys.font}</span>
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3 leading-relaxed">
                      {sys.description}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800/60">
                      <div className="flex items-center gap-1.5">
                        {sys.colors.map((color, i) => (
                          <span
                            key={i}
                            className="w-4 h-4 rounded-md border border-black/10 shadow-xs"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSystem(sys);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Use System'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. PROJECTS TAB */}
        {activeTab === 'projects' && (
          <div className="w-full mb-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Design Projects & Prototypes
              </span>
              <button
                onClick={() => {
                  setPrompt('Create an innovative responsive SaaS design project with modern aesthetics');
                  setActiveTab('templates');
                }}
                className="text-xs font-bold text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Start New Design
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {[
                {
                  id: 'proj-1',
                  name: 'Neon Fintech Mobile App',
                  system: 'Cyberpunk Neon',
                  mode: 'Visual',
                  time: '2 hours ago',
                  prompt: 'Mobile crypto wallet and real-time transaction graphs with neon theme.',
                },
                {
                  id: 'proj-2',
                  name: 'SaaS Metrics Dashboard',
                  system: 'Nordic SaaS',
                  mode: 'Code',
                  time: 'Yesterday',
                  prompt: 'Multi-tenant analytics overview with responsive charts and dark mode.',
                },
                {
                  id: 'proj-3',
                  name: 'Executive Portfolio',
                  system: 'Minimal Clean',
                  mode: 'Visual',
                  time: '3 days ago',
                  prompt: 'Architectural portfolio featuring masonry grid and typography tokens.',
                },
              ].map((proj) => (
                <div
                  key={proj.id}
                  className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1b1c20] hover:border-indigo-500/50 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-sm text-zinc-900 dark:text-white truncate">
                        {proj.name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-semibold">
                        {proj.system}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                      {proj.prompt}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800/60 text-xs">
                    <span className="text-[10px] text-zinc-400">{proj.time}</span>
                    <button
                      onClick={() => {
                        setPrompt(proj.prompt);
                        const sys = DESIGN_SYSTEMS.find((s) => s.name === proj.system) || DESIGN_SYSTEMS[0];
                        setSelectedSystem(sys);
                        handleCreate();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      Open in Studio <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Dock Navigation matching Claude Design Studio */}
      <footer className="mt-auto px-6 py-3 border-t border-zinc-200 dark:border-zinc-800/80 bg-white/90 dark:bg-[#17181c] shrink-0 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          {[
            { id: 'templates', label: 'Templates' },
            { id: 'systems', label: 'Design systems' },
            { id: 'projects', label: 'Projects' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-800 dark:text-white shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates & tokens..."
              className="pl-8 pr-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:border-indigo-500 w-36 sm:w-56"
            />
          </div>
        </div>
      </footer>

      {/* Tutorial Modal */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1b1c20] border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> SMARAN Design Studio
              </h3>
              <button
                onClick={() => setShowTutorial(false)}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <p>
                <strong>1. Choose a Template:</strong> Select from 12 pre-built design patterns ranging from mobile apps and animations to interactive slides and 3D objects.
              </p>
              <p>
                <strong>2. Pick a Design System:</strong> Apply tokens from Modernist, Cyberpunk, Nordic SaaS, or Minimal Clean to style your layout automatically.
              </p>
              <p>
                <strong>3. Select AI Model:</strong> Pick Auto, Claude 3.5 Sonnet, GPT-4o, or SMARAN Core depending on your project needs.
              </p>
              <p>
                <strong>4. Full Artifact Generation:</strong> SMARAN compiles interactive HTML/CSS/JS web applications, wireframes, and live previews ready to export.
              </p>
            </div>
            <button
              onClick={() => setShowTutorial(false)}
              className="mt-6 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md shadow-indigo-600/25"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
