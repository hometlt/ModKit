import { diagnostic } from '@modkit/core'
import { revisionIdFromRef } from '@modkit/sdk'
import type {
  ArtifactByteSource,
  Lease,
  ModelAnimationSource,
  ModelMaterialSource,
  ModelResourceRefsSource,
  ModelResourceAsset,
  ModelResourcePort,
  ModelResourceRequest,
  ModelResourceResult,
  ModelSceneSource,
  ModelSkeletonSource,
  ModelSocketSource,
  ResourceBudget,
} from '@modkit/sdk'
import {
  createSubjectRasterResources,
  type SubjectRasterResourceState,
} from './raster-resources.js'
import type { OpenSubjectResult } from './subject-open.js'
import { createModelProjectionCache, modelProjectionKey } from './model-projection-cache.js'

/** Host-local profiling hook, deliberately outside the codec/worker SDK contracts. */
export interface ModelResourceProfile {
  readonly state: 'converted' | 'unresolved' | 'aborted'
  readonly cache: 'bypass' | 'miss' | 'hit' | 'shared-hit'
  readonly reserveMs: number
  readonly resolveMs: number
  /** Includes native inspection and companion discovery; not an isolated decode timer. */
  readonly nativeOpenMs: number
  readonly projectionWaitMs: number
  readonly exportUvmMs: number
  readonly reopenUvmMs: number
  readonly acquireFacetsMs: number
  readonly totalMs: number
  readonly exportInvocations: number
  readonly uvmBytes: number
  readonly cacheRetainedBytes: number
  /**
   * Which layer of the load order the model itself came out of, when the origin names one.
   *
   * A world receipt can count converted models; it could not say whether a map carries its own art
   * or borrows all of it from the installed game, which is the question asked of any map that is
   * about to be shared.
   */
  readonly rootId?: string
}

interface Options {
  readonly state: SubjectRasterResourceState
  readonly budget: ResourceBudget
  readonly isAuthorized: () => boolean
  readonly open: (
    source: ArtifactByteSource,
    path: string,
    signal?: AbortSignal,
  ) => Promise<OpenSubjectResult>
  /** Session cleanup owns every outstanding lease, including abandoned worker requests. */
  readonly own: (release: () => Promise<void>) => void
  readonly ancestors: readonly string[]
  readonly onProfile?: (profile: ModelResourceProfile) => void
}

function uvmArtifactSource(
  source: ArtifactByteSource,
  bytes: Uint8Array,
  conversionKey: string,
): ArtifactByteSource {
  // bytes is an owned host projection, never exposed to codecs or callers. Reads/streams copy;
  // the public ModelResourceResult owns a separate copy that may be mutated or transferred.
  const owned = bytes
  const size = BigInt(owned.byteLength)
  const range = (offset: bigint, length: bigint): Uint8Array => {
    if (offset < 0n || length < 0n || offset > size) {
      throw new RangeError('UVM artifact reads require a non-negative range inside the source')
    }
    const end = offset + length
    return owned.slice(Number(offset), Number(end > size ? size : end))
  }
  return Object.freeze({
    kind: 'bytes' as const,
    ref: Object.freeze({
      id: `${source.ref.id}#model.export-uvm`,
      uri: `memory+uvm:${encodeURIComponent(source.ref.uri)}`,
    }),
    revision: revisionIdFromRef({
      kind: 'provider-token',
      value: conversionKey,
    }),
    size,
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new RangeError('UVM artifact read length must be a non-negative safe integer')
      }
      return range(offset, BigInt(length))
    },
    async *stream(
      requested?: { readonly offset: bigint; readonly length?: bigint },
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted()
      const offset = requested?.offset ?? 0n
      const length = requested?.length ?? size - offset
      yield range(offset, length)
    },
  })
}

/** Codec selection and conversion stay in the host. No native parser or scene dependency. */
export function createSubjectModelResources(options: Options): ModelResourcePort {
  const projections = createModelProjectionCache(options.state, options.budget.maxScalarBytes)
  let projectionResources = options.state.resources
  let closed = false
  const outstanding = new Set<() => Promise<void>>()
  const reservationWaiters = new Set<() => void>()
  let reservedByModels = 0
  const wakeReservationWaiters = () => {
    for (const wake of [...reservationWaiters]) wake()
  }
  const reserve = async (maxBytes: number, signal?: AbortSignal): Promise<boolean> => {
    if (maxBytes > options.budget.maxScalarBytes) return false
    projections.trimForReservation(maxBytes)
    while (options.state.reservedBytes + maxBytes > options.budget.maxScalarBytes) {
      signal?.throwIfAborted()
      if (!available() || reservedByModels === 0) return false
      await new Promise<void>(resolve => {
        const wake = () => {
          reservationWaiters.delete(wake)
          signal?.removeEventListener('abort', wake)
          resolve()
        }
        reservationWaiters.add(wake)
        signal?.addEventListener('abort', wake, { once: true })
      })
      projections.trimForReservation(maxBytes)
    }
    signal?.throwIfAborted()
    if (!available()) return false
    options.state.reservedBytes += maxBytes
    reservedByModels += maxBytes
    return true
  }
  options.own(async () => {
    closed = true
    projections.clear()
    wakeReservationWaiters()
    const results = await Promise.allSettled([...outstanding].map(release => release()))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  })
  const available = () => !closed && options.state.live && options.isAuthorized()
  const refuse = (message: string): Lease<ModelResourceAsset> => ({
    value: {
      result: {
        state: 'unresolved',
        diagnostics: [diagnostic('warning', 'x3.host/model-resource-unavailable', message)],
      },
      async acquire() {
        throw new TypeError('model resource is unavailable')
      },
      async readRaster() {
        throw new TypeError('model resource is unavailable')
      },
    },
    async release() {
      return undefined
    },
  })
  return {
    async acquire(request: ModelResourceRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const started = performance.now()
      if (!available()) return refuse('Model resources require a live read-source subject.')
      if (options.ancestors.length >= Math.min(8, options.budget.maxDepth))
        return refuse('Nested models exceed the depth limit.')
      const maxBytes = request?.maxBytes,
        units = request?.metersPerSourceUnit
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
        return refuse('Model conversion maxBytes must be a positive safe integer.')
      if (maxBytes > options.budget.maxScalarBytes)
        return refuse(
          `Model conversion requires ${String(maxBytes)} bytes, exceeding the ${String(options.budget.maxScalarBytes)} byte subject limit.`,
        )
      if (units !== undefined && (!Number.isFinite(units) || units <= 0))
        return refuse('Model conversion metersPerSourceUnit must be positive and finite.')
      const resources = options.state.resources
      if (resources === undefined) return refuse('The subject has no model resource origin.')
      if (resources !== projectionResources) {
        projections.clear()
        projectionResources = resources
      }
      // Concurrent model requests wait for the bounded session reservation instead of becoming
      // permanently unresolved merely because an earlier conversion is still in flight.
      const reservationStarted = performance.now()
      if (!(await reserve(maxBytes, signal)))
        return refuse(
          `Model conversion requires ${String(maxBytes)} bytes with ${String(options.state.reservedBytes)} bytes already reserved, exceeding the ${String(options.budget.maxScalarBytes)} byte subject limit.`,
        )
      // The resource session captures and validates the complete requirement before yielding.
      const releases: (() => Promise<void>)[] = []
      let released = false
      const profile = {
        state: 'unresolved' as ModelResourceProfile['state'],
        cache: 'bypass' as ModelResourceProfile['cache'],
        reserveMs: performance.now() - reservationStarted,
        resolveMs: 0,
        nativeOpenMs: 0,
        projectionWaitMs: 0,
        exportUvmMs: 0,
        reopenUvmMs: 0,
        acquireFacetsMs: 0,
        exportInvocations: 0,
        uvmBytes: 0,
      }
      /** Kept beside the profile rather than in it: the field is absent, not `undefined`. */
      let rootId: string | undefined
      const timed = async <T>(
        phase:
          | 'resolveMs'
          | 'nativeOpenMs'
          | 'projectionWaitMs'
          | 'exportUvmMs'
          | 'reopenUvmMs'
          | 'acquireFacetsMs',
        work: () => Promise<T>,
      ): Promise<T> => {
        const start = performance.now()
        try {
          return await work()
        } finally {
          profile[phase] += performance.now() - start
        }
      }
      let projection: Awaited<ReturnType<typeof projections.claim>> | undefined
      const release = async () => {
        if (released) return
        released = true
        outstanding.delete(release)
        let failure: unknown
        try {
          for (const dispose of releases.reverse()) {
            try {
              await dispose()
            } catch (error) {
              failure ??= error
            }
          }
        } finally {
          options.state.reservedBytes -= maxBytes
          reservedByModels -= maxBytes
          wakeReservationWaiters()
        }
        if (failure !== undefined) throw failure
      }
      try {
        const resolution = await timed('resolveMs', () =>
          resources.resolve(request.requirement, signal),
        )
        if (resolution.state !== 'resolved') {
          await release()
          return refuse(resolution.diagnostic.message)
        }
        rootId = resolution.provenance.rootId
        releases.push(() => resolution.lease.release())
        const source = resolution.lease.value
        if (source.kind !== 'bytes') throw new TypeError('model resource needs a byte source')
        const sourceIdentityKey = `${source.ref.id}@${source.revision}`
        if (options.ancestors.includes(sourceIdentityKey))
          throw new TypeError('model resource cycle')
        if (!available()) throw new TypeError('model resource authority expired')
        const opened = await timed('nativeOpenMs', () =>
          options.open(source, resolution.provenance.logicalId, signal),
        )
        if (opened.state !== 'opened') {
          const details = [
            ...opened.diagnostics,
            ...opened.candidates.flatMap(candidate => candidate.diagnostics),
          ]
            .map(item => `${item.code}: ${item.message}`)
            .join('; ')
          throw new TypeError(
            details.length === 0
              ? 'no model codec opened the resource'
              : `no model codec opened the resource (${details})`,
          )
        }
        releases.push(() => opened.session.dispose())
        const operation = opened.descriptor.operations.find(
          item =>
            item.id === 'model.export-uvm' && item.state === 'available' && !item.mutatesSource,
        )
        if (operation === undefined)
          throw new TypeError('the resource does not publish model.export-uvm')
        const sourceKey = [
          source.ref.id,
          opened.descriptor.revision,
          operation.id,
          operation.handlerId,
          'schemaVersion=1',
          `metersPerSourceUnit=${units === undefined ? 'source-unit' : String(units)}`,
        ].join('|')
        projection = await timed('projectionWaitMs', () =>
          projections.claim(
            resources === options.state.resources
              ? modelProjectionKey(opened, source, sourceKey, resolution.provenance.logicalId)
              : undefined,
            signal,
          ),
        )
        profile.cache = projection.state
        signal?.throwIfAborted()
        if (!available()) throw new TypeError('model resource authority expired')
        let conversionDiagnostics: ModelResourceResult['diagnostics'] = []
        let uvmBytes: Uint8Array
        if ('bytes' in projection) {
          uvmBytes = projection.bytes
        } else {
          profile.exportInvocations++
          const converted = await timed('exportUvmMs', () =>
            opened.session.operations().invoke(
              operation.handlerId,
              {
                schemaVersion: 1,
                ...(units === undefined ? {} : { metersPerSourceUnit: units }),
              },
              signal === undefined ? {} : { signal },
            ),
          )
          if (
            converted.state !== 'ok' ||
            converted.output.kind !== 'bytes' ||
            !(converted.output.value instanceof Uint8Array) ||
            converted.output.value.length > maxBytes
          )
            throw new RangeError('model resource conversion did not return bounded UVM bytes')
          uvmBytes = converted.output.value.slice()
          conversionDiagnostics = converted.diagnostics
        }
        signal?.throwIfAborted()
        if (!available()) throw new TypeError('model resource authority expired')
        if (uvmBytes.length > maxBytes)
          throw new RangeError('model resource conversion did not return bounded UVM bytes')
        profile.uvmBytes = uvmBytes.byteLength
        let scene: Lease<ModelSceneSource> | undefined
        let skeleton: Lease<ModelSkeletonSource> | undefined
        let animations: Lease<ModelAnimationSource> | undefined
        let materials: Lease<ModelMaterialSource> | undefined
        let resourceReferences: Lease<ModelResourceRefsSource> | undefined
        let sockets: Lease<ModelSocketSource> | undefined
        let sceneDiagnostic: ReturnType<typeof diagnostic> | undefined
        let sceneResources = opened.resources
        try {
          const uvmPath = resolution.provenance.logicalId.replace(/(?:\.[^./]+)?$/u, '.uvm')
          const uvmOpened = await timed('reopenUvmMs', () =>
            options.open(uvmArtifactSource(source, uvmBytes, sourceKey), uvmPath, signal),
          )
          if (uvmOpened.state !== 'opened') {
            const details = [
              ...uvmOpened.diagnostics,
              ...uvmOpened.candidates.flatMap(candidate => candidate.diagnostics),
            ]
              .map(item => `${item.code}: ${item.message}`)
              .join('; ')
            throw new TypeError(
              details.length === 0
                ? 'the exported UVM could not be reopened by a UVM codec'
                : `the exported UVM could not be reopened by a UVM codec (${details})`,
            )
          }
          releases.push(() => uvmOpened.session.dispose())
          // The reopened UVM is an in-memory projection of the native model. Its subject-local
          // resource origin can resolve the synthetic .uvm itself, but it does not own the M3's
          // game-logical DDS/M3A companions. Keep the native model overlay when one was captured;
          // only fall back to the UVM origin for a codec that supplied no native resource port.
          sceneResources = sceneResources ?? uvmOpened.resources
          const facetsStarted = performance.now()
          try {
            const acquiredScene = await uvmOpened.session.dataSource(
              'common.view/model-scene-source',
              1,
            )
            scene = acquiredScene
            releases.push(() => acquiredScene.release())
            const advertised = new Set(
              (uvmOpened.descriptor.dataSources ?? [])
                .filter(item => item.major === 1)
                .map(item => item.contract),
            )
            if (advertised.has('common.view/model-skeleton-source')) {
              skeleton = await uvmOpened.session.dataSource('common.view/model-skeleton-source', 1)
              releases.push(() => skeleton!.release())
            }
            if (advertised.has('common.view/model-animation-source')) {
              animations = await uvmOpened.session.dataSource(
                'common.view/model-animation-source',
                1,
              )
              releases.push(() => animations!.release())
            }
            if (advertised.has('common.view/model-material-source')) {
              materials = await uvmOpened.session.dataSource('common.view/model-material-source', 1)
              releases.push(() => materials!.release())
            }
            if (advertised.has('common.view/model-resource-refs-source')) {
              resourceReferences = await uvmOpened.session.dataSource(
                'common.view/model-resource-refs-source',
                1,
              )
              releases.push(() => resourceReferences!.release())
            }
            if (advertised.has('common.view/model-socket-source')) {
              sockets = await uvmOpened.session.dataSource('common.view/model-socket-source', 1)
              releases.push(() => sockets!.release())
            }
          } finally {
            profile.acquireFacetsMs += performance.now() - facetsStarted
          }
        } catch (error) {
          sceneDiagnostic = diagnostic(
            'warning',
            'x3.host/model-resource-uvm-scene-unavailable',
            error instanceof Error
              ? `The exported UVM has no renderable scene: ${error.message}`
              : 'The exported UVM has no renderable scene.',
          )
        }
        signal?.throwIfAborted()
        if (!available()) throw new TypeError('model resource authority expired')
        const result: ModelResourceResult = {
          state: 'converted',
          bytes: uvmBytes.slice(),
          sourceKey,
          diagnostics: [
            ...opened.diagnostics,
            ...conversionDiagnostics,
            ...(sceneDiagnostic === undefined ? [] : [sceneDiagnostic]),
          ],
        }
        const childState: SubjectRasterResourceState = {
          live: true,
          reservedBytes: result.bytes.byteLength,
          ...(sceneResources === undefined ? {} : { resources: sceneResources }),
        }
        releases.push(async () => {
          childState.live = false
        })
        const childOptions = {
          ...options,
          state: childState,
          budget: { ...options.budget, maxScalarBytes: maxBytes },
          isAuthorized: () => !released && available(),
          ancestors: [...options.ancestors, sourceIdentityKey],
          own: (dispose: () => Promise<void>) => {
            releases.push(dispose)
          },
        }
        const models = createSubjectModelResources(childOptions)
        const rasters = createSubjectRasterResources({
          ...childOptions,
          open: (bytes, hint, abort) => options.open(bytes, hint.path ?? '', abort),
        })
        outstanding.add(release)
        if (
          projection.state === 'miss' &&
          sceneDiagnostic === undefined &&
          conversionDiagnostics.length === 0
        )
          projection.finish(uvmBytes)
        profile.state = 'converted'
        return {
          value: {
            result,
            acquire: models.acquire,
            readRaster: rasters.read,
            ...(scene === undefined
              ? {}
              : {
                  sceneInfo: scene.value.info.bind(scene.value),
                  nodes: scene.value.nodes.bind(scene.value),
                  meshes: scene.value.meshes.bind(scene.value),
                  ...(scene.value.primitive === undefined
                    ? {}
                    : { primitive: scene.value.primitive.bind(scene.value) }),
                  ...(skeleton === undefined
                    ? {}
                    : { skeletonBindings: skeleton.value.bindings.bind(skeleton.value) }),
                  ...(animations === undefined
                    ? {}
                    : { animationClips: animations.value.clips.bind(animations.value) }),
                  ...(materials === undefined
                    ? {}
                    : { materials: materials.value.materials.bind(materials.value) }),
                  ...(resourceReferences === undefined
                    ? {}
                    : {
                        resourceReferences: resourceReferences.value.references.bind(
                          resourceReferences.value,
                        ),
                      }),
                  ...(sockets === undefined
                    ? {}
                    : { sockets: sockets.value.sockets.bind(sockets.value) }),
                }),
          },
          release,
        }
      } catch (error) {
        await release()
        if (signal?.aborted) throw error
        return refuse(error instanceof Error ? error.message : 'Model acquisition failed.')
      } finally {
        if (projection?.state === 'miss') projection.finish()
        if (signal?.aborted) profile.state = 'aborted'
        try {
          options.onProfile?.(
            Object.freeze({
              ...profile,
              totalMs: performance.now() - started,
              cacheRetainedBytes: projections.retainedBytes,
              ...(rootId === undefined ? {} : { rootId }),
            }),
          )
        } catch {
          // A diagnostic observer must not change acquisition or leak its lease.
        }
      }
    },
  }
}
