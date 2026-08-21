/** A foreign project installs packed public artifacts and reaches createModkit from its own cwd. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x3-library-install-'))
const tarballDirectory = join(temporaryRoot, 'tarballs')

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

function sh(command: string, args: readonly string[], cwd: string) {
  const needsShim = process.platform === 'win32' && (command === 'pnpm' || command === 'npm')
  const options = {
    cwd,
    encoding: 'utf8' as const,
    timeout: 300_000,
    env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
  }
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], options)
    : spawnSync(command, [...args], options)
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function pack(directory: string): string {
  mkdirSync(tarballDirectory, { recursive: true })
  const before = new Set(readdirSync(tarballDirectory))
  const result = sh('pnpm', ['pack', '--pack-destination', tarballDirectory], directory)
  expect(result.status, result.stderr).toBe(0)
  const created = readdirSync(tarballDirectory).find(
    file => file.endsWith('.tgz') && !before.has(file),
  )
  if (created === undefined) throw new Error(`pack produced no tarball for ${directory}`)
  return join(tarballDirectory, created)
}

describe('createModkit as a packed foreign-project dependency', () => {
  it(
    'packs core/sdk/vfs/host plus one extension, installs them cleanly, and opens a descriptor',
    { timeout: 360_000 },
    () => {
      const tarballs = [
        ...['core', 'sdk', 'vfs', 'host'].map(name => pack(join(repoRoot, 'packages', name))),
        pack(join(repoRoot, 'extensions', 'codec-kit', 'codec-kit')),
        pack(join(repoRoot, 'extensions', 'common', 'images')),
      ]
      const consumer = join(temporaryRoot, 'consumer')
      mkdirSync(consumer, { recursive: true })
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'modkit-library-consumer', private: true, type: 'module' }),
      )
      writeFileSync(
        join(consumer, 'sample.png'),
        readFileSync(join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')),
      )
      writeFileSync(
        join(consumer, 'open.mjs'),
        `import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createModkit } from '@modkitx-x3/host/node'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const extensionRoot = dirname(
  fileURLToPath(import.meta.resolve('modkit-extension-x3-images/package.json')),
)
const modkit = await createModkit({ extensions: [extensionRoot], roots: [projectRoot] })
const opened = await modkit.open(join(projectRoot, 'sample.png'))
try {
  if (opened.snapshot.state !== 'opened' || opened.session === undefined) {
    throw new Error('the packed library did not open sample.png')
  }
  const descriptor = await opened.session.descriptor()
  console.log(JSON.stringify({
    state: opened.snapshot.state,
    selected: opened.snapshot.selected.contributionId,
    variant: opened.snapshot.selected.variantId,
    extensions: modkit.extensionCoordinates,
    revision: descriptor.revision,
    sources: descriptor.dataSources.map(item => item.contract),
    operations: descriptor.operations.map(item => item.id),
  }))
} finally {
  await opened.close()
  await modkit.close()
}
`,
      )

      const install = sh(
        'npm',
        ['install', '--no-audit', '--no-fund', '--install-links=false', ...tarballs],
        consumer,
      )
      expect(install.status, install.stderr).toBe(0)
      const run = sh('node', ['open.mjs'], consumer)
      expect(run.status, run.stderr).toBe(0)
      const output = JSON.parse(run.stdout) as {
        readonly state: string
        readonly selected: string
        readonly variant: string
        readonly extensions: readonly string[]
        readonly revision: string
        readonly sources: readonly string[]
        readonly operations: readonly string[]
      }
      expect(output).toMatchObject({
        state: 'opened',
        selected: 'org.modkitx/image-png',
        variant: 'portable',
        extensions: ['org.modkitx/images'],
      })
      expect(output.revision).toMatch(/^provider-token:/u)
      expect(output.sources).toContain('common.view/raster-image-source')
      expect(output.operations).toContain('edit.field')
    },
  )
})
