import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const cli = resolve(import.meta.dirname, '../dist/main.js')
let scratch: string
let inert: string
let valid: string
let broken: string
let input: string
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'modkit-cli-admission-'))
  inert = join(scratch, 'ordinary-package')
  valid = join(scratch, 'valid-extension')
  broken = join(scratch, 'broken-extension')
  input = join(scratch, 'input.json')
  await mkdir(inert)
  await writeFile(join(inert, 'package.json'), '{"name":"ordinary-package"}')
  await writeFile(input, '{}')
  await cp(resolve(import.meta.dirname, 'fixtures/valid-extension'), valid, { recursive: true })
  await cp(valid, broken, { recursive: true })
  const manifest = {
    name: '@fixture/broken-extension',
    version: '1.0.0',
    license: 'MIT',
    modkit: {
      schemaVersion: 1,
      publisher: 'zz.fixture',
      id: 'broken',
      contributionManifests: ['./contributions/*.json'],
    },
  }
  await writeFile(join(broken, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(broken, 'contributions/greeter.json'), '{"schemaVersion":1}')
})
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

interface Reply {
  readonly diagnostics?: readonly { readonly code: string; readonly severity: string }[]
  readonly result?: {
    readonly diagnostics?: Reply['diagnostics']
    readonly summary?: { readonly discovered: number }
  }
  readonly extensions?: readonly { readonly extension: { readonly id: string } }[]
}

function run(args: readonly string[]): Reply {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(1)
  return JSON.parse(result.stdout) as Reply
}

describe('CLI admission uses every explicit root before any command executes', () => {
  it.each(['validate', 'open', 'run', 'edit', 'project.validate', 'operations', 'invoke'])(
    '%s refuses a directory without an authored extension, even with built-ins present',
    verb => {
      const extension = ['--ext', inert]
      const nonexistent = join(scratch, 'never-open.uvw.json')
      const args =
        verb === 'validate'
          ? ['validate', inert, '--json']
          : verb === 'open'
            ? ['open', nonexistent, ...extension, '--json']
            : verb === 'run' || verb === 'edit'
              ? [
                  'run',
                  verb === 'edit' ? 'subject.edit' : 'subject.inspect',
                  nonexistent,
                  ...extension,
                  '--format',
                  'protocol-json',
                ]
              : verb === 'project.validate'
                ? ['project.validate', scratch, ...extension, '--format', 'json']
                : verb === 'operations'
                  ? ['operations', ...extension, '--format', 'protocol-json']
                  : [
                      'invoke',
                      'fixture.echo',
                      ...extension,
                      '--input',
                      input,
                      '--format',
                      'protocol-json',
                    ]
      const result = run(args)
      const diagnostics = result.diagnostics ?? result.result?.diagnostics
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'x3.host/extension-not-an-extension' }),
        ]),
      )
      expect(JSON.stringify(diagnostics)).toContain(inert)
      if (verb === 'project.validate') expect(result.result?.summary?.discovered).toBe(0)
    },
  )

  it.each(['open', 'run', 'project.validate', 'operations'])(
    '%s reports an invalid contribution in a later extension',
    verb => {
      const extension = ['--ext', valid, '--ext', broken]
      const nonexistent = join(scratch, 'never-open.uvw.json')
      const args =
        verb === 'open'
          ? ['open', nonexistent, ...extension, '--json']
          : verb === 'run'
            ? ['run', 'subject.inspect', nonexistent, ...extension, '--format', 'protocol-json']
            : verb === 'project.validate'
              ? ['project.validate', scratch, ...extension, '--format', 'json']
              : ['operations', ...extension, '--format', 'protocol-json']
      const result = run(args)
      const diagnostics = result.diagnostics ?? result.result?.diagnostics
      expect(diagnostics?.some(item => item.severity === 'error')).toBe(true)
      expect(JSON.stringify(diagnostics)).toContain(broken)
      expect(JSON.stringify(diagnostics)).toContain('greeter.json')
      if (verb === 'open')
        expect(result.extensions?.some(item => item.extension.id === 'broken')).toBe(true)
    },
  )

  it('reports unreadable and duplicate roots together instead of hiding the later failure', () => {
    const result = run([
      'open',
      input,
      '--ext',
      valid,
      '--ext',
      valid,
      '--ext',
      join(scratch, 'missing'),
      '--json',
    ])
    expect(result.diagnostics?.map(item => item.code)).toEqual(
      expect.arrayContaining([
        'x3.host/extension-coordinate-conflict',
        'x3.host/extension-root-unreadable',
      ]),
    )
  })
})
