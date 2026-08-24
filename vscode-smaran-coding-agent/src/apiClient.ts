import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

export interface SmaranModel {
  id: string;
  name: string;
  provider?: string;
  description?: string;
}

export class SmaranApiClient {
  /**
   * Locate the running SMARAN.AI engine.
   *
   * The desktop app binds whatever port is free and publishes it to
   * `%LOCALAPPDATA%/SMARAN.AI/data/runtime.json`, so it is read first. An
   * explicit `smaran.backendUrl` setting always wins, and a fixed default is
   * the last resort for the container deployment.
   */
  private getBaseUrl(): string {
    const configured = vscode.workspace
      .getConfiguration('smaran')
      .get<string>('backendUrl');
    if (configured && configured.trim()) {
      return configured.trim().replace(/\/+$/, '');
    }

    const discovered = SmaranApiClient.discoverRunningApp();
    return discovered || 'http://localhost:3003';
  }

  /** Read the port advertised by a running desktop app, if there is one. */
  private static discoverRunningApp(): string | null {
    try {
      // Required lazily so the module still loads where these are unavailable.
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const os = require('os') as typeof import('os');

      const roots = [
        process.env.LOCALAPPDATA,                       // Windows
        path.join(os.homedir(), 'Library', 'Application Support'), // macOS
        path.join(os.homedir(), '.local', 'share'),     // Linux
        os.homedir(),
      ].filter(Boolean) as string[];

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
          } catch (err: any) {
            // ESRCH means no such process. EPERM means it exists but belongs
            // to someone else, which still counts as running.
            if (err && err.code === 'ESRCH') {
              continue;
            }
          }
        }

        return `http://127.0.0.1:${parsed.port}`;
      }
    } catch (_) {
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
  private static desktopKeys(): Record<string, string> {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const os = require('os') as typeof import('os');

      const roots = [
        process.env.LOCALAPPDATA,
        path.join(os.homedir(), 'Library', 'Application Support'),
        path.join(os.homedir(), '.local', 'share'),
        os.homedir(),
      ].filter(Boolean) as string[];

      for (const root of roots) {
        const candidate = path.join(root, 'SMARAN.AI', 'data', 'cloud_keys.json');
        if (!fs.existsSync(candidate)) {
          continue;
        }
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          // Only strings, and only non-empty ones: a blank entry should fall
          // through to the next provider rather than being tried and failing.
          const keys: Record<string, string> = {};
          for (const [name, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && value.trim()) {
              keys[name] = value.trim();
            }
          }
          return keys;
        }
      }
    } catch (_) {
      // Best effort. No keys simply means the provider chain is shorter.
    }
    return {};
  }

  public async getModels(): Promise<SmaranModel[]> {
    try {
      // The backend exposes the catalog under /api/models/catalog; a bare
      // /api/models has never existed, so this always fell through to the
      // hardcoded list below.
      const url = `${this.getBaseUrl()}/api/models/catalog`;
      const res = await this.fetchJson(url);
      const entries = Array.isArray(res) ? res : (res?.models || res?.catalog);
      if (Array.isArray(entries) && entries.length) {
        return entries.map((m: any) => ({
          id: m.id || m.name,
          name: m.name || m.id,
          provider: m.company || m.provider || 'Multi-LLM'
        }));
      }
    } catch (_) {}

    // Offline fallback. Every id here is a real, currently published model:
    // the previous list advertised models that do not exist, which is what
    // produced "Repository Not Found" when one of them was selected.
    return [
      { id: 'auto', name: '⚡ Auto (use an available configured route)', provider: 'Dynamic' },
      { id: 'deepseek/deepseek-r1', name: '🧠 DeepSeek R1 (configured provider required)', provider: 'DeepSeek' },
      { id: 'deepseek/deepseek-chat', name: '🤖 DeepSeek Chat (configured provider required)', provider: 'DeepSeek' },
      { id: 'groq/llama-3.3-70b-versatile', name: '⚡ Groq LLaMA 3.3 70B (Groq key required)', provider: 'Groq' },
      { id: 'google/gemini-2.5-flash', name: '✨ Gemini Flash (Gemini key required)', provider: 'Google' },
      { id: 'openrouter/free', name: '🟢 OpenRouter free route (availability varies)', provider: 'OpenRouter' },
      { id: 'meta/llama-3.1-8b-instruct', name: '⚡ NVIDIA LLaMA 3.1 8B (NVIDIA key required)', provider: 'NVIDIA' },
      { id: 'claude-3-5-sonnet', name: '🧠 Claude (Anthropic or OpenRouter key required)', provider: 'Anthropic' },
      { id: 'qwen2.5-coder', name: '⚡ Qwen 2.5 Coder (installed Ollama model required)', provider: 'Local / Ollama' }
    ];
  }

  public async askAgent(
    prompt: string,
    contextFiles?: { path: string; content: string }[],
    model: string = 'auto',
    onToken?: (token: string) => void,
    responseLanguage: string = 'en'
  ): Promise<string> {
    const baseUrl = this.getBaseUrl();
    const config = vscode.workspace.getConfiguration('smaran');
    const apiKeys = { ...SmaranApiClient.desktopKeys(), ...(config.get<any>('apiKeys') || {}) };

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
      enable_headroom: config.get<boolean>('enableHeadroomCompression', true)
    };

    // 1. Use a running SMARAN.AI app when there is one. The extension does not
    // depend on it: if no app is configured or advertising itself, this step is
    // skipped entirely rather than stalling on a connection that cannot succeed.
    const appIsAvailable =
      Boolean(config.get<string>('backendUrl')?.trim()) ||
      SmaranApiClient.discoverRunningApp() !== null;

    if (appIsAvailable) {
      try {
        return await this._callLocalBackend(baseUrl, payload, onToken);
      } catch (localErr: any) {
        // App unreachable — continue with the user's own provider key or Ollama.
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
      } catch (_) {}
    }

    if (openRouterKey) {
      try {
        return await this._callOpenRouterDirect(openRouterKey, prompt, model, contextFiles, onToken);
      } catch (_) {}
    }

    if (groqKey) {
      try {
        return await this._callGroqDirect(groqKey, prompt, model, contextFiles, onToken);
      } catch (_) {}
    }

    if (geminiKey) {
      try {
        return await this._callGeminiDirect(geminiKey, prompt, contextFiles, onToken);
      } catch (_) {}
    }

    if (nvidiaKey) {
      try {
        return await this._callNvidiaDirect(nvidiaKey, prompt, model, contextFiles, onToken);
      } catch (_) {}
    }

    if (deepseekKey) {
      try {
        return await this._callDeepSeekDirect(deepseekKey, prompt, contextFiles, onToken);
      } catch (_) {}
    }

    if (anthropicKey) {
      try {
        return await this._callAnthropicDirect(anthropicKey, prompt, contextFiles, onToken);
      } catch (_) {}
    }

    if (openaiKey) {
      try {
        return await this._callOpenAIDirect(openaiKey, prompt, contextFiles, onToken);
      } catch (_) {}
    }

    // 3. Local Ollama, if the user is running one on port 11434.
    {
      try {
        return await this._callLocalOllama(prompt, contextFiles, onToken);
      } catch (_) {}

      throw new Error(
        'No AI engine is configured yet. Add your own provider key in VS Code ' +
        'Settings under "SMARAN.AI: Api Keys" — Groq, Google Gemini and ' +
        'OpenRouter all offer free tiers, and Claude, OpenAI or DeepSeek keys ' +
        'work too. A local Ollama on port 11434, or an open SMARAN.AI app, is ' +
        'also used automatically when present. Nothing was fabricated.'
      );
    }
  }

  private _callLocalBackend(baseUrl: string, payload: any, onToken?: (token: string) => void): Promise<string> {
    const url = `${baseUrl}/api/chat`;
    return new Promise((resolve, reject) => {
      try {
        const u = new URL(url);
        const isHttps = u.protocol === 'https:';
        const client = isHttps ? https : http;

        const bodyData = JSON.stringify(payload);
        const req = client.request(
          {
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
          },
          (res) => {
            let accumulatedText = '';
            let lineBuffer = '';

            res.on('data', (chunk) => {
              lineBuffer += chunk.toString();
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const data = JSON.parse(trimmed);
                  if (data.token !== undefined) {
                    accumulatedText += data.token;
                    if (onToken) onToken(data.token);
                  } else if (data.response || data.translated_response || data.content) {
                    const finalMsg = data.translated_response || data.response || data.content;
                    if (!accumulatedText) accumulatedText = finalMsg;
                  }
                } catch (_) {
                  accumulatedText += trimmed;
                  if (onToken) onToken(trimmed);
                }
              }
            });

            res.on('end', () => {
              if (lineBuffer.trim()) {
                try {
                  const data = JSON.parse(lineBuffer.trim());
                  if (data.token !== undefined) accumulatedText += data.token;
                  else if (data.response || data.translated_response || data.content) {
                    accumulatedText = data.translated_response || data.response || data.content;
                  }
                } catch (_) {
                  accumulatedText += lineBuffer.trim();
                }
              }
              resolve(accumulatedText.trim() || 'No response received from SMARAN.AI');
            });
          }
        );

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Connection timed out'));
        });

        req.write(bodyData);
        req.end();
      } catch (err: any) {
        reject(err);
      }
    });
  }


  private _callLocalOllama(prompt: string, contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            resolve(parsed.response || "No response from local Ollama");
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private _callGroqDirect(apiKey: string, prompt: string, model: string = 'auto', contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            const ans = parsed.choices?.[0]?.message?.content || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
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
  private _callNvidiaDirect(apiKey: string, prompt: string, model: string = 'auto', contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            if (onToken) onToken(answer);
            resolve(answer);
          } catch (e) {
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

  private _callOpenRouterDirect(apiKey: string, prompt: string, model: string = 'auto', contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let sysMsg = "You are SMARAN.AI, a software engineering assistant. Use only the workspace context supplied in this request.";
      if (contextFiles && contextFiles.length > 0) {
        sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
      }

      let targetModel = "meta-llama/llama-3.3-70b-instruct:free";
      if (model.includes('deepseek-r1') || model.includes('r1')) {
        targetModel = "deepseek/deepseek-r1:free";
      } else if (model.includes('deepseek-v4') || model.includes('deepseek')) {
        targetModel = "deepseek/deepseek-chat";
      } else if (model.includes('gemini')) {
        targetModel = "google/gemini-2.0-flash-exp:free";
      } else if (model.includes('nemotron')) {
        targetModel = "nvidia/llama-3.1-nemotron-70b-instruct:free";
      } else if (model.includes('claude')) {
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
            const ans = parsed.choices?.[0]?.message?.content || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
            reject(new Error(`OpenRouter API Error: ${data}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private _callGeminiDirect(apiKey: string, prompt: string, contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
        path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
            const ans = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
            reject(new Error(`Gemini API Error: ${data}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private _callDeepSeekDirect(apiKey: string, prompt: string, contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            const ans = parsed.choices?.[0]?.message?.content || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
            reject(new Error(`DeepSeek API Error: ${data}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private _callAnthropicDirect(apiKey: string, prompt: string, contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            const ans = parsed.content?.[0]?.text || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
            reject(new Error(`Anthropic API Error: ${data}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private _callOpenAIDirect(apiKey: string, prompt: string, contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
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
            const ans = parsed.choices?.[0]?.message?.content || "No response";
            if (onToken) onToken(ans);
            resolve(ans);
          } catch (e) {
            reject(new Error(`OpenAI API Error: ${data}`));
          }
        });
      });
      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      client.get(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          timeout: 3000,
          headers: { 'Accept': 'application/json' }
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      ).on('error', (e) => reject(e));
    });
  }
}
