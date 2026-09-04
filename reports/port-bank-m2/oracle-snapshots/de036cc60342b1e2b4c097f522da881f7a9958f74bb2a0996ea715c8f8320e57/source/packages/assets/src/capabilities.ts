/**
 * Capability (trait) contract v1 — `ASSET_CAPABILITIES.md` sections 2, 3.2, and 4.
 *
 * A capability describes *observable data* in a resolved asset. It is not an extension, not a
 * category, not a UI component name, and never proof that an operation is available: "a trait
 * never implies an operation" (section 3.3) and "no trait implies edit, save, export,
 * execution, or trust" (design rule 4).
 */

/**
 * Every capability identifier defined by `ASSET_CAPABILITIES.md` section 4, in document order.
 * Identifiers are lowercase, dot-namespaced, stable, and versioned independently from codec
 * IDs; new parameters extend a capability compatibly, incompatible meaning takes a new
 * version or ID (section 4).
 */
export const CAPABILITY_IDS = [
  // 4.1 general content
  'content.metadata',
  'content.binary',
  'content.text',
  'content.images',
  'content.fonts',
  'content.styles',
  'content.scripts',
  'content.thumbnails',
  // 4.2 raster, texture, and vector
  'image.raster',
  'image.channels',
  'image.mipmaps',
  'image.subresources',
  'image.compressed-blocks',
  'image.frames',
  'image.palette',
  'image.color-profile',
  'vector.scene',
  'vector.paths',
  'vector.shapes',
  'vector.text',
  'vector.gradients',
  // 4.3 document, table, presentation, and design
  'document.flow',
  'document.pages',
  'document.outline',
  'document.annotations',
  'table.sheets',
  'table.cells',
  'table.formulas',
  'presentation.slides',
  'presentation.masters',
  'design.components',
  'design.constraints',
  // 4.4 structure and projects
  'structure.hierarchy',
  'structure.layers',
  'structure.nodes',
  'structure.timeline',
  'project.editable',
  'project.companions',
  // 4.5 models and scenes
  'model.geometry',
  'model.materials',
  'model.textures',
  'model.skeleton',
  'model.animations',
  'model.lods',
  'scene.objects',
  'scene.cameras',
  'scene.lights',
  'scene.effects',
  // 4.6 audio, video, and time-based media
  'audio.streams',
  'audio.waveform',
  'audio.loop-points',
  'video.streams',
  'video.tracks',
  'media.duration',
  'media.frames',
  'media.seekable',
  'media.interactive-runtime',
  // 4.7 containers and virtual sources
  'container.entries',
  'container.directories',
  'container.nested',
  'container.compression',
  'container.encryption',
  'container.overlay',
  'source.dependencies',
  // 4.8 fonts, code, and semantic game assets
  'font.glyphs',
  'font.metrics',
  'font.character-map',
  'code.source',
  'code.shader',
  'code.node-graph',
  'game.map',
  'game.replay',
  'game.layout',
  'game.localization',
  'game.catalog',
] as const

export type KnownCapabilityId = (typeof CAPABILITY_IDS)[number]

/**
 * A capability ID. The known v1 union keeps editor completion useful while third-party codecs
 * may introduce their own dot-namespaced IDs; `Record<never, never>` is the standard widening
 * trick that stops TypeScript from collapsing the union to `string`.
 */
export type CapabilityId = KnownCapabilityId | (string & Record<never, never>)

export function isKnownCapabilityId(value: string): value is KnownCapabilityId {
  return (CAPABILITY_IDS as readonly string[]).includes(value)
}

/** Capability IDs must stay lowercase and dot-namespaced (`ASSET_CAPABILITIES.md` section 4). */
export function isWellFormedCapabilityId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(value)
}

/**
 * `dependency-required` means the trait exists but needs an optional runtime, companion, or
 * permission that is not currently satisfied; `partial` means it is usable with declared
 * limitations. Both must carry diagnostics (design rule 5).
 */
export type CapabilityState = 'available' | 'partial' | 'disabled' | 'dependency-required'

export interface CapabilityInstance<TParameters = unknown> {
  readonly id: CapabilityId
  readonly version: 1
  readonly state: CapabilityState
  /** Serializable parameters described per capability in section 4's tables. */
  readonly parameters?: TParameters
  /** {@link import('./diagnostics.js').AssetDiagnostic.id} values explaining a non-available state. */
  readonly diagnosticIds?: readonly string[]
}

/**
 * A trait requirement declared by a viewer contribution (`ASSET_CAPABILITIES.md` section 6).
 * `states` defaults to `['available']`, so requiring a degraded trait is always explicit.
 */
export interface CapabilityRequirement {
  readonly id: CapabilityId
  readonly states?: readonly CapabilityState[]
}

const DEFAULT_REQUIRED_STATES: readonly CapabilityState[] = ['available']

export function findCapability(
  traits: readonly CapabilityInstance[],
  id: CapabilityId,
): CapabilityInstance | undefined {
  return traits.find(trait => trait.id === id)
}

/** True when `traits` contains `requirement.id` in one of its accepted states. */
export function satisfiesCapabilityRequirement(
  traits: readonly CapabilityInstance[],
  requirement: CapabilityRequirement,
): boolean {
  const trait = findCapability(traits, requirement.id)
  if (!trait) return false
  return (requirement.states ?? DEFAULT_REQUIRED_STATES).includes(trait.state)
}
