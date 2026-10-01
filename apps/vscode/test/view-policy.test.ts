/**
 * The stage list is derived from a descriptor, not from a file name — proved against a *real*
 * descriptor produced by the real open path, so a codec that changes what it publishes changes
 * this test rather than quietly changing the product.
 *
 * The catalog itself lives in `../src/stages.ts`, which imports explicit `@modkit/ui/*`
 * surfaces and therefore the DOM; the policy under test is deliberately DOM-free, so the stage
 * *facts* are restated here in the same shape the catalog uses. `orderStages` throws on an id the
 * order does not rank, while the source-boundary test below keeps unrelated UI scenes out of the
 * webview graph.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeSubjectServices, loadExtensionRoots } from '@modkit/host/node'
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'
import {
  applicableStages,
  descriptorTraits,
  orderStages,
  preferredStage,
  publishedContracts,
  stageIdOf,
  STAGE_ORDER,
  type StageFacts,
} from '../src/view-policy.js'
import {
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
} from '../src/index.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')

/** The same facts `createVsCodePreviewStages` declares, without the viewer modules. */
const CATALOG: readonly StageFacts[] = [
  { id: 'image', label: 'Image', contract: 'common.view/raster-image-source' },
  { id: 'vector', label: 'Vector', contract: 'common.view/vector-scene-source' },
  { id: 'world', label: 'World', contract: 'common.view/world-scene-source' },
  { id: 'model', label: 'Model', contract: 'common.view/model-scene-source' },
  { id: 'audio', label: 'Audio', contract: 'common.view/audio-media-source' },
  { id: 'video', label: 'Video', contract: 'common.view/video-media-source' },
  { id: 'archive', label: 'Entries', contract: 'common.view/namespace-entry-source' },
  { id: 'card', label: 'Card', contract: 'common.view/subject-facts-source' },
  {
    id: 'calculations',
    label: 'Calculations',
    contract: 'common.view/subject-calculations-source',
  },
  { id: 'table', label: 'Table', contract: 'common.view/table-data-source' },
  { id: 'tree', label: 'Tree', contract: 'common.view/tree-data-source' },
  { id: 'relations', label: 'Relations', contract: 'common.view/relation-graph-source' },
  {
    id: 'text',
    label: 'Text',
    contract: 'common.view/text-data-source',
    trait: 'content.text',
  },
  {
    id: 'virtual-text',
    label: 'Text (streaming)',
    contract: 'common.view/text-data-source',
    trait: 'content.text',
  },
  {
    id: 'text-editor',
    label: 'Text (editor)',
    contract: 'common.view/text-data-source',
    trait: 'content.text',
    editable: true,
  },
  {
    id: 'edit',
    label: 'Edit',
    contract: 'common.view/byte-range-source',
    editable: true,
  },
  { id: 'metadata', label: 'Metadata', contract: 'common.view/byte-range-source' },
  { id: 'hex', label: 'Hex', contract: 'common.view/byte-range-source' },
  {
    id: 'hex-editor',
    label: 'Hex (editor)',
    contract: 'common.view/byte-range-source',
    editable: true,
  },
]

function memorySource(name: string, text: string): ArtifactByteSource {
  const bytes = new TextEncoder().encode(text)
  return {
    kind: 'bytes',
    ref: { id: `memory://vscode/${name}`, uri: `memory://vscode/${name}` },
    revision: revisionId(`content-hash.sha256:${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

async function openJsonDescriptor(): Promise<Record<string, unknown>> {
  const services = await createNodeSubjectServices({
    topology: createVsCodeDesktopTopology(),
    realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
    extensions: [],
  })
  const result = await services.open({
    source: memorySource('sample.json', '{"name":"Modkit","items":[1,2,3]}'),
    path: 'sample.json',
    intent: 'full',
    grant: { id: 'view-policy-test', classes: ['read-source'] },
    budget: {
      maxInputBytes: 1_000_000n,
      maxDepth: 128,
      maxNodes: 100_000,
      maxScalarBytes: 1_000_000,
      maxDiagnostics: 100,
    },
  })
  if (result.state !== 'opened') throw new Error(`json did not open: ${result.reason}`)
  const descriptor = result.descriptor as unknown as Record<string, unknown>
  await result.session.dispose()
  return descriptor
}

async function openGltfDescriptor(): Promise<Record<string, unknown>> {
  const roots = await loadExtensionRoots([join(repositoryRoot, 'extensions', 'models')], {
    origin: 'bundled',
  })
  expect(roots.failures).toEqual([])
  const services = await createNodeSubjectServices({
    topology: createVsCodeDesktopTopology(),
    realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
    extensions: roots.inputs,
  })
  const result = await services.open({
    source: memorySource(
      'sample.gltf',
      JSON.stringify({
        asset: { version: '2.0', generator: 'VS Code relation-stage fixture' },
        scenes: [{ name: 'Scene', nodes: [0] }],
        nodes: [{ name: 'Triangle', mesh: 0 }],
        meshes: [{ name: 'Mesh', primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: 36, uri: 'triangle.bin' }],
      }),
    ),
    path: 'sample.gltf',
    intent: 'full',
    grant: { id: 'relation-stage-test', classes: ['read-source'] },
    budget: {
      maxInputBytes: 1_000_000n,
      maxDepth: 128,
      maxNodes: 100_000,
      maxScalarBytes: 1_000_000,
      maxDiagnostics: 100,
    },
  })
  if (result.state !== 'opened') throw new Error(`glTF did not open: ${result.reason}`)
  const descriptor = result.descriptor as unknown as Record<string, unknown>
  await result.session.dispose()
  return descriptor
}

// Composing a real host (inventory of every bundled root) takes ~10 s cold on a loaded machine.
const REAL_HOST_TIMEOUT_MS = 60_000

describe('VS Code view policy', () => {
  it('imports only the UI surfaces that the stage catalog enables', () => {
    const source = readFileSync(new URL('../src/stages.ts', import.meta.url), 'utf8')
    const importedSurfaces = [...source.matchAll(/from '@modkit\/ui\/([^']+)'/gu)].map(
      match => match[1],
    )

    expect(importedSurfaces).toEqual([
      'archive',
      'audio',
      'code',
      'card',
      'calculations',
      'editor',
      'explorer',
      'graph',
      'template',
      'hex',
      'viewer',
      'hex-editor',
      'font',
      'image',
      'map-layers',
      'model',
      'transport',
      'table',
      'text-virtual',
      'tree',
      'vector',
      'video',
      'export',
      'localization',
    ])
    // The world renderer (and three.js behind it) is imported on first mount, not with the page.
    expect(source).toContain("import('@modkit/ui/world')")
    expect(source).not.toMatch(/from '@modkit\/ui'/u)
    // the relations graph walks from its root as deep as `modkit.maxGraphHops` says, in its own
    // view and in a section of the subject's card
    expect(source).toMatch(
      /const relationsStage = createRelationGraphViewer\(\{\s+localizer: context\.localizer,\s+\.\.\.\(context\.graphDepth === undefined \? \{\} : \{ depth: context\.graphDepth \}\),/u,
    )
    expect(source).toMatch(/graph: relationsStage,/u)
    expect(source).toMatch(/module: relationsStage,/u)
    expect(source).not.toContain('@modkit/ui/monaco')
    expect(source).not.toContain('@modkit/ui/settings')
    expect(source).not.toContain('@modkit/ui/workbench')
    // `edit` and `metadata` are no longer stages of their own: they are sidebar sections of the
    // render view, mounted as viewer modules by the image stage.
    for (const id of ['text-editor', 'hex-editor']) {
      expect(source).toMatch(
        new RegExp(`id: '${id}',[\\s\\S]*?appLocal: true,[\\s\\S]*?\\n    \\}`, 'u'),
      )
    }
    for (const id of [
      'archive',
      'card',
      'calculations',
      'relations',
      'text',
      'virtual-text',
      'hex',
    ]) {
      const start = source.indexOf(`id: '${id}'`)
      const nextStage = source.indexOf('\n    {', start)
      const block = source.slice(start, nextStage < 0 ? source.length : nextStage)
      expect(block, `${id} remains governed by the generated plan`).not.toContain('appLocal: true')
    }
  })

  it('ranks every stage the catalog declares, with no duplicates', () => {
    const ordered = orderStages(CATALOG)
    expect(ordered.map(stageIdOf)).toEqual(
      STAGE_ORDER.filter(id => CATALOG.some(stage => stageIdOf(stage) === id)),
    )
    expect(new Set(ordered.map(stageIdOf)).size).toBe(CATALOG.length)
    expect(STAGE_ORDER.indexOf('relations')).toBe(STAGE_ORDER.indexOf('tree') + 1)
  })

  it('refuses a stage the order does not rank, rather than dropping it from every picker', () => {
    expect(() =>
      orderStages([...CATALOG, { id: 'holograph', label: 'Holograph', contract: 'x/y' }]),
    ).toThrow(/holograph/u)
  })

  it(
    'derives the stage list from a real descriptor',
    async () => {
      const descriptor = await openJsonDescriptor()
      // what the JSON codec actually publishes — asserted so a change upstream is visible here
      expect(publishedContracts(descriptor)).toContain('common.view/tree-data-source')
      expect(publishedContracts(descriptor)).toContain('common.view/byte-range-source')
      expect(descriptorTraits(descriptor)).toContain('content.text')

      const readOnly = applicableStages(CATALOG, descriptor).map(stageIdOf)
      expect(readOnly).toContain('tree')
      expect(readOnly).toContain('hex')
      expect(readOnly).toContain('metadata')
      // no raster source, no model source: those stages are never offered for JSON
      expect(readOnly).not.toContain('image')
      expect(readOnly).not.toContain('model')
      // and no editor at all, because this call said the host supplied no ports
      expect(readOnly).not.toContain('text-editor')
      expect(readOnly).not.toContain('hex-editor')

      const editable = applicableStages(CATALOG, descriptor, { editorPorts: true }).map(stageIdOf)
      expect(editable).toContain('hex-editor')
      expect(editable).toContain('edit')
      expect(editable.filter(id => !readOnly.includes(id))).toEqual(
        expect.arrayContaining(['hex-editor']),
      )
      // the first offered view is the richest one the descriptor supports, never hex
      expect(preferredStage(editable, undefined)).toBe(editable[0])
      expect(preferredStage(editable, undefined)).not.toBe('hex')
    },
    REAL_HOST_TIMEOUT_MS,
  )

  /*
   * A container opens on its entries.
   *
   * A zip publishes a namespace entry source *and* subject facts, so both the archive view and the
   * card apply — and a first view chosen by policy order alone put the card first for anything
   * that was not obviously media. What a person who opened an archive came for is the entry list;
   * MK2 showed it, and this is the rule that keeps it showing.
   */
  it(
    'opens a real archive on its entries, not on its card',
    async () => {
      const roots = await loadExtensionRoots([join(repositoryRoot, 'extensions', 'archives')], {
        origin: 'bundled',
      })
      expect(roots.failures).toEqual([])
      const services = await createNodeSubjectServices({
        topology: createVsCodeDesktopTopology(),
        realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
        extensions: roots.inputs,
      })
      const bytes = readFileSync(
        join(
          repositoryRoot,
          'packages',
          'testkit',
          'test',
          'fixtures',
          'mk2-synthetic',
          'minimal.zip',
        ),
      )
      const result = await services.open({
        source: {
          kind: 'bytes',
          ref: { id: 'memory://vscode/minimal.zip', uri: 'memory://vscode/minimal.zip' },
          revision: revisionId('content-hash.sha256:minimal-zip'),
          size: BigInt(bytes.byteLength),
          read: async (offset: bigint, length: number) =>
            new Uint8Array(bytes.subarray(Number(offset), Number(offset) + length)),
          stream: async function* stream() {
            yield new Uint8Array(bytes)
          },
        } as unknown as ArtifactByteSource,
        path: 'minimal.zip',
        intent: 'full',
        grant: { id: 'view-policy-test', classes: ['read-source'] },
        budget: {
          maxInputBytes: 16_000_000n,
          maxDepth: 64,
          maxNodes: 100_000,
          maxScalarBytes: 16_000_000,
          maxDiagnostics: 100,
        },
      })
      if (result.state !== 'opened') throw new Error(`zip did not open: ${result.reason}`)
      const descriptor = result.descriptor as unknown as Record<string, unknown>
      await result.session.dispose()

      expect(publishedContracts(descriptor)).toContain('common.view/namespace-entry-source')
      expect(publishedContracts(descriptor)).toContain('common.view/subject-facts-source')
      const offered = applicableStages(CATALOG, descriptor).map(stageIdOf)
      expect(offered).toContain('archive')
      expect(offered).toContain('card')
      expect(preferredStage(offered, undefined)).toBe('archive')
      // …and a plan that named the card does not take the entries away.
      expect(preferredStage(offered, 'card')).toBe('archive')
    },
    REAL_HOST_TIMEOUT_MS,
  )

  it(
    'offers Relations after Tree for a real bundled glTF graph source',
    async () => {
      const descriptor = await openGltfDescriptor()
      expect(publishedContracts(descriptor)).toContain('common.view/relation-graph-source')
      const applicable = applicableStages(CATALOG, descriptor).map(stageIdOf)
      expect(applicable).toContain('relations')
      expect(applicable.indexOf('relations')).toBe(applicable.indexOf('tree') + 1)
    },
    REAL_HOST_TIMEOUT_MS,
  )

  it('honours a plan-selected stage only when it survived applicability', async () => {
    const descriptor = await openJsonDescriptor()
    const applicable = applicableStages(CATALOG, descriptor).map(stageIdOf)
    expect(preferredStage(applicable, 'hex')).toBe('hex')
    expect(preferredStage(applicable, 'image')).toBe(applicable[0])
  })

  it('opens maps and models on their render area even when a thumbnail or archive is available', () => {
    for (const scene of ['world', 'model', 'map-layers']) {
      const applicable = ['image', scene, 'archive', 'card', 'hex']
      for (const planned of [undefined, 'image', 'archive', 'card']) {
        expect(preferredStage(applicable, planned)).toBe(scene)
      }
      expect(preferredStage(applicable, 'hex')).toBe('hex')
    }
    // the 2D layers are for a map whose world cannot be shown; a world comes first
    expect(preferredStage(['world', 'map-layers', 'archive', 'card'], 'archive')).toBe('world')
  })

  it('opens a timed world on its playback, where the play controls are', () => {
    // a replay: the plan ranks world above playback, but the world stage only follows the clock
    const replay = ['world', 'playback', 'archive', 'card', 'hex']
    for (const planned of [undefined, 'world', 'card', 'archive']) {
      expect(preferredStage(replay, planned)).toBe('playback')
    }
    expect(preferredStage(replay, 'hex')).toBe('hex')
    // a map has no transport, and audio with a timeline keeps its own render stage
    expect(preferredStage(['world', 'archive', 'card'], 'world')).toBe('world')
    expect(preferredStage(['audio', 'playback', 'card'], 'audio')).toBe('audio')
  })
})
