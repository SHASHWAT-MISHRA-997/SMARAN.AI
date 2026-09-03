/**
 * The panel.
 *
 * Three screens behind one view: the conversation, the past ones, and the
 * setup. Setup is in here rather than in settings.json because a person who
 * has just installed this has no key, no model and no idea which of the eight
 * providers to pick - and telling them to open a JSON file is how they stop.
 *
 * The conversation shows the work, not a summary of it: which file is being
 * read, which command is running, what that command printed. If it goes wrong
 * you can see the step it went wrong on.
 *
 * Two things are deliberately visible and never summarised away:
 *
 *   the folder it is working in, because an agent that writes files should
 *   never leave you guessing where;
 *
 *   which tools actually ran, listed at the end beside the agent's own account
 *   of what it did. A small model will write one file and say it wrote three.
 */

import * as path from 'path';
import * as vscode from 'vscode';

import { AgentEvent, run, ToolCall } from './agent/loop';
import { MODES, ModeId } from './agent/modes';
import { Message } from './agent/models';
import {
    deleteOllamaModel, firstVisionModel, listModels, ModelOption, PROVIDERS,
    pullOllamaModel,
} from './providers';
import { isOfficeFile, officeText } from './office';
import { Entry, Session, SessionStore } from './sessions';
import { McpRegistry } from './agent/mcpRegistry';
import { Keys, lmStudioUrl, mcpServers, ollamaUrl, resolveChoice } from './settings';

/** Enough of a file to be useful, short enough not to crowd out the task. */
const ATTACH_LIMIT = 60_000;

interface Attachment {
    path: string;
    /** Empty for an image: there is no text in a screenshot. */
    text: string;
    truncated: boolean;
    /** Base64, without the data: prefix. Present only for images. */
    image?: string;
    /** image/png, image/jpeg - what the model has to be told it is. */
    mime?: string;
}

/** Extensions a picture arrives as. Read as bytes rather than as text. */
const IMAGE_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};

export class AgentPanel implements vscode.WebviewViewProvider {
    public static readonly viewId = 'smaran-ai.chatView';

    private view?: vscode.WebviewView;
    private stopRequested = false;
    private busy = false;

    /** MCP servers stay open for the window, not per conversation: they are
     *  processes, and one per question would leave a pile of them running. */
    private readonly mcp = new McpRegistry();
    private session?: Session;
    private attachments: Attachment[] = [];
    /** Resolves when the person answers the approval showing in the panel. */
    private pendingApproval?: (allowed: boolean) => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly keys: Keys,
        private readonly sessions: SessionStore,
    ) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage((message) => void this.handle(message));
    }

    // ── incoming ──────────────────────────────────────────────────────────

    private async handle(message: { type: string; [key: string]: unknown }): Promise<void> {
        switch (message.type) {
            case 'hello': await this.announce(); break;
            case 'task': {
                const text = String(message.text || '');
                if (text.trim()) {
                    // Recorded before anything is attempted, so the question
                    // is in the transcript even if the answer fails.
                    this.record({ kind: 'you', title: 'You', body: text });
                }
                await this.start(text);
                break;
            }
            case 'approve': await this.execute(String(message.text || '')); break;

            case 'answer':
                // The loop is waiting on this. Answering twice would leave the
                // second answer with nothing to resolve, so it is cleared first.
                this.pendingApproval?.(Boolean(message.allowed));
                this.pendingApproval = undefined;
                break;

            case 'stop':
                this.stopRequested = true;
                // A run paused on an approval would otherwise sit there for
                // ever: stopping has to answer the question it is waiting on.
                this.pendingApproval?.(false);
                this.pendingApproval = undefined;
                break;

            case 'setMode':
                await vscode.workspace.getConfiguration('smaran')
                    .update('mode', String(message.mode), vscode.ConfigurationTarget.Global);
                await this.announce();
                break;

            case 'newSession':
                this.session = undefined;
                this.attachments = [];
                this.post({ type: 'cleared' });
                this.post({ type: 'attachments', files: [] });
                break;

            case 'listSessions':
                this.post({
                    type: 'sessions',
                    sessions: this.sessions.all().map((s) => ({
                        id: s.id, title: s.title, updatedAt: s.updatedAt, steps: s.entries.length,
                    })),
                });
                break;

            case 'openSession': {
                const session = this.sessions.get(String(message.id));
                if (session) {
                    this.session = session;
                    this.post({ type: 'restore', entries: session.entries, title: session.title });
                }
                break;
            }

            case 'deleteSession':
                await this.sessions.remove(String(message.id));
                if (this.session?.id === message.id) {
                    this.session = undefined;
                    this.post({ type: 'cleared' });
                }
                void this.handle({ type: 'listSessions' });
                break;

            case 'clearSessions': {
                /* The confirmation lives here because the webview has none:
                   window.confirm is blocked there, so the panel's own guard
                   never fired and this arrived unasked. */
                const answer = await vscode.window.showWarningMessage(
                    'Delete every saved conversation for this project?',
                    { modal: true },
                    'Delete all',
                );
                if (answer !== 'Delete all') break;
                await this.sessions.clear();
                this.session = undefined;
                this.post({ type: 'cleared' });
                void this.handle({ type: 'listSessions' });
                break;
            }

            case 'attach': await this.attach(); break;

            case 'attachImage': {
                /* A screenshot pasted into the composer. Held exactly as the
                   picker holds one, so there is one attachment type and one
                   path to the model rather than two. */
                const name = String(message.name || `pasted-${Date.now()}.png`);
                this.attachments = this.attachments.filter((a) => a.path !== name);
                this.attachments.push({
                    path: name,
                    text: '',
                    truncated: false,
                    image: String(message.data || ''),
                    mime: String(message.mime || 'image/png'),
                });
                this.sendAttachments();
                break;
            }

            case 'unattach':
                this.attachments = this.attachments.filter((a) => a.path !== message.path);
                this.sendAttachments();
                break;

            case 'setup': await this.sendSetup(); break;

            case 'saveKey':
                await this.keys.set(String(message.provider), String(message.key || ''));
                await this.sendSetup();
                break;

            case 'chooseProvider': {
                const config = vscode.workspace.getConfiguration('smaran');
                const chosen = String(message.provider);
                await config.update('provider', chosen, vscode.ConfigurationTarget.Global);
                // The model that was chosen belongs to the old provider and
                // will 404 against the new one. Clearing it is kinder than
                // letting that happen and reading as a broken extension.
                await config.update('model', '', vscode.ConfigurationTarget.Global);

                /* Then pick one, rather than leaving Setup with a key entered,
                   nothing selected and no sign that a second step is owed. The
                   list is already ordered coding-first; the first free entry is
                   a working default and every one of them is one tap away in
                   the chip. */
                const picked = await this.autoPickModel(chosen);
                await this.sendSetup();
                await this.announce();
                // Setup is finished when there is something to talk to, so it
                // gets out of the way instead of waiting to be dismissed.
                if (picked) this.post({ type: 'goChat', model: picked });
                break;
            }

            case 'chooseModel':
                await vscode.workspace.getConfiguration('smaran')
                    .update('model', String(message.model), vscode.ConfigurationTarget.Global);
                await this.sendSetup();
                await this.announce();
                break;

            case 'openMcpSettings': {
                /* settings.json, not the settings UI.
                 *
                 * This is an array of objects, and the UI cannot edit those -
                 * it shows the description and a single "Edit in settings.json"
                 * link, which is one more click and a screen that does
                 * nothing. Straight to the file, with a starter entry put in
                 * when there is none, so there is something to edit rather
                 * than a name to spell correctly from memory. */
                const config = vscode.workspace.getConfiguration('smaran');
                const existing = config.get<unknown[]>('mcpServers') || [];
                if (!existing.length) {
                    await config.update('mcpServers', [{
                        name: 'example',
                        target: 'npx -y @modelcontextprotocol/server-filesystem .',
                        enabled: false,
                    }], vscode.ConfigurationTarget.Global);
                }
                await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                break;
            }

            case 'refreshModels': await this.sendModels(String(message.provider)); break;

            case 'pullModel': {
                const name = String(message.model || '').trim();
                if (!name) break;
                this.post({ type: 'pull', model: name, percent: -1, status: 'starting…', busy: true });
                try {
                    await pullOllamaModel(ollamaUrl(), name, (percent, status) =>
                        this.post({ type: 'pull', model: name, percent, status, busy: true }));
                    this.post({ type: 'pull', model: name, percent: 100, status: 'installed', busy: false });
                    await this.sendSetup();
                } catch (error) {
                    this.post({
                        type: 'pull', model: name, percent: -1, busy: false,
                        status: (error as Error).message,
                        failed: true,
                    });
                }
                break;
            }

            case 'deleteModel': {
                const name = String(message.model || '');
                // Deleting a model is a download thrown away, and some of them
                // are many gigabytes. Worth one question.
                const answer = await vscode.window.showWarningMessage(
                    `Delete ${name} from Ollama? You would have to download it again.`,
                    { modal: true }, 'Delete');
                if (answer !== 'Delete') break;
                try {
                    await deleteOllamaModel(ollamaUrl(), name);
                    if (vscode.workspace.getConfiguration('smaran').get<string>('model') === name) {
                        await vscode.workspace.getConfiguration('smaran')
                            .update('model', '', vscode.ConfigurationTarget.Global);
                    }
                    await this.sendSetup();
                    await this.announce();
                } catch (error) {
                    void vscode.window.showErrorMessage(`Could not delete ${name}: ${(error as Error).message}`);
                }
                break;
            }

            case 'openLink':
                await vscode.env.openExternal(vscode.Uri.parse(String(message.url)));
                break;

            case 'openFile': {
                const folder = this.folder();
                if (folder) {
                    const uri = vscode.Uri.file(path.resolve(folder, String(message.path)));
                    await vscode.window.showTextDocument(uri, { preview: false }).then(undefined, () => {
                        void vscode.window.showWarningMessage(`Could not open ${message.path}.`);
                    });
                }
                break;
            }
        }
    }

    /** Give the agent a task from a command rather than the box. */
    public async submit(task: string): Promise<void> {
        await vscode.commands.executeCommand('smaran-ai.chatView.focus');
        this.record({ kind: 'you', title: 'You', body: task });
        await this.start(task);
    }

    // ── state out ─────────────────────────────────────────────────────────

    private folder(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private post(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private mode(): ModeId {
        const set = vscode.workspace.getConfiguration('smaran').get<string>('mode') as ModeId;
        return MODES.some((m) => m.id === set) ? set : 'manual';
    }

    private async announce(): Promise<void> {
        const choice = await resolveChoice(this.keys);
        const provider = PROVIDERS.find((p) => p.id === choice.provider);
        this.post({
            type: 'ready',
            folder: this.folder(),
            folderName: this.folder() ? path.basename(this.folder() as string) : undefined,
            provider: provider?.label || choice.provider,
            model: choice.model,
            problem: choice.problem,
            modes: MODES,
            mode: this.mode(),
        });
    }

    /**
     * Ask, and wait.
     *
     * The run is genuinely paused here - the loop is awaiting this promise, so
     * nothing is written and no command runs until there is an answer. That is
     * the difference between a mode and a label.
     */
    private ask(call: ToolCall, because: string | undefined): Promise<boolean> {
        return new Promise((resolve) => {
            this.pendingApproval = resolve;
            const command = call.name === 'git'
                ? `git ${call.args.subcommand ?? ''}`
                : call.args.command;
            this.post({
                type: 'confirm',
                name: call.name,
                what: command || call.args.path || '',
                because,
                detail: call.name === 'write_file'
                    ? `${(call.args.content ?? '').split('\n').length} lines`
                    : call.args.find
                        ? `replacing ${(call.args.find ?? '').split('\n').length} line(s)`
                        : undefined,
            });
        });
    }

    /**
     * How many models each local runner has, right now.
     *
     * Plenty of people have both Ollama and LM Studio installed. Without this
     * the only way to find out which one is running, and what is in it, was to
     * select it and wait - so the list said the same thing about both whether
     * one was running, both were, or neither.
     */
    private async localStatus(): Promise<Record<string, string>> {
        const count = async (id: string, url: string) => {
            try {
                const models = await listModels(id, '', ollamaUrl(), lmStudioUrl());
                return models.length ? `${models.length} model${models.length === 1 ? '' : 's'}` : 'no models yet';
            } catch {
                return 'not running';
            }
        };
        const [ollama, lmstudio] = await Promise.all([
            count('', ollamaUrl()),
            count('lmstudio', lmStudioUrl()),
        ]);
        return { '': ollama, lmstudio };
    }

    private async sendSetup(): Promise<void> {
        const config = vscode.workspace.getConfiguration('smaran');
        const provider = (config.get<string>('provider') || '').trim();
        this.post({
            type: 'setup',
            providers: PROVIDERS,
            localStatus: await this.localStatus(),
            mcp: await this.mcpReport(),
            configured: await this.keys.configured(),
            provider,
            model: (config.get<string>('model') || '').trim(),
            modes: MODES,
            mode: this.mode(),
            ollamaUrl: ollamaUrl(),
        });
        await this.sendModels(provider);
    }

    /**
     * Choose a model for a provider that has none, and say which.
     *
     * Entering a key used to leave you on Setup with nothing selected: the
     * agent refused to run, and the only clue was a chip reading "choose a
     * model" on a screen you had just left. Returns undefined when nothing
     * could be listed - a wrong key, or a local runner that is not started -
     * and in that case Setup stays put, which is where the problem is.
     */
    private async autoPickModel(provider: string): Promise<string | undefined> {
        let models: ModelOption[];
        try {
            models = await listModels(
                provider, await this.keys.get(provider), ollamaUrl(), lmStudioUrl());
        } catch {
            return undefined;
        }
        const definition = PROVIDERS.find((p) => p.id === provider);
        // Only where free and paid sit in one list. Where everything is free,
        // or nothing is, the flag says nothing and filtering on it would
        // discard the whole catalogue.
        const preferred = definition?.free_models === 'some'
            ? models.filter((m) => m.free)
            : models;
        const pick = (preferred[0] || models[0])?.id;
        if (!pick) return undefined;
        await vscode.workspace.getConfiguration('smaran')
            .update('model', pick, vscode.ConfigurationTarget.Global);
        return pick;
    }

    /**
     * What the MCP servers are doing, for the Setup screen.
     *
     * Connecting here rather than only before a run means the screen shows
     * the truth as soon as you look at it - including a server that will not
     * start, which is the thing worth knowing before asking a question that
     * depends on it.
     */
    private async mcpReport(): Promise<
        { name: string; target: string; connected: boolean; tools: string[]; problem?: string }[]
    > {
        const configured = mcpServers();
        if (!configured.length) return [];
        try {
            await this.mcp.use(configured);
        } catch {
            // A failure to connect is already recorded per server.
        }
        return this.mcp.report();
    }

    private async sendModels(provider: string): Promise<void> {
        this.post({ type: 'models', provider, loading: true, models: [] });
        try {
            const models = await listModels(
                provider, await this.keys.get(provider), ollamaUrl(), lmStudioUrl());
            this.post({ type: 'models', provider, loading: false, models });
        } catch (error) {
            // The local runners fail by not being started, which is not the
            // same problem as a bad key and should not read like one. Neither
            // message names a model to install: whichever one you already have
            // will appear in this list, and pushing a particular one is not
            // this extension's business.
            const notRunning = (where: string, url: string) =>
                `${where} is not answering at ${url}. Start it, and any model you have there `
                + 'will appear here.';

            this.post({
                type: 'models', provider, loading: false, models: [],
                error: provider === '' ? notRunning('Ollama', ollamaUrl())
                    : provider === 'lmstudio' ? notRunning('LM Studio', lmStudioUrl())
                    : (error as Error).message,
            });
        }
    }

    // ── attachments ───────────────────────────────────────────────────────

    private async attach(): Promise<void> {
        const folder = this.folder();
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach',
            defaultUri: folder ? vscode.Uri.file(folder) : undefined,
        });
        if (!picked?.length) {
            return;
        }
        for (const uri of picked) {
            const shown = folder ? path.relative(folder, uri.fsPath).split(path.sep).join('/') : uri.fsPath;
            const mime = IMAGE_TYPES[path.extname(uri.fsPath).toLowerCase()];
            try {
                const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
                this.attachments = this.attachments.filter((a) => a.path !== shown);
                if (mime) {
                    // A picture read as UTF-8 is a page of replacement
                    // characters, which is what used to be sent.
                    this.attachments.push({
                        path: shown, text: '', truncated: false,
                        image: bytes.toString('base64'), mime,
                    });
                } else if (isOfficeFile(path.extname(uri.fsPath))) {
                    /* A .docx read as UTF-8 is a page of binary, and that is
                       what used to be attached. These are zips of XML; the
                       words are pulled out of the parts that hold them. */
                    const words = officeText(path.extname(uri.fsPath), bytes);
                    if (!words) {
                        void vscode.window.showWarningMessage(
                            `${shown} has no readable text in it.`);
                        continue;
                    }
                    this.attachments.push({
                        path: shown,
                        text: `[text extracted from ${shown}; layout, tables and images `
                            + `are not preserved]

${words.slice(0, ATTACH_LIMIT)}`,
                        truncated: words.length > ATTACH_LIMIT,
                    });
                } else {
                    const raw = bytes.toString('utf8');
                    this.attachments.push({
                        path: shown,
                        text: raw.slice(0, ATTACH_LIMIT),
                        truncated: raw.length > ATTACH_LIMIT,
                    });
                }
            } catch {
                void vscode.window.showWarningMessage(`${shown} could not be read.`);
            }
        }
        this.sendAttachments();
    }

    /** What is attached, in a shape the panel can show rather than just name. */
    private sendAttachments(): void {
        this.post({
            type: 'attachments',
            files: this.attachments.map((a) => a.path),
            items: this.attachments.map((a) => ({
                path: a.path,
                kind: a.image ? 'image' : 'text',
                // Small enough to sit in a chip; it is the same bytes the model
                // will be given, so the preview cannot disagree with what is sent.
                preview: a.image ? `data:${a.mime};base64,${a.image}` : undefined,
                bytes: a.image ? Math.round((a.image.length * 3) / 4) : a.text.length,
                truncated: a.truncated,
            })),
        });
    }

    /**
     * The task, with anything attached put in front of it.
     *
     * Files inside the project are named rather than pasted - the agent can
     * read those itself, and pasting them twice wastes the context it needs.
     * A file from outside cannot be read by any tool, so its contents are the
     * only way it can be seen at all.
     */
    private compose(task: string): string {
        if (!this.attachments.length) {
            return task;
        }
        const inside: string[] = [];
        const pasted: string[] = [];
        for (const file of this.attachments) {
            if (file.path.startsWith('..') || path.isAbsolute(file.path)) {
                pasted.push(
                    `--- ${file.path}${file.truncated ? ' (first part only)' : ''} ---\n${file.text}`);
            } else {
                inside.push(file.path);
            }
        }
        const parts: string[] = [];
        if (inside.length) {
            parts.push(`These files are the ones I mean: ${inside.join(', ')}. Read them before you start.`);
        }
        if (pasted.length) {
            parts.push(`Attached, from outside the project:\n\n${pasted.join('\n\n')}`);
        }
        parts.push(task);
        return parts.join('\n\n');
    }

    // ── running ───────────────────────────────────────────────────────────

    private record(entry: Entry): void {
        if (entry.kind === 'skip') {
            return;
        }
        this.post({ type: 'entry', entry });
        /* Shown, not kept. "thinking" is replaced by whatever the model says,
           so writing it to the transcript would fill a reopened conversation
           with a row per step saying it was about to do something. */
        if (entry.kind === 'thinking') {
            return;
        }
        if (!this.session) {
            this.session = this.sessions.create(entry.kind === 'you' ? entry.body || '' : 'Untitled');
        }
        this.session.entries.push(entry);
        void this.sessions.save(this.session);
    }

    private async start(task: string): Promise<void> {
        if (!task.trim() || this.busy) {
            return;
        }
        if (!this.folder()) {
            this.record({
                kind: 'error', title: 'No folder open',
                body: 'The agent works inside a project. Open a folder and try again.',
            });
            return;
        }

        const choice = await resolveChoice(this.keys);
        if (choice.problem) {
            this.post({ type: 'needsSetup', reason: choice.problem });
            return;
        }

        // Plan mode explores the real code and reports; the other three go
        // straight to work and differ in what they do without asking. A
        // separate "write a plan first" step on top of that would be a second
        // thing called planning, which is one too many.
        await this.execute(task);
    }

    private async execute(task: string): Promise<void> {
        const folder = this.folder();
        if (!folder || this.busy) {
            return;
        }
        const choice = await resolveChoice(this.keys);
        if (choice.problem) {
            this.post({ type: 'needsSetup', reason: choice.problem });
            return;
        }

        this.busy = true;
        this.stopRequested = false;
        const mode = this.mode();
        this.post({ type: 'started' });

        const history: Message[] = this.session?.history || [];
        const composed = this.compose(task);
        try {
            /* Connect before the first step, so the tools are in the prompt
               rather than discovered halfway through. A server that will not
               start is not fatal: its tools are absent and the panel says
               why, which beats an agent quietly missing half its abilities. */
            /* What this mode will and will not do, before it does anything.
               A mode that never interrupts looks like a mode that does
               nothing - the run that prompted this only read files, which no
               mode gates, so Manual sat silent throughout and read as fake. */
            const active = MODES.find((m) => m.id === mode);
            if (active) {
                this.record({
                    kind: 'note',
                    title: `${active.label} — ${active.description}`,
                });
            }

            /* A picture needs a model with eyes.
             *
             * Sending one to a model without them produced "openrouter refused
             * the request (HTTP 404). No endpoints found that support image
             * input" - true, and no use to anybody. The provider knows which
             * of its models can see, so it is asked, and the swap is announced
             * rather than done quietly: it changes what answers, and that is
             * worth a line. */
            const pictures = this.attachments.filter((a) => a.image && a.mime);
            if (pictures.length) {
                const current = (await listModels(
                    choice.provider, await this.keys.get(choice.provider),
                    ollamaUrl(), lmStudioUrl(),
                ).catch(() => [] as ModelOption[])).find((m) => m.id === choice.model);

                // Only swap when the provider has actually said it cannot see.
                // Where nothing is said, the model is tried and the provider
                // gets to answer for itself.
                if (current && current.vision === false) {
                    const seeing = await firstVisionModel(
                        choice.provider, await this.keys.get(choice.provider),
                        ollamaUrl(), lmStudioUrl(),
                    );
                    if (seeing) {
                        this.record({
                            kind: 'note',
                            title: `${choice.model} cannot read pictures, so this one is going to ${seeing}`,
                        });
                        choice.model = seeing;
                    } else {
                        this.record({
                            kind: 'note',
                            title: `${choice.provider || 'This provider'} has no model that reads pictures`,
                            body: 'The screenshot is attached and will be sent; the model will '
                                + 'say for itself whether it can see it.',
                        });
                    }
                }
            }

            await this.mcp.use(mcpServers());
            const report = this.mcp.report();
            const broken = report.filter((r) => !r.connected);
            if (broken.length) {
                this.record({
                    kind: 'note',
                    title: `${broken.length} MCP server${broken.length === 1 ? '' : 's'} did not start`,
                    body: broken.map((r) => r.problem || r.name).join('\n'),
                });
            }

            for await (const event of run(
                composed, folder, history, choice, () => this.stopRequested,
                mode, (call, because) => this.ask(call, because), this.mcp,
                this.attachments
                    .filter((a) => a.image && a.mime)
                    .map((a) => ({ data: a.image as string, mime: a.mime as string })),
            )) {
                this.record(this.asEntry(event, folder));
                if (event.type === 'done' && this.session) {
                    // Kept so a follow-up - "now add a test for that" - knows
                    // what was already done rather than starting from nothing.
                    this.session.history.push({ role: 'user', content: composed });
                    this.session.history.push({ role: 'assistant', content: event.text });
                    await this.sessions.save(this.session);
                }
            }
            if (this.stopRequested) {
                this.record({ kind: 'note', title: 'Stopped. What it had already done is done.' });
            }
        } catch (error) {
            this.record({ kind: 'error', title: 'Stopped', body: (error as Error).message });
        } finally {
            this.busy = false;
            this.pendingApproval = undefined;
            this.attachments = [];
            this.post({ type: 'attachments', files: [] });
            this.post({ type: 'finished', mode });
        }
    }

    /** One event, in the words the panel shows and the history keeps. */
    private asEntry(event: AgentEvent, folder: string): Entry {
        switch (event.type) {
            case 'workspace':
                return { kind: 'note', title: `Working in ${event.root}` };

            case 'thinking':
                // Something on screen for the part of a run that is just
                // waiting. On a slow free model this is most of it.
                return { kind: 'thinking', title: `Step ${event.step} · thinking…` };

            case 'note':
                return { kind: 'note', title: event.text };

            case 'message':
                // An empty one was drawn as an empty box - a question asked,
                // a box, and nothing in it. The parser refuses empty replies
                // now; this is the belt to that pair of braces.
                return event.text.trim()
                    ? { kind: 'says', body: event.text }
                    : { kind: 'skip' };

            case 'tool_call': {
                const args = Object.entries(event.args).map(([key, value]) => {
                    const text = String(value ?? '');
                    // A whole file in an argument would bury the panel; its
                    // size says as much as the text would.
                    return key === 'content'
                        ? `${key}: ${text.split('\n').length} lines`
                        : `${key}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
                });
                return {
                    kind: 'tool',
                    title: `Step ${event.step} · ${event.name}`,
                    body: args.join('\n'),
                };
            }

            case 'tool_result':
                return { kind: 'result', body: event.result };

            case 'refused':
                return { kind: 'note', title: `${event.name} was not run`, body: event.because };

            case 'done':
                // Only worth saying when something was done. A card after
                // every reply announcing that nothing happened is noise, and
                // after "Hi" it is faintly absurd.
                return event.toolsUsed.length
                    ? {
                        kind: 'done',
                        title: `Finished in ${event.steps} steps`,
                        body: `Tools that ran: ${event.toolsUsed.join(', ')}`,
                    }
                    : { kind: 'skip' };

            case 'error':
                return { kind: 'error', title: 'Stopped', body: event.message };
        }
        return { kind: 'note', title: String(folder) };
    }

    // ── the page ──────────────────────────────────────────────────────────

    private html(webview: vscode.Webview): string {
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name));
        const nonce = Math.random().toString(36).slice(2);
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- data: is on img-src for the attachment thumbnails. A pasted screenshot is
     held as base64 and shown as a data URL; without it the policy blocked the
     thumbnail and the chip drew a broken-image box beside "29 KB image".
     Everything else stays shut. -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link href="${asset('panel.css')}" rel="stylesheet">
</head>
<body>
  <!-- Three fixed layers behind everything: a slow colour wash, a perspective
       grid, and a scanline. All CSS, no canvas and no timers - a panel that
       sits open all day should not be spending a core on its own wallpaper. -->
  <div class="fx fx-wash" aria-hidden="true"></div>
  <div class="fx fx-grid" aria-hidden="true"></div>
  <div class="fx fx-scan" aria-hidden="true"></div>

  <header>
    <!-- The real mark. This was a gradient square standing in for a logo
         that has been in this folder the whole time. -->
    <img class="brand" src="${asset('smaran-logo.png')}" alt="SMARAN.AI">
    <span id="folder" title="The folder the agent works in">—</span>
    <span class="spacer"></span>
    <button id="tabHistory" class="icon" title="Past conversations">History</button>
    <button id="tabSetup" class="icon" title="Model and keys">Setup</button>
    <button id="newSession" class="icon" title="Start a new conversation">New</button>
  </header>
  <!-- Shown only while a run is in flight, so "is it doing anything" never
       has to be answered by watching for new text to appear. -->
  <div id="beam" class="beam" hidden aria-hidden="true"></div>

  <!-- What it is doing, right now, pinned.
       The transcript scrolls; this does not. A run that reads twenty files
       pushes its own progress off the screen, and then the only way to know
       whether anything is happening is to watch for new text - which is the
       thing people said was missing. -->
  <div id="status" class="status" hidden>
    <span class="status-dot" aria-hidden="true"></span>
    <span id="statusText">Working…</span>
    <span id="statusTime" class="status-time"></span>
  </div>

  <main id="log" class="screen"></main>
  <section id="history" class="screen" hidden></section>
  <section id="setup" class="screen" hidden></section>

  <footer id="composer">
    <div id="attachments" class="chips"></div>
    <textarea id="task" rows="3"
      placeholder="What should it do?  It can read the project, change files and run commands."></textarea>
    <div class="row">
      <button id="attach" class="ghost" title="Attach a file">+</button>
      <button id="modeChip" class="ghost mode" title="How much it may do without asking">Manual</button>
      <span class="spacer"></span>
      <button id="modelChip" class="ghost model" title="Provider and model">no model</button>
      <button id="send" title="Ctrl+Enter">Send</button>
      <button id="stop" class="ghost" hidden>Stop</button>
    </div>
    <div id="modeMenu" class="menu" hidden></div>
  </footer>
<script nonce="${nonce}" src="${asset('panel.js')}"></script>
</body>
</html>`;
    }
}
