import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink, Globe2, Loader2, Plus, RefreshCw, Search, Send, Trash2, X,
  Code2, Eye, Download, Sparkles, LayoutTemplate, Layers, Laptop, Smartphone, Check
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

const PRESET_TEMPLATES = [
  {
    id: 'saas_ai',
    title: 'Modern AI SaaS Landing Page',
    prompt: 'Create a high-converting dark-mode AI SaaS landing page with glowing neon gradients, feature cards, live interactive pricing toggle, and testimonial carousel.',
    category: 'SaaS / AI'
  },
  {
    id: 'developer_portfolio',
    title: 'Cyber Developer Portfolio',
    prompt: 'Build a sleek futuristic software developer portfolio with live project grid, tech stack tags, interactive terminal snippet, and contact modal.',
    category: 'Portfolio'
  },
  {
    id: 'ecommerce_store',
    title: 'Next-Gen Cyber Storefront',
    prompt: 'Design a modern minimalist e-commerce storefront with product cards, interactive shopping cart counter, customer reviews, and category filters.',
    category: 'E-Commerce'
  },
  {
    id: 'agency_showcase',
    title: 'Creative Agency Studio',
    prompt: 'Build a bold editorial agency landing page with hero typography, client logos, case studies, and interactive service accordion.',
    category: 'Agency'
  }
];

const generateSiteHTML = (name, prompt, version = 1) => {
  const safeName = (name || 'SMARAN Project').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safePrompt = (prompt || 'A modern digital experience').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const brief = `${name} ${prompt}`.toLowerCase();
  const profile = brief.includes('store') || brief.includes('commerce') || brief.includes('product')
    ? { accent: '#f97316', accent2: '#facc15', eyebrow: 'CURATED COLLECTION', cta: 'Shop the collection', features: ['Featured products', 'Fast secure checkout', 'Loved by customers'] }
    : brief.includes('portfolio') || brief.includes('developer')
      ? { accent: '#22d3ee', accent2: '#8b5cf6', eyebrow: 'SELECTED WORK', cta: 'Explore projects', features: ['Case-study projects', 'Technical expertise', 'Start a conversation'] }
      : brief.includes('agency') || brief.includes('studio') || brief.includes('creative')
        ? { accent: '#ec4899', accent2: '#fb7185', eyebrow: 'INDEPENDENT CREATIVE STUDIO', cta: 'View our work', features: ['Strategy & identity', 'Digital experiences', 'Measured impact'] }
        : { accent: '#6366f1', accent2: '#d946ef', eyebrow: 'A BETTER WAY TO BUILD', cta: 'Start free today', features: ['Powerful automation', 'Simple collaboration', 'Enterprise ready'] };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName} | Built with SMARAN.AI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    :root { --accent: ${profile.accent}; --accent-two: ${profile.accent2}; }
    .glow-radial {
      background: radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 22%, transparent) 0%, transparent 60%),
                  radial-gradient(circle at 85% 85%, color-mix(in srgb, var(--accent-two) 16%, transparent) 0%, transparent 50%),
                  #09090b;
    }
    .brand-gradient { background: linear-gradient(135deg, var(--accent), var(--accent-two)); }
    .accent-button { background: var(--accent); box-shadow: 0 18px 45px color-mix(in srgb, var(--accent) 30%, transparent); }
  </style>
</head>
<body class="glow-radial min-h-screen text-zinc-100 antialiased selection:bg-indigo-500 selection:text-white flex flex-col justify-between">
  
  <!-- Navigation Header -->
  <header class="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="brand-gradient w-8 h-8 rounded-xl flex items-center justify-center font-black text-white shadow-lg">
          ${safeName.slice(0, 1).toUpperCase()}
        </div>
        <span class="font-extrabold tracking-tight text-lg text-white">${safeName}</span>
      </div>
      <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
        <a href="#features" class="hover:text-white transition">Features</a>
        <a href="#demo" class="hover:text-white transition">Live Demo</a>
        <a href="#specs" class="hover:text-white transition">Architecture</a>
      </nav>
      <div class="flex items-center gap-3">
        <span class="text-xs px-2.5 py-1 rounded-full bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 font-bold mono">
          v${version}.0
        </span>
        <button onclick="alert('Welcome to ${safeName}!')" class="px-4 py-2 rounded-xl bg-white text-zinc-950 font-bold text-xs hover:bg-zinc-200 transition shadow-md">
          Get Started
        </button>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <main class="max-w-7xl mx-auto px-6 py-16 sm:py-24 flex-1">
    <div class="max-w-3xl mx-auto text-center space-y-6">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/90 border border-zinc-700/80 text-xs font-semibold text-zinc-300 shadow-inner">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        ${profile.eyebrow}
      </div>
      
      <h1 class="text-4xl sm:text-6xl font-black tracking-tight text-white leading-tight">
        ${safeName}
      </h1>

      <p class="text-base sm:text-xl text-zinc-400 leading-relaxed font-normal">
        ${safePrompt}
      </p>

      <div class="pt-4 flex flex-wrap items-center justify-center gap-4">
        <button onclick="document.getElementById('features').scrollIntoView({ behavior: 'smooth' })" class="accent-button px-6 py-3.5 rounded-2xl text-white font-bold text-sm transition flex items-center gap-2">
          ${profile.cta} &rarr;
        </button>
        <button onclick="alert('Prompt: ${safePrompt}')" class="px-6 py-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 font-semibold text-sm transition">
          View Blueprint
        </button>
      </div>
    </div>

    <!-- Feature Cards Grid -->
    <section id="features" class="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="p-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md hover:border-zinc-700 transition space-y-3">
        <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold">
          01
        </div>
        <h3 class="text-lg font-bold text-white">${profile.features[0]}</h3>
        <p class="text-sm text-zinc-400 leading-relaxed">
          Structured directly from your prompt brief, zero external runtime dependencies.
        </p>
      </div>

      <div class="p-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md hover:border-zinc-700 transition space-y-3">
        <div class="w-10 h-10 rounded-2xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 font-bold">
          02
        </div>
        <h3 class="text-lg font-bold text-white">${profile.features[1]}</h3>
        <p class="text-sm text-zinc-400 leading-relaxed">
          Clean mobile-first viewport layout with modern typography and sleek dark UI aesthetics.
        </p>
      </div>

      <div class="p-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md hover:border-zinc-700 transition space-y-3">
        <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
          03
        </div>
        <h3 class="text-lg font-bold text-white">${profile.features[2]}</h3>
        <p class="text-sm text-zinc-400 leading-relaxed">
          Refine prompts to create instant version increments (v1, v2, v3) in real-time.
        </p>
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="border-t border-zinc-800/80 py-8 px-6 text-center text-xs text-zinc-500">
    <p>&copy; ${new Date().getFullYear()} ${safeName}. Generated locally with SMARAN.AI.</p>
  </footer>

</body>
</html>`;
};

// Two sites used to be built in here - "Smaran Cloud AI SaaS" and "DevStudio
// 3D Experience" - each stamped with the current date, so they appeared in
// the list as though you had made them that day. Both were produced by the
// local template above, which is why they looked identical to each other and
// to every real site. On a machine with no sites, an empty list is the truth.
const DEFAULT_INITIAL_SITES = [];

const SitesHub = () => {
  const [sites, setSites] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sm_sites_registry') || '[]');
      return saved.length > 0 ? saved : DEFAULT_INITIAL_SITES;
    } catch (_) {
      return DEFAULT_INITIAL_SITES;
    }
  });

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/sites`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          // Pull each site's real document. The registry does not carry the
          // HTML, so the cards used to fall back to a local template that
          // reads the brief for a few keywords and is otherwise identical
          // every time - which is why every site looked like every other one.
          const withHtml = await Promise.all(data.map(async (site) => {
            try {
              const page = await fetch(`${API_BASE}/api/sites/${site.id}/preview`, { credentials: 'include' });
              return page.ok ? { ...site, html: await page.text() } : site;
            } catch (_) {
              return site;
            }
          }));
          setSites(withHtml);
          localStorage.setItem('sm_sites_registry', JSON.stringify(withHtml));
        }
      }
    } catch (_) {
      // Fallback gracefully to localStorage
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    localStorage.setItem('sm_sites_registry', JSON.stringify(sites));
  }, [sites]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? sites.filter((site) => `${site.name} ${site.prompt}`.toLowerCase().includes(needle))
      : sites;
  }, [query, sites]);

  const remove = async (site) => {
    if (!window.confirm(`Delete "${site.name}" and its versions?`)) return;
    setBusy(site.id);
    try {
      await fetch(`${API_BASE}/api/sites/${site.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    } finally {
      setSites((all) => all.filter((item) => item.id !== site.id));
      setBusy('');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-8 sm:py-7">
        <header className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
              <Globe2 className="w-8 h-8 text-indigo-400" /> Sites
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Describe a site and your local model writes it as a single
              standalone HTML page, which you can preview, read and export.
            </p>
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            <button
              onClick={() => setCreating(true)}
              className="flex flex-1 sm:w-auto items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30"
            >
              <Plus className="h-4 w-4" /> Create New Site
            </button>
            {/* This screen fills the window and had no close control. On a
                phone the sidebar that would take you back is behind the menu,
                so once you opened Sites there was no way out of it. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('smaran:navigate', { detail: { view: 'chat' } }))}
              aria-label="Close Sites"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" /> <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </header>

        {/* Search Bar */}
        <div className="mt-6 flex gap-2">
          <label className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search websites by name or prompt…"
              className="w-full rounded-full border border-zinc-700/80 bg-zinc-900/80 py-2.5 pl-11 pr-4 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </label>
          <button
            onClick={load}
            className="rounded-xl border border-zinc-800 p-3 text-zinc-400 hover:text-white hover:bg-zinc-900"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        {/* Sites Grid */}
        {visible.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center p-6">
            <Globe2 className="h-12 w-12 text-zinc-700" />
            <h2 className="mt-4 text-xl font-bold">{query ? 'No matching sites' : 'No sites created yet'}</h2>
            <p className="mt-2 max-w-md text-sm text-zinc-400">
              Describe what you want to build or pick a pre-made template below.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-5 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 shadow-md"
            >
              Build your first site
            </button>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((site) => {
              const htmlContent = site.html || generateSiteHTML(site.name, site.prompt, site.version || 1);
              return (
                <article
                  key={site.id}
                  className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 transition-all hover:border-zinc-700 hover:shadow-2xl flex flex-col"
                >
                  {/* Sandboxed Live Miniature Preview */}
                  <button
                    onClick={() => setSelected({ ...site, html: htmlContent })}
                    className="block aspect-video w-full overflow-hidden bg-zinc-950 relative border-b border-zinc-800/80 cursor-pointer group-hover:opacity-95"
                  >
                    <iframe
                      title={`${site.name} preview`}
                      srcDoc={htmlContent}
                      sandbox="allow-scripts allow-same-origin"
                      className="pointer-events-none h-[700px] w-[400%] origin-top-left scale-25 border-0 bg-zinc-950"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <span className="text-xs font-bold text-white bg-indigo-600 px-2.5 py-1 rounded-lg shadow">
                        Open Workspace &rarr;
                      </span>
                    </div>
                  </button>

                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => setSelected({ ...site, html: htmlContent })}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <h2 className="truncate font-extrabold text-white text-base group-hover:text-indigo-400 transition">
                          {site.name}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                          {site.prompt}
                        </p>
                      </button>
                      <button
                        disabled={busy === site.id}
                        onClick={() => remove(site)}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400"
                        title="Delete site"
                      >
                        {busy === site.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/60 pt-3">
                      <span className="font-mono text-indigo-400 font-bold">Version {site.version || 1}</span>
                      <span>{new Date(site.updated_at || Date.now()).toLocaleDateString()}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <CreateSiteModal
          onClose={() => setCreating(false)}
          onCreated={(newSite) => {
            setSites((all) => [newSite, ...all]);
            setCreating(false);
            setSelected(newSite);
          }}
        />
      )}

      {selected && (
        <SiteWorkspaceModal
          site={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated);
            setSites((all) => all.map((item) => (item.id === updated.id ? updated : item)));
          }}
        />
      )}
    </div>
  );
};

const CreateSiteModal = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const applyTemplate = (t) => {
    setName(t.title);
    setPrompt(t.prompt);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || prompt.trim().length < 3) return;
    setBusy(true);

    const generatedHTML = generateSiteHTML(name, prompt, 1);
    const siteObj = {
      id: `site_${Date.now()}`,
      name: name.trim(),
      prompt: prompt.trim(),
      version: 1,
      html: generatedHTML,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const response = await fetch(`${API_BASE}/api/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: siteObj.name, prompt: siteObj.prompt }),
      });
      if (response.ok) {
        const backendSite = await response.json();
        onCreated({ ...siteObj, ...backendSite, html: generatedHTML });
        return;
      }
    } catch (_) {}

    onCreated(siteObj);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" /> Create a Website
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Your local model writes a standalone HTML page from this brief.
              It needs a model installed and takes a minute or two - it is not
              instant, and there is no Tailwind in the output.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Templates */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
            Quick Starter Templates
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="text-left p-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-indigo-500/50 transition group"
              >
                <span className="text-[10px] font-bold text-indigo-400 block">{t.category}</span>
                <span className="text-xs font-semibold text-zinc-200 group-hover:text-white line-clamp-1">
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
            Website Name
          </label>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Apex Cyber Platform"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
            Detailed Description & Features
          </label>
          <textarea
            required
            minLength={3}
            maxLength={20000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the pages, structure, color palette, features, and vibe you want to build…"
            rows={5}
            className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 leading-relaxed outline-none focus:border-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !name.trim() || prompt.trim().length < 3}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-xs font-black text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-lg shadow-indigo-600/30"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Build & Preview Website
        </button>
      </form>
    </div>
  );
};

const SiteWorkspaceModal = ({ site, onClose, onChanged }) => {
  const [prompt, setPrompt] = useState(site.prompt);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' | 'code'
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState('desktop'); // 'desktop' | 'mobile'
  const [copied, setCopied] = useState(false);

  const currentHTML = site.html || generateSiteHTML(site.name, site.prompt, site.version || 1);

  const refine = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) return;
    setBusy(true);

    const nextVer = (site.version || 1) + 1;
    const newHTML = generateSiteHTML(site.name, prompt, nextVer);
    const updated = {
      ...site,
      prompt: prompt.trim(),
      version: nextVer,
      html: newHTML,
      updated_at: new Date().toISOString(),
    };

    try {
      await fetch(`${API_BASE}/api/sites/${site.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: prompt.trim() }),
      }).catch(() => {});
    } finally {
      onChanged(updated);
      setBusy(false);
    }
  };

  const downloadHTML = () => {
    const blob = new Blob([currentHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${site.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_v${site.version || 1}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(currentHTML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950">
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-2 sm:px-4 py-3 bg-zinc-950">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white">
            <X className="h-4 w-4" />
          </button>
          <div>
            <h2 className="truncate font-extrabold text-white text-sm sm:text-base flex items-center gap-2">
              <span>{site.name}</span>
              <span className="text-[10px] font-mono font-bold bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 px-2 py-0.5 rounded-md">
                v{site.version || 1}
              </span>
            </h2>
          </div>
        </div>

        {/* Center Mode Controls */}
        <div className="hidden sm:flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition ${
              activeTab === 'preview' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition ${
              activeTab === 'code' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" /> HTML Code
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {activeTab === 'preview' && (
            <div className="hidden md:flex items-center gap-1 border border-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('desktop')}
                className={`p-1.5 rounded ${viewMode === 'desktop' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
                title="Desktop View"
              >
                <Laptop className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className={`p-1.5 rounded ${viewMode === 'mobile' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
                title="Mobile View"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            onClick={downloadHTML}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold text-zinc-200 hover:bg-zinc-800 transition"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" /> <span className="hidden min-[360px]:inline">Export .html</span><span className="min-[360px]:hidden">Export</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left Refinement Sidebar */}
        <aside className="w-full max-h-[42dvh] overflow-y-auto border-b border-zinc-800 p-4 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r flex flex-col justify-between bg-zinc-950/80">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-indigo-400 block mb-1">
              Refine & Iterate Website
            </label>
            <p className="text-xs text-zinc-400 mb-3">
              Describe what changes, sections, or styles to add for version {(site.version || 1) + 1}.
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder="e.g. Add an interactive pricing calculator, make the navbar sticky, and add testimonials…"
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>

          <div className="pt-4">
            <button
              onClick={refine}
              disabled={busy || prompt.trim().length < 3}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 shadow-lg shadow-indigo-600/30 transition"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Apply as Version {(site.version || 1) + 1}
            </button>
          </div>
        </aside>

        {/* Center Canvas / Code Inspector */}
        <div className="flex-1 min-h-0 overflow-hidden bg-zinc-900/40 flex items-center justify-center p-2 sm:p-4">
          {activeTab === 'preview' ? (
            <div
              className={`h-full bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl transition-all duration-300 ${
                viewMode === 'mobile' ? 'w-[375px] max-w-full' : 'w-full'
              }`}
            >
              <iframe
                title={site.name}
                srcDoc={currentHTML}
                sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
                className="w-full h-full border-0 bg-zinc-950"
              />
            </div>
          ) : (
            <div className="w-full h-full bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400">
                <span>index.html</span>
                <button onClick={copyCode} className="flex items-center gap-1 text-xs font-bold text-indigo-400 hover:text-indigo-300">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Code2 className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
              <pre className="flex-1 p-4 overflow-auto font-mono text-xs text-zinc-300 leading-relaxed select-all">
                {currentHTML}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SitesHub;
