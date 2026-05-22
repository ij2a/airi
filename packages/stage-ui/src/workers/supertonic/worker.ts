/**
 * Supertonic TTS Web Worker Entry Point
 *
 * Uses the unified inference protocol from protocol.ts.
 * Synthesis is performed via the @huggingface/transformers text-to-speech pipeline.
 */

import type {
  ErrorResponse,
  InferenceResultResponse,
  LoadModelRequest,
  ModelReadyResponse,
  ProgressResponse,
  RunInferenceRequest,
  WorkerInboundMessage,
} from '../../libs/inference/protocol'
import type { VoiceId } from './types'

import { pipeline } from '@huggingface/transformers'
import { errorMessageFrom } from '@moeru/std'

import { MODEL_IDS, MODEL_NAMES } from '../../libs/inference/constants'
import { classifyError, isRecoverable } from '../../libs/inference/protocol'
import { DEFAULT_NUM_INFERENCE_STEPS, DEFAULT_SPEED, getVoiceEmbeddingUrl, wrapWithLanguageTag } from './constants'

// ---------------------------------------------------------------------------
// Inference-specific input/output types
// ---------------------------------------------------------------------------

export interface SupertonicGenerateInput {
  action: 'generate'
  text: string
  voiceId: VoiceId
  numInferenceSteps?: number
  speed?: number
  /** ISO language code — if omitted, auto-detected from text */
  lang?: string
}

export interface SupertonicGetVoicesInput {
  action: 'getVoices'
}

export type SupertonicInferenceInput = SupertonicGenerateInput | SupertonicGetVoicesInput

export interface SupertonicGenerateOutput {
  action: 'generate'
  samples: Float32Array
  samplingRate: number
}

export interface SupertonicVoicesOutput {
  action: 'getVoices'
}

export type SupertonicInferenceOutput = SupertonicGenerateOutput | SupertonicVoicesOutput

// ---------------------------------------------------------------------------
// Model singleton
// ---------------------------------------------------------------------------

// NOTICE: The transformers.js pipeline is not typed as a stable public interface.
// Using `any` here is unavoidable without importing internal pipeline types.
let ttsModel: any | null = null
let currentDevice: string | null = null

const cancelledRequestIds = new Set<string>()

function markCancelled(targetRequestId: string): void {
  cancelledRequestIds.add(targetRequestId)
  const msg: ErrorResponse = {
    type: 'error',
    requestId: targetRequestId,
    payload: {
      code: 'CANCELLED',
      message: 'Operation cancelled by caller',
      recoverable: false,
    },
  }
  globalThis.postMessage(msg)
}

function isCancelled(requestId: string): boolean {
  return cancelledRequestIds.has(requestId)
}

function clearCancelled(requestId: string): void {
  cancelledRequestIds.delete(requestId)
}

function sendError(requestId: string, error: unknown, phase?: 'load' | 'inference'): void {
  const message = errorMessageFrom(error) ?? 'Unknown error'
  const code = classifyError(error, phase)
  const msg: ErrorResponse = {
    type: 'error',
    requestId,
    payload: {
      code,
      message,
      recoverable: isRecoverable(code),
    },
  }
  globalThis.postMessage(msg)
}

async function loadModel(request: LoadModelRequest): Promise<void> {
  const { requestId, device } = request

  try {
    // Skip reload if same device is already loaded
    if (ttsModel && currentDevice === device) {
      if (isCancelled(requestId)) {
        clearCancelled(requestId)
        return
      }
      const ready: ModelReadyResponse = {
        type: 'model-ready',
        requestId,
        modelId: MODEL_NAMES.SUPERTONIC,
        device: device as 'webgpu' | 'wasm' | 'cpu',
      }
      globalThis.postMessage(ready)
      return
    }

    ttsModel = null

    // NOTICE: Supertonic uses the standard transformers.js text-to-speech pipeline.
    // The pipeline auto-selects WebGPU or WASM based on the device argument.
    // Unlike Kokoro, there is no dtype/quantization selection for this model.
    ttsModel = await pipeline('text-to-speech', MODEL_IDS.SUPERTONIC, {
      device,
      progress_callback: (progress: any) => {
        const msg: ProgressResponse = {
          type: 'progress',
          requestId,
          payload: {
            phase: 'download',
            // NOTICE: raw.progress from @huggingface/transformers is already 0-100
            percent: progress?.progress ?? -1,
            message: progress?.status,
            file: progress?.file,
            loaded: progress?.loaded,
            total: progress?.total,
          },
        }
        globalThis.postMessage(msg)
      },
    })

    currentDevice = device

    if (isCancelled(requestId)) {
      clearCancelled(requestId)
      return
    }

    const ready: ModelReadyResponse = {
      type: 'model-ready',
      requestId,
      modelId: MODEL_NAMES.SUPERTONIC,
      device: device as 'webgpu' | 'wasm' | 'cpu',
    }
    globalThis.postMessage(ready)
  }
  catch (error) {
    if (isCancelled(requestId))
      clearCancelled(requestId)
    else
      sendError(requestId, error, 'load')
  }
}

async function runInference(request: RunInferenceRequest<SupertonicInferenceInput>): Promise<void> {
  const { requestId, input } = request

  try {
    if (input.action === 'getVoices') {
      if (isCancelled(requestId)) {
        clearCancelled(requestId)
        return
      }
      // Voices are constants — no model state needed
      const result: InferenceResultResponse<SupertonicVoicesOutput> = {
        type: 'inference-result',
        requestId,
        output: { action: 'getVoices' },
      }
      globalThis.postMessage(result)
      return
    }

    // action === 'generate'
    if (!ttsModel)
      throw new Error('Supertonic TTS generation failed: No model loaded.')

    const { text, voiceId, numInferenceSteps, speed, lang } = input
    const speakerEmbeddingsUrl = getVoiceEmbeddingUrl(voiceId)

    // NOTICE: Supertonic v2 requires language tags around the input text for
    // correct phonemization. Without them the model defaults to English,
    // causing Korean and other non-Latin scripts to be skipped or mispronounced.
    // Reference: https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX
    const taggedText = wrapWithLanguageTag(text, lang as any)

    const audioResult = await ttsModel(taggedText, {
      speaker_embeddings: speakerEmbeddingsUrl,
      num_inference_steps: numInferenceSteps ?? DEFAULT_NUM_INFERENCE_STEPS,
      speed: speed ?? DEFAULT_SPEED,
    })

    if (isCancelled(requestId)) {
      clearCancelled(requestId)
      return
    }

    const samples = audioResult.audio as Float32Array
    const samplingRate = audioResult.sampling_rate as number

    const result: InferenceResultResponse<SupertonicGenerateOutput> = {
      type: 'inference-result',
      requestId,
      output: { action: 'generate', samples, samplingRate },
    }
    ;(globalThis as any).postMessage(result, [samples.buffer])
  }
  catch (error) {
    if (isCancelled(requestId))
      clearCancelled(requestId)
    else
      sendError(requestId, error, 'inference')
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

globalThis.addEventListener('message', async (event: MessageEvent<WorkerInboundMessage<SupertonicInferenceInput>>) => {
  const message = event.data

  switch (message.type) {
    case 'load-model':
      await loadModel(message)
      break
    case 'run-inference':
      await runInference(message as RunInferenceRequest<SupertonicInferenceInput>)
      break
    case 'unload-model':
      ttsModel = null
      currentDevice = null
      globalThis.postMessage({ type: 'model-unloaded', requestId: message.requestId })
      break
    case 'cancel':
      markCancelled(message.targetRequestId)
      break
    default:
      console.warn('[Supertonic Worker] Unknown message type:', (message as any).type)
  }
})
