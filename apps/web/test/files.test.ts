/**
 * A2: the browser's file capability, proven in Node against a fake File System Access tree.
 *
 * The explorer never learns which browser it is running in; it learns what `FileAccess` answers.
 * These cases are the answers: what a granted folder lists, what it refuses to read, what the
 * fallback path still manages, and what the app is allowed to claim a browser can do.
 */
import { describe, expect, it } from 'vitest'
import {
  createDirectoryAccess,
  createSingleFileAccess,
  describeFileCapability,
  MAXIMUM_DIRECTORY_ENTRIES,
  type WebDirectoryHandleLike,
  type WebFileLike,
  type WebFileSystemHandleLike,
} from '../src/files.js'

const encoder = new TextEncoder()

function fakeFile(name: string, text: string): WebFileLike {
  const bytes = encoder.encode(text)
  return {
    name,
    size: bytes.byteLength,
    lastModified: 1,
    slice(start, end) {
      const part = bytes.slice(start, end)
      return {
        async arrayBuffer() {
          const copy = new ArrayBuffer(part.byteLength)
          new Uint8Array(copy).set(part)
          return copy
        },
      }
    },
  }
}

function fileHandle(name: string, text: string): WebFileSystemHandleLike {
  return {
    kind: 'file',
    name,
    async getFile() {
      return fakeFile(name, text)
    },
  }
}

function directoryHandle(
  name: string,
  children: readonly WebFileSystemHandleLike[],
  style: 'entries' | 'values' | 'neither' = 'entries',
): WebDirectoryHandleLike {
  const base = { kind: 'directory' as const, name }
  if (style === 'neither') return base
  if (style === 'values') {
    return {
      ...base,
      values: async function* () {
        yield* children
      },
    }
  }
  return {
    ...base,
    entries: async function* () {
      for (const child of children) yield [child.name, child] as const
    },
  }
}

const tree = (): WebDirectoryHandleLike =>
  directoryHandle('assets', [
    fileHandle('logo.png', 'PNGDATA'),
    directoryHandle('icons', [fileHandle('star.svg', '<svg/>')]),
    fileHandle('notes.txt', 'hello world'),
  ])

describe('browser file access', () => {
  it('lists a granted folder with sizes on files and no size on directories', async () => {
    const access = createDirectoryAccess(tree())
    expect(access.label).toBe('assets')
    const entries = await access.list(undefined)
    expect(entries.map(entry => entry.id)).toEqual(['logo.png', 'icons', 'notes.txt'])
    expect(entries.find(entry => entry.id === 'icons')).toEqual({
      id: 'icons',
      name: 'icons',
      directory: true,
    })
    expect(entries.find(entry => entry.id === 'notes.txt')?.size).toBe(11)
  })

  it('ids are paths relative to the grant, and a child folder lists once it has been browsed', async () => {
    const access = createDirectoryAccess(tree())
    await access.list(undefined)
    const nested = await access.list('icons')
    expect(nested.map(entry => entry.id)).toEqual(['icons/star.svg'])
    expect(await access.read('icons/star.svg', 1024)).toEqual(encoder.encode('<svg/>'))
  })

  it('refuses a path this session never browsed rather than resolving it by string', async () => {
    const access = createDirectoryAccess(tree())
    await expect(access.list('icons')).rejects.toThrow(/not a folder this session has browsed/u)
    await expect(access.read('icons/star.svg', 16)).rejects.toThrow(
      /not a file this session has browsed/u,
    )
    await access.list(undefined)
    await expect(access.read('../outside.txt', 16)).rejects.toThrow(
      /not a file this session has browsed/u,
    )
  })

  it('remembers sizes after the listing, because the tree hands back entries without one', async () => {
    const access = createDirectoryAccess(tree())
    expect(access.sizeOf('notes.txt')).toBeUndefined()
    await access.list(undefined)
    expect(access.sizeOf('notes.txt')).toBe(11)
    expect(access.sizeOf('icons')).toBeUndefined()
    const picked = createSingleFileAccess(fakeFile('one.txt', 'abc'))
    expect(picked.access.sizeOf('one.txt')).toBe(3)
    expect(picked.access.sizeOf('other.txt')).toBeUndefined()
  })

  it('reads no more than the caller asked for', async () => {
    const access = createDirectoryAccess(tree())
    await access.list(undefined)
    expect(new TextDecoder().decode(await access.read('notes.txt', 5))).toBe('hello')
    expect(new TextDecoder().decode(await access.read('notes.txt', 1024))).toBe('hello world')
  })

  it('accepts a handle that offers values() instead of entries()', async () => {
    const access = createDirectoryAccess(
      directoryHandle('root', [fileHandle('a.txt', 'a')], 'values'),
    )
    expect((await access.list(undefined)).map(entry => entry.name)).toEqual(['a.txt'])
  })

  it('says so when a handle offers neither iteration surface', async () => {
    const access = createDirectoryAccess(directoryHandle('root', [], 'neither'))
    await expect(access.list(undefined)).rejects.toThrow(/neither entries\(\) nor values\(\)/u)
  })

  it('bounds a huge folder and reports the truncation instead of hiding it', async () => {
    const children = Array.from({ length: MAXIMUM_DIRECTORY_ENTRIES + 5 }, (_value, index) =>
      fileHandle(`file-${index}.txt`, 'x'),
    )
    const notices: string[] = []
    const access = createDirectoryAccess(directoryHandle('big', children), {
      onNotice: message => notices.push(message),
    })
    const entries = await access.list(undefined)
    expect(entries).toHaveLength(MAXIMUM_DIRECTORY_ENTRIES)
    expect(notices.join('\n')).toMatch(/more than 2000 entries/u)
  })

  it('keeps a file whose snapshot cannot be read, and says why', async () => {
    const broken: WebFileSystemHandleLike = {
      kind: 'file',
      name: 'locked.bin',
      async getFile() {
        throw new Error('permission revoked')
      },
    }
    const notices: string[] = []
    const access = createDirectoryAccess(directoryHandle('root', [broken]), {
      onNotice: message => notices.push(message),
    })
    const entries = await access.list(undefined)
    expect(entries).toEqual([{ id: 'locked.bin', name: 'locked.bin', directory: false }])
    expect(notices[0]).toMatch(/permission revoked/u)
  })

  it('a single picked file is a one-entry folder, which is all the explorer needs', async () => {
    const picked = createSingleFileAccess(fakeFile('report.csv', 'a,b\n1,2\n'))
    expect(picked.entry).toEqual({
      id: 'report.csv',
      name: 'report.csv',
      directory: false,
      size: 8,
    })
    expect(await picked.access.list(undefined)).toEqual([picked.entry])
    expect(await picked.access.list('report.csv')).toEqual([])
    expect(new TextDecoder().decode(await picked.access.read('report.csv', 3))).toBe('a,b')
    await expect(picked.access.read('other.csv', 3)).rejects.toThrow(/not the opened file/u)
  })

  it('claims only the pickers the page actually has', () => {
    const full = describeFileCapability({
      showDirectoryPicker: () => undefined,
      showOpenFilePicker: () => undefined,
    })
    expect(full).toMatchObject({ directories: true, filePicker: true, inputFallback: true })
    expect(full.notice).toMatch(/grants folder access/u)

    const fileOnly = describeFileCapability({ showOpenFilePicker: () => undefined })
    expect(fileOnly).toMatchObject({ directories: false, filePicker: true })
    expect(fileOnly.notice).toMatch(/no folder picker/u)

    const bare = describeFileCapability({})
    expect(bare).toMatchObject({ directories: false, filePicker: false, inputFallback: true })
    expect(bare.notice).toMatch(/plain file input/u)
  })
})
