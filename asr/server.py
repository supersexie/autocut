"""
Autocut speech-to-text on our own GPUs (faster-whisper), for when Deepgram's limits are too low.

  POST /transcribe?language=en      body: mono 16 kHz 16-bit little-endian PCM (what the worker sends Deepgram)
  -> {"words": [{"text": "Um,", "start": 0.12, "end": 0.40}, ...]}
  GET  /health                      -> {"ok": true, "model": ..., "device": ..., "busy": n}

Every spoken word comes back, ums and repeats included: the cutter removes them, so it has to see
them. Whisper normally tidies those away; the prompt below (written the way people really talk)
keeps them.

Settings (environment):
  ASR_MODEL     large-v3 (default; best words), large-v3-turbo / distil-large-v3 (faster), small (CPU tests)
  ASR_DEVICE    cuda (default) or cpu
  ASR_COMPUTE   float16 on GPU, int8 on CPU (default)
  ASR_PARALLEL  how many takes one GPU works on at once (default 4)
  ASR_TOKEN     if set, callers must send "Authorization: Bearer <token>"
  PORT          8000
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from faster_whisper import WhisperModel

MODEL = os.environ.get("ASR_MODEL", "large-v3")
DEVICE = os.environ.get("ASR_DEVICE", "cuda")
COMPUTE = os.environ.get("ASR_COMPUTE", "float16" if DEVICE == "cuda" else "int8")
PARALLEL = max(1, int(os.environ.get("ASR_PARALLEL", "4")))
TOKEN = os.environ.get("ASR_TOKEN", "")
MAX_SECONDS = 60 * 60  # an hour of audio per request at most
MIN_WORD = 0.08
FILLER_PROMPT = {
    "en": "Umm, so, uh, I was like, I was thinking, hmm, you know, like, okay. So, um, yeah.",
    "es": "Eh, este, o sea, bueno, mmm, pues, eh, ¿sabes?, o sea, sí.",
}

# num_workers lets that many requests run on the model at the same time (one copy of the weights).
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, num_workers=PARALLEL)
slots = threading.BoundedSemaphore(PARALLEL)
busy = 0
busy_lock = threading.Lock()


def transcribe(pcm: bytes, language: str):
    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    duration = len(audio) / 16000
    segments, _ = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT.get(language),
        condition_on_previous_text=False,  # stops Whisper repeating itself on long takes
        vad_filter=False,  # pauses matter: the cutter decides what to drop
        beam_size=5,
        temperature=0.0,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            start = max(0.0, float(w.start))
            end = min(duration, max(float(w.end), start + MIN_WORD))
            if end > start:
                words.append({"text": text, "start": round(start, 3), "end": round(end, 3)})
    return words


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self.reply(200, {"ok": True, "model": MODEL, "device": DEVICE, "busy": busy, "parallel": PARALLEL})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        global busy
        url = urlparse(self.path)
        if url.path != "/transcribe":
            return self.reply(404, {"error": "not found"})
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.reply(401, {"error": "unauthorized"})
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0 or size > MAX_SECONDS * 16000 * 2 or size % 2:
            return self.reply(400, {"error": "send mono 16 kHz 16-bit PCM"})
        pcm = self.rfile.read(size)
        language = (parse_qs(url.query).get("language") or ["en"])[0][:5]
        # Full: say so straight away, so the worker tries again shortly (or uses Deepgram).
        if not slots.acquire(timeout=30):
            return self.reply(429, {"error": "busy"})
        with busy_lock:
            busy += 1
        try:
            self.reply(200, {"words": transcribe(pcm, language)})
        except Exception as err:  # noqa: BLE001
            self.reply(500, {"error": str(err)[:200]})
        finally:
            with busy_lock:
                busy -= 1
            slots.release()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Autocut ASR: {MODEL} on {DEVICE} ({COMPUTE}), {PARALLEL} at once, port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
