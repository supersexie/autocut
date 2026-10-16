# Autocut

An iPhone and iPad app for UGC creators. Record or import a raw take; Autocut cuts out the dead
air, ums and flubbed retakes, captions every word, and opens it in an editor (trim, split, speed,
zoom, captions, text, music, photo and video overlays). Export saves the finished video to Photos.

**Setting it up on your own accounts? [ACCOUNTS.md](ACCOUNTS.md) lists every account and key, and where each goes.**
**Setting up payments? See [PAYMENTS.md](PAYMENTS.md).**

**Shipping it? Start with [HANDOVER.md](HANDOVER.md):** setup, builds, payments, App Store answers, scaling,
the test list and what's left to do.

## What's where

| Folder | What it is |
|---|---|
| `app/` | **The app** (frontend). Expo SDK 57, React Native, Expo Router. Screens in `app/src/app/`, components in `app/src/components/`, logic in `app/src/lib/`. |
| `src/` | **The server** (backend). Node. An API (`server.js`) and any number of workers (`worker.js`) sharing a job list (Postgres on Supabase, or Redis at very large scale) and video storage (Cloudflare R2); transcribes with Deepgram, finds the cuts, renders exports with ffmpeg. Runs on Railway. API listed at the top of `src/server.js`. |
| `tests/`, `app/tests/` | Server and app tests. |
| `supabase/migrations/` | The database tables (run once in Supabase). |
| `.env.example` | Every server setting. |
| `legal/` | Privacy policy and terms, served by the server at `/privacy` and `/terms`. |
| `fonts/` | Caption fonts the server renders with (the app has its own copy in `app/assets/fonts/`). All SIL Open Font License. |
| `design/Logo/` | The logo in every format (`Final/`), plus the versions that weren't picked (`Other versions/`). |
| `design/App Store/` | App Store screenshots, iPhone 6.9" and iPad 13", numbered in upload order. |
| `design/Legal/` | Previews of the privacy policy and terms. |
| `Dockerfile`, `railway.json` | How the server is built and deployed. |
| `AWS.md`, `infra/`, `Dockerfile.gpu`, `asr/` | The setup for 100,000 jobs at once on AWS (Kubernetes, GPU exports, our own GPU speech-to-text, Redis job list). Ready, not in use yet. |
| `site/` | The website that sends people to the App Store (static). |

## Run it

```bash
npm install && npm run server          # the server, on http://localhost:8787
cd app && npm install && npx expo start # the app: scan the QR with Expo Go, or press i for the Simulator
```

Copy `app/.env.example` to `app/.env.local` and fill it in to use the live server and accounts.
Without it the app talks to the server on your Mac and you can continue without an account.

## Checks

```bash
npm test                                                        # server
cd app && npx tsc --noEmit && npx expo lint && npm test && npx expo-doctor   # app
```

## How the cutting works

1. **Transcribe** with word timings (Deepgram; Whisper on the worker as a backup).
2. **Fillers and stutters**: "um", "uh", repeated words.
3. **Retakes**: when a phrase is said again soon after, the earlier try is dropped (last take wins).
4. **Dead air**: pauses longer than the chosen limit become cuts, snapped to the real audio so words aren't clipped.
5. **Render**: trims joined with short fades so cuts don't click (or, with Overlap audio, a 0.16 s crossfade).

The cutting logic is `src/plan.js`, unit tested in `tests/`.
