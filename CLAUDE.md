# Autocut: notes for Claude

Autocut is an iPhone/iPad app that cuts the dead air, ums and retakes out of a raw video, captions it,
opens it in an editor, and exports it to Photos. This folder was handed over by the previous owner. The
new owner is setting it up on their own accounts and shipping it to the App Store.

**Read `HANDOVER.md` first.** Its "Start here" section is the step-by-step plan; walk the owner through it
in order. `ACCOUNTS.md` covers every account and key, `PAYMENTS.md` covers purchases, and `AWS.md` is only
for very large scale (not needed to launch).

## Layout

- `app/`: the app (Expo SDK 57, React Native, Expo Router). Read `app/AGENTS.md` before changing it.
  Expo APIs change every SDK, so check the versioned docs instead of relying on memory.
- `src/`: the Node server. `ROLE=api` (what the app talks to) or `ROLE=worker` (cutting, previews, server
  exports). Runs on Railway.
- `supabase/migrations/`: the database tables, run once in Supabase.
- `site/`: the static website. `legal/`: the privacy policy and terms the server serves.
- `infra/`, `asr/`, `Dockerfile.gpu`: the AWS setup for very large scale. Leave alone unless asked.

## Rules

- **Pushing to `main` redeploys the live server on Railway.** Ask the owner before pushing to `main`.
- **Secrets go only in Railway's variables**, never in the repo or the app. Never ask the owner to paste a
  secret key into chat. Tell them where to put it instead.
- The owner enters passwords and payment details themselves.
- Run the checks before saying something is done:
  - server: `npm test`
  - app: `cd app && npx tsc --noEmit && npx expo lint && npm test`

## Things that aren't obvious

- **Native code doesn't run in Expo Go.** That covers export on the phone (`app/modules/autocut-export`) and
  the editor's player (`app/modules/autocut-player`). In Expo Go the app quietly falls back to the server
  export and a simpler player. Test those two in a development or TestFlight build.
- **iOS 27:** `app/plugins/withSceneLifecycle.js` switches on Apple's scene life cycle. Without it, apps
  built with Xcode 27 crash at launch. Keep it in `app.json` until Expo's own template does this.
- **Running locally without any settings,** the server uses a database on disk (PGlite) and a local video
  folder. `npm run server` is enough to try everything.
- **Captions are drawn three ways that must match:** the editor preview
  (`app/src/components/editor/StyledText.tsx`), the phone export (`app/modules/autocut-export/ios/TextImage.swift`)
  and the server export (`src/ass.js`). Change a caption style in all three.
- **How many cuts run at once** is set by Railway settings, not code. See HANDOVER.md §10, "Going big on
  Railway".
