import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFilesystemLanguageDocumentSource } from '../src/node/language-filesystem-source.js'

const root = await mkdtemp(join(tmpdir(), 'modkit-fs-encoding-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('filesystem language documents by their encoding', () => {
  it('reads a UTF-16 table by its BOM as a read-only document, and a UTF-8 file as writable', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\tПривет\n', 'utf16le')])
    await writeFile(join(root, 'names.ucs'), utf16)
    await writeFile(join(root, 'plain.ucs'), '2\tHello\n')
    const source = createFilesystemLanguageDocumentSource({
      roots: [root],
      routes: [{ languageId: 'relic-ucs', extension: 'ucs', dialect: 'utf16' }],
      maxDocumentBytes: 1024,
      maxWorkspaceBytes: 4096,
    })
    const result = await source.snapshot({
      document: { uri: 'file:///primary.ucs', languageId: 'relic-ucs', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['relic-ucs'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    } as never)
    const byName = new Map(
      result.documents.map(document => [document.uri.split('/').pop(), document]),
    )
    expect(byName.get('names.ucs')?.text).toBe('1\tПривет\n')
    expect(byName.get('names.ucs')?.dialect).toBe('utf16')
    const origins = new Map(
      result.workspaceContext!.documentOrigins.map(origin => [origin.logicalId, origin.readOnly]),
    )
    expect(origins.get('names.ucs')).toBe(true)
    expect(origins.get('plain.ucs')).toBe(false)
  })
})
