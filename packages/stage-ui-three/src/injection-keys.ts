import type { InjectionKey, Ref } from 'vue'

/**
 * Optional injection key for overriding the mouse X position used by VRMModel.
 *
 * Provide a `Ref<number>` (window-relative pixel X) from a parent component to
 * enable global mouse tracking (e.g. via Electron's screen.getCursorScreenPoint).
 * When not provided, VRMModel falls back to VueUse's useMouse().
 */
export const mouseXKey: InjectionKey<Ref<number>> = Symbol('mouseX')

/**
 * Optional injection key for overriding the mouse Y position used by VRMModel.
 *
 * Provide a `Ref<number>` (window-relative pixel Y) from a parent component to
 * enable global mouse tracking (e.g. via Electron's screen.getCursorScreenPoint).
 * When not provided, VRMModel falls back to VueUse's useMouse().
 */
export const mouseYKey: InjectionKey<Ref<number>> = Symbol('mouseY')
