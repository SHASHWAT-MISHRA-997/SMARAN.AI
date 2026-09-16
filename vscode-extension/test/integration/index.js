/** Mocha entry point, loaded by VS Code inside the extension host. */

const path = require('node:path');
const Mocha = require('mocha');

function run() {
    const mocha = new Mocha({ ui: 'tdd', color: false, timeout: 30000 });
    mocha.addFile(path.resolve(__dirname, 'suite.js'));

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} test(s) failed inside VS Code`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { run };
