import type { VrmHook } from './hooks'

import {
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeCapsule,
  VRMSpringBoneColliderShapeSphere,
} from '@pixiv/three-vrm'
import { Quaternion, Vector3 } from 'three'

/**
 * Capsule collider definitions for each arm bone segment.
 * `from` is where the capsule starts (bone origin), `to` is where it ends
 * (the next bone's origin).  The tail vector is computed at load time from
 * the actual bone world positions so it fits the model's proportions.
 */
const ARM_CAPSULE_DEFS = [
  { from: 'leftUpperArm' as const, to: 'leftLowerArm' as const, radius: 0.07 },
  { from: 'leftLowerArm' as const, to: 'leftHand' as const, radius: 0.06 },
  { from: 'rightUpperArm' as const, to: 'rightLowerArm' as const, radius: 0.07 },
  { from: 'rightLowerArm' as const, to: 'rightHand' as const, radius: 0.06 },
]

/** Sphere at each hand (no downstream bone to extend toward). */
const ARM_SPHERE_DEFS = [
  { bone: 'leftHand' as const, radius: 0.05 },
  { bone: 'rightHand' as const, radius: 0.05 },
]

const SKIRT_BONE_PREFIX = 'Skirt_'

// Scratch objects — allocated once, reused per collider.
const _fromPos = new Vector3()
const _toPos = new Vector3()
const _tailLocal = new Vector3()
const _boneQuat = new Quaternion()

/**
 * VRM load hook that adds capsule colliders along each arm bone segment and
 * wires them into every skirt spring-bone joint so the skirt can no longer
 * clip through the arms.
 *
 * Why capsules instead of spheres:
 * A sphere at a joint origin (shoulder, elbow, wrist) only covers a small
 * radius around that single point.  The mid-section of the arm between two
 * joints has no coverage and the skirt clips straight through it.  A capsule
 * extends from one joint to the next and covers the full bone length.
 *
 * The `tail` vector of each capsule is derived from the bone world positions
 * at load time so it matches the model's actual proportions regardless of
 * scale or skeleton layout.
 */
export function createSkirtArmColliderHook(): VrmHook {
  return {
    onLoad({ vrm }) {
      const springBoneManager = vrm.springBoneManager
      if (!springBoneManager) {
        console.warn('[skirt-arm-collider] springBoneManager not found on VRM')
        return
      }

      // Ensure bone world matrices are current before reading positions.
      // The VRM scene may not yet be added to the Three.js scene at this point,
      // but updateMatrixWorld() works on any self-contained scene graph.
      vrm.scene.updateMatrixWorld(true)

      const colliders: VRMSpringBoneCollider[] = []

      // ── Capsules along each arm segment ─────────────────────────────────
      for (const { from, to, radius } of ARM_CAPSULE_DEFS) {
        const fromNode = vrm.humanoid.getRawBoneNode(from)
        const toNode = vrm.humanoid.getRawBoneNode(to)
        if (!fromNode || !toNode) {
          console.warn(`[skirt-arm-collider] bone not found: ${from} or ${to}`)
          continue
        }

        fromNode.getWorldPosition(_fromPos)
        toNode.getWorldPosition(_toPos)

        // Compute the tail vector in the FROM bone's local space.
        // tail = (toPos - fromPos) rotated by the inverse of fromNode's world rotation.
        _tailLocal.copy(_toPos).sub(_fromPos)
        fromNode.getWorldQuaternion(_boneQuat)
        _boneQuat.invert()
        _tailLocal.applyQuaternion(_boneQuat)

        const collider = new VRMSpringBoneCollider(
          new VRMSpringBoneColliderShapeCapsule({ radius, tail: _tailLocal.clone() }),
        )
        fromNode.add(collider)
        colliders.push(collider)
      }

      // ── Spheres at each hand ─────────────────────────────────────────────
      for (const { bone, radius } of ARM_SPHERE_DEFS) {
        const node = vrm.humanoid.getRawBoneNode(bone)
        if (!node) {
          console.warn(`[skirt-arm-collider] bone not found: ${bone}`)
          continue
        }
        const collider = new VRMSpringBoneCollider(
          new VRMSpringBoneColliderShapeSphere({ radius }),
        )
        node.add(collider)
        colliders.push(collider)
      }

      if (colliders.length === 0) {
        console.warn('[skirt-arm-collider] no arm colliders created — bone nodes not found')
        return
      }

      // ── Register with spring-bone manager ───────────────────────────────
      const armColliderGroup = { name: 'arm-colliders', colliders }
      springBoneManager.colliderGroups.push(armColliderGroup)

      // ── Wire into every Skirt_ joint ─────────────────────────────────────
      let patchedCount = 0
      springBoneManager.joints.forEach((joint) => {
        if (joint.bone.name.startsWith(SKIRT_BONE_PREFIX)) {
          joint.colliderGroups.push(armColliderGroup)
          patchedCount++
        }
      })

      console.log(
        `[skirt-arm-collider] patched ${patchedCount} skirt joints`
        + ` with ${colliders.length} arm colliders (${ARM_CAPSULE_DEFS.length} capsules + ${ARM_SPHERE_DEFS.length} spheres)`,
      )
    },
  }
}
