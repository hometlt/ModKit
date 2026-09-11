import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import {
  environmentCases,
  environmentExpected,
  environmentSamplerCases,
  type EnvironmentFilter,
} from './fixtures/scene-environment.js'

interface Frame {
  cpu: number[]
  gpu: number[]
  diagnostics: { code: string }[]
  triangles: number[]
}
interface Result extends Frame {
  invariant?: Frame
  changed?: Frame
  projectedNormal?: { baseline: Frame; projected: Frame }
}
let browser: Browser, page: Page
const reports: unknown[] = []
const evidence = process.env['MODKIT_ENVIRONMENT_FRAME_EVIDENCE_DIR']

beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined)
    throw new Error('Chrome/Chromium required for environment frame tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-environment.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'environmentProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('environment frame probe missing')
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage()
  await page.addScriptTag({ content: output.text })
  if (evidence !== undefined && process.env['MODKIT_ENVIRONMENT_SAMPLING_DIAGNOSTIC'] === '1') {
    const result = await page.evaluate(async () => {
      const scope = globalThis as unknown as {
        environmentProbe: { environmentSamplerPrecisionProbe(): Promise<unknown> }
      }
      return scope.environmentProbe.environmentSamplerPrecisionProbe()
    })
    mkdirSync(evidence, { recursive: true })
    writeFileSync(
      resolve(evidence, 'sampler-precision.json'),
      JSON.stringify(result, null, 2) + '\n',
    )
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
  if (evidence !== undefined) {
    mkdirSync(evidence, { recursive: true })
    writeFileSync(
      resolve(evidence, 'cases.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          width: 32,
          height: 32,
          scope:
            'Explicit scene environment frame, world eye and perturbed world TBN through true-cube envi/enviMask. Seventeen semantic fixtures with independent scalar face-interior color oracles and nearest/linear filtering, plus four fixed-direction legacy nearest cube sampling regressions. Affine normal/view inputs use w=1 and their transformed lengths are retained before reflection. Exact zero direction and zero intermediate detail blend use the explicitly documented +Z fallbacks. The UV projection frame leaves the world environment fixed while still changing normal maps sampled with world UVs. This is authored scene semantic evidence, not native M3 shader or signed-detail-blend equivalence.',
          tolerance:
            '2 RGBA8 units against independent expected colors and across the full CPU/WebGL frame; invariant controls must be byte-identical within each renderer.',
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
  }
})

function compare(result: Frame) {
  expect(result.diagnostics).toEqual([])
  expect(result.triangles).toEqual([2, 2])
  expect(
    Math.max(...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0)))),
  ).toBeLessThanOrEqual(2)
}

async function capture(name: string, result: Frame) {
  if (evidence === undefined) return
  mkdirSync(evidence, { recursive: true })
  const cpu = Uint8Array.from(result.cpu),
    gpu = Uint8Array.from(result.gpu)
  writeFileSync(
    resolve(evidence, `${name}.png`),
    await encodeRgbaPng({ width: 32, height: 32, rgba: gpu }),
  )
  writeFileSync(
    resolve(evidence, `${name}.cpu.png`),
    await encodeRgbaPng({ width: 32, height: 32, rgba: cpu }),
  )
  reports.push({
    name,
    cpuSha256: createHash('sha256').update(cpu).digest('hex'),
    gpuSha256: createHash('sha256').update(gpu).digest('hex'),
    maxDifference: Math.max(
      ...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0))),
    ),
    differences: result.cpu
      .flatMap((value, index) =>
        Math.abs(value - (result.gpu[index] ?? 0)) > 2
          ? [
              {
                x: Math.floor(index / 4) % 32,
                y: Math.floor(index / 128),
                channel: index % 4,
                cpu: value,
                gpu: result.gpu[index],
              },
            ]
          : [],
      )
      .slice(0, 64),
  })
}

it.each(
  environmentCases.flatMap((item, index) =>
    (['nearest', 'linear'] as const).map(filter => ({ name: item.name, index, filter })),
  ),
)(
  '$name / $filter follows the explicit environment contract in CPU and WebGL',
  async ({ name, index, filter }) => {
    const result = await page.evaluate(
      async ({ index, filter }) => {
        const scope = globalThis as unknown as {
          environmentProbe: {
            environmentFrameProbe(index: number, filter: EnvironmentFilter): Promise<Result>
          }
        }
        return scope.environmentProbe.environmentFrameProbe(index, filter)
      },
      { index, filter },
    )
    await capture(`${name}-${filter}`, result)
    compare(result)
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++) {
        const expected = environmentExpected(index, filter, x, y)
        for (const [renderer, pixels] of [
          ['cpu', result.cpu],
          ['gpu', result.gpu],
        ] as const)
          expected.forEach((value, channel) =>
            expect(
              Math.abs((pixels[(y * 32 + x) * 4 + channel] ?? -1000) - value),
              `${renderer} pixel ${x},${y}, channel ${channel}`,
            ).toBeLessThanOrEqual(2),
          )
      }
    if (result.invariant !== undefined) {
      compare(result.invariant)
      expect(result.cpu).toEqual(result.invariant.cpu)
      expect(result.gpu).toEqual(result.invariant.gpu)
      await capture(`${name}-${filter}-invariant`, result.invariant)
    }
    if (result.changed !== undefined) {
      compare(result.changed)
      expect(result.cpu).not.toEqual(result.changed.cpu)
      expect(result.gpu).not.toEqual(result.changed.gpu)
      await capture(`${name}-${filter}-control`, result.changed)
    }
    if (result.projectedNormal !== undefined) {
      compare(result.projectedNormal.baseline)
      compare(result.projectedNormal.projected)
      expect(result.projectedNormal.baseline.cpu).not.toEqual(result.projectedNormal.projected.cpu)
      expect(result.projectedNormal.baseline.gpu).not.toEqual(result.projectedNormal.projected.gpu)
      await capture(`${name}-${filter}-normal-world-uv-baseline`, result.projectedNormal.baseline)
      await capture(`${name}-${filter}-normal-world-uv-projected`, result.projectedNormal.projected)
    }
  },
)

it.each(
  environmentSamplerCases.map((item, index) => ({
    index,
    pixel: item.pixel.join(','),
    expected: item.expected,
  })),
)(
  'legacy nearest cube direction from pixel $pixel selects the independently specified texel',
  async ({ index, pixel, expected }) => {
    const result = await page.evaluate(async index => {
      const scope = globalThis as unknown as {
        environmentProbe: { environmentSamplerFrameProbe(index: number): Promise<Frame> }
      }
      return scope.environmentProbe.environmentSamplerFrameProbe(index)
    }, index)
    await capture(`legacy-nearest-${pixel.replace(',', '-')}`, result)
    compare(result)
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++)
        for (const pixels of [result.cpu, result.gpu])
          expected.forEach((value, channel) =>
            expect(
              Math.abs((pixels[(y * 32 + x) * 4 + channel] ?? -1000) - value),
            ).toBeLessThanOrEqual(2),
          )
  },
)
