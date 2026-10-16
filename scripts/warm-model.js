// Downloads the Whisper model into .models at build time so the first real cut doesn't wait.
import { transcribe } from '../src/transcribe.js';

// Naming the model always uses Whisper (the backup), even when a Deepgram key is set at build time.
await transcribe(new Float32Array(16000), { model: 'onnx-community/whisper-small_timestamped' });
console.log('Whisper model ready.');
