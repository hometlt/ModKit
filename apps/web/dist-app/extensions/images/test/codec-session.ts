import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

export const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')

export const imageTestBudget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 16,
  maxNodes: 4096,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 32,
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://image-gpu-depth/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:image-gpu-depth-${name}`),
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
      compositionFingerprint: `image-gpu-depth-${source.ref.id}`,
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

export async function openImageCodec(
  entrypoint: string,
  bytes: Uint8Array,
  resource: ResourceBudget = imageTestBudget,
  signal?: AbortSignal,
) {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'images', 'src', entrypoint)).href
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
