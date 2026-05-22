/**
 * Whisper ASR Web Worker — patched entry point.
 *
 * This file replaces a simple `import '@xsai-transformers/transcription/worker'`
 * because the upstream worker contains a critical bug in `base64ToFeatures()`:
 *
 *   const samples = Int16Array.from(pcmBuffer.slice(0, alignedLength))
 *
 * `pcmBuffer` is an `ArrayBuffer`. `ArrayBuffer` has no `Symbol.iterator` and no
 * numeric `length` property, so `Int16Array.from(ArrayBuffer)` silently produces an
 * EMPTY typed array regardless of the buffer's contents. The audio sent to the
 * HuggingFace pipeline is therefore always zero-length, causing Whisper to
 * hallucinate "you" (its bias response to silence).
 *
 * NOTICE:
 * Root cause: `Int16Array.from(source)` follows the ECMAScript %TypedArray%.from spec:
 *   1. Check `source[Symbol.iterator]` → undefined for ArrayBuffer
 *   2. Fall back to array-like: `ToLength(source.length)` → 0 (ArrayBuffer has no .length)
 *   3. Result: Int16Array of length 0
 * The correct idiom is `new Int16Array(arrayBuffer)` which creates a VIEW of the buffer,
 * interpreting every 2 bytes as one signed 16-bit integer.
 * Upstream: node_modules/@xsai-transformers/transcription/dist/worker/index.js line 28
 * Removal condition: when the upstream package ships a fixed version.
 *
 * Vite bundles this file as a separate worker chunk via the
 * `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` pattern.
 *
 * Call stack:
 * providers.ts getWhisperProvider()
 *   → createTranscriptionProvider({ worker: new Worker(this file) })
 *     → @xsai-transformers/transcription index.js (provider side)
 *       → eventa IPC → this worker
 */

import { full, pipeline, TextStreamer } from '@huggingface/transformers'
import { defineInvokeEventa, defineInvokeHandler, defineStreamInvokeHandler, toStreamHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'
import { decodeBase64 } from '@moeru/std/base64'
import { merge } from '@moeru/std/merge'
import { isWebGPUSupported } from 'gpuu/webgpu'

// Mirror the RPC definition names from @xsai-transformers/transcription/dist/rpc-*.js
// so the provider (main thread) and this worker share the same eventa channel IDs.
const load = defineInvokeEventa('load')
const transcribe = defineInvokeEventa('transcribe')

const MAX_NEW_TOKENS = 64

const { context } = createContext()

/** Returns true when the Uint8Array begins with a valid RIFF/WAVE header. */
function isWavFormat(bytes: Uint8Array): boolean {
  return bytes.length > 44
    // 'R', 'I', 'F', 'F'
    && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    // 'W', 'A', 'V', 'E'
    && bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69
}

/**
 * Decode base64-encoded audio and return Float32 samples suitable for the
 * HuggingFace Automatic Speech Recognition pipeline.
 *
 * Accepts PCM16 WAV (produced by convertToWhisperWav) or raw PCM16 bytes.
 *
 * NOTICE: Upstream uses `Int16Array.from(arrayBuffer)` which always produces
 * an empty array (ArrayBuffer is not iterable). Fixed here with `new Int16Array(buffer)`
 * which creates a view that correctly interprets every 2 bytes as one Int16 sample.
 */
function base64ToFeatures(base64Audio: string): Float32Array {
  const bytes = decodeBase64(base64Audio)

  // Slice carefully using byteOffset in case decodeBase64 returns a view into a
  // pooled buffer (byteOffset !== 0).
  const dataStart = bytes.byteOffset + (isWavFormat(bytes) ? 44 : 0)
  const dataEnd = bytes.byteOffset + bytes.byteLength
  const pcmBuffer = bytes.buffer.slice(dataStart, dataEnd)

  // NOTICE: `new Int16Array(arrayBuffer)` creates a typed array VIEW — every 2 bytes
  // become one signed 16-bit integer. This is what the upstream intended but broke.
  // `Int16Array.from(arrayBuffer)` (the upstream code) = Int16Array(0) because
  // ArrayBuffer has no Symbol.iterator and no .length property.
  const samples = new Int16Array(pcmBuffer)

  return Float32Array.from(samples, s => s / 32768)
}

let asr: any

defineStreamInvokeHandler(
  context,
  load,

  toStreamHandler(async ({ emit, payload: { modelId, options } }: any) => {
    const device = (await isWebGPUSupported()) ? 'webgpu' : 'wasm' as const
    const opts = merge(
      {
        device,

        progress_callback: (progress: any) => {
          emit({ data: { progress }, type: 'progress' })
        },
      },
      options,
    )

    emit({ data: { message: `Using device: "${device}"` }, type: 'info' })
    emit({ data: { message: 'Loading models...' }, type: 'info' })

    asr = await pipeline('automatic-speech-recognition', modelId, opts as any)

    // Warm-up generation to pre-compile shaders / kernels.
    // whisper-large-v3 uses 128 mel bins; all others use 80.
    if (modelId.includes('whisper-large-v3')) {
      await asr.model.generate({ input_features: full([1, 128, 3000], 0), max_new_tokens: 1 })
    }
    else {
      await asr.model.generate({ input_features: full([1, 80, 3000], 0), max_new_tokens: 1 })
    }

    emit({ data: { message: 'Ready!', status: 'ready' }, type: 'status' })
  }),
)

defineInvokeHandler(context, transcribe, async ({ audio, options }: any) => {
  if (!asr)
    throw new Error('Model not loaded yet.')
  if (!audio || audio.length === 0)
    throw new TypeError('Invalid data format for transcribe message.')

  // 'auto' or absent → let Whisper auto-detect the spoken language.
  // Passing an explicit BCP-47/ISO 639-1 code forces Whisper to transcribe in
  // that language; omitting it enables the built-in language detection token.
  const language: string | undefined = (options?.language && options.language !== 'auto')
    ? options.language as string
    : undefined

  const audioData = base64ToFeatures(audio as string)
  const streamer = new TextStreamer(asr.tokenizer, {
    decode_kwargs: { skip_special_tokens: true },
    skip_prompt: true,
  })
  const inputs = await asr.processor(audioData)
  const outputs = await asr.model.generate({
    ...inputs,
    ...(language ? { language } : {}),
    max_new_tokens: MAX_NEW_TOKENS,
    streamer,
  })
  const outputText = asr.tokenizer.batch_decode(outputs, { skip_special_tokens: true })
  return { text: (outputText as string[]).join('') }
})
