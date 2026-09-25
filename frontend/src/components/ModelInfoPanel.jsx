import React, { useEffect, useState } from 'react';
import { X, Download, Heart, Clock, ExternalLink, Eye, Wrench, Brain, RefreshCw, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * Everything known about one model, the way LM Studio shows it: downloads,
 * likes, last update, parameters, architecture, format, capabilities, the
 * download options with sizes and whether each fits this machine, and the
 * model card. Local (catalogue or installed) and cloud models alike.
 *
 * The figures come from /api/models/info/* - Hugging Face, the local Ollama,
 * and models.dev - and a figure nobody published is left out, not guessed.
 *
 *   target: { kind: 'catalog', model }        a catalogue entry
 *           { kind: 'cloud', provider, id }   a cloud provider's model
 *   onPull(name)   start an Ollama download (hf.co/owner/repo:QUANT)
 *   pullNote       what that download is doing
 */

const CAP_STYLE = {
  Vision: ['text-amber-300 border-amber-500/40 bg-amber-500/10', Eye],
  'Tool Use': ['text-sky-300 border-sky-500/40 bg-sky-500/10', Wrench],
  Reasoning: ['text-emerald-300 border-emerald-500/40 bg-emerald-500/10', Brain],
};

export const compact = (n) => {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
};

export const ago = (iso, now = Date.now()) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  if (days === 0) return 'today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
};

export const gbText = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(2)} GB` : '');
const tokens = (n) => (n ? (n >= 1000 ? `${Math.round(n / 1000)}K tokens` : `${n} tokens`) : '');
const price = (v) => (v == null ? '' : v === 0 ? 'free' : `$${v} / M tokens`);

/** Only http(s) links are followed from a model card. */
export const safeHref = (raw) => {
  try {
    const url = new URL(String(raw || ''), 'https://huggingface.co/');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};

/* Inline: `code`, **bold**, [text](url); everything else is plain text.
   Built as React elements, never as HTML, so a model card cannot inject
   markup or script into the app. */
function inline(text, keyBase) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)\s]+)[^)]*\))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={key} className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-indigo-200">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key} className="text-white">{m[2].slice(2, -2)}</strong>);
    else {
      const href = safeHref(m[5]);
      out.push(href
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline">{m[4]}</a>
        : m[4]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A model card, as plain safe elements: headings, lists, code, tables, text. */
export function ReadmeView({ text }) {
  const cleaned = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images
    .replace(/<[^>]+>/g, '');                 // raw HTML tags
  const lines = cleaned.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={blocks.length} className="my-3 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">{body.join('\n')}</pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const size = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm'][heading[1].length - 1];
      blocks.push(<div key={blocks.length} className={`${size} mt-5 mb-2 font-black text-white`}>{inline(heading[2], blocks.length)}</div>);
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i += 1;
      }
      blocks.push(
        <div key={blocks.length} className="my-3 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-[11px]">
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className={ri === 0 ? 'bg-zinc-900 font-bold text-zinc-200' : 'border-t border-zinc-800 text-zinc-400'}>
                  {r.map((c, ci) => <td key={ci} className="px-3 py-1.5">{inline(c, `${blocks.length}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      blocks.push(<ul key={blocks.length} className="my-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">{items.map((it, k) => <li key={k}>{inline(it, `${blocks.length}-${k}`)}</li>)}</ul>);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*([-*+]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(<p key={blocks.length} className="my-2 text-sm leading-relaxed text-zinc-300">{inline(para.join(' '), blocks.length)}</p>);
  }
  return <div>{blocks}</div>;
}

function Chip({ label, value }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-black text-zinc-100">{value}</span>
    </span>
  );
}

function Capabilities({ list }) {
  if (!list?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Capabilities</span>
      {list.map((cap) => {
        const [style, Icon] = CAP_STYLE[cap] || ['text-zinc-300 border-zinc-700 bg-zinc-800/60', null];
        return (
          <span key={cap} className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${style}`}>
            {Icon && <Icon className="h-3 w-3" />}{cap}
          </span>
        );
      })}
    </div>
  );
}

const FIT_STYLE = {
  fits: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  partial: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  too_large: 'text-red-300 border-red-500/40 bg-red-500/10',
  unknown: 'text-zinc-400 border-zinc-700 bg-zinc-800/60',
};

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

export default function ModelInfoPanel({ target, onClose, onPull, pullNote }) {
  const [hf, setHf] = useState(null);
  const [local, setLocal] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState('');

  const model = target?.kind === 'catalog' ? target.model : null;

  useEffect(() => {
    let live = true;
    const jobs = [];
    const fail = (where) => (err) => live && setErrors((e) => [...e, `${where}: ${err.message}`]);
    if (target?.kind === 'cloud') {
      const q = new URLSearchParams({ provider: target.provider, model: target.id });
      jobs.push(getJson(`${API_BASE}/api/models/info/cloud?${q}`).then((d) => live && setCloud(d), fail('Details')));
    } else if (model) {
      if (model.hf_repo) {
        jobs.push(getJson(`${API_BASE}/api/models/info/hf?repo=${encodeURIComponent(model.hf_repo)}`)
          .then((d) => {
            if (!live) return;
            setHf(d);
            const pick = (d.downloads_options || []).filter((f) => f.ollama_name);
            const best = [...pick].reverse().find((f) => f.fit.status === 'fits') || pick[0];
            if (best) setChoice(best.ollama_name);
          }, fail('Hugging Face')));
      }
      if (model.is_downloaded && model.ollama_tag) {
        jobs.push(getJson(`${API_BASE}/api/models/info/ollama?name=${encodeURIComponent(model.ollama_tag)}`)
          .then((d) => live && setLocal(d), fail('Installed copy')));
      }
    }
    Promise.allSettled(jobs).then(() => live && setLoading(false));
    return () => { live = false; };
  }, [target, model]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = cloud?.name || model?.name || target?.id || '';
  const subtitle = target?.kind === 'cloud' ? `${target.provider} · ${target.id}` : (model?.hf_repo || model?.ollama_tag || '');
  const description = cloud?.description || model?.description || '';
  const caps = cloud?.capabilities || local?.capabilities || (hf?.capabilities?.length ? hf.capabilities : model?.capabilities) || [];
  const options = (hf?.downloads_options || []).filter((f) => f.ollama_name);
  const chosen = options.find((f) => f.ollama_name === choice);
  const url = cloud?.listed_by?.doc || hf?.url || local?.url;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${title} details`}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-white">{title}</h2>
            {subtitle && <p className="truncate font-mono text-[11px] text-zinc-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" className="rounded-full border border-zinc-700 p-1.5 text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-300">
            {hf?.downloads != null && <span className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"><Download className="h-3.5 w-3.5" />{compact(hf.downloads)}</span>}
            {hf?.likes != null && <span className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"><Heart className="h-3.5 w-3.5" />{compact(hf.likes)}</span>}
            {(hf?.last_modified || cloud?.last_updated) && (
              <span className="flex items-center gap-1 text-zinc-400"><Clock className="h-3.5 w-3.5" />Last updated: <b className="text-zinc-200">{ago(hf?.last_modified || cloud?.last_updated)}</b></span>
            )}
            {url && <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-indigo-300 hover:text-white">Source <ExternalLink className="h-3 w-3" /></a>}
          </div>

          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            {description && <p className="text-sm font-semibold text-indigo-300">{description}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Chip label="Params" value={local?.params || hf?.params || model?.parameters} />
              <Chip label="Arch" value={local?.architecture || hf?.architecture || cloud?.family} />
              <Chip label="Format" value={local?.format || hf?.formats?.join(' · ')} />
              <Chip label="Quant" value={local?.quantization} />
              <Chip label="Context" value={tokens(local?.context_length || hf?.context_length || cloud?.context_length) || model?.context_length} />
              <Chip label="Max output" value={tokens(cloud?.max_output)} />
              <Chip label="License" value={local?.license || hf?.license || model?.license} />
              <Chip label="Size" value={gbText(local?.size_bytes)} />
              <Chip label="Knowledge" value={cloud?.knowledge} />
              <Chip label="Released" value={cloud?.release_date} />
              <Chip label="Open weights" value={cloud ? (cloud.open_weights ? 'yes' : 'no') : ''} />
            </div>
            <Capabilities list={caps} />
            {cloud && (cloud.price_input_per_mtok != null || cloud.price_output_per_mtok != null) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                <Chip label="Input" value={price(cloud.price_input_per_mtok)} />
                <Chip label="Output" value={price(cloud.price_output_per_mtok)} />
                <Chip label="Cached input" value={price(cloud.price_cache_read_per_mtok)} />
              </div>
            )}
            {cloud?.modalities && (
              <p className="text-[11px] text-zinc-400">Takes <b className="text-zinc-200">{cloud.modalities.input.join(', ') || 'text'}</b> · gives <b className="text-zinc-200">{cloud.modalities.output.join(', ') || 'text'}</b></p>
            )}
            {model?.is_downloaded && <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Installed on this machine</p>}
          </div>

          {options.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-black text-white">Download options</h3>
              {hf?.gguf_repo && hf.gguf_repo !== hf.id && (
                <p className="text-[11px] text-zinc-500">GGUF build from <span className="font-mono text-zinc-300">{hf.gguf_repo}</span>, pulled through Ollama.</p>
              )}
              <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
                <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Quantization"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white">
                  {options.map((f) => (
                    <option key={f.file} value={f.ollama_name}>GGUF · {f.quant} · {gbText(f.size_bytes)} · {f.fit.label}</option>
                  ))}
                </select>
                {chosen && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${FIT_STYLE[chosen.fit.status]}`}>{chosen.fit.label}</span>
                    <button type="button" onClick={() => onPull?.(chosen.ollama_name)} disabled={!onPull}
                            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-500 disabled:opacity-50">
                      <Download className="h-4 w-4" /> Download {gbText(chosen.size_bytes)}
                    </button>
                  </div>
                )}
                {pullNote && <p className="text-[11px] font-semibold text-zinc-300">{pullNote}</p>}
                {hf?.memory?.vram_gb != null && (
                  <p className="text-[10px] text-zinc-500">Checked against {hf.memory.vram_gb} GB of graphics memory and {Math.round(hf.memory.ram_gb || 0)} GB of RAM on this machine.</p>
                )}
              </div>
            </div>
          )}

          {loading && <p className="flex items-center gap-2 text-xs text-zinc-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Reading the model's details…</p>}
          {!loading && errors.map((e) => <p key={e} className="text-xs text-amber-300">{e}</p>)}

          {hf?.readme && (
            <div className="space-y-2">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-400">Readme</h3>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <ReadmeView text={hf.readme} />
                {hf.readme_truncated && <p className="mt-3 text-[11px] text-zinc-500">Shortened - the full card is on Hugging Face.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
