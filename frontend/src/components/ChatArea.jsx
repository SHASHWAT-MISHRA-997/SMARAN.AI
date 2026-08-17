import React, { useEffect, useRef, useState } from 'react';
import { Send, FileText, Check, Copy, ArrowDown, Bot, Sparkles, BookOpen, User, X, Upload, Plus, Database, LayoutDashboard, Globe, FolderPlus, Brain, Languages, UserCheck, Boxes, Trash2, Eye, Code2, Download, ExternalLink, RefreshCw, Cpu, Zap, Gauge, Timer, Activity, Shield } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { parseJsonResponse } from '../utils/api';
import { downloadProjectZip, downloadSingleFile } from '../utils/zip';
import ArtifactRenderer from './ArtifactRenderer';

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'hi', name: 'Hindi', native: 'हिंदी', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', flag: '🇮🇳' },
];

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

//  Think / Reasoning Block 
// Renders the AI's chain-of-thought in a collapsible glassmorphism panel.
const cleanPlainText = (value) => {
  let text = String(value || '');
  const score = (input) => (input.match(/[]/g) || []).length;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const repaired = decodeURIComponent(escape(text));
      if (score(repaired) >= score(text)) break;
      text = repaired;
    } catch (_) {
      break;
    }
  }
  return text.replace(/\*\*/g, '').replace(/__/g, '');
};

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

  //  Extract <think></think> reasoning blocks 
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

      const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imageMatch) {
        flushTable(lineIdx);
        flushList(lineIdx);
        const imageSrc = imageMatch[2].startsWith('/') ? `${API_BASE}${imageMatch[2]}` : imageMatch[2];
        elements.push(
          <a key={`image-${lineIdx}`} href={imageSrc} target="_blank" rel="noopener noreferrer"
            className="block my-4 max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl">
            <img src={imageSrc} alt={imageMatch[1] || 'Locally generated image'}
              className="w-full h-auto object-contain bg-zinc-100 dark:bg-zinc-950" loading="lazy" />
          </a>
        );
        return;
      }

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
  cleaned = cleaned.replace(/\\sqrt\{([^{}]+)\}/g, '($1)');
  cleaned = cleaned.replace(/\\text\{([^}]+)\}/g, '$1'); // Remove \text{...} wrappers
  cleaned = cleaned.replace(/\\times/g, '  ');
  cleaned = cleaned.replace(/\\div/g, '  ');
  cleaned = cleaned.replace(/\\pm/g, '  ');
  cleaned = cleaned.replace(/\\cdot/g, '  ');
  cleaned = cleaned.replace(/\\approx/g, '  ');
  cleaned = cleaned.replace(/\\neq/g, '  ');
  cleaned = cleaned.replace(/\\leq/g, '  ');
  cleaned = cleaned.replace(/\\geq/g, '  ');
  cleaned = cleaned.replace(/\\infty/g, '');
  cleaned = cleaned.replace(/\\rightarrow/g, '');
  cleaned = cleaned.replace(/\\sum/g, '');
  cleaned = cleaned.replace(/\\prod/g, '');
  cleaned = cleaned.replace(/\\int/g, '');
  
  // Greek Symbols & SI Units
  cleaned = cleaned.replace(/\\Delta/g, '');
  cleaned = cleaned.replace(/\\mu/g, '');
  cleaned = cleaned.replace(/\\alpha/g, '');
  cleaned = cleaned.replace(/\\beta/g, '');
  cleaned = cleaned.replace(/\\gamma/g, '');
  cleaned = cleaned.replace(/\\theta/g, '');
  cleaned = cleaned.replace(/\\pi/g, '');
  cleaned = cleaned.replace(/\\sigma/g, '');
  cleaned = cleaned.replace(/\\lambda/g, '');
  cleaned = cleaned.replace(/\\omega/g, '');
  cleaned = cleaned.replace(/\\phi/g, '');
  cleaned = cleaned.replace(/\\psi/g, '');
  cleaned = cleaned.replace(/\\eta/g, '');
  cleaned = cleaned.replace(/\\rho/g, '');
  cleaned = cleaned.replace(/\\tau/g, '');
  cleaned = cleaned.replace(/\\degC/g, 'C');
  cleaned = cleaned.replace(/\\degree/g, '');
  cleaned = cleaned.replace(/\\circ/g, '');
  cleaned = cleaned.replace(/\^\s*/g, '');
  
  // Fractions: \frac{num}{den} -> (num / den). Repeating handles common nested fractions.
  for (let i = 0; i < 4; i += 1) {
    const next = cleaned.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)');
    if (next === cleaned) break;
    cleaned = next;
  }
  
  // Superscripts & Subscripts
  const superscript = { '0': '', '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': '', '+': '', '-': '', '=': '', '(': '', ')': '', n: '', i: '' };
  const toSuperscript = (value) => [...value].map(char => superscript[char] || char).join('');
  cleaned = cleaned.replace(/\^\{([^}]+)\}/g, (_, value) => toSuperscript(value));
  cleaned = cleaned.replace(/\^2/g, '');
  cleaned = cleaned.replace(/\^3/g, '');
  cleaned = cleaned.replace(/\^x/g, '');
  cleaned = cleaned.replace(/\^n/g, '');
  
  // Clean backslashes, escape underscores, spaces
  cleaned = cleaned.replace(/\\([ _&%#${}])/g, '$1'); 
  cleaned = cleaned.replace(/\\/g, ''); 
  cleaned = cleaned.replace(/\*/g, '  ');
  
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
  const langLower = (language || '').toLowerCase();
  const isHtmlOrWeb = langLower === 'html' || langLower === 'htm' || langLower === 'svg' || langLower === 'xml' || /<!doctype html|<html|<body|<div|<script/i.test(code);
  const [viewMode, setViewMode] = useState(isHtmlOrWeb ? 'preview' : 'code');
  const [iframeKey, setIframeKey] = useState(0);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = () => {
    if (isHtmlOrWeb) {
      downloadProjectZip("smaran_web_project", [
        { name: "index.html", content: code },
        { name: "README.md", content: "# SMARAN.AI Generated Web Application\n\nDouble click `index.html` to run this web application in any browser!" }
      ]);
    } else {
      const ext = langLower === 'python' || langLower === 'py' ? 'py' : langLower === 'javascript' || langLower === 'js' ? 'js' : langLower === 'json' ? 'json' : langLower === 'css' ? 'css' : (langLower || 'txt');
      downloadProjectZip(`smaran_${langLower || 'app'}_project`, [
        { name: `app.${ext}`, content: code },
        { name: "README.md", content: `# SMARAN.AI Generated Project\n\nRun with your environment:\n\n\`\`\`bash\n# Example execution\n${ext === 'py' ? 'python app.py' : ext === 'js' ? 'node app.js' : ''}\n\`\`\`` }
      ]);
    }
  };

  const handleDownloadFile = () => {
    const ext = isHtmlOrWeb ? 'html' : langLower === 'python' || langLower === 'py' ? 'py' : langLower === 'javascript' || langLower === 'js' ? 'js' : langLower === 'json' ? 'json' : langLower === 'css' ? 'css' : (langLower || 'txt');
    downloadSingleFile(`smaran_app.${ext}`, code);
  };

  const handleOpenNewTab = () => {
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  };

  return (
    <div className="my-4 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 overflow-hidden bg-zinc-950 shadow-xl animate-in fade-in duration-200">
      {/* Code / Preview Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3.5 py-2 border-b border-zinc-850 bg-zinc-900/90 text-[11px] font-mono text-zinc-300 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-indigo-400 uppercase tracking-wider">{language || (isHtmlOrWeb ? 'HTML5 APP' : 'CODE')}</span>
          {isHtmlOrWeb && (
            <div className="flex items-center bg-zinc-800/90 rounded-lg p-0.5 border border-zinc-700/80">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  viewMode === 'preview' ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Live Preview</span>
              </button>
              <button
                onClick={() => setViewMode('code')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  viewMode === 'code' ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Reload Preview */}
          {isHtmlOrWeb && viewMode === 'preview' && (
            <button
              onClick={() => setIframeKey((k) => k + 1)}
              title="Reload preview"
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Open In New Tab */}
          {isHtmlOrWeb && (
            <button
              onClick={handleOpenNewTab}
              title="Open in full browser window"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-bold transition-all cursor-pointer border border-zinc-700"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="hidden sm:inline">New Tab</span>
            </button>
          )}

          {/* Download Project ZIP */}
          <button
            onClick={handleDownloadZip}
            title="Download complete project files as ZIP"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/40 text-[10px] font-bold transition-all cursor-pointer shadow-xs hover:scale-105"
          >
            <Download className="w-3 h-3" />
            <span>📦 Download ZIP</span>
          </button>

          {/* Copy Code */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-bold transition-all cursor-pointer border border-zinc-700"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Body: Live Iframe Sandbox or Code Editor */}
      {isHtmlOrWeb && viewMode === 'preview' ? (
        <div className="relative w-full bg-white dark:bg-zinc-900 min-h-[380px] max-h-[550px] overflow-hidden flex flex-col">
          <iframe
            key={iframeKey}
            srcDoc={code}
            title="SMARAN Live Interactive Artifact Preview"
            sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups"
            className="w-full h-[420px] border-0 bg-white"
          />
        </div>
      ) : (
        <pre className="p-4 overflow-x-auto font-mono text-[11px] text-zinc-300 leading-relaxed text-left whitespace-pre max-h-[500px]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
};

// Live pipeline step indicator shown while AI is processing
const THINKING_STEPS = [
  {
    icon: '🔍',
    title: 'Scanning Input & URL Detection',
    desc: 'Extracting video IDs, web links, and file metadata...',
    color: 'indigo',
  },
  {
    icon: '⚡',
    title: 'Fetching Live Web & Video Evidence',
    desc: 'Retrieving YouTube transcripts, subtitles, and website pages...',
    color: 'amber',
  },
  {
    icon: '🧠',
    title: 'Neural Model Inference Routing',
    desc: 'Querying vLLM / Ollama local neural weights in VRAM...',
    color: 'violet',
  },
  {
    icon: '✍️',
    title: 'Synthesizing Factual Response',
    desc: 'Generating accurate, grounded response token-by-token...',
    color: 'emerald',
  },
  {
    icon: '🛡️',
    title: 'Fact Grounding & Citation Audit',
    desc: 'Verifying evidence sources & formatting visual preview cards...',
    color: 'blue',
  },
];

const ThinkingIndicator = () => {
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const stepTimer = setInterval(() => {
      setStep((prev) => (prev < THINKING_STEPS.length - 1 ? prev + 1 : prev));
    }, 1500);
    const ticker = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => {
      clearInterval(stepTimer);
      clearInterval(ticker);
    };
  }, []);

  const current = THINKING_STEPS[step];
  const progress = (((step + 1) / THINKING_STEPS.length) * 100).toFixed(0);

  return (
    <div className="space-y-3 w-full max-w-[560px] my-4 text-left" aria-live="polite" aria-label="AI is processing">
      {/* Main status card with glowing border & glassmorphism */}
      <div className="flex items-start gap-3 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-50 via-white to-violet-50 dark:from-indigo-950/30 dark:via-zinc-900/60 dark:to-indigo-950/30 p-4 shadow-[0_0_30px_rgba(99,102,241,0.2)] backdrop-blur-md">
        {/* Glowing pulsing orb */}
        <span className="relative flex h-5 w-5 mt-0.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-5 w-5 rounded-full bg-gradient-to-tr from-amber-500 via-indigo-500 to-purple-500 shadow-sm" />
        </span>

        <div className="flex-1 min-w-0">
          {/* Step title */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-indigo-700 dark:text-indigo-200 leading-tight uppercase tracking-wider flex items-center gap-1.5">
              <span>{current.icon}</span>
              <span>{current.title}...</span>
            </p>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-700 dark:text-indigo-300 shrink-0">
              Step {step + 1}/{THINKING_STEPS.length}
            </span>
          </div>

          {/* Step description */}
          <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-400 mt-1 leading-snug">
            {current.desc}
          </p>

          {/* Animated Gradient Progress bar */}
          <div className="mt-3 h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800/80 overflow-hidden p-0.5 border border-zinc-300 dark:border-zinc-700/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500 transition-all duration-[1500ms] ease-out shadow-[0_0_10px_rgba(139,92,246,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Step count + live timer */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1.5 items-center">
              {THINKING_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full transition-all duration-300 ${
                    i < step
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                      : i === step
                      ? 'bg-amber-400 animate-pulse ring-2 ring-amber-400/40'
                      : 'bg-zinc-300 dark:bg-zinc-700/50'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] font-mono font-black text-amber-400/90 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
              {elapsed.toFixed(1)}s elapsed
            </span>
          </div>
        </div>

        {/* Live bouncing dots */}
        <span className="flex gap-1 mt-1 shrink-0" aria-hidden="true">
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.3s]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
          <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-400" />
        </span>
      </div>

      {/* Shimmer skeleton lines */}
      <div className="h-3 w-full rounded-full bg-gradient-to-r from-zinc-200 via-indigo-300/60 to-zinc-200 dark:from-zinc-800 dark:via-indigo-900/40 dark:to-zinc-800 animate-pulse" />
      <div className="h-3 w-[88%] rounded-full bg-gradient-to-r from-zinc-200 via-purple-300/60 to-zinc-200 dark:from-zinc-800 dark:via-purple-900/40 dark:to-zinc-800 animate-pulse" />
    </div>
  );
};

const MediaPreviewCard = ({ text }) => {
  if (!text || typeof text !== 'string') return null;

  // Detect ALL YouTube video IDs
  const ytRegex = /(?:youtube\.com\/(?:watch\?[^\s]*?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/gi;
  const videoIds = [];
  let m;
  while ((m = ytRegex.exec(text)) !== null) {
    if (!videoIds.includes(m[1])) videoIds.push(m[1]);
  }

  // Detect all Web URLs (excluding YouTube)
  const allUrls = text.match(/https?:\/\/[^\s<>\]\[\)\(]+/gi) || [];
  const webUrls = allUrls.filter(u => !u.includes('youtube.com') && !u.includes('youtu.be'));
  const cleanWebUrls = webUrls.map(u => u.replace(/[.,;:!?)]+$/, '')).filter((v, i, a) => a.indexOf(v) === i);

  if (videoIds.length === 0 && cleanWebUrls.length === 0) return null;

  return (
    <div className="mt-2 space-y-3 w-full max-w-none text-left">
      {videoIds.map((vid, idx) => (
        <div key={idx} className="w-full rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-950/30 via-zinc-950 to-zinc-900 overflow-hidden shadow-[0_0_25px_rgba(239,68,68,0.2)] transition-all hover:border-red-500/60">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-xs font-bold text-red-400">
            <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 font-extrabold text-[11px] shrink-0 shadow-xs">
              <svg className="w-4 h-4 text-red-500 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              YouTube Video {idx + 1}
            </span>
            <a
              href={`https://www.youtube.com/watch?v=${vid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-red-600 px-3 py-1 rounded-full bg-red-500/80 text-white font-extrabold text-[11px] flex items-center gap-1.5 shadow-md transition-all shrink-0 cursor-pointer"
            >
              Watch on YouTube ↗
            </a>
          </div>
          <div className="relative aspect-video w-full bg-black">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${vid}`}
              title={`YouTube Video Player ${idx + 1}`}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ))}

      {cleanWebUrls.length > 0 && (
        <div className="space-y-3 w-full max-w-none text-left">
          {cleanWebUrls.map((url, idx) => (
            <div key={idx} className="rounded-2xl border border-indigo-500/40 bg-gradient-to-br from-indigo-950/30 via-zinc-950 to-zinc-900 p-4 shadow-[0_0_25px_rgba(99,102,241,0.2)] transition-all hover:border-indigo-500/60">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(url).hostname; } catch(_) { return 'website'; } })()}&sz=64`}
                    alt="Website Favicon"
                    className="w-4 h-4 rounded shrink-0 bg-white p-0.5"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <span className="text-xs font-black text-indigo-400 truncate tracking-wide">
                    {(() => { try { return new URL(url).hostname; } catch(_) { return url; } })()}
                  </span>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11px] flex items-center gap-1.5 shadow-md transition-all shrink-0 cursor-pointer"
                >
                  Visit Website ↗
                </a>
              </div>
              <p className="text-xs text-zinc-300 font-mono truncate">
                {url}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

//  Per-message row with Gemini-style copy / re-use / delete actions 
const MessageRow = ({ msg, onReuse, onRefClick, onEdit, onDelete }) => {
  const [copied, setCopied] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(msg.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      {/* 3D AI Avatar Badge — self-start ensures no vertical stretching */}
      {msg.role !== 'user' && (
        <div className="relative shrink-0 self-start h-8 sm:h-9 mt-1 select-none group cursor-pointer">
          <div className={`absolute inset-0 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-amber-500 blur-[3px] transition-all duration-300 ${
            msg.isLoading ? 'animate-pulse opacity-100' : 'opacity-60 group-hover:opacity-100'
          }`} />
          <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-indigo-500/40 flex items-center justify-center shadow-[0_0_14px_rgba(99,102,241,0.35)] overflow-hidden">
            <span className="absolute w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping opacity-75" />
            <Bot className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-indigo-300 filter drop-shadow-[0_0_6px_rgba(99,102,241,0.8)]" />
          </div>
        </div>
      )}

      <div className={`flex flex-col min-w-0 ${
        msg.role === 'user' ? 'items-end max-w-[90%] sm:max-w-[620px]' : 'items-start w-full'
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
                <>
                  <p className="text-sm font-bold whitespace-pre-wrap leading-relaxed text-left">
                    {/* Parse out the  [Uploaded filename.png] text visual indicator to clean up bubble view if we rendered the image above */}
                    {msg.content.replace(/^\s*\[Uploaded\s+[^\]]+\]\s*/, '')}
                  </p>
                  <MediaPreviewCard text={msg.content} />
                </>
              )}
            </div>
          ) : (
            <>
              <MarkdownText text={msg.content} />

              {!msg.isLoading && msg.content && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-indigo-500/20 dark:border-indigo-500/30 bg-gradient-to-br from-indigo-50/80 via-white/80 to-purple-50/80 dark:from-zinc-950/90 dark:via-zinc-900/90 dark:to-indigo-950/40 select-none shadow-[0_8px_30px_-12px_rgba(99,102,241,0.3)] ring-1 ring-white/50 dark:ring-white/5 transition-all duration-300 w-full select-all p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-indigo-200/50 dark:border-zinc-800 pb-2">
                    <div className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      100% Genuine Execution Telemetry
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-500 dark:text-zinc-400 font-bold">
                      <span>
                        {telemetry?.cpu_name ? `Sync: ${telemetry.cpu_name.replace(/Processor|\(R\)|\(TM\)/gi, '').trim()}${telemetry?.gpu_name ? ` • ${telemetry.gpu_name}` : ''}` : (telemetry?.gpu_name ? `Sync: ${telemetry.gpu_name}` : 'Host Hardware Synced')}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 text-[10px] font-mono">
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">AI Model</span>
                      <span className="font-extrabold text-zinc-900 dark:text-zinc-100 truncate block mt-0.5" title={msg.model_used || msg.modelUsed || activeModelDisplay}>
                        {(msg.model_used || msg.modelUsed || activeModelDisplay || 'Local Model').split('/').pop()}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block">Speed</span>
                      <span className="font-extrabold text-emerald-700 dark:text-emerald-300 block mt-0.5">
                        {msg.tokensPerSec || msg.tokens_per_sec ? `${(msg.tokensPerSec || msg.tokens_per_sec).toFixed(1)} tok/s` : 'Real-time'}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider block">Response Time</span>
                      <span className="font-extrabold text-indigo-700 dark:text-indigo-300 block mt-0.5">
                        {msg.execution_time_sec ? `${msg.execution_time_sec}s` : (msg.responseTimeMs || msg.response_time_ms ? `${((msg.responseTimeMs || msg.response_time_ms) / 1000).toFixed(2)}s` : '0.4s')}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">Total Tokens</span>
                      <span className="font-extrabold text-zinc-900 dark:text-zinc-100 block mt-0.5">
                        {msg.tokenCount || msg.token_count || (msg.content ? msg.content.split(/\s+/).length : 0)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">Context</span>
                      <span className="font-extrabold text-zinc-900 dark:text-zinc-100 block mt-0.5">
                        {(() => {
                          const val = msg.total_context || msg.totalContext || msg.ctx_window || 32768;
                          const num = typeof val === 'number' ? val : (parseInt(val) || 32768);
                          return num >= 1000 ? `${(num / 1024).toFixed(0)}K` : `${num}`;
                        })()}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                      <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">Timestamp</span>
                      <span className="font-extrabold text-zinc-700 dark:text-zinc-300 block mt-0.5 truncate">
                        {msg.local_datetime || (msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : new Date().toLocaleTimeString())}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {msg.isLoading && <ThinkingIndicator />}

            </>
          )}
        </div>

        {/*  Gemini-style action bar  visible on row hover  */}
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

            {/* Delete message */}
            <button
              onClick={() => onDelete && onDelete(msg.id)}
              title="Delete this message"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-800 transition-all cursor-pointer select-none"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
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

const ChatArea = ({ token, activeSessionId, activeCollections, setActiveCollections, selectedModel, turboMode, onTogglePanel, onOpenModelHub, onOpenDeveloper }) => {
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
  // RAG Mode Toggle  Combination (RAG On / Direct AI Mode)
  const [isRagEnabled, setIsRagEnabled] = useState(true);
  // Model readiness  polling until model is downloaded
  const [modelStatus, setModelStatus] = useState({ ready: true, downloading: false, status_msg: '', display_name: '' });
  // Language selector - English, Hindi
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translatedResponse, setTranslatedResponse] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const translateTimerRef = useRef(null);

  // Real-time hardware telemetry and speed stats for Single Row Auto-Adjust Bar
  const [telemetry, setTelemetry] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchTelemetry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/telemetry`);
        if (res.ok && active) {
          const data = await res.json();
          setTelemetry(data);
        }
      } catch (_) {}
    };
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  // Auto-translate input text to selected language
  const autoTranslateInput = async (text) => {
    if (!text || selectedLanguage === 'en') return text;
    
    try {
      const targetLang = selectedLanguage;
      const sourceLang = 'auto';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data[0] && data[0][0] && data[0][0][0]) {
        return data[0][0][0];
      }
    } catch (e) {
      console.error('Auto-translate failed:', e);
    }
    return text;
  };

  const handleInputChange = async (e) => {
    const text = e.target.value;
    setInput(text);
    
    // Auto-translate if language is not English
    if (selectedLanguage !== 'en' && text.trim()) {
      if (translateTimerRef.current) {
        clearTimeout(translateTimerRef.current);
      }
      translateTimerRef.current = setTimeout(async () => {
        setIsTranslating(true);
        const translated = await autoTranslateInput(text);
        if (translated !== text) {
          setInput(translated);
        }
        setIsTranslating(false);
      }, 500);
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (translateTimerRef.current) {
        clearTimeout(translateTimerRef.current);
      }
    };
  }, []);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const streamingRef = useRef(false);
  const incomingQueueRef = useRef([]);
  const typewriterTimerRef = useRef(null);

  const getCloudRoutingPayload = () => {
    if (!selectedModel?.startsWith('cloud:')) return {};
    const [, provider, ...modelParts] = selectedModel.split(':');
    const model = modelParts.join(':');
    let apiKeys = {};
    let cachedModels = {};
    try { apiKeys = JSON.parse(localStorage.getItem('sm_cloud_api_keys') || '{}'); } catch (_) {}
    try { cachedModels = JSON.parse(localStorage.getItem('sm_cloud_provider_models') || '{}'); } catch (_) {}
    const isEligible = (providerId, modelId) => (
      providerId !== 'openrouter' || modelId === 'openrouter/free' || modelId.endsWith(':free')
    );
    const automaticFallback = localStorage.getItem('sm_cloud_auto_fallback') !== 'false';
    const manualOnlyProviders = new Set(['openai', 'anthropic', 'gemini']);
    const fallbacks = automaticFallback
      ? Object.entries(cachedModels).flatMap(([providerId, models]) =>
          (manualOnlyProviders.has(providerId) ? [] : (Array.isArray(models) ? models : []))
            .filter((modelId) => apiKeys[providerId] && isEligible(providerId, modelId))
            .map((modelId) => ({ provider: providerId, model: modelId, api_key: apiKeys[providerId] }))
        ).filter((route) => route.provider !== provider || route.model !== model).slice(0, 12)
      : [];
    return {
      cloud_provider: provider,
      cloud_model: model,
      cloud_api_key: apiKeys[provider] || '',
      cloud_fallbacks: fallbacks,
    };
  };

  const displayMap = {
    'auto': 'Auto (Smart Model Router)',
    'Qwen/Qwen3-4B-AWQ': 'Qwen 3 4B AWQ (Quantized)',
    'Qwen/Qwen3-4B': 'Qwen 3 4B (Full Precision)',
    'nvidia/Nemotron-Mini-4B-Instruct': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
    'nemotron-mini:4b': 'Nemotron-3 Nano 4B (NVIDIA Instruct)',
    'Qwen/Qwen3-8B': 'Qwen 3 8B (High Precision Reasoning)',
    'qwen3:8b': 'Qwen 3 8B (High Precision Reasoning)',
  };

  const resolveDisplayName = (modelId) => {
    if (!modelId) return activeModelDisplay;
    if (modelId === 'auto') return 'LOCAL · Auto Router';
    if (modelId.startsWith('cloud:')) {
      const [, provider, ...parts] = modelId.split(':');
      return `Cloud API · ${provider.toUpperCase()} · ${parts.join(':')}`;
    }
    const direct = displayMap[modelId];
    if (direct) return direct;
    const lowered = modelId.toLowerCase();
    if (lowered.includes('qwen3') && lowered.includes('4b')) return 'Qwen 3 4B AWQ (Quantized)';
    if (lowered.includes('qwen3') && lowered.includes('8b')) return 'Qwen 3 8B (High Precision Reasoning)';
    if (lowered.includes('nemotron')) return 'Nemotron-3 Nano 4B (NVIDIA Instruct)';
    if (lowered.includes('phi-3.5') || lowered.includes('phi3.5')) return 'Phi-3.5 Vision 4.2B (Microsoft Vision)';
    if (lowered.includes('phi-3') || lowered.includes('phi3')) return 'Phi-3 Mini 3.8B (Microsoft Instruct)';
    if (lowered.includes('llama')) return 'Llama 3.1 8B (Core)';
    return modelId;
  };

  useEffect(() => {
    setActiveModelDisplay(resolveDisplayName(selectedModel));
  }, [selectedModel]);

  useEffect(() => {
    if (lastUsedModel && lastUsedModel !== selectedModel) {
      setActiveModelDisplay(resolveDisplayName(lastUsedModel));
    }
  }, [lastUsedModel]);

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
            // Model is ready  stop polling
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

  const handleClearCurrentChat = async () => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    const confirmed = window.confirm("Clear all messages in this conversation?");
    if (!confirmed) return;
    try {
      await fetch(`${API_BASE}/api/chat/sessions/${activeSessionId}/messages`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages([]);
    } catch (err) {
      console.error('Failed to clear messages on backend:', err);
      setMessages([]);
    }
  };

  const handleDeleteMessage = async (msgId) => {
    if (!msgId) return;
    try {
      await fetch(`${API_BASE}/api/chat/messages/${msgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Failed to delete message on backend:', err);
    }
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };


  const fetchUploadedFiles = async (collectionIds = activeCollections) => {
    // CRITICAL: Never show files if there is no active session.
    // Without a session_id filter the backend returns ALL documents across all
    // sessions  which causes old uploaded files to reappear after chat history
    // is deleted or when a new session is being created.
    if (!token || !activeSessionId || collectionIds.length === 0) {
      setUploadedFiles([]);
      return;
    }
    try {
      const allDocs = [];
      for (const colId of collectionIds) {
        // Always pass session_id  only files uploaded in THIS session are shown.
        const url = `${API_BASE}/api/collections/${colId}/documents?session_id=${activeSessionId}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const docs = await parseJsonResponse(res);
          allDocs.push(...docs);
        }
      }
      
      const uniqueDocs = Array.from(
        new Map(allDocs.map((doc) => [doc.id, doc])).values()
      ).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
      setUploadedFiles(uniqueDocs);
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
      setIsWebSearchEnabled(false);
      // Add collection to search contexts if not checked
      const nextActiveCollections = activeCollections.includes(targetCollectionId)
        ? activeCollections
        : [...activeCollections, targetCollectionId];
      if (nextActiveCollections !== activeCollections) {
        setActiveCollections(nextActiveCollections);
      }
      // Refresh visible session-file chips after every successful upload, including the first Quick Upload.
      await fetchUploadedFiles(nextActiveCollections);
      
      setDirectUploadMessage(` Successfully parsed and indexed ${files.length} document(s)!`);
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
    
    // Ignore build artifacts, virtual environments, and system VCS directories
    const IGNORED_DIR_PATTERNS = [
      '/node_modules/', '/.git/', '/.venv/', '/venv/', '/__pycache__/', 
      '/dist/', '/build/', '/.next/', '/.idea/', '/.vscode/', '/.pytest_cache/',
      '/data/', '/SMARAN.AI_Release/', '/brain/', '/.antigravity/', '/out/', '/coverage/'
    ];
    const FORBIDDEN_EXTS = [
      '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.dmg', '.pkg', '.deb', '.rpm', '.class', '.pyc', '.pyo', '.o', '.a', '.lib', '.obj', '.zip', '.tar', '.gz', '.7z', '.rar', '.gguf'
    ];

    const validFiles = files.filter(file => {
      if (!file || file.size === 0) return false;
      const relPath = '/' + (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      if (IGNORED_DIR_PATTERNS.some(pat => relPath.includes(pat))) return false;
      
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (FORBIDDEN_EXTS.includes(ext)) return false;
      return true;
    });

    if (validFiles.length === 0) {
      alert("No valid files found in the selected folder.");
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

    // 2. Upload each file sequentially while preserving relative subfolder path
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const relativePath = file.webkitRelativePath || file.name;
      setDirectUploadMessage(`Ingesting folder files: ${i + 1} of ${validFiles.length} ("${relativePath}")...`);
      
      const formData = new FormData();
      formData.append('file', file, relativePath);
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
        console.error(`Failed to upload ${relativePath}:`, err);
      }
    }

    // Update session collections context if not active
    if (!activeCollections.includes(targetCollectionId)) {
      setActiveCollections([...activeCollections, targetCollectionId]);
    } else {
      fetchUploadedFiles();
    }

    setDirectUploadMessage(` Successfully ingested ${uploadedCount} of ${validFiles.length} files from folder!`);
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
      formData.append('session_id', activeSessionId);

      const uploadRes = await fetch(`${API_BASE}/api/collections/${targetCollectionId}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (uploadRes.ok) {
        if (!activeCollections.includes(targetCollectionId)) {
        setActiveCollections([...activeCollections, targetCollectionId]);
      }
      // Refresh visible session-file chips after every successful upload, including the first Quick Upload.
      await fetchUploadedFiles();
        setDirectUploadMessage(` Successfully ingested table "${fileName}"!`);
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
              collections: isRagEnabled ? activeCollections : [],
              model: selectedModel,
              turbo: turboMode,
              web_search: isWebSearchEnabled,
              rag_enabled: isRagEnabled,
              ...getCloudRoutingPayload(),
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
                              responseTimeMs: parsed.response_time_ms,
                              tokensPerSec: parsed.tokens_per_sec || msg.tokensPerSec,
                              model_used: parsed.model_routed || msg.model_used,
                              execution_source: parsed.execution_source || msg.execution_source,
                              local_datetime: parsed.local_datetime,
                            }
                          : msg
                      )
                    );
                    // Push live speed+latency into telemetry ribbon immediately
                    if (parsed.response_time_ms || parsed.tokens_per_sec) {
                      const inferenceData = {
                        tokens_per_sec: parsed.tokens_per_sec || 0,
                        response_time_ms: parsed.response_time_ms || 0,
                        avg_tokens_per_sec: parsed.tokens_per_sec || 0,
                        total_tokens: parsed.token_count || 0,
                      };
                      setTelemetry(prev => ({
                        ...prev,
                        ...inferenceData,
                        total_tokens: (prev?.total_tokens || 0) + (parsed.token_count || 0),
                      }));
                      window.dispatchEvent(new CustomEvent('smaran-inference-update', { detail: { ...inferenceData, total_tokens: inferenceData.total_tokens } }));
                    }
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

    if (translateTimerRef.current) {
      clearTimeout(translateTimerRef.current);
    }
    setIsTranslating(false);

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

    let accumulatedResponse = '';
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
          rag_enabled: isRagEnabled,
          target_language: selectedLanguage === 'en' ? undefined : selectedLanguage,
          ...getCloudRoutingPayload(),
        }),
      });

      if (!res.ok) {
        const errorBody = await parseJsonResponse(res);
        throw new Error(errorBody?.detail || `Server returned an error (${res.status})`);
      }


      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
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
                          tokensPerSec: parsed.tokens_per_sec || msg.tokensPerSec,
                          execution_time_sec: parsed.execution_time_sec || msg.execution_time_sec
                        } 
                      : msg
                  )
                );
                // Push live speed+latency into telemetry ribbon immediately
                const inferenceData2 = {
                  tokens_per_sec: parsed.tokens_per_sec || 0,
                  response_time_ms: parsed.response_time_ms || 0,
                  avg_tokens_per_sec: parsed.tokens_per_sec || 0,
                  total_tokens: parsed.token_count || 0,
                };
                setTelemetry(prev => ({
                  ...prev,
                  ...inferenceData2,
                  total_tokens: (prev?.total_tokens || 0) + (parsed.token_count || 0),
                }));
                window.dispatchEvent(new CustomEvent('smaran-inference-update', { detail: { ...inferenceData2 } }));
              }
              if (parsed.translated_response && selectedLanguage !== 'en') {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: parsed.translated_response, originalContent: parsed.original_response || accumulatedResponse }
                      : msg
                  )
                );
                accumulatedResponse = parsed.translated_response;
                if (typewriterTimerRef.current) {
                  clearInterval(typewriterTimerRef.current);
                  typewriterTimerRef.current = null;
                }
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
                const visibleError = `Request failed: ${parsed.error}`;
                accumulatedResponse += visibleError;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: accumulatedResponse, isLoading: false }
                      : msg
                  )
                );
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
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current);
        typewriterTimerRef.current = null;
      }
      if (incomingQueueRef.current.length > 0) {
        accumulatedResponse += incomingQueueRef.current.join('');
        incomingQueueRef.current = [];
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: accumulatedResponse || msg.content, isLoading: false }
            : msg
        )
      );
      setStreaming(false);
      streamingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-[#0c0c0e]/40 relative overflow-hidden transition-colors duration-300">
      {/* Background glows  clamped so they never cause horizontal scroll */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[45%] left-[55%] -translate-x-1/2 -translate-y-1/2 w-[400px] sm:w-[700px] h-[400px] sm:h-[700px] rounded-full blur-[120px] sm:blur-[160px] animate-drift-1 bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,rgba(139,92,246,0.18)_40%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(79,70,229,0.2)_0%,rgba(139,92,246,0.3)_40%,transparent_70%)]" />
        <div className="absolute top-[30%] left-[25%] w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full blur-[80px] sm:blur-[120px] animate-drift-2 bg-[radial-gradient(circle,rgba(59,130,246,0.08)_0%,rgba(6,182,212,0.1)_50%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(30,58,138,0.18)_0%,rgba(15,118,110,0.15)_50%,transparent_70%)]" />
        <div className="absolute bottom-[15%] right-[20%] w-[250px] sm:w-[400px] h-[250px] sm:h-[400px] rounded-full blur-[90px] sm:blur-[130px] animate-drift-1 bg-[radial-gradient(circle,rgba(236,72,153,0.06)_0%,rgba(168,85,247,0.08)_50%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(236,72,153,0.12)_0%,rgba(168,85,247,0.18)_50%,transparent_70%)]" />
      </div>

      {/* 3D Glowing Top Engine Banner */}
      <div className="px-4 sm:px-6 py-2.5 sm:py-3 bg-white/80 dark:bg-zinc-950/60 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800/80 flex flex-row items-center justify-between text-[11px] sm:text-xs text-zinc-800 dark:text-zinc-300 select-none font-bold transition-all duration-300 gap-3 overflow-hidden shrink-0 relative z-10 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex items-center justify-center shrink-0">
            <span className="absolute w-3 h-3 rounded-full bg-indigo-500 animate-ping opacity-75" />
            <Sparkles className="relative w-4 h-4 text-indigo-600 dark:text-indigo-400 filter drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
          </div>
          <div className="flex items-center gap-2 truncate">
            <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[10px] sm:text-xs uppercase tracking-wider">AI Engine:</span>
            <span className="relative inline-flex items-center px-2.5 py-1 rounded-xl bg-indigo-50 dark:bg-gradient-to-r dark:from-zinc-900 dark:via-indigo-950/40 dark:to-zinc-900 border border-indigo-200 dark:border-indigo-500/40 text-indigo-950 dark:text-white font-extrabold font-mono text-[10px] sm:text-xs shadow-xs hover:border-indigo-400 transition-all cursor-pointer">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse mr-1.5" />
              {activeModelDisplay}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Clear Current Chat */}
          {messages.length > 0 && (
            <button
              onClick={handleClearCurrentChat}
              title="Clear current conversation"
              className="p-2 rounded-xl bg-orange-50 dark:bg-zinc-900 hover:bg-orange-100 dark:hover:bg-rose-950/50 border border-orange-200 dark:border-zinc-800 text-orange-600 dark:text-rose-400 hover:text-orange-700 dark:hover:text-rose-300 shadow-xs hover:scale-105 transition-all cursor-pointer flex items-center gap-1.5 font-bold text-xs"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline text-[11px]">Clear Chat</span>
            </button>
          )}

          {/* Performance Panel Toggle */}
          {onTogglePanel && (
            <button
              onClick={onTogglePanel}
              title="Toggle Performance Panel"
              className="p-2 rounded-xl bg-indigo-50 dark:bg-zinc-900 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 shadow-xs hover:scale-105 transition-all cursor-pointer flex items-center gap-1.5 font-bold text-xs"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden md:inline text-[11px]">Performance</span>
            </button>
          )}
        </div>
      </div>

      {/* Single Row Real-Time Hardware & Speed Telemetry Ribbon (Auto-adjusts with panel) */}
      <div className="w-full px-3 sm:px-6 py-1 bg-white/70 dark:bg-zinc-950/40 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/60 flex items-center justify-between gap-2 sm:gap-4 overflow-x-auto no-scrollbar font-mono text-[10px] sm:text-[11px] select-none shrink-0 z-10 transition-all duration-300">
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 flex-wrap sm:flex-nowrap">
          {/* Real Processor / CPU */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-300 font-bold" title={telemetry?.cpu_name || 'CPU'}>
            <Cpu className="w-3 h-3 text-orange-500 shrink-0" />
            <span className="truncate max-w-[130px] sm:max-w-[200px]">{telemetry?.cpu_name ? telemetry.cpu_name.replace(/with Radeon Graphics|Processor|\(R\)|\(TM\)/gi, '').trim() : 'Processor'}</span>
            <span className="text-orange-600 dark:text-orange-400 font-black">{telemetry?.cpu_usage !== undefined ? `${telemetry.cpu_usage.toFixed(0)}%` : '--'}</span>
          </div>

          {/* Real GPU */}
          {telemetry?.gpu_available && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 font-bold" title={telemetry?.gpu_name || 'GPU'}>
              <Zap className="w-3 h-3 text-purple-500 shrink-0" />
              <span className="truncate max-w-[100px] sm:max-w-[150px]">{telemetry?.gpu_name ? telemetry.gpu_name.replace(/NVIDIA GeForce|AMD Radeon|\(TM\)/gi, '').trim() : 'GPU'}</span>
              <span className="text-purple-600 dark:text-purple-400 font-black">{telemetry?.gpu_usage !== undefined ? `${telemetry.gpu_usage.toFixed(0)}%` : '--'}</span>
            </div>
          )}

          {/* Real RAM */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold">
            <LayoutDashboard className="w-3 h-3 text-cyan-500 shrink-0" />
            <span>RAM</span>
            <span className="text-cyan-600 dark:text-cyan-400 font-black">
              {telemetry?.memory_used_gb ? `${telemetry.memory_used_gb.toFixed(1)}/${telemetry.memory_total_gb ? telemetry.memory_total_gb.toFixed(0) : '?'}GB` : `${telemetry?.memory_usage?.toFixed(0) || '--'}%`}
            </span>
          </div>
        </div>

        {/* Inference Speed & Response Time */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Token / sec */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs">
            <Gauge className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline">Speed:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-black">
              {telemetry?.tokens_per_sec > 0 ? `${telemetry.tokens_per_sec} tok/s` : 'Ready'}
            </span>
          </div>

          {/* Response Latency */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 font-bold">
            <Timer className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="hidden sm:inline">Latency:</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-black">
              {telemetry?.response_time_ms ? `${(telemetry.response_time_ms / 1000).toFixed(2)}s` : '0.0s'}
            </span>
          </div>
        </div>
      </div>

      {/* Model Downloading Banner  shown when AI model is still being pulled */}
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
                {modelStatus.status_msg || 'AI Model is downloading  please wait...'}
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
            
            {/* Animated Gradient Icon  hidden on very small screens to save space */}
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
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">.AI</span>
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-md mx-auto font-semibold">
                Meet SMARAN.AI, your personal AI assistant.
              </p>
            </div>

            {/* Prompt Cards  single col on mobile, 2-col on sm+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 md:gap-4 w-full select-none">
              {[
                {
                  title: "🎥 YouTube Video Intelligence",
                  subtitle: "Extract video transcript, key timestamps, visual context, and ask anything about the video.",
                  prompt: "Explain what happens inside this YouTube video: https://youtu.be/B1PUBlhd9Yg",
                  icon: "▶",
                  gradient: "from-red-500/20 via-orange-500/20 to-amber-500/20 dark:from-red-500/15 dark:to-amber-500/15",
                  borderHover: "hover:border-red-500/50 dark:hover:border-red-500/40",
                  glowHover: "hover:shadow-[0_0_30px_rgba(239,68,68,0.25)]"
                },
                {
                  title: "🌐 Real-Time Web & Website Scraper",
                  subtitle: "Analyze live web page URLs, portfolio sites, documentation, or search internet facts.",
                  prompt: "Analyze the content of this portfolio website: https://shashwatmishra-portfolio.netlify.app/",
                  icon: "🌐",
                  gradient: "from-blue-500/20 via-cyan-500/20 to-teal-500/20 dark:from-blue-500/15 dark:to-teal-500/15",
                  borderHover: "hover:border-cyan-400/50 dark:hover:border-cyan-500/40",
                  glowHover: "hover:shadow-[0_0_30px_rgba(6,182,212,0.25)]"
                },
                {
                  title: "📄 Deep RAG Document Intelligence",
                  subtitle: "Query complex PDF invoices, Word docs, Excel BoMs, or multi-page technical manuals.",
                  prompt: "Summarize the key findings, data tables, and metrics across all uploaded documents in this chat.",
                  icon: "📊",
                  gradient: "from-emerald-500/20 via-teal-500/20 to-indigo-500/20 dark:from-emerald-500/15 dark:to-indigo-500/15",
                  borderHover: "hover:border-emerald-400/50 dark:hover:border-emerald-500/40",
                  glowHover: "hover:shadow-[0_0_30px_rgba(16,185,129,0.25)]"
                },
                {
                  title: "🧠 AI Memory & Model Matrix",
                  subtitle: "Store persistent user preferences, compare vLLM vs Ollama models, and run multi-agent reasoning.",
                  prompt: "What long-term memory facts do you have stored about me, and which AI inference engine is active right now?",
                  icon: "🧠",
                  gradient: "from-purple-500/20 via-indigo-500/20 to-pink-500/20 dark:from-purple-500/15 dark:to-pink-500/15",
                  borderHover: "hover:border-purple-400/50 dark:hover:border-purple-500/40",
                  glowHover: "hover:shadow-[0_0_30px_rgba(168,85,247,0.25)]"
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
                onDelete={handleDeleteMessage}
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
        <div className="max-w-4xl mx-auto px-6 py-2 select-none animate-in fade-in slide-in-from-bottom-1 duration-200 text-left">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              Active Session Files ({uploadedFiles.length})
            </span>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Remove all active files from this chat session?")) return;
                for (const f of uploadedFiles) {
                  await handleDeleteUploadedFile(f.id);
                }
              }}
              className="text-[10px] font-bold text-rose-500 hover:text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              Clear All Files
            </button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
            {uploadedFiles.map((f) => (
              <div
                key={f.id}
                title={f.name}
                className="flex items-center gap-2 px-3 py-1 bg-[#f0f4f9] dark:bg-[#2f2f30] border border-zinc-200/60 dark:border-zinc-800/80 rounded-full text-xs font-semibold text-zinc-850 dark:text-zinc-200 hover:border-indigo-500/40 transition-all"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-[#8ab4f8] shrink-0" />
                <span className="max-w-[200px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteUploadedFile(f.id)}
                  className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                  title="Delete file from database"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Box Console */}
      <div className="px-2 sm:px-5 pb-3 sm:pb-5 pt-1 bg-transparent shrink-0 relative z-10 w-full max-w-full">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 bg-gradient-to-r from-zinc-100/95 via-white/90 to-indigo-50/80 dark:from-zinc-950/95 dark:via-zinc-900/95 dark:to-indigo-950/45 border border-indigo-300/60 dark:border-indigo-500/35 rounded-2xl sm:rounded-[30px] p-2 sm:px-4 sm:py-2 shadow-[0_14px_35px_-18px_rgba(99,102,241,0.75)] focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/35 focus-within:shadow-[0_0_38px_rgba(99,102,241,0.38)] transition-all w-full overflow-hidden">
          
          {/* Mobile Top Toolbar (Strictly inside input box) */}
          <div className="flex sm:hidden items-center justify-between gap-1 pb-1.5 border-b border-indigo-200/40 dark:border-zinc-800/80 w-full">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeSessionId || directUploading}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-md transition-colors cursor-pointer disabled:opacity-35 shrink-0"
                title="Attach Files"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={!activeSessionId || directUploading}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-indigo-600 dark:text-indigo-400 rounded-md transition-colors cursor-pointer disabled:opacity-35 shrink-0"
                title="Upload Folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsPasteTableOpen(true)}
                disabled={!activeSessionId || directUploading}
                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-emerald-600 dark:text-emerald-500 rounded-md transition-colors cursor-pointer disabled:opacity-35 shrink-0"
                title="Paste Table"
              >
                <BookOpen className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsRagEnabled(!isRagEnabled)}
                disabled={!activeSessionId || directUploading}
                className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1 text-[9px] font-black ${
                  isRagEnabled
                    ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/40'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                }`}
                title="Toggle RAG Document Grounding"
              >
                <Brain className="w-3 h-3" />
                <span>{isRagEnabled ? 'RAG' : 'Direct'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                disabled={!activeSessionId || directUploading}
                className={`px-1.5 py-0.5 rounded-md transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1 text-[9px] font-black ${
                  isWebSearchEnabled
                    ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                }`}
                title="Toggle Live Web Search"
              >
                <Globe className={`w-3 h-3 ${isWebSearchEnabled ? 'animate-pulse text-blue-500' : ''}`} />
                <span>{isWebSearchEnabled ? 'Web' : 'Off'}</span>
              </button>
            </div>

            {/* Mobile Language Selector */}
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="text-[9px] font-bold text-zinc-700 dark:text-zinc-200 bg-white/80 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md px-1.5 py-0.5 outline-none shrink-0"
              title="Response Language"
            >
              <option value="en">EN</option>
              <option value="hi">HI</option>
              <option value="gu">GU</option>
              <option value="pa">PA</option>
              <option value="mr">MR</option>
              <option value="ta">TA</option>
              <option value="te">TE</option>
              <option value="ml">ML</option>
              <option value="kn">KN</option>
            </select>
          </div>

          {/* Desktop Left Action Buttons (Exact original desktop single row) */}
          <div className="hidden sm:flex items-center gap-1 shrink-0">
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

            {/* RAG Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsRagEnabled(!isRagEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`px-2.5 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1.5 text-xs font-black ${
                isRagEnabled
                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/40 shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
              title={isRagEnabled ? 'RAG Document Grounding ON' : 'Direct AI Mode'}
            >
              <Brain className={`w-4 h-4 ${isRagEnabled ? 'text-purple-600 dark:text-purple-400' : ''}`} />
              <span className="text-[11px] font-extrabold">{isRagEnabled ? 'RAG ON' : 'Direct AI'}</span>
            </button>

            {/* Live Web Search Toggle */}
            <button
              type="button"
              onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`px-2.5 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1.5 text-xs font-black ${
                isWebSearchEnabled
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
              title={isWebSearchEnabled ? 'Live Web Search ON' : 'Live Web Search OFF'}
            >
              <Globe className={`w-4 h-4 ${isWebSearchEnabled ? 'animate-pulse text-blue-500 dark:text-blue-400' : ''}`} />
              <span className="text-[11px] font-extrabold">{isWebSearchEnabled ? 'Web ON' : 'Web OFF'}</span>
            </button>
          </div>
          
          {/* Single unified hidden file input accepts ALL file types */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleDirectFileUpload}
            accept=".pdf,.csv,.tsv,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.markdown,.xml,.rst,.adoc,.rtf,.ipynb,.py,.js,.jsx,.ts,.tsx,.c,.cpp,.cc,.cxx,.h,.hpp,.cs,.java,.kt,.kts,.go,.rs,.php,.rb,.swift,.m,.mm,.sh,.bash,.zsh,.bat,.cmd,.ps1,.sql,.r,.scala,.dart,.lua,.pl,.json,.jsonc,.json5,.yaml,.yml,.toml,.ini,.env,.conf,.config,.properties,.log,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.avi,.mkv,.webm,.mov,.flv,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.gif,.svg"
            multiple
            className="hidden"
          />

          {/* Recursive directory upload input accepts entire folders and subfolders */}
          <input
            type="file"
            ref={folderInputRef}
            onChange={handleFolderUpload}
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
          />

          {/* Main Input Textarea Row */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 w-full min-w-0">
            <textarea
              value={input}
              onChange={handleInputChange}
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
                  ? isWebSearchEnabled
                    ? 'Search and ask the live web...'
                    : isRagEnabled
                      ? 'Ask from uploaded files only...'
                      : 'Ask SMARAN.AI directly...'
                  : 'Start a new conversation'
              }
              disabled={!activeSessionId || streaming || directUploading}
              rows={1}
              className="flex-1 w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-xs sm:text-sm text-zinc-900 dark:text-zinc-200 font-semibold resize-none max-h-28 py-1 sm:py-2 px-1 sm:px-2 min-w-0"
            />

            {isTranslating && (
              <span className="text-[10px] text-indigo-500 animate-pulse shrink-0">Translating...</span>
            )}

            {/* Desktop Language Selector (Hidden on mobile because it is in mobile toolbar) */}
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="hidden sm:block response-language-select text-[10px] font-extrabold text-zinc-700 dark:text-zinc-200 bg-gradient-to-r from-white to-indigo-50 dark:from-zinc-900 dark:to-indigo-950/70 border border-indigo-300/80 dark:border-indigo-500/45 rounded-2xl px-3 py-2 outline-none cursor-pointer shrink-0 transition-all duration-300 hover:border-violet-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:shadow-[0_0_22px_rgba(99,102,241,0.38)] hover:-translate-y-0.5 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/35"
              title="Response Language"
            >
              <option value="en">English (EN)</option>
              <option value="hi">Hindi (HI)</option>
              <option value="gu">Gujarati (GU)</option>
              <option value="pa">Punjabi (PA)</option>
              <option value="mr">Marathi (MR)</option>
              <option value="ta">Tamil (TA)</option>
              <option value="te">Telugu (TE)</option>
              <option value="ml">Malayalam (ML)</option>
              <option value="kn">Kannada (KN)</option>
            </select>

            {/* Send Button */}
            <button
              type="submit"
              disabled={!activeSessionId || !input.trim() || streaming || directUploading}
              className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-white bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 disabled:from-zinc-300 disabled:to-zinc-400 dark:disabled:from-zinc-700 dark:disabled:to-zinc-800 rounded-full shadow-[0_0_18px_rgba(139,92,246,0.38)] hover:shadow-[0_0_28px_rgba(139,92,246,0.62)] hover:scale-105 sm:hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none shrink-0"
              title="Send Message"
            >
              <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 translate-x-[1.5px] -translate-y-[0.5px]" />
            </button>
          </div>

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
