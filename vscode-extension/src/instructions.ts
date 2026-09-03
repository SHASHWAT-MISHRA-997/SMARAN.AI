/**
 * The project's own standing instructions.
 *
 * Every serious coding agent reads a file like this before it does anything -
 * Codex reads AGENTS.md, Claude Code reads CLAUDE.md - and this one read
 * nothing. So the same correction had to be typed again every session: which
 * package manager, which test command, that this repository writes comments a
 * certain way, that a folder is generated and must not be edited by hand. The
 * model got none of it and could not have known any of it.
 *
 * Both names are read, because a project that has one of them should not have
 * to keep a second copy for this. `.smaran/instructions.md` is here for a
 * project that wants to say something to this agent and nothing else.
 *
 * Two limits, both deliberate:
 *
 * It is capped. A file of any size would push the actual task out of the
 * context window on a small model, and the failure would look like the model
 * being stupid rather than the prompt being full. When it is cut, it says so
 * in the text the model sees, so the model knows it is reading part of a
 * document rather than all of one.
 *
 * It is read fresh for every run, not cached at startup. Somebody who edits
 * these instructions because the agent got something wrong expects the next
 * run to know - not the next window.
 */

import * as fs from 'fs';
import * as path from 'path';

/** In the order they are read. Every one that exists is included. */
const NAMES = ['AGENTS.md', 'CLAUDE.md', path.join('.smaran', 'instructions.md')];

/** Codex caps its project doc at 32 KiB. The same number, for the same reason. */
export const MAX_BYTES = 32 * 1024;

export interface ProjectInstructions {
    /** The text to put in the prompt, empty when there is nothing to say. */
    text: string;
    /** Which files it came from, for the panel to name. */
    from: string[];
}

export function readInstructions(root: string): ProjectInstructions {
    const parts: string[] = [];
    const from: string[] = [];

    for (const name of NAMES) {
        const file = path.join(root, name);
        let raw: string;
        try {
            if (!fs.statSync(file).isFile()) continue;
            raw = fs.readFileSync(file, 'utf8');
        } catch {
            // Missing is the normal case, not an error worth reporting.
            continue;
        }
        if (!raw.trim()) continue;

        let body = raw;
        if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
            body = Buffer.from(body, 'utf8').subarray(0, MAX_BYTES).toString('utf8')
                + `\n\n[cut here - ${name} is longer than ${MAX_BYTES / 1024} KB and the rest `
                + 'was not included]';
        }
        parts.push(`--- ${name} ---\n${body.trim()}`);
        from.push(name);
    }

    if (!parts.length) {
        return { text: '', from: [] };
    }

    return {
        /* Named as the project's instructions and placed above the task, so a
           model that has to choose between the two knows which one is the
           standing rule and which one is today's request. */
        text: 'This project has its own instructions. Follow them - they '
            + 'outrank your general habits, and where they conflict with what '
            + 'you would normally do, they win.\n\n'
            + parts.join('\n\n'),
        from,
    };
}
