/**
 * Talking to a model with no backend in the middle.
 *
 * The phone app has no Python behind it. Until now that meant it could do
 * nothing at all on its own: every request went to its own bundle of files,
 * and the only advice on offer was to go and pair a computer. Somebody who
 * installed a phone app to use on their phone was told to go and use a
 * desktop.
 *
 * So the phone talks to the provider directly, the way the editor extension
 * does. Your key is kept on the device and sent to the provider you chose and
 * nowhere else - there is no server of ours in between, and there is nothing
 * to pair unless you want the things that genuinely need a computer:
 * documents, local models, and control of that machine.
 *
 * The four shapes here are the same four the rest of this project uses.
 *
 * NVIDIA NIM is not here. Its free tier is real and it works in the desktop
 * app, but its API refuses cross-origin requests, so from a phone the call
 * never leaves the WebView. It was listed and greyed with that explanation
 * for a while; showing a provider that can never be picked was decided to be
 * worse than not showing it. Checked twice from a page, with Groq answering
 * 401 from the same page as a control.
 */

const KEY_STORE = 'sm_cloud_keys';
const PROVIDER_STORE = 'sm_direct_provider';
const MODEL_STORE = 'sm_direct_model';

export const PROVIDERS = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    free: true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    hint: 'Free tier. A good first choice.',
  },
  {
    id: 'groq',
    label: 'Groq',
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    hint: 'Free tier, and fast.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    free: true,
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'Many models behind one key, several free.',
  },
  {
    /* Added after checking each one from a page, which is what a phone is:
       all five answered 401 to a made-up key, meaning the browser let the
       request out and the host rejected the key. NVIDIA is the only one that
       never left the device. */
    id: 'cerebras',
    label: 'Cerebras',
    free: true,
    keyUrl: 'https://cloud.cerebras.ai/',
    hint: 'Free tier, and the fastest of these.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    free: true,
    keyUrl: 'https://console.mistral.ai/api-keys/',
    hint: 'Free "Experiment" tier. Requires opting in to training on your data.',
  },
  {
    id: 'together',
    label: 'Together AI',
    free: true,
    keyUrl: 'https://api.together.ai/settings/api-keys',
    hint: 'A few models free, the rest billed.',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    free: true,
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    hint: 'Free trial key. Evaluation only, not for commercial use.',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    free: true,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: 'Several models free, the rest billed.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    hint: 'Paid.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: 'Paid.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: 'Paid, inexpensive.',
  },
];

const OPENAI_COMPATIBLE = {
  openai: 'https://api.openai.com/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/* ── what is stored on this device ─────────────────────────────────────── */

export const loadKeys = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) || '{}') || {};
  } catch {
    return {};
  }
};

export const saveKey = (provider, key) => {
  const all = loadKeys();
  if (key && key.trim()) all[provider] = key.trim();
  else delete all[provider];
  localStorage.setItem(KEY_STORE, JSON.stringify(all));
  return all;
};

export const getProvider = () => localStorage.getItem(PROVIDER_STORE) || '';
export const setProvider = (id) => localStorage.setItem(PROVIDER_STORE, id || '');
export const getModel = () => localStorage.getItem(MODEL_STORE) || '';
export const setModel = (id) => localStorage.setItem(MODEL_STORE, id || '');

/** Is there a provider and a key to talk to right now? */
export const isReady = () => {
  const provider = getProvider();
  return Boolean(provider && loadKeys()[provider]);
};

/* ── listing what a key can actually run ───────────────────────────────── */

export async function listModels(provider, key) {
  if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Google would not list its models (${res.status}). Check the key.`);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.split('/').pop() }));
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Without this the browser's preflight is refused outright.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) throw new Error(`Anthropic would not list its models (${res.status}). Check the key.`);
    return ((await res.json()).data || []).map((m) => ({ id: m.id }));
  }

  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!res.ok) throw new Error(`OpenRouter would not list its models (${res.status}).`);
    return ((await res.json()).data || []).map((m) => ({
      id: m.id,
      free: String(m.pricing?.prompt ?? '') === '0' || m.id.endsWith(':free'),
    }));
  }

  const base = OPENAI_COMPATIBLE[provider];
  if (!base) throw new Error(`${provider} is not a provider this knows.`);
  const res = await fetch(`${base}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`That provider would not list its models (${res.status}). Check the key.`);
  return ((await res.json()).data || []).map((m) => ({ id: m.id }));
}

/** Chat models first: nobody picking a model here wants an embedder. */
export const usable = (models) => {
  const score = (id) => {
    const n = id.toLowerCase();
    if (/embed|whisper|tts|image|vision|audio|rerank|moderation|guard|bge-/.test(n)) return 2;
    if (/flash|mini|small|lite|8b|7b|9b/.test(n)) return 0;
    return 1;
  };
  return [...models]
    .filter((m) => !/embed|bge-|rerank|moderation/i.test(m.id))
    .sort((a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id));
};

/* ── one answer, streamed ──────────────────────────────────────────────── */

/**
 * Send the conversation and call `onToken` as the reply arrives.
 *
 * Streamed rather than waited for: on a phone, on mobile data, a model that
 * takes twenty seconds to finish looks broken if nothing appears until it is
 * done. Returns the whole reply once it ends.
 */
export async function streamReply({ provider, model, key, messages, signal, onToken }) {
  const push = (text) => { if (text) onToken?.(text); };

  if (provider === 'gemini') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents, generationConfig: { temperature: 0.6 } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(await readError(res, 'Google'));
    return readSse(res, signal, (json) => {
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('');
      push(text);
      return text;
    });
  }

  if (provider === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const body = {
      model,
      max_tokens: 4096,
      stream: true,
      messages: messages.filter((m) => m.role !== 'system'),
    };
    if (system) body.system = system;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(await readError(res, 'Anthropic'));
    return readSse(res, signal, (json) => {
      const text = json?.delta?.text || '';
      push(text);
      return text;
    });
  }

  const base = OPENAI_COMPATIBLE[provider];
  if (!base) throw new Error('No provider is set up on this device yet.');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.6 }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res, 'The provider'));
  return readSse(res, signal, (json) => {
    const text = json?.choices?.[0]?.delta?.content || '';
    push(text);
    return text;
  });
}

/** Whatever the provider said went wrong, rather than a bare status code. */
async function readError(res, who) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message || parsed?.detail || body.slice(0, 200);
    } catch {
      detail = body.slice(0, 200);
    }
  } catch { /* nothing readable came back */ }

  if (res.status === 401 || res.status === 403) {
    return `${who} refused the key. Check it in Settings.`;
  }
  if (res.status === 429) {
    return `${who} is rate-limiting this key. Wait a moment, or pick another provider.`;
  }
  return `${who} answered ${res.status}. ${detail}`;
}

/** Server-sent events, which all three shapes above speak. */
async function readSse(res, signal, take) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let whole = '';

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        whole += take(JSON.parse(payload)) || '';
      } catch {
        // A half-written event is not an error; the rest still arrives.
      }
    }
  }
  return whole;
}
