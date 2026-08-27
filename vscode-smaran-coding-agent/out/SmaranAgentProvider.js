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
exports.SmaranAgentProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const apiClient_1 = require("./apiClient");
class SmaranAgentProvider {
    _extensionUri;
    static viewType = 'smaran-ai.chatView';
    _view;
    _client;
    _terminal;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._client = new apiClient_1.SmaranApiClient();
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage': {
                    await this._handleUserPrompt(data.prompt, data.model, data.attachments || [], data.language || 'en');
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
                case 'createWorkspaceFile': {
                    await this._createWorkspaceFile(data.filePath, data.content);
                    break;
                }
                case 'runTerminalCommand': {
                    await this._runTerminalCommand(data.command);
                    break;
                }
                case 'saveApiKeys': {
                    const config = vscode.workspace.getConfiguration('smaran');
                    if (data.keys) {
                        await config.update('apiKeys', data.keys, vscode.ConfigurationTarget.Global);
                        if (data.keys.backendUrl) {
                            await config.update('backendUrl', data.keys.backendUrl, vscode.ConfigurationTarget.Global);
                        }
                        vscode.window.showInformationMessage('⚡ SMARAN.AI: Provider keys and settings saved!');
                    }
                    break;
                }
                case 'getApiKeys': {
                    const config = vscode.workspace.getConfiguration('smaran');
                    const savedKeys = config.get('apiKeys') || {};
                    const backendUrl = config.get('backendUrl') || 'http://localhost:3003';
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
    async _handlePickAttachment() {
        if (!this._view)
            return;
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach to SMARAN.AI',
            filters: {
                'Code & Data Files': ['ts', 'js', 'py', 'json', 'html', 'css', 'md', 'txt', 'csv', 'yaml', 'yml', 'sql', 'sh', 'png', 'jpg']
            }
        });
        if (!uris || uris.length === 0)
            return;
        for (const uri of uris) {
            try {
                const name = vscode.workspace.asRelativePath(uri);
                let content = '';
                if (uri.fsPath.match(/\.(png|jpg|jpeg|webp|ico)$/i)) {
                    const buf = await vscode.workspace.fs.readFile(uri);
                    content = `[Image File: ${name}, size: ${buf.byteLength} bytes]`;
                }
                else {
                    const raw = await vscode.workspace.fs.readFile(uri);
                    content = new TextDecoder('utf-8').decode(raw);
                    // 50,000 characters is roughly 12,000 tokens - smaller than one large
                    // source file, and every model this routes to takes far more. Raised
                    // to 200,000, about 50,000 tokens, which still leaves room in a 128k
                    // context for the reply.
                    if (content.length > 200000) {
                        content = content.slice(0, 200000) + '\n...[Truncated at 200,000 characters]';
                    }
                }
                this._view.webview.postMessage({
                    type: 'attachmentAdded',
                    file: { name, path: uri.fsPath, content }
                });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Failed to attach file: ${err.message}`);
            }
        }
    }
    async _createWorkspaceFile(relativePath, content) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No active workspace open to create files.');
                return false;
            }
            const rootUri = workspaceFolders[0].uri;
            const requestedPath = String(relativePath || '').trim();
            if (!requestedPath || path.isAbsolute(requestedPath)) {
                vscode.window.showErrorMessage('SMARAN.AI rejected an empty or absolute generated file path.');
                return false;
            }
            const rootPath = path.resolve(rootUri.fsPath);
            const targetPath = path.resolve(rootPath, requestedPath);
            const pathFromRoot = path.relative(rootPath, targetPath);
            if (!pathFromRoot ||
                pathFromRoot === '..' ||
                pathFromRoot.startsWith(`..${path.sep}`) ||
                path.isAbsolute(pathFromRoot)) {
                vscode.window.showErrorMessage('SMARAN.AI rejected a generated file path outside the first workspace folder.');
                return false;
            }
            const targetUri = vscode.Uri.file(targetPath);
            const approval = await vscode.window.showWarningMessage(`SMARAN.AI wants to write: ${pathFromRoot}`, { modal: true, detail: `Review the exact workspace target before allowing it: ${targetPath}` }, 'Allow');
            if (approval !== 'Allow')
                return false;
            // Create parent directories if missing
            const parentDir = vscode.Uri.file(path.dirname(targetUri.fsPath));
            await vscode.workspace.fs.createDirectory(parentDir);
            // Write file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(targetUri, encoder.encode(content));
            // Open document in editor
            const doc = await vscode.workspace.openTextDocument(targetUri);
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
            vscode.window.showInformationMessage(`⚡ SMARAN.AI: Wrote workspace file ${pathFromRoot}`);
            return true;
        }
        catch (err) {
            vscode.window.showErrorMessage(`File creation error: ${err.message}`);
            return false;
        }
    }
    async _runTerminalCommand(command) {
        const approval = await vscode.window.showWarningMessage(`SMARAN.AI wants to run a terminal command`, { modal: true, detail: command }, 'Allow');
        if (approval !== 'Allow')
            return;
        if (!this._terminal || this._terminal.exitStatus !== undefined) {
            this._terminal = vscode.window.createTerminal({ name: 'SMARAN.AI Agent' });
        }
        this._terminal.show(true);
        this._terminal.sendText(command);
        vscode.window.showInformationMessage(`💻 SMARAN.AI executing: ${command}`);
    }
    async _handleUserPrompt(userPrompt, model = 'auto', attachments = [], responseLanguage = 'en') {
        if (!this._view)
            return;
        let contextFiles = [];
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
        // 2. Bounded workspace file manifest (paths only, maximum 60 entries)
        let workspaceName = 'Workspace Active';
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const rootFolder = vscode.workspace.workspaceFolders[0];
            workspaceName = rootFolder.name;
            try {
                const foundFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 60);
                const fileTree = foundFiles.map(f => vscode.workspace.asRelativePath(f)).join('\n');
                contextFiles.push({
                    path: 'workspace://file_manifest.txt',
                    content: `Project Root: ${rootFolder.name}\nPath: ${rootFolder.uri.fsPath}\nTracked Files (${foundFiles.length} total):\n${fileTree}`
                });
            }
            catch (_) { }
        }
        // 3. Add attached files
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                contextFiles.push({ path: att.name, content: att.content });
            }
        }
        const supportedLanguages = {
            en: 'English', hi: 'Hindi', gu: 'Gujarati', pa: 'Punjabi', mr: 'Marathi',
            ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali'
        };
        const normalizedLanguage = supportedLanguages[responseLanguage] ? responseLanguage : 'en';
        const languageName = supportedLanguages[normalizedLanguage];
        // Explain the extension's real, approval-gated tools to the selected model.
        const agentInstruction = `You are SMARAN.AI, a software engineering assistant.
You can see only the active editor or selection, the bounded file-path manifest, and attachments supplied with this request. You do not have unrestricted workspace or system access.
You may propose either of these structured actions. VS Code will ask the user before executing each generated workspace write or terminal command:
<tool_call name="create_file">
<path>relative/path/to/file.ext</path>
<content>
// full file code
</content>
</tool_call>

<tool_call name="run_command">
<command>npm run build</command>
</tool_call>

Respond in ${languageName} (${normalizedLanguage}) unless code, commands, identifiers, or quoted source text require their original language. Do not claim that an unavailable tool, file, model, or web result was inspected.

User Request:
${userPrompt}`;
        this._view.webview.postMessage({
            type: 'agentThinking',
            step: 'Preparing supplied context and requesting a model response...'
        });
        try {
            const rawResponse = await this._client.askAgent(agentInstruction, contextFiles, model, (token) => {
                this._view?.webview.postMessage({
                    type: 'streamToken',
                    token: token
                });
            }, normalizedLanguage);
            // Parse and execute any tool calls emitted by the model
            await this._parseAndExecuteToolCalls(rawResponse);
            this._view.webview.postMessage({
                type: 'agentResponse',
                response: rawResponse,
                meta: {
                    model: model === 'auto' ? 'Auto-Combo Router' : model,
                    workspace: workspaceName
                }
            });
        }
        catch (err) {
            this._view.webview.postMessage({
                type: 'agentError',
                error: err.message || 'Unable to process request.'
            });
        }
    }
    async _parseAndExecuteToolCalls(response) {
        // 1. Check for <tool_call name="create_file">
        const createFileRegex = /<tool_call\s+name=["']create_file["']>[\s\S]*?<path>([\s\S]*?)<\/path>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/tool_call>/gi;
        let match;
        while ((match = createFileRegex.exec(response)) !== null) {
            const filePath = match[1].trim();
            const content = match[2].trim();
            if (filePath && content) {
                await this._createWorkspaceFile(filePath, content);
            }
        }
        // 2. Check for <tool_call name="run_command">
        const runCommandRegex = /<tool_call\s+name=["']run_command["']>[\s\S]*?<command>([\s\S]*?)<\/command>[\s\S]*?<\/tool_call>/gi;
        let cmdMatch;
        while ((cmdMatch = runCommandRegex.exec(response)) !== null) {
            const command = cmdMatch[1].trim();
            if (command) {
                await this._runTerminalCommand(command);
            }
        }
    }
    async _applyCodeToEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            const newDoc = await vscode.workspace.openTextDocument({ content: code, language: 'typescript' });
            await vscode.window.showTextDocument(newDoc);
            return;
        }
        const selection = editor.selection;
        await editor.edit((editBuilder) => {
            if (!selection.isEmpty) {
                editBuilder.replace(selection, code);
            }
            else {
                const firstLine = editor.document.lineAt(0);
                const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
                const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
                editBuilder.replace(fullRange, code);
            }
        });
        vscode.window.showInformationMessage('⚡ SMARAN.AI: Code applied successfully!');
    }
    async _insertSnippetToEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const position = editor.selection.active;
        await editor.edit((editBuilder) => {
            editBuilder.insert(position, code);
        });
    }
    async _sendCurrentEditorContext() {
        if (!this._view)
            return;
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
        }
        else {
            this._view.webview.postMessage({
                type: 'contextUpdate',
                fileName: 'Workspace Ready',
                language: '',
                hasSelection: false,
                workspaceName
            });
        }
    }
    _getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; font-src https:;">
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
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(245,158,11,0.3), rgba(0,240,255,0.3));
      border: 1px solid rgba(0,240,255,0.5);
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

    /* ─── Drawers (History & Settings) ─── */
    .drawer {
      display: none;
      background: #0d0f1a;
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      flex-direction: column;
      gap: 7px;
      max-height: 240px;
      overflow-y: auto;
    }
    .drawer.open { display: flex; }
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
      color: #000;
      font-weight: 900;
      font-size: 10px;
      padding: 6px 10px;
      border-radius: 5px;
      cursor: pointer;
      margin-top: 4px;
    }

    /* ─── Context Bar ─── */
    .context-bar {
      padding: 4px 10px;
      background: #0d0e17;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-muted);
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
    .workspace-tag {
      color: var(--neon-amber);
      font-weight: 700;
      font-size: 9px;
    }
    .active-file {
      color: var(--accent);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ─── Chat Messages Area ─── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg {
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.45;
      font-size: 11.5px;
      word-wrap: break-word;
    }
    .msg-user {
      background: #181c2e;
      border: 1px solid #2b304c;
      align-self: flex-end;
      color: #fff;
      max-width: 90%;
      border-bottom-right-radius: 2px;
    }
    .msg-agent {
      background: #121420;
      border: 1px solid var(--border);
      align-self: flex-start;
      color: #d1d5db;
      max-width: 98%;
      border-bottom-left-radius: 2px;
    }
    .msg-agent strong { color: #fff; }

    .code-block {
      background: #08090f;
      border: 1px solid #202438;
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

    /* ─── Input Area ─── */
    .input-area {
      padding: 8px 10px;
      background: #0b0d14;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .selector-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(104px, 0.42fr) 30px;
      gap: 5px;
      align-items: stretch;
    }
    .model-select,
    .language-select {
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
      min-width: 0;
    }
    .language-select { color: var(--neon-amber); }
    .model-select option,
    .language-select option { background: #0d0f17; color: #fff; }
    .model-select optgroup { background: #141622; color: var(--accent); font-weight: 800; }
    
    .input-container {
      display: flex;
      align-items: center;
      background: #131522;
      border: 1px solid #252a42;
      border-radius: 8px;
      padding: 4px 6px;
      gap: 6px;
    }
    .input-container:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);
    }
    .btn-attach {
      background: none;
      border: 1px solid rgba(123, 126, 150, 0.28);
      /* #7b7e96 on this bar sat near 3:1 against the field, which is why
         the two icons read as smudges. Lifted to a legible grey and given
         a hairline edge so each one is visibly a button. */
      color: #b6bad2;
      cursor: pointer;
      padding: 6px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .btn-attach:hover {
      color: var(--accent);
      border-color: rgba(0, 240, 255, 0.45);
      background: rgba(0, 240, 255, 0.12);
    }
    .btn-attach svg { display: block; }
    .btn-attach.active {
      color: #071016;
      background: var(--accent);
      box-shadow: 0 0 10px rgba(0, 240, 255, 0.35);
    }
    .voice-status {
      min-height: 12px;
      color: var(--text-muted);
      font-size: 9px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .voice-status.error { color: #ff99c2; }
    textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 12px;
      line-height: 1.4;
      resize: none;
      /* A fixed 32px cannot hold two lines of 12px text at 1.4, and the
         placeholder wrapped to two in a narrow panel, so its second line
         was clipped. A minimum with room to grow fits both. */
      min-height: 34px;
      height: auto;
      max-height: 120px;
      overflow-y: auto;
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
      flex-shrink: 0;
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
    @media (max-width: 310px) {
      .selector-row { grid-template-columns: minmax(0, 1fr) 30px; }
      .model-select { grid-column: 1 / -1; }
      .language-select { grid-column: 1; }
      .btn-send { padding-inline: 8px; font-size: 10px; }
      .input-container { gap: 3px; padding-inline: 4px; }
      .btn-attach { padding-inline: 4px; }
    }
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
      <button id="newChatBtn" class="btn-icon" onclick="startNewChat()" title="Start New Chat">➕</button>
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
      <strong>👋 SMARAN.AI Coding Assistant Ready</strong><br>
      Ask me to inspect context, propose edits, create files, or run commands. Workspace writes and terminal commands require your approval.
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
    <div class="pill" onclick="quickSend('📁 Build full implementation plan for project requirements')">📁 Plan</div>
  </div>

  <!-- Input Area -->
  <div class="input-area">
    <div class="selector-row">
      <select id="modelSelect" class="model-select" aria-label="Model route">
        <option value="auto">⚡ Auto (available configured route)</option>
        <optgroup label="Routes — availability depends on installation or key">
          <option value="deepseek/deepseek-r1">🧠 DeepSeek R1 (provider required)</option>
          <option value="groq/llama-3.3-70b">⚡ Groq LLaMA 3.3 (Groq key)</option>
          <option value="openrouter/free">🟢 OpenRouter free route (may vary)</option>
          <option value="google/gemini-flash">✨ Gemini Flash (Gemini key)</option>
          <option value="nvidia/nemotron-3-ultra-70b">⚡ Nemotron (provider required)</option>
          <option value="claude-3-5-sonnet">🧠 Claude (provider required)</option>
          <option value="qwen2.5-coder">⚡ Qwen 2.5 Coder (installed Ollama)</option>
        </optgroup>
      </select>
    </div>
    
    <div class="input-container">
      <button class="btn-attach" onclick="pickAttachment()" title="Attach a text file or image metadata" aria-label="Attach a file"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
      <button id="speakBtn" class="btn-attach" type="button" title="Dictate prompt using this VS Code runtime" aria-label="Dictate"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3"/></svg></button>
      <textarea id="promptInput" rows="1" placeholder="Instruct SMARAN.AI…" title="Enter to send, Shift+Enter for a newline"></textarea>
      <button id="sendBtn" class="btn-send">SEND</button>
    </div>
    <div id="voiceStatus" class="voice-status" role="status" aria-live="polite"></div>
  </div>

  <script>
    var vscode = acquireVsCodeApi();
    var promptInput = document.getElementById('promptInput');
    var sendBtn = document.getElementById('sendBtn');
    var speakBtn = document.getElementById('speakBtn');
    var modelSelect = document.getElementById('modelSelect');
    // The language menu was removed. Dictation still needs a locale,
    // so it is fixed here rather than read from a control that is
    // no longer on screen.
    var uiLanguage = 'en';
    var voiceStatus = document.getElementById('voiceStatus');
    var chat = document.getElementById('chat');
    var activeFile = document.getElementById('activeFile');
    var workspaceTag = document.getElementById('workspaceTag');
    var selectionBadge = document.getElementById('selectionBadge');
    var attachmentBar = document.getElementById('attachmentBar');

    var currentEl = null;
    var attachments = [];
    var sessions = [];
    try { sessions = JSON.parse(localStorage.getItem('smaran_sessions') || '[]'); } catch(e){}
    var currentSessionId = 'session_' + Date.now();
    var languageLocales = {
      en: 'en-US', hi: 'hi-IN', pa: 'pa-IN', gu: 'gu-IN', mr: 'mr-IN',
      bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', kn: 'kn-IN'
    };
    var speechRecognition = null;
    var recognitionBaseText = '';
    var recognitionHeard = false;
    var recognitionHadError = false;

    function setVoiceStatus(message, isError) {
      voiceStatus.textContent = message || '';
      voiceStatus.classList.toggle('error', Boolean(isError));
    }

    sendBtn.addEventListener('click', function() { submit(); });
    speakBtn.addEventListener('click', function() {
      var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        setVoiceStatus('Dictation is unavailable in this VS Code runtime. Use OS voice typing or type the prompt.', true);
        return;
      }
      if (speechRecognition) {
        setVoiceStatus('Stopping dictation…', false);
        try { speechRecognition.stop(); } catch (_) {}
        return;
      }

      try {
        recognitionBaseText = promptInput.value.trim();
        recognitionHeard = false;
        recognitionHadError = false;
        speechRecognition = new Recognition();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = true;
        speechRecognition.maxAlternatives = 1;
        speechRecognition.lang = languageLocales[uiLanguage] || 'en-US';
        speechRecognition.onstart = function() {
          speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
          speakBtn.classList.add('active');
          setVoiceStatus('Listening in ' + speechRecognition.lang + '… Click stop when finished.', false);
        };
        speechRecognition.onresult = function(event) {
          var spoken = '';
          for (var i = 0; i < event.results.length; i++) {
            spoken += event.results[i][0].transcript + ' ';
          }
          spoken = spoken.trim();
          recognitionHeard = spoken.length > 0;
          promptInput.value = [recognitionBaseText, spoken].filter(Boolean).join(' ');
          setVoiceStatus(recognitionHeard ? 'Speech captured. Waiting for dictation to finish…' : 'Listening…', false);
        };
        speechRecognition.onerror = function(event) {
          recognitionHadError = true;
          var reason = event && event.error ? event.error : 'unknown microphone error';
          var help = reason === 'not-allowed' || reason === 'service-not-allowed'
            ? ' Allow microphone access for VS Code, then try again.'
            : reason === 'no-speech'
              ? ' No speech was detected.'
              : '';
          setVoiceStatus('Dictation error: ' + reason + '.' + help, true);
        };
        speechRecognition.onend = function() {
          var shouldSubmit = recognitionHeard && !recognitionHadError && promptInput.value.trim().length > 0;
          speechRecognition = null;
          speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3"/></svg>';
          speakBtn.classList.remove('active');
          if (shouldSubmit) {
            setVoiceStatus('Speech captured. Sending prompt…', false);
            window.setTimeout(function() { submit(); }, 0);
          } else if (!recognitionHadError) {
            setVoiceStatus('Dictation stopped without captured speech.', true);
          }
        };
        speechRecognition.start();
      } catch (error) {
        speechRecognition = null;
        speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3"/></svg>';
        speakBtn.classList.remove('active');
        setVoiceStatus('Could not start dictation in this VS Code runtime.', true);
      }
    });
    promptInput.addEventListener('keydown', function(e) {
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
      attachmentBar.innerHTML = attachments.map(function(a, i) {
        return '<div class="att-chip"><span>📄 ' + esc(a.name) + '</span><span class="att-remove" onclick="removeAttachment(' + i + ')">✕</span></div>';
      }).join('');
    }

    function submit() {
      var t = promptInput.value.trim();
      if (!t && attachments.length === 0) return;
      
      var userHtml = esc(t);
      if (attachments.length > 0) {
        userHtml += '<div style="margin-top:4px;font-size:9px;color:var(--accent);">' +
          attachments.map(function(a) { return '📎 ' + esc(a.name); }).join(' | ') + '</div>';
      }

      addMsg('msg-user', userHtml);
      var payloadAttachments = attachments.slice(0);
      attachments = [];
      renderAttachments();

      promptInput.value = '';
      vscode.postMessage({
        type: 'sendMessage',
        prompt: t || 'Analyze attached context files',
        model: modelSelect.value,
        language: uiLanguage,
        attachments: payloadAttachments
      });
    }

    function addMsg(cls, html) {
      var d = document.createElement('div');
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
      var safe = String(text || '');
      var bt = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
      var codeBlockRegex = new RegExp(bt + '([a-zA-Z0-9]*)\\n([\\s\\S]*?)' + bt, 'g');
      safe = safe.replace(codeBlockRegex, function(m, lang, code) {
        var enc = encodeURIComponent(code);
        return '<div class="code-block"><pre><code>' + esc(code) + '</code></pre>' +
          '<div class="code-actions">' +
          '<button class="btn-action" onclick="applyCode(\\'' + enc + '\\')">⚡ Apply to File</button>' +
          '<button class="btn-action" onclick="insertSnippet(\\'' + enc + '\\')">📋 Insert at Cursor</button>' +
          '</div></div>';
      });
      safe = safe.replace(/### (.*?)\\n/g, '<h4 style="color:#00F0FF;margin:6px 0;">$1</h4>');
      safe = safe.replace(/## (.*?)\\n/g, '<h3 style="color:#FFB800;margin:8px 0;">$1</h3>');
      safe = safe.replace(/# (.*?)\\n/g, '<h2 style="color:#fff;margin:10px 0;">$1</h2>');
      safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/\\n/g, '<br>');
      return safe;
    }

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function toggleDrawer(id) {
      var target = document.getElementById(id);
      var isCurrentlyOpen = target.classList.contains('open');
      document.querySelectorAll('.drawer').forEach(function(d) { d.classList.remove('open'); });
      document.querySelectorAll('.btn-icon').forEach(function(b) { b.classList.remove('active'); });

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
      var listEl = document.getElementById('sessionList');
      if (sessions.length === 0) {
        listEl.innerHTML = '<div style="color:#6b6e82;font-size:10px;padding:6px;">No saved sessions yet.</div>';
        return;
      }
      listEl.innerHTML = sessions.map(function(s) {
        return '<div class="session-item ' + (s.id === currentSessionId ? 'active' : '') + '" onclick="restoreSession(\\'' + s.id + '\\')">' +
          '<span class="session-title">' + esc(s.title || 'Untitled Session') + '</span>' +
          '<button class="btn-trash" onclick="event.stopPropagation(); deleteSession(\\'' + s.id + '\\')" title="Delete Session">🗑️</button>' +
        '</div>';
      }).join('');
    }

    function startNewChat() {
      saveCurrentSession();
      currentSessionId = 'session_' + Date.now();
      chat.innerHTML = '<div class="msg msg-agent"><strong>👋 SMARAN.AI New Session Started</strong><br>How can I assist with the supplied project context?</div>';
      document.querySelectorAll('.drawer').forEach(function(d) { d.classList.remove('open'); });
      document.querySelectorAll('.btn-icon').forEach(function(b) { b.classList.remove('active'); });
    }

    function saveCurrentSession() {
      var msgs = [];
      chat.querySelectorAll('.msg').forEach(function(m) {
        msgs.push({
          role: m.classList.contains('msg-user') ? 'user' : 'agent',
          html: m.innerHTML
        });
      });
      if (msgs.length <= 1) return;

      var firstUserMsg = msgs.find(function(m) { return m.role === 'user'; });
      var title = firstUserMsg ? firstUserMsg.html.replace(/<[^>]*>/g, '').slice(0, 32) : 'Session';

      var existingIndex = sessions.findIndex(function(s) { return s.id === currentSessionId; });
      var rec = {
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
      try { localStorage.setItem('smaran_sessions', JSON.stringify(sessions)); } catch(e){}
    }

    function restoreSession(id) {
      var session = sessions.find(function(s) { return s.id === id; });
      if (!session) return;
      currentSessionId = id;
      chat.innerHTML = session.messages.map(function(m) {
        return '<div class="msg ' + (m.role === 'user' ? 'msg-user' : 'msg-agent') + '">' + m.html + '</div>';
      }).join('');
      var restoredAgentMessages = chat.querySelectorAll('.msg-agent');
      if (restoredAgentMessages.length > 0) {
      }
      chat.scrollTop = chat.scrollHeight;
      toggleDrawer('historyDrawer');
    }

    function deleteSession(id) {
      sessions = sessions.filter(function(s) { return s.id !== id; });
      try { localStorage.setItem('smaran_sessions', JSON.stringify(sessions)); } catch(e){}
      if (currentSessionId === id) {
        startNewChat();
      } else {
        renderSessionList();
      }
    }

    function clearAllSessions() {
      sessions = [];
      try { localStorage.removeItem('smaran_sessions'); } catch(e){}
      startNewChat();
    }

    function saveKeys() {
      var keys = {
        openRouter: document.getElementById('keyOpenRouter').value.trim(),
        groq: document.getElementById('keyGroq').value.trim(),
        custom: document.getElementById('keyCustom').value.trim(),
        anthropic: document.getElementById('keyAnthropic').value.trim(),
        openai: document.getElementById('keyOpenAI').value.trim(),
        gemini: document.getElementById('keyGemini').value.trim(),
        backendUrl: document.getElementById('keyBackendUrl').value.trim() || 'http://localhost:3003'
      };
      vscode.postMessage({ type: 'saveApiKeys', keys: keys });
      document.getElementById('settingsDrawer').classList.remove('open');
      document.getElementById('gearBtn').classList.remove('active');
    }

    window.addEventListener('message', function(event) {
      var m = event.data;
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
          var fullHtml = fmtMd(m.response);
          if (currentEl) { currentEl.innerHTML = fullHtml; }
          else { addMsg('msg-agent', fullHtml); }
          currentEl = null;
          chat.scrollTop = chat.scrollHeight;
          saveCurrentSession();
          break;
        case 'agentError':
          var errCard = '<div class="error-card">' +
            '<strong>⚠️ Notice</strong><br>' +
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
exports.SmaranAgentProvider = SmaranAgentProvider;
//# sourceMappingURL=SmaranAgentProvider.js.map