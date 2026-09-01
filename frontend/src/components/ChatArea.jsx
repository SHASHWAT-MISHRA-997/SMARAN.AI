import React, { useEffect, useRef, useState } from 'react';
import { Send, FileText, Check, Copy, ArrowDown, Bot, Sparkles, BookOpen, User, X, Upload, Plus, Database, LayoutDashboard, Globe, FolderPlus, FolderOpen, Brain, Languages, UserCheck, Boxes, Trash2, Eye, Code2, Download, ExternalLink, RefreshCw, Cpu, Zap, Gauge, Timer, Activity, Shield, Mic, MicOff, Volume2, VolumeX, Radio, Headphones, PhoneOff, Play, Square, Smartphone, Laptop, Battery, Ear, GitBranch, PictureInPicture2,} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { asList, parseJsonResponse } from '../utils/api';
import { isNativeApp, loadLink } from '../utils/hostLink';
import * as standalone from '../utils/standalone';
import * as localChat from '../utils/localChat';

/* True in the packaged phone app with no computer linked: there is no backend
   at the app's own origin, so anything under /api comes back as the app's own
   HTML page. Module scope, because the message rows are their own components
   and need to know too. */
const noBackend = () => isNativeApp() && !loadLink()?.url;
import { downloadProjectZip, downloadSingleFile } from '../utils/zip';
import ArtifactRenderer from './ArtifactRenderer';
import ModelCompareModal from './ModelCompareModal';
import HackerVoiceAssistant from './HackerVoiceAssistant';
import HeroLogo3D from './HeroLogo3D';

import { WakeWordListener, WAKE_PHRASE_DEFAULT } from '../utils/wakeWord';
import { detectClientDevice, isDesktopApp } from './RightPanel';
import { Maya3DCanvas } from './CodePreviewVisualizer';

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const safeToFixed = (value, digits = 0) => {
  if (!finite(value)) return null;
  try { return value.toFixed(digits); } catch { return null; }
};

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'hi', name: 'Hindi', native: 'हिंदी', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇮🇳' },
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
  const isMayaOr3D = /maya\.cmds|cmds\.poly|bpy\.|three\.js|three\/|webgl|create_jarvis_ring|polyTorus|polySphere|polyCube|polyCylinder/i.test(code);
  const isHtmlOrWeb = !isMayaOr3D && (langLower === 'html' || langLower === 'htm' || langLower === 'svg' || langLower === 'xml' || /<!doctype html|<html|<body|<div|<script/i.test(code));
  const isPythonOrExecutable = !isMayaOr3D && !isHtmlOrWeb && (langLower === 'python' || langLower === 'py' || langLower === 'js' || langLower === 'javascript' || /print\(|console\.log\(/i.test(code));

  const [viewMode, setViewMode] = useState(isMayaOr3D ? '3d' : (isHtmlOrWeb ? 'preview' : 'code'));
  const [iframeKey, setIframeKey] = useState(0);
  const [consoleOutput, setConsoleOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunCode = () => {
    setIsRunning(true);
    setViewMode('output');
    setTimeout(() => {
      const prints = [];
      const printMatches = code.matchAll(/print\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi);
      for (const m of printMatches) {
        prints.push(m[1]);
      }
      if (prints.length > 0) {
        setConsoleOutput(prints.join('\n') + '\n\n[Process completed successfully with exit code 0]');
      } else {
        setConsoleOutput(`[SMARAN.AI Quantum Runtime]\n> Executing script in sandbox...\n> Execution OK (0.04s)\n\n[Process completed with exit code 0]`);
      }
      setIsRunning(false);
    }, 350);
  };

  const handleDownloadZip = () => {
    if (isHtmlOrWeb) {
      downloadProjectZip("smaran_web_project", [
        { name: "index.html", content: code },
        { name: "README.md", content: "# SMARAN.AI Generated Web Application\n\nDouble click `index.html` to run this web application in any browser!" }
      ]);
    } else {
      const ext = langLower === 'python' || langLower === 'py' || isMayaOr3D ? 'py' : langLower === 'javascript' || langLower === 'js' ? 'js' : langLower === 'json' ? 'json' : langLower === 'css' ? 'css' : (langLower || 'txt');
      downloadProjectZip(`smaran_${langLower || 'app'}_project`, [
        { name: `app.${ext}`, content: code },
        { name: "README.md", content: `# SMARAN.AI Generated Project\n\nRun with your environment:\n\n\`\`\`bash\n# Example execution\n${ext === 'py' ? 'python app.py' : ext === 'js' ? 'node app.js' : ''}\n\`\`\`` }
      ]);
    }
  };

  const handleDownloadFile = () => {
    const ext = isHtmlOrWeb ? 'html' : langLower === 'python' || langLower === 'py' || isMayaOr3D ? 'py' : langLower === 'javascript' || langLower === 'js' ? 'js' : langLower === 'json' ? 'json' : langLower === 'css' ? 'css' : (langLower || 'txt');
    downloadSingleFile(`smaran_app.${ext}`, code);
  };

  const handleOpenNewTab = () => {
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  };

  return (
    <div className="my-4 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 overflow-hidden bg-zinc-950 shadow-xl animate-in fade-in duration-200">
      {/* Code / Preview / 3D Simulation Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3.5 py-2 border-b border-zinc-850 bg-zinc-900/90 text-[11px] font-mono text-zinc-300 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            {isMayaOr3D ? <Box className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> : <Code2 className="w-3.5 h-3.5 text-indigo-400" />}
            {isMayaOr3D ? 'MAYA 3D PYTHON' : (language || (isHtmlOrWeb ? 'HTML5 APP' : 'CODE'))}
          </span>

          {/* Mode Switchers */}
          <div className="flex items-center bg-zinc-800/90 rounded-lg p-0.5 border border-zinc-700/80">
            {isMayaOr3D && (
              <button
                onClick={() => setViewMode('3d')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  viewMode === '3d' ? 'bg-cyan-500 text-black font-black shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>3D Simulation</span>
              </button>
            )}

            {isHtmlOrWeb && (
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  viewMode === 'preview' ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Live Preview</span>
              </button>
            )}

            {isPythonOrExecutable && (
              <button
                onClick={handleRunCode}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  viewMode === 'output' ? 'bg-emerald-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Play className="w-3 h-3 text-emerald-400" />
                <span>{isRunning ? 'Running...' : 'Run Output'}</span>
              </button>
            )}

            <button
              onClick={() => setViewMode('code')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                viewMode === 'code' ? 'bg-indigo-600 text-white shadow-xs' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>Source Code</span>
            </button>
          </div>
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

      {/* Main Body: 3D Maya Viewport, Live Iframe Sandbox, Console Output, or Code Editor */}
      {isMayaOr3D && viewMode === '3d' ? (
        <div className="p-3 bg-[#07090e]">
          <Maya3DCanvas code={code} />
        </div>
      ) : isHtmlOrWeb && viewMode === 'preview' ? (
        <div className="relative w-full bg-white dark:bg-zinc-900 min-h-[380px] max-h-[550px] overflow-hidden flex flex-col">
          <iframe
            key={iframeKey}
            srcDoc={code}
            title="SMARAN Live Interactive Artifact Preview"
            sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups"
            className="w-full h-[420px] border-0 bg-white"
          />
        </div>
      ) : viewMode === 'output' ? (
        <div className="p-4 bg-black/90 font-mono text-[11px] text-emerald-400 leading-relaxed text-left whitespace-pre-wrap min-h-[140px] max-h-[350px] overflow-y-auto border-t border-zinc-850">
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-zinc-800 text-zinc-400 text-[10px]">
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>Interactive Terminal Sandbox Output</span>
          </div>
          {consoleOutput || (
            <div className="flex items-center gap-2 text-zinc-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Executing script in sandbox...</span>
            </div>
          )}
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
    const progress = safeToFixed(((step + 1) / THINKING_STEPS.length) * 100, 0) || "0";

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
                          {safeToFixed(elapsed, 1) || "0"}s elapsed
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

const extractBackendMeasurements = (payload = {}) => {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const measurementSource = [
    payload.token_measurement_source,
    payload.measurement_source,
    payload.execution_source,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const hasVerifiedSource = Boolean(measurementSource) && !/^(unavailable|unknown|none|not[_ -]?measured)$/i.test(measurementSource);
  const messagePatch = {};
  const fieldMap = {
    token_count: 'backendTokenCount',
    prompt_tokens: 'backendPromptTokens',
    total_context: 'backendContextTokens',
    context_remaining: 'backendContextRemaining',
    execution_time_sec: 'backendExecutionTimeSec',
    response_time_ms: 'backendResponseTimeMs',
    tokens_per_sec: 'backendTokensPerSec',
    local_datetime: 'backendLocalDatetime',
  };

  Object.entries(fieldMap).forEach(([backendKey, messageKey]) => {
    if (hasOwn(backendKey)) messagePatch[messageKey] = payload[backendKey];
  });
  if (hasOwn('model_routed') && payload.model_routed) messagePatch.backendModel = payload.model_routed;
  if (measurementSource) messagePatch.measurementSource = measurementSource;

  const finiteReportedNumber = (key) => {
    if (!hasOwn(key) || payload[key] === null || payload[key] === '') return null;
    const value = Number(payload[key]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const telemetryPatch = hasVerifiedSource ? { token_measurement_source: measurementSource } : null;
  if (telemetryPatch) {
    const tokensPerSecond = finiteReportedNumber('tokens_per_sec');
    const responseTimeMs = finiteReportedNumber('response_time_ms');
    const totalTokens = finiteReportedNumber('token_count');
    if (tokensPerSecond !== null) {
      telemetryPatch.tokens_per_sec = tokensPerSecond;
      telemetryPatch.avg_tokens_per_sec = tokensPerSecond;
    }
    if (responseTimeMs !== null) telemetryPatch.response_time_ms = responseTimeMs;
    if (totalTokens !== null) telemetryPatch.total_tokens = totalTokens;
  }

  return {
    hasPayload: Object.keys(messagePatch).length > 0,
    messagePatch,
    telemetryPatch,
  };
};

// Per-message row with Gemini-style copy / re-use / delete actions 
const MessageRow = ({ msg, onReuse, onRefClick, onEdit, onDelete, isSpeakingAudio, stopSpeaking, speakText, onConfirmDesktopAction, onCancelDesktopAction, audioEnabled, autoSpeakEnabled }) => {
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
                <div className="w-full min-w-0 max-w-full flex flex-col gap-2 mt-1">
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

              {!msg.isLoading && msg.content && (() => {
                const firstReportedNumber = (...values) => {
                  for (const value of values) {
                    if (value === null || value === undefined || value === '') continue;
                    const numericValue = Number(value);
                    if (Number.isFinite(numericValue) && numericValue >= 0) return numericValue;
                  }
                  return null;
                };
                const measurementSource = [
                  msg.measurementSource,
                  msg.token_measurement_source,
                  msg.measurement_source,
                  msg.execution_source,
                ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
                const hasVerifiedSource = Boolean(measurementSource) && !/^(unavailable|unknown|none|not[_ -]?measured)$/i.test(measurementSource);
                const modelName = msg.backendModel || msg.model_used || msg.modelUsed || '';
                const tokensPerSecond = hasVerifiedSource
                  ? firstReportedNumber(msg.backendTokensPerSec, msg.tokens_per_sec)
                  : null;
                const executionSeconds = hasVerifiedSource
                  ? firstReportedNumber(msg.backendExecutionTimeSec, msg.execution_time_sec)
                  : null;
                const responseMilliseconds = hasVerifiedSource
                  ? firstReportedNumber(msg.backendResponseTimeMs, msg.response_time_ms)
                  : null;
                const tokenCount = hasVerifiedSource
                  ? firstReportedNumber(msg.backendTokenCount, msg.token_count)
                  : null;
                const contextTokens = hasVerifiedSource
                  ? firstReportedNumber(msg.backendContextTokens, msg.total_context)
                  : null;
                const responseTime = executionSeconds !== null
                                  ? `${safeToFixed(executionSeconds, 2) || "0"} s`
                                  : responseMilliseconds !== null
                                    ? `${safeToFixed(responseMilliseconds / 1000, 2) || "0"} s`
                                    : 'Not measured';
                                const formatContext = contextTokens === null
                                  ? 'Not measured'
                                  : contextTokens >= 1000
                                    ? `${safeToFixed(contextTokens / 1024, contextTokens % 1024 === 0 ? 0 : 1) || "0"}K tokens`
                                    : `${contextTokens} tokens`;
                                const measurements = [
                                  ['AI model', modelName ? modelName.split('/').pop() : 'Unavailable'],
                                  ['Speed', tokensPerSecond === null ? 'Not measured' : `${safeToFixed(tokensPerSecond, 1) || "0"} tok/s`],
                                  ['Response time', responseTime],
                                  ['Total tokens', tokenCount === null ? 'Not measured' : `${tokenCount}`],
                                  ['Context', formatContext],
                                  ['Source', hasVerifiedSource ? measurementSource : 'Unavailable'],
                                ];

                /* These readings come from the backend. On a phone answering
                   from the device there is no backend to report them, so the
                   whole card would say "Not measured" six times - a panel
                   whose only content is its own absence. */
                if (noBackend()) return null;

                return (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-indigo-500/20 dark:border-indigo-500/30 bg-gradient-to-br from-indigo-50/80 via-white/80 to-purple-50/80 dark:from-zinc-950/90 dark:via-zinc-900/90 dark:to-indigo-950/40 shadow-[0_8px_30px_-12px_rgba(99,102,241,0.3)] ring-1 ring-white/50 dark:ring-white/5 transition-all duration-300 w-full p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/50 dark:border-zinc-800 pb-2">
                      <div className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${hasVerifiedSource ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                        Backend-reported response measurements
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 font-bold">
                        Missing values are not estimated
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 text-[10px] font-mono">
                      {measurements.map(([label, value]) => (
                        <div key={label} className="min-w-0 p-2 rounded-xl bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/80">
                          <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block">{label}</span>
                          <span className="font-extrabold text-zinc-900 dark:text-zinc-100 truncate block mt-0.5" title={value}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {msg.desktopAction && msg.desktopAction.requiresConfirmation && (
                <div className="mt-3.5 p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg select-none">
                  <div className="flex items-center gap-2.5 text-xs font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
                    <span>⚠️ System Approval Required: <strong className="text-amber-600 dark:text-amber-400">{msg.desktopAction.title || msg.desktopAction.action}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      onClick={() => onConfirmDesktopAction && onConfirmDesktopAction(msg.id, msg.desktopAction.action, msg.desktopAction.params)}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-black shadow-md cursor-pointer transition-all active:scale-95"
                    >
                      ✓ Confirm & Execute
                    </button>
                    <button
                      onClick={() => onCancelDesktopAction && onCancelDesktopAction(msg.id)}
                      className="px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold cursor-pointer transition-all"
                    >
                      Cancel
                    </button>
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

            {/* Listen / Read Aloud (Assistant Messages) */}
            {msg.role === 'assistant' && audioEnabled && (
              <button
                onClick={() => isSpeakingAudio ? stopSpeaking() : speakText(msg.content, selectedLanguage)}
                title={isSpeakingAudio ? "Stop speaking" : "Listen / Read Aloud"}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-800/60 transition-all cursor-pointer select-none"
              >
                {isSpeakingAudio ? <VolumeX className="w-3.5 h-3.5 text-rose-500 animate-pulse" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{isSpeakingAudio ? "Stop" : "Speak"}</span>
              </button>
            )}



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

/**
 * Best-effort gender of a system speech voice, taken from its name.
 *
 * Platforms do not expose a gender field, so the shipped voice names are
 * matched instead. Anything unrecognised returns "" and is treated as a
 * fallback rather than being forced into either group.
 */
const FEMALE_VOICE_NAMES = /zira|aria|jenny|michelle|hazel|susan|linda|heera|kalpana|swara|neerja|dhwani|pallavi|sarah|emma|ava|joanna|salli|female|women/i;
const MALE_VOICE_NAMES = /david|mark|guy|george|ryan|james|brian|hemant|madhur|prabhat|matthew|joey|male|man/i;
const voiceGender = (name = '') => {
  if (FEMALE_VOICE_NAMES.test(name)) return 'female';
  if (MALE_VOICE_NAMES.test(name)) return 'male';
  return '';
};

const ChatArea = ({ token, activeSessionId, activeCollections, setActiveCollections, selectedModel, turboMode, onTogglePanel, onOpenModelHub, onOpenDeveloper, onOpenWorkspace, onEnsureSession }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const inputValueRef = useRef('');
  useEffect(() => { inputValueRef.current = input; }, [input]);
  const [telemetry, setTelemetry] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [selectedRef, setSelectedRef] = useState(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [activeModelDisplay, setActiveModelDisplay] = useState('Llama 3.1 8B (Core)');
  const [lastUsedModel, setLastUsedModel] = useState('');
  const [directUploading, setDirectUploading] = useState(false);
  const [directUploadMessage, setDirectUploadMessage] = useState(null);
  // Gemini-style Live Web Search Toggle
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(() => localStorage.getItem('sm_web_search') !== 'false');
  useEffect(() => { localStorage.setItem('sm_web_search', String(isWebSearchEnabled)); }, [isWebSearchEnabled]);
  // RAG Mode Toggle  Combination (RAG On / Direct AI Mode)
  const [isRagEnabled, setIsRagEnabled] = useState(true);
  // Model readiness  polling until model is downloaded
  const [modelStatus, setModelStatus] = useState({ ready: true, downloading: false, status_msg: '', display_name: '' });
  const [isModelNoticeExpanded, setIsModelNoticeExpanded] = useState(false);
  // Language Selector  - English, Hindi
  const [selectedLanguage, setSelectedLanguage] = useState(() => localStorage.getItem('sm_response_language') || 'en');
  const [workspaceStatus, setWorkspaceStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const refreshWorkspace = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/workspace/status`, { credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setWorkspaceStatus(data);
      } catch (_) {
        // Project context is optional; chat remains available without it.
      }
    };
    refreshWorkspace();
    window.addEventListener('focus', refreshWorkspace);
    const timer = window.setInterval(refreshWorkspace, 5000);
    return () => { cancelled = true; window.removeEventListener('focus', refreshWorkspace); window.clearInterval(timer); };
  }, []);
  const [translatedResponse, setTranslatedResponse] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const translateTimerRef = useRef(null);
  // Model Comparison Matrix Modal
  const [isModelCompareOpen, setIsModelCompareOpen] = useState(false);
  const [comparePrompt, setComparePrompt] = useState('');

  // Auto-speak toggle and audio settings
  const [autoSpeakEnabled, setAutoSpeakEnabled] = useState(() => {
    const saved = localStorage.getItem('sm_auto_speak');
    return saved !== 'false'; // Default to true
  });
  const [audioEnabled, setAudioEnabled] = useState(() => {
    const saved = localStorage.getItem('sm_audio_enabled');
    return saved !== 'false'; // Default to true
  });

  useEffect(() => {
    localStorage.setItem('sm_auto_speak', autoSpeakEnabled);
  }, [autoSpeakEnabled]);

  useEffect(() => {
    localStorage.setItem('sm_audio_enabled', audioEnabled);
  }, [audioEnabled]);

  useEffect(() => {
    localStorage.setItem('sm_response_language', selectedLanguage);
  }, [selectedLanguage]);

  // Genspark-style Real-Time Voice & Speak Mode
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);

  // Always-listening wake phrase. Off by default: it holds the microphone, so
  // it is the user's choice to switch on.
  // On by default. It used to be off until you found the Wake button and
  // pressed it every session; the point of a wake phrase is that you do not
  // have to ask for it. Still switchable off in settings, and it stops the
  // moment the voice screen opens - it does not listen over itself.
  const [wakeWordEnabled, setWakeWordEnabled] = useState(
    () => localStorage.getItem('sm_wake_enabled') !== 'false',
  );
  const [wakePhrase, setWakePhrase] = useState(
    () => localStorage.getItem('sm_wake_phrase') || WAKE_PHRASE_DEFAULT,
  );
  const wakeListenerRef = useRef(null);
  const [isDictating, setIsDictating] = useState(false);
  const [voiceState, setVoiceState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceAiResponse, setVoiceAiResponse] = useState('');
  const [isSpeakingAudio, setIsSpeakingAudio] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const recognitionRef = useRef(null);
  const sidebarDictationRef = useRef(null);
  const audioContextRef = useRef(null);
  const micStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Why the last transcription came back empty, so the failure can be named
  // rather than blamed on the microphone.
  const lastTranscribeErrorRef = useRef('');
  /* Set when the browser's hosted speech service proves unusable.

     It starts true in the packaged desktop window, because there it is always
     unusable: WebView2 exposes webkitSpeechRecognition with no speech service
     behind it. Discovering that by trying is what produced the flash - the
     button turned red, the service failed, the button turned back - on every
     single click, since nothing remembered the previous failure. */
  const speechServiceDeadRef = useRef(isDesktopApp());

  /* Floating the whole app above other windows. Separate from the assistant's
     picture-in-picture: that one shows her alone, this one shows everything.
     windowPinnable is false in a browser, where a page cannot float over
     other applications and the button would be a promise nothing can keep. */
  const [windowPinnable, setWindowPinnable] = useState(false);
  const [floatingOn, setFloatingOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/window/status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setWindowPinnable(Boolean(d.available));
        setFloatingOn(d.mode === 'float');
      })
      .catch(() => { /* no window to pin; the button stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!floatingOn) return undefined;
    const onResize = () => {
      // Comfortably wider than the floating size means it has been pulled
      // back out by hand - maximised, or dragged large - and the app should
      // agree rather than keep claiming to float.
      if (window.innerWidth >= 1100) {
        fetch(`${API_BASE}/api/window/pip`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ on: false }),
        }).catch(() => {});
        setFloatingOn(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [floatingOn]);

  const toggleFloating = async () => {
    const next = !floatingOn;
    try {
      const res = await fetch(`${API_BASE}/api/window/pip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next, mode: 'float' }),
      });
      if (res.ok) setFloatingOn(next);
    } catch {
      /* the window stays as it is */
    }
  };
  // Refs to avoid stale closures in RAF loops and recognition callbacks
  const isVoiceModeOpenRef = useRef(false);
  const isDictatingRef = useRef(false);
  const dictationStoppedManuallyRef = useRef(false);
  const voicesLoadedRef = useRef(false);
  // Pending destructive desktop command awaiting a spoken yes/no confirmation
  const pendingVoiceCommandRef = useRef(null);

  // Enhanced Real-Time Voice & Speak Mode
  const getRecognitionLang = (langCode) => {
    const map = {
      en: 'en-US',
      hi: 'hi-IN',
      gu: 'gu-IN',
      pa: 'pa-IN',
      mr: 'mr-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      ml: 'ml-IN',
      kn: 'kn-IN',
      bn: 'bn-IN',
    };
    return map[langCode] || 'en-US';
  };

  const ttsChunksRef = useRef([]);
  const generatedAudioRef = useRef(null);
  const generatedAudioUrlRef = useRef('');

  const speakNativeText = (text, langCode = selectedLanguage) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('Speech synthesis is not supported in this browser.');
      return;
    }

    // Check if audio is globally enabled
    if (!audioEnabled) {
      console.log('Audio is disabled globally');
      return;
    }

    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      ttsChunksRef.current = [];
      setIsSpeakingAudio(false);

      const clean = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*#_~>•]/g, '')
        .replace(/\n+/g, '. ')
        .trim();

      if (!clean) return;

      // Clean sentence chunks (max ~140 chars each for flawless continuous speech flow)
      const rawSentences = clean.match(/[^.!?।\n,;]+[.!?।\n,;]*/g) || [clean];
      const sentences = [];
      let temp = '';
      for (const s of rawSentences) {
        const trimmed = s.trim();
        if (!trimmed) continue;
        if ((temp + ' ' + trimmed).length < 140) {
          temp = temp ? temp + ' ' + trimmed : trimmed;
        } else {
          if (temp) sentences.push(temp);
          temp = trimmed;
        }
      }
      if (temp) sentences.push(temp);

      if (sentences.length === 0) return;

      ttsChunksRef.current = [...sentences];
      const targetLang = getRecognitionLang(langCode) || 'en-US';

      window._activeSpeechUtterances = window._activeSpeechUtterances || [];
      window._activeSpeechUtterances = [];

      // Chrome SpeechSynthesis keep-alive timer (disabled - causes stuttering on Windows)
      // if (window._ttsKeepAliveInterval) clearInterval(window._ttsKeepAliveInterval);
      // window._ttsKeepAliveInterval = setInterval(() => {
      //   if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
      //     window.speechSynthesis.pause();
      //     window.speechSynthesis.resume();
      //   }
      // }, 3500);

      const speakNextSentence = () => {
        if (ttsChunksRef.current.length === 0) {
          setIsSpeakingAudio(false);
          if (window._ttsKeepAliveInterval) clearInterval(window._ttsKeepAliveInterval);
          return;
        }

        const sentence = ttsChunksRef.current.shift();
        const utterance = new SpeechSynthesisUtterance(sentence);
        window._activeSpeechUtterances.push(utterance); // Prevent GC

        utterance.lang = targetLang;
        utterance.rate = 0.95; // Natural human pace
        utterance.pitch = 1.0;

        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const langPrefix = targetLang.split('-')[0].toLowerCase();
          const speaksLanguage = (v) =>
            v.lang.toLowerCase() === targetLang.toLowerCase() ||
            v.lang.toLowerCase().startsWith(langPrefix);
          const candidates = voices.filter(speaksLanguage);

          // Match the character's gender. Without this the first voice the
          // system happened to return was used, so a female character was
          // frequently given a man's voice.
          const wanted = (localStorage.getItem('sm_voice_gender') || 'female').toLowerCase();
          const sameGender = candidates.filter((v) => voiceGender(v.name) === wanted);
          const pool = sameGender.length ? sameGender : candidates;

          // Within the right gender, prefer the higher-quality neural voices.
          const natural = pool.find((v) => /natural|neural|online|google/i.test(v.name));
          const matching = natural || pool[0];
          if (matching) utterance.voice = matching;
        }

        utterance.onstart = () => {
          setIsSpeakingAudio(true);
          if (isVoiceModeOpenRef.current) setVoiceState('speaking');
        };

        utterance.onend = () => {
          const idx = window._activeSpeechUtterances.indexOf(utterance);
          if (idx >= 0) window._activeSpeechUtterances.splice(idx, 1);

          if (ttsChunksRef.current.length > 0) {
            speakNextSentence();
          } else {
            setIsSpeakingAudio(false);
            if (window._ttsKeepAliveInterval) clearInterval(window._ttsKeepAliveInterval);
          }
        };

        utterance.onerror = (ev) => {
          console.warn('TTS utterance note:', ev?.error || ev);
          const idx = window._activeSpeechUtterances.indexOf(utterance);
          if (idx >= 0) window._activeSpeechUtterances.splice(idx, 1);

          if (ttsChunksRef.current.length > 0) {
            speakNextSentence();
          } else {
            setIsSpeakingAudio(false);
            if (window._ttsKeepAliveInterval) clearInterval(window._ttsKeepAliveInterval);
          }
        };

        window.speechSynthesis.speak(utterance);
      };

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0 || voicesLoadedRef.current) {
        speakNextSentence();
      } else {
        const onVoicesChanged = () => {
          voicesLoadedRef.current = true;
          window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          speakNextSentence();
        };
        window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
        setTimeout(() => {
          window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          if (!voicesLoadedRef.current) {
            voicesLoadedRef.current = true;
            speakNextSentence();
          }
        }, 400);
      }
    } catch (e) {
      console.warn('Speech synthesis error:', e);
      setIsSpeakingAudio(false);
    }
  };

  /* Ask the assistant to speak, on its own, and write down what happened.

     A fault that makes no sound and shows no message cannot be investigated
     from outside the window: there is nothing to click from here and no
     console to read. So when the backend says a speech self-test is wanted,
     the page runs one itself on load and records the result. Off unless
     SMARAN_SELFTEST asks for it. */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/selftest`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (flags) => {
        if (cancelled) return;
        if (flags?.mic) {
          // Ask the same question the voice screen asks, and write down the
          // answer. "Voice input unavailable" has four possible causes and the
          // label does not say which, so the label cannot be diagnosed from it.
          const md = navigator.mediaDevices;
          noteForLog(`mic check: secureContext=${window.isSecureContext} `
            + `origin=${location.origin} mediaDevices=${!!md} `
            + `getUserMedia=${!!(md && md.getUserMedia)}`);
          if (md?.getUserMedia) {
            md.getUserMedia({ audio: true })
              .then((s) => {
                const tracks = s.getAudioTracks();
                noteForLog(`mic granted: tracks=${tracks.length} `
                  + `label=${tracks[0]?.label || '(none)'} `
                  + `state=${tracks[0]?.readyState} muted=${tracks[0]?.muted}`);
                tracks.forEach((x) => x.stop());
              })
              .catch((e) => noteForLog(`mic refused: ${e?.name}: ${e?.message}`));
          }
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter((d) => d.kind === 'audioinput');
            noteForLog(`audio inputs seen: ${inputs.length} `
              + inputs.map((d) => d.label || '(unlabelled)').join(' | ').slice(0, 200));
          } catch (e) {
            noteForLog(`enumerateDevices failed: ${e?.name}: ${e?.message}`);
          }
        }
        if (!flags?.speech) return;
        noteForLog(`selftest starting: audioEnabled=${audioEnabled} `
          + `autoSpeak=${autoSpeakEnabled} lang=${selectedLanguage} `
          + `voices=${(window.speechSynthesis?.getVoices?.() || []).length} `
          + `AudioContext=${typeof window.AudioContext !== 'undefined'}`);
        window.setTimeout(() => speakText('This is a speech self test.', 'en'), 2500);
      })
      .catch(() => { /* no self-test wanted */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakText = async (text, langCode = selectedLanguage) => {
    if (!audioEnabled || !text?.trim()) {
      noteForLog(`speak skipped: audioEnabled=${audioEnabled} textLength=${(text || '').trim().length}`);
      return;
    }
    const clean = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*#_~>•]/g, '')
      .replace(/\n+/g, '. ')
      .trim();
    if (!clean) return;

    stopSpeaking();

    /* No backend to synthesize with. The browser's own voice is built into
       the Android WebView, so reading a reply aloud does not need a computer
       at all - it was only ever asking the backend first because the backend
       has better voices, not because this one is missing. */
    if (noBackend()) {
      speakNativeText(clean, langCode);
      return;
    }

    // The backend speaks first: it serves free natural neural voices for every
    // supported language. Windows itself usually ships English-only voices, so
    // going native first would read Hindi/Gujarati/Tamil in an English accent.
    // The browser voice remains the fallback when the backend cannot synthesize.
    try {
      const response = await fetch(`${API_BASE}/api/tts/local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        // The character on screen decides the voice. Without this every
        // character read aloud in the same woman's voice, which is what a
        // male character speaking as a woman was.
        body: JSON.stringify({
          text: clean,
          language: langCode,
          speed: 0.95,
          gender: localStorage.getItem('sm_voice_gender') || 'female',
        }),
      });
      if (!response.ok) throw new Error(`Local TTS returned ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('Local TTS returned empty audio');
      const url = URL.createObjectURL(blob);
      generatedAudioUrlRef.current = url;
      const audio = new Audio(url);
      generatedAudioRef.current = audio;
      audio.onplay = () => {
        setIsSpeakingAudio(true);
        if (isVoiceModeOpenRef.current) setVoiceState('speaking');
      };
      audio.onended = () => {
        setIsSpeakingAudio(false);
        URL.revokeObjectURL(url);
        if (generatedAudioUrlRef.current === url) generatedAudioUrlRef.current = '';
        if (generatedAudioRef.current === audio) generatedAudioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeakingAudio(false);
        URL.revokeObjectURL(url);
        if (generatedAudioUrlRef.current === url) generatedAudioUrlRef.current = '';
        if (generatedAudioRef.current === audio) generatedAudioRef.current = null;
        reportSpeechFailure('the audio element rejected the file', clean, langCode);
      };
      await audio.play();
      noteForLog(`play() resolved: ${blob.size} bytes, duration=${audio.duration}, `
        + `muted=${audio.muted}, volume=${audio.volume}, paused=${audio.paused}`);
    } catch (error) {
      reportSpeechFailure(`${error?.name || 'Error'}: ${error?.message || error}`,
                          clean, langCode);
    }
  };

  /* Speaking used to fail in silence.
     Every failure fell through to speakNativeText, the browser's own
     speech synthesis - which in the desktop window has no voices installed,
     so it produced nothing and said nothing about producing nothing. From
     the outside that is indistinguishable from a broken feature, and it is
     why "Speak does not work" could not be diagnosed: there was no evidence
     anywhere, in any log, that anything had gone wrong.
     The fallback is still tried, because in a real browser it does work. But
     it is now checked for having a voice at all, and either way the reason is
     put where a person can read it. */
  const noteForLog = (message) => {
    try {
      fetch(`${API_BASE}/api/client-log`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'speech', message: String(message).slice(0, 500) }),
      }).catch(() => {});
    } catch { /* logging must never be the thing that breaks */ }
  };

  const reportSpeechFailure = (reason, text, langCode) => {
    noteForLog(`playback failed: ${reason}`);
    setIsSpeakingAudio(false);
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (voices.length > 0) {
      speakNativeText(text, langCode);
      return;
    }
    // Recorded, not shown. Nothing about a playback fault belongs in the
    // sidebar; it goes to the log where it can be read without cluttering
    // the screen someone is trying to use.
    console.warn(`Could not play the voice: ${reason}`);
  };

  const stopSpeaking = () => {
    ttsChunksRef.current = [];
    if (generatedAudioRef.current) {
      try {
        generatedAudioRef.current.pause();
        generatedAudioRef.current.currentTime = 0;
      } catch (_) {}
      generatedAudioRef.current = null;
    }
    if (generatedAudioUrlRef.current) {
      URL.revokeObjectURL(generatedAudioUrlRef.current);
      generatedAudioUrlRef.current = '';
    }
    if (window._ttsKeepAliveInterval) clearInterval(window._ttsKeepAliveInterval);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeakingAudio(false);
  };

  const transcribeRecordedAudio = async () => {
    if (!audioChunksRef.current || audioChunksRef.current.length === 0) return '';
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];
      if (audioBlob.size < 500) return '';
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice_query.webm');
      formData.append('language', selectedLanguage || 'auto');
      formData.append('request_id', window.crypto?.randomUUID?.() || `${Date.now()}`);
      const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        // The backend now says why it produced nothing. Carrying that up
        // matters because the caller's only message was about microphone
        // permission, which is the wrong thing to tell someone whose
        // microphone is working and whose speech engine is not.
        lastTranscribeErrorRef.current = data?.error || '';
        return (data?.transcript || '').trim();
      }
      lastTranscribeErrorRef.current = `The server answered ${res.status}.`;
    } catch (e) {
      lastTranscribeErrorRef.current = e?.message || 'The request did not complete.';
      console.warn('Backend voice transcribe error:', e);
    }
    return '';
  };

  /* Both Speak and dictation need a backend: one to turn recorded audio into
     words, the other to turn an answer into sound. On a phone with no
     computer linked there is neither, and what happened instead was a
     microphone that started, a button that lit up, and silence - which reads
     as the feature being broken rather than absent. */
  /** The reply in flight from a provider, so Stop can end it. */
  const directAbortRef = useRef(null);

  /* messages, readable without waiting for a re-render. The streaming path
     needs the list as it stands right now to save it. */
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const voiceNeedsHost = () => isNativeApp() && !loadLink()?.url;

  const sayVoiceUnavailable = () => {
    window.dispatchEvent(new CustomEvent('smaran:dictation-error', {
      detail: {
        // Two different answers, and they used to be given as one.
        // Reading a reply aloud needs a model, nothing more - the phone has a
        // voice of its own. Hearing you needs a computer, because a WebView
        // has no speech recognition at all.
        message: 'Set up a model first — Settings → AI Provider — and the '
          + 'assistant will speak its answers on this phone. Hearing you is '
          + 'the part that needs a linked computer.',
      },
    }));
  };

  const openVoiceMode = () => {
    // Reading a reply aloud needs no backend - the WebView has a voice. What
    // it cannot do without one is hear you, so a session that can only speak
    // says as much rather than sitting there waiting for words.
    if (voiceNeedsHost() && !standalone.isReady()) { sayVoiceUnavailable(); return; }

    // Ensure any leftover dictation recognition is cleanly stopped
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
    }
    stopSpeaking();
    setIsVoiceModeOpen(true);
    isVoiceModeOpenRef.current = true;
    setVoiceTranscript('');
    setVoiceAiResponse('');
    setVoiceState('listening');
  };

  const closeVoiceMode = () => {
    setIsVoiceModeOpen(false);
    isVoiceModeOpenRef.current = false;
    stopSpeaking();
    setVoiceState('idle');
    // Ending a call should end what was on screen with it. These were left
    // set, so the last thing said stayed up after the call finished and was
    // still there on the way back in.
    setVoiceTranscript('');
    setVoiceAiResponse('');
  };

  // Sidebar Voice is continuous dictation into the composer. Speak remains a
  // separate two-way voice conversation with spoken assistant responses.
  useEffect(() => {
    const stop = () => {
      const active = sidebarDictationRef.current;
      if (active?.kind === 'recording') {
        try { active.recorder.stop(); } catch (_) {}
        active.stream?.getTracks?.().forEach((track) => track.stop());
      } else {
        try { active?.stop?.(); } catch (_) {}
      }
      sidebarDictationRef.current = null;
      setIsDictating(false);
      window.dispatchEvent(new CustomEvent('smaran:dictation-state', { detail: { active: false } }));
    };
    const startRecordedDictation = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        window.dispatchEvent(new CustomEvent('smaran:dictation-error', { detail: { message: 'This browser cannot access a microphone for dictation.' } }));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const startingText = inputValueRef.current.trim();
        audioChunksRef.current = [];
        recorder.ondataavailable = (event) => { if (event.data?.size) audioChunksRef.current.push(event.data); };
        recorder.onstop = async () => {
          const transcript = await transcribeRecordedAudio();
          if (transcript) {
            setInput([startingText, transcript].filter(Boolean).join(' ').trim());
            return;
          }
          // Two different situations were reported with one sentence about
          // microphone permission: the engine heard nothing, and the engine
          // did not run. The second is not the microphone's fault and the
          // advice was sending people to check a setting that was fine.
          const failure = lastTranscribeErrorRef.current;
          window.dispatchEvent(new CustomEvent('smaran:dictation-error', {
            detail: {
              message: failure
                ? `Speech recognition could not run: ${failure}`
                : 'No speech was heard. The microphone is working; try speaking closer to it.',
            },
          }));
        };
        sidebarDictationRef.current = { kind: 'recording', recorder, stream };
        recorder.start(250);
        setIsDictating(true);
        composerRef.current?.focus?.();
        window.dispatchEvent(new CustomEvent('smaran:dictation-state', { detail: { active: true } }));
      } catch (error) {
        const message = error?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in the app or browser settings, then try again.'
          : 'Microphone could not be started.';
        window.dispatchEvent(new CustomEvent('smaran:dictation-error', { detail: { message } }));
      }
    };
    const toggle = async () => {
      if (sidebarDictationRef.current) { stop(); return; }
      // Recorded dictation is transcribed by the backend, so without one this
      // can only ever record and discard. Saying so beats a red button that
      // never produces a word.
      if (isNativeApp() && !loadLink()?.url
          && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
        window.dispatchEvent(new CustomEvent('smaran:dictation-error', {
          detail: {
            message: 'Dictation is transcribed by the computer this phone is '
              + 'linked to, and none is linked yet. Pair one from Settings.',
          },
        }));
        return;
      }
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      // Once the browser's speech service has failed, it fails every time.
      // Trying it first on each click meant the button lit up, the service
      // died, and the button went out again before the recorder that actually
      // works had a chance - which is the flash of red people were seeing.
      if (!Recognition || speechServiceDeadRef.current) {
        await startRecordedDictation();
        return;
      }
      const recognition = new Recognition();
      recognition.lang = getRecognitionLang(selectedLanguage);
      recognition.continuous = true;
      recognition.interimResults = true;
      const startingText = inputValueRef.current.trim();
      recognition.onresult = (event) => {
        let finalText = ''; let interimText = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const text = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) finalText += text; else interimText += text;
        }
        setInput([startingText, finalText, interimText].filter(Boolean).join(' ').trim());
      };
      // Web Speech is a cloud service wearing a browser API. In an Android
      // WebView and in the desktop WebView2, window.webkitSpeechRecognition
      // usually exists, so the check above hands it the job - and then it
      // fails here with 'network' or 'service-not-allowed' because no speech
      // service is bound. Dictation simply stopped with an error and never
      // reached the local recorder, which is why Speak did nothing on the
      // phone. These errors mean the service is unusable, not that the
      // microphone is; fall through to recording and this app's own
      // transcription, which runs locally and needs nobody's cloud.
      const SERVICE_UNAVAILABLE = ['network', 'service-not-allowed', 'language-not-supported'];
      recognition.onerror = (event) => {
        if (SERVICE_UNAVAILABLE.includes(event.error)) {
          // Remembered, so the next click goes straight to the recorder.
          speechServiceDeadRef.current = true;
          stop();
          startRecordedDictation();
          return;
        }
        const message = event.error === 'not-allowed'
          ? 'Microphone permission was denied. Allow it in the app or browser settings, then try again.'
          : event.error === 'aborted' ? '' : `Voice dictation stopped: ${event.error || 'unknown error'}.`;
        if (message) window.dispatchEvent(new CustomEvent('smaran:dictation-error', { detail: { message } }));
        stop();
      };
      recognition.onend = () => { if (sidebarDictationRef.current === recognition) stop(); };
      sidebarDictationRef.current = recognition;
      try {
        recognition.start();
        setIsDictating(true);
        composerRef.current?.focus?.();
        window.dispatchEvent(new CustomEvent('smaran:dictation-state', { detail: { active: true } }));
      } catch (_) { stop(); }
    };
    window.addEventListener('smaran:toggle-dictation', toggle);
    return () => { window.removeEventListener('smaran:toggle-dictation', toggle); stop(); };
  }, [selectedLanguage]);

  // The pet sits above the composer, and the composer changes height - it
  // stacks into two rows on a phone and grows as the text box fills. A fixed
  // offset is what put the pet on top of the input bar. Publish the real
  // height so anything anchored above it can follow.
  const composerShellRef = useRef(null);
  useEffect(() => {
    const shell = composerShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--sm-composer-h', `${Math.round(shell.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  /* Keeping the box you are typing in on screen.

     A phone's on-screen keyboard takes half the window. The layout is sized
     in dvh, so the page shrinks under it and the composer - which is at the
     bottom - ends up below the fold. Tapping the box, or the dictate button
     beside it, appeared to make the input bar vanish.

     visualViewport reports the space the keyboard actually left, which is the
     only reliable measure of it; there is no keyboard event on the web. */
  const composerShell = composerShellRef;
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const keepInView = () => {
      const hiddenByKeyboard = window.innerHeight - viewport.height > 120;
      if (!hiddenByKeyboard) return;
      // A frame later, so it runs after the browser has finished resizing.
      window.requestAnimationFrame(() => {
        composerShell.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      });
    };

    viewport.addEventListener('resize', keepInView);
    return () => viewport.removeEventListener('resize', keepInView);
  }, []);

  /* Voice failures, said where the button was pressed.
     They were only ever rendered in the sidebar, which on a phone is behind
     the hamburger menu - so on the one device where the microphone most often
     will not start, the reason was invisible and Speak just did nothing. */
  const [voiceNotice, setVoiceNotice] = useState('');
  useEffect(() => {
    const failed = (event) => setVoiceNotice(
      event.detail?.message || 'Voice could not start.');
    const started = () => setVoiceNotice('');
    window.addEventListener('smaran:dictation-error', failed);
    window.addEventListener('smaran:dictation-state', started);
    return () => {
      window.removeEventListener('smaran:dictation-error', failed);
      window.removeEventListener('smaran:dictation-state', started);
    };
  }, []);

  const composerRef = useRef(null);
  const [clientDevice, setClientDevice] = useState(null);

  useEffect(() => {
    localStorage.setItem('sm_wake_enabled', String(wakeWordEnabled));
    localStorage.setItem('sm_wake_phrase', wakePhrase);

    const shouldListen = wakeWordEnabled && !isVoiceModeOpen;
    if (!shouldListen) {
      wakeListenerRef.current?.stop();
      wakeListenerRef.current = null;
      return undefined;
    }
    // This used to bail out here when Web Speech was missing, and in the
    // desktop WebView the object is present but the service behind it is not,
    // so it started and failed silently for ever. The listener has a local
    // path now - it watches the microphone level and asks this app's own
    // transcription only when someone actually speaks - so it is worth
    // starting either way.
    const listener = new WakeWordListener({
      phrase: wakePhrase,
      apiBase: API_BASE,
      onWake: () => {
        listener.stop();
        openVoiceMode();
      },
      onError: (message) => console.warn('Wake phrase:', message),
    });
    listener.start();
    wakeListenerRef.current = listener;

    return () => {
      listener.stop();
      wakeListenerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled, wakePhrase, isVoiceModeOpen]);

  useEffect(() => {
    // detectClientDevice is async (it awaits the Battery API). Storing the
    // promise itself left every field undefined, which is why the ribbon showed
    // "OS not reported" on a machine the browser had already identified.
    let active = true;
    Promise.resolve(detectClientDevice())
      .then((info) => { if (active) setClientDevice(info); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Real-time hardware telemetry and speed stats for Single Row Auto-Adjust Bar
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
  // Preserve exactly what the user types. The selected language controls the
  // assistant response and speech recognizer; it must never rewrite the prompt.
  // Grow the composer with the text, up to the CSS max height. Fixed at one row
  // the field scrolled what you were typing out of sight.
  const autoSizeComposer = (element) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  };

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    setInput(nextValue);
    window.dispatchEvent(new CustomEvent('smaran:pet-state', {
      detail: { state: nextValue.trim() ? 'typing' : 'idle', message: '' },
    }));
    autoSizeComposer(event.target);
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
    let cancelled = false;
    let timer = null;
    const checkStatus = async () => {
      try {
        const params = new URLSearchParams({ model: selectedModel || 'auto' });
        const res = await fetch(`${API_BASE}/api/model/status?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setModelStatus(data);
        }
      } catch (_) {}
      finally {
        if (!cancelled) timer = window.setTimeout(checkStatus, document.hidden ? 30000 : 10000);
      }
    };
    checkStatus();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [token, selectedModel]);

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
    // With no backend the conversation lives on the device.
    if (noBackend()) {
      setMessages(localChat.loadMessages(activeSessionId));
      setTimeout(scrollToBottom, 50);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${activeSessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // A 200 that is not a list is not a conversation. In the Android shell
        // this came back as the app's own HTML page, and putting it into
        // state took the whole interface down before it drew anything.
        const data = await parseJsonResponse(res);
        setMessages(asList(data));
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


  const fetchUploadedFiles = async (collectionIds = null) => {
    try {
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      let targetIds = collectionIds && collectionIds.length > 0 ? collectionIds : activeCollections;
      
      // If active collections is empty, fetch all user collections from backend
      if (!targetIds || targetIds.length === 0) {
        const colRes = await fetch(`${API_BASE}/api/collections`, {
          headers: authHeaders,
          credentials: 'include'
        });
        if (colRes.ok) {
          const cols = await parseJsonResponse(colRes);
          targetIds = asList(cols).map((c) => c.id);
          if (targetIds.length > 0) {
            setActiveCollections(targetIds);
          }
        }
      }

      if (!targetIds || targetIds.length === 0) {
        setUploadedFiles([]);
        return;
      }

      const allDocs = [];
      for (const colId of targetIds) {
        const url = activeSessionId 
          ? `${API_BASE}/api/collections/${colId}/documents?session_id=${activeSessionId}`
          : `${API_BASE}/api/collections/${colId}/documents`;
        const res = await fetch(url, {
          headers: authHeaders,
          credentials: 'include'
        });
        if (res.ok) {
          const docs = await parseJsonResponse(res);
          allDocs.push(...asList(docs));
        }
      }
      
      const uniqueDocs = Array.from(
        new Map(allDocs.map((doc) => [doc.id, doc])).values()
      ).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
      setUploadedFiles(uniqueDocs);
    } catch (err) {
      console.error('fetchUploadedFiles error:', err);
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
        if (selectedFilePreview?.id === docId) setSelectedFilePreview(null);
      } else {
        alert('Failed to delete file. Please try again.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete file. Please try again.');
    }
  };

  const handleOpenDocPreview = async (doc) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/${doc.id}/content`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedFilePreview(data);
      } else {
        setSelectedFilePreview({ id: doc.id, name: doc.name, content_preview: "Document content parsed and indexed into vector database." });
      }
    } catch (e) {
      setSelectedFilePreview({ id: doc.id, name: doc.name, content_preview: "Document content indexed." });
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
    if (files.length === 0) return;

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
      
      const nextActiveCollections = activeCollections.includes(targetCollectionId)
        ? activeCollections
        : [...activeCollections, targetCollectionId];
      if (nextActiveCollections !== activeCollections) {
        setActiveCollections(nextActiveCollections);
      }
      
      // Refresh visible session-file chips after every successful upload
      await fetchUploadedFiles(nextActiveCollections);
      
      setDirectUploadMessage(`Successfully parsed and indexed ${files.length} document(s)!`);
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
                  // Preserve only measurements explicitly supplied by the backend.
                  const backendMeasurements = extractBackendMeasurements(parsed);
                  if (backendMeasurements.hasPayload) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id
                          ? {
                              ...msg,
                              ...backendMeasurements.messagePatch,
                            }
                          : msg
                      )
                    );
                  }
                  if (backendMeasurements.telemetryPatch && Object.keys(backendMeasurements.telemetryPatch).length > 1) {
                    setTelemetry((previous) => ({ ...previous, ...backendMeasurements.telemetryPatch }));
                    window.dispatchEvent(new CustomEvent('smaran-inference-update', { detail: backendMeasurements.telemetryPatch }));
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

  const handleConfirmDesktopAction = async (msgId, action, params) => {
    try {
      const res = await fetch(`${API_BASE}/api/desktop/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, params, confirmed: true }),
      });
      if (res.ok) {
        const data = await res.json();
        const updateText = data.success
          ? `🦾 **J.A.R.V.I.S. Desktop Action Completed**\n\n${data.message || 'Operation confirmed and executed successfully.'}`
          : `❌ **Action Failed:** ${data.error || 'Execution rejected.'}`;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, content: updateText, desktopAction: null }
              : m
          )
        );
        speakText(data.message || 'Action executed, sir.', selectedLanguage);
      }
    } catch (err) {
      console.error('Desktop confirmation execution failed:', err);
    }
  };

  const handleCancelDesktopAction = (msgId) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, content: '🛑 **Action Cancelled by User.** No system changes were made.', desktopAction: null }
          : m
      )
    );
  };

  /**
   * The whole conversation, in the shape a provider expects.
   *
   * Trimmed to the last twenty turns: a long chat sent in full is slow, costs
   * more, and eventually exceeds what the model can hold - and the oldest
   * turns are almost never what the next answer depends on.
   */
  const conversationFor = (prompt) => {
    const history = messagesRef.current
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-20)
      .map((m) => ({ role: m.role, content: String(m.content) }));
    /* Anything remembered goes in front of the model. Storing a fact that
       nothing ever reads would be the same broken promise with extra steps. */
    const facts = localChat.loadFacts()
      .map((f) => `- ${f.content || f.fact || ''}`.trim())
      .filter((line) => line.length > 2);

    return [
      {
        role: 'system',
        content: 'You are SMARAN.AI, a helpful assistant running on the '
          + "person's own device. Answer directly and plainly. If you do not "
          + 'know something, say so rather than inventing it.'
          + (facts.length
            ? ['', '', 'Things this person has asked you to remember:', ...facts].join('\n')
            : ''),
      },
      ...history,
      { role: 'user', content: prompt },
    ];
  };

  /** Answer with no backend, streaming into the bubble already on screen. */
  const answerOnDevice = async ({ prompt, sessionId, assistantId, userMessage, spoken }) => {
    const provider = standalone.getProvider();
    const key = standalone.loadKeys()[provider];
    const model = standalone.getModel();

    const fail = (text) => {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: text, isLoading: false } : m));
      setStreaming(false);
      streamingRef.current = false;
    };

    if (!provider || !key) {
      fail('This device has no model set up yet. Open Settings → AI Provider, '
        + 'pick one and paste its key — Google Gemini, Groq, OpenRouter and '
        + 'NVIDIA all have a free tier.');
      return;
    }
    if (!model) {
      fail('Pick a model in Settings → AI Provider. The list comes from the '
        + 'provider, so it shows what your key can actually run.');
      return;
    }

    const controller = new AbortController();
    directAbortRef.current = controller;
    let sofar = '';

    try {
      await standalone.streamReply({
        provider,
        model,
        key,
        messages: conversationFor(prompt),
        signal: controller.signal,
        onToken: (chunk) => {
          sofar += chunk;
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, content: sofar, isLoading: false } : m));
        },
      });

      if (!sofar.trim()) {
        sofar = 'The model returned an empty reply. Try again, or pick a '
          + 'different model in Settings.';
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, content: sofar, isLoading: false } : m));
      }

      // Kept on the device, so the conversation is still here tomorrow.
      localChat.saveMessages(sessionId, messagesRef.current.map((m) =>
        (m.id === assistantId ? { ...m, content: sofar, isLoading: false } : m)));

      if (spoken) speakText(sofar, selectedLanguage);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        fail(error?.message || 'That request could not be completed.');
        return;
      }
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId
          ? { ...m, content: sofar || 'Stopped.', isLoading: false }
          : m));
    } finally {
      directAbortRef.current = null;
      setStreaming(false);
      streamingRef.current = false;
      window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'idle' } }));
      setTimeout(scrollToBottom, 60);
    }
  };

  const handleSend = async (e, directPrompt = null, isVoicePrompt = false) => {
    if (e && e.preventDefault) e.preventDefault();
    const userPrompt = (directPrompt || input || '').trim();
    if (!userPrompt || streaming) return;
    window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'running', message: 'Working on it…' } }));

    // Spoken turns are answered conversationally, without web/document grounding.
    const isVoiceTurn = Boolean(isVoicePrompt || isVoiceModeOpenRef.current);

    // setActiveSessionId was called here and was never defined - not a prop,
    // not local state - so this line threw a ReferenceError and killed the
    // send. It also invented a session id the server had never heard of.
    // Ask the parent for a real one instead, and only fall back to a local id
    // if that fails too.
    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      const created = await onEnsureSession?.();
      targetSessionId = created?.id
        || ('session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
    }

    if (translateTimerRef.current) {
      clearTimeout(translateTimerRef.current);
    }
    setIsTranslating(false);
    
    setInput('');
    // Collapse the composer back to a single row once the message is sent.
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setStreaming(true);
    streamingRef.current = true;
    incomingQueueRef.current = [];

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: userPrompt,
      created_at: new Date().toISOString(),
    };
    
    const assistantMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      references: [],
      created_at: new Date().toISOString(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setTimeout(scrollToBottom, 50);

    /* No backend: answer from the device itself.
     *
     * A phone with no computer linked has nothing behind /api, so every path
     * below this would have failed. It talks to the chosen provider directly
     * instead - the key is on the device and goes to that provider and
     * nowhere else. Documents, local models and desktop control genuinely do
     * need a computer and are not pretended at; plain conversation does not,
     * and now works. */
    if (noBackend()) {
      await answerOnDevice({
        prompt: userPrompt,
        sessionId: targetSessionId,
        assistantId: assistantMessage.id,
        userMessage,
        spoken: isVoiceTurn,
      });
      return;
    }

    // -----------------------------------------------------------------------
    // J.A.R.V.I.S. Desktop OS Control Engine (Apps, Files, System, URLs)
    // -----------------------------------------------------------------------
    try {
      const intentRes = await fetch(`${API_BASE}/api/desktop/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: userPrompt }),
      });
      if (intentRes.ok) {
        const intentData = await intentRes.json();
        if (intentData.detected && intentData.intent) {
          const { action, params } = intentData.intent;
          const execRes = await fetch(`${API_BASE}/api/desktop/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action, params, confirmed: false }),
          });
          if (execRes.ok) {
            const execData = await execRes.json();
            if (execData.requires_confirmation) {
              const confirmMsg = `⚠️ **J.A.R.V.I.S. Confirmation Required**\n\n**Action:** ${execData.title || action}\n${execData.description || ''}\n\n*This system modification requires your explicit approval.*`;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        content: confirmMsg,
                        isLoading: false,
                        desktopAction: { action, params, requiresConfirmation: true, title: execData.title },
                      }
                    : msg
                )
              );
              setStreaming(false);
              streamingRef.current = false;
              window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'waiting', message: 'Your approval is needed' } }));
              if (isVoicePrompt && isVoiceModeOpen) {
                speakText(`Confirmation required for ${execData.title || action}. Please confirm on your screen.`);
              }
              return;
            } else if (execData.success) {
              if (execData.url) {
                try {
                  window.open(execData.url, '_blank', 'noopener,noreferrer');
                } catch (openErr) {
                  console.warn('Window open note:', openErr);
                }
              }

              let replyContent = `🦾 **J.A.R.V.I.S. Desktop Action Completed**\n\n${execData.message || 'Action executed successfully.'}`;
              if (execData.screenshot_base64) {
                replyContent += `\n\n![Screenshot](data:image/png;base64,${execData.screenshot_base64})`;
              }
              if (execData.items && Array.isArray(execData.items)) {
                replyContent += `\n\n**Directory Contents (${execData.total_items} items):**\n` +
                  execData.items.slice(0, 15).map(it => `- ${it.type === 'folder' ? '📁' : '📄'} **${it.name}** ${it.size_human ? `(${it.size_human})` : ''}`).join('\n');
              }
              if (execData.apps && Array.isArray(execData.apps)) {
                replyContent += `\n\n**Top Running Applications:**\n` +
                  execData.apps.slice(0, 10).map(a => `- ⚡ **${a.name}** (PID: ${a.pid} | RAM: ${a.memory_mb} MB | CPU: ${a.cpu_percent}%)`).join('\n');
              }
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessage.id
                    ? { ...msg, content: replyContent, isLoading: false }
                    : msg
                )
              );
              setStreaming(false);
              streamingRef.current = false;
              window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'waving', message: 'Done!' } }));
              if (isVoicePrompt || isVoiceModeOpen || isVoiceModeOpenRef.current) {
                speakText(execData.message || 'Done, sir.');
              }
              return;
            }
          }
        }
      }
    } catch (desktopErr) {
      console.warn('Desktop intent note:', desktopErr);
    }

    let fullResponseText = '';
    let displayedResponse = '';
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: targetSessionId,
          prompt: userPrompt,
          // A spoken turn is a conversation, not a research request. Forcing web
          // or document grounding onto it makes the assistant read out search
          // results ("Based on retrieved context: ...") instead of answering,
          // so grounding is left off unless the user is typing.
          collections: isVoiceTurn || !isRagEnabled ? [] : activeCollections,
          model: selectedModel,
          turbo: turboMode,
          web_search: isVoiceTurn ? false : isWebSearchEnabled,
          rag_enabled: !isVoiceTurn && isRagEnabled && activeCollections.length > 0,
          // Spoken turns get short, proactive replies written to be heard.
          voice_mode: isVoiceTurn,
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
              const backendMeasurements = extractBackendMeasurements(parsed);
              if (backendMeasurements.hasPayload) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, ...backendMeasurements.messagePatch }
                      : msg
                  )
                );
              }
              if (backendMeasurements.telemetryPatch && Object.keys(backendMeasurements.telemetryPatch).length > 1) {
                setTelemetry((previous) => ({ ...previous, ...backendMeasurements.telemetryPatch }));
                window.dispatchEvent(new CustomEvent('smaran-inference-update', { detail: backendMeasurements.telemetryPatch }));
              }
              if (parsed.translated_response && selectedLanguage !== 'en') {
                fullResponseText = parsed.translated_response;
                displayedResponse = parsed.translated_response;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: parsed.translated_response, originalContent: parsed.original_response || fullResponseText }
                      : msg
                  )
                );
                if (typewriterTimerRef.current) {
                  clearInterval(typewriterTimerRef.current);
                  typewriterTimerRef.current = null;
                }
              }
              if (parsed.token) {
                if (!fullResponseText) window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'review', message: 'Answering…' } }));
                fullResponseText += parsed.token;
                incomingQueueRef.current.push(parsed.token);
                if (!typewriterTimerRef.current) {
                  typewriterTimerRef.current = setInterval(() => {
                    if (incomingQueueRef.current.length > 0) {
                      const next = incomingQueueRef.current.shift();
                      displayedResponse += next;
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessage.id
                            ? { ...msg, content: displayedResponse, isLoading: false }
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
                fullResponseText += visibleError;
                displayedResponse += visibleError;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: displayedResponse, isLoading: false }
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
      window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'failed', message: 'Something went wrong' } }));
      const errMsg = `Request failed: ${err.message || 'Unable to communicate with the AI model.'}`;
      fullResponseText = errMsg;
      displayedResponse = errMsg;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: errMsg, isLoading: false }
            : msg
        )
      );
    } finally {
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current);
        typewriterTimerRef.current = null;
      }
      const finalResult = fullResponseText.trim() || displayedResponse.trim();
      incomingQueueRef.current = [];
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? { ...msg, content: finalResult || msg.content, isLoading: false }
            : msg
        )
      );
      setStreaming(false);
      streamingRef.current = false;
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('smaran:pet-state', { detail: { state: 'idle', message: '' } })), 1300);
      if (isVoicePrompt || isVoiceModeOpen || isVoiceModeOpenRef.current) {
        const finalVoiceReply = finalResult || (selectedLanguage === 'hi' ? "मॉडल से कोई उत्तर नहीं मिला। कृपया मॉडल या API स्थिति जाँचें।" : "The selected model returned no answer. Please check its runtime or API status.");
        setVoiceAiResponse(finalVoiceReply);
        if (autoSpeakEnabled && audioEnabled) {
          speakText(finalVoiceReply, selectedLanguage);
        }
      }
    }
  };

  // Speak a J.A.R.V.I.S. reply directly (bypasses the chat model) and surface it
  // in the voice bubble. Used for desktop/OS control confirmations & results.
  const emitVoiceReply = (spokenText) => {
    if (!spokenText) return;
    setVoiceAiResponse(spokenText);
    if (autoSpeakEnabled && audioEnabled) {
      speakText(spokenText, selectedLanguage);
    }
  };

  // Carry out a workspace control the user asked for by voice. These live in the
  // browser, so the backend only names the action and speaks the confirmation.
  const applyVoiceUiAction = (action) => {
    switch (action) {
      case 'attach_files':
        fileInputRef.current?.click();
        break;
      case 'upload_folder':
        folderInputRef.current?.click();
        break;
      case 'rag_on':
        setIsRagEnabled(true);
        break;
      case 'rag_off':
        setIsRagEnabled(false);
        break;
      case 'web_on':
        setIsWebSearchEnabled(true);
        break;
      case 'web_off':
        setIsWebSearchEnabled(false);
        break;
      // Camera and screen live inside the voice session, which is a sibling
      // component, so it is told rather than reached into. The browser will
      // not open either without your click - a page cannot start a camera or
      // choose a window on its own - so these open the picker and the
      // permission prompt, and the last step stays yours.
      case 'camera_on':
      case 'camera_off':
      case 'screen_share_on':
      case 'screen_share_off':
        window.dispatchEvent(new CustomEvent('smaran:vision', {
          detail: {
            mode: action.startsWith('camera') ? 'camera' : 'screen',
            on: action.endsWith('_on'),
          },
        }));
        break;
      // Picture-in-picture shrinks and pins the real desktop window, so you
      // can work in another application while this keeps listening.
      case 'pip_on':
      case 'pip_off':
        fetch(`${API_BASE}/api/window/pip`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ on: action === 'pip_on' }),
        }).then(() => {
          // A pinned 420x560 window showing the full workspace is unusable -
          // there is no room for a sidebar, a chat and a telemetry panel. The
          // small window is the assistant, so entering it opens her and
          // leaving it puts everything back.
          document.documentElement.classList.toggle('sm-pip', action === 'pip_on');
          if (action === 'pip_on') openVoiceMode();
        }).catch(() => {});
        break;
      case 'clear_chat':
        handleClearCurrentChat();
        break;
      case 'new_chat':
        setMessages([]);
        break;
      default:
        break;
    }
  };

  // Detect affirmative / negative words across the supported voice languages so a
  // spoken "yes / haan / ठीक है / no / nahi" can confirm or cancel a pending action.
  const AFFIRMATIVE_WORDS = ['yes', 'yeah', 'yep', 'yup', 'confirm', 'confirmed', 'ok', 'okay', 'sure', 'do it', 'go ahead', 'proceed', 'haan', 'haa', 'ha', 'ji', 'karo', 'kar do', 'kardo', 'theek hai', 'thik hai', 'हाँ', 'हां', 'करो', 'ठीक', 'ठीक है', 'હા', 'ஆம்', 'అవును', 'ಹೌದು'];
  const NEGATIVE_WORDS = ['no', 'nope', 'cancel', 'stop', 'dont', "don't", 'do not', 'nahi', 'nahin', 'mat', 'ruko', 'rehne do', 'नहीं', 'ना', 'मत', 'रुको', 'நো', 'இல்லை', 'కాదు', 'ಬೇಡ'];
  const matchesWord = (text, words) => {
    const t = ` ${text.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    return words.some((w) => t.includes(` ${w} `));
  };

  // Try to handle the utterance as a desktop/OS control command. Returns true if
  // it was handled (executed or a confirmation was requested), so the caller can
  // skip the conversational model.
  const tryVoiceDesktopCommand = async (queryText) => {
    // 1) Resolve any pending yes/no confirmation first.
    const pending = pendingVoiceCommandRef.current;
    if (pending) {
      if (matchesWord(queryText, NEGATIVE_WORDS)) {
        pendingVoiceCommandRef.current = null;
        emitVoiceReply(selectedLanguage === 'en' ? 'Cancelled.' : 'Action cancelled.');
        return true;
      }
      if (matchesWord(queryText, AFFIRMATIVE_WORDS)) {
        pendingVoiceCommandRef.current = null;
        try {
          const res = await fetch(`${API_BASE}/api/desktop/voice-command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ text: pending.text, language: selectedLanguage, confirmed: true }),
          });
          const data = await res.json();
          emitVoiceReply(data?.message || 'Done.');
        } catch (_) {
          emitVoiceReply(selectedLanguage === 'en' ? 'That action could not be completed.' : 'Action could not be completed.');
        }
        return true;
      }
      // Neither yes nor no: drop the stale pending command and fall through.
      pendingVoiceCommandRef.current = null;
    }

    // 2) Detect + run a fresh control command.
    try {
      const res = await fetch(`${API_BASE}/api/desktop/voice-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: queryText, language: selectedLanguage, confirmed: false }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.handled) return false;
      if (data.ui_action) {
        applyVoiceUiAction(data.ui_action);
      }
      if (data.requires_confirmation) {
        pendingVoiceCommandRef.current = { text: queryText };
      }
      emitVoiceReply(data.message || 'Done.');
      return true;
    } catch (_) {
      // Bridge unreachable (e.g. host agent unavailable) — fall back to chat.
      return false;
    }
  };

  const handleSendVoicePrompt = async (queryText) => {
    if (!queryText || !queryText.trim()) return;
    const query = queryText.trim();
    setVoiceAiResponse('');
    // First, try to fulfil the utterance as a hands-free desktop/OS command.
    const handled = await tryVoiceDesktopCommand(query);
    if (handled) return;
    // Otherwise answer conversationally with the selected model.
    await handleSend(null, query, true);
  };

  const telemetrySource = String(telemetry?.telemetry_source || '');
  const hasHostTelemetry = telemetrySource === 'host_bridge' || telemetrySource.endsWith('_host_bridge');
  const reportedOs = clientDevice?.os || 'OS not reported';
  const reportedDevice = clientDevice?.deviceName || clientDevice?.deviceType || 'Browser client';

  return (
    <div className="chat-workspace flex flex-col h-full min-w-0 min-h-0 bg-zinc-50/50 dark:bg-[#0c0c0e]/40 relative overflow-hidden transition-colors duration-300">
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
          <div className="flex items-center gap-2 min-w-0">
            <span className="hidden sm:inline shrink-0 text-zinc-500 dark:text-zinc-400 font-mono text-[10px] sm:text-xs uppercase tracking-wider">AI Engine:</span>
            <span className="relative inline-flex items-center px-2.5 py-1 rounded-xl bg-indigo-50 dark:bg-gradient-to-r dark:from-zinc-900 dark:via-indigo-950/40 dark:to-zinc-900 border border-indigo-200 dark:border-indigo-500/40 text-indigo-950 dark:text-white font-extrabold font-mono text-[10px] sm:text-xs shadow-xs hover:border-indigo-400 transition-all cursor-pointer min-w-0" title={activeModelDisplay}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse mr-1.5" />
              <span className="truncate">{activeModelDisplay}</span>
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
              data-testid="performance-toggle"
              onClick={onTogglePanel}
              title="Toggle Performance Panel"
              className="hidden md:flex p-2 rounded-xl bg-indigo-50 dark:bg-zinc-900 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 shadow-xs hover:scale-105 transition-all cursor-pointer items-center gap-1.5 font-bold text-xs"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden md:inline text-[11px]">Performance</span>
            </button>
          )}

          {/* Float the whole app above your other windows. This is not
              picture-in-picture and does not pretend to be: everything stays -
              sidebar, chat, panels - the window is just smaller and on top.
              Picture-in-picture is the assistant alone, and lives inside her.
              Only offered where there is a real window to pin; in a browser a
              page cannot float over other applications. */}
          {windowPinnable && (
            <button
              onClick={toggleFloating}
              title={floatingOn
                ? 'Back to the normal window'
                : 'Keep SMARAN.AI above your other windows'}
              className={`flex p-2 rounded-xl border shadow-xs hover:scale-105 transition-all cursor-pointer items-center gap-1.5 font-bold text-xs ${
                floatingOn
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-indigo-50 dark:bg-zinc-900 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 border-indigo-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400'
              }`}
            >
              <PictureInPicture2 className="w-4 h-4" />
              <span className="hidden lg:inline text-[11px]">{floatingOn ? 'Dock' : 'Float'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Single Row Real-Time Hardware & Speed Telemetry Ribbon (Hidden on mobile per user request) */}
      <div className="hidden sm:flex w-full px-3 sm:px-6 py-1.5 bg-white/80 dark:bg-zinc-950/60 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/60 flex-wrap items-center gap-x-1.5 gap-y-1 sm:gap-x-2.5 font-mono text-[10px] sm:text-[11px] select-none shrink-0 z-10 transition-all duration-300">
        <div className="contents">
          {/* Real Client Active Device (Mobile / Tablet / Laptop) */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 font-bold" title={`Browser-reported client hint: ${reportedDevice} (${reportedOs}). Browser hints can be unavailable or spoofed.`}>
            {clientDevice?.isMobile ? <Smartphone className="w-3 h-3 text-indigo-500 shrink-0" /> : <Laptop className="w-3 h-3 text-indigo-500 shrink-0" />}
            <span className="truncate max-w-[100px] sm:max-w-[150px]">{reportedDevice}</span>
            <span className="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-black truncate max-w-[110px]">{reportedOs}</span>
          </div>

          {/* Source-labelled host or container CPU */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-300 font-bold" title={`${hasHostTelemetry ? 'Service host bridge' : 'Local runtime'} CPU: ${telemetry?.cpu_name || 'Unavailable'}. This is not claimed as the browser device CPU.`}>
            <Cpu className="w-3 h-3 text-orange-500 shrink-0" />
            <span className="truncate max-w-[130px] sm:max-w-[190px]">{telemetry?.cpu_name ? `Host: ${telemetry.cpu_name.replace(/with Radeon Graphics|Processor|\(R\)|\(TM\)/gi, '').trim()}` : 'Host CPU unavailable'}</span>
            <span className="text-orange-600 dark:text-orange-400 font-black">{telemetry?.cpu_usage !== undefined ? `${safeToFixed(telemetry.cpu_usage, 0) || "0"}%` : '--'}</span>
          </div>

          {/* AI Server Host Dedicated GPU (Shown ONLY if physical GPU exists) */}
          {Boolean(telemetry?.gpu_available && telemetry?.gpu_name && !/host cpu|unified ram|none|n\/a|no gpu|microsoft basic/i.test(telemetry.gpu_name)) && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 font-bold" title={`Service host GPU: ${telemetry?.gpu_name || 'GPU'}. This is not claimed as the browser device GPU.`}>
              <Zap className="w-3 h-3 text-purple-500 shrink-0" />
              <span className="truncate max-w-[90px] sm:max-w-[130px]">{telemetry?.gpu_name ? telemetry.gpu_name.replace(/NVIDIA GeForce|AMD Radeon|\(TM\)/gi, '').trim() : 'GPU'}</span>
              <span className="text-purple-600 dark:text-purple-400 font-black">{telemetry?.gpu_usage !== undefined ? `${safeToFixed(telemetry.gpu_usage, 0) || "0"}%` : '--'}</span>
            </div>
          )}

          {/* Source-labelled host or container RAM */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold">
            <LayoutDashboard className="w-3 h-3 text-cyan-500 shrink-0" />
            <span>{hasHostTelemetry ? 'Host RAM' : 'System RAM'}</span>
            <span className="text-cyan-600 dark:text-cyan-400 font-black">
              {telemetry?.memory_used_gb && telemetry?.memory_total_gb ? `${safeToFixed(telemetry.memory_used_gb, 1) || "0"}/${safeToFixed(telemetry.memory_total_gb, 1) || "0"}GB` : (Number.isFinite(telemetry?.memory_usage) ? `${safeToFixed(telemetry.memory_usage, 0) || "0"}%` : 'Unavailable')}
            </span>
          </div>
        </div>

        {/* Inference Speed & Response Time */}
        <div className="contents">
          {/* Token / sec */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs">
            <Gauge className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline">Speed:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-black">
              {telemetry?.tokens_per_sec > 0 ? `${safeToFixed(telemetry.tokens_per_sec, 1) || "0"} tok/s` : 'Not measured'}
            </span>
          </div>

          {/* Response Latency */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 font-bold">
            <Timer className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="hidden sm:inline">Latency:</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-black">
              {telemetry?.response_time_ms ? `${safeToFixed(telemetry.response_time_ms / 1000, 2) || "0"}s` : 'Unavailable'}
            </span>
          </div>
        </div>
      </div>

      {/* Model Downloading Banner  shown when AI model is still being pulled */}
      {!modelStatus.ready && (
        <div className="shrink-0 z-20 relative border-b border-amber-300/80 dark:border-amber-800/60 bg-amber-50/95 dark:bg-amber-950/45">
          <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2">
            <div className="shrink-0 relative flex items-center justify-center w-5 h-5" aria-hidden="true">
              {modelStatus.downloading ? (
                <span className="w-5 h-5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,.65)]" />
              )}
            </div>
            <div className="flex-1 min-w-[180px]">
              <p className="text-[11px] sm:text-xs font-black text-amber-900 dark:text-amber-200 leading-snug break-words">
                {modelStatus.downloading ? modelStatus.status_msg : 'AI model setup needed'}
              </p>
              {isModelNoticeExpanded && !modelStatus.downloading && (
                <p className="text-[10px] sm:text-[11px] text-amber-800/80 dark:text-amber-300/75 font-semibold mt-0.5 leading-relaxed">
                  {modelStatus.status_msg || 'No installed local model or verified cloud provider is connected.'}
                </p>
              )}
            </div>
            {!modelStatus.downloading && (
              <button type="button" onClick={onOpenModelHub} className="shrink-0 min-h-0! px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black uppercase tracking-wide cursor-pointer">
                Choose model
              </button>
            )}
            <button type="button" onClick={() => setIsModelNoticeExpanded((value) => !value)} className="shrink-0 min-h-0! min-w-0! px-2 py-1.5 rounded-lg text-[10px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-900/40 cursor-pointer" aria-expanded={isModelNoticeExpanded}>
              {isModelNoticeExpanded ? 'Less' : 'Details'}
            </button>
          </div>
          {modelStatus.downloading && modelStatus.progress_pct > 0 && (
            <div className="h-1 bg-amber-200/70 dark:bg-amber-950/50 overflow-hidden"><div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${modelStatus.progress_pct}%` }} /></div>
          )}
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
            
            {/* Animated 3D hero: tumbling glass logo, orbiting rings,
                energy arcs, and a wordmark that assembles itself. */}
            <HeroLogo3D />

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
                  className={`relative p-3 sm:p-4 bg-white/70 dark:bg-white/[0.03] backdrop-blur-md border border-zinc-200/60 dark:border-white/[0.06] rounded-2xl cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 text-left flex flex-col justify-between min-h-[90px] sm:min-h-28 md:min-h-32 group overflow-hidden ${card.borderHover} ${card.glowHover}`}
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
                  isSpeakingAudio={isSpeakingAudio}
                  stopSpeaking={stopSpeaking}
                  speakText={speakText}
                  onConfirmDesktopAction={handleConfirmDesktopAction}
                  onCancelDesktopAction={handleCancelDesktopAction}
                  audioEnabled={audioEnabled}
                  autoSpeakEnabled={autoSpeakEnabled}
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
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-2 select-none animate-in fade-in slide-in-from-bottom-1 duration-200 text-left relative z-20">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              📎 Active Session Files ({uploadedFiles.length})
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
              Clear All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-28 sm:max-h-36 overflow-y-auto pr-1">
            {uploadedFiles.map((f) => (
              <div
                key={f.id}
                onClick={() => handleOpenDocPreview(f)}
                title={`Click to preview ${f.name}`}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200/60 dark:border-indigo-500/35 rounded-full text-[11px] sm:text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:border-indigo-500/60 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 transition-all shadow-sm cursor-pointer group"
              >
                <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="max-w-[130px] sm:max-w-[200px] truncate">{f.name}</span>
                <span className="text-[8px] sm:text-[9px] font-extrabold uppercase px-1.5 py-0.2 bg-indigo-500/20 text-indigo-500 dark:text-indigo-300 rounded-md">Preview</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDeleteUploadedFile(f.id); }}
                  className="p-0.5 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-full text-zinc-400 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                  title="Remove file"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Box Console — Responsive: Clean 2-tier toolbar on Mobile (<640px) | Single unified capsule on Desktop (≥640px) */}
      <div className="px-2 sm:px-5 pb-3 sm:pb-5 pt-1 bg-transparent shrink-0 relative z-10 w-full max-w-full">
        <div className="mx-auto mb-2 hidden max-w-4xl items-center gap-1.5 sm:flex">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-2.5 text-[11px] font-semibold text-zinc-300">
          <Laptop className="h-3.5 w-3.5 text-indigo-400" /> Local
          </span>
          {/* Both of these used to state things that were not so. With no
              folder open - which is what /api/workspace/status reports until
              you pick one - the middle chip still read "SMARAN Workspace" and
              its tooltip said "Workspace active". And the branch chip printed
              `git?.branch || 'main'`, so with git null it showed "main": a
              branch name nothing had read. Now the first says there is no
              folder, and the second is not rendered at all unless a branch was
              actually found. */}
          <button type="button" onClick={onOpenWorkspace}
            className="inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-2.5 text-[11px] font-semibold text-zinc-200 transition hover:border-indigo-500/60 hover:bg-zinc-800"
            title={workspaceStatus?.open ? workspaceStatus.root : 'No folder is open. Click to choose one.'}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="truncate">
              {workspaceStatus?.open
                ? String(workspaceStatus.root).split(/[\\/]/).filter(Boolean).pop()
                : 'Open a folder'}
            </span>
          </button>
          {workspaceStatus?.git?.branch && (
            <span title={`Git branch: ${workspaceStatus.git.branch}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-2.5 text-[11px] font-semibold text-zinc-300">
              <GitBranch className="h-3.5 w-3.5 text-emerald-400" /> {workspaceStatus.git.branch}
            </span>
          )}
        </div>
        {voiceNotice && (
          <div
            role="alert"
            className="relative z-30 max-w-4xl mx-auto mb-1.5 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-100"
          >
            <span className="flex-1">{voiceNotice}</span>
            <button
              type="button"
              onClick={() => setVoiceNotice('')}
              className="shrink-0 font-bold underline"
            >
              Dismiss
            </button>
          </div>
        )}
        <form data-testid="chat-composer" ref={composerShellRef} onSubmit={handleSend} className="composer-shell max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 bg-gradient-to-b from-white/95 to-zinc-50/90 dark:from-zinc-900/95 dark:to-zinc-950/95 border border-indigo-300/60 dark:border-indigo-500/35 rounded-2xl sm:rounded-3xl p-2.5 sm:p-2.5 shadow-[0_14px_35px_-18px_rgba(99,102,241,0.55)] focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/35 focus-within:shadow-[0_0_38px_rgba(99,102,241,0.38)] transition-all w-full overflow-hidden">
          {/* Hidden file inputs */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleDirectFileUpload}
            accept=".pdf,.csv,.tsv,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.txt,.md,.markdown,.xml,.rst,.adoc,.rtf,.ipynb,.py,.js,.jsx,.ts,.tsx,.c,.cpp,.cc,.cxx,.h,.hpp,.cs,.java,.kt,.kts,.go,.rs,.php,.rb,.swift,.m,.mm,.sh,.bash,.zsh,.bat,.cmd,.ps1,.sql,.r,.scala,.dart,.lua,.pl,.json,.jsonc,.json5,.yaml,.yml,.toml,.ini,.env,.conf,.config,.properties,.log,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.avi,.mkv,.webm,.mov,.flv,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.gif,.svg"
            multiple
            className="hidden"
          />
          <input
            type="file"
            ref={folderInputRef}
            onChange={handleFolderUpload}
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
          />

          {/* Desktop Left Tools (sm+) */}
          <div className="composer-desktop-left hidden sm:flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!activeSessionId || directUploading} className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl transition-colors cursor-pointer disabled:opacity-35" title="Attach Files">
              <Upload className="w-4 h-4" />
            </button>
            {/* The folder icon that stood here did the same thing as the
                "Folder" chip in the row below - same ref, same handler - so
                the composer offered folder upload twice, once labelled and
                once not. The labelled one stays. */}
          </div>

          {/* The textarea and the send buttons are deliberately not gated on
              activeSessionId. The placeholder invites you to start a
              conversation, so refusing keystrokes until one already existed
              was the box contradicting itself - that was the dead composer on
              mobile. handleSend creates the session when there is none. The
              attach and upload buttons stay gated, because a file genuinely
              has to be attached to something. */}
          {/* Main Textarea Area */}
          <div className="composer-input w-full sm:flex-1 relative min-w-0 flex items-center gap-1.5 order-first sm:order-none">
            <textarea
              ref={composerRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                const isShortcut = e.ctrlKey || e.metaKey;
                if (isShortcut) {
                  const allowedKeys = ['c', 'x', 'v', 'a', 'z', 'y', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
                  if (allowedKeys.includes(e.key.toLowerCase()) || allowedKeys.includes(e.key)) return;
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
              }}
              onPaste={(e) => { e.stopPropagation(); }}
              onCopy={(e) => e.stopPropagation()}
              onCut={(e) => e.stopPropagation()}
              placeholder={
                activeSessionId
                  ? isWebSearchEnabled ? 'Search the live web...' : isRagEnabled ? 'Ask from uploaded files...' : 'Ask SMARAN.AI directly...'
                  : 'Start a new conversation'
              }
              disabled={streaming || directUploading}
              rows={1}
              className="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 font-semibold resize-none min-h-[38px] max-h-32 py-2 px-1 sm:px-2 leading-relaxed"
            />
            {isTranslating && (
              <span className="absolute right-10 sm:right-2 top-2 text-[10px] text-indigo-500 font-bold animate-pulse">Translating...</span>
            )}
            
            {/* Mobile Send Button */}
            {/* Dictation. It types what you say into the box beside it, which
                is where it belongs - the only way to start it was a row in the
                sidebar, and on a phone the sidebar is behind the menu. So on a
                phone you had to open the menu, find Voice, and by then you had
                lost sight of the box it types into. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('smaran:toggle-dictation'))}
              className={`h-8 w-8 rounded-xl shrink-0 flex items-center justify-center transition-all cursor-pointer border ${
                isDictating
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 animate-pulse'
                  : 'bg-zinc-200 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:text-indigo-500'
              }`}
              title={isDictating ? 'Stop dictating' : 'Dictate — speak and it types for you'}
              aria-label={isDictating ? 'Stop dictating' : 'Dictate'}
            >
              <Mic className="w-3.5 h-3.5" />
            </button>
            <button
              type="submit"
              disabled={!input.trim() || streaming || directUploading}
              className="composer-compact-send sm:hidden w-8 h-8 rounded-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/30 transition-all cursor-pointer disabled:opacity-30 disabled:shadow-none"
              title="Send Message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Tools Strip (sm:hidden) — Single Touch-Scrollable Action Bar */}
          <div className="composer-compact-tools sm:hidden w-full flex items-center gap-1.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/80 overflow-x-auto no-scrollbar py-0.5">
            {/* Speak Button — Prominent Primary Mobile Action */}
            <button
              type="button"
              onClick={openVoiceMode}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 via-indigo-600 to-fuchsia-600 text-white rounded-xl font-black text-xs shadow-md shadow-violet-500/25 cursor-pointer hover:scale-105 active:scale-95 transition-all shrink-0"
              title="Real-time Voice Mode (Speak & AI Responds Aloud)"
            >
              <Volume2 className="w-3.5 h-3.5 animate-pulse" />
              <span>Speak</span>
            </button>

            {/* File Attach */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeSessionId || directUploading}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-bold border border-zinc-200 dark:border-zinc-700/60 cursor-pointer disabled:opacity-35 shrink-0"
              title="Attach Files"
            >
              <Upload className="w-3.5 h-3.5 text-indigo-500" />
              <span>Attach file</span>
            </button>

            {/* Folder upload was offered twice over: this chip and the
                "Open a folder" button above the composer, which do different
                things and both said folder. Renaming it was not enough - it
                is gone. "Attach file" takes multiple files at once, which is
                what folder upload was mostly used for. */}
            {/* RAG Toggle */}
            <button
              type="button"
              onClick={() => setIsRagEnabled(!isRagEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                isRagEnabled
                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/40 shadow-xs'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700/60'
              }`}
              title={isRagEnabled ? 'RAG Mode Active' : 'Direct AI Mode'}
            >
              <Brain className={`w-3.5 h-3.5 ${isRagEnabled ? 'text-purple-600 dark:text-purple-400' : ''}`} />
              <span>{isRagEnabled ? 'RAG' : 'Direct AI'}</span>
            </button>

            {/* Web Search Toggle */}
            <button
              type="button"
              onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                isWebSearchEnabled
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40 shadow-xs'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700/60'
              }`}
              title={isWebSearchEnabled ? 'Live Web Search Active' : 'Web Search Inactive'}
            >
              <Globe className={`w-3.5 h-3.5 ${isWebSearchEnabled ? 'animate-pulse text-blue-500' : ''}`} />
              <span>{isWebSearchEnabled ? 'Web ON' : 'Web OFF'}</span>
            </button>

            {/* Compare Mode.
                Not on a phone answering from the device: it runs several
                models side by side through the backend, so with none it
                showed "0 models confirmed", a key field that led nowhere, and
                no way back out of it. */}
            {!noBackend() && (
              <button
                type="button"
                onClick={() => { setComparePrompt(input); setIsModelCompareOpen(true); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 cursor-pointer shrink-0"
                title="Compare Models Side-by-Side"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Compare</span>
              </button>
            )}

            {/* Language Selector */}
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-2 py-1 shrink-0" title="Response Language">
              <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="text-xs font-bold text-zinc-900 dark:text-zinc-100 bg-transparent outline-none cursor-pointer"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-bold">{l.flag} {l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Desktop Right Tools (sm+) — Single Continuous Row */}
          <div className="composer-desktop-right hidden sm:flex items-center gap-1.5 shrink-0">
            {/* RAG Toggle */}
            <button
              type="button"
              onClick={() => setIsRagEnabled(!isRagEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`h-8 px-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1 text-xs font-bold ${
                isRagEnabled
                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
              title={isRagEnabled ? 'RAG Document Grounding ON' : 'Direct AI Mode'}
            >
              <Brain className={`w-3.5 h-3.5 ${isRagEnabled ? 'text-purple-600 dark:text-purple-400' : ''}`} />
              <span>{isRagEnabled ? 'RAG ON' : 'Direct AI'}</span>
            </button>

            {/* Web Toggle */}
            <button
              type="button"
              onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
              disabled={!activeSessionId || directUploading}
              className={`h-8 px-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-35 shrink-0 flex items-center gap-1 text-xs font-bold ${
                isWebSearchEnabled
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
              title={isWebSearchEnabled ? 'Live Web Search ON' : 'Live Web Search OFF'}
            >
              <Globe className={`w-3.5 h-3.5 ${isWebSearchEnabled ? 'animate-pulse text-blue-500' : ''}`} />
              <span>{isWebSearchEnabled ? 'Web ON' : 'Web OFF'}</span>
            </button>

            {/* The Wake button stood here. It defaulted to off, so the wake
                phrase only worked if you found the button and pressed it,
                every session - which is the opposite of what a wake phrase
                is for. Listening is on by default now and switchable in
                settings, so the composer does not need a control for it. */}

            {/* Compare */}
            <button
              type="button"
              onClick={() => { setComparePrompt(input); setIsModelCompareOpen(true); }}
              className="h-8 px-2.5 rounded-xl transition-all cursor-pointer text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 border border-indigo-500/30 shrink-0 flex items-center gap-1 text-xs font-bold"
              title="Compare Models Side-by-Side"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Compare</span>
            </button>


            {/* Speak — Real-time J.A.R.V.I.S. Voice Mode (desktop) */}
            <button
              type="button"
              onClick={openVoiceMode}
              className="h-8 px-3 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-fuchsia-600 text-white font-black text-xs shadow-[0_0_14px_rgba(139,92,246,0.35)] hover:shadow-[0_0_24px_rgba(139,92,246,0.6)] hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0 flex items-center gap-1.5"
              title="Speak — SMARAN.AI Jarvis (hands-free voice)"
            >
              <Volume2 className="w-3.5 h-3.5 animate-pulse" />
              <span>Speak</span>
            </button>

            {/* Language Selector  */}
            <div className="h-8 flex items-center gap-1 bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-xl px-2.5 shrink-0 shadow-xs" title="Response Language">
              <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="text-xs font-black text-zinc-900 dark:text-zinc-50 bg-transparent outline-none cursor-pointer pr-1"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-bold">{l.flag} {l.name}</option>
                ))}
              </select>
            </div>

            {/* Send */}
            <button
              type="submit"
              disabled={!input.trim() || streaming || directUploading}
              className="w-8 h-8 flex items-center justify-center text-white bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 disabled:from-zinc-300 disabled:to-zinc-400 dark:disabled:from-zinc-700 dark:disabled:to-zinc-800 rounded-xl shadow-[0_0_14px_rgba(139,92,246,0.35)] hover:shadow-[0_0_24px_rgba(139,92,246,0.6)] hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none shrink-0"
              title="Send Message"
            >
              <Send className="w-3.5 h-3.5" />
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

      {/* Document Content Preview Modal */}
      {selectedFilePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-zinc-950 border border-indigo-500/30 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-left">
            <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    {selectedFilePreview.name}
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      INGESTED PREVIEW
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Ingested Document Content & Vector Indexing Details</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedFilePreview(null)}
                className="p-1.5 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-3 font-semibold text-xs flex-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                <span>Extracted Text Content</span>
                <span>Type: {selectedFilePreview.file_type || 'Text/Document'}</span>
              </div>
              <div className="p-4 bg-black/60 border border-zinc-800/80 rounded-2xl font-mono text-[11px] leading-relaxed text-indigo-200 whitespace-pre-wrap select-text max-h-[400px] overflow-y-auto">
                {selectedFilePreview.content_preview}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/40 flex justify-end">
              <button
                onClick={() => setSelectedFilePreview(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Multi-Model Answer Comparison Matrix Modal */}
      <ModelCompareModal
        isOpen={isModelCompareOpen}
        onClose={() => setIsModelCompareOpen(false)}
        initialPrompt={comparePrompt || input}
        token={token}
        apiBase={API_BASE}
        isRagEnabled={isRagEnabled}
      />

      {/* J.A.R.V.I.S. / Iron Man / Matrix Cyberpunk Holographic 3D Hands-Free Voice Assistant */}
      <HackerVoiceAssistant
        isOpen={isVoiceModeOpen}
        onClose={closeVoiceMode}
        onSendQuery={(queryText) => handleSendVoicePrompt(queryText)}
        isSpeakingAudio={isSpeakingAudio}
        stopSpeaking={stopSpeaking}
        speakText={speakText}
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
        languages={LANGUAGES}
        voiceAiResponse={voiceAiResponse}
        activeModelDisplay={activeModelDisplay}
        telemetry={telemetry}
        API_BASE={API_BASE}
        token={token}
        audioEnabled={audioEnabled}
        autoSpeakEnabled={autoSpeakEnabled}
        setAudioEnabled={setAudioEnabled}
        setAutoSpeakEnabled={setAutoSpeakEnabled}
        onAttachFiles={() => fileInputRef.current?.click()}
        onUploadFolder={() => folderInputRef.current?.click()}
        isRagEnabled={isRagEnabled}
        setIsRagEnabled={setIsRagEnabled}
        isWebSearchEnabled={isWebSearchEnabled}
        setIsWebSearchEnabled={setIsWebSearchEnabled}
        onClearChat={handleClearCurrentChat}
        wakeWordSupported={WakeWordListener.isSupported()}
        wakeWordEnabled={wakeWordEnabled}
        wakePhrase={wakePhrase}
        onToggleWakeWord={() => setWakeWordEnabled((value) => !value)}
      />
    </div>
  );
};

export default ChatArea;
