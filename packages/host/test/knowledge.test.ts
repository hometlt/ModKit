import { describe, expect, it } from 'vitest'
import {
  buildInventory,
  createHostContributionContractRegistry,
  type ExtensionInput,
} from '@modkit/host'
import { createKnowledgeCatalog } from '@modkit/host/knowledge'
import type { KnowledgePackSpecV1 } from '@modkit/sdk/knowledge'
import type { VfsMount } from '@modkit/vfs'

const fieldTarget = {
  kind: 'field',
  ecosystem: 'game-alpha',
  schema: {
    contract: 'org.example.alpha/alpha-data-schema',
    major: 1,
    revision: 'sha256:fixture-schema',
  },
  typeId: 'CUnit',
  canonicalPath: ['LifeMax'],
} as const

const pack: KnowledgePackSpecV1 = {
  schemaVersion: 1,
  sourceLocale: 'en',
  priority: 100,
  gameIds: ['game-alpha'],
  entries: [
    {
      id: 'org.example.alpha.alpha/life-max',
      target: fieldTarget,
      locale: 'en',
      title: 'Maximum life',
      summary: 'The maximum life of a unit before modifiers.',
      claimKind: 'schema-derived-fact',
      confidence: 'verified',
      aliases: ['health', 'hit points'],
      sources: [
        {
          kind: 'schema',
          title: 'ALPHA data schema fixture',
          schema: {
            contract: 'org.example.alpha/alpha-data-schema',
            major: 1,
            revision: 'sha256:fixture-schema',
          },
          revision: 'sha256:fixture-schema',
          reviewedAt: '2026-08-28',
        },
      ],
    },
    {
      id: 'org.example.alpha.alpha/life-max',
      target: fieldTarget,
      locale: 'ru',
      title: 'Максимальное здоровье',
      summary: 'Максимальный запас здоровья юнита до модификаторов.',
      claimKind: 'documented-interpretation',
      confidence: 'high',
      sources: [
        {
          kind: 'community-wiki',
          title: 'ALPHAMapster Data Types',
          url: 'https://alphamapster.wiki.gg/wiki/Data_Types',
          reviewedAt: '2026-08-28',
        },
      ],
    },
    {
      id: 'org.example.alpha.alpha/unit-overview',
      target: { kind: 'subject', ecosystem: 'game-alpha', subjectKind: 'unit' },
      locale: 'en',
      title: 'Unit',
      summary: 'A generic unit data record.',
      claimKind: 'documented-interpretation',
      confidence: 'high',
      sources: [
        {
          kind: 'official-documentation',
          title: 'ALPHA Editor documentation',
          url: 'https://us.forums.publisher-alpha.com/en/alpha/',
          reviewedAt: '2026-08-28',
        },
      ],
    },
  ],
}

const extensionInput = (): ExtensionInput => {
  const path = 'contributions/alpha-knowledge.json'
  return {
    source: 'knowledge-fixture',
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher: 'org.example.alpha',
        id: 'game-alpha-knowledge-fixture',
        version: '1.2.3',
        license: 'MIT',
        contributionManifests: ['./contributions/*.json'],
      },
    },
    files: [path],
    documents: new Map([
      [
        path,
        {
          schemaVersion: 1,
          contract: { id: 'modkit/knowledge-pack', major: 1 },
          id: 'org.example.alpha/alpha-data-knowledge',
          displayName: 'ALPHA data knowledge',
          spec: pack,
        },
      ],
    ]),
    documentDigests: new Map([[path, 'sha256:knowledge-manifest']]),
    artifact: {
      inventoryRecordId: 'artifact:knowledge-fixture',
      artifactDigest: 'sha256:knowledge-artifact',
      artifactRoot: new URL('file:///knowledge-fixture/'),
      verifyArtifactDigest: expected => expected === 'sha256:knowledge-artifact',
    },
  }
}

const rankedExtensionInput = (
  extensionId: string,
  priority: number,
  entryId: string,
  title: string,
): ExtensionInput => {
  const path = `contributions/${extensionId}.json`
  const artifactDigest = `sha256:${extensionId}-artifact`
  const entry = pack.entries?.[2]
  if (entry === undefined) throw new Error('fixture must contain a generic subject entry')
  return {
    source: extensionId,
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher: 'org.example.alpha',
        id: extensionId,
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: ['./contributions/*.json'],
      },
    },
    files: [path],
    documents: new Map([
      [
        path,
        {
          schemaVersion: 1,
          contract: { id: 'modkit/knowledge-pack', major: 1 },
          id: `org.example.alpha/${extensionId}-knowledge`,
          displayName: `${title} knowledge`,
          spec: {
            ...pack,
            priority,
            entries: [{ ...entry, id: entryId, title }],
          },
        },
      ],
    ]),
    documentDigests: new Map([[path, `sha256:${extensionId}-manifest`]]),
    artifact: {
      inventoryRecordId: `artifact:${extensionId}`,
      artifactDigest,
      artifactRoot: new URL(`file:///${extensionId}/`),
      verifyArtifactDigest: expected => expected === artifactDigest,
    },
  }
}

describe('inventory-backed knowledge catalog', () => {
  it('resolves locales, provenance and direct external links without executable activation', async () => {
    const inventory = await buildInventory(
      [extensionInput()],
      createHostContributionContractRegistry(),
    )
    const contribution = inventory.extensions[0]?.contributions[0]
    expect(contribution?.inventoryEligible, JSON.stringify(contribution?.diagnostics)).toBe(true)
    expect(contribution?.activationEligible).toBe(false)

    const catalog = createKnowledgeCatalog(inventory)
    expect(catalog.snapshotId.length).toBeLessThan(64)
    const page = await catalog.resolve({ target: fieldTarget, locales: ['ru-RU', 'en'] })
    expect(page.diagnostics).toEqual([])
    expect(page.completeness).toBe('complete')
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      entry: {
        locale: 'ru',
        title: 'Максимальное здоровье',
        sources: [{ url: 'https://alphamapster.wiki.gg/wiki/Data_Types' }],
      },
      localeRank: 1,
      provenance: {
        packId: 'org.example.alpha/alpha-data-knowledge',
        ownerExtensionId: 'org.example.alpha/game-alpha-knowledge-fixture',
        extensionVersion: '1.2.3',
        manifestDigest: 'sha256:knowledge-manifest',
      },
    })
    const defaultLocale = await catalog.resolve({ target: fieldTarget, locales: [] })
    expect(defaultLocale.items[0]?.entry.locale).toBe('en')
  })

  it('searches aliases and falls back from a concrete subject to generic subject help', async () => {
    const inventory = await buildInventory(
      [extensionInput()],
      createHostContributionContractRegistry(),
    )
    const catalog = createKnowledgeCatalog(inventory)
    const aliases = await catalog.search({ text: 'hit points', locales: ['en'] })
    expect(aliases.items.map(item => item.entry.id)).toEqual(['org.example.alpha.alpha/life-max'])

    const generic = await catalog.resolve({
      target: {
        kind: 'subject',
        ecosystem: 'game-alpha',
        subjectKind: 'unit',
        subjectId: 'Marine',
      },
      locales: ['en'],
    })
    expect(generic.items[0]?.entry.id).toBe('org.example.alpha.alpha/unit-overview')
  })

  it('caps pages and reports malformed cursors structurally', async () => {
    const inventory = await buildInventory(
      [extensionInput()],
      createHostContributionContractRegistry(),
    )
    const catalog = createKnowledgeCatalog(inventory)
    const capped = await catalog.search({ locales: ['en'], limit: 1_000 })
    expect(capped.diagnostics.map(item => item.code)).toContain('x3.knowledge/page-limit-capped')
    const first = await catalog.search({ locales: ['en'], limit: 1 })
    expect(first.nextCursor).toBeDefined()
    if (first.nextCursor === undefined) throw new Error('fixture must have another knowledge page')
    const second = await catalog.search({
      locales: ['en'],
      limit: 1,
      cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(1)
    const wrongQuery = await catalog.search({
      text: 'unit',
      locales: ['en'],
      cursor: first.nextCursor,
    })
    expect(wrongQuery.diagnostics.map(item => item.code)).toContain('x3.knowledge/invalid-cursor')
    expect(wrongQuery.completeness).toBe('invalid')
    const invalid = await catalog.search({ locales: ['en'], cursor: 'nope' })
    expect(invalid.items).toEqual([])
    expect(invalid.diagnostics.map(item => item.code)).toContain('x3.knowledge/invalid-cursor')

    const oversized = await catalog.search({ text: 'x'.repeat(1_025), locales: ['en'] })
    expect(oversized.items).toEqual([])
    expect(oversized.completeness).toBe('invalid')
    expect(oversized.diagnostics.map(item => item.code)).toContain(
      'x3.knowledge/query-text-too-long',
    )
    const oversizedCursor = await catalog.search({
      locales: ['en'],
      cursor: 'x'.repeat(65_537),
    })
    expect(oversizedCursor.diagnostics.map(item => item.code)).toContain(
      'x3.knowledge/query-cursor-too-large',
    )
    const duplicateKinds = await catalog.search({
      locales: ['en'],
      claimKinds: ['community-note', 'community-note'],
    })
    expect(duplicateKinds.diagnostics.map(item => item.code)).toContain(
      'x3.knowledge/query-claim-kinds-invalid',
    )
    const invalidTarget = await catalog.resolve({ target: null as never, locales: ['en'] })
    expect(invalidTarget.completeness).toBe('invalid')
    expect(invalidTarget.diagnostics.map(item => item.code)).toContain(
      'x3.knowledge/query-target-invalid',
    )
    const invalidLocale = await catalog.search({ locales: ['-'] })
    expect(invalidLocale.completeness).toBe('invalid')
    expect(invalidLocale.diagnostics.map(item => item.code)).toContain(
      'x3.knowledge/query-locales-invalid',
    )
  })

  it('honours cancellation before scanning the catalog', async () => {
    const inventory = await buildInventory(
      [extensionInput()],
      createHostContributionContractRegistry(),
    )
    const catalog = createKnowledgeCatalog(inventory)
    const controller = new AbortController()
    controller.abort()
    await expect(catalog.search({ locales: ['en'] }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })

    const duringScan = new AbortController()
    const cancellable = createKnowledgeCatalog(inventory, { scanChunkSize: 1 })
    const pending = cancellable.search({ locales: ['en'] }, duringScan.signal)
    setTimeout(() => duringScan.abort(), 0)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('caps the aggregate index and reports incomplete catalog results', async () => {
    const inventory = await buildInventory(
      [extensionInput()],
      createHostContributionContractRegistry(),
    )
    const catalog = createKnowledgeCatalog(inventory, {
      maxIndexedEntries: 1,
      maxSearchableCharacters: 1_000_000,
    })
    const page = await catalog.search({ locales: ['en'] })
    expect(page.items).toHaveLength(1)
    expect(page.completeness).toBe('capped')
    expect(page.diagnostics.map(item => item.code)).toContain('x3.knowledge/catalog-index-capped')
  })

  it('retains a later high-priority pack when the aggregate index is capped', async () => {
    const low = rankedExtensionInput(
      'aaa-low-priority',
      1,
      'org.example.alpha.alpha/low-priority',
      'Low priority',
    )
    const high = rankedExtensionInput(
      'zzz-high-priority',
      1_000,
      'org.example.alpha.alpha/high-priority',
      'High priority',
    )
    const inventory = await buildInventory([low, high], createHostContributionContractRegistry())
    const catalog = createKnowledgeCatalog(inventory, { maxIndexedEntries: 1 })
    const page = await catalog.search({ locales: ['en'] })
    expect(page.items.map(item => item.entry.title)).toEqual(['High priority'])
    expect(page.completeness).toBe('capped')
  })

  it('changes the snapshot when trusted ownership provenance changes', async () => {
    const original = extensionInput()
    const standalone = original.containers.standalone
    if (standalone === undefined) throw new Error('fixture must use a standalone container')
    const moved = {
      ...original,
      containers: {
        standalone: {
          ...standalone,
          id: 'game-alpha-knowledge-fixture-moved',
        },
      },
    } satisfies ExtensionInput
    const registry = createHostContributionContractRegistry()
    const [first, second] = await Promise.all([
      buildInventory([original], registry),
      buildInventory([moved], registry),
    ])
    expect(first.extensions[0]?.contributions[0]?.inventoryEligible).toBe(true)
    expect(second.extensions[0]?.contributions[0]?.inventoryEligible).toBe(true)
    expect(createKnowledgeCatalog(first).snapshotId).not.toBe(
      createKnowledgeCatalog(second).snapshotId,
    )
  })
})

describe('knowledge entries kept in an entriesPath file', () => {
  const manifestPath = 'contributions/alpha-knowledge.json'
  const entriesPath = 'contributions/knowledge/alpha.entries.json'
  const entriesBytes = new TextEncoder().encode(JSON.stringify({ entries: pack.entries }))

  const externalInput = (): ExtensionInput => {
    const base = extensionInput()
    const { entries: _inline, ...spec } = pack
    return {
      ...base,
      files: [manifestPath, entriesPath],
      documents: new Map([
        [
          manifestPath,
          {
            schemaVersion: 1,
            contract: { id: 'modkit/knowledge-pack', major: 1 },
            id: 'org.example.alpha/alpha-data-knowledge',
            displayName: 'ALPHA data knowledge',
            spec: { ...spec, entriesPath },
          },
        ],
      ]),
      artifact: {
        ...base.artifact,
        fileDigests: {
          [manifestPath]: 'sha256:knowledge-manifest',
          [entriesPath]: 'sha256:knowledge-entries',
        },
      },
    }
  }

  /** A VFS that serves the one entries file and counts the mounts it was asked for. */
  const servingVfs = (bytes: Uint8Array) => {
    const mounted: string[] = []
    const mount = {
      async stat(path: string) {
        return path === entriesPath ? { kind: 'file', size: BigInt(bytes.byteLength) } : undefined
      },
      async open() {
        return {
          size: async () => bytes.byteLength,
          readAt: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          dispose: async () => undefined,
        }
      },
      dispose: async () => undefined,
    }
    return {
      mounted,
      vfs: {
        async openMount(uri: string) {
          mounted.push(uri)
          return mount as unknown as VfsMount
        },
      },
    }
  }

  it('reads the file on the first query only, attested and validated like inline entries', async () => {
    const inventory = await buildInventory(
      [externalInput()],
      createHostContributionContractRegistry(),
    )
    const contribution = inventory.extensions[0]?.contributions[0]
    expect(contribution?.inventoryEligible, JSON.stringify(contribution?.diagnostics)).toBe(true)
    const served = servingVfs(entriesBytes)
    const catalog = createKnowledgeCatalog(
      inventory,
      {},
      { vfs: served.vfs, digest: async () => 'sha256:knowledge-entries' },
    )
    expect(served.mounted).toEqual([])
    const page = await catalog.resolve({ target: fieldTarget, locales: ['ru-RU', 'en'] })
    expect(page.diagnostics).toEqual([])
    expect(page.total).toBe(1)
    expect(page.items[0]?.entry.locale).toBe('ru')
    await catalog.search({ text: 'unit', locales: ['en'] })
    expect(served.mounted).toEqual(['file:///knowledge-fixture/'])
  })

  it('refuses a file whose bytes are not the attested ones', async () => {
    const inventory = await buildInventory(
      [externalInput()],
      createHostContributionContractRegistry(),
    )
    const catalog = createKnowledgeCatalog(
      inventory,
      {},
      { vfs: servingVfs(entriesBytes).vfs, digest: async () => 'sha256:tampered' },
    )
    const page = await catalog.resolve({ target: fieldTarget, locales: ['en'] })
    expect(page.total).toBe(0)
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'x3.knowledge/entries-file-refused',
        message: expect.stringContaining('does not match its attested SHA-256'),
      }),
    ])
  })

  it('refuses entries that would not validate inline', async () => {
    const inventory = await buildInventory(
      [externalInput()],
      createHostContributionContractRegistry(),
    )
    const broken = new TextEncoder().encode(
      JSON.stringify({ entries: [{ ...pack.entries?.[0], claimKind: 'rumour' }] }),
    )
    const catalog = createKnowledgeCatalog(
      inventory,
      {},
      { vfs: servingVfs(broken).vfs, digest: async () => 'sha256:knowledge-entries' },
    )
    const page = await catalog.search({ text: 'life', locales: ['en'] })
    expect(page.total).toBe(0)
    expect(page.diagnostics).toEqual([
      expect.objectContaining({ code: 'x3.knowledge/entries-file-refused' }),
    ])
  })

  it('says so when the entries are in a file and no reader was given', async () => {
    const inventory = await buildInventory(
      [externalInput()],
      createHostContributionContractRegistry(),
    )
    const page = await createKnowledgeCatalog(inventory).search({ text: 'life', locales: ['en'] })
    expect(page.total).toBe(0)
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'x3.knowledge/entries-file-refused',
        message: expect.stringContaining(entriesPath),
      }),
    ])
  })
})
