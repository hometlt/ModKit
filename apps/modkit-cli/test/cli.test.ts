import { spawnSync } from 'node:child_process'
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
})
