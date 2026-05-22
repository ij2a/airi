/**
 * Supertonic TTS inference adapter.
 *
 * Uses the unified inference protocol from protocol.ts.
 * Backed by a Web Worker running the @huggingface/transformers text-to-speech pipeline.
 *
 * Call stack:
 *
 * getSupertonicAdapter()
 *   -> {@link createSupertonicAdapter}
 *     -> loadModel / generate
 *       -> Worker (supertonic/worker.ts)
 *         -> @huggingface/transformers pipeline('text-to-speech')
 */

import type { SupertonicVoice, VoiceId } from '../../../workers/supertonic/types'
import type { AllocationToken } from '../gpu-resource-coordinator'
import type { ProgressPayload } from '../protocol'

import { defaultPerfTracer } from '@proj-airi/stage-shared'
import { Mutex } from 'async-mutex'

import { removeInferenceStatus, updateInferenceStatus } from '../../../composables/use-inference-status'
import { SUPERTONIC_VOICES } from '../../../workers/supertonic/constants'
import { MAX_RESTARTS, MODEL_NAMES, RESTART_DELAY_MS, TIMEOUTS } from '../constants'
import { getGPUCoordinator, getLoadQueue, MODEL_VRAM_ESTIMATES } from '../coordinator'
import { LOAD_PRIORITY } from '../load-queue'
import { classifyDeviceLossReason, classifyError, createRequestId, InferenceAbortError, throwIfAborted } from '../protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupertonicAdapter {
  /**
   * Load the Supertonic model on the given device.
   *
   * Use when:
   * - The provider is first activated
   * - The device changes (e.g. WASM fallback after WebGPU failure)
   *
   * Expects:
   * - `options.signal` to cancel mid-load
   *
   * Returns:
   * - The list of available preset voices
   */
  loadModel: (
    device: string,
    options?: {
      onProgress?: (p: ProgressPayload) => void
      signal?: AbortSignal
    },
  ) => Promise<SupertonicVoice[]>

  /**
   * Synthesize speech from text with the given voice.
   *
   * Use when:
   * - The model is loaded and a voice is selected
   *
   * Returns:
   * - WAV-encoded audio as an ArrayBuffer
   */
  generate: (
    text: string,
    voiceId: VoiceId,
    options?: {
      numInferenceSteps?: number
      speed?: number
      /** ISO language code (e.g. "ko", "en"). Auto-detected from text if omitted. */
      lang?: string
      signal?: AbortSignal
    },
  ) => Promise<ArrayBuffer>

  /** Get the list of available preset voices */
  getVoices: () => SupertonicVoice[]

  /** Terminate the worker */
  terminate: () => void

  /** Current adapter state */
  readonly state: 'idle' | 'loading' | 'ready' | 'running' | 'error' | 'terminated'

  /** Last successful load device, or null if never loaded */
  readonly manifest: { device: string } | null

  /** Number of WebGPU device-loss events observed */
  readonly deviceLossCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOAD_MODEL_TIMEOUT = TIMEOUTS.SUPERTONIC_LOAD
const GENERATE_TIMEOUT = TIMEOUTS.SUPERTONIC_GENERATE

const DEVICE_LOSS_WASM_THRESHOLD = 2

// ---------------------------------------------------------------------------
// Audio Encoding
// ---------------------------------------------------------------------------

/**
 * Encode raw PCM Float32Array samples into a WAV ArrayBuffer.
 */
function encodeWav(samples: Float32Array, sampleRate: number, numChannels = 1): ArrayBuffer {
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataLength = samples.length * bytesPerSample
  const headerLength = 44
  const buffer = new ArrayBuffer(headerLength + dataLength)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')

  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitsPerSample, true)

  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  const output = new Int16Array(buffer, headerLength)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

// ---------------------------------------------------------------------------
// Worker message helper
// ---------------------------------------------------------------------------

function waitForWorkerMessage<T = any>(
  worker: Worker,
  requestId: string,
  targetType: string,
  timeout: number,
  callback?: (data: any) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | null = null

    // NOTICE: cleanup and handler are mutually recursive — cleanup removes the
    // handler listener, and handler calls cleanup on completion. We declare cleanup
    // as a `let` so handler (defined first) can reference it safely. By the time
    // addEventListener fires, cleanup is always assigned.
    let cleanup!: () => void

    const handler = (event: MessageEvent): void => {
      if (event.data.requestId !== requestId)
        return

      if (event.data.type === targetType) {
        cleanup()
        resolve(event.data as T)
      }
      else if (event.data.type === 'error') {
        cleanup()
        const code = event.data.payload?.code
        if (code === 'CANCELLED')
          reject(new InferenceAbortError(event.data.payload?.message))
        else
          reject(new Error(event.data.payload?.message ?? 'Worker error'))
      }
      else {
        callback?.(event.data)
      }
    }

    cleanup = (): void => {
      if (timeoutId !== undefined)
        clearTimeout(timeoutId)
      worker.removeEventListener('message', handler)
      if (abortListener && signal)
        signal.removeEventListener('abort', abortListener)
    }

    worker.addEventListener('message', handler)

    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Supertonic: timeout after ${timeout}ms waiting for '${targetType}'`))
    }, timeout)

    if (signal) {
      if (signal.aborted) {
        cleanup()
        worker.postMessage({ type: 'cancel', requestId: createRequestId(), targetRequestId: requestId })
        reject(new InferenceAbortError(typeof signal.reason === 'string' ? signal.reason : undefined))
        return
      }
      abortListener = () => {
        cleanup()
        worker.postMessage({ type: 'cancel', requestId: createRequestId(), targetRequestId: requestId })
        const reason = signal.reason
        reject(reason instanceof Error ? reason : new InferenceAbortError(typeof reason === 'string' ? reason : undefined))
      }
      signal.addEventListener('abort', abortListener)
    }
  })
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface SupertonicManifest {
  device: string
}

export function createSupertonicAdapter(): SupertonicAdapter {
  let worker: Worker | null = null
  let state: SupertonicAdapter['state'] = 'idle'
  let restartAttempts = 0
  let allocationToken: AllocationToken | null = null
  let currentModelStatusId: string | null = null
  let errorListener: ((event: ErrorEvent) => void) | null = null
  let lastManifest: SupertonicManifest | null = null
  let deviceLossCount = 0

  const operationMutex = new Mutex()
  const lifecycleMutex = new Mutex()

  function initializeWorker(): void {
    worker = new Worker(
      new URL('../../../workers/supertonic/worker.ts', import.meta.url),
      { type: 'module' },
    )
    errorListener = (event: ErrorEvent) => handleWorkerError(event)
    worker.addEventListener('error', errorListener)
  }

  function handleWorkerError(event: ErrorEvent | Error): void {
    state = 'error'
    operationMutex.cancel()

    const code = classifyError(event instanceof Error ? event : (event as ErrorEvent).error ?? event)
    if (code === 'DEVICE_LOST') {
      deviceLossCount++
      getGPUCoordinator().recordDeviceLoss({
        modelId: currentModelStatusId ?? MODEL_NAMES.SUPERTONIC,
        reason: classifyDeviceLossReason(event instanceof Error ? event : (event as ErrorEvent).error ?? event),
        occurredAt: Date.now(),
      })
    }

    destroyWorker()
    scheduleRestart()
  }

  function destroyWorker(): void {
    if (worker) {
      if (errorListener)
        worker.removeEventListener('error', errorListener)
      errorListener = null
      worker.terminate()
      worker = null
    }
  }

  function scheduleRestart(): void {
    if (restartAttempts >= MAX_RESTARTS) {
      console.error(`[SupertonicAdapter] Max restart attempts (${MAX_RESTARTS}) reached.`)
      state = 'terminated'
      return
    }

    restartAttempts++
    const delay = RESTART_DELAY_MS * restartAttempts

    console.warn(
      `[SupertonicAdapter] Restarting in ${delay}ms `
      + `(attempt ${restartAttempts}/${MAX_RESTARTS})`,
    )

    setTimeout(() => {
      ensureStarted().catch((err) => {
        console.error('[SupertonicAdapter] Restart failed:', err)
      })
    }, delay)
  }

  function onSuccess(): void {
    restartAttempts = 0
  }

  async function ensureStarted(): Promise<void> {
    await lifecycleMutex.runExclusive(async () => {
      if (!worker) {
        initializeWorker()
        state = 'idle'
      }
    })
  }

  // -- Public API -----------------------------------------------------------

  async function loadModel(
    device: string,
    options?: {
      onProgress?: (p: ProgressPayload) => void
      signal?: AbortSignal
    },
  ): Promise<SupertonicVoice[]> {
    // NOTICE: Proactive WASM promotion after repeated WebGPU device-loss events.
    let effectiveDevice = device
    if (device === 'webgpu' && deviceLossCount >= DEVICE_LOSS_WASM_THRESHOLD) {
      console.warn(
        `[SupertonicAdapter] ${deviceLossCount} device-loss events recorded, `
        + `promoting load from webgpu to wasm.`,
      )
      effectiveDevice = 'wasm'
    }

    throwIfAborted(options?.signal)
    await ensureStarted()

    return defaultPerfTracer.withMeasure('inference', 'supertonic-load-model', () => operationMutex.runExclusive(async () => {
      throwIfAborted(options?.signal)
      state = 'loading'
      const modelStatusId = MODEL_NAMES.SUPERTONIC

      if (currentModelStatusId && currentModelStatusId !== modelStatusId)
        removeInferenceStatus(currentModelStatusId)
      currentModelStatusId = modelStatusId

      updateInferenceStatus(modelStatusId, { state: 'downloading', device: effectiveDevice as any })

      return getLoadQueue().enqueue(modelStatusId, LOAD_PRIORITY.TTS, async () => {
        throwIfAborted(options?.signal)
        const requestId = createRequestId()

        const readyPromise = waitForWorkerMessage<any>(worker!, requestId, 'model-ready', LOAD_MODEL_TIMEOUT, (data) => {
          if (data.type === 'progress') {
            const payload = data.payload
            const progress: ProgressPayload = {
              phase: payload.phase ?? 'download',
              percent: payload.percent ?? -1,
              message: payload.message,
              file: payload.file,
              loaded: payload.loaded,
              total: payload.total,
            }
            updateInferenceStatus(modelStatusId, { progress })
            options?.onProgress?.(progress)
          }
        }, options?.signal)

        worker!.postMessage({
          type: 'load-model',
          requestId,
          modelId: MODEL_NAMES.SUPERTONIC,
          device: effectiveDevice,
        })

        await readyPromise

        const coordinator = getGPUCoordinator()
        if (allocationToken)
          coordinator.release(allocationToken)
        const estimated = MODEL_VRAM_ESTIMATES[MODEL_NAMES.SUPERTONIC] ?? 200 * 1024 * 1024
        allocationToken = coordinator.requestAllocation(MODEL_NAMES.SUPERTONIC, estimated)

        lastManifest = { device: effectiveDevice }
        state = 'ready'
        updateInferenceStatus(modelStatusId, { state: 'ready', device: effectiveDevice as any })
        onSuccess()

        return SUPERTONIC_VOICES
      }, { signal: options?.signal })
    }), { device: effectiveDevice }).catch((error) => {
      if ((error as Error)?.name === 'AbortError')
        throw error
      handleWorkerError(error instanceof Error ? error : new Error(String(error)))
      throw error
    })
  }

  async function generate(
    text: string,
    voiceId: VoiceId,
    options?: {
      numInferenceSteps?: number
      speed?: number
      lang?: string
      signal?: AbortSignal
    },
  ): Promise<ArrayBuffer> {
    throwIfAborted(options?.signal)
    const notReadyError = new Error('Model not loaded. Call loadModel() first.')

    return defaultPerfTracer.withMeasure('inference', 'supertonic-generate', () => operationMutex.runExclusive(async () => {
      throwIfAborted(options?.signal)
      if (!worker || state !== 'ready')
        throw notReadyError

      if (allocationToken)
        getGPUCoordinator().touch(allocationToken.modelId)

      state = 'running'
      const requestId = createRequestId()

      const resultPromise = waitForWorkerMessage<any>(
        worker,
        requestId,
        'inference-result',
        GENERATE_TIMEOUT,
        undefined,
        options?.signal,
      )

      worker.postMessage({
        type: 'run-inference',
        requestId,
        input: {
          action: 'generate',
          text,
          voiceId,
          numInferenceSteps: options?.numInferenceSteps,
          speed: options?.speed,
          lang: options?.lang,
        },
      })

      const response = await resultPromise
      const output = response.output

      if (output.action === 'generate') {
        state = 'ready'
        onSuccess()
        return encodeWav(output.samples as Float32Array, output.samplingRate as number)
      }

      throw new Error(`[Supertonic] Unexpected output action: ${output.action}`)
    }), { text: text.slice(0, 50), voiceId }).catch((error) => {
      if (error === notReadyError)
        throw error

      handleWorkerError(error instanceof Error ? error : new Error(String(error)))
      throw error
    })
  }

  function getVoices(): SupertonicVoice[] {
    return SUPERTONIC_VOICES
  }

  function terminateAdapter(): void {
    operationMutex.cancel()
    destroyWorker()
    if (allocationToken) {
      removeInferenceStatus(allocationToken.modelId)
      getGPUCoordinator().release(allocationToken)
      allocationToken = null
    }
    state = 'terminated'
  }

  return {
    loadModel,
    generate,
    getVoices,
    terminate: terminateAdapter,
    get state() { return state },
    get manifest() { return lastManifest },
    get deviceLossCount() { return deviceLossCount },
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalAdapter: SupertonicAdapter | null = null
const singletonMutex = new Mutex()

/**
 * Get the global Supertonic adapter instance.
 * Creates and starts the worker on first call.
 * Automatically re-creates the adapter if it has entered a terminal state.
 */
export async function getSupertonicAdapter(): Promise<SupertonicAdapter> {
  return singletonMutex.runExclusive(async () => {
    if (
      !globalAdapter
      || globalAdapter.state === 'terminated'
      || globalAdapter.state === 'error'
    ) {
      globalAdapter = createSupertonicAdapter()
    }
    return globalAdapter
  })
}
