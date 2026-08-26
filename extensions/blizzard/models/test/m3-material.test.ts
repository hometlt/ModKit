import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type ModelMaterialRef,
  type ModelMaterialSource,
  type ModelSceneSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { decodeM3Materials } from '../src/m3/material.node.js'
import { loadM3StructuresXml } from '../src/m3/native/binary/parser.js'
import { M3SectionList } from '../src/m3/native/binary/sections.js'
import { installM3PlatformAdapters } from '../src/m3/native/platform.js'

installM3PlatformAdapters({ DOMParser })

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const MODEL_PATH =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const MODEL_BYTES = 60_128
const MODEL_SHA256 = 'fb7680019ca7ec88aeb37591a7477c2555dd674d57f0c7486736ccb11919a436'
const TEST_PATH = 'extensions/blizzard/models/test/m3-material.test.ts'
const TEXTURE_ID = 'Assets/Textures/Synthetic_diff.dds'
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'm3-material-preflight', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

async function inventory() {
  const inputs = await Promise.all(
    [
      ['blizzard', 'casc'],
      ['blizzard', 'models'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  return buildInventory(inputs, createHostContributionContractRegistry())
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function writeTag(bytes: Uint8Array, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) bytes[offset + index] = tag.charCodeAt(3 - index)
}

function recordsBytes(
  desc: { readonly size: number; instance(): Record<string, unknown> },
  records: readonly Record<string, unknown>[],
): Uint8Array {
  const buffer = new ArrayBuffer(desc.size * records.length)
  for (const [index, record] of records.entries()) {
    Object.assign(desc.instance(), record).toBuffer(buffer, index * desc.size)
  }
  return new Uint8Array(buffer)
}

interface SyntheticMaterialOptions {
  readonly truncateTag?: 'MAT_' | 'LAYR'
  readonly nameSection?: number
  readonly textureSection?: number
  readonly materialReferenceIndex?: number
  readonly materialType?: number
  readonly emptyTexture?: boolean
}

async function buildMaterialM3(options: SyntheticMaterialOptions = {}): Promise<Uint8Array> {
  const structures = await loadM3StructuresXml(
    await readFile(
      join(repoRoot, 'extensions', 'blizzard', 'models', 'src', 'm3', 'native', 'structures.xml'),
      'utf8',
    ),
  )
  const desc = (tag: string, version: number) => structures[tag].getVersion(version, 34, structures)
  const headerDesc = desc('MD34', 11)
  const modelDesc = desc('MODL', 20)
  const materialReferenceDesc = desc('MATM', 0)
  const standardDesc = desc('MAT_', 15)
  const layerDesc = desc('LAYR', 22)
  const divisionDesc = desc('DIV_', 2)
  const regionDesc = desc('REGN', 5)
  const batchDesc = desc('BAT_', 1)
  const materialName = new TextEncoder().encode('Synthetic material\0')
  const textureName = new TextEncoder().encode(
    options.emptyTexture === true ? '\0' : `${TEXTURE_ID}\0`,
  )

  const model = modelDesc.instance()
  Object.assign(model.material_references, { entries: 1, index: 2, flags: 0 })
  Object.assign(model.materials_standard, { entries: 1, index: 3, flags: 0 })
  Object.assign(model.divisions, { entries: 1, index: 7, flags: 0 })

  const materialReference = materialReferenceDesc.instance()
  materialReference.type = options.materialType ?? 1
  materialReference.material_index = 0

  const standard = standardDesc.instance()
  Object.assign(standard.name, {
    entries: materialName.byteLength,
    index: options.nameSection ?? 4,
    flags: 0,
  })
  standard.flags = 0x0008_0009
  standard.blend_mode = 2
  standard.priority = 3
  Object.assign(standard.layer_diff, { entries: 1, index: 5, flags: 0 })

  const layer = layerDesc.instance()
  Object.assign(layer.color_bitmap, {
    entries: textureName.byteLength,
    index: options.textureSection ?? 6,
    flags: 0,
  })
  layer.flags = 0x0c
  layer.uv_source = 1
  layer.color_channels = 0x0f

  const division = divisionDesc.instance()
  Object.assign(division.regions, { entries: 1, index: 8, flags: 0 })
  Object.assign(division.batches, { entries: 1, index: 9, flags: 0 })

  const region = regionDesc.instance()
  region.id = 0
  region.vertex_count = 0
  region.face_count = 0

  const batch = batchDesc.instance()
  batch.region_index = 0
  batch.material_reference_index = options.materialReferenceIndex ?? 0
  batch.bone = -1

  const sections = [
    { tag: 'MD34', version: 11, repetitions: 1, bytes: new Uint8Array(headerDesc.size) },
    { tag: 'MODL', version: 20, repetitions: 1, bytes: recordsBytes(modelDesc, [model]) },
    {
      tag: 'MATM',
      version: 0,
      repetitions: 1,
      bytes: recordsBytes(materialReferenceDesc, [materialReference]),
    },
    {
      tag: 'MAT_',
      version: 15,
      repetitions: 1,
      bytes: recordsBytes(standardDesc, [standard]),
    },
    { tag: 'CHAR', version: 0, repetitions: materialName.byteLength, bytes: materialName },
    { tag: 'LAYR', version: 22, repetitions: 1, bytes: recordsBytes(layerDesc, [layer]) },
    { tag: 'CHAR', version: 0, repetitions: textureName.byteLength, bytes: textureName },
    { tag: 'DIV_', version: 2, repetitions: 1, bytes: recordsBytes(divisionDesc, [division]) },
    { tag: 'REGN', version: 5, repetitions: 1, bytes: recordsBytes(regionDesc, [region]) },
    { tag: 'BAT_', version: 1, repetitions: 1, bytes: recordsBytes(batchDesc, [batch]) },
  ]
  if (options.truncateTag !== undefined) {
    const section = sections.find(item => item.tag === options.truncateTag)
    if (section === undefined) throw new TypeError(`missing ${options.truncateTag} section`)
    section.bytes = section.bytes.subarray(0, section.bytes.byteLength - 1)
  }
  let cursor = 0
  const offsets = sections.map(section => {
    const offset = cursor
    cursor += section.bytes.byteLength
    return offset
  })
  const indexOffset = cursor
  const bytes = new Uint8Array(indexOffset + sections.length * 16)
  for (const [index, section] of sections.entries()) bytes.set(section.bytes, offsets[index])
  const view = new DataView(bytes.buffer)
  for (const [index, section] of sections.entries()) {
    const offset = indexOffset + index * 16
    writeTag(bytes, offset, section.tag)
    view.setUint32(offset + 4, offsets[index], true)
    view.setUint32(offset + 8, section.repetitions, true)
    view.setUint32(offset + 12, section.version, true)
  }
  const header = headerDesc.instance()
  header.tag = 0x4d443334
  header.index_offset = indexOffset
  header.index_size = sections.length
  Object.assign(header.model, { entries: 1, index: 1, flags: 0 })
  header.toBuffer(bytes.buffer, 0)
  return bytes
}

function proveMaterial(note: string): void {
  proves({ contributionId: 'org.modkitx/m3', operation: 'inspect', test: TEST_PATH, note })
}

async function pageMaterials(source: ModelMaterialSource): Promise<ModelMaterialRef[]> {
  const values: ModelMaterialRef[] = []
  let cursor: string | undefined
  do {
    const page = await source.materials({
      limit: 1,
      ...(cursor === undefined ? {} : { cursor }),
    })
    values.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return values
}

async function openMemory(bytes: Uint8Array) {
  const uri = 'memory://m3-material/fixture.m3'
  const source: ArtifactByteSource = Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${createHash('sha256').update(bytes).digest('hex')}`),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  })
  return openSubject({
    inventory: await inventory(),
    source,
    path: 'fixture.m3',
    intent: 'full',
    target,
    grant,
    budget,
    executionBackends,
  })
}

function referencedString(sections: M3SectionList, reference: unknown): string | null {
  if (reference === null || typeof reference !== 'object') return null
  const value = reference as { readonly entries?: unknown; readonly index?: unknown }
  if (!Number.isInteger(value.entries) || Number(value.entries) <= 0) return null
  if (!Number.isInteger(value.index) || Number(value.index) < 0) return null
  const section = sections.getSectionByReference(value)
  if (section?.desc.history.name !== 'CHAR') return null
  const content = section.content
  if (!Array.isArray(content) || content.length < Number(value.entries)) return null
  const bytes = Uint8Array.from(content.slice(0, Number(value.entries)), item => Number(item))
  const zero = bytes.indexOf(0)
  return new TextDecoder('latin1').decode(zero < 0 ? bytes : bytes.subarray(0, zero))
}

describe('M3 MATM/MAT_/LAYR decoding', () => {
  it('decodes standard semantics, joins a layer to a resource id, and proves BAT_ binding', async () => {
    const decoded = await decodeM3Materials(await buildMaterialM3(), budget, undefined, [
      TEXTURE_ID,
    ])
    expect(decoded).toMatchObject({
      standardMaterials: 1,
      exoticMaterials: 0,
      decodedLayers: 1,
      linkedLayers: 1,
      rejectedNames: 0,
      rejectedLayerReferences: 0,
      unresolvedLayerResources: 0,
      rejectedMaterialReferences: 0,
      ambiguousPrimitiveBindings: 0,
      unsupportedBlendModes: 0,
      fatal: false,
    })
    expect(decoded.materials).toEqual([
      expect.objectContaining({
        id: 'material-0',
        name: 'Synthetic material',
        typeName: 'standard',
        blendMode: 2,
        blendModeName: 'additive',
        priority: 3,
        flagNames: ['vertex-color', 'two-sided', 'double-lambert'],
        layers: [
          expect.objectContaining({
            slot: 'diffuse',
            resourceId: TEXTURE_ID,
            flagNames: ['uv-wrap-x', 'uv-wrap-y'],
            uvSource: 1,
            colorChannels: 15,
          }),
        ],
      }),
    ])
    expect(decoded.primitiveBindings).toEqual([
      { primitiveId: 'division-0-region-0', materialId: 'material-0' },
    ])
    proveMaterial(
      'MATM identity, MAT_ semantics, a resource-id LAYR join, and BAT_ binding decode exactly',
    )
  })

  it('publishes the material facet without inventing layer fields in its ABI', async () => {
    const opened = await openMemory(await buildMaterialM3({ emptyTexture: true }))
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') return
    try {
      const sceneLease = await opened.session.dataSource('common.view/model-scene-source', 1)
      try {
        expect(await (sceneLease.value as ModelSceneSource).info()).toMatchObject({
          materials: 1,
          textures: 1,
        })
      } finally {
        await sceneLease.release()
      }
      const lease = await opened.session.dataSource('common.view/model-material-source', 1)
      try {
        const source = lease.value as ModelMaterialSource
        expect(await source.info()).toEqual({ materials: 1 })
        const published = await pageMaterials(source)
        expect(published).toEqual([{ id: 'material-0', name: 'Synthetic material' }])
        expect(JSON.stringify(published)).not.toMatch(/\.dds/iu)
      } finally {
        await lease.release()
      }
      const receipt = opened.descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
        ?.entries[0]?.value as
        { readonly planes: readonly { planeId: string; state: string }[] } | undefined
      expect(receipt?.planes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ planeId: 'materials', state: 'normalized' }),
          expect.objectContaining({ planeId: 'material-layer-facet-fields', state: 'lost' }),
          expect.objectContaining({ planeId: 'material-shader-parameters', state: 'lost' }),
        ]),
      )
      proveMaterial(
        'the live facet carries material identity while the receipt names its absent layer ABI',
      )
    } finally {
      await opened.session.dispose()
    }
  }, 30_000)

  it.each(['MAT_', 'LAYR'] as const)(
    'reports a truncated %s table without parser escape',
    async tag => {
      const decoded = await decodeM3Materials(await buildMaterialM3({ truncateTag: tag }), budget)
      expect(decoded.fatal).toBe(true)
      expect(decoded.issues).toContainEqual(
        expect.objectContaining({
          code: `x3.m3/material-${tag.toLowerCase().replaceAll('_', '')}-truncated`,
        }),
      )
      const opened = await openMemory(
        await buildMaterialM3({ truncateTag: tag, emptyTexture: true }),
      )
      if (opened.state !== 'opened') {
        throw new Error(`truncated ${tag} did not open: ${JSON.stringify(opened).slice(0, 4000)}`)
      }
      if (opened.state === 'opened') await opened.session.dispose()
      proveMaterial(
        `a truncated ${tag} table becomes a coded refusal and keeps the subject inspectable`,
      )
    },
    30_000,
  )

  it('rejects a LAYR bitmap reference that does not address CHAR', async () => {
    const decoded = await decodeM3Materials(
      await buildMaterialM3({ textureSection: 8 }),
      budget,
      undefined,
      [TEXTURE_ID],
    )
    expect(decoded).toMatchObject({ linkedLayers: 0, rejectedLayerReferences: 1, fatal: false })
    expect(decoded.materials[0]?.layers[0]).not.toHaveProperty('resourceId')
    expect(decoded.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/material-layer-refused' }),
    )
    proveMaterial('a LAYR bitmap reference to a non-CHAR section is refused, never path-guessed')
  })

  it('rejects an out-of-range BAT_ material reference', async () => {
    const decoded = await decodeM3Materials(
      await buildMaterialM3({ materialReferenceIndex: 7 }),
      budget,
      undefined,
      [TEXTURE_ID],
    )
    expect(decoded.primitiveBindings).toEqual([])
    expect(decoded.rejectedMaterialReferences).toBe(1)
    expect(decoded.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/material-binding-refused' }),
    )
    proveMaterial(
      'an out-of-range BAT_ material_reference_index never becomes primitive.materialId',
    )
  })

  it('counts and names exotic MATM types without claiming their parameters', async () => {
    const decoded = await decodeM3Materials(await buildMaterialM3({ materialType: 3 }), budget)
    expect(decoded).toMatchObject({ standardMaterials: 0, exoticMaterials: 1 })
    expect(decoded.exoticTypes).toEqual(['composite'])
    expect(decoded.materials[0]).toMatchObject({
      id: 'material-0',
      name: 'M3 composite material 0',
      typeName: 'composite',
      layers: [],
    })
    expect(decoded.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/material-types-partial' }),
    )
    proveMaterial(
      'an exotic MATM type is named and counted while its parameter plane stays partial',
    )
  })

  it('refuses allocation through both maxNodes and maxScalarBytes before schema publication', async () => {
    const bytes = await buildMaterialM3()
    const nodes = await decodeM3Materials(bytes, { ...budget, maxNodes: 9 })
    expect(nodes).toMatchObject({ fatal: true, materials: [] })
    expect(nodes.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/material-budget-exceeded' }),
    )
    const scalar = await decodeM3Materials(bytes, { ...budget, maxScalarBytes: 1 })
    expect(scalar).toMatchObject({ fatal: true, materials: [] })
    expect(scalar.issues).toContainEqual(
      expect.objectContaining({ code: 'x3.m3/material-budget-exceeded' }),
    )
    proveMaterial('material index, records, and scalar bytes are bounded before schema publication')
  })

  it('honours an already-cancelled material decode', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      decodeM3Materials(await buildMaterialM3(), budget, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    proveMaterial('an already-cancelled material decode performs no schema work')
  })
})

describe('M3 material corpus preflight', () => {
  const sc2Root = process.env['MODKITX_SC2_ROOT']?.trim()
  const installed = sc2Root !== undefined && existsSync(join(sc2Root, '.build.info'))

  it.skipIf(!installed)(
    'pins all five standard materials and both BAT_ bindings through the host/CASC route',
    async () => {
      if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const casc = await openSubject({
        inventory: await inventory(),
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: sc2Root,
        intent: 'full',
        target,
        grant,
        budget,
        executionBackends,
      })
      if (casc.state !== 'opened') {
        throw new Error(`CASC did not open: ${JSON.stringify(casc.diagnostics).slice(0, 4000)}`)
      }
      try {
        const extracted = await casc.session.operations().invoke('extract-entry', {
          entryId: MODEL_PATH,
        })
        if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
          throw new Error(`CASC extraction failed for ${MODEL_PATH}`)
        }
        const bytes = extracted.output.value
        const digest = createHash('sha256').update(bytes).digest('hex')
        const xml = await readFile(
          join(
            repoRoot,
            'extensions',
            'blizzard',
            'models',
            'src',
            'm3',
            'native',
            'structures.xml',
          ),
          'utf8',
        )
        const sections = await M3SectionList.load(bufferOf(bytes), xml)
        const layers = sections.getSectionsByTag('LAYR').flatMap(section => section.content)
        const resourceIds = [
          ...new Map(
            layers
              .map(layer => referencedString(sections, layer.color_bitmap))
              .filter((value): value is string => value !== null && value.length > 0)
              .map(value => [value.toLowerCase(), value]),
          ).values(),
        ]
        const decoded = await decodeM3Materials(bytes, budget, undefined, resourceIds)

        expect(MODEL_PATH).not.toMatch(/^(?:[A-Za-z]:|[\\/]|[a-z][a-z0-9+.-]*:)/u)
        expect(bytes.byteLength).toBe(MODEL_BYTES)
        expect(digest).toBe(MODEL_SHA256)
        expect(sections.getSectionsByTag('MATM')).toHaveLength(1)
        expect(sections.getSectionsByTag('MATM')[0]?.content).toHaveLength(5)
        expect(sections.getSectionsByTag('MAT_')[0]?.content).toHaveLength(5)
        expect(layers).toHaveLength(65)
        expect(decoded).toMatchObject({
          standardMaterials: 5,
          exoticMaterials: 0,
          decodedLayers: 65,
          linkedLayers: 14,
          rejectedNames: 0,
          rejectedLayerReferences: 0,
          unresolvedLayerResources: 0,
          rejectedMaterialReferences: 0,
          ambiguousPrimitiveBindings: 0,
          unsupportedBlendModes: 0,
          fatal: false,
        })
        expect(decoded.materials.map(item => item.name)).toEqual([
          'SM_HML_matArtifactp01',
          '24 - Default',
          '19 - Default',
          'SM_HML_matArtifactp01222',
          '24 - Defaultdark',
        ])
        expect(decoded.primitiveBindings).toEqual([
          { primitiveId: 'division-0-region-0', materialId: 'material-0' },
          { primitiveId: 'division-0-region-1', materialId: 'material-3' },
        ])

        const nested = await openNestedSubject({
          parent: casc.session,
          entryId: MODEL_PATH,
          inventory: await inventory(),
          executionBackends,
          target,
          grant,
          budget,
        })
        if (nested.result.state !== 'opened') {
          throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 1200))
        }
        try {
          expect(nested.result.selected.contributionId).toBe('org.modkitx/m3')
          const descriptor = await nested.result.session.descriptor()
          const materialLease = await nested.result.session.dataSource(
            'common.view/model-material-source',
            1,
          )
          try {
            const source = materialLease.value as ModelMaterialSource
            expect(await source.info()).toEqual({ materials: 5 })
            const published = await pageMaterials(source)
            expect(published.map(item => item.id)).toEqual([
              'material-0',
              'material-1',
              'material-2',
              'material-3',
              'material-4',
            ])
            expect(JSON.stringify(published)).not.toMatch(/\.dds/iu)
          } finally {
            await materialLease.release()
          }
          const sceneLease = await nested.result.session.dataSource(
            'common.view/model-scene-source',
            1,
          )
          try {
            const source = sceneLease.value as ModelSceneSource
            expect(await source.info()).toMatchObject({ materials: 5, primitives: 2 })
            expect(
              await source.primitive?.('division-0-region-0', { maxBytes: 1_000_000 }),
            ).toMatchObject({ id: 'division-0-region-0', materialId: 'material-0' })
            expect(
              await source.primitive?.('division-0-region-1', { maxBytes: 1_000_000 }),
            ).toMatchObject({ id: 'division-0-region-1', materialId: 'material-3' })
          } finally {
            await sceneLease.release()
          }
          const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
            ?.entries[0]?.value as
            { readonly planes: readonly { planeId: string; state: string }[] } | undefined
          expect(receipt?.planes).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ planeId: 'materials', state: 'normalized' }),
              expect.objectContaining({ planeId: 'material-layer-facet-fields', state: 'lost' }),
              expect.objectContaining({ planeId: 'material-shader-parameters', state: 'lost' }),
            ]),
          )
          expect(JSON.stringify(receipt)).not.toMatch(/(?:[A-Za-z]:[\\/]|file:\/\/|\\\\)/u)
        } finally {
          await nested.result.session.dispose()
        }
        console.info(
          `[sc2-live] ${MODEL_PATH}: bytes=${bytes.byteLength}, sha256=${digest}, ` +
            `MATM=${decoded.materials.length}, MAT_=${decoded.standardMaterials}, ` +
            `LAYR=${decoded.decodedLayers}, resourceLinks=${decoded.linkedLayers}, ` +
            `BAT-bindings=${decoded.primitiveBindings.length}`,
        )
        proveMaterial(
          'the pinned CASC sample publishes 5 MATM identities, 65 layer slots, 14 resource links, and 2 primitive bindings',
        )
      } finally {
        await casc.session.dispose()
      }
    },
    300_000,
  )
})
