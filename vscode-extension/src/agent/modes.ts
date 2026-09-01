/**
 * How much the agent may do without asking you.
 *
 * The mode is enforced here, at the point a tool is about to run, and not
 * anywhere the model can see. A mode that lived in the prompt would be a
 * request; asking a model not to write files is not the same as it being
 * unable to, and the difference only shows up on the day it matters.
 *
 * Reading is never gated. list_files, read_file and search change nothing, and
 * a confirmation for each one trains people to click through confirmations.
 */

export type ModeId = 'plan' | 'manual' | 'autoEdit' | 'auto';

export interface Mode {
    id: ModeId;
    label: string;
    /** What it does, in the terms the panel shows. */
    description: string;
}

export const MODES: Mode[] = [
    {
        id: 'plan',
        label: 'Plan',
        description: 'Explores the code and tells you what it would do. Changes nothing at all.',
    },
    {
        id: 'manual',
        label: 'Manual',
        description: 'Asks before every change and every command.',
    },
    {
        id: 'autoEdit',
        label: 'Edit automatically',
        description: 'Changes files on its own. Still asks before running a command.',
    },
    {
        id: 'auto',
        label: 'Auto',
        description: 'Works on its own, and pauses for anything that looks risky.',
    },
];

/** Tools that change something. Everything else runs unasked in every mode. */
export const MUTATING = new Set(['write_file', 'edit_file', 'run_command', 'git']);

/**
 * Commands worth stopping on even when you asked not to be stopped.
 *
 * This is a short list of things that are hard to undo, not an attempt at a
 * sandbox - a shell is a shell, and anything claiming to make one safe by
 * pattern matching would be lying. It catches the well-known ways to lose work
 * by accident: deleting recursively, force-pushing over somebody's history,
 * piping a download straight into a shell, overwriting a disk.
 *
 * Auto mode pauses on these. Nothing else about them is special.
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

/** What should happen when this tool is about to run, in this mode. */
export function decide(mode: ModeId, name: string, args: Record<string, string>): Decision {
    if (!MUTATING.has(name)) {
        return { act: 'run' };
    }

    const command = name === 'git' ? `git ${args.subcommand ?? ''}` : (args.command ?? '');

    switch (mode) {
        case 'plan':
            return {
                act: 'refuse',
                because:
                    'You are in Plan mode, so nothing can be changed. Do not try again - '
                    + 'finish looking at the code and describe what you would change and why.',
            };

        case 'manual':
            return { act: 'ask' };

        case 'autoEdit':
            // Writing a file is visible, reviewable and inside the project.
            // Running a command is neither bounded nor undoable, which is the
            // line this mode draws.
            return name === 'run_command' || name === 'git'
                ? { act: 'ask', because: riskOf(command) }
                : { act: 'run' };

        case 'auto': {
            const risk = name === 'run_command' || name === 'git' ? riskOf(command) : undefined;
            return risk ? { act: 'ask', because: risk } : { act: 'run' };
        }
    }
}
