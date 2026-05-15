<script setup lang="ts">
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { animations } from '@proj-airi/stage-ui-three'
import { ref } from 'vue'

import ModelSettingsPanel from './panel.vue'
import ModelSettingsPreviewStage from './preview-stage.vue'

import { Emotion, EMOTION_VRMExpressionName_value } from '../../../../constants/emotions'
import { createEmptyModelSettingsRuntimeSnapshot } from './runtime'

withDefaults(defineProps<{
  palette: string[]
  settingsClass?: string | string[]
  allowExtractColors?: boolean
  live2dSceneClass?: string | string[]
  vrmSceneClass?: string | string[]
}>(), {
  allowExtractColors: true,
})

defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

const EMOTION_ANIMATION_URL: Partial<Record<Emotion, string>> = {
  [Emotion.Happy]: animations.clapping.href,
  [Emotion.Sad]: animations.sad.href,
  [Emotion.Angry]: animations.angry.href,
  [Emotion.Think]: animations.thinking.href,
  [Emotion.Surprise]: animations.surprised.href,
  [Emotion.Neutral]: animations.relax.href,
  [Emotion.Awkward]: animations.blush.href,
  [Emotion.Curious]: animations.lookAround.href,
}

const previewStageRef = ref<{
  capturePreviewFrame: () => Promise<Blob | undefined>
  setExpression: (expression: string, intensity?: number) => void
  playAnimation: (url: string, fadeSeconds?: number) => void
}>()
const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())

async function capturePreviewFrame() {
  return previewStageRef.value?.capturePreviewFrame()
}

function handleRuntimeSnapshotChanged(nextSnapshot: ModelSettingsRuntimeSnapshot) {
  runtimeSnapshot.value = nextSnapshot
}

function handleTestEmotion(emotion: string) {
  const expression = EMOTION_VRMExpressionName_value[emotion as Emotion]
  if (expression)
    previewStageRef.value?.setExpression(expression)

  const animUrl = EMOTION_ANIMATION_URL[emotion as Emotion]
  if (animUrl)
    previewStageRef.value?.playAnimation(animUrl)
}

defineExpose({
  capturePreviewFrame,
})
</script>

<template>
  <ModelSettingsPanel
    :allow-extract-colors="allowExtractColors"
    :palette="palette"
    :runtime-snapshot="runtimeSnapshot"
    :settings-class="settingsClass"
    @extract-colors-from-model="$emit('extractColorsFromModel')"
    @test-emotion="handleTestEmotion"
  />
  <ModelSettingsPreviewStage
    ref="previewStageRef"
    :live2d-scene-class="live2dSceneClass"
    :vrm-scene-class="vrmSceneClass"
    @runtime-snapshot-changed="handleRuntimeSnapshotChanged"
  />
</template>
