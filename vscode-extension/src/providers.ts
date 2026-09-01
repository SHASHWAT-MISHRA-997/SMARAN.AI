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
    hint: string;
}

export const PROVIDERS: Provider[] = [
    {
        id: '', label: 'Ollama (on this machine)',
        hint: 'No key, nothing leaves your computer. Needs Ollama installed.',
    },
    {
        id: 'groq', label: 'Groq', keyUrl: 'https://console.groq.com/keys', free: true,
        hint: 'Free tier. Fast.',
    },
    {
        id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', free: true,
        hint: 'Free tier.',
    },
    {
        id: 'openrouter', label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', free: true,
        hint: 'Many models behind one key, several free.',
    },
    {
        id: 'nvidia', label: 'NVIDIA NIM', keyUrl: 'https://build.nvidia.com/', free: true,
        hint: 'Free developer tier.',
    },
    {
        id: 'anthropic', label: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/settings/keys',
        hint: 'Paid.',
    },
    {
        id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys',
        hint: 'Paid.',
    },
    {
        id: 'deepseek', label: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys',
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
): Promise<ModelOption[]> {
    switch (provider) {
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
        default: throw new Error(`${provider} is not a provider this knows.`);
    }
}
