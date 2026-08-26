/**
 * The same command fixtures, in two of the three hosts (block 13, exit-gate line 2).
 *
 * The gate reads: *the same command fixtures pass in the CLI, the Electron fake host and the
 * VS Code integration*. Two of those three are here, and they are deliberately as unalike as the
 * products are — the CLI is spawned as a real process and asserted through its stdout, the Electron
 * host is composed in this process and asserted on the returned object. If the runtime had drifted
 * into either adapter, one of these two columns would move and the other would not.
 *
 * The third column is `pnpm smoke:vscode`, which runs the identical `COMMAND_FIXTURES` inside a
 * real editor and records the verdicts in its receipt. It cannot live here: it needs an editor.
 *
 * The fixtures and the checker are imported, never restated — `packages/testkit/src/command-fixtures.ts`
 * says why.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkCommandFixture,
  proves,
  stageCommandFixtures,
  COMMAND_FIXTURES,
  COMMAND_FIXTURE_EXTENSIONS,
  type CommandFixture,
  type CommandFixtureVerdict,
} from '@modkitx-x3/testkit'
import {
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  type CommandResult,
} from '@modkitx-x3/host'
import { createPathSubjectOpener } from '@modkitx-x3/host/node'
import { createElectronSubjectServices } from '../../apps/electron/src/index.js'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)), '..')
const cliEntry = join(repoRoot, 'apps', 'modkit-cli', 'dist', 'main.js')
const extensionRoots = COMMAND_FIXTURE_EXTENSIONS.map(part => join(repoRoot, 'extensions', ...part))

const workspace = mkdtempSync(join(tmpdir(), 'x3-command-fixtures-'))
const staged = stageCommandFixtures(workspace, repoRoot)
const disposers: (() => Promise<void>)[] = []

afterAll(async () => {
  for (const dispose of disposers.splice(0)) await dispose().catch(() => undefined)
  rmSync(workspace, { recursive: true, force: true })
})

const subjectPath = (fixture: CommandFixture): string =>
  fixture.subject === 'png' ? staged.png : staged.archive

// ---------------------------------------------------------------------------------------------
// host 1: the CLI, as a process

/** Run `modkit run` for real and parse the one JSON document it prints. */
function runThroughCli(fixture: CommandFixture): CommandResult {
  const argv = [
    cliEntry,
    'run',
    fixture.command,
    subjectPath(fixture),
    ...extensionRoots.flatMap(root => ['--ext', root]),
    ...(fixture.entry === undefined ? [] : ['--entry', fixture.entry]),
    '--format',
    'json',
  ]
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, argv, { encoding: 'utf8' })
  } catch (error) {
    // A non-zero exit is an expected outcome for `unavailable` and `failed`; the document is still
    // on stdout, and reading it is the point. Only a run that printed nothing is a real failure.
    const failure = error as { stdout?: string }
    stdout = failure.stdout ?? ''
    if (stdout.trim() === '') throw error
  }
  return JSON.parse(stdout) as CommandResult
}

// ---------------------------------------------------------------------------------------------
// host 2: the Electron composition, headless

let electronRuntime: Promise<(fixture: CommandFixture) => Promise<CommandResult>> | undefined

function electronRunner(): Promise<(fixture: CommandFixture) => Promise<CommandResult>> {
  electronRuntime ??= (async () => {
    const subjects = await createElectronSubjectServices(extensionRoots)
    disposers.push(async () => {
      await (subjects as unknown as { dispose?: () => Promise<void> }).dispose?.()
    })
    const runtime = createSubjectCommandRuntime()
    /*
     * `main.cjs` confines a requested path through `roots.require` before it opens anything; the
     * headless equivalent is the path opener with the staged workspace as its root. Same opener,
     * same confinement, no window.
     */
    const opener = commandSubjectsFrom(
      createPathSubjectOpener({
        subjects,
        roots: [workspace],
        grant: { id: 'electron-fixtures', classes: ['read-source'] },
      }),
    )
    return async (fixture: CommandFixture) =>
      runtime.run(
        fixture.command,
        {
          subject: subjectPath(fixture),
          ...(fixture.entry === undefined ? {} : { entry: fixture.entry }),
        },
        { openSubject: opener },
      )
  })()
  return electronRuntime
}

// ---------------------------------------------------------------------------------------------

describe('one command fixture set, two hosts, one verdict each', () => {
  it.each(COMMAND_FIXTURES.map(fixture => [fixture.id, fixture] as const))(
    'CLI: %s',
    (_id, fixture) => {
      const verdict = checkCommandFixture(fixture, runThroughCli(fixture))
      expect(verdict, `${fixture.id}: ${fixture.proves} — ${verdict.note ?? ''}`).toMatchObject({
        passed: true,
      })
    },
    180_000,
  )

  it.each(COMMAND_FIXTURES.map(fixture => [fixture.id, fixture] as const))(
    'Electron fake host: %s',
    async (_id, fixture) => {
      const run = await electronRunner()
      const verdict = checkCommandFixture(fixture, await run(fixture))
      expect(verdict, `${fixture.id}: ${fixture.proves} — ${verdict.note ?? ''}`).toMatchObject({
        passed: true,
      })
    },
    180_000,
  )

  it('the two hosts agree fixture for fixture, not merely each with itself', async () => {
    const run = await electronRunner()
    const rows: CommandFixtureVerdict[] = []
    for (const fixture of COMMAND_FIXTURES) {
      const cli = runThroughCli(fixture)
      const electron = await run(fixture)
      /*
       * The comparison that makes this a *parity* test rather than two suites in one file: the two
       * hosts must reach the same state for the same input. A refusal in one and a success in the
       * other is exactly the drift exit-gate line 1 forbids, and it would pass both loops above.
       */
      expect(
        electron.state,
        `${fixture.id}: CLI says ${cli.state}, Electron says ${electron.state}`,
      ).toBe(cli.state)
      if (cli.state === 'unavailable' && electron.state === 'unavailable') {
        // Both must offer an alternative; §4.2 makes it part of the answer, not decoration.
        expect(cli.alternative.length).toBeGreaterThan(0)
        expect(electron.alternative.length).toBeGreaterThan(0)
      }
      rows.push(checkCommandFixture(fixture, electron))
    }
    expect(rows.every(row => row.passed)).toBe(true)
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'read',
      note: 'the shared command runtime extracts a container member identically in CLI and Electron',
    })
  }, 300_000)
})
