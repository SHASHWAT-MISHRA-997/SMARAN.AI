// Run by VS Code's extension test host against the extracted VSIX.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.run = async function () {
  const audit = process.env.SMARAN_AUDIT_ROOT;
  assert.ok(audit, 'An isolated audit directory is required');
  const resultPath = path.join(audit, 'vscode-host-result.json');
  const checks = [];
  try {
    const extension = vscode.extensions.getExtension('ShashwatMishra.smaran-ai-codex');
    assert.ok(extension, 'Packaged extension is discoverable');
    assert.equal(extension.packageJSON.version, '2.20.1');
    checks.push('packaged extension 2.20.1 discovered');
    await extension.activate();
    const panelPath = path.join(extension.extensionPath, 'out', 'agentPanel.js');
    // Windows drive-letter casing can give require() a second module instance.
    const loadedPanel = Object.values(require.cache).find(m => m.filename.toLowerCase() === panelPath.toLowerCase());
    const { AgentPanel } = loadedPanel ? loadedPanel.exports : require(panelPath);
    const original = AgentPanel.prototype.resolveWebviewView;
    let rendered;
    AgentPanel.prototype.resolveWebviewView = function (view) {
      original.call(this, view);
      rendered = view;
    };
    await extension.activate();
    assert.ok(extension.isActive);
    checks.push('extension activated in real VS Code host');
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['smaran.startAgent', 'smaran.undoLastChange', 'smaran.switchMode']) {
      assert.ok(commands.includes(id), `Missing command: ${id}`);
    }
    checks.push('agent commands registered');
    await vscode.commands.executeCommand('smaran.startAgent');
    const deadline = Date.now() + 15000;
    while (!rendered && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    assert.ok(rendered?.visible, `Agent view becomes visible (resolved=${Boolean(rendered)}, visible=${rendered?.visible})`);
    assert.match(rendered.webview.html, /Content-Security-Policy/);
    assert.match(rendered.webview.html, /<script/);
    AgentPanel.prototype.resolveWebviewView = original;
    checks.push('agent webview resolved with scripts and CSP');
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.equal(path.relative(workspace, path.join(audit, 'vscode-workspace')), '');
    const fixture = path.join(workspace, 'audit-example.txt');
    fs.writeFileSync(fixture, 'original\n');
    const tools = require(path.join(extension.extensionPath, 'out', 'agent', 'tools.js'));
    tools.confineToFolder(true);
    const change = tools.prepareFileChange('edit_file', { path: 'audit-example.txt', find: 'original', replace: 'verified' }, workspace);
    assert.match(change.preview, /verified/);
    tools.applyFileChange(change, workspace);
    const document = await vscode.workspace.openTextDocument(fixture);
    await vscode.window.showTextDocument(document);
    assert.equal(document.getText(), 'verified\n');
    tools.undoLast(workspace);
    assert.equal(fs.readFileSync(fixture, 'utf8'), 'original\n');
    checks.push('packaged edit and undo operate correctly in isolated editor workspace');
    require(path.join(extension.extensionPath, 'node_modules', 'ws'));
    checks.push('packaged ws loads in extension host');
    fs.writeFileSync(resultPath, JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    fs.writeFileSync(resultPath, JSON.stringify({ passed: false, checks, error: String(error.stack || error) }, null, 2));
    throw error;
  }
};
