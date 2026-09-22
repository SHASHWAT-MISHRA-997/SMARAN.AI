/**
 * Two habits of small coding models, both seen in one live run of
 * qwen2.5-coder:7b through this extension in a real VS Code.
 *
 * It wrapped a file in a Markdown fence, and the fence went to disk: stats.cjs
 * began with ```javascript and could not be loaded. Then, on its third step,
 * it typed out what a write_file result looks like instead of calling
 * write_file - "Created src/stats.test.cjs." and a diff - and the loop, seeing
 * no tool call, reported the task finished with the file never written.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unwrapFence } = require('../out/agent/tools.js');
const { imitatedResultPaths, describedButUnwritten } = require('../out/agent/loop.js');

let passed = 0;
const ok = (name) => { console.log('  ok  ' + name); passed += 1; };

const code = "module.exports = { add: (a, b) => a + b };\n";

assert.strictEqual(unwrapFence('\n```javascript\n' + code + '```\n', 'stats.cjs'), code);
assert.strictEqual(unwrapFence('```\n' + code + '```', 'stats.cjs'), code);
ok('a fence around the whole file is removed, with or without a language');

assert.strictEqual(unwrapFence('```js\r\nconst a = 1;\r\n```\r\n', 'a.js'), 'const a = 1;\r\n');
ok('Windows line endings survive the unwrap');

assert.strictEqual(unwrapFence(code, 'stats.cjs'), code);
ok('a file with no fence is untouched');

const readme = '```bash\nnpm test\n```\n';
assert.strictEqual(unwrapFence(readme, 'README.md'), readme);
ok('a Markdown file keeps its fence - there it can be the content');

const twoBlocks = '```js\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```\n';
assert.strictEqual(unwrapFence(twoBlocks, 'x.js'), twoBlocks);
ok('two fenced blocks are not one wrapper, and are left alone');

const template = 'const doc = `\n```\nhello\n```\n`;\n';
assert.strictEqual(unwrapFence(template, 'doc.js'), template);
ok('code that merely contains a fence is not stripped');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smaran-habits-'));
fs.writeFileSync(path.join(root, 'stats.cjs'), code);

const imitation = 'Created src/stats.test.cjs.\nsrc/stats.test.cjs: +25 -0\nFinal newline added.\n+ import test from "node:test";';
assert.deepStrictEqual(imitatedResultPaths(imitation, root), ['src/stats.test.cjs']);
ok('a typed-out result for a file that does not exist is caught');

const honest = 'Done. stats.cjs now exports summarize.\n\nstats.cjs: +21 -0';
assert.deepStrictEqual(imitatedResultPaths(honest, root), []);
ok('a true summary repeating a real result line is not mistaken for one');

assert.deepStrictEqual(imitatedResultPaths('All four files are written and the tests pass.', root), []);
ok('an ordinary final answer is not touched');

const shown = "Great, let's create the `stats.test.cjs` file.\n\nHere's the initial content for `stats.test.cjs`:\n\n```javascript\n// stats.test.cjs\nconst test = require('node:test');\n```\n";
assert.deepStrictEqual(describedButUnwritten(shown, root), ['stats.test.cjs']);
ok('code shown for a file it said it was creating, never written, is caught');

const example = 'Here is how a debounce works:\n\n```js\nfunction debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }\n```\n';
assert.deepStrictEqual(describedButUnwritten(example, root), []);
ok('an example in an answer is still an answer');

const summary = "I'll write it up: `stats.cjs` exports summarize.\n\n```js\nsummarize([1, 2]) // { count: 2 }\n```\n";
assert.deepStrictEqual(describedButUnwritten(summary, root), []);
ok('a summary naming only files that exist is not caught');

fs.rmSync(root, { recursive: true, force: true });
console.log(`${passed} checks passed`);

// A whole file, </content> closed, then no </tool_call>: qwen2.5-coder:7b did
// this three times running and every one was refused as a cut-off write.
const { parseToolCall, looksTruncated, endsOnClosedArgument } = require('../out/agent/loop.js');
const wholeButUnclosed = 'Next.\n\n<tool_call name="write_file">\n<path>t.cjs</path>\n<content>\nconst a = 1;\n</content>\n\n\n';
const cutMidFile = '<tool_call name="write_file">\n<path>t.cjs</path>\n<content>\nconst a = 1;\nconst b';
assert.ok(looksTruncated(wholeButUnclosed));
assert.ok(endsOnClosedArgument(wholeButUnclosed, 'write_file', parseToolCall(wholeButUnclosed).args));
console.log('  ok  a write whose content closed is complete without </tool_call>');
assert.ok(!endsOnClosedArgument(cutMidFile, 'write_file', parseToolCall(cutMidFile).args));
console.log('  ok  a write cut off inside its content is still refused');
const pathOnly = '<tool_call name="write_file"><path>unfinished.js</path>';
assert.ok(!endsOnClosedArgument(pathOnly, 'write_file', parseToolCall(pathOnly).args));
console.log('  ok  a write that closed its path but sent no content is still refused');
