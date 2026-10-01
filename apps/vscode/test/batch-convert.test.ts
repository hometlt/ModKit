import { describe, expect, it } from 'vitest'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import {
  batchConversionFor,
  batchOutputPath,
  runBatchConversion,
  type BatchConversion,
} from '../src/batch-convert.js'

const preset = (extension: string, handlerId = `convert-${extension}`): BatchConversion => ({
  form: {
    handlerId,
    label: extension.toUpperCase(),
    writes: { extension, mediaType: `x/${extension}` },
  },
  input: { target: extension },
})

describe('batch conversion', () => {
  it('takes the codec preset writing the asked extension and keeps the file in its place', () => {
    const presets = [preset('dds'), preset('png'), preset('PNG', 'second')]
    expect(batchConversionFor(presets, '.Png')?.form.handlerId).toBe('convert-png')
    expect(batchConversionFor(presets, 'wav')).toBeUndefined()
    expect(batchOutputPath('Textures/btn-marine.dds', 'png')).toBe('Textures/btn-marine.png')
    expect(batchOutputPath('noext', '.png')).toBe('noext.png')
  })

  it('converts what it can, says why it skips the rest, and stops when cancelled', async () => {
    const written: string[] = []
    const opened: string[] = []
    const controller = new AbortController()
    const operations = {
      async invoke(handlerId: string) {
        return {
          state: 'ok',
          output: { kind: 'bytes', value: new Uint8Array([1, handlerId.length]) },
        }
      },
    } as unknown as OperationSession
    const outcomes = await runBatchConversion({
      files: ['a.dds', 'notes.txt', 'b.dds', 'c.dds'],
      extension: 'png',
      open: async file => {
        opened.push(file)
        if (file === 'b.dds') controller.abort()
        return file.endsWith('.txt')
          ? { reason: 'no codec opened it', dispose: async () => undefined }
          : {
              descriptor: { file } as unknown as AnyDescriptor,
              operations,
              dispose: async () => undefined,
            }
      },
      conversions: () => [preset('png')],
      write: async (output, bytes) => {
        written.push(`${output}:${bytes.length}`)
        return output
      },
      signal: controller.signal,
    })
    expect(outcomes).toEqual([
      { state: 'converted', file: 'a.dds', output: 'a.png' },
      { state: 'skipped', file: 'notes.txt', reason: 'no codec opened it' },
    ])
    // the run stopped once cancelled: c.dds was never opened
    expect(opened).toEqual(['a.dds', 'notes.txt', 'b.dds'])
    expect(written).toEqual(['a.png:2'])
  })
})
