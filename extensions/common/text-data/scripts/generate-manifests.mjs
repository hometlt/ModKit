import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'contributions')
mkdirSync(output, { recursive: true })

const formats = {
  json: {
    extensions: ['json'],
    mediaType: 'application/json',
    contract: 'json-syntax',
    semantic: 'tree',
  },
  jsonc: {
    extensions: ['jsonc'],
    mediaType: 'application/jsonc',
    contract: 'jsonc-syntax',
    semantic: 'tree',
  },
  xml: {
    extensions: ['xml'],
    mediaType: 'application/xml',
    contract: 'xml-syntax',
    semantic: 'tree',
  },
  yaml: {
    extensions: ['yaml', 'yml'],
    mediaType: 'application/yaml',
    contract: 'yaml-syntax',
    semantic: 'tree',
  },
  toml: {
    extensions: ['toml'],
    mediaType: 'application/toml',
    contract: 'toml-syntax',
    semantic: 'tree',
  },
  ini: {
    extensions: ['ini', 'cfg', 'conf'],
    mediaType: 'text/plain',
    contract: 'ini-syntax',
    semantic: 'tree',
  },
  csv: { extensions: ['csv'], mediaType: 'text/csv', contract: 'csv-syntax', semantic: 'table' },
  tsv: {
    extensions: ['tsv', 'tab'],
    mediaType: 'text/tab-separated-values',
    contract: 'tsv-syntax',
    semantic: 'table',
  },
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

for (const [format, config] of Object.entries(formats)) {
  const semanticTrait = config.semantic === 'tree' ? 'structure.hierarchy' : 'table.cells'
  const semanticSource =
    config.semantic === 'tree' ? 'common.view/tree-data-source' : 'common.view/table-data-source'
  const manifest = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/codec-contribution', major: 1 },
    id: `org.modkitx/text-${format}`,
    displayName: `${format.toUpperCase()} text data`,
    runtimeVariants: runtimeVariant(`./src/codecs/${format}.js`, ['read-source']),
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
          contract: `common.text-data/${config.contract}`,
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
      implementationTier: { claimed: format === 'csv' || format === 'tsv' ? 2 : 1 },
      budgets,
    },
  }
  writeFileSync(join(output, `codec-${format}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
}

const providers = {
  json: ['json-syntax', 'jsonc-syntax'],
  xml: ['xml-syntax'],
  yaml: ['yaml-syntax'],
  toml: ['toml-syntax'],
  ini: ['ini-syntax'],
  delimited: ['csv-syntax', 'tsv-syntax'],
}

for (const [provider, contracts] of Object.entries(providers)) {
  const manifest = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
    id: `org.modkitx/${provider === 'delimited' ? 'delimited-text' : `${provider}-syntax`}-default`,
    displayName: `${provider} syntax provider`,
    runtimeVariants: runtimeVariant('./src/providers/index.js', []),
    spec: {
      provides: contracts.map(contract => ({
        offerId: `${contract}-default-v1`,
        contract: `common.text-data/${contract}`,
        major: 1,
        version: '1.0.0',
      })),
      lifecycleScope: 'session',
      outputs: [
        {
          id: contracts.some(contract => contract === 'csv-syntax' || contract === 'tsv-syntax')
            ? 'table.cells'
            : 'structure.hierarchy',
          representation: 'runtime',
          presence: 'will-expose',
        },
      ],
    },
  }
  writeFileSync(
    join(output, `provider-${provider}-default.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}
