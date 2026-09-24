import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createFilesystemLanguageDocumentSource } from '@modkit/host/node'

const snapshot = (source, overrides = {}) =>
  source.snapshot({
    document: { uri: 'file:///primary.test', languageId: 'test', version: 1, text: '' },
    workspaceDocuments: [],
    workspaceDocumentOrigins: [],
    workspaceLanguageIds: ['test'],
    maxDocuments: 8,
    signal: new AbortController().signal,
    ...overrides,
  })

test('filesystem source reads unique routes, excludes open overlays, and advances file revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-lsp-'))
  try {
    await mkdir(join(root, 'nested'))
    const path = join(root, 'nested', 'one.foo')
    await writeFile(path, 'first')
    const source = createFilesystemLanguageDocumentSource({
      roots: [root],
      routes: [{ languageId: 'test', extension: 'foo' }],
      maxDocumentBytes: 1024,
      maxWorkspaceBytes: 2048,
    })
    const first = await snapshot(source)
    assert.equal(first.isComplete, true)
    assert.deepEqual(
      first.documents.map(item => [item.languageId, item.text, item.version]),
      [['test', 'first', 1]],
    )
    assert.equal(first.workspaceContext.semanticComplete, true)
    assert.deepEqual(
      first.workspaceContext.documentOrigins.map(item => item.logicalId),
      ['nested/one.foo'],
    )
    assert.deepEqual(source.origin(first.documents[0]), {
      uri: first.documents[0].uri,
      layerId: first.workspaceContext.documentOrigins[0].layerId,
      logicalId: 'nested/one.foo',
      precedence: 0,
      sourceRevision: '1',
      readOnly: false,
      overlay: true,
    })
    const excluded = await snapshot(source, {
      workspaceDocuments: [
        { uri: pathToFileURL(path).href, languageId: 'test', version: 9, text: 'overlay' },
      ],
      workspaceDocumentOrigins: [],
    })
    assert.deepEqual(excluded.documents, [])
    await writeFile(path, 'second version')
    const second = await snapshot(source)
    assert.equal(second.documents[0].version, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('filesystem source refuses ambiguous extension routing and reports truncation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-lsp-'))
  try {
    await writeFile(join(root, 'one.xml'), '<one/>')
    const ambiguous = createFilesystemLanguageDocumentSource({
      roots: [root],
      routes: [
        { languageId: 'test', extension: 'xml' },
        { languageId: 'other', extension: 'xml' },
      ],
      maxDocumentBytes: 1024,
      maxWorkspaceBytes: 2048,
    })
    const result = await snapshot(ambiguous, { workspaceLanguageIds: ['test'] })
    assert.deepEqual(result.documents, [])
    assert.equal(result.isComplete, false)

    await writeFile(join(root, 'two.foo'), 'two')
    await writeFile(join(root, 'three.foo'), 'three')
    const bounded = createFilesystemLanguageDocumentSource({
      roots: [root],
      routes: [{ languageId: 'test', extension: 'foo' }],
      maxDocumentBytes: 1024,
      maxWorkspaceBytes: 2048,
    })
    const truncated = await snapshot(bounded, { maxDocuments: 1 })
    assert.equal(truncated.documents.length, 1)
    assert.equal(truncated.isComplete, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
