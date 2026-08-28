import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'

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
      timeToBadgeMs: number
    }
    expect(metrics).toMatchObject({
      stepsToFirstGreen: 5,
      filesTouched: 5,
      conceptsRequired: ['Subject', 'Contribution', 'Contract', 'Operation'],
    })
    expect(metrics.timeToBadgeMs).toBeGreaterThan(0)
    expect(metrics.timeToBadgeMs).toBeLessThanOrEqual(20 * 60 * 1000)
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

describe('modkit open (S7): the product open path of the CLI', () => {
  const repositoryRoot = join(appDir, '..', '..')
  const images = join(repositoryRoot, 'extensions', 'common', 'images')
  const png = join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')
  const starcraft2 = join(repositoryRoot, 'extensions', 'blizzard', 'starcraft2')
  const sc2Map = join(
    repositoryRoot,
    'packages',
    'testkit',
    'test',
    'fixtures',
    'mk2-synthetic',
    'minimal.SC2Map',
  )
  const sc2Campaign = join(
    repositoryRoot,
    'packages',
    'testkit',
    'test',
    'fixtures',
    'mk2-synthetic',
    'minimal.SC2Campaign',
  )

  it('opens a real PNG worker-brokered with a linked root, prints the selection and exits 0; the process ends', () => {
    const { status, stdout } = run(['open', png, '--ext', images, '--json'])
    expect(status).toBe(0)
    const report = JSON.parse(stdout) as {
      state: string
      selected: { contributionId: string; variantId: string }
      descriptor: { dataSources: { contract: string }[] }
      candidates: { variantId: string; state: string }[]
      diagnostics: { code: string }[]
    }
    expect(report.state).toBe('opened')
    expect(report.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    expect(report.descriptor.dataSources.map(item => item.contract)).toContain(
      'common.view/byte-range-source',
    )
    expect(report.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    // a linked root is never trusted in-process without --trust
    expect(report.candidates.find(item => item.variantId === 'trusted-node')?.state).toBe(
      'rejected',
    )
    // the human rendering names the boundary
    expect(run(['open', png, '--ext', images]).stdout).toContain('· worker-brokered')
  }, 60_000)

  it('opens the pinned SC2Map through the CLI linked-root contract', () => {
    const { status, stdout } = run(['open', sc2Map, '--ext', starcraft2, '--json'])
    expect(status).toBe(0)
    const report = JSON.parse(stdout) as {
      state: string
      selected: { contributionId: string; variantId: string }
      descriptor: {
        identity: { formatId: string }
        traits: { id: string; state: string; parameters?: Record<string, unknown> }[]
        dataSources: { contract: string; major: number }[]
      }
      candidates: { variantId: string; state: string }[]
      diagnostics: { code: string }[]
    }
    expect(report.state).toBe('opened')
    expect(report.selected).toMatchObject({
      contributionId: 'org.modkitx/sc2-map',
      variantId: 'portable',
    })
    expect(report.descriptor.identity.formatId).toBe('sc2-map')
    expect(report.descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'game.map', parameters: { packed: true, documents: 6 } }),
        expect.objectContaining({ id: 'container.entries', parameters: { count: 5 } }),
        expect.objectContaining({ id: 'content.scripts', parameters: { files: 1 } }),
      ]),
    )
    expect(
      report.descriptor.dataSources.map(item => `${item.contract}@${item.major}`).sort(),
    ).toEqual([
      'common.view/byte-range-source@1',
      'common.view/namespace-entry-source@1',
      'common.view/tree-data-source@1',
    ])
    expect(report.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    expect(report.candidates.find(item => item.variantId === 'trusted-node')?.state).toBe(
      'rejected',
    )
    proves({
      capabilityId: 'format/sc2-map/open-inspect',
      operation: 'read',
      note: 'the CLI opens the pinned packed SC2Map through an explicit linked extension root',
    })
  }, 60_000)

  it('selects the semantic SC2Campaign codec through the CLI linked-root contract', () => {
    const { status, stdout } = run(['open', sc2Campaign, '--ext', starcraft2, '--json'])
    expect(status).toBe(0)
    const report = JSON.parse(stdout) as {
      state: string
      selected: { contributionId: string; variantId: string }
      descriptor: {
        identity: { formatId: string }
        traits: { id: string; state: string; parameters?: Record<string, unknown> }[]
      }
    }
    expect(report.state).toBe('opened')
    expect(report.selected).toMatchObject({
      contributionId: 'org.modkitx/sc2-campaign',
      variantId: 'portable',
    })
    expect(report.descriptor.identity.formatId).toBe('sc2-campaign')
    expect(report.descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'container.entries', parameters: { count: 9 } }),
        expect.objectContaining({ id: 'game.catalog', parameters: { files: 1 } }),
        expect.objectContaining({ id: 'game.layout', parameters: { files: 1 } }),
        expect.objectContaining({ id: 'game.localization', parameters: { files: 1 } }),
      ]),
    )
  }, 60_000)

  it('exits 1 for a subject no linked codec claims, 2 for usage and IO failures', () => {
    const garbage = join(mkdtempSync(join(tmpdir(), 'x3-open-')), 'garbage.bin')
    writeFileSync(garbage, 'not an image at all\n')
    const unresolved = run(['open', garbage, '--ext', images])
    expect(unresolved.status).toBe(1)
    expect(unresolved.stdout).toContain('UNRESOLVED')
    expect(run(['open', png]).status).toBe(2)
    expect(run(['open', png, '--ext', images, '--intent', 'thumbnail']).status).toBe(2)
    expect(run(['open', join(appDir, 'does-not-exist.png'), '--ext', images]).status).toBe(2)
  }, 60_000)
})

describe('focused Product GA tools use shared host contracts', () => {
  const repositoryRoot = join(appDir, '..', '..')
  const images = join(repositoryRoot, 'extensions', 'common', 'images')
  const starcraft2 = join(repositoryRoot, 'extensions', 'blizzard', 'starcraft2')
  const png = join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')
  const galaxy = join(
    repositoryRoot,
    'packages',
    'testkit',
    'test',
    'fixtures',
    'mk2-synthetic',
    'minimal.galaxy',
  )

  it('validates a real Galaxy script through the stable shared-command protocol', () => {
    const result = run([
      'run',
      'subject.validate',
      galaxy,
      '--ext',
      starcraft2,
      '--format',
      'protocol-json',
    ])
    expect(result.status).toBe(0)
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string
      request: { schemaVersion: string; command: string; input: { subject: string } }
      result: {
        state: string
        command: string
        data: { outputKind: string; report: unknown }
        diagnostics: { code: string }[]
      }
    }
    expect(receipt.schemaVersion).toBe('modkit-command-protocol-1')
    expect(receipt.request).toMatchObject({
      schemaVersion: 'modkit-command-protocol-1',
      command: 'subject.validate',
      input: { subject: galaxy },
    })
    expect(receipt.result).toMatchObject({
      state: 'ok',
      command: 'subject.validate',
      data: { outputKind: 'none', report: null },
    })
    expect(receipt.result.diagnostics.map(item => item.code)).toContain(
      'x3.host/worker-shared-process',
    )
    proves({
      capabilityId: 'platform/tools/ga-priority',
      operation: 'read',
      note: 'the CLI validates positive Galaxy source through subject.validate and emits the stable command receipt',
    })
  }, 60_000)

  it('converts PNG pixels to an exported rgba8 artifact through subject.convert', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'x3-cli-png-convert-')), 'favicon.rgba')
    const result = run([
      'run',
      'subject.convert',
      png,
      '--ext',
      images,
      '--target',
      'rgba8',
      '--out',
      output,
      '--format',
      'protocol-json',
    ])
    expect(result.status).toBe(0)
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string
      request: { command: string; input: { target: string } }
      result: {
        state: string
        data: { outputKind: string; byteLength: number; wroteTo: string }
      }
    }
    expect(receipt).toMatchObject({
      schemaVersion: 'modkit-command-protocol-1',
      request: { command: 'subject.convert', input: { target: 'rgba8' } },
      result: {
        state: 'ok',
        data: { outputKind: 'bytes', byteLength: 32 * 32 * 4, wroteTo: output },
      },
    })
    const converted = readFileSync(output)
    expect(converted).toHaveLength(32 * 32 * 4)
    expect(converted.subarray(0, 8)).not.toEqual(readFileSync(png).subarray(0, 8))
    proves({
      capabilityId: 'platform/tools/ga-priority',
      operation: 'materialize',
      note: 'the shared subject.convert operation exports deterministic decoded rgba8 bytes from a PNG',
    })
  }, 60_000)

  it('validates a focused SC2/common project as deterministic per-file command receipts', () => {
    const project = mkdtempSync(join(tmpdir(), 'x3-cli-project-'))
    const scripts = join(project, 'scripts')
    const textures = join(project, 'textures')
    mkdirSync(scripts)
    mkdirSync(textures)
    writeFileSync(join(scripts, 'main.galaxy'), readFileSync(galaxy))
    writeFileSync(join(textures, 'icon.png'), readFileSync(png))

    const result = run([
      'project.validate',
      project,
      '--ext',
      starcraft2,
      '--ext',
      images,
      '--format',
      'protocol-json',
    ])
    expect(result.status).toBe(0)
    const receipt = JSON.parse(result.stdout) as {
      schemaVersion: string
      request: { command: string; project: string }
      result: {
        state: string
        summary: { discovered: number; validated: number; unclaimed: number; failed: number }
        files: {
          path: string
          state: string
          receipt: {
            schemaVersion: string
            request: { command: string }
            result: { state: string }
          }
        }[]
      }
    }
    expect(receipt).toMatchObject({
      schemaVersion: 'modkit-project-validation-1',
      request: { command: 'project.validate', project },
      result: {
        state: 'ok',
        summary: { discovered: 2, validated: 2, unclaimed: 0, failed: 0 },
      },
    })
    expect(receipt.result.files.map(item => [item.path, item.state])).toEqual([
      ['scripts/main.galaxy', 'validated'],
      ['textures/icon.png', 'validated'],
    ])
    expect(receipt.result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          receipt: expect.objectContaining({
            schemaVersion: 'modkit-command-protocol-1',
            request: expect.objectContaining({ command: 'subject.validate' }),
            result: expect.objectContaining({ state: 'ok' }),
          }),
        }),
      ]),
    )

    writeFileSync(join(project, 'unsupported.bin'), 'not a supported project asset')
    const incomplete = run([
      'project.validate',
      project,
      '--ext',
      starcraft2,
      '--ext',
      images,
      '--format',
      'protocol-json',
    ])
    expect(incomplete.status).toBe(1)
    expect(JSON.parse(incomplete.stdout)).toMatchObject({
      result: {
        state: 'failed',
        summary: { discovered: 3, validated: 2, unclaimed: 1, failed: 0 },
      },
    })
    proves({
      capabilityId: 'platform/tools/ga-priority',
      operation: 'read',
      note: 'project.validate checks every scoped file through the shared subject.validate runtime and fails closed on unclaimed inputs',
    })
  }, 120_000)
})
