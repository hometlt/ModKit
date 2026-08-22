import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
  type TreeDataSource,
  type VectorSceneSource,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'common-vector')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('no services')
    },
    async resolveUnknown() {
      throw new Error('no services')
    },
  },
}

function source(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://vector/${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:vector-${format}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function input(value: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: value.ref,
    revision: value.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: 'content', revision: value.revision }],
      compositionFingerprint: value.ref.id,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function bytes(format: string) {
  return new Uint8Array(await readFile(join(fixtures, `minimal.${format}`)))
}
async function codec(format: string): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', format, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}
async function open(format: string, data: Uint8Array, resourceBudget = budget) {
  return (await codec(format)).open(input(source(format, data)), 'inspect', resourceBudget)
}
async function summary(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported Windows metafile codecs', () => {
  for (const expected of [
    { format: 'emf', width: 100, height: 50, records: 3, shapes: 1 },
    { format: 'wmf', width: 96, height: 48, records: 2, shapes: 1 },
  ])
    it(`replays ${expected.format.toUpperCase()} rectangle records to a secure SVG`, async () => {
      const session = await open(expected.format, await bytes(expected.format))
      expect(await summary(session)).toMatchObject(expected)
      const vectorLease = await session.dataSource('common.view/vector-scene-source', 1)
      const vector = vectorLease.value as VectorSceneSource
      expect(await vector.info()).toMatchObject({
        width: expected.width,
        height: expected.height,
        shapes: 1,
        paths: 0,
      })
      const document = await vector.document()
      expect(document.profile).toBe('uvg.secure-static.v1')
      expect(document.text).toMatch(/<rect[^>]+fill="none"[^>]+stroke="black"/u)
      const treeLease = await session.dataSource('common.view/tree-data-source', 1)
      const tree = treeLease.value as TreeDataSource
      expect((await tree.children(await tree.root(), { limit: 10 })).items).toHaveLength(
        expected.records,
      )
      await treeLease.release()
      await vectorLease.release()
      await session.dispose()
    })

  it('rejects damaged record streams and enforces budgets', async () => {
    const emf = await bytes('emf')
    const badEmf = emf.slice()
    new DataView(badEmf.buffer).setUint32(92, 28, true)
    await expect(open('emf', badEmf)).rejects.toThrow(/EMF/u)
    await expect(open('emf', emf, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    const wmf = await bytes('wmf')
    const badWmf = wmf.slice()
    badWmf[20] = (badWmf[20] ?? 0) ^ 1
    await expect(open('wmf', badWmf)).rejects.toThrow(/WMF/u)
    await expect(open('wmf', wmf, { ...budget, maxScalarBytes: 1 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
