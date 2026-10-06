import assert from 'node:assert/strict'
import test from 'node:test'
import { parseModkitLspConfiguration } from '../dist/config.js'

test('configuration requires explicit absolute roots and extensions', () => {
  assert.throws(() => parseModkitLspConfiguration([]), /--root/)
  assert.throws(() => parseModkitLspConfiguration(['--root', '.', '--extension', 'x']), /absolute/)
})

test('default closure admits dependencies up to the primary activation bound', () => {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace'
  const extension = process.platform === 'win32' ? 'C:\\extension' : '/extension'
  const args = ['--root', root, '--extension', extension]
  const defaults = parseModkitLspConfiguration(args)
  assert.equal(defaults.maxDocumentBytes, 16_777_216)
  assert.equal(defaults.maxWorkspaceBytes, 268_435_456)
  assert.throws(
    () => parseModkitLspConfiguration([...args, '--max-workspace-bytes', '4194304']),
    /--max-document-bytes cannot exceed --max-workspace-bytes/,
  )
  assert.equal(
    parseModkitLspConfiguration([...args, '--max-document-bytes', '4194304']).maxDocumentBytes,
    4_194_304,
  )
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

test('resolved Data stays in memory by default and on disk only in a named cache directory', () => {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace'
  const extension = process.platform === 'win32' ? 'C:\\extension' : '/extension'
  const cache = process.platform === 'win32' ? 'C:\\cache' : '/cache'
  const args = ['--root', root, '--extension', extension]
  const defaults = parseModkitLspConfiguration(args)
  assert.equal(defaults.resolvedDataMemoryBytes, 512 * 1_048_576)
  assert.equal(defaults.resolvedDataCache, undefined)
  const kept = parseModkitLspConfiguration([
    ...args,
    '--resolved-data-cache',
    cache,
    '--resolved-data-cache-mib',
    '64',
    '--resolved-data-memory-mib',
    '128',
  ])
  assert.deepEqual(kept.resolvedDataCache, { directory: cache, maxBytes: 64 * 1_048_576 })
  assert.equal(kept.resolvedDataMemoryBytes, 128 * 1_048_576)
  assert.throws(
    () => parseModkitLspConfiguration([...args, '--resolved-data-cache', 'relative']),
    /absolute/,
  )
  assert.throws(
    () => parseModkitLspConfiguration([...args, '--resolved-data-memory-mib', '70000']),
    /cannot exceed/,
  )
})
