/**
 * The site's GitHub sign-in, exercised end to end with GitHub itself stubbed.
 *
 * This function is the only place a GitHub client secret exists, and it is
 * what lets "Continue with GitHub" be one tap rather than an eight-character
 * code typed from one app into another. That makes its failure modes worth
 * pinning down, because the interesting ones are all silent: a sealed identity
 * that opens without the verifier, a redirect to somewhere that was never
 * allowed, a blob that is still accepted an hour later.
 *
 * It lives with the frontend tests because this is where the JavaScript test
 * runner is. Nothing here reaches the network: fetch is replaced for the two
 * calls the function makes to GitHub.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

process.env.GITHUB_CLIENT_SECRET = 'test-secret-not-a-real-one';

const { default: handler } = await import(
  '../../website/netlify/functions/github-auth.mjs'
);

const ORIGIN = 'https://smaran-ai.netlify.app';
const APP = 'ai.smaran.app://auth-callback';
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');

const get = (path) => handler(new Request(`${ORIGIN}${path}`));
const post = (path, body) => handler(new Request(`${ORIGIN}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

/** GitHub, as far as this function can tell. */
function stubGitHub({ email = 'dev@example.com', verified = true, primary = true } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'gho_stub' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.endsWith('/user')) {
      return new Response(JSON.stringify({ id: 4242, login: 'octo', name: 'Octo Cat', avatar_url: 'https://x/y.png' }),
        { headers: { 'Content-Type': 'application/json' } });
    }
    if (target.endsWith('/user/emails')) {
      return new Response(JSON.stringify([{ email, verified, primary }]),
        { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch to ${target}`);
  };
  return () => { globalThis.fetch = real; };
}

/** Walk start -> callback and return what the app would receive. */
async function signIn(verifier, options) {
  const started = await get(`/api/github/start?challenge=${sha256(verifier)}&redirect=${encodeURIComponent(APP)}`);
  const state = new URL(started.headers.get('location')).searchParams.get('state');

  const restore = stubGitHub(options);
  try {
    const page = await (await get(`/api/github/callback?code=stub-code&state=${encodeURIComponent(state)}`)).text();
    const fragment = /#(?:result=([^"'\\]+)|error=([a-z]+))/.exec(page);
    return { sealed: fragment && fragment[1], error: fragment && fragment[2] };
  } finally {
    restore();
  }
}

test('the whole round trip hands back a verified identity', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed } = await signIn(verifier);
  assert.ok(sealed, 'no sealed identity came back');

  const res = await post('/api/github/exchange', { sealed, verifier });
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.deepEqual(user, {
    id: 'github_4242',
    email: 'dev@example.com',
    username: 'Octo Cat',
    avatar: 'https://x/y.png',
    provider: 'github',
  });
});

test('an app that steals the redirect cannot open what it catches', async () => {
  // The whole reason the identity is sealed rather than sent in the clear:
  // any app on an Android phone may claim ai.smaran.app://, and the one that
  // does still has to produce the verifier it never saw.
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed } = await signIn(verifier);

  const thief = await post('/api/github/exchange', { sealed, verifier: crypto.randomBytes(32).toString('base64url') });
  assert.equal(thief.status, 401);
  // And the real app is still able to finish.
  assert.equal((await post('/api/github/exchange', { sealed, verifier })).status, 200);
});

test('a sealed identity cannot be opened with no verifier at all', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed } = await signIn(verifier);
  assert.equal((await post('/api/github/exchange', { sealed })).status, 401);
  assert.equal((await post('/api/github/exchange', { sealed, verifier: '' })).status, 401);
});

test('a tampered seal is refused rather than half-read', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed } = await signIn(verifier);
  const flipped = `${sealed.slice(0, -2)}${sealed.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
  assert.equal((await post('/api/github/exchange', { sealed: flipped, verifier })).status, 401);
});

test('every refusal says the same thing', async () => {
  const one = await post('/api/github/exchange', { sealed: 'nonsense', verifier: 'x' });
  const two = await post('/api/github/exchange', {});
  assert.equal(one.status, two.status);
  assert.deepEqual(await one.json(), await two.json());
});

test('an unverified GitHub email never becomes a SMARAN login', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed, error } = await signIn(verifier, { verified: false });
  assert.ok(!sealed, 'an unverified address was sealed as an identity');
  assert.equal(error, 'unverified');
});

test('the identity leaves without the GitHub token that produced it', async () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const { sealed } = await signIn(verifier);
  const body = await (await post('/api/github/exchange', { sealed, verifier })).text();
  assert.ok(!body.includes('gho_stub'), 'the access token was handed to the app');
});

test('sign-in may only return to the app or to loopback', async () => {
  const challenge = sha256('anything');
  for (const target of [
    'https://example.com/steal',
    'http://192.168.1.5:3003/auth',
    'javascript:alert(1)',
    'ai.smaran.evil://auth-callback',
    '',
  ]) {
    const res = await get(`/api/github/start?challenge=${challenge}&redirect=${encodeURIComponent(target)}`);
    assert.equal(res.status, 400, `${target || '(empty)'} was accepted as a destination`);
  }

  for (const target of [APP, 'http://127.0.0.1:53127/auth/github', 'http://localhost:3003/auth/github']) {
    const res = await get(`/api/github/start?challenge=${challenge}&redirect=${encodeURIComponent(target)}`);
    assert.equal(res.status, 302, `${target} should be allowed`);
    assert.match(res.headers.get('location'), /^https:\/\/github\.com\/login\/oauth\/authorize/);
  }
});

test('a challenge that is not one is refused before GitHub is involved', async () => {
  for (const challenge of ['', 'short', 'not base64url!!', 'A'.repeat(200)]) {
    const res = await get(`/api/github/start?challenge=${encodeURIComponent(challenge)}&redirect=${encodeURIComponent(APP)}`);
    assert.equal(res.status, 400);
  }
});

test('the state GitHub carries reveals nothing on its own', async () => {
  const started = await get(`/api/github/start?challenge=${sha256('v')}&redirect=${encodeURIComponent(APP)}`);
  const state = new URL(started.headers.get('location')).searchParams.get('state');
  const plain = Buffer.from(state, 'base64url').toString('latin1');
  assert.ok(!plain.includes('smaran'), 'the redirect is readable inside the state');
  assert.ok(!plain.includes('challenge'), 'the challenge is readable inside the state');
  // Deliberately not "contains no brace": ciphertext is random bytes, and one
  // of them is a brace often enough to fail a test for no reason.
  assert.throws(() => JSON.parse(plain), 'the state is not encrypted at all');
});

test('a state from a different deployment is not accepted', async () => {
  const started = await get(`/api/github/start?challenge=${sha256('v')}&redirect=${encodeURIComponent(APP)}`);
  const state = new URL(started.headers.get('location')).searchParams.get('state');

  process.env.GITHUB_CLIENT_SECRET = 'a-completely-different-secret';
  try {
    const restore = stubGitHub();
    const res = await get(`/api/github/callback?code=stub&state=${encodeURIComponent(state)}`);
    restore();
    assert.equal(res.status, 400);
  } finally {
    process.env.GITHUB_CLIENT_SECRET = 'test-secret-not-a-real-one';
  }
});

test('with no secret configured the function says so instead of half-working', async () => {
  const secret = process.env.GITHUB_CLIENT_SECRET;
  delete process.env.GITHUB_CLIENT_SECRET;
  try {
    const res = await get(`/api/github/start?challenge=${sha256('v')}&redirect=${encodeURIComponent(APP)}`);
    assert.equal(res.status, 503);
  } finally {
    process.env.GITHUB_CLIENT_SECRET = secret;
  }
});
