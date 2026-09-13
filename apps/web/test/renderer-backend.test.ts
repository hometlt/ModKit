import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ModelSceneSource,
  type ResourceBudget,
} from '@modkit/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const browserModule = join(repoRoot, 'packages', 'scene', 'dist', 'render', 'browser.js')
const fixtureRoot = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

let browser: Browser
let server: Server
let origin = ''

const codecBudget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const codecContext: ContributionContext = {
  budgets: codecBudget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('browser renderer fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('browser renderer fixtures have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://browser-rendering/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:browser-rendering-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
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
      compositionFingerprint: name,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

const modelFixtures = [
  {
    format: 'obj',
    codec: join(repoRoot, 'extensions', 'models', 'src', 'obj', 'codec.js'),
    sample: 'minimal.obj',
    primitiveId: 'primitive-0',
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  },
  {
    format: 'ply',
    codec: join(repoRoot, 'extensions', 'models', 'src', 'ply', 'codec.js'),
    sample: 'minimal.ply',
    primitiveId: 'primitive-0',
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  },
  {
    format: 'stl',
    codec: join(repoRoot, 'extensions', 'models', 'src', 'stl', 'codec.js'),
    sample: 'minimal.stl',
    primitiveId: 'primitive-0',
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  },
] as const

async function decodedFixture(fixture: (typeof modelFixtures)[number]) {
  const codecModule = (await import(pathToFileURL(fixture.codec).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  const bytes = new Uint8Array(await readFile(join(fixtureRoot, fixture.sample)))
  const session = await codecModule
    .createCodec(codecContext)
    .open(inputFor(fixture.sample, bytes), 'inspect', codecBudget)
  const lease = await session.dataSource('common.view/model-scene-source', 1)
  try {
    const model = lease.value as ModelSceneSource
    if (model.primitive === undefined) throw new TypeError(`${fixture.format} has no primitive API`)
    const primitive = await model.primitive(fixture.primitiveId, { maxBytes: 10_000_000 })
    if (primitive.indices === undefined) throw new TypeError(`${fixture.format} has no indices`)
    return {
      positions: [...primitive.positions],
      indices: [...primitive.indices],
      viewProjection: [...fixture.viewProjection],
      triangles: primitive.indices.length / 3,
    }
  } finally {
    await lease.release()
    await session.dispose()
  }
}

beforeAll(async () => {
  const bundled = await build({
    entryPoints: [browserModule],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome120'],
    write: false,
    logLevel: 'silent',
  })
  const source = bundled.outputFiles[0]?.text
  if (source === undefined) throw new Error('browser renderer bundle produced no JavaScript')
  server = createServer((request, response) => {
    response.setHeader('content-type', 'text/javascript; charset=utf-8')
    if (request.url === '/browser.js') {
      response.end(source)
      return
    }
    if (request.url === '/worker.js') {
      response.end(`
        import { renderBrowser } from './browser.js'
        self.onmessage = async event => {
          try {
            const input = event.data
            const frame = await renderBrowser({
              scene: {
                materials: [{ id: 'red', baseColor: [1, 0, 0, 1] }],
                primitives: [{
                  id: 'browser-triangle',
                  topology: 'triangles',
                  positions: new Float32Array(input.positions),
                  indices: new Uint32Array(input.indices),
                  materialId: 'red',
                }],
              },
              camera: { viewProjection: new Float32Array(input.viewProjection) },
              viewport: { width: 32, height: 32 },
              clearColor: [0, 0, 0, 1],
              outputKind: 'rgba8',
            })
            let redPixels = 0
            for (let offset = 0; offset < frame.rgba.length; offset += 4) {
              if (frame.rgba[offset] === 255 && frame.rgba[offset + 1] === 0 &&
                  frame.rgba[offset + 2] === 0 && frame.rgba[offset + 3] === 255) redPixels += 1
            }
            self.postMessage({
              outputKind: frame.outputKind,
              width: frame.width,
              height: frame.height,
              diagnostics: frame.diagnostics,
              statistics: frame.statistics,
              redPixels,
            })
          } catch (error) {
            self.postMessage({ error: error instanceof Error ? error.message : String(error) })
          }
        }
      `)
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>renderer worker harness</title>')
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('renderer server failed')
  origin = `http://127.0.0.1:${address.port}`
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) throw new Error('Chrome/Chromium is required')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(done => server?.close(() => done()))
})

describe('browser WebGL scene renderer', () => {
  it.each(modelFixtures)(
    'renders decoded $format geometry inside a real browser worker',
    async fixture => {
      const geometry = await decodedFixture(fixture)
      const page = await browser.newPage()
      await page.goto(origin)
      const result = await page.evaluate(
        input =>
          new Promise<Record<string, unknown>>((resolveResult, reject) => {
            const worker = new Worker('/worker.js', { type: 'module' })
            worker.onerror = event => reject(new Error(event.message))
            worker.onmessage = event => {
              worker.terminate()
              resolveResult(event.data as Record<string, unknown>)
            }
            worker.postMessage(input)
          }),
        geometry,
      )
      expect(result).not.toHaveProperty('error')
      expect(result).toMatchObject({
        outputKind: 'rgba8',
        width: 32,
        height: 32,
        diagnostics: [],
        statistics: { primitives: 1, triangles: geometry.triangles },
      })
      const statistics = result['statistics']
      if (typeof statistics !== 'object' || statistics === null || !('fragments' in statistics)) {
        throw new Error('browser renderer returned no fragment statistics')
      }
      expect(result['redPixels']).toBe(statistics.fragments)
      expect(result['redPixels']).toEqual(expect.any(Number))
      expect(result['redPixels']).not.toBe(0)
      await page.close()
    },
    30_000,
  )
})
