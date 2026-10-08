import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageWorkspaceDocumentSourceRequest } from '../src/language/workspace.js'
import { languageImmutableCapture, languageWorkspaceContextToken } from '../src/language/context.js'
import { createFilesystemLanguageDocumentSource } from '../src/node/language-filesystem-source.js'

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof fs>()),
}))

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map(path => fs.rm(path, { recursive: true, force: true })),
  )
})

const request = {
  document: { uri: 'file:///primary.txt', languageId: 'fixture', version: 1, text: '' },
  workspaceDocuments: [],
  workspaceDocumentOrigins: [],
  workspaceLanguageIds: ['fixture'],
  maxDocuments: 16,
  signal: new AbortController().signal,
} as LanguageWorkspaceDocumentSourceRequest

async function fixture(maxWorkspaceBytes = 8192) {
  const root = await fs.mkdtemp(join(tmpdir(), 'modkit-fs-capture-'))
  directories.push(root)
  const source = createFilesystemLanguageDocumentSource({
    roots: [root],
    routes: [{ languageId: 'fixture', extension: 'txt' }],
    maxDocumentBytes: maxWorkspaceBytes,
    maxWorkspaceBytes,
  })
  return { root, source }
}

describe('filesystem document captures', () => {
  it('reuses owner captures, but detects equal-size rewrites with the same timestamp', async () => {
    const { root, source } = await fixture()
    const path = join(root, 'a.txt')
    await fs.writeFile(path, 'before')
    const info = await fs.stat(path)
    const first = await source.snapshot(request)
    const second = await source.snapshot(request)
    expect(second).toEqual(first)
    expect(second.documents[0]).toBe(first.documents[0])
    expect(languageImmutableCapture(first.documents[0] ?? {})).toBe(true)
    expect(first.workspaceContext?.documentOrigins[0]?.sourceRevision).toBe(
      languageWorkspaceContextToken('before'),
    )
    await fs.writeFile(path, 'after!')
    await fs.utimes(path, info.atime, info.mtime)
    const changed = await source.snapshot(request)
    expect(changed.documents[0]).toMatchObject({ version: 2, text: 'after!' })
    expect(changed.workspaceContext?.revision).not.toBe(first.workspaceContext?.revision)
    expect((await source.snapshot(request)).documents[0]).toBe(changed.documents[0])
  })

  it('refreshes listings and excludes open buffers instead of retaining deleted files', async () => {
    const { root, source } = await fixture()
    await fs.writeFile(join(root, 'a.txt'), 'a')
    const first = await source.snapshot(request)
    const open = await source.snapshot({ ...request, workspaceDocuments: first.documents })
    expect(open.documents).toEqual([])
    await fs.unlink(join(root, 'a.txt'))
    await fs.writeFile(join(root, 'b.txt'), 'b')
    const next = await source.snapshot(request)
    expect(next.documents.map(document => document.text)).toEqual(['b'])
    expect(next.workspaceContext?.revision).not.toBe(first.workspaceContext?.revision)
  })

  it('bounds retained captures without changing returned documents or their versions', async () => {
    const { root, source } = await fixture(1200)
    await fs.writeFile(join(root, 'a.txt'), 'a'.repeat(250))
    await fs.writeFile(join(root, 'b.txt'), 'b'.repeat(250))
    const first = await source.snapshot(request)
    const second = await source.snapshot(request)
    expect(second).toEqual(first)
    expect(second.isComplete).toBe(true)
    expect(second.documents[0]).toBe(first.documents[0])
    expect(second.documents[1]).not.toBe(first.documents[1])
    const third = await source.snapshot(request)
    expect(third.documents[0]).toBe(first.documents[0])
    expect(third.documents[1]).not.toBe(second.documents[1])
  })

  it('keeps encoding origins fresh when identical text changes from UTF-8 to UTF-16', async () => {
    const { root, source } = await fixture()
    const path = join(root, 'a.txt')
    await fs.writeFile(path, 'hello')
    const first = await source.snapshot(request)
    await fs.writeFile(
      path,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')]),
    )
    const second = await source.snapshot(request)
    expect(second.documents[0]).toBe(first.documents[0])
    expect(first.workspaceContext?.documentOrigins[0]?.readOnly).toBe(false)
    expect(second.workspaceContext?.documentOrigins[0]?.readOnly).toBe(true)
  })

  it('checks actual read bytes when stat underestimates a growing file', async () => {
    const { root, source } = await fixture(1200)
    const path = join(root, 'a.txt')
    await fs.writeFile(path, 'a'.repeat(1201))
    const info = await fs.stat(path)
    vi.spyOn(fs, 'stat').mockResolvedValue({ ...info, size: 1 } as typeof info)
    const result = await source.snapshot(request)
    expect(result.documents).toEqual([])
    expect(result.isComplete).toBe(false)
  })
})
