import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import {
  signedNormalCases,
  signedNormalExpected,
  type SignedNormalFilter,
} from './fixtures/scene-signed-normal.js'

interface Frame {
  cpu: number[]
  gpu: number[]
  diagnostics: { code: string }[]
  triangles: number[]
}
interface Result extends Frame {
  changed?: Frame
  lighting?: Frame
  lightingChangedEye?: Frame
}
let browser: Browser, page: Page
const evidence = process.env['MODKIT_SIGNED_NORMAL_FRAME_EVIDENCE_DIR']
const reports: unknown[] = []
beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined)
    throw new Error('Chrome/Chromium required for signed normal frame tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-signed-normal.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'signedNormalProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('signed normal frame probe missing')
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
            'Opt-in signed-two-detail scene normal policy. Independent world TBN, signed mask sum, squared weight, lighting/specular and +Z cube-face color equations. Includes nonorthonormal interpolated frames, mixed image storage, animated sign crossing, separate lighting/environment eye authority, antipodal blend cancellation, and finite large-value mask/normal stability. Does not claim all native M3 shader equivalence.',
          tolerance:
            '2 RGBA8 units against independent per-pixel colors and full CPU/WebGL frames; lighting eye-authority controls must be byte-identical within each provider.',
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
  }
})
function compare(frame: Frame) {
  expect(frame.diagnostics).toEqual([])
  expect(frame.triangles).toEqual([2, 2])
  expect(
    Math.max(...frame.cpu.map((value, index) => Math.abs(value - (frame.gpu[index] ?? 0)))),
  ).toBeLessThanOrEqual(2)
}
async function capture(name: string, frame: Frame) {
  if (evidence === undefined) return
  mkdirSync(evidence, { recursive: true })
  const cpu = Uint8Array.from(frame.cpu),
    gpu = Uint8Array.from(frame.gpu)
  writeFileSync(
    resolve(evidence, `${name}.cpu.png`),
    await encodeRgbaPng({ width: 32, height: 32, rgba: cpu }),
  )
  writeFileSync(
    resolve(evidence, `${name}.png`),
    await encodeRgbaPng({ width: 32, height: 32, rgba: gpu }),
  )
  reports.push({
    name,
    cpuSha256: createHash('sha256').update(cpu).digest('hex'),
    gpuSha256: createHash('sha256').update(gpu).digest('hex'),
    maxDifference: Math.max(
      ...frame.cpu.map((value, index) => Math.abs(value - (frame.gpu[index] ?? 0))),
    ),
    differences: frame.cpu
      .flatMap((value, index) =>
        Math.abs(value - (frame.gpu[index] ?? 0)) > 2
          ? [
              {
                x: Math.floor(index / 4) % 32,
                y: Math.floor(index / 128),
                channel: index % 4,
                cpu: value,
                gpu: frame.gpu[index],
              },
            ]
          : [],
      )
      .slice(0, 64),
  })
}
it.each(
  signedNormalCases.flatMap((item, index) =>
    (['nearest', 'linear'] as const).map(filter => ({ name: item.name, index, filter })),
  ),
)(
  '$name / $filter follows independent signed-world-normal and lighting equations',
  async ({ name, index, filter }) => {
    const result = await page.evaluate(
      async ({ index, filter }) => {
        const scope = globalThis as unknown as {
          signedNormalProbe: {
            signedNormalFrameProbe(index: number, filter: SignedNormalFilter): Promise<Result>
          }
        }
        return scope.signedNormalProbe.signedNormalFrameProbe(index, filter)
      },
      { index, filter },
    )
    await capture(`${name}-${filter}`, result)
    compare(result)
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++) {
        const expected = signedNormalExpected(index, filter, x, y)
        for (const [provider, pixels] of [
          ['cpu', result.cpu],
          ['gpu', result.gpu],
        ] as const)
          expected.forEach((value, channel) =>
            expect(
              Math.abs((pixels[(y * 32 + x) * 4 + channel] ?? -1000) - value),
              `${provider} pixel ${x},${y}, channel ${channel}`,
            ).toBeLessThanOrEqual(2),
          )
      }
    if (
      result.changed !== undefined &&
      result.lighting !== undefined &&
      result.lightingChangedEye !== undefined
    ) {
      for (const frame of [result.changed, result.lighting, result.lightingChangedEye])
        compare(frame)
      expect(result.cpu).not.toEqual(result.changed.cpu)
      expect(result.gpu).not.toEqual(result.changed.gpu)
      expect(result.lighting.cpu).toEqual(result.lightingChangedEye.cpu)
      expect(result.lighting.gpu).toEqual(result.lightingChangedEye.gpu)
      await capture(`${name}-${filter}-environment-eye`, result.changed)
      await capture(`${name}-${filter}-lighting`, result.lighting)
      await capture(`${name}-${filter}-lighting-eye`, result.lightingChangedEye)
    }
  },
)
