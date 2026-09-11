import { diagnostic, isModkitError } from '@modkit/core'
import {
  revisionId,
  type ArtifactByteSource,
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
import type { OpenSubjectResult } from './subject-open.js'
import { captureRasterSelection, rasterSelectionPlan } from './raster-selection.js'

/** Shared by the candidate's narrowed contexts. Bound only when that candidate becomes the subject. */
export interface SubjectRasterResourceState {
  live: boolean
  reservedBytes: number
  resources?: ResourceSessionPort
}

export interface SubjectRasterResourceOptions {
  readonly state: SubjectRasterResourceState
  readonly budget: ResourceBudget
  readonly isAuthorized: () => boolean
  /** Ordinary host codec selection under read-only authority; not supplied by the extension. */
  readonly open: (
    source: ArtifactByteSource,
    hint: { path?: string; mediaType?: string },
    signal?: AbortSignal,
  ) => Promise<OpenSubjectResult>
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
      const maxBytes = request.maxBytes
      let selection: ReturnType<typeof captureRasterSelection>
      const explicitSelection = request.selection !== undefined
      try {
        selection = captureRasterSelection(request.selection)
      } catch (error) {
        return refusal(
          'x3.host/raster-request-invalid',
          error instanceof Error ? error.message : 'Invalid raster selection',
        )
      }
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
          const resolution = await resources.resolve(request.requirement, signal)
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
        if (!info.decodedAccess || raster.value.readRegion === undefined)
          return refusal(
            'x3.host/raster-decode-unavailable',
            'The selected image codec does not decode pixel regions.',
            provenance,
          )
        let plan: ReturnType<typeof rasterSelectionPlan>
        try {
          plan = rasterSelectionPlan(info, selection, maxBytes)
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
              subresource,
              region: Object.freeze({ ...region, pixels: region.pixels.slice() }),
            }),
          )
        }
        const common = {
          info: Object.freeze({ ...info }),
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
