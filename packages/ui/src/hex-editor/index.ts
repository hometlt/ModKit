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
import type { ByteRangeSource, EditorModule, EditorMount } from '@modkitx-x3/sdk'
import { bindingId } from '@modkitx-x3/sdk'

import {
  createSurface,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'
import { HexWindowModel, HEX_WINDOW_BYTES } from '../hex/index.js'

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

export const hexEditor: EditorModule = {
  abiVersion: 1,
  async mount(args): Promise<EditorMount> {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Hex editor')
    const lease = (await args.sources.get(BYTE_RANGE_SOURCE)) as
      { value: ByteRangeSource; release(): Promise<void> } | undefined
    if (lease === undefined) throw new TypeError('hex editor binding is unavailable')
    scope.lease(lease)

    const source = lease.value as ByteRangeSource
    const model = new HexWindowModel(source)

    const toolbar = element(root, 'div', { part: 'hex.toolbar', role: 'toolbar' })
    toolbar.setAttribute('aria-label', 'Hex editing')
    const offsetInput = element(toolbar, 'input', { part: 'hex.offset-input' }) as HTMLInputElement
    offsetInput.type = 'text'
    offsetInput.value = '0'
    offsetInput.setAttribute('aria-label', 'Byte offset')
    const go = element(toolbar, 'button', { text: 'Go', part: 'hex.go' }) as HTMLButtonElement
    go.type = 'button'
    const save = element(toolbar, 'button', {
      text: 'Save',
      part: 'operations.button',
    }) as HTMLButtonElement
    save.type = 'button'
    save.disabled = true
    const revert = element(toolbar, 'button', {
      text: 'Revert',
      part: 'operations.button',
    }) as HTMLButtonElement
    revert.type = 'button'
    revert.disabled = true
    const status = element(toolbar, 'output', { text: 'Ready', part: 'viewer.status' })

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
      void args.edit.propose({
        baseRevisions: { content: args.descriptor.revision },
        edits: runs.map(run => ({
          kind: 'bytes' as const,
          bindingId: 'content',
          range: { kind: 'bytes' as const, offset: run.offset, length: BigInt(run.bytes.length) },
          payload: { kind: 'inline' as const, bytes: run.bytes },
        })),
        provenance: { origin: 'hex-editor' },
      } as never)
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

    const syncDirty = (): void => {
      const dirty = pending.size > 0
      save.disabled = !dirty
      revert.disabled = !dirty
      setState(root, dirty ? ['mutating'] : [])
      setViewerText(status, dirty ? `${pending.size} byte(s) changed` : 'Ready')
    }

    const renderWindow = async (): Promise<void> => {
      const raw = offsetInput.value.trim()
      const parsed = /^(?:0x)?[0-9a-f]+$/iu.test(raw) ? BigInt(raw) : 0n
      const view = await model.read(parsed, scope.signal)
      windowOffset = view.offset
      original = view.bytes
      pending.clear()
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
          cell.setAttribute('aria-label', `byte at ${absolute}`)

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

          cell.addEventListener('blur', () => {
            const text = (cell.textContent ?? '').trim()
            if (!HEX_BYTE.test(text)) {
              // Restore what the source holds rather than writing a guess.
              const key = absolute.toString(10)
              const known = pending.get(key)?.after ?? value
              setByte(absolute, value, known)
              return
            }
            setByte(absolute, value, Number.parseInt(text, 16))
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
          glyph.setAttribute('aria-label', `character at ${absolute}`)
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
            setByte(absolute, value, code)
          })
        }
      }
      syncDirty()
    }

    const commit = async (): Promise<void> => {
      if (pending.size === 0) return
      const runs = coalesceHexEdits([...pending.values()])
      const change = {
        baseRevisions: { content: args.descriptor.revision },
        edits: runs.map(run => ({
          kind: 'bytes' as const,
          bindingId: 'content',
          range: { kind: 'bytes' as const, offset: run.offset, length: BigInt(run.bytes.length) },
          payload: { kind: 'inline' as const, bytes: run.bytes },
        })),
        provenance: { origin: 'hex-editor' },
      }
      setViewerText(status, 'Validating…')
      const validation = await args.edit.propose(change as never)
      if ((validation as { state?: string }).state === 'invalid') {
        setState(root, ['error'])
        setViewerText(status, 'Rejected by validation')
        return
      }
      const plan = await args.edit.plan(change as never)
      const authorization = await args.authorization.request(plan)
      if (authorization === undefined) {
        setViewerText(status, 'Not authorised')
        return
      }
      const prepared = await args.commit.prepare(plan, { grant: authorization.grant })
      const state = (prepared as { state?: string }).state
      if (state !== 'prepared') {
        setState(root, ['error'])
        setViewerText(status, `Prepare failed: ${state ?? 'unknown'}`)
        return
      }
      await args.commit.commit((prepared as unknown as { prepared: never }).prepared, {
        grant: authorization.grant,
      } as never)
      setState(root, [])
      setViewerText(status, `Committed ${runs.length} range(s)`)
      await renderWindow()
    }

    go.addEventListener('click', () => void renderWindow())
    revert.addEventListener('click', () => void renderWindow())
    save.addEventListener('click', () => void commit())

    await renderWindow()

    return {
      async update(next) {
        root.dataset['revision'] = String(next.revision)
        await renderWindow()
      },
      async unmount() {
        await scope.close()
        root.remove()
      },
    } as EditorMount
  },
}

export { HEX_WINDOW_BYTES }
