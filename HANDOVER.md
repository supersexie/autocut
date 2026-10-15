# Autocut: handover

Everything you need to get Autocut onto the App Store. The app works and has been tested end to end
on iPhone (Expo Go) and on the iPad Simulator. What's left is accounts, builds, payments and store setup.

---

## 1. What Autocut is

An iPhone/iPad app for UGC creators. You record (or import) a raw take; Autocut cuts out the dead air,
filler words and flubbed retakes, captions every word, and opens it in an editor (trim, split, speed,
zoom keyframes, captions, text, music, photo/video overlays). Export saves the finished video to Photos.

Two parts:

| Part | Where | What it does |
|---|---|---|
| **App** | `app/` | Expo (SDK 57, React Native 0.86, Expo Router). iPhone and iPad, portrait. |
| **Cutting server** | `src/` (repo root) | Node. Transcribes with Whisper (runs on the server, no API keys), finds the cuts, and renders exports with ffmpeg. Live on Railway. |
| **Accounts** | Supabase | Email sign-in (Apple/Google ready, switched off, see §5). |

**Ignore** `ios/` (an old Swift prototype, not used), `prototype/` and `samples/`. In `design/`, only
`design/Logo/` (the logo in every format) and `design/App Store/` (the store screenshots) matter.
The real iOS app is generated from `app/` by EAS. Don't commit an `app/ios` folder.

---

## 2. Rules before you start

- **Pushing to `main` redeploys the live server on Railway.** Don't push to `main` without checking
  with the owner first. Work on a branch.
- The **Supabase secret key** lives only in Railway's variables. It must never go in the app or the repo.
  (The *publishable* key in `app/eas.json` is meant to be public. That's fine.)
- Bundle ID is `com.rishavvashisht.autocut`. If you publish under a different ID, change it in
  `app/app.json` **and** add the new ID in Supabase → Authentication → Providers → Apple (if Apple sign-in is on).

---

## 3. Running it locally

```bash
# App (in Expo Go on a phone, or the iOS Simulator)
cd app
npm install
npx expo start              # scan the QR with Expo Go; press Shift+I for an iPad Simulator

# Checks (all pass today)
npx tsc --noEmit && npx expo lint && npm test && npx expo-doctor
cd .. && npm test           # server tests
```

`app/.env.local` (not in git) points the app at the live server and Supabase. Copy
`app/.env.example` and ask the owner for the values (they're the same as in `app/eas.json`).

To run the server on your Mac instead: `npm install && npm run server` at the repo root (no
Supabase vars = no sign-in needed, for development only).

---

## 4. Building for TestFlight

```bash
cd app
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

- `app/eas.json` already holds the app's public settings (server URL, Supabase URL and publishable key), so
  store builds reach the right server. Build numbers go up on their own.
- Let EAS manage certificates. It also turns on the Sign in with Apple capability.
- Export compliance is answered in `app.json` (`usesNonExemptEncryption: false`), so TestFlight won't ask.

### ⚠️ Check the editor on your first TestFlight build

Store builds include a small native video player (`app/modules/autocut-player`) that plays the edit as one
seamless video. **Expo Go can't load it, so it has never run on a real device.** In Expo Go the app
uses a fallback (two players taking turns plus a server-stitched preview), and that's what was tested.

On the first TestFlight build, open a cut in the editor and play through several cuts. If the build
fails on `AutocutPlayer`, or editor playback is wrong, add this to `app/package.json` and rebuild. The app
then uses the tested fallback:

```json
"expo": { "autolinking": { "exclude": ["autocut-player"] } }
```

---

## 5. Things to set up (accounts and settings)

### Required before review

1. **Legal details** on the privacy policy and terms. They currently say `[operator name]`.
   Railway → the autocut service → **Variables**:
   - `LEGAL_OPERATOR`: who publishes the app (as on the App Store listing)
   - `LEGAL_EMAIL`: contact for privacy requests
   - `LEGAL_COUNTRY`: whose laws apply, e.g. `United States`

   Railway redeploys by itself. Check https://autocut-production-88f1.up.railway.app/privacy afterwards.

2. **Payments.** See §6. Apple will reject the app as it is.

### Optional

3. **Support email**: add `"EXPO_PUBLIC_SUPPORT_EMAIL": "…"` to each profile's `env` in `app/eas.json`
   to show "Help & contact" in Settings (hidden without it).
4. **Sign in with Apple / Google**: currently **off** in Supabase, so only email sign-in shows in store
   builds (the buttons appear by themselves once a provider is switched on). Turn on **both or neither**:
   Apple requires Sign in with Apple whenever Google sign-in is offered.
   - Supabase → Authentication → Providers → **Apple**: enable, add `com.rishavvashisht.autocut` as a client ID.
   - **Google**: create an OAuth client in Google Cloud, enable the provider, and under URL Configuration →
     Redirect URLs add `autocut://**` and `exp://**`.
   - (In Expo Go/dev builds the buttons always show so the screens can be designed. That's expected.)

---

## 6. Payments (the main job left)

Nothing charges today. The app says "Free during the beta", but the plan screens show prices:

- Plans and prices: `app/src/lib/plans.ts` (Starter $19.99, Pro $49.99, Ultimate $99.99 a month; yearly is 33% off).
- Screens: `app/src/components/PlanPicker.tsx` (last step of onboarding, and "Change plan"),
  `app/src/app/paywall.tsx`, `app/src/app/plan.tsx` ("Your plan", with a placeholder Restore purchases).
- The chosen plan is saved on the Supabase user (`profile.plan`, `profile.billing`).
- **What each plan gets is enforced**, in the app and on the server:
  - Starter: 100 edits a month, batch edits (right away only), no Overlap audio.
  - Pro: 300 edits, Overlap audio, Scheduled batch edits.
  - Ultimate: unlimited edits, Overlap audio, Scheduled batch edits.
  - App: `app/src/lib/plans.ts` and `usage.ts` (locks, upgrade prompts).
  - Server: `src/plans.js`. It counts edits per account per month (`/data/usage`), refuses the 101st/301st
    edit (402) and scheduled edits on Starter (403), and ignores Overlap audio on Starter exports. Stopped or
    failed cuts don't use up an edit. Keep both copies of the rules in step.
- ⚠️ The server reads the plan from the Supabase account (`user_metadata.plan`), which the **app** sets today.
  That isn't proof of payment: when subscriptions go in, have the server take the plan from the purchase
  (e.g. a RevenueCat webhook writing `app_metadata.plan`, which users can't change) and read that in
  `accountFrom()` in `src/auth.js`.
- To try the limits locally: `DEV_PLAN=starter npm run server` (or `pro`).

**Apple rejects apps that show paid plans without In-App Purchase (guideline 3.1.1).** Either:
- connect App Store subscriptions (RevenueCat is the easy route; it needs a development/EAS build, not
  Expo Go), make "Continue with …" start the purchase and "Restore purchases" restore it, and enforce the
  edit limit on the server (`POST /cuts` in `src/server.js`); **or**
- remove the prices from those screens and ship as free first.

---

## 7. App Store Connect answers

- **Privacy Policy URL:** https://autocut-production-88f1.up.railway.app/privacy
- **Terms (EULA) URL:** https://autocut-production-88f1.up.railway.app/terms
- **App Privacy:**
  - Collects **email address** (account).
  - Collects **user content**: the videos and their audio are uploaded to the server to be cut and
    transcribed, and deleted after 7 days or when the account is deleted.
  - No tracking, no ads, no third-party analytics.
- **Account deletion:** Settings → Delete account (removes the login and everything on the server).
- **Review notes:**
  - Give a working email and password for a test account.
  - Mention that videos are cut on the server, so the first cut of a take takes a minute or two.
- **iPad:** supported. Apple reviews on iPad too, and it's been checked on the iPad Simulator.
- **Screenshots:** ready in `design/App Store/`, numbered 1–5 in upload order: iPhone 6.9" (1320×2868) and
  iPad 13" (2064×2752). They show another creator's sponsored video, so **get his permission first** (or re-shoot
  with your own take).
- **App icon:** already in the app. The master is `app/assets/logo.svg`; other formats are in `design/Logo/Final/`.

### ⚠️ The intro video

The first screen new users see plays a sample take (`app/assets/intro/raw.mp4` and `edited.mp4`). It's
another creator's video (his face, an "@STEE.UGC" watermark, brand logos). **Get his permission or swap in
your own clips before release.** To swap:
- Replace both files with the same take raw and edited, the same length, frame-aligned.
- Re-transcribe the raw one into `app/src/lib/introWords.json` (word timings: `{t, s, e}`).

---

## 8. Test before you submit (on TestFlight)

- Create an account, sign out, sign in, reset password, delete the account.
- New-user intro → onboarding → plan screen.
- Camera: the two-step camera tour, record a take (front and back, pinch to zoom), pause and record a
  second take, done → review → send.
- Import one video from Photos; import several (Arrange your clips).
- Batch (every plan): add 2–3 videos of a few clips each, reorder one with Arrange, Edit all → all land in Cuts.
- Scheduled batch edit (Pro/Ultimate; Starter sees a PRO lock): on a video in Batch tap Schedule, pick a time a few minutes ahead, Schedule → it shows
  "Scheduled for …" in Cuts and is cut by the server at that time (the phone can be off). Cancel refunds the edit.
- Wait for the cut, then in the editor:
  - Play through several cuts (**the native player, see §4**). Trim, split, speed, undo.
  - Pinch the video to zoom (keyframes).
  - Captions: move, resize, edit, split, delete.
  - Text, music, and a photo and a video overlay.
- Export → saved to Photos → Share.
- Do it once on an iPad.

---

## 9. The server (Railway)

- Live: https://autocut-production-88f1.up.railway.app (`/health` → `{"ok":true,…}`)
- Built from the `Dockerfile`. The Whisper model is baked into the image. Deploys on push to `main`.
- **Variables:**
  - `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (required)
  - `LEGAL_OPERATOR`, `LEGAL_EMAIL`, `LEGAL_COUNTRY`
  - Optional: `CONCURRENCY` (cuts at once, default 1), `RETENTION_DAYS` (default 7), `MAX_UPLOAD_MB` (default 1024)
- A volume is mounted at `/data` (takes and cuts). Scheduled edits wait there too (with their clips), so they
  survive a redeploy; the server checks every 15 s for ones that are due.
- Needs at least 2 GB RAM and 2 vCPU. Transcription is CPU-bound, so more CPU means faster cuts.
  With `CONCURRENCY=1`, cuts queue one at a time, so raise it (and the CPU) as users grow.
- The API is listed at the top of `src/server.js`. Every route except `/health`, `/privacy` and `/terms`
  needs the user's Supabase token.

---

## 10. Where things are in the code

| Thing | File |
|---|---|
| Screens and navigation | `app/src/app/` (Expo Router; `_layout.tsx` decides signed-in / onboarding / app) |
| Intro, onboarding, sign-in | `welcome.tsx`, `setup.tsx`, `sign-in.tsx` |
| Camera (Create tab) | `app/src/app/(tabs)/index.tsx` |
| Editor | `app/src/app/edit/[id].tsx` + `app/src/components/editor/` |
| Edit model (clips, captions, overlays, export body) | `app/src/lib/edit.ts` (tested in `app/tests/`) |
| Uploads, cutting jobs, retries | `app/src/lib/jobs.ts`, `app/src/lib/api.ts` |
| Local storage of cuts and settings | `app/src/lib/store.ts` |
| Caption/text styles (shared with the server) | `app/src/lib/styles.json` |
| Finding the cuts | `src/plan.js`, `src/pipeline.js`, `src/transcribe.js` |
| Rendering exports | `src/media.js`, `src/ass.js` (captions/text) |
| Privacy policy / terms | `legal/` (served by `src/legal.js`) |

Fonts: TikTok Sans is the default caption font. It and the other caption fonts are bundled in `fonts/`
(server) and `app/assets/fonts/` (app), all under the SIL Open Font License.
