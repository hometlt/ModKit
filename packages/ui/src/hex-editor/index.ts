/**
 * HexEditor — byte-level editing over `common.view/byte-range-source`.
 *
 * Read-only hex stays `hexViewer`; editing is a separate `EditorModule` because the presence of
 * `content.binary` never implies an editor (doc 06 §16). The editor does not own saving: it builds
 * a `ChangeSet` of byte-range `SourceEdit`s, the commit coordinator re-checks revisions and
 * permissions, and the authorization port grants.
 *
 * Only the loaded window is editable, and only bytes that actually changed are emitted — a
 * one-byte change in a 1 TiB source produces a one-byte edit, never a whole-file rewrite.
 */
import type { ByteRangeSource, ChangeSet, EditorModule, EditorMount } from '@modkit/sdk'
import { bindingId } from '@modkit/sdk'

import {
  createSurface,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'
import { HexWindowModel, HEX_WINDOW_BYTES, parseByteOffset } from '../hex/index.js'
import {
  announceEditorEdit,
  handleEditorHistoryRequest,
  handleEditorSaveRequest,
} from '../editor/commands.js'
import { type UiLocalizer } from '../localization/index.js'
import { HEX_EDITOR_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/**
 * The binding this editor reads.
 *
 * An `EditorModule` mount carries no presentation slot — only a viewer gets one — so an editor
 * names its binding directly instead of looking one up. The previous code passed an empty slot to
 * `unknownSourceLease`, whose search therefore never matched and the editor failed for every host.
 */
const BYTE_RANGE_SOURCE = Object.freeze({
  bindingId: bindingId('editor-hex'),
  contract: 'common.view/byte-range-source' as const,
  major: 1 as const,
})

const HEX_BYTE = /^[0-9a-f]{1,2}$/iu

export interface HexEdit {
  readonly offset: bigint
  readonly before: number
  readonly after: number
}

/**
 * The pending runs as a `ChangeSet`.
 *
 * This used to be hand-built with fields no contract declares — `baseRevisions`, `bindingId`, a
 * bare `kind` — and cast `as never`, which is precisely why nobody noticed. `ChangeSet` is
 * `{ targets, edits: SourceEdit[], provenance: { actor } }`, and the first thing `createRawWriter`
 * does is read `change.targets`. The hex editor could not save through any writer, and the cast
 * silenced the one place that would have said so.
 *
 * The edits address the target's own source by byte range, which is what a hex editor means: no
 * semantic path, no re-encoding, just these bytes at this offset.
 */
function hexChangeSet(
  runs: readonly { readonly offset: bigint; readonly bytes: Uint8Array }[],
  targets: ChangeSet['targets'],
): ChangeSet {
  const target = targets[0]
  if (target === undefined) throw new TypeError('the edit session carries no target to write to')
  return {
    targets,
    edits: runs.map(run => ({
      operation: 'replace' as const,
      targetId: target.targetId,
      source: target.ownerSource,
      range: { kind: 'bytes' as const, offset: run.offset, length: BigInt(run.bytes.length) },
      payload: { kind: 'inline' as const, bytes: run.bytes },
      label: 'Edit bytes',
    })),
    provenance: { actor: 'user' },
  }
}

/** Pure: collapse per-byte changes into contiguous runs so one drag is one edit, not fifty. */
export function coalesceHexEdits(
  edits: readonly HexEdit[],
): readonly { readonly offset: bigint; readonly bytes: Uint8Array }[] {
  const sorted = [...edits].sort((left, right) => (left.offset < right.offset ? -1 : 1))
  const runs: { offset: bigint; values: number[] }[] = []
  for (const edit of sorted) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.offset + BigInt(last.values.length) === edit.offset) {
      last.values.push(edit.after)
      continue
    }
    runs.push({ offset: edit.offset, values: [edit.after] })
  }
  return runs.map(run => ({ offset: run.offset, bytes: new Uint8Array(run.values) }))
}

export interface HexEditorOptions {
  readonly localizer?: UiLocalizer
}

export function createHexEditor(options: HexEditorOptions = {}): EditorModule {
  const localizer = withEnglishUiFallback(options.localizer, HEX_EDITOR_FALLBACK_MESSAGES)
  return {
    abiVersion: 1,
    async mount(args): Promise<EditorMount> {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('editor.hex'))
      root.dataset['modkitEditor'] = 'hex'
      const lease = (await args.sources.get(BYTE_RANGE_SOURCE)) as
        { value: ByteRangeSource; release(): Promise<void> } | undefined
      if (lease === undefined) throw new TypeError('hex editor binding is unavailable')
      scope.lease(lease)

      const source = lease.value as ByteRangeSource
      const model = new HexWindowModel(source)

      const toolbar = element(root, 'div', { part: 'hex.toolbar', role: 'toolbar' })
      toolbar.setAttribute('aria-label', localizer.text('viewer.hexEditing'))
      const offsetInput = element(toolbar, 'input', {
        part: 'hex.offset-input',
      }) as HTMLInputElement
      offsetInput.type = 'text'
      offsetInput.value = '0'
      offsetInput.setAttribute('aria-label', localizer.text('viewer.byteOffset'))
      const go = element(toolbar, 'button', {
        text: localizer.text('viewer.go'),
        part: 'hex.go',
      }) as HTMLButtonElement
      go.type = 'button'
      const save = element(toolbar, 'button', {
        text: localizer.text('viewer.save'),
        part: 'operations.button',
      }) as HTMLButtonElement
      save.type = 'button'
      save.dataset['modkitAction'] = 'save'
      save.disabled = true
      const revert = element(toolbar, 'button', {
        text: localizer.text('viewer.revert'),
        part: 'operations.button',
      }) as HTMLButtonElement
      revert.type = 'button'
      revert.disabled = true
      const status = element(toolbar, 'output', {
        text: localizer.text('viewer.ready'),
        part: 'viewer.status',
      })

      const grid = element(root, 'div', { part: 'hex.content' })
      grid.setAttribute('role', 'grid')

      let windowOffset = 0n
      let original: Uint8Array<ArrayBufferLike> = new Uint8Array()
      const pending = new Map<string, HexEdit>()
      /** Live cell elements per offset, so a hex edit can repaint its ASCII twin and vice versa. */
      const hexCells = new Map<string, HTMLElement>()
      const asciiCells = new Map<string, HTMLElement>()

      const printable = (value: number): string =>
        value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'

      /**
       * Announce that the buffer differs from disk.
       *
       * The host learns about unsaved work through `propose`, which is what marks the tab. Without
       * this a byte could sit edited in the grid while the tab still looked saved.
       */
      const announce = (): void => {
        if (pending.size === 0) return
        const runs = coalesceHexEdits([...pending.values()])
        void args.edit.propose(hexChangeSet(runs, args.edit.targets))
      }

      /** Apply a new value for one offset and keep both columns in step. */
      const setByte = (absolute: bigint, base: number, next: number): void => {
        const key = absolute.toString(10)
        if (next === base) pending.delete(key)
        else pending.set(key, { offset: absolute, before: base, after: next })

        const hex = hexCells.get(key)
        if (hex !== undefined) {
          hex.textContent = next.toString(16).padStart(2, '0')
          setState(hex, next === base ? [] : ['mutating'])
        }
        const ascii = asciiCells.get(key)
        if (ascii !== undefined) {
          ascii.textContent = printable(next)
          setState(ascii, next === base ? [] : ['mutating'])
        }
        syncDirty()
        announce()
      }

      /*
       * Each committed byte change, newest last. Undo walks back and redo forward; the host's own
       * stack (VS Code's Edit > Undo, Ctrl+Z) drives both through `handleEditorHistoryRequest`,
       * one step per `announceEditorEdit`. A new window, a revert or a save starts over.
       */
      interface ByteStep {
        readonly offset: bigint
        readonly base: number
        readonly from: number
        readonly to: number
      }
      const history: ByteStep[] = []
      const future: ByteStep[] = []

      /** A change the user made: applied, recorded and announced, unless it changed nothing. */
      const editByte = (absolute: bigint, base: number, next: number): void => {
        const from = pending.get(absolute.toString(10))?.after ?? base
        setByte(absolute, base, next)
        if (from === next) return
        history.push({ offset: absolute, base, from, to: next })
        future.length = 0
        announceEditorEdit(root)
      }

      const step = (
        from: ByteStep[],
        into: ByteStep[],
        value: (record: ByteStep) => number,
      ): boolean => {
        const record = from.pop()
        if (record === undefined) return false
        setByte(record.offset, record.base, value(record))
        into.push(record)
        return true
      }

      const syncDirty = (): void => {
        const dirty = pending.size > 0
        save.disabled = !dirty
        revert.disabled = !dirty
        setState(root, dirty ? ['mutating'] : [])
        setViewerText(
          status,
          dirty
            ? localizer.text('editor.bytesChanged', { count: pending.size })
            : localizer.text('viewer.ready'),
        )
      }

      const renderWindow = async (): Promise<void> => {
        const view = await model.read(parseByteOffset(offsetInput.value) ?? 0n, scope.signal)
        windowOffset = view.offset
        original = view.bytes
        pending.clear()
        history.length = 0
        future.length = 0
        drawWindow()
      }

      /**
       * Draw the grid from the bytes this editor already holds.
       *
       * Separate from `renderWindow` because after a commit there is nothing left to read: the source
       * was opened at a revision the commit has just superseded, so asking it again refuses with
       * "changed on disk while it was open" — and since the Save handler discards its promise, that
       * refusal surfaced as an unhandled rejection while the grid kept showing pre-save bytes. The
       * editor knows exactly what it wrote, so it draws that instead of asking.
       */
      const drawWindow = (): void => {
        grid.replaceChildren()

        for (let row = 0; row < original.length; row += 16) {
          const line = element(grid, 'div', { part: 'hex.row' })
          line.setAttribute('role', 'row')
          const address = (windowOffset + BigInt(row)).toString(16).padStart(16, '0')
          element(line, 'span', { text: address, part: 'hex.gutter' })
          const chunk = original.slice(row, row + 16)
          for (const [column, value] of [...chunk].entries()) {
            const absolute = windowOffset + BigInt(row + column)
            const cell = element(line, 'span', { part: 'hex.cell' }) as HTMLSpanElement
            cell.setAttribute('role', 'gridcell')
            cell.contentEditable = 'true'
            cell.spellcheck = false
            cell.dataset['offset'] = absolute.toString(10)
            cell.textContent = value.toString(16).padStart(2, '0')
            cell.setAttribute(
              'aria-label',
              localizer.text('viewer.byteAt', { offset: absolute.toString() }),
            )

            hexCells.set(absolute.toString(10), cell)

            /*
             * Reject non-hex keys at the source rather than cleaning up afterwards: a cell that
             * briefly shows `zz` and then snaps back is worse than one that never accepted `z`.
             * Navigation, deletion and shortcuts stay allowed.
             */
            cell.addEventListener('beforeinput', event => {
              const data = (event as InputEvent).data
              if (data === null) return
              const current = (cell.textContent ?? '').replace(/\s/gu, '')
              if (!/^[0-9a-f]$/iu.test(data) || current.length >= 2) event.preventDefault()
            })

            // Two digits are a whole byte: it is one undoable step then, not at some later blur.
            cell.addEventListener('input', () => {
              const text = (cell.textContent ?? '').trim()
              if (text.length === 2 && HEX_BYTE.test(text))
                editByte(absolute, value, Number.parseInt(text, 16))
            })

            cell.addEventListener('blur', () => {
              const text = (cell.textContent ?? '').trim()
              if (!HEX_BYTE.test(text)) {
                // Restore what the source holds rather than writing a guess.
                const key = absolute.toString(10)
                const known = pending.get(key)?.after ?? value
                setByte(absolute, value, known)
                return
              }
              editByte(absolute, value, Number.parseInt(text, 16))
            })
          }
          /*
           * The ASCII column is editable too, and edits flow both ways: typing a character rewrites
           * its byte, and editing the byte repaints the character. One value, two views of it.
           */
          const ascii = element(line, 'span', { part: 'hex.ascii' })
          for (const [column, value] of [...chunk].entries()) {
            const absolute = windowOffset + BigInt(row + column)
            const glyph = element(ascii, 'span') as HTMLSpanElement
            glyph.contentEditable = 'true'
            glyph.spellcheck = false
            glyph.textContent = printable(value)
            glyph.setAttribute(
              'aria-label',
              localizer.text('viewer.characterAt', { offset: absolute.toString() }),
            )
            asciiCells.set(absolute.toString(10), glyph)

            // One printable character per cell; anything else would not map to a single byte.
            glyph.addEventListener('beforeinput', event => {
              const data = (event as InputEvent).data
              if (data === null) return
              if (data.length !== 1 || data.charCodeAt(0) < 0x20 || data.charCodeAt(0) > 0x7e) {
                event.preventDefault()
              }
            })

            glyph.addEventListener('blur', () => {
              const text = glyph.textContent ?? ''
              const code = text.length === 1 ? text.charCodeAt(0) : Number.NaN
              if (Number.isNaN(code) || code < 0x20 || code > 0x7e) {
                const known = pending.get(absolute.toString(10))?.after ?? value
                setByte(absolute, value, known)
                return
              }
              editByte(absolute, value, code)
            })
          }
        }
        syncDirty()
      }

      const commit = async (): Promise<boolean> => {
        if (pending.size === 0) return true
        const runs = coalesceHexEdits([...pending.values()])
        const change = hexChangeSet(runs, args.edit.targets)
        setViewerText(status, localizer.text('editor.validating'))
        // `ValidationResult` is `{ valid, diagnostics }` (13D); this used to look for a `state` of
        // `invalid`, which no writer produces — so a refused change went on to be planned and
        // prepared as if the writer had accepted it
        const validation = await args.edit.propose(change)
        if (!validation.valid) {
          setState(root, ['error'])
          const first = validation.diagnostics[0]
          setViewerText(
            status,
            first === undefined
              ? localizer.text('editor.rejectedValidation')
              : localizer.text('editor.rejectedReason', { reason: first.message }),
          )
          return false
        }
        const plan = await args.edit.plan(change)
        const authorization = await args.authorization.request(plan)
        if (authorization === undefined) {
          setViewerText(status, localizer.text('editor.notAuthorized'))
          return false
        }
        const prepared = await args.commit.prepare(plan, { grant: authorization.grant })
        // `ready` is what a CommitCoordinator answers with (13D `PrepareCommitResult`); this used to
        // look for `prepared`, a state no coordinator produces, so every save reported a failure
        // after the plan had already been made
        if (prepared.state !== 'ready') {
          setState(root, ['error'])
          setViewerText(
            status,
            prepared.state === 'conflict'
              ? localizer.text('editor.conflictChanged')
              : localizer.text('editor.prepareRejected', { reason: prepared.reason ?? '' }),
          )
          return false
        }
        const receipt = await args.commit.commit(prepared.prepared, {
          grant: authorization.grant,
        })
        if (receipt.state !== 'committed') {
          setState(root, ['error'])
          setViewerText(
            status,
            receipt.state === 'not-applied'
              ? localizer.text('editor.saveRejectedReason', { reason: receipt.reason ?? '' })
              : localizer.text('editor.saveState', { state: receipt.state }),
          )
          return false
        }
        /*
         * Fold what was committed into the bytes on screen. Re-reading is not an option (the source
         * is pinned to the revision this commit superseded), and leaving the grid on the old bytes
         * would show the file as it no longer is.
         */
        const updated = new Uint8Array(original)
        for (const run of runs) {
          const start = Number(run.offset - windowOffset)
          if (start >= 0 && start + run.bytes.length <= updated.length)
            updated.set(run.bytes, start)
        }
        original = updated
        pending.clear()
        history.length = 0
        future.length = 0
        drawWindow()
        setState(root, [])
        /*
         * The session still holds the revision it opened with, so a second save from this tab is a
         * conflict by construction. Saying so is better than letting the next Save fail with a word
         * the user has no way to connect to this one.
         */
        setViewerText(status, localizer.text('editor.committedRanges', { count: runs.length }))
        return true
      }

      go.addEventListener('click', () => void renderWindow())
      revert.addEventListener('click', () => void renderWindow())
      save.addEventListener('click', () => {
        // no bare `void`: a rejection here is the one thing the user most needs to be told about
        commit().catch((error: unknown) => {
          setState(root, ['error'])
          setViewerText(
            status,
            localizer.text('editor.saveFailed', {
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
        })
      })
      const removeSaveRequest = handleEditorSaveRequest(root, commit)
      const removeHistoryRequest = handleEditorHistoryRequest(root, {
        undo: () => step(history, future, record => record.from),
        redo: () => step(future, history, record => record.to),
      })

      await renderWindow()

      return {
        async update(next) {
          root.dataset['revision'] = String(next.revision)
          await renderWindow()
        },
        async unmount() {
          removeSaveRequest()
          removeHistoryRequest()
          await scope.close()
          root.remove()
        },
      } as EditorMount
    },
  }
}

export const hexEditor: EditorModule = createHexEditor()

export { HEX_WINDOW_BYTES }
