# autocut

Drop in a raw UGC take, get back a tight edit: dead air, fillers, stutters and flubbed
retakes removed, with optional burned-in captions. Runs fully locally (Whisper via
transformers.js, ffmpeg via `ffmpeg-static`), no API keys.

```bash
npm install
npm run cut -- samples/raw.mp4 --captions
```

Outputs next to the input:

- `raw.cut.mp4` – the edited video
- `raw.cut.srt` – captions on the edited timeline
- `raw.cut.json` – every word, kept segment and cut with its reason (for tuning / a future editor UI)

Options: `-o out.mp4`, `--captions`, `--max-gap 0.3` (longest pause kept), `--keep-fillers`,
`--plan-only` (skip rendering), `--model <hf whisper model>`.

## How it decides

1. **Transcribe** with word timestamps (`onnx-community/whisper-base_timestamped`, downloaded on first run into `.models/`).
2. **Fillers / stutters** – "um", "uh", repeated words.
3. **Retakes** – split into phrases; if a phrase is re-said within the next few phrases, the earlier delivery is dropped (last take wins).
4. **Dead air** – pauses longer than `maxGap` between kept words become cuts, with small pads and edges snapped to real audio so words aren't clipped.
5. **Render** – trim + concat with 12 ms audio fades so cuts don't click.

Logic lives in `src/plan.js` (pure, unit tested in `tests/`).

## iPhone app (`ios/`)

SwiftUI app that does the whole thing on the phone: record or import a take, watch the cuts
land on the timeline, preview the edit with captions, then save to Photos or share. Nothing is
uploaded — Apple's on-device speech recognition gives the word timings, `CutPlanner.swift`
(a port of `src/plan.js`) decides the cuts, and AVFoundation builds and exports the edit.

Open `ios/Autocut.xcodeproj` in Xcode 26, pick an iPhone simulator or your phone, and press Run.
For a real iPhone, set your team under Signing & Capabilities first.

| Tab | What it does |
|---|---|
| Create | Record now / Import a video → processing screen → finished cut |
| Cuts | Every cut you've made, tap to rewatch, save or share |
| You | Pause length, remove ums, remove retakes, burn-in captions |

`ios/scripts/check-planner.sh` compiles the cutting logic with the Mac toolchain and runs its checks (no Xcode needed).
