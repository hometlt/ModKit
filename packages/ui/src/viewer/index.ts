import type {
  AnyDescriptor,
  AssetDiagnostic,
  AssetOperationDescriptor,
  BindingRef,
  JsonValue,
  Lease,
  OperationResult,
  OperationSession,
  PresentationSlot,
  ViewerMount,
  ViewerModule,
  ViewerSources,
} from '@modkit/sdk'
import { setPart, setState, type PartName, type StateName } from '../parts.js'

export {
  setPart,
  setState,
  auditParts,
  PARTS,
  STATES,
  PART_ATTRIBUTE,
  STATE_ATTRIBUTE,
} from '../parts.js'
export type { PartName, StateName, PartAudit } from '../parts.js'
export {
  rememberUiPreference,
  setUiPreferenceStore,
  uiPreference,
  type UiPreferenceStore,
} from './preferences.js'

export const VIEWER_CSP = Object.freeze({
  defaultSrc: "'none'",
  scriptSrc: "'self'",
  styleSrc: "'self'",
  // C1 in ADR-UI-001. `style-src-attr` does not inherit from `style-src`, so the ban on the
  // `style` attribute has to be stated here or it is not enforced at all. Components set dynamic
  // values through CSSOM (`style.setProperty`), which this does not block.
  styleSrcAttr: "'none'",
  imgSrc: "'self' blob: data:",
  // The audio and video stages hand a codec-owned encoded representation to the platform player
  // as a blob; without this the policy falls through to default-src 'none' and playback dies.
  mediaSrc: "'self' blob:",
  fontSrc: "'self'",
  connectSrc: "'self'",
  workerSrc: "'self' blob:",
  frameSrc: "'none'",
})

/**
 * Policy for a host that embeds the trusted in-process code editor.
 *
 * Measured, not assumed: Monaco creates and renders under the strict policy, but its runtime
 * injected stylesheet (~140 KB of theme, token and decoration rules) is refused, leaving the
 * editor unthemed — transparent background, no token colours. It needs `style-src 'unsafe-inline'`.
 * It does **not** need `script-src 'unsafe-eval'`: the editor constructs fine without it.
 *
 * Use this only for the application host that ships the editor. Untrusted third-party viewers keep
 * `VIEWER_CSP` and run in a restricted frame (BRIEF-13C §6), so the relaxation does not reach them.
 */
export const VIEWER_CSP_TRUSTED_EDITOR = Object.freeze({
  ...VIEWER_CSP,
  styleSrc: "'self' 'unsafe-inline'",
  // Measured: the editor renders each visible line as markup carrying a `style` attribute with its
  // computed `top` and `height`. Under `style-src-attr 'none'` those attributes are refused, the
  // lines never reach their positions, and the text visibly jumps as the view scrolls. This is the
  // C1 exclusion the ADR anticipates for a trusted in-process editor, scoped to that host only.
  styleSrcAttr: "'unsafe-inline'",
  // The editor's icon font is inlined as a data URI by the bundler; `font-src 'self'` alone
  // rejects it and the glyphs fall back to tofu.
  fontSrc: "'self' data:",
})

const policyText = (policy: Readonly<Record<string, string>>): string =>
  Object.entries(policy)
    .map(
      ([name, value]) => `${name.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)} ${value}`,
    )
    .join('; ')

export const VIEWER_CSP_TEXT = policyText(VIEWER_CSP)
export const VIEWER_CSP_TRUSTED_EDITOR_TEXT = policyText(VIEWER_CSP_TRUSTED_EDITOR)

const HOSTILE_TEXT =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu

/** Render untrusted labels as text and make layout-control characters visible. */
export function safeViewerText(value: unknown, maximum = 1_000_000): string {
  const text = String(value)
  const bounded = text.length > maximum ? `${text.slice(0, maximum)}…` : text
  return bounded.replace(HOSTILE_TEXT, character => {
    const code = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '0000'
    return `\\u{${code}}`
  })
}

export function setViewerText(node: Node, value: unknown, maximum?: number): void {
  node.textContent = safeViewerText(value, maximum)
}

export function requireContainer(value: unknown): HTMLElement {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ownerDocument' in value) ||
    !('replaceChildren' in value) ||
    typeof (value as { replaceChildren?: unknown }).replaceChildren !== 'function'
  ) {
    throw new TypeError('viewer container must be a DOM element')
  }
  return value as HTMLElement
}

export function createSurface(container: unknown, label: string): HTMLElement {
  const host = requireContainer(container)
  const root = host.ownerDocument.createElement('section')
  root.className = 'modkit-viewer'
  root.tabIndex = 0
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', label)
  root.dataset['modkitViewer'] = label
  setPart(root, 'viewer')
  host.replaceChildren(root)
  return root
}

export function element(
  parent: HTMLElement,
  tag: keyof HTMLElementTagNameMap,
  options: {
    readonly className?: string
    readonly role?: string
    readonly text?: unknown
    /** Public styling hook; see `../parts.ts`. */
    readonly part?: PartName
    readonly state?: readonly StateName[]
  } = {},
): HTMLElement {
  const node = parent.ownerDocument.createElement(tag)
  if (options.className !== undefined) node.className = options.className
  if (options.role !== undefined) node.setAttribute('role', options.role)
  if (options.text !== undefined) setViewerText(node, options.text)
  if (options.part !== undefined) setPart(node, options.part)
  if (options.state !== undefined) setState(node, options.state)
  parent.append(node)
  return node
}

export function bindingFor(slot: PresentationSlot, contract: string): BindingRef | undefined {
  return slot.bindings.find(binding => 'contract' in binding && binding.contract === contract)
}

export class ViewerMountScope {
  readonly controller = new AbortController()
  readonly signal = this.controller.signal
  readonly #leases: Lease<unknown>[] = []
  readonly #cleanup: (() => void | Promise<void>)[] = []
  #closed = false

  constructor(parent?: AbortSignal) {
    if (parent?.aborted) this.controller.abort(parent.reason)
    else if (parent !== undefined) {
      const abort = () => this.controller.abort(parent.reason)
      parent.addEventListener('abort', abort, { once: true })
      this.#cleanup.push(() => parent.removeEventListener('abort', abort))
    }
  }

  lease<T>(lease: Lease<T>): Lease<T> {
    this.#leases.push(lease as Lease<unknown>)
    return lease
  }

  cleanup(callback: () => void | Promise<void>): void {
    this.#cleanup.push(callback)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.controller.abort('viewer-unmounted')
    for (const callback of this.#cleanup.reverse()) await callback()
    for (const lease of this.#leases.reverse()) await lease.release()
  }
}

export function createViewerMount(
  root: HTMLElement,
  scope: ViewerMountScope,
  initial: { readonly descriptor: AnyDescriptor; readonly slot: PresentationSlot },
  render: (args: {
    readonly descriptor: AnyDescriptor
    readonly slot: PresentationSlot
  }) => void | Promise<void>,
): ViewerMount {
  let state = initial
  return Object.freeze({
    async update(args: Parameters<ViewerMount['update']>[0]) {
      if (scope.signal.aborted) return
      state = args
      root.setAttribute('aria-label', safeViewerText(args.slot.contributionId, 512))
      await render(state)
    },
    async unmount() {
      await scope.close()
      root.remove()
    },
  })
}

export function defineViewerModule(module: ViewerModule): ViewerModule {
  return Object.freeze(module)
}

/**
 * A viewer whose code loads the first time it mounts.
 *
 * For a stage most subjects never reach — a map's world renderer, with three.js behind it — the
 * host can list it without paying for it: the catalog holds this small object, and the real module
 * is imported (a separate chunk in a split build) when a subject actually needs it, then kept.
 */
export function lazyViewerModule(load: () => Promise<ViewerModule>): ViewerModule {
  let loading: Promise<ViewerModule> | undefined
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      loading ??= load().catch(error => {
        // A failed load must not be remembered: the next mount tries again.
        loading = undefined
        throw error
      })
      return (await loading).mount(args)
    },
  })
}

export function operationById(
  descriptor: AnyDescriptor,
  operationId: string,
): AssetOperationDescriptor | undefined {
  return descriptor.operations.find(operation => operation.id === operationId)
}

export async function invokeOperation(
  descriptor: AnyDescriptor,
  operations: OperationSession,
  operationId: string,
  input: JsonValue,
  options?: {
    readonly signal?: AbortSignal
    readonly onProgress?: (completed: number, total?: number, message?: string) => void
  },
): Promise<OperationResult> {
  const declaration = operationById(descriptor, operationId)
  if (declaration === undefined) {
    return {
      state: 'rejected',
      reason: 'not-declared',
      diagnostics: [],
    }
  }
  if (declaration.state !== 'available') {
    return {
      state: 'rejected',
      reason: declaration.state === 'dependency-required' ? 'dependency-required' : 'disabled',
      diagnostics: [],
    }
  }
  return operations.invoke(declaration.handlerId, input, {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.onProgress === undefined
      ? {}
      : {
          onProgress: progress =>
            options.onProgress?.(progress.completed, progress.total, progress.message),
        }),
  })
}

export function diagnosticsBySeverity(
  diagnostics: readonly AssetDiagnostic[],
): Readonly<Record<'error' | 'warning' | 'information' | 'hint', readonly AssetDiagnostic[]>> {
  const unique = new Map<string, AssetDiagnostic>()
  for (const item of diagnostics) unique.set(item.id, item)
  const values = [...unique.values()]
  return Object.freeze({
    error: Object.freeze(values.filter(item => item.severity === 'error')),
    warning: Object.freeze(values.filter(item => item.severity === 'warning')),
    information: Object.freeze(values.filter(item => item.severity === 'information')),
    hint: Object.freeze(values.filter(item => item.severity === 'hint')),
  })
}

export function unknownSourceLease(
  sources: ViewerSources,
  slot: PresentationSlot,
  contract: string,
): Promise<Lease<unknown> | undefined> {
  const binding = bindingFor(slot, contract)
  if (binding === undefined || !('contract' in binding)) return Promise.resolve(undefined)
  return sources.get(binding as never) as Promise<Lease<unknown> | undefined>
}
