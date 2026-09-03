/**
 * Two dials: what the agent may touch, and when it has to ask.
 *
 * There used to be one. Four modes ran from "changes nothing" to "works on its
 * own", and each of them silently decided both questions at once - so there
 * was no way to say "you may edit anything in this project, but ask me every
 * single time", and no way to say "never interrupt me, but you cannot leave
 * this folder". Those are different questions and they were answered together.
 *
 * Codex separates them, and the reason is worth repeating: a loose approval
 * policy inside a tight reach is still safe, while a strict approval policy
 * with full reach is only as safe as the attention of whoever is clicking.
 * One of those is a property of the system; the other is a property of a tired
 * person at midnight.
 *
 * WHAT THIS IS NOT
 *
 * Codex's reach is enforced by the operating system - Seatbelt, Landlock,
 * restricted tokens. This one is not, and saying otherwise would be the kind
 * of claim that only fails on the day it matters.
 *
 * What is genuinely enforced here:
 *
 *   - Reading and writing files. Every path goes through a check that resolves
 *     symlinks and refuses anything outside the folder. That is real.
 *   - Whether a changing tool runs at all. Read-only means the write and
 *     command tools refuse, in this process, before anything happens.
 *
 * What is not:
 *
 *   - Where a shell command goes. It starts in the project folder and can walk
 *     straight out of it. Nothing here can stop that, and a list of patterns
 *     pretending to would be worse than useless because it would be believed.
 *     This is said in the interface, not hidden in a comment.
 */

/** What the agent may touch. */
export type ReachId = 'read' | 'workspace' | 'full';

/** When it must stop and ask. */
export type ApprovalId = 'always' | 'commands' | 'risky' | 'never';

export interface Policy {
    reach: ReachId;
    approval: ApprovalId;
}

export interface Choice1<T> {
    id: T;
    label: string;
    description: string;
}

export const REACHES: Choice1<ReachId>[] = [
    {
        id: 'read',
        label: 'Read only',
        description: 'Looks at the code and changes nothing. No files written, no commands run.',
    },
    {
        id: 'workspace',
        label: 'This project',
        description: 'Writes only inside the open folder. Commands start here, but a command can go anywhere.',
    },
    {
        id: 'full',
        label: 'Anywhere',
        description: 'May read and write outside the open folder too.',
    },
];

export const APPROVALS: Choice1<ApprovalId>[] = [
    { id: 'always', label: 'Every time', description: 'Asks before every change and every command.' },
    { id: 'commands', label: 'Before commands', description: 'Edits files on its own. Asks before running anything.' },
    { id: 'risky', label: 'When it looks risky', description: 'Works on its own and stops at what is hard to undo.' },
    { id: 'never', label: 'Never', description: 'Never asks. Whatever it may touch, it touches.' },
];

/**
 * The old single mode, as the pair it always secretly was.
 *
 * Anyone who set a mode meant something by it, and that meaning is kept rather
 * than reset to a default on upgrade.
 */
export type ModeId = 'plan' | 'manual' | 'autoEdit' | 'auto';

export const FROM_MODE: Record<ModeId, Policy> = {
    plan: { reach: 'read', approval: 'never' },
    manual: { reach: 'workspace', approval: 'always' },
    autoEdit: { reach: 'workspace', approval: 'commands' },
    auto: { reach: 'workspace', approval: 'risky' },
};

/** Tools that change something. Everything else runs unasked, always. */
export const MUTATING = new Set(['write_file', 'edit_file', 'run_command', 'git']);

/** Tools that run a shell. These are the ones reach cannot actually contain. */
export const SHELL = new Set(['run_command', 'git']);

/**
 * A tool from an MCP server, by the name the model calls it.
 *
 * These are treated as changing something whatever they are called. The
 * server is somebody else's program: this extension cannot read its code and
 * has no way to know whether `search_issues` reads or writes. Assuming the
 * safe answer for a tool that turns out to write is the failure that cannot
 * be undone, so the assumption goes the other way.
 */
export const isMcpTool = (name: string): boolean => name.startsWith('mcp_');

/**
 * Commands worth stopping on even when you asked not to be stopped.
 *
 * This is a short list of things that are hard to undo, not an attempt at a
 * sandbox - a shell is a shell, and anything claiming to make one safe by
 * pattern matching would be lying. It catches the well-known ways to lose work
 * by accident: deleting recursively, force-pushing over somebody's history,
 * piping a download straight into a shell, overwriting a disk.
 */
const RISKY: { pattern: RegExp; why: string }[] = [
    { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, why: 'deletes files recursively' },
    { pattern: /\b(rmdir\s+\/s|del\s+\/[qsf])/i, why: 'deletes files without asking' },
    { pattern: /\bRemove-Item\b[^|]*-Recurse/i, why: 'deletes a folder tree' },
    { pattern: /\bgit\s+push\b[^|]*(--force|-f)\b/i, why: 'force-pushes over history that is already published' },
    { pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i, why: 'throws away uncommitted work' },
    { pattern: /\bgit\s+push\b/i, why: 'publishes commits to a remote' },
    { pattern: /\b(curl|wget|iwr|Invoke-WebRequest)\b[\s\S]*\|\s*(ba)?sh\b/i, why: 'runs a downloaded script' },
    { pattern: /\bdd\s+.*of=\/dev\//i, why: 'writes directly to a device' },
    { pattern: /\b(mkfs|format\s+[a-z]:)/i, why: 'formats a disk' },
    { pattern: /\b(shutdown|reboot)\b/i, why: 'shuts the machine down' },
    { pattern: /\bchmod\s+(-R\s+)?777\b/i, why: 'makes files writable by everyone' },
    { pattern: /\b(npm|yarn|pnpm)\s+publish\b/i, why: 'publishes a package' },
    { pattern: /\bdocker\s+system\s+prune\b/i, why: 'deletes unused Docker data' },
    { pattern: />\s*\/dev\/sd[a-z]/i, why: 'writes over a disk' },
];

/** Why this command is worth a look, or nothing if it is ordinary. */
export function riskOf(command: string): string | undefined {
    for (const { pattern, why } of RISKY) {
        if (pattern.test(command || '')) {
            return why;
        }
    }
    return undefined;
}

export type Decision =
    | { act: 'run' }
    | { act: 'ask'; because?: string }
    | { act: 'refuse'; because: string };

/**
 * What should happen when this tool is about to run.
 *
 * Reach is asked first and can only refuse. Approval is asked second and can
 * only slow things down. Neither can loosen the other, which is the whole
 * point of there being two: no setting of approval can grant reach that was
 * not given, and no reach makes an approval prompt go away.
 */
export function decide(policy: Policy, name: string, args: Record<string, string>): Decision {
    const changes = isMcpTool(name) || MUTATING.has(name);

    if (!changes) {
        return { act: 'run' };
    }

    // ── first dial ────────────────────────────────────────────────────────
    if (policy.reach === 'read') {
        return {
            act: 'refuse',
            because: isMcpTool(name)
                ? 'The agent is set to read only, so no tool that could change something may '
                  + 'run - including tools from MCP servers. Say what you would do instead.'
                : 'The agent is set to read only, so nothing can be changed. Do not try '
                  + 'again - finish looking at the code and describe what you would change '
                  + 'and why.',
        };
    }

    // ── second dial ───────────────────────────────────────────────────────
    /* An MCP tool is always shown and waited on, at every approval setting
       short of never. "Never ask" is a decision about this agent's own tools,
       whose behaviour is known; a server's tools are somebody else's program.
       So it is honoured, and not quietly overridden - but it is the only
       setting that runs one unasked. */
    if (isMcpTool(name)) {
        return policy.approval === 'never'
            ? { act: 'run' }
            : { act: 'ask', because: 'a tool from an MCP server' };
    }

    const command = name === 'git' ? `git ${args.subcommand ?? ''}` : (args.command ?? '');
    const shell = SHELL.has(name);
    const risk = shell ? riskOf(command) : undefined;

    switch (policy.approval) {
        case 'always':
            return { act: 'ask', because: risk };

        case 'commands':
            // Writing a file is visible, reviewable and inside the project.
            // Running a command is neither bounded nor undoable, which is the
            // line this setting draws.
            return shell ? { act: 'ask', because: risk } : { act: 'run' };

        case 'risky':
            return risk ? { act: 'ask', because: risk } : { act: 'run' };

        case 'never':
            return { act: 'run' };
    }
}

/** The pair in the words the panel puts on its chip. */
export function describePolicy(policy: Policy): string {
    const reach = REACHES.find((r) => r.id === policy.reach);
    const approval = APPROVALS.find((a) => a.id === policy.approval);
    return `${reach ? reach.label : policy.reach} · asks ${
        approval ? approval.label.toLowerCase() : policy.approval}`;
}
