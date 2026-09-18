import { describe, expect, it } from 'vitest'
import type { NamespaceEntry } from '@modkit/sdk'
import { buildArchiveTree } from '../src/archive/index.js'

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
})
