/**
 * The stage list is derived from a descriptor, not from a file name — proved against a *real*
 * descriptor produced by the real open path, so a codec that changes what it publishes changes
 * this test rather than quietly changing the product.
 *
 * The catalog itself lives in `../src/stages.ts`, which imports explicit `@modkitx-x3/ui/*`
 * surfaces and therefore the DOM; the policy under test is deliberately DOM-free, so the stage
 * *facts* are restated here in the same shape the catalog uses. `orderStages` throws on an id the
 * order does not rank, while the source-boundary test below keeps unrelated UI scenes out of the
 * webview graph.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeSubjectServices, loadExtensionRoots } from '@modkitx-x3/host/node'
import { revisionId, type ArtifactByteSource } from '@modkitx-x3/sdk'
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
  const roots = await loadExtensionRoots(
    [join(repositoryRoot, 'extensions', 'common', 'text-json')],
    {
      origin: 'bundled',
    },
  )
  expect(roots.failures).toEqual([])
  const services = await createNodeSubjectServices({
    topology: createVsCodeDesktopTopology(),
    realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
    extensions: roots.inputs,
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
  const roots = await loadExtensionRoots([join(repositoryRoot, 'extensions', 'common', 'models')], {
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

describe('VS Code view policy', () => {
  it('imports only the UI surfaces that the stage catalog enables', () => {
    const source = readFileSync(new URL('../src/stages.ts', import.meta.url), 'utf8')
    const importedSurfaces = [...source.matchAll(/from '@modkitx-x3\/ui\/([^']+)'/gu)].map(
      match => match[1],
    )

    expect(importedSurfaces).toEqual([
      'audio',
      'code',
      'editor',
      'explorer',
      'graph',
      'hex',
      'hex-editor',
      'image',
      'metadata',
      'model',
      'table',
      'text-virtual',
      'tree',
      'vector',
      'video',
      'world',
    ])
    expect(source).not.toMatch(/from '@modkitx-x3\/ui'/u)
    expect(source).toContain('module: relationGraphViewer')
    expect(source).not.toContain('@modkitx-x3/ui/monaco')
    expect(source).not.toContain('@modkitx-x3/ui/settings')
    expect(source).not.toContain('@modkitx-x3/ui/workbench')
    for (const id of ['relations', 'text-editor', 'edit', 'metadata', 'hex-editor']) {
      expect(source).toMatch(
        new RegExp(`id: '${id}',[\\s\\S]*?appLocal: true,[\\s\\S]*?\\n    \\}`, 'u'),
      )
    }
    for (const id of ['archive', 'text', 'virtual-text', 'hex']) {
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

  it('derives the stage list from a real descriptor', async () => {
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
  })

  it('offers Relations after Tree for a real bundled glTF graph source', async () => {
    const descriptor = await openGltfDescriptor()
    expect(publishedContracts(descriptor)).toContain('common.view/relation-graph-source')
    const applicable = applicableStages(CATALOG, descriptor).map(stageIdOf)
    expect(applicable).toContain('relations')
    expect(applicable.indexOf('relations')).toBe(applicable.indexOf('tree') + 1)
  })

  it('honours a plan-selected stage only when it survived applicability', async () => {
    const descriptor = await openJsonDescriptor()
    const applicable = applicableStages(CATALOG, descriptor).map(stageIdOf)
    expect(preferredStage(applicable, 'hex')).toBe('hex')
    expect(preferredStage(applicable, 'image')).toBe(applicable[0])
  })
})
