import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Blocks, CheckCircle2, Loader2, Plug, Plus, RefreshCw,
  Search, Sparkles, Trash2, Wrench, X,
} from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

/**
 * Skills, Connectors, Plugins and local MCP servers, in one place.
 *
 * Laid out as a rail of sections beside a table, because that is what this
 * data is: rows with a name, an author, a state and one action. Cards would
 * make eighteen entries take four screens and hide the state, which is the
 * column people actually came to read.
 *
 * Every row's state comes from the backend's own runtime status, not from
 * whether a config flag is set. A plugin that is switched on but cannot
 * start says so, and says why.
 */

const SECTIONS = [
  { id: 'skill',     label: 'Skills',     icon: Sparkles, blurb: 'Capabilities the assistant can call on its own.' },
  { id: 'connector', label: 'Connectors', icon: Plug,     blurb: 'Links to outside services and their data.' },
  { id: 'plugin',    label: 'Plugins',    icon: Blocks,   blurb: 'Bundles that add tools to the assistant.' },
  { id: 'mcp',       label: 'Developer',  icon: Wrench,   blurb: 'Local MCP servers you are working on.' },
];

const STATE = {
  active:         { label: 'Running',  tone: 'text-emerald-400', dot: 'bg-emerald-400' },
  setup_required: { label: 'Needs setup', tone: 'text-amber-400', dot: 'bg-amber-400' },
  error:          { label: 'Failed',   tone: 'text-rose-400',   dot: 'bg-rose-400' },
  disabled:       { label: 'Off',      tone: 'text-zinc-500',   dot: 'bg-zinc-600' },
};

const ExtensionsHub = ({ isOpen, onClose }) => {
  const [rows, setRows] = useState([]);
  const [custom, setCustom] = useState([]);
  const [section, setSection] = useState('skill');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, mine] = await Promise.all([
        fetch(`${API_BASE}/api/plugins`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API_BASE}/api/plugins/custom/all`, { credentials: 'include' }).then((r) => r.json()).catch(() => []),
      ]);
      const list = Array.isArray(all) ? all : Object.values(all?.plugins || all || {});
      setRows(list.filter(Boolean));
      setCustom(Array.isArray(mine) ? mine : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') (detail ? setDetail(null) : onClose?.()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, detail]);

  const toggle = async (row) => {
    const on = row.runtime_status === 'active';
    setBusy(row.name);
    try {
      await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(row.name)}/${on ? 'disable' : 'enable'}`, {
        method: 'POST',
        credentials: 'include',
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const removeCustom = async (id) => {
    setBusy(id);
    try {
      await fetch(`${API_BASE}/api/plugins/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  /* MCP servers are stored as custom entries of type "mcp"; everything else
     is a registered Python plugin. They are listed together so the rail
     reads the way the rest of the app does. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = section === 'mcp'
      ? custom.filter((c) => c.type === 'mcp').map((c) => ({
          name: c.name,
          description: c.description || c.url,
          author: 'You',
          type: 'mcp',
          runtime_status: 'setup_required',
          status_detail: `Saved target ${c.url}. This backend has not connected to it.`,
          capabilities: [],
          is_custom: true,
          id: c.id,
        }))
      : rows.filter((r) => r.type === section);

    if (!needle) return source;
    return source.filter((r) =>
      `${r.name} ${r.description || ''} ${r.author || ''}`.toLowerCase().includes(needle));
  }, [rows, custom, section, query]);

  const counts = useMemo(() => {
    const out = {};
    SECTIONS.forEach((s) => {
      out[s.id] = s.id === 'mcp'
        ? custom.filter((c) => c.type === 'mcp').length
        : rows.filter((r) => r.type === s.id).length;
    });
    return out;
  }, [rows, custom]);

  if (!isOpen) return null;

  const current = SECTIONS.find((s) => s.id === section);
  const running = visible.filter((r) => r.runtime_status === 'active').length;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="flex h-[min(46rem,92vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">

        {/* rail */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40 p-3 sm:flex">
          <p className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
            Customize
          </p>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setSection(id); setDetail(null); }}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold transition
                          ${section === id
                            ? 'bg-zinc-800 text-white'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${section === id ? 'text-red-400' : ''}`} />
              <span className="flex-1">{label}</span>
              <span className="text-[11px] font-mono text-zinc-600">{counts[id] ?? 0}</span>
            </button>
          ))}

          <p className="mt-auto px-2 pb-1 text-[10px] leading-relaxed text-zinc-600">
            State is read from the running backend, not from a saved setting.
          </p>
        </aside>

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-white">{current.label}</h2>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">{current.blurb}</p>
            </div>

            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-44 rounded-lg border border-zinc-700 bg-black/40 py-1.5 pl-9 pr-3 text-xs
                           text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-red-400/50"
              />
            </div>

            <button
              type="button"
              onClick={load}
              title="Re-read from the backend"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {(
              <button
                type="button"
                onClick={() => setAdding(section === 'mcp' ? 'mcp' : 'repo')}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black
                           text-white transition hover:bg-red-500"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* table */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading from the backend…
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm font-bold text-zinc-400">
                  {query ? 'Nothing matches that.' : `No ${current.label.toLowerCase()} yet.`}
                </p>
                {!query && (
                  <p className="max-w-sm text-[11px] leading-relaxed text-zinc-600">
                    {section === 'mcp'
                      ? 'Add a local MCP server and it appears here. Saving the address does not connect to it; that happens when the assistant first needs it.'
                      : 'Add one from a git repository. It is cloned and read straight away, so a bad address is reported now rather than failing quietly later.'}
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur">
                  <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">
                    <th className="px-5 py-2.5 font-bold">Name</th>
                    <th className="hidden px-3 py-2.5 font-bold lg:table-cell">Author</th>
                    <th className="px-3 py-2.5 font-bold">State</th>
                    <th className="px-5 py-2.5 text-right font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const state = STATE[row.runtime_status] || STATE.disabled;
                    const on = row.runtime_status === 'active';
                    return (
                      <tr
                        key={row.id || row.name}
                        className="group border-b border-zinc-900 transition hover:bg-zinc-900/50"
                      >
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setDetail(row)}
                            className="text-left"
                          >
                            <span className="block font-bold text-zinc-100 group-hover:text-white">
                              {row.name}
                            </span>
                            <span className="mt-0.5 line-clamp-1 block max-w-md text-[11px] text-zinc-500">
                              {row.description || '—'}
                            </span>
                          </button>
                        </td>
                        <td className="hidden px-3 py-3 text-[11px] text-zinc-500 lg:table-cell">
                          {row.author || '—'}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${state.tone}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                            {state.label}
                          </span>
                          {on && row.capabilities?.length > 0 && (
                            <span className="ml-2 text-[10px] text-zinc-600">
                              {row.capabilities.length} capabilit{row.capabilities.length === 1 ? 'y' : 'ies'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {row.is_custom ? (
                            <button
                              type="button"
                              onClick={() => removeCustom(row.id)}
                              disabled={busy === row.id}
                              className="rounded-lg p-1.5 text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                              aria-label={`Remove ${row.name}`}
                            >
                              {busy === row.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggle(row)}
                              disabled={busy === row.name}
                              className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition
                                          ${on
                                            ? 'border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                                            : 'bg-red-600 text-white hover:bg-red-500'}`}
                            >
                              {busy === row.name
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : on ? 'Turn off' : 'Turn on'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-zinc-800 px-5 py-2.5 text-[11px] text-zinc-600">
            <span>{visible.length} listed</span>
            {running > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="text-emerald-500">{running} running</span>
              </>
            )}
          </footer>
        </div>
      </div>

      {detail && <DetailPanel row={detail} onClose={() => setDetail(null)} />}
      {adding === 'mcp' && <AddServer onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {adding === 'repo' && <AddFromRepo onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
};

/** What a row actually is, including why it is not running. */
const DetailPanel = ({ row, onClose }) => {
  const state = STATE[row.runtime_status] || STATE.disabled;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-white">{row.name}</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">{row.description || '—'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className={`flex items-center gap-2 text-xs font-bold ${state.tone}`}>
            {row.runtime_status === 'active'
              ? <CheckCircle2 className="h-4 w-4" />
              : <AlertCircle className="h-4 w-4" />}
            {state.label}
          </p>

          {row.status_detail && (
            <p className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400">
              {row.status_detail}
            </p>
          )}

          {row.capabilities?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                What it exposes
              </p>
              <ul className="space-y-1">
                {row.capabilities.map((c) => (
                  <li key={typeof c === 'string' ? c : c.name}
                      className="rounded-lg bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
                    {typeof c === 'string' ? c : c.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Save a local MCP server. Saving records the address; it does not connect. */
/**
 * Installing a skill, connector or plugin from a git repository.
 *
 * The backend clones and reads the manifest before answering, so this waits
 * for a real outcome instead of showing a tick the moment the request is
 * accepted. A repository that does not exist, or one with no manifest, says so
 * here rather than leaving a failure in a log nobody reads.
 */
const AddFromRepo = ({ onClose, onSaved }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const repo = url.trim();
    if (!repo) return;

    setBusy(true);
    setError('');
    setDone('');
    try {
      const response = await fetch(`${API_BASE}/api/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repo_url: repo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The backend writes these to be read; showing its words beats
        // replacing them with something vaguer.
        setError(data.detail || `Install failed (${response.status}).`);
        return;
      }
      setDone(data.message || 'Installed.');
      setTimeout(onSaved, 900);
    } catch (err) {
      setError(`Could not reach the app: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
      >
        <h3 className="text-sm font-black text-white">Add from a repository</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          The repository is cloned and its <code>plugin.json</code> read before this
          closes. Nothing is enabled until you turn it on.
        </p>

        <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          Repository URL
        </label>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/name"
          className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm
                     text-white outline-none focus:border-red-500"
        />

        {error && (
          <p className="mt-3 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </p>
        )}
        {done && (
          <p className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-[11px] text-emerald-300">
            {done}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black
                       text-white transition hover:bg-red-500 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? 'Cloning…' : 'Install'}
          </button>
        </div>
      </form>
    </div>
  );
};

const AddServer = ({ onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/plugins/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), type: 'mcp', url: url.trim(), description: description.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `Could not save (${response.status}).`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="font-black text-white">Add a local MCP server</h3>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {[
            { label: 'Name', value: name, set: setName, placeholder: 'my-server', required: true },
            { label: 'Address', value: url, set: setUrl, placeholder: 'http://127.0.0.1:8000', required: true },
            { label: 'Description', value: description, set: setDescription, placeholder: 'Optional', required: false },
          ].map((f) => (
            <label key={f.label} className="block">
              <span className="mb-1.5 block text-[11px] font-bold text-zinc-400">{f.label}</span>
              <input
                value={f.value}
                required={f.required}
                placeholder={f.placeholder}
                onChange={(e) => f.set(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100
                           outline-none placeholder:text-zinc-600 focus:border-red-400/60"
              />
            </label>
          ))}

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm
                       font-black text-white transition hover:bg-red-500 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>

          <p className="text-center text-[10px] leading-relaxed text-zinc-600">
            Saving records the address. Nothing connects to it until the assistant needs it.
          </p>
        </div>
      </form>
    </div>
  );
};

export default ExtensionsHub;
