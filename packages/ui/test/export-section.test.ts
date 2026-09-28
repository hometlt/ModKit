import type { AnyDescriptor } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { exportConversions } from '../src/export/index.js'

/*
 * The Export section offers what a codec's `export.convert` presets write — the same offer image
 * views draw — so a WEM gets «WAV» and «OGG» buttons without the section knowing audio.
 */
const descriptor = (state = 'available'): AnyDescriptor =>
  ({
    operations: [
      {
        id: 'export.convert',
        handlerId: 'convert-audio',
        mutatesSource: false,
        state,
        inputSchema: {
          $ref: 'modkit://test/wem-export.v1',
          document: {
            schemaVersion: 1,
            forms: [
              {
                id: 'wav',
                label: 'WAV',
                summary: 'PCM as a WAV file',
                baseInput: { target: 'wav' },
                fields: [],
                writes: {
                  format: { id: 'wav', label: 'WAV' },
                  extension: '.wav',
                  mediaType: 'audio/wav',
                },
              },
              // a preset of the same operation that writes no file is not a conversion
              { id: 'probe', label: 'Probe', summary: 's', baseInput: { probe: true }, fields: [] },
            ],
          },
        },
      },
    ],
    metadata: [],
  }) as unknown as AnyDescriptor

describe('the Export section', () => {
  it('offers the conversions that name the file they write, with their fixed input', () => {
    const conversions = exportConversions(descriptor())
    expect(conversions.map(item => item.form.id)).toEqual(['wav'])
    expect(conversions[0]?.input).toEqual({ target: 'wav' })
    expect(conversions[0]?.form.writes.extension).toBe('.wav')
  })

  it('offers nothing when the operation is not available here', () => {
    expect(exportConversions(descriptor('unavailable'))).toEqual([])
  })
})
