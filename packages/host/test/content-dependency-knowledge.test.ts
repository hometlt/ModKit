import { describe, expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createContentDependencyLanguageDocumentSource } from '../src/content-dependencies.js'
import { validatedLanguageSemanticContextRequirements } from '../src/language/semantic-context.js'

const encoder = new TextEncoder()
const KNOWLEDGE = 'modkit.lua-environment.json'
const files = new Map<string, Uint8Array>([
  [`engine/${KNOWLEDGE}`, encoder.encode('{"globals":["game"]}')],
  [`engine/nested/${KNOWLEDGE}`, encoder.encode('{"not":"at the root"}')],
  [`project/${KNOWLEDGE}`, encoder.encode('{"modules":{"ReplicatedStorage.Util":"src/util.lua"}}')],
  ['project/src/util.lua', encoder.encode('return {}')],
  [`huge/${KNOWLEDGE}`, new Uint8Array(8 * 1024 * 1024 + 1)],
])
const directories = new Set(['engine', 'engine/nested', 'project', 'project/src', 'huge'])

const sources: ContentSources = {
  async snapshot() {
    return { label: 'test', regions: [], connections: [], roots: [] }
  },
  async connect() {},
  async disconnect() {},
  async search() {
    return []
  },
  async add() {},
  async remove() {},
  async refresh() {},
  async list(_sourceId, path) {
    const prefix = `${path}/`
    const children = [...directories].filter(item => item.startsWith(prefix) && !item.slice(prefix.length).includes('/'))
      .map(item => ({ path: item, name: item.slice(prefix.length), directory: true }))
    for (const [file, bytes] of files) {
      if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
        children.push({ path: file, name: file.slice(prefix.length), directory: false, size: bytes.byteLength } as never)
    }
    return children
  },
  async read(_sourceId, path, maximum) {
    const bytes = files.get(path)
    if (bytes === undefined || bytes.byteLength > maximum) throw new RangeError('unavailable')
    return bytes.slice()
  },
  async dispose() {},
}

const resolution = (layers: readonly string[]): ContentDependencyResolution => ({
  schemaVersion: 1,
  gameId: 'roblox/roblox',
  complete: true,
  mounts: layers.map((layer, order) => ({
    dependencyId: layer,
    order,
    sourceId: 'roblox:environment',
    sourcePath: layer,
    displayName: layer,
    kind: 'dependency',
    fingerprint: `provider-token:${layer}`,
  })),
  dependencies: [],
  diagnostics: [],
})

const snapshot = (layers: readonly string[], knowledgeFileNames?: readonly string[]) =>
  createContentDependencyLanguageDocumentSource({
    contentSources: sources,
    resolution: resolution(layers),
    routes: [{ languageId: 'lua', extension: 'lua' }],
  }).snapshot({
    document: { uri: 'file:///active.lua', languageId: 'lua', version: 1, text: '' },
    workspaceDocuments: [],
    workspaceDocumentOrigins: [],
    workspaceLanguageIds: ['lua'],
    maxDocuments: 8,
    ...(knowledgeFileNames === undefined ? {} : { knowledgeFileNames }),
    signal: new AbortController().signal,
  })

describe('language knowledge files from the subject context', () => {
  it('supplies each requested root file as a semantic input, weaker layers first, never as a document', async () => {
    const result = await snapshot(['engine', 'project'], [KNOWLEDGE])
    const inputs = (result.workspaceContext?.semanticInputs ?? []).filter(input => input.kind === 'language-knowledge')
    expect(inputs.map(input => (input.payload as { text: string }).text)).toEqual([
      '{"globals":["game"]}',
      '{"modules":{"ReplicatedStorage.Util":"src/util.lua"}}',
    ])
    expect(inputs.every(input => (input.payload as { fileName: string }).fileName === KNOWLEDGE)).toBe(true)
    expect(result.documents.map(document => document.uri)).toEqual([
      'content-source://roblox%3Aenvironment/project/src/util.lua',
    ])
  })

  it('asks for nothing when the provider requested nothing, and reports a file over budget', async () => {
    const plain = await snapshot(['engine'])
    expect(plain.workspaceContext?.semanticInputs?.some(input => input.kind === 'language-knowledge')).toBe(false)
    const huge = await snapshot(['huge'], [KNOWLEDGE])
    const status = huge.workspaceContext?.semanticInputs?.find(input => input.kind === 'semantic-context-status')
    expect(status?.payload).toMatchObject({ state: 'unavailable', requirement: 'language-knowledge' })
  })

  it('accepts one knowledge requirement of plain file names', () => {
    expect(
      validatedLanguageSemanticContextRequirements([{ kind: 'language-knowledge', fileNames: [KNOWLEDGE] }]),
    ).toEqual([{ kind: 'language-knowledge', fileNames: [KNOWLEDGE] }])
    for (const fileNames of [[], ['a/b.json'], ['..'], ['x.json', 'X.JSON']]) {
      expect(() => validatedLanguageSemanticContextRequirements([{ kind: 'language-knowledge', fileNames }])).toThrow()
    }
    expect(() =>
      validatedLanguageSemanticContextRequirements([
        { kind: 'language-knowledge', fileNames: ['a.json'] },
        { kind: 'language-knowledge', fileNames: ['b.json'] },
      ]),
    ).toThrow()
  })
})
