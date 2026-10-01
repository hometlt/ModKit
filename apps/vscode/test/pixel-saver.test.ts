import { describe, expect, it, vi } from 'vitest'

import type { AnyDescriptor, AssetEditPlan, OperationSession } from '@modkit/sdk'

import {
  createVsCodePixelSaver,
  editFormFields,
  hasPartialAlpha,
  pixelSaveRefusal,
  wholeFileBytes,
} from '../src/edit-panel.js'
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

  it('asks for an encoding that keeps partial alpha when the source refuses it (7.4)', async () => {
    const file = new Uint8Array([0x44, 0x44, 0x53, 0x20])
    const applyPlan = vi.fn(async () => ({ failed: false, message: 'applied' }))
    const ask = vi.fn(async (_message: string, choices: readonly string[]) => {
      expect(choices).toEqual(['Save as DXT5', 'Save uncompressed (RGBA8, lossless)'])
      return 0
    })
    const save = createVsCodePixelSaver({
      localizer: createVscodeLocalizer('en'),
      portsFor: () => ({ applyPlan }) as never,
      reopen: async () => true,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
      ask,
    })
    const formats: unknown[] = []
    const invoke = vi.fn(async (_handler: string, input: { format: string }) => {
      formats.push(input.format)
      // the codec refuses as the host reports a handler failure: thrown
      if (input.format === 'keep') throw new Error('DXT1 conversion requires binary alpha')
      return {
        state: 'ok',
        output: {
          kind: 'edit-plan',
          plan: planWith([
            { operation: 'replace', targetId: 't', payload: { kind: 'inline', bytes: file } },
          ]),
        },
      }
    })
    // the DDS codec's own form names the encodings it can write
    const encoding = {
      key: 'format',
      label: 'Encoding',
      type: {
        kind: 'enum',
        members: [{ id: 'keep' }, { id: 'dxt1' }, { id: 'dxt5' }, { id: 'rgba8' }],
      },
      inputPath: ['format'],
      initial: 'dxt1',
    }
    const descriptor = {
      operations: [
        {
          id: 'edit.content',
          handlerId: 'image.edit',
          mutatesSource: true,
          state: 'available',
          inputSchema: {
            $ref: 'modkit://test/dds-edit-content.v1',
            document: {
              schemaVersion: 1,
              forms: [
                {
                  id: 'dds-recompress',
                  label: 'Change the DDS encoding',
                  summary: 'Re-encodes the base surface.',
                  baseInput: { transform: 'recompress' },
                  fields: [encoding],
                },
              ],
            },
          },
        },
      ],
    } as unknown as AnyDescriptor
    const request = {
      descriptor,
      operations: { invoke } as unknown as OperationSession,
      image: { width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 128]) },
    }
    expect(hasPartialAlpha(request.image.rgba)).toBe(true)
    expect((await save(request)).state).toBe('saved')
    expect(formats).toEqual(['keep', 'dxt5'])
    expect(applyPlan).toHaveBeenCalledTimes(1)
    // a backup never asks: it reports the refusal
    expect((await save({ ...request, mode: 'bytes' })).state).toBe('refused')
    expect(ask).toHaveBeenCalledTimes(1)
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

  it('leaves the encoding out of a transform form, but not of one that only asks for it (7.11)', () => {
    const field = (name: string) => ({ name }) as never
    const form = (...names: string[]) =>
      ({ id: 'f', fields: names.map(field) }) as unknown as Parameters<typeof editFormFields>[0]
    const names = (fields: readonly { readonly name: string }[]) => fields.map(item => item.name)
    expect(names(editFormFields(form('width', 'height', 'format'), true))).toEqual([
      'width',
      'height',
    ])
    // Change the DDS encoding: the encoding is the whole form
    expect(names(editFormFields(form('format'), true))).toEqual(['format'])
    expect(names(editFormFields(form('width', 'format'), false))).toEqual(['width', 'format'])
  })
})
