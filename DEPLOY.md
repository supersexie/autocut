# Launch checklist

What's done in code is marked ✅. Everything else needs an account or a decision from you.

## 1. Accounts (Supabase)

1. Create a project at supabase.com (free tier is fine to start).
2. **Project Settings → API keys**: copy the Project URL, the **publishable** key and the **secret** key.
3. App: copy `app/.env.example` to `app/.env.local` and fill in `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. (The publishable key is safe to ship in the app.)
4. **Authentication → URL Configuration → Redirect URLs**: add `exp://**` and `autocut://**`.
5. Google sign-in: create an OAuth client in Google Cloud, then enable **Authentication → Providers → Google**.
6. Apple sign-in: enable **Providers → Apple** and add `host.exp.Exponent` (Expo Go) and
   `com.rishavvashisht.autocut` (the real app) as client IDs.

The **secret** key never goes in the app. It only goes on the server (step 2).

## 2. Cutting server (Railway)

✅ `Dockerfile`, `railway.json`, sign-in checks, per-user data, retention cleanup, account deletion.

1. Create an account at railway.com and add a payment method (expect roughly $10–30/month to start).
2. **New Project → Deploy from GitHub repo → supersexie/autocut**. Railway finds the Dockerfile.
3. **Variables**:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SECRET_KEY` = your secret key
   - optional: `CONCURRENCY` (cuts at once, default 1), `RETENTION_DAYS` (default 7), `MAX_UPLOAD_MB` (default 1024)
4. **Volumes → New volume**, mount path `/data` (takes and cuts live here).
5. **Settings → Resources**: at least 2 GB RAM and 2 vCPU. Whisper is CPU-bound, so more CPU = faster cuts.
6. **Settings → Networking → Generate domain**. Put it in `app/.env.local` as `EXPO_PUBLIC_API_URL=https://…`.
7. Check it: open `https://<your-domain>/health` → `{"ok":true,…}`.

## 3. App Store basics

- ✅ Delete account in Settings (Apple requires it).
- ✅ Development-only bits (server address, "Continue without an account") are hidden in release builds.
- ⬜ App icon (1024×1024 PNG) and splash image.
- ⬜ Privacy policy and terms pages at a public URL (the app links to them).
- ⬜ Apple Developer Program ($99/year) at developer.apple.com.

## 4. Build and TestFlight

- ⬜ `npx eas-cli@latest build --platform ios --profile production`, then `eas submit` to TestFlight.

## 5. Payments

- ⬜ App Store subscriptions through RevenueCat, real prices in `app/src/lib/plans.ts`, server-side edit limits.
