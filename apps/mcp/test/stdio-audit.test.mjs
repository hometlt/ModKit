import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const tests = fileURLToPath(new URL('.', import.meta.url))
const executable = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const blizzard = resolve(tests, '../../../../modkit-extensions-blizzard/starcraft2')

async function connect(root, extension, extra = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, '--root', root, '--extension', extension, ...extra],
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', chunk => {
    stderr += chunk.toString()
  })
  const client = new Client({ name: 'sc2-public-stdio-audit', version: '1.0.0' })
  await client.connect(transport)
  const call = async (name, args = {}) => {
    const result = await client
      .callTool({ name, arguments: args }, { timeout: 30_000 })
      .catch(error => {
        throw new Error(`${name}: ${error.message}; stderr=${stderr}`, { cause: error })
      })
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}; ${stderr}`)
    const envelope = result.structuredContent
    assert.equal(envelope.trust, 'untrusted-data')
    assert.notEqual(envelope.completeness, 'invalid', JSON.stringify(envelope))
    return envelope
  }
  return { client, call, stderr: () => stderr }
}

test('stdio accepts an advertised overlay larger than 1 MiB', { timeout: 60_000 }, async () => {
  const extension = resolve(tests, 'fixtures/language-session-extension')
  const { client, call } = await connect(extension, extension)
  try {
    const opened = await call('modkit.language_session_open', {
      documents: [
        {
          uri: 'untitled:Large.fixturelang',
          languageId: 'fixture-language',
          text: 'x'.repeat(1_100_000),
        },
      ],
    })
    assert.equal(opened.data.documents[0].version, 1)
    await call('modkit.language_session_close', { sessionHandle: opened.data.sessionHandle })
  } finally {
    await client.close()
  }
})

test(
  'public SC2 stdio discovery, overlays, edit commit, reopen, undo and redo',
  { timeout: 240_000 },
  async t => {
    const root = await mkdtemp(join(tests, '.stdio-audit-'))
    let client
    try {
      const base = join(root, 'Audit.SC2Mod', 'Base.SC2Data')
      const dataPath = join(base, 'GameData', 'UnitData.xml')
      const scriptPath = join(base, 'MapScript.galaxy')
      const libraryPath = join(base, 'Lib.galaxy')
      await mkdir(join(base, 'GameData'), { recursive: true })
      await Promise.all([
        writeFile(
          dataPath,
          '<Catalog><CUnit id="AuditMarine"><LifeMax value="45"/></CUnit></Catalog>',
        ),
        writeFile(scriptPath, 'include "Lib"\nvoid Init() { int x = Helper(2); }\n'),
        writeFile(libraryPath, 'int Helper(int value) { return value; }\n'),
      ])
      const connected = await connect(root, blizzard, ['--allow-edits'])
      client = connected.client
      const { call } = connected
      const toolNames = (await client.listTools()).tools.map(tool => tool.name)
      for (const name of [
        'modkit.capabilities',
        'modkit.inventory',
        'modkit.service_operations',
        'modkit.language_session_open',
        'modkit.language_session_feature',
        'modkit.propose_edit',
        'modkit.prepare_edit',
        'modkit.commit_edit',
        'modkit.undo_edit',
        'modkit.redo_edit',
      ]) {
        assert.ok(toolNames.includes(name), name)
      }
      const capabilities = await call('modkit.capabilities')
      assert.equal(capabilities.data.edits.enabled, true)
      const inventory = await call('modkit.inventory', { limit: 20 })
      const services = await call('modkit.service_operations', { limit: 20, activate: false })
      assert.ok(inventory.data.total > 0)
      assert.ok(services.data.total > 0)
      assert.ok((await client.listResourceTemplates()).resourceTemplates.length > 0)
      const session = await call('modkit.language_session_open', {
        documents: [
          { path: scriptPath, languageId: 'galaxy', documentKind: 'galaxy-source' },
          { path: libraryPath, languageId: 'galaxy', documentKind: 'galaxy-source' },
        ],
      })
      const sessionHandle = session.data.sessionHandle
      const primaryUri = session.data.documents[0].uri
      const definition = await call('modkit.language_session_feature', {
        sessionHandle,
        primaryUri,
        feature: 'definition',
        position: { line: 1, character: 24 },
        maxResults: 20,
      })
      assert.ok(
        definition.data.result.locations.some(
          location => location.uri === pathToFileURL(libraryPath).href,
        ),
        JSON.stringify(definition),
      )
      const tokens = await call('modkit.language_session_feature', {
        sessionHandle,
        primaryUri,
        feature: 'semantic-tokens',
        maxResults: 1,
      })
      assert.equal(tokens.data.result.tokens.length, 1)
      assert.equal(tokens.completeness, 'partial')
      const updated = await call('modkit.language_session_update', {
        sessionHandle,
        uri: primaryUri,
        version: 2,
        text: 'include "Lib"\nvoid Init() { int x = Helper(3); }\n',
      })
      assert.equal(updated.data.result.analysis.documentVersion, 2)
      const stale = await client.callTool({
        name: 'modkit.language_session_update',
        arguments: {
          sessionHandle,
          uri: primaryUri,
          version: 2,
          text: 'stale',
        },
      })
      assert.equal(stale.isError, true)
      assert.equal(stale.structuredContent.diagnostics[0].code, 'x3.mcp/language-version-stale')
      await call('modkit.language_session_close', { sessionHandle })

      t.diagnostic(
        JSON.stringify({
          stage: 'SC2 language smoke passed',
          toolNames,
          inventoryTotal: inventory.data.total,
          serviceOperationsTotal: services.data.total,
          features: session.data.documents[0].features,
          definition: definition.completeness,
          updateVersion: 2,
          staleUpdateRejected: true,
        }),
      )

      const open = async () => {
        const opened = await call('modkit.open_subject', { path: dataPath })
        const handle = opened.data.handle
        assert.equal(typeof handle, 'string', JSON.stringify(opened))
        const candidates = opened.data.selectionCandidates ?? []
        if (candidates.length > 0) {
          const candidate = candidates.find(item => item.codecId === 'blizzard/sc2-data')
          assert.ok(candidate, JSON.stringify(candidates))
          await call('modkit.open_selection', { handle, selectionId: candidate.candidateId })
        }
        return handle
      }
      const handle = await open()
      const inspected = await call('modkit.inspect', { handle })
      const edit = inspected.data.descriptor.operations.find(
        operation =>
          operation.id === 'edit.field' &&
          operation.mutatesSource &&
          operation.state === 'available',
      )
      assert.ok(edit, JSON.stringify(inspected))
      const subjects = await call('modkit.search_subjects', {
        handle,
        subjectId: 'Unit/AuditMarine',
        limit: 20,
      })
      assert.equal(subjects.data.exact?.subjectId, 'Unit/AuditMarine', JSON.stringify(subjects))
      // Search canonicalization and selector opening are separate owner capabilities. This synthetic
      // single-file source currently advertises the canonical exact id but has no selectable card.
      const proposed = await call('modkit.propose_edit', {
        handle,
        operationId: edit.id,
        input: { path: ['Unit', 'AuditMarine', 'LifeMax'], value: '55' },
      })
      const planHandle = proposed.data.planHandle
      const prepared = await call('modkit.prepare_edit', { planHandle })
      assert.equal(prepared.data.state, 'ready')
      const committed = await call('modkit.commit_edit', { planHandle })
      assert.equal(committed.data.result.state, 'committed')
      const transactionId = committed.data.result.receipt.transactionId
      const reopened = await open()
      const changed = await call('modkit.inspect', { handle: reopened })
      assert.notEqual(changed.data.descriptor.revision, inspected.data.descriptor.revision)
      await call('modkit.close_subject', { handle: reopened })
      assert.equal(
        (await call('modkit.undo_edit', { transactionId })).data.result.state,
        'committed',
      )
      const redone = await call('modkit.redo_edit', { transactionId })
      assert.equal(redone.data.result.state, 'committed')
      const redoId = redone.data.result.receipt.transactionId
      assert.equal(
        (await call('modkit.undo_edit', { transactionId: redoId })).data.result.state,
        'committed',
      )
      await call('modkit.discard_edit', { id: redoId })
      await call('modkit.close_subject', { handle })
      t.diagnostic(
        JSON.stringify({
          toolNames,
          inventory: { total: inventory.data.total, completeness: inventory.completeness },
          services: { total: services.data.total, completeness: services.completeness },
          languageFeatures: session.data.documents[0].features,
          definition: definition.completeness,
          editOperation: edit.id,
          commit: 'committed',
          reopen: 'revision changed',
          undo: 'committed',
          redo: 'committed',
        }),
      )
    } finally {
      await client?.close()
      assert.ok(relative(tests, root).startsWith('.stdio-audit-'))
      await rm(root, { recursive: true, force: true })
    }
  },
)
