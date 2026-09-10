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
    dirty?: boolean;
}

export interface SyncConfig {
    backendUrl?: string;
    token?: string;
    projectId?: string;
}

export type SyncState = 'idle' | 'syncing' | 'connected' | 'offline' | 'conflict';

const KEY = 'smaran.sessions';

export class SessionStore {
    private readonly revisions = new Map<string, number>();
    private readonly pushes = new Map<string, Promise<boolean>>();
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
        session.dirty = true;
        const allStored = (this.memento.get<Session[]>(KEY) || []).filter((s) => s.id !== session.id);
        // Never silently discard old conversations or pending tombstones.
        const kept = [session, ...allStored]
            .sort((a, b) => b.updatedAt - a.updatedAt);
        await this.memento.update(KEY, kept);

        if (config?.backendUrl) {
            void this.pushToBackend(session, config);
        }
    }

    async remove(id: string, config?: SyncConfig): Promise<void> {
        const allStored = this.memento.get<Session[]>(KEY) || [];
        const existing = allStored.find((s) => s.id === id);
        if (existing) {
            existing.deleted = true;
            existing.entries = [];
            existing.history = [];
            await this.save(existing, config);
        }
    }

    async clear(config?: SyncConfig): Promise<void> {
        const allStored = this.memento.get<Session[]>(KEY) || [];
        for (const s of allStored) {
            await this.remove(s.id, config);
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
            // Resume failed/offline writes before reconciling remote state.
            // A conflict remains dirty and is never replaced by the pull.
            for (const pending of this.memento.get<Session[]>(KEY) || []) {
                if (pending.dirty) { await this.pushToBackend(pending, config); }
            }
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

            type RemoteTask = {
                id: string;
                project_id?: string;
                title: string;
                revision: number;
                entries?: Entry[];
                history?: { role: 'user' | 'assistant'; content: string }[];
                deleted?: boolean;
                created_at?: string;
                updated_at?: string;
            };
            const remoteTasks: RemoteTask[] = [];
            let page = await res.json();
            const seenOffsets = new Set<number>();
            for (;;) {
                if (!Array.isArray(page.tasks)) { throw new Error('Invalid coding task response'); }
                remoteTasks.push(...page.tasks);
                if (page.next_offset == null) { break; }
                if (!Number.isInteger(page.next_offset) || page.next_offset < 0 || seenOffsets.has(page.next_offset)) {
                    throw new Error('Invalid coding task pagination');
                }
                seenOffsets.add(page.next_offset);
                url.searchParams.set('offset', String(page.next_offset));
                const next = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(4000) });
                if (!next.ok) { throw new Error('Task page unavailable'); }
                page = await next.json();
            }

            const allStored = this.memento.get<Session[]>(KEY) || [];
            const localMap = new Map<string, Session>(allStored.map((s) => [s.id, s]));
            let changed = false;
            let conflicted = false;

            for (const rTask of remoteTasks) {
                const local = localMap.get(rTask.id);
                const localRev = this.revisions.get(rTask.id) || local?.revision || 0;
                if (local?.dirty) {
                    conflicted ||= rTask.revision > localRev;
                    continue;
                }

                if (rTask.deleted) {
                    if (local && !local.deleted) {
                        local.deleted = true;
                        changed = true;
                    }
                    continue;
                }

                if (!local || rTask.revision > localRev) {
                    const detailUrl = new URL(`/api/code/tasks/${encodeURIComponent(rTask.id)}`, backendUrl);
                    const detail = await fetch(detailUrl.toString(), { headers, signal: AbortSignal.timeout(4000) });
                    if (!detail.ok) { throw new Error('Task transcript unavailable'); }
                    const full = await detail.json();
                    if (full.id !== rTask.id || !Array.isArray(full.entries) || !Array.isArray(full.history)) {
                        throw new Error('Invalid task transcript');
                    }
                    Object.assign(rTask, full);
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
                    .sort((a, b) => b.updatedAt - a.updatedAt);
                await this.memento.update(KEY, sorted);
            }
            this.syncState = conflicted ? 'conflict' : 'connected';
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
        // Streaming entries arrive faster than network writes. Serialize per
        // task so successive snapshots use the acknowledged server revision.
        const snapshot = structuredClone(session);
        const previous = this.pushes.get(session.id) || Promise.resolve(true);
        const operation = previous.then(() => this.sendSnapshot(snapshot, config));
        this.pushes.set(session.id, operation);
        try {
            return await operation;
        } finally {
            if (this.pushes.get(session.id) === operation) { this.pushes.delete(session.id); }
        }
    }

    private async sendSnapshot(session: Session, config: SyncConfig): Promise<boolean> {
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
            const matchesSent = (stored: Session) => JSON.stringify({
                title: stored.title, entries: stored.entries || [], history: stored.history || [],
                deleted: Boolean(stored.deleted),
            }) === JSON.stringify({ title: payload.title, entries: payload.entries,
                history: payload.history, deleted: payload.deleted });

            const res = await fetch(url.toString(), {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            });

            if (res.ok) {
                const data = await res.json();
                if (Number.isInteger(data?.revision) && data.revision > 0) {
                    this.revisions.set(session.id, data.revision);
                    session.revision = data.revision;
                    const stored = this.memento.get<Session[]>(KEY) || [];
                    await this.memento.update(KEY, stored.map(s => s.id === session.id
                        ? { ...s, revision: data.revision, dirty: !matchesSent(s) } : s));
                } else {
                    this.syncState = 'offline';
                    return false;
                }
                this.syncState = 'connected';
                return true;
            } else if (res.status === 409) {
                this.syncState = 'conflict';
                return false;
            }
            this.syncState = 'offline';
            return false;
        } catch {
            this.syncState = 'offline';
            return false;
        }
    }
}
