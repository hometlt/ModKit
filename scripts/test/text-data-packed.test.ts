import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
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
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x3-text-extensions-packed-'))
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
    JSON.stringify({ name: `x3-text-extension-${name}`, private: true, type: 'module' }),
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

const groups = [
  {
    directory: 'text-json',
    packageName: 'modkit-extension-x3-text-json',
    formats: ['json', 'jsonc'],
    dependencies: ['@modkitx-x3/codec-kit', 'jsonc-parser'],
    samples: [
      ['json', 'common.text-data/json-syntax', 'json', '{"x":1}'],
      ['jsonc', 'common.text-data/jsonc-syntax', 'jsonc', '{//c\n"x":1}'],
    ],
  },
  {
    directory: 'text-delimited',
    packageName: 'modkit-extension-x3-text-delimited',
    formats: ['csv', 'tsv'],
    dependencies: ['@modkitx-x3/codec-kit'],
    samples: [
      ['csv', 'common.text-data/csv-syntax', 'csv-rfc4180', 'x,y\n1,2\n'],
      ['tsv', 'common.text-data/tsv-syntax', 'tsv-iana', 'x\ty\n1\t2\n'],
    ],
  },
  {
    directory: 'text-ini',
    packageName: 'modkit-extension-x3-text-ini',
    formats: ['ini'],
    dependencies: ['@modkitx-x3/codec-kit'],
    samples: [['ini', 'common.text-data/ini-syntax', 'ini-basic', '[x]\ny=1\n']],
  },
  {
    directory: 'text-xml',
    packageName: 'modkit-extension-x3-text-xml',
    formats: ['xml'],
    dependencies: ['@modkitx-x3/codec-kit', '@rgrove/parse-xml'],
    samples: [['xml', 'common.text-data/xml-syntax', 'xml-1.0', '<x/>']],
  },
  {
    directory: 'text-yaml',
    packageName: 'modkit-extension-x3-text-yaml',
    formats: ['yaml'],
    dependencies: ['@modkitx-x3/codec-kit', 'yaml'],
    samples: [['yaml', 'common.text-data/yaml-syntax', 'yaml-1.2-core', 'x: 1\n']],
  },
  {
    directory: 'text-toml',
    packageName: 'modkit-extension-x3-text-toml',
    formats: ['toml'],
    dependencies: ['@modkitx-x3/codec-kit', 'smol-toml'],
    samples: [['toml', 'common.text-data/toml-syntax', 'toml-1.0', 'x = 1\n']],
  },
] as const

const parserPackages = ['jsonc-parser', '@rgrove/parse-xml', 'yaml', 'smol-toml'] as const
const npmFlags = ['--no-audit', '--no-fund', '--install-links=false']
const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 100_000,
  maxDiagnostics: 100,
}

describe('13B packed text extension boundaries', () => {
  it(
    'installs every format family independently with only its own parser dependency',
    { timeout: 600_000 },
    async () => {
      const platform = ['core', 'sdk', 'vfs', 'host'].map(name =>
        pack(join(repoRoot, 'packages', name)),
      )
      const codecKit = pack(join(repoRoot, 'packages', 'codec-kit'))
      const tarballs = new Map(
        groups.map(group => [
          group.packageName,
          pack(join(repoRoot, 'extensions', 'common', 'data', group.directory)),
        ]),
      )

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
            target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
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

      for (const group of groups) {
        const external = consumer(group.directory)
        const extension = tarballs.get(group.packageName)
        if (extension === undefined) throw new Error(`missing tarball for ${group.packageName}`)
        const install = sh(
          'npm',
          ['install', ...npmFlags, ...platform, codecKit, extension],
          external,
        )
        expect(install.status, install.stderr).toBe(0)
        const externalRequire = createRequire(join(external, 'package.json'))
        const publicEntry = (await import(
          pathToFileURL(externalRequire.resolve(group.packageName)).href
        )) as { contributionManifests: readonly string[] }
        expect(publicEntry.contributionManifests).toEqual(['./contributions/*.json'])
        const formatCatalog = (await import(
          pathToFileURL(externalRequire.resolve(`${group.packageName}/formats`)).href
        )) as { TEXT_FORMATS: readonly string[] }
        expect(formatCatalog.TEXT_FORMATS).toEqual(group.formats)

        for (const [format, contract, dialect, text] of group.samples) {
          const providerModule = (await import(
            pathToFileURL(
              externalRequire.resolve(`${group.packageName}/formats/${format}/provider`),
            ).href
          )) as {
            createProvider(selection: { contract: string }): Promise<{
              readonly value: { parse(request: unknown): Promise<{ state: string }> }
              release(): Promise<void>
            }>
          }
          const providerLease = await providerModule.createProvider({ contract })
          try {
            expect(
              await providerLease.value.parse({ input: { text }, dialect, budget }),
              contract,
            ).toMatchObject({ state: 'ok' })
          } finally {
            await providerLease.release()
          }
        }

        const installed = JSON.parse(
          readFileSync(externalRequire.resolve(`${group.packageName}/package.json`), 'utf8'),
        ) as { dependencies: Record<string, string> }
        expect(Object.keys(installed.dependencies).sort()).toEqual([...group.dependencies].sort())
        for (const parser of parserPackages) {
          const parserPackageJson = join(
            external,
            'node_modules',
            ...parser.split('/'),
            'package.json',
          )
          if (group.dependencies.includes(parser as never)) {
            expect(existsSync(parserPackageJson), `${group.packageName} omitted ${parser}`).toBe(
              true,
            )
          } else {
            expect(existsSync(parserPackageJson), `${group.packageName} leaked ${parser}`).toBe(
              false,
            )
          }
        }
      }
    },
  )
})
