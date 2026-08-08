import React, { useEffect, useRef, useState } from 'react';
import { Send, FileText, Check, Copy, ArrowDown, Bot, Sparkles, BookOpen, User, X, Upload, Plus, Database, LayoutDashboard, Globe, FolderPlus, Brain } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { parseJsonResponse } from '../utils/api';
import ArtifactRenderer from './ArtifactRenderer';

const isChartSpec = (value) => (
  value &&
  typeof value === 'object' &&
  ['bar', 'line', 'pie'].includes(String(value.type || '').toLowerCase()) &&
  Array.isArray(value.labels) &&
  Array.isArray(value.datasets) &&
  value.datasets.every((dataset) => dataset && typeof dataset.label === 'string' && Array.isArray(dataset.data))
);

const parseChartSpec = (value) => {
  const tryParse = (str) => {
    try {
      const parsed = JSON.parse(str);
      return isChartSpec(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  };

  const cleanVal = value.trim();
  let res = tryParse(cleanVal);
  if (res) return res;

  // Attempt repairs for local models occasionally outputting ellipses/LaTeX
  try {
    // 1. Escape lone backslashes
    let repaired = cleanVal.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    
    // 2. Clear out array ellipses: remove trailing ellipses like ", ..." or ",..."
    repaired = repaired.replace(/,\s*\.\.\.\s*(?=\])/g, '');
    repaired = repaired.replace(/(?<=\[)\s*\.\.\.\s*,\s*/g, '');
    // Also remove mid-array ellipses like ", ..., " or ",...,"
    repaired = repaired.replace(/,\s*\.\.\.\s*,\s*/g, ',');
    
    res = tryParse(repaired);
    if (res) return res;

    // Fallback: replace any unquoted ... with null/empty tokens so JSON parsing is valid
    repaired = cleanVal.replace(/(?<!")\.\.\.(?!")/g, 'null');
    repaired = repaired.replace(/,\s*,\s*/g, ','); // merge double commas if any
    return tryParse(repaired);
  } catch (_) {
    return null;
  }
};

// Never expose Markdown control characters to employees when a model produces
// an incomplete marker such as "**Heading".
const cleanPlainText = (value) => String(value || '')
  .replace(/\*\*/g, '')
  .replace(/__/g, '');

// ── Think / Reasoning Block ───────────────────────────────────────────────────
// Renders the AI's chain-of-thought in a collapsible glassmorphism panel.
const ThinkBlock = ({ content }) => {
  const [open, setOpen] = React.useState(false);
  if (!content || !content.trim()) return null;
  return (
    <div className="mb-3 rounded-2xl border border-indigo-300/30 dark:border-indigo-700/30 bg-indigo-50/60 dark:bg-indigo-950/20 backdrop-blur-sm overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left cursor-pointer select-none group"
      >
        {/* Animated spinner dot when not expanded */}
        <span className={`flex h-2 w-2 shrink-0 rounded-full ${open ? 'bg-indigo-400' : 'bg-indigo-400 animate-pulse'}`} />
        <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex-1">
          {open ? 'Hide Reasoning' : 'Model\'s Reasoning (click to expand)'}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14" height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-indigo-500 dark:text-indigo-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-indigo-200/30 dark:border-indigo-800/30">
          <pre className="mt-3 font-mono text-[11px] leading-relaxed text-indigo-800 dark:text-indigo-300 whitespace-pre-wrap break-words">
            {content.trim()}
          </pre>
        </div>
      )}
    </div>
  );
};

// Markdown text & charts custom parser
// Also handles <think>...</think> reasoning blocks from CoT models.
const MarkdownText = ({ text }) => {
  if (!text) return null;

  // ── Extract <think>…</think> reasoning blocks ─────────────────────────────
  // These are streamed by DeepSeek-R1, Nemotron, and other CoT models.
  const thinkMatches = [];
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinkMatch;
  while ((thinkMatch = thinkRegex.exec(text)) !== null) {
    thinkMatches.push(thinkMatch[1]);
  }
  // Strip out all think blocks so they don't bleed into the main markdown
  const cleanedText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Handle partial/open <think> block still streaming (no closing tag yet)
  const hasOpenThink = /<think>/i.test(text) && !/<\/think>/i.test(text);
  const openThinkContent = hasOpenThink
    ? text.substring(text.toLowerCase().lastIndexOf('<think>') + 7)
    : null;

  const parts = cleanedText.split(/```/);
  
  const thinkElements = thinkMatches.map((t, i) => (
    <ThinkBlock key={`think-${i}`} content={t} />
  ));
  // Render an open/live think block if still streaming
  if (hasOpenThink && openThinkContent) {
    thinkElements.push(<ThinkBlock key="think-live" content={openThinkContent} />);
  }

  const markdownParts = parts.map((part, index) => {

    if (index % 2 === 1) {
      const lines = part.trim().split('\n');
      const firstLine = lines[0].trim();
      
      const firstLineLower = firstLine.toLowerCase();
      const rawBlockContent = lines.slice(1).join('\n').trim();

      if (firstLineLower === 'chart') {
        const chartData = parseChartSpec(rawBlockContent);
        if (chartData) {
          return <ArtifactRenderer key={index} data={chartData} />;
        }
      }

      // Check if this code block contains a valid chart specification (with or without language tag)
      const possibleJsonString = (firstLineLower === 'json' || firstLineLower === 'chart')
        ? rawBlockContent
        : part.trim();
        
      const autoChartData = parseChartSpec(possibleJsonString);
      if (autoChartData) {
        return <ArtifactRenderer key={index} data={autoChartData} />;
      }

      const isLang = /^[a-zA-Z0-9_\-]+$/.test(firstLine);
      const language = isLang ? firstLine : '';
      const code = isLang ? lines.slice(1).join('\n') : part;
      
      return <CodeBlock key={index} code={code.trim()} language={language} />;
    }

    const blockLines = part.split('\n');
    let elements = [];
    let currentTable = null;
    let currentList = null;

    const flushTable = (key) => {
      if (currentTable) {
        elements.push(
          <div key={`table-${key}`} className="overflow-x-auto my-4 border border-zinc-200 dark:border-zinc-800/60 rounded-xl shadow-md">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900/80 font-bold border-b border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-300">
                  {currentTable.headers.map((h, i) => (
                    <th key={i} className="px-4 py-2.5 border-r border-zinc-200 dark:border-zinc-850/80 font-bold uppercase tracking-wider">{parseInlineFormatting(h.trim())}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-850/60 bg-zinc-50/50 dark:bg-zinc-950/20">
                {currentTable.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 text-zinc-950 dark:text-zinc-300 font-semibold">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2 border-r border-zinc-200 dark:border-zinc-850/80 leading-relaxed">{parseInlineFormatting(cell.trim())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        currentTable = null;
      }
    };

    const flushList = (key) => {
      if (currentList) {
        elements.push(
          <ul key={`list-${key}`} className="list-disc pl-6 space-y-2 my-4 text-sm text-zinc-950 dark:text-zinc-300 font-semibold">
            {currentList.map((item, li) => (
              <li key={li} className="leading-relaxed">{parseInlineFormatting(item)}</li>
            ))}
          </ul>
        );
        currentList = null;
      }
    };

    blockLines.forEach((line, lineIdx) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('|')) {
        flushList(lineIdx);
        const cols = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        
        // Skip table separator alignment lines (e.g., | :--- | :--- |)
        if (cols.every(c => /^[:\s\-]+$/.test(c.trim()))) {
          return;
        }

        if (!currentTable) {
          currentTable = { headers: cols, rows: [] };
        } else {
          currentTable.rows.push(cols);
        }
        return;
      }

      flushTable(lineIdx);

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const itemText = trimmed.substring(2);
        if (!currentList) {
          currentList = [itemText];
        } else {
          currentList.push(itemText);
        }
        return;
      }

      flushList(lineIdx);

      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (match) {
          const level = match[1].length;
          const content = match[2];
          const classes = level === 1 ? "text-xl font-black my-4 text-zinc-950 dark:text-white tracking-wide" :
                          level === 2 ? "text-lg font-black my-3 text-zinc-950 dark:text-white tracking-wide" :
                          "text-sm font-black my-2 text-zinc-900 dark:text-zinc-200";
          elements.push(React.createElement(`h${level}`, { key: lineIdx, className: classes }, parseInlineFormatting(content)));
          return;
        }
      }

      if (trimmed) {
        elements.push(
          <p key={lineIdx} className="my-3 leading-relaxed text-sm text-zinc-950 dark:text-zinc-200 text-left font-semibold">
            {parseInlineFormatting(trimmed)}
          </p>
        );
      }
    });

    flushTable(part.length);
    flushList(part.length);

    return <div key={index}>{elements}</div>;
  });

  return (
    <>
      {thinkElements}
      {markdownParts}
    </>
  );
};

// Clean LaTeX math syntax into extremely readable presentation text
const cleanMathFormula = (mathStr) => {
  let cleaned = mathStr;
  
  // Strip out LaTeX block and inline math delimiters
  if (cleaned.startsWith('$$') && cleaned.endsWith('$$')) cleaned = cleaned.slice(2, -2);
  else if (cleaned.startsWith('$') && cleaned.endsWith('$')) cleaned = cleaned.slice(1, -1);
  else if (cleaned.startsWith('\\(') && cleaned.endsWith('\\)')) cleaned = cleaned.slice(2, -2);
  else if (cleaned.startsWith('\\[') && cleaned.endsWith('\\]')) cleaned = cleaned.slice(2, -2);

  // Replace common LaTeX operations and notations with readable symbols.
  cleaned = cleaned.replace(/\\left|\\right/g, '');
  cleaned = cleaned.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');
  cleaned = cleaned.replace(/\\text\{([^}]+)\}/g, '$1'); // Remove \text{...} wrappers
  cleaned = cleaned.replace(/\\times/g, ' × ');
  cleaned = cleaned.replace(/\\div/g, ' ÷ ');
  cleaned = cleaned.replace(/\\pm/g, ' ± ');
  cleaned = cleaned.replace(/\\cdot/g, ' · ');
  cleaned = cleaned.replace(/\\approx/g, ' ≈ ');
  cleaned = cleaned.replace(/\\neq/g, ' ≠ ');
  cleaned = cleaned.replace(/\\leq/g, ' ≤ ');
  cleaned = cleaned.replace(/\\geq/g, ' ≥ ');
  cleaned = cleaned.replace(/\\infty/g, '∞');
  cleaned = cleaned.replace(/\\rightarrow/g, '→');
  cleaned = cleaned.replace(/\\sum/g, 'Σ');
  cleaned = cleaned.replace(/\\prod/g, 'Π');
  cleaned = cleaned.replace(/\\int/g, '∫');
  
  // Greek Symbols & SI Units
  cleaned = cleaned.replace(/\\Delta/g, 'Δ');
  cleaned = cleaned.replace(/\\mu/g, 'μ');
  cleaned = cleaned.replace(/\\alpha/g, 'α');
  cleaned = cleaned.replace(/\\beta/g, 'β');
  cleaned = cleaned.replace(/\\gamma/g, 'γ');
  cleaned = cleaned.replace(/\\theta/g, 'θ');
  cleaned = cleaned.replace(/\\pi/g, 'π');
  cleaned = cleaned.replace(/\\sigma/g, 'σ');
  cleaned = cleaned.replace(/\\lambda/g, 'λ');
  cleaned = cleaned.replace(/\\omega/g, 'ω');
  cleaned = cleaned.replace(/\\phi/g, 'φ');
  cleaned = cleaned.replace(/\\psi/g, 'ψ');
  cleaned = cleaned.replace(/\\eta/g, 'η');
  cleaned = cleaned.replace(/\\rho/g, 'ρ');
  cleaned = cleaned.replace(/\\tau/g, 'τ');
  cleaned = cleaned.replace(/\\degC/g, '°C');
  cleaned = cleaned.replace(/\\degree/g, '°');
  cleaned = cleaned.replace(/\\circ/g, '°');
  cleaned = cleaned.replace(/\^\s*°/g, '°');
  
  // Fractions: \frac{num}{den} -> (num / den). Repeating handles common nested fractions.
  for (let i = 0; i < 4; i += 1) {
    const next = cleaned.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)');
    if (next === cleaned) break;
    cleaned = next;
  }
  
  // Superscripts & Subscripts
  const superscript = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const toSuperscript = (value) => [...value].map(char => superscript[char] || char).join('');
  cleaned = cleaned.replace(/\^\{([^}]+)\}/g, (_, value) => toSuperscript(value));
  cleaned = cleaned.replace(/\^2/g, '²');
  cleaned = cleaned.replace(/\^3/g, '³');
  cleaned = cleaned.replace(/\^x/g, 'ˣ');
  cleaned = cleaned.replace(/\^n/g, 'ⁿ');
  
  // Clean backslashes, escape underscores, spaces
  cleaned = cleaned.replace(/\\([ _&%#${}])/g, '$1'); 
  cleaned = cleaned.replace(/\\/g, ''); 
  cleaned = cleaned.replace(/\*/g, ' × ');
  
  return cleaned.trim();
};

const parseInlineFormatting = (text) => {
  if (!text) return '';
  
  // Split regex to capture block math ($$ or \[), inline math ($ or \(), bold (**), and inline code (`)
  const parts = text.split(/(\$\$[^\$]+\$\$|\$[^\$]+\$|\\\(.*?\\\)|\\\[.*?\\\]|\*\*.*?\*\*|`.*?`)/g);
  
  return parts.map((part, i) => {
    if (!part) return null;
    
    // Block Math
    if ((part.startsWith('$$') && part.endsWith('$$')) || (part.startsWith('\\[') && part.endsWith('\\]'))) {
      const cleaned = cleanMathFormula(part);
      return (
        <div key={i} className="my-4 p-4 text-center font-serif text-sm md:text-base bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-150/80 dark:border-indigo-900/60 rounded-2xl text-indigo-750 dark:text-indigo-400 font-bold shadow-xs select-all">
          {cleaned}
        </div>
      );
    }
    
    // Inline Math
    if ((part.startsWith('$') && part.endsWith('$')) || (part.startsWith('\\(') && part.endsWith('\\)'))) {
      const cleaned = cleanMathFormula(part);
      return (
        <span key={i} className="mx-1 px-1.5 py-0.5 rounded-md font-serif italic text-indigo-750 dark:text-indigo-400 font-bold bg-indigo-50/40 dark:bg-indigo-950/30">
          {cleaned}
        </span>
      );
    }
    
    // Bold
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-black text-zinc-950 dark:text-white">{part.slice(2, -2)}</strong>;
    }
    
    // Inline Code
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="px-1.5 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-950 border border-zinc-350 dark:border-zinc-850 text-indigo-750 dark:text-indigo-400 font-bold font-mono text-[11px]">{part.slice(1, -1)}</code>;
    }
    
    return cleanPlainText(part);
  });
};

const CodeBlock = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-2xl border border-zinc-200 dark:border-zinc-850 overflow-hidden bg-zinc-950 shadow-lg animate-in fade-in duration-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-900 bg-zinc-900/60 text-[10px] font-mono text-zinc-400">
        <span>{language.toUpperCase() || 'CODE NODE'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-450" />
              <span className="text-emerald-450 font-bold">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto font-mono text-[11px] text-zinc-300 leading-relaxed text-left whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
};

// ── Live pipeline step indicator — shown while AI is processing ──────────────
const THINKING_STEPS = [
  {
    icon: '🔍',
    title: 'Analyzing Query Intent',
    desc: 'Tokenizing your message & identifying key entities...',
    color: 'indigo',
  },
  {
    icon: '📚',
    title: 'Querying Knowledge Base',
    desc: 'Searching ChromaDB vector space + BM25 text index...',
    color: 'violet',
  },
  {
    icon: '⚖️',
    title: 'Reranking Context Blocks',
    desc: 'Applying Reciprocal Rank Fusion (RRF) on retrieved chunks...',
    color: 'purple',
  },
  {
    icon: '🔒',
    title: 'Acquiring Inference Slot',
    desc: 'Waiting for local GPU/CPU inference semaphore lock...',
    color: 'blue',
  },
  {
    icon: '🤖',
    title: 'Generating Response',
    desc: 'Local model synthesizing answer token-by-token...',
    color: 'indigo',
  },
];

const ThinkingIndicator = () => {
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const stepTimer = setInterval(() => {
      setStep((prev) => (prev < THINKING_STEPS.length - 1 ? prev + 1 : prev));
    }, 1800);
    const ticker = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => {
      clearInterval(stepTimer);
      clearInterval(ticker);
    };
  }, []);

  const current = THINKING_STEPS[step];
  const progress = ((step / (THINKING_STEPS.length - 1)) * 100).toFixed(0);

  return (
    <div className="space-y-3 w-full max-w-[520px] mt-4 text-left" aria-live="polite" aria-label="AI is processing">
      {/* Main status card */}
      <div className="flex items-start gap-3 rounded-2xl border border-indigo-400/25 bg-indigo-500/8 dark:bg-indigo-500/10 px-4 py-3.5 shadow-[0_0_24px_rgba(99,102,241,0.12)]">
        {/* Pulsing dot */}
        <span className="relative flex h-4 w-4 mt-0.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-70" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-indigo-500" />
        </span>

        <div className="flex-1 min-w-0">
          {/* Step title */}
          <p className="text-sm font-black text-indigo-700 dark:text-indigo-300 leading-tight">
            {current.icon} {current.title}…
          </p>
          {/* Step description */}
          <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
            {current.desc}
          </p>
          {/* Progress bar */}
          <div className="mt-2.5 h-1 w-full rounded-full bg-indigo-200/30 dark:bg-indigo-900/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-[1800ms] ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Step count + elapsed */}
          <div className="flex items-center justify-between mt-1.5">
            <div className="flex gap-1">
              {THINKING_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                    i < step
                      ? 'bg-indigo-500'
                      : i === step
                      ? 'bg-indigo-400 animate-pulse'
                      : 'bg-indigo-200/30 dark:bg-indigo-800/30'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
              {elapsed.toFixed(1)}s elapsed
            </span>
          </div>
        </div>

        {/* Bouncing dots */}
        <span className="flex gap-1 mt-1 shrink-0" aria-hidden="true">
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
        </span>
      </div>

      {/* Shimmer skeleton lines */}
      <div className="h-3.5 w-full rounded-full animate-gemini-shimmer" />
      <div className="h-3.5 w-[88%] rounded-full animate-gemini-shimmer" />
      <div className="h-3.5 w-[64%] rounded-full animate-gemini-shimmer" />
    </div>
  );
};

// ── Per-message row with Gemini-style copy / re-use actions ─────────────────
const MessageRow = ({ msg, onReuse, onRefClick, onEdit }) => {
  const [copied, setCopied] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(msg.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [speaking, setSpeaking] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    if ('speechSynthesis' in window) {
      if (speaking) {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      } else {
        // Strip think tags to only read final AI response
        const cleanText = msg.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
      }
    } else {
      alert("Text-to-speech is not supported in this browser.");
    }
  };

  const handleSave = () => {
    if (editText.trim() && editText.trim() !== msg.content) {
      onEdit(msg.id, editText.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(msg.content);
    setIsEditing(false);
  };

  return (
    <div
      className={`flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 group/row ${
        msg.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* AI avatar */}
      {msg.role !== 'user' && (
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 font-black mt-1 transition-all duration-500 ${
          msg.isLoading
            ? 'bg-indigo-500/15 dark:bg-indigo-500/20 shadow-[0_0_18px_rgba(99,102,241,0.35)] dark:shadow-[0_0_22px_rgba(139,92,246,0.45)] ring-2 ring-indigo-400/30 dark:ring-indigo-500/40'
            : 'bg-[#f0f4f9] dark:bg-[#2f2f30]'
        }`}>
          🤖
        </div>
      )}

      <div className={`flex flex-col min-w-0 ${
        msg.role === 'user' ? 'items-end max-w-[90%] sm:max-w-[80%]' : 'items-start w-full'
      }`}>
        {/* Bubble */}
        <div className={`p-4 ${
          msg.role === 'user'
            ? 'bg-[#f0f4f9] dark:bg-[#2f2f30] text-[#1f1f1f] dark:text-[#e3e3e3] rounded-[24px] font-semibold text-left shadow-xs border border-zinc-200/40 dark:border-zinc-800/60 hover:shadow-[0_0_14px_rgba(99,102,241,0.06)] dark:hover:shadow-[0_0_16px_rgba(99,102,241,0.09)] transition-shadow duration-300'
            : `bg-transparent text-[#1f1f1f] dark:text-[#e3e3e3] text-left w-full ${msg.isLoading ? 'border-l-2 border-indigo-400/40 dark:border-indigo-500/40 pl-3' : ''}`
        }`}>
          {msg.role === 'user' ? (
            <div className="space-y-2 text-left">
              {/* If we have a vision file reference, render it! */}
              {(() => {
                let imageUrl = msg.imagePreview; // Local blob URL during active session
                
                // If loaded from history database, parse msg.references
                if (!imageUrl && msg.references && Array.isArray(msg.references)) {
                  const visionRef = msg.references.find(r => r.type === 'vision');
                  if (visionRef && visionRef.url) {
                    imageUrl = `${API_BASE}${visionRef.url}`;
                  }
                } else if (!imageUrl && typeof msg.references === 'string') {
                  try {
                    const parsed = JSON.parse(msg.references);
                    if (Array.isArray(parsed)) {
                      const visionRef = parsed.find(r => r.type === 'vision');
                      if (visionRef && visionRef.url) {
                        imageUrl = `${API_BASE}${visionRef.url}`;
                      }
                    }
                  } catch (_) {}
                }

                if (imageUrl) {
                  return (
                    <div className="max-w-[320px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-xs mb-2">
                      <img 
                        src={imageUrl} 
                        alt="Uploaded visual resource" 
                        className="w-full h-auto max-h-[220px] object-cover"
                        onError={(e) => {
                          e.target.style.display = 'none'; // hide broken images gracefully
                        }}
                      />
                    </div>
                  );
                }
                return null;
              })()}
              
              {isEditing ? (
                <div className="w-full min-w-[280px] sm:min-w-[400px] flex flex-col gap-2 mt-1">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full p-2.5 bg-white dark:bg-zinc-800 border border-indigo-500/50 rounded-xl text-xs sm:text-sm text-zinc-950 dark:text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500 font-normal leading-relaxed resize-y min-h-[60px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={handleCancel}
                      className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-150 dark:hover:bg-zinc-800 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-[10px] font-bold text-white transition-all cursor-pointer shadow-xs"
                    >
                      Save & Send
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-bold whitespace-pre-wrap leading-relaxed text-left">
                  {/* Parse out the 📎 [Uploaded filename.png] text visual indicator to clean up bubble view if we rendered the image above */}
                  {msg.content.replace(/^📎\s*\[Uploaded\s+[^\]]+\]\s*/, '')}
                </p>
              )}
            </div>
          ) : (
            <>
              <MarkdownText text={msg.content} />

              {!msg.isLoading && msg.content && (
                <div className="mt-4 p-3 rounded-xl border border-indigo-500/20 dark:border-purple-500/20 bg-zinc-50/50 dark:bg-zinc-900/60 select-none shadow-sm flex flex-col gap-1.5 w-full select-all">
                  <div className="text-[9px] font-black text-indigo-600 dark:text-purple-400 uppercase tracking-widest flex items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 pb-1 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Verified Transparency Metrics (vLLM Engine)
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono text-zinc-650 dark:text-zinc-400">
                    <div>
                      <span className="text-zinc-400 dark:text-zinc-500">Model:</span>{" "}
                      <span className="font-bold text-zinc-950 dark:text-zinc-200">{msg.model_used || msg.modelUsed || 'Qwen3-4B-AWQ'}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400 dark:text-zinc-500">Tokens:</span>{" "}
                      <span className="font-bold text-zinc-950 dark:text-zinc-200">
                        {msg.tokenCount || msg.token_count || 0}
                        {msg.prompt_tokens ? ` (+${msg.prompt_tokens} prompt)` : ""}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-400 dark:text-zinc-500">Context:</span>{" "}
                      <span className="font-bold text-zinc-950 dark:text-zinc-200">
                        {msg.total_context || msg.totalContext || 8192}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-400 dark:text-zinc-500">Date/Time:</span>{" "}
                      <span className="font-bold text-zinc-950 dark:text-zinc-200">
                        {msg.local_datetime || (msg.created_at ? new Date(msg.created_at).toLocaleString() : new Date().toLocaleString())}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {msg.isLoading && <ThinkingIndicator />}

            </>
          )}
        </div>

        {/* ── Gemini-style action bar — visible on row hover ── */}
        {!msg.isLoading && msg.content && !isEditing && (
          <div className={`flex items-center gap-0.5 mt-1.5 px-1 opacity-0 group-hover/row:opacity-100 transition-opacity duration-150 ${
            msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
          }`}>
            {/* Copy */}
            <button
              onClick={handleCopy}
              title="Copy message"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 transition-all cursor-pointer select-none"
            >
              {copied
                ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Copied!</span></>
                : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>
              }
            </button>

            {/* Speak TTS (offline browser fallback) */}
            <button
              onClick={handleSpeak}
              title={speaking ? "Stop speaking" : "Listen to response"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 transition-all cursor-pointer select-none"
            >
              {speaking ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                  <span>Speak</span>
                </>
              )}
            </button>

            {/* Edit (user messages only) */}
            {msg.role === 'user' && (
              <button
                onClick={() => setIsEditing(true)}
                title="Edit message"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 transition-all cursor-pointer select-none"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                <span>Edit</span>
              </button>
            )}

            {/* Re-use (user messages only) */}
            {msg.role === 'user' && (
              <button
                onClick={() => onReuse(msg.content)}
                title="Paste back into input"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 transition-all cursor-pointer select-none"
              >
                <ArrowDown className="w-3.5 h-3.5 -rotate-90" />
                <span>Re-use</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* User avatar */}
      {msg.role === 'user' && (
        <div className="w-9 h-9 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0 shadow-md mt-1">
          <User className="w-4.5 h-4.5 text-zinc-650" />
        </div>
      )}
    </div>
  );
};

const ChatArea = ({ token, activeSessionId, activeCollections, setActiveCollections, selectedModel, turboMode, onTogglePanel }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [selectedRef, setSelectedRef] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [activeModelDisplay, setActiveModelDisplay] = useState('Llama 3.1 8B (Core)');
  const [lastUsedModel, setLastUsedModel] = useState('');
  const [directUploading, setDirectUploading] = useState(false);
  const [directUploadMessage, setDirectUploadMessage] = useState(null);
  const [isPasteTableOpen, setIsPasteTableOpen] = useState(false);
  const [pasteTableName, setPasteTableName] = useState('');
  const [pasteTableData, setPasteTableData] = useState('');
  // Gemini-style Live Web Search Toggle
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  // RAG Mode Toggle — Combination (RAG On / Direct AI Mode)
  const [isRagEnabled, setIsRagEnabled] = useState(true);
  // Model readiness — polling until model is downloaded
  const [modelStatus, setModelStatus] = useState({ ready: true, downloading: false, status_msg: '', display_name: '' });

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const streamingRef = useRef(false);
  const incomingQueueRef = useRef([]);
  const typewriterTimerRef = useRef(null);

  useEffect(() => {
    const displayMap = {
      'auto': 'Auto (Smart Model Router)',
      'Qwen/Qwen3-4B-AWQ': 'Qwen 3 4B AWQ (Quantized)',
      'Qwen/Qwen3-4B': 'Qwen 3 4B (Full Precision)',
      'nvidia/Nemotron-Mini-4B-Instruct': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
      'nemotron-mini:4b': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
      'Qwen/Qwen3-8B': 'Qwen 3 8B (High Precision Reasoning)',
      'qwen3:8b': 'Qwen 3 8B (High Precision Reasoning)',
    };
    setActiveModelDisplay(displayMap[selectedModel] || selectedModel);
  }, [selectedModel]);

  // Poll model download status every 5s until ready
  useEffect(() => {
    let interval = null;
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/model/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setModelStatus(data);
          if (data.ready) {
            // Model is ready — stop polling
            clearInterval(interval);
          }
        }
      } catch (_) {}
    };
    checkStatus();
    interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (activeSessionId) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  useEffect(() => {
    fetchUploadedFiles();
  }, [activeCollections, token, activeSessionId]);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${activeSessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await parseJsonResponse(res);
        setMessages(data);
        setTimeout(scrollToBottom, 50);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUploadedFiles = async () => {
    // CRITICAL: Never show files if there is no active session.
    // Without a session_id filter the backend returns ALL documents across all
    // sessions — which causes old uploaded files to reappear after chat history
    // is deleted or when a new session is being created.
    if (!token || !activeSessionId || activeCollections.length === 0) {
      setUploadedFiles([]);
      return;
    }
    try {
      const allDocs = [];
      for (const colId of activeCollections) {
        // Always pass session_id — only files uploaded in THIS session are shown.
        const url = `${API_BASE}/api/collections/${colId}/documents?session_id=${activeSessionId}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const docs = await parseJsonResponse(res);
          allDocs.push(...docs);
        }
      }
      setUploadedFiles(allDocs);
    } catch (err) {
      console.error(err);
    }
  };


  const handleDeleteUploadedFile = async (docId) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setUploadedFiles((prev) => prev.filter((f) => f.id !== docId));
      } else {
        alert('Failed to delete file. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete file. Please try again.');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 400);
  };

  // Direct upload inside the chat window
  const handleDirectUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDirectFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !activeSessionId) return;

    setDirectUploading(true);
    setDirectUploadMessage(`Ingesting ${files.length} document(s) to vector database...`);

    try {
      // 1. Fetch existing collections
      const getColRes = await fetch(`${API_BASE}/api/collections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      let targetCollectionId = null;
      if (getColRes.ok) {
        const cols = await parseJsonResponse(getColRes);
        if (cols.length > 0) {
          targetCollectionId = cols[0].id;
        }
      }

      // 2. If no collection exists, create a default "Quick Uploads" collection
      if (!targetCollectionId) {
        setDirectUploadMessage("Initializing default database folder 'Quick Uploads'...");
        const createColRes = await fetch(`${API_BASE}/api/collections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Quick Uploads',
            description: 'Autocreated folder for direct chat file uploads'
          }),
        });

        if (createColRes.ok) {
          const colData = await parseJsonResponse(createColRes);
          targetCollectionId = colData.id;
        } else {
          throw new Error("Could not initialize default upload collection");
        }
      }

      // 3. Upload each file
      setDirectUploadMessage(`Uploading and chunking ${files.length} document(s)...`);
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        if (activeSessionId) {
          formData.append('session_id', activeSessionId);
        }

        const uploadRes = await fetch(`${API_BASE}/api/collections/${targetCollectionId}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!uploadRes.ok) {
          const errData = await parseJsonResponse(uploadRes);
          throw new Error(errData.detail || `Upload error for ${file.name}`);
        }
      }

      setIsRagEnabled(true);
      // Add collection to search contexts if not checked
      if (!activeCollections.includes(targetCollectionId)) {
        setActiveCollections([...activeCollections, targetCollectionId]);
      } else {
        fetchUploadedFiles();
      }
      
      setDirectUploadMessage(`🟢 Successfully parsed and indexed ${files.length} document(s)!`);
      setTimeout(() => {
        setDirectUploadMessage(null);
      }, 4000);
    } catch (err) {
      console.error(err);
      alert(`Upload Warning/Error:\n${err.message}`);
    } finally {
      setDirectUploading(false);
      if (e.target) e.target.value = null;
    }
  };

  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !activeSessionId) return;

    setDirectUploading(true);
    let uploadedCount = 0;
    
    // Filter supported files
    const supportedExtensions = ['.pdf', '.csv', '.xlsx', '.docx', '.pptx', '.txt', '.md', '.xml', '.py', '.cpp', '.h', '.json', '.yaml', '.yml', '.log', '.html', '.htm'];
    const validFiles = files.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return supportedExtensions.includes(ext);
    });

    if (validFiles.length === 0) {
      alert("No supported documents found in the selected folder.");
      setDirectUploading(false);
      return;
    }

    // 1. Fetch or create collection
    let targetCollectionId = null;
    try {
      const getColRes = await fetch(`${API_BASE}/api/collections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (getColRes.ok) {
        const cols = await parseJsonResponse(getColRes);
        if (cols.length > 0) {
          targetCollectionId = cols[0].id;
        }
      }
      if (!targetCollectionId) {
        setDirectUploadMessage("Initializing default database folder 'Folder Uploads'...");
        const createColRes = await fetch(`${API_BASE}/api/collections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Folder Uploads',
            description: 'Autocreated folder for recursive directory indexing'
          }),
        });
        if (createColRes.ok) {
          const colData = await parseJsonResponse(createColRes);
          targetCollectionId = colData.id;
        }
      }
    } catch (err) {
      console.error(err);
    }

    if (!targetCollectionId) {
      alert("Could not initialize target collection for folder upload.");
      setDirectUploading(false);
      return;
    }

    // 2. Upload each file sequentially
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setDirectUploadMessage(`Ingesting folder files: ${i + 1} of ${validFiles.length} ("${file.name}")...`);
      
      const formData = new FormData();
      formData.append('file', file);
      if (activeSessionId) {
        formData.append('session_id', activeSessionId);
      }

      try {
        const uploadRes = await fetch(`${API_BASE}/api/collections/${targetCollectionId}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (uploadRes.ok) {
          uploadedCount++;
        }
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
      }
    }

    // Update session collections context if not active
    if (!activeCollections.includes(targetCollectionId)) {
      setActiveCollections([...activeCollections, targetCollectionId]);
    } else {
      fetchUploadedFiles();
    }

    setDirectUploadMessage(`🟢 Successfully ingested ${uploadedCount} of ${validFiles.length} files from folder!`);
    setTimeout(() => {
      setDirectUploadMessage(null);
    }, 4000);
    setDirectUploading(false);
    e.target.value = null;
  };

  const handlePasteTableSubmit = async (e) => {
    e.preventDefault();
    if (!pasteTableData.trim() || !activeSessionId) return;

    setIsPasteTableOpen(false);
    setDirectUploading(true);
    setDirectUploadMessage("Processing pasted spreadsheet table parameters...");

    // Convert tab-separated values (TSV) to CSV
    const rows = pasteTableData.split('\n');
    const csvRows = [];
    for (const row of rows) {
      if (!row.trim()) continue;
      const cols = row.split('\t').map(col => {
        let val = col.replace(/"/g, '""');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val}"`;
        }
        return val;
      });
      csvRows.push(cols.join(','));
    }
    const csvContent = csvRows.join('\n');
    
    // Create virtual File object
    const fileName = `${pasteTableName.trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pasted_table'}.csv`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const file = new File([blob], fileName, { type: 'text/csv' });

    try {
      // 1. Fetch or create collection
      let targetCollectionId = null;
      const getColRes = await fetch(`${API_BASE}/api/collections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (getColRes.ok) {
        const cols = await parseJsonResponse(getColRes);
        if (cols.length > 0) {
          targetCollectionId = cols[0].id;
        }
      }
      if (!targetCollectionId) {
        const createColRes = await fetch(`${API_BASE}/api/collections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: 'Pasted Tables',
            description: 'Autocreated folder for Excel tables pasted from clipboard'
          }),
        });
        if (createColRes.ok) {
          const colData = await parseJsonResponse(createColRes);
          targetCollectionId = colData.id;
        }
      }

      if (!targetCollectionId) {
        throw new Error("Could not initialize target database collection.");
      }

      // 2. Upload
      setDirectUploadMessage(`Ingesting pasted CSV data table as "${fileName}"...`);
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(`${API_BASE}/api/collections/${targetCollectionId}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (uploadRes.ok) {
        if (!activeCollections.includes(targetCollectionId)) {
          setActiveCollections([...activeCollections, targetCollectionId]);
        } else {
          fetchUploadedFiles();
        }
        setDirectUploadMessage(`🟢 Successfully ingested table "${fileName}"!`);
        setTimeout(() => setDirectUploadMessage(null), 4000);
      } else {
        const errData = await parseJsonResponse(uploadRes);
        throw new Error(errData.detail || "Upload error");
      }
    } catch (err) {
      console.error(err);
      alert(`Pasted table upload failed: ${err.message}`);
      setDirectUploadMessage(null);
    } finally {
      setDirectUploading(false);
      setPasteTableName('');
      setPasteTableData('');
    }
  };

  const handleEditMessage = async (msgId, newText) => {
    if (!newText || !newText.trim() || streaming) return;
    try {
      // 1. Send edit request to backend API
      const resp = await fetch(`${API_BASE}/api/chat/messages/${msgId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: newText.trim() })
      });
      
      if (!resp.ok) {
        throw new Error('Failed to update message content.');
      }

      // 2. Fetch the fresh branched session messages to sync client state (removes all messages after this one)
      const messagesResp = await fetch(`${API_BASE}/api/chat/sessions/${activeSessionId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (messagesResp.ok) {
        const updatedMsgs = await messagesResp.json();
        setMessages(updatedMsgs);
        
        // 3. Trigger chat stream using the edited user text, and clearing current input field
        setStreaming(true);
        streamingRef.current = true;
        incomingQueueRef.current = [];

        // Set up the loading assistant message chunk
        const assistantMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: '',
          references: [],
          created_at: new Date().toISOString(),
          isLoading: true,
          tokenCount: 0,
        };

        // Append the assistant loading bubble to messages
        setMessages((prev) => [...prev, assistantMessage]);
        setTimeout(scrollToBottom, 50);

        // Fetch streaming response from chat endpoint
        try {
          const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              session_id: activeSessionId,
              prompt: newText.trim(),
              collections: activeCollections,
              model: selectedModel,
              turbo: turboMode,
              web_search: isWebSearchEnabled,
            }),
          });

          if (!res.ok) {
            const errorBody = await parseJsonResponse(res);
            throw new Error(errorBody?.detail || `Server error (${res.status})`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let accumulatedResponse = '';
          let references = [];
          let tokenCount = 0;
          let streamBuffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            streamBuffer += decoder.decode(value, { stream: true });
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.references) {
                    references = parsed.references;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id ? { ...msg, references } : msg
                      )
                    );
                  }
                  if (parsed.model_routed) {
                    setLastUsedModel(parsed.model_routed);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id ? { ...msg, model_used: parsed.model_routed } : msg
                      )
                    );
                  }
                  const tokenStr = parsed.token || parsed.error;
                  if (tokenStr) {
                    accumulatedResponse += tokenStr;
                    incomingQueueRef.current.push(tokenStr);
                    
                    if (!typewriterTimerRef.current) {
                      const processQueue = () => {
                        if (incomingQueueRef.current.length > 0) {
                          const nextToken = incomingQueueRef.current.shift();
                          setMessages((prev) =>
                            prev.map((msg) =>
                              msg.id === assistantMessage.id
                                ? { ...msg, content: (msg.content || '') + nextToken }
                                : msg
                            )
                          );
                          setTimeout(scrollToBottom, 20);
                          typewriterTimerRef.current = setTimeout(processQueue, 15);
                        } else {
                          typewriterTimerRef.current = null;
                        }
                      };
                      processQueue();
                    }
                  }
                  // Handle metrics payload
                  if (parsed.token_count) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id
                          ? {
                              ...msg,
                              tokenCount: parsed.token_count,
                              prompt_tokens: parsed.prompt_tokens,
                              total_context: parsed.total_context,
                              context_remaining: parsed.context_remaining,
                              execution_time_sec: parsed.execution_time_sec,
                              local_datetime: parsed.local_datetime,
                            }
                          : msg
                      )
                    );
                  }
                } catch (_) {}
              }
            }
          }

          // Complete typewriter queue flush if any
          const flushQueue = () => {
            if (incomingQueueRef.current.length > 0) {
              const remaining = incomingQueueRef.current.join('');
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? { ...msg, content: (msg.content || '') + remaining }
                    : msg
                )
              );
              incomingQueueRef.current = [];
            }
          };
          flushQueue();

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessage.id ? { ...msg, isLoading: false } : msg
            )
          );
        } catch (streamErr) {
          console.error(streamErr);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessage.id
                ? { ...msg, content: (msg.content || '') + `\n[Streaming Error: ${streamErr.message}]`, isLoading: false }
                : msg
            )
          );
        } finally {
          setStreaming(false);
          streamingRef.current = false;
        }
      }
    } catch (err) {
      console.error(err);
      alert('Error saving message: ' + err.message);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || streaming || !activeSessionId || !modelStatus.ready) return;

    const userPrompt = input.trim();
    
    setInput('');
    setStreaming(true);
    streamingRef.current = true;
    incomingQueueRef.current = [];

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: userPrompt,
      created_at: new Date().toISOString(),
    };
    
    const streamStartTime = Date.now();
    const assistantMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      references: [],
      created_at: new Date().toISOString(),
      isLoading: true,
      tokenCount: 0,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setTimeout(scrollToBottom, 50);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: activeSessionId,
          prompt: userPrompt,
          collections: isRagEnabled ? activeCollections : [],
          model: selectedModel,
          turbo: turboMode,
          web_search: isWebSearchEnabled,
        }),
      });

      if (!res.ok) {
        const errorBody = await parseJsonResponse(res);
        throw new Error(errorBody?.detail || `Server returned an error (${res.status})`);
      }


      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedResponse = '';
      let references = [];
      let tokenCount = 0;

      let streamBuffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.references) {
                references = parsed.references;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, references } : msg
                  )
                );
              }
              if (parsed.model_routed) {
                setLastUsedModel(parsed.model_routed);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, modelUsed: parsed.model_routed } : msg
                  )
                );
              }
              if (parsed.response_time_ms) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id 
                      ? { 
                          ...msg, 
                          responseTimeMs: parsed.response_time_ms,
                          // Map tokens_per_sec from the final backend metadata payload
                          tokensPerSec: parsed.tokens_per_sec || msg.tokensPerSec
                        } 
                      : msg
                  )
                );
              }
              if (parsed.token) {
                tokenCount += 1;
                incomingQueueRef.current.push(parsed.token);
                if (!typewriterTimerRef.current) {
                  typewriterTimerRef.current = setInterval(() => {
                    if (incomingQueueRef.current.length > 0) {
                      const next = incomingQueueRef.current.shift();
                      accumulatedResponse += next;
                      const elapsedSec = (Date.now() - streamStartTime) / 1000;
                      const tps = elapsedSec > 0 ? (tokenCount / elapsedSec) : 0;
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessage.id
                            ? { ...msg, content: accumulatedResponse, isLoading: false, tokenCount, tokensPerSec: tps }
                            : msg
                        )
                      );
                      scrollToBottom();
                    } else if (!streamingRef.current) {
                      clearInterval(typewriterTimerRef.current);
                      typewriterTimerRef.current = null;
                    }
                  }, 12);
                }
              }
              if (parsed.error) {
                incomingQueueRef.current.push(`\n\n[Error: ${parsed.error}]`);
              }
            } catch (err) {
              console.error('Partial buffer line parse skipped', err);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: `Request failed: ${err.message || 'Unable to communicate with the local AI model.'}`, isLoading: false }
            : msg
        )
      );
    } finally {
      setStreaming(false);
      streamingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-[#0c0c0e]/40 relative overflow-hidden transition-colors duration-300">
      {/* Background glows — clamped so they never cause horizontal scroll */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[45%] left-[55%] -translate-x-1/2 -translate-y-1/2 w-[400px] sm:w-[700px] h-[400px] sm:h-[700px] rounded-full blur-[120px] sm:blur-[160px] animate-drift-1 bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,rgba(139,92,246,0.18)_40%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(79,70,229,0.2)_0%,rgba(139,92,246,0.3)_40%,transparent_70%)]" />
        <div className="absolute top-[30%] left-[25%] w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full blur-[80px] sm:blur-[120px] animate-drift-2 bg-[radial-gradient(circle,rgba(59,130,246,0.08)_0%,rgba(6,182,212,0.1)_50%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(30,58,138,0.18)_0%,rgba(15,118,110,0.15)_50%,transparent_70%)]" />
        <div className="absolute bottom-[15%] right-[20%] w-[250px] sm:w-[400px] h-[250px] sm:h-[400px] rounded-full blur-[90px] sm:blur-[130px] animate-drift-1 bg-[radial-gradient(circle,rgba(236,72,153,0.06)_0%,rgba(168,85,247,0.08)_50%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(236,72,153,0.12)_0%,rgba(168,85,247,0.18)_50%,transparent_70%)]" />
      </div>

      {/* Top Banner Status */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 bg-white dark:bg-[#131314]/50 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-900 flex flex-row items-center justify-between text-[11px] sm:text-xs text-zinc-900 dark:text-zinc-400 select-none font-bold transition-colors duration-300 gap-2 overflow-hidden shrink-0 relative z-10">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-650 dark:text-indigo-400 animate-pulse shrink-0" />
          <span className="truncate flex items-center gap-1">
            Engine:
            <strong className="text-zinc-950 dark:text-zinc-200 font-extrabold font-mono bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 rounded-md text-[10px] sm:text-xs whitespace-nowrap">
              {activeModelDisplay}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
          <span className="text-zinc-900 dark:text-zinc-400 font-extrabold uppercase tracking-wider text-[9px] sm:text-[10px] whitespace-nowrap">
            <span className="inline sm:hidden">Online</span>
            <span className="hidden sm:inline">Local Index Sync Node Online</span>
          </span>
          {/* Performance Panel Toggle */}
          {onTogglePanel && (
            <button
              onClick={onTogglePanel}
              title="Toggle Performance Panel"
              className="ml-1 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Model Downloading Banner — shown when AI model is still being pulled */}
      {!modelStatus.ready && (
        <div className="shrink-0 z-20 relative">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800/60">
            {/* Animated spinner */}
            <div className="shrink-0 relative flex items-center justify-center w-6 h-6">
              <span className="absolute w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-amber-800 dark:text-amber-300 truncate">
                {modelStatus.status_msg || 'AI Model is downloading — please wait...'}
              </p>
              {modelStatus.progress_pct > 0 && (
                <div className="mt-1.5 w-full max-w-md bg-amber-200 dark:bg-amber-950/20 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="h-full bg-amber-600 dark:bg-amber-450 rounded-full transition-all duration-500" 
                    style={{ width: `${modelStatus.progress_pct}%` }}
                  />
                </div>
              )}
              <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 font-semibold mt-0.5">
                Downloading model weights in background. You can chat immediately using ready models.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 bg-amber-200/60 dark:bg-amber-900/50 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 uppercase tracking-wider">Downloading</span>
            </div>
          </div>
        </div>
      )}

      {/* Messages Scroll Panel */}
      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6 relative z-10"
      >
        {messages.length === 0 ? (
          <div className="min-h-full flex flex-col items-center justify-start sm:justify-center text-center max-w-2xl mx-auto w-full space-y-4 sm:space-y-6 px-2 py-6 sm:py-8 select-none animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Animated Gradient Icon — hidden on very small screens to save space */}
            <div className="relative hidden sm:block">
              <div className="absolute inset-0 w-16 h-16 sm:w-24 sm:h-24 rounded-[20px] sm:rounded-[28px] bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 opacity-25 dark:opacity-40 blur-xl animate-pulse" />
              <div className="relative w-16 h-16 sm:w-24 sm:h-24 rounded-[20px] sm:rounded-[28px] bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-[2px] shadow-[0_0_40px_rgba(99,102,241,0.3)] dark:shadow-[0_0_50px_rgba(139,92,246,0.4)]">
                <div className="w-full h-full rounded-[18px] sm:rounded-[26px] bg-white dark:bg-[#131314] flex items-center justify-center">
                  <Bot className="w-8 h-8 sm:w-11 sm:h-11 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
            </div>

            {/* Heading */}
            <div className="space-y-2 sm:space-y-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight select-none">
                <span className="bg-gradient-to-r from-[#ea580c] via-[#f97316] to-[#fbbf24] bg-clip-text text-transparent">SMARAN</span>
                {' '}
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">AI</span>
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-md mx-auto font-semibold">
                Meet SMARAN AI, your personal AI assistant.
              </p>
            </div>

            {/* Prompt Cards — single col on mobile, 2-col on sm+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 md:gap-4 w-full select-none">
              {[
                {
                  title: "Summarize Inventory Stock",
                  subtitle: "Get a high-level summary of store item counts, categories, and top suppliers.",
                  prompt: "Provide a detailed summary of the store inventory based on the uploaded data. What are the main categories of items, who are the key suppliers, and what is the total item count?",
                  icon: "💡",
                  gradient: "from-amber-500/20 to-orange-500/20 dark:from-amber-500/10 dark:to-orange-500/10",
                  borderHover: "hover:border-amber-400/50 dark:hover:border-amber-500/30",
                  glowHover: "hover:shadow-[0_0_30px_rgba(245,158,11,0.15)] dark:hover:shadow-[0_0_35px_rgba(245,158,11,0.2)]"
                },
                {
                  title: "Low Stock Alert Analysis",
                  subtitle: "Find which items in the store are currently below their minimum stock limits.",
                  prompt: "Identify and list all items in the inventory where the closing stock is less than the specified minimum stock limit. Suggest which items need reordering.",
                  icon: "🛠️",
                  gradient: "from-blue-500/20 to-cyan-500/20 dark:from-blue-500/10 dark:to-cyan-500/10",
                  borderHover: "hover:border-blue-400/50 dark:hover:border-blue-500/30",
                  glowHover: "hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] dark:hover:shadow-[0_0_35px_rgba(59,130,246,0.2)]"
                },
                {
                  title: "Visualize Stock Distribution",
                  subtitle: "Request a cost breakdown chart to visualize total inventory stock value.",
                  prompt: "Show a bar chart visualization of the total value of stock grouped by brand and category. List the values and counts.",
                  icon: "📊",
                  gradient: "from-emerald-500/20 to-teal-500/20 dark:from-emerald-500/10 dark:to-teal-500/10",
                  borderHover: "hover:border-emerald-400/50 dark:hover:border-emerald-500/30",
                  glowHover: "hover:shadow-[0_0_30px_rgba(16,185,129,0.15)] dark:hover:shadow-[0_0_35px_rgba(16,185,129,0.2)]"
                },
                {
                  title: "Context & System Info",
                  subtitle: "Find out which knowledge collections and files are currently active.",
                  prompt: "What knowledge collections and documents are currently loaded into my active RAG context? Summarize their contents.",
                  icon: "🔍",
                  gradient: "from-purple-500/20 to-pink-500/20 dark:from-purple-500/10 dark:to-pink-500/10",
                  borderHover: "hover:border-purple-400/50 dark:hover:border-purple-500/30",
                  glowHover: "hover:shadow-[0_0_30px_rgba(168,85,247,0.15)] dark:hover:shadow-[0_0_35px_rgba(168,85,247,0.2)]"
                }
              ].map((card, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    if (activeSessionId) {
                      setInput(card.prompt);
                    }
                  }}
                  className={`relative p-3 sm:p-4 bg-white/70 dark:bg-white/[0.03] backdrop-blur-md border border-zinc-200/60 dark:border-white/[0.06] rounded-2xl cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-left flex flex-col justify-between min-h-[70px] sm:h-28 md:h-32 group overflow-hidden ${card.borderHover} ${card.glowHover}`}
                >
                  {/* Hover gradient overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl`} />
                  
                  <div className="space-y-1 relative z-10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-zinc-950 dark:text-white group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
                        {card.title}
                      </span>
                      <span className="text-base group-hover:scale-125 transition-transform duration-300">{card.icon}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
                      {card.subtitle}
                    </p>
                  </div>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-extrabold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 relative z-10">
                    Use Prompt &rarr;
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                onReuse={(text) => setInput(text)}
                onRefClick={(ref) => setSelectedRef(ref)}
                onEdit={handleEditMessage}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Direct uploading status overlay */}
      {directUploading && (
        <div className="mx-6 mb-2 p-4 bg-indigo-500/10 border border-indigo-500/20 dark:border-indigo-500/25 text-indigo-700 dark:text-indigo-400 text-xs rounded-2xl flex items-center gap-3 animate-pulse text-left font-bold shadow-md">
          <Upload className="w-5 h-5 animate-bounce shrink-0" />
          <span>{directUploadMessage}</span>
        </div>
      )}

      {/* Floating Scroll Bottom Button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute right-4 sm:right-8 bottom-24 sm:bottom-28 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-650 dark:text-zinc-300 rounded-full shadow-2xl transition-all cursor-pointer animate-bounce z-20"
        >
          <ArrowDown className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        </button>
      )}

      {/* Uploaded Files Chips (Gemini style) */}
      {uploadedFiles.length > 0 && (
        <div className="max-w-4xl mx-auto px-6 py-2 flex flex-wrap gap-2 select-none animate-in fade-in slide-in-from-bottom-1 duration-200 text-left">
          {uploadedFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#f0f4f9] dark:bg-[#2f2f30] border border-zinc-200/60 dark:border-zinc-800/80 rounded-full text-xs font-semibold text-zinc-850 dark:text-zinc-200"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-[#8ab4f8]" />
              <span className="max-w-[150px] truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => handleDeleteUploadedFile(f.id)}
                className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-rose-600 transition-colors cursor-pointer"
                title="Delete file from database"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Box Console */}
      <div className="px-3 sm:px-5 pb-4 sm:pb-5 pt-2 bg-transparent shrink-0 relative z-10">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto flex items-center bg-[#f0f4f9] dark:bg-[#1e1f20] border border-zinc-200/50 dark:border-zinc-800/80 rounded-[28px] sm:rounded-[32px] px-3 sm:px-4 py-1.5 sm:py-2 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:focus-within:ring-indigo-500/20 focus-within:border-indigo-400/40 dark:focus-within:border-indigo-500/30 transition-all shadow-xs focus-within:shadow-[0_0_25px_rgba(99,102,241,0.12)] dark:focus-within:shadow-[0_0_30px_rgba(99,102,241,0.15)]">
          
          {/* Attach File */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeSessionId || directUploading}
            className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-400 rounded-full transition-colors cursor-pointer disabled:opacity-35 shrink-0"
            title="Attach Files"
          >
            <Upload className="w-5 h-5" />
          </button>

          {/* Upload Folder (Recursive Subfolder Ingestion) */}
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={!activeSessionId || directUploading}
            className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-indigo-600 dark:text-indigo-400 rounded-full transition-colors cursor-pointer disabled:opacity-35 shrink-0"
            title="Upload Entire Folder (Recursive Subfolders & Files)"
          >
            <FolderPlus className="w-5 h-5" />
          </button>
          
          {/* Paste Excel Table */}
          <button
            type="button"
            onClick={() => setIsPasteTableOpen(true)}
            disabled={!activeSessionId || directUploading}
            className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-emerald-600 dark:text-emerald-500 rounded-full transition-colors cursor-pointer disabled:opacity-35 shrink-0"
            title="Paste Excel Table"
          >
            <BookOpen className="w-5 h-5" />
          </button>

          {/* RAG Mode Toggle (Combination: RAG + Direct Chat) */}
          <button
            type="button"
            onClick={() => setIsRagEnabled(!isRagEnabled)}
            disabled={!activeSessionId || directUploading}
            className={`px-2.5 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1.5 text-xs font-black ${
              isRagEnabled
                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/40 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
            }`}
            title={isRagEnabled ? 'RAG Document Grounding ON (Searching uploaded collections)' : 'Direct AI Mode (RAG Disabled - Fast Unrestricted General Knowledge)'}
          >
            <Brain className={`w-4 h-4 ${isRagEnabled ? 'text-purple-600 dark:text-purple-400' : ''}`} />
            <span className="text-[11px] font-extrabold">{isRagEnabled ? 'RAG ON' : 'Direct AI'}</span>
          </button>

          {/* Gemini-Style Live Web Search Toggle */}
          <button
            type="button"
            onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
            disabled={!activeSessionId || directUploading}
            className={`px-2.5 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1.5 text-xs font-black ${
              isWebSearchEnabled
                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
            }`}
            title={isWebSearchEnabled ? 'Live Web Search ON' : 'Turn Web Search ON'}
          >
            <Globe className={`w-4 h-4 ${isWebSearchEnabled ? 'animate-pulse text-blue-500 dark:text-blue-400' : ''}`} />
            <span className="text-[11px] font-extrabold">{isWebSearchEnabled ? 'Web ON' : 'Search'}</span>
          </button>
          
          {/* Single unified hidden file input — accepts ALL file types */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleDirectFileUpload}
            accept=".pdf,.csv,.xlsx,.docx,.pptx,.txt,.md,.xml,.py,.cpp,.h,.json,.yaml,.yml,.log,.html,.htm,.png,.jpg,.jpeg,.webp,.bmp,.tiff"
            multiple
            className="hidden"
          />

          {/* Recursive directory upload input — accepts entire folders and subfolders */}
          <input
            type="file"
            ref={folderInputRef}
            onChange={handleFolderUpload}
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
          />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              const isShortcut = e.ctrlKey || e.metaKey;
              if (isShortcut) {
                const allowedKeys = ['c', 'x', 'v', 'a', 'z', 'y', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
                if (allowedKeys.includes(e.key.toLowerCase()) || allowedKeys.includes(e.key)) {
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            onPaste={(e) => { e.stopPropagation(); }}
            onCopy={(e) => e.stopPropagation()}
            onCut={(e) => e.stopPropagation()}
            placeholder={
              activeSessionId
                ? 'Ask SMARAN AI...'
                : 'Start a new conversation'
            }
            disabled={!activeSessionId || streaming || directUploading}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-sm text-zinc-900 dark:text-zinc-200 font-semibold resize-none max-h-28 py-2 px-2"
          />
          <button
            type="submit"
            disabled={!activeSessionId || !input.trim() || streaming || directUploading}
            className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-850 text-[#1967d2] dark:text-[#8ab4f8] disabled:text-zinc-400 dark:disabled:text-zinc-650 rounded-full transition-colors cursor-pointer disabled:opacity-35 shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>

        </form>
      </div>

      {/* Sources Detail Modal */}
      {selectedRef && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 dark:bg-black/70 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="w-full sm:max-w-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[75vh]">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-55 dark:bg-zinc-900/30 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-zinc-950 dark:text-white flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-indigo-650 dark:text-indigo-400" />
                Context Source Reference Detail
              </h3>
              <button
                onClick={() => setSelectedRef(null)}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-sm flex-1 text-left font-bold">
              <div className="flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-850/85 p-3.5 rounded-2xl text-xs">
                <span className="text-zinc-900 dark:text-zinc-350">Document: {selectedRef.document_name}</span>
                <span className="text-indigo-700 dark:text-indigo-400 font-mono">RRF Rank Score: {selectedRef.rrf_score.toFixed(5)}</span>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-550 dark:text-zinc-500 font-black uppercase tracking-widest pl-1">Retrieved Segment Content</span>
                <div className="p-4 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl font-mono text-[11px] leading-relaxed text-zinc-950 dark:text-zinc-300 whitespace-pre-wrap select-text max-h-[350px] overflow-y-auto text-left">
                  {selectedRef.text}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/30 border-t border-zinc-200 dark:border-zinc-900 flex justify-end">
              <button
                onClick={() => setSelectedRef(null)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-500/10"
              >
                Close reference details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paste Excel Table Modal */}
      {isPasteTableOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <form onSubmit={handlePasteTableSubmit} className="w-full max-w-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-left">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-900/30 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-zinc-950 dark:text-white flex items-center gap-2">
                <BookOpen className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-500" />
                Paste Raw Excel Spreadsheet Data
              </h3>
              <button
                type="button"
                onClick={() => setIsPasteTableOpen(false)}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1 font-semibold text-xs">
              <div className="space-y-1">
                <label className="text-zinc-855 dark:text-zinc-300 block mb-1">Table File Title</label>
                <input
                  type="text"
                  id="pasteTableName"
                  name="pasteTableName"
                  required
                  placeholder="e.g. sales_reports_q4"
                  value={pasteTableName}
                  onChange={(e) => setPasteTableName(e.target.value)}
                  className="w-full border border-zinc-250 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-950 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-zinc-855 dark:text-zinc-300 block mb-1">Paste Excel Cells (Directly Ctrl+V)</label>
                <textarea
                  required
                  rows={8}
                  placeholder="Paste cells here... Columns will automatically parse by tabs"
                  value={pasteTableData}
                  onChange={(e) => setPasteTableData(e.target.value)}
                  className="w-full border border-zinc-250 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-950 dark:text-white resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/30 border-t border-zinc-200 dark:border-zinc-900 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsPasteTableOpen(false)}
                className="px-5 py-2.5 text-zinc-650 hover:bg-zinc-150 dark:text-zinc-400 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md"
              >
                Ingest Table Data
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChatArea;
