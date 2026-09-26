/* Ollama and LM Studio, against a stand-in for each local server: chat, the
   model list, and "ollama" accepted as Ollama's name in settings. */
const http = require('http');
const assert = require('assert');
const { test } = require('node:test');

function serve() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/tags') return json({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'nomic-embed-text' }] });
      if (req.url === '/api/chat') return json({ message: { role: 'assistant', content: 'ollama says hi' }, done: true });
      if (req.url === '/v1/models') return json({ data: [{ id: 'llama-3.2-3b' }] });
      if (req.url === '/v1/chat/completions') return json({ choices: [{ message: { content: 'lmstudio says hi' } }] });
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('Ollama and LM Studio answer and list their models', async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const models = require('../out/agent/models.js');
  const providers = require('../out/providers.js');
  const msgs = [{ role: 'user', content: 'hi' }];
  try {
    assert.equal(await models.complete(msgs, { provider: '', model: 'qwen2.5-coder:7b', apiKey: '', ollamaUrl: base }), 'ollama says hi');
    assert.equal(await models.complete(msgs, { provider: 'lmstudio', model: 'llama-3.2-3b', apiKey: '', ollamaUrl: '', lmStudioUrl: `${base}/v1` }), 'lmstudio says hi');
    // Embedding models cannot chat and are left out.
    assert.deepEqual((await providers.listModels('', '', base)).map((m) => m.id), ['qwen2.5-coder:7b']);
    assert.deepEqual((await providers.listModels('ollama', '', base)).map((m) => m.id), ['qwen2.5-coder:7b']);
    assert.deepEqual((await providers.listModels('lmstudio', '', base, `${base}/v1`)).map((m) => m.id), ['llama-3.2-3b']);
  } finally {
    server.close();
  }
});
