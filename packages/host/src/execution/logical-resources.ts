import type {
  ArtifactSource,
  Lease,
  LogicalResourcePort,
  LogicalResourceRequirement,
  ResourceResolution,
} from '@modkit/sdk'

type ResolutionMetadata =
  | Omit<Extract<ResourceResolution, { state: 'resolved' }>, 'lease'>
  | Extract<ResourceResolution, { state: 'unresolved' }>

/** Internal ABI wrapper: RPC leases are capabilities, never functions nested in a value. */
export interface WireLogicalResourceResolution {
  readonly result: ResolutionMetadata
  openSource(signal?: AbortSignal): Promise<Lease<ArtifactSource>>
}

export interface WireLogicalResourcePort extends Omit<LogicalResourcePort, 'resolve' | 'identity'> {
  identity: NonNullable<LogicalResourcePort['identity']>
  resolve(
    requirement: LogicalResourceRequirement,
    signal?: AbortSignal,
  ): Promise<Lease<WireLogicalResourceResolution>>
}

export function wireLogicalResources(port: LogicalResourcePort): WireLogicalResourcePort {
  return Object.freeze({
    identity: port.identity === undefined ? async () => undefined : port.identity.bind(port),
    discover: port.discover.bind(port),
    readBatch: port.readBatch.bind(port),
    provenance: port.provenance.bind(port),
    async resolve(requirement, signal) {
      const resolution = await port.resolve(requirement, signal)
      let released = false
      let opened = false
      const release = async (): Promise<void> => {
        if (released) return
        released = true
        if (resolution.state === 'resolved') await resolution.lease.release()
      }
      const result: ResolutionMetadata =
        resolution.state === 'resolved'
          ? { state: 'resolved', revision: resolution.revision, provenance: resolution.provenance }
          : resolution
      return {
        value: {
          result,
          async openSource(sourceSignal) {
            sourceSignal?.throwIfAborted()
            if (released || opened || resolution.state !== 'resolved')
              throw new TypeError('The logical resource result cannot lease another source.')
            opened = true
            return { value: resolution.lease.value, release }
          },
        },
        release,
      }
    },
  } satisfies WireLogicalResourcePort)
}

export function logicalResourcesFromWire(wire: WireLogicalResourcePort): LogicalResourcePort {
  return Object.freeze({
    identity: wire.identity.bind(wire),
    discover: wire.discover.bind(wire),
    readBatch: wire.readBatch.bind(wire),
    provenance: wire.provenance.bind(wire),
    async resolve(requirement, signal) {
      const handle = await wire.resolve(requirement, signal)
      try {
        const result = handle.value.result
        if (result.state === 'unresolved') {
          await handle.release()
          return result
        }
        const source = await handle.value.openSource(signal)
        let released = false
        return {
          ...result,
          lease: {
            value: source.value,
            async release() {
              if (released) return
              released = true
              try {
                await source.release()
              } finally {
                await handle.release()
              }
            },
          },
        }
      } catch (error) {
        await handle.release()
        throw error
      }
    },
  } satisfies LogicalResourcePort)
}
