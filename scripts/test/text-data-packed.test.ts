import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x3-text-data-packed-'))
const tarballDirectory = join(temporaryRoot, 'tarballs')

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

function sh(command: string, args: string[], cwd: string) {
  const needsShim = process.platform === 'win32' && (command === 'pnpm' || command === 'npm')
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
    : spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
      })
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
  if (!created) throw new Error(`pack produced no tarball for ${directory}`)
  return join(tarballDirectory, created)
}

function consumer(name: string): string {
  const directory = join(temporaryRoot, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name: `x3-text-data-${name}`, private: true, type: 'module' }),
  )
  return directory
}

function textFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...textFiles(path))
    else if (statSync(path).size <= 5_000_000) files.push(path)
  }
  return files
}

describe('13B packed text-data boundary', () => {
  it(
    'keeps parser dependencies in the extension and runs from a clean external install',
    { timeout: 360_000 },
    async () => {
      const platform = ['core', 'sdk', 'vfs', 'host'].map(name =>
        pack(join(repoRoot, 'packages', name)),
      )
      const extension = pack(join(repoRoot, 'extensions', 'common', 'text-data'))
      const alternate = pack(join(repoRoot, 'examples', 'modkit-extension-x3-alternate-xml'))
      const npmFlags = ['--no-audit', '--no-fund', '--install-links=false']

      const platformOnly = consumer('platform-only')
      const platformInstall = sh('npm', ['install', ...npmFlags, ...platform], platformOnly)
      expect(platformInstall.status, platformInstall.stderr).toBe(0)
      const platformRequire = createRequire(join(platformOnly, 'package.json'))
      const host = (await import(
        pathToFileURL(platformRequire.resolve('@modkitx-x3/host')).href
      )) as {
        resolveProvider(
          request: unknown,
          offers: readonly unknown[],
        ): { state: string; reason?: string }
      }
      const core = (await import(
        pathToFileURL(platformRequire.resolve('@modkitx-x3/core')).href
      )) as { contractId(value: string): string }
      expect(
        host.resolveProvider(
          {
            contract: { contract: core.contractId('common.text-data/json-syntax'), major: 1 },
            target: {
              environment: 'node',
              operatingSystem: 'windows',
              architecture: 'x64',
            },
          },
          [],
        ),
      ).toMatchObject({ state: 'unresolved', reason: 'no-offer' })

      const forbidden = ["'jsonc-parser'", "'smol-toml'", "'@rgrove/parse-xml'", "from 'yaml'"]
      for (const name of ['core', 'sdk', 'vfs', 'host']) {
        const packageRoot = join(platformOnly, 'node_modules', '@modkitx-x3', name)
        const combined = textFiles(packageRoot)
          .map(file => readFileSync(file, 'utf8'))
          .join('\n')
        for (const needle of forbidden) expect(combined, `${name}: ${needle}`).not.toContain(needle)
      }

      const external = consumer('external')
      const install = sh(
        'npm',
        ['install', ...npmFlags, ...platform, extension, alternate],
        external,
      )
      expect(install.status, install.stderr).toBe(0)
      const externalRequire = createRequire(join(external, 'package.json'))
      const publicEntry = (await import(
        pathToFileURL(externalRequire.resolve('modkit-extension-x3-text-data')).href
      )) as { contributionManifests: readonly string[] }
      expect(publicEntry.contributionManifests).toEqual(['./contributions/*.json'])
      const budget = {
        maxInputBytes: 1_000_000n,
        maxDepth: 64,
        maxNodes: 10_000,
        maxScalarBytes: 100_000,
        maxDiagnostics: 100,
      }
      const samples = [
        ['json', 'common.text-data/json-syntax', 'json', '{"x":1}'],
        ['jsonc', 'common.text-data/jsonc-syntax', 'jsonc', '{//c\n"x":1}'],
        ['xml', 'common.text-data/xml-syntax', 'xml-1.0', '<x/>'],
        ['yaml', 'common.text-data/yaml-syntax', 'yaml-1.2-core', 'x: 1\n'],
        ['toml', 'common.text-data/toml-syntax', 'toml-1.0', 'x = 1\n'],
        ['ini', 'common.text-data/ini-syntax', 'ini-basic', '[x]\ny=1\n'],
        ['csv', 'common.text-data/csv-syntax', 'csv-rfc4180', 'x,y\n1,2\n'],
        ['tsv', 'common.text-data/tsv-syntax', 'tsv-iana', 'x\ty\n1\t2\n'],
      ] as const
      for (const [format, contract, dialect, text] of samples) {
        const providerModule = (await import(
          pathToFileURL(
            externalRequire.resolve(`modkit-extension-x3-text-data/formats/${format}/provider`),
          ).href
        )) as {
          createProvider(selection: { contract: string }): {
            parse(request: unknown): Promise<{ state: string }>
          }
        }
        expect(
          await providerModule
            .createProvider({ contract })
            .parse({ input: { text }, dialect, budget }),
          contract,
        ).toMatchObject({ state: 'ok' })
      }

      const alternateModule = (await import(
        pathToFileURL(externalRequire.resolve('modkit-extension-x3-alternate-xml/runtime')).href
      )) as {
        createProvider(selection: { contract: string }): {
          parse(request: unknown): Promise<{ state: string }>
        }
      }
      expect(
        await alternateModule
          .createProvider({ contract: 'common.text-data/xml-syntax' })
          .parse({ input: { text: '<alternate>ok</alternate>' }, dialect: 'xml-1.0', budget }),
      ).toMatchObject({ state: 'ok' })

      const installed = JSON.parse(
        readFileSync(externalRequire.resolve('modkit-extension-x3-text-data/package.json'), 'utf8'),
      ) as { dependencies: Record<string, string> }
      expect(Object.keys(installed.dependencies).sort()).toEqual([
        '@rgrove/parse-xml',
        'jsonc-parser',
        'smol-toml',
        'yaml',
      ])
    },
  )
})
