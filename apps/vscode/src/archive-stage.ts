/** Namespace tree plus a selected-entry byte pane for the VS Code webview. */
import type { JsonValue, NamespaceEntrySource, ViewerModule } from '@modkit/sdk'
import {
  defineViewerModule,
  element,
  requireContainer,
  setViewerText,
  unknownSourceLease,
} from '@modkit/ui/viewer'
import { createNamespaceViewer } from '@modkit/ui/namespace'
import type { UiLocalizer } from '@modkit/ui/localization'

import {
  ARCHIVE_ENTRY_PREVIEW_BYTES,
  ARCHIVE_LISTING_PAGES,
  findArchiveExtractOperation,
  hexDump,
  previewText,
} from './archive-entry.js'
import { createVscodeLocalizer } from './localization.js'

export function createVsCodeArchiveStage(
  localizer: UiLocalizer = createVscodeLocalizer('en'),
): ViewerModule {
  const namespaceViewer = createNamespaceViewer({ localizer })
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const container = requireContainer(args.container)
      container.replaceChildren()
      const treeHost = container.ownerDocument.createElement('div')
      treeHost.className = 'vscode-stage-part'
      const entryHost = container.ownerDocument.createElement('div')
      entryHost.className = 'vscode-stage-part vscode-archive-entry'
      container.append(treeHost, entryHost)

      const tree = await namespaceViewer.mount({ ...args, container: treeHost })
      const status = element(entryHost, 'output', { part: 'viewer.status' })
      const body = element(entryHost, 'pre', { part: 'hex.content' })
      setViewerText(status, localizer.text('vscode.container.pickEntry'))

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/namespace-entry-source',
      )
      const source = lease?.value as NamespaceEntrySource | undefined
      const paths = new Map<string, string>()
      const pathFor = async (entryId: string): Promise<string | undefined> => {
        const known = paths.get(entryId)
        if (known !== undefined || source === undefined) return known
        let cursor: string | undefined
        for (let page = 0; page < ARCHIVE_LISTING_PAGES; page += 1) {
          const listed = await source.list(
            '',
            { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
            args.signal,
          )
          for (const item of listed.items) paths.set(item.id, item.path)
          const found = paths.get(entryId)
          if (found !== undefined) return found
          cursor = listed.nextCursor
          if (cursor === undefined) break
        }
        return undefined
      }

      const extract = findArchiveExtractOperation(args.descriptor.operations)
      const show = (detail: { readonly entryId?: unknown; readonly source?: unknown }): void => {
        const reference = detail.source as { readonly uri?: string } | null
        const entryId = String(detail.entryId ?? '')
        setViewerText(
          status,
          `${entryId} → ${reference?.uri ?? localizer.text('vscode.container.noSourceReference')}${
            extract === undefined
              ? ` · ${localizer.text('vscode.container.extractUnavailable')}`
              : ''
          }`,
        )
        if (extract === undefined) {
          setViewerText(body, '')
          return
        }
        void (async () => {
          try {
            const path = await pathFor(entryId)
            if (path === undefined) {
              setViewerText(
                body,
                localizer.text('vscode.container.entryNotListed', { id: entryId }),
              )
              return
            }
            const input: JsonValue = { entryId }
            const result = await args.operations.invoke(extract.handlerId, input, {
              ...(args.signal === undefined ? {} : { signal: args.signal }),
            })
            if (result.state !== 'ok' || result.output.kind !== 'bytes') {
              setViewerText(
                body,
                result.state === 'ok'
                  ? localizer.text('vscode.container.wrongOutput', { kind: result.output.kind })
                  : localizer.text('vscode.container.rejected', { reason: result.reason }),
              )
              return
            }
            const bytes = result.output.value.slice(0, ARCHIVE_ENTRY_PREVIEW_BYTES)
            const text = previewText(bytes)
            setViewerText(body, text ?? hexDump(bytes), ARCHIVE_ENTRY_PREVIEW_BYTES * 4)
            setViewerText(
              status,
              localizer.text('vscode.container.shown', {
                path,
                count: result.output.value.length,
                mode: localizer.text(text === undefined ? 'stage.hex' : 'stage.text'),
              }),
            )
          } catch (error) {
            setViewerText(
              body,
              localizer.text('vscode.container.readFailed', {
                reason: error instanceof Error ? error.message : String(error),
              }),
            )
          }
        })()
      }

      const listener = (event: Event): void => {
        const detail = (event as { readonly detail?: Record<string, unknown> }).detail
        if (detail !== undefined) show(detail)
      }
      treeHost.addEventListener('modkit-open-source', listener)

      return {
        async update(next) {
          await tree.update(next)
        },
        async unmount() {
          treeHost.removeEventListener('modkit-open-source', listener)
          await tree.unmount()
          container.replaceChildren()
        },
      }
    },
  })
}
