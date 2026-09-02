/**
 * The MCP client, against a real server process.
 *
 * The server below is a genuine MCP implementation - it speaks newline
 * JSON-RPC over stdio, refuses to answer before `initialize`, and returns
 * content blocks in the shape the schema defines. Testing against a stub that
 * answers anything would prove the client can parse its own assumptions.
 *
 * It also does two things real servers do and clients forget: it prints a
 * banner to stdout that is not JSON, and it writes its startup detail to
 * stderr.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { McpSession, splitCommand, qualify } = require('../out/agent/mcp.js');
const { McpRegistry } = require('../out/agent/mcpRegistry.js');
const { decide } = require('../out/agent/modes.js');

const SERVER = `
const lines = [];
process.stdout.write("starting up\\n");           // not JSON, on purpose
process.stderr.write("server: ready\\n");
let initialised = false;
process.stdin.on('data', (chunk) => {
  for (const line of chunk.toString('utf8').split('\\n')) {
    const text = line.trim();
    if (!text) continue;
    const msg = JSON.parse(text);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
    if (msg.method === 'initialize') {
      reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} },
              serverInfo: { name: 'test-server', version: '1.0.0' } });
    } else if (msg.method === 'notifications/initialized') {
      initialised = true;
    } else if (!initialised) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
        error: { code: -32002, message: 'not initialised' } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      reply({ tools: [
        { name: 'echo', description: 'Repeat the text back.',
          inputSchema: { properties: { text: { type: 'string' }, times: { type: 'integer' } } } },
        { name: 'boom', description: 'Always fails.' },
      ] });
    } else if (msg.method === 'tools/call') {
      if (msg.params.name === 'boom') {
        reply({ isError: true, content: [{ type: 'text', text: 'it broke' }] });
      } else {
        const n = msg.params.arguments.times;
        reply({ content: [{ type: 'text',
          text: msg.params.arguments.text + '|times=' + n + '|type=' + typeof n }] });
      }
    }
  }
});
`;

(async () => {
  let passed = 0;
  const ok = (name) => { console.log('  ok  ' + name); passed += 1; };

  // splitCommand, which decides whether a published command line works at all.
  assert.deepStrictEqual(splitCommand('npx -y @scope/server'), ['npx', '-y', '@scope/server']);
  assert.deepStrictEqual(splitCommand('"C:/Program Files/node.exe" run'),
    ['C:/Program Files/node.exe', 'run']);
  assert.deepStrictEqual(splitCommand('   '), []);
  ok('a command line splits the way it was written');

  assert.strictEqual(qualify('my server', 'do-thing'), 'mcp_my_server_do_thing');
  ok('tool names survive being made into identifiers');

  const file = path.join(os.tmpdir(), `smaran-mcp-test-${process.pid}.js`);
  fs.writeFileSync(file, SERVER);
  const config = { name: 'test', target: `${JSON.stringify(process.execPath)} ${JSON.stringify(file)}` };

  const session = new McpSession(config);
  await session.open(config);
  assert.strictEqual(session.serverInfo.name, 'test-server');
  ok('the handshake completes and the server identifies itself');

  const tools = await session.listTools();
  assert.deepStrictEqual(tools.map((t) => t.name), ['echo', 'boom']);
  ok('tools are listed');

  const said = await session.call('echo', { text: 'hello', times: 3 });
  assert.ok(said.includes('hello'), said);
  ok('a tool call returns its text');
  session.close();

  // The registry: naming, coercion, failure, and what the panel is told.
  const registry = new McpRegistry();
  await registry.use([config]);

  const report = registry.report();
  assert.strictEqual(report.length, 1);
  assert.strictEqual(report[0].connected, true, JSON.stringify(report[0]));
  assert.deepStrictEqual(report[0].tools, ['echo', 'boom']);
  ok('the panel is told what connected and what it offers');

  assert.ok(registry.has('mcp_test_echo'));
  assert.ok(!registry.has('mcp_test_missing'));
  ok('tools are addressable under their prefixed names');

  assert.ok(registry.describe().includes('mcp_test_echo(text, times)'),
    registry.describe());
  ok('the prompt lists them with their arguments');

  // Arguments arrive as strings; a schema asking for an integer must get one.
  const coerced = await registry.call('mcp_test_echo', { text: 'x', times: '4' });
  assert.ok(coerced.includes('type=number'), coerced);
  ok('an integer argument arrives as a number, not "4"');

  const failed = await registry.call('mcp_test_boom', {});
  assert.ok(/reported a failure/.test(failed) && /it broke/.test(failed), failed);
  ok('a tool that fails says so instead of throwing');

  const missing = await registry.call('mcp_test_nope', {});
  assert.ok(/no MCP tool called/.test(missing), missing);
  ok('an invented tool name is answered, not crashed on');

  // Every mode, because this is the safety half of the feature.
  assert.strictEqual(decide('plan', 'mcp_test_echo', {}).act, 'refuse');
  for (const mode of ['manual', 'autoEdit', 'auto']) {
    assert.strictEqual(decide(mode, 'mcp_test_echo', {}).act, 'ask',
      `${mode} should still ask`);
  }
  ok('MCP tools are shown and waited on in every mode, and refused in Plan');

  registry.closeAll();

  // A server that cannot start is reported, not thrown.
  const broken = new McpRegistry();
  await broken.use([{ name: 'nope', target: 'definitely-not-a-real-command-xyz' }]);
  const brokenReport = broken.report();
  assert.strictEqual(brokenReport[0].connected, false);
  assert.ok(brokenReport[0].problem, 'a reason should be kept');
  assert.deepStrictEqual(broken.tools(), []);
  ok('a server that will not start is reported with its reason');
  broken.closeAll();

  fs.unlinkSync(file);
  console.log(`${passed} checks passed`);
})().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
