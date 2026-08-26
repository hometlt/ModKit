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
 * app, and a BIG archive built in memory from two synthetic model fixtures. Nothing here needs an
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
export const COMMAND_FIXTURE_ENTRY = 'art/w3d/minimal.w3d'

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
    entry: 'art/w3d/not-here.w3d',
    expect: 'failed',
    proves: 'a member that does not exist fails by name rather than by exception shape',
  },
])

/** File names the staged workspace uses; a host names them the same way in every run. */
export const COMMAND_FIXTURE_FILES = Object.freeze({
  png: 'fixture.png',
  archive: 'fixture.big',
})

/** A BIG4 archive: header, flat index of `offset/size/name\0`, then the payloads. */
export function buildFixtureArchive(
  entries: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Uint8Array {
  const encoder = new TextEncoder()
  const stored = entries.map(item => ({ name: encoder.encode(item.path), payload: item.bytes }))
  const indexBytes = stored.reduce((total, item) => total + 8 + item.name.byteLength + 1, 0)
  const dataOffset = 16 + indexBytes
  const total = stored.reduce((size, item) => size + item.payload.byteLength, dataOffset)
  const archive = new Uint8Array(total)
  const view = new DataView(archive.buffer)
  archive.set(encoder.encode('BIG4'), 0)
  view.setUint32(4, total, true)
  view.setUint32(8, stored.length, false)
  view.setUint32(12, dataOffset, false)
  let index = 16
  let payload = dataOffset
  for (const item of stored) {
    view.setUint32(index, payload, false)
    view.setUint32(index + 4, item.payload.byteLength, false)
    index += 8
    archive.set(item.name, index)
    index += item.name.byteLength
    archive[index] = 0
    index += 1
    archive.set(item.payload, payload)
    payload += item.payload.byteLength
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
        bytes: new Uint8Array(readFileSync(join(synthetic, 'minimal.westwood.w3d'))),
      },
      {
        path: 'art/textures/fixture.tga',
        bytes: new Uint8Array(readFileSync(join(synthetic, 'minimal.tga'))),
      },
    ]),
  )
  return { png, archive }
}

/** Extension roots the fixtures need: the PNG codec and the BIG reader. */
export const COMMAND_FIXTURE_EXTENSIONS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['common', 'images']),
  Object.freeze(['ea', 'big']),
  Object.freeze(['ea', 'models']),
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
