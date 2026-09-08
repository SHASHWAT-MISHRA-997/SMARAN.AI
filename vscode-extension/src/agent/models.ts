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
    /**
     * Pictures attached to this turn, base64 with their type.
     *
     * Every provider takes them in a different shape and the four shapes are
     * handled below. A model that cannot see will say so in its own words -
     * that is better than this file keeping a list of which models have eyes,
     * which would be wrong within a month.
     */
    images?: { data: string; mime: string }[];
}

export interface Choice {
    provider: string;
    model: string;
    apiKey: string;
    ollamaUrl: string;
    /** Where LM Studio's local server is, when that is the provider. */
    lmStudioUrl?: string;
}

export interface NativeTool {
    type: 'function';
    function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, { type: 'string' }>; required: string[] } };
}
export const NATIVE_CALL_PREFIX = 'SMARAN_TOOL_CALL_JSON\n';

export const OPENAI_COMPATIBLE: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
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

/** The OpenAI content-parts shape, used only when there is a picture. */
function toOpenAiMessage(message: Message): unknown {
    if (!message.images?.length) {
        return { role: message.role, content: message.content };
    }
    return {
        role: message.role,
        content: [
            { type: 'text', text: message.content },
            ...message.images.map((image) => ({
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${image.data}` },
            })),
        ],
    };
}

async function openAiStyle(base: string, choice: Choice, messages: Message[], tools?: NativeTool[]): Promise<string> {
    // Native calls must be returned to the provider as assistant/tool pairs,
    // with the original call id. Plain user text is not a tool result and
    // some models repeat the same action indefinitely when it is used.
    let pendingCall: string | undefined;
    const wireMessages = messages.map((message, index) => {
        if (tools?.length && message.role === 'assistant' && message.content.startsWith(NATIVE_CALL_PREFIX)) {
            const call = JSON.parse(message.content.slice(NATIVE_CALL_PREFIX.length));
            pendingCall = call.id || `smaran_call_${index}`;
            return { role: 'assistant', content: null, tool_calls: [{ id: pendingCall, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
        }
        if (pendingCall && message.role === 'user' && message.content.startsWith('Result of ')) {
            const id = pendingCall;
            pendingCall = undefined;
            return { role: 'tool', tool_call_id: id, content: message.content };
        }
        pendingCall = undefined;
        return toOpenAiMessage(message);
    });
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
        {
            model: choice.model,
            messages: wireMessages,
            temperature: 0.2,
            max_tokens: 4096,
            ...(tools?.length ? { tools, parallel_tool_calls: false } : {}),
        },
        choice.apiKey ? { Authorization: `Bearer ${choice.apiKey}` } : {},
    );
    // Some OpenRouter routes expose text-only models. Fall back only when the
    // provider explicitly rejects function tools, never for auth/rate limits.
    if (tools?.length && [400, 404, 422].includes(status)
        && /(?:tool|function)[\s\S]{0,100}(?:not supported|unsupported|not available)|(?:not support|unsupported)[\s\S]{0,100}(?:tool|function)|no endpoints found[^\n]*tool/i.test(body)) {
        return openAiStyle(base, choice, messages.map(message => message.role === 'system'
            ? { ...message, content: message.content + '\nThis route has no native tools. Use the documented text tool_call tags for all actions.' }
            : message));
    }
    const data = contentOrThrow(choice.provider, status, body) as {
        choices?: {
            finish_reason?: string;
            message?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] };
        }[];
    };
    const choiceOut = data.choices?.[0];
    const message = choiceOut?.message;
    if (choiceOut?.finish_reason === 'error' || choiceOut?.finish_reason === 'content_filter') {
        throw new Error(`${choice.model} could not complete its response (${choiceOut.finish_reason}). Try another model or retry the task.`);
    }
    if (message?.tool_calls?.length) {
        if (message.tool_calls.length !== 1 || choiceOut?.finish_reason === 'length') {
            throw new Error('The provider returned multiple or incomplete tool calls. Retry with one complete action per step.');
        }
        const call = message.tool_calls[0].function;
        const args = JSON.parse(call?.arguments || '{}');
        if (!call?.name || !args || typeof args !== 'object' || Array.isArray(args)) {
            throw new Error('The provider returned an invalid tool call.');
        }
        const id = message.tool_calls[0].id;
        return NATIVE_CALL_PREFIX + JSON.stringify({ name: call.name, args, ...(id ? { id } : {}) });
    }
    // Reasoning can arrive before a provider fails. It is not a completed
    // answer or an executable tool call and must not end the run as success.
    const text = (message?.content || '').trim();
    if (text) return text;

    /* Still nothing. Saying so is the whole point - silence reads as the
     * extension being broken, and the reason is usually one of these two. */
    if (choiceOut?.finish_reason === 'length') {
        throw new Error(
            `${choice.model} used its whole budget before writing anything. `
            + 'Try a different model, or a shorter question.');
    }
    if (message?.reasoning_content || message?.reasoning) {
        throw new Error(`${choice.model} returned reasoning without a final answer. Retry the task or choose another model.`);
    }
    throw new Error(
        `${choice.model} returned an empty reply. That model may not be usable `
        + 'through this provider - pick another from the chip beside Send.');
}

async function gemini(choice: Choice, messages: Message[]): Promise<string> {
    // Gemini keeps the system prompt separately and calls the assistant
    // "model", so the conversation is rewritten rather than passed on.
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [
                { text: m.content },
                // Gemini calls it inline_data, and wants the base64 bare.
                ...(m.images || []).map((image) => ({
                    inline_data: { mime_type: image.mime, data: image.data },
                })),
            ],
        }));

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

/** Anthropic wants each picture as its own content block with a source. */
function toAnthropicMessage(message: Message): unknown {
    if (!message.images?.length) {
        return { role: message.role, content: message.content };
    }
    return {
        role: message.role,
        content: [
            { type: 'text', text: message.content },
            ...message.images.map((image) => ({
                type: 'image',
                source: { type: 'base64', media_type: image.mime, data: image.data },
            })),
        ],
    };
}

async function anthropic(choice: Choice, messages: Message[]): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const payload: Record<string, unknown> = {
        model: choice.model,
        messages: messages.filter((m) => m.role !== 'system').map(toAnthropicMessage),
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
            // Ollama takes pictures as a bare base64 array on the message.
            messages: messages.map((m) => (m.images?.length
                ? { role: m.role, content: m.content, images: m.images.map((i) => i.data) }
                : { role: m.role, content: m.content })),
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

export async function complete(messages: Message[], choice: Choice, tools?: NativeTool[]): Promise<string> {
    const call = async (): Promise<string> => {
        // LM Studio speaks the OpenAI shape too; it just lives on this machine
        // and its address is a setting rather than a constant.
        if (choice.provider === 'lmstudio') {
            return openAiStyle(
                choice.lmStudioUrl || 'http://127.0.0.1:1234/v1', choice, messages);
        }
        if (choice.provider in OPENAI_COMPATIBLE) {
            return openAiStyle(OPENAI_COMPATIBLE[choice.provider], choice, messages, choice.provider === 'openrouter' ? tools : undefined);
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
