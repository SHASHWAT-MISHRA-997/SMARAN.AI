// Integration scenario executed by VS Code, with a real configured provider.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.run = async function () {
  const audit = process.env.SMARAN_AUDIT_ROOT;
  assert.ok(audit);
  const resultPath = path.join(audit, process.env.SMARAN_AUDIT_RECOVERY ? 'extension-live-recovery.json' : 'extension-live-scenario.json');
  const entries = [];
  const checks = [];
  const https = require('node:https');
  const originalRequest = https.request;
  https.request = function (...args) {
    const request = originalRequest.apply(this, args);
    request.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const choice = data.choices?.[0];
          if (choice) entries.push({ kind: 'response-shape', finish: choice.finish_reason, contentLength: choice.message?.content?.length || 0, reasoningLength: (choice.message?.reasoning || choice.message?.reasoning_content || '').length, toolCalls: choice.message?.tool_calls?.map(call => ({ name: call.function?.name, args: call.function?.arguments })) || [] });
        } catch {}
      });
    });
    return request;
  };
  const save = (extra) => fs.writeFileSync(resultPath, JSON.stringify({ checks, entries, ...extra }, null, 2));
  const extension = vscode.extensions.getExtension('ShashwatMishra.smaran-ai-codex');
  assert.ok(extension);
  await extension.activate();
  const loaded = (relative) => {
    const filename = path.join(extension.extensionPath, relative);
    return Object.values(require.cache).find(module => module.filename.toLowerCase() === filename.toLowerCase())?.exports || require(filename);
  };
  const { AgentPanel } = loaded('out/agentPanel.js');
  const { Keys } = loaded('out/settings.js');
  const originalResolve = AgentPanel.prototype.resolveWebviewView;
  const originalRecord = AgentPanel.prototype.record;
  const originalAsk = AgentPanel.prototype.ask;
  const originalGet = Keys.prototype.get;
  let panel;
  AgentPanel.prototype.resolveWebviewView = function (view) {
    originalResolve.call(this, view);
    panel = this;
    assert.equal(view.webview.options.enableScripts, true);
    assert.match(view.webview.html, /Content-Security-Policy/);
  };
  AgentPanel.prototype.record = function (entry) {
    entries.push(entry);
    save({ running: true });
    return originalRecord.call(this, entry);
  };
  AgentPanel.prototype.ask = async function (call) {
    // The only shell command approved for this fixture is its test runner.
    const allowed = call.name === 'run_command' && /^node --test stats\.test\.cjs\s*$/.test(call.args.command);
    entries.push({ kind: 'approval-audit', tool: call.name, allowed });
    return allowed;
  };
  const keyFile = path.join(audit, '../../data/cloud_keys.json');
  const provider = process.env.SMARAN_AUDIT_PROVIDER || 'openrouter';
  const key = String((provider === 'openrouter' && process.env.SMARAN_AUDIT_OPENROUTER_KEY) || JSON.parse(fs.readFileSync(keyFile, 'utf8'))[provider] || '').trim();
  assert.ok(key, 'A project-configured provider key is needed for the live scenario');
  Keys.prototype.get = async function (requested) { return requested === provider ? key : ''; };
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.equal(path.resolve(root).toLowerCase(), path.join(audit, 'extension-sample-app').toLowerCase());
    const config = vscode.workspace.getConfiguration('smaran');
    for (const [name, value] of Object.entries({ provider, model: process.env.SMARAN_AUDIT_MODEL || 'cohere/north-mini-code:free', reach: 'workspace', approval: 'commands' })) {
      await config.update(name, value, vscode.ConfigurationTarget.Workspace);
    }
    await extension.activate();
    await vscode.commands.executeCommand('smaran.startAgent');
    const deadline = Date.now() + 15000;
    while (!panel && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(panel, 'The actual agent webview must open');
    checks.push('Real VS Code agent panel opened with scripts and CSP');
    const prompt = 'Build a tiny dependency-free JavaScript statistics library in this empty workspace. Create stats.cjs exporting summarize(numbers), returning {count, sum, min, max, mean}. Empty input returns count 0, sum 0, min null, max null, mean null. Reject non-arrays, non-numbers, NaN and Infinity with TypeError. Include tests in stats.test.cjs using node:test and a short README.md. Inspect the folder first. Run exactly node --test stats.test.cjs and fix failures before finishing. Work only in this folder. Do not install anything, access the network, delegate, use git, or run any other shell command.';
    fs.writeFileSync(path.join(audit, 'extension-live-prompt.txt'), prompt);
    const task = process.env.SMARAN_AUDIT_RECOVERY
      ? 'The statistics library has a regression: summarize returns an incorrect count. Inspect the files, run exactly node --test stats.test.cjs to reproduce it, fix the implementation without weakening tests, then run that same command again. Keep the existing API and invalid-input behavior. Work only in this workspace. Do not install anything, use network, delegate, use git or run any other command.'
      : prompt;
    await panel.submit(task);
    assert.ok(!entries.some(entry => entry.kind === 'error'), 'The agent run must not report an error');
    assert.ok(entries.some(entry => entry.kind === 'done'), 'The agent must report completion');
    for (const file of ['stats.cjs', 'stats.test.cjs', 'README.md']) assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
    // Validate output independently from the model's own tests.
    const { summarize } = require(path.join(root, 'stats.cjs'));
    assert.deepEqual(summarize([]), { count: 0, sum: 0, min: null, max: null, mean: null });
    assert.deepEqual(summarize([-2, 0, 5]), { count: 3, sum: 3, min: -2, max: 5, mean: 1 });
    for (const input of [null, {}, [NaN], [Infinity], ['2']]) assert.throws(() => summarize(input), TypeError);
    checks.push('The live model created the requested software; independent empty, negative, ordinary and invalid-input assertions passed');
    save({ passed: true, running: false });
  } catch (error) {
    save({ passed: false, running: false, error: String(error.stack || error) });
    throw error;
  } finally {
    AgentPanel.prototype.resolveWebviewView = originalResolve;
    AgentPanel.prototype.record = originalRecord;
    AgentPanel.prototype.ask = originalAsk;
    Keys.prototype.get = originalGet;
    https.request = originalRequest;
  }
};
