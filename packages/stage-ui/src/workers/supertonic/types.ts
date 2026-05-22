/**
 * Supertonic TTS domain types.
 *
 * Worker communication uses the unified protocol from protocol.ts.
 * These types define the domain-specific data structures (voices, etc.).
 */

export type VoiceId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5'

export interface SupertonicVoice {
  id: VoiceId
  name: string
  gender: 'male' | 'female'
}
