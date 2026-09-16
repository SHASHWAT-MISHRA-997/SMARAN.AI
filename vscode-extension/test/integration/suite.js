/**
 * The extension, running inside a real VS Code extension host.
 *
 * Everything else in test/ runs under plain node: the vscode module is stubbed,
 * so those tests establish that the logic is right and nothing at all about
 * whether the extension loads, activates, or registers the commands its
 * manifest promises. A manifest that names a command the code never registers
 * produces an entry in the palette that fails when pressed, and no unit test
 * can see it.
 *
 * This runs in the editor. `vscode` here is the real API.
 */

const assert = require('node:assert/strict');
const vscode = require('vscode');

const ID = 'ShashwatMishra.smaran-ai-codex';

suite('the extension inside VS Code', () => {
    test('VS Code knows about it at all', () => {
        const found = vscode.extensions.getExtension(ID)
            || vscode.extensions.all.find(
                (e) => e.id.toLowerCase() === ID.toLowerCase());
        assert.ok(found, 'the extension is not installed in this editor');
    });

    test('it activates', async () => {
        const found = vscode.extensions.all.find(
            (e) => e.id.toLowerCase() === ID.toLowerCase());
        await found.activate();
        assert.equal(found.isActive, true, 'activate() did not leave it active');
    });

    test('every command the manifest promises is really registered', async () => {
        const found = vscode.extensions.all.find(
            (e) => e.id.toLowerCase() === ID.toLowerCase());
        await found.activate();

        const promised = (found.packageJSON.contributes.commands || [])
            .map((c) => c.command);
        const registered = new Set(await vscode.commands.getCommands(true));
        const missing = promised.filter((c) => !registered.has(c));

        assert.deepEqual(missing, [],
            'the palette offers these, and pressing them would fail: ' + missing.join(', '));
        assert.ok(promised.length >= 5, 'expected the full command set, saw ' + promised.length);
    });

    test('the activation event is one that actually fires', () => {
        const found = vscode.extensions.all.find(
            (e) => e.id.toLowerCase() === ID.toLowerCase());
        const events = found.packageJSON.activationEvents || [];
        assert.ok(events.length > 0, 'nothing would ever activate it');
        // onStartupFinished is the one this ships with. A manifest that lost it
        // would still pass every other test here, because they activate it by
        // hand - and then nothing would start it for a real user.
        assert.ok(
            events.includes('onStartupFinished') || events.includes('*'),
            'no unconditional activation event: ' + events.join(', '),
        );
    });

    test('it reports the version it was built as, not "unknown"', () => {
        const found = vscode.extensions.all.find(
            (e) => e.id.toLowerCase() === ID.toLowerCase());
        assert.match(found.packageJSON.version, /^\d+\.\d+\.\d+$/);
    });

    test('a contributed command can be invoked without throwing', async () => {
        const found = vscode.extensions.all.find(
            (e) => e.id.toLowerCase() === ID.toLowerCase());
        await found.activate();
        // switchMode opens a picker and returns; it touches no file and needs
        // no backend, which makes it the one safe command to actually press.
        await vscode.commands.executeCommand('smaran.switchMode');
    });
});
