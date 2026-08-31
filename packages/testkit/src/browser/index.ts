import type {
  AnyDescriptor,
  AssetSession,
  AssetSessionEvent,
  KnowledgeCatalog,
  OperationSession,
  PresentationSlot,
  ResolvedPresentationPlan,
  ViewerModule,
  ViewerMount,
  ViewerSources,
} from '@modkit/sdk'
import { VIEWER_CSP_TEXT, safeViewerText } from '@modkit/ui/viewer'

export interface BrowserViewerHostOptions {
  readonly root: HTMLElement
  readonly descriptor: AnyDescriptor
  readonly resolved: ResolvedPresentationPlan
  readonly sources: ViewerSources
  readonly operations: OperationSession
  readonly knowledge?: KnowledgeCatalog
  readonly modules: Readonly<Record<string, ViewerModule>>
}

export interface BrowserViewerHost {
  readonly csp: string
  switchStage(slotId: string): Promise<void>
  update(descriptor: AnyDescriptor, resolved?: ResolvedPresentationPlan): Promise<void>
  unmount(): Promise<void>
  metrics(): Readonly<{ mounts: number; unmounts: number; containers: number }>
}

export interface BrowserSessionBinding {
  readonly done: Promise<void>
  dispose(): Promise<void>
}

export interface BrowserSessionBindingOptions {
  readonly session: Pick<AssetSession, 'events'>
  readonly host: Pick<BrowserViewerHost, 'update'>
  readonly resolvePlan: (
    descriptor: AnyDescriptor,
  ) => ResolvedPresentationPlan | Promise<ResolvedPresentationPlan>
  readonly signal?: AbortSignal
  readonly onState?: (event: Extract<AssetSessionEvent, { readonly kind: 'state' }>) => void
}

/**
 * Forward the host-owned session event stream into an already-open browser viewer host.
 * Descriptor events are resolved sequentially, diagnostics are deduplicated by stable id,
 * and no polling or second codec/session open is introduced.
 */
export function bindAssetSessionToViewerHost(
  options: BrowserSessionBindingOptions,
): BrowserSessionBinding {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  let descriptor: AnyDescriptor | undefined
  const diagnostics = new Map<string, AnyDescriptor['diagnostics'][number]>()

  const snapshotWithDiagnostics = (): AnyDescriptor | undefined => {
    if (descriptor === undefined) return undefined
    return Object.freeze({
      ...descriptor,
      diagnostics: Object.freeze([...diagnostics.values()]),
    }) as AnyDescriptor
  }

  const done = (async () => {
    try {
      for await (const event of options.session.events(controller.signal)) {
        if (controller.signal.aborted) break
        if (event.kind === 'descriptor') {
          descriptor = event.descriptor
          diagnostics.clear()
          for (const diagnostic of descriptor.diagnostics)
            diagnostics.set(diagnostic.id, diagnostic)
          const next = snapshotWithDiagnostics() as AnyDescriptor
          await options.host.update(next, await options.resolvePlan(next))
        } else if (event.kind === 'diagnostic') {
          diagnostics.set(event.diagnostic.id, event.diagnostic)
          const next = snapshotWithDiagnostics()
          if (next !== undefined) {
            descriptor = next
            await options.host.update(next)
          }
        } else {
          options.onState?.(event)
        }
      }
    } finally {
      options.signal?.removeEventListener('abort', abort)
    }
  })()

  return Object.freeze({
    done,
    async dispose() {
      controller.abort('browser-session-binding-disposed')
      await done
    },
  })
}

interface MountedSlot {
  readonly slot: PresentationSlot
  readonly container: HTMLElement
  readonly mount: ViewerMount
}

export async function createBrowserViewerHost(
  options: BrowserViewerHostOptions,
): Promise<BrowserViewerHost> {
  let descriptor = options.descriptor
  let resolved = options.resolved
  let closed = false
  let mounts = 0
  let unmounts = 0
  const mounted = new Map<string, MountedSlot>()
  options.root.dataset['modkitBrowserHost'] = '1'
  options.root.setAttribute('aria-label', 'Modkit asset viewer')

  const mountSlot = async (slot: PresentationSlot) => {
    if (mounted.has(slot.slotId)) return
    const module = options.modules[slot.contributionId]
    if (module === undefined)
      throw new TypeError(`viewer module is missing: ${slot.contributionId}`)
    const container = options.root.ownerDocument.createElement('div')
    container.dataset['slotId'] = slot.slotId
    container.dataset['slotKind'] = slot.kind
    options.root.append(container)
    const mount = await module.mount({
      container,
      descriptor,
      slot,
      sources: options.sources,
      operations: options.operations,
      ...(options.knowledge === undefined ? {} : { knowledge: options.knowledge }),
    })
    mounts += 1
    mounted.set(slot.slotId, { slot, container, mount })
  }

  const unmountSlot = async (slotId: string) => {
    const item = mounted.get(slotId)
    if (item === undefined) return
    mounted.delete(slotId)
    await item.mount.unmount()
    item.container.remove()
    unmounts += 1
  }

  const activeAndSupporting = () => {
    const selected = resolved.plan.slots.filter(
      slot => slot.kind !== 'stage' || slot.slotId === resolved.plan.activeStage,
    )
    if (resolved.plan.activeStage === undefined && resolved.plan.fallback !== undefined) {
      selected.push(resolved.plan.fallback)
    }
    return selected
  }

  for (const slot of activeAndSupporting()) await mountSlot(slot)

  return Object.freeze({
    csp: VIEWER_CSP_TEXT,
    async switchStage(slotId: string) {
      if (closed) throw new TypeError('browser viewer host is unmounted')
      const next = resolved.plan.slots.find(slot => slot.kind === 'stage' && slot.slotId === slotId)
      if (next === undefined) throw new TypeError(`stage is not in the plan: ${slotId}`)
      for (const item of [...mounted.values()]) {
        if (item.slot.kind === 'stage') await unmountSlot(item.slot.slotId)
      }
      await mountSlot(next)
      mounted.get(next.slotId)?.container.focus()
    },
    async update(nextDescriptor: AnyDescriptor, nextResolved?: ResolvedPresentationPlan) {
      if (closed) return
      descriptor = nextDescriptor
      if (nextResolved !== undefined) resolved = nextResolved
      const desired = new Set(activeAndSupporting().map(slot => slot.slotId as string))
      for (const item of [...mounted.values()]) {
        if (!desired.has(item.slot.slotId)) await unmountSlot(item.slot.slotId)
      }
      for (const slot of activeAndSupporting()) {
        const item = mounted.get(slot.slotId)
        if (item === undefined) await mountSlot(slot)
        else await item.mount.update({ descriptor, slot })
      }
    },
    async unmount() {
      if (closed) return
      closed = true
      for (const slotId of [...mounted.keys()]) await unmountSlot(slotId)
      options.root.replaceChildren()
    },
    metrics() {
      return Object.freeze({ mounts, unmounts, containers: mounted.size })
    },
  })
}

export type RestrictedViewerMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'navigate'; readonly subjectUri: string }
  | { readonly kind: 'download'; readonly resourceUri: string }
  | { readonly kind: 'clipboard'; readonly text: string }

export function isRestrictedViewerMessage(value: unknown): value is RestrictedViewerMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (record['kind'] === 'ready') return keys.length === 1
  if (record['kind'] === 'navigate') {
    return keys.join(',') === 'kind,subjectUri' && typeof record['subjectUri'] === 'string'
  }
  if (record['kind'] === 'download') {
    return keys.join(',') === 'kind,resourceUri' && typeof record['resourceUri'] === 'string'
  }
  if (record['kind'] === 'clipboard') {
    return keys.join(',') === 'kind,text' && typeof record['text'] === 'string'
  }
  return false
}

export function isAllowedViewerResource(value: string, base: URL): boolean {
  try {
    const url = new URL(value, base)
    return (
      url.protocol === 'blob:' || (url.origin === base.origin && url.protocol === base.protocol)
    )
  } catch {
    return false
  }
}

export function createRestrictedViewerFrame(
  container: HTMLElement,
  source: URL,
): HTMLIFrameElement {
  if (!isAllowedViewerResource(source.href, new URL(container.ownerDocument.baseURI))) {
    throw new TypeError('third-party viewer resource is not allowed')
  }
  const frame = container.ownerDocument.createElement('iframe')
  frame.title = safeViewerText('Restricted extension viewer')
  frame.sandbox.add('allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.setAttribute('allow', '')
  frame.src = source.href
  container.append(frame)
  return frame
}
