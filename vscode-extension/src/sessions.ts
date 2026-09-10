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
    revision?: number;
    projectId?: string;
    deleted?: boolean;
}

export interface SyncConfig {
    backendUrl?: string;
    token?: string;
    projectId?: string;
}

export type SyncState = 'idle' | 'syncing' | 'connected' | 'offline' | 'conflict';

const KEY = 'smaran.sessions';
const MAX_SESSIONS = 60;

export class SessionStore {
    private readonly revisions = new Map<string, number>();
    private syncState: SyncState = 'idle';

    constructor(private readonly memento: vscode.Memento) {}

    getSyncState(): SyncState {
        return this.syncState;
    }

    all(): Session[] {
        return (this.memento.get<Session[]>(KEY) || [])
            .filter((s) => !s.deleted)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    get(id: string): Session | undefined {
        return (this.memento.get<Session[]>(KEY) || []).find((s) => s.id === id && !s.deleted);
    }

    create(title: string, projectId?: string): Session {
        const session: Session = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim().slice(0, 80) || 'Untitled',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            entries: [],
            history: [],
            revision: 0,
            projectId: projectId || 'default',
        };
        void this.save(session);
        return session;
    }

    async save(session: Session, config?: SyncConfig): Promise<void> {
        session.updatedAt = Date.now();
        const allStored = (this.memento.get<Session[]>(KEY) || []).filter((s) => s.id !== session.id);
        // Oldest first out of the door. Unbounded growth in a Memento is a
        // slow leak nobody would ever notice until the panel got slow.
        const kept = [session, ...allStored]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_SESSIONS);
        await this.memento.update(KEY, kept);

        if (config?.backendUrl) {
            void this.pushToBackend(session, config);
        }
    }

    async remove(id: string, config?: SyncConfig): Promise<void> {
        const allStored = this.memento.get<Session[]>(KEY) || [];
        const existing = allStored.find((s) => s.id === id);
        await this.memento.update(KEY, allStored.filter((s) => s.id !== id));

        if (existing && config?.backendUrl) {
            existing.deleted = true;
            void this.pushToBackend(existing, config);
        }
    }

    async clear(config?: SyncConfig): Promise<void> {
        const allStored = this.memento.get<Session[]>(KEY) || [];
        await this.memento.update(KEY, []);
        if (config?.backendUrl) {
            for (const s of allStored) {
                s.deleted = true;
                void this.pushToBackend(s, config);
            }
        }
    }

    /**
     * Pull remote coding tasks from the SMARAN backend and merge them with local tasks.
     * Note: Ordinary Chat and Speak history is strictly excluded on the backend (/api/code/tasks).
     */
    async pullFromBackend(config: SyncConfig): Promise<boolean> {
        const backendUrl = config.backendUrl || 'http://127.0.0.1:3003';
        this.syncState = 'syncing';
        try {
            const url = new URL('/api/code/tasks', backendUrl);
            if (config.projectId) {
                url.searchParams.set('project_id', config.projectId);
            }
            const headers: Record<string, string> = { 'Accept': 'application/json' };
            if (config.token) {
                headers['Authorization'] = `Bearer ${config.token}`;
            }

            const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(4000) });
            if (!res.ok) {
                this.syncState = 'offline';
                return false;
            }

            const remoteTasks: Array<{
                id: string;
                project_id?: string;
                title: string;
                revision: number;
                entries?: Entry[];
                history?: { role: 'user' | 'assistant'; content: string }[];
                deleted?: boolean;
                created_at?: string;
                updated_at?: string;
            }> = await res.json();

            if (!Array.isArray(remoteTasks)) {
                this.syncState = 'connected';
                return false;
            }

            const allStored = this.memento.get<Session[]>(KEY) || [];
            const localMap = new Map<string, Session>(allStored.map((s) => [s.id, s]));
            let changed = false;

            for (const rTask of remoteTasks) {
                const local = localMap.get(rTask.id);
                const localRev = this.revisions.get(rTask.id) || local?.revision || 0;

                if (rTask.deleted) {
                    if (local && !local.deleted) {
                        local.deleted = true;
                        changed = true;
                    }
                    continue;
                }

                if (!local || rTask.revision > localRev) {
                    const merged: Session = {
                        id: rTask.id,
                        title: rTask.title || 'Untitled Coding Task',
                        createdAt: rTask.created_at ? new Date(rTask.created_at).getTime() : (local?.createdAt || Date.now()),
                        updatedAt: rTask.updated_at ? new Date(rTask.updated_at).getTime() : Date.now(),
                        entries: Array.isArray(rTask.entries) ? rTask.entries : [],
                        history: Array.isArray(rTask.history) ? rTask.history : [],
                        revision: rTask.revision,
                        projectId: rTask.project_id || config.projectId,
                    };
                    localMap.set(rTask.id, merged);
                    this.revisions.set(rTask.id, rTask.revision);
                    changed = true;
                }
            }

            if (changed) {
                const sorted = Array.from(localMap.values())
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .slice(0, MAX_SESSIONS);
                await this.memento.update(KEY, sorted);
            }
            this.syncState = 'connected';
            return true;
        } catch {
            this.syncState = 'offline';
            return false;
        }
    }

    /**
     * Push a task update to the backend with optimistic locking revision checking.
     */
    async pushToBackend(session: Session, config: SyncConfig): Promise<boolean> {
        const backendUrl = config.backendUrl || 'http://127.0.0.1:3003';
        try {
            const currentRev = this.revisions.get(session.id) || session.revision || 0;
            const url = new URL(`/api/code/tasks/${encodeURIComponent(session.id)}`, backendUrl);
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
            if (config.token) {
                headers['Authorization'] = `Bearer ${config.token}`;
            }

            const payload = {
                expected_revision: currentRev,
                project_id: config.projectId || session.projectId || 'default',
                title: session.title,
                entries: session.entries || [],
                history: session.history || [],
                archived: false,
                deleted: Boolean(session.deleted),
            };

            const res = await fetch(url.toString(), {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            });

            if (res.ok) {
                const data = await res.json();
                if (data?.revision) {
                    this.revisions.set(session.id, data.revision);
                    session.revision = data.revision;
                }
                this.syncState = 'connected';
                return true;
            } else if (res.status === 409) {
                this.syncState = 'conflict';
                await this.pullFromBackend(config);
                return false;
            }
            return false;
        } catch {
            this.syncState = 'offline';
            return false;
        }
    }
}
