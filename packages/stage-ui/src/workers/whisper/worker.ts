/**
 * Whisper ASR Web Worker Entry Point
 *
 * Re-exports the @xsai-transformers/transcription worker which registers
 * @moeru/eventa-based handlers for `load` (stream) and `transcribe` (invoke).
 * Vite bundles this file as a separate worker chunk via the
 * `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` pattern.
 */
import '@xsai-transformers/transcription/worker'
