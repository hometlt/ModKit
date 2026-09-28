import { describe, expect, it, vi } from 'vitest'

import type { AnyDescriptor, AssetEditPlan, OperationSession } from '@modkit/sdk'

import { createVsCodePixelSaver, pixelSaveRefusal, wholeFileBytes } from '../src/edit-panel.js'
import { createVscodeLocalizer } from '../src/localization.js'

const planWith = (edits: readonly unknown[]): AssetEditPlan =>
  ({ planId: 'p', targets: [], edits, diagnostics: [] }) as unknown as AssetEditPlan

describe('pixel saver', () => {
  it('encodes the edited pixels for Save As and a backup without applying anything', async () => {
    const file = new Uint8Array([0x44, 0x44, 0x53, 0x20])
    const applyPlan = vi.fn(async () => ({ failed: false, message: 'applied' }))
    const reopen = vi.fn(async () => true)
    const save = createVsCodePixelSaver({
      localizer: createVscodeLocalizer('en'),
      portsFor: () => ({ applyPlan }) as never,
      reopen,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
    })
    const invoke = vi.fn(async () => ({
      state: 'ok',
      output: {
        kind: 'edit-plan',
        plan: planWith([
          { operation: 'replace', targetId: 't', payload: { kind: 'inline', bytes: file } },
        ]),
      },
    }))
    const request = {
      descriptor: {
        operations: [{ id: 'edit.content', handlerId: 'image.edit', mutatesSource: true }],
      } as unknown as AnyDescriptor,
      operations: { invoke } as unknown as OperationSession,
      image: { width: 1, height: 1, rgba: new Uint8Array(4) },
    }

    expect(await save({ ...request, mode: 'bytes' })).toEqual({ state: 'encoded', bytes: file })
    // the source is untouched: nothing applied, the tab not reopened
    expect(applyPlan).not.toHaveBeenCalled()
    expect(reopen).not.toHaveBeenCalled()

    expect((await save(request)).state).toBe('saved')
    expect(applyPlan).toHaveBeenCalledTimes(1)
  })

  it('offers the paint tools only where Save can write the pixels', async () => {
    const localizer = createVscodeLocalizer('en')
    const withOperations = (operations: readonly unknown[]) =>
      ({ operations }) as unknown as AnyDescriptor
    const writable = withOperations([
      { id: 'edit.content', handlerId: 'image.edit', mutatesSource: true },
    ])
    const exportOnly = withOperations([
      { id: 'export.convert', handlerId: 'convert', mutatesSource: false },
    ])
    const armed = { localizer, portsFor: () => ({}) as never }
    expect(pixelSaveRefusal(armed, writable)).toBeUndefined()
    // no encoder: the Edit section says export still works, and Save says the same
    const noEncoder = localizer.text('imageEditing.unavailable')
    expect(pixelSaveRefusal(armed, exportOnly)).toBe(noEncoder)
    // a read-only source has no editing arm, whatever its codec can write
    expect(pixelSaveRefusal({ localizer, portsFor: () => undefined }, writable)).toBe(
      localizer.text('vscode.edit.noArm'),
    )
    const save = createVsCodePixelSaver({
      localizer,
      portsFor: () => ({}) as never,
      reopen: async () => true,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
    })
    const invoke = vi.fn()
    const refused = await save({
      descriptor: exportOnly,
      operations: { invoke } as unknown as OperationSession,
      image: { width: 1, height: 1, rgba: new Uint8Array(4) },
    })
    expect(refused).toEqual({ state: 'refused', reason: noEncoder })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('takes the file only from a plan that replaces one whole file', () => {
    const replace = (payload: unknown, range?: unknown) => ({
      operation: 'replace',
      targetId: 't',
      payload,
      ...(range === undefined ? {} : { range }),
    })
    const bytes = new Uint8Array([1, 2, 3])
    expect(wholeFileBytes(planWith([replace({ kind: 'inline', bytes })]))).toBe(bytes)
    expect(wholeFileBytes(planWith([replace({ kind: 'text', text: 'hi' })]))).toEqual(
      new TextEncoder().encode('hi'),
    )
    const ranged = replace({ kind: 'inline', bytes }, { kind: 'bytes', offset: 0n, length: 1n })
    expect(wholeFileBytes(planWith([ranged]))).toBeUndefined()
    expect(wholeFileBytes(planWith([replace({ kind: 'staged', ref: {} })]))).toBeUndefined()
    const both = [replace({ kind: 'inline', bytes }), replace({ kind: 'inline', bytes })]
    expect(wholeFileBytes(planWith(both))).toBeUndefined()
  })
})
