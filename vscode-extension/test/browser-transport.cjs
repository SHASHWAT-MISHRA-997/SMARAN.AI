const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Inject only the transport in the compiled module. No real browser or
// external page is needed to reproduce an abandoned CDP request.
function session() {
    const filename = require.resolve('../out/agent/browser');
    const mod = { exports: {} };
    const source = fs.readFileSync(filename, 'utf8') + '\nexports.transport = {send, listen, locate, setSocket(value) { socket = value; }};';
    vm.runInNewContext(source, {
        module:mod, exports:mod.exports, require:createRequire(filename), process,
        setTimeout, clearTimeout, console, Buffer, URL,
    }, {filename});
    return mod.exports;
}

test('closing the browser rejects pending commands instead of hanging forever', async () => {
    const browser = session();
    browser.transport.setSocket({send() {}, close() {}});
    const pending = browser.transport.send('Runtime.evaluate');
    const rejected = assert.rejects(pending, /browser was closed/);
    await browser.close();
    await rejected;
});

test('send failure rejects immediately and clears its deadline', async () => {
    const browser = session();
    browser.transport.setSocket({send(data, callback) {callback(new Error('connection lost'));}});
    await assert.rejects(browser.transport.send('Runtime.evaluate'), /connection lost/);
});

test('browser lookup preserves dollar signs and whitespace regex in page code', async () => {
    const browser = session();
    let expression;
    browser.transport.setSocket({send(data) {
        const request = JSON.parse(data);
        expression = request.params.expression;
        browser.transport.listen({id:request.id,result:{result:{value:{ok:true}}}});
    }});
    const text = 'Shashwat $& $$';
    await browser.transport.locate(text);
    assert(expression.includes(`const wanted = ${JSON.stringify(text)};`));
    assert(expression.includes('/\\s+/g'));
});
