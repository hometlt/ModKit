import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(appDir, 'dist', 'main.js')
const fixtures = join(appDir, 'test', 'fixtures')

function run(args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('modkit validate (S0 acceptance)', () => {
  it('validates the fixture extension; unknown contract stays inspectable, not executable', () => {
    const { status, stdout } = run(['validate', join(fixtures, 'valid-extension'), '--json'])
    expect(status).toBe(0)
    const report = JSON.parse(stdout) as {
      ok: boolean
      container: string
      extension: { publisher: string; id: string; version: string }
      contributions: { path: string; specState: string; id?: string }[]
    }
    expect(report.ok).toBe(true)
    expect(report.container).toBe('package-json')
    // inherited npm version checked (S0 acceptance)
    expect(report.extension).toEqual({ publisher: 'org.example', id: 'greeter', version: '1.2.0' })
    expect(report.contributions).toEqual([
      {
        path: 'contributions/greeter.json',
        specState: 'unknown-contract',
        id: 'org.example/greeter-plain',
      },
    ])
  })

  it('both authored containers = validation failure with the packaging-error code', () => {
    const { status, stdout } = run(['validate', join(fixtures, 'both-containers')])
    expect(status).toBe(1)
    expect(stdout).toContain('x3.sdk/two-authored-containers')
  })

  it('usage and IO failures exit 2', () => {
    expect(run([]).status).toBe(2)
    expect(run(['validate']).status).toBe(2)
    expect(run(['validate', join(fixtures, 'does-not-exist')]).status).toBe(2)
  })

  it('scaffolds the four-concept codec golden path without overwriting a target', () => {
    const parent = mkdtempSync(join(tmpdir(), 'x3-codec-scaffold-'))
    const target = join(parent, 'plain-text')
    const created = run(['create', 'codec', target, '--id', 'org.example/plain-text'])
    expect(created.status).toBe(0)
    const metrics = JSON.parse(readFileSync(join(target, 'golden-path.json'), 'utf8')) as {
      stepsToFirstGreen: number
      filesTouched: number
      conceptsRequired: string[]
    }
    expect(metrics).toEqual({
      stepsToFirstGreen: 5,
      filesTouched: 5,
      conceptsRequired: ['Subject', 'Contribution', 'Contract', 'Operation'],
      timeToBadgeMs: null,
    })
    expect(run(['validate', target]).status).toBe(0)
    expect(run(['create', 'codec', target, '--id', 'org.example/plain-text']).status).toBe(2)
  })

  it('explains candidates, rejections, and the selected logical offer as assertable JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'x3-explain-'))
    const fixture = join(root, 'resolution.json')
    writeFileSync(
      fixture,
      JSON.stringify({
        request: {
          contract: { contract: 'org.example/service', major: 1, range: '^1.1' },
          target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
        },
        offers: [
          {
            kind: 'primary',
            extensionId: 'org.example/good-extension',
            extensionVersion: '1.0.0',
            providerId: 'org.example/good',
            runtimeVariant: 'node',
            target: { environments: ['node'] },
            provides: [
              {
                offerId: 'default',
                contract: 'org.example/service',
                major: 1,
                version: '1.2.0',
              },
            ],
          },
          {
            kind: 'primary',
            extensionId: 'org.example/old-extension',
            extensionVersion: '1.0.0',
            providerId: 'org.example/old',
            runtimeVariant: 'node',
            target: { environments: ['node'] },
            provides: [
              {
                offerId: 'legacy',
                contract: 'org.example/service',
                major: 1,
                version: '1.0.0',
              },
            ],
          },
        ],
      }),
    )
    const result = run(['explain', fixture, '--json'])
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as {
      candidates: { providerId: string; outcome: string; reason?: string }[]
      result: { state: string; selected: { offer: { providerId: string } } }
    }
    expect(report.candidates).toEqual([
      expect.objectContaining({ providerId: 'org.example/good', outcome: 'selected' }),
      expect.objectContaining({
        providerId: 'org.example/old',
        outcome: 'rejected',
        reason: 'version-incompatible',
      }),
    ])
    expect(report.result.selected.offer.providerId).toBe('org.example/good')
  })
})
