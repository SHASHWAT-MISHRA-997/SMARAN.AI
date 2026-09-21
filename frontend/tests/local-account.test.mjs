/** Local password and security-question recovery, without recovery codes. */

import assert from 'node:assert/strict';
import test from 'node:test';

// Only localStorage needs standing in for: node already provides the same
// Web Crypto, btoa and atob the browser does, and its `crypto` global is
// read-only, so assigning to it throws rather than helping.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const account = await import('../src/utils/localAccount.js');

const EMAIL = 'owner@example.com';
const PASSWORD = 'a decent passphrase';
const OTHER = 'a different passphrase';
const QUESTIONS = [
  { question: 'First school?', answer: "St. Mary's" },
  { question: 'First pet?', answer: 'Rex' },
];

function fresh() {
  store.clear();
}

const register = (extra = {}) => account.registerLocally({
  email: EMAIL, password: PASSWORD, displayName: 'Owner', securityQuestions: QUESTIONS, ...extra });

async function failure(run) {
  try {
    await run();
    return null;
  } catch (err) {
    return err.message;
  }
}

test('registering creates an account without recovery codes', async () => {
  fresh();
  const result = await register();
  assert.equal(result.user.email, EMAIL);
  assert.equal(result.provider, 'password');
  assert.equal(result.recovery_code, undefined);
  assert.ok(account.hasLocalAccount());
});

test('nothing readable is written to storage', async () => {
  fresh();
  await register({ securityQuestions: QUESTIONS });
  const raw = store.get('smaran_local_account');
  assert.ok(!raw.includes(PASSWORD), 'the password is in storage');
  assert.ok(!raw.toLowerCase().includes('rex'), 'a security answer is in storage');
  // The questions themselves are not secret and stay readable, which is what
  // lets the recovery screen ask them.
  assert.ok(raw.includes('First pet?'));
});

test('the right password signs in and the wrong one does not', async () => {
  fresh();
  await register();
  assert.equal((await account.signInLocally({ email: EMAIL, password: PASSWORD })).user.email, EMAIL);
  assert.match(await failure(() => account.signInLocally({ email: EMAIL, password: OTHER })),
    /do not match/);
});

test('a wrong address is answered exactly like a wrong password', async () => {
  fresh();
  await register();
  const wrongPassword = await failure(() => account.signInLocally({ email: EMAIL, password: OTHER }));
  const wrongEmail = await failure(() => account.signInLocally({ email: 'nobody@example.com', password: PASSWORD }));
  assert.equal(wrongPassword, wrongEmail);
});

test('the address is matched regardless of case and spacing', async () => {
  fresh();
  await register();
  const result = await account.signInLocally({ email: '  Owner@Example.COM ', password: PASSWORD });
  assert.equal(result.user.email, EMAIL);
});

test('repeated wrong passwords start costing time', async () => {
  fresh();
  await register();
  for (let i = 0; i < 4; i += 1) {
    await failure(() => account.signInLocally({ email: EMAIL, password: OTHER }));
  }
  const message = await failure(() => account.signInLocally({ email: EMAIL, password: OTHER }));
  assert.match(message, /Too many attempts/);
  // And the delay applies to the right password too, or it only inconveniences
  // the person who is not guessing.
  assert.match(await failure(() => account.signInLocally({ email: EMAIL, password: PASSWORD })),
    /Too many attempts/);
});

test('signing in successfully clears the count', async () => {
  fresh();
  await register();
  await failure(() => account.signInLocally({ email: EMAIL, password: OTHER }));
  await account.signInLocally({ email: EMAIL, password: PASSWORD });
  assert.equal(JSON.parse(store.get('smaran_local_account')).failedAttempts, 0);
});



test('security questions can set a new password', async () => {
  fresh();
  await register({ securityQuestions: QUESTIONS });
  assert.deepEqual(account.localSecurityQuestions(EMAIL), ['First school?', 'First pet?']);
  const reset = await account.recoverLocallyWithAnswers({
    email: EMAIL, answers: QUESTIONS, newPassword: OTHER });
  assert.equal(reset.recovery_code, undefined);
  assert.equal((await account.signInLocally({ email: EMAIL, password: OTHER })).user.email, EMAIL);
});

test('an answer is matched the way a person would write it', async () => {
  fresh();
  await register({ securityQuestions: QUESTIONS });
  // "St. Mary's" set at registration, "st marys" typed a year later.
  const reset = await account.recoverLocallyWithAnswers({
    email: EMAIL,
    answers: [{ question: 'First school?', answer: 'st marys' },
              { question: 'First pet?', answer: '  REX ' }],
    newPassword: OTHER,
  });
  assert.equal(reset.recovery_code, undefined);
});

test('every question must be answered, not just one', async () => {
  fresh();
  await register({ securityQuestions: QUESTIONS });
  const onlyOne = await failure(() => account.recoverLocallyWithAnswers({
    email: EMAIL, answers: [QUESTIONS[0]], newPassword: OTHER }));
  assert.match(onlyOne, /do not match/);

  store.clear();
  await register({ securityQuestions: QUESTIONS });
  const oneWrong = await failure(() => account.recoverLocallyWithAnswers({
    email: EMAIL,
    answers: [QUESTIONS[0], { question: 'First pet?', answer: 'Fluffy' }],
    newPassword: OTHER,
  }));
  assert.match(oneWrong, /do not match/);
  // The password is unchanged, so a failed attempt is not a way to wear an
  // account down.
  assert.equal((await account.signInLocally({ email: EMAIL, password: PASSWORD })).user.email, EMAIL);
});

test('an account with no questions cannot be reset by answering none', async () => {
  fresh();
  await register();
  const legacy = JSON.parse(store.get('smaran_local_account'));
  legacy.questions = [];
  store.set('smaran_local_account', JSON.stringify(legacy));
  assert.match(await failure(() => account.recoverLocallyWithAnswers({
    email: EMAIL, answers: [], newPassword: OTHER })), /do not match/);
});

test('answering wrongly gets slower too', async () => {
  fresh();
  await register({ securityQuestions: QUESTIONS });
  for (let i = 0; i < 4; i += 1) {
    await failure(() => account.recoverLocallyWithAnswers({
      email: EMAIL,
      answers: [QUESTIONS[0], { question: 'First pet?', answer: 'wrong' }],
      newPassword: OTHER,
    }));
  }
  assert.match(await failure(() => account.recoverLocallyWithAnswers({
    email: EMAIL, answers: QUESTIONS, newPassword: OTHER })), /Too many attempts/);
});

test('one question is refused at registration, since two is the floor', async () => {
  fresh();
  assert.match(await failure(() => register({ securityQuestions: [QUESTIONS[0]] })),
    /at least 2 security questions/);
});

test('an answer too short to be worth anything is refused', async () => {
  fresh();
  assert.match(await failure(() => register({
    securityQuestions: [QUESTIONS[0], { question: 'First pet?', answer: '!' }] })),
    /at least 2 letters/);
});



test('registration cannot overwrite an existing device account', async () => {
  fresh();
  await register();
  assert.match(await failure(() => register({email: 'other@example.com'})), /already exists/);
  assert.equal((await account.signInLocally({email: EMAIL, password: PASSWORD})).user.email, EMAIL);
});
test('question lookup matches the entered account', async () => {
  fresh();
  await register();
  assert.deepEqual(account.localSecurityQuestions('other@example.com'), []);
  assert.equal(account.localSecurityQuestions(' OWNER@example.com ').length, 2);
});
test('duplicate questions are refused', async () => {
  fresh();
  assert.match(await failure(() => register({securityQuestions: [QUESTIONS[0], QUESTIONS[0]]})), /different question/);
});
