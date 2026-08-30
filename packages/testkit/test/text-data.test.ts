import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, contractId } from '@modkitx-x3/core'
import {
  buildLockEntry,
  replayPolicyLock,
  resolveProvider,
  serializePolicyLock,
} from '@modkitx-x3/host'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  createSpecSchemaRegistry,
  revisionId,
  validateContributionManifest,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ContributionManifestV1Wire,
  type Lease,
  type ProviderOffer,
  type ProviderRequest,
  type ResourceBudget,
  type TableDataSource,
  type TreeDataSource,
} from '@modkitx-x3/sdk'
import { runTextDataConformance } from '@modkitx-x3/testkit'
import type {
  ParseRequest,
  TextDataContractId,
  TextSyntaxProvider,
} from '@modkitx-x3/sdk/text-data'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(here, '..', '..', '..')
const extensionNameByFormat: Readonly<Record<string, string>> = Object.freeze({
  json: 'core-native',
  jsonc: 'core-native',
  csv: 'text-csv',
  tsv: 'text-csv',
  ini: 'text-ini',
  xml: 'text-xml',
  yaml: 'text-yaml',
  toml: 'text-toml',
})
const nativeTextRoot = join(repositoryRoot, 'packages', 'host', 'native-text')
const textExtensionRoots = Object.freeze([
  nativeTextRoot,
  ...[...new Set(Object.values(extensionNameByFormat))]
    .filter(name => name !== 'core-native')
    .map(name => join(repositoryRoot, 'extensions', 'common', 'data', name)),
])
const extensionRootFor = (format: string): string => {
  const extension = extensionNameByFormat[format]
  if (extension === undefined) throw new TypeError(`unknown text format ${format}`)
  return extension === 'core-native'
    ? nativeTextRoot
    : join(repositoryRoot, 'extensions', 'common', 'data', extension)
}
const alternateXmlRoot = join(
  here,
  '..',
  '..',
  '..',
  'examples',
  'modkit-extension-x3-alternate-xml',
)
const providerFormatByContract = Object.freeze({
  'common.text-data/json-syntax': 'json',
  'common.text-data/jsonc-syntax': 'jsonc',
  'common.text-data/xml-syntax': 'xml',
  'common.text-data/yaml-syntax': 'yaml',
  'common.text-data/toml-syntax': 'toml',
  'common.text-data/ini-syntax': 'ini',
  'common.text-data/csv-syntax': 'csv',
  'common.text-data/tsv-syntax': 'tsv',
} satisfies Readonly<Record<TextDataContractId, string>>)

const familyByFormat: Readonly<Partial<Record<string, string>>> = Object.freeze({
  json: 'json',
  jsonc: 'json',
  csv: 'delimited',
  tsv: 'delimited',
})

function sourceEntrypoint(format: string, kind: 'codec' | 'provider'): string {
  const family = familyByFormat[format]
  if (format === 'json' || format === 'jsonc') {
    return `json/families/json/entrypoints/${format}-${kind}.js`
  }
  return family === undefined
    ? `src/${format}/${kind}.js`
    : `src/families/${family}/entrypoints/${format}-${kind}.js`
}

function sourceProfile(format: string): string {
  const family = familyByFormat[format]
  if (format === 'json' || format === 'jsonc') {
    return `json/families/json/profiles/${format}.js`
  }
  return family === undefined
    ? `src/${format}/definition.js`
    : `src/families/${family}/profiles/${format}.js`
}

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

interface ProviderModule {
  createTextSyntaxProvider<Contract extends TextDataContractId>(
    contract: Contract,
  ): TextSyntaxProvider<Contract>
}

interface FormatProviderModule {
  createProvider(selection: {
    readonly contract: TextDataContractId
  }): TextSyntaxProvider<TextDataContractId> | Lease<TextSyntaxProvider<TextDataContractId>>
}

interface AlternateProviderModule {
  createProvider(selection: {
    readonly contract: 'common.text-data/xml-syntax'
  }): TextSyntaxProvider<'common.text-data/xml-syntax'>
}

async function providers(): Promise<ProviderModule> {
  const modules = new Map<TextDataContractId, FormatProviderModule>()
  await Promise.all(
    Object.entries(providerFormatByContract).map(async ([contract, format]) => {
      const module = (await import(
        pathToFileURL(join(extensionRootFor(format), sourceEntrypoint(format, 'provider'))).href
      )) as FormatProviderModule
      modules.set(contract as TextDataContractId, module)
    }),
  )
  return {
    createTextSyntaxProvider(contract) {
      const module = modules.get(contract)
      if (module === undefined) throw new TypeError(`missing provider for ${contract}`)
      const selected = module.createProvider({ contract })
      return ('value' in selected ? selected.value : selected) as TextSyntaxProvider<
        typeof contract
      >
    },
  }
}

async function alternateXmlProvider(): Promise<TextSyntaxProvider<'common.text-data/xml-syntax'>> {
  const module = (await import(
    pathToFileURL(join(alternateXmlRoot, 'src', 'provider.js')).href
  )) as AlternateProviderModule
  return module.createProvider({ contract: 'common.text-data/xml-syntax' })
}

const target = {
  environment: 'node' as const,
  operatingSystem: 'windows' as const,
  architecture: 'x64' as const,
}

function providerOffer(
  providerId: string,
  contracts: readonly {
    readonly contract: TextDataContractId
    readonly offerId: string
    readonly version?: string
  }[],
): ProviderOffer {
  return {
    kind: 'primary',
    extensionId: providerId.startsWith('org.example/')
      ? 'org.example/alternate-xml'
      : 'org.modkitx/text-data',
    extensionVersion: '1.0.0',
    providerId,
    runtimeVariant: 'portable',
    target: { environments: ['browser-worker', 'node', 'node-worker'] },
    provides: contracts.map(item => ({
      offerId: item.offerId,
      contract: contractId(item.contract),
      major: 1,
      version: item.version ?? '1.0.0',
    })),
  }
}

const defaultTextOffers: readonly ProviderOffer[] = [
  providerOffer('org.modkitx/json-syntax-default', [
    {
      contract: 'common.text-data/json-syntax',
      offerId: 'json-syntax-default-v1',
    },
  ]),
  providerOffer('org.modkitx/jsonc-syntax-default', [
    { contract: 'common.text-data/jsonc-syntax', offerId: 'jsonc-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/xml-syntax-default', [
    { contract: 'common.text-data/xml-syntax', offerId: 'xml-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/yaml-syntax-default', [
    { contract: 'common.text-data/yaml-syntax', offerId: 'yaml-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/toml-syntax-default', [
    { contract: 'common.text-data/toml-syntax', offerId: 'toml-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/ini-syntax-default', [
    { contract: 'common.text-data/ini-syntax', offerId: 'ini-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/csv-syntax-default', [
    { contract: 'common.text-data/csv-syntax', offerId: 'csv-syntax-default-v1' },
  ]),
  providerOffer('org.modkitx/tsv-syntax-default', [
    { contract: 'common.text-data/tsv-syntax', offerId: 'tsv-syntax-default-v1' },
  ]),
]

const alternateXmlOffer = providerOffer('org.example/xml-syntax-parse-xml', [
  {
    contract: 'common.text-data/xml-syntax',
    offerId: 'xml-syntax-alternate-v1',
    version: '1.1.0',
  },
])

function requestFor(contract: TextDataContractId): ProviderRequest {
  return { contract: { contract: contractId(contract), major: 1 }, target }
}

async function codecFor(format: string): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extensionRootFor(format), sourceEntrypoint(format, 'codec'))).href
  )) as { createCodec(context: ContributionContext): Codec }
  const providerModule = await providers()
  const context: ContributionContext = {
    budgets: budget,
    diagnostics: { report: () => undefined },
    contracts: {
      async resolve(request) {
        return {
          value: providerModule.createTextSyntaxProvider(request.contract as TextDataContractId),
          async release() {
            return undefined
          },
        } as never
      },
      async resolveUnknown() {
        throw new Error('fixture has no foreign contract')
      },
    },
  }
  return module.createCodec(context)
}

async function probe(format: string, text: string, uri: string) {
  const bytes = new TextEncoder().encode(text)
  return (await codecFor(format)).probe({
    source: byteSource(bytes, uri),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
  })
}

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:text-data-1'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('aborted')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: 'text-data-fixture',
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

const cases = [
  ['common.text-data/json-syntax', 'json', '{"name":"Modkit","count":2}'],
  ['common.text-data/jsonc-syntax', 'jsonc', '{// comment\n"name":"Modkit",}'],
  ['common.text-data/xml-syntax', 'xml-1.0', '<root id="1"><child>value</child></root>'],
  ['common.text-data/yaml-syntax', 'yaml-1.2-core', 'name: Modkit\nitems:\n  - one\n'],
  ['common.text-data/toml-syntax', 'toml-1.0', 'name = "Modkit"\ncount = 2\n'],
  ['common.text-data/ini-syntax', 'ini-basic', '[main]\nname=Modkit\n'],
  ['common.text-data/csv-syntax', 'csv-rfc4180', 'name,count\nModkit,2\n'],
  ['common.text-data/tsv-syntax', 'tsv-iana', 'name\tcount\nModkit\t2\n'],
] as const

describe('13B text-data providers and codecs', () => {
  it('validates all isolated contribution manifests through the A-1 authorities', async () => {
    const manifestsWithRoots = (
      await Promise.all(
        textExtensionRoots.map(async root => {
          const directory = join(root, 'contributions')
          const names = await (await import('node:fs/promises')).readdir(directory)
          return Promise.all(
            names.sort().map(async name => ({
              root,
              manifest: JSON.parse(
                await readFile(join(directory, name), 'utf8'),
              ) as ContributionManifestV1Wire,
            })),
          )
        }),
      )
    ).flat()
    const manifests = manifestsWithRoots.map(item => item.manifest)
    expect(manifests).toHaveLength(32)
    expect(new Set(manifests.map(manifest => manifest.id)).size).toBe(32)
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    for (const { manifest, root } of manifestsWithRoots) {
      const result = await validateContributionManifest(manifest, registry)
      expect(result.specState, `${manifest.id}: ${JSON.stringify(result.diagnostics)}`).toBe(
        'validated',
      )
      for (const variant of manifest.runtimeVariants ?? []) {
        await expect(
          readFile(join(root, variant.entrypoint.replace(/^\.\//u, ''))),
          `${manifest.id}: ${variant.entrypoint}`,
        ).resolves.toBeInstanceOf(Buffer)
      }
    }
    expect(manifests.filter(manifest => manifest.contract.id.includes('codec'))).toHaveLength(9)
    // eight syntax providers plus the external writers and Core's JSON/plain writers.
    expect(
      manifests.filter(manifest => manifest.contract.id.includes('service-provider')),
    ).toHaveLength(15)
    expect(
      manifests.filter(manifest => manifest.contract.id.includes('contract-definition')),
    ).toHaveLength(8)
    expect(
      manifests.every(
        manifest => JSON.stringify(manifest).includes('"mutatesSource":true') === false,
      ),
    ).toBe(true)
    const manifestText = JSON.stringify(manifests)
    expect(manifestText).not.toContain('"rawPreserving":true')
    expect(manifestText).not.toMatch(/"(?:edit\.content|source\.save[^"]*)"/u)
  })

  it('validates and conforms the independently packaged alternate XML provider', async () => {
    const manifest = JSON.parse(
      await readFile(join(alternateXmlRoot, 'contributions', 'provider-xml.json'), 'utf8'),
    ) as ContributionManifestV1Wire
    const result = await validateContributionManifest(
      manifest,
      createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES),
    )
    expect(result.specState, JSON.stringify(result.diagnostics)).toBe('validated')
    const report = await runTextDataConformance(await alternateXmlProvider(), [
      {
        name: 'alternate-xml-valid',
        input: { text: '<alternate>portable</alternate>' },
        dialect: 'xml-1.0',
        budget,
        expectedState: 'ok',
      },
      {
        name: 'alternate-xml-invalid',
        input: { text: '<broken>' },
        dialect: 'xml-1.0',
        budget,
        expectedState: 'failed',
      },
    ])
    expect(report).toMatchObject({
      contract: 'common.text-data/xml-syntax',
      passed: 2,
      failures: [],
    })
  })

  it('resolves every text contract independent of registration order with byte-stable locks', () => {
    for (const [contract] of cases) {
      const request = requestFor(contract)
      const forward = resolveProvider(request, defaultTextOffers)
      const reversed = resolveProvider(request, [...defaultTextOffers].reverse())
      expect(forward.state, contract).toBe('resolved')
      expect(canonicalJsonStringify(reversed), contract).toBe(canonicalJsonStringify(forward))
      expect(serializePolicyLock([buildLockEntry(request, forward)]), contract).toBe(
        serializePolicyLock([buildLockEntry(request, reversed)]),
      )
    }
  })

  it('pins, prefers by version range, and lock-replays the alternate XML provider', () => {
    const offers = [...defaultTextOffers, alternateXmlOffer]
    const pinnedRequest: ProviderRequest = {
      ...requestFor('common.text-data/xml-syntax'),
      pin: {
        providerId: 'org.example/xml-syntax-parse-xml',
        offerId: 'xml-syntax-alternate-v1',
      },
    }
    const pinned = resolveProvider(pinnedRequest, offers)
    expect(pinned.state).toBe('resolved')
    if (pinned.state !== 'resolved') throw new Error('alternate XML pin did not resolve')
    expect(pinned.selected.offer.providerId).toBe('org.example/xml-syntax-parse-xml')
    const lock = serializePolicyLock([buildLockEntry(pinnedRequest, pinned)])
    const replayed = replayPolicyLock(pinnedRequest, [...offers].reverse(), lock)
    expect(replayed.state).toBe('resolved')
    if (replayed.state === 'resolved') {
      expect(replayed.selected.offer.providerId).toBe('org.example/xml-syntax-parse-xml')
      expect(replayed.selected.resolvedContract.offerId).toBe('xml-syntax-alternate-v1')
    }

    const ranged = resolveProvider(
      {
        ...requestFor('common.text-data/xml-syntax'),
        contract: {
          contract: contractId('common.text-data/xml-syntax'),
          major: 1,
          range: '^1.1.0',
        },
      },
      offers,
    )
    expect(ranged.state).toBe('resolved')
    if (ranged.state === 'resolved') {
      expect(ranged.selected.offer.providerId).toBe('org.example/xml-syntax-parse-xml')
    }
  })

  it('isolates TSV and JSONC replacements from their sibling contracts', () => {
    const alternateTsv = providerOffer('org.example/tsv-syntax-alternate', [
      {
        contract: 'common.text-data/tsv-syntax',
        offerId: 'tsv-syntax-alternate-v1',
        version: '1.1.0',
      },
    ])
    const alternateJsonc = providerOffer('org.example/jsonc-syntax-alternate', [
      {
        contract: 'common.text-data/jsonc-syntax',
        offerId: 'jsonc-syntax-alternate-v1',
        version: '1.1.0',
      },
    ])
    const offers = [...defaultTextOffers, alternateTsv, alternateJsonc]
    const csv = resolveProvider(requestFor('common.text-data/csv-syntax'), offers)
    const json = resolveProvider(requestFor('common.text-data/json-syntax'), offers)
    expect(csv.state).toBe('resolved')
    expect(json.state).toBe('resolved')
    if (csv.state === 'resolved') {
      expect(csv.selected.offer.providerId).toBe('org.modkitx/csv-syntax-default')
    }
    if (json.state === 'resolved') {
      expect(json.selected.offer.providerId).toBe('org.modkitx/json-syntax-default')
    }
  })

  it.each(cases)(
    'parses and publishes the right lazy source for %s',
    async (contract, dialect, text) => {
      const module = await providers()
      const provider = module.createTextSyntaxProvider(contract)
      const report = await runTextDataConformance(provider, [
        { name: `${dialect}-valid`, input: { text }, dialect, budget, expectedState: 'ok' },
      ])
      expect(report).toMatchObject({ contract, passed: 1, failures: [] })
      const dataLease = await provider.dataSource({ input: { text }, dialect, budget })
      if (contract.endsWith('/csv-syntax') || contract.endsWith('/tsv-syntax')) {
        const source = dataLease.value as TableDataSource
        expect(await source.shape()).toMatchObject({ rows: 'unknown', columns: 2 })
        expect((await source.rows({ kind: 'range', from: 0, count: 1 })).items).toHaveLength(1)
      } else {
        const source = dataLease.value as TreeDataSource
        const root = await source.root()
        expect(root.id).toBe('root')
        expect((await source.children(root, { limit: 10 })).items.length).toBeGreaterThan(0)
      }
      await dataLease.release()
    },
    // the first case pays the cold import of every bundled provider; under machine contention
    // (parallel agent runs) that exceeded the 5 s default once
    20_000,
  )

  it.each([
    ['json', '{"ok":true}'],
    ['jsonc', '{// comment\n"ok":true}'],
    ['xml', '<root/>'],
    ['yaml', 'key: value\n'],
    ['toml', 'key = "value"\n'],
    ['ini', '[main]\nkey=value\n'],
    ['csv', 'a,b\n1,2\n'],
    ['tsv', 'a\tb\n1\t2\n'],
  ] as const)(
    'requires structural evidence in addition to the .%s extension',
    async (format, ownText) => {
      const own = await probe(format, ownText, `memory://fixtures/data.${format}`)
      const foreign = await probe(
        format,
        'plain text without the expected structure',
        `memory://fixtures/data.${format}`,
      )
      expect(own.confidence).toBeGreaterThan(0.5)
      expect(foreign.confidence).toBeLessThanOrEqual(0.15)
    },
  )

  it('keeps JSON/JSONC bounded detection honest', async () => {
    const comment = '{// actual comment\n"value":1}'
    const strictComment = await probe('json', comment, 'memory://fixtures/value')
    const jsoncComment = await probe('jsonc', comment, 'memory://fixtures/value')
    expect(jsoncComment.confidence).toBeGreaterThan(0.9)
    expect(strictComment.confidence).toBeLessThan(0.2)

    const markerInString = '{"url":"https://example.invalid/a//b"}'
    const strictString = await probe('json', markerInString, 'memory://fixtures/value')
    const jsoncString = await probe('jsonc', markerInString, 'memory://fixtures/value')
    expect(strictString.confidence).toBe(jsoncString.confidence)

    const markerBeyondProbe = `{"padding":"${'x'.repeat(9000)}",// beyond bounded window\n"v":1}`
    const boundedJson = await probe('json', markerBeyondProbe, 'memory://fixtures/value')
    const boundedJsonc = await probe('jsonc', markerBeyondProbe, 'memory://fixtures/value')
    expect(boundedJson.confidence).toBe(boundedJsonc.confidence)
    expect(boundedJson.evidence[0]?.note).toBe('json-jsonc-ambiguous')
  })

  it('pages one million delimited rows without materializing an eager document', async () => {
    const { createTextSyntaxProvider } = await providers()
    const text = 'left,right\n'.repeat(1_000_000)
    const provider = createTextSyntaxProvider('common.text-data/csv-syntax')
    const dataLease = await provider.dataSource({
      input: { text },
      dialect: 'csv-rfc4180',
      budget: { ...budget, maxInputBytes: 20_000_000n, maxNodes: 2 },
    })
    const source = dataLease.value as TableDataSource
    expect(await source.shape()).toEqual({ rows: 'unknown', columns: 2 })
    expect(await source.rows({ kind: 'range', from: 0, count: 2 })).toMatchObject({
      items: [
        { index: 0, cells: ['left', 'right'] },
        { index: 1, cells: ['left', 'right'] },
      ],
      nextCursor: '2',
    })
    expect(await source.rows({ kind: 'range', from: 999_999, count: 1 })).toMatchObject({
      items: [{ index: 999_999, cells: ['left', 'right'] }],
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      source.rows({ kind: 'range', from: 500_000, count: 1 }, controller.signal),
    ).rejects.toThrow(/cancel/u)
    await dataLease.release()
  })

  it('returns stable diagnostics with simultaneous byte and UTF-16 coordinates', async () => {
    const { createTextSyntaxProvider } = await providers()
    const malformed = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"emoji":"😀",\r\n broken}'),
    ])
    const result = await createTextSyntaxProvider('common.text-data/json-syntax').parse({
      input: { bytes: malformed },
      dialect: 'json',
      budget,
    })
    expect(result.state).toBe('failed')
    if (result.state !== 'failed') throw new Error('malformed JSON unexpectedly parsed')
    const first = result.diagnostics[0]
    expect(first?.code).toBe('org.modkitx/text-data-json-parse')
    expect(first?.severity).toBe('error')
    expect(first?.range).toMatchObject({ line: 1 })
    if (first?.range && 'byteOffset' in first.range && 'utf16Offset' in first.range) {
      expect(BigInt(first.range.byteOffset)).toBeGreaterThan(BigInt(first.range.utf16Offset))
    } else {
      throw new Error('diagnostic did not retain byte and UTF-16 coordinates')
    }
  })

  it.each(cases)(
    'opens %s through codec → provider → session without format UI',
    async (contract, dialect, text) => {
      const format = contract.slice('common.text-data/'.length, -'-syntax'.length)
      const module = (await import(
        pathToFileURL(join(extensionRootFor(format), sourceEntrypoint(format, 'codec'))).href
      )) as { createCodec(context: ContributionContext): Codec }
      const providerModule = await providers()
      const context: ContributionContext = {
        budgets: budget,
        diagnostics: { report: () => undefined },
        contracts: {
          async resolve(request) {
            return {
              value: providerModule.createTextSyntaxProvider(
                request.contract as TextDataContractId,
              ),
              async release() {
                return undefined
              },
            } as never
          },
          async resolveUnknown() {
            throw new Error('fixture has no foreign contract')
          },
        },
      }
      const codec = module.createCodec(context)
      const bytes = new TextEncoder().encode(text)
      const source = byteSource(bytes, `memory://fixtures/example.${format}`)
      const detection = await codec.probe({
        source,
        plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
      })
      expect(detection.codecId).toBe(`org.modkitx/text-${format}`)
      const session = await codec.open(inputFor(source), 'inspect', budget)
      const descriptor = await session.descriptor()
      expect(descriptor).toMatchObject({
        interpretation: 'codec',
        identity: { codecId: `org.modkitx/text-${format}` },
      })
      expect(descriptor.traits.map(trait => trait.id)).toEqual(
        expect.arrayContaining(['content.text', 'content.binary']),
      )
      expect(await session.operations().invoke('validate', null)).toMatchObject({ state: 'ok' })
      if (format === 'csv' || format === 'tsv') {
        expect(await session.operations().invoke('scan', { from: 0, count: 1 })).toMatchObject({
          state: 'ok',
          output: { kind: 'json' },
        })
      }
      await session.dispose()
      void dialect
    },
  )

  it('preserves encoding/BOM/newline unless an explicit serialize target changes them', async () => {
    const { createTextSyntaxProvider } = await providers()
    const provider = createTextSyntaxProvider('common.text-data/json-syntax')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}\r\n')])
    const parsed = await provider.parse({ input: { bytes }, dialect: 'json', budget })
    expect(parsed.state).toBe('ok')
    if (parsed.state === 'failed') throw new Error('fixture did not parse')
    const preserved = await provider.serialize({
      document: parsed.document,
      dialect: 'json',
      budget,
    })
    expect(preserved).toMatchObject({ encoding: 'utf-8', bom: true, newline: 'crlf' })
    expect([...preserved.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const changed = await provider.serialize({
      document: parsed.document,
      dialect: 'json',
      target: { bom: false, newline: 'lf' },
      budget,
    })
    expect(changed).toMatchObject({ encoding: 'utf-8', bom: false, newline: 'lf' })
  })

  it('matches the recorded INI and CSV oracle fixtures', async () => {
    const { createTextSyntaxProvider } = await providers()
    const iniFixture = JSON.parse(
      await readFile(
        join(extensionRootFor('ini'), 'test', 'fixtures', 'ini-structured-parity.json'),
        'utf8',
      ),
    ) as {
      input: string
      sections: readonly { name: string; entries: Readonly<Record<string, string>> }[]
    }
    const ini = await createTextSyntaxProvider('common.text-data/ini-syntax').parse({
      input: { text: iniFixture.input },
      dialect: 'ini-default',
      budget,
    })
    expect(ini.state).toBe('ok')
    if (ini.state === 'failed') throw new Error('INI parity fixture failed')
    expect(
      ini.document.sections.map(section => ({
        name: section.name,
        entries: Object.fromEntries(section.entries.map(entry => [entry.key, entry.value])),
      })),
    ).toEqual(iniFixture.sections)

    const csvFixture = JSON.parse(
      await readFile(
        join(extensionRootFor('csv'), 'test', 'fixtures', 'csv-rfc4180-parity.json'),
        'utf8',
      ),
    ) as { input: string; rows: readonly (readonly string[])[] }
    const csv = await createTextSyntaxProvider('common.text-data/csv-syntax').parse({
      input: { text: csvFixture.input },
      dialect: 'csv-rfc4180',
      budget,
    })
    expect(csv.state).toBe('ok')
    if (csv.state === 'failed') throw new Error('CSV parity fixture failed')
    expect(csv.document.rows.map(row => row.cells.map(cell => cell.value))).toEqual(csvFixture.rows)
  })

  /*
   * Block 11 slice 11A.3. The block-9 difference matrix recorded one honest CSV gap: detection read
   * a grammar the parser does not use. `detectDelimited` split the probe window on bare newlines and
   * bare delimiters, so a spec-legal file whose quoted field carries a comma or a CR/LF looked
   * ragged and scored 0.05 — X3 refused a document the canonical stack parsed. Detection now runs
   * the parser's own quote-aware scan.
   */
  it('detects a spec-legal CSV whose quoted fields carry the delimiter and a line break', async () => {
    const specLegal =
      'name,quote,note\r\nAlice,"Hello, ""world""",first\r\nBob,"line one\r\nline two",second\r\n'
    const detected = await probe('csv', specLegal, 'memory://fixtures/table.csv')
    expect(detected.confidence).toBeGreaterThan(0.9)
    expect(detected.evidence[0]?.note).toBe('delimited-arity')

    // The very bytes of the parity sample, which used to score 0.05.
    const sample = await readFile(
      join(
        repositoryRoot,
        'packages',
        'testkit',
        'test',
        'fixtures',
        'mk2-synthetic',
        'minimal.csv',
      ),
      'utf8',
    )
    expect(
      (await probe('csv', sample, 'memory://fixtures/minimal.csv')).confidence,
    ).toBeGreaterThan(0.9)

    // Ragged arity is still not a table, and a NUL is still not text.
    expect(
      (await probe('csv', 'a,b\r\nc,d,e\r\n', 'memory://fixtures/x.csv')).confidence,
    ).toBeLessThan(0.1)
    expect(
      (await probe('csv', 'a,b \r\nc,d\r\n', 'memory://fixtures/x.csv')).confidence,
    ).toBeLessThan(0.05)

    // TSV reads the same grammar with its own delimiter, and does not answer for commas.
    expect(
      (await probe('tsv', 'name\tquote\r\nAlice\t"tab\tinside"\r\n', 'memory://fixtures/x.tsv'))
        .confidence,
    ).toBeGreaterThan(0.9)
    expect(
      (await probe('tsv', 'a,b\r\nc,d\r\n', 'memory://fixtures/x.tsv')).confidence,
    ).toBeLessThan(0.1)
  })

  it('reads quotes, embedded breaks, BOM, empty and trailing cells, and serializes back', async () => {
    const { createTextSyntaxProvider } = await providers()
    const provider = createTextSyntaxProvider('common.text-data/csv-syntax')
    const parseText = async (text: string) => {
      const result = await provider.parse({ input: { text }, dialect: 'csv-rfc4180', budget })
      if (result.state === 'failed')
        throw new Error(result.diagnostics[0]?.message ?? 'parse failed')
      return result.document.rows.map(row => row.cells.map(cell => cell.value))
    }

    expect(await parseText('a,"b,c",d\r\n')).toEqual([['a', 'b,c', 'd']])
    expect(await parseText('a,"line\r\nbreak",c\r\n')).toEqual([['a', 'line\r\nbreak', 'c']])
    expect(await parseText('a,"say ""hi""",c\r\n')).toEqual([['a', 'say "hi"', 'c']])
    expect(await parseText('a,,c\r\n')).toEqual([['a', '', 'c']])
    expect(await parseText('a,b,\r\n')).toEqual([['a', 'b', '']])

    // A UTF-8 BOM is provenance, not a cell: it is stripped and reported on the document source.
    const withBom = await provider.parse({
      input: {
        bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b\r\nc,d\r\n')]),
      },
      dialect: 'csv-rfc4180',
      budget,
    })
    if (withBom.state === 'failed') throw new Error('BOM sample failed')
    expect(withBom.document.source).toMatchObject({ encoding: 'utf-8', bom: true, newline: 'crlf' })
    expect(withBom.document.rows[0]?.cells[0]?.value).toBe('a')

    // serialize → parse returns the same table, quoting only what needs quoting.
    const round = await provider.parse({
      input: { text: 'a,"b,c"\r\n"d""e",f\r\n' },
      dialect: 'csv-rfc4180',
      budget,
    })
    if (round.state === 'failed') throw new Error('round-trip sample failed')
    const serialized = await provider.serialize({
      document: round.document,
      dialect: 'csv-rfc4180',
      budget,
      target: {},
    })
    const reparsed = await provider.parse({
      input: { bytes: serialized.bytes },
      dialect: 'csv-rfc4180',
      budget,
    })
    if (reparsed.state === 'failed') throw new Error('re-parse failed')
    expect(reparsed.document.rows.map(row => row.cells.map(cell => cell.value))).toEqual(
      round.document.rows.map(row => row.cells.map(cell => cell.value)),
    )
  })

  it('carries a spreadsheet formula as literal text and never evaluates or rewrites it', async () => {
    const { createTextSyntaxProvider } = await providers()
    const provider = createTextSyntaxProvider('common.text-data/csv-syntax')
    const injections = ['=CMD("calc")', '+1+1', '-1-1', '@SUM(A1)', '=1+1', '\t=HYPERLINK("x")']
    const text = `${injections.map(value => `${value},safe`).join('\r\n')}\r\n`
    const parsed = await provider.parse({ input: { text }, dialect: 'csv-rfc4180', budget })
    if (parsed.state === 'failed') throw new Error('injection sample failed')
    const firstCells = parsed.document.rows.map(row => row.cells[0]?.value)
    expect(firstCells).toEqual(injections)
    // Nothing was computed: `=1+1` stays five characters, not the number two.
    expect(firstCells).not.toContain('2')

    const lease = await provider.dataSource({ input: { text }, dialect: 'csv-rfc4180', budget })
    const table = lease.value as TableDataSource
    expect((await table.cell({ row: 0, column: 0 })).value).toBe('=CMD("calc")')
    await lease.release()
  })

  it('fails closed before vendor parsing on budgets, aliases, DTDs, NUL and cancellation', async () => {
    const { createTextSyntaxProvider } = await providers()
    const probes: readonly [TextDataContractId, ParseRequest][] = [
      [
        'common.text-data/json-syntax',
        {
          input: { text: '{"oversized":true}' },
          dialect: 'json',
          budget: { ...budget, maxInputBytes: 2n },
        },
      ],
      [
        'common.text-data/xml-syntax',
        { input: { text: '<!DOCTYPE x [<!ENTITY y "z">]><x>&y;</x>' }, dialect: 'xml-1.0', budget },
      ],
      [
        'common.text-data/yaml-syntax',
        { input: { text: 'a: &a [x]\nb: *a\n' }, dialect: 'yaml-1.2-core', budget },
      ],
      [
        'common.text-data/csv-syntax',
        { input: { text: 'a,\0b\n' }, dialect: 'csv-rfc4180', budget },
      ],
    ]
    for (const [contract, request] of probes) {
      const result = await createTextSyntaxProvider(contract).parse(request)
      expect(result.state, contract).toBe('failed')
      if (result.state === 'failed') {
        expect(result.diagnostics[0]?.code, contract).toMatch(/^org\.modkitx\//u)
        expect(result.diagnostics[0]?.range, contract).toBeDefined()
      }
    }
    const budgetProbe = probes[0]
    if (budgetProbe === undefined) throw new Error('budget probe fixture is missing')
    const budgetFailure = await createTextSyntaxProvider('common.text-data/json-syntax').parse(
      budgetProbe[1],
    )
    expect(budgetFailure.state).toBe('failed')
    if (budgetFailure.state === 'failed') {
      expect(budgetFailure.diagnostics[0]?.code).toBe('org.modkitx/text-data-input-budget')
    }
    const controller = new AbortController()
    controller.abort()
    await expect(
      createTextSyntaxProvider('common.text-data/json-syntax').parse({
        input: { text: '{}' },
        dialect: 'json',
        budget,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/u)
  })

  it.each([
    ['common.text-data/json-syntax', 'json', '{'],
    ['common.text-data/jsonc-syntax', 'jsonc', '{/* unterminated'],
    ['common.text-data/xml-syntax', 'xml-1.0', '<root>'],
    ['common.text-data/yaml-syntax', 'yaml-1.2-core', 'x: ['],
    ['common.text-data/toml-syntax', 'toml-1.0', 'x ='],
    ['common.text-data/ini-syntax', 'ini-basic', '[unterminated'],
    ['common.text-data/csv-syntax', 'csv-rfc4180', '"unterminated'],
    ['common.text-data/tsv-syntax', 'tsv-iana', '"unterminated'],
  ] as const)('returns a stable diagnostic for malformed %s', async (contract, dialect, text) => {
    const { createTextSyntaxProvider } = await providers()
    const result = await createTextSyntaxProvider(contract).parse({
      input: { text },
      dialect,
      budget,
    })
    expect(result.state).toBe('failed')
    if (result.state !== 'failed') throw new Error(`${contract} malformed fixture parsed`)
    expect(result.diagnostics).not.toHaveLength(0)
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error' })
    expect(result.diagnostics[0]?.code).toMatch(/^org\.modkitx\//u)
    expect(result.diagnostics[0]?.range).toBeDefined()
  })

  it('reports truncation rather than over-consuming configured node limits', async () => {
    const { createTextSyntaxProvider } = await providers()
    const json = await createTextSyntaxProvider('common.text-data/json-syntax').parse({
      input: { text: '{"a":[1,2,3],"b":{"c":4}}' },
      dialect: 'json',
      budget: { ...budget, maxNodes: 2 },
    })
    expect(json).toMatchObject({ state: 'truncated', truncated: { limit: 'maxNodes' } })
    const csv = await createTextSyntaxProvider('common.text-data/csv-syntax').parse({
      input: { text: 'a,b\n1,2\n3,4\n' },
      dialect: 'csv-rfc4180',
      budget: { ...budget, maxNodes: 1 },
    })
    expect(csv).toMatchObject({ state: 'truncated', truncated: { limit: 'maxNodes' } })
  })

  it.each(Object.values(providerFormatByContract))(
    'keeps the %s codec and provider import graphs isolated',
    async format => {
      const parserPackages = ['jsonc-parser', '@rgrove/parse-xml', 'yaml', 'smol-toml'] as const
      const expectedParser = {
        json: 'jsonc-parser',
        jsonc: 'jsonc-parser',
        xml: '@rgrove/parse-xml',
        yaml: 'yaml',
        toml: 'smol-toml',
        ini: undefined,
        csv: undefined,
        tsv: undefined,
      }[format]
      const graphFor = async (kind: 'codec' | 'provider') => {
        const result = await build({
          absWorkingDir: extensionRootFor(format),
          entryPoints: [sourceEntrypoint(format, kind)],
          bundle: true,
          format: 'esm',
          platform: 'neutral',
          packages: 'external',
          write: false,
          metafile: true,
          logLevel: 'silent',
        })
        const inputs = Object.keys(result.metafile?.inputs ?? {}).map(path =>
          path.replaceAll('\\', '/'),
        )
        const external = Object.values(result.metafile?.outputs ?? {})
          .flatMap(output => output.imports)
          .filter(item => item.external)
          .map(item => item.path)
        return { inputs, external }
      }
      const codecGraph = await graphFor('codec')
      const providerGraph = await graphFor('provider')
      for (const other of Object.values(providerFormatByContract)) {
        if (other === format) continue
        expect(codecGraph.inputs, `${format} codec imported ${other}`).not.toEqual(
          expect.arrayContaining([expect.stringContaining(sourceProfile(other))]),
        )
        expect(providerGraph.inputs, `${format} provider imported ${other}`).not.toEqual(
          expect.arrayContaining([expect.stringContaining(sourceProfile(other))]),
        )
      }
      expect(codecGraph.external.filter(path => parserPackages.includes(path as never))).toEqual([])
      expect(
        providerGraph.external.filter(path => parserPackages.includes(path as never)).sort(),
      ).toEqual(expectedParser === undefined ? [] : [expectedParser])
    },
  )

  it('keeps the public index provider-free and all portable sources free of node imports', async () => {
    for (const root of textExtensionRoots.filter(root => root !== nativeTextRoot)) {
      expect(await readFile(join(root, 'src', 'index.js'), 'utf8'), root).not.toMatch(/providers/u)
    }
    for (const format of Object.values(providerFormatByContract)) {
      for (const kind of ['codec', 'provider'] as const) {
        const path = sourceEntrypoint(format, kind)
        expect(await readFile(join(extensionRootFor(format), path), 'utf8'), path).not.toMatch(
          /node:/u,
        )
      }
    }
    const sharedRoot = join(repositoryRoot, 'packages', 'codec-kit', 'src', 'text')
    for (const path of [
      'index.js',
      'codec-runtime.js',
      'provider-runtime.js',
      'scalars.js',
      'text.js',
      'tree-data-source.js',
    ]) {
      expect(await readFile(join(sharedRoot, path), 'utf8'), path).not.toMatch(/node:/u)
    }
    for (const format of Object.values(providerFormatByContract)) {
      const providerSource = await readFile(
        join(extensionRootFor(format), sourceEntrypoint(format, 'provider')),
        'utf8',
      )
      expect(providerSource).not.toMatch(/publisher-specific-container/iu)
      expect(providerSource).not.toMatch(/org\.example/u)
    }
  })
})
