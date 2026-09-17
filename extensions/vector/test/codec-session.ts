import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ResourceBudget,
} from '@modkit/sdk'

export const repoRoot = join(import.meta.dirname, '..', '..', '..')

export const vectorTestBudget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 16,
  maxNodes: 4096,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 32,
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://vector/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:vector-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(_range, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: `vector-${source.ref.id}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  } as unknown as AssetInput
}

export async function openVectorCodec(
  entrypoint: string,
  bytes: Uint8Array,
  resource: ResourceBudget = vectorTestBudget,
  signal?: AbortSignal,
) {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'vector', 'src', entrypoint)).href
  )) as { createCodec(context: unknown): { open: unknown } }
  const instance = module.createCodec({}) as {
    open(
      input: unknown,
      intent: string,
      budget: ResourceBudget,
      operationSignal?: AbortSignal,
    ): Promise<unknown>
  }
  return instance.open(
    inputFor(byteSource(bytes, entrypoint.replaceAll('/', '-'))),
    'inspect',
    resource,
    signal,
  ) as Promise<{
    descriptor(): Promise<{ dataSources: readonly { contract: string }[] }>
    dataSource(
      contract: string,
      major: number,
    ): Promise<{ value: unknown; release(): Promise<void> }>
    dispose(): Promise<void>
  }>
}
