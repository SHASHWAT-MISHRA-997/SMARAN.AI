/**
 * The MCP servers this window has open, and the tools they add.
 *
 * One registry for the whole extension: servers are processes, and starting a
 * fresh copy per conversation would leave a pile of them running. Connections
 * are made when first needed and kept until the window closes or the
 * configuration changes.
 *
 * A server that will not start is not an error that stops anything. Its tools
 * are simply absent, and the reason is kept so the panel can say what happened
 * rather than showing an empty list.
 */

import { McpError, McpServerConfig, McpSession, McpTool, qualify } from './mcp';

export interface ServerState {
    config: McpServerConfig;
    session?: McpSession;
    tools: McpTool[];
    /** Why it is not connected, in the words it failed in. */
    problem?: string;
}

export class McpRegistry {
    private states = new Map<string, ServerState>();
    private connecting?: Promise<void>;
    private signature = '';

    /**
     * Point the registry at a configuration.
     *
     * Called on every run, so it has to be cheap when nothing changed: the
     * configuration is compared as a whole and connections are left alone
     * unless it actually differs.
     */
    async use(configs: McpServerConfig[]): Promise<void> {
        const wanted = configs.filter((c) => c.enabled !== false && c.name && c.target);
        const signature = JSON.stringify(wanted);
        if (signature === this.signature && !this.connecting) return;

        if (signature !== this.signature) {
            this.closeAll();
            this.signature = signature;
            this.states = new Map(wanted.map((config) => [config.name, { config, tools: [] }]));
        }

        // One connect pass at a time, shared by every caller that arrives
        // while it is running.
        this.connecting = this.connecting || this.connectAll();
        try {
            await this.connecting;
        } finally {
            this.connecting = undefined;
        }
    }

    private async connectAll(): Promise<void> {
        await Promise.all([...this.states.values()].map(async (state) => {
            if (state.session) return;
            const session = new McpSession(state.config);
            try {
                await session.open(state.config);
                state.tools = await session.listTools();
                state.session = session;
                state.problem = undefined;
            } catch (error) {
                session.close();
                state.problem = error instanceof McpError
                    ? error.message
                    : `${state.config.name}: ${(error as Error).message}`;
                state.tools = [];
            }
        }));
    }

    /** What the panel shows: every configured server and how it went. */
    report(): { name: string; target: string; connected: boolean; tools: string[]; problem?: string }[] {
        return [...this.states.values()].map((state) => ({
            name: state.config.name,
            target: state.config.target,
            connected: Boolean(state.session),
            tools: state.tools.map((t) => t.name),
            problem: state.problem,
        }));
    }

    /** Every tool, under the name the model will use for it. */
    tools(): { name: string; server: string; tool: McpTool }[] {
        const out: { name: string; server: string; tool: McpTool }[] = [];
        for (const state of this.states.values()) {
            if (!state.session) continue;
            for (const tool of state.tools) {
                out.push({ name: qualify(state.config.name, tool.name), server: state.config.name, tool });
            }
        }
        return out;
    }

    /** The lines that go into the prompt, so the model knows these exist. */
    describe(): string {
        return this.tools()
            .map(({ name, tool }) => {
                const args = Object.keys(tool.inputSchema?.properties || {});
                const what = (tool.description || 'A tool from an MCP server.')
                    .replace(/\s+/g, ' ')
                    .slice(0, 160);
                return `- ${name}(${args.join(', ')}): ${what}`;
            })
            .join('\n');
    }

    has(name: string): boolean {
        return this.tools().some((t) => t.name === name);
    }

    async call(name: string, args: Record<string, string>): Promise<string> {
        const found = this.tools().find((t) => t.name === name);
        if (!found) return `There is no MCP tool called ${JSON.stringify(name)}.`;
        const state = this.states.get(found.server);
        if (!state?.session) return `${found.server} is not connected.`;
        try {
            return await state.session.call(found.tool.name, coerce(found.tool, args));
        } catch (error) {
            // A failure goes back to the model as a result. Being told what
            // went wrong is how it corrects itself.
            return `${name} failed: ${(error as Error).message.slice(0, 300)}`;
        }
    }

    closeAll(): void {
        for (const state of this.states.values()) state.session?.close();
        this.states.clear();
        this.signature = '';
    }
}

/**
 * Tool calls arrive as strings, because the tags they come in are text.
 *
 * A schema that asks for a number or a boolean gets one; anything else is
 * passed through untouched. Sending "true" where a server wants true is the
 * kind of mismatch that produces a validation error nobody can act on.
 */
function coerce(tool: McpTool, args: Record<string, string>): Record<string, unknown> {
    const properties = tool.inputSchema?.properties || {};
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(args)) {
        const type = properties[key]?.type;
        if (type === 'number' || type === 'integer') {
            const value = Number(raw);
            out[key] = Number.isFinite(value) ? value : raw;
        } else if (type === 'boolean') {
            out[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
        } else if (type === 'array' || type === 'object') {
            try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
        } else {
            out[key] = raw;
        }
    }
    return out;
}
