const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tools = require('../out/agent/tools');
const { decide } = require('../out/agent/modes');
const loop = require('../out/agent/loop');
const models = require('../out/agent/models');
const { unified } = require('../out/agent/diff');

test('native provider tool calls preserve code and obey the same read-only policy', async t => {
    const root = project(t);
    const content = 'const tag = "</content>";\n';
    const reply = models.NATIVE_CALL_PREFIX + JSON.stringify({ name: 'write_file', args: { path: 'native.js', content } });
    assert.equal(loop.parseToolCall(reply).args.content, content);
    assert.equal(loop.proseBefore(reply), '');
    const original = models.complete;
    let calls = 0;
    models.complete = async () => ++calls === 1 ? reply : 'No change was made.';
    t.after(() => { models.complete = original; });
    const events = [];
    for await (const event of loop.run('write', root, [], { provider: '', model: 'test' }, () => false, { reach: 'read', approval: 'never' }, async () => true)) events.push(event);
    assert.ok(events.some(event => event.type === 'refused'));
    assert.equal(fs.existsSync(path.join(root, 'native.js')), false);
});

const scratch = path.resolve(__dirname, '../../.cache/audit/extension-tests');
fs.mkdirSync(scratch, { recursive: true });
test('LF edits match Windows CRLF while preserving unrelated bytes and indentation', async t => {
    const root = project(t);
    const file = path.join(root, 'windows.txt');
    fs.writeFileSync(file, 'prefix\r\n  first\r\n  second\r\nsuffix\n');
    await tools.execute('edit_file', {path:'windows.txt', find:'  first\n  second', replace:'  changed\n  second'}, root);
    assert.equal(fs.readFileSync(file, 'utf8'), 'prefix\r\n  changed\r\n  second\r\nsuffix\n');
    assert.throws(() => tools.prepareFileChange('edit_file', {path:'windows.txt', find:'changed\nsecond', replace:'bad'}, root), /no line-number prefixes/);
});
function project(t) {
    const root = fs.mkdtempSync(path.join(scratch, 'project-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    tools.confineToFolder(true);
    return root;
}

test('read-only and manual policy gate browser mutations', () => {
    for (const name of ['browser_click', 'browser_type']) {
        assert.equal(decide({ reach: 'read', approval: 'never' }, name, {}).act, 'refuse');
        assert.equal(decide({ reach: 'workspace', approval: 'always' }, name, {}).act, 'ask');
    }
});

test('parser preserves indentation, trailing newlines and literal replacements', async t => {
    const root = project(t);
    const find = '  old\n';
    const replace = '    $& $$ $` $\'\n';
    fs.writeFileSync(path.join(root, 'a.txt'), find);
    const call = loop.parseToolCall(`<toolcall name="edit_file"><path>a.txt</path><find>${find}</find><replace>${replace}</replace></tool>`);
    assert.equal(call.args.find, find);
    assert.equal(call.args.replace, replace);
    await tools.execute(call.name, call.args, root);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), replace);
});

test('successful wrapped calls emit prose without leaking tags', async t => {
    const root = project(t);
    const original = models.complete;
    t.after(() => { models.complete = original; });
    const replies = ['Checking now <tool_calls><tool_call name="list_files"></tool_call></tool_calls>', 'Done'];
    models.complete = async () => replies.shift();
    const events = [];
    for await (const event of loop.run('inspect', root, [], {provider:'',model:'test'}, () => false, {reach:'read',approval:'never'}, async () => false)) events.push(event);
    assert.deepEqual(events.filter(e => e.type === 'message').map(e => e.text), ['Checking now', 'Done']);
});

test('preview is read-only and refuses to overwrite a file changed during review', t => {
    const root = project(t);
    const target = path.join(root, 'a.txt');
    fs.writeFileSync(target, 'before\n');
    const prepared = tools.prepareFileChange('write_file', {path:'a.txt',content:'after\n'}, root);
    assert.match(prepared.preview, /- before/);
    assert.match(prepared.preview, /\+ after/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'before\n');
    fs.writeFileSync(target, 'human edit\n');
    assert.throws(() => tools.applyFileChange(prepared, root), /changed while/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'human edit\n');
});

test('approval sees diff before the file changes and decline leaves it untouched', async t => {
    const root = project(t);
    const original = models.complete;
    t.after(() => { models.complete = original; });
    const replies = ['<tool_call name="write_file"><path>a.txt</path><content>after</content></tool_call>', 'Declined'];
    models.complete = async () => replies.shift();
    let asked = false;
    for await (const event of loop.run('edit', root, [], {provider:'',model:'test'}, () => false, {reach:'workspace',approval:'always'}, async call => {
        asked = true;
        assert.match(call.preview, /\+ after/);
        assert.equal(fs.existsSync(path.join(root, 'a.txt')), false);
        return false;
    })) { /* consume the real loop */ }
    assert.equal(asked, true);
    assert.equal(fs.existsSync(path.join(root, 'a.txt')), false);
});

test('nested paths under an outward junction cannot escape the workspace', async t => {
    const root = project(t);
    const outside = project(t);
    fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await tools.execute('write_file', {path:'link/new/sub/file.txt',content:'escape'}, root);
    assert.match(result, /outside the open folder/);
    assert.equal(fs.existsSync(path.join(outside, 'new')), false);
});

test('search refuses a file symlink outside the workspace', async t => {
    const root = project(t);
    const outside = project(t);
    fs.writeFileSync(path.join(outside, 'private.txt'), 'sensitive-marker');
    try { fs.symlinkSync(path.join(outside, 'private.txt'), path.join(root, 'link.txt'), 'file'); }
    catch (error) { if (error.code === 'EPERM') return t.skip('Windows file symlink privilege unavailable'); throw error; }
    assert.doesNotMatch(await tools.execute('search', {query:'sensitive-marker'}, root), /1.*sensitive-marker/);
});

test('undo refuses a change belonging to another workspace', async t => {
    const root = project(t);
    const other = project(t);
    await tools.execute('write_file', {path:'same.txt',content:'a'}, root);
    fs.writeFileSync(path.join(other, 'same.txt'), 'a');
    assert.throws(() => tools.undoLast(other), /outside the open folder/);
    assert.equal(fs.readFileSync(path.join(other, 'same.txt'), 'utf8'), 'a');
    tools.undoLast(root);
    assert.equal(fs.existsSync(path.join(root, 'same.txt')), false);
});

test('missing file paths are rejected and no-change diffs stay empty', async t => {
    assert.match(await tools.execute('write_file', {content:'bad'}, project(t)), /needs path/);
    assert.equal(unified('same\n', 'same\n', 'a.txt'), '');
    assert.match(unified('same', 'same\n', 'a.txt'), /Final newline added/);
});

test('undo preserves a file deletion made after the agent edit', async t => {
    const root = project(t);
    const target = path.join(root, 'deleted.txt');
    fs.writeFileSync(target, 'original');
    await tools.execute('write_file', {path:'deleted.txt', content:'agent edit'}, root);
    fs.unlinkSync(target);
    assert.match(tools.undoLast(root), /has changed/);
    assert.equal(fs.existsSync(target), false);
});
