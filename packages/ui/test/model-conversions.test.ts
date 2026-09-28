import { describe, expect, it } from 'vitest'
import type { AnyDescriptor } from '@modkit/sdk'
import { convertedFileName } from '../src/image/index.js'
import { modelConversions } from '../src/model/index.js'

/*
 * A model codec's UVM export has no presets of its own, so the model view offered it nowhere: an
 * M3 reached UVM only through «Run command» (plan 6.21).
 */
const descriptor = (state: string) =>
  ({
    operations: [
      { id: 'model.export-uvm', handlerId: 'model-export-uvm', state, mutatesSource: false },
    ],
  }) as unknown as AnyDescriptor

describe('model conversions', () => {
  it('offer UVM for any codec that publishes model.export-uvm, as the host exports it', () => {
    const [uvm, ...rest] = modelConversions(descriptor('available'))
    expect(rest).toEqual([])
    expect(uvm?.form).toMatchObject({ id: 'uvm', label: 'UVM', handlerId: 'model-export-uvm' })
    expect(uvm?.input).toEqual({ schemaVersion: 1 })
    expect(convertedFileName('Marine', 'uvm', uvm?.form.writes?.extension ?? '')).toBe('Marine.uvm')
  })

  it('offer nothing for an export the codec switched off', () => {
    expect(modelConversions(descriptor('disabled'))).toEqual([])
  })
})
