const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const models = require('../out/agent/models.js');
const { run } = require('../out/agent/loop.js');
const { canDelegate, setDelegator } = require('../out/agent/delegate.js');

test('child cannot spawn a grandchild; parent can delegate again afterwards', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smaran-delegate-'));
    const original = models.complete;
    let parentCalls = 0;
    let childCalls = 0;
    const call = '<tool_call name="delegate"><task>Read the project summary</task></tool_call>';
    models.complete = async (messages) => {
        if (messages[0].content.includes('You are a focused sub-agent.')) {
            childCalls += 1;
            assert.equal(canDelegate(), false, 'child must not register its own delegator');
            return childCalls % 2 ? call : 'Read complete.';
        }
        parentCalls += 1;
        return parentCalls <= 2 ? call : 'Both summaries received.';
    };
    try {
        const events = [];
        for await (const event of run(
            'Review twice', root, [], { provider: 'lmstudio', model: 'fixture' },
            () => false, { reach: 'read', approval: 'always' }, async () => true,
        )) events.push(event);
        assert.equal(childCalls, 4);
        assert.equal(parentCalls, 3);
        assert.ok(events.some(event => event.type === 'done' && event.text === 'Both summaries received.'));
        assert.equal(canDelegate(), false, 'completed run releases handler');
    } finally {
        models.complete = original;
        setDelegator(null);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
