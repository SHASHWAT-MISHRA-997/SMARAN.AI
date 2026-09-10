const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../out/sessions');

function memory(initial = []) {
    let value = structuredClone(initial);
    return { get: () => structuredClone(value), update: async (_, next) => { value = structuredClone(next); } };
}
const config = { backendUrl: 'http://localhost:3003', projectId: 'fixture' };
const task = { id: 'task-a', title: 'Real task', project_id: 'fixture', revision: 1,
    entries: [{ kind: 'you', body: 'Implement feature' }], history: [{ role: 'user', content: 'Implement feature' }] };

test('pull reads paginated envelope and fetches actual transcripts', async () => {
    const previous = global.fetch;
    const calls = [];
    global.fetch = async url => {
        calls.push(url);
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/task-a')) return Response.json(task);
        if (parsed.searchParams.has('offset')) return Response.json({ tasks: [], next_offset: null });
        return Response.json({ tasks: [{ id: task.id, title: task.title, revision: 1 }], next_offset: 100 });
    };
    try {
        const store = new SessionStore(memory());
        assert.equal(await store.pullFromBackend(config), true);
        assert.deepEqual(store.get(task.id).history, task.history);
        assert.equal(calls.length, 3);
    } finally { global.fetch = previous; }
});

test('409 retains local edits and conflict status without destructive pull', async () => {
    const previous = global.fetch;
    let requests = 0;
    global.fetch = async () => { requests++; return new Response('{}', { status: 409 }); };
    try {
        const store = new SessionStore(memory());
        const local = { id: task.id, title: 'Local edit', revision: 1, entries: [], history: [], updatedAt: 1 };
        await store.save(local);
        assert.equal(await store.pushToBackend(local, config), false);
        assert.equal(store.getSyncState(), 'conflict');
        assert.equal(store.get(task.id).title, 'Local edit');
        assert.equal(requests, 1);
    } finally { global.fetch = previous; }
});

test('remote updates cannot overwrite an unsynced local task', async () => {
    const previous = global.fetch;
    global.fetch = async () => Response.json({ tasks: [{ ...task, revision: 2 }], next_offset: null });
    try {
        const store = new SessionStore(memory([{ id: task.id, title: 'Unsynced', revision: 1, dirty: true,
            updatedAt: 1, entries: [], history: [] }]));
        await store.pullFromBackend(config);
        assert.equal(store.get(task.id).title, 'Unsynced');
        assert.equal(store.getSyncState(), 'conflict');
    } finally { global.fetch = previous; }
});

test('offline deletion persists until reconnect sends a tombstone', async () => {
    const previous = global.fetch;
    const disk = memory([{ id: task.id, title: 'Delete me', revision: 1,
        entries: task.entries, history: task.history, updatedAt: 1 }]);
    try {
        const store = new SessionStore(disk);
        await store.remove(task.id);
        assert.equal(store.get(task.id), undefined);
        assert.equal(disk.get()[0].dirty, true);
        assert.deepEqual(disk.get()[0].history, []);
        let sent;
        global.fetch = async (_, options) => {
            if (options.method === 'PUT') {
                sent = JSON.parse(options.body);
                return Response.json({ revision: 2 });
            }
            return Response.json({ tasks: [{ ...task, deleted: true, revision: 2 }], next_offset: null });
        };
        // New instance proves the pending deletion survives extension restart.
        await new SessionStore(disk).pullFromBackend(config);
        assert.equal(sent.deleted, true);
        assert.equal(disk.get()[0].dirty, false);
    } finally { global.fetch = previous; }
});

test('streaming snapshots serialize writes and use acknowledged revisions', async () => {
    const previous = global.fetch;
    const payloads = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    global.fetch = async (_, options) => {
        payloads.push(JSON.parse(options.body));
        if (payloads.length === 1) await gate;
        return Response.json({ revision: payloads.length });
    };
    try {
        const store = new SessionStore(memory());
        const local = { id: 'stream', title: 'First', entries: [], history: [], updatedAt: 1 };
        const first = store.pushToBackend(local, config);
        local.title = 'Second';
        const second = store.pushToBackend(local, config);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(payloads.length, 1);
        release();
        assert.equal(await first, true);
        assert.equal(await second, true);
        assert.deepEqual(payloads.map(p => p.expected_revision), [0, 1]);
        assert.deepEqual(payloads.map(p => p.title), ['First', 'Second']);
    } finally { release(); global.fetch = previous; }
});
