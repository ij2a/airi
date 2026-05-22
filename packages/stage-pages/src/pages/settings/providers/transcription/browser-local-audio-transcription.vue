<script setup lang="ts">
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'
import {
  TranscriptionPlayground,
  TranscriptionProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { DEFAULT_WHISPER_MODEL } from '@proj-airi/stage-ui/workers/whisper/constants'
import { Callout, ComboboxSelect } from '@proj-airi/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const providerId = 'browser-local-audio-transcription'
const { t } = useI18n()
const hearingStore = useHearingStore()
const providersStore = useProvidersStore()

const providerConfig = computed(() => providersStore.getProviderConfig(providerId))

const model = computed({
  get: () => (providerConfig.value?.model as string | undefined) || DEFAULT_WHISPER_MODEL,
  set: (val) => { providerConfig.value.model = val },
})

// Language selection — 'auto' means no explicit language hint passed to Whisper
// (the worker auto-detects; absent an explicit hint it tends to favour English).
const language = computed({
  get: () => (providerConfig.value?.language as string | undefined) || 'auto',
  set: (val) => { providerConfig.value.language = val },
})

// Whisper supports 99 languages; listing the most common ones here.
// ISO 639-1 codes used by HuggingFace transformers.js.
const LANGUAGE_OPTIONS = [
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

const providerModels = computed(() => providersStore.getModelsForProvider(providerId))
const modelOptions = computed(() =>
  providerModels.value.map(m => ({ label: m.name, value: m.id })),
)

// Model loading state
const isLoadingModel = ref(false)
const loadError = ref('')
const loadProgress = ref<{ file: string, progress: number } | null>(null)

async function loadModel() {
  const metadata = providersStore.getProviderMetadata(providerId)
  if (!metadata?.capabilities?.loadModel)
    return

  try {
    isLoadingModel.value = true
    loadError.value = ''
    loadProgress.value = null

    await metadata.capabilities.loadModel(providerConfig.value, {
      onProgress: (progress) => {
        if (progress.status === 'progress') {
          loadProgress.value = { file: progress.file, progress: progress.progress }
        }
        if (progress.status === 'ready') {
          loadProgress.value = null
        }
      },
    })
  }
  catch (err) {
    loadError.value = errorMessageFrom(err) ?? 'Unknown error'
  }
  finally {
    isLoadingModel.value = false
  }
}

async function handleGenerateTranscription(file: File) {
  const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, any>>(providerId)
  if (!provider)
    throw new Error('Failed to initialize transcription provider')

  const modelToUse = (providerConfig.value?.model as string | undefined) || DEFAULT_WHISPER_MODEL
  const selectedLanguage = (providerConfig.value?.language as string | undefined) || 'auto'

  // Only pass an explicit language hint when the user chose a specific language.
  // Omitting it lets Whisper auto-detect (which may still favour English internally).
  const providerOptions = selectedLanguage !== 'auto'
    ? { language: selectedLanguage }
    : undefined

  return await hearingStore.transcription(
    providerId,
    provider,
    modelToUse,
    file,
    'json',
    providerOptions ? { providerOptions } : undefined,
  )
}

onMounted(async () => {
  await providersStore.fetchModelsForProvider(providerId)
  if (!providerConfig.value?.model) {
    providerConfig.value.model = DEFAULT_WHISPER_MODEL
  }
})

watch(model, (newVal) => {
  providerConfig.value.model = newVal
})

watch(language, (newVal) => {
  providerConfig.value.language = newVal
})
</script>

<template>
  <TranscriptionProviderSettings :provider-id="providerId">
    <template #basic-settings>
      <!-- Model selection -->
      <div class="space-y-3">
        <Callout :label="t('settings.pages.providers.provider.browser-local-audio-transcription.fields.field.model.label')">
          <p>{{ t('settings.pages.providers.provider.browser-local-audio-transcription.fields.field.model.description') }}</p>
        </Callout>
        <ComboboxSelect
          v-model="model"
          :options="modelOptions"
          :disabled="isLoadingModel"
          placeholder="Choose a model..."
        />
      </div>

      <!-- Language selection -->
      <div class="space-y-3">
        <Callout :label="t('settings.pages.providers.provider.browser-local-audio-transcription.fields.field.language.label')">
          <p>{{ t('settings.pages.providers.provider.browser-local-audio-transcription.fields.field.language.description') }}</p>
        </Callout>
        <ComboboxSelect
          v-model="language"
          :options="LANGUAGE_OPTIONS"
          placeholder="Select a language..."
        />
      </div>

      <!-- Load button + progress -->
      <div class="space-y-2">
        <button
          :disabled="isLoadingModel"
          :class="[
            'w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            isLoadingModel
              ? 'cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500'
              : 'bg-primary-500 text-white hover:bg-primary-600 dark:bg-primary-600 dark:hover:bg-primary-500',
          ]"
          @click="loadModel"
        >
          {{ isLoadingModel ? t('settings.pages.providers.provider.browser-local-audio-transcription.buttons.loading') : t('settings.pages.providers.provider.browser-local-audio-transcription.buttons.load') }}
        </button>

        <!-- Download progress -->
        <div v-if="loadProgress" class="space-y-1">
          <div class="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span class="truncate">{{ loadProgress.file }}</span>
            <span class="ml-2 shrink-0">{{ loadProgress.progress.toFixed(1) }}%</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              class="h-full rounded-full bg-primary-500 transition-all duration-200"
              :style="{ width: `${loadProgress.progress}%` }"
            />
          </div>
        </div>

        <!-- Load error -->
        <div v-if="loadError" class="border border-red-200 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {{ loadError }}
        </div>
      </div>
    </template>

    <template #playground>
      <TranscriptionPlayground
        :generate-transcription="handleGenerateTranscription"
        :api-key-configured="true"
      />
    </template>
  </TranscriptionProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
