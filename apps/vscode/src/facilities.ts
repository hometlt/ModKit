/**
 * What this window's realms can actually do, as opposed to what the topology intends (block 13,
 * work 3; §1.5).
 *
 * The VS Code topology declares its webview realm with `gpu.webgl2` and `worker.module`, and that
 * declaration is a *statement of intent*: it is what the realm is composed to be allowed. Whether
 * the running page can honour it is a different question with a different answer per machine — a
 * driver without WebGL2, a remote session, a headless container. A page that claims WebGL2 where
 * the canvas refuses one is telling the user something untrue about their own machine.
 *
 * Measured, not assumed: `pnpm smoke:vscode` launches with `--disable-gpu` and the webview still
 * reports `gpu.webgl2` — Chromium falls back to a software rasteriser — while `gpu.webgpu` turns up
 * *ungranted*, offered by the page and not composed into the realm. Both facts are in the receipt,
 * and neither was what this file's first draft guessed.
 *
 * §1.5 asks for host-native capability rather than imitation, and §4.2 for a *named* structured
 * outcome when a facility is absent. So the intended set stays where it is (a composed realm cannot
 * be recomposed after activation without invalidating every resolution cache keyed to its
 * revision), the page probes what it really has, and the difference is reported by name instead of
 * being either hidden or fatal.
 *
 * The vocabulary is deliberately the PWA's — `probeWebFacilities` in `apps/web/src/index.ts` asks
 * the same globals in the same order — because a facility id that means one thing in the browser
 * and another in a webview would be worse than no probe at all.
 *
 * Kept free of `vscode`: the probe runs in the page and the comparison is a pure function, so both
 * are exercised in plain Node.
 */

/** The globals a webview probe reads. Declared structurally, like `UriLike` and `DirectoryProbe`. */
export interface WebviewGlobalsLike {
  readonly Worker?: unknown
  /*
   * `unknown` rather than a shape: the DOM's own `Navigator` declares no `gpu` in this lab's lib
   * set, so a structural type would refuse the very global this probe exists to read. The read is
   * narrowed where it happens instead.
   */
  readonly navigator?: unknown
  readonly document?:
    | {
        createElement(tag: string): { getContext(id: string): unknown } | undefined
      }
    | undefined
}

/** Facilities the VS Code topology composes the webview realm with. */
export const VSCODE_WEBVIEW_INTENDED_FACILITIES: readonly string[] = Object.freeze([
  'gpu.webgl2',
  'worker.module',
])

/**
 * What the page can honour, asked of the page's own globals.
 *
 * A `getContext('webgl2')` that answers `null` is the whole test for WebGL2 — creating the context
 * is the only question a canvas can be asked that a driver, a flag or a remote session can all
 * answer differently.
 */
export function probeWebviewFacilities(scope: WebviewGlobalsLike): readonly string[] {
  const found: string[] = []
  if (typeof scope.Worker === 'function') found.push('worker.module')
  let canvas: { getContext(id: string): unknown } | undefined
  try {
    canvas = scope.document?.createElement('canvas')
  } catch {
    // a document that refuses to make a canvas has no WebGL2 either; that is the answer, not a crash
    canvas = undefined
  }
  try {
    if (canvas !== undefined && canvas.getContext('webgl2') != null) found.push('gpu.webgl2')
  } catch {
    // some environments throw rather than answering null; identical meaning
  }
  const navigatorObject = scope.navigator as { readonly gpu?: unknown } | undefined
  if (navigatorObject?.gpu !== undefined) found.push('gpu.webgpu')
  return Object.freeze([...new Set(found)].sort())
}

export interface FacilityReport {
  /** Composed into the realm, and therefore what resolution was allowed to assume. */
  readonly intended: readonly string[]
  /** What the running page answered for. */
  readonly observed: readonly string[]
  /** Intended and not honoured — the §4.2 degradations, by name. */
  readonly degraded: readonly string[]
  /** Present and not composed: real, unusable through this realm, and worth saying so. */
  readonly ungranted: readonly string[]
}

/**
 * Compare intent with reality.
 *
 * `ungranted` exists because the interesting direction is not only downwards. A webview that offers
 * WebGPU while the realm composes only WebGL2 is a capability this product is declining to use, and
 * a report that showed only losses would make that look like an absence rather than a decision.
 */
export function describeFacilities(
  observed: readonly string[],
  intended: readonly string[] = VSCODE_WEBVIEW_INTENDED_FACILITIES,
): FacilityReport {
  const has = new Set(observed)
  const composed = new Set(intended)
  return Object.freeze({
    intended: Object.freeze([...composed].sort()),
    observed: Object.freeze([...has].sort()),
    degraded: Object.freeze([...composed].filter(item => !has.has(item)).sort()),
    ungranted: Object.freeze([...has].filter(item => !composed.has(item)).sort()),
  })
}

/** One line per degradation, in the shape the output channel and the Host view both print. */
export function describeDegradation(report: FacilityReport): readonly string[] {
  return Object.freeze(
    report.degraded.map(
      facility =>
        `${facility} is composed into this window's page realm but the page cannot honour it; ` +
        'anything that needs it is unavailable here rather than emulated',
    ),
  )
}
