import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'contributions')
mkdirSync(output, { recursive: true })

const formatRoot = join(root, 'src', 'formats')
const formatNames = readdirSync(formatRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const formats = new Map()
for (const format of formatNames) {
  const module = await import(pathToFileURL(join(formatRoot, format, 'definition.js')).href)
  formats.set(format, module.definition)
}

for (const name of readdirSync(output)) {
  if (name.endsWith('.json')) unlinkSync(join(output, name))
}

const budgets = {
  maxInputBytes: '1073741824',
  maxDepth: 256,
  maxNodes: 1000000,
  maxScalarBytes: 104857600,
  maxDiagnostics: 10000,
}

const runtimeVariant = (entrypoint, permissions) => [
  {
    variantId: 'portable',
    entrypoint,
    target: { environments: ['browser-worker', 'node', 'node-worker'] },
    executionProfile: 'worker-brokered',
    requestedPermissionClasses: permissions,
  },
]

const operations = format =>
  [
    ['view.inspect', 'inspect', 'json'],
    ['asset.validate', 'validate', 'none'],
    ['asset.search', 'search', 'json'],
    ['export.raw', 'export-raw', 'bytes'],
    ['data.parse', 'parse', 'json'],
    ['data.serialize', 'serialize', 'bytes'],
    ...(format === 'csv' || format === 'tsv' ? [['data.scan', 'scan', 'json']] : []),
  ].map(([id, handlerId, output]) => ({
    id,
    handlerId,
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: [output],
  }))

for (const [format, config] of formats) {
  const semanticTrait = config.semantic === 'tree' ? 'structure.hierarchy' : 'table.cells'
  const semanticSource =
    config.semantic === 'tree' ? 'common.view/tree-data-source' : 'common.view/table-data-source'
  const manifest = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/codec-contribution', major: 1 },
    id: `org.modkitx/text-${format}`,
    displayName: `${format.toUpperCase()} text data`,
    runtimeVariants: runtimeVariant(`./src/formats/${format}/codec.js`, ['read-source']),
    spec: {
      formatRefs: [{ formatId: format, label: format.toUpperCase(), mediaType: config.mediaType }],
      roles: ['semantic'],
      sourceTopology: 'single',
      artifactStages: ['authored'],
      openIntents: ['probe', 'inspect', 'full', 'stream', 'export'],
      match: { extensions: config.extensions, mediaTypes: [config.mediaType] },
      probe: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
      requires: [
        {
          contract: config.contract,
          major: 1,
          range: '^1.0.0',
        },
      ],
      representations: [
        {
          id: 'syntax-document',
          contract: `common.text-data/${format}-document`,
          major: 1,
          stage: 'authored',
          lossy: false,
        },
      ],
      publishesDataSources: [
        { contract: semanticSource, major: 1 },
        { contract: 'common.view/text-data-source', major: 1 },
        { contract: 'common.view/byte-range-source', major: 1 },
      ],
      operations: operations(format),
      traitDeclarations: [
        { id: semanticTrait, representation: 'source', presence: 'will-expose' },
        { id: 'content.text', representation: 'source', presence: 'will-expose' },
        { id: 'content.binary', representation: 'source', presence: 'will-expose' },
      ],
      implementationTier: { claimed: config.implementationTier },
      budgets,
    },
  }
  writeFileSync(join(output, `codec-${format}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
}

for (const [format, config] of formats) {
  const manifest = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
    id: `org.modkitx/${format}-syntax-default`,
    displayName: `${format} syntax provider`,
    runtimeVariants: runtimeVariant(`./src/formats/${format}/provider.js`, []),
    spec: {
      provides: [
        {
          offerId: `${format}-syntax-default-v1`,
          contract: config.contract,
          major: 1,
          version: '1.0.0',
        },
      ],
      lifecycleScope: 'session',
      outputs: [
        {
          id: config.semantic === 'table' ? 'table.cells' : 'structure.hierarchy',
          representation: 'runtime',
          presence: 'will-expose',
        },
      ],
    },
  }
  writeFileSync(
    join(output, `provider-${format}-default.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}
