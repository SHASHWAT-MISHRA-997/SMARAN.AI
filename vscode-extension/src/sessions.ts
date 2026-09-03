/**
 * Past conversations, kept per project.
 *
 * A run that changed six files is a record of what happened to your code, and
 * losing it when the panel reloads is worse than a nuisance - it is the only
 * account of what was done and why. So the transcript is written down, not
 * held in memory.
 *
 * Per project rather than globally: the history that matters when you open a
 * repository is that repository's, not yesterday's work on something else.
 */

import * as vscode from 'vscode';

/** One thing that appeared in the panel, stored exactly as it was shown. */
export interface Entry {
    /** 'skip' is thrown away rather than shown or stored. */
    /* 'thinking' is transient - shown while a request is in flight and
       replaced by whatever the model actually said. It is not written to
       a saved transcript. */
    kind: 'you' | 'says' | 'tool' | 'result' | 'done' | 'error' | 'note' | 'plan' | 'skip' | 'thinking' | 'steps';
    title?: string;
    body?: string;
    /**
     * What was attached to the message, kept with the message.
     *
     * A pasted screenshot showed as a chip above the composer, and the
     * composer clears when the run starts - so the picture disappeared the
     * moment it was sent, and the transcript showed a question about an image
     * with no image anywhere near it. It was sent; it just could not be seen.
     * Images carry their data so they still draw when a session is reopened.
     */
    files?: { name: string; image?: string; mime?: string }[];
    /** A published step list, drawn as a checklist and replaced in place. */
    steps?: { state: 'todo' | 'doing' | 'done'; text: string }[];
}

export interface Session {
    id: string;
    /** The first task, which is what a person recognises it by. */
    title: string;
    createdAt: number;
    updatedAt: number;
    entries: Entry[];
    /** The model turns, so a reopened session can be carried on. */
    history: { role: 'user' | 'assistant'; content: string }[];
}

const KEY = 'smaran.sessions';
const MAX_SESSIONS = 60;

export class SessionStore {
    constructor(private readonly memento: vscode.Memento) {}

    all(): Session[] {
        return (this.memento.get<Session[]>(KEY) || []).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    get(id: string): Session | undefined {
        return this.all().find((s) => s.id === id);
    }

    create(title: string): Session {
        const session: Session = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim().slice(0, 80) || 'Untitled',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            entries: [],
            history: [],
        };
        void this.save(session);
        return session;
    }

    async save(session: Session): Promise<void> {
        session.updatedAt = Date.now();
        const rest = this.all().filter((s) => s.id !== session.id);
        // Oldest first out of the door. Unbounded growth in a Memento is a
        // slow leak nobody would ever notice until the panel got slow.
        const kept = [session, ...rest]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_SESSIONS);
        await this.memento.update(KEY, kept);
    }

    async remove(id: string): Promise<void> {
        await this.memento.update(KEY, this.all().filter((s) => s.id !== id));
    }

    async clear(): Promise<void> {
        await this.memento.update(KEY, []);
    }
}
