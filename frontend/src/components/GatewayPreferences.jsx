import React, { useState, useEffect } from 'react';
import { Globe, Send, CheckCircle2, AlertCircle, RefreshCw, Power, MessageSquare } from 'lucide-react';
import { API_BASE, fetchWithAuth } from '../context/AuthContext';

export default function GatewayPreferences() {
  const [status, setStatus] = useState({ telegram: { running: false }, discord: { running: false }, webhook: { running: false } });
  const [loading, setLoading] = useState(true);

  // Telegram inputs
  const [tgToken, setTgToken] = useState(() => localStorage.getItem('sm_tg_token') || '');
  const [tgChatId, setTgChatId] = useState(() => localStorage.getItem('sm_tg_chat_id') || '');
  const [tgBusy, setTgBusy] = useState(false);

  // Discord inputs
  const [dcToken, setDcToken] = useState(() => localStorage.getItem('sm_dc_token') || '');
  const [dcChannelId, setDcChannelId] = useState(() => localStorage.getItem('sm_dc_channel_id') || '');
  const [dcBusy, setDcBusy] = useState(false);

  const [messageNotice, setMessageNotice] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/agent/gateway/status`);
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch (err) {
      console.error('Failed to get gateway status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const toggleTelegram = async () => {
    setTgBusy(true);
    setMessageNotice('');
    try {
      if (status.telegram?.running) {
        await fetchWithAuth(`${API_BASE}/api/agent/gateway/telegram/stop`, { method: 'POST' });
      } else {
        localStorage.setItem('sm_tg_token', tgToken);
        localStorage.setItem('sm_tg_chat_id', tgChatId);
        const res = await fetchWithAuth(`${API_BASE}/api/agent/gateway/telegram/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tgToken, default_chat_id: tgChatId }),
        });
        const data = await res.json();
        if (!data.started) {
          setMessageNotice('Failed to start Telegram Bot. Check bot token.');
        }
      }
      await fetchStatus();
    } catch (err) {
      setMessageNotice(String(err));
    } finally {
      setTgBusy(false);
    }
  };

  const toggleDiscord = async () => {
    setDcBusy(true);
    setMessageNotice('');
    try {
      if (status.discord?.running) {
        await fetchWithAuth(`${API_BASE}/api/agent/gateway/discord/stop`, { method: 'POST' });
      } else {
        localStorage.setItem('sm_dc_token', dcToken);
        localStorage.setItem('sm_dc_channel_id', dcChannelId);
        const res = await fetchWithAuth(`${API_BASE}/api/agent/gateway/discord/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: dcToken, default_channel_id: dcChannelId }),
        });
        const data = await res.json();
        if (!data.started) {
          setMessageNotice('Failed to start Discord Bot. Check token & channel.');
        }
      }
      await fetchStatus();
    } catch (err) {
      setMessageNotice(String(err));
    } finally {
      setDcBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Globe className="w-4 h-4 text-indigo-500" />
          Multi-Platform Gateway (Hermes Parity)
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Connect SMARAN.AI to Telegram, Discord, and Webhooks to chat and trigger agent runs remotely.
        </p>
      </div>

      {messageNotice && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500">
          {messageNotice}
        </div>
      )}

      {/* Telegram Section */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">Telegram Gateway</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              status.telegram?.running
                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
            }`}>
              {status.telegram?.running ? 'Connected' : 'Stopped'}
            </span>
          </div>
          <button
            onClick={toggleTelegram}
            disabled={tgBusy || (!status.telegram?.running && !tgToken)}
            className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              status.telegram?.running
                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            } disabled:opacity-50`}
          >
            <Power className="w-3 h-3" />
            {status.telegram?.running ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[11px] font-semibold text-zinc-500">Bot Token (from @BotFather)</label>
            <input
              type="password"
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              disabled={status.telegram?.running}
              className="w-full mt-1 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 outline-none font-mono"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-500">Default Chat ID (optional)</label>
            <input
              type="text"
              placeholder="e.g. 987654321"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              disabled={status.telegram?.running}
              className="w-full mt-1 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 outline-none font-mono"
            />
          </div>
        </div>
      </div>

      {/* Discord Section */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold">Discord Gateway</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              status.discord?.running
                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
            }`}>
              {status.discord?.running ? 'Connected' : 'Stopped'}
            </span>
          </div>
          <button
            onClick={toggleDiscord}
            disabled={dcBusy || (!status.discord?.running && !dcToken)}
            className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              status.discord?.running
                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            } disabled:opacity-50`}
          >
            <Power className="w-3 h-3" />
            {status.discord?.running ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[11px] font-semibold text-zinc-500">Bot Token</label>
            <input
              type="password"
              placeholder="Discord Bot Token"
              value={dcToken}
              onChange={(e) => setDcToken(e.target.value)}
              disabled={status.discord?.running}
              className="w-full mt-1 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 outline-none font-mono"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-zinc-500">Channel ID</label>
            <input
              type="text"
              placeholder="e.g. 112233445566778899"
              value={dcChannelId}
              onChange={(e) => setDcChannelId(e.target.value)}
              disabled={status.discord?.running}
              className="w-full mt-1 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 outline-none font-mono"
            />
          </div>
        </div>
      </div>

      {/* Webhook Endpoint */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-2">
        <span className="text-xs font-bold">Webhook Trigger Ingress</span>
        <p className="text-[11px] text-zinc-500">
          Send HTTP POST payloads with <code>{`{"prompt": "..."}`}</code> to trigger agent runs from scripts or CI/CD pipelines:
        </p>
        <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-950 font-mono text-[11px] text-indigo-500 select-all border border-zinc-200 dark:border-zinc-800">
          {API_BASE}/api/agent/gateway/webhook/generic
        </div>
      </div>
    </div>
  );
}
