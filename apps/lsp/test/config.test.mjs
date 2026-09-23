import assert from 'node:assert/strict'
import test from 'node:test'
import { parseModkitLspConfiguration } from '../dist/config.js'

test('configuration requires explicit absolute roots and extensions', () => {
  assert.throws(() => parseModkitLspConfiguration([]), /--root/)
  assert.throws(() => parseModkitLspConfiguration(['--root', '.', '--extension', 'x']), /absolute/)
})

test('configuration deduplicates roots and enforces bounded snapshots', () => {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace'
  const extension = process.platform === 'win32' ? 'C:\\extension' : '/extension'
  const value = parseModkitLspConfiguration([
    '--root',
    root,
    '--root',
    root,
    '--extension',
    extension,
    '--max-documents',
    '12',
    '--max-document-bytes',
    '1024',
    '--max-workspace-bytes',
    '4096',
    '--locale',
    'ruRU',
    '--locale',
    'enUS',
  ])
  assert.deepEqual(value.roots, [root])
  assert.deepEqual(value.extensions, [extension])
  assert.equal(value.maxDocuments, 12)
  assert.deepEqual(value.locales, ['ruRU', 'enUS'])
  assert.deepEqual(value.baseMods, [])
  assert.deepEqual(
    parseModkitLspConfiguration([
      '--root', root, '--extension', extension,
      '--base-mod', 'Mods/Liberty.SC2Mod', '--base-mod', 'Mods/Liberty.SC2Mod', '--base-mod', 'C:/Mine.SC2Mod',
    ]).baseMods,
    ['Mods/Liberty.SC2Mod', 'C:/Mine.SC2Mod'],
  )
  assert.throws(
    () =>
      parseModkitLspConfiguration([
        '--root',
        root,
        '--extension',
        extension,
        '--max-documents',
        '4097',
      ]),
    /cannot exceed/,
  )
})
