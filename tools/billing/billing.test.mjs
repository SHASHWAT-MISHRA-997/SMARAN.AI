// Tests for the Pro billing function (website/netlify/functions/billing).
// Run: node tools/billing/billing.test.mjs
//
// Every secret here is random and generated for this run only; no real
// Razorpay key is used and no request reaches Razorpay.
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = crypto.randomBytes(16).toString('hex');
process.env.RAZORPAY_PLAN_ID = 'plan_TEST12345';
process.env.LICENSE_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.BILLING_ENABLED;

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../../website/netlify/functions/billing');
const lib = await import(pathToFileURL(path.join(dir, 'lib.mjs')));
const { default: handler } = await import(pathToFileURL(path.join(dir, 'billing.mjs')));

// Any call to Razorpay in these tests is a bug: fail loudly instead.
globalThis.fetch = async () => { throw new Error('unexpected network call'); };

let failed = 0;
const ok = (cond, name) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) failed++; };

const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
  .update('pay_ABCDEFGH12|sub_ABCDEFGH12').digest('hex');
ok(lib.paymentSignatureValid('pay_ABCDEFGH12', 'sub_ABCDEFGH12', sig), 'genuine signature accepted');
ok(!lib.paymentSignatureValid('pay_ABCDEFGH12', 'sub_OTHERSUB12', sig), 'signature for another subscription rejected');

const key = lib.issueLicense('sub_ABCDEFGH12');
ok(lib.readLicense(key)?.s === 'sub_ABCDEFGH12', 'licence key round-trips');
const [prefix, , mac] = key.split('.');
const forged = Buffer.from(JSON.stringify({ v: 1, s: 'sub_FORGED1234', i: 1 })).toString('base64url');
ok(lib.readLicense(`${prefix}.${forged}.${mac}`) === null, 'edited licence key rejected');
ok(lib.readLicense('garbage') === null, 'garbage licence key rejected');

const call = (route, method = 'GET', body, origin = 'https://smaran-ai.netlify.app') =>
  handler(new Request('https://smaran-ai.netlify.app/api/billing/' + route, {
    method,
    headers: origin ? { origin, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

let r = await call('config');
let j = await r.json();
ok(r.status === 200 && j.enabled === false && j.keyId === null && j.amount === 70000, 'off by default, no key id exposed');
r = await call('subscribe', 'POST', { email: 'a@b.co' });
ok(r.status === 503, 'subscribe refused while billing is off');

process.env.BILLING_ENABLED = 'true';
r = await call('subscribe', 'POST', { email: 'a@b.co' }, 'https://evil.example');
ok(r.status === 403, 'subscribe from a foreign origin refused');
r = await call('subscribe', 'POST', { email: 'a@b.co' }, null);
ok(r.status === 403, 'subscribe with no origin refused');
r = await call('subscribe', 'POST', { email: 'not-an-email' });
ok(r.status === 400, 'bad email refused');
r = await call('verify', 'POST', {
  razorpay_payment_id: 'pay_ABCDEFGH12', razorpay_subscription_id: 'sub_ABCDEFGH12', razorpay_signature: '0'.repeat(64),
});
ok(r.status === 400, 'wrong signature refused before any Razorpay call');
r = await call('verify', 'POST', { razorpay_payment_id: 'x', razorpay_subscription_id: 'y', razorpay_signature: 'z' });
ok(r.status === 400, 'malformed ids refused');
r = await call('license', 'POST', { key: 'SMARAN-PRO.x.y' }, null);
j = await r.json();
ok(r.status === 200 && j.active === false, 'invalid licence reported inactive (app calls without Origin)');
r = await handler(new Request('https://smaran-ai.netlify.app/api/billing/license', {
  method: 'POST', headers: { origin: 'https://smaran-ai.netlify.app' }, body: 'x'.repeat(10000),
}));
ok(r.status === 400, 'oversized body refused');
r = await call('config');
j = await r.json();
ok(j.enabled === true && j.keyId === 'rzp_test_x', 'config gives only the public key id when on');
ok(!JSON.stringify(j).includes(process.env.RAZORPAY_KEY_SECRET), 'key secret never in a response');

process.env.LICENSE_SECRET = 'short';
r = await call('config');
j = await r.json();
ok(j.enabled === false, 'a weak licence secret keeps billing off');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
