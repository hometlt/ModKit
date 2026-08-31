import { describe, expect, it } from 'vitest'
import type { SourceEdit } from '@modkit/sdk'

function spliceUtf16(
  source: string,
  range: { readonly offset: number; readonly length: number },
  replacement: string,
): string {
  if (
    !Number.isSafeInteger(range.offset) ||
    !Number.isSafeInteger(range.length) ||
    range.offset < 0 ||
    range.length < 0 ||
    range.offset + range.length > source.length
  ) {
    throw new RangeError('invalid UTF-16 edit range')
  }
  return `${source.slice(0, range.offset)}${replacement}${source.slice(
    range.offset + range.length,
  )}`
}

function replaceOccurrence(source: string, needle: string, replacement: string): string {
  const offset = source.indexOf(needle)
  if (offset < 0 || source.indexOf(needle, offset + 1) >= 0) {
    throw new TypeError('target must occur exactly once')
  }
  return spliceUtf16(source, { offset, length: needle.length }, replacement)
}

function applyArchiveEdits(
  input: ReadonlyMap<string, Uint8Array>,
  edits: readonly SourceEdit[],
): ReadonlyMap<string, Uint8Array> {
  const output = new Map(input)
  for (const edit of edits) {
    if (edit.operation === 'create') {
      if (edit.payload.kind !== 'inline') throw new TypeError('fixture expects inline bytes')
      output.set(edit.newPath, edit.payload.bytes.slice())
    } else if (edit.operation === 'delete') {
      const path = new URL(edit.source.uri).pathname.replace(/^\//u, '')
      output.delete(path)
    } else {
      throw new TypeError(`archive fixture cannot apply ${edit.operation}`)
    }
  }
  return output
}

describe('13D format-preservation vertical proofs', () => {
  it('performs a JSONC targeted edit while preserving BOM/comments/indent/order byte-for-byte', () => {
    const source =
      '\uFEFF{\r\n  // keep this comment\r\n  "first": 1,\r\n  "name": "old",\r\n  "last": 3\r\n}\r\n'
    const noOp = replaceOccurrence(source, '"old"', '"old"')
    expect(new TextEncoder().encode(noOp)).toEqual(new TextEncoder().encode(source))

    const edited = replaceOccurrence(source, '"old"', '"new"')
    expect(edited).toBe(
      '\uFEFF{\r\n  // keep this comment\r\n  "first": 1,\r\n  "name": "new",\r\n  "last": 3\r\n}\r\n',
    )
    expect(edited.startsWith('\uFEFF')).toBe(true)
    expect(edited).toContain('// keep this comment')
    expect(edited.indexOf('"first"')).toBeLessThan(edited.indexOf('"name"'))
    expect(edited.indexOf('"name"')).toBeLessThan(edited.indexOf('"last"'))
  })

  it('splices one INI line without changing either neighbour or CRLF bytes', () => {
    const source = '; header\r\nalpha=1\r\nbeta=old value\r\ngamma=3\r\n'
    const edited = replaceOccurrence(source, 'beta=old value', 'beta=new value')
    expect(edited).toBe('; header\r\nalpha=1\r\nbeta=new value\r\ngamma=3\r\n')
    expect(edited.split('\r\n')[1]).toBe('alpha=1')
    expect(edited.split('\r\n')[3]).toBe('gamma=3')
  })

  it('splices a multiline CSV cell while preserving quoting and every other row', () => {
    const source = 'id,value\r\n1,"line\r\none"\r\n2,"untouched,quoted"\r\n'
    const edited = replaceOccurrence(source, 'line\r\none', 'changed\r\ncell')
    expect(edited).toBe('id,value\r\n1,"changed\r\ncell"\r\n2,"untouched,quoted"\r\n')
    expect(edited.endsWith('2,"untouched,quoted"\r\n')).toBe(true)
  })

  it('adds/deletes archive entries without touching or recompressing unaffected payloads', () => {
    const untouched = new Uint8Array([9, 8, 7, 6])
    const removed = new Uint8Array([1, 1, 1])
    const input = new Map<string, Uint8Array>([
      ['keep.bin', untouched],
      ['remove.bin', removed],
    ])
    const archive = { id: 'archive', uri: 'memory://archive/' }
    const output = applyArchiveEdits(input, [
      {
        operation: 'create',
        targetId: 'archive',
        source: archive,
        newPath: 'new.bin',
        payload: { kind: 'inline', bytes: new Uint8Array([2, 3, 4]) },
      },
      {
        operation: 'delete',
        targetId: 'remove',
        source: { id: 'remove', uri: 'memory://archive/remove.bin' },
      },
    ])
    expect([...output.keys()].sort()).toEqual(['keep.bin', 'new.bin'])
    expect(output.get('keep.bin')).toBe(untouched)
    expect(output.get('new.bin')).toEqual(new Uint8Array([2, 3, 4]))
  })
})
