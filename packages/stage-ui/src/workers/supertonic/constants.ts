/**
 * Supertonic TTS constants.
 */

import type { SupertonicVoice, VoiceId } from './types'

import { MODEL_IDS } from '../../libs/inference/constants'

/** Default number of denoising steps. Higher values improve quality at the cost of speed (range: 1-50). */
export const DEFAULT_NUM_INFERENCE_STEPS = 8

/** Default speech rate multiplier (range: 0.8-1.2). */
export const DEFAULT_SPEED = 1.05

/**
 * All 10 preset Supertonic voice styles.
 * Embeddings are fetched at runtime from HuggingFace and cached by transformers.js.
 */
export const SUPERTONIC_VOICES: SupertonicVoice[] = [
  { id: 'F1', name: 'Female 1', gender: 'female' },
  { id: 'F2', name: 'Female 2', gender: 'female' },
  { id: 'F3', name: 'Female 3', gender: 'female' },
  { id: 'F4', name: 'Female 4', gender: 'female' },
  { id: 'F5', name: 'Female 5', gender: 'female' },
  { id: 'M1', name: 'Male 1', gender: 'male' },
  { id: 'M2', name: 'Male 2', gender: 'male' },
  { id: 'M3', name: 'Male 3', gender: 'male' },
  { id: 'M4', name: 'Male 4', gender: 'male' },
  { id: 'M5', name: 'Male 5', gender: 'male' },
]

/**
 * Returns the HuggingFace resolve URL for a Supertonic v2 voice embedding binary.
 *
 * Before:
 * - voiceId: "F1"
 *
 * After:
 * - "https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F1.bin"
 */
export function getVoiceEmbeddingUrl(voiceId: VoiceId): string {
  return `https://huggingface.co/${MODEL_IDS.SUPERTONIC}/resolve/main/voices/${voiceId}.bin`
}

/**
 * Language codes supported by Supertonic v2.
 * Text must be wrapped in the corresponding tag for correct phonemization.
 */
export const SUPERTONIC_LANGUAGES = ['en', 'ko', 'es', 'pt', 'fr'] as const
export type SupertonicLang = typeof SUPERTONIC_LANGUAGES[number]

/**
 * Detects the language of the input text using Unicode block heuristics,
 * then wraps it in the appropriate Supertonic language tag.
 *
 * Supertonic v2 requires text wrapped as `<lang>text</lang>` for correct
 * phonemization. Without a tag the model defaults to English processing,
 * which causes Korean/other scripts to be skipped or mispronounced.
 *
 * Before:
 * - "HANGUL_SAMPLE"
 *
 * After:
 * - "<ko>HANGUL_SAMPLE</ko>"
 *
 * Before:
 * - "Hello world"
 *
 * After:
 * - "<en>Hello world</en>"
 */
export function wrapWithLanguageTag(text: string, lang?: SupertonicLang): string {
  const detected = lang ?? detectLanguage(text)
  return `<${detected}>${text}</${detected}>`
}

/**
 * Detects language from text using Unicode block ranges.
 * Falls back to English when no specific script is detected.
 */
function detectLanguage(text: string): SupertonicLang {
  // Hangul syllables U+AC00-U+D7A3, Jamo U+1100-U+11FF, Compat Jamo U+3130-U+318F
  // NOTICE: \uXXXX escapes required -- regexp/no-obscure-range rejects literal CJK/Hangul ranges.
  const HANGUL = /[\u{AC00}-\u{D7A3}\u{1100}-\u{11FF}\u{3130}-\u{318F}]/u
  if (HANGUL.test(text))
    return 'ko'
  // French heuristic: accented characters common in French
  if (/[àâæçéèêëîïôœùûüÿ]/i.test(text))
    return 'fr'
  // Spanish heuristic: n with tilde, inverted question/exclamation marks
  if (/[ñ¿¡]/i.test(text))
    return 'es'
  return 'en'
}
