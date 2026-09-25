/**
 * `.zst` payloads through the host's ordinary open path, decoded by the shared codec-kit decoder.
 * Frames come from Node's own Zstandard encoder, so they carry compressed blocks, checksums and
 * several frames — the cases the previous raw/RLE-only reader refused.
 */
import { join } from 'node:path'
import { constants, crc32, zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  type Inventory,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import { revisionId, type ArtifactByteSource, type ResourceBudget } from '@modkit/sdk'

const extensionRoot = join(import.meta.dirname, '..')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'archives-zstd', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 16,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 32,
}

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let inventoryPromise: Promise<Inventory> | undefined
function inventory(): Promise<Inventory> {
  inventoryPromise ??= loadExtensionDirectory(extensionRoot).then(loaded =>
    buildInventory(
      [{ ...loaded, execution: { origin: 'bundled' as const, allowTrustedInProcess: true } }],
      createHostContributionContractRegistry(),
    ),
  )
  return inventoryPromise
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://archives-zstd/${name}`
  return Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}-${crc32(bytes)}`),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  })
}

function text(lines: number, seed: number): Uint8Array {
  return new TextEncoder().encode(
    Array.from({ length: lines }, (_, index) => `line ${index} value ${(index * seed) % 97}`).join(
      '\n',
    ),
  )
}

async function extract(bytes: Uint8Array, name: string, resource = budget) {
  const result = await openSubject({
    inventory: await inventory(),
    source: byteSource(bytes, name),
    path: name,
    intent: 'full',
    target,
    grant,
    budget: resource,
    executionBackends,
  })
  if (result.state !== 'opened') return { state: result.state, diagnostics: result.diagnostics }
  const lease = await result.session.dataSource('common.view/namespace-entry-source', 1)
  const listing = await lease.value.list('', { limit: 10 })
  await lease.release()
  const output = await result.session.operations().invoke('extract-entry', { entryId: 'payload' })
  await result.session.dispose()
  return { state: result.state, listing: listing.items, output }
}

describe('Zstandard payloads', () => {
  it('decode compressed blocks, checksums and concatenated frames', async () => {
    const first = text(4000, 7)
    const second = text(1000, 13)
    const frames = new Uint8Array([
      ...zstdCompressSync(first, { params: { [constants.ZSTD_c_checksumFlag]: 1 } }),
      ...zstdCompressSync(second),
    ])
    const opened = await extract(frames, 'payload.zst')
    expect(opened.state).toBe('opened')
    expect(opened.listing?.map(entry => [entry.path, entry.size])).toEqual([
      ['payload.bin', BigInt(first.length + second.length)],
    ])
    expect(opened.output).toMatchObject({ state: 'ok' })
    const value = (opened.output as { output: { value: Uint8Array } }).output.value
    expect(Buffer.from(value).equals(Buffer.concat([first, second]))).toBe(true)
  })

  it('refuses output beyond the scalar budget', async () => {
    const frame = new Uint8Array(zstdCompressSync(text(4000, 7)))
    const opened = await extract(frame, 'big.zst', { ...budget, maxScalarBytes: 1000 })
    expect(opened.state).not.toBe('opened')
  })
})
