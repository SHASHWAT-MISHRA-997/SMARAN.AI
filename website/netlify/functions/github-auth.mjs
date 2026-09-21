/**
 * "Continue with GitHub", without asking anyone to type a code.
 *
 * Google is one tap because Google supports PKCE for native apps: the app can
 * finish the sign-in itself, holding no secret. GitHub OAuth Apps do not. The
 * token exchange requires a client secret, and a secret shipped inside an APK
 * is not a secret, so the app used GitHub's Device Flow instead - show an
 * eight-character code, send the person to github.com/login/device, have them
 * type it in. It works, and it is two screens and a transcription for
 * something Google does in one tap.
 *
 * This function is the secret-holder that makes the one tap possible. It runs
 * on the site, where an environment variable really is private, and it is the
 * only place GITHUB_CLIENT_SECRET exists.
 *
 * The part worth reading carefully is how the result gets back to the app.
 *
 * The app opens a browser; the browser must hand the answer back. On Android
 * that is a custom scheme, ai.smaran.app://auth-callback, and any app on the
 * phone may claim that scheme. So the answer is never sent in the clear.
 * Before opening the browser the app invents a random verifier, keeps it, and
 * sends only its SHA-256. The identity comes back sealed - AES-256-GCM, bound
 * to that hash - and is opened by a second call that must present the verifier
 * itself. An app that intercepts the redirect gets a sealed blob it cannot
 * open. This is PKCE, done here because GitHub will not do it there.
 *
 * Two further deliberate choices:
 *
 * - The GitHub access token never leaves this function. It is used here to
 *   read the profile and the verified email, and then it is gone. The app
 *   receives an identity, not a credential, so nothing it stores can be
 *   replayed against GitHub.
 * - The sealing key is derived from the client secret rather than configured
 *   separately, so setting this up is one environment variable and not two.
 *   Different derivation info per purpose keeps the two uses apart.
 */

import crypto from 'node:crypto';

const GITHUB_CLIENT_ID = 'Ov23livgXVI30gGhq3wQ';
const SCOPE = 'read:user user:email';

/* A sign-in that has been sitting around is not a sign-in in progress. Long
   enough for a slow phone and a considered "Authorize", short enough that a
   stolen redirect is worthless by the time it is found. */
const STATE_TTL_MS = 10 * 60 * 1000;
const SEALED_TTL_MS = 5 * 60 * 1000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/**
 * Where the answer may be delivered.
 *
 * Anything reachable from here is somewhere a signed-in identity can be sent,
 * so this is an allowlist and not a filter. The packaged app's own scheme, and
 * loopback for a desktop build - RFC 8252 leaves the port to the app, which
 * picks a free one at runtime, so the port is not pinned. Loopback cannot be
 * reached from another machine, which is what makes that safe.
 */
function redirectIsAllowed(target) {
  let url;
  try { url = new URL(target); } catch { return false; }
  if (url.protocol === 'ai.smaran.app:') return true;
  if (url.protocol !== 'http:') return false;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

/**
 * The configured secret, without whatever came with it off the clipboard.
 *
 * A trailing newline survives a copy-paste into a dashboard field and is
 * invisible there, and GitHub answers a secret with one on the end exactly as
 * it answers a wrong secret: incorrect_client_credentials. Trimming costs
 * nothing - no GitHub secret has leading or trailing whitespace in it - and
 * removes a failure that reads as "you typed it wrong" when you did not.
 */
function clientSecret() {
  return (process.env.GITHUB_CLIENT_SECRET || '').trim();
}

function sealingKey(purpose) {
  const secret = clientSecret();
  if (!secret) throw new Error('unconfigured');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'smaran-github-oauth', purpose, 32));
}

function seal(purpose, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(purpose), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ ...payload, iat: Date.now() }), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function unseal(purpose, blob, maxAgeMs) {
  let payload;
  try {
    const raw = Buffer.from(String(blob || ''), 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    payload = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'),
    );
  } catch {
    // A wrong key, a tampered blob and a truncated one all land here, and all
    // three mean the same thing to a caller: this is not ours.
    return null;
  }
  if (!Number.isFinite(payload.iat) || Date.now() - payload.iat > maxAgeMs) return null;
  return payload;
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');

/** Step one: send the person to GitHub, carrying the app's challenge along. */
function start(url) {
  const challenge = url.searchParams.get('challenge') || '';
  const redirect = url.searchParams.get('redirect') || '';

  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return json(400, { error: 'A sign-in challenge is required.' });
  if (!redirectIsAllowed(redirect)) return json(400, { error: 'That is not a destination this sign-in can return to.' });
  if (!clientSecret()) return json(503, { error: 'GitHub sign-in is not configured on this site.' });

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', GITHUB_CLIENT_ID);
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/github/callback`);
  authorize.searchParams.set('state', seal('state-v1', { challenge, redirect }));
  return Response.redirect(authorize.toString(), 302);
}

/**
 * Ask GitHub who this is. The access token stays inside this scope.
 *
 * Every way this can fail used to come back as one word, "unverified", which
 * the app showed as "GitHub did not return a verified email address" - so a
 * client secret with a typo in it, a callback URL that did not match, and an
 * account genuinely holding no confirmed address all read as the same thing,
 * and the one that was true said nothing about where to look. They are told
 * apart now. The reason is a short tag, chosen rather than passed through, so
 * nothing GitHub says ends up quoted into a URL.
 */
async function identify(code, origin) {
  const exchanged = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: clientSecret(),
      code,
      redirect_uri: `${origin}/api/github/callback`,
    }),
  }).then((res) => res.json()).catch(() => null);

  const token = exchanged && exchanged.access_token;
  if (!token) {
    // Logged because this is the failure an operator has to fix, and the
    // browser is the wrong place to explain a misconfigured secret. GitHub's
    // own error code only: never the code, never the secret.
    console.error('github token exchange refused:', (exchanged && exchanged.error) || 'no answer');
    return { failed: 'exchange' };
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const [profile, emails] = await Promise.all([
    fetch('https://api.github.com/user', { headers }).then((r) => r.json()).catch(() => null),
    fetch('https://api.github.com/user/emails', { headers }).then((r) => r.json()).catch(() => null),
  ]);

  if (!profile || !profile.id) {
    console.error('github profile unreadable');
    return { failed: 'profile' };
  }
  if (!Array.isArray(emails)) {
    // Almost always the user:email scope missing from the granted token.
    console.error('github email list unreadable');
    return { failed: 'scope' };
  }
  // An unverified address is not an identity. GitHub lets an account hold
  // addresses it has never proved, and those must not become a SMARAN login.
  const verified = emails.filter((entry) => entry && entry.verified && entry.email);
  const email = (verified.find((entry) => entry.primary) || verified[0] || {}).email;
  if (!email) return { failed: 'unverified' };

  return {
    identity: {
      id: `github_${profile.id}`,
      email,
      username: profile.name || profile.login,
      avatar: profile.avatar_url,
      provider: 'github',
    },
  };
}

/**
 * A page whose only job is to step back into the app that opened it.
 *
 * A fragment for the packaged app, because a fragment is not sent to any
 * server and the phone's browser is the only thing that needs to read it. A
 * query for a desktop build, because there the reader *is* a server - a
 * listener on loopback - and a fragment would never reach it. That is the same
 * split Google's own loopback flow makes.
 */
function handBack(redirect, answer) {
  const target = redirect.startsWith('http')
    ? `${redirect}${redirect.includes('?') ? '&' : '?'}${answer}`
    : `${redirect}#${answer}`;
  const escaped = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Returning to SMARAN.AI</title>`
    // A custom scheme in a Location header is honoured inconsistently across
    // Android browsers, so the step back is made from the page instead, with
    // a link for the case where it is refused without a tap.
    + `<style>body{background:#09090d;color:#f3f4f6;font:500 16px/1.6 system-ui,sans-serif;`
    + `display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}`
    + `a{color:#ef4444}</style></head><body><div><p>Signed in. Returning to SMARAN.AI…</p>`
    + `<p><a href="${escaped}">Open SMARAN.AI</a></p></div>`
    + `<script>location.replace(${JSON.stringify(target)})</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** Step two: GitHub sends the person back here with a code. */
async function callback(url) {
  const state = unseal('state-v1', url.searchParams.get('state'), STATE_TTL_MS);
  // Without a readable state there is nowhere to send anybody, so this is the
  // one failure that has to be answered on this page rather than in the app.
  if (!state || !redirectIsAllowed(state.redirect)) {
    return json(400, { error: 'This sign-in link has expired. Start again from SMARAN.AI.' });
  }

  if (url.searchParams.get('error') || !url.searchParams.get('code')) {
    return handBack(state.redirect, 'error=denied');
  }

  const { identity, failed } = await identify(url.searchParams.get('code'), url.origin);
  if (!identity) return handBack(state.redirect, `error=${failed}`);

  return handBack(state.redirect, `result=${seal('identity-v1', { identity, challenge: state.challenge })}`);
}

/** Step three: the app proves the sealed identity was meant for it. */
async function exchange(request) {
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const sealed = unseal('identity-v1', body.sealed, SEALED_TTL_MS);
  // One answer for every way this can fail, so it says nothing about which
  // part was wrong.
  const refuse = () => json(401, { error: 'This sign-in could not be confirmed. Please start again.' });
  if (!sealed || !sealed.identity) return refuse();

  const offered = sha256(body.verifier || '');
  const expected = String(sealed.challenge || '');
  if (offered.length !== expected.length) return refuse();
  if (!crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(expected))) return refuse();

  return json(200, { user: sealed.identity });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const step = url.pathname.split('/').filter(Boolean).pop();

  try {
    // Asked before the browser is opened. Without it the app would have to
    // discover a missing secret by sending someone to a dead end, when it
    // could have used the device-code flow that needs no secret at all.
    if (step === 'config' && request.method === 'GET') {
      return json(200, { configured: Boolean(clientSecret()) });
    }
    if (step === 'start' && request.method === 'GET') return start(url);
    if (step === 'callback' && request.method === 'GET') return await callback(url);
    if (step === 'exchange' && request.method === 'POST') return await exchange(request);
  } catch (error) {
    if (error && error.message === 'unconfigured') {
      return json(503, { error: 'GitHub sign-in is not configured on this site.' });
    }
    throw error;
  }
  return json(404, { error: 'Unknown sign-in step.' });
}

export const config = { path: '/api/github/:step' };
