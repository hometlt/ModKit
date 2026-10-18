import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

test('every vocabulary word is a canonical role or tag the animation schema admits', async () => {
  const vocabulary = await json('../model/uvm-clip-vocabulary.v1.json')
  const { $defs } = await json('../model/schema/uvm.animation.schema.json')
  const role = new RegExp($defs.clipRole.pattern, 'u')
  const tag = new RegExp($defs.clipTags.items.pattern, 'u')
  assert.equal(vocabulary.schemaVersion, 'uvm-clip-vocabulary-1')
  for (const word of Object.keys(vocabulary.roles)) assert.match(word, role)
  for (const word of Object.keys(vocabulary.tags)) {
    assert.match(word, tag)
    assert.ok(!word.includes(':'), `${word} is canonical, never prefixed`)
    assert.ok(!(word in vocabulary.roles), `${word} is both a role and a tag`)
  }
  assert.ok(!role.test('sage:DYING') && !role.test('Attack 01'))
  assert.ok(tag.test('sc2:Attack Slow') && !tag.test('sage:') && !tag.test('Damaged'))
  for (const word of ['idle\n', 'Attack', 'sage:idle']) assert.ok(!role.test(word))
  for (const word of ['left\n', 'sage:suppressed\n', 'sage:\tAttack', 'sage:Attack\u0000']) {
    assert.ok(!tag.test(word), JSON.stringify(word))
  }
})

test('re-emitting seed vectors retains curated clip assertions and the complete schema corpus', async () => {
  const specs = new URL('../', import.meta.url)
  const previous = await json('../conformance/schema-assertions.json')
  const directory = await mkdtemp(join(tmpdir(), 'uvm-clip-vocabulary-'))
  const copy = join(directory, 'specs')
  await cp(fileURLToPath(specs), copy, { recursive: true })
  const emit = () => {
    const result = spawnSync(process.execPath, [join(copy, 'tools/uv-conformance-emit.mjs')], {
      cwd: directory, encoding: 'utf8', timeout: 30_000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  }
  const read = async () => JSON.parse(await readFile(join(copy, 'conformance/schema-assertions.json'), 'utf8'))
  emit()
  const after = await read()
  const key = assertion => assertion.id ?? JSON.stringify([
    assertion.document, assertion.pointer, assertion.schemaId, assertion.mutations ?? [],
  ])
  const cases = new Map(after.assertions.map(assertion => [key(assertion), assertion]))
  assert.equal(cases.size, after.assertions.length, 'no duplicate cases after regeneration')
  for (const original of previous.assertions) {
    assert.equal(cases.get(key(original))?.expect, original.expect, key(original))
    if (original.id?.startsWith('uvm-clip-role/')) assert.deepEqual(cases.get(key(original)), original)
  }
  assert.ok(previous.assertions.some(assertion => assertion.id === 'uvm-clip-role/playback-without-role'))
  for (const schema of previous.schemaDirectories) assert.ok(after.schemaDirectories.includes(schema))
  assert.equal(after.checkedOn, previous.checkedOn)
  assert.equal(after.checkedWith, previous.checkedWith)
  emit()
  assert.deepEqual(await read(), after, 'a second regeneration is stable')
})
