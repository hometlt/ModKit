import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const extensionRoot = join(repoRoot, 'examples', 'modkit-extension-x3-plain-text')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x3-a8-packed-'))
const tarballDirectory = join(temporaryRoot, 'tarballs')

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

function sh(command: string, args: string[], cwd: string) {
  const needsShim = process.platform === 'win32' && (command === 'pnpm' || command === 'npm')
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 240_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
    : spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 240_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function pack(directory: string): string {
  mkdirSync(tarballDirectory, { recursive: true })
  const before = new Set(readdirSync(tarballDirectory))
  const result = sh('pnpm', ['pack', '--pack-destination', tarballDirectory], directory)
  expect(result.status, result.stderr).toBe(0)
  const created = readdirSync(tarballDirectory)
    .filter(file => file.endsWith('.tgz') && !before.has(file))
    .at(0)
  if (!created) throw new Error(`pack produced no tarball for ${directory}`)
  return join(tarballDirectory, created)
}

function emptyConsumer(name: string): string {
  const directory = join(temporaryRoot, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name: `x3-a8-${name}`, private: true, type: 'module' }),
  )
  return directory
}

describe('A-8 packed/direct-library/dependency-boundary proof', () => {
  it(
    'installs packed artifacts, runs direct without host, and requires host only at runtime boundary',
    { timeout: 300_000 },
    async () => {
      const core = pack(join(repoRoot, 'packages/core'))
      const sdk = pack(join(repoRoot, 'packages/sdk'))
      const vfs = pack(join(repoRoot, 'packages/vfs'))
      const host = pack(join(repoRoot, 'packages/host'))
      const extension = pack(extensionRoot)
      const npmFlags = ['--no-audit', '--no-fund', '--install-links=false']

      const directConsumer = emptyConsumer('direct')
      const directInstall = sh(
        'npm',
        ['install', '--omit=optional', ...npmFlags, core, sdk, extension],
        directConsumer,
      )
      expect(directInstall.status, directInstall.stderr).toBe(0)
      const directRequire = createRequire(join(directConsumer, 'package.json'))
      expect(() => directRequire.resolve('@modkitx-x3/host')).toThrow()
      const direct = (await import(
        pathToFileURL(directRequire.resolve('modkit-extension-x3-plain-text/direct')).href
      )) as {
        sampleLooksText(bytes: Uint8Array): { text: boolean; reason: string }
      }
      expect(direct.sampleLooksText(new TextEncoder().encode('packed text\n'))).toMatchObject({
        text: true,
        reason: 'utf8-text',
      })
      expect(direct.sampleLooksText(new Uint8Array([0x41, 0, 0x42]))).toMatchObject({
        text: false,
        reason: 'nul-byte',
      })
      await expect(
        import(pathToFileURL(directRequire.resolve('modkit-extension-x3-plain-text/runtime')).href),
      ).rejects.toThrow(/@modkitx-x3\/host/u)

      const hostedConsumer = emptyConsumer('hosted')
      const hostedInstall = sh(
        'npm',
        ['install', ...npmFlags, core, sdk, vfs, host, extension],
        hostedConsumer,
      )
      expect(hostedInstall.status, hostedInstall.stderr).toBe(0)
      const hostedRequire = createRequire(join(hostedConsumer, 'package.json'))
      const runtime = (await import(
        pathToFileURL(hostedRequire.resolve('modkit-extension-x3-plain-text/runtime')).href
      )) as { createCodec(): unknown }
      expect(runtime.createCodec()).toMatchObject({
        probe: expect.any(Function),
        open: expect.any(Function),
      })

      const installedPackage = JSON.parse(
        readFileSync(hostedRequire.resolve('modkit-extension-x3-plain-text/package.json'), 'utf8'),
      ) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> }
      expect(Object.keys(installedPackage.dependencies).sort()).toEqual([
        '@modkitx-x3/core',
        '@modkitx-x3/sdk',
      ])
      expect(installedPackage.peerDependencies).toEqual({ '@modkitx-x3/host': '*' })
    },
  )
})
