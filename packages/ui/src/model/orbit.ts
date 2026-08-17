/**
 * Orbit camera for 3D stages — MK2 model-viewer parity.
 *
 * The constants are lifted from MK2's `model-viewer-main.ts` deliberately: drag sensitivity, the
 * asymmetric pitch clamp, the wheel step and the reset pose are muscle memory for existing users,
 * and a "cleaner" set would make the same model feel different in MK3.
 *
 * The maths is DOM-free so a renderer can drive it from a worker or a test, and `attach()` is the
 * only part that touches events. That split is what lets the built-in canvas stage and an external
 * WebGL backend (`GraphRenderer`-style provider) share one camera without sharing a renderer.
 */

/** Pitch is clamped short of the poles: at exactly ±π/2 the yaw basis degenerates. */
const PITCH_MINIMUM = -1.4
const PITCH_MAXIMUM = 1.5
const DRAG_RADIANS_PER_PIXEL = 0.008
const WHEEL_IN = 0.9
const WHEEL_OUT = 1.1
const DISTANCE_MINIMUM = 0.15
const DISTANCE_MAXIMUM = 8
const RESET_YAW = 0.7
const RESET_PITCH = 0.45

export type ViewAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export interface OrbitPose {
  readonly yaw: number
  readonly pitch: number
  /** Multiplier on the framing radius, not a world distance: 1 frames the model. */
  readonly distanceScale: number
}

export interface OrbitBasis {
  /** Unit vector from target towards the camera. */
  readonly backward: readonly [number, number, number]
  readonly right: readonly [number, number, number]
  readonly up: readonly [number, number, number]
}

export interface OrbitController {
  readonly pose: OrbitPose
  /** Camera position for a target and framing radius, in Y-up viewer space. */
  position(
    target: readonly [number, number, number],
    radius: number,
  ): readonly [number, number, number]
  basis(): OrbitBasis
  orbit(deltaX: number, deltaY: number): void
  zoom(wheelDelta: number): void
  snapTo(axis: ViewAxis): void
  reset(): void
  set(pose: Partial<OrbitPose>): void
  /** Bind pointer drag and wheel zoom to an element. Returns a detach function. */
  attach(host: HTMLElement, signal?: AbortSignal): () => void
  onChange(listener: (pose: OrbitPose) => void): () => void
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

/** Snapping to a pole needs the epsilon for the same reason the clamp does. */
const POLE = Math.PI / 2 - 0.001

const AXIS_POSE: Readonly<Record<ViewAxis, readonly [number, number]>> = Object.freeze({
  '+x': [Math.PI / 2, 0],
  '-x': [-Math.PI / 2, 0],
  '+y': [0, POLE],
  '-y': [0, -POLE],
  '+z': [0, 0],
  '-z': [Math.PI, 0],
})

export function createOrbitController(initial: Partial<OrbitPose> = {}): OrbitController {
  let yaw = initial.yaw ?? RESET_YAW
  let pitch = clamp(initial.pitch ?? RESET_PITCH, PITCH_MINIMUM, PITCH_MAXIMUM)
  let distanceScale = clamp(initial.distanceScale ?? 1, DISTANCE_MINIMUM, DISTANCE_MAXIMUM)
  const listeners = new Set<(pose: OrbitPose) => void>()

  const emit = (): void => {
    const pose: OrbitPose = { yaw, pitch, distanceScale }
    for (const listener of listeners) listener(pose)
  }

  const controller: OrbitController = {
    get pose(): OrbitPose {
      return { yaw, pitch, distanceScale }
    },

    position(target, radius) {
      const scaled = radius * distanceScale
      return [
        target[0] + Math.sin(yaw) * Math.cos(pitch) * scaled,
        target[1] + Math.sin(pitch) * scaled,
        target[2] + Math.cos(yaw) * Math.cos(pitch) * scaled,
      ]
    },

    basis() {
      const backward = [
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      ] as const
      // `right` is the horizontal perpendicular; the model never rolls, so it stays in the XZ plane.
      const horizontal = Math.hypot(backward[0], backward[2]) || 1
      const right = [backward[2] / horizontal, 0, -backward[0] / horizontal] as const
      const up = [
        backward[1] * right[2],
        backward[2] * right[0] - backward[0] * right[2],
        -backward[1] * right[0],
      ] as const
      return { backward, right, up }
    },

    orbit(deltaX, deltaY) {
      yaw += deltaX * DRAG_RADIANS_PER_PIXEL
      pitch = clamp(pitch + deltaY * DRAG_RADIANS_PER_PIXEL, PITCH_MINIMUM, PITCH_MAXIMUM)
      emit()
    },

    zoom(wheelDelta) {
      distanceScale = clamp(
        distanceScale * (wheelDelta > 0 ? WHEEL_OUT : WHEEL_IN),
        DISTANCE_MINIMUM,
        DISTANCE_MAXIMUM,
      )
      emit()
    },

    snapTo(axis) {
      const pose = AXIS_POSE[axis]
      if (pose === undefined) throw new TypeError(`unknown view axis: ${String(axis)}`)
      yaw = pose[0]
      pitch = pose[1]
      emit()
    },

    reset() {
      yaw = RESET_YAW
      pitch = RESET_PITCH
      distanceScale = 1
      emit()
    },

    set(pose) {
      if (pose.yaw !== undefined) yaw = pose.yaw
      if (pose.pitch !== undefined) pitch = clamp(pose.pitch, PITCH_MINIMUM, PITCH_MAXIMUM)
      if (pose.distanceScale !== undefined) {
        distanceScale = clamp(pose.distanceScale, DISTANCE_MINIMUM, DISTANCE_MAXIMUM)
      }
      emit()
    },

    attach(host, signal) {
      let dragging = false
      let lastX = 0
      let lastY = 0
      const options = signal === undefined ? {} : { signal }

      host.addEventListener(
        'pointerdown',
        event => {
          dragging = true
          lastX = event.clientX
          lastY = event.clientY
          host.setPointerCapture(event.pointerId)
        },
        options,
      )
      host.addEventListener(
        'pointermove',
        event => {
          if (!dragging) return
          controller.orbit(event.clientX - lastX, event.clientY - lastY)
          lastX = event.clientX
          lastY = event.clientY
        },
        options,
      )
      const stop = (): void => {
        dragging = false
      }
      host.addEventListener('pointerup', stop, options)
      host.addEventListener('pointercancel', stop, options)
      host.addEventListener(
        'wheel',
        event => {
          // Non-passive on purpose: without preventDefault the wheel scrolls the panel instead.
          event.preventDefault()
          controller.zoom(event.deltaY)
        },
        { passive: false, ...options },
      )

      // Keyboard parity: the stage is focusable, so orbiting must not require a pointer (C-15).
      host.addEventListener(
        'keydown',
        event => {
          const step = event.shiftKey ? 40 : 12
          if (event.key === 'ArrowLeft') controller.orbit(-step, 0)
          else if (event.key === 'ArrowRight') controller.orbit(step, 0)
          else if (event.key === 'ArrowUp') controller.orbit(0, -step)
          else if (event.key === 'ArrowDown') controller.orbit(0, step)
          else if (event.key === '+' || event.key === '=') controller.zoom(-1)
          else if (event.key === '-') controller.zoom(1)
          else if (event.key === '0') controller.reset()
          else return
          event.preventDefault()
        },
        options,
      )

      return stop
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return controller
}
