import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const extractor = path.join(root, 'scripts/migration/extract-pinned-symbols.mjs')
const checkedConfig = path.join(root, 'packages/uv/model-rig-kernels.config.json')
const run = (config, check = false) =>
  spawnSync(process.execPath, [extractor, '--config', config, ...(check ? ['--check'] : [])], {
    cwd: root,
    encoding: 'utf8',
  })

test('UVM kernels still equal their immutable MK2 declarations', () => {
  const result = run(checkedConfig, true)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('shared CPU skinning still equals the immutable MK2 renderer declarations', () => {
  const result = run(path.join(root, 'packages/codec-kit/model-skinning-kernels.config.json'), true)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

for (const config of [
  'packages/uv/model-container-kernels.config.json',
  'packages/codec-kit/crypto-digest-kernels.config.json',
]) {
  test(`${config} still equals its immutable MK2 declarations`, () => {
    const result = run(path.join(root, config), true)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}

test('the pinned writer retains its structured legacy error code at the strict boundary', async () => {
  const { encodeSkeleton, BufferBuilder } = await import(
    pathToFileURL(path.join(root, 'packages/uv/dist/model/legacy/rig-kernels.js')).href
  )
  assert.throws(
    () =>
      encodeSkeleton(
        { skeleton: { bones: [{ index: 1, parentIndex: -1 }] }, meshes: [] },
        [],
        new BufferBuilder(),
        [],
        [],
      ),
    { name: 'ModkitError', code: 'CONFIG_INVALID' },
  )
})

test('the provenance gate rejects a modified generated module', async () => {
  const directory = await mkdtemp(path.join(root, '.tmp-uv-rig-'))
  try {
    const config = JSON.parse(await readFile(checkedConfig, 'utf8'))
    config.output = path.relative(root, path.join(directory, 'rig.ts')).replaceAll('\\', '/')
    config.provenance = path
      .relative(root, path.join(directory, 'provenance.json'))
      .replaceAll('\\', '/')
    const configPath = path.join(directory, 'config.json')
    await writeFile(configPath, JSON.stringify(config))
    assert.equal(run(configPath).status, 0)
    assert.equal(run(configPath, true).status, 0)
    await appendFile(path.join(directory, 'rig.ts'), '\n// unexpected mutation\n')
    const result = run(configPath, true)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /pinned extraction differs/)
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), root)
    await rm(directory, { recursive: true, force: true })
  }
})
