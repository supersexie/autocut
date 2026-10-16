# Autocut: handover

Everything you need to get Autocut onto the App Store and running at scale. The app works and has
been tested end to end on iPhone (Expo Go) and on the iPad Simulator. The server is built to run as
many machines at once. What's left is creating the accounts below, entering their keys, store setup,
and a lawyer's review of the privacy policy and terms.

---

## 1. What Autocut is

An iPhone/iPad app for UGC creators. You record (or import) a raw take; Autocut cuts out the dead air,
filler words and flubbed retakes, captions every word, and opens it in an editor (trim, split, speed,
zoom keyframes, captions, text, music, photo/video overlays). Export saves the finished video to Photos.

| Part | Where | What it does |
|---|---|---|
| **App** | `app/` | Expo (SDK 57, React Native 0.86, Expo Router). iPhone and iPad, portrait. |
| **API** | `src/server.js`, `ROLE=api` | What the app talks to: sign-in checks, upload links, cut status, payments webhooks. Light; one or two are plenty. |
| **Workers** | `src/worker.js`, `ROLE=worker` | The heavy work: joining takes, transcribing, finding cuts, previews, exports. Run as many as you need. |
| **Job list and records** | Supabase Postgres (`DATABASE_URL`) | Cuts, the shared job list, monthly edit counts, consent records. Every API and worker shares it. |
| **Videos** | Cloudflare R2 | Every take, cut, preview and export, kept until the account is deleted. Phones upload and download straight to it. |
| **Speech to text** | Deepgram (Nova-3) | Words with timings, ums kept. Whisper on the worker is the backup. |
| **Accounts** | Supabase Auth | Email sign-in (Apple/Google ready, switched off, see §5). |
| **Payments** | Apple in-app purchase (via RevenueCat) + Whop (web, US only) | Both tell the server, which puts the plan on the account. |

Run with none of the settings in §5 (local development), everything runs in one process on your Mac:
a local database (PGlite) and a folder of videos instead of Supabase and R2.

**Ignore** `ios/` (an old Swift prototype, not used), `prototype/` and `samples/`. In `design/`, only
`design/Logo/` (the logo in every format) and `design/App Store/` (the store screenshots) matter.
The real iOS app is generated from `app/` by EAS. Don't commit an `app/ios` folder.

---

## 2. Rules before you start

- **Pushing to `main` redeploys the live server on Railway.** Don't push to `main` without checking
  with the owner first. Work on a branch.
- **Secrets live only in Railway's variables**: the Supabase secret key, `DATABASE_URL`, the R2 keys, the
  Deepgram key, the Whop key and webhook secret. Never in the app or the repo. (The Supabase *publishable*
  key and the RevenueCat *public* key in the app are meant to be public.) All the settings are listed in
  `.env.example`.
- Bundle ID is `com.rishavvashisht.autocut`. If you publish under a different ID, change it in
  `app/app.json` **and** add the new ID in Supabase → Authentication → Providers → Apple (if Apple sign-in is on).

---

## 3. Running it locally

```bash
# Server (one process: API + worker, local database and video folder; no accounts needed)
npm install && npm run server          # http://localhost:8787

# App (in Expo Go on a phone, or the iOS Simulator)
cd app && npm install
npx expo start                         # scan the QR with Expo Go; press Shift+I for an iPad Simulator

# Checks (all pass today)
npx tsc --noEmit && npx expo lint && npm test && npx expo-doctor     # app
cd .. && npm test                                                     # server (includes the job-list tests)
```

`app/.env.local` (not in git) points the app at a server and Supabase. Copy `app/.env.example`.
Leave `EXPO_PUBLIC_API_URL` unset to use the server on your Mac.

---

## 4. Building, and shipping fixes without review

```bash
cd app
npx eas-cli@latest login
npx eas-cli@latest init                 # once: creates the Expo project and puts its id in app.json
npx eas-cli@latest update:configure     # once: turns on instant updates (adds the update URL)
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

- `app/eas.json` holds the app's public settings per build profile (server URL, Supabase URL and
  publishable key; add the payment settings from §6 when ready). Build numbers go up on their own.
- Let EAS manage certificates. It also turns on the Sign in with Apple capability.
- Export compliance is answered in `app.json` (`usesNonExemptEncryption: false`).

### Instant bug fixes (EAS Update)

JavaScript fixes ship straight to phones, no App Store review:

```bash
npx eas-cli@latest update --channel production --message "Fix caption timing"
```

- Builds check for an update at launch, and again when the app comes back to the front
  (`app/src/lib/updates.ts`); a fix downloads quietly and is used from the next launch.
- `runtimeVersion` uses the **fingerprint** policy: an update only goes to builds whose native code it
  matches. Changing native code (a new native library, `app.json` plugins, `app/modules/`) needs a new
  store build; the fingerprint makes sure an update never reaches a build it would break.
- Apple allows this for fixes and small changes. New features that change what the app does still go
  through review.

### ⚠️ Check these on your first TestFlight build

They can't run in Expo Go, so they've never run on a real device:

1. **The editor's native player** (`app/modules/autocut-player`): open a cut and play through several cuts.
   If the build fails on `AutocutPlayer`, or playback is wrong, add
   `"expo": { "autolinking": { "exclude": ["autocut-player"] } }` to `app/package.json` and rebuild (the app
   then uses the tested fallback).
2. **Apple in-app purchase** (RevenueCat), once §6 is set up: buy with a Sandbox account, then Restore.
3. **Instant updates**: publish a tiny update to the build's channel and check it arrives on the next launch.

---

## 5. Accounts and settings to set up

Moving to your own accounts? **[ACCOUNTS.md](ACCOUNTS.md)** lists every account, every key, where to get it
and where it goes, including what to change in `app/app.json` and `app/eas.json`.

Railway → the project → each service → **Variables**. `.env.example` lists every setting.

### Required

1. **Shared database (Supabase).**
   - Supabase → SQL editor → run `supabase/migrations/20261016_shared_state.sql` (safe to run again).
   - Supabase → **Connect** → **Session pooler** → copy the connection string → `DATABASE_URL` on every service.
2. **Video storage (Cloudflare R2).**
   - Cloudflare → R2 → create a bucket (e.g. `autocut-videos`). Keep it **private** (no public access).
   - R2 → **Manage API tokens** → create a token with *Object Read & Write* on that bucket.
   - Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` on every service.
   - Bucket → Settings → **CORS**: not needed (the app isn't a browser), leave it empty.
   - Cost: about $0.015 per GB a month to store, nothing for downloads. Videos are kept until the account
     is deleted, so storage grows with users: 1,000 creators keeping 5 GB each ≈ $75/month.
3. **Deepgram.** Deepgram → API keys → create one → `DEEPGRAM_API_KEY` on the **worker** services.
   `DEEPGRAM_MIP_OPT_OUT=1` (the default) stops Deepgram training on users' audio, as the privacy policy
   says; Deepgram charges more for that than its standard rate. Turning it off needs the privacy policy changed.
4. **Railway services** (all from this repo and its `Dockerfile`):
   - **api**: `ROLE=api`, the public domain the app uses (the current one: autocut-production-88f1.up.railway.app).
   - **worker**: `ROLE=worker`, `CONCURRENCY=1`, at least 2 vCPU / 4 GB. Add **replicas** to cut more at once.
     No public domain needed.
   - Both: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, the `R2_*` settings.
   - The existing `/data` volume stays on **api** only: cuts made before this change are moved to R2 the
     first time someone opens them. Workers don't need a volume.
5. **Legal details** on the privacy policy and terms (they say `[operator name]` until set), on **api**:
   `LEGAL_OPERATOR`, `LEGAL_EMAIL`, `LEGAL_COUNTRY`. Check https://autocut-production-88f1.up.railway.app/privacy.
6. **A lawyer's review** of `legal/privacy.html` and `legal/terms.html` (see §7), and their decision on
   whether agreeing to AI use is required (`AI_CONSENT_REQUIRED` in `app/src/lib/consent.ts`).
7. **Payments.** §6.

### Optional

- **Support email**: add `"EXPO_PUBLIC_SUPPORT_EMAIL": "…"` to each profile's `env` in `app/eas.json`
  to show "Help & contact" in Settings.
- **Sign in with Apple / Google**: currently **off** in Supabase, so only email sign-in shows in store
  builds. Turn on **both or neither** (Apple requires Sign in with Apple whenever Google is offered).
  - Supabase → Authentication → Providers → **Apple**: enable, add `com.rishavvashisht.autocut` as a client ID.
  - **Google**: create an OAuth client in Google Cloud, enable the provider, and under URL Configuration →
    Redirect URLs add `autocut://**` and `exp://**`.

---

## 6. Payments

**The full step-by-step setup guide is [PAYMENTS.md](PAYMENTS.md)** (Apple, RevenueCat, Whop, switching on,
testing, troubleshooting). This section is the summary.

Two ways to pay, as Apple allows: **Apple's in-app purchase everywhere**, and **Whop on the web, only on
the US App Store**, offered next to Apple's, never instead of it. (Apple guideline 3.1.1: a subscription
app must offer in-app purchase; links to outside checkout are allowed on the US storefront only. Apple
may add a fee on those links after the Epic v. Apple case; check before relying on 0%.)

Both end the same way: the provider tells our server (a webhook), and the server writes the plan to the
account's `app_metadata.plans` (users can't edit `app_metadata`). The plan in force is the best one still
active (`src/billing.js`). The app waits for `GET /me` to show it.

**Everything is built and off by default.** Today the app is free and the plan picker just saves the
choice. Turn payments on with `EXPO_PUBLIC_PAYMENTS=1` (app, in `eas.json`) **and** `PAYMENTS_REQUIRED=1`
(server, on api) once the steps below are done.

### Apple (via RevenueCat)

1. App Store Connect → the app → **Subscriptions**: one group, six products (Starter, Pro, Ultimate × monthly,
   yearly) at the prices in `app/src/lib/plans.ts`. Include the plan and period in each product id, e.g.
   `autocut.pro.yearly`.
2. RevenueCat → new project → add the App Store app (with the App Store Connect API key it asks for).
   - **Entitlements** named `starter`, `pro`, `ultimate`, each with its two products.
   - **Offering** `default` with packages named `starter_monthly`, `starter_yearly`, `pro_monthly`, … `ultimate_yearly`.
   - **Integrations → Webhooks**: URL `https://<api domain>/webhooks/revenuecat`, Authorization header: a
     long random string → also set it as `REVENUECAT_WEBHOOK_AUTH` on api.
   - The public Apple API key (`appl_…`) → `EXPO_PUBLIC_REVENUECAT_IOS_KEY` in `eas.json`.
3. The app uses the Supabase user id as RevenueCat's user id, so purchases land on the right account.
   Restore purchases is on Your plan.

### Whop (web, US)

1. Whop → create the product with six plans (same prices). Note each plan's id (`plan_…`).
2. `WHOP_PLANS` on api, e.g. `starter-monthly=plan_a,starter-yearly=plan_b,pro-monthly=plan_c,pro-yearly=plan_d,ultimate-monthly=plan_e,ultimate-yearly=plan_f`.
3. Whop → Developer → **API key** with `checkout_configuration:create` → `WHOP_API_KEY`.
4. Whop → Developer → **Webhooks** (API version v1): URL `https://<api domain>/webhooks/whop`, events
   `membership.activated` and `membership.deactivated` (and `membership.updated`). Its `ws_…` secret →
   `WHOP_WEBHOOK_SECRET`.
5. The app asks the server for a checkout link carrying the user's id, opens it, and comes back on
   `autocut://plan`. Customers manage or cancel at whop.com (Your plan → Manage subscription).

Check Whop's webhook payload against `whopChange()` in `src/billing.js` on the first real purchase: Whop's
docs don't list every field, so it reads the user id from `data.metadata.user_id` and the plan from
`data.plan.id` / `data.plan_id`. The server logs `[billing] whop on …` when it works.

### What each plan gets (enforced in the app and on the server)

- Starter: 100 edits a month, batch edits (right away only), no Overlap audio.
- Pro: 300 edits, Overlap audio, Scheduled batch edits.
- Ultimate: unlimited edits, Overlap audio, Scheduled batch edits.
- App: `app/src/lib/plans.ts`, `usage.ts`. Server: `src/plans.js` (rules), edits counted per account per
  month in the database. Keep both copies of the rules in step. To try the limits locally:
  `DEV_PLAN=starter npm run server`.

---

## 7. Privacy, consent and App Store answers

### What changed (October 2026)

- Videos (raw takes and everything made from them) are **kept until the account is deleted**, not 7 days.
- With the user's agreement, videos may be used to **improve Autocut and its AI**.
- The outside companies are named: Cloudflare, Deepgram, Supabase, Railway, Whop, Apple and RevenueCat.
- Data can transfer if the company is sold.
- Wording: `legal/privacy.html`, `legal/terms.html`. **A lawyer must approve the final wording** before
  release. Points for them: the AI-use licence, what happens to model improvements after deletion,
  keeping consent records after deletion (today they're deleted with the account), Whop refunds, and
  which law applies.

### Consent in the app

- Sign-up shows two boxes: the terms and privacy policy (required), and AI use (optional, unless
  `AI_CONSENT_REQUIRED` is set to true in `app/src/lib/consent.ts`; the lawyer decides).
- Accounts from before these terms are asked once, and can't continue until they agree or sign out.
- Settings › Help improve Autocut's AI turns it on or off at any time.
- The server records the version agreed, when, and the AI choice (`consents` table; `POST /consent`).
  **Only use videos from accounts with `consents.ai = true` for AI work.**
- Changing the terms again: bump `TERMS_VERSION` in both `src/legal.js` and `app/src/lib/consent.ts`;
  everyone is asked to agree again.

### App Store Connect

- **Privacy Policy URL:** https://autocut-production-88f1.up.railway.app/privacy
- **Terms (EULA) URL:** https://autocut-production-88f1.up.railway.app/terms
- **App Privacy labels** (update these before submitting the new version):

  | Data type | Collected | Linked to the user | Purposes | Tracking |
  |---|---|---|---|---|
  | Email address | Yes | Yes | App Functionality | No |
  | Name (optional, from profile) | Yes | Yes | App Functionality | No |
  | Photos or Videos | Yes | Yes | App Functionality, Product Personalization*, Other Purposes (improving the app's AI, with consent) | No |
  | Audio Data | Yes | Yes | App Functionality, Other Purposes (improving the app's AI, with consent) | No |
  | Purchase History | Yes | Yes | App Functionality | No |
  | Other User Content (transcripts, captions, text) | Yes | Yes | App Functionality, Other Purposes | No |
  | Crash/performance data | No | | | |

  *Only if you use it to tailor the app per user; otherwise leave Product Personalization off. The lawyer
  should confirm these match the final policy.
- **Account deletion:** Settings → Delete account (removes the login, every video in R2, the cuts, counts
  and consent records).
- **Review notes:**
  - Give a working email and password for a test account.
  - Say videos are cut on our servers, so the first cut takes up to a minute.
  - If payments are on: mention Whop is shown only on the US storefront, alongside in-app purchase.
- **iPad:** supported. Apple reviews on iPad too.
- **Screenshots:** ready in `design/App Store/`, numbered 1–10 in upload order (Apple allows up to 10 per
  device): iPhone 6.9" (1320×2868) and iPad 13" (2064×2752). They show another creator's sponsored video,
  so **get his permission first** (or re-shoot with your own take).
- **App icon:** already in the app. The master is `app/assets/logo.svg`; other formats are in `design/Logo/Final/`.

### ⚠️ The intro video

The first screen new users see plays a sample take (`app/assets/intro/raw.mp4` and `edited.mp4`). It's
another creator's video (his face, an "@STEE.UGC" watermark, brand logos). **Get his permission or swap in
your own clips before release.** To swap:
- Replace both files with the same take raw and edited, the same length, frame-aligned.
- Re-transcribe the raw one into `app/src/lib/introWords.json` (word timings: `{t, s, e}`).

---

## 8. Test before you submit (on TestFlight)

- Create an account (the two consent boxes; Create account stays off until the terms box is ticked), sign
  out, sign in, reset password, delete the account (its videos disappear from R2).
- Settings › Help improve Autocut's AI on and off.
- New-user intro → onboarding → plan screen → account → Who runs this studio? → @handle → studio ready →
  Show me around (5-step tour). Settings › Replay tutorial shows it again.
- Camera: the camera tour, record a take (front and back, pinch to zoom), pause and record a second take,
  done → review → send.
- Import one video from Photos; import several (Arrange your clips).
- Batch: add 2–3 videos of a few clips each, reorder one with Arrange, Edit all → all land in Cuts.
- Scheduled batch edit (Pro/Ultimate; Starter sees a PRO lock): schedule a few minutes ahead → "Scheduled
  for …" in Cuts, cut by a worker at that time (the phone can be off). Cancel refunds the edit.
- In the editor: play through cuts (the native player, §4), trim, split, speed, undo, pinch to zoom,
  captions (move, resize, edit, split, delete; the pencil's look card), text, music, a photo and a video overlay.
- Export → saved to Photos → Share.
- Payments (when on): buy with Apple (Sandbox), Restore, change plan; on a US account also Pay on the web
  with Whop; check Your plan updates.
- Do it once on an iPad.

---

## 9. The server (Railway)

- Live: https://autocut-production-88f1.up.railway.app (`/health` → `{"ok":true,"role":…,"queued":…,"running":…}`)
- One `Dockerfile`, two kinds of service (`ROLE=api`, `ROLE=worker`; §5). Deploys on push to `main`.
  The Whisper model is still baked into the image as the backup for Deepgram.
- **How a cut flows:** the app asks the api for a signed upload link (`POST /uploads/sign`) and sends the
  take straight to R2 → `POST /cuts` adds a row to `cuts` and a job to `tasks` → any free worker claims it
  (`FOR UPDATE SKIP LOCKED`, so never twice), fetches the take from R2, transcribes with Deepgram, finds the
  cuts, writes progress to the cut's row (what the app polls) and makes the editor's first preview →
  previews and exports work the same way → the app downloads videos straight from R2 with signed links.
- **Nothing is lost on a restart.** Workers send a heartbeat; a job whose worker goes quiet for 2 minutes
  goes back on the list (after 3 tries it fails and the edit is refunded). Scheduled edits wait in `tasks`
  with their time.
- **Variables:** see `.env.example`. Rarely needed: `PORT` (default 8787), `AUTOCUT_DATA` (default `/data`),
  `FFMPEG_STALL_MS` (default 90000), `MAX_UPLOAD_MB` (1024), `DB_POOL` (5), `CACHE_GB` (worker's local
  copy of recent videos, 8).
- Workers need at least 2 vCPU / 4 GB. With Deepgram, a one-minute take is cut in a few seconds of
  transcription plus ffmpeg time; exports are the heaviest job. For many jobs at once, split workers into
  a cut pool and an export pool and turn on autoscaling (§10).
- `/health` reports `storageOk` (a real signed upload to R2 at start) and `deepgramOk`, plus jobs
  `queued` and `running`.
- The API is listed at the top of `src/server.js`. Every route except `/health`, `/privacy`, `/terms`, the
  `/webhooks/*` (checked by signature) and `/blobs/*` (local development only, signed) needs the user's
  Supabase token.

---

## 10. Scaling to thousands of jobs at once

The app itself can't be overloaded: recording, the editor and playback run on each phone. The server
side is built to grow sideways: any number of worker copies share one job list, each claims jobs without
ever taking another's, and Railway can add and remove copies automatically.

### The limits that matter (checked October 2026)

| Piece | Limit | What it means |
|---|---|---|
| Railway (Pro) | 42 copies per service, 24 vCPU each (~1,000 vCPU per service) | Add a second worker service past that |
| Deepgram | ~50–100 requests at once per account (can't be raised on pay-as-you-go/Growth; Enterprise via sales) | Each takes a few seconds, so that's still ~1,000+ cuts a minute |
| Supabase pooler | a few hundred client connections, by compute size | Few, big worker copies with small pools, not thousands of tiny ones |
| CPU (ffmpeg) | an export uses ~1–2 vCPU for tens of seconds | The real cost: 1,000 exports at once ≈ 2,000 vCPU |

### How it's set up for that

1. **Two worker pools**, both from this repo:
   - **worker-cut**: `ROLE=worker`, `WORKER_KINDS=cut`, `CONCURRENCY=16`, `DEEPGRAM_MAX=8`, 4 vCPU / 8 GB.
     A cut is mostly waiting on Deepgram, so one copy runs many.
   - **worker-render**: `ROLE=worker`, `WORKER_KINDS=render,preview`, `CONCURRENCY=6`, 12 vCPU / 12 GB.
     Exports and previews are ffmpeg: about one per two vCPU.
   - Both: `WHISPER_FALLBACK=0` (under load, slow local Whisper would make things worse; a cut that
     Deepgram can't do after retrying fails and is refunded) and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`
     (a copy being stopped finishes its jobs or hands them straight back).
   - Keep `DEEPGRAM_MAX × max worker-cut copies` under your Deepgram limit (e.g. 8 × 10 = 80).
2. **Autoscaling** (`src/scaler.js`, Railway's own approach): every 30 s the api reads the job list and
   sets each pool's number of copies: straight up when work arrives, down one copy at a time after 5
   quiet minutes. On the **api** service:
   - `RAILWAY_API_TOKEN`: Railway → Project → Settings → **Tokens** → create a project token.
   - `SCALE_POOLS=cut=<worker-cut service id>:16:1:10,render=<worker-render service id>:6:1:40`
     (service id: the service → Settings, or the URL). Format: `jobs per copy : min copies : max copies`.
   - The log shows `[scaler] render: 3 → 9 copies (40 waiting, 14 running)`.
3. **Database connections**: `DB_POOL=3` per copy. With dozens of copies, switch `DATABASE_URL` to the
   **Transaction pooler** (port 6543) and raise the Supabase compute size if it reports "max client connections".
4. **Sign-in checks**: in Supabase → Project Settings → **JWT Keys**, move to the new asymmetric signing keys
   if offered, so the server verifies tokens itself instead of asking Supabase on every request.
5. **The app** checks a cut's progress every 1.5 s (not faster), and downloads videos straight from R2.

### What 1,000 at once costs

Roughly 1,000 cuts at once ≈ 63 worker-cut copies' worth of slots (but limited by Deepgram to ~80 in
flight, which clears them in about a minute), and 1,000 exports at once ≈ 170 worker-render copies at 12 vCPU,
four times Railway's 42-copy cap per service, so it needs four render services (or people wait longer). Sustained, that's
tens of thousands of dollars a month of CPU; with autoscaling you pay for the peaks only. The biggest saving
at that size is moving exports onto the phone (below).

### Before a big launch

- One active cut per account, and an estimated wait in the app when the list is long.
- Load-test a staging copy (separate Railway environment and R2 bucket) with hundreds of simulated users.
- Alerts on `/health` (`queued` staying high) and on worker errors.

**Which transcription service** (prices checked October 2026; check again before you sign up). Autocut
needs a time for every word, the ums kept with their times, accuracy on fast talkers, English and Spanish.

| Service | Price | Word times | Keeps "um/uh" | Verdict |
|---|---|---|---|---|
| **Deepgram Nova-3** (in use) | ~$0.0043/min standard (more with the training opt-out) | Yes | Yes, with `filler_words=true` | **Chosen** |
| ElevenLabs Scribe v2 | ~$0.22/hr | Yes | Yes (verbatim by default) | Close second |
| AssemblyAI Universal-3.5 Pro | ~$0.21/hr | Yes | Partly (~76% of fillers) | Misses fillers |
| Groq (Whisper large-v3) | ~$0.11/hr | Yes | Often skips them | Poor at fillers |
| OpenAI gpt-4o-transcribe | ~$0.006/min | **No** | | Can't be used: no word times |

Before launch, run Deepgram on the same fast-talker takes Whisper small was chosen on (fast talkers are
where transcription went wrong before). It costs cents.

**At millions of users: do the work on the phone.** This is how CapCut and Edits stay affordable. Every
recent iPhone can run Whisper itself (WhisperKit), with the same per-word times, and render exports with
Apple's own video tools. Server cost per cut then drops to almost nothing. It needs native code, so test it
on TestFlight builds.

---

## 11. Where things are in the code

| Thing | File |
|---|---|
| Screens and navigation | `app/src/app/` (Expo Router; `_layout.tsx` decides signed-in / onboarding / app) |
| Intro, onboarding, sign-in (with consent) | `welcome.tsx`, `setup.tsx`, `sign-in.tsx`, `components/ConsentChecks.tsx` |
| Asking existing accounts to agree | `app/src/components/ConsentGate.tsx`, `app/src/lib/consent.ts` |
| Payments in the app | `app/src/lib/billing.ts`, `components/PlanPicker.tsx`, `app/plan.tsx` |
| Instant updates | `app/src/lib/updates.ts`, `app.json` (`runtimeVersion`, `updates`), `eas.json` (channels) |
| Camera (Create tab) | `app/src/app/(tabs)/index.tsx` |
| Editor | `app/src/app/edit/[id].tsx` + `app/src/components/editor/` |
| Edit model (clips, captions, overlays, export body) | `app/src/lib/edit.ts` (tested in `app/tests/`) |
| Uploads, cutting jobs, retries | `app/src/lib/jobs.ts`, `app/src/lib/api.ts` |
| Local storage of cuts and settings | `app/src/lib/store.ts` |
| Caption/text styles (shared with the server) | `app/src/lib/styles.json` |
| API routes | `src/server.js` |
| Workers (cut, preview, export jobs) | `src/worker.js` |
| Autoscaling worker copies | `src/scaler.js` |
| Database (cuts, job list, usage, consent) | `src/db.js`, `supabase/migrations/` |
| Video storage (R2 / local folder) | `src/storage.js` |
| Speech to text (Deepgram, Whisper backup) | `src/transcribe.js` |
| Payments (Whop, RevenueCat webhooks) | `src/billing.js`, `src/auth.js` (`planOf`, `setPlanFrom`) |
| Finding the cuts | `src/plan.js`, `src/pipeline.js` |
| Rendering exports | `src/media.js`, `src/ass.js` (captions/text), `src/edits.js` (checking requests) |
| Privacy policy / terms | `legal/` (served by `src/legal.js`) |
| Tests | `tests/` (server; `scale.test.js` covers the job list, workers, payments, Deepgram), `app/tests/` |

Fonts: TikTok Sans is the default caption font. It and the other caption fonts are bundled in `fonts/`
(server) and `app/assets/fonts/` (app), all under the SIL Open Font License.
