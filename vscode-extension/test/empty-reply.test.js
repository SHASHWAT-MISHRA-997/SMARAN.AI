/* The empty-reply cases, against the real parser. */
const http = require('http');
const assert = require('assert');

const cases = [
  { name: 'content present',            body: { choices: [{ message: { content: 'hello' } }] },                        expect: 'hello' },
  { name: 'reasoning_content only',     body: { choices: [{ message: { content: '', reasoning_content: 'thought' } }] }, expect: 'thought' },
  { name: 'reasoning only',             body: { choices: [{ message: { content: '', reasoning: 'thought2' } }] },        expect: 'thought2' },
  { name: 'empty, finish_reason length',body: { choices: [{ finish_reason: 'length', message: { content: '' } }] },      throws: /whole budget/ },
  { name: 'empty, no reason',           body: { choices: [{ message: { content: '' } }] },                              throws: /empty reply/ },
];

(async () => {
  let index = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cases[index].body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const { complete } = require('../out/agent/models.js');

  let passed = 0;
  for (index = 0; index < cases.length; index += 1) {
    const c = cases[index];
    const choice = { provider: 'lmstudio', model: 'test-model', apiKey: '', lmStudioUrl: base };
    try {
      const got = await complete([{ role: 'user', content: 'hi' }], choice);
      assert.strictEqual(got, c.expect, `${c.name}: got ${JSON.stringify(got)}`);
      assert.ok(!c.throws, `${c.name}: expected a thrown error`);
    } catch (error) {
      if (!c.throws) throw error;
      assert.ok(c.throws.test(error.message), `${c.name}: message was "${error.message}"`);
    }
    passed += 1;
    console.log(`  ok  ${c.name}`);
  }
  server.close();
  console.log(`${passed}/${cases.length} passed`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
