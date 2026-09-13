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
}

function uvmArtifactSource(
  source: ArtifactByteSource,
  bytes: Uint8Array,
  conversionKey: string,
): ArtifactByteSource {
  const owned = bytes.slice()
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
  const outstanding = new Set<() => Promise<void>>()
  const reservationWaiters = new Set<() => void>()
  let reservedByModels = 0
  const wakeReservationWaiters = () => {
    for (const wake of [...reservationWaiters]) wake()
  }
  const reserve = async (maxBytes: number, signal?: AbortSignal): Promise<boolean> => {
    if (maxBytes > options.budget.maxScalarBytes) return false
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
    }
    signal?.throwIfAborted()
    if (!available()) return false
    options.state.reservedBytes += maxBytes
    reservedByModels += maxBytes
    return true
  }
  options.own(async () => {
    const results = await Promise.allSettled([...outstanding].map(release => release()))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  })
  const available = () => options.state.live && options.isAuthorized()
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
      // Concurrent model requests wait for the bounded session reservation instead of becoming
      // permanently unresolved merely because an earlier conversion is still in flight.
      if (!(await reserve(maxBytes, signal)))
        return refuse(
          `Model conversion requires ${String(maxBytes)} bytes with ${String(options.state.reservedBytes)} bytes already reserved, exceeding the ${String(options.budget.maxScalarBytes)} byte subject limit.`,
        )
      // The resource session captures and validates the complete requirement before yielding.
      const releases: (() => Promise<void>)[] = []
      let released = false
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
        const resolution = await resources.resolve(request.requirement, signal)
        if (resolution.state !== 'resolved') {
          await release()
          return refuse(resolution.diagnostic.message)
        }
        releases.push(() => resolution.lease.release())
        const source = resolution.lease.value
        if (source.kind !== 'bytes') throw new TypeError('model resource needs a byte source')
        const sourceIdentityKey = `${source.ref.id}@${source.revision}`
        if (options.ancestors.includes(sourceIdentityKey)) throw new TypeError('model resource cycle')
        if (!available()) throw new TypeError('model resource authority expired')
        const opened = await options.open(source, resolution.provenance.logicalId, signal)
        if (opened.state !== 'opened') throw new TypeError('no model codec opened the resource')
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
        const converted = await opened.session
          .operations()
          .invoke(
            operation.handlerId,
            {
              schemaVersion: 1,
              ...(units === undefined ? {} : { metersPerSourceUnit: units }),
            },
            signal === undefined ? {} : { signal },
          )
        signal?.throwIfAborted()
        if (!available()) throw new TypeError('model resource authority expired')
        if (
          converted.state !== 'ok' ||
          converted.output.kind !== 'bytes' ||
          !(converted.output.value instanceof Uint8Array) ||
          converted.output.value.length > maxBytes
        )
          throw new RangeError('model resource conversion did not return bounded UVM bytes')
        const uvmBytes = converted.output.value.slice()
        let scene: Lease<ModelSceneSource> | undefined
        let skeleton: Lease<ModelSkeletonSource> | undefined
        let animations: Lease<ModelAnimationSource> | undefined
        let materials: Lease<ModelMaterialSource> | undefined
        let resourceReferences: Lease<ModelResourceRefsSource> | undefined
        let sockets: Lease<ModelSocketSource> | undefined
        let sceneDiagnostic: ReturnType<typeof diagnostic> | undefined
        let sceneResources = opened.resources
        try {
          const uvmOpened = await options.open(
            uvmArtifactSource(source, uvmBytes, sourceKey),
            `${resolution.provenance.logicalId}.uvm`,
            signal,
          )
          if (uvmOpened.state !== 'opened') {
            throw new TypeError('the exported UVM could not be reopened by a UVM codec')
          }
          releases.push(() => uvmOpened.session.dispose())
          sceneResources = uvmOpened.resources ?? sceneResources
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
            skeleton = await uvmOpened.session.dataSource(
              'common.view/model-skeleton-source',
              1,
            )
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
            materials = await uvmOpened.session.dataSource(
              'common.view/model-material-source',
              1,
            )
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
            sockets = await uvmOpened.session.dataSource(
              'common.view/model-socket-source',
              1,
            )
            releases.push(() => sockets!.release())
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
        const result: ModelResourceResult = {
          state: 'converted',
          bytes: uvmBytes.slice(),
          sourceKey,
          diagnostics: [
            ...opened.diagnostics,
            ...converted.diagnostics,
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
      }
    },
  }
}
