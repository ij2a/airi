import type { VRMCore } from '@pixiv/three-vrm-core'

import { Euler, MathUtils, Quaternion } from 'three'

/**
 * Maximum head yaw (left/right) in radians — ~22.5°.
 */
const MAX_YAW = Math.PI / 8

/**
 * Maximum head pitch (up/down) in radians — ~15°.
 */
const MAX_PITCH = Math.PI / 12

/**
 * Exponential smoothing speed (rad/s). Higher = snappier, lower = floatier.
 */
const TRACKING_SPEED = 5

/**
 * Fraction of rotation distributed to neck vs. head.
 * VTuber convention: neck takes ~35%, head takes the rest.
 */
const NECK_SHARE = 0.35
const HEAD_SHARE = 1 - NECK_SHARE

// Module-level scratch objects to avoid per-frame GC pressure.
const _trackingEuler = new Euler(0, 0, 0, 'YXZ')
const _trackingQuat = new Quaternion()

/**
 * Mouse-driven head and neck tracking for VRM models.
 *
 * Takes normalized screen coordinates ([-1, 1] range, matching Live2D's
 * `focus(x, y)` convention) and rotates the `head` and `neck` normalized
 * bones accordingly every frame.
 *
 * Must be called **after** `AnimationMixer.update()` and **before**
 * `VRMHumanoid.update()` so the quaternion writes are picked up by the
 * humanoid's normalized→raw bone mapping.
 *
 * Bone quaternions are **set** (not accumulated via multiply) each frame so
 * values never drift across frames — avoiding the "infinite spin" that occurs
 * when the animation clip does not reset these bones itself.
 *
 * Use when:
 * - `trackingMode === 'mouse'` and you want the head to follow the cursor,
 *   not just the eyes.
 * - Pass `(0, 0)` to smoothly return the head to the neutral forward pose.
 *
 * Expects:
 * - `screenNormX`: normalized horizontal position, -1 = left edge, +1 = right edge.
 * - `screenNormY`: normalized vertical position, -1 = bottom, +1 = top.
 * - Called once per render frame with a valid `delta` (seconds).
 *
 * Returns:
 * - `{ update }` — no-op when VRM or head bone is absent.
 */
export function useHeadTracking() {
  // Plain numbers — no Vue reactivity; pure per-frame animation state.
  let targetYaw = 0
  let targetPitch = 0
  let currentYaw = 0
  let currentPitch = 0

  function update(
    vrm: VRMCore | undefined,
    /** Normalized screen X: -1 = left edge of screen, +1 = right edge. */
    screenNormX: number,
    /** Normalized screen Y: -1 = bottom of screen, +1 = top. */
    screenNormY: number,
    delta: number,
  ) {
    if (!vrm?.humanoid)
      return

    const head = vrm.humanoid.getNormalizedBoneNode('head')
    if (!head)
      return

    // ── Map screen coords to target angles ────────────────────────────────
    // Yaw: mouse right (+X) → character turns right → negative Y rotation in
    // Three.js right-hand rule (positive Y rotates CCW from above = turns LEFT).
    targetYaw = MathUtils.clamp(screenNormX * MAX_YAW, -MAX_YAW, MAX_YAW)
    // Pitch: mouse up (+Y) → character looks up → positive X rotation.
    targetPitch = MathUtils.clamp(screenNormY * MAX_PITCH, -MAX_PITCH, MAX_PITCH)

    // ── Exponential smoothing ──────────────────────────────────────────────
    // Frame-rate independent: approaches target at TRACKING_SPEED rad/s.
    const t = 1 - Math.exp(-TRACKING_SPEED * delta)
    currentYaw += (targetYaw - currentYaw) * t
    currentPitch += (targetPitch - currentPitch) * t

    // ── Apply to bones ─────────────────────────────────────────────────────
    // SET (not multiply) so values are idempotent across frames.
    // Using multiply would cause the rotation to accumulate whenever the
    // AnimationMixer does not reset the bone — resulting in infinite spin.
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')

    if (neck) {
      _trackingEuler.set(currentPitch * NECK_SHARE, currentYaw * NECK_SHARE, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      neck.quaternion.copy(_trackingQuat)

      _trackingEuler.set(currentPitch * HEAD_SHARE, currentYaw * HEAD_SHARE, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      head.quaternion.copy(_trackingQuat)
    }
    else {
      _trackingEuler.set(currentPitch, currentYaw, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      head.quaternion.copy(_trackingQuat)
    }
  }

  return { update }
}
