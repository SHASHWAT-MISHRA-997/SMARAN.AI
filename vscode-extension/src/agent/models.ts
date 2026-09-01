/**
 * One reply, from whichever model the settings point at.
 *
 * Three shapes cover everything reachable:
 *
 *   OpenAI-compatible  OpenAI, Groq, OpenRouter, DeepSeek, NVIDIA, LM Studio,
 *                      vLLM - one request shape, many hosts
 *   Gemini             different enough to need its own call
 *   Anthropic          likewise, and the system prompt sits outside the
 *                      message list
 *
 * Plus Ollama, for a model on this machine and no key at all.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface Choice {
    provider: string;
    model: string;
    apiKey: string;
    ollamaUrl: string;
    /** Where LM Studio's local server is, when that is the provider. */
    lmStudioUrl?: string;
}

export const OPENAI_COMPATIBLE: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    ollamacloud: 'https://ollama.com/v1',
    cerebras: 'https://api.cerebras.ai/v1',
    mistral: 'https://api.mistral.ai/v1',
    together: 'https://api.together.xyz/v1',
    cohere: 'https://api.cohere.ai/compatibility/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
};

/** Answered while busy; worth waiting out once. Refused is not. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const TIMEOUT_MS = 300_000;

function post(url: string, payload: unknown, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'https:' ? https : http;
        const data = JSON.stringify(payload);
        const request = transport.request(
            target,
            {
                method: 'POST',
                timeout: TIMEOUT_MS,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    ...headers,
                },
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(chunk as Buffer));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
            },
        );
        request.on('timeout', () => request.destroy(new Error('the model did not answer in time')));
        request.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ECONNREFUSED' && target.port === '11434') {
                reject(new Error(
                    'Ollama is not running on this machine, and no cloud provider is configured. ' +
                    'Start Ollama, or set smaran.provider and a key in smaran.apiKeys.',
                ));
                return;
            }
            reject(error);
        });
        request.write(data);
        request.end();
    });
}

function contentOrThrow(provider: string, status: number, body: string): unknown {
    if (status < 200 || status >= 300) {
        let detail = body.slice(0, 200);
        try {
            const parsed = JSON.parse(body);
            detail = parsed?.error?.message || parsed?.detail || detail;
        } catch { /* the body was not the error shape */ }
        const error = new Error(`${provider} refused the request (HTTP ${status}). ${detail}`);
        (error as Error & { status?: number }).status = status;
        throw error;
    }
    return JSON.parse(body);
}

async function openAiStyle(base: string, choice: Choice, messages: Message[]): Promise<string> {
    const { status, body } = await post(
        `${base.replace(/\/+$/, '')}/chat/completions`,
        /* max_tokens matters more than it looks.
         *
         * Without it a host assumes the model's ceiling and reserves against
         * it. OpenRouter refused outright: "You requested up to 65536 tokens,
         * but can only afford 2845" - on a free account with a small balance,
         * asking for the maximum fails before a single token is generated.
         *
         * 4096 is more than any single step of this agent produces; a whole
         * file being written is well under it. */
        { model: choice.model, messages, temperature: 0.2, max_tokens: 4096 },
        choice.apiKey ? { Authorization: `Bearer ${choice.apiKey}` } : {},
    );
    const data = contentOrThrow(choice.provider, status, body) as {
        choices?: { message?: { content?: string } }[];
    };
    return (data.choices?.[0]?.message?.content || '').trim();
}

async function gemini(choice: Choice, messages: Message[]): Promise<string> {
    // Gemini keeps the system prompt separately and calls the assistant
    // "model", so the conversation is rewritten rather than passed on.
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const payload: Record<string, unknown> = { contents, generationConfig: { temperature: 0.2 } };
    if (system) {
        payload.systemInstruction = { parts: [{ text: system }] };
    }
    const { status, body } = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${choice.model}:generateContent?key=${encodeURIComponent(choice.apiKey)}`,
        payload,
        {},
    );
    const data = contentOrThrow('gemini', status, body) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

async function anthropic(choice: Choice, messages: Message[]): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const payload: Record<string, unknown> = {
        model: choice.model,
        messages: messages.filter((m) => m.role !== 'system'),
        max_tokens: 4096,
        temperature: 0.2,
    };
    if (system) {
        payload.system = system;
    }
    const { status, body } = await post('https://api.anthropic.com/v1/messages', payload, {
        'x-api-key': choice.apiKey,
        'anthropic-version': '2023-06-01',
    });
    const data = contentOrThrow('anthropic', status, body) as {
        content?: { type?: string; text?: string }[];
    };
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
}

async function ollama(choice: Choice, messages: Message[]): Promise<string> {
    const { status, body } = await post(
        `${choice.ollamaUrl.replace(/\/+$/, '')}/api/chat`,
        {
            model: choice.model,
            messages,
            stream: false,
            options: { temperature: 0.2, num_predict: 2048 },
        },
        {},
    );
    const data = contentOrThrow('the local model', status, body) as { message?: { content?: string } };
    return (data.message?.content || '').trim();
}

/** Whatever is installed locally, so an empty model setting still works. */
export async function firstInstalledOllamaModel(ollamaUrl: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const request = http.get(`${ollamaUrl.replace(/\/+$/, '')}/api/tags`, { timeout: 3000 }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (c) => chunks.push(c as Buffer));
            response.on('end', () => {
                try {
                    const models = JSON.parse(Buffer.concat(chunks).toString('utf8')).models || [];
                    const names: string[] = models.map((m: { name: string }) => m.name);
                    // An embedding model cannot hold a conversation, and one
                    // picked here would fail in a way that reads as the agent
                    // being broken.
                    const usable = names.filter((n) => !/embed|bge-|minilm/i.test(n));
                    // A coding model first when there is one; it is the job.
                    resolve(usable.find((n) => /coder|code/i.test(n)) || usable[0]);
                } catch {
                    resolve(undefined);
                }
            });
        });
        request.on('error', () => resolve(undefined));
        request.on('timeout', () => { request.destroy(); resolve(undefined); });
    });
}

export async function complete(messages: Message[], choice: Choice): Promise<string> {
    const call = async (): Promise<string> => {
        // LM Studio speaks the OpenAI shape too; it just lives on this machine
        // and its address is a setting rather than a constant.
        if (choice.provider === 'lmstudio') {
            return openAiStyle(
                choice.lmStudioUrl || 'http://127.0.0.1:1234/v1', choice, messages);
        }
        if (choice.provider in OPENAI_COMPATIBLE) {
            return openAiStyle(OPENAI_COMPATIBLE[choice.provider], choice, messages);
        }
        if (choice.provider === 'gemini') {
            return gemini(choice, messages);
        }
        if (choice.provider === 'anthropic') {
            return anthropic(choice, messages);
        }
        return ollama(choice, messages);
    };

    for (const attempt of [1, 2]) {
        try {
            return await call();
        } catch (error) {
            const status = (error as Error & { status?: number }).status;
            if (attempt === 1 && status && RETRYABLE.has(status)) {
                await new Promise((r) => setTimeout(r, 3000));
                continue;
            }
            throw error;
        }
    }
    throw new Error('No reply.');
}
