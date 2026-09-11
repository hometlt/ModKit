import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import {
  cubeCornerCases,
  cubeEdgeCases,
  cubeInteriorCases,
  cubeTexel,
  sharedCorner,
  type CubeCase,
  type CubeFilter,
} from './fixtures/scene-cube.js'

let browser: Browser, page: Page
const reports: unknown[] = []
const evidence = process.env['MODKIT_CUBE_FRAME_EVIDENCE_DIR']
interface Frame {
  cpu: number[]
  gpu: number[]
  diagnostics: { code: string }[]
  triangles: number[]
}
beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined) throw new Error('Chrome/Chromium required for cube frame tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-cube.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'cubeProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('cube frame probe missing')
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage()
  await page.addScriptTag({ content: output.text })
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
            'Authored six-face spatial cube images through ordinary scene material CPU/WebGL rendering; normal and reflection coordinates, nearest/linear, all face orientations, twelve seams, eight corners, and legacy 2D atlas. Not native M3 shader equivalence.',
          nearestCenters:
            'The four central texels have the same color: reflection from a float32 45-degree normal otherwise puts the exact face center on a discontinuous nearest-texel boundary. Distinct off-center x/y gradients independently test orientation and filtering. The first candidate exposed four such boundary-oracle failures; its report is retained separately.',
          tolerance:
            '2 RGBA8 units for independent interior/edge/atlas samples and CPU/WebGL frames. At unequal cube corners CPU uses the recommended three-face average; the tested GPU must stay in the neighboring-corner envelope, without requiring exact CPU/GPU equality. Khronos permits different fourth-tap construction at unequal corners. Matching three-face corners must preserve their exact color within 2 RGBA8 units.',
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
  }
})

async function render(
  item: CubeCase,
  source: 2 | 7,
  filter: CubeFilter,
  variant: 'cube' | 'atlas' | 'matching-corners' = 'cube',
): Promise<Frame> {
  const result = await page.evaluate(
    async ({ direction, source, filter, variant }) => {
      const scope = globalThis as unknown as {
        cubeProbe: {
          cubeFrameProbe(
            direction: readonly [number, number, number],
            source: 2 | 7,
            filter: CubeFilter,
            variant: 'cube' | 'atlas' | 'matching-corners',
          ): Promise<Frame>
        }
      }
      return scope.cubeProbe.cubeFrameProbe(direction, source, filter, variant)
    },
    { direction: item.direction, source, filter, variant },
  )
  expect(result.diagnostics).toEqual([])
  expect(result.triangles).toEqual([2, 2])
  return result
}

function expectPixels(frame: number[], expected: readonly number[]) {
  // Every covered pixel has the same authored normal; check the entire interior, not one pixel.
  for (let y = 5; y < 27; y++)
    for (let x = 5; x < 27; x++)
      expected.forEach((value, channel) =>
        expect(
          Math.abs((frame[(y * 32 + x) * 4 + channel] ?? -1000) - value),
          `pixel ${x},${y}, channel ${channel}`,
        ).toBeLessThanOrEqual(2),
      )
}

function expectedSample(item: CubeCase, filter: CubeFilter, atlas = false) {
  const center = item.name.endsWith('-center')
  const colors = item.points.map(([face, x, y]) =>
    cubeTexel(
      face,
      center ? 3.5 : filter === 'nearest' ? Math.floor(x + 0.5) : x,
      center
        ? 3.5
        : filter === 'nearest'
          ? Math.floor((atlas ? 7 - y : y) + 0.5)
          : atlas
            ? 7 - y
            : y,
    ),
  )
  return [0, 1, 2, 3].map(
    channel => colors.reduce((sum, color) => sum + (color[channel] ?? 0), 0) / colors.length,
  )
}

async function capture(name: string, result: Frame, cornerEnvelope = false) {
  if (evidence === undefined) return
  mkdirSync(evidence, { recursive: true })
  const cpu = Uint8Array.from(result.cpu),
    gpu = Uint8Array.from(result.gpu)
  writeFileSync(
    resolve(evidence, `${name}.png`),
    await encodeRgbaPng({ width: 32, height: 32, rgba: gpu }),
  )
  reports.push({
    name,
    cornerEnvelope,
    cpuSha256: createHash('sha256').update(cpu).digest('hex'),
    gpuSha256: createHash('sha256').update(gpu).digest('hex'),
    maxDifference: Math.max(
      ...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0))),
    ),
  })
}

const sources = [7, 2] as const
const filters = ['nearest', 'linear'] as const
it.each(
  cubeInteriorCases.flatMap(item =>
    sources.flatMap(source => filters.map(filter => ({ name: item.name, item, source, filter }))),
  ),
)(
  '$name / source $source / $filter uses the independently specified DDS face and orientation',
  async ({ item, source, filter, name }) => {
    const result = await render(item, source, filter)
    const expected = expectedSample(item, filter)
    expectPixels(result.cpu, expected)
    expectPixels(result.gpu, expected)
    expect(
      Math.max(...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    await capture(`${name}-${source}-${filter}`, result)
  },
)

it.each(cubeEdgeCases.flatMap(item => sources.map(source => ({ name: item.name, item, source }))))(
  '$name / source $source blends the two independently identified neighboring faces',
  async ({ item, source, name }) => {
    const result = await render(item, source, 'linear')
    const expected = expectedSample(item, 'linear')
    expectPixels(result.cpu, expected)
    expectPixels(result.gpu, expected)
    expect(
      Math.max(...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    await capture(`${name}-${source}-linear`, result)
  },
)

it.each(
  cubeCornerCases.flatMap(item => sources.map(source => ({ name: item.name, item, source }))),
)(
  '$name / source $source uses three neighboring corners and preserves equal corner colors',
  async ({ item, source, name }) => {
    const result = await render(item, source, 'linear')
    expectPixels(result.cpu, expectedSample(item, 'linear'))
    // ARB_seamless_cube_map recommends averaging the three available corner texels, but permits
    // another fourth-tap construction. Do not demand an implementation-specific GPU corner color.
    // https://registry.khronos.org/OpenGL/extensions/ARB/ARB_seamless_cube_map.txt
    const colors = item.points.map(([face, x, y]) => cubeTexel(face, x, y))
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++)
        for (let channel = 0; channel < 4; channel++) {
          const value = result.gpu[(y * 32 + x) * 4 + channel] ?? -1000
          expect(value).toBeGreaterThanOrEqual(
            Math.min(...colors.map(color => color[channel] ?? 0)) - 2,
          )
          expect(value).toBeLessThanOrEqual(
            Math.max(...colors.map(color => color[channel] ?? 0)) + 2,
          )
        }
    await capture(`${name}-${source}-linear`, result, true)
    const matching = await render(item, source, 'linear', 'matching-corners')
    expectPixels(matching.cpu, sharedCorner)
    expectPixels(matching.gpu, sharedCorner)
    await capture(`${name}-${source}-matching`, matching)
  },
)

it.each(
  cubeInteriorCases
    .filter(item => item.name.endsWith('-spatial'))
    .flatMap(item =>
      sources.flatMap(source => filters.map(filter => ({ name: item.name, item, source, filter }))),
    ),
)(
  '$name / source $source / $filter retains the existing 4x3 two-dimensional atlas convention',
  async ({ item, source, filter, name }) => {
    const result = await render(item, source, filter, 'atlas')
    const expected = expectedSample(item, filter, true)
    expectPixels(result.cpu, expected)
    expectPixels(result.gpu, expected)
    expect(
      Math.max(...result.cpu.map((value, index) => Math.abs(value - (result.gpu[index] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    await capture(`${name}-${source}-${filter}-atlas`, result)
  },
)
