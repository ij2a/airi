import type { VRMCore } from '@pixiv/three-vrm-core'

import { Euler, MathUtils, Quaternion, Vector3 } from 'three'

/**
 * Maximum head yaw (left/right) in radians.
 * ~30° — beyond this the neck looks unnatural without full body turn.
 */
const MAX_YAW = Math.PI / 6

/**
 * Maximum head pitch (up/down) in radians.
 * ~20° — enough to follow cursor movement without exaggerated tilting.
 */
const MAX_PITCH = Math.PI / 9

/**
 * Exponential smoothing speed for head rotation lerp (radians/sec).
 * Higher = snappier; lower = more floaty.
 */
const TRACKING_SPEED = 6

/**
 * Fraction of total rotation given to neck vs. head.
 * VTuber convention: neck takes a third, head takes the rest.
 */
const NECK_SHARE = 0.35
const HEAD_SHARE = 1 - NECK_SHARE

const _headWorldPos = new Vector3()
const _dir = new Vector3()
const _trackingEuler = new Euler(0, 0, 0, 'YXZ')
const _trackingQuat = new Quaternion()

/**
 * Mouse-driven head tracking for VRM models.
 *
 * Rotates the normalized `head` (and optionally `neck`) bones toward a 3D
 * look-at target every frame.  Must be called **after** `AnimationMixer.update()`
 * and **before** `VRMHumanoid.update()` so that tracking stacks on top of the
 * running animation without fighting the humanoid's own bone mapping.
 *
 * Use when:
 * - `trackingMode` is `'mouse'` or `'camera'` and you want the head to follow
 *   the cursor/camera, not just the eyes.
 *
 * Expects:
 * - `lookAtTarget` is the same world-space position used by `useIdleEyeSaccades`.
 * - Called once per render frame with a valid `delta` (seconds since last frame).
 *
 * Returns:
 * - `{ update }` — call every frame; returns immediately when VRM is absent.
 */
export function useHeadTracking() {
  // Plain numbers — no Vue reactivity needed; this is pure per-frame animation state.
  let targetYaw = 0
  let targetPitch = 0
  let currentYaw = 0
  let currentPitch = 0

  function update(
    vrm: VRMCore | undefined,
    lookAtTarget: { x: number, y: number, z: number },
    delta: number,
  ) {
    if (!vrm?.humanoid)
      return

    const head = vrm.humanoid.getNormalizedBoneNode('head')
    if (!head)
      return

    // ── Compute target yaw / pitch ─────────────────────────────────────────
    // Head world position (used as the "eye" of the ray).
    head.updateMatrixWorld(true)
    head.getWorldPosition(_headWorldPos)

    _dir.set(
      lookAtTarget.x - _headWorldPos.x,
      lookAtTarget.y - _headWorldPos.y,
      lookAtTarget.z - _headWorldPos.z,
    ).normalize()

    // Yaw: angle around Y (positive = left in VRM's right-handed coordinate)
    targetYaw = Math.atan2(_dir.x, -_dir.z)
    // Pitch: angle around X (positive = down in VRM; negate to make "up" positive)
    targetPitch = -Math.asin(MathUtils.clamp(_dir.y, -1, 1))

    // Clamp to comfortable head-turn limits.
    targetYaw = MathUtils.clamp(targetYaw, -MAX_YAW, MAX_YAW)
    targetPitch = MathUtils.clamp(targetPitch, -MAX_PITCH, MAX_PITCH)

    // ── Smooth interpolation ───────────────────────────────────────────────
    // Exponential decay: frame-rate independent, approaches target at TRACKING_SPEED rad/s.
    const t = 1 - Math.exp(-TRACKING_SPEED * delta)
    currentYaw += (targetYaw - currentYaw) * t
    currentPitch += (targetPitch - currentPitch) * t

    // ── Apply rotations on top of the animation ────────────────────────────
    // The AnimationMixer has already written the clip's rotation into the
    // normalized bone quaternion.  We post-multiply our tracking offset so
    // the head always turns *relative to wherever the animation put it*.
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')

    if (neck) {
      // Split between neck and head for a natural multi-joint look.
      _trackingEuler.set(currentPitch * NECK_SHARE, currentYaw * NECK_SHARE, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      neck.quaternion.multiply(_trackingQuat)

      _trackingEuler.set(currentPitch * HEAD_SHARE, currentYaw * HEAD_SHARE, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      head.quaternion.multiply(_trackingQuat)
    }
    else {
      // No neck bone — apply all rotation to head.
      _trackingEuler.set(currentPitch, currentYaw, 0)
      _trackingQuat.setFromEuler(_trackingEuler)
      head.quaternion.multiply(_trackingQuat)
    }
  }

  return { update }
}
