import { describe, expect, it } from 'vitest'
import type { NamespaceEntry } from '@modkit/sdk'
import { buildArchiveTree, storedTotal } from '../src/archive/index.js'

const entry = (path: string, kind: 'file' | 'directory' = 'file'): NamespaceEntry =>
  ({ id: path, path, name: path.split('/').filter(Boolean).at(-1), kind, revision: 'r' }) as never

describe('archive tree', () => {
  it('builds the folders a flat listing only implies, and keeps a stored empty one', () => {
    const top = buildArchiveTree([
      entry('art/w3d/bowl.w3d'),
      entry('art/tex/bowl.dds'),
      entry('empty/', 'directory'),
      entry('readme.txt'),
    ])
    expect([...top.folders.keys()]).toEqual(['art', 'empty'])
    expect([...(top.folders.get('art')?.folders.keys() ?? [])]).toEqual(['w3d', 'tex'])
    expect(
      top.folders
        .get('art')
        ?.folders.get('tex')
        ?.files.map(file => file.name),
    ).toEqual(['bowl.dds'])
    expect(top.folders.get('empty')?.files).toEqual([])
    expect(top.files.map(file => file.name)).toEqual(['readme.txt'])
  })

  it('totals the stored sizes, a file stored as it is by its size', () => {
    const file = (fields: Partial<NamespaceEntry>): NamespaceEntry =>
      ({ ...entry('a.bin'), ...fields }) as NamespaceEntry
    expect(
      storedTotal([
        file({ size: 10n, compression: 'stored' }),
        file({ size: 30n, storedSize: 12n, compression: 'deflate' }),
        file({ size: 5n, storedRange: { offset: 0n, length: 5n } }),
      ]),
    ).toBe(27n)
    // A file that says nothing of how it is stored leaves the total unknown, not equal to the size.
    expect(storedTotal([file({ size: 10n })])).toBeUndefined()
  })
})
