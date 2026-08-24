import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesRoot = join(repoRoot, 'extensions', 'common', 'images')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('image detectors require no services')
    },
    async resolveUnknown() {
      throw new Error('image detectors require no services')
    },
  },
}

function source(name: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://image-detection/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:image-detection-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

async function codec(format: 'cur' | 'tga'): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(imagesRoot, 'src', format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function probe(format: 'cur' | 'tga', bytes: Uint8Array) {
  return (await codec(format)).probe({
    source: source(format, bytes),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8_192 }], maxBytes: 8_192 },
  })
}

describe('common image detector isolation', () => {
  it('requires a plausible CUR directory and does not outrank a colliding TGA header', async () => {
    const cursor = new Uint8Array(await readFile(join(fixtures, 'minimal.cur')))
    expect((await probe('cur', cursor)).confidence).toBe(0.99)

    const tga = new Uint8Array(await readFile(join(fixtures, 'minimal.tga')))
    tga[0] = 0
    tga[3] = 0
    tga[4] = 1
    expect([...tga.subarray(0, 6)]).toEqual([0, 0, 2, 0, 1, 0])
    expect((await probe('tga', tga)).confidence).toBe(0.9)
    expect(await probe('cur', tga)).toMatchObject({ confidence: 0 })
  })
})
