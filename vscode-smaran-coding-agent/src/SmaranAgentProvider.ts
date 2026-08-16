import * as vscode from 'vscode';
import { SmaranApiClient } from './apiClient';

interface AttachedFile {
  name: string;
  path: string;
  content: string;
}

export class SmaranAgentProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'smaran-ai.chatView';
  private _view?: vscode.WebviewView;
  private _client: SmaranApiClient;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._client = new SmaranApiClient();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage': {
          await this._handleUserPrompt(data.prompt, data.model, data.attachments || []);
          break;
        }
        case 'pickAttachment': {
          await this._handlePickAttachment();
          break;
        }
        case 'applyCode': {
          await this._applyCodeToEditor(data.code);
          break;
        }
        case 'insertSnippet': {
          await this._insertSnippetToEditor(data.code);
          break;
        }
        case 'saveApiKeys': {
          const config = vscode.workspace.getConfiguration('smaran');
          if (data.keys) {
            await config.update('apiKeys', data.keys, vscode.ConfigurationTarget.Global);
            if (data.keys.backendUrl) {
              await config.update('backendUrl', data.keys.backendUrl, vscode.ConfigurationTarget.Global);
            }
            vscode.window.showInformationMessage('⚡ SMARAN.AI: Settings and API Keys saved successfully!');
          }
          break;
        }
        case 'getApiKeys': {
          const config = vscode.workspace.getConfiguration('smaran');
          const savedKeys = config.get<any>('apiKeys') || {};
          const backendUrl = config.get<string>('backendUrl') || 'http://localhost:3003';
          this._view?.webview.postMessage({
            type: 'loadedApiKeys',
            keys: { ...savedKeys, backendUrl }
          });
          break;
        }
        case 'getEditorContext': {
          await this._sendCurrentEditorContext();
          break;
        }
      }
    });

    this._sendCurrentEditorContext();
  }

  private async _handlePickAttachment() {
    if (!this._view) return;
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach to SMARAN.AI',
      filters: {
        'Code & Data Files': ['ts', 'js', 'py', 'json', 'html', 'css', 'md', 'txt', 'csv', 'yaml', 'yml', 'sql', 'sh', 'bat', 'png', 'jpg']
      }
    });

    if (!uris || uris.length === 0) return;

    for (const uri of uris) {
      try {
        const name = vscode.workspace.asRelativePath(uri);
        let content = '';
        if (uri.fsPath.match(/\.(png|jpg|jpeg|webp|ico)$/i)) {
          const buf = await vscode.workspace.fs.readFile(uri);
          content = `[Image File: ${name}, size: ${buf.byteLength} bytes]`;
        } else {
          const raw = await vscode.workspace.fs.readFile(uri);
          content = new TextDecoder('utf-8').decode(raw);
          if (content.length > 50000) {
            content = content.slice(0, 50000) + '\n...[Truncated for prompt optimization]';
          }
        }

        this._view.webview.postMessage({
          type: 'attachmentAdded',
          file: { name, path: uri.fsPath, content }
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to attach file: ${err.message}`);
      }
    }
  }

  private async _handleUserPrompt(userPrompt: string, model: string = 'auto', attachments: AttachedFile[] = []) {
    if (!this._view) return;

    let contextFiles: { path: string; content: string }[] = [];

    // 1. Current active editor context
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const doc = editor.document;
      const selection = editor.selection;
      const selectedText = !selection.isEmpty ? doc.getText(selection) : doc.getText();
      contextFiles.push({
        path: vscode.workspace.asRelativePath(doc.uri),
        content: selectedText
      });
    }

    // 2. Real Workspace Structure
    let workspaceName = 'Workspace Active';
    let totalWorkspaceFiles = 0;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const rootFolder = vscode.workspace.workspaceFolders[0];
      workspaceName = rootFolder.name;
      try {
        const foundFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 60);
        totalWorkspaceFiles = foundFiles.length;
        const fileTree = foundFiles.map(f => vscode.workspace.asRelativePath(f)).join('\n');
        contextFiles.push({
          path: 'workspace://directory_manifest.txt',
          content: `Project / Workspace: ${rootFolder.name}\nPath: ${rootFolder.uri.fsPath}\nTracked Files (${foundFiles.length} total):\n${fileTree}`
        });
      } catch (_) {}
    }

    // 3. User attachments
    for (const att of attachments) {
      contextFiles.push({
        path: `attachment://${att.name}`,
        content: att.content
      });
    }

    this._view.webview.postMessage({
      type: 'agentThinking',
      step: 'Reasoning with Multi-LLM Engine & Memory...'
    });

    try {
      const response = await this._client.askAgent(userPrompt, contextFiles, model, (token) => {
        this._view?.webview.postMessage({
          type: 'streamToken',
          token: token
        });
      });

      this._view.webview.postMessage({
        type: 'agentResponse',
        response: response,
        meta: {
          model: model === 'auto' ? '⚡ Auto-Combo' : model,
          workspace: workspaceName,
          filesInspected: totalWorkspaceFiles,
          headroomSaved: '65–90% Prompt Compression',
          claudeMem: '🧠 Cognitive Memory Active',
          plugins: ['task-observer', 'ui-ux-pro-max', 'reverse-skill', 'mcp-hub']
        }
      });
    } catch (err: any) {
      this._view.webview.postMessage({
        type: 'agentError',
        error: err.message || 'Connection error with SMARAN.AI backend'
      });
    }
  }

  private async _applyCodeToEditor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open to apply code.');
      return;
    }

    const selection = editor.selection;
    await editor.edit((editBuilder) => {
      if (!selection.isEmpty) {
        editBuilder.replace(selection, code);
      } else {
        const firstLine = editor.document.lineAt(0);
        const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
        const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
        editBuilder.replace(fullRange, code);
      }
    });

    vscode.window.showInformationMessage('⚡ SMARAN.AI: Code applied successfully!');
  }

  private async _insertSnippetToEditor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const position = editor.selection.active;
    await editor.edit((editBuilder) => {
      editBuilder.insert(position, code);
    });
  }

  private async _sendCurrentEditorContext() {
    if (!this._view) return;
    const editor = vscode.window.activeTextEditor;
    let workspaceName = '';
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceName = vscode.workspace.workspaceFolders[0].name;
    }

    if (editor) {
      const fileName = vscode.workspace.asRelativePath(editor.document.uri);
      const language = editor.document.languageId;
      const hasSelection = !editor.selection.isEmpty;
      this._view.webview.postMessage({
        type: 'contextUpdate',
        fileName,
        language,
        hasSelection,
        workspaceName
      });
    } else {
      this._view.webview.postMessage({
        type: 'contextUpdate',
        fileName: 'Workspace Ready',
        language: '',
        hasSelection: false,
        workspaceName
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMARAN.AI Coder</title>
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: #12131c;
      --border: #1e2235;
      --accent: #00F0FF;
      --neon-amber: #F59E0B;
      --neon-pink: #FF007A;
      --neon-green: #00FF66;
      --neon-purple: #7000FF;
      --text: #e4e4e7;
      --text-muted: #8b8ea4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ─── Header ─── */
    .header {
      padding: 8px 12px;
      background: linear-gradient(90deg, #10121d 0%, #151827 100%);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .brand-logo {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(245,158,11,0.25), rgba(0,240,255,0.25));
      border: 1px solid rgba(245,158,11,0.5);
      font-size: 11px;
    }
    .brand-title {
      font-weight: 900;
      font-size: 13px;
      letter-spacing: 0.5px;
      background: linear-gradient(135deg, #FFB800 0%, #00F0FF 50%, #7000FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .btn-icon {
      background: none;
      border: 1px solid #25283b;
      color: #8b8ea4;
      width: 26px;
      height: 26px;
      border-radius: 5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.15s;
    }
    .btn-icon:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(0, 240, 255, 0.08);
    }
    .btn-icon.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(0, 240, 255, 0.15);
    }

    /* ─── Drawer Panels (History & Settings) ─── */
    .drawer {
      display: none;
      background: #0d0f1a;
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      flex-direction: column;
      gap: 7px;
      max-height: 240px;
      overflow-y: auto;
      animation: slideDown 0.2s ease-out;
    }
    .drawer.open { display: flex; }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .drawer-title {
      font-size: 10px;
      font-weight: 800;
      color: var(--accent);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .session-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
    }
    .session-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      background: #141624;
      border: 1px solid #25283b;
      border-radius: 5px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .session-item:hover {
      border-color: var(--accent);
      background: #181b2e;
    }
    .session-item.active {
      border-color: var(--accent);
      background: rgba(0, 240, 255, 0.08);
      color: var(--accent);
    }
    .session-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .btn-trash {
      background: none;
      border: none;
      color: #6b6e82;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 3px;
      margin-left: 6px;
    }
    .btn-trash:hover {
      color: #FF007A;
      background: rgba(255, 0, 122, 0.15);
    }

    .key-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .key-row label {
      font-size: 9px;
      color: #8b8ea4;
      font-weight: 600;
      min-width: 95px;
      white-space: nowrap;
    }
    .key-row input {
      flex: 1;
      background: #141624;
      border: 1px solid #25283b;
      border-radius: 4px;
      color: #fff;
      padding: 4px 6px;
      font-size: 10px;
      outline: none;
      font-family: monospace;
    }
    .key-row input:focus { border-color: var(--accent); }
    .btn-save {
      background: linear-gradient(135deg, #00F0FF, #7000FF);
      border: none;
      color: #fff;
      font-weight: 800;
      padding: 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 10px;
      margin-top: 4px;
    }

    /* ─── Context Bar ─── */
    .context-bar {
      padding: 4px 12px;
      background: rgba(0,0,0,0.3);
      border-bottom: 1px solid var(--border);
      font-size: 10px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .context-info {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .active-file {
      color: #a1a1aa;
      font-family: monospace;
      font-size: 10px;
    }
    .workspace-tag {
      color: var(--neon-amber);
      font-weight: 700;
      font-size: 10px;
    }

    /* ─── Messages ─── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg {
      padding: 9px 12px;
      border-radius: 8px;
      line-height: 1.5;
      font-size: 12px;
      word-break: break-word;
    }
    .msg-user {
      background: #181b29;
      border: 1px solid #282d45;
      align-self: flex-end;
      max-width: 88%;
      color: #fff;
    }
    .msg-agent {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      align-self: flex-start;
      width: 100%;
    }

    /* Transparency Receipt Pill */
    .receipt-pill {
      margin-bottom: 6px;
      padding: 4px 8px;
      background: rgba(0, 240, 255, 0.05);
      border: 1px solid rgba(0, 240, 255, 0.2);
      border-radius: 5px;
      font-size: 9px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: #9d9fb5;
    }
    .receipt-item {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .receipt-item strong {
      color: var(--accent);
    }

    .code-block {
      background: #06070a;
      border: 1px solid #202230;
      border-radius: 6px;
      padding: 8px;
      margin: 8px 0;
      font-family: 'Fira Code', Consolas, Monaco, monospace;
      font-size: 11px;
      overflow-x: auto;
      color: #d4d4d8;
    }
    .code-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .btn-action {
      background: rgba(0, 240, 255, 0.12);
      border: 1px solid rgba(0, 240, 255, 0.25);
      color: #00F0FF;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-action:hover {
      background: #00F0FF;
      color: #000;
    }

    /* ─── Attachment List ─── */
    .attachment-bar {
      display: none;
      padding: 4px 10px;
      background: #10121d;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 5px;
      flex-shrink: 0;
    }
    .attachment-bar.has-items { display: flex; }
    .att-chip {
      background: #181c2e;
      border: 1px solid #2b304c;
      color: var(--accent);
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .att-remove {
      cursor: pointer;
      color: #8b8ea4;
      font-weight: bold;
    }
    .att-remove:hover { color: #FF007A; }

    /* ─── Quick Actions ─── */
    .quick-actions {
      padding: 5px 10px;
      display: flex;
      gap: 5px;
      overflow-x: auto;
      border-top: 1px solid var(--border);
      background: rgba(0,0,0,0.2);
      flex-shrink: 0;
    }
    .pill {
      background: #141622;
      border: 1px solid #25283b;
      color: #9d9fb5;
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 10px;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pill:hover {
      border-color: var(--accent);
      color: #fff;
    }

    /* ─── Sleek Codex/Claude Code Input Bar ─── */
    .input-area {
      padding: 8px 10px;
      background: #0b0d14;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .model-select {
      background: #121420;
      border: 1px solid #202438;
      color: var(--accent);
      font-size: 10px;
      font-weight: 700;
      border-radius: 5px;
      padding: 4px 6px;
      outline: none;
      width: 100%;
      cursor: pointer;
    }
    .model-select option { background: #0d0f17; color: #fff; }
    .model-select optgroup { background: #141622; color: var(--accent); font-weight: 800; }
    
    .input-container {
      display: flex;
      align-items: center;
      background: #131522;
      border: 1px solid #252a42;
      border-radius: 8px;
      padding: 4px 6px;
      gap: 6px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-container:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);
    }
    .btn-attach {
      background: none;
      border: none;
      color: #7b7e96;
      cursor: pointer;
      padding: 6px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .btn-attach:hover {
      color: var(--accent);
      background: rgba(0, 240, 255, 0.12);
    }
    .btn-attach svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }
    textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 12px;
      line-height: 1.4;
      resize: none;
      height: 32px;
      max-height: 120px;
      outline: none;
      font-family: inherit;
      padding: 5px 2px;
    }
    textarea::placeholder {
      color: #55586d;
    }
    .btn-send {
      background: linear-gradient(135deg, #00F0FF 0%, #7000FF 100%);
      border: none;
      color: #fff;
      font-weight: 800;
      font-size: 11px;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    .btn-send:hover { opacity: 0.9; }

    .error-card {
      background: rgba(255, 0, 122, 0.08);
      border: 1px solid rgba(255, 0, 122, 0.3);
      border-radius: 6px;
      padding: 8px 10px;
      color: #ff99c2;
      font-size: 11px;
      line-height: 1.5;
    }
    .error-card strong { color: #FF007A; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="brand">
      <div class="brand-logo">🧠</div>
      <span class="brand-title">SMARAN.AI</span>
    </div>
    <div class="header-actions">
      <button id="newChatBtn" class="btn-icon" onclick="startNewChat()" title="Start New Chat (Ctrl+N)">➕</button>
      <button id="historyBtn" class="btn-icon" onclick="toggleDrawer('historyDrawer')" title="Chat Sessions History">🕒</button>
      <button id="gearBtn" class="btn-icon" onclick="toggleDrawer('settingsDrawer')" title="API Keys & Model Settings">⚙️</button>
    </div>
  </div>

  <!-- Sessions History Drawer -->
  <div id="historyDrawer" class="drawer">
    <div class="drawer-title">
      <span>🕒 Conversation History</span>
      <button class="btn-trash" onclick="clearAllSessions()" title="Clear All History">🗑️ Clear All</button>
    </div>
    <div id="sessionList" class="session-list"></div>
  </div>

  <!-- Settings Drawer -->
  <div id="settingsDrawer" class="drawer">
    <div class="drawer-title">🔑 Custom Provider API Keys & Settings</div>
    <div class="key-row"><label>OpenRouter API:</label><input type="password" id="keyOpenRouter" placeholder="sk-or-v1-..." /></div>
    <div class="key-row"><label>Groq Cloud API:</label><input type="password" id="keyGroq" placeholder="gsk_..." /></div>
    <div class="key-row"><label>DeepSeek API:</label><input type="password" id="keyCustom" placeholder="sk-..." /></div>
    <div class="key-row"><label>Anthropic API:</label><input type="password" id="keyAnthropic" placeholder="sk-ant-..." /></div>
    <div class="key-row"><label>OpenAI API:</label><input type="password" id="keyOpenAI" placeholder="sk-..." /></div>
    <div class="key-row"><label>Google Gemini:</label><input type="password" id="keyGemini" placeholder="AIzaSy..." /></div>
    <div class="key-row"><label>Backend Endpoint:</label><input type="text" id="keyBackendUrl" placeholder="http://localhost:3003" /></div>
    <button class="btn-save" onclick="saveKeys()">💾 Save & Apply Provider Settings</button>
  </div>

  <!-- Context Bar -->
  <div class="context-bar">
    <div class="context-info">
      <span id="workspaceTag" class="workspace-tag">[Workspace Ready]</span>
      <span id="activeFile" class="active-file"></span>
    </div>
    <span id="selectionBadge" style="display:none;color:var(--neon-pink);font-size:9px;">[Selection]</span>
  </div>

  <!-- Chat Messages -->
  <div class="messages" id="chat">
    <div class="msg msg-agent">
      <strong>👋 SMARAN.AI Ready!</strong><br>
      Ask me to write code, refactor functions, generate tests, explain algorithms, inspect workspace files, or debug terminal diagnostics directly in your editor.
    </div>
  </div>

  <!-- Attachment Preview Chips -->
  <div id="attachmentBar" class="attachment-bar"></div>

  <!-- Quick Action Chips -->
  <div class="quick-actions">
    <div class="pill" onclick="quickSend('⚡ Explain the structure and logic of this code in detail')">⚡ Explain</div>
    <div class="pill" onclick="quickSend('🛠️ Refactor for peak performance, cleanliness and readability')">🛠️ Refactor</div>
    <div class="pill" onclick="quickSend('🧪 Generate comprehensive unit tests covering edge cases')">🧪 Unit Tests</div>
    <div class="pill" onclick="quickSend('🐞 Find and fix potential security bugs and performance leaks')">🐞 Fix Bugs</div>
  </div>

  <!-- Input Area -->
  <div class="input-area">
    <select id="modelSelect" class="model-select">
      <option value="auto">⚡ Auto-Combo (Multi-LLM Dynamic Routing)</option>
      <optgroup label="🚀 Flagship AI Models">
        <option value="deepseek/deepseek-v4-pro">🤖 DeepSeek V4 Pro (671B MoE)</option>
        <option value="deepseek/deepseek-r1">🧠 DeepSeek R1 Reasoning</option>
        <option value="groq/llama-3.3-70b">⚡ Groq Ultra-Fast (500+ T/s)</option>
        <option value="openrouter/free">🟢 OpenRouter Zero-Cost Routes</option>
        <option value="google/gemini-2.5-flash">✨ Gemini 2.5 Flash Free</option>
        <option value="nvidia/nemotron-3-ultra-70b">⚡ Nemotron 3 Ultra 70B</option>
        <option value="claude-3-5-sonnet">🧠 Claude 3.5 Sonnet / Opus</option>
        <option value="qwen2.5-coder">⚡ Qwen 2.5 Coder 32B (Local)</option>
      </optgroup>
    </select>
    
    <div class="input-container">
      <button class="btn-attach" onclick="pickAttachment()" title="Attach File / Screenshot">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
        </svg>
      </button>
      <textarea id="promptInput" placeholder="Instruct SMARAN.AI... (Enter to send, Shift+Enter for new line)"></textarea>
      <button id="sendBtn" class="btn-send">SEND</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');
    const chat = document.getElementById('chat');
    const activeFile = document.getElementById('activeFile');
    const workspaceTag = document.getElementById('workspaceTag');
    const selectionBadge = document.getElementById('selectionBadge');
    const attachmentBar = document.getElementById('attachmentBar');

    let currentEl = null;
    let attachments = [];
    let sessions = JSON.parse(localStorage.getItem('smaran_sessions') || '[]');
    let currentSessionId = 'session_' + Date.now();

    sendBtn.addEventListener('click', () => submit());
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    function quickSend(t) { promptInput.value = t; submit(); }

    function pickAttachment() {
      vscode.postMessage({ type: 'pickAttachment' });
    }

    function removeAttachment(index) {
      attachments.splice(index, 1);
      renderAttachments();
    }

    function renderAttachments() {
      if (attachments.length === 0) {
        attachmentBar.classList.remove('has-items');
        attachmentBar.innerHTML = '';
        return;
      }
      attachmentBar.classList.add('has-items');
      attachmentBar.innerHTML = attachments.map((a, i) =>
        '<div class="att-chip"><span>📄 ' + esc(a.name) + '</span><span class="att-remove" onclick="removeAttachment(' + i + ')">✕</span></div>'
      ).join('');
    }

    function submit() {
      const t = promptInput.value.trim();
      if (!t && attachments.length === 0) return;
      
      let userHtml = esc(t);
      if (attachments.length > 0) {
        userHtml += '<div style="margin-top:4px;font-size:9px;color:var(--accent);">' +
          attachments.map(a => '📎 ' + esc(a.name)).join(' | ') + '</div>';
      }

      addMsg('msg-user', userHtml);
      const payloadAttachments = [...attachments];
      attachments = [];
      renderAttachments();

      promptInput.value = '';
      vscode.postMessage({
        type: 'sendMessage',
        prompt: t || 'Analyze attached context files',
        model: modelSelect.value,
        attachments: payloadAttachments
      });
    }

    function addMsg(cls, html) {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      d.innerHTML = html;
      chat.appendChild(d);
      chat.scrollTop = chat.scrollHeight;
      saveCurrentSession();
      return d;
    }

    function applyCode(enc) { vscode.postMessage({ type: 'applyCode', code: decodeURIComponent(enc) }); }
    function insertSnippet(enc) { vscode.postMessage({ type: 'insertSnippet', code: decodeURIComponent(enc) }); }

    function fmtMd(text) {
      return text.replace(/\\\`\\\`\\\`([a-zA-Z0-9]*)\\n([\\s\\S]*?)\\\`\\\`\\\`/g, function(m, lang, code) {
        const enc = encodeURIComponent(code);
        return '<div class="code-block"><pre><code>' + esc(code) + '</code></pre>' +
          '<div class="code-actions">' +
          '<button class="btn-action" onclick="applyCode(\\'' + enc + '\\')">⚡ Apply to File</button>' +
          '<button class="btn-action" onclick="insertSnippet(\\'' + enc + '\\')">📋 Insert at Cursor</button>' +
          '</div></div>';
      }).replace(/\\n/g, '<br>');
    }

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function toggleDrawer(id) {
      const target = document.getElementById(id);
      const isCurrentlyOpen = target.classList.contains('open');
      document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.btn-icon').forEach(b => b.classList.remove('active'));

      if (!isCurrentlyOpen) {
        target.classList.add('open');
        if (id === 'settingsDrawer') {
          document.getElementById('gearBtn').classList.add('active');
          vscode.postMessage({ type: 'getApiKeys' });
        } else if (id === 'historyDrawer') {
          document.getElementById('historyBtn').classList.add('active');
          renderSessionList();
        }
      }
    }

    function renderSessionList() {
      const listEl = document.getElementById('sessionList');
      if (sessions.length === 0) {
        listEl.innerHTML = '<div style="color:#6b6e82;font-size:10px;padding:6px;">No saved sessions yet.</div>';
        return;
      }
      listEl.innerHTML = sessions.map(s =>
        '<div class="session-item ' + (s.id === currentSessionId ? 'active' : '') + '" onclick="restoreSession(\\'' + s.id + '\\')">' +
          '<span class="session-title">' + esc(s.title || 'Untitled Session') + '</span>' +
          '<button class="btn-trash" onclick="event.stopPropagation(); deleteSession(\\'' + s.id + '\\')" title="Delete Session">🗑️</button>' +
        '</div>'
      ).join('');
    }

    function startNewChat() {
      saveCurrentSession();
      currentSessionId = 'session_' + Date.now();
      chat.innerHTML = '<div class="msg msg-agent"><strong>👋 SMARAN.AI New Session Started!</strong><br>How can I assist you with your project today?</div>';
      document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.btn-icon').forEach(b => b.classList.remove('active'));
    }

    function saveCurrentSession() {
      const msgs = [];
      chat.querySelectorAll('.msg').forEach(m => {
        msgs.push({
          role: m.classList.contains('msg-user') ? 'user' : 'agent',
          html: m.innerHTML
        });
      });
      if (msgs.length <= 1) return;

      const firstUserMsg = msgs.find(m => m.role === 'user');
      const title = firstUserMsg ? firstUserMsg.html.replace(/<[^>]*>/g, '').slice(0, 32) : 'Session';

      const existingIndex = sessions.findIndex(s => s.id === currentSessionId);
      const rec = {
        id: currentSessionId,
        title: title,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        messages: msgs
      };

      if (existingIndex >= 0) {
        sessions[existingIndex] = rec;
      } else {
        sessions.unshift(rec);
      }
      if (sessions.length > 25) sessions.pop();
      localStorage.setItem('smaran_sessions', JSON.stringify(sessions));
    }

    function restoreSession(id) {
      const session = sessions.find(s => s.id === id);
      if (!session) return;
      currentSessionId = id;
      chat.innerHTML = session.messages.map(m =>
        '<div class="msg ' + (m.role === 'user' ? 'msg-user' : 'msg-agent') + '">' + m.html + '</div>'
      ).join('');
      chat.scrollTop = chat.scrollHeight;
      toggleDrawer('historyDrawer');
    }

    function deleteSession(id) {
      sessions = sessions.filter(s => s.id !== id);
      localStorage.setItem('smaran_sessions', JSON.stringify(sessions));
      if (currentSessionId === id) {
        startNewChat();
      } else {
        renderSessionList();
      }
    }

    function clearAllSessions() {
      sessions = [];
      localStorage.removeItem('smaran_sessions');
      startNewChat();
    }

    function saveKeys() {
      const keys = {
        openRouter: document.getElementById('keyOpenRouter').value.trim(),
        groq: document.getElementById('keyGroq').value.trim(),
        custom: document.getElementById('keyCustom').value.trim(),
        anthropic: document.getElementById('keyAnthropic').value.trim(),
        openai: document.getElementById('keyOpenAI').value.trim(),
        gemini: document.getElementById('keyGemini').value.trim(),
        backendUrl: document.getElementById('keyBackendUrl').value.trim() || 'http://localhost:3003'
      };
      vscode.postMessage({ type: 'saveApiKeys', keys });
      document.getElementById('settingsDrawer').classList.remove('open');
      document.getElementById('gearBtn').classList.remove('active');
    }

    window.addEventListener('message', (event) => {
      const m = event.data;
      switch (m.type) {
        case 'attachmentAdded':
          attachments.push(m.file);
          renderAttachments();
          break;
        case 'loadedApiKeys':
          if (m.keys) {
            if (m.keys.openRouter) document.getElementById('keyOpenRouter').value = m.keys.openRouter;
            if (m.keys.groq) document.getElementById('keyGroq').value = m.keys.groq;
            if (m.keys.custom) document.getElementById('keyCustom').value = m.keys.custom;
            if (m.keys.anthropic) document.getElementById('keyAnthropic').value = m.keys.anthropic;
            if (m.keys.openai) document.getElementById('keyOpenAI').value = m.keys.openai;
            if (m.keys.gemini) document.getElementById('keyGemini').value = m.keys.gemini;
            if (m.keys.backendUrl) document.getElementById('keyBackendUrl').value = m.keys.backendUrl;
          }
          break;
        case 'contextUpdate':
          if (m.workspaceName) {
            workspaceTag.textContent = '[' + m.workspaceName + ']';
          } else {
            workspaceTag.textContent = '[Workspace Ready]';
          }
          activeFile.textContent = m.fileName && m.fileName !== 'Workspace Ready' ? ' • ' + m.fileName : '';
          selectionBadge.style.display = m.hasSelection ? 'inline' : 'none';
          break;
        case 'agentThinking':
          currentEl = addMsg('msg-agent', '<em>⚡ ' + esc(m.step) + '</em>');
          break;
        case 'streamToken':
          if (!currentEl) {
            currentEl = addMsg('msg-agent', '');
          }
          if (currentEl.querySelector('em')) {
            currentEl.innerHTML = '';
          }
          currentEl.innerText += m.token;
          chat.scrollTop = chat.scrollHeight;
          break;
        case 'agentResponse':
          let fullHtml = '';
          if (m.meta) {
            fullHtml += '<div class="receipt-pill">' +
              '<span class="receipt-item">⚡ <strong>' + esc(m.meta.model) + '</strong></span>' +
              '<span class="receipt-item">🗜️ <strong>Headroom:</strong> ' + esc(m.meta.headroomSaved) + '</span>' +
              '<span class="receipt-item">🧠 <strong>Memory:</strong> Synced</span>' +
              '<span class="receipt-item">🛠️ <strong>Plugins:</strong> ' + esc(m.meta.plugins.join(', ')) + '</span>' +
            '</div>';
          }
          fullHtml += fmtMd(m.response);
          if (currentEl) { currentEl.innerHTML = fullHtml; }
          else { addMsg('msg-agent', fullHtml); }
          currentEl = null;
          chat.scrollTop = chat.scrollHeight;
          saveCurrentSession();
          break;
        case 'agentError':
          const errCard = '<div class="error-card">' +
            '<strong>⚠️ Connection Notice</strong><br>' +
            esc(m.error).replace(/\\n/g, '<br>') +
            '</div>';
          if (currentEl) { currentEl.innerHTML = errCard; }
          else { addMsg('msg-agent', errCard); }
          currentEl = null;
          break;
      }
    });

    vscode.postMessage({ type: 'getEditorContext' });
  </script>
</body>
</html>`;
  }
}
