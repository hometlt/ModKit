import type { AnyDescriptor } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { exportOffer } from '../src/field-editor/index.js'
import { convertedFileName, firstShownMip } from '../src/image/index.js'

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
    // a codec's encoding preset, `<target>-<encoding>`, by its encoding
    expect(convertedFileName('tex', 'dds-dxt5', '.dds')).toBe('tex.dxt5.dds')
  })
})

describe('image start level', () => {
  const info = (size: number, mipLevels: number) =>
    ({ width: size, height: size, mipLevels }) as Parameters<typeof firstShownMip>[0]

  it('starts an image over the 64 MiB budget at the first mip that fits', () => {
    expect(firstShownMip(info(1024, 11))).toBe(0)
    expect(firstShownMip(info(4096, 13))).toBe(0)
    expect(firstShownMip(info(8192, 14))).toBe(1)
    expect(firstShownMip(info(16384, 15))).toBe(2)
  })

  it('stays at mip 0 when no declared level fits, so the read says why', () => {
    expect(firstShownMip(info(8192, 1))).toBe(0)
  })
})
