import type { AnyDescriptor } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { exportOffer } from '../src/field-editor/index.js'
import { convertedFileName } from '../src/image/index.js'

const presets = {
  schemaVersion: 1,
  forms: [
    { id: 'png', label: 'Export PNG', summary: 's', baseInput: { target: 'png' }, fields: [] },
    {
      id: 'dxt1',
      label: 'DXT1',
      summary: 's',
      baseInput: { target: 'dds', format: 'dxt1' },
      fields: [],
    },
  ],
}

function descriptor(mutatesSource: boolean, state = 'available'): AnyDescriptor {
  return {
    operations: [
      {
        id: 'export.convert',
        handlerId: 'convert',
        mutatesSource,
        state,
        inputSchema: { $ref: 'modkit://test/export.v1', document: presets },
      },
    ],
    metadata: [],
  } as unknown as AnyDescriptor
}

describe('image conversion presets', () => {
  it('offers export.convert presets with their fixed input', () => {
    const forms = exportOffer(descriptor(false))
    expect(forms.map(form => form.id)).toEqual(['png', 'dxt1'])
    expect(forms[1]!.build(new Map())).toEqual({ target: 'dds', format: 'dxt1' })
    expect(forms[0]!.handlerId).toBe('convert')
  })

  it('never offers a mutating or unavailable operation as an export', () => {
    expect(exportOffer(descriptor(true))).toEqual([])
    expect(exportOffer(descriptor(false, 'unavailable'))).toEqual([])
  })

  it('names converted files as MK2 did', () => {
    // `writes.extension` as manifests declare it, with its dot
    expect(convertedFileName('tex', 'png', '.png')).toBe('tex.png')
    expect(convertedFileName('tex', 'dxt1', '.dds')).toBe('tex.dxt1.dds')
    expect(convertedFileName('tex', 'button', '.dds')).toBe('tex.button.dds')
    expect(convertedFileName('tex', 'png', 'png')).toBe('tex.png')
  })
})
