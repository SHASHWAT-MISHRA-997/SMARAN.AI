/**
 * Download a real VS Code, install this extension into it, and run the suite
 * in its extension host.
 *
 * The extension had never been run inside an editor. Its other tests stub the
 * vscode module and run under plain node, which cannot see whether it loads,
 * activates, or registers the commands its manifest advertises.
 *
 *     npm run test:vscode
 *
 * The first run downloads a VS Code build into .vscode-test/ and is slow;
 * later runs reuse it.
 */

const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './index.js');

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                // A scratch folder, so the run does not depend on whatever the
                // developer happened to have open.
                path.resolve(__dirname, 'fixture'),
                '--disable-workspace-trust',
                // Other installed extensions are not this extension's problem,
                // and on this machine several of them start their own
                // processes.
                '--disable-extensions',
            ],
        });
    } catch (err) {
        console.error('Failed inside VS Code:', err && err.message);
        process.exit(1);
    }
}

main();
