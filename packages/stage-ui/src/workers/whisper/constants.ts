import type { ModelInfo } from '../../stores/providers'

/** A single available Whisper model variant. */
export interface WhisperModel {
  /** HuggingFace model ID (e.g. `onnx-community/whisper-tiny`) */
  id: string
  /** Human-readable display name */
  name: string
  /** Approximate download size label shown in the UI */
  sizeLabel: string
  /** i18n key for the model description */
  descriptionKey: string
}

/**
 * Available Whisper ONNX models in ascending size order.
 * All are hosted under `onnx-community` on HuggingFace and run via
 * @xsai-transformers/transcription (WebGPU with WASM fallback).
 */
export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'onnx-community/whisper-tiny',
    name: 'Whisper Tiny',
    sizeLabel: '~39 MB',
    descriptionKey: 'settings.pages.providers.provider.browser-local-audio-transcription.models.whisper-tiny.description',
  },
  {
    id: 'onnx-community/whisper-base',
    name: 'Whisper Base',
    sizeLabel: '~74 MB',
    descriptionKey: 'settings.pages.providers.provider.browser-local-audio-transcription.models.whisper-base.description',
  },
  {
    id: 'onnx-community/whisper-small',
    name: 'Whisper Small',
    sizeLabel: '~244 MB',
    descriptionKey: 'settings.pages.providers.provider.browser-local-audio-transcription.models.whisper-small.description',
  },
  {
    id: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    sizeLabel: '~809 MB',
    descriptionKey: 'settings.pages.providers.provider.browser-local-audio-transcription.models.whisper-large-v3-turbo.description',
  },
]

/** Default model used when no model is configured. */
export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0].id

/** Selectable languages for Whisper transcription. */
export interface WhisperLanguageOption {
  /** Display label shown in the UI */
  label: string
  /** ISO 639-1 language code, or `'auto'` for auto-detection */
  value: string
}

/**
 * Language options for Whisper transcription, ordered by common usage.
 * `'auto'` lets Whisper run its built-in language detection token.
 */
export const WHISPER_LANGUAGE_OPTIONS: WhisperLanguageOption[] = [
  { label: 'Auto-detect', value: 'auto' },
  { label: '한국어 (Korean)', value: 'ko' },
  { label: 'English', value: 'en' },
  { label: '日本語 (Japanese)', value: 'ja' },
  { label: '中文 (Chinese)', value: 'zh' },
  { label: 'Español (Spanish)', value: 'es' },
  { label: 'Français (French)', value: 'fr' },
  { label: 'Deutsch (German)', value: 'de' },
  { label: 'Português (Portuguese)', value: 'pt' },
  { label: 'Русский (Russian)', value: 'ru' },
  { label: 'Italiano (Italian)', value: 'it' },
  { label: 'Nederlands (Dutch)', value: 'nl' },
  { label: 'Polski (Polish)', value: 'pl' },
  { label: 'Türkçe (Turkish)', value: 'tr' },
  { label: 'Tiếng Việt (Vietnamese)', value: 'vi' },
]

/** Default language — auto-detect. */
export const DEFAULT_WHISPER_LANGUAGE = 'auto'

/**
 * Convert WHISPER_MODELS to the shared ModelInfo shape expected by the
 * providers store's `capabilities.listModels` return type.
 */
export function whisperModelsToModelInfo(): ModelInfo[] {
  return WHISPER_MODELS.map(m => ({
    id: m.id,
    name: `${m.name} (${m.sizeLabel})`,
    provider: 'browser-local-audio-transcription',
    description: '',
    contextLength: 0,
    deprecated: false,
  }))
}
