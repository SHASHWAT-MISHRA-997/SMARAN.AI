/**
 * What the agent can do, inside the folder you have open and nowhere else.
 *
 * These are the same seven tools the desktop app has, written again here so
 * that the extension needs nothing else installed. That duplication is a real
 * cost and worth naming: the app's copy is in backend/app/agent/tools.py, and
 * a change to one is a change to both. It is the price of the extension
 * working on a machine that has only VS Code on it, which is the point.
 *
 * The boundary is the folder. Every path is resolved first and then checked to
 * still be inside the root - that order matters, because `root/link/../../etc`
 * looks perfectly fine as text and is not fine at all once resolved.
 */

import { unified } from './diff';
import * as browser from './browser';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Long enough to work with, short enough that one file cannot fill the context. */
const MAX_OUTPUT = 12000;

/** Reading a file into a prompt has to stop somewhere. */
const MAX_READ_BYTES = 400_000;

/** Large, generated, and never what somebody means by "my project". */
const SKIP = new Set([
    '.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv',
    'env', 'dist', 'build', '.next', '.nuxt', 'target', '.gradle', '.idea',
    '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', 'site-packages',
    '.terraform', 'vendor', 'Pods', '.cache', 'out',
]);

export class ToolError extends Error {}

function clip(text: string, limit = MAX_OUTPUT): string {
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}\n… (${text.length - limit} more characters not shown)`;
}

/**
 * A path inside the open folder - or anywhere, when reach says so.
 *
 * The check resolves symlinks first, so a link pointing out of the project is
 * refused for where it lands rather than allowed for where it sits. When reach
 * is set to Anywhere the check is skipped, which is what that setting means;
 * the path is still resolved, so what runs is a real absolute path and not
 * whatever relative string the model happened to write.
 */
let confined = true;

/** Set once per run, from the reach dial. */
export function confineToFolder(on: boolean): void {
    confined = on;
}

function resolveInside(root: string, relative: string): string {
    const candidate = path.resolve(root, relative || '.');
    if (!confined) {
        return candidate;
    }

    let real = candidate;
    let realRoot = root;
    try {
        realRoot = fs.realpathSync(root);
        real = fs.existsSync(candidate)
            ? fs.realpathSync(candidate)
            : path.join(fs.realpathSync(path.dirname(candidate)), path.basename(candidate));
    } catch {
        // A parent that does not exist yet is reported by the caller as a
        // missing directory, which is more useful than a resolution failure.
    }

    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new ToolError(
            `${relative} is outside the open folder. Only files under ${root} can be read or changed.`,
        );
    }
    return real;
}

function walk(root: string, under: string): string[] {
    const found: string[] = [];
    const visit = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && SKIP.has(entry.name)) {
                continue;
            }
            const full = path.join(dir, entry.name);
            const shown = path.relative(root, full).split(path.sep).join('/');
            if (entry.isDirectory()) {
                found.push(`${shown}/`);
                if (found.length < 2000) {
                    visit(full);
                }
            } else {
                found.push(shown);
            }
        }
    };
    visit(under);
    return found;
}

export const TOOLS: Record<string, { args: string[]; description: string; changes: boolean }> = {
    list_files: { args: ['path'], description: 'List files in the project. path is optional.', changes: false },
    read_file: { args: ['path'], description: 'Read a file. Returns it with line numbers.', changes: false },
    write_file: { args: ['path', 'content'], description: 'Create or completely replace a file.', changes: true },
    edit_file: {
        args: ['path', 'find', 'replace'],
        description: 'Replace an exact piece of text in a file. The text must appear exactly once.',
        changes: true,
    },
    search: { args: ['query'], description: 'Find which files contain a piece of text.', changes: false },
    run_command: { args: ['command'], description: 'Run a shell command in the project and read its output.', changes: true },
    git: { args: ['subcommand'], description: 'Run a git command, for example: status, add -A, commit -m "...", push.', changes: true },
    /* Eyes.
     *
     * Without these the agent could build a page and never learn whether
     * it works: it wrote the code, said it was done, and the person
     * opened it themselves and found it broken. The loop that the agents
     * this one is compared to actually run is open it, look, fix, look
     * again - and there was nothing here to look with.
     *
     * Reading only. Clicking and typing are a larger surface and can be
     * added once reading has earned its place. */
    open_browser: {
        args: ['url'],
        description: 'Open a page in a real browser window and watch it. Use this after starting a dev server, and whenever the task is about something a person would look at. Example url: localhost:3000',
        changes: false,
    },
    browser_check: {
        args: [],
        description: 'Report what the open page says: uncaught errors, console errors and warnings, requests that failed, and the text it rendered. This is how you find out whether your change worked.',
        changes: false,
    },
    browser_click: {
        args: ['text'],
        description: 'Click something by the words on it - the label a person would read, for example "Save" or "Sign in". Not a CSS selector. If more than one thing matches it clicks nothing and tells you what it saw.',
        changes: true,
    },
    browser_type: {
        args: ['into', 'text', 'enter'],
        description: 'Type into a field, found by its label or placeholder. Replaces whatever is already in it. Set enter to yes to press Enter afterwards.',
        changes: true,
    },
    browser_reload: {
        args: [],
        description: 'Reload the open page and report it again. Use this after editing a file, to see whether the problem is gone.',
        changes: false,
    },
    /* The step list, published by the model and kept on screen.
     *
     * A long run was a scrolling column of tool calls: every step visible, the
     * shape of the work not. Watching it, you could not tell whether the agent
     * was on its second step of five or its fifth of five, or whether it had
     * quietly dropped the half of the task you cared about.
     *
     * Antigravity calls this a Task List and writes it before any code;
     * Claude Code keeps a todo list through the run. Same idea both times, and
     * the value is the same: the plan is stated where it can be checked
     * against what actually happens.
     *
     * It changes nothing on disk, so it is never gated by a mode. */
    todo: {
        args: ['items'],
        description: 'Publish or update your step list. items is one step per line, each '
            + 'starting with [ ] for not done, [~] for in progress, or [x] for done. '
            + 'Send the whole list every time, not just what changed. Use it at the '
            + 'start of anything with more than two steps, and again as each one is done.',
        changes: false,
    },
};

/** One published step. */
export interface TodoItem {
    state: 'todo' | 'doing' | 'done';
    text: string;
}

/**
 * Read the model's step list.
 *
 * Deliberately forgiving about the marker: models write `[ ]`, `[]`, `- [ ]`,
 * `1. [x]`, and a bullet with no box at all. A list that renders as nothing
 * because a dash was missing would be worse than no list, so anything with
 * text on the line becomes an item, and only the marker decides its state.
 */
export function parseTodo(text: string): TodoItem[] {
    const items: TodoItem[] = [];
    for (const line of String(text || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const marked = /^(?:[-*]\s*|\d+[.)]\s*)?\[([ x~*-]?)\]\s*(.+)$/i.exec(trimmed);
        if (marked) {
            const mark = marked[1].toLowerCase();
            items.push({
                state: mark === 'x' ? 'done' : (mark === '~' || mark === '*') ? 'doing' : 'todo',
                text: marked[2].trim(),
            });
            continue;
        }
        const bare = /^(?:[-*]\s+|\d+[.)]\s+)(.+)$/.exec(trimmed);
        if (bare) {
            items.push({ state: 'todo', text: bare[1].trim() });
        }
    }
    return items;
}

export function describeTools(): string {
    return Object.entries(TOOLS)
        .map(([name, tool]) => `- ${name}(${tool.args.join(', ')}): ${tool.description}`)
        .join('\n');
}

function listFiles(root: string, args: Record<string, string>): string {
    const under = args.path ? resolveInside(root, args.path) : root;
    if (!fs.existsSync(under)) {
        return `There is nothing at ${args.path}.`;
    }
    const entries = walk(root, under);
    return entries.length ? clip(entries.join('\n')) : `Nothing found under ${args.path || '.'}.`;
}

function readFile(root: string, args: Record<string, string>): string {
    const target = resolveInside(root, args.path);
    if (!fs.existsSync(target)) {
        return `${args.path} does not exist.`;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        return `${args.path} is a folder, not a file.`;
    }
    if (stat.size > MAX_READ_BYTES) {
        return `${args.path} is ${(stat.size / 1e6).toFixed(1)} MB, past the ${(MAX_READ_BYTES / 1e6).toFixed(1)} MB limit for reading.`;
    }
    const text = fs.readFileSync(target, 'utf8');
    if (!text) {
        return '(the file is empty)';
    }
    const numbered = text
        .split('\n')
        .map((line, index) => `${String(index + 1).padStart(5)}  ${line}`)
        .join('\n');
    return clip(numbered);
}

/* Every change, with what was there before it.
 *
 * Two reasons, and the second is the one that matters. A diff needs the old
 * text to compare against, and an agent that edits a file has destroyed the
 * only copy of it unless something kept one. Without this, "put that back"
 * had no answer except the version control the project may not have.
 *
 * Bounded, because a long run rewriting a large file would otherwise hold
 * every version of it in memory at once. The oldest is dropped first, which
 * is also the one least likely to be wanted.
 */
interface Recorded {
    path: string;
    before: string;
    after: string;
    existed: boolean;
    at: number;
}

const MAX_REMEMBERED = 40;
const history: Recorded[] = [];

function record(entry: Recorded): void {
    history.push(entry);
    if (history.length > MAX_REMEMBERED) history.shift();
}

/** The changes made so far, newest last. */
export function changes(): ReadonlyArray<Recorded> {
    return history;
}

/**
 * Put the most recent change back, and say what was undone.
 *
 * It refuses when the file has moved on since - somebody may have edited it
 * by hand, and silently throwing that away to restore an older version is
 * worse than the change being undone.
 */
export function undoLast(root: string): string {
    const last = history.pop();
    if (!last) { return "Nothing has been changed yet, so there is nothing to undo."; }

    const target = resolveInside(root, last.path);
    const now = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (now !== null && now !== last.after) {
        history.push(last);
        return last.path + " has changed since the agent wrote it, so it was left "
            + "alone rather than overwriting whatever that was.";
    }

    if (!last.existed) {
        try { fs.unlinkSync(target); } catch { /* already gone */ }
        return "Removed " + last.path + ", which the agent had created.";
    }
    fs.writeFileSync(target, last.before, "utf8");
    return "Put " + last.path + " back as it was.";
}

function writeFile(root: string, args: Record<string, string>): string {
    const target = resolveInside(root, args.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = args.content ?? '';
    const existed = fs.existsSync(target);
    const before = existed ? fs.readFileSync(target, 'utf8') : '';
    fs.writeFileSync(target, content, 'utf8');
    record({ path: args.path, before, after: content, existed, at: Date.now() });

    if (!existed) {
        // A trailing newline is not a line. Counting the split parts called a
        // one-line file two lines, every time.
        const lines = content.split(String.fromCharCode(10));
        if (lines.length && lines[lines.length - 1] === '') { lines.pop(); }
        const count = lines.length;
        return "Created " + args.path + " (" + count + (count === 1 ? " line)." : " lines).");
    }
    const shown = unified(before, content, args.path);
    return shown || (args.path + " was written with exactly what was already in it.");
}

function editFile(root: string, args: Record<string, string>): string {
    const target = resolveInside(root, args.path);
    if (!fs.existsSync(target)) {
        return `${args.path} does not exist.`;
    }
    const current = fs.readFileSync(target, 'utf8');
    const find = args.find ?? '';
    // Counting with split rather than a regex: the text is code, and code is
    // full of characters a regex would read as syntax.
    const occurrences = find ? current.split(find).length - 1 : 0;
    if (occurrences === 0) {
        return `That exact text is not in ${args.path}. Read the file again and copy the lines you mean, including their indentation.`;
    }
    if (occurrences > 1) {
        return `That text appears ${occurrences} times in ${args.path}, so it is not clear which one you mean. Include more surrounding lines to make it unique.`;
    }
    const updated = current.replace(find, args.replace ?? '');
    fs.writeFileSync(target, updated, 'utf8');
    record({ path: args.path, before: current, after: updated, existed: true, at: Date.now() });
    const shown = unified(current, updated, args.path);
    return shown || (args.path + " is unchanged - the replacement matches what was there.");
}

function search(root: string, args: Record<string, string>): string {
    const under = args.path ? resolveInside(root, args.path) : root;
    const query = args.query ?? '';
    const hits: string[] = [];
    for (const shown of walk(root, under)) {
        if (shown.endsWith('/') || hits.length >= 80) {
            continue;
        }
        const full = path.join(root, shown);
        let text: string;
        try {
            if (fs.statSync(full).size > MAX_READ_BYTES) {
                continue;
            }
            text = fs.readFileSync(full, 'utf8');
        } catch {
            continue;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].includes(query)) {
                hits.push(`${shown}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
                break;
            }
        }
    }
    return hits.length ? clip(hits.join('\n')) : `No file contains ${JSON.stringify(query)}.`;
}

function runCommand(root: string, args: Record<string, string>): Promise<string> {
    return new Promise((resolve) => {
        exec(
            args.command ?? '',
            { cwd: root, timeout: 300_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
                const output = `${stdout || ''}${stderr || ''}`.trim();
                if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
                    resolve('The command was still running after five minutes and was stopped.');
                    return;
                }
                // The exit code is part of the result. A command that failed
                // and a command that printed nothing have to look different,
                // or the model cannot tell whether its test passed.
                const code = error && typeof error.code === 'number' ? error.code : 0;
                resolve(clip(`exit code ${code}\n${output || '(no output)'}`));
            },
        );
    });
}

export async function execute(
    name: string,
    args: Record<string, string>,
    root: string,
): Promise<string> {
    const tool = TOOLS[name];
    if (!tool) {
        return `There is no tool called ${JSON.stringify(name)}. The ones that exist are: ${Object.keys(TOOLS).join(', ')}.`;
    }
    const missing = tool.args.filter((a) => a !== 'path' && !(a in args));
    if (missing.length) {
        return `${name} needs ${missing.join(' and ')}.`;
    }

    try {
        switch (name) {
            case 'list_files': return listFiles(root, args);
            case 'read_file': return readFile(root, args);
            case 'write_file': return writeFile(root, args);
            case 'edit_file': return editFile(root, args);
            case 'search': return search(root, args);
            case 'run_command': return await runCommand(root, args);
            case 'git': return await runCommand(root, { command: `git ${args.subcommand ?? ''}` });
            case 'open_browser': return await browser.open(String(args.url ?? ''));
            case 'browser_check': return await browser.check();
            case 'browser_click': return await browser.click(String(args.text ?? ''));
            case 'browser_type': return await browser.type(
                String(args.into ?? ''), String(args.text ?? ''),
                /^(y|yes|true|1)$/i.test(String(args.enter ?? '')));
            case 'browser_reload': return await browser.reload();
            case 'todo': {
                /* The list is shown by the panel, from the event the loop
                   emits. What goes back to the model is the list as it was
                   understood - so a model whose formatting was not read the
                   way it meant can see that and correct it, instead of
                   ticking items in its head that nobody else can see. */
                const items = parseTodo(args.items);
                if (!items.length) {
                    return 'No steps were read from that. Put one step per line, each '
                        + 'starting with [ ], [~] or [x].';
                }
                const done = items.filter((i) => i.state === 'done').length;
                return `Step list updated - ${done} of ${items.length} done:\n`
                    + items.map((i) => `${i.state === 'done' ? '[x]'
                        : i.state === 'doing' ? '[~]' : '[ ]'} ${i.text}`).join('\n');
            }
            default: return `${name} is listed but not implemented.`;
        }
    } catch (error) {
        // The failure goes to the model as a result, not up as an exception:
        // being told the path was refused is how it corrects itself.
        return `${name} failed: ${(error as Error).message.slice(0, 300)}`;
    }
}
