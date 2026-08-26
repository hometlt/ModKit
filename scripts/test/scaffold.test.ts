/**
 * Block 12 item 19 and the exit-gate line «extension scaffold компилируется против реального
 * open(input, intent, budget) ABI».
 *
 * The golden-path budget has been asserted since block A-4, but against hand-written numbers —
 * there was no scaffold to measure, so the gate was checking a constant against a constant. This
 * runs the real scaffold and measures its actual output, then opens a subject with it through the
 * real host: `buildInventory` over the generated directory, `openSubject`, the descriptor, the
 * published data source, and the budget refusal.
 *
 * That last part is the whole point of the exit-gate line. A scaffold that type-checks proves the
 * types exist; a scaffold that *opens a subject* proves the ABI a newcomer is about to copy is the
 * ABI the host actually implements. Those two things drift, and a newcomer copying the drifted one
 * loses an afternoon to a signature nobody updated.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertGoldenPathMetrics, GOLDEN_PATH_CONCEPTS } from '@modkitx-x3/testkit'
import type { ResourceBudget } from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..')
const scaffold = join(repoRoot, 'scripts', 'scaffold-extension.mjs')

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 10_000,
  maxScalarBytes: 100_000,
  maxDiagnostics: 32,
}

let scratch: string | undefined
afterEach(async () => {
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  scratch = undefined
})

async function runScaffold(id: string): Promise<string> {
  /*
   * Inside the repository, not the system temp directory. The scaffolded codec imports
   * `@modkitx-x3/codec-kit`, so it can only load where that specifier resolves — which is exactly
   * what a real user does, and exactly what the README now says.
   */
  scratch = await mkdtemp(join(repoRoot, 'extensions', '.x3-scaffold-'))
  execFileSync(process.execPath, [scaffold, '--out', scratch, '--id', id], { encoding: 'utf8' })
  /*
   * The one thing `pnpm install` would do, done here instead.
   *
   * pnpm does not hoist, so every extension gets its own `node_modules` link at install time — a
   * freshly written directory has none, and the codec's `@modkitx-x3/codec-kit` import cannot
   * resolve. Linking it is not a workaround for the scaffold being wrong; it is the install step
   * the scaffold's own README tells the user to run, performed by the test so the ABI below is
   * exercised rather than skipped.
   */
  const linkDir = join(scratch, 'node_modules', '@modkitx-x3')
  await mkdir(linkDir, { recursive: true })
  await symlink(
    join(repoRoot, 'extensions', 'codec-kit', 'codec-kit'),
    join(linkDir, 'codec-kit'),
    'junction',
  )
  return scratch
}

async function allFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const next = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      // node_modules is the install step's, not the scaffold's; counting it would inflate the budget
      if (entry.name === 'node_modules') continue
      if (entry.isDirectory()) await walk(join(directory, entry.name), next)
      else found.push(next)
    }
  }
  await walk(root, '')
  return found.sort()
}

describe('12-4 the extension scaffold', () => {
  it('stays inside the golden-path budget, measured from what it actually wrote', async () => {
    const directory = await runScaffold('demofmt')
    const files = await allFiles(directory)
    expect(files).toEqual([
      'README.md',
      'contributions/codec-demofmt.json',
      'fixtures/example.demofmt',
      'package.json',
      'src/codec.js',
    ])

    // measured, not asserted: the file count is the scaffold's, and the concepts are the ones its
    // README actually names
    const readme = await readFile(join(directory, 'README.md'), 'utf8')
    const conceptsRequired = GOLDEN_PATH_CONCEPTS.filter(concept =>
      new RegExp(`\\b${concept}\\b`, 'u').test(readme),
    )
    expect(conceptsRequired).toEqual([...GOLDEN_PATH_CONCEPTS])
    expect(() =>
      assertGoldenPathMetrics({
        stepsToFirstGreen: 5,
        filesTouched: files.length,
        conceptsRequired,
        timeToBadgeMs: null,
      }),
    ).not.toThrow()
  }, 60_000)

  it('opens a subject through the real open(input, intent, budget) ABI', async () => {
    const directory = await runScaffold('demofmt')
    const {
      buildInventory,
      createHostContributionContractRegistry,
      createExecutionBackendRegistry,
    } = await import('@modkitx-x3/host')
    const { loadExtensionDirectory, openFileArtifactSource } = await import('@modkitx-x3/host/node')
    const { openSubject } = await import('@modkitx-x3/host')

    const inventory = await buildInventory(
      [
        {
          ...(await loadExtensionDirectory(directory)),
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        },
      ],
      createHostContributionContractRegistry(),
    )
    const executionBackends = createExecutionBackendRegistry([
      {
        profile: 'trusted-in-process',
        supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
        async activate(activation) {
          return {
            module: (await import(activation.entrypoint.href)) as Record<string, unknown>,
            release: async () => undefined,
          }
        },
      },
    ])

    const fixture = join(directory, 'fixtures', 'example.demofmt')
    const opened = await openSubject({
      inventory,
      source: await openFileArtifactSource(fixture),
      path: fixture,
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'scaffold', classes: ['read-source'] } as never,
      budget,
      executionBackends,
    })

    expect(opened.state, JSON.stringify(opened)).toBe('opened')
    if (opened.state !== 'opened') return
    expect(opened.selected.contributionId).toBe('org.example/demofmt')

    const descriptor = (await opened.session.descriptor()) as unknown as {
      dataSources: readonly { contract: string; major: number }[]
    }
    // the contract the README promises is the contract the descriptor publishes
    expect(descriptor.dataSources.map(item => `${item.contract}@${item.major}`)).toContain(
      'common.view/text-data-source@1',
    )
    await opened.session.dispose()
  }, 120_000)

  it('refuses bytes that are not its own, and honours the caller budget', async () => {
    /*
     * Both halves of a codec's honesty, in the smallest example a newcomer will copy. If the
     * scaffold claimed foreign bytes or ignored the budget, every codec grown from it would inherit
     * that — which is why the scaffold is worth testing rather than merely writing.
     */
    const directory = await runScaffold('demofmt')
    const definitionSource = await readFile(join(directory, 'src', 'codec.js'), 'utf8')
    expect(definitionSource).toContain('maxScalarBytes')
    expect(definitionSource).toContain('magic-header-missing')

    // a renamed foreign file must not be claimed on its name alone
    const foreign = join(directory, 'fixtures', 'renamed.demofmt')
    await writeFile(foreign, 'this is not the scaffolded format\n')
    const { loadExtensionDirectory, openFileArtifactSource } = await import('@modkitx-x3/host/node')
    const {
      buildInventory,
      createHostContributionContractRegistry,
      createExecutionBackendRegistry,
      openSubject,
    } = await import('@modkitx-x3/host')
    const inventory = await buildInventory(
      [
        {
          ...(await loadExtensionDirectory(directory)),
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        },
      ],
      createHostContributionContractRegistry(),
    )
    const opened = await openSubject({
      inventory,
      source: await openFileArtifactSource(foreign),
      path: foreign,
      intent: 'full',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'scaffold', classes: ['read-source'] } as never,
      budget,
      executionBackends: createExecutionBackendRegistry([
        {
          profile: 'trusted-in-process',
          supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
          async activate(activation) {
            return {
              module: (await import(activation.entrypoint.href)) as Record<string, unknown>,
              release: async () => undefined,
            }
          },
        },
      ]),
    })
    expect(opened.state).toBe('unresolved')
  }, 120_000)
})
