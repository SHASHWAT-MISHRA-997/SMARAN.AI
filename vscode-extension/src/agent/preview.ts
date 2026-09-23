/**
 * A live preview beside the editor, that updates as the agent works.
 *
 * WHY
 *
 * The agent could build a page and even test it in its own Chrome window, but
 * the person watching VS Code saw none of it: files changed in the explorer
 * and that was all. Claude Code and Codex show the thing being built, next to
 * the code, and it changes as the code changes. This is that.
 *
 * HOW
 *
 * A small static server for the workspace, on 127.0.0.1 only, started the
 * first time a preview is asked for. Every HTML page it serves carries a
 * five-line script that listens on /__smaran_reload (Server-Sent Events); a
 * watcher on the workspace sends an event whenever a file changes, and the
 * page reloads itself. The page is shown in VS Code's own Simple Browser,
 * beside the editor. A dev server's address (localhost:5173) is shown as it
 * is - it already reloads itself.
 *
 * WHAT IT WILL NOT SERVE
 *
 * Anything outside the workspace, and anything under a dot-name - .env, .git,
 * .ssh. The server is local-only, but a preview of a project should not be a
 * way to read its secrets from a browser tab.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

type Opener = (url: string) => Promise<void> | void;

let opener: Opener | undefined;
let server: http.Server | undefined;
let serverRoot = '';
let serverPort = 0;
let watcher: fs.FSWatcher | undefined;
const listeners = new Set<http.ServerResponse>();
let lastShown = '';

/** Set by the extension: how to show a URL beside the editor. Absent in tests. */
export function setPreviewOpener(fn: Opener | undefined): void {
    opener = fn;
}

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

const RELOAD_SCRIPT = '<script>(function(){try{var s=new EventSource("/__smaran_reload");'
    + 's.onmessage=function(){location.reload()};}catch(e){}})();</script>';

/** The file a request path maps to, or undefined when it is not ours to serve. */
export function resolveRequest(root: string, urlPath: string): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent((urlPath || '/').split('?')[0].split('#')[0]);
    } catch {
        return undefined;
    }
    const parts = decoded.split(/[\\/]+/).filter(Boolean);
    if (parts.some((part) => part.startsWith('.'))) return undefined;
    const target = path.resolve(root, ...parts);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    try {
        if (fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
    } catch {
        /* not there; the caller answers 404 */
    }
    return target;
}

function notifyChanged(): void {
    for (const response of listeners) {
        try {
            response.write('data: reload\n\n');
        } catch {
            listeners.delete(response);
        }
    }
}

async function ensureServer(root: string): Promise<number> {
    if (server && serverRoot === root) return serverPort;
    await stopPreview();
    serverRoot = root;
    server = http.createServer((request, response) => {
        if ((request.url || '').startsWith('/__smaran_reload')) {
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-store',
                Connection: 'keep-alive',
            });
            response.write(': connected\n\n');
            listeners.add(response);
            request.on('close', () => listeners.delete(response));
            return;
        }
        const file = resolveRequest(root, request.url || '/');
        if (!file) {
            response.writeHead(403, { 'Content-Type': 'text/plain' }).end('Not served.');
            return;
        }
        fs.readFile(file, (error, data) => {
            if (error) {
                response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found.');
                return;
            }
            const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
            let body: Buffer | string = data;
            if (type.startsWith('text/html')) {
                const html = data.toString('utf8');
                body = /<\/body>/i.test(html)
                    ? html.replace(/<\/body>/i, `${RELOAD_SCRIPT}</body>`)
                    : html + RELOAD_SCRIPT;
            }
            response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            response.end(body);
        });
    });
    await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
    });
    serverPort = (server.address() as { port: number }).port;

    let pending: NodeJS.Timeout | undefined;
    try {
        watcher = fs.watch(root, { recursive: true }, (_event, name) => {
            const changed = String(name || '');
            if (/(^|[\\/])(node_modules|\.git|dist|build)([\\/]|$)/.test(changed)) return;
            clearTimeout(pending);
            pending = setTimeout(notifyChanged, 150);
        });
    } catch {
        // Recursive watching is not available everywhere; the preview still
        // works, it just needs the agent's own reloads.
        watcher = undefined;
    }
    return serverPort;
}

/**
 * Show a page beside the editor. `target` is a file in the workspace
 * ("index.html", "site/about.html") or an address ("localhost:5173").
 * Returns what to tell the model.
 */
export async function showPreview(root: string, target: string): Promise<string> {
    const wanted = (target || '').trim() || 'index.html';
    let url: string;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(wanted) || /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(wanted)) {
        url = /^[a-z][a-z0-9+.-]*:\/\//i.test(wanted) ? wanted : `http://${wanted}`;
        const host = new URL(url).hostname;
        if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
            return 'The preview shows pages from this project or a local dev server only.';
        }
    } else {
        const file = resolveRequest(root, '/' + wanted.replace(/^[\\/]+/, ''));
        if (!file || !fs.existsSync(file)) {
            return `${wanted} is not a file in this workspace, so there is nothing to preview yet.`;
        }
        const port = await ensureServer(root);
        const relative = path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/');
        url = `http://127.0.0.1:${port}/${relative}`;
    }
    lastShown = url;
    if (opener) await opener(url);
    return `Live preview is open beside the editor at ${url}. It reloads by itself when files change. `
        + 'To test it - errors, clicking, typing - open the same address with open_browser.';
}

/** The address last shown, so the agent's own browser can test the same page. */
export function lastPreviewUrl(): string {
    return lastShown;
}

export async function stopPreview(): Promise<void> {
    for (const response of listeners) {
        try { response.end(); } catch { /* already closed */ }
    }
    listeners.clear();
    watcher?.close();
    watcher = undefined;
    if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = undefined;
    serverRoot = '';
    serverPort = 0;
}
