/**
 * The panel: a task goes in, and every step the agent takes comes out.
 *
 * What is on screen is the whole point. 1.5.0 showed a reply. This shows the
 * work - which file is being read, which command is running, what that command
 * printed, and what the agent did with the answer. If it goes wrong you can
 * see the step it went wrong on.
 *
 * Two things are deliberately visible and not summarised away:
 *
 *   the folder it is working in, because an agent that can write files should
 *   never leave you guessing where;
 *
 *   which tools actually ran, listed at the end next to the agent's own
 *   account of what it did. A small model will write one file and say it
 *   wrote three, and you should not have to take its word.
 */

import * as vscode from 'vscode';

import { Message } from './agent/models';
import { AgentEvent, plan, run } from './agent/loop';
import { resolveChoice } from './settings';

export class AgentPanel implements vscode.WebviewViewProvider {
    public static readonly viewId = 'smaran-ai.chatView';

    private view?: vscode.WebviewView;
    private stopRequested = false;
    private busy = false;
    private history: Message[] = [];

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
                    this.stopRequested = true;
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

        void this.announce();
    }

    /** Give the agent a task from somewhere other than the panel. */
    public async submit(task: string): Promise<void> {
        await vscode.commands.executeCommand('smaran-ai.chatView.focus');
        this.post({ type: 'echo', text: task });
        await this.start(task);
    }

    private async announce(): Promise<void> {
        const choice = await resolveChoice();
        this.post({
            type: 'ready',
            folder: this.folder(),
            model: choice.provider
                ? `${choice.provider} · ${choice.model || 'no model set'}`
                : (choice.model ? `local · ${choice.model}` : 'no model'),
            problem: choice.problem,
        });
    }

    private folder(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private post(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private async start(task: string): Promise<void> {
        if (!task.trim() || this.busy) {
            return;
        }
        if (!this.folder()) {
            this.post({
                type: 'error',
                text: 'Open a folder first. The agent works inside a project, and there is no project here.',
            });
            return;
        }

        const choice = await resolveChoice();
        if (choice.problem) {
            this.post({ type: 'error', text: choice.problem });
            return;
        }

        if (!vscode.workspace.getConfiguration('smaran').get<boolean>('planFirst', true)) {
            await this.execute(task);
            return;
        }

        this.post({ type: 'thinking', text: 'Working out what to do…' });
        try {
            this.post({ type: 'plan', text: await plan(task, choice), task });
        } catch (error) {
            this.post({ type: 'error', text: (error as Error).message });
        }
    }

    private async execute(task: string): Promise<void> {
        const folder = this.folder();
        if (!folder || this.busy) {
            return;
        }
        const choice = await resolveChoice();
        if (choice.problem) {
            this.post({ type: 'error', text: choice.problem });
            return;
        }

        this.busy = true;
        this.stopRequested = false;
        this.post({ type: 'started' });

        const used: string[] = [];
        try {
            for await (const event of run(task, folder, this.history, choice, () => this.stopRequested)) {
                this.post(this.forDisplay(event));
                if (event.type === 'tool_call') {
                    used.push(event.name);
                }
                if (event.type === 'done') {
                    // Kept so a follow-up ("now add a test for it") knows what
                    // was already done rather than starting from nothing.
                    this.history.push({ role: 'user', content: task });
                    this.history.push({ role: 'assistant', content: event.text });
                }
            }
            if (this.stopRequested) {
                this.post({ type: 'stopped' });
            }
        } catch (error) {
            this.post({ type: 'error', text: (error as Error).message });
        } finally {
            this.busy = false;
            this.post({ type: 'finished', used });
            // A run that wrote files leaves the editor showing what is no
            // longer on disk. This is the moment to say so.
            await vscode.commands.executeCommand('workbench.action.files.revert').then(undefined, () => undefined);
        }
    }

    private forDisplay(event: AgentEvent): Record<string, unknown> {
        if (event.type === 'tool_call') {
            // A whole file in an argument would bury the panel; the size says
            // as much as the text would.
            const shown = Object.entries(event.args).map(([key, value]) => {
                const text = String(value ?? '');
                return key === 'content'
                    ? [key, `${text.split('\n').length} lines`]
                    : [key, text.length > 200 ? `${text.slice(0, 200)}…` : text];
            });
            return { type: 'tool_call', name: event.name, args: shown, step: event.step };
        }
        if (event.type === 'done') {
            return { type: 'done', steps: event.steps, tools_used: event.toolsUsed };
        }
        return event as unknown as Record<string, unknown>;
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
  <header id="status"><span id="folder"></span><span id="model"></span></header>
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
