import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface ApplicationRow {
  readonly id: string
  readonly support: string
  readonly testedSurface: string
  readonly evidenceLevel: string
  readonly verification: readonly string[]
  readonly evidence: readonly string[]
  readonly notClaimed: readonly string[]
}

interface HostMatrix {
  readonly schemaVersion: number
  readonly scope: string
  readonly validatedTarget: {
    readonly operatingSystem: string
    readonly nodePlatform: string
    readonly architecture: string
  }
  readonly applications: readonly ApplicationRow[]
  readonly unvalidatedTargets: readonly {
    readonly operatingSystem: string
    readonly architecture: string
    readonly status: string
  }[]
  readonly releaseBoundary: {
    readonly kind: string
    readonly namedBacklog: readonly string[]
    readonly notClaimed: readonly string[]
  }
}

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const matrixPath = resolve(repositoryRoot, 'reports/block20/supported-os-host-matrix.json')
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as HostMatrix

const EXPECTED_APPLICATIONS = [
  'automation-host',
  'cli',
  'electron',
  'pwa',
  'server',
  'vscode',
] as const

describe('Block 20 supported OS and host matrix', () => {
  it('limits the local GA claim to the Windows x64 machine that was actually exercised', () => {
    expect(matrix).toMatchObject({
      schemaVersion: 1,
      scope: 'focused-product-local-ga',
      validatedTarget: {
        operatingSystem: 'windows',
        nodePlatform: 'win32',
        architecture: 'x64',
      },
      releaseBoundary: { kind: 'local-source-ga' },
    })
    expect(matrix.unvalidatedTargets).toEqual([
      { operatingSystem: 'linux', architecture: 'x64', status: 'not-run' },
      { operatingSystem: 'macos', architecture: 'arm64-or-x64', status: 'not-run' },
    ])
    expect(matrix.releaseBoundary.notClaimed).toEqual(
      expect.arrayContaining([
        'public release readiness',
        'signed native installers',
        'Linux or macOS support',
      ]),
    )
    expect(matrix.releaseBoundary.namedBacklog).toEqual([
      'platform/release/authenticode-signing',
      'platform/release/packaged-installers',
      'platform/release/public-pwa-deployment',
    ])
  })

  it('names exactly the six GA applications and gives every claim an executable check', () => {
    expect(matrix.applications.map(row => row.id)).toEqual(EXPECTED_APPLICATIONS)
    for (const row of matrix.applications) {
      expect(row.support).toBe('supported-local-ga')
      expect(row.testedSurface.length).toBeGreaterThan(20)
      expect(row.evidenceLevel.length).toBeGreaterThan(10)
      expect(row.verification.length).toBeGreaterThan(0)
      expect(row.verification.every(command => command.startsWith('pnpm '))).toBe(true)
      expect(row.evidence.length).toBeGreaterThan(0)
      expect(row.notClaimed.length).toBeGreaterThan(0)
      for (const path of row.evidence) expect(existsSync(resolve(repositoryRoot, path))).toBe(true)
    }
  })

  it('records the real-process proofs without upgrading headless Electron to a GUI claim', () => {
    const byId = new Map(matrix.applications.map(row => [row.id, row]))
    expect(byId.get('cli')?.evidenceLevel).toBe('current-source-live-process')
    expect(byId.get('pwa')?.evidenceLevel).toBe('current-source-live-browser')
    expect(byId.get('vscode')?.evidenceLevel).toBe(
      'recorded-live-editor-and-current-source-contracts',
    )
    expect(byId.get('electron')?.evidenceLevel).toBe('current-source-headless-composition')
    expect(byId.get('electron')?.notClaimed).toContain('a launched packaged Electron GUI')

    const cliTest = readFileSync(
      resolve(repositoryRoot, 'apps/modkit-cli/test/cli.test.ts'),
      'utf8',
    )
    const pwaTest = readFileSync(resolve(repositoryRoot, 'apps/web/test/boot.test.ts'), 'utf8')
    const electronTest = readFileSync(
      resolve(repositoryRoot, 'apps/electron/test/subject-open-smoke.test.ts'),
      'utf8',
    )
    expect(cliTest).toContain('spawnSync(process.execPath')
    expect(pwaTest).toContain('chromium.launch')
    expect(electronTest).toContain('opened headlessly')

    const vscodeReceipt = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'reports/vscode-smoke/receipt.json'), 'utf8'),
    ) as {
      readonly environment: { readonly os: string }
      readonly runner: { readonly exitCode: number; readonly editorExited: boolean }
      readonly summary: { readonly allPassed: boolean }
    }
    expect(vscodeReceipt.environment.os).toMatch(/^win32 .* x64$/u)
    expect(vscodeReceipt.runner).toEqual({ exitCode: 0, editorExited: true })
    expect(vscodeReceipt.summary.allPassed).toBe(true)
  })
})
