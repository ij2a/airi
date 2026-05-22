/**
 * Audio conversion utilities for the browser-local Whisper transcription provider.
 *
 * The @xsai-transformers/transcription worker expects PCM16 WAV data at 16 kHz.
 * Browsers typically record at the device's native sample rate (~44.1/48 kHz) using
 * Float32 PCM when going through mediabunny's WavOutputFormat. Passing that data
 * directly causes the worker to misread the bytes as Int16, producing garbage audio
 * that Whisper hallucinates as "you" or similar short English words.
 */

/** Sample rate Whisper expects. */
const WHISPER_SAMPLE_RATE = 16000

/**
 * Convert any browser-recorded audio file to a 16 kHz mono PCM16 WAV.
 *
 * Use when:
 * - The source audio comes from the browser's MediaRecorder / mediabunny at ~48 kHz Float32
 * - The target is the @xsai-transformers/transcription worker which reads Int16 at 16 kHz
 *
 * Expects:
 * - A `File` or `Blob`-backed file the browser's `AudioContext` can decode (WAV, WebM, OGG, …)
 *
 * Returns:
 * - A new `File('recording.wav', 'audio/wav')` with RIFF/PCM16 payload at 16 kHz mono
 *
 * NOTICE:
 * @xsai-transformers/transcription worker's base64ToFeatures() does:
 *   `Int16Array.from(pcmBuffer.slice(0, alignedLength))` then divides by 32768.
 * mediabunny WavOutputFormat with codec:'pcm-f32' writes Float32 PCM at the device native rate.
 * Float32 bytes misread as Int16 → random garbage → "you" hallucination.
 * Fix: use AudioContext (auto-resamples to 16 kHz) + manual Float32→Int16 conversion.
 * See: node_modules/@xsai-transformers/transcription/dist/worker/index.js  base64ToFeatures()
 */
export async function convertToWhisperWav(file: File): Promise<File> {
  const audioCtx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE })
  try {
    // decodeAudioData automatically resamples to the context's sampleRate (16 kHz).
    const audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer())

    // Downmix to mono: take channel 0 only.
    const float32Samples = audioBuffer.getChannelData(0)

    // Convert Float32 [-1, 1] → Int16 [-32768, 32767].
    const int16Samples = new Int16Array(float32Samples.length)
    for (let i = 0; i < float32Samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32Samples[i]))
      int16Samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF
    }

    // Build a minimal RIFF/PCM16 WAV container.
    // Layout: RIFF header (12 B) + fmt chunk (24 B) + data chunk header (8 B) + samples
    const dataBytes = int16Samples.byteLength
    const wavBuffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(wavBuffer)

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++)
        view.setUint8(offset + i, str.charCodeAt(i))
    }

    // RIFF chunk
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + dataBytes, true) // total file size − 8
    writeStr(8, 'WAVE')
    // fmt sub-chunk
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // AudioFormat = PCM
    view.setUint16(22, 1, true) // NumChannels = 1 (mono)
    view.setUint32(24, WHISPER_SAMPLE_RATE, true) // SampleRate
    view.setUint32(28, WHISPER_SAMPLE_RATE * 2, true) // ByteRate = SampleRate × BlockAlign
    view.setUint16(32, 2, true) // BlockAlign = NumChannels × (BitsPerSample / 8)
    view.setUint16(34, 16, true) // BitsPerSample
    // data sub-chunk
    writeStr(36, 'data')
    view.setUint32(40, dataBytes, true)
    new Int16Array(wavBuffer, 44).set(int16Samples)

    return new File([wavBuffer], 'recording.wav', { type: 'audio/wav' })
  }
  finally {
    await audioCtx.close()
  }
}
