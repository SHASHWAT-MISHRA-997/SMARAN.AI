/**
 * Shared pieces of SMARAN.AI Pro billing (Razorpay subscriptions).
 *
 * Nothing is stored on our side. A licence key is a signed pointer to a
 * Razorpay subscription, and whether it is active is asked of Razorpay at the
 * moment of checking - so a cancelled or failed subscription stops unlocking
 * Pro by itself, with no webhook or database to fall out of step.
 *
 * Configuration, all in Netlify environment variables, never in this repo:
 *   RAZORPAY_KEY_ID      public key id (rzp_live_... or rzp_test_...)
 *   RAZORPAY_KEY_SECRET  secret key - server side only, never sent anywhere
 *   RAZORPAY_PLAN_ID     the ₹700 / month plan created in the Razorpay dashboard
 *   LICENSE_SECRET       random string (32+ chars) that signs licence keys
 *   BILLING_ENABLED      "true" to take payments; anything else keeps Pro free
 */
import crypto from 'node:crypto';

export const PRICE_PAISE = 70000;          // ₹700.00
export const CURRENCY = 'INR';
const API = 'https://api.razorpay.com/v1';

const ALLOWED_ORIGINS = new Set([
  'https://smaran-ai.netlify.app',
  'http://localhost:4173',
]);

export function config() {
  const env = process.env;
  const keyId = env.RAZORPAY_KEY_ID || '';
  const ready = Boolean(keyId && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_PLAN_ID
    && (env.LICENSE_SECRET || '').length >= 32);
  return { keyId, ready, enabled: ready && env.BILLING_ENABLED === 'true' };
}

export function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

export function json(req, status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

// Browsers always send Origin on a cross-site POST; a page elsewhere must not
// be able to start subscriptions in a visitor's name. The desktop app calls
// the licence check without an Origin, which is allowed there only.
export function originAllowed(req, { allowMissing = false } = {}) {
  const origin = req.headers.get('origin');
  if (!origin) return allowMissing;
  return ALLOWED_ORIGINS.has(origin);
}

// A small per-instance limiter: enough to stop one client hammering the
// Razorpay API through us, without pretending to be a global quota.
const hits = new Map();
export function rateLimited(req, max = 10, windowMs = 60_000) {
  const ip = req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > max;
}

export async function readJson(req, limit = 4096) {
  const text = await req.text();
  if (text.length > limit) throw new Error('too large');
  const body = JSON.parse(text || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
  return body;
}

export async function razorpay(path, init = {}) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('razorpay ' + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest();
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Razorpay's documented check for subscription payments:
// HMAC_SHA256(payment_id + "|" + subscription_id, key_secret) == signature.
export function paymentSignatureValid(paymentId, subscriptionId, signature) {
  const expected = hmac(process.env.RAZORPAY_KEY_SECRET, `${paymentId}|${subscriptionId}`).toString('hex');
  return safeEqual(expected, signature);
}

export const SUB_ID = /^sub_[A-Za-z0-9]{8,32}$/;
export const PAY_ID = /^pay_[A-Za-z0-9]{8,32}$/;

export function issueLicense(subscriptionId) {
  const payload = b64u(JSON.stringify({ v: 1, s: subscriptionId, i: Math.floor(Date.now() / 1000) }));
  const sig = b64u(hmac(process.env.LICENSE_SECRET, payload));
  return `SMARAN-PRO.${payload}.${sig}`;
}

export function readLicense(key) {
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'SMARAN-PRO' || parts[1].length > 400) return null;
  const expected = b64u(hmac(process.env.LICENSE_SECRET, parts[1]));
  if (!safeEqual(expected, parts[2])) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return data && data.v === 1 && SUB_ID.test(data.s) ? data : null;
  } catch {
    return null;
  }
}

// Razorpay subscription states that mean "paid up": authenticated is the
// moment after the first successful payment, active is every month after.
export const PAID_STATES = new Set(['authenticated', 'active']);
