import { describe, expect, it } from 'vitest'

import {
  builtinByteRangeSource,
  builtinTextSource,
  decodeUtf8,
  looksTextual,
} from '../src/explorer/builtin.js'

const encoder = new TextEncoder()

describe('explorer built-in fallback sources', () => {
  it('offers valid UTF-8 as text and rejects malformed or NUL-bearing input', () => {
    expect(decodeUtf8(encoder.encode('hello ✓'))).toBe('hello ✓')
    expect(decodeUtf8(Uint8Array.from([0xc3, 0x28]))).toBeUndefined()
    expect(looksTextual(encoder.encode('alpha\nbeta'))).toBe(true)
    expect(looksTextual(Uint8Array.from([0x50, 0x4b, 0x00, 0x03]))).toBe(false)
    expect(looksTextual(Uint8Array.from([...encoder.encode('valid'), 0xc3, 0x28]))).toBe(false)
  })

  it('publishes bounded text information, slices and search results', async () => {
    const source = builtinTextSource(encoder.encode('alpha\nbeta\ngamma'))

    await expect(source.info()).resolves.toMatchObject({ lines: 3, encoding: 'utf-8' })
    await expect(
      source.slice({ kind: 'from-line', line: 1, lineCount: 1, maxBytes: 64 }),
    ).resolves.toEqual({
      text: 'beta\n',
      fromLine: 1,
      lineCount: 1,
      complete: false,
      nextCursor: 'c11-l2',
    })

    const firstPage = await source.slice({
      kind: 'from-line',
      line: 0,
      lineCount: 3,
      maxBytes: 7,
    })
    expect(firstPage).toMatchObject({ complete: false, text: 'alpha\nb', fromLine: 0 })
    if (firstPage.complete) throw new Error('fixture must be paged')
    await expect(
      source.slice({ kind: 'from-cursor', cursor: firstPage.nextCursor, maxBytes: 64 }),
    ).resolves.toMatchObject({ complete: true, text: 'eta\ngamma' })

    const matches = []
    for await (const match of source.search({ pattern: 'mm' })) matches.push(match)
    expect(matches).toEqual([
      {
        byteOffset: '13',
        byteLength: '2',
      },
    ])
  })

  it('never reads beyond the byte buffer', async () => {
    const source = builtinByteRangeSource(Uint8Array.from([1, 2, 3, 4]))

    await expect(source.size()).resolves.toBe(4n)
    await expect(source.read(2n, 16)).resolves.toEqual(Uint8Array.from([3, 4]))
    await expect(source.read(10n, 2)).resolves.toEqual(new Uint8Array())
    await expect(source.read(-1n, 2)).rejects.toThrow('non-negative offset')
    await expect(source.read(0n, Number.NaN)).rejects.toThrow('safe length')
  })
})
