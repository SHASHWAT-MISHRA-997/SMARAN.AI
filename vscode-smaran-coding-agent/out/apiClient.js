"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmaranApiClient = void 0;
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
class SmaranApiClient {
    /**
     * Locate the running SMARAN.AI engine.
     *
     * The desktop app binds whatever port is free and publishes it to
     * `%LOCALAPPDATA%/SMARAN.AI/data/runtime.json`, so it is read first. An
     * explicit `smaran.backendUrl` setting always wins, and a fixed default is
     * the last resort for the container deployment.
     */
    getBaseUrl() {
        const configured = vscode.workspace
            .getConfiguration('smaran')
            .get('backendUrl');
        if (configured && configured.trim()) {
            return configured.trim().replace(/\/+$/, '');
        }
        const discovered = SmaranApiClient.discoverRunningApp();
        return discovered || 'http://localhost:3003';
    }
    /** Read the port advertised by a running desktop app, if there is one. */
    static discoverRunningApp() {
        try {
            // Required lazily so the module still loads where these are unavailable.
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const roots = [
                process.env.LOCALAPPDATA, // Windows
                path.join(os.homedir(), 'Library', 'Application Support'), // macOS
                path.join(os.homedir(), '.local', 'share'), // Linux
                os.homedir(),
            ].filter(Boolean);
            for (const root of roots) {
                const candidate = path.join(root, 'SMARAN.AI', 'data', 'runtime.json');
                if (!fs.existsSync(candidate)) {
                    continue;
                }
                const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (!parsed || typeof parsed.port !== 'number') {
                    continue;
                }
                // The file survives a crash or a force-quit, and a stale advert sends
                // every request to a dead port where it sits until it times out.
                // Signal 0 does not kill anything; it only asks whether the process
                // is still there.
                if (typeof parsed.pid === 'number') {
                    try {
                        process.kill(parsed.pid, 0);
                    }
                    catch (err) {
                        // ESRCH means no such process. EPERM means it exists but belongs
                        // to someone else, which still counts as running.
                        if (err && err.code === 'ESRCH') {
                            continue;
                        }
                    }
                }
                return `http://127.0.0.1:${parsed.port}`;
            }
        }
        catch (_) {
            // Discovery is best effort; fall through to the default.
        }
        return null;
    }
    /** Keys the desktop app already holds, so they need not be typed twice.
     *
     * Without this the extension only worked while the app was running: the
     * keys lived in the app's data directory and VS Code knew nothing about
     * them, so closing the app took the assistant with it. Reading them here
     * means the editor can talk to the same providers on its own.
     *
     * Anything set in VS Code settings wins, so a workspace can deliberately
     * point somewhere else.
     */
    static desktopKeys() {
        try {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const roots = [
                process.env.LOCALAPPDATA,
                path.join(os.homedir(), 'Library', 'Application Support'),
                path.join(os.homedir(), '.local', 'share'),
                os.homedir(),
            ].filter(Boolean);
            for (const root of roots) {
                const candidate = path.join(root, 'SMARAN.AI', 'data', 'cloud_keys.json');
                if (!fs.existsSync(candidate)) {
                    continue;
                }
                const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    // Only strings, and only non-empty ones: a blank entry should fall
                    // through to the next provider rather than being tried and failing.
                    const keys = {};
                    for (const [name, value] of Object.entries(parsed)) {
                        if (typeof value === 'string' && value.trim()) {
                            keys[name] = value.trim();
                        }
                    }
                    return keys;
                }
            }
        }
        catch (_) {
            // Best effort. No keys simply means the provider chain is shorter.
        }
        return {};
    }
    async getModels() {
        try {
            // The backend exposes the catalog under /api/models/catalog; a bare
            // /api/models has never existed, so this always fell through to the
            // hardcoded list below.
            const url = `${this.getBaseUrl()}/api/models/catalog`;
            const res = await this.fetchJson(url);
            const entries = Array.isArray(res) ? res : (res?.models || res?.catalog);
            if (Array.isArray(entries) && entries.length) {
                return entries.map((m) => ({
                    id: m.id || m.name,
                    name: m.name || m.id,
                    provider: m.company || m.provider || 'Multi-LLM'
                }));
            }
        }
        catch {
            // The catalogue is optional: the built-in list below is a real
            // fallback, not a guess, so a failed fetch is not worth surfacing.
        }
        // Offline fallback. Every id here is a real, currently published model:
        // the previous list advertised models that do not exist, which is what
        // produced "Repository Not Found" when one of them was selected.
        return [
            { id: 'auto', name: '⚡ Auto (use an available configured route)', provider: 'Dynamic' },
            { id: 'deepseek/deepseek-r1', name: '🧠 DeepSeek R1 (configured provider required)', provider: 'DeepSeek' },
            { id: 'deepseek/deepseek-chat', name: '🤖 DeepSeek Chat (configured provider required)', provider: 'DeepSeek' },
            { id: 'groq/llama-3.3-70b-versatile', name: '⚡ Groq LLaMA 3.3 70B (Groq key required)', provider: 'Groq' },
            { id: 'google/gemini-flash', name: '✨ Gemini Flash (Gemini key required)', provider: 'Google' },
            { id: 'openrouter/free', name: '🟢 OpenRouter free route (availability varies)', provider: 'OpenRouter' },
            { id: 'meta/llama-3.1-8b-instruct', name: '⚡ NVIDIA LLaMA 3.1 8B (NVIDIA key required)', provider: 'NVIDIA' },
            { id: 'claude-3-5-sonnet', name: '🧠 Claude (Anthropic or OpenRouter key required)', provider: 'Anthropic' },
            { id: 'qwen2.5-coder', name: '⚡ Qwen 2.5 Coder (installed Ollama model required)', provider: 'Local / Ollama' }
        ];
    }
    async askAgent(prompt, contextFiles, model = 'auto', onToken, responseLanguage = 'en') {
        const baseUrl = this.getBaseUrl();
        const config = vscode.workspace.getConfiguration('smaran');
        const apiKeys = { ...SmaranApiClient.desktopKeys(), ...(config.get('apiKeys') || {}) };
        const supportedLanguages = new Set(['en', 'hi', 'gu', 'pa', 'mr', 'ta', 'te', 'ml', 'kn', 'bn']);
        const targetLanguage = supportedLanguages.has(responseLanguage) ? responseLanguage : 'en';
        const payload = {
            session_id: `vscode-${Date.now()}`,
            prompt: prompt,
            model: model,
            collections: [],
            rag_enabled: false,
            web_search: true,
            target_language: targetLanguage,
            context_files: contextFiles || [],
            enable_headroom: config.get('enableHeadroomCompression', true)
        };
        // 1. Use a running SMARAN.AI app when there is one. The extension does not
        // depend on it: if no app is configured or advertising itself, this step is
        // skipped entirely rather than stalling on a connection that cannot succeed.
        // Why each route declined, so a failure can name the reason instead of
        // presenting silence as an answer.
        const refusals = [];
        const appIsAvailable = Boolean(config.get('backendUrl')?.trim()) ||
            SmaranApiClient.discoverRunningApp() !== null;
        if (appIsAvailable) {
            try {
                return await this._callLocalBackend(baseUrl, payload, onToken);
            }
            catch (localErr) {
                // App unreachable - continue with the user's own provider key or
                // Ollama, but record why so a later failure can say what happened.
                refusals.push(`SMARAN.AI app: ${localErr?.message || localErr}`);
            }
        }
        // 2. Check user-configured API Keys
        const openRouterKey = apiKeys.openRouter || apiKeys.openrouter;
        const groqKey = apiKeys.groq;
        const geminiKey = apiKeys.gemini || apiKeys.google;
        const nvidiaKey = apiKeys.nvidia || apiKeys.nvidiaNim;
        const deepseekKey = apiKeys.deepseek;
        const anthropicKey = apiKeys.anthropic;
        const openaiKey = apiKeys.openai;
        if (groqKey && (model.startsWith('groq') || model === 'auto')) {
            try {
                return await this._callGroqDirect(groqKey, prompt, model, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (openRouterKey) {
            try {
                return await this._callOpenRouterDirect(openRouterKey, prompt, model, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (groqKey) {
            try {
                return await this._callGroqDirect(groqKey, prompt, model, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (geminiKey) {
            try {
                return await this._callGeminiDirect(geminiKey, prompt, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (nvidiaKey) {
            try {
                return await this._callNvidiaDirect(nvidiaKey, prompt, model, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (deepseekKey) {
            try {
                return await this._callDeepSeekDirect(deepseekKey, prompt, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (anthropicKey) {
            try {
                return await this._callAnthropicDirect(anthropicKey, prompt, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        if (openaiKey) {
            try {
                return await this._callOpenAIDirect(openaiKey, prompt, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
        }
        // 3. Local Ollama, if the user is running one on port 11434.
        {
            try {
                return await this._callLocalOllama(prompt, contextFiles, onToken);
            }
            catch (err) {
                refusals.push(String(err?.message || err));
            }
            // A configured route that failed is a different problem from no route at
            // all, and they need different advice. Telling someone nothing is
            // configured when their key was merely rejected sends them to re-enter a
            // key that was never the issue.
            if (refusals.length) {
                throw new Error('Every configured route refused this request:\n' +
                    refusals.map((r) => '  - ' + r).join('\n') + '\n\n' +
                    "These are the providers' own messages, not a guess. A rejected key, " +
                    'an exhausted free quota and an unknown model all read differently above.');
            }
            throw new Error('No AI engine is configured yet. Add your own provider key in VS Code ' +
                'Settings under "SMARAN.AI: Api Keys" — Groq, Google Gemini and ' +
                'OpenRouter all offer free tiers, and Claude, OpenAI or DeepSeek keys ' +
                'work too. A local Ollama on port 11434, or an open SMARAN.AI app, is ' +
                'also used automatically when present. Nothing was fabricated.');
        }
    }
    /**
     * The provider's answer, or the provider's own reason for not giving one.
     *
     * Every one of these APIs reports failure as valid JSON with an `error`
     * object and no `choices`. Reaching for the content and falling back to a
     * string turned that into a successful reply reading 'No response': the
     * real message - 'User not found', 'insufficient credits', 'model not
     * found' - was discarded, and because the call resolved rather than threw,
     * the next provider in the chain was never tried.
     */
    static _contentOrThrow(provider, status, raw, content) {
        if (typeof content === 'string' && content.trim())
            return content;
        let reason = '';
        try {
            const parsed = JSON.parse(raw);
            reason =
                parsed?.error?.message ||
                    parsed?.error?.type ||
                    (typeof parsed?.error === 'string' ? parsed.error : '') ||
                    parsed?.message ||
                    '';
        }
        catch {
            reason = raw.slice(0, 200);
        }
        const code = status && status >= 400 ? ` (HTTP ${status})` : '';
        throw new Error(`${provider}${code}: ${reason || 'returned no content'}`);
    }
    _callLocalBackend(baseUrl, payload, onToken) {
        const url = `${baseUrl}/api/chat`;
        return new Promise((resolve, reject) => {
            try {
                const u = new URL(url);
                const isHttps = u.protocol === 'https:';
                const client = isHttps ? https : http;
                const bodyData = JSON.stringify(payload);
                const req = client.request({
                    hostname: u.hostname,
                    port: u.port || (isHttps ? 443 : 80),
                    path: u.pathname + u.search,
                    method: 'POST',
                    timeout: 5000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(bodyData),
                        'X-Client': 'SMARAN-Coding-Agent-IDE'
                    }
                }, (res) => {
                    let accumulatedText = '';
                    let lineBuffer = '';
                    res.on('data', (chunk) => {
                        lineBuffer += chunk.toString();
                        const lines = lineBuffer.split('\n');
                        lineBuffer = lines.pop() || '';
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed)
                                continue;
                            try {
                                const data = JSON.parse(trimmed);
                                if (data.token !== undefined) {
                                    accumulatedText += data.token;
                                    if (onToken)
                                        onToken(data.token);
                                }
                                else if (data.response || data.translated_response || data.content) {
                                    const finalMsg = data.translated_response || data.response || data.content;
                                    if (!accumulatedText)
                                        accumulatedText = finalMsg;
                                }
                            }
                            catch (_) {
                                accumulatedText += trimmed;
                                if (onToken)
                                    onToken(trimmed);
                            }
                        }
                    });
                    res.on('end', () => {
                        if (lineBuffer.trim()) {
                            try {
                                const data = JSON.parse(lineBuffer.trim());
                                if (data.token !== undefined)
                                    accumulatedText += data.token;
                                else if (data.response || data.translated_response || data.content) {
                                    accumulatedText = data.translated_response || data.response || data.content;
                                }
                            }
                            catch (_) {
                                accumulatedText += lineBuffer.trim();
                            }
                        }
                        resolve(accumulatedText.trim() || 'No response received from SMARAN.AI');
                    });
                });
                req.on('error', (err) => reject(err));
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Connection timed out'));
                });
                req.write(bodyData);
                req.end();
            }
            catch (err) {
                reject(err);
            }
        });
    }
    _callLocalOllama(prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let fullPrompt = prompt;
            if (contextFiles && contextFiles.length > 0) {
                fullPrompt = "Workspace Context:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n') + "\n\nTask: " + prompt;
            }
            const body = JSON.stringify({
                model: "qwen2.5-coder",
                prompt: fullPrompt,
                stream: false
            });
            const req = http.request({
                hostname: "localhost",
                port: 11434,
                path: "/api/generate",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                },
                timeout: 8000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(SmaranApiClient._contentOrThrow('Local Ollama', res.statusCode, data, parsed.response));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    _callGroqDirect(apiKey, prompt, model = 'auto', contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            let groqModel = "llama-3.3-70b-versatile";
            if (model.includes('r1') || model.includes('reasoning')) {
                groqModel = "deepseek-r1-distill-llama-70b";
            }
            const body = JSON.stringify({
                model: groqModel,
                messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2
            });
            const req = https.request({
                hostname: "api.groq.com",
                path: "/openai/v1/chat/completions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('Groq', res.statusCode, data, parsed.choices?.[0]?.message?.content);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`Groq API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    /**
     * NVIDIA NIM — an OpenAI-compatible endpoint with a free developer tier.
     *
     * Its catalogue advertises models the chat endpoint will not serve, so an
     * instruction-tuned model is requested explicitly rather than guessed.
     */
    _callNvidiaDirect(apiKey, prompt, model = 'auto', contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const nvidiaModel = model.startsWith('nvidia/') || model.startsWith('meta/')
                ? model
                : 'meta/llama-3.1-8b-instruct';
            const body = JSON.stringify({
                model: nvidiaModel,
                messages: [
                    { role: 'system', content: sysMsg },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                max_tokens: 4096
            });
            const req = https.request({
                hostname: 'integrate.api.nvidia.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 120000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const answer = parsed.choices?.[0]?.message?.content;
                        if (!answer) {
                            reject(new Error(`NVIDIA returned no answer (HTTP ${res.statusCode}).`));
                            return;
                        }
                        if (onToken)
                            onToken(answer);
                        resolve(answer);
                    }
                    catch (e) {
                        reject(new Error(`NVIDIA API error (HTTP ${res.statusCode}).`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('NVIDIA request timed out')); });
            req.write(body);
            req.end();
        });
    }
    /**
     * A model OpenRouter is currently giving away.
     *
     * The slug used to be written into this file and it went stale: OpenRouter
     * moved meta-llama/llama-3.3-70b-instruct:free onto its paid tier and every
     * request came back "This model is unavailable for free". Any hardcoded name
     * has the same fate waiting for it, so the catalogue is asked instead. It
     * needs no key.
     *
     * Cached for an hour: the list changes over days, and fetching it per
     * message would add a round trip to every reply.
     */
    static _freeModel = null;
    // Free in the catalogue is not the same as usable with this key. The
    // highest-context free model was thinkingmachines/inkling-small:free, which
    // answers 403 "only available on agentic harnesses". Nothing in the
    // catalogue row marks it — the :free entry carries the same fields as any
    // other, checked against the live API rather than assumed — so the only way
    // to know is to be refused, and then to remember.
    static _rejectedModels = new Set();
    /** Free models the catalogue offers, best first, minus any that refused us. */
    async _freeOpenRouterModels() {
        const cached = SmaranApiClient._freeModel;
        if (cached && Date.now() - cached.at < 3600000) {
            return cached.ids.filter((id) => !SmaranApiClient._rejectedModels.has(id));
        }
        const catalogue = await new Promise((resolve) => {
            const req = https.request({
                hostname: 'openrouter.ai',
                path: '/api/v1/models',
                method: 'GET',
                headers: { 'User-Agent': 'SMARAN.AI' },
            }, (res) => {
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(15000, () => { req.destroy(); resolve(null); });
            req.end();
        });
        const rows = catalogue?.data;
        if (!Array.isArray(rows))
            return [];
        // Zero on both sides, not just the prompt: a model that is free to send to
        // and charges for what it writes is not a free model.
        //
        // And it has to answer in text and nothing else. google/lyria-3-pro-preview
        // is free and ranked fourth, but Lyria writes music; its row reads
        // output_modalities ["text", "audio"], so merely requiring "text" let it
        // through. A model for editing code emits text alone — checked against the
        // live catalogue, not inferred from the name.
        const free = rows.filter((m) => {
            const p = m?.pricing || {};
            if (!(Number(p.prompt) === 0 && Number(p.completion) === 0))
                return false;
            const out = m?.architecture?.output_modalities;
            if (!Array.isArray(out))
                return true;
            return out.length === 1 && out[0] === 'text';
        });
        // Largest context first, which copes best with a file's worth of
        // workspace context. The whole list is kept, not just the winner, so a
        // refusal has somewhere to go.
        free.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
        const ids = free.map((m) => String(m.id));
        SmaranApiClient._freeModel = { ids, at: Date.now() };
        return ids.filter((id) => !SmaranApiClient._rejectedModels.has(id));
    }
    async _callOpenRouterDirect(apiKey, prompt, model = 'auto', contextFiles, onToken) {
        // A free model can still refuse this key — inkling-small:free answers 403
        // "only available on agentic harnesses", and nothing in the catalogue
        // says so. Walk the ranked list, remembering each refusal, so one gated
        // model at the top does not sink the whole route.
        const candidates = await this._freeOpenRouterModels();
        const attempts = model === 'auto' || !model
            ? candidates.slice(0, 4)
            : [candidates[0]];
        let lastError = null;
        for (const candidate of attempts.length ? attempts : [undefined]) {
            try {
                return await this._openRouterOnce(apiKey, prompt, model, candidate, contextFiles, onToken);
            }
            catch (e) {
                lastError = e;
                const text = String(e?.message || '');
                // 403 and 404 are about this model, so try the next one. Anything
                // else — a bad key, a network failure — would fail identically for
                // every model, and retrying would just be slower.
                const modelSpecific = /\b(403|404)\b/.test(text);
                if (!modelSpecific)
                    throw e;
                if (candidate)
                    SmaranApiClient._rejectedModels.add(candidate);
            }
        }
        throw lastError || new Error('OpenRouter refused every free model it offers.');
    }
    _openRouterOnce(apiKey, prompt, model, discovered, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            // Whatever the catalogue says is free today. The named fallback is
            // only for when the catalogue could not be read at all.
            let targetModel = discovered || "meta-llama/llama-3.3-70b-instruct";
            if (model.includes('deepseek-r1') || model.includes('r1')) {
                targetModel = "deepseek/deepseek-r1:free";
            }
            else if (model.includes('deepseek-v4') || model.includes('deepseek')) {
                targetModel = "deepseek/deepseek-chat";
            }
            else if (model.includes('gemini')) {
                targetModel = "google/gemini-3.6-flash";
            }
            else if (model.includes('nemotron')) {
                targetModel = "nvidia/llama-3.1-nemotron-70b-instruct:free";
            }
            else if (model.includes('claude')) {
                targetModel = "anthropic/claude-3.5-sonnet";
            }
            const body = JSON.stringify({
                model: targetModel,
                messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt }
                ]
            });
            const req = https.request({
                hostname: "openrouter.ai",
                path: "/api/v1/chat/completions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                    "HTTP-Referer": "https://smaran-ai.netlify.app",
                    "X-Title": "SMARAN AI Coder"
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('OpenRouter', res.statusCode, data, parsed.choices?.[0]?.message?.content);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`OpenRouter API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    _callGeminiDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let fullPrompt = prompt;
            if (contextFiles && contextFiles.length > 0) {
                fullPrompt = "Workspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n') + "\n\nUser Task:\n" + prompt;
            }
            const body = JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }]
            });
            const req = https.request({
                hostname: "generativelanguage.googleapis.com",
                path: `/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('Google Gemini', res.statusCode, data, parsed.candidates?.[0]?.content?.parts?.[0]?.text);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`Gemini API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    _callDeepSeekDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const body = JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt }
                ]
            });
            const req = https.request({
                hostname: "api.deepseek.com",
                path: "/chat/completions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('DeepSeek', res.statusCode, data, parsed.choices?.[0]?.message?.content);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`DeepSeek API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    _callAnthropicDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const body = JSON.stringify({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4096,
                system: sysMsg,
                messages: [{ role: "user", content: prompt }]
            });
            const req = https.request({
                hostname: "api.anthropic.com",
                path: "/v1/messages",
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('Anthropic', res.statusCode, data, parsed.content?.[0]?.text);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`Anthropic API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    _callOpenAIDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const body = JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: sysMsg },
                    { role: "user", content: prompt }
                ]
            });
            const req = https.request({
                hostname: "api.openai.com",
                path: "/v1/chat/completions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = SmaranApiClient._contentOrThrow('OpenAI', res.statusCode, data, parsed.choices?.[0]?.message?.content);
                        if (onToken)
                            onToken(ans);
                        resolve(ans);
                    }
                    catch (e) {
                        reject(new Error(`OpenAI API Error: ${data}`));
                    }
                });
            });
            req.on('error', e => reject(e));
            req.write(body);
            req.end();
        });
    }
    fetchJson(url) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const isHttps = u.protocol === 'https:';
            const client = isHttps ? https : http;
            client.get({
                hostname: u.hostname,
                port: u.port || (isHttps ? 443 : 80),
                path: u.pathname + u.search,
                timeout: 3000,
                headers: { 'Accept': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).on('error', (e) => reject(e));
        });
    }
}
exports.SmaranApiClient = SmaranApiClient;
//# sourceMappingURL=apiClient.js.map