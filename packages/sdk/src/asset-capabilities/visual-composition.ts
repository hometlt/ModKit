/**
 * Format-neutral, visual-only composition of one world scene and one model scene.
 *
 * The document never owns or rewrites either source subject. It only records exact source
 * snapshots, shared data-source bindings and a separate overlay-placement layer. Runtime and
 * native-export compatibility are deliberately outside this contract.
 */

import { isSegment } from '@modkitx-x3/core'
import type { ProjectionBasis } from './uv-projection.js'
import {
  bindingId,
  definePresentationPlan,
  presentationSlotId,
  type BindingId,
  type KnownBindingRef,
  type PresentationPlan,
  type PresentationSlot,
  type PresentationSlotId,
} from './presentation.js'
import type { RevisionId } from './types.js'
import { snapshotJsonWireData } from '../manifest/validate.js'

export const MIXED_VISUAL_STAGE_ID: PresentationSlotId = presentationSlotId('mixed-visual')
export const MIXED_VISUAL_WORLD_BINDING_ID: BindingId = bindingId('mixed-world')
export const MIXED_VISUAL_MODEL_BINDING_ID: BindingId = bindingId('mixed-model')

export interface VisualSubjectSnapshot {
  readonly subjectUri: string
  readonly revision: RevisionId
}

export type MixedVisualSource = Readonly<{
  readonly sourceId: string
  /** Opaque grouping key supplied by the owner; common code never interprets it as a game id. */
  readonly originGroup: string
  readonly subject: VisualSubjectSnapshot
}> &
  (
    | Readonly<{
        readonly role: 'world-base'
        readonly binding: KnownBindingRef<'common.view/world-scene-source', 1>
      }>
    | Readonly<{
        readonly role: 'model-overlay'
        readonly binding: KnownBindingRef<'common.view/model-scene-source', 1>
      }>
  )

export interface VisualAssetProvenance {
  /** Stable identity in the owning source; never replaced by a composition-local identity. */
  readonly sourceIdentity: string
  readonly subject: VisualSubjectSnapshot
  readonly originUri: string
  readonly logicalPath?: string
  readonly contentDigest?: `sha256:${string}`
}

export type VisualAssetLicense =
  | Readonly<{
      readonly state: 'declared'
      /** SPDX expression or an equally explicit owner-supplied license identifier. */
      readonly expression: string
      readonly notice?: string
    }>
  | Readonly<{
      readonly state: 'unknown'
      readonly reason: string
    }>

export type VisualAssetRedistribution =
  | Readonly<{
      readonly state: 'allowed'
      readonly basis: string
      readonly attributionRequired: boolean
    }>
  | Readonly<{
      readonly state: 'restricted' | 'unknown'
      readonly reason: string
    }>

export interface VisualAssetPolicy {
  readonly provenance: VisualAssetProvenance
  readonly license: VisualAssetLicense
  readonly redistribution: VisualAssetRedistribution
}

export interface MixedVisualObject extends VisualAssetPolicy {
  readonly objectId: string
  readonly sourceId: string
  readonly role: 'world-base' | 'model-overlay'
  /** Resource records keep their own policy and may therefore be redistributed differently. */
  readonly resourceIds: readonly string[]
}

export interface MixedVisualResource extends VisualAssetPolicy {
  readonly resourceId: string
  readonly sourceId: string
  readonly logicalId: string
}

export interface VisualCoordinateFrame {
  readonly coordinateSpaceId: string
  readonly basis: ProjectionBasis
  /** Origin in this frame's own units and axis order. */
  readonly origin: readonly [number, number, number]
}

export interface VisualSignedAxisMapping {
  readonly sourceAxis: 'x' | 'y' | 'z'
  readonly direction: 1 | -1
}

/** Exact, inspectable affine receipt used for display; no hidden unit or basis inference exists. */
export interface VisualTransformReceipt {
  readonly schemaVersion: 1
  readonly source: VisualCoordinateFrame
  readonly target: VisualCoordinateFrame
  readonly axes: Readonly<{
    readonly x: VisualSignedAxisMapping
    readonly y: VisualSignedAxisMapping
    readonly z: VisualSignedAxisMapping
  }>
  /** Positive per-target-axis scale after axis/sign mapping. */
  readonly scale: readonly [number, number, number]
  /** Target-frame translation, separate from both preserved source and target origins. */
  readonly translation: readonly [number, number, number]
  readonly evidence: Readonly<{
    readonly kind: 'owner-declared' | 'adapter-qualified'
    readonly reference: string
    readonly receiptDigest?: `sha256:${string}`
  }>
}

export interface MixedVisualOverlayPlacement {
  readonly placementId: string
  readonly objectId: string
  readonly transform: VisualTransformReceipt
}

export interface MixedVisualCompatibilityReport {
  readonly mode: 'visual-only'
  readonly definitionCompatible: false
  readonly runtimeCompatible: false
  readonly nativeExportable: false
  readonly reasons: readonly string[]
  readonly requiredEvidence: readonly ['definition-mapping', 'runtime-conformance', 'native-export']
}

export interface MixedVisualCompositionDocument {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly worldFrame: VisualCoordinateFrame
  readonly sources: readonly [MixedVisualSource, MixedVisualSource]
  readonly objects: readonly MixedVisualObject[]
  readonly resources: readonly MixedVisualResource[]
  /** Overlay placements remain separate from both immutable source subjects. */
  readonly overlayPlacements: readonly MixedVisualOverlayPlacement[]
  readonly compatibility: MixedVisualCompatibilityReport
}

export interface MixedVisualPresentationSlot extends PresentationSlot {
  readonly slotId: typeof MIXED_VISUAL_STAGE_ID
  readonly kind: 'stage'
  readonly composition: MixedVisualCompositionDocument
}

export interface MixedVisualWorkspace {
  readonly document: MixedVisualCompositionDocument
  readonly presentation: PresentationPlan<readonly [MixedVisualPresentationSlot]>
}

export interface MixedVisualWorkspaceInput {
  readonly workspaceId: string
  readonly workspaceUri: string
  readonly workspaceRevision: RevisionId
  readonly worldFrame: VisualCoordinateFrame
  readonly world: Omit<Extract<MixedVisualSource, { readonly role: 'world-base' }>, 'binding'> &
    Readonly<{ binding?: KnownBindingRef<'common.view/world-scene-source', 1> }>
  readonly model: Omit<Extract<MixedVisualSource, { readonly role: 'model-overlay' }>, 'binding'> &
    Readonly<{ binding?: KnownBindingRef<'common.view/model-scene-source', 1> }>
  readonly objects: readonly MixedVisualObject[]
  readonly resources: readonly MixedVisualResource[]
  readonly overlayPlacements: readonly MixedVisualOverlayPlacement[]
}

function nonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`)
}

function finiteTuple(value: readonly number[], label: string, positive = false): void {
  if (value.length !== 3 || value.some(item => !Number.isFinite(item) || (positive && item <= 0))) {
    throw new TypeError(`${label} must contain three ${positive ? 'positive ' : ''}finite numbers`)
  }
}

function basis(value: ProjectionBasis, label: string): void {
  if (value.unit === 'meter') {
    if (value.sourceUnit !== undefined) {
      throw new TypeError(`${label}.sourceUnit is only valid for source-unit coordinates`)
    }
  } else {
    nonEmpty(value.sourceUnit ?? '', `${label}.sourceUnit`)
  }
  if (
    value.metersPerUnit !== undefined &&
    (!Number.isFinite(value.metersPerUnit) || value.metersPerUnit <= 0)
  ) {
    throw new TypeError(`${label}.metersPerUnit must be positive and finite`)
  }
  if (
    value.unitsPerCell !== undefined &&
    (!Number.isFinite(value.unitsPerCell) || value.unitsPerCell <= 0)
  ) {
    throw new TypeError(`${label}.unitsPerCell must be positive and finite`)
  }
}

function frame(value: VisualCoordinateFrame, label: string): void {
  nonEmpty(value.coordinateSpaceId, `${label}.coordinateSpaceId`)
  basis(value.basis, `${label}.basis`)
  finiteTuple(value.origin, `${label}.origin`)
}

function subject(value: VisualSubjectSnapshot, label: string): void {
  nonEmpty(value.subjectUri, `${label}.subjectUri`)
  nonEmpty(value.revision, `${label}.revision`)
}

function digest(value: string | undefined, label: string): void {
  if (value !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`)
  }
}

function policy(value: VisualAssetPolicy, label: string): void {
  nonEmpty(value.provenance.sourceIdentity, `${label}.provenance.sourceIdentity`)
  subject(value.provenance.subject, `${label}.provenance.subject`)
  nonEmpty(value.provenance.originUri, `${label}.provenance.originUri`)
  digest(value.provenance.contentDigest, `${label}.provenance.contentDigest`)
  if (value.license.state === 'declared')
    nonEmpty(value.license.expression, `${label}.license.expression`)
  else nonEmpty(value.license.reason, `${label}.license.reason`)
  if (value.redistribution.state === 'allowed')
    nonEmpty(value.redistribution.basis, `${label}.redistribution.basis`)
  else nonEmpty(value.redistribution.reason, `${label}.redistribution.reason`)
}

function sameSubject(left: VisualSubjectSnapshot, right: VisualSubjectSnapshot): boolean {
  return left.subjectUri === right.subjectUri && left.revision === right.revision
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameFrame(left: VisualCoordinateFrame, right: VisualCoordinateFrame): boolean {
  return sameJson(left, right)
}

function validateTransform(value: VisualTransformReceipt, worldFrame: VisualCoordinateFrame): void {
  if (value.schemaVersion !== 1) throw new TypeError('overlay transform schemaVersion must be 1')
  frame(value.source, 'overlay transform source')
  frame(value.target, 'overlay transform target')
  if (!sameFrame(value.target, worldFrame)) {
    throw new TypeError('overlay transform target must exactly match the workspace world frame')
  }
  const sourceAxes = Object.values(value.axes).map(item => item.sourceAxis)
  if (new Set(sourceAxes).size !== 3) {
    throw new TypeError('overlay transform must map each source axis exactly once')
  }
  const indices = sourceAxes.map(axis => (axis === 'x' ? 0 : axis === 'y' ? 1 : 2))
  let inversions = 0
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      if ((indices[left] as number) > (indices[right] as number)) inversions += 1
    }
  }
  const permutationDirection = inversions % 2 === 0 ? 1 : -1
  const mappedDirection =
    permutationDirection * value.axes.x.direction * value.axes.y.direction * value.axes.z.direction
  const expectedDirection = value.source.basis.handedness === value.target.basis.handedness ? 1 : -1
  if (mappedDirection !== expectedDirection) {
    throw new TypeError('overlay transform axis directions do not preserve the declared handedness')
  }
  finiteTuple(value.scale, 'overlay transform scale', true)
  finiteTuple(value.translation, 'overlay transform translation')
  nonEmpty(value.evidence.reference, 'overlay transform evidence reference')
  digest(value.evidence.receiptDigest, 'overlay transform evidence receiptDigest')
}

function validateDocument(document: MixedVisualCompositionDocument): void {
  if (document.schemaVersion !== 1) throw new TypeError('mixed visual schemaVersion must be 1')
  nonEmpty(document.workspaceId, 'workspaceId')
  frame(document.worldFrame, 'worldFrame')
  if (document.sources.length !== 2) throw new TypeError('mixed visual workspace needs two sources')
  const world = document.sources.find(source => source.role === 'world-base')
  const model = document.sources.find(source => source.role === 'model-overlay')
  if (world === undefined || model === undefined) {
    throw new TypeError('mixed visual workspace needs one world source and one model source')
  }
  if (world.originGroup === model.originGroup) {
    throw new TypeError('mixed visual sources must declare different origin groups')
  }
  if (sameSubject(world.subject, model.subject)) {
    throw new TypeError('mixed visual sources must retain two distinct subject snapshots')
  }
  for (const source of document.sources) {
    if (!isSegment(source.sourceId))
      throw new TypeError(`invalid mixed visual source id: ${source.sourceId}`)
    nonEmpty(source.originGroup, `source ${source.sourceId} originGroup`)
    subject(source.subject, `source ${source.sourceId} subject`)
  }
  if (world.binding.contract !== 'common.view/world-scene-source' || world.binding.major !== 1) {
    throw new TypeError('world source must use common.view/world-scene-source@1')
  }
  if (model.binding.contract !== 'common.view/model-scene-source' || model.binding.major !== 1) {
    throw new TypeError('model source must use common.view/model-scene-source@1')
  }
  if (!isSegment(world.binding.bindingId) || !isSegment(model.binding.bindingId)) {
    throw new TypeError('mixed visual binding ids must be portable segments')
  }
  if (world.binding.bindingId === model.binding.bindingId) {
    throw new TypeError('mixed visual world/model binding ids must be distinct')
  }

  const sourceIds = new Set(document.sources.map(source => source.sourceId))
  if (sourceIds.size !== document.sources.length)
    throw new TypeError('mixed visual source ids must be unique')
  const resources = new Map<string, MixedVisualResource>()
  for (const resource of document.resources) {
    if (!isSegment(resource.resourceId))
      throw new TypeError(`invalid mixed visual resource id: ${resource.resourceId}`)
    if (resources.has(resource.resourceId))
      throw new TypeError(`duplicate mixed visual resource id: ${resource.resourceId}`)
    const source = document.sources.find(candidate => candidate.sourceId === resource.sourceId)
    if (source === undefined) throw new TypeError(`unknown resource source: ${resource.sourceId}`)
    nonEmpty(resource.logicalId, `resource ${resource.resourceId} logicalId`)
    if (!sameSubject(resource.provenance.subject, source.subject)) {
      throw new TypeError(
        `resource ${resource.resourceId} provenance does not match its source snapshot`,
      )
    }
    policy(resource, `resource ${resource.resourceId}`)
    resources.set(resource.resourceId, resource)
  }

  const objects = new Map<string, MixedVisualObject>()
  for (const object of document.objects) {
    if (!isSegment(object.objectId))
      throw new TypeError(`invalid mixed visual object id: ${object.objectId}`)
    if (objects.has(object.objectId))
      throw new TypeError(`duplicate mixed visual object id: ${object.objectId}`)
    const source = document.sources.find(candidate => candidate.sourceId === object.sourceId)
    if (source === undefined) throw new TypeError(`unknown object source: ${object.sourceId}`)
    if (source.role !== object.role)
      throw new TypeError(`object ${object.objectId} role does not match its source`)
    if (!sameSubject(object.provenance.subject, source.subject)) {
      throw new TypeError(`object ${object.objectId} provenance does not match its source snapshot`)
    }
    if (new Set(object.resourceIds).size !== object.resourceIds.length) {
      throw new TypeError(`object ${object.objectId} resource ids must be unique`)
    }
    for (const resourceId of object.resourceIds) {
      const resource = resources.get(resourceId)
      if (resource === undefined)
        throw new TypeError(`object ${object.objectId} references unknown resource ${resourceId}`)
      if (resource.sourceId !== object.sourceId) {
        throw new TypeError(`object ${object.objectId} cannot claim a resource from another source`)
      }
    }
    policy(object, `object ${object.objectId}`)
    objects.set(object.objectId, object)
  }
  if (![...objects.values()].some(object => object.role === 'world-base')) {
    throw new TypeError('mixed visual workspace needs a world-base object')
  }
  if (![...objects.values()].some(object => object.role === 'model-overlay')) {
    throw new TypeError('mixed visual workspace needs a model-overlay object')
  }

  const placementIds = new Set<string>()
  for (const placement of document.overlayPlacements) {
    if (!isSegment(placement.placementId))
      throw new TypeError(`invalid overlay placement id: ${placement.placementId}`)
    if (placementIds.has(placement.placementId))
      throw new TypeError(`duplicate overlay placement id: ${placement.placementId}`)
    const object = objects.get(placement.objectId)
    if (object?.role !== 'model-overlay') {
      throw new TypeError(
        `overlay placement ${placement.placementId} must reference a model-overlay object`,
      )
    }
    validateTransform(placement.transform, document.worldFrame)
    placementIds.add(placement.placementId)
  }
  const placedObjects = new Set(document.overlayPlacements.map(placement => placement.objectId))
  for (const object of objects.values()) {
    if (object.role === 'model-overlay' && !placedObjects.has(object.objectId)) {
      throw new TypeError(`model-overlay object ${object.objectId} has no separate placement`)
    }
  }
  if (
    document.compatibility.mode !== 'visual-only' ||
    document.compatibility.definitionCompatible !== false ||
    document.compatibility.runtimeCompatible !== false ||
    document.compatibility.nativeExportable !== false
  ) {
    throw new TypeError('mixed visual compatibility must remain visual-only')
  }
  if (
    document.compatibility.reasons.length < 3 ||
    document.compatibility.reasons.some(reason => reason.trim().length === 0) ||
    !sameJson(document.compatibility.requiredEvidence, [
      'definition-mapping',
      'runtime-conformance',
      'native-export',
    ])
  ) {
    throw new TypeError('mixed visual compatibility must name every missing promotion evidence')
  }
}

/** Creates one immutable, game-neutral composition and its dynamic shared-viewer plan. */
export function defineMixedVisualWorkspace(
  input: MixedVisualWorkspaceInput,
): Readonly<MixedVisualWorkspace> {
  const world: MixedVisualSource = {
    ...input.world,
    binding:
      input.world.binding ??
      ({
        bindingId: MIXED_VISUAL_WORLD_BINDING_ID,
        contract: 'common.view/world-scene-source',
        major: 1,
      } as const),
  }
  const model: MixedVisualSource = {
    ...input.model,
    binding:
      input.model.binding ??
      ({
        bindingId: MIXED_VISUAL_MODEL_BINDING_ID,
        contract: 'common.view/model-scene-source',
        major: 1,
      } as const),
  }
  const document: MixedVisualCompositionDocument = {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    worldFrame: input.worldFrame,
    sources: [world, model],
    objects: input.objects,
    resources: input.resources,
    overlayPlacements: input.overlayPlacements,
    compatibility: {
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
    },
  }
  validateDocument(document)
  const frozenDocument = snapshotJsonWireData(document) as MixedVisualCompositionDocument
  const slot = {
    slotId: MIXED_VISUAL_STAGE_ID,
    kind: 'stage',
    contributionId: 'org.modkitx.ui/mixed-visual-stage',
    extensionId: 'org.modkitx/ui',
    priority: 390,
    singletonGroup: 'center-stage',
    bindings: [world.binding, model.binding],
    composition: frozenDocument,
  } as const satisfies MixedVisualPresentationSlot
  const presentation = definePresentationPlan({
    subjectUri: input.workspaceUri,
    revision: input.workspaceRevision,
    slots: [slot] as const,
    unsatisfied: [],
    activeStage: MIXED_VISUAL_STAGE_ID,
    alternateStages: [],
  })
  return Object.freeze({ document: frozenDocument, presentation })
}

/** Runtime guard used by every viewer host; it has no publisher, game or format routing table. */
export function isMixedVisualPresentationSlot(
  slot: PresentationSlot,
): slot is MixedVisualPresentationSlot {
  const candidate = slot as PresentationSlot & {
    readonly composition?: MixedVisualCompositionDocument
  }
  if (slot.slotId !== MIXED_VISUAL_STAGE_ID || candidate.composition === undefined) return false
  try {
    validateDocument(candidate.composition)
    const expectedBindings = candidate.composition.sources.map(source => source.binding)
    return (
      slot.kind === 'stage' &&
      slot.bindings.length === expectedBindings.length &&
      slot.bindings.every((binding, index) => {
        const expected = expectedBindings[index]
        return (
          expected !== undefined &&
          'contract' in binding &&
          binding.bindingId === expected.bindingId &&
          binding.contract === expected.contract &&
          binding.major === expected.major
        )
      })
    )
  } catch {
    return false
  }
}
