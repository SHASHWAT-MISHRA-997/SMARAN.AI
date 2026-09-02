/**
 * Talking to MCP servers, so the agent can use tools this extension does not
 * ship.
 *
 * The Model Context Protocol is JSON-RPC 2.0 with a fixed handshake:
 * `initialize`, then a `notifications/initialized` with no reply, and only
 * then is the server obliged to answer anything else. Getting that order
 * wrong produces a server that sits there, which is why it is spelled out.
 *
 * Two transports, because those are the two servers are published with: a
 * local process spoken to over stdin and stdout, and an HTTP endpoint. The
 * same two the desktop app speaks, deliberately - a server configured for one
 * works in the other, and the record on disk has the same shape.
 *
 * Messages over stdio are newline-delimited JSON. Servers do print to stdout
 * despite the spec, so a line that is not JSON is skipped rather than treated
 * as a protocol violation. Their stderr is kept: that is where a server says
 * "missing API key", and discarding it turns that into "the process exited".
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'SMARAN.AI Codex', version: '2.12.0' };
/** Nothing is declared until it is genuinely handled: a capability this does
 *  not implement invites requests that would never be answered. */
const CLIENT_CAPABILITIES = {};

export interface McpServerConfig {
    /** Short, and used as the tool prefix, so it wants to be a word. */
    name: string;
    /** An http(s) address, or a command line such as `npx -y @scope/server`. */
    target: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    enabled?: boolean;
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: { properties?: Record<string, { description?: string; type?: string }> };
}

export class McpError extends Error {}

interface Rpc {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { message?: string; code?: number };
}

/** One live conversation with one server. */
export class McpSession {
    readonly name: string;
    serverInfo: { name?: string; version?: string } = {};
    private capabilities: Record<string, unknown> = {};
    private nextId = 1;

    private child?: ChildProcessWithoutNullStreams;
    private stderrTail: string[] = [];
    private buffer = '';
    private waiting = new Map<number, { resolve: (v: Rpc) => void; reject: (e: Error) => void }>();

    private readonly http?: { url: string; headers: Record<string, string> };

    constructor(config: McpServerConfig) {
        this.name = config.name;
        if (/^https?:\/\//i.test(config.target)) {
            this.http = { url: config.target, headers: config.headers || {} };
        }
    }

    /* ── the process, when there is one ────────────────────────────────── */

    private start(config: McpServerConfig): void {
        const parts = splitCommand(config.target);
        if (!parts.length) throw new McpError(`${this.name}: there is no command to run.`);

        /* Most servers are published as an `npx` or `uvx` line, and on Windows
           those are .cmd shims that a bare spawn will not find. The obvious
           fix - shell: true - concatenates the arguments unquoted, so the
           first path containing a space breaks the command: spawning Node
           from "C:\Program Files" failed with 'C:\Program' is not
           recognized. Resolving the executable ourselves keeps the arguments
           as arguments. */
        const [command, ...args] = parts;
        this.child = spawn(resolveExecutable(command), args, {
            env: { ...process.env, ...(config.env || {}) },
        }) as ChildProcessWithoutNullStreams;

        this.child.on('error', (error) => {
            this.failEveryone(new McpError(`${this.name}: could not start — ${error.message}`));
        });
        this.child.on('exit', () => {
            this.failEveryone(new McpError(`${this.name}: ${this.whyItDied()}`));
        });

        this.child.stderr.on('data', (chunk: Buffer) => {
            for (const line of chunk.toString('utf8').split('\n')) {
                const text = line.trim();
                if (text) this.stderrTail.push(text);
            }
            // The tail, not the whole run.
            this.stderrTail = this.stderrTail.slice(-40);
        });

        this.child.stdout.on('data', (chunk: Buffer) => {
            this.buffer += chunk.toString('utf8');
            let newline = this.buffer.indexOf('\n');
            while (newline >= 0) {
                const line = this.buffer.slice(0, newline).trim();
                this.buffer = this.buffer.slice(newline + 1);
                newline = this.buffer.indexOf('\n');
                if (!line) continue;
                let message: Rpc;
                try {
                    message = JSON.parse(line);
                } catch {
                    continue; // A server printing to stdout, not a protocol error.
                }
                if (typeof message.id === 'number') {
                    this.waiting.get(message.id)?.resolve(message);
                    this.waiting.delete(message.id);
                }
            }
        });
    }

    private whyItDied(): string {
        const tail = this.stderrTail.slice(-4).join(' / ');
        const code = this.child?.exitCode;
        return tail
            ? `the server exited (code ${code}): ${tail.slice(0, 300)}`
            : `the server exited (code ${code}) without saying why`;
    }

    private failEveryone(error: Error): void {
        for (const pending of this.waiting.values()) pending.reject(error);
        this.waiting.clear();
    }

    /* ── requests ──────────────────────────────────────────────────────── */

    private async request(method: string, params?: unknown, timeoutMs = 60000): Promise<unknown> {
        const id = this.nextId++;
        const payload: Rpc = { jsonrpc: '2.0', id, method, params: params ?? {} };
        const reply = this.http
            ? await this.postHttp(payload, timeoutMs)
            : await this.writeLine(payload, timeoutMs);
        if (reply.error) {
            throw new McpError(`${this.name}: ${reply.error.message || 'the server refused'}`);
        }
        return reply.result;
    }

    private async notify(method: string): Promise<void> {
        const payload: Rpc = { jsonrpc: '2.0', method, params: {} };
        if (this.http) {
            await this.postHttp(payload, 15000).catch(() => undefined);
            return;
        }
        this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
    }

    private writeLine(payload: Rpc, timeoutMs: number): Promise<Rpc> {
        return new Promise((resolve, reject) => {
            if (!this.child || this.child.exitCode !== null) {
                reject(new McpError(`${this.name}: not running.`));
                return;
            }
            const timer = setTimeout(() => {
                this.waiting.delete(payload.id as number);
                reject(new McpError(`${this.name}: no reply within ${Math.round(timeoutMs / 1000)} seconds.`));
            }, timeoutMs);

            this.waiting.set(payload.id as number, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            this.child.stdin.write(`${JSON.stringify(payload)}\n`);
        });
    }

    private postHttp(payload: Rpc, timeoutMs: number): Promise<Rpc> {
        return new Promise((resolve, reject) => {
            const target = new URL(this.http!.url);
            const body = JSON.stringify(payload);
            const transport = target.protocol === 'https:' ? https : http;
            const request = transport.request(
                target,
                {
                    method: 'POST',
                    timeout: timeoutMs,
                    headers: {
                        'Content-Type': 'application/json',
                        // Streamable HTTP servers answer either shape; saying
                        // both is what the spec asks a client to send.
                        Accept: 'application/json, text/event-stream',
                        'Content-Length': Buffer.byteLength(body),
                        ...this.http!.headers,
                    },
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on('data', (c) => chunks.push(c as Buffer));
                    response.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8').trim();
                        if (!text) { resolve({ jsonrpc: '2.0' }); return; }
                        // An SSE reply is one or more `data:` lines; the last
                        // JSON one is the answer.
                        const line = text.startsWith('event:') || text.startsWith('data:')
                            ? text.split('\n').filter((l) => l.startsWith('data:')).pop()?.slice(5).trim() || ''
                            : text;
                        try {
                            resolve(JSON.parse(line));
                        } catch {
                            reject(new McpError(`${this.name}: reply was not JSON — ${text.slice(0, 200)}`));
                        }
                    });
                },
            );
            request.on('timeout', () => request.destroy(new McpError(`${this.name}: no reply in time.`)));
            request.on('error', reject);
            request.write(body);
            request.end();
        });
    }

    /* ── the handshake and what it unlocks ─────────────────────────────── */

    async open(config: McpServerConfig): Promise<void> {
        if (!this.http) this.start(config);

        const result = (await this.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: CLIENT_CAPABILITIES,
            clientInfo: CLIENT_INFO,
        })) as { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> } | undefined;

        this.serverInfo = result?.serverInfo || {};
        this.capabilities = result?.capabilities || {};

        // Nothing else is owed until this is sent.
        await this.notify('notifications/initialized');
    }

    async listTools(): Promise<McpTool[]> {
        // Asking for a capability the server did not advertise is a request it
        // may reject; absence is an empty list, not a failure.
        if (!('tools' in this.capabilities)) return [];
        const result = (await this.request('tools/list')) as { tools?: McpTool[] } | undefined;
        return result?.tools || [];
    }

    async call(tool: string, args: Record<string, unknown>): Promise<string> {
        const result = (await this.request('tools/call', { name: tool, arguments: args })) as {
            content?: { type?: string; text?: string }[];
            isError?: boolean;
        } | undefined;

        const text = (result?.content || [])
            .map((part) => (part.type === 'text' ? part.text || '' : `[${part.type || 'content'}]`))
            .join('\n')
            .trim();

        if (result?.isError) {
            return `${tool} reported a failure: ${text || 'no detail given'}`;
        }
        // A tool that returns nothing has still run; saying so beats a blank.
        return text || `${tool} ran and returned nothing.`;
    }

    close(): void {
        this.failEveryone(new McpError(`${this.name}: closed.`));
        try { this.child?.kill(); } catch { /* already gone */ }
        this.child = undefined;
    }
}

/**
 * Find what a bare command name actually refers to.
 *
 * On Windows `npx` is `npx.cmd`, and spawn without a shell does not apply
 * PATHEXT - so the command every MCP server documents does not run. This is
 * the same lookup a shell does, done here so the arguments never have to pass
 * through one.
 */
export function resolveExecutable(command: string): string {
    if (command.includes('/') || command.includes(String.fromCharCode(92))) return command;
    if (process.platform !== 'win32') return command;

    const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        for (const extension of ['', ...extensions]) {
            const candidate = path.join(dir, command + extension);
            try {
                if (fs.statSync(candidate).isFile()) return candidate;
            } catch { /* not there */ }
        }
    }
    return command;
}

/**
 * Split a command line the way a shell would, minus the parts a config file
 * has no business using. Quotes are honoured because paths have spaces.
 */
export function splitCommand(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (const ch of line.trim()) {
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (current) { out.push(current); current = ''; }
        } else {
            current += ch;
        }
    }
    if (current) out.push(current);
    return out;
}

/**
 * A tool name the model can actually emit.
 *
 * Prefixed with the server it came from, because two servers may both offer
 * `search` and the agent has to be able to say which one it means. Kept to
 * the characters the tag parser accepts.
 */
export const qualify = (server: string, tool: string): string =>
    `mcp_${server.replace(/[^A-Za-z0-9_]/g, '_')}_${tool.replace(/[^A-Za-z0-9_]/g, '_')}`;
