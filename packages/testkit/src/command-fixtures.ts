/**
 * One set of command fixtures, run by four hosts (block 13 plus automation in block 14B).
 *
 * The gate asks that "the same command fixtures pass in the CLI, the Electron fake host and the
 * VS Code integration". The only way that sentence means anything is if the fixtures are one
 * object rather than three lists that happen to look alike — so they live here, in the package all
 * three already depend on for test material, and each host imports them rather than restating them.
 *
 * What a fixture asserts is deliberately narrow: the **state** the command reached and a handful of
 * fields that could only be true if the work actually happened. It does not assert prose, because
 * refusal wording is meant to improve, and it does not assert byte counts of a codec's output,
 * because that is the codec's own conformance suite's job. What it does pin is the thing three
 * hosts can silently disagree about — whether a command ran, refused, or failed.
 *
 * The workspace is staged from bytes this repository already owns: a PNG that ships with the web
 * app, and a ZIP archive built in memory from neutral synthetic fixtures. Nothing here needs an
 * installed game, which is why this set can run in a unit test, in a headless Electron composition
 * and inside a real editor without a corpus descriptor between them. The live-corpus matrix is
 * block 13's slice D, and this is not it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Which staged file a fixture runs against. */
export type CommandFixtureSubject = 'png' | 'archive'

export interface CommandFixture {
  readonly id: string
  readonly command: string
  readonly subject: CommandFixtureSubject
  readonly entry?: string
  /** The state the command must reach in every host. */
  readonly expect: 'ok' | 'unavailable' | 'failed'
  /**
   * Fields of `data` that must be present and equal. Only facts that prove the work happened —
   * never a message, never a size a codec is free to change.
   */
  readonly data?: Readonly<Record<string, string | number | boolean>>
  /** Why this fixture is in the set at all. Printed by a host that reports one. */
  readonly proves: string
}

/** The member the archive fixture holds, and the one `subject.extract` asks for. */
export const COMMAND_FIXTURE_ENTRY = 'assets/models/triangle.obj'

export const COMMAND_FIXTURES: readonly CommandFixture[] = Object.freeze([
  {
    id: 'open-png',
    command: 'subject.open',
    subject: 'png',
    expect: 'ok',
    data: { formatId: 'png' },
    proves: 'a codec claims a real file and the host reports which one, identically in every app',
  },
  {
    id: 'inspect-png',
    command: 'subject.inspect',
    subject: 'png',
    expect: 'ok',
    proves: 'the descriptor crosses the worker boundary and is reported whole',
  },
  {
    id: 'validate-png',
    command: 'subject.validate',
    subject: 'png',
    expect: 'ok',
    proves: 'a command routes to the codec’s own asset.validate operation',
  },
  {
    id: 'preview-png',
    command: 'subject.preview',
    subject: 'png',
    expect: 'unavailable',
    proves:
      'a subject that publishes no preview operation answers §4.2 host-unavailable with an ' +
      'alternative, in every app, instead of one app inventing a preview and another throwing',
  },
  {
    id: 'extract-archive-member',
    command: 'subject.extract',
    subject: 'archive',
    entry: COMMAND_FIXTURE_ENTRY,
    expect: 'ok',
    data: { entry: COMMAND_FIXTURE_ENTRY },
    proves: 'a container member is read through the container’s own bounded extraction',
  },
  {
    id: 'extract-missing-member',
    command: 'subject.extract',
    subject: 'archive',
    entry: 'assets/models/not-here.obj',
    expect: 'failed',
    proves: 'a member that does not exist fails by name rather than by exception shape',
  },
])

/** File names the staged workspace uses; a host names them the same way in every run. */
export const COMMAND_FIXTURE_FILES = Object.freeze({
  png: 'fixture.png',
  archive: 'fixture.zip',
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A deterministic classic ZIP containing stored entries only. */
export function buildFixtureArchive(
  entries: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const local = new Uint8Array(30 + name.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(14, crc32(entry.bytes), true)
    localView.setUint32(18, entry.bytes.byteLength, true)
    localView.setUint32(22, entry.bytes.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    local.set(name, 30)
    parts.push(local, entry.bytes)

    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc32(entry.bytes), true)
    centralView.setUint32(20, entry.bytes.byteLength, true)
    centralView.setUint32(24, entry.bytes.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    directory.push(central)
    offset += local.byteLength + entry.bytes.byteLength
  }
  const directorySize = directory.reduce((total, part) => total + part.byteLength, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, offset, true)

  const all = [...parts, ...directory, end]
  const archive = new Uint8Array(all.reduce((total, part) => total + part.byteLength, 0))
  let cursor = 0
  for (const part of all) {
    archive.set(part, cursor)
    cursor += part.byteLength
  }
  return archive
}

/**
 * Write the fixture workspace into `directory` and answer with the paths.
 *
 * Every host stages it the same way, from the same bytes, so "the same fixtures" is a statement
 * about the input as well as the assertions.
 */
export function stageCommandFixtures(
  directory: string,
  repositoryRoot: string,
): { readonly png: string; readonly archive: string } {
  const synthetic = join(repositoryRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
  const png = join(directory, COMMAND_FIXTURE_FILES.png)
  writeFileSync(png, readFileSync(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')))
  const archive = join(directory, COMMAND_FIXTURE_FILES.archive)
  writeFileSync(
    archive,
    buildFixtureArchive([
      {
        path: COMMAND_FIXTURE_ENTRY,
        bytes: new Uint8Array(readFileSync(join(synthetic, 'minimal.obj'))),
      },
      {
        path: 'assets/images/fixture.png',
        bytes: new Uint8Array(readFileSync(join(synthetic, 'minimal.png'))),
      },
    ]),
  )
  return { png, archive }
}

/** Common extension roots used by the image, ZIP and nested model fixtures. */
export const COMMAND_FIXTURE_EXTENSIONS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['common', 'images']),
  Object.freeze(['common', 'archives']),
  Object.freeze(['common', 'models']),
])

/** One fixture's verdict, in the shape every host reports so a receipt can hold all three. */
export interface CommandFixtureVerdict {
  readonly id: string
  readonly command: string
  readonly expected: string
  readonly actual: string
  readonly passed: boolean
  readonly note?: string
}

/**
 * Check one result against its fixture, without knowing which host produced it.
 *
 * Shared for the same reason the fixtures are: three hosts each writing "did it reach the expected
 * state, and do the named fields match" is three chances to be subtly more forgiving than the
 * others.
 */
export function checkCommandFixture(
  fixture: CommandFixture,
  result: {
    readonly state: string
    readonly data?: unknown
  },
): CommandFixtureVerdict {
  if (result.state !== fixture.expect) {
    return {
      id: fixture.id,
      command: fixture.command,
      expected: fixture.expect,
      actual: result.state,
      passed: false,
      note: `expected ${fixture.expect}, got ${result.state}`,
    }
  }
  const data = (result.data ?? {}) as Record<string, unknown>
  for (const [key, value] of Object.entries(fixture.data ?? {})) {
    if (data[key] !== value) {
      return {
        id: fixture.id,
        command: fixture.command,
        expected: `${key}=${String(value)}`,
        actual: `${key}=${String(data[key])}`,
        passed: false,
        note: `field «${key}» does not match`,
      }
    }
  }
  return {
    id: fixture.id,
    command: fixture.command,
    expected: fixture.expect,
    actual: result.state,
    passed: true,
  }
}
