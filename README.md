# Tantsiri Boutique Store

A mobile-first boutique storefront with a Cloudflare Worker API, email OTP admin access, GitHub private-repository JSON storage, and WhatsApp order handoff.

> **Production note:** This is a deployable MVP foundation, not a claim that a new deployment is automatically production-ready. Configure secrets, verify the GitHub App permissions, set your domain/origin, run the test and security checklist, and test real email/WhatsApp flows before accepting customers. GitHub file storage is not transactional and cannot guarantee race-free inventory reservation across simultaneous orders.

## Included
- Responsive storefront, product details, search, category filtering, sorting and local cart.
- Admin email OTP login and product create/edit UI.
- Worker-side validation, signed HttpOnly session, OTP expiry/attempt limit/resend cooldown.
- GitHub App integration for private JSON file storage.
- Server-side order creation and WhatsApp deep link.
- Basic dashboard metrics, order list API, audit log.
- Logo asset cropped from the supplied reference image.

## Architecture
- GitHub Pages serves the static Vite frontend.
- Cloudflare Workers serves `/api/*`.
- Cloudflare Workers KV stores short-lived OTP/session/rate-limit records only.
- A GitHub App installation token accesses the private storage repository.
- Business records remain in the private repository. The browser never receives the GitHub token.

## 1. Create repositories
Create:
1. `tantsiri-store` (public) — this project.
2. `tantsiri-private-storage` (private) — storage only.

In the private repository, create these files (or let the Worker create them on first write):
```json
// catalogue.json
{ "products": [], "collections": [], "settings": {} }
```
```json
// configuration/whatsapp.json
{ "contacts": [{ "id": "primary", "label": "Orders", "number": "91XXXXXXXXXX", "enabled": true, "primary": true }] }
```
```json
// orders/orders.json
{ "orders": [] }
```
```json
// activity-logs/activity.json
{ "entries": [] }
```

## 2. Configure a GitHub App
Create a GitHub App owned by the account/organization that owns the private repository.
- Repository permissions: **Contents: Read and write** only.
- Install it on `tantsiri-private-storage` only.
- Generate a private key.
- Record App ID and Installation ID.
- Do not put the private key in this repository or frontend environment.

For GitHub App private key, store the PEM including BEGIN/END lines as a Cloudflare Worker secret. The Worker supports escaped newlines.

## 3. Configure Cloudflare Worker
From `worker/`:
```bash
npm install
npx wrangler kv namespace create AUTH_KV
```
Copy the returned namespace ID into `worker/wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

Set non-secret variables in `wrangler.toml`:
- `ALLOWED_ORIGIN`: exact GitHub Pages origin, e.g. `https://YOUR-USERNAME.github.io` (include project path only in frontend URL; origin has no path).
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`.
- `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`.
- `ADMIN_EMAILS`: comma-separated allowed emails.
- `OWNER_EMAIL`: owner email; receives owner role.
- `RESEND_FROM`: verified sender, e.g. `Tantsiri <orders@yourdomain.com>`.

Set secrets:
```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEND_API_KEY
```
Use a randomly generated `SESSION_SECRET` of at least 32 bytes. Example generation: `openssl rand -base64 48`.

Deploy:
```bash
npx wrangler deploy
```
Copy the deployed `https://....workers.dev` URL.

## 4. Configure Resend
Create a Resend account, verify a sending domain, and create an API key. Add the API key only as `RESEND_API_KEY` Worker secret. Set `RESEND_FROM` to an address on the verified domain. Resend free-tier allowances and terms change; check the provider dashboard before launch.

## 5. Configure the frontend
At the repository root, create `.env.local`:
```env
VITE_API_BASE=https://YOUR-WORKER.workers.dev
```
For GitHub Pages, set repository Actions variable `VITE_API_BASE` to the Worker URL. Do not set secrets in `VITE_*` variables; Vite embeds them into public browser code.

The included workflow builds and deploys the site. Enable GitHub Pages → Build and deployment → GitHub Actions.

## 6. First admin sign-in
- Set `ADMIN_EMAILS` to the exact administrator email addresses.
- Set `OWNER_EMAIL` to the owner address.
- Deploy the Worker again after changing variables.
- Visit `https://YOUR-USERNAME.github.io/tantsiri-store/#/admin`.
- Request OTP and verify the email code.

## 7. WhatsApp configuration
Edit `configuration/whatsapp.json` in the private repository before launch. Use international digits only, e.g. `919876543210`. Enable the intended contact and mark one as primary. Never publish customer records in the public repository.

## Local development
Terminal 1:
```bash
cd worker && npm install && npx wrangler dev
```
Terminal 2 (root):
```bash
npm install
# create .env.local with VITE_API_BASE=http://localhost:8787
npm run dev
```
For local Worker development, configure secrets with `wrangler secret put` and set the required variables in `wrangler.toml`.

## Tests and build
```bash
npm install
npm test
npm run build
```

## Storage model and important limitations
GitHub Contents API stores versioned files, not transactional rows. Updates use the current file SHA and GitHub rejects stale writes, but a read-modify-write operation is not an atomic compare-and-swap transaction. Concurrent updates can still race in edge cases. This design is intended for a small, low-volume boutique MVP only.
- The current order endpoint validates stock against the published catalogue but does **not** reserve/decrement inventory atomically. Treat orders as requests pending manual confirmation, not confirmed stock reservations.
- The Worker currently implements basic product CRUD and order read endpoints; collection, order-status, content, administrator, payment, image-upload, export, backup and full analytics screens remain follow-on implementation work.
- The KV namespace is used for ephemeral auth state, not as a business database.
- GitHub API limits and Cloudflare/Resend free-tier quotas can change. Monitor usage and set billing alerts.
- Git history retains prior versions, including deleted data. Define a retention policy and do not put highly sensitive payment credentials or identity documents in this repository.
- Back up the private repository independently and periodically. Test restoration before relying on backups.

## Pre-launch checklist
- [ ] GitHub App installed on the private storage repo only; Contents permission only.
- [ ] All Worker secrets configured; no secrets in Git history.
- [ ] Exact production origin configured; CORS verified.
- [ ] Resend sender domain verified; OTP delivery and expiry tested.
- [ ] Owner and secondary admin sign-in tested.
- [ ] WhatsApp numbers tested on Android/iOS.
- [ ] Product and order workflows tested with real devices.
- [ ] Privacy policy, terms, shipping/returns policy and contact details published.
- [ ] Rate limits, abuse protection, monitoring and backup/restore procedure reviewed.
- [ ] Inventory reservation and full admin operations completed before representing this as a fully featured production store.

## License
Private project. Add your preferred license and business policies before publishing.
