import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import type { LanguageAnalysis, LanguageDocument } from '@modkitx-x3/sdk/language'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import { resolveLanguageProvider } from '@modkitx-x3/host/language'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { galaxyLanguage } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'galaxy-language', 'src', 'linked.js'))
    .href
)) as { readonly galaxyLanguage: LinkedExtension }

const REALM = 'org.modkitx.test/language-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/language',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/language-policy', revision: '1' },
    },
  ],
  links: [],
})
const budgets = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([galaxyLanguage])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

async function galaxy(text: string): Promise<LanguageAnalysis> {
  const resolution = await resolveLanguageProvider({
    services: { ...composition, serviceDefinitions: definitions },
    languageId: 'galaxy',
    documentKind: 'galaxy-source',
    extension: '.galaxy',
    grant: { id: 'language-test', classes: [] },
    budgets,
  })
  expect(resolution.state).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('Galaxy provider did not resolve')
  const document: LanguageDocument = {
    uri: 'file:///TriggerLibs/Waves.galaxy',
    languageId: 'galaxy',
    version: 7,
    text,
  }
  try {
    return await resolution.provider.analyze({ document })
  } finally {
    await resolution.release()
  }
}

describe('standard language contract and Galaxy provider', () => {
  it('resolves a declared route and returns tokens, diagnostics and document symbols', async () => {
    const result = await galaxy(
      [
        'struct WaveState {',
        '  int count;',
        '};',
        '',
        'void SpawnWave(int count) {',
        '  string label = "wave";',
        '  // Spawn only a positive wave.',
        '  if (count > 0) {',
        '    return;',
        '  }',
        '}',
      ].join('\n'),
    )

    expect(result.documentVersion).toBe(7)
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(item => item.kind)).toEqual(
      expect.arrayContaining(['comment', 'keyword', 'number', 'string', 'type']),
    )
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'WaveState', kind: 'struct' }),
        expect.objectContaining({ name: 'SpawnWave', kind: 'function' }),
      ]),
    )
  })

  it('reports a protocol-neutral diagnostic for malformed Galaxy source', async () => {
    const result = await galaxy('void Broken() {\n  return;\n')
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'galaxy/unclosed-brace', severity: 'error' }),
    ])
  })

  it('does not select the Galaxy offer for another language route', async () => {
    const resolution = await resolveLanguageProvider({
      services: { ...composition, serviceDefinitions: definitions },
      languageId: 'xml',
      documentKind: 'xml-source',
      extension: 'xml',
      grant: { id: 'language-test-mismatch', classes: [] },
      budgets,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/language-provider-unresolved',
    )
  })
})
