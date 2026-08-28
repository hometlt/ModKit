import { describe, expect, it } from 'vitest'
import {
  defineMixedVisualWorkspace,
  isMixedVisualPresentationSlot,
  revisionId,
  type MixedVisualWorkspaceInput,
  type VisualAssetPolicy,
  type VisualCoordinateFrame,
  type VisualTransformReceipt,
} from '../src/index.js'

const worldRevision = revisionId('content-hash.sha256:world-snapshot')
const modelRevision = revisionId('content-hash.sha256:model-snapshot')
const workspaceRevision = revisionId('content-hash.sha256:mixed-workspace')

const worldFrame: VisualCoordinateFrame = Object.freeze({
  coordinateSpaceId: 'uvw-canonical',
  basis: Object.freeze({
    handedness: 'right',
    upAxis: 'y',
    forwardAxis: '+z',
    unit: 'meter',
    unitsPerCell: 1,
  }),
  origin: Object.freeze([0, 0, 0] as const),
})

const transform: VisualTransformReceipt = Object.freeze({
  schemaVersion: 1,
  source: Object.freeze({
    coordinateSpaceId: 'model-native',
    basis: Object.freeze({
      handedness: 'left',
      upAxis: 'z',
      forwardAxis: '+y',
      unit: 'source-unit',
      sourceUnit: 'publisher-model-unit',
    }),
    origin: Object.freeze([0, 0, 0] as const),
  }),
  target: worldFrame,
  axes: Object.freeze({
    x: Object.freeze({ sourceAxis: 'x', direction: 1 as const }),
    y: Object.freeze({ sourceAxis: 'z', direction: 1 as const }),
    z: Object.freeze({ sourceAxis: 'y', direction: 1 as const }),
  }),
  scale: Object.freeze([0.01, 0.01, 0.01] as const),
  translation: Object.freeze([12, 0, 24] as const),
  evidence: Object.freeze({
    kind: 'adapter-qualified',
    reference: 'projection receipt fixture',
    receiptDigest: `sha256:${'a'.repeat(64)}` as const,
  }),
})

function policy(subjectUri: string, revision: ReturnType<typeof revisionId>): VisualAssetPolicy {
  return {
    provenance: {
      sourceIdentity: `${subjectUri}#root`,
      subject: { subjectUri, revision },
      originUri: subjectUri,
      contentDigest: `sha256:${'b'.repeat(64)}`,
    },
    license: { state: 'unknown', reason: 'game asset terms require owner review' },
    redistribution: { state: 'restricted', reason: 'local inspection only' },
  }
}

function input(): MixedVisualWorkspaceInput {
  const worldUri = 'subject://priority-a/map'
  const modelUri = 'subject://priority-b/model'
  return {
    workspaceId: 'mixed-proof',
    workspaceUri: 'workspace://mixed-proof',
    workspaceRevision,
    worldFrame,
    world: {
      sourceId: 'world-source',
      originGroup: 'priority-family-a',
      role: 'world-base',
      subject: { subjectUri: worldUri, revision: worldRevision },
    },
    model: {
      sourceId: 'model-source',
      originGroup: 'priority-family-b',
      role: 'model-overlay',
      subject: { subjectUri: modelUri, revision: modelRevision },
    },
    objects: [
      {
        objectId: 'world-root',
        sourceId: 'world-source',
        role: 'world-base',
        resourceIds: ['terrain-resource'],
        ...policy(worldUri, worldRevision),
      },
      {
        objectId: 'model-root',
        sourceId: 'model-source',
        role: 'model-overlay',
        resourceIds: ['model-resource'],
        ...policy(modelUri, modelRevision),
      },
    ],
    resources: [
      {
        resourceId: 'terrain-resource',
        sourceId: 'world-source',
        logicalId: 'terrain',
        ...policy(worldUri, worldRevision),
      },
      {
        resourceId: 'model-resource',
        sourceId: 'model-source',
        logicalId: 'geometry',
        ...policy(modelUri, modelRevision),
      },
    ],
    overlayPlacements: [{ placementId: 'model-placement', objectId: 'model-root', transform }],
  }
}

describe('mixed visual composition contract', () => {
  it('keeps source snapshots unchanged and builds an exact two-source PresentationPlan', () => {
    const request = input()
    const before = JSON.stringify(request)
    const workspace = defineMixedVisualWorkspace(request)
    expect(JSON.stringify(request)).toBe(before)
    expect(workspace.document.sources.map(source => source.subject)).toEqual([
      request.world.subject,
      request.model.subject,
    ])
    expect(workspace.presentation).toMatchObject({
      subjectUri: request.workspaceUri,
      revision: request.workspaceRevision,
      activeStage: 'mixed-visual',
      alternateStages: [],
    })
    const slot = workspace.presentation.slots[0]
    expect(slot?.bindings).toEqual([
      {
        bindingId: 'mixed-world',
        contract: 'common.view/world-scene-source',
        major: 1,
      },
      {
        bindingId: 'mixed-model',
        contract: 'common.view/model-scene-source',
        major: 1,
      },
    ])
    expect(slot === undefined ? false : isMixedVisualPresentationSlot(slot)).toBe(true)
    expect(Object.isFrozen(workspace.document)).toBe(true)
    expect(Object.isFrozen(workspace.presentation)).toBe(true)
  })

  it('keeps placements separate and carries policy on every object and resource', () => {
    const workspace = defineMixedVisualWorkspace(input()).document
    expect(workspace.overlayPlacements).toHaveLength(1)
    expect(workspace.objects).toHaveLength(2)
    expect(workspace.resources).toHaveLength(2)
    for (const asset of [...workspace.objects, ...workspace.resources]) {
      expect(asset.provenance).toMatchObject({ originUri: expect.any(String) })
      expect(asset.license).toMatchObject({ state: 'unknown' })
      expect(asset.redistribution).toMatchObject({ state: 'restricted' })
    }
    expect(workspace.overlayPlacements[0]?.transform).toMatchObject({
      source: {
        basis: { handedness: 'left', upAxis: 'z', unit: 'source-unit' },
        origin: [0, 0, 0],
      },
      target: {
        basis: { handedness: 'right', upAxis: 'y', unit: 'meter' },
        origin: [0, 0, 0],
      },
      scale: [0.01, 0.01, 0.01],
      translation: [12, 0, 24],
    })
  })

  it('never upgrades a visual composition into definitions, runtime or native export', () => {
    expect(defineMixedVisualWorkspace(input()).document.compatibility).toEqual({
      mode: 'visual-only',
      definitionCompatible: false,
      runtimeCompatible: false,
      nativeExportable: false,
      reasons: [
        'visual placement does not prove definition compatibility',
        'no runtime conformance evidence is attached',
        'no native writer or export fidelity evidence is attached',
      ],
      requiredEvidence: ['definition-mapping', 'runtime-conformance', 'native-export'],
    })
  })

  it('fails closed on same-origin mixing, transform inference and provenance/resource drift', () => {
    const sameOrigin = input()
    expect(() =>
      defineMixedVisualWorkspace({
        ...sameOrigin,
        model: { ...sameOrigin.model, originGroup: sameOrigin.world.originGroup },
      }),
    ).toThrow(/different origin groups/u)

    const inferredAxes = input()
    const placement = inferredAxes.overlayPlacements[0]
    if (placement === undefined) throw new Error('fixture overlay placement is missing')
    expect(() =>
      defineMixedVisualWorkspace({
        ...inferredAxes,
        overlayPlacements: [
          {
            ...placement,
            transform: {
              ...transform,
              axes: { ...transform.axes, z: { sourceAxis: 'x', direction: -1 } },
            },
          },
        ],
      }),
    ).toThrow(/each source axis exactly once/u)

    const drifted = input()
    expect(() =>
      defineMixedVisualWorkspace({
        ...drifted,
        objects: drifted.objects.map(object =>
          object.objectId === 'model-root'
            ? {
                ...object,
                provenance: {
                  ...object.provenance,
                  subject: { ...object.provenance.subject, subjectUri: 'subject://wrong' },
                },
              }
            : object,
        ),
      }),
    ).toThrow(/provenance does not match/u)

    const crossSource = input()
    expect(() =>
      defineMixedVisualWorkspace({
        ...crossSource,
        objects: crossSource.objects.map(object =>
          object.objectId === 'model-root'
            ? { ...object, resourceIds: ['terrain-resource'] }
            : object,
        ),
      }),
    ).toThrow(/resource from another source/u)
  })
})
