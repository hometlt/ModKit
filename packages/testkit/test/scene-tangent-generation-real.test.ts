import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encodeRgbaPng } from '../../scene/src/output/png.js'
import {
  tangentCases,
  tangentExpected,
  type TangentFilter,
} from './fixtures/scene-tangent-generation.js'

interface Diagnostic {
  code: string
  message: string
  primitiveId?: string
}
interface Frame {
  cpu: number[]
  gpu: number[]
  cpuDiagnostics: Diagnostic[]
  gpuDiagnostics: Diagnostic[]
  triangles: number[]
}
interface Failure {
  cpu: { name: string; message: string } | null
  gpu: { name: string; message: string } | null
}
interface Probe {
  tangentFrameProbe(index: number, filter: TangentFilter): Promise<Frame>
  tangentFailureProbe(index: number, filter: TangentFilter): Promise<Failure>
}
let browser: Browser, page: Page
const evidence = process.env['MODKIT_TANGENT_FRAME_EVIDENCE_DIR']
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
    throw new Error('Chrome/Chromium required for tangent frame tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-tangent-generation.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'tangentProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('tangent frame probe missing')
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
            'Explicit scene tangentGeneration UV selection. Independent analytic quad T/B handedness, spatial RGB normal filtering and world Lambert equations. Covers UV0 default, selected UV1–4, nonuniform transform, authored TANGENT authority, degenerate UV diagnostics, missing UV errors, and distinct per-pass composite geometry. Does not claim automatic native M3 tangent-space inference.',
          tolerance:
            '2 RGBA8 units against independent per-pixel colors and full CPU/WebGL frames; errors and diagnostics checked separately.',
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
  }
})
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
    cpuDiagnostics: frame.cpuDiagnostics,
    gpuDiagnostics: frame.gpuDiagnostics,
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
  tangentCases.flatMap((item, index) =>
    (['nearest', 'linear'] as const).map(filter => ({ ...item, index, filter })),
  ),
)(
  '$name / $filter follows independent generated-tangent and lighting equations',
  async ({ name, index, filter, missingSelected, authored, basis, composite }) => {
    if (missingSelected && !authored) {
      const result = await page.evaluate(
        async ({ index, filter }) =>
          (globalThis as unknown as { tangentProbe: Probe }).tangentProbe.tangentFailureProbe(
            index,
            filter,
          ),
        { index, filter },
      )
      for (const provider of ['cpu', 'gpu'] as const)
        expect(result[provider]).toEqual({
          name: 'TypeError',
          message: 'primitive quad lacks TEXCOORD_1 for tangent generation',
        })
      return
    }
    const frame = await page.evaluate(
      async ({ index, filter }) =>
        (globalThis as unknown as { tangentProbe: Probe }).tangentProbe.tangentFrameProbe(
          index,
          filter,
        ),
      { index, filter },
    )
    await capture(`${name}-${filter}`, frame)
    expect(frame.triangles).toEqual(composite === undefined ? [2, 2] : [4, 4])
    for (const diagnostics of [frame.cpuDiagnostics, frame.gpuDiagnostics]) {
      if (basis === 'degenerate')
        expect(diagnostics).toEqual([
          {
            code: 'common.scene/tangent-generation-degenerate-uv',
            severity: 'warning',
            primitiveId: 'quad',
            message:
              'Tangent generation for TEXCOORD_1 used geometric fallback for 2 triangle(s) with a degenerate UV determinant.',
          },
        ])
      else expect(diagnostics).toEqual([])
    }
    expect(
      Math.max(...frame.cpu.map((value, index) => Math.abs(value - (frame.gpu[index] ?? 0)))),
    ).toBeLessThanOrEqual(2)
    for (let y = 5; y < 27; y++)
      for (let x = 5; x < 27; x++) {
        const expected = tangentExpected(index, filter, x, y)
        for (const [provider, pixels] of [
          ['cpu', frame.cpu],
          ['gpu', frame.gpu],
        ] as const)
          expected.forEach((value, channel) =>
            expect(
              Math.abs((pixels[(y * 32 + x) * 4 + channel] ?? -1000) - value),
              `${provider} pixel ${x},${y}, channel ${channel}`,
            ).toBeLessThanOrEqual(2),
          )
      }
  },
)
