import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'contributions')
mkdirSync(output, { recursive: true })
const check = process.argv.includes('--check')
const prettierConfig = (await resolveConfig(root)) ?? {}

const dataSource = contract => ({ contract, major: 1 })
const trait = id => ({ id, states: ['available'] })

const contributions = [
  {
    id: 'bounded-text-stage',
    entrypoint: './dist/code/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('content.text')],
      consumesDataSources: [dataSource('common.view/text-data-source')],
      applicability: {
        interpretation: 'any',
        sourceBytes: { maximum: '16777216' },
        longestLineBytes: { maximum: 1048576, whenUnknown: 'ineligible' },
      },
      priority: 220,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'virtual-text-stage',
    entrypoint: './dist/text-virtual/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('content.text')],
      consumesDataSources: [dataSource('common.view/text-data-source')],
      applicability: { interpretation: 'any' },
      priority: 120,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'tree-stage',
    entrypoint: './dist/tree/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('structure.hierarchy')],
      consumesDataSources: [dataSource('common.view/tree-data-source')],
      priority: 300,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'table-stage',
    entrypoint: './dist/table/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('table.cells')],
      consumesDataSources: [dataSource('common.view/table-data-source')],
      priority: 320,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'hex-stage',
    entrypoint: './dist/hex/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/byte-range-source')],
      priority: 40,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'unknown-binary-fallback',
    entrypoint: './dist/hex/index.js',
    spec: {
      kind: 'fallback',
      consumesDataSources: [dataSource('common.view/byte-range-source')],
      applicability: { interpretation: 'none' },
      priority: -100,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'transport-bar',
    entrypoint: './dist/transport/index.js',
    spec: {
      kind: 'transport',
      consumesDataSources: [dataSource('common.view/transport-source')],
      priority: 100,
    },
  },
  {
    id: 'namespace-tree',
    entrypoint: './dist/namespace/index.js',
    spec: {
      kind: 'tree',
      consumesDataSources: [dataSource('common.view/namespace-entry-source')],
      priority: 200,
      singletonGroup: 'left-tree',
    },
  },
  {
    id: 'diagnostics-panel',
    entrypoint: './dist/panels/index.js',
    spec: { kind: 'panel', consumesDataSources: [], priority: 100, singletonGroup: 'right-panel' },
  },
  {
    id: 'operation-toolbar',
    entrypoint: './dist/panels/index.js',
    spec: { kind: 'toolbar', consumesDataSources: [], priority: 100, singletonGroup: 'toolbar' },
  },
]

const expected = new Map()
for (const contribution of contributions) {
  const manifest = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/viewer-contribution', major: 1 },
    id: `org.modkitx.ui/${contribution.id}`,
    displayName: contribution.id.replaceAll('-', ' '),
    runtimeVariants: [
      {
        variantId: 'browser',
        entrypoint: contribution.entrypoint,
        target: { environments: ['browser-main'] },
        executionProfile: 'trusted-in-process',
        requestedPermissionClasses: [],
      },
    ],
    spec: contribution.spec,
  }
  expected.set(
    `viewer-${contribution.id}.json`,
    await format(JSON.stringify(manifest), { ...prettierConfig, parser: 'json' }),
  )
}

if (check) {
  const stale = []
  for (const [name, text] of expected) {
    const path = join(output, name)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(name)
  }
  for (const name of readdirSync(output)) {
    if (name.startsWith('viewer-') && name.endsWith('.json') && !expected.has(name))
      stale.push(name)
  }
  if (stale.length > 0) {
    console.error(`viewer manifests are stale: ${[...new Set(stale)].sort().join(', ')}`)
    process.exitCode = 1
  } else console.log(`${expected.size} viewer manifests up to date`)
} else {
  for (const [name, text] of expected) writeFileSync(join(output, name), text)
  console.log(`emitted ${expected.size} viewer manifests`)
}
