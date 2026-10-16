# Autocut: every account and key

For setting Autocut up on **your own accounts** (your Gmail, your company). This lists every account to
create, every key you'll get, and exactly where each one goes. No real values are written here, and they
never should be: keys go only into Railway variables, `app/eas.json` (public keys only) or your own password
manager.

Setting up payments too? The step-by-step for Apple, RevenueCat and Whop is in [PAYMENTS.md](PAYMENTS.md);
this file lists their keys so you have everything in one place.

---

## 1. Accounts to create

| # | Account | What it's for | Cost |
|---|---|---|---|
| 1 | **GitHub** | Holds the code; Railway deploys from it | Free |
| 2 | **Supabase** ([supabase.com](https://supabase.com)) | Sign-in, and the shared database (cuts, job list, edit counts, consent) | Free to start; Pro $25/mo |
| 3 | **Cloudflare** ([dash.cloudflare.com](https://dash.cloudflare.com)) | R2: stores every video | ~$0.015/GB a month, free downloads |
| 4 | **Deepgram** ([console.deepgram.com](https://console.deepgram.com)) | Speech to text | Pay per minute; $200 free credit to start |
| 5 | **Railway** ([railway.com](https://railway.com)) | Runs the server (API + workers) | Hobby $5/mo + usage; Pro $20/mo + usage for scale |
| 6 | **Expo** ([expo.dev](https://expo.dev)) | Builds the iPhone app, sends instant fixes | Free tier works; paid for more builds |
| 7 | **Apple Developer** ([developer.apple.com](https://developer.apple.com)) | App Store, in-app purchase | $99/year |
| 8 | **RevenueCat** ([revenuecat.com](https://www.revenuecat.com)) | Apple in-app purchase | Free until $2.5k/mo revenue |
| 9 | **Whop** ([whop.com](https://whop.com)) | Web checkout (US) | A % of each sale |
| 10 | Google Cloud (optional) | Only for "Sign in with Google" | Free |

Order: GitHub → Supabase → Cloudflare → Deepgram → Railway → Expo → Apple → RevenueCat → Whop.

---

## 2. Every key: where to get it, where it goes

**Secret** = never in the app, chat or repo; only in Railway. **Public** = safe to put in `app/eas.json`.

### Supabase
| Key | Where to get it | Goes in | Secret? |
|---|---|---|---|
| Project URL | Project Settings → API (or Data API) → Project URL (`https://xxxx.supabase.co`) | Railway `SUPABASE_URL` (all 3 services) **and** `app/eas.json` `EXPO_PUBLIC_SUPABASE_URL` | Public |
| Publishable key | Project Settings → API Keys → **Publishable** (`sb_publishable_…`) | `app/eas.json` `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public |
| Secret key | Project Settings → API Keys → **Secret** (`sb_secret_…`) | Railway `SUPABASE_SECRET_KEY` (all 3 services) | **Secret** |
| Database connection string | **Connect** (top) → **Direct** → Method: **Session pooler** → copy, put your database password in place of `[YOUR-PASSWORD]` (letters and numbers only) | Railway `DATABASE_URL` (all 3 services) | **Secret** |

Supabase also needs (once):
- **SQL Editor** → run `supabase/migrations/20261016_shared_state.sql` → "Success. No rows returned"
  → Table Editor shows `cuts`, `tasks`, `usage`, `consents`.
- **Authentication → URL Configuration → Redirect URLs**: add `autocut://**` and `exp://**`.
- Recommended: **Project Settings → JWT Keys** → use the asymmetric signing keys, so the server checks
  sign-ins itself instead of asking Supabase on every request.

### Cloudflare R2
| Key | Where to get it | Goes in | Secret? |
|---|---|---|---|
| Bucket name | R2 → **Create bucket** → name it `autocut-videos`, location Automatic, keep it **private** | Railway `R2_BUCKET` (all 3) | Public |
| Account ID | R2 page, or the part between `https://` and `.r2.cloudflarestorage.com` in the endpoint (32 characters) | Railway `R2_ACCOUNT_ID` (all 3) | Not secret |
| Access Key ID | R2 → **Manage API tokens** → Create → *Object Read & Write*, only bucket `autocut-videos`, TTL Forever → "Access Key ID" | Railway `R2_ACCESS_KEY_ID` (all 3) | **Secret** |
| Secret Access Key | Same screen, shown **once** → "Secret Access Key" | Railway `R2_SECRET_ACCESS_KEY` (all 3) | **Secret** |

(The "Token value" starting `cfat_` on that screen isn't used.)

### Deepgram
| Key | Where to get it | Goes in | Secret? |
|---|---|---|---|
| API key | Console → **API Keys** → Create (Member, never expires), shown once | Railway `DEEPGRAM_API_KEY` (autocut + worker-cut) | **Secret** |

### Railway
| Key | Where to get it | Goes in | Secret? |
|---|---|---|---|
| Project token | Project → **Settings → Tokens** → Create (environment production) | Railway `RAILWAY_API_TOKEN` (autocut only) | **Secret** |
| Service IDs of the two workers | Click the worker → the browser address shows `…/service/<id>?…` | Railway `SCALE_POOLS` (autocut only) | Not secret |
| The API's public address | autocut service → Settings → Networking → **Generate Domain** (`https://….up.railway.app`) | `app/eas.json` `EXPO_PUBLIC_API_URL`, and the webhook URLs in RevenueCat and Whop | Public |

### Expo
No keys to copy. Log in on the build machine (`npx eas-cli@latest login`) and run `eas init` (section 4).

### Apple, RevenueCat, Whop (payments; steps in PAYMENTS.md)
| Key | Where to get it | Goes in | Secret? |
|---|---|---|---|
| RevenueCat public App Store key | RevenueCat → Project settings → API keys (`appl_…`) | `app/eas.json` `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | Public |
| RevenueCat webhook password | Make one up (long random string); also typed into RevenueCat → Integrations → Webhooks → Authorization header | Railway `REVENUECAT_WEBHOOK_AUTH` (autocut) | **Secret** |
| Whop API key | Whop → Developer → API keys (`checkout_configuration:create`) | Railway `WHOP_API_KEY` (autocut) | **Secret** |
| Whop webhook secret | Whop → Developer → Webhooks → Create, shown once (`ws_…`) | Railway `WHOP_WEBHOOK_SECRET` (autocut) | **Secret** |
| Whop plan IDs | Each plan's settings / checkout link (`plan_…`) | Railway `WHOP_PLANS` (autocut), format in PAYMENTS.md | Not secret |
| App Store Connect / In-App Purchase keys | App Store Connect → Users and Access → Integrations | Uploaded into **RevenueCat** only | **Secret** |

---

## 3. Railway: the three services and their variables

One Railway project, environment **production**, three services, all deployed from the GitHub repo
(**+ Create → GitHub Repo**). Paste each block into the service's **Variables → Raw Editor** and fill in the values.

### `autocut` (the API: give it a public domain)
```
ROLE=api
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DATABASE_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=autocut-videos
DEEPGRAM_API_KEY=
LEGAL_OPERATOR=
LEGAL_EMAIL=
LEGAL_COUNTRY=
RAILWAY_API_TOKEN=
SCALE_POOLS=cut=<worker-cut service id>:16:1:3,render=<worker-render service id>:4:1:3
```
Payments (add when following PAYMENTS.md):
```
WHOP_API_KEY=
WHOP_WEBHOOK_SECRET=
WHOP_PLANS=
REVENUECAT_WEBHOOK_AUTH=
PAYMENTS_REQUIRED=0
```

### `worker-cut` (no public domain)
```
ROLE=worker
WORKER_KINDS=cut
CONCURRENCY=16
DEEPGRAM_MAX=8
DEEPGRAM_MIP_OPT_OUT=1
WHISPER_FALLBACK=0
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DATABASE_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=autocut-videos
DEEPGRAM_API_KEY=
```

### `worker-render` (no public domain; 8 vCPU on Hobby, 12+ on Pro)
```
ROLE=worker
WORKER_KINDS=render,preview
CONCURRENCY=4
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DATABASE_URL=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=autocut-videos
```
`CONCURRENCY` on worker-render = half its vCPUs (4 on 8 vCPU, 6 on 12).

**Common paste mistakes** (both happened during the first setup): a value must be only the value. No
variable name inside it (`R2_ACCOUNT_ID=R2_ACCOUNT_ID=…`), nothing after the connection string's `/postgres`,
no quotes or spaces.

**Check it worked:** open `https://<your api domain>/health`. You want:
```
"role": "api", "storageOk": true, "deepgramOk": true,
"scaler": { "pools": { "cut": {…}, "render": {…} } }
```
If `storageOk` is false, the message says why (usually a wrong R2 value). `"scaler": {"off": "missing …"}`
names the missing setting.

---

## 4. The app: what to change for your accounts

Only two files in the code point at the current accounts.

**`app/eas.json`**: in each of `development`, `preview` and `production` → `env`:
```json
"EXPO_PUBLIC_SUPABASE_URL": "https://<your project>.supabase.co",
"EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_…",
"EXPO_PUBLIC_API_URL": "https://<your api domain>.up.railway.app"
```
Optional there: `EXPO_PUBLIC_SUPPORT_EMAIL` (shows "Help & contact" in Settings). Payments add
`EXPO_PUBLIC_PAYMENTS` and `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (see PAYMENTS.md).

**`app/app.json`**: it's linked to the current Expo project. To move it to yours:
1. Delete these three entries: `"owner"`, `"extra" → "eas" → "projectId"`, and `"updates" → "url"`.
2. Then, in the `app` folder:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   ```
   (Pick a team/organisation account in `init` if others will build too: personal accounts can't add members.)
3. **Bundle ID**: it's `com.rishavvashisht.autocut` (`ios.bundleIdentifier` and `android.package`). If your
   Apple account uses its own, e.g. `com.yourcompany.autocut`, change both, and use the same in Supabase →
   Authentication → Providers → Apple (if you turn on Sign in with Apple) and in RevenueCat.

**For local development**, copy `app/.env.example` to `app/.env.local` with the same three
`EXPO_PUBLIC_…` values.

---

## 5. Two things to decide, and the legal checklist

### Deepgram: pay more so it doesn't train on users' audio?

Deepgram has two prices. The cheaper one lets Deepgram use the audio you send to train its own speech
models (its "Model Improvement Program"). Opting out costs more per minute (Deepgram doesn't publish the
difference; it shows on the bill).

Autocut is set to **opt out**: `DEEPGRAM_MIP_OPT_OUT=1` (also the default when unset), because the privacy
policy promises users: *"We ask Deepgram not to use your audio to train its own models."*

- **Keep it (recommended):** nothing to do.
- **Take the cheaper rate:** set `DEEPGRAM_MIP_OPT_OUT=0` on worker-cut **and** remove that sentence from
  `legal/privacy.html` (section "Who processes your data for us"). Both together, or the policy is untrue.

### Legal checklist (before App Store review)

The privacy policy and terms are already written for how Autocut works (videos kept until the account is
deleted, used to improve the app and its AI with consent, the outside companies named, data moving if the
company is sold, Whop payments, cancelling and refunds). They're served by the API at `/privacy` and
`/terms`; the text is in `legal/privacy.html` and `legal/terms.html`. Still to do:

1. **Your details** on those pages (they show `[operator name]`, `[contact email]` and `[country]` until set).
   Railway → **autocut** → **Variables**, add these three. They appear **publicly** on the privacy policy and terms.

   - **`LEGAL_OPERATOR`**: who publishes the app. The full legal name of the person, or the company's
     registered name if there is one. It must match the seller name on the App Store listing.
     ```
     LEGAL_OPERATOR=Your Full Name
     ```
     or
     ```
     LEGAL_OPERATOR=Your Company LLC
     ```
   - **`LEGAL_EMAIL`**: where people send privacy requests (asking for their data, or to delete it). Use an
     address someone checks. A dedicated one (`privacy@yourdomain.com`, or a separate Gmail) is better than a
     personal email, since it's public.
     ```
     LEGAL_EMAIL=privacy@yourdomain.com
     ```
   - **`LEGAL_COUNTRY`**: the country whose laws apply: where the publisher (or their company) is based or
     registered. Used for "governed by the laws of…" in the terms.
     ```
     LEGAL_COUNTRY=United States
     ```

   Save; Railway redeploys. Then open `https://<your api domain>/privacy` and `/terms` and check the three
   show in place of the placeholders. Apple rejects the app with placeholders. The lawyer can confirm the
   best operator and country, especially if a company is being formed before launch.
2. **A lawyer approves the final wording.** Points for them: the licence to use videos for AI, what happens
   to model improvements after an account is deleted, deleting consent records with the account, Whop
   refunds, and which law applies.
3. **The lawyer decides whether agreeing to AI use is required or optional.** Today it's optional: off by default,
   turned on in Settings. To make it required: `app/src/lib/consent.ts` →
   `AI_CONSENT_REQUIRED = true`, then a new build. The server records each person's choice in the `consents`
   table; **only use videos from accounts with `ai = true` for AI work.**
4. **Changing the terms later:** bump `TERMS_VERSION` in both `src/legal.js` and `app/src/lib/consent.ts`;
   everyone is asked to agree again in the app.
5. **App Store privacy labels**: fill them in App Store Connect from the table in HANDOVER.md §7.
6. **The other creator's video.** The intro video (`app/assets/intro/`) and all 20 App Store screenshots
   (`design/App Store/`) show another creator (his face, an "@STEE.UGC" watermark, brand logos). Get his
   written permission, or replace them with your own take before release.

---

## 6. Done? Quick end-to-end check

1. `/health` looks like section 3's check.
2. In the app (TestFlight, or Expo Go pointed at your server): create an account (tick the terms box) →
   record or import a short take → Send → it cuts → opens in the editor → Export saves to Photos.
3. In Cloudflare R2 → `autocut-videos` → a `users/<id>/` folder now holds the take, preview and export.
4. In Supabase → Table Editor → `cuts` has a row; `consents` has your agreement.
5. Settings → Delete account → the R2 folder and rows disappear.

The whole system is described in [HANDOVER.md](HANDOVER.md); every server setting with comments is in
[.env.example](.env.example).
