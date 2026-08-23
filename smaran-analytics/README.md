# SMARAN.AI — Usage Analytics (developer only)

Private dashboard showing how the software is being used. **This folder is not
shipped to users** — keep it out of the installer and out of the APK.

## Run it

```bash
pip install fastapi uvicorn
python server.py
```

Then open <http://127.0.0.1:9000>.

On first run an ingest key is generated and written to `ingest-key.txt`. The
app must send that key with every event, otherwise anyone who finds the URL can
push made-up numbers into your dashboard.

## What you see

| Metric | Meaning |
|---|---|
| Total installations | Distinct devices that have ever reported |
| Active (24 h / 7 days) | Installations seen in that window |
| New | First-time installations inside the selected window |
| Launches | App opens |
| Sign-ups / Logins / Google sign-ins | Account events |
| Platforms | Windows, Android, and so on |
| App versions | Which builds are in the wild |

Plus a per-day chart, the installation list, and a live event feed.

## Hosting it later

Right now it listens on localhost, so it only sees events from this machine.
To collect from real users you need it reachable from the internet:

1. Deploy this folder to any host that runs Python (Railway, Render and
   Fly.io all have free tiers that suit this).
2. Set `ANALYTICS_INGEST_KEY` there to a secret of your choosing.
3. Build the app with `SMARAN_ANALYTICS_URL` pointing at the deployed address
   and `SMARAN_ANALYTICS_KEY` set to the same secret.

Nothing else changes.

## What is collected, and what is not

**Collected**

- a random installation id created on the device — not an account, not a
  person, and not derived from any hardware identifier
- platform and app version
- event names: install, launch, heartbeat, signup, login, google_signin,
  signout
- the time the event arrived

**Not collected**

Conversations, prompts, uploaded files or their names, model API keys, email
addresses, names, or anything typed into the app.

## Why it is drawn that line

Two reasons, and the second one matters more.

Collecting personal data without telling people is unlawful in most places the
software will run. India's **DPDP Act 2023** requires notice and consent and
carries financial penalties; the **GDPR** requires a lawful basis and applies
to any EU user. An app that quietly uploads user content would also be
rejected by the Play Store.

The app therefore shows a short notice about usage reporting and offers a
switch to turn it off. **That switch is honoured** — if you later remove it,
the numbers here stop being defensible, and the exposure lands on you as the
publisher rather than on the users.

Counting installations, launches and sign-ins is completely normal product
analytics and needs none of the sensitive material to be useful.
