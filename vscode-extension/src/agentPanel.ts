/**
 * The panel: a task goes in, and every step the agent takes comes out.
 *
 * What is on screen is the whole point of this rewrite. The previous version
 * showed a reply. This shows the work - which file is being read, which
 * command is running, what that command printed, and what the agent did with
 * the answer. If it goes wrong you can see the step it went wrong on.
 *
 * Two things are deliberately visible and not summarised away:
 *
 *   the folder it is working in, because the editor's project and the
 *   desktop app's open folder are often not the same one;
 *
 *   which tools actually ran, listed at the end next to the agent's own
 *   account of what it did. A small model will write one file and say it
 *   wrote three, and you should not have to take its word.
 */

import * as vscode from 'vscode';
import { AgentEvent, APP_NOT_FOUND, baseUrl, plan, run } from './backend';

export class AgentPanel implements vscode.WebviewViewProvider {
    public static readonly viewId = 'smaran-ai.chatView';

    private view?: vscode.WebviewView;
    private running?: AbortController;
    private history: unknown[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        view.webview.html = this.html(view.webview);

        view.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'task':
                    await this.start(String(message.text || ''));
                    break;
                case 'stop':
                    this.stop();
                    break;
                case 'approve':
                    await this.execute(String(message.text || ''));
                    break;
                case 'reset':
                    this.history = [];
                    this.post({ type: 'cleared' });
                    break;
            }
        });

        this.post({ type: 'ready', folder: this.folder(), connected: Boolean(baseUrl()) });
    }

    /** Give the agent a task from somewhere other than the panel. */
    public async submit(task: string): Promise<void> {
        await vscode.commands.executeCommand('smaran-ai.chatView.focus');
        this.post({ type: 'echo', text: task });
        await this.start(task);
    }

    private folder(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private post(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private async start(task: string): Promise<void> {
        if (!task.trim()) {
            return;
        }
        const folder = this.folder();
        if (!folder) {
            this.post({
                type: 'error',
                text: 'Open a folder first. The agent works inside a project, and there is no project here.',
            });
            return;
        }
        if (!baseUrl()) {
            this.post({ type: 'error', text: APP_NOT_FOUND });
            return;
        }

        const planFirst = vscode.workspace.getConfiguration('smaran').get<boolean>('planFirst', true);
        if (!planFirst) {
            await this.execute(task);
            return;
        }

        this.post({ type: 'thinking', text: 'Working out what to do…' });
        try {
            const intent = await plan(task, folder);
            this.post({ type: 'plan', text: intent, task });
        } catch (error) {
            this.post({ type: 'error', text: (error as Error).message });
        }
    }

    private async execute(task: string): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            return;
        }
        this.stop();
        this.running = new AbortController();
        this.post({ type: 'started' });

        const used: string[] = [];
        try {
            for await (const event of run(task, folder, this.history, this.running.signal)) {
                this.post(this.forDisplay(event));
                if (event.type === 'tool_call' && event.name) {
                    used.push(event.name);
                }
                if (event.type === 'done') {
                    // Kept so a follow-up ("now add a test for it") knows what
                    // was already done rather than starting from nothing.
                    this.history.push({ role: 'user', content: task });
                    this.history.push({ role: 'assistant', content: event.text || '' });
                }
            }
        } catch (error) {
            const message = (error as Error).message;
            this.post({ type: message === 'stopped' ? 'stopped' : 'error', text: message });
        } finally {
            this.running = undefined;
            this.post({ type: 'finished', used });
        }
    }

    private forDisplay(event: AgentEvent): Record<string, unknown> {
        if (event.type === 'tool_call') {
            const args = event.arguments || {};
            // The whole file contents in an argument would bury the panel;
            // the size says as much as the text would.
            const shown = Object.entries(args).map(([key, value]) => {
                const text = String(value ?? '');
                return key === 'content'
                    ? [key, `${text.split('\n').length} lines`]
                    : [key, text.length > 200 ? `${text.slice(0, 200)}…` : text];
            });
            return { type: 'tool_call', name: event.name, args: shown, step: event.step };
        }
        return event as unknown as Record<string, unknown>;
    }

    private stop(): void {
        this.running?.abort();
        this.running = undefined;
    }

    private html(webview: vscode.Webview): string {
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
        const nonce = Math.random().toString(36).slice(2);
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${asset('panel.css')}" rel="stylesheet">
</head>
<body>
  <header id="status"><span id="folder"></span></header>
  <main id="log"></main>
  <footer>
    <textarea id="task" rows="3" placeholder="What should it do? It can read the project, change files and run commands."></textarea>
    <div class="row">
      <button id="send">Send</button>
      <button id="stop" class="ghost" hidden>Stop</button>
      <button id="reset" class="ghost">New task</button>
    </div>
  </footer>
<script nonce="${nonce}" src="${asset('panel.js')}"></script>
</body>
</html>`;
    }
}
