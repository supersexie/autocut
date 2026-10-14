# Handover: getting Autocut onto the App Store

Autocut is an Expo (SDK 57) iPhone/iPad app in `app/`, plus a Node cutting server in `src/`
that runs on Railway. Sign-in is Supabase. ✅ = done and checked; ⬜ = needs someone with the accounts.

## Where things stand

- ✅ App: typechecks, lints clean, tests pass (`cd app && npm test`; server: `npm test` at the root).
- ✅ `expo-doctor`: all checks pass.
- ✅ `app/eas.json`: development / preview / production profiles, with the app's public settings
  (server URL, Supabase URL and publishable key) baked in. Build numbers go up on their own.
- ✅ Bundle ID `com.rishavvashisht.autocut` (change it in `app/app.json` if you publish under another ID,
  and add the new one as an Apple client ID in Supabase, see below).
- ✅ iPhone and iPad (portrait, full screen). Icon 1024×1024, no transparency. Splash screen.
- ✅ Permission texts for camera, microphone, photo library and saving to Photos.
- ✅ Export compliance answered in the app (`usesNonExemptEncryption: false`), so TestFlight won't ask.
- ✅ Delete account in Settings: removes the user's videos on the server and their login.
- ✅ Server live at https://autocut-production-88f1.up.railway.app (`/health` → 200; everything else needs a signed-in user).
- ✅ Privacy policy and terms at `/privacy` and `/terms` on that server, linked in the app.

## 1. Before the first build

1. **Legal details (required).** The privacy policy and terms still say `[operator name]` and `[country]`.
   In Railway → the autocut service → **Variables**, set:
   - `LEGAL_OPERATOR`: the person or company publishing the app (as on the App Store listing)
   - `LEGAL_EMAIL`: a contact email for privacy requests
   - `LEGAL_COUNTRY`: whose laws apply, e.g. `United States`

   Railway redeploys on its own; then check https://autocut-production-88f1.up.railway.app/privacy.
2. **Support email (optional).** Add `"EXPO_PUBLIC_SUPPORT_EMAIL": "…"` to each profile's `env` in
   `app/eas.json` to show a "Help & contact" row in Settings. Without it the row is hidden.
3. **Google / Apple sign-in (optional).** These are currently **off** in Supabase, so the app shows
   email sign-in only. The buttons appear by themselves once a provider is turned on. Turn on **both or
   neither**: Apple requires Sign in with Apple whenever Google sign-in is offered.
   - Supabase → Authentication → Providers → **Apple**: enable, and add `com.rishavvashisht.autocut`
     (and `host.exp.Exponent` for Expo Go) as client IDs. The app uses native Sign in with Apple.
   - **Google**: create an OAuth client in Google Cloud, enable the provider, and add
     `autocut://**` and `exp://**` under Authentication → URL Configuration → Redirect URLs.

## 2. Build and TestFlight

```bash
cd app
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

EAS sets up the certificates and the Sign in with Apple capability when you log in with the Apple Developer account.

**The native video player.** App Store builds include a small native module
(`app/modules/autocut-player`) that plays the edit as one seamless video. Expo Go doesn't have it,
so it has never run on a phone. Expo Go uses a fallback instead: two players taking turns, smoothed
by a preview stitched together on the server. Check the editor in TestFlight. If the build fails on
`AutocutPlayer`, or editor playback misbehaves, add this to `app/package.json` and rebuild. The app
then uses the same playback that has been tested in Expo Go:

```json
"expo": { "autolinking": { "exclude": ["autocut-player"] } }
```

## 3. Test on TestFlight before review

- Create an account, sign out, sign in, reset password, delete the account.
- Record a take, and import one from Photos (one clip, and several clips via Arrange).
- Wait for the cut. Then in the editor: play through several cuts, trim, split, speed, keyframes
  (pinch the video), captions, text, music, a photo and a video overlay. Then export and save to Photos.
- Do the same once on an iPad.

## 4. App Store Connect

- **Privacy Policy URL:** https://autocut-production-88f1.up.railway.app/privacy
- **Support URL:** a page or mailto you control.
- **App Privacy:** collects **email address** (account) and **user content** (the videos and their
  audio are uploaded to the server to be cut and transcribed, and deleted after 7 days or when the
  account is deleted). No tracking, no ads, no third-party analytics.
- **Review notes:** give Apple a working email and password for a test account. Explain that videos
  are cut on the server, so the first cut of a take takes a minute or two.

## 5. Payments (blocks review)

The onboarding and "Your plan" screens show plans with prices, but nothing charges yet. The app says
"Free during the beta". Apple rejects apps that show paid plans without In-App Purchase (guideline 3.1.1).
Before submitting for review, either connect App Store subscriptions (e.g. RevenueCat; prices live in
`app/src/lib/plans.ts`) and enforce edit limits on the server, or remove the prices from those screens.

## Server reference (Railway)

Variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (required), `LEGAL_OPERATOR`, `LEGAL_EMAIL`,
`LEGAL_COUNTRY`, and optionally `CONCURRENCY` (cuts at once, default 1), `RETENTION_DAYS` (default 7),
`MAX_UPLOAD_MB` (default 1024). A volume is mounted at `/data`. At least 2 GB RAM and 2 vCPU are
needed (Whisper transcription is CPU-bound). Pushing to `main` redeploys.
The Supabase **secret** key only ever goes on the server, never in the app.
