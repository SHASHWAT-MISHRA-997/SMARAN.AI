/**
 * SMARAN.AI Pro billing endpoints, one function with four routes:
 *
 *   GET  /api/billing/config     is billing on, the public key, the price
 *   POST /api/billing/subscribe  create a Razorpay subscription for checkout
 *   POST /api/billing/verify     check the payment signature, issue a licence key
 *   POST /api/billing/license    is this licence key's subscription paid up?
 *
 * While BILLING_ENABLED is not "true", subscribe and verify refuse and the
 * site keeps showing Pro as free for the launch period.
 */
import {
  config as billingConfig, json, corsHeaders, originAllowed, rateLimited, readJson, razorpay,
  paymentSignatureValid, issueLicense, readLicense, PAID_STATES, SUB_ID, PAY_ID,
  PRICE_PAISE, CURRENCY,
} from './lib.mjs';

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  const cfg = billingConfig();

  try {
    if (route === 'config' && req.method === 'GET') {
      return json(req, 200, {
        enabled: cfg.enabled,
        keyId: cfg.enabled ? cfg.keyId : null,
        amount: PRICE_PAISE,
        currency: CURRENCY,
      });
    }

    if (req.method !== 'POST') return json(req, 405, { error: 'method not allowed' });

    if (route === 'subscribe') {
      if (!originAllowed(req)) return json(req, 403, { error: 'forbidden' });
      if (rateLimited(req, 5)) return json(req, 429, { error: 'too many attempts, try again in a minute' });
      if (!cfg.enabled) return json(req, 503, { error: 'Pro is free during the launch period' });
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json(req, 400, { error: 'enter a valid email address' });
      const sub = await razorpay('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: process.env.RAZORPAY_PLAN_ID,
          total_count: 120,            // monthly for up to ten years, cancellable any time
          quantity: 1,
          customer_notify: 1,
          notes: { product: 'SMARAN.AI Pro', email },
        }),
      });
      return json(req, 200, { subscriptionId: sub.id, keyId: cfg.keyId });
    }

    if (route === 'verify') {
      if (!originAllowed(req)) return json(req, 403, { error: 'forbidden' });
      if (rateLimited(req, 10)) return json(req, 429, { error: 'too many attempts' });
      if (!cfg.enabled) return json(req, 503, { error: 'billing is not open' });
      const b = await readJson(req);
      const paymentId = String(b.razorpay_payment_id || '');
      const subscriptionId = String(b.razorpay_subscription_id || '');
      const signature = String(b.razorpay_signature || '');
      if (!PAY_ID.test(paymentId) || !SUB_ID.test(subscriptionId) || !/^[a-f0-9]{64}$/.test(signature)) {
        return json(req, 400, { error: 'invalid payment details' });
      }
      if (!paymentSignatureValid(paymentId, subscriptionId, signature)) {
        return json(req, 400, { error: 'payment could not be verified' });
      }
      // The signature proves Razorpay sent it; the API confirms it is ours and paid.
      const sub = await razorpay(`/subscriptions/${subscriptionId}`);
      if (sub.plan_id !== process.env.RAZORPAY_PLAN_ID || !PAID_STATES.has(sub.status)) {
        return json(req, 402, { error: 'payment is not complete yet' });
      }
      return json(req, 200, { license: issueLicense(subscriptionId), status: sub.status, currentEnd: sub.current_end || null });
    }

    if (route === 'license') {
      if (!originAllowed(req, { allowMissing: true })) return json(req, 403, { error: 'forbidden' });
      if (rateLimited(req, 30)) return json(req, 429, { error: 'too many checks' });
      if (!cfg.ready) return json(req, 200, { active: false, reason: 'billing not configured' });
      const b = await readJson(req);
      const lic = readLicense(b.key);
      if (!lic) return json(req, 200, { active: false, reason: 'invalid key' });
      const sub = await razorpay(`/subscriptions/${lic.s}`);
      const active = sub.plan_id === process.env.RAZORPAY_PLAN_ID && PAID_STATES.has(sub.status);
      return json(req, 200, { active, status: sub.status, currentEnd: sub.current_end || null });
    }

    return json(req, 404, { error: 'not found' });
  } catch (err) {
    // Never echo Razorpay's error body: it can name internal ids.
    const status = err && err.status === 404 ? 404 : err instanceof SyntaxError || /too large|object/.test(String(err && err.message)) ? 400 : 502;
    return json(req, status, { error: status === 502 ? 'payment service unavailable, try again' : 'bad request' });
  }
};

export const config = { path: '/api/billing/*' };
