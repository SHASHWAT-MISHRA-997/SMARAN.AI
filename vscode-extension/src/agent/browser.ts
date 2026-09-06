/**
 * A real browser the agent can open, look at, and be told the truth by.
 *
 * WHY THIS EXISTS
 *
 * The agent could read files, write files and run commands, and that is enough
 * to build a web page and never once find out whether it works. It was asked
 * to behave like the agents people compare it to - open the thing, look at it,
 * see the error, fix it, look again - and it had no way to open anything. So
 * it wrote code, said it was done, and the person opened the page themselves
 * and found it broken. Every time.
 *
 * What was missing is not cleverness. It is eyes.
 *
 * HOW IT WORKS
 *
 * Chrome and Edge speak the Chrome DevTools Protocol when started with
 * --remote-debugging-port. That is the same mechanism Puppeteer and Playwright
 * use, and it needs no driver and no download: the browser is already on the
 * machine. A short HTTP request lists the open targets, and a websocket to one
 * of them carries the commands and, more importantly, the events - every
 * console message, every uncaught exception, every request that failed.
 *
 * A separate profile directory is used deliberately. Attaching to the person's
 * everyday browser would mean their tabs, their cookies and their logins are
 * in reach of a model, and there is no reason for that. This window starts
 * empty and is thrown away.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not click things or fill forms. Reading is what closes the loop
 * between a change and knowing whether it worked, and reading cannot break
 * anything. Driving the page is a larger surface and a larger risk, and it can
 * be added when reading has proven itself.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import WebSocket from 'ws';

/** Where a Chromium browser usually is on each platform, in order of preference. */
const CANDIDATES: Record<string, string[]> = {
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
    ],
};

export class BrowserError extends Error {}

function findBrowser(): string {
    for (const candidate of CANDIDATES[process.platform] ?? []) {
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
            // Not there. The next one might be.
        }
    }
    throw new BrowserError(
        'No Chrome, Edge or Brave was found on this machine, so there is '
        + 'nothing to open the page in. Any one of them installs this ability; '
        + 'nothing is downloaded by the extension itself.');
}

interface Collected {
    /** console.error and console.warn, newest last. */
    console: string[];
    /** Uncaught exceptions, with the message and where it came from. */
    exceptions: string[];
    /** Requests the page asked for and did not get. */
    failedRequests: string[];
}

let child: ChildProcess | null = null;
let socket: WebSocket | null = null;
let port = 0;
let nextId = 1;
let currentUrl = '';
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const collected: Collected = { console: [], exceptions: [], failedRequests: [] };

/** Keep a bounded amount: a page in a reload loop would otherwise fill memory. */
const MAX_KEPT = 60;

function remember(list: string[], line: string): void {
    list.push(line);
    if (list.length > MAX_KEPT) list.shift();
}

function getJson(url: string, timeoutMs = 4000): Promise<any> {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: timeoutMs }, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error as Error); }
            });
        });
        request.on('timeout', () => { request.destroy(new Error('timed out')); });
        request.on('error', reject);
    });
}

async function freePort(): Promise<number> {
    const net = await import('net');
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const chosen = (server.address() as any).port as number;
            server.close(() => resolve(chosen));
        });
    });
}

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!socket) throw new BrowserError('The browser is not open. Use open_browser first.');
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket!.send(JSON.stringify({ id, method, params }));
        // A command that never comes back would hang the whole agent run.
        setTimeout(() => {
            if (pending.delete(id)) reject(new BrowserError(`${method} did not answer in 20s.`));
        }, 20000);
    });
}

/** Turn a CDP console argument list into something readable. */
function describeArgs(args: any[]): string {
    return (args ?? [])
        .map((a) => a?.value ?? a?.description ?? a?.unserializableValue ?? a?.type ?? '')
        .join(' ')
        .trim();
}

function listen(message: any): void {
    if (message.id !== undefined) {
        const waiting = pending.get(message.id);
        if (!waiting) return;
        pending.delete(message.id);
        if (message.error) waiting.reject(new BrowserError(message.error.message ?? 'protocol error'));
        else waiting.resolve(message.result);
        return;
    }

    switch (message.method) {
        case 'Runtime.consoleAPICalled': {
            const level = message.params?.type;
            // Only what indicates something is wrong. A page that logs its own
            // progress would otherwise bury the one line that matters.
            if (level !== 'error' && level !== 'warning' && level !== 'assert') return;
            const text = describeArgs(message.params?.args);
            if (text) remember(collected.console, `${level}: ${text}`);
            break;
        }
        case 'Runtime.exceptionThrown': {
            const details = message.params?.exceptionDetails ?? {};
            const text = details.exception?.description
                ?? details.text
                ?? 'an exception with no description';
            const where = details.url
                ? ` (${details.url}:${(details.lineNumber ?? 0) + 1})`
                : '';
            remember(collected.exceptions, `${String(text).split('\n')[0]}${where}`);
            break;
        }
        case 'Network.loadingFailed': {
            const reason = message.params?.errorText ?? 'failed';
            const kind = message.params?.type ?? '';
            remember(collected.failedRequests, `${kind} request failed: ${reason}`);
            break;
        }
        case 'Network.responseReceived': {
            const status = message.params?.response?.status ?? 0;
            if (status >= 400) {
                remember(collected.failedRequests,
                    `${status} for ${message.params?.response?.url ?? 'a request'}`);
            }
            break;
        }
        default:
            break;
    }
}

async function attach(): Promise<void> {
    const targets: any[] = await getJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new BrowserError('The browser started but exposed no page to attach to.');

    socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
        socket!.once('open', () => resolve());
        socket!.once('error', (e) => reject(new BrowserError(String(e))));
    });
    socket.on('message', (raw) => {
        try { listen(JSON.parse(String(raw))); } catch { /* not JSON we understand */ }
    });
    socket.on('close', () => { socket = null; });

    // Events first, so nothing that happens during the very first load is missed.
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Network.enable');
}

/** Open a page, replacing whatever was open before. */
export async function open(url: string): Promise<string> {
    // Any scheme, not only http. Checking for http:// alone turned a
    // file:// path into http://file:///... and Chrome went looking for a
    // host called "file" - which is what the first run of this actually did.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        // A bare "localhost:3000" is what anybody types, and it is unambiguous.
        url = `http://${url}`;
    }

    if (!socket || !child || child.exitCode !== null) {
        await close();
        const executable = findBrowser();
        port = await freePort();
        const profile = path.join(os.tmpdir(), `smaran-codex-browser-${process.pid}`);
        child = spawn(executable, [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            '--no-first-run',
            '--no-default-browser-check',
            // A window the person can actually watch. Headless would be easier
            // and would defeat the point: they asked to see it working.
            '--new-window',
            'about:blank',
        ], { detached: false, stdio: 'ignore' });

        // The port is not open the instant the process starts.
        const deadline = Date.now() + 15000;
        for (;;) {
            try {
                await getJson(`http://127.0.0.1:${port}/json/version`, 1000);
                break;
            } catch {
                if (Date.now() > deadline) {
                    throw new BrowserError('The browser did not start listening within 15 seconds.');
                }
                await new Promise((r) => setTimeout(r, 300));
            }
        }
        await attach();
    }

    // A fresh page means a fresh set of problems; keeping the previous ones
    // would report an error that has already been fixed.
    collected.console.length = 0;
    collected.exceptions.length = 0;
    collected.failedRequests.length = 0;

    await send('Page.navigate', { url });
    currentUrl = url;

    // Settle, so that check() straight afterwards sees a loaded page rather
    // than an empty one. Two seconds is enough for a local dev server and
    // short enough not to feel like a hang.
    await new Promise((r) => setTimeout(r, 2000));
    return `Opened ${url}. Use browser_check to see what the page reports.`;
}

/** What the page says about itself right now. */
export async function check(): Promise<string> {
    if (!socket) {
        throw new BrowserError('No page is open. Use open_browser first.');
    }

    let title = '';
    let text = '';
    let ok = true;
    try {
        const result = await send('Runtime.evaluate', {
            expression: `(() => ({
                title: document.title,
                text: (document.body ? document.body.innerText : '').slice(0, 4000)
            }))()`,
            returnByValue: true,
        });
        title = result?.result?.value?.title ?? '';
        text = result?.result?.value?.text ?? '';
    } catch (error) {
        ok = false;
        text = `The page could not be read: ${(error as Error).message}`;
    }

    const lines: string[] = [];
    lines.push(`URL: ${currentUrl}`);
    if (title) lines.push(`Title: ${title}`);

    const problems = collected.exceptions.length
        + collected.console.length
        + collected.failedRequests.length;

    if (!problems && ok) {
        lines.push('No errors, no failed requests, nothing logged as a warning.');
    }
    if (collected.exceptions.length) {
        lines.push('', 'Uncaught errors:');
        collected.exceptions.forEach((e) => lines.push(`  ${e}`));
    }
    if (collected.console.length) {
        lines.push('', 'Console:');
        collected.console.forEach((e) => lines.push(`  ${e}`));
    }
    if (collected.failedRequests.length) {
        lines.push('', 'Requests that failed:');
        collected.failedRequests.forEach((e) => lines.push(`  ${e}`));
    }

    // The text last, because when something is broken the errors are what
    // matters and a wall of page copy pushes them out of view.
    if (text.trim()) {
        lines.push('', 'What the page shows:', text.trim());
    } else if (ok) {
        lines.push('', 'The page rendered no text at all, which usually means it '
            + 'failed before drawing anything.');
    }

    return lines.join('\n');
}

/** Reload and report, which is the whole loop after a fix. */
export async function reload(): Promise<string> {
    if (!socket) throw new BrowserError('No page is open. Use open_browser first.');
    collected.console.length = 0;
    collected.exceptions.length = 0;
    collected.failedRequests.length = 0;
    await send('Page.reload', { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 2000));
    return check();
}

export async function close(): Promise<void> {
    try { socket?.close(); } catch { /* already gone */ }
    socket = null;
    pending.clear();
    if (child && child.exitCode === null) {
        try { child.kill(); } catch { /* already gone */ }
    }
    child = null;
    currentUrl = '';
}

/** True when a window is open, so the panel can say so. */
export function isOpen(): boolean {
    return Boolean(socket);
}
