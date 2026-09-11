import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { materialProgramCases } from './fixtures/scene-material-program.js'
import { specialFrameCases } from './fixtures/scene-material-frame.js'
import { normalFrameCases } from './fixtures/scene-material-normal.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'

let browser: Browser, page: Page
const evidence = process.env['MODKIT_MATERIAL_FRAME_EVIDENCE_DIR']
const reports: unknown[] = []
async function capture(name: string, result: { cpu: number[]; gpu: number[] }) {
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
    cpuSha256: createHash('sha256').update(cpu).digest('hex'),
    gpuSha256: createHash('sha256').update(gpu).digest('hex'),
    maxStraightDifference: Math.max(
      ...result.cpu.map((value, i) => Math.abs(value - (result.gpu[i] ?? 0))),
    ),
  })
}
beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined)
    throw new Error('Chrome/Chromium required for scene frame tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-material-frame-probe.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'frameProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('frame probe missing')
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
            'Whole scene material frames, authored spatial textures, nearest and linear filtering; 19 UV source routes on the stated fixture geometry, not arbitrary-model/native shader equivalence.',
          tolerance:
            '2 in reconstructed premultiplied RGBA8 for material cases; 2 straight RGBA8 for geometry/blend cases',
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
  }
})
it.each(specialFrameCases().map((item, index) => ({ name: item.name, index })))(
  '$name applies scene depth, geometry and blend state in both providers',
  async ({ index, name }) => {
    const result = await page.evaluate(async index => {
      const scope = globalThis as unknown as {
        frameProbe: { specialFrameProbe(index: number): Promise<{ cpu: number[]; gpu: number[] }> }
      }
      return scope.frameProbe.specialFrameProbe(index)
    }, index)
    const errors = result.cpu.map((value, i) => Math.abs(value - (result.gpu[i] ?? 0)))
    expect(
      Math.max(...errors),
      `different components=${errors.filter(error => error > 2).length}`,
    ).toBeLessThanOrEqual(2)
    const blend = name.startsWith('blend-state-')
      ? Number(name.slice('blend-state-'.length))
      : undefined
    if (blend !== undefined) {
      const expected = [
        [51, 102, 153, 128],
        [39, 77, 115, 255],
        [77, 153, 230, 255],
        [52, 102, 154, 255],
        [5, 20, 46, 255],
        [10, 41, 92, 255],
      ][blend]
      if (expected === undefined) throw new Error('missing blend oracle')
      for (const frame of [result.cpu, result.gpu])
        expected.forEach((value, channel) => {
          const offset = (16 * 32 + 16) * 4,
            actual = frame[offset + channel] ?? 0
          // The independent oracle is straight RGBA; compare its quantized storage value.
          const a = channel === 3 ? actual : Math.round((actual * (frame[offset + 3] ?? 0)) / 255)
          const b = channel === 3 ? value : Math.round((value * (expected[3] ?? 0)) / 255)
          expect(Math.abs(a - b)).toBeLessThanOrEqual(1)
        })
    }
    await capture(name, result)
  },
)
it.each([5, 13, 14, 17, 18])(
  'preserves world UV source %i across rotation, scale and translation',
  async source => {
    const result = await page.evaluate(async source => {
      const scope = globalThis as unknown as {
        frameProbe: {
          rebasedMaterialFrameProbe(
            source: number,
          ): Promise<{ baseline: number[]; cpu: number[]; gpu: number[] }>
        }
      }
      return scope.frameProbe.rebasedMaterialFrameProbe(source)
    }, source)
    expect(result.cpu).toEqual(result.baseline)
    expect(
      Math.max(...result.gpu.map((value, i) => Math.abs(value - (result.baseline[i] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    await capture(`rebased-world-uv-${source}`, result)
  },
)
it.each(
  normalFrameCases.flatMap((name, index) =>
    (['nearest', 'linear'] as const).map(filter => ({ name, index, filter })),
  ),
)(
  '$name / $filter binds each normal layer encoding after filtering',
  async ({ name, index, filter }) => {
    const result = await page.evaluate(
      async ({ index, filter }) => {
        const scope = globalThis as unknown as {
          frameProbe: {
            normalFrameProbe(
              index: number,
              filter: 'nearest' | 'linear',
            ): Promise<{
              baseline: number[]
              cpu: number[]
              gpu: number[]
              diagnostics: { code: string }[]
            }>
          }
        }
        return scope.frameProbe.normalFrameProbe(index, filter)
      },
      { index, filter },
    )
    expect(result.diagnostics).toEqual([])
    expect(result.cpu).toEqual(result.baseline)
    expect(
      Math.max(...result.gpu.map((value, i) => Math.abs(value - (result.baseline[i] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    expect(new Set(result.gpu).size).toBeGreaterThan(20)
    await capture(`${name}-${filter}`, result)
  },
)
it.each(
  materialProgramCases().flatMap((item, index) =>
    (['nearest', 'linear'] as const).map(filter => ({ name: item.name, index, filter })),
  ),
)(
  '$name / $filter renders geometry and spatial texture samples in CPU/WebGL',
  async ({ index, filter, name }) => {
    const result = await page.evaluate(
      async ({ index, filter }) => {
        const scope = globalThis as unknown as {
          frameProbe: {
            materialFrameProbe(
              index: number,
              filter: 'nearest' | 'linear',
            ): Promise<{
              cpu: number[]
              gpu: number[]
              diagnostics: { code: string }[]
              triangles: number
            }>
          }
        }
        return scope.frameProbe.materialFrameProbe(index, filter)
      },
      { index, filter },
    )
    expect(result.triangles).toBe(2)
    expect(
      result.diagnostics.filter(
        item => item.code.includes('unresolved') || item.code.includes('unsupported'),
      ),
    ).toEqual([])
    // RGBA8 quantizes premultiplied color before the public straight-alpha conversion. Compare in
    // that storage space: dividing by a small alpha amplifies a one-byte rounding difference.
    const errors = result.cpu.map((value, index) => {
      const other = result.gpu[index] ?? 0
      if (index % 4 === 3) return Math.abs(value - other)
      const alphaIndex = index - (index % 4) + 3
      return Math.abs(
        (value * (result.cpu[alphaIndex] ?? 0)) / 255 -
          (other * (result.gpu[alphaIndex] ?? 0)) / 255,
      )
    })
    expect(
      Math.max(...errors),
      `different components=${errors.filter(value => value > 2).length}`,
    ).toBeLessThanOrEqual(2)
    expect(new Set(result.gpu).size).toBeGreaterThan(2)
    await capture(`${name}-${filter}`, result)
  },
)
