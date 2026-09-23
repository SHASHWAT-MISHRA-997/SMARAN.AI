# SMARAN.AI Pro billing (Razorpay)

Pro is ₹700 / month through Razorpay subscriptions. The code is live but
**off**: until `BILLING_ENABLED=true`, the site shows Pro as free for the
launch period and the server refuses to start a subscription.

## How it works

- `website/netlify/functions/billing/` serves four routes:
  - `GET /api/billing/config`: tells the page whether billing is on.
  - `POST /api/billing/subscribe`: creates a subscription.
  - `POST /api/billing/verify`: checks Razorpay's payment signature and issues a licence key.
  - `POST /api/billing/license`: tells the app whether a key's subscription is paid up.
- Nothing is stored on our side. A licence key is a signed pointer to a
  Razorpay subscription, and every check asks Razorpay live whether it is
  `active`. Cancelled or failed subscriptions stop unlocking Pro by themselves.
- `website/billing.js` switches the Pro card to ₹700 and opens Razorpay
  Checkout (UPI, cards, netbanking, wallets). Card and UPI details go to
  Razorpay only.
- Tests: `node tools/billing/billing.test.mjs`. They use throwaway secrets and
  make no network calls.

## Switching it on

1. **Razorpay account.** Sign up at razorpay.com and finish KYC (PAN, bank
   account, business details). Razorpay reviews the website. It needs:
   - Terms (`/terms.html`, section 08).
   - Cancellation & refund policy (`/refund.html`).
   - Privacy policy (`/#privacy`).
   - A contact email and phone number shown on the site. **Not on the site yet: add them before applying.**
2. **International cards.** Dashboard → Settings → Payment methods → request
   International payments, so buyers outside India can pay.
3. **Plan.** Dashboard → Subscriptions → Plans → Create plan: ₹700, monthly,
   named "SMARAN.AI Pro". Copy the `plan_...` id.
4. **Keys.** Dashboard → Account & Settings → API keys → generate live keys.
   Start with test mode keys (`rzp_test_...`) to try it end to end first.
5. **Licence secret.** Generate a random secret on your own machine, and never share it:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
6. **Netlify.** Site `smaran-ai` → Site configuration → Environment variables.
   Add each of these, scoped to Functions:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_PLAN_ID`
   - `LICENSE_SECRET`
   - `BILLING_ENABLED` = `true`
7. **Redeploy** the site. Functions read environment variables at deploy time.
8. Open the site. The Pro card shows ₹700 / month. Pay with a test card, then
   check that a licence key appears.

Changing `LICENSE_SECRET` later invalidates every issued licence key: keep it.

## Still needed before charging real customers

- **Licence check in the app.** A Settings → Pro field in the app that
  stores the key and calls `/api/billing/license`, plus gating of Pro features.
  Until that ships, a paid key unlocks nothing that isn't already free.
- A way to show a lost key again (for example by subscription id and email).
