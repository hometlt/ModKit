import { expect, test } from 'vitest'
import { parseByteSize, parseRunArguments } from '../src/commands.js'

test('--max-input-bytes takes bytes or whole KiB, MiB, GiB and nothing else', () => {
  expect(parseByteSize('1048576')).toBe(1_048_576n)
  expect(parseByteSize('512MiB')).toBe(512n << 20n)
  expect(parseByteSize('4GiB')).toBe(4n << 30n)
  for (const refused of [undefined, '', '0', '0GiB', '-1', '1.5GiB', '12MB', 'GiB', '4 GiB'])
    expect(parseByteSize(refused)).toBeUndefined()
})

test('modkit run raises the open budget for reading commands, never for subject.edit', () => {
  expect(
    parseRunArguments('subject.extract', 'Sounds.pck', [
      '--ext',
      'wwise',
      '--entry',
      'sfx/1.wem',
      '--max-input-bytes',
      '2GiB',
    ]),
  ).toMatchObject({ entry: 'sfx/1.wem', maxInputBytes: 2n << 30n })
  expect(parseRunArguments('subject.inspect', 'a.pck', ['--ext', 'x'])).not.toHaveProperty(
    'maxInputBytes',
  )
  expect(
    parseRunArguments('subject.inspect', 'a.pck', ['--ext', 'x', '--max-input-bytes', 'lots']),
  ).toBeUndefined()
  expect(
    parseRunArguments('subject.edit', 'a.txt', ['--ext', 'x', '--max-input-bytes', '1MiB']),
  ).toBeUndefined()
})
