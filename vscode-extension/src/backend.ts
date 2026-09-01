/**
 * Finding the SMARAN.AI app, and talking to the agent inside it.
 *
 * The agent is not in this extension. It lives in the app, where the tools,
 * the workspace boundary and the model routing already are, and where the
 * desktop and the command line reach the same code. This file is the wire
 * between the editor and that.
 *
 * The app publishes the port it actually bound to, because its preferred port
 * is often taken. Guessing a fixed port is how the previous version ended up
 * timing out against nothing.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import * as vscode from 'vscode';

/** One thing that happened during a run, as the app reports it. */
export interface AgentEvent {
    type: 'workspace' | 'message' | 'tool_call' | 'tool_result' | 'done' | 'error';
    root?: string;
    text?: string;
    name?: string;
    arguments?: Record<string, string>;
    result?: string;
    step?: number;
    steps?: number;
    tools_used?: string[];
    message?: string;
}

/** Where the app said it is listening, if it is running at all. */
function discoverRunningApp(): string | undefined {
    const roots = [
        process.env.LOCALAPPDATA,                                  // Windows
        path.join(os.homedir(), 'Library', 'Application Support'),  // macOS
        path.join(os.homedir(), '.local', 'share'),                 // Linux
        os.homedir(),
    ].filter(Boolean) as string[];

    for (const root of roots) {
        const advert = path.join(root, 'SMARAN.AI', 'data', 'runtime.json');
        if (!fs.existsSync(advert)) {
            continue;
        }
        let parsed: { port?: number; url?: string; pid?: number };
        try {
            parsed = JSON.parse(fs.readFileSync(advert, 'utf8'));
        } catch {
            continue;
        }
        if (typeof parsed.port !== 'number') {
            continue;
        }
        // The file outlives a force-quit, and a stale advert sends every
        // request to a port that now belongs to nobody. Signal 0 kills
        // nothing; it only asks whether that process is still there.
        if (typeof parsed.pid === 'number') {
            try {
                process.kill(parsed.pid, 0);
            } catch {
                continue;
            }
        }
        return parsed.url || `http://127.0.0.1:${parsed.port}`;
    }
    return undefined;
}

export function baseUrl(): string | undefined {
    const configured = vscode.workspace.getConfiguration('smaran').get<string>('backendUrl');
    if (configured && configured.trim()) {
        return configured.trim().replace(/\/+$/, '');
    }
    return discoverRunningApp();
}

/** The message shown when the app is not running, in place of a silent failure. */
export const APP_NOT_FOUND =
    'The SMARAN.AI app is not running, and the agent lives inside it. ' +
    'Start the app, or set smaran.backendUrl if it is somewhere else.';

interface RequestOptions {
    method: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
}

function request(url: string, options: RequestOptions): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === 'https:' ? https : http;
        const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

        const req = transport.request(
            target,
            {
                method: options.method,
                headers: payload
                    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                    : {},
            },
            resolve,
        );
        req.on('error', (error: NodeJS.ErrnoException) => {
            // "connect ECONNREFUSED 127.0.0.1:1" tells a person nothing about
            // what to do. A refused connection here has one meaning.
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                reject(new Error(`Nothing answered at ${target.origin}. ${APP_NOT_FOUND}`));
                return;
            }
            reject(error);
        });
        options.signal?.addEventListener('abort', () => req.destroy(new Error('stopped')));
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

async function readAll(response: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/** The provider, key and model the settings say to use. */
export function modelChoice(): { provider: string; api_key: string; model: string } {
    const config = vscode.workspace.getConfiguration('smaran');
    const provider = (config.get<string>('provider') || '').trim();
    const keys = config.get<Record<string, string>>('apiKeys') || {};
    // openRouter was the spelling in the old settings; both are accepted so
    // that an existing configuration keeps working.
    const key = provider === 'openrouter'
        ? (keys.openrouter || keys.openRouter || '')
        : (keys[provider] || '');
    return {
        provider,
        api_key: (key || '').trim(),
        model: (config.get<string>('model') || '').trim(),
    };
}

/** What the agent says it intends to do. Touches nothing. */
export async function plan(task: string, root: string): Promise<string> {
    const base = baseUrl();
    if (!base) {
        throw new Error(APP_NOT_FOUND);
    }
    const response = await request(`${base}/api/agent/plan`, {
        method: 'POST',
        body: { task, root, ...modelChoice() },
    });
    const text = await readAll(response);
    if (response.statusCode !== 200) {
        let detail = text.slice(0, 300);
        try {
            detail = JSON.parse(text).detail || detail;
        } catch { /* the body was not the error shape */ }
        throw new Error(detail);
    }
    return JSON.parse(text).plan || '';
}

/**
 * Carry out a task, handing back each step as the app reports it.
 *
 * The response is newline-delimited JSON and is read as it arrives, not at the
 * end - a run that writes four files and runs the tests should be watchable
 * while it happens, not a spinner followed by a wall of text.
 */
export async function* run(
    task: string,
    root: string,
    history: unknown[],
    signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
    const base = baseUrl();
    if (!base) {
        throw new Error(APP_NOT_FOUND);
    }
    const response = await request(`${base}/api/agent/run`, {
        method: 'POST',
        body: { task, root, history, ...modelChoice() },
        signal,
    });

    let buffer = '';
    for await (const chunk of response) {
        buffer += (chunk as Buffer).toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
            if (!line) {
                continue;
            }
            try {
                yield JSON.parse(line) as AgentEvent;
            } catch {
                // A half-written line is not an error worth showing; the rest
                // of the stream still arrives.
            }
        }
    }
}
