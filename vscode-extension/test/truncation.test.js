/**
 * A tool call cut off mid-write.
 *
 * The model's reply can end in the middle of a call - it runs into max_tokens,
 * or it simply stops. The parser needs the closing tag, so the whole reply was
 * treated as prose and the raw `<tool_call name="read_file"><path>...` was
 * printed at the person as though it were the answer. Then the run ended.
 */
const assert = require('assert');
const { parseToolCall, looksTruncated, proseBefore } = require('../out/agent/loop.js');

let passed = 0;
const ok = (name) => { console.log('  ok  ' + name); passed += 1; };

const complete = '<tool_call name="read_file">\n<path>a/b.py</path>\n</tool_call>';
const cut = 'Let me look at that file.\n\n<tool_call name="read_file">\n<path>a/b.py</path>\n<offset>200</offset>';

assert.ok(parseToolCall(complete));
assert.strictEqual(parseToolCall(complete).args.path, 'a/b.py');
assert.strictEqual(looksTruncated(complete), false);
ok('a complete call still parses, and is not called truncated');

assert.strictEqual(parseToolCall(cut), undefined);
assert.strictEqual(looksTruncated(cut), true);
ok('a call with no closing tag is recognised as cut off');

assert.strictEqual(proseBefore(cut), 'Let me look at that file.');
ok('what the model said before the call is kept');

assert.ok(!proseBefore(cut).includes('<tool_call'));
ok('the half-written tag is not part of what is shown');

assert.strictEqual(looksTruncated('No tools here, just an answer.'), false);
assert.strictEqual(proseBefore('No tools here, just an answer.'), 'No tools here, just an answer.');
ok('an ordinary reply is untouched');

// An unknown argument must not break a call that is otherwise complete.
const extra = '<tool_call name="read_file">\n<path>a/b.py</path>\n<offset>200</offset>\n</tool_call>';
const parsed = parseToolCall(extra);
assert.ok(parsed && parsed.args.path === 'a/b.py' && parsed.args.offset === '200');
ok('an argument the tool does not know still parses');

console.log(`${passed} checks passed`);
