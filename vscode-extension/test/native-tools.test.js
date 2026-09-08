const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { complete, OPENAI_COMPATIBLE, NATIVE_CALL_PREFIX } = require('../out/agent/models');

test('text-only routes fall back without native tools; auth failures never retry', async () => {
  const requests = [];
  let status = 400;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (body.tools && status !== 200) {
      res.statusCode = status;
      res.end(JSON.stringify({ error: { message: status === 401 ? 'Invalid key' : 'Tool calling is not supported' } }));
    } else res.end(JSON.stringify({ choices: [{ message: { content: '<tool_call name="list_files"></tool_call>' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = OPENAI_COMPATIBLE.openrouter;
  OPENAI_COMPATIBLE.openrouter = `http://127.0.0.1:${server.address().port}`;
  const choice = { provider: 'openrouter', model: 'fixture', apiKey: '', ollamaUrl: '' };
  const tools = [{ type: 'function', function: { name: 'list_files', description: 'List', parameters: { type: 'object', properties: {}, required: [] } } }];
  try {
    assert.match(await complete([{ role: 'system', content: 'Use tools' }], choice, tools), /list_files/);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].tools, undefined);
    assert.match(requests[1].messages[0].content, /no native tools/);
    status = 401;
    await assert.rejects(complete([], choice, tools), /HTTP 401/);
    assert.equal(requests.length, 3);
    status = 200;
    await complete([
      { role: 'assistant', content: NATIVE_CALL_PREFIX + JSON.stringify({ name:'list_files', args:{}, id:'provider-call-7' }) },
      { role: 'user', content: 'Result of list_files:\nstats.cjs' },
    ], choice, tools);
    assert.equal(requests[3].messages[0].tool_calls[0].id, 'provider-call-7');
    assert.deepEqual(requests[3].messages[1], {role:'tool', tool_call_id:'provider-call-7', content:'Result of list_files:\nstats.cjs'});
  } finally {
    OPENAI_COMPATIBLE.openrouter = original;
    await new Promise(resolve => server.close(resolve));
  }
});
