/**
 * View gizmo — the axis indicator from MK2's model viewer, as a standalone component.
 *
 * It is deliberately not part of the model stage: any 3D surface (model, map, replay) wants the
 * same affordance, and an external WebGL backend should be able to mount it without importing a
 * viewer. It owns no camera — it renders a pose and reports axis clicks.
 *
 * Geometry is expressed as SVG attributes rather than CSS. That is not a stylistic preference:
 * ADR-UI-001 C1 bans the `style` attribute, and per-frame positioning through registered `--mk-*`
 * tokens would mean six tokens per handle. Attributes carry no such restriction, and the whole
 * widget stays themeable because every colour still resolves from a token.
 */
import { element, setPart } from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { MODEL_GIZMO_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import type { ViewAxis } from './orbit.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const GIZMO_SIZE = 80
const CENTER = GIZMO_SIZE / 2
/** Axes pointing towards the camera read as nearer: longer arm, bigger handle, full opacity. */
const RADIUS_FRONT = 28
const RADIUS_BACK = 18
const HANDLE_FRONT = 11
const HANDLE_BACK = 6

interface AxisSpec {
  readonly key: ViewAxis
  readonly label: string
  readonly vector: readonly [number, number, number]
  readonly token: string
}

const AXES: readonly AxisSpec[] = Object.freeze([
  { key: '+x', label: 'X', vector: [1, 0, 0], token: '--mk-color-axis-x' },
  { key: '-x', label: '', vector: [-1, 0, 0], token: '--mk-color-axis-x' },
  { key: '+y', label: 'Y', vector: [0, 1, 0], token: '--mk-color-axis-y' },
  { key: '-y', label: '', vector: [0, -1, 0], token: '--mk-color-axis-y' },
  { key: '+z', label: 'Z', vector: [0, 0, 1], token: '--mk-color-axis-z' },
  { key: '-z', label: '', vector: [0, 0, -1], token: '--mk-color-axis-z' },
])

export interface ViewGizmoOptions {
  readonly localizer?: UiLocalizer
  /** Called when an axis handle is activated by pointer or keyboard. */
  readonly onAxis?: (axis: ViewAxis) => void
}

export interface ViewGizmo {
  readonly root: HTMLElement
  /** Re-project the handles for a camera pose. Cheap enough to call every frame. */
  update(yaw: number, pitch: number): void
  destroy(): void
}

interface AxisNodes {
  readonly spec: AxisSpec
  readonly line: SVGLineElement
  readonly handle: SVGCircleElement
  readonly label: SVGTextElement
  readonly hit: SVGGElement
}

export function createViewGizmo(host: HTMLElement, options: ViewGizmoOptions = {}): ViewGizmo {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_GIZMO_FALLBACK_MESSAGES)
  const document = host.ownerDocument
  const root = element(host, 'div', { part: 'gizmo' })
  root.setAttribute('aria-label', localizer.text('viewer.viewAxis'))
  root.setAttribute('role', 'group')

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', String(GIZMO_SIZE))
  svg.setAttribute('height', String(GIZMO_SIZE))
  svg.setAttribute('viewBox', `0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`)
  setPart(svg, 'gizmo.svg')
  root.append(svg)

  const pivot = document.createElementNS(SVG_NS, 'circle')
  pivot.setAttribute('cx', String(CENTER))
  pivot.setAttribute('cy', String(CENTER))
  pivot.setAttribute('r', '3')
  pivot.setAttribute('fill', 'var(--mk-color-canvas-gizmo)')
  svg.append(pivot)

  const nodes: AxisNodes[] = []

  for (const spec of AXES) {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', String(CENTER))
    line.setAttribute('y1', String(CENTER))
    line.setAttribute('stroke', `var(${spec.token})`)
    line.setAttribute('stroke-linecap', 'round')
    setPart(line, 'gizmo.axis')
    svg.append(line)

    // A group, so the circle and its letter share one hit target, one focus ring and one label.
    const hit = document.createElementNS(SVG_NS, 'g')
    hit.setAttribute('role', 'button')
    hit.setAttribute('tabindex', '0')
    hit.setAttribute(
      'aria-label',
      localizer.text('viewer.viewFromAxis', { axis: spec.key.toUpperCase() }),
    )
    setPart(hit, 'gizmo.handle')

    const handle = document.createElementNS(SVG_NS, 'circle')
    handle.setAttribute('fill', `var(${spec.token})`)
    hit.append(handle)

    const label = document.createElementNS(SVG_NS, 'text')
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('dominant-baseline', 'central')
    label.setAttribute('fill', 'var(--mk-color-fg-inverse)')
    label.textContent = spec.label
    setPart(label, 'gizmo.label')
    hit.append(label)

    const activate = (): void => options.onAxis?.(spec.key)
    hit.addEventListener('click', activate)
    hit.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      activate()
    })

    svg.append(hit)
    nodes.push({ spec, line, handle, label, hit })
  }

  const update = (yaw: number, pitch: number): void => {
    // Same basis as the orbit controller; duplicated rather than imported so the gizmo can render
    // a pose that came from an external renderer with its own camera.
    const backward = [
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ] as const
    const horizontal = Math.hypot(backward[0], backward[2]) || 1
    const right = [backward[2] / horizontal, 0, -backward[0] / horizontal] as const
    const up = [
      backward[1] * right[2],
      backward[2] * right[0] - backward[0] * right[2],
      -backward[1] * right[0],
    ] as const

    for (const { spec, line, handle, label, hit } of nodes) {
      const screenX = spec.vector[0] * right[0] + spec.vector[2] * right[2]
      const screenY = spec.vector[0] * up[0] + spec.vector[1] * up[1] + spec.vector[2] * up[2]
      const depth =
        spec.vector[0] * backward[0] + spec.vector[1] * backward[1] + spec.vector[2] * backward[2]
      const front = depth >= 0

      const x = CENTER + screenX * (front ? RADIUS_FRONT : RADIUS_BACK)
      const y = CENTER - screenY * (front ? RADIUS_FRONT : RADIUS_BACK)

      line.setAttribute('x2', String(x))
      line.setAttribute('y2', String(y))
      line.setAttribute('stroke-width', front ? '2.5' : '1.5')
      line.setAttribute('opacity', front ? '1' : '0.35')

      handle.setAttribute('cx', String(x))
      handle.setAttribute('cy', String(y))
      handle.setAttribute('r', String((front ? HANDLE_FRONT : HANDLE_BACK) / 2 + 3))
      label.setAttribute('x', String(x))
      label.setAttribute('y', String(y))
      label.setAttribute('font-size', front ? '9' : '0')
      hit.setAttribute('opacity', front ? '1' : '0.5')
    }
  }

  update(0.7, 0.45)

  return {
    root,
    update,
    destroy() {
      root.remove()
    },
  }
}
