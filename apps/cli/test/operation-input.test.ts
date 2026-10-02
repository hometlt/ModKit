import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseRunArguments, readOperationInput } from '../src/commands.js'

test('CLI keeps the operation request separate from its command and subject', () => {
  expect(
    parseRunArguments('subject.convert', 'model.m3', [
      '--ext',
      'models',
      '--operation',
      'model.write',
      '--input',
      'scene.json',
      '--out',
      'new.m3',
    ]),
  ).toMatchObject({
    command: 'subject.convert',
    file: 'model.m3',
    operation: 'model.write',
    inputFile: 'scene.json',
    out: 'new.m3',
  })
  expect(
    parseRunArguments('subject.inspect', 'model.m3', ['--ext', 'models', '--input', 'scene.json']),
  ).toBeUndefined()
  expect(
    parseRunArguments('subject.preview', 'model.m3', ['--ext', 'models', '--input']),
  ).toBeUndefined()
})

test('CLI names the installation a map is written for, on subject.convert only', () => {
  expect(
    parseRunArguments('subject.convert', 'world.uvw', [
      '--ext',
      'westwood',
      '--target',
      'ra2-map',
      '--target-context',
      'F:/GAMES/Red Alert 2',
    ]),
  ).toMatchObject({ target: 'ra2-map', targetContext: 'F:/GAMES/Red Alert 2' })
  expect(
    parseRunArguments('subject.inspect', 'world.uvw', ['--ext', 'w', '--target-context', 'x']),
  ).toBeUndefined()
  expect(
    parseRunArguments('subject.convert', 'world.uvw', ['--ext', 'w', '--target-context']),
  ).toBeUndefined()
})

test('operation JSON owns finite bounded input, including explicit null, and honors cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modkit-cli-input-'))
  try {
    const file = join(directory, 'input.json')
    await writeFile(file, '{"schemaVersion":1,"values":[1,2,3]}')
    const value = await readOperationInput(file)
    expect(value).toEqual({ schemaVersion: 1, values: [1, 2, 3] })
    expect(Object.isFrozen(value)).toBe(true)
    await writeFile(file, 'null')
    expect(await readOperationInput(file)).toBeNull()
    await writeFile(file, '{"value":1e999}')
    await expect(readOperationInput(file)).rejects.toThrow()
    await writeFile(file, '['.repeat(66) + '0' + ']'.repeat(66))
    await expect(readOperationInput(file)).rejects.toThrow(/maxDepth/)
    await writeFile(file, Buffer.from([0xff]))
    await expect(readOperationInput(file)).rejects.toThrow()
    await writeFile(file, ' '.repeat((16 << 20) + 1))
    await expect(readOperationInput(file)).rejects.toThrow(/16 MiB/)
    await expect(readOperationInput(file, AbortSignal.abort())).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
