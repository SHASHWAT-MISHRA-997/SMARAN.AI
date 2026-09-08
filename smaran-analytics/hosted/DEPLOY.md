# Hosted analytics deployment

Run from this directory against the explicitly selected analytics Netlify site.
Do not deploy from the repository root, which may be linked to another site.

1. Keep the existing randomly generated dashboard and ingest keys in local,
   ignored `keys.json`. Never copy this file into `public/` or a deployment stage.
2. Run `node prepare-key-hashes.mjs` and `node --test test/*.test.mjs`.
   The generated ignored `key-hashes.json` contains SHA-256 verifiers only.
3. Stage `public/`, `netlify/`, `netlify.toml`, the package files, dependencies,
   and `key-hashes.json` in a fresh directory. Exclude old `.netlify` build caches
   and raw credential files. Build the functions and scan the completed bundles
   for raw keys before uploading.
4. Deploy a draft to the analytics site ID
   `82006ee5-5c72-4dd4-b976-8418fec5675a`. Check authenticated summary/web reads,
   unauthorized requests, invalid date ranges and method rejection. Use an
   invalid JSON ingest request with the correct key to test authentication
   without writing any analytics records. A hash must not work as a password.
5. Publish the verified deployment only with production authorization.

Clients continue sending their existing keys. The server hashes the supplied
value before comparing it with its verifier. Existing server environment keys
remain supported, as do `ANALYTICS_DASHBOARD_KEY_SHA256` and
`ANALYTICS_INGEST_KEY_SHA256`. Missing or malformed configuration fails closed.
These are high-entropy API keys, not human passwords; password authentication
would require a password-specific hashing design.

`--context` requires `--build` in the current Netlify CLI. For a prepared static
deployment with `--no-build`, omit `--context`; plain `deploy` creates a draft.
