import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const fixture = join(repository, 'examples', 'modkit-extension-x3-synthetic-editor')
const temporary = mkdtempSync(join(tmpdir(), 'x3-packed-editor-'))

afterAll(() => rmSync(temporary, { recursive: true, force: true }))

function run(command: string, args: readonly string[], cwd: string) {
  const executable =
    process.platform === 'win32' && (command === 'pnpm' || command === 'npm')
      ? (process.env['COMSPEC'] ?? 'cmd.exe')
      : command
  const commandArgs = executable === command ? [...args] : ['/d', '/s', '/c', command, ...args]
  return spawnSync(executable, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 240_000,
    env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
  })
}

describe('13D packed external editor', () => {
  it(
    'installs only public tarballs and validates/loads editor plus writer without host changes',
    { timeout: 300_000 },
    () => {
      const tarballDirectory = join(temporary, 'tarballs')
      for (const name of ['core', 'sdk', 'vfs', 'host', 'ui']) {
        const packed = run(
          'pnpm',
          ['pack', '--pack-destination', tarballDirectory],
          join(repository, 'packages', name),
        )
        expect(packed.status, packed.stderr).toBe(0)
      }
      const tarballs = readdirSync(tarballDirectory)
        .filter(name => name.endsWith('.tgz'))
        .map(name => join(tarballDirectory, name))
      expect(tarballs).toHaveLength(5)

      const installed = join(temporary, 'extension')
      cpSync(fixture, installed, { recursive: true })
      const install = run(
        'npm',
        ['install', '--no-audit', '--no-fund', '--install-links=false', ...tarballs],
        installed,
      )
      expect(install.status, install.stderr).toBe(0)
      const executed = run('node', ['runner.mjs'], installed)
      expect(executed.status, executed.stderr).toBe(0)
      expect(JSON.parse(executed.stdout)).toEqual({ editorAbi: 1, writerAbi: 1 })
    },
  )
})
