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
  private getBaseUrl(): string {
    const config = vscode.workspace.getConfiguration('smaran');
    return config.get<string>('backendUrl') || 'http://localhost:3003';
  }

  public async getModels(): Promise<SmaranModel[]> {
    try {
      const url = `${this.getBaseUrl()}/api/models`;
      const res = await this.fetchJson(url);
      if (Array.isArray(res)) {
        return res.map((m: any) => ({
          id: m.id || m.name,
          name: m.name || m.id,
          provider: m.provider || 'Multi-LLM'
        }));
      }
    } catch (_) {}

    return [
      { id: 'auto', name: '⚡ Auto-Combo (Multi-LLM Dynamic Selection)', provider: 'Dynamic' },
      { id: 'deepseek/deepseek-r1', name: '🧠 DeepSeek R1 Reasoning (Free)', provider: 'DeepSeek' },
      { id: 'groq/llama-3.3-70b', name: '⚡ Groq LLaMA 3.3 70B (500+ T/s)', provider: 'Groq' },
      { id: 'google/gemini-2.5-flash', name: '✨ Gemini 2.0 / 2.5 Flash', provider: 'Google' },
      { id: 'openrouter/free', name: '🟢 OpenRouter LLaMA 3.3 70B (Free)', provider: 'OpenRouter' },
      { id: 'deepseek/deepseek-v4-pro', name: '🤖 DeepSeek V3 / V4 Chat', provider: 'DeepSeek' },
      { id: 'nvidia/nemotron-3-ultra-70b', name: '⚡ NVIDIA Nemotron 70B', provider: 'NVIDIA' },
      { id: 'claude-3-5-sonnet', name: '🧠 Claude 3.5 Sonnet', provider: 'Anthropic' },
      { id: 'qwen2.5-coder', name: '⚡ Qwen 2.5 Coder (Local)', provider: 'Local / Ollama' }
    ];
  }

  public async askAgent(
    prompt: string,
    contextFiles?: { path: string; content: string }[],
    model: string = 'auto',
    onToken?: (token: string) => void
  ): Promise<string> {
    const baseUrl = this.getBaseUrl();
    const config = vscode.workspace.getConfiguration('smaran');
    const apiKeys = config.get<any>('apiKeys') || {};

    const payload = {
      session_id: `vscode-${Date.now()}`,
      prompt: prompt,
      model: model,
      collections: [],
      rag_enabled: false,
      web_search: false,
      context_files: contextFiles || [],
      enable_headroom: config.get<boolean>('enableHeadroomCompression', true)
    };

    // 1. First attempt connection to Local SMARAN.AI Desktop / Docker backend
    try {
      return await this._callLocalBackend(baseUrl, payload, onToken);
    } catch (localErr: any) {
      // 2. If local backend is offline, check configured cloud API keys
      const openRouterKey = apiKeys.openRouter || apiKeys.openrouter;
      const groqKey = apiKeys.groq;
      const geminiKey = apiKeys.gemini || apiKeys.google;
      const deepseekKey = apiKeys.deepseek;

      // Direct Groq Cloud
      if (groqKey && (model.startsWith('groq') || model === 'auto')) {
        return await this._callGroqDirect(groqKey, prompt, model, contextFiles, onToken);
      }

      // Direct OpenRouter
      if (openRouterKey) {
        return await this._callOpenRouterDirect(openRouterKey, prompt, model, contextFiles, onToken);
      }

      // Fallback Groq if OpenRouter not configured
      if (groqKey) {
        return await this._callGroqDirect(groqKey, prompt, model, contextFiles, onToken);
      }

      // Direct Gemini
      if (geminiKey) {
        return await this._callGeminiDirect(geminiKey, prompt, contextFiles, onToken);
      }

      // Direct DeepSeek
      if (deepseekKey) {
        return await this._callDeepSeekDirect(deepseekKey, prompt, contextFiles, onToken);
      }

      throw new Error(
        `SMARAN.AI Desktop backend is not running on ${baseUrl}.\n\n` +
        `💡 Two easy ways to use SMARAN.AI:\n` +
        `1. Start SMARAN.AI Desktop or Docker container (runs on http://localhost:3003)\n` +
        `2. Or click Settings (⚙️) above and enter a free OpenRouter or Groq API Key for direct cloud pair programming.`
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

  private _callGroqDirect(apiKey: string, prompt: string, model: string = 'auto', contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let sysMsg = "You are SMARAN.AI, an autonomous senior AI coding assistant and pair programmer.";
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

  private _callOpenRouterDirect(apiKey: string, prompt: string, model: string = 'auto', contextFiles?: any[], onToken?: (token: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let sysMsg = "You are SMARAN.AI, an autonomous senior AI coding assistant and pair programmer.";
      if (contextFiles && contextFiles.length > 0) {
        sysMsg += "\n\nWorkspace Context Files:\n" + contextFiles.map(c => `--- ${c.path} ---\n${c.content}`).join('\n\n');
      }

      // Map model to OpenRouter identifier
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
          "HTTP-Referer": "https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI",
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
      let sysMsg = "You are SMARAN.AI, an autonomous senior AI coding assistant.";
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
