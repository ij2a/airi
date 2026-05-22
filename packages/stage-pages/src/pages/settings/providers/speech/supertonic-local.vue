<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Callout } from '@proj-airi/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const providerId = 'supertonic-local'
const defaultModel = 'supertonic-3'
const defaultVoiceId = 'F1'
const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const { t } = useI18n()

const availableVoices = ref(speechStore.availableVoices[providerId] || [])
const voicesLoading = ref(false)

async function handleGenerateSpeech(input: string, voiceId: string, _useSSML: boolean) {
  try {
    const provider = await providersStore.getProviderInstance(providerId) as SpeechProvider
    if (!provider) {
      throw new Error('Failed to initialize Supertonic speech provider')
    }

    const config = providersStore.getProviderConfig(providerId)

    return await speechStore.speech(
      provider,
      defaultModel,
      input,
      voiceId,
      { ...config },
    )
  }
  catch (error) {
    console.error('[Supertonic Playground] Error generating speech:', error)
    throw error
  }
}

onMounted(async () => {
  try {
    voicesLoading.value = true

    const config = providersStore.getProviderConfig(providerId)
    const metadata = providersStore.getProviderMetadata(providerId)

    if (metadata.capabilities.loadModel) {
      await metadata.capabilities.loadModel(config, {
        onProgress: async (_progress) => {},
      })
    }

    // Mark provider as configured so it appears in the speech module's provider list.
    // Supertonic requires no credentials — validation always passes — but the provider
    // store only surfaces providers that have been explicitly activated. This call
    // sets isConfigured=true and calls markProviderAdded in a single step.
    providersStore.forceProviderConfigured(providerId)

    await speechStore.loadVoicesForProvider(providerId)
    availableVoices.value = speechStore.availableVoices[providerId] || []

    // Supertonic has a single fixed model. Persist it so the speech module
    // (modules/speech.vue) and the Stage.vue pipeline find a non-empty activeSpeechModel.
    // Only set if this provider is currently selected or no model is set yet.
    if (speechStore.activeSpeechProvider === providerId || !speechStore.activeSpeechModel) {
      speechStore.activeSpeechModel = defaultModel
    }

    // Seed a default voice when none is persisted yet so the conversation
    // pipeline can immediately synthesize speech without requiring a detour
    // through the module settings page.
    if (speechStore.activeSpeechProvider === providerId && !speechStore.activeSpeechVoiceId) {
      speechStore.activeSpeechVoiceId = defaultVoiceId
    }
  }
  catch (error) {
    console.error('[Supertonic Settings] Error loading model/voices:', error)
  }
  finally {
    voicesLoading.value = false
  }
})
</script>

<template>
  <SpeechProviderSettings
    :provider-id="providerId"
    :default-model="defaultModel"
  >
    <template #voice-settings>
      <Callout :label="t('settings.pages.providers.provider.supertonic-local.fields.info.label')">
        <div>
          <p>{{ t('settings.pages.providers.provider.supertonic-local.fields.info.description') }}</p>
        </div>
      </Callout>
    </template>

    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices"
        :generate-speech="handleGenerateSpeech"
        :api-key-configured="true"
        :voices-loading="voicesLoading"
        :default-text="t('settings.pages.providers.provider.supertonic-local.playground.default-text')"
      />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
  meta:
    layout: settings
    stageTransition:
      name: slide
</route>
