import { describe, expect, it } from 'vitest'
import type { LocalExtensionCandidate } from '@modkit/extension-manager/node'

import {
  createExtensionCardCatalog,
  extensionCardBundle,
  extensionCardIconTarget,
  extensionCardResourceTargets,
} from '../src/extension-cards.js'

const contribution = {
  schemaVersion: 1,
  contract: { id: 'modkit/codec-contribution', major: 1 },
  id: 'org.example/demo-codec',
  displayName: 'Demo codec',
  runtimeVariants: [],
  spec: {
    formatRefs: [{ formatId: 'demo', label: 'Demo' }],
    roles: ['semantic'],
    sourceTopology: 'single',
    artifactStages: ['authored'],
    openIntents: ['inspect'],
    match: { extensions: ['demo'] },
    probe: { kind: 'bytes', ranges: [{ from: 'start', length: 4 }], maxBytes: 4 },
    representations: [],
    publishesDataSources: [],
    operations: [],
    implementationTier: { claimed: 1 },
    budgets: {
      maxInputBytes: '1024',
      maxDepth: 4,
      maxNodes: 16,
      maxScalarBytes: 1024,
      maxDiagnostics: 4,
    },
  },
} as const

const candidate: LocalExtensionCandidate = {
  id: 'org.example/demo',
  publisher: 'org.example',
  extensionId: 'demo',
  version: '1.0.0',
  displayName: 'Demo extension',
  summary: 'A local extension candidate.',
  license: 'MIT',
  contributionManifests: ['./contributions/*.json'],
  contributions: [
    {
      id: contribution.id,
      displayName: contribution.displayName,
      contract: contribution.contract,
      path: 'contributions/demo.json',
      manifest: contribution,
    },
  ],
  diagnostics: [],
  sourceId: 'demo-repository',
  enabled: true,
  selected: true,
  embedded: false,
  root: 'C:/workspace/demo',
  presentation: {
    source: { kind: 'root', root: 'src' },
    icon: { path: 'assets/icon.svg', mediaType: 'image/svg+xml' },
    licenseFiles: [{ path: 'licenses/MIT.txt', displayName: 'MIT License' }],
  },
}

describe('extension subject card catalog', () => {
  it('builds navigable extension and contribution cards from an inert local candidate', async () => {
    const catalog = createExtensionCardCatalog({
      inventory: { extensions: [], diagnostics: [] },
      localCandidates: [candidate],
      linkableLocalExtensionIds: [candidate.id],
      managedPackageByExtension: new Map(),
      disabledManagedExtensions: [],
      disabledExtensions: [],
      disabledContributions: [],
    })
    const entry = catalog.get(candidate.id)
    expect(entry?.installed).toBe(false)
    if (entry === undefined) throw new Error('candidate card is missing')
    expect(entry?.projection.contractGroups.map(group => group.key)).toEqual([
      'modkit/codec-contribution@1',
    ])
    const bundle = await extensionCardBundle(entry, contribution.id)
    expect(bundle.extension.linkable).toBe(true)
    expect(bundle.extension.codecs).toEqual({ ids: [contribution.id], enabled: true })
    expect(bundle.extension).not.toHaveProperty('root')
    expect(bundle.extension.resources).toEqual([
      {
        id: 'source',
        role: 'source',
        label: 'Source',
        display: expect.stringMatching(/[\\/]workspace[\\/]demo[\\/]src$/u),
      },
      {
        id: 'license-0',
        role: 'license',
        label: 'MIT License',
        display: expect.stringMatching(/[\\/]workspace[\\/]demo[\\/]licenses[\\/]MIT\.txt$/u),
      },
    ])
    // The actual target is kept in the extension host registry, not the Webview bundle.
    expect(bundle.extension.resources[0]).not.toHaveProperty('target')
    const targets = extensionCardResourceTargets(entry).get(bundle.extension.subjectId)
    expect(targets?.map(resource => resource.role)).toEqual(['source', 'icon', 'license'])
    expect(extensionCardIconTarget(entry)).toMatch(
      /[\\/]workspace[\\/]demo[\\/]assets[\\/]icon\.svg$/u,
    )
    expect(bundle.documents).toHaveLength(2)
    const active = bundle.documents.find(
      document => document.subject.subjectId === bundle.activeSubjectId,
    )
    expect(active?.subject.id).toBe(contribution.id)
    expect(active?.relations[0]?.role).toBe('belongs-to')
    const owner = bundle.documents.find(document => document.subject.id === candidate.id)
    expect(owner?.relations[0]?.role).toBe('owns')
  })

  it('does not expose a link action when a coordinate has no authoritative local source', async () => {
    const catalog = createExtensionCardCatalog({
      inventory: { extensions: [], diagnostics: [] },
      localCandidates: [candidate, { ...candidate, root: 'C:/workspace/duplicate' }],
      linkableLocalExtensionIds: [],
      managedPackageByExtension: new Map(),
      disabledManagedExtensions: [],
      disabledExtensions: [],
      disabledContributions: [],
    })
    const entry = catalog.get(candidate.id)
    if (entry === undefined) throw new Error('candidate card is missing')
    expect((await extensionCardBundle(entry)).extension.linkable).toBe(false)
  })

  it('opens an explicitly declared HTTP(S) source only through a host-owned URL target', async () => {
    const { root: _root, ...remoteCandidate } = candidate
    const catalog = createExtensionCardCatalog({
      inventory: { extensions: [], diagnostics: [] },
      localCandidates: [
        {
          ...remoteCandidate,
          presentation: { source: { kind: 'url', url: 'https://example.test/modkit' } },
        },
      ],
      linkableLocalExtensionIds: [],
      managedPackageByExtension: new Map(),
      disabledManagedExtensions: [],
      disabledExtensions: [],
      disabledContributions: [],
    })
    const entry = catalog.get(candidate.id)
    if (entry === undefined) throw new Error('candidate card is missing')
    const bundle = await extensionCardBundle(entry)
    expect(bundle.extension.resources).toEqual([
      {
        id: 'source',
        role: 'source',
        label: 'Source',
        display: 'https://example.test/modkit',
      },
    ])
    expect(extensionCardResourceTargets(entry).get(bundle.extension.subjectId)).toEqual([
      { id: 'source', role: 'source', kind: 'url', target: 'https://example.test/modkit' },
    ])
  })
})
