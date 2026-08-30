/**
 * The same command fixtures, in three headless hosts (blocks 13 and 14B).
 *
 * The gate reads: *the same command fixtures pass in the CLI, the Electron fake host and the
 * VS Code integration*. CLI and Electron remain the original two columns; block 14B adds the
 * automation host as a third headless column over the same runtime and fixtures. The CLI is spawned
 * as a real process, while Electron and automation are composed in this process. If behaviour had
 * drifted into an adapter, at least one column would move and the others would not.
 *
 * The editor column is `pnpm smoke:vscode`, which runs the identical `COMMAND_FIXTURES` inside a
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
  commandRequest,
  createSubjectCommandEndpoint,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  COMMAND_UNKNOWN,
  type CommandReceipt,
  type CommandResult,
} from '@modkitx-x3/host'
import { createPathSubjectOpener } from '@modkitx-x3/host/node'
import { createAutomationHost } from '../../apps/automation-host/src/index.js'
import { createElectronSubjectServices } from '../../apps/electron/src/index.js'

const repoRoot = join(fileURLToPath(new URL('..', import.meta.url)), '..')
const cliEntry = join(repoRoot, 'apps', 'cli', 'dist', 'main.js')
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
function runCliJson(fixture: CommandFixture, format: 'json' | 'protocol-json'): unknown {
  const argv = [
    cliEntry,
    'run',
    fixture.command,
    subjectPath(fixture),
    ...extensionRoots.flatMap(root => ['--ext', root]),
    ...(fixture.entry === undefined ? [] : ['--entry', fixture.entry]),
    '--format',
    format,
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
  return JSON.parse(stdout)
}

const runThroughCli = (fixture: CommandFixture): CommandResult =>
  runCliJson(fixture, 'json') as CommandResult

const runThroughCliProtocol = (fixture: CommandFixture): CommandReceipt =>
  runCliJson(fixture, 'protocol-json') as CommandReceipt

const listCliCommands = (format: '--json' | '--protocol-json'): unknown =>
  JSON.parse(execFileSync(process.execPath, [cliEntry, 'commands', format], { encoding: 'utf8' }))

// ---------------------------------------------------------------------------------------------
// host 2: the Electron composition, headless

let electronRuntime: Promise<(fixture: CommandFixture) => Promise<CommandReceipt>> | undefined

function electronRunner(): Promise<(fixture: CommandFixture) => Promise<CommandReceipt>> {
  electronRuntime ??= (async () => {
    const subjects = await createElectronSubjectServices(extensionRoots)
    disposers.push(async () => {
      await (subjects as unknown as { dispose?: () => Promise<void> }).dispose?.()
    })
    /*
     * `main.cjs` confines a requested path through `roots.require` before it opens anything; the
     * headless equivalent is the path opener with the staged workspace as its root. Same opener,
     * same confinement, no window.
     */
    const endpoint = createSubjectCommandEndpoint({
      openSubject: createPathSubjectOpener({
        subjects,
        roots: [workspace],
        grant: { id: 'electron-fixtures', classes: ['read-source'] },
      }),
    })
    disposers.push(() => endpoint.dispose())
    return async (fixture: CommandFixture) =>
      endpoint.execute(
        commandRequest(fixture.command, {
          subject: subjectPath(fixture),
          ...(fixture.entry === undefined ? {} : { entry: fixture.entry }),
        }),
      )
  })()
  return electronRuntime
}

// ---------------------------------------------------------------------------------------------
// host 3: the automation composition, with an explicit filesystem grant root

let automationRuntime: Promise<(fixture: CommandFixture) => Promise<CommandReceipt>> | undefined

function automationRunner(): Promise<(fixture: CommandFixture) => Promise<CommandReceipt>> {
  automationRuntime ??= (async () => {
    const host = await createAutomationHost([], { extensionRoots })
    disposers.push(async () => {
      await (host.subjects as unknown as { dispose?: () => Promise<void> }).dispose?.()
    })
    return async (fixture: CommandFixture) =>
      host.runCommand(
        commandRequest(fixture.command, {
          subject: subjectPath(fixture),
          ...(fixture.entry === undefined ? {} : { entry: fixture.entry }),
        }),
        { roots: [workspace] },
      )
  })()
  return automationRuntime
}

// ---------------------------------------------------------------------------------------------

describe('one command fixture set, three headless hosts, one verdict each', () => {
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
      const verdict = checkCommandFixture(fixture, (await run(fixture)).result)
      expect(verdict, `${fixture.id}: ${fixture.proves} — ${verdict.note ?? ''}`).toMatchObject({
        passed: true,
      })
    },
    180_000,
  )

  it.each(COMMAND_FIXTURES.map(fixture => [fixture.id, fixture] as const))(
    'Automation host: %s',
    async (_id, fixture) => {
      const run = await automationRunner()
      const verdict = checkCommandFixture(fixture, (await run(fixture)).result)
      expect(verdict, `${fixture.id}: ${fixture.proves} — ${verdict.note ?? ''}`).toMatchObject({
        passed: true,
      })
    },
    180_000,
  )

  it('keeps legacy CLI JSON while offering the versioned protocol envelope', () => {
    const fixture = COMMAND_FIXTURES[0] as CommandFixture
    const legacy = runThroughCli(fixture)
    expect(legacy).toMatchObject({ state: 'ok', command: fixture.command })
    expect(legacy).not.toHaveProperty('schemaVersion')
    const receipt = runThroughCliProtocol(fixture)
    expect(receipt).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      request: { command: fixture.command },
      result: { state: 'ok', command: fixture.command },
    })
    const legacyContracts = listCliCommands('--json')
    expect(Array.isArray(legacyContracts)).toBe(true)
    expect(legacyContracts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'subject.open', needsSubject: true })]),
    )
    const protocolContracts = listCliCommands('--protocol-json')
    expect(protocolContracts).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      commands: expect.arrayContaining([
        expect.objectContaining({ id: 'subject.open', callers: expect.arrayContaining(['cli']) }),
      ]),
    })
    const unknown = runThroughCliProtocol({
      ...fixture,
      id: 'unknown-command-protocol',
      command: 'subject.teleport',
    })
    expect(unknown.result).toMatchObject({ state: 'failed', code: COMMAND_UNKNOWN })
  }, 180_000)

  it('the three headless hosts agree fixture for fixture, not merely each with itself', async () => {
    const runElectron = await electronRunner()
    const runAutomation = await automationRunner()
    const rows: CommandFixtureVerdict[] = []
    for (const fixture of COMMAND_FIXTURES) {
      const cli = runThroughCliProtocol(fixture)
      const electron = await runElectron(fixture)
      const automation = await runAutomation(fixture)
      /*
       * The comparison that makes this a *parity* test rather than three suites in one file: all
       * hosts must reach the same state for the same input. A refusal in one and a success in the
       * others is exactly the drift exit-gate line 1 forbids, and it would pass the loops above.
       */
      expect(
        [electron.result.state, automation.result.state],
        `${fixture.id}: CLI says ${cli.result.state}, Electron says ${electron.result.state}, ` +
          `automation says ${automation.result.state}`,
      ).toEqual([cli.result.state, cli.result.state])
      if (
        cli.result.state === 'unavailable' &&
        electron.result.state === 'unavailable' &&
        automation.result.state === 'unavailable'
      ) {
        // All must offer an alternative; §4.2 makes it part of the answer, not decoration.
        expect(cli.result.alternative.length).toBeGreaterThan(0)
        expect(electron.result.alternative.length).toBeGreaterThan(0)
        expect(automation.result.alternative.length).toBeGreaterThan(0)
      }
      rows.push(checkCommandFixture(fixture, electron.result))
      rows.push(checkCommandFixture(fixture, automation.result))
    }
    expect(rows.every(row => row.passed)).toBe(true)
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'read',
      note: 'the shared command runtime extracts a container member identically in CLI, Electron and automation hosts',
    })
  }, 300_000)
})
