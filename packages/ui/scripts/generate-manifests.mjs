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
    id: 'subject-card-stage',
    entrypoint: './dist/card/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/subject-facts-source')],
      priority: 390,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'subject-calculations-stage',
    entrypoint: './dist/calculations/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/subject-calculations-source')],
      priority: 380,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'relation-graph-stage',
    entrypoint: './dist/graph/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/relation-graph-source')],
      priority: 370,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'game-template-stage',
    entrypoint: './dist/template/index.js',
    spec: {
      kind: 'stage',
      requiresOperations: ['view.template'],
      consumesDataSources: [],
      priority: 365,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'image-stage',
    entrypoint: './dist/image/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('image.raster')],
      consumesDataSources: [dataSource('common.view/raster-image-source')],
      priority: 360,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'vector-stage',
    entrypoint: './dist/vector/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('vector.scene')],
      consumesDataSources: [dataSource('common.view/vector-scene-source')],
      priority: 350,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'audio-stage',
    entrypoint: './dist/audio/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('audio.streams')],
      consumesDataSources: [dataSource('common.view/audio-media-source')],
      priority: 360,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'video-stage',
    entrypoint: './dist/video/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('video.streams')],
      consumesDataSources: [dataSource('common.view/video-media-source')],
      priority: 370,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'world-stage',
    entrypoint: './dist/world/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/world-scene-source')],
      optionalDataSources: [dataSource('common.view/transport-source')],
      priority: 380,
      singletonGroup: 'center-stage',
    },
  },
  {
    id: 'model-stage',
    entrypoint: './dist/model/index.js',
    spec: {
      kind: 'stage',
      requiresTraits: [trait('model.geometry')],
      consumesDataSources: [dataSource('common.view/model-scene-source')],
      // read when the subject publishes them, ignored when it does not: the stage is still
      // selected by the base scene source alone, so a codec publishing no facet keeps its stage
      optionalDataSources: [
        dataSource('common.view/model-resource-refs-source'),
        dataSource('common.view/model-skeleton-source'),
        dataSource('common.view/model-animation-source'),
        dataSource('common.view/model-collision-source'),
        dataSource('common.view/model-material-source'),
        // MODEL_FACET_CONTRACTS in `src/model/index.ts` has read this one since sockets shipped;
        // the manifest simply never said so, which made the stage's own declaration narrower than
        // its behaviour.
        dataSource('common.view/model-socket-source'),
      ],
      // The renderer is a service of the *realm*, not a source published by the subject's codec:
      // a page with a GPU resolves one, a bridge realm without host authority does not, and the
      // stage keeps its 2D fallback either way. Declaring it is what gives stage eligibility a
      // path to `common.render/scene-3d` at all.
      optionalServices: [{ contract: 'common.render/scene-3d', major: 1 }],
      priority: 350,
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
    id: 'archive-stage',
    entrypoint: './dist/namespace/index.js',
    spec: {
      kind: 'stage',
      consumesDataSources: [dataSource('common.view/namespace-entry-source')],
      priority: 340,
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
    contract: { id: 'modkit/viewer-contribution', major: 1 },
    id: `modkit.ui/${contribution.id}`,
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

const editorManifest = {
  schemaVersion: 1,
  contract: { id: 'modkit/editor-contribution', major: 1 },
  id: 'modkit.ui/bounded-text-editor',
  displayName: 'bounded text editor',
  runtimeVariants: [
    {
      variantId: 'browser',
      entrypoint: './dist/editor/index.js',
      target: { environments: ['browser-main'] },
      executionProfile: 'trusted-in-process',
      requestedPermissionClasses: [],
    },
  ],
  spec: {
    sessionModel: 'single-subject',
    selectionKinds: ['text-range'],
    semanticLocationKinds: ['source-range'],
    requiresTransactions: true,
    requiresOperations: ['edit.content', 'source.save'],
    consumesDataSources: [dataSource('common.view/text-data-source')],
    writer: {
      formatId: 'text',
      representationId: 'source',
      mutationMode: 'mutate',
      minimumRoundTrip: 'byte-identical',
    },
    priority: 100,
    scaleLimits: { maximumSourceBytes: '16777216' },
  },
}
expected.set(
  'editor-bounded-text.json',
  await format(JSON.stringify(editorManifest), { ...prettierConfig, parser: 'json' }),
)

if (check) {
  const stale = []
  for (const [name, text] of expected) {
    const path = join(output, name)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) stale.push(name)
  }
  for (const name of readdirSync(output)) {
    if (
      (name.startsWith('viewer-') || name.startsWith('editor-')) &&
      name.endsWith('.json') &&
      !expected.has(name)
    )
      stale.push(name)
  }
  if (stale.length > 0) {
    console.error(`viewer manifests are stale: ${[...new Set(stale)].sort().join(', ')}`)
    process.exitCode = 1
  } else console.log(`${expected.size} UI contribution manifests up to date`)
} else {
  for (const [name, text] of expected) writeFileSync(join(output, name), text)
  console.log(`emitted ${expected.size} UI contribution manifests`)
}
