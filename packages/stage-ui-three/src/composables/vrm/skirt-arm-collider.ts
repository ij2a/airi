import type { VrmHook } from './hooks'

import { VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere } from '@pixiv/three-vrm'

/**
 * Arm bone names (VRM humanoid standard) and their collider sphere radii.
 * Radii are in meters; typical VRM models are ~1.6–1.8 m tall.
 */
const ARM_COLLIDER_DEFS = [
  { bone: 'leftUpperArm' as const, radius: 0.07 },
  { bone: 'leftLowerArm' as const, radius: 0.06 },
  { bone: 'leftHand' as const, radius: 0.05 },
  { bone: 'rightUpperArm' as const, radius: 0.07 },
  { bone: 'rightLowerArm' as const, radius: 0.06 },
  { bone: 'rightHand' as const, radius: 0.05 },
]

/**
 * Spring bone joints whose names start with this prefix get the arm collider
 * group injected at load time.
 */
const SKIRT_BONE_PREFIX = 'Skirt_'

/**
 * VRM load hook that adds sphere colliders on the arm/hand bones and wires
 * them into every skirt spring-bone joint so the skirt can no longer clip
 * through the arms.
 *
 * How it works:
 * 1. For each arm bone, create a `VRMSpringBoneColliderShapeSphere` and attach
 *    it to the **raw** bone node (not the normalized proxy) so it moves with
 *    the actual skeleton.
 * 2. Collect all those colliders into one `VRMSpringBoneColliderGroup`.
 * 3. Push that group into every spring-bone joint whose bone name starts with
 *    `Skirt_`.
 *
 * The colliders are added to the raw scene tree so they are automatically
 * picked up by three-vrm's spring-bone solver each frame.
 */
export function createSkirtArmColliderHook(): VrmHook {
  return {
    onLoad({ vrm }) {
      const springBoneManager = vrm.springBoneManager
      if (!springBoneManager)
        return

      // ── Build colliders on each arm raw bone ──────────────────────────────
      const colliders = ARM_COLLIDER_DEFS.flatMap(({ bone, radius }) => {
        // Raw bone nodes follow the actual skeleton; normalized nodes are
        // proxy objects used by the humanoid animation system and do not
        // participate in the spring-bone solver scene.
        const node = vrm.humanoid.getRawBoneNode(bone)
        if (!node) {
          console.warn(`[skirt-arm-collider] bone not found: ${bone}`)
          return []
        }

        const collider = new VRMSpringBoneCollider(
          new VRMSpringBoneColliderShapeSphere({ radius }),
        )
        node.add(collider)
        return [collider]
      })

      if (colliders.length === 0)
        return

      // ── Register the collider group with the spring-bone manager ──────────
      const armColliderGroup = { name: 'arm-colliders', colliders }
      springBoneManager.colliderGroups.push(armColliderGroup)

      // ── Wire into every Skirt_ joint ──────────────────────────────────────
      let patchedCount = 0
      springBoneManager.joints.forEach((joint) => {
        if (joint.bone.name.startsWith(SKIRT_BONE_PREFIX)) {
          joint.colliderGroups.push(armColliderGroup)
          patchedCount++
        }
      })

      console.debug(`[skirt-arm-collider] patched ${patchedCount} skirt joints with ${colliders.length} arm colliders`)
    },
  }
}
