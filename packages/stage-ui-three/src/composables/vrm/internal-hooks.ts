import type { VrmHook } from './hooks'

import { createVrmOutlineHook } from './outline'
import { createSkirtArmColliderHook } from './skirt-arm-collider'

export function resolveInternalVrmHooks(): readonly VrmHook[] {
  return [
    createVrmOutlineHook(),
    createSkirtArmColliderHook(),
  ]
}
