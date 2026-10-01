import { diagnostic, isModkitError } from '@modkit/core'
import {
  revisionId,
  type ArtifactByteSource,
  type CompressedTextureDescriptorV1,
  type InputSearchScope,
  type Lease,
  type RasterImageSource,
  type RasterResourcePort,
  type RasterResourceResult,
  type ResourceBudget,
  type ResourceProvenanceRecord,
  type ResourceSessionPort,
  type RasterRegion,
  type RasterSubresource,
} from '@modkit/sdk'
import { createMemorySource } from '@modkit/vfs'
import { artifactByteSourceFromRandomAccess } from './source-bridge.js'
import { resourceIdParameters } from './resource-id.js'
import type { OpenSubjectResult } from './subject-open.js'
import {
  captureCompressedFormats,
  captureRasterSelection,
  compressedSelectionPlan,
  rasterSelectionPlan,
} from './raster-selection.js'

/** Shared by the candidate's narrowed contexts. Bound only when that candidate becomes the subject. */
export interface SubjectRasterResourceState {
  live: boolean
  reservedBytes: number
  resources?: ResourceSessionPort
}

/**
 * Where a codec wants one role's resources looked for, and in what order.
 *
 * Derived from the requirements the codec's own `planInput` returned, so the search rule for a
 * format lives in that format's codec and nowhere else. A viewer asking for a texture states the
 * role and the name the document spells; it does not get to decide which mounts are searched, or
 * that a model's textures may sit one directory down in `Textures/`.
 */
export interface RasterCompanionRule {
  readonly scopes: readonly InputSearchScope[]
  /** Directories the name is tried under, in order; `''` is the name on its own. */
  readonly directories: readonly string[]
  /**
   * Extensions the game loads in place of the one a document spells (`.dds` for a `.tga` a Grey Goo
   * model names), from the codec's patterns (`…/*.dds`, `…/X.dds`); tried after the document's own.
   */
  readonly extensions?: readonly string[]
}

/**
 * The spellings of one logical id, in the order the codec's rule wants them tried.
 *
 * The id as the document spells it comes first: a layout the format preserved is the answer when
 * it is there. Everything after it re-files the *name* — a model carried out of its mod keeps
 * naming `Assets/Textures/Foo.dds` while its textures now sit beside it, or one folder down.
 */
function rasterSpellings(logicalId: string, rule: RasterCompanionRule | undefined): string[] {
  const spellings = [logicalId]
  if (rule === undefined) return spellings
  const name = logicalId.replaceAll('\\', '/').split('/').at(-1) ?? logicalId
  const stem = name.replace(/\.[^.]*$/u, '')
  const names = [
    name,
    ...(rule.extensions ?? [])
      .map(extension => `${stem}${extension}`)
      .filter(other => other.toLowerCase() !== name.toLowerCase()),
  ]
  for (const candidate of names)
    for (const directory of rule.directories) {
      const spelling = directory === '' ? candidate : `${directory}/${candidate}`
      if (!spellings.includes(spelling)) spellings.push(spelling)
    }
  return spellings
}

export interface SubjectRasterResourceOptions {
  readonly state: SubjectRasterResourceState
  readonly budget: ResourceBudget
  readonly isAuthorized: () => boolean
  /** The opened codec's own search rule per role; absent when it planned no companions. */
  readonly companionRule?: (role: string) => RasterCompanionRule | undefined
  /** Ordinary host codec selection under read-only authority; not supplied by the extension. */
  readonly open: (
    source: ArtifactByteSource,
    hint: { path?: string; mediaType?: string },
    signal?: AbortSignal,
  ) => Promise<OpenSubjectResult>
}

/**
 * A codec's compressed descriptor, checked against the plan and copied into host-owned bytes: one
 * plane, level 0 the planned level's size, each level the next smaller one, blocks of the stated
 * layout, no more than the budget. Undefined when the codec answered anything else.
 */
function ownedCompressedTexture(
  texture: CompressedTextureDescriptorV1,
  info: { readonly width: number; readonly height: number },
  plan: { readonly mipLevel: number; readonly bytes: number },
  maxBytes: number,
): CompressedTextureDescriptorV1 | undefined {
  const levels = texture?.subresources
  const block = texture?.block
  if (
    !Array.isArray(levels) ||
    levels.length === 0 ||
    typeof texture.format !== 'string' ||
    block === null ||
    typeof block !== 'object' ||
    block.width !== 4 ||
    block.height !== 4 ||
    block.depth !== 1 ||
    (block.bytes !== 8 && block.bytes !== 16)
  )
    return undefined
  let total = 0
  const owned = []
  for (const [index, level] of levels.entries()) {
    const width = Math.max(1, Math.floor(info.width / 2 ** (plan.mipLevel + index)))
    const height = Math.max(1, Math.floor(info.height / 2 ** (plan.mipLevel + index)))
    const bytes = Math.ceil(width / 4) * Math.ceil(height / 4) * block.bytes
    if (
      level === null ||
      typeof level !== 'object' ||
      level.mipLevel !== index ||
      level.layer !== 0 ||
      level.face !== 0 ||
      level.width !== width ||
      level.height !== height ||
      !(level.data instanceof Uint8Array) ||
      level.data.byteLength !== bytes
    )
      return undefined
    total += bytes
    if (total > maxBytes) return undefined
    owned.push(
      Object.freeze({
        mipLevel: index,
        layer: 0,
        face: 0,
        depthSlice: 0,
        width,
        height,
        depth: 1 as const,
        data: level.data.slice(),
      }),
    )
  }
  return Object.freeze({
    schemaVersion: 1,
    format: texture.format,
    dimensions: Object.freeze({ width: owned[0]!.width, height: owned[0]!.height, depth: 1 }),
    mipLevelCount: owned.length,
    layerCount: 1,
    faceCount: 1,
    colorSpace: texture.colorSpace,
    alphaMode: texture.alphaMode,
    block: Object.freeze({ width: 4, height: 4, depth: 1, bytes: block.bytes }),
    subresources: Object.freeze(owned),
    source: Object.freeze({ ...texture.source }),
  })
}

/**
 * What a logical raster id names after its last `#` (resourceIdParameters): a named atlas area
 * (`textures/tex.gaf#region=Metal01`), one frame of a many-frame image (`gi.shp#frame=3`), or both
 * (an area of that frame). A parameter list of other words stays part of the name, as before; a
 * frame that is no nonnegative integer is refused rather than read as a name.
 */
export function rasterIdParameters(
  logicalId: string,
): Readonly<{ name: string; region?: string; frame?: number }> {
  const { name, parameters } = resourceIdParameters(logicalId)
  const keys = Object.keys(parameters)
  if (keys.length === 0 || keys.some(key => key !== 'region' && key !== 'frame'))
    return { name: logicalId }
  const { region, frame } = parameters
  if (region !== undefined && region.length === 0)
    throw new TypeError('raster id region must name an area')
  if (frame !== undefined && !(/^(?:0|[1-9][0-9]*)$/u.test(frame) && Number.isSafeInteger(Number(frame))))
    throw new TypeError('raster id frame must be a nonnegative integer')
  return {
    name,
    ...(region === undefined ? {} : { region }),
    ...(frame === undefined ? {} : { frame: Number(frame) }),
  }
}

export function createSubjectRasterResources(
  options: SubjectRasterResourceOptions,
): RasterResourcePort {
  const refusal = (
    code: string,
    message: string,
    provenance?: ResourceProvenanceRecord,
  ): RasterResourceResult => ({
    state: 'unresolved',
    diagnostics: [diagnostic('warning', code, message)],
    ...(provenance === undefined ? {} : { provenance }),
  })
  return Object.freeze({
    async read(request, signal) {
      signal?.throwIfAborted()
      if (!options.state.live)
        return refusal(
          'x3.host/raster-context-unavailable',
          'Raster resources require a live opened subject.',
        )
      if (!options.isAuthorized())
        return refusal(
          'x3.host/resource-permission-missing',
          'The subject grant does not permit raster resource reads.',
        )
      if (request === null || typeof request !== 'object')
        return refusal('x3.host/raster-request-invalid', 'A raster resource request is required.')
      const requestedBytes = request.maxBytes
      let selection: ReturnType<typeof captureRasterSelection>
      let compressedFormats: ReadonlySet<string>
      const explicitSelection = request.selection !== undefined
      try {
        selection = captureRasterSelection(request.selection)
        compressedFormats = captureCompressedFormats(request.compressedFormats)
      } catch (error) {
        return refusal(
          'x3.host/raster-request-invalid',
          error instanceof Error ? error.message : 'Invalid raster selection',
        )
      }
      // A read that lets the host pick its mip ('fit') is held to what the subject's budget has left
      // instead of refused: the texture comes back at a smaller level rather than not at all.
      const available = options.budget.maxScalarBytes - options.state.reservedBytes
      const maxBytes =
        selection.mipLevel === 'fit' &&
        Number.isSafeInteger(requestedBytes) &&
        requestedBytes > available
          ? available
          : requestedBytes
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        options.state.reservedBytes + maxBytes > options.budget.maxScalarBytes
      )
        return refusal(
          'x3.host/resource-budget-exceeded',
          'Raster reads exceed the subject decoded byte budget.',
        )
      options.state.reservedBytes += maxBytes
      const releases: (() => void | Promise<void>)[] = []
      let provenance: ResourceProvenanceRecord | undefined
      /** A named area of an atlas image (`textures/tex.gaf#region=Metal01`): its pixels only. */
      let atlasRegion: string | undefined
      /** One frame of a many-frame image (`gi.shp#frame=3`): an image of its own, of one frame. */
      let frameOnly: number | undefined
      try {
        let source: ArtifactByteSource
        let hint: { path?: string; mediaType?: string } = {}
        if (request.kind === 'logical') {
          const resources = options.state.resources
          if (resources === undefined)
            return refusal(
              'x3.host/raster-origin-unavailable',
              'The subject has no resource origin.',
            )
          /*
           * The codec's rule, applied to the caller's request.
           *
           * A requirement arrives spelling one name and a scope list the caller guessed at. The
           * codec that opened this subject already said where its own resources live — which
           * scopes, in which order, and under which directories — so that answer replaces the
           * guess. A spelling that carries a directory is matched as a path, which is why trying
           * `Textures/Foo.dds` after `Foo.dds` finds the copy one level down that a bare-name
           * sweep of the model's own directory never sees.
           */
          const rule = options.companionRule?.(request.requirement.role)
          let parameters: ReturnType<typeof rasterIdParameters>
          try {
            parameters = rasterIdParameters(request.requirement.logicalId)
          } catch (error) {
            return refusal(
              'x3.host/raster-request-invalid',
              error instanceof Error ? error.message : 'Invalid raster id parameters.',
            )
          }
          atlasRegion = parameters.region
          frameOnly = parameters.frame
          if (frameOnly !== undefined && (selection.frame ?? 0) !== 0)
            return refusal(
              'x3.host/raster-selection-invalid',
              'The resource names one frame of its image: it has no other frame to select.',
            )
          const asked =
            parameters.name === request.requirement.logicalId
              ? request.requirement
              : { ...request.requirement, logicalId: parameters.name }
          const requirement = rule === undefined ? asked : { ...asked, scopes: rule.scopes }
          const spellings = rasterSpellings(requirement.logicalId, rule)
          let resolution = await resources.resolve(requirement, signal)
          for (const spelling of spellings.slice(1)) {
            if (resolution.state === 'resolved') break
            signal?.throwIfAborted()
            resolution = await resources.resolve({ ...requirement, logicalId: spelling }, signal)
          }
          provenance = resolution.provenance
          if (resolution.state === 'unresolved')
            return { state: 'unresolved', diagnostics: [resolution.diagnostic], provenance }
          releases.push(() => resolution.lease.release())
          if (resolution.lease.value.kind !== 'bytes')
            return refusal(
              'x3.host/raster-source-unsupported',
              'The resource is not a byte source.',
              provenance,
            )
          source = resolution.lease.value
          hint = { path: provenance.logicalId }
        } else if (request.kind === 'embedded') {
          if (
            !(request.bytes instanceof Uint8Array) ||
            BigInt(request.bytes.length) > options.budget.maxInputBytes
          )
            return refusal(
              'x3.host/resource-budget-exceeded',
              'Embedded raster bytes exceed the subject input budget.',
            )
          if (
            request.mediaType !== undefined &&
            (typeof request.mediaType !== 'string' || request.mediaType.length > 256)
          )
            return refusal('x3.host/raster-request-invalid', 'Invalid embedded raster media type.')
          const id = `modkit-inline://raster/${globalThis.crypto.randomUUID()}`
          const owned = createMemorySource(id, request.bytes.slice())
          hint = request.mediaType === undefined ? {} : { mediaType: request.mediaType }
          releases.push(() => owned.dispose())
          source = await artifactByteSourceFromRandomAccess(owned, {
            ref: { id, uri: id },
            revision: revisionId(`provider-token:${encodeURIComponent(id)}`),
            ...(signal === undefined ? {} : { signal }),
          })
        } else return refusal('x3.host/raster-request-invalid', 'Unknown raster resource request.')
        signal?.throwIfAborted()
        if (!options.state.live || !options.isAuthorized())
          return refusal(
            'x3.host/raster-context-unavailable',
            'The raster context is no longer readable.',
            provenance,
          )
        const opened = await options.open(source, hint, signal)
        if (opened.state !== 'opened')
          return {
            state: 'unresolved',
            diagnostics: [
              ...opened.diagnostics,
              diagnostic(
                'warning',
                'x3.host/raster-codec-unavailable',
                'No image codec could open the resource.',
              ),
            ],
            ...(provenance === undefined ? {} : { provenance }),
          }
        releases.push(() => opened.session.dispose())
        if (
          !opened.descriptor.dataSources.some(
            ref => ref.contract === 'common.view/raster-image-source' && ref.major === 1,
          )
        )
          return refusal(
            'x3.host/raster-source-unsupported',
            'The selected codec does not publish raster pixels.',
            provenance,
          )
        const raster: Lease<RasterImageSource> = await opened.session.dataSource(
          'common.view/raster-image-source',
          1,
        )
        releases.push(() => raster.release())
        const info = Object.freeze({ ...(await raster.value.info(signal)) })
        const compressedPlan =
          compressedFormats.size === 0 ||
          atlasRegion !== undefined ||
          frameOnly !== undefined ||
          raster.value.readCompressed === undefined ||
          ![...compressedFormats].some(format => format.startsWith(`${info.compression}-`))
            ? undefined
            : compressedSelectionPlan(info, selection, maxBytes)
        if (compressedPlan !== undefined) {
          const subresource: RasterSubresource = Object.freeze({
            frame: selection.frame ?? 0,
            mipLevel: compressedPlan.mipLevel,
            layer: selection.layer ?? 0,
            face: typeof selection.face === 'number' ? selection.face : 0,
            slice: 0,
          })
          let texture: CompressedTextureDescriptorV1 | undefined
          try {
            texture = await raster.value.readCompressed!(
              {
                mipLevel: subresource.mipLevel,
                layer: subresource.layer,
                face: subresource.face,
                maxBytes,
              },
              signal,
            )
          } catch (error) {
            if (signal?.aborted) throw error
            // A codec that cannot hand these blocks over still decodes them below.
          }
          const owned =
            texture === undefined
              ? undefined
              : ownedCompressedTexture(texture, info, compressedPlan, maxBytes)
          if (owned !== undefined && compressedFormats.has(owned.format))
            return {
              state: 'compressed',
              info,
              texture: owned,
              subresource,
              diagnostics: Object.freeze([...opened.diagnostics]),
              ...(provenance === undefined ? {} : { provenance }),
            }
        }
        if (!info.decodedAccess || raster.value.readRegion === undefined)
          return refusal(
            'x3.host/raster-decode-unavailable',
            'The selected image codec does not decode pixel regions.',
            provenance,
          )
        if (frameOnly !== undefined && frameOnly >= info.frames)
          return refusal(
            'x3.host/raster-frame-missing',
            `The image has no frame ${String(frameOnly)}; it has ${String(info.frames)}.`,
            provenance,
          )
        if (atlasRegion !== undefined) {
          // the codec names its atlas areas in mip 0 pixels; one area is one image of its own
          const area = info.atlasRegions?.find(item => item.name === atlasRegion)
          if (area === undefined)
            return refusal(
              'x3.host/raster-atlas-region-missing',
              `The image has no atlas region named ${atlasRegion}.`,
              provenance,
            )
          const region = await raster.value.readRegion(
            {
              x: area.x,
              y: area.y,
              width: area.width,
              height: area.height,
              ...(frameOnly === undefined ? {} : { frame: frameOnly }),
              pixelFormat: 'rgba8',
              maxBytes,
            },
            signal,
          )
          if (
            region.width !== area.width ||
            region.height !== area.height ||
            region.pixelFormat !== 'rgba8' ||
            !(region.pixels instanceof Uint8Array) ||
            region.pixels.length > maxBytes
          )
            return refusal(
              'x3.host/raster-region-invalid',
              'The image codec returned an invalid bounded RGBA region.',
              provenance,
            )
          const { atlasRegions: _atlas, ...rest } = info
          return {
            info: Object.freeze({
              ...rest,
              width: area.width,
              height: area.height,
              mipLevels: 1,
              ...(frameOnly === undefined ? {} : { frames: 1 }),
            }),
            diagnostics: Object.freeze([...opened.diagnostics]),
            ...(provenance === undefined ? {} : { provenance }),
            state: 'decoded',
            region: Object.freeze({ ...region, pixels: region.pixels.slice() }),
          }
        }
        let plan: ReturnType<typeof rasterSelectionPlan>
        try {
          plan = rasterSelectionPlan(
            info,
            frameOnly === undefined ? selection : { ...selection, frame: frameOnly },
            maxBytes,
          )
        } catch (error) {
          return refusal(
            isModkitError(error) ? error.code : 'x3.host/raster-selection-invalid',
            error instanceof Error ? error.message : 'Invalid raster selection',
            provenance,
          )
        }
        const surfaces: { subresource: RasterSubresource; region: RasterRegion }[] = []
        let remaining = maxBytes
        for (const subresource of plan.subresources) {
          signal?.throwIfAborted()
          if (!options.state.live || !options.isAuthorized())
            return refusal(
              'x3.host/raster-context-unavailable',
              'The raster context is no longer readable.',
              provenance,
            )
          const region = await raster.value.readRegion(
            {
              x: 0,
              y: 0,
              width: plan.width,
              height: plan.height,
              ...subresource,
              pixelFormat: 'rgba8',
              maxBytes: remaining,
            },
            signal,
          )
          signal?.throwIfAborted()
          if (!options.state.live || !options.isAuthorized())
            return refusal(
              'x3.host/raster-context-unavailable',
              'The raster context is no longer readable.',
              provenance,
            )
          if (
            region.width !== plan.width ||
            region.height !== plan.height ||
            region.pixelFormat !== 'rgba8' ||
            !Number.isSafeInteger(region.rowStride) ||
            region.rowStride < plan.width * 4 ||
            !(region.pixels instanceof Uint8Array) ||
            region.pixels.length > remaining ||
            region.rowStride * (plan.height - 1) + plan.width * 4 > region.pixels.length
          )
            return refusal(
              'x3.host/raster-region-invalid',
              'The image codec returned an invalid bounded RGBA region.',
              provenance,
            )
          remaining -= region.pixels.length
          surfaces.push(
            Object.freeze({
              // a named frame is frame 0 of the one-frame image the resource is
              subresource:
                frameOnly === undefined ? subresource : Object.freeze({ ...subresource, frame: 0 }),
              region: Object.freeze({ ...region, pixels: region.pixels.slice() }),
            }),
          )
        }
        const common = {
          info: Object.freeze(frameOnly === undefined ? { ...info } : { ...info, frames: 1 }),
          diagnostics: Object.freeze([...opened.diagnostics]),
          ...(provenance === undefined ? {} : { provenance }),
        }
        if (selection.face === 'all')
          return { ...common, state: 'decoded-surfaces', surfaces: Object.freeze(surfaces) }
        const first = surfaces[0]
        if (first === undefined) throw new TypeError('raster selection produced no surfaces')
        return {
          ...common,
          state: 'decoded',
          region: first.region,
          ...(explicitSelection ? { subresource: first.subresource } : {}),
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
        return refusal(
          'x3.host/raster-resource-failed',
          error instanceof Error ? error.message : 'Raster resource read failed.',
          provenance,
        )
      } finally {
        try {
          const failures: unknown[] = []
          for (const release of releases.reverse()) {
            try {
              await release()
            } catch (error) {
              failures.push(error)
            }
          }
          if (failures.length > 0) throw failures[0]
        } finally {
          options.state.reservedBytes -= maxBytes
        }
      }
    },
  } satisfies RasterResourcePort)
}
