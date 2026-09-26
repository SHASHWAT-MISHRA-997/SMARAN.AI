import React, { useState, useEffect } from 'react';
import { Globe, Power } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { agentSettingsRequest } from '../utils/agentSettingsRequest';

export default function GatewayPreferences() {
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);

  // Telegram inputs
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState(() => localStorage.getItem('sm_tg_chat_id') || '');
  const [tgBusy, setTgBusy] = useState(false);

  // Discord inputs
  const [dcToken, setDcToken] = useState('');
  const [dcChannelId, setDcChannelId] = useState(() => localStorage.getItem('sm_dc_channel_id') || '');
  const [dcBusy, setDcBusy] = useState(false);

  const [messageNotice, setMessageNotice] = useState('');
  const [webhookBusy, setWebhookBusy] = useState(false);

  const toggleWebhook = async () => {
    setWebhookBusy(true);
    setMessageNotice('');
    try {
      const action = status.webhook?.running ? 'stop' : 'start';
      await agentSettingsRequest(`/gateway/webhook/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      await fetchStatus();
    } catch (error) {
      setMessageNotice(error.message);
    } finally {
      setWebhookBusy(false);
    }
  };

  const fetchStatus = async () => {
    setLoading(true);
    try {
      setStatus(await agentSettingsRequest('/gateway/status'));
    } catch (err) {
      setMessageNotice(err.message);
      setStatus({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    localStorage.removeItem('sm_tg_token');
    localStorage.removeItem('sm_dc_token');
    fetchStatus();
  }, []);

  const toggleTelegram = async () => {
    setTgBusy(true);
    setMessageNotice('');
    try {
      if (status.telegram?.running) {
        await agentSettingsRequest('/gateway/telegram/stop', { method: 'POST' });
      } else {
        localStorage.setItem('sm_tg_chat_id', tgChatId);
        const data = await agentSettingsRequest('/gateway/telegram/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tgToken.trim(), default_chat_id: tgChatId }),
        });
        if (!data.started) {
          // The backend says why - a token of the wrong kind, or Telegram's own reason.
          setMessageNotice(data.reason || 'Failed to start Telegram Bot. Check bot token.');
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
        await agentSettingsRequest('/gateway/discord/stop', { method: 'POST' });
      } else {
        localStorage.setItem('sm_dc_channel_id', dcChannelId);
        const data = await agentSettingsRequest('/gateway/discord/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: dcToken.trim(), default_channel_id: dcChannelId }),
        });
        if (!data.started) {
          setMessageNotice('Failed to start Discord Bot. Check token & channel.');
        }
      }
      await fetchStatus();
    } catch (err) {
      setMessageNotice(err.message || String(err));
    } finally {
      setDcBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Globe className="w-4 h-4 text-indigo-500" />
          Gateway & Bots
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Connect SMARAN.AI to Telegram, Discord, and Webhooks to chat and trigger agent runs remotely.
        </p>
      </div>

      {messageNotice && (
        <div role="alert" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500">
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
              {loading ? 'Checking…' : !status.telegram ? 'Unavailable' : status.telegram.running ? 'Connected' : 'Stopped'}
            </span>
          </div>
          <button
            onClick={toggleTelegram}
            disabled={loading || !status.telegram || tgBusy || (!status.telegram?.running && !tgToken.trim())}
            className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              status.telegram?.running
                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            } disabled:opacity-50`}
          >
            <Power className="w-3 h-3" />
            {tgBusy ? 'Please wait…' : status.telegram?.running ? 'Disconnect' : 'Connect'}
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
              {loading ? 'Checking…' : !status.discord ? 'Unavailable' : status.discord.running ? 'Connected' : 'Stopped'}
            </span>
          </div>
          <button
            onClick={toggleDiscord}
            disabled={loading || !status.discord || dcBusy || (!status.discord?.running && !dcToken.trim())}
            className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              status.discord?.running
                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            } disabled:opacity-50`}
          >
            <Power className="w-3 h-3" />
            {dcBusy ? 'Please wait…' : status.discord?.running ? 'Disconnect' : 'Connect'}
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
        <button onClick={toggleWebhook} disabled={loading || webhookBusy || !status.webhook}
          className="ml-3 px-3 py-1 rounded-xl bg-indigo-600 text-white text-xs disabled:opacity-50">
          {webhookBusy ? 'Please wait…' : status.webhook?.running ? 'Disable webhook' : 'Enable webhook'}
        </button>
        <p className="text-[11px] text-zinc-500">
          Send HTTP POST payloads with <code>{`{"prompt": "..."}`}</code> while enabled to trigger agent runs from scripts or CI/CD pipelines. If configured, pass the secret in the X-Webhook-Secret header:
        </p>
        <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-950 font-mono text-[11px] text-indigo-500 select-all border border-zinc-200 dark:border-zinc-800">
          {API_BASE || window.location.origin}/api/agent/gateway/webhook/generic
        </div>
      </div>
    </div>
  );
}
