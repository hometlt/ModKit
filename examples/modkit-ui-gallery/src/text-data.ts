/**
 * Opens every independent text-data format under `extensions/data` through its real codec and provider.
 *
 * Nothing here re-parses anything: the extension's own `createCodec` is called with a minimal
 * context, the provider is resolved through `context.contracts.resolve`, and the resulting session
 * hands back the data sources the codec declares in its contribution manifest. The gallery then
 * mounts the shipped viewers on those sources.
 *
 * This is the "direct library/provider test without workbench" surface of doc 06 §22.
 */
import { TEXT_DATA_ENTRYPOINTS, TEXT_DATA_BROKEN } from './text-data-entrypoints.generated.js'

export { TEXT_DATA_BROKEN }

export type FormatId = 'json' | 'jsonc' | 'xml' | 'yaml' | 'toml' | 'ini' | 'csv' | 'tsv'

export interface FormatSpec {
  readonly id: FormatId
  readonly label: string
  readonly mediaType: string
  /** The semantic data source this codec publishes beyond text and bytes. */
  readonly semantic: 'common.view/tree-data-source' | 'common.view/table-data-source'
  readonly traits: readonly string[]
  readonly sample: string
}

const CATALOG_JSON = `{
  "$schema": "https://schemas.modkit.org/unit.json",
  "id": "Marine",
  "parent": "CUnitStandard",
  "life": 45,
  "armor": 0,
  "abilities": ["Stimpack", "CombatShield"],
  "model": { "path": "Assets/Marine.m3", "scale": 1.0 },
  "flags": { "biological": true, "mechanical": false }
}`

export const FORMATS: readonly FormatSpec[] = Object.freeze([
  {
    id: 'json',
    label: 'JSON',
    mediaType: 'application/json',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: CATALOG_JSON,
  },
  {
    id: 'jsonc',
    label: 'JSONC',
    mediaType: 'application/jsonc',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: `{
  // JSONC keeps comments and trailing commas, which JSON rejects.
  "id": "Marauder",
  "life": 125,
  /* block comment */
  "abilities": ["ConcussiveShells",],
}`,
  },
  {
    id: 'xml',
    label: 'XML',
    mediaType: 'application/xml',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: `<?xml version="1.0" encoding="UTF-8"?>
<Catalog>
  <CUnit id="Zealot" parent="CUnitStandard">
    <Life value="100"/>
    <Shields value="50"/>
    <Weapon link="Psiblades"/>
  </CUnit>
  <!-- generic XML: no SC2 semantics live in this provider -->
</Catalog>`,
  },
  {
    id: 'yaml',
    label: 'YAML',
    mediaType: 'application/yaml',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: `id: Zergling
parent: CUnitStandard
life: 35
speed: 4.13
abilities:
  - Burrow
  - MetabolicBoost
model:
  path: Assets/Zergling.m3
  scale: 0.9`,
  },
  {
    id: 'toml',
    label: 'TOML',
    mediaType: 'application/toml',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: `id = "Hydralisk"
parent = "CUnitStandard"
life = 90

[model]
path = "Assets/Hydralisk.m3"
scale = 1.1

[[weapons]]
name = "NeedleSpines"
damage = 12`,
  },
  {
    id: 'ini',
    label: 'INI',
    mediaType: 'text/plain',
    semantic: 'common.view/tree-data-source',
    traits: ['structure.hierarchy', 'content.text', 'content.binary'],
    sample: `; dialects differ; the provider takes an explicit one
[Unit]
Id=Ultralisk
Life=500
Armor=2

[Model]
Path=Assets/Ultralisk.m3
Scale=1.4`,
  },
  {
    id: 'csv',
    label: 'CSV',
    mediaType: 'text/csv',
    semantic: 'common.view/table-data-source',
    traits: ['table.cells', 'content.text', 'content.binary'],
    sample: `id,life,armor,model,note
Marine,45,0,Marine.m3,baseline infantry
Marauder,125,1,Marauder.m3,"anti-armour, slows"
Zealot,100,1,Zealot.m3,shields 50
"Quoted, comma",1,0,hostile.m3,"embedded ""quotes"" survive"`,
  },
  {
    id: 'tsv',
    label: 'TSV',
    mediaType: 'text/tab-separated-values',
    semantic: 'common.view/table-data-source',
    traits: ['table.cells', 'content.text', 'content.binary'],
    sample: [
      'id\tlife\tarmor\tmodel',
      'Zergling\t35\t0\tZergling.m3',
      'Hydralisk\t90\t0\tHydralisk.m3',
      'Ultralisk\t500\t2\tUltralisk.m3',
    ].join('\n'),
  },
])

type Factory = (context: unknown) => unknown

/** Entrypoints are resolved from the extension's contribution manifests at build time. */
function entrypoint(kind: 'codec' | 'provider', id: FormatId): Factory | undefined {
  return TEXT_DATA_ENTRYPOINTS[`${kind}:${id}`] as Factory | undefined
}

export function isAvailable(id: FormatId): boolean {
  return entrypoint('codec', id) !== undefined && entrypoint('provider', id) !== undefined
}

const BUDGET = {
  maxInputBytes: 1_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function sourceFor(text: string, uri: string) {
  const bytes = new TextEncoder().encode(text)
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: 'content-hash.sha256:gallery-text-data',
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ReturnType<typeof sourceFor>) {
  const binding = {
    sourceKind: 'candidate',
    bindingId: 'content',
    role: 'content',
    ownership: 'owned',
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
      compositionFingerprint: `gallery:${source.ref.uri}`,
    },
    bindingsFor() {
      return []
    },
    async openBinding() {
      return {
        value: source,
        async release() {
          return Promise.resolve()
        },
      }
    },
  }
}

/** What the descriptor actually claims — the only basis for deciding which tabs exist. */
export function traitsOf(descriptor: OpenedFormat['descriptor']): readonly string[] {
  return ((descriptor as { traits?: readonly { id: string }[] }).traits ?? []).map(t => t.id)
}

export function publishedSources(descriptor: OpenedFormat['descriptor']): readonly string[] {
  return (descriptor.dataSources ?? []).map(s => s.contract)
}

export interface OpenedFormat {
  readonly spec: FormatSpec
  readonly descriptor: {
    readonly subjectUri: string
    readonly revision: string
    readonly operations: readonly unknown[]
    readonly diagnostics: readonly unknown[]
    readonly dataSources?: readonly { readonly contract: string }[]
  }
  readonly semanticSource: unknown
  readonly textSource: unknown
  readonly byteSource: unknown
  dispose(): Promise<void>
}

/** Open one format through its own codec, exactly as a host would. */
export async function openFormat(spec: FormatSpec): Promise<OpenedFormat> {
  const providerFactory = entrypoint('provider', spec.id)
  const codecFactory = entrypoint('codec', spec.id)
  if (providerFactory === undefined || codecFactory === undefined) {
    const reason = TEXT_DATA_BROKEN.filter(item => item.id === spec.id)
      .map(item => `${item.kind}: ${item.reason}`)
      .join('; ')
    throw new Error(`text-data ${spec.id} is unavailable — ${reason || 'no entrypoint'}`)
  }
  const provider = (providerFactory as (options: unknown) => unknown)({
    contract: `common.text-data/${spec.id}-syntax`,
  })
  const codec = codecFactory({
    budgets: BUDGET,
    diagnostics: {
      report() {
        // the gallery surfaces codec diagnostics through the descriptor, not this channel
      },
    },
    contracts: {
      async resolve() {
        return {
          value: provider,
          async release() {
            return Promise.resolve()
          },
        }
      },
      async resolveUnknown() {
        throw new Error('foreign contract is unavailable')
      },
    },
  }) as {
    open(
      input: unknown,
      intent: string,
      budget: unknown,
    ): Promise<{
      descriptor(): Promise<OpenedFormat['descriptor']>
      dataSource(contract: string, major: number): Promise<{ value: unknown }>
      dispose(): Promise<void>
    }>
  }

  const source = sourceFor(spec.sample, `memory://gallery/sample.${spec.id}`)
  const session = await codec.open(inputFor(source), 'full', BUDGET)
  const descriptor = await session.descriptor()
  const lease = async (contract: string) => (await session.dataSource(contract, 1)).value

  return {
    spec,
    descriptor,
    semanticSource: await lease(spec.semantic),
    textSource: await lease('common.view/text-data-source'),
    byteSource: await lease('common.view/byte-range-source'),
    dispose: () => session.dispose(),
  }
}
