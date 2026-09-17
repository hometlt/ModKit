import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { parseRunArguments, runCommand } from '../src/commands.js'

const coreRoot = resolve(import.meta.dirname, '..', '..', '..')
const sc2 = resolve(coreRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')

test('subject.edit takes --operation, --input and --commit, and --commit only there', () => {
  expect(
    parseRunArguments('subject.edit', 'a.SC2Bank', [
      '--ext',
      'sc2',
      '--operation',
      'edit.field',
      '--input',
      'edit.json',
      '--commit',
    ]),
  ).toMatchObject({ command: 'subject.edit', operation: 'edit.field', commit: true })
  expect(
    parseRunArguments('subject.inspect', 'a.SC2Bank', ['--ext', 'sc2', '--commit']),
  ).toBeUndefined()
})

test('the CLI previews and commits the same SC2 Bank edit.field handler the UI and MCP use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modkit-cli-edit-'))
  try {
    const bank = join(directory, 'endofdreamsbank2.SC2Bank')
    await copyFile(
      join(sc2, 'modules', 'banks', 'test', 'fixtures', 'endofdreamsbank2.SC2Bank'),
      bank,
    )
    const input = join(directory, 'edit.json')
    await writeFile(input, JSON.stringify({ path: ['Ranks', 'Rank'], value: 'Legend' }))
    const original = await readFile(bank, 'utf8')
    const run = async (commit: boolean) => {
      let stdout = ''
      const code = await runCommand(
        {
          command: 'subject.edit',
          file: bank,
          roots: [sc2],
          operation: 'edit.field',
          inputFile: input,
          ...(commit ? { commit } : {}),
          trust: false,
          format: 'json',
        },
        { writeStdout: text => void (stdout += text), writeStderr: () => undefined },
      )
      return {
        code,
        result: JSON.parse(stdout) as { state: string; data: Record<string, unknown> },
      }
    }

    const preview = await run(false)
    if (preview.result.state !== 'ok') throw new Error(`PREVIEW ${JSON.stringify(preview.result)}`)
    expect(preview.result).toMatchObject({ state: 'ok', data: { committed: false } })
    expect(preview.code).toBe(0)
    expect(await readFile(bank, 'utf8')).toBe(original)

    const committed = await run(true)
    if (committed.result.state !== 'ok')
      throw new Error(`COMMIT ${JSON.stringify(committed.result)}`)
    expect(committed.result).toMatchObject({
      state: 'ok',
      data: { committed: true, state: 'committed' },
    })
    expect(committed.code).toBe(0)
    const written = await readFile(bank, 'utf8')
    expect(written).toContain('<Value string="Legend"/>')
    expect(written.replace('Legend', 'Hero')).toBe(original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
