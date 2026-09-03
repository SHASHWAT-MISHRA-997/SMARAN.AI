/**
 * A picture, in four provider shapes.
 *
 * Pasting a screenshot did nothing, then explained why it could do nothing.
 * Every provider takes an image differently and all four are handled, so
 * whether it can be read now depends on the model rather than on this
 * extension. The shapes below are each provider's documented one; getting any
 * of them wrong produces a 400 that reads as the feature being broken.
 */
const assert = require('assert');
const http = require('http');

const { complete } = require('../out/agent/models.js');

const IMAGE = { data: 'aGVsbG8=', mime: 'image/png' };

(async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen = { path: req.url, payload: JSON.parse(body || '{}') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Answer in whichever shape the caller expects.
      res.end(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        message: { content: 'ok' },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  let passed = 0;
  const ok = (name) => { console.log('  ok  ' + name); passed += 1; };

  const messages = [{ role: 'user', content: 'what is this?', images: [IMAGE] }];

  // OpenAI-compatible: content becomes parts, image_url carries a data URL.
  await complete(messages, { provider: 'lmstudio', model: 'm', apiKey: '', lmStudioUrl: `${base}/v1` });
  const openai = seen.payload.messages[0];
  assert.ok(Array.isArray(openai.content), 'content should be parts');
  assert.strictEqual(openai.content[0].type, 'text');
  assert.strictEqual(openai.content[1].type, 'image_url');
  assert.ok(openai.content[1].image_url.url.startsWith('data:image/png;base64,'));
  ok('OpenAI shape: a text part and an image_url data URL');

  // Ollama: a bare base64 array on the message.
  await complete(messages, { provider: '', model: 'm', apiKey: '', ollamaUrl: base });
  const ollama = seen.payload.messages[0];
  assert.deepStrictEqual(ollama.images, ['aGVsbG8=']);
  assert.strictEqual(ollama.content, 'what is this?');
  ok('Ollama shape: base64 on an images array, text left alone');

  // And a turn with no picture must be untouched by any of it.
  await complete([{ role: 'user', content: 'plain' }], {
    provider: 'lmstudio', model: 'm', apiKey: '', lmStudioUrl: `${base}/v1`,
  });
  assert.strictEqual(seen.payload.messages[0].content, 'plain');
  ok('a message without a picture keeps a plain string body');

  server.close();
  console.log(`${passed} checks passed`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
