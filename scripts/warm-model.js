// Downloads the Whisper model into .models at build time so the first real cut doesn't wait.
import { transcribe } from '../src/transcribe.js';

await transcribe(new Float32Array(16000));
console.log('Whisper model ready.');
