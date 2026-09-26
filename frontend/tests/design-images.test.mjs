import test from 'node:test';
import assert from 'node:assert/strict';
import { withImageFallback } from '../src/utils/designImages.js';

test('a page with pictures gets the missing-picture fallback before </body>, once', () => {
  const page = '<html><body><img src="wedding1.jpg" alt="Wedding"></body></html>';
  const out = withImageFallback(page);
  assert.ok(out.indexOf('data-smaran-images') < out.indexOf('</body>'));
  assert.equal(withImageFallback(out), out);
});

test('a page without pictures gets only the layout safety net', () => {
  const page = '<html><head><title>x</title></head><body><h1>Hi</h1></body></html>';
  const out = withImageFallback(page);
  assert.ok(out.indexOf('data-smaran-safety') < out.indexOf('<title>'));
  assert.ok(!out.includes('data-smaran-images'));
  assert.equal(withImageFallback(out), out);
  assert.equal(withImageFallback(''), '');
});
