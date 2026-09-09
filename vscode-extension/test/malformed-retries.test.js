const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const models = require('../out/agent/models.js');
const { run } = require('../out/agent/loop.js');

test('repeated malformed writes stop promptly without reporting completion', async () => {
    const original = models.complete;
    let calls = 0;
    models.complete = async () => {
        calls++;
        return '<tool_call name="write_file"><path>unfinished.js</path>';
    };
    try {
        const events = [];
        for await (const event of run('Write a file', path.resolve(__dirname), [],
            { provider: 'lmstudio', model: 'fixture' }, () => false,
            { reach: 'read', approval: 'always' }, async () => false)) events.push(event);
        assert.equal(calls, 3);
        assert.ok(events.some(e => e.type === 'error' && /incomplete/.test(e.message)));
        assert.ok(!events.some(e => e.type === 'done' || e.type === 'tool_result'));
    } finally {
        models.complete = original;
    }
});
