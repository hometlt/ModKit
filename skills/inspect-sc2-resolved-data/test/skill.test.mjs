import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const repositoryRoot = new URL('../../../', import.meta.url)

const read = relative => readFile(new URL(relative, root), 'utf8')

test('every public Modkit tool named by the skill exists in the MCP adapter', async () => {
  const [skill, workflows, server] = await Promise.all([
    read('SKILL.md'),
    read('references/public-mk3-workflows.md'),
    readFile(new URL('apps/mcp/src/server.ts', repositoryRoot), 'utf8'),
  ])
  const registered = new Set(
    [...server.matchAll(/server\.registerTool\(\s*'([^']+)'/gu)].map(match => match[1]),
  )
  const named = new Set(
    [...`${skill}\n${workflows}`.matchAll(/`(modkit\.[a-z_]+)`/gu)].map(match => match[1]),
  )
  assert.ok(named.size >= 20, 'skill should exercise the public discovery/read/edit lifecycle')
  assert.deepEqual(
    [...named].filter(name => !registered.has(name)),
    [],
  )
  assert.doesNotMatch(`${skill}\n${workflows}`, /@modkitx\//u)
})

test('evaluation corpus covers every requested module and failure boundary', async () => {
  const corpus = JSON.parse(await read('evals/cases.json'))
  const ids = corpus.cases.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const expected of [
    'data-effective-provenance',
    'galaxy-unsaved-diagnostics',
    'galaxy-trigger-conversion-loss',
    'layout-template-preview',
    'strings-markup-translation',
    'style-effective-render',
    'wizard-bounded-expansion',
    'mod-metadata-transaction',
    'cross-format-two-mod-isolation',
    'stale-plan-recovery',
    'knowledge-prompt-injection',
    'missing-capability',
  ]) {
    assert.ok(ids.includes(expected), `missing evaluation case ${expected}`)
  }
  assert.ok(corpus.defaults.maxPagesPerCollection <= 5)
  assert.ok(corpus.defaults.maxGraphDepth <= 3)
  assert.ok(corpus.metrics.includes('privateAccessAttempts'))
})
