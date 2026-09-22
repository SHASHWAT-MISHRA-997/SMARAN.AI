/**
 * Give the real extension a real task in a real VS Code, with a real model.
 *
 *     SMARAN_AUDIT_PROVIDER=ollama|lmstudio|gemini|groq|openrouter \
 *     SMARAN_AUDIT_MODEL=<model id> \
 *     [SMARAN_AUDIT_KEY_FILE=<path to cloud_keys.json>] \
 *     node test/host/run-scenario.js <empty audit folder>
 *
 * scenario.cjs does the work: it opens the agent panel, asks for a small
 * statistics library with tests and a README, lets the agent run exactly one
 * command (its own test runner), and then checks the library itself rather
 * than trusting the model's tests. The result is written to
 * <audit>/extension-live-scenario.json with every step the agent took.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const audit = path.resolve(process.argv[2] || '');
    if (!process.argv[2]) throw new Error('Pass an empty folder for the run.');
    const workspace = path.join(audit, 'extension-sample-app');
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true });

    await runTests({
        extensionDevelopmentPath: path.resolve(__dirname, '../../'),
        extensionTestsPath: path.resolve(__dirname, './scenario.cjs'),
        extensionTestsEnv: { ...process.env, SMARAN_AUDIT_ROOT: audit },
        launchArgs: [
            workspace,
            '--disable-workspace-trust',
            '--disable-extensions',
            // A profile of its own, so nothing from the developer's editor -
            // settings, keys, other extensions - takes part in the run.
            '--user-data-dir', path.join(audit, 'user-data'),
        ],
    });
}

main().catch((err) => {
    console.error('Scenario failed:', err && err.message);
    process.exit(1);
});
