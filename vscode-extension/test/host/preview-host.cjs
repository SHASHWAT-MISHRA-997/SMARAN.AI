// Run inside a real VS Code: the preview must open as a Simple Browser tab
// beside the editor, showing the workspace page through the local server.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.run = async function () {
  const out = process.env.SMARAN_AUDIT_ROOT;
  const result = { checks: [] };
  try {
    const extension = vscode.extensions.getExtension('ShashwatMishra.smaran-ai-codex');
    await extension.activate();
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    fs.writeFileSync(path.join(root, 'index.html'), '<html><body><h1>Preview works</h1></body></html>');

    const doc = await vscode.workspace.openTextDocument(path.join(root, 'index.html'));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    // The instance the extension configured - a second require() of the same
    // file under different drive-letter casing is a separate module on Windows.
    const wanted = path.join(extension.extensionPath, 'out', 'agent', 'preview.js').toLowerCase();
    const loaded = Object.values(require.cache).find((m) => m.filename.toLowerCase() === wanted);
    assert.ok(loaded, 'the extension must have loaded the preview module');
    const preview = loaded.exports;
    const commands = (await vscode.commands.getCommands(true)).filter((c) => /simpleBrowser/i.test(c));
    result.commands = commands;
    const said = await preview.showPreview(root, 'index.html');
    result.said = said;
    await new Promise((r) => setTimeout(r, 2500));

    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => ({ column: group.viewColumn, label: tab.label,
        viewType: tab.input && tab.input.viewType, isActive: tab.isActive })));
    result.tabs = tabs;
    const browserTab = tabs.find((t) => /^127\.0\.0\.1:\d+\/index\.html$/.test(t.label));
    assert.ok(browserTab, 'a Simple Browser tab must be open');
    result.checks.push('Simple Browser tab opened');
    assert.ok(browserTab.column > 1, 'it must open beside the editor, not over it');
    result.checks.push('it opened in column ' + browserTab.column + ', beside the editor');
    const editorStillThere = tabs.some((t) => t.column === 1 && /index\.html/.test(t.label));
    assert.ok(editorStillThere, 'the code must stay open');
    result.checks.push('the code editor stayed open in column 1');
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = String(error && error.stack || error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'preview-host.json'), JSON.stringify(result, null, 2));
  }
};
