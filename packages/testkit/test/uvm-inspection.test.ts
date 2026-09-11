import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { operationId } from '@modkit/core'
import {
  revisionId,
  type ModelSceneSource,
  type ModelSkeletonSource,
  type ModelAnimationSource,
  type TreeDataSource,
} from '@modkit/sdk'
import * as kit from '@modkit/codec-kit'
import * as sources from '@modkit/codec-kit/model/sources'
import { createProjectionReceipt } from '@modkit/codec-kit/projection'
import { readUvmContainer } from '../../uv/src/model/container.js'
import { createUvmInspection, type UvmInspectionOptions } from '../../scene/src/uvm/inspection.js'

const fixtureUrl = new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url)
const options: UvmInspectionOptions = {
  adapter: { id: 'test/uvm-inspection', version: '1.0.0' },
  subjectRevision: revisionId('content-hash.sha256:inspection-fixture'),
  bytesRead: 0n,
  budget: { maxDepth: 128, maxNodes: 100_000, maxScalarBytes: 1_000_000, maxJsonBytes: 2_000_000 },
}
async function fixture() {
  const bytes = Buffer.from(await readFile(fixtureUrl, 'utf8'), 'base64')
  return {
    container: readUvmContainer(bytes),
    options: { ...options, bytesRead: BigInt(bytes.length) },
  }
}
function source<T>(inspection: kit.InspectionResult, key: string): T {
  const value = inspection.dataSources?.[key]
  if (value === undefined) throw new Error(`missing ${key}`)
  return value as T
}

it('keeps existing codec-kit factories as re-exports of the portable implementations', () => {
  for (const key of Object.keys(sources) as (keyof typeof sources)[])
    expect(kit[key]).toBe(sources[key])
  expect(kit.createProjectionReceipt).toBe(createProjectionReceipt)
})

it('publishes the M3-derived UVM through one common inspection without a codec or host', async () => {
  const { container, options } = await fixture()
  const inspection = createUvmInspection(container, options)
  expect(inspection.summary).toMatchObject({ format: 'uvm', meshes: 1, primitives: 1, nodes: 2 })
  expect(inspection.handlers).toBeUndefined()
  expect(inspection.operationStates).toBeUndefined()
  expect(inspection.projectionReceipt).toMatchObject({
    adapter: options.adapter,
    subjectRevision: options.subjectRevision,
    basis: { handedness: 'right', upAxis: 'y', unit: 'meter' },
    evidence: [
      { kind: 'observed', bytesRead: options.bytesRead },
      { kind: 'declared', source: 'UV_provenance' },
      {
        kind: 'declared',
        source: 'UV_provenance',
        statement: 'the producing importer recorded 1 loss(es) in UV_provenance.lost',
      },
    ],
  })
  const model = source<ModelSceneSource>(inspection, 'common.view/model-scene-source')
  const skeleton = source<ModelSkeletonSource>(inspection, 'common.view/model-skeleton-source')
  const animations = source<ModelAnimationSource>(inspection, 'common.view/model-animation-source')
  expect(await model.info()).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
  expect((await skeleton.bindings({ limit: 10 })).items).toMatchObject([
    { boneName: 'Root', nodeId: 'node-1' },
  ])
  expect((await animations.clips({ limit: 10 })).items).toMatchObject([
    { name: 'Stand', durationSeconds: 1, looping: true },
  ])
  if (model.primitive === undefined) throw new Error('missing decoded primitive reader')
  container.binary.fill(0xff)
  const first = await model.primitive('mesh-0-primitive-0', { maxBytes: 1000 })
  expect(first.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  first.positions.fill(99)
  expect((await model.primitive('mesh-0-primitive-0', { maxBytes: 1000 })).positions[0]).toBe(0)
  await expect(model.primitive('mesh-0-primitive-0', { maxBytes: 1 })).rejects.toThrow(
    'maxBytes budget',
  )
})

it('exposes complete BlizzardM3 JSON with editing opt-in and keeps the tree snapshot owned', async () => {
  const { container, options } = await fixture()
  const native = { sections: [{ 'future/key': 4_294_967_295 }] }
  const document = { ...container.document, extras: { BlizzardM3: native } }
  const readonlyInspection = createUvmInspection({ ...container, document }, options)
  const editableInspection = createUvmInspection(
    { ...container, document },
    {
      ...options,
      treeWrite: {
        operation: operationId('edit.field', { contributionId: 'test/uvm-inspection' }),
      },
    },
  )
  const node = { id: 'json:/extras/BlizzardM3/sections/0/future~1key', hasChildren: false }
  const original = native.sections[0]
  if (original === undefined) throw new Error('missing section')
  original['future/key'] = 0
  expect(
    await source<TreeDataSource>(readonlyInspection, 'common.view/tree-data-source').facts(node),
  ).toMatchObject({ value: 4_294_967_295 })
  expect(
    await source<TreeDataSource>(readonlyInspection, 'common.view/tree-data-source').facts(node),
  ).not.toHaveProperty('editable')
  expect(
    await source<TreeDataSource>(editableInspection, 'common.view/tree-data-source').facts(node),
  ).toMatchObject({
    value: 4_294_967_295,
    semanticPath: ['extras', 'BlizzardM3', 'sections', '0', 'future/key'],
    editable: { write: { operation: 'edit.field' } },
  })
})

it('rejects invalid profiles, exhausted budgets and cancellation before returning inspection', async () => {
  const { container, options } = await fixture()
  expect(() =>
    createUvmInspection(
      { ...container, document: { ...container.document, asset: { version: '3.0' } } },
      options,
    ),
  ).toThrow('UVM asset.version must be 2.0')
  for (const key of ['maxNodes', 'maxDepth', 'maxScalarBytes', 'maxJsonBytes'] as const)
    expect(() =>
      createUvmInspection(container, { ...options, budget: { ...options.budget, [key]: 0 } }),
    ).toThrow()
  expect(() => createUvmInspection(container, { ...options, bytesRead: -1n })).toThrow(
    'invalid UVM inspection byte count',
  )
  const controller = new AbortController()
  controller.abort(new Error('cancel inspection'))
  expect(() => createUvmInspection(container, { ...options, signal: controller.signal })).toThrow(
    'cancel inspection',
  )
})
