import type {
  AssetEditPlan,
  ChangeSet,
  CommitReceipt,
  EditorModule,
  EditorMount,
  Lease,
  TextDataSource,
} from '@modkit/sdk'
import { bindingId } from '@modkit/sdk'
import {
  createSurface,
  element,
  safeViewerText,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'
import { handleEditorSaveRequest } from './commands.js'
import { type UiLocalizer } from '../localization/index.js'
import { EDITOR_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

const TEXT_DATA_SOURCE = Object.freeze({
  bindingId: bindingId('editor-text'),
  contract: 'common.view/text-data-source' as const,
  major: 1 as const,
})

export interface TextEditorModuleOptions {
  readonly localizer?: UiLocalizer
  readonly maximumSourceBytes?: number
  readonly createChangeSet?: (args: {
    readonly text: string
    readonly targets: ChangeSet['targets']
  }) => ChangeSet
}

export function defineEditorModule(module: EditorModule): EditorModule {
  return Object.freeze(module)
}

async function loadText(source: TextDataSource, maximum: number, signal: AbortSignal) {
  const info = await source.info()
  if (info.bytes > BigInt(maximum))
    throw new RangeError('editor source exceeds bounded text budget')
  const slice = await source.slice(
    {
      kind: 'from-line',
      line: 0,
      lineCount: info.lines === 'unknown' ? Number.MAX_SAFE_INTEGER : Math.max(1, info.lines),
      maxBytes: maximum,
    },
    signal,
  )
  if (!slice.complete) throw new RangeError('editor source requires a streaming editor')
  return slice.text
}

function defaultChangeSet(text: string, targets: ChangeSet['targets']): ChangeSet {
  return {
    targets,
    edits: targets.map(target => ({
      operation: 'replace' as const,
      targetId: target.targetId,
      source: target.ownerSource,
      payload: { kind: 'text' as const, text },
      label: 'Edit text',
    })),
    provenance: { actor: 'user' },
  }
}

function rejectionText(state: string, reason?: string): string {
  return safeViewerText(reason === undefined ? state : `${state}: ${reason}`, 1024)
}

/**
 * Format-neutral bounded text editor. It owns DOM/edit intent only; validation, writer fidelity,
 * grants, revision checks and side effects stay behind the injected SDK ports.
 */
export function createTextEditorModule(options: TextEditorModuleOptions = {}): EditorModule {
  const localizer = withEnglishUiFallback(options.localizer, EDITOR_FALLBACK_MESSAGES)
  const maximum = options.maximumSourceBytes ?? 16 * 1024 * 1024
  return defineEditorModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('editor.text'))
      root.dataset['modkitEditor'] = 'text'
      root.dataset['revision'] = args.descriptor.revision
      const lease = (await args.sources.get(TEXT_DATA_SOURCE)) as Lease<TextDataSource> | undefined
      if (lease === undefined) throw new TypeError('text editor data-source binding is unavailable')
      scope.lease(lease)

      const toolbar = element(root, 'div', {
        className: 'modkit-editor__toolbar',
        role: 'toolbar',
        part: 'editor.toolbar',
      })
      toolbar.setAttribute('aria-label', localizer.text('viewer.editingActions'))
      const save = element(toolbar, 'button', {
        text: localizer.text('viewer.save'),
      }) as HTMLButtonElement
      save.dataset['modkitAction'] = 'save'
      const undo = element(toolbar, 'button', {
        text: localizer.text('viewer.undo'),
      }) as HTMLButtonElement
      const redo = element(toolbar, 'button', {
        text: localizer.text('viewer.redo'),
      }) as HTMLButtonElement
      const status = element(toolbar, 'output', {
        text: localizer.text('viewer.ready'),
        part: 'viewer.status',
      })
      save.type = undo.type = redo.type = 'button'
      undo.disabled = true
      redo.disabled = true
      const input = element(root, 'textarea', {
        className: 'modkit-editor__text',
        part: 'editor.text',
      }) as HTMLTextAreaElement
      input.setAttribute('aria-label', localizer.text('viewer.editableText'))
      input.spellcheck = false
      input.value = await loadText(lease.value, maximum, scope.signal)

      let busy = false
      let lastPlan: AssetEditPlan | undefined
      let lastReceipt: CommitReceipt | undefined

      const request = async (plan: AssetEditPlan) =>
        args.authorization.request(plan, { signal: scope.signal })

      const saveChange = async (): Promise<boolean> => {
        if (busy || scope.signal.aborted) return false
        busy = true
        save.disabled = true
        setViewerText(status, localizer.text('editor.validating'))
        try {
          const change =
            options.createChangeSet?.({ text: input.value, targets: args.edit.targets }) ??
            defaultChangeSet(input.value, args.edit.targets)
          const validation = await args.edit.propose(change)
          if (!validation.valid) {
            setViewerText(status, localizer.text('editor.validationRejected'))
            return false
          }
          const plan = await args.edit.plan(change)
          const authorization = await request(plan)
          if (authorization === undefined) {
            setViewerText(status, localizer.text('viewer.saveCancelled'))
            return false
          }
          const prepared = await args.commit.prepare(plan, {
            grant: authorization.grant,
            ...(authorization.confirmationToken === undefined
              ? {}
              : { confirmationToken: authorization.confirmationToken }),
            signal: scope.signal,
          })
          if (prepared.state !== 'ready') {
            setViewerText(
              status,
              prepared.state === 'conflict'
                ? localizer.text('editor.conflictChanged')
                : rejectionText(localizer.text('viewer.saveRejected'), prepared.reason),
            )
            return false
          }
          setViewerText(status, localizer.text('editor.saving'))
          const result = await args.commit.commit(prepared.prepared, {
            grant: authorization.grant,
            signal: scope.signal,
            onProgress: done =>
              setViewerText(status, localizer.text('editor.savingProgress', { progress: done })),
          })
          if (result.state === 'committed') {
            lastPlan = plan
            lastReceipt = result.receipt
            undo.disabled = result.receipt.undo === 'none'
            redo.disabled = true
            setViewerText(status, localizer.text('viewer.saved'))
            return true
          } else {
            setViewerText(
              status,
              result.state === 'not-applied'
                ? rejectionText(localizer.text('editor.notSaved'), result.reason)
                : result.state === 'rolled-back'
                  ? localizer.text('editor.rolledBack')
                  : localizer.text('editor.partiallySaved'),
            )
            return false
          }
        } catch (error) {
          setViewerText(status, error instanceof Error ? error.message : String(error))
          return false
        } finally {
          busy = false
          save.disabled = false
        }
      }

      const replay = async (kind: 'undo' | 'redo') => {
        if (busy || lastPlan === undefined || lastReceipt === undefined) return
        busy = true
        const authorization = await request(lastPlan)
        if (authorization === undefined) {
          setViewerText(
            status,
            localizer.text('editor.actionCancelled', {
              action: localizer.text(kind === 'undo' ? 'viewer.undo' : 'viewer.redo'),
            }),
          )
          busy = false
          return
        }
        const result = await args.commit[kind](lastReceipt.transactionId, {
          grant: authorization.grant,
          signal: scope.signal,
        })
        if (result.state === 'committed') {
          undo.disabled = kind === 'undo'
          redo.disabled = kind === 'redo'
          setViewerText(status, localizer.text(kind === 'undo' ? 'editor.undone' : 'editor.redone'))
        } else {
          setViewerText(
            status,
            result.state === 'not-applied'
              ? rejectionText(
                  localizer.text('editor.actionRejected', {
                    action: localizer.text(kind === 'undo' ? 'viewer.undo' : 'viewer.redo'),
                  }),
                  result.reason,
                )
              : localizer.text('editor.actionFailed', {
                  action: localizer.text(kind === 'undo' ? 'viewer.undo' : 'viewer.redo'),
                }),
          )
        }
        busy = false
      }

      save.addEventListener('click', saveChange)
      const removeSaveRequest = handleEditorSaveRequest(root, saveChange)
      undo.addEventListener('click', () => void replay('undo'))
      redo.addEventListener('click', () => void replay('redo'))
      scope.cleanup(() => {
        save.removeEventListener('click', saveChange)
        removeSaveRequest()
      })

      return Object.freeze({
        async update(update: Parameters<EditorMount['update']>[0]) {
          root.dataset['revision'] = update.descriptor.revision
          setViewerText(status, localizer.text('editor.sourceUpdated'))
        },
        async unmount() {
          await scope.close()
          await args.edit.dispose()
          root.remove()
        },
      }) satisfies EditorMount
    },
  })
}

export const textEditor = createTextEditorModule()

export {
  EDITOR_SAVE_REQUEST,
  handleEditorSaveRequest,
  requestEditorSave,
  type EditorSaveRequestDetail,
} from './commands.js'

export default textEditor
