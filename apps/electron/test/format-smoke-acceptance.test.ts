import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildElectronFormatSmokeReceipt,
  readElectronFormatSmokePlan,
  summarizeElectronFormatSmokeAuthority,
  type ElectronFormatSmokeObservation,
  type ElectronFormatSmokePlan,
} from '../src/format-smoke-acceptance.js'

const authorityBytes = readFileSync(
  new URL('../../vscode/generated/format-smoke.v1.json', import.meta.url),
)
const electronAuthorityBytes = readFileSync(
  new URL('../generated/format-smoke.v1.json', import.meta.url),
)
const authority = JSON.parse(authorityBytes.toString('utf8')) as unknown
const authoritySha256 = createHash('sha256').update(authorityBytes).digest('hex')

const basename = (value: string): string => value.split(/[\\/]/u).filter(Boolean).at(-1) ?? value

const routeCodec = (item: { readonly route: readonly { readonly contributionId: string }[] }) =>
  item.route.at(-1)?.contributionId

const viewForStage = (stage: string): string => {
  switch (stage) {
    case 'raster':
      return 'image'
    case 'tree':
      return 'archive'
    case 'tree-text':
      return 'tree'
    case 'metadata-tree':
      return 'audio'
    case 'model-or-wireframe':
      return 'model'
    default:
      return stage
  }
}

const boundaryFor = (kind: string) => {
  switch (kind) {
    case 'sc2-casc-entry':
    case 'warzone-wz-entry':
      return 'product-container-entry' as const
    case 'sc2-install-file':
    case 'warzone-install-file':
      return 'container-file' as const
    default:
      return 'direct-file' as const
  }
}

const planForAuthority = (): ElectronFormatSmokePlan => {
  const summary = summarizeElectronFormatSmokeAuthority(authority)
  return {
    kind: 'x3.electron/format-smoke-plan',
    schemaVersion: 1,
    authoritySha256,
    cases: summary.included.map(item => {
      const boundary = boundaryFor(item.corpus.kind)
      return {
        caseId: item.id,
        fileName: basename(item.corpus.path ?? item.id),
        boundary,
        stage: item.stage,
        ...(boundary === 'product-container-entry'
          ? {
              parentPath: `C:/isolated/${basename(item.corpus.container ?? item.id)}`,
              entryPath: item.corpus.path,
            }
          : {}),
      }
    }),
  }
}

describe('Electron format-smoke acceptance authority', () => {
  it('requires each path-free runtime case to name its ratified stage', () => {
    const plan = planForAuthority()
    const first = plan.cases[0]
    if (first === undefined) throw new Error('missing included case')
    expect(() =>
      readElectronFormatSmokePlan({
        ...plan,
        cases: [{ ...first, stage: undefined }, ...plan.cases.slice(1)],
      }),
    ).toThrow(/stage/u)
  })

  it('keeps large product parents range-backed while scalar materialization stays at 64 MiB', () => {
    const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    expect(main).toContain('const MAXIMUM_SUBJECT_BYTES = 64 * 1024 * 1024')
    expect(main).toContain('const MAXIMUM_RANGE_BACKED_SUBJECT_BYTES = 256 * 1024 * 1024')
    expect(main).toContain('maxInputBytes: BigInt(MAXIMUM_RANGE_BACKED_SUBJECT_BYTES)')
    expect(main).toContain('maxScalarBytes: MAXIMUM_SUBJECT_BYTES')
  })

  it('keeps the Electron build input byte-identical to the generated authority', () => {
    expect(electronAuthorityBytes.equals(authorityBytes)).toBe(true)
  })

  it('consumes the current generated authority without caching the previous route inventory', () => {
    const summary = summarizeElectronFormatSmokeAuthority(authority)
    expect(summary.included.map(item => item.id)).toHaveLength(13)
    expect(summary.excluded.map(item => item.id)).toEqual(['document-odt'])
    expect(summary.packageIds).toEqual(['blizzard/starcraft2-suite', 'wz2100project/warzone-2100'])
    expect(summary.commonRoots.map(item => item.coordinate)).toEqual([
      'modkit/archives',
      'modkit/audio',
      'modkit/data',
      'modkit/documents',
      'modkit/images',
      'modkit/models',
      'modkit/vector',
      'modkit/video',
    ])
    expect(summary.externalRoots).toEqual([
      'blizzard/casc',
      'blizzard/common-formats',
      'blizzard/diablo',
      'blizzard/galaxy-language',
      'blizzard/models',
      'blizzard/mpq',
      'blizzard/starcraft2',
      'blizzard/warcraft-3',
      'wz2100project/warzone-2100',
    ])
    expect(summary.pwaFacilityRefusals.map(item => item.id)).toEqual([
      'casc-dds',
      'audio-wav',
      'audio-ogg',
      'model-m3',
    ])
    expect(summary.included.find(item => item.id === 'archive-mpq')?.route.at(-1)).toMatchObject({
      formatId: 'sc2-map',
      extensionId: 'blizzard/starcraft2',
      contributionId: 'blizzard/sc2-map',
    })
  })

  it('emits a path-free pass receipt only for exact planned corpus bytes and expected final routes', () => {
    const summary = summarizeElectronFormatSmokeAuthority(authority)
    const observations: ElectronFormatSmokeObservation[] = summary.included.map(item => {
      const boundary = boundaryFor(item.corpus.kind)
      return {
        entryName: basename(item.corpus.path ?? item.id),
        codecId: routeCodec(item),
        selectedRoute: item.route,
        bytes: item.corpus.bytes ?? 0,
        sha256: item.corpus.sha256 ?? '',
        views: [viewForStage(item.stage), 'hex'],
        stages: [
          { id: viewForStage(item.stage), state: 'ok' },
          { id: 'hex', state: 'ok' },
        ],
        panels: [
          { id: 'operations', state: 'ok' },
          { id: 'metadata', state: 'ok' },
        ],
        ...(boundary === 'product-container-entry'
          ? {
              container: {
                parentEntryName: basename(item.corpus.container ?? item.id),
                parentCodecId: item.route[0]?.contributionId,
                parentRoute: item.route.slice(0, 1),
                entryPath: item.corpus.path ?? '',
              },
            }
          : {}),
      }
    })
    const receipt = buildElectronFormatSmokeReceipt(authority, {
      authoritySha256,
      plan: planForAuthority(),
      renderer: {
        realmId: 'modkit.app/electron/renderer',
        facilities: ['gpu.webgl2', 'worker.module'],
      },
      observations,
    })
    expect(receipt.verdict).toBe('pass')
    expect(JSON.stringify(receipt)).not.toMatch(/[A-Z]:\\\\|C:\\\\|references\//u)
    expect(receipt.cases.find(item => item.id === 'model-m3')?.boundary).toMatchObject({
      kind: 'product-container-entry',
      routeScope: 'container-and-final-authority-steps',
    })
    expect(receipt.cases.find(item => item.id === 'model-m3')?.observed?.container).toMatchObject({
      parentCodecId: summary.included.find(item => item.id === 'model-m3')?.route[0]
        ?.contributionId,
    })
  })

  it('fails clearly when a required included case never opened in the product path', () => {
    const receipt = buildElectronFormatSmokeReceipt(authority, {
      authoritySha256,
      plan: planForAuthority(),
      renderer: {
        realmId: 'modkit.app/electron/renderer',
        facilities: ['gpu.webgl2', 'worker.module'],
      },
      observations: [],
    })
    expect(receipt.verdict).toBe('fail')
    expect(receipt.failures).toContainEqual(
      expect.objectContaining({
        code: 'x3.electron-format-smoke/case-not-opened',
        caseId: 'image-dds',
      }),
    )
  })

  it('fails a case whose edit arm hit the bounded timeout', () => {
    const summary = summarizeElectronFormatSmokeAuthority(authority)
    const first = summary.included[0]
    if (first === undefined) throw new Error('missing included case')
    const receipt = buildElectronFormatSmokeReceipt(authority, {
      authoritySha256,
      plan: planForAuthority(),
      renderer: {
        realmId: 'modkit.app/electron/renderer',
        facilities: ['gpu.webgl2', 'worker.module'],
      },
      observations: [
        {
          entryName: basename(first.corpus.path ?? first.id),
          codecId: routeCodec(first),
          bytes: first.corpus.bytes ?? 0,
          sha256: first.corpus.sha256 ?? '',
          views: [viewForStage(first.stage)],
          stages: [{ id: viewForStage(first.stage), state: 'ok' }],
          panels: [],
          editFallback: {
            code: 'x3.electron/edit-arm-timeout',
            reason: 'bounded pathological latency',
          },
        },
      ],
    })
    expect(receipt.failures).toContainEqual(
      expect.objectContaining({
        code: 'x3.electron-format-smoke/edit-arm-timeout',
        caseId: first.id,
      }),
    )
  })

  it('rejects materialized loose files for authority nested container entries', () => {
    const plan = planForAuthority()
    const downgraded: ElectronFormatSmokePlan = {
      ...plan,
      cases: plan.cases.map(item =>
        item.boundary === 'product-container-entry'
          ? {
              caseId: item.caseId,
              fileName: item.fileName,
              boundary: 'loose-materialized',
              stage: item.stage,
            }
          : item,
      ),
    }
    const receipt = buildElectronFormatSmokeReceipt(authority, {
      authoritySha256,
      plan: downgraded,
      renderer: {
        realmId: 'modkit.app/electron/renderer',
        facilities: ['gpu.webgl2', 'worker.module'],
      },
      observations: [],
    })
    expect(
      receipt.failures.filter(
        item => item.code === 'x3.electron-format-smoke/container-boundary-required',
      ),
    ).toHaveLength(5)
  })
})
