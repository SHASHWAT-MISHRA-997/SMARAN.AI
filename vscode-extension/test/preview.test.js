/**
 * The live preview beside the editor (src/agent/preview.ts), without VS Code:
 * the opener is replaced by a function that records the URL, and the page is
 * fetched the way the Simple Browser would fetch it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { resolveRequest, showPreview, setPreviewOpener, stopPreview } = require('../out/agent/preview.js');

const get = (url) => new Promise((resolve, reject) => {
    http.get(url, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
});

const workspace = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smaran-preview-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<html><body><h1>Hello</h1></body></html>');
    fs.writeFileSync(path.join(root, '.env'), 'API_KEY=secret');
    fs.mkdirSync(path.join(root, 'site'));
    fs.writeFileSync(path.join(root, 'site', 'about.html'), '<p>About</p>');
    return root;
};

test('only files inside the workspace, and never a dot-name', () => {
    const root = workspace();
    assert.equal(resolveRequest(root, '/index.html'), path.join(root, 'index.html'));
    assert.equal(resolveRequest(root, '/'), path.join(root, 'index.html'));
    assert.equal(resolveRequest(root, '/.env'), undefined);
    assert.equal(resolveRequest(root, '/.git/config'), undefined);
    assert.equal(resolveRequest(root, '/../../etc/passwd'), undefined);
    assert.equal(resolveRequest(root, '/%2e%2e/%2e%2e/secret'), undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a page opens beside the editor, is served with the reload script, and reloads on change', async () => {
    const root = workspace();
    const opened = [];
    setPreviewOpener((url) => { opened.push(url); });
    try {
        const said = await showPreview(root, 'index.html');
        assert.equal(opened.length, 1);
        assert.match(opened[0], /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
        assert.match(said, /Live preview is open beside the editor/);

        const page = await get(opened[0]);
        assert.equal(page.status, 200);
        assert.match(page.body, /<h1>Hello<\/h1>/);
        assert.match(page.body, /EventSource\("\/__smaran_reload"\)/);

        const secret = await get(opened[0].replace('index.html', '.env'));
        assert.equal(secret.status, 403);
        assert.doesNotMatch(secret.body, /secret/);

        // A change to any file reaches the page as a reload event.
        const reload = await new Promise((resolve, reject) => {
            const req = http.get(opened[0].replace('index.html', '__smaran_reload'), (res) => {
                res.on('data', (chunk) => {
                    if (String(chunk).includes('data: reload')) { req.destroy(); resolve(true); }
                });
            });
            req.on('error', () => {});
            setTimeout(() => fs.writeFileSync(path.join(root, 'index.html'), '<h1>Changed</h1>'), 300);
            setTimeout(() => reject(new Error('no reload event within 5s')), 5000);
        });
        assert.equal(reload, true);
        assert.match((await get(opened[0])).body, /Changed/);
    } finally {
        setPreviewOpener(undefined);
        await stopPreview();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a dev server address is shown as it is; anything else is refused', async () => {
    const opened = [];
    setPreviewOpener((url) => { opened.push(url); });
    try {
        await showPreview(os.tmpdir(), 'localhost:5173');
        assert.deepEqual(opened, ['http://localhost:5173']);
        const refused = await showPreview(os.tmpdir(), 'https://example.com');
        assert.match(refused, /local dev server only/);
        const missing = await showPreview(os.tmpdir(), 'no-such-page.html');
        assert.match(missing, /nothing to preview yet/);
        assert.equal(opened.length, 1);
    } finally {
        setPreviewOpener(undefined);
        await stopPreview();
    }
});
