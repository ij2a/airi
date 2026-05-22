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
