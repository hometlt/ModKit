/**
 * Archive stage — the shipped namespace tree beside an inline preview of the selected entry.
 *
 * `@modkitx-x3/ui` ships `namespaceViewer` as a `tree` contribution, not a `stage`, so the Electron
 * policy composes the stage itself: the tree on the left, the bytes of whatever entry the user
 * activates on the right. Nothing about the tree is reimplemented — this file mounts the shipped
 * module and listens for the `modkit-open-source` event it already dispatches.
 *
 * Why an operation and not `openEntry`: the namespace contract's `openEntry` hands back an
 * `AssetSourceRef` — an identity, deliberately not bytes. The platform-owned `container.extract`
 * operation turns the namespace's opaque `{ entryId }` into bytes without this app knowing a ZIP
 * handler or path convention. Opening the entry as its own subject is a different feature.
 */
import {
  createSurface,
  defineViewerModule,
  element,
  hexViewer,
  namespaceViewer,
  setState,
  setViewerText,
  ViewerMountScope,
} from '@modkitx-x3/ui'
import type { NamespaceEntrySource, OperationSession, ViewerModule } from '@modkitx-x3/sdk'

import { mountViewer, type MountedViewer } from './mount.js'
import { indexNamespace, type ArchiveEntryFact } from './namespace-index.js'
import { entryPreviewOperations } from './view-policy.js'

/** Enough to see what an entry is; a member of an archive is a preview, not a document. */
const MAXIMUM_ENTRY_BYTES = 512 * 1024

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** An in-memory `ByteRangeSource` over already-materialised bytes, for the shipped hex viewer. */
function byteRangeOver(bytes: Uint8Array): { size(): Promise<bigint>; read: unknown } {
  return {
    async size() {
      return BigInt(bytes.byteLength)
    },
    async read(offset: bigint, length: number) {
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError('byte range must use a non-negative offset and safe length')
      }
      const start = Number(offset)
      if (start >= bytes.byteLength) return new Uint8Array()
      return bytes.slice(start, Math.min(start + length, bytes.byteLength))
    },
  }
}

const bytesOfOutput = (output: unknown): Uint8Array | undefined => {
  const value = (output as { kind?: unknown; value?: unknown } | undefined)?.value
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

export interface ArchiveStageOptions {
  /** Resolves the operation session for the subject this stage was mounted for. */
  operationsFor(descriptor: Record<string, unknown>): Promise<OperationSession | undefined>
}

export function createArchiveStage(options: ArchiveStageOptions): ViewerModule {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, 'Archive')
      const layout = element(root, 'div', { part: 'archive' })
      const treePane = element(layout, 'div', { part: 'archive.tree' })
      const previewPane = element(layout, 'div', { part: 'archive.preview' })
      const status = element(previewPane, 'output', { part: 'viewer.status' })
      const body = element(previewPane, 'div', { part: 'archive.entries' })
      setViewerText(status, 'Select an entry to preview it.')

      const descriptor = args.descriptor as unknown as Record<string, unknown>
      const tree = await namespaceViewer.mount({
        ...args,
        container: treePane,
        signal: scope.signal,
      })
      scope.cleanup(() => tree.unmount())

      const lease = await args.sources.getUnknown({
        bindingId: 'content',
        contract: 'common.view/namespace-entry-source',
        major: 1,
      } as never)
      const source = lease?.value as NamespaceEntrySource | undefined
      const index =
        source === undefined
          ? new Map<string, ArchiveEntryFact>()
          : await indexNamespace(source, scope.signal)
      if (lease !== undefined) scope.lease(lease)

      let mounted: MountedViewer | undefined
      const showBytes = async (label: string, bytes: Uint8Array): Promise<void> => {
        await mounted?.unmount()
        mounted = undefined
        body.replaceChildren()
        const text = decodeUtf8(bytes)
        if (text !== undefined && !bytes.includes(0)) {
          const pane = element(body, 'div', { part: 'text' })
          for (const line of text.split(/\r\n|\r|\n/u).slice(0, 2000)) {
            element(pane, 'div', { part: 'text.line', text: line })
          }
        } else {
          mounted = await mountViewer({
            module: hexViewer,
            container: body,
            descriptor,
            slotId: 'archive:entry',
            contract: 'common.view/byte-range-source',
            source: async () => ({ value: byteRangeOver(bytes) }),
            signal: scope.signal,
          })
        }
        setViewerText(status, `${label} · ${bytes.byteLength} bytes`)
      }

      const preview = async (entryId: string): Promise<void> => {
        const entry = index.get(entryId)
        if (entry === undefined) {
          setViewerText(status, `entry ${entryId} is outside the indexed namespace`)
          return
        }
        const candidates = entryPreviewOperations(descriptor)
        if (candidates.length === 0) {
          setState(previewPane, ['degraded'])
          setViewerText(
            status,
            `${entry.path}: this subject declares no available container.extract operation, so its bytes cannot be read here.`,
          )
          return
        }
        const operations = await options.operationsFor(descriptor)
        if (operations === undefined) {
          setState(previewPane, ['degraded'])
          setViewerText(
            status,
            `${entry.path}: this host has no operation session for the subject.`,
          )
          return
        }
        setState(previewPane, ['loading'])
        setViewerText(status, `${entry.path}: extracting…`)
        for (const id of candidates) {
          const handler = (descriptor['operations'] as { id?: string; handlerId?: string }[])
            .filter(item => item.id === id)
            .map(item => item.handlerId ?? '')[0]
          if (handler === undefined || handler === '') continue
          const result = await operations.invoke(handler, { entryId } as never, {
            signal: scope.signal,
          })
          if (result.state !== 'ok') continue
          const bytes = bytesOfOutput(result.output)
          if (bytes === undefined) continue
          setState(previewPane, [])
          await showBytes(entry.path, bytes.slice(0, MAXIMUM_ENTRY_BYTES))
          return
        }
        setState(previewPane, ['error'])
        setViewerText(status, `${entry.path}: no declared operation returned bytes for this entry.`)
      }

      const onOpen = (event: Event): void => {
        const detail = (event as CustomEvent<{ entryId?: unknown }>).detail
        if (typeof detail?.entryId !== 'string') return
        void preview(detail.entryId).catch((error: unknown) => {
          setState(previewPane, ['error'])
          setViewerText(status, error instanceof Error ? error.message : String(error))
        })
      }
      treePane.addEventListener('modkit-open-source', onOpen)
      scope.cleanup(() => treePane.removeEventListener('modkit-open-source', onOpen))
      setViewerText(status, `${index.size} file entries indexed. Select one to preview its bytes.`)

      return {
        async update() {
          // The archive namespace is fixed for the session's revision; nothing to redraw.
        },
        async unmount() {
          await mounted?.unmount()
          await scope.close()
          root.remove()
        },
      }
    },
  })
}
