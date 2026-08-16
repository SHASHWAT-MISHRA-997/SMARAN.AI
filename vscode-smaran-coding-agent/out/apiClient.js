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
    getBaseUrl() {
        const config = vscode.workspace.getConfiguration('smaran');
        return config.get('backendUrl') || 'http://localhost:3003';
    }
    async getModels() {
        try {
            const url = `${this.getBaseUrl()}/api/models`;
            const res = await this.fetchJson(url);
            if (Array.isArray(res)) {
                return res.map((m) => ({
                    id: m.id || m.name,
                    name: m.name || m.id,
                    provider: m.provider || 'Multi-LLM'
                }));
            }
        }
        catch (_) { }
        return [
            { id: 'auto', name: '⚡ Auto-Combo (Multi-LLM Dynamic Selection)', provider: 'Dynamic' },
            { id: 'deepseek/deepseek-v4-pro', name: '🤖 DeepSeek V4 Pro (671B MoE)', provider: 'DeepSeek' },
            { id: 'deepseek/deepseek-r1', name: '🧠 DeepSeek R1 Reasoning', provider: 'DeepSeek' },
            { id: 'groq/llama-3.3-70b', name: '⚡ Groq Cloud (500+ T/s Ultra-Fast)', provider: 'Groq' },
            { id: 'openrouter/free', name: '🟢 OpenRouter Free Routes', provider: 'OpenRouter' },
            { id: 'google/gemini-2.5-flash', name: '✨ Gemini 2.5 Flash Free', provider: 'Google' },
            { id: 'nvidia/nemotron-3-ultra-70b', name: '⚡ Nemotron 3 Ultra 70B', provider: 'Nvidia' },
            { id: 'claude-3-5-sonnet', name: '🧠 Claude 3.5 Sonnet / Opus', provider: 'Anthropic' },
            { id: 'qwen2.5-coder', name: '⚡ Qwen 2.5 Coder 32B', provider: 'Local / Ollama' }
        ];
    }
    async askAgent(prompt, contextFiles, model = 'auto', onToken) {
        const baseUrl = this.getBaseUrl();
        const config = vscode.workspace.getConfiguration('smaran');
        const apiKeys = config.get('apiKeys') || {};
        const payload = {
            session_id: `vscode-${Date.now()}`,
            prompt: prompt,
            model: model,
            collections: [],
            rag_enabled: false,
            web_search: false,
            context_files: contextFiles || [],
            enable_headroom: config.get('enableHeadroomCompression', true)
        };
        // 1. Attempt connection to Local SMARAN.AI Desktop backend
        try {
            return await this._callLocalBackend(baseUrl, payload, onToken);
        }
        catch (localErr) {
            // 2. If local backend is offline, check if user has configured cloud API keys (Groq or OpenRouter)
            if (apiKeys.groq && (model.startsWith('groq') || model === 'auto')) {
                return await this._callGroqDirect(apiKeys.groq, prompt, contextFiles, onToken);
            }
            if (apiKeys.openRouter && (model.startsWith('openrouter') || model === 'auto')) {
                return await this._callOpenRouterDirect(apiKeys.openRouter, prompt, contextFiles, onToken);
            }
            throw new Error(`SMARAN.AI Desktop is not currently running on ${baseUrl}.\n\n` +
                `💡 To resolve:\n` +
                `1. Start SMARAN.AI Desktop by running SMARAN_AI.exe or Docker (port 3003)\n` +
                `2. Or click Settings (⚙️) above and enter a Groq or OpenRouter API Key for direct cloud inference.`);
        }
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
    _callGroqDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, an autonomous senior AI coding assistant and pair programmer.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const body = JSON.stringify({
                model: "llama-3.3-70b-versatile",
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
                        const ans = parsed.choices?.[0]?.message?.content || "No response";
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
    _callOpenRouterDirect(apiKey, prompt, contextFiles, onToken) {
        return new Promise((resolve, reject) => {
            let sysMsg = "You are SMARAN.AI, an autonomous senior AI coding assistant.";
            if (contextFiles && contextFiles.length > 0) {
                sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
            }
            const body = JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
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
                    "Content-Length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const ans = parsed.choices?.[0]?.message?.content || "No response";
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