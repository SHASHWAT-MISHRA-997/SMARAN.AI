/**
 * An account on a phone that has no backend behind it.
 *
 * The packaged Android app is often standalone: no paired computer, so no
 * Python server, so `API_BASE` is empty and every /api/auth call lands on the
 * static asset server and 404s. That is why registering on the phone did
 * nothing at all - there was nothing at the other end. Google worked because
 * its standalone path verifies the token with Google directly and keeps a
 * local profile; this does the same for an account made here.
 *
 * Be honest about what this protects against, because it is not the same as
 * the server-backed version:
 *
 *   It stops somebody who picks up an unlocked phone and opens the app. It
 *   does not stop somebody who can read the app's private storage, because
 *   the hash is there and can be attacked offline - which is why PBKDF2 runs
 *   at 310,000 iterations, making each guess expensive rather than free. What
 *   actually protects the data on a phone is Android's own sandbox and disk
 *   encryption, and neither of those is ours to claim credit for.
 *
 * What is stored is only ever a hash: of the password and of each security
 * answer, each with its own random salt. Nothing in localStorage can be read
 * back into a credential.
 *
 * There is no recovery code. The security questions are the way back in, and
 * they are required when the account is made rather than offered - an account
 * with no way in is not a feature, and "optional" is how that would happen.
 */

const STORE_KEY = 'smaran_local_account';

/* OWASP's floor for PBKDF2-HMAC-SHA256 at the time of writing. High enough to
   make offline guessing expensive, low enough that signing in on a mid-range
   phone is not a visible wait. */
const ITERATIONS = 310000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const MAX_ATTEMPTS_BEFORE_DELAY = 3;
const MAX_DELAY_SECONDS = 300;

export const LOCAL_PROVIDER = 'password';

const encoder = new TextEncoder();

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

/** Constant-time-ish comparison, so a wrong hash does not fail faster. */
function sameDigest(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(secret, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, KEY_BITS);
  return toBase64(bits);
}

async function hashSecret(secret) {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  return { salt, digest: await derive(secret, salt) };
}

const matches = async (secret, record) =>
  Boolean(record) && sameDigest(await derive(secret, record.salt), record.digest);

function read() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function write(account) {
  localStorage.setItem(STORE_KEY, JSON.stringify(account));
}

export const hasLocalAccount = () => Boolean(read()?.password);
export const localAccountEmail = () => read()?.email || '';

/** Answers are compared as people write them: see normalise_answer in Python. */
export const normaliseAnswer = (raw) =>
  String(raw || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

const normaliseEmail = (raw) => String(raw || '').trim().toLowerCase();

/** Seconds this account must wait, after too many wrong answers. */
function delayRemaining(account) {
  if (!account?.lockedUntil) return 0;
  return Math.max(0, Math.ceil((account.lockedUntil - Date.now()) / 1000));
}

function recordFailure(account) {
  const attempts = (account.failedAttempts || 0) + 1;
  account.failedAttempts = attempts;
  const over = attempts - MAX_ATTEMPTS_BEFORE_DELAY;
  if (over > 0) {
    account.lockedUntil = Date.now() + Math.min(MAX_DELAY_SECONDS, 2 ** Math.min(over, 8)) * 1000;
  }
  write(account);
}

function clearFailures(account) {
  account.failedAttempts = 0;
  account.lockedUntil = null;
  write(account);
}

class LocalAuthError extends Error {}

const refuse = (message, wait) => {
  throw new LocalAuthError(wait
    ? `Too many attempts. Try again in ${wait} seconds.`
    : message);
};

const WRONG_CREDENTIALS = 'That email and password do not match an account.';
const WRONG_ANSWERS = "Those answers do not match this account's security questions.";

/** The shape the gate expects, matching what the server returns. */
const session = (account) => ({
  user: { id: `local_${account.id}`, username: account.name || account.email, email: account.email },
  provider: LOCAL_PROVIDER,
});

export async function registerLocally({ email, password, displayName, securityQuestions = [] }) {
  const existing = read();
  const address = normaliseEmail(email);
  if (existing?.password) {
    throw new LocalAuthError('An account already exists on this device. Sign in or reset its password.');
  }
  if (password.length < 6) {
    throw new LocalAuthError('Password must be at least 6 characters long.');
  }
  // Required, not optional: with no recovery code these are the only way
  // back into an account on a device with no server behind it.
  if (securityQuestions.length < 2) {
    throw new LocalAuthError('Please set at least 2 security questions.');
  }

  if (securityQuestions.length > 5) throw new LocalAuthError('Please set no more than 5 security questions.');
  const seen = new Set();
  const questions = [];
  for (const entry of securityQuestions) {
    const question = String(entry.question || '').trim();
    if (question.length < 3 || question.length > 160) throw new LocalAuthError('Each question must contain 3 to 160 characters.');
    const key = normaliseAnswer(question);
    if (seen.has(key)) throw new LocalAuthError('Please choose a different question for each answer.');
    seen.add(key);
    const answer = normaliseAnswer(entry.answer);
    if (answer.length < 2) {
      throw new LocalAuthError('Each security answer needs at least 2 letters or digits.');
    }
    questions.push({ question: entry.question.trim(), answer: await hashSecret(answer) });
  }

  const account = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    email: address,
    name: (displayName || '').trim().slice(0, 80),
    password: await hashSecret(password),
    questions,
    createdAt: new Date().toISOString(),
    failedAttempts: 0,
    lockedUntil: null,
  };
  write(account);
  return session(account);
}

export async function signInLocally({ email, password }) {
  const account = read();
  const wait = delayRemaining(account);
  if (wait) refuse(WRONG_CREDENTIALS, wait);

  // The comparison runs even when the address is wrong, so the two failures
  // take the same time as each other.
  const ok = await matches(password, account?.password);
  if (!account?.password || normaliseEmail(email) !== account.email || !ok) {
    if (account) recordFailure(account);
    refuse(WRONG_CREDENTIALS);
  }
  clearFailures(account);
  return session(account);
}

/** The questions this device's account was asked, for the recovery screen. */
export const localSecurityQuestions = (email) => {
  const account = read();
  return account?.email === normaliseEmail(email)
    ? (account.questions || []).map((entry) => entry.question) : [];
};

async function resetPassword(account, newPassword) {
  if (newPassword.length < 6) {
    throw new LocalAuthError('Password must be at least 6 characters long.');
  }
  account.password = await hashSecret(newPassword);
  clearFailures(account);
}

export async function recoverLocallyWithAnswers({ email, answers, newPassword }) {
  const account = read();
  const wait = delayRemaining(account);
  if (wait) refuse(WRONG_ANSWERS, wait);

  const stored = account?.questions || [];
  const offered = new Map(answers.map((a) => [normaliseAnswer(a.question), a.answer]));

  // Every question has to be right, and every one is checked even after a
  // failure, so the time taken does not point at which answer was wrong.
  let ok = stored.length > 0 && offered.size === stored.length;
  for (const entry of stored) {
    const given = offered.get(normaliseAnswer(entry.question));
    if (!await matches(normaliseAnswer(given || ''), entry.answer)) ok = false;
  }
  if (!account || !stored.length || normaliseEmail(email) !== account.email || !ok) {
    if (account) recordFailure(account);
    refuse(WRONG_ANSWERS);
  }

  await resetPassword(account, newPassword);
  write(account);
  return session(account);
}
