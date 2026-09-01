/**
 * The providers, and what each one will actually run for you.
 *
 * Model names are asked for, never hardcoded. A typed-in list goes stale
 * quietly: two models this extension was tested against were retired inside a
 * day of each other, and a fixed list would have carried on offering them and
 * failing with a 404 that reads as the extension being broken.
 *
 * So every list here comes from the provider, with the key you gave, and what
 * comes back is what you can pick.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface Provider {
    id: string;
    label: string;
    /** Where to get a key, so the panel can link to it rather than describe it. */
    keyUrl?: string;
    /** True where a free tier exists at the time of writing. */
    free?: boolean;
    /** Runs on this machine: no key, and nothing leaves it. */
    local?: boolean;
    /** False for the local runners, which have nothing to paste. */
    needsKey?: boolean;
    /** How much of this provider's catalogue costs nothing.
     *  'all'  - every model listed is usable at no cost (a local runner,
     *           or a provider whose free tier covers its whole catalogue
     *           within a quota)
     *  'some' - mixed, and which is which is marked per model
     *  'none' - everything here is billed */
    free_models?: 'all' | 'some' | 'none';
    /** Where to go to install a local runner. */
    setupUrl?: string;
    setupLabel?: string;
    hint: string;
}

export const PROVIDERS: Provider[] = [
    {
        id: '', free_models: 'all', label: 'Ollama (on this machine)', local: true,
        setupUrl: 'https://ollama.com', setupLabel: 'Get Ollama',
        hint: 'No key, nothing leaves your computer. Any model you have pulled shows up below.',
    },
    {
        id: 'lmstudio', free_models: 'all', label: 'LM Studio (on this machine)', local: true,
        setupUrl: 'https://lmstudio.ai', setupLabel: 'Get LM Studio',
        hint: 'No key. Start its local server (Developer tab) and whatever you have loaded appears below.',
    },
    {
        id: 'groq', free_models: 'all', needsKey: true, label: 'Groq', keyUrl: 'https://console.groq.com/keys', free: true,
        hint: 'Free tier. Fast.',
    },
    {
        id: 'gemini', free_models: 'all', needsKey: true, label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', free: true,
        hint: 'Free tier.',
    },
    {
        id: 'openrouter', free_models: 'some', needsKey: true, label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', free: true,
        hint: 'Many models behind one key, several free.',
    },
    {
        id: 'nvidia', free_models: 'all', needsKey: true, label: 'NVIDIA NIM', keyUrl: 'https://build.nvidia.com/', free: true,
        hint: 'Free developer tier.',
    },
    {
        /* All five endpoints below were probed before being added: each
           answered 401 to a made-up key, which is a host that exists and is
           rejecting the key rather than a URL guessed from a blog post.
           GitHub Models was left out - its documented path answered 410. */
        id: 'cerebras', free_models: 'all', needsKey: true, label: 'Cerebras',
        keyUrl: 'https://cloud.cerebras.ai/', free: true,
        hint: 'Free tier, and the fastest of these by a distance.',
    },
    {
        id: 'mistral', free_models: 'all', needsKey: true, label: 'Mistral',
        keyUrl: 'https://console.mistral.ai/api-keys/', free: true,
        hint: 'Free "Experiment" tier. It requires opting in to training on your data.',
    },
    {
        id: 'together', free_models: 'some', needsKey: true, label: 'Together AI',
        keyUrl: 'https://api.together.ai/settings/api-keys', free: true,
        hint: 'A few models are free; the rest are billed.',
    },
    {
        id: 'cohere', free_models: 'all', needsKey: true, label: 'Cohere',
        keyUrl: 'https://dashboard.cohere.com/api-keys', free: true,
        hint: 'Free trial key. Evaluation only - not licensed for commercial use.',
    },
    {
        id: 'siliconflow', free_models: 'some', needsKey: true, label: 'SiliconFlow',
        keyUrl: 'https://cloud.siliconflow.cn/account/ak', free: true,
        hint: 'Several models free, the rest billed.',
    },
    {
        id: 'anthropic', free_models: 'none', needsKey: true, label: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/settings/keys',
        hint: 'Paid.',
    },
    {
        id: 'openai', free_models: 'none', needsKey: true, label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys',
        hint: 'Paid.',
    },
    {
        id: 'deepseek', free_models: 'none', needsKey: true, label: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys',
        hint: 'Paid, inexpensive.',
    },
];

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'https:' ? https : http;
        const request = transport.get(target, { headers, timeout: 20000 }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (c) => chunks.push(c as Buffer));
            response.on('end', () =>
                resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        request.on('timeout', () => request.destroy(new Error(`${target.host} did not answer in time.`)));
        request.on('error', reject);
    });
}

/**
 * Installing and removing Ollama models from here.
 *
 * Only Ollama. LM Studio's local server speaks the OpenAI chat API and
 * nothing else - it has no endpoint for fetching or deleting a model, so
 * offering the buttons for it would be offering something that cannot work.
 * Its own window does that job.
 */
export function pullOllamaModel(
    ollamaUrl: string,
    model: string,
    onProgress: (percent: number, status: string) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const target = new URL(`${ollamaUrl.replace(/\/+$/, '')}/api/pull`);
        const transport = target.protocol === 'https:' ? https : http;
        const payload = JSON.stringify({ model, stream: true });

        const request = transport.request(
            target,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            },
            (response) => {
                let buffer = '';
                let failed: string | undefined;

                response.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString('utf8');
                    let newline = buffer.indexOf('\n');
                    while (newline >= 0) {
                        const line = buffer.slice(0, newline).trim();
                        buffer = buffer.slice(newline + 1);
                        newline = buffer.indexOf('\n');
                        if (!line) continue;
                        try {
                            const event = JSON.parse(line);
                            if (event.error) { failed = String(event.error); continue; }
                            // A percentage only when there is something to be a
                            // percentage of; the early phases have no total.
                            const percent = event.total
                                ? Math.round(((event.completed || 0) / event.total) * 100)
                                : -1;
                            onProgress(percent, String(event.status || ''));
                        } catch { /* a half-written line; the rest still arrives */ }
                    }
                });
                response.on('end', () => (failed ? reject(new Error(failed)) : resolve()));
            },
        );
        request.on('error', (error: NodeJS.ErrnoException) =>
            reject(error.code === 'ECONNREFUSED'
                ? new Error(`Ollama is not running at ${ollamaUrl}.`)
                : error));
        request.write(payload);
        request.end();
    });
}

export function deleteOllamaModel(ollamaUrl: string, model: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const target = new URL(`${ollamaUrl.replace(/\/+$/, '')}/api/delete`);
        const transport = target.protocol === 'https:' ? https : http;
        const payload = JSON.stringify({ model });

        const request = transport.request(
            target,
            {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (c: Buffer) => chunks.push(c));
                response.on('end', () => {
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                        resolve();
                        return;
                    }
                    let detail = Buffer.concat(chunks).toString('utf8').slice(0, 160);
                    try { detail = JSON.parse(detail).error || detail; } catch { /* as it came */ }
                    reject(new Error(detail || `Ollama answered ${response.statusCode}.`));
                });
            },
        );
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

/** A model as the panel shows it. */
export interface ModelOption {
    id: string;
    /** Marked so the free ones are findable in a list of three hundred. */
    free?: boolean;
    /** Roughly how much it can hold, when the provider says. */
    context?: number;
}

const CODING_FIRST = (models: ModelOption[]): ModelOption[] => {
    // Not a judgement about quality - just that somebody opening this wants to
    // write code, and scrolling past every vision and audio model to find a
    // coder is a poor first minute.
    const score = (id: string) => {
        const name = id.toLowerCase();
        if (/embed|whisper|tts|image|vision|audio|rerank|moderation|guard/.test(name)) return 3;
        if (/coder|code|devstral/.test(name)) return 0;
        if (/sonnet|opus|gpt|flash|pro|large|instruct|chat/.test(name)) return 1;
        return 2;
    };
    return [...models].sort((a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id));
};

async function openAiStyleModels(base: string, key: string, provider: string): Promise<ModelOption[]> {
    const { status, body } = await get(`${base}/models`, key ? { Authorization: `Bearer ${key}` } : {});
    if (status !== 200) {
        throw new Error(`${provider} would not list its models (HTTP ${status}). Check the key.`);
    }
    const data = JSON.parse(body).data || [];
    return CODING_FIRST(data.map((m: { id: string }) => ({ id: m.id })));
}

export async function listModels(
    provider: string,
    key: string,
    ollamaUrl: string,
    lmStudioUrl = 'http://127.0.0.1:1234/v1',
): Promise<ModelOption[]> {
    switch (provider) {
        // Whatever is loaded in LM Studio's local server. It speaks the
        // OpenAI shape, so this is the same call as the cloud hosts with no
        // key and a different address.
        case 'lmstudio':
            return openAiStyleModels(lmStudioUrl.replace(/\/+$/, ''), '', 'LM Studio');

        case '': {
            const { status, body } = await get(`${ollamaUrl.replace(/\/+$/, '')}/api/tags`);
            if (status !== 200) {
                throw new Error('Ollama answered, but not with a model list.');
            }
            const models = JSON.parse(body).models || [];
            return CODING_FIRST(
                models
                    .map((m: { name: string }) => ({ id: m.name }))
                    // An embedding model cannot hold a conversation, and one
                    // picked here fails in a way that reads as a broken agent.
                    .filter((m: ModelOption) => !/embed|bge-|minilm/i.test(m.id)),
            );
        }

        case 'gemini': {
            const { status, body } = await get(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
            if (status !== 200) {
                throw new Error(`Google would not list its models (HTTP ${status}). Check the key.`);
            }
            const models = JSON.parse(body).models || [];
            return CODING_FIRST(
                models
                    .filter((m: { supportedGenerationMethods?: string[] }) =>
                        (m.supportedGenerationMethods || []).includes('generateContent'))
                    .map((m: { name: string }) => ({ id: m.name.split('/').pop() as string })),
            );
        }

        case 'anthropic': {
            const { status, body } = await get('https://api.anthropic.com/v1/models', {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
            });
            if (status !== 200) {
                throw new Error(`Anthropic would not list its models (HTTP ${status}). Check the key.`);
            }
            return CODING_FIRST((JSON.parse(body).data || []).map((m: { id: string }) => ({ id: m.id })));
        }

        case 'openrouter': {
            const { status, body } = await get('https://openrouter.ai/api/v1/models',
                key ? { Authorization: `Bearer ${key}` } : {});
            if (status !== 200) {
                throw new Error(`OpenRouter would not list its models (HTTP ${status}).`);
            }
            const data = JSON.parse(body).data || [];
            return CODING_FIRST(data.map((m: { id: string; pricing?: { prompt?: string }; context_length?: number }) => ({
                id: m.id,
                free: String(m.pricing?.prompt ?? '') === '0' || m.id.endsWith(':free'),
                context: m.context_length,
            })));
        }

        case 'groq': return openAiStyleModels('https://api.groq.com/openai/v1', key, 'Groq');
        case 'openai': return openAiStyleModels('https://api.openai.com/v1', key, 'OpenAI');
        case 'deepseek': return openAiStyleModels('https://api.deepseek.com/v1', key, 'DeepSeek');
        case 'nvidia': return openAiStyleModels('https://integrate.api.nvidia.com/v1', key, 'NVIDIA');
        case 'cerebras': return openAiStyleModels('https://api.cerebras.ai/v1', key, 'Cerebras');
        case 'mistral': return openAiStyleModels('https://api.mistral.ai/v1', key, 'Mistral');
        case 'together': return openAiStyleModels('https://api.together.xyz/v1', key, 'Together');
        case 'cohere': return openAiStyleModels('https://api.cohere.ai/compatibility/v1', key, 'Cohere');
        case 'siliconflow': return openAiStyleModels('https://api.siliconflow.cn/v1', key, 'SiliconFlow');
        default: throw new Error(`${provider} is not a provider this knows.`);
    }
}
