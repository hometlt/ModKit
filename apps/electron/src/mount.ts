/**
 * One place where the application mounts a viewer module by hand.
 *
 * `createCodecPreview` does this for the stages inside a tab. The inspector dock and the archive
 * stage's entry pane mount viewers outside that path — the panels consume the descriptor rather
 * than a stage binding, and the entry pane shows bytes that belong to a member of the subject, not
 * to the subject — so the same slot/sources shim is written once, here, instead of three times.
 *
 * The `as never` casts are the same ones `packages/ui/src/explorer/preview.ts` carries: a
 * `ViewerModule` is typed against the SDK's descriptor and lease shapes, and this host holds the
 * wire-shaped values the subject RPC returned. The values are the ones the viewer reads; only the
 * nominal types differ.
 */
import type { ViewerModule } from '@modkit/sdk'

export interface MountedViewer {
  unmount(): Promise<void> | void
}

export interface MountRequest {
  readonly module: ViewerModule
  readonly container: HTMLElement
  readonly descriptor: Record<string, unknown>
  /** Slot identity the viewer reports; only its binding is load-bearing. */
  readonly slotId: string
  /** Contract the viewer resolves through `bindingFor`; omit for a descriptor-only panel. */
  readonly contract?: string
  readonly major?: number
  /** Produces the leased data source for `contract`. Required whenever `contract` is set. */
  readonly source?: () => Promise<{ readonly value: unknown }>
  /** Operation session for a viewer that invokes (`operationToolbar`, `transportViewer`). */
  readonly operations?: unknown
  readonly signal?: AbortSignal
}

export async function mountViewer(request: MountRequest): Promise<MountedViewer> {
  const major = request.major ?? 1
  const slot = {
    slotId: request.slotId,
    kind: 'primary',
    contributionId: 'modkit.app.electron/inspector',
    extensionId: 'modkit.app.electron',
    priority: 100,
    bindings:
      request.contract === undefined
        ? []
        : [{ bindingId: 'content', contract: request.contract, major }],
  }
  const lease = async (): Promise<{ value: unknown; release(): Promise<void> }> => {
    if (request.source === undefined)
      throw new TypeError(`no source supplied for ${request.slotId}`)
    const opened = await request.source()
    return {
      value: opened.value,
      async release() {
        // The subject session owns its data sources; releasing here would be premature.
      },
    }
  }
  const sources = { get: lease, getUnknown: lease }

  return (await request.module.mount({
    container: request.container,
    descriptor: request.descriptor as never,
    slot: slot as never,
    sources: sources as never,
    operations: request.operations as never,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  } as never)) as MountedViewer
}
