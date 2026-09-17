/**
 * Writes to resolved subjects (values that come from the mod dependency chain) through the same
 * host lifecycle as subject edits: propose → prepare → commit → history → reopen → undo/redo/discard.
 * The StarCraft II resolved-data provider chooses the destination in the active mod or asks for one.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { ModkitError } from '@modkit/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type ModkitMcpHostPort,
} from '../src/index.js'

const blizzard = resolve(import.meta.dirname, '..', '..', '..', '..', 'modkit-extensions-blizzard')
const GAME = 'blizzard/starcraft-2'
const UNIT_DATA = join('Base.SC2Data', 'GameData', 'UnitData.xml')
const baseXml = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
  <CUnit id="Marine"><LifeMax value="45"/></CUnit>
</Catalog>
`
const activeXml = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
  <CUnit id="Marine"><WeaponArray index="0" Link="GaussRifle"/><Mover value="Ground"/><LifeMax value="50"/></CUnit>
  <CUnit id="Marauder"><WeaponArray index="0" Link="GaussRifle"/></CUnit>
  <CWeaponLegacy id="GaussRifle"><DisplayEffect value="GaussDamage"/></CWeaponLegacy>
</Catalog>
`

let root: string
let host: ModkitMcpHostPort
let app: ReturnType<typeof createModkitMcpServer>
let client: Client
const dir = (name: string) => join(root, `${name}.SC2Mod`)

type CallResult = Awaited<ReturnType<Client['callTool']>>
const envelope = (value: CallResult) => value.structuredContent as McpEnvelope
const data = (value: CallResult) => (envelope(value).data ?? {}) as Record<string, unknown>
const codes = (value: CallResult) =>
  envelope(value).diagnostics.map(item => (item as { code?: string }).code)
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args })

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'modkit-mcp-resolved-edit-'))
  await mkdir(join(dir('A'), 'Base.SC2Data', 'GameData'), { recursive: true })
  await mkdir(join(dir('C'), 'Base.SC2Data', 'GameData'), { recursive: true })
  await writeFile(join(dir('A'), UNIT_DATA), baseXml)
  await writeFile(join(dir('C'), UNIT_DATA), activeXml)
  host = await createHostMcpPort({
    roots: [root],
    extensions: [resolve(blizzard, 'starcraft2')],
    allowEdits: true,
  })
  app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'sc2-resolved-edit', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
}, 180_000)

afterAll(async () => {
  await Promise.allSettled([client?.close()])
  await Promise.allSettled([app?.dispose()])
  await host?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}, 60_000)

async function openWorkspace(names: readonly string[], maxRequirements?: number) {
  const opened = await call('modkit.open_resolved_workspace', {
    gameId: GAME,
    directories: names.map(dir),
    ...(maxRequirements === undefined ? {} : { maxRequirements }),
  })
  return opened
}

const handleOf = (opened: CallResult): string => {
  const handle = data(opened)['handle']
  if (typeof handle !== 'string')
    throw new Error(`workspace did not open: ${JSON.stringify(opened.structuredContent)}`)
  return handle
}

async function commit(planHandle: unknown): Promise<string> {
  const prepared = await call('modkit.prepare_edit', { planHandle })
  if (data(prepared)['state'] !== 'ready')
    throw new Error(`prepare: ${JSON.stringify(prepared.structuredContent)}`)
  const committed = await call('modkit.commit_edit', { planHandle })
  const result = data(committed)['result'] as {
    state?: string
    receipt?: { transactionId: string }
  }
  if (result?.state !== 'committed' || result.receipt === undefined) {
    throw new Error(`commit: ${JSON.stringify(committed.structuredContent)}`)
  }
  return result.receipt.transactionId
}

const lifeField = (value: number, targetDocument?: { rootId: string; path: string }) => ({
  kind: 'field',
  subjectId: 'Unit/Marine',
  fieldPath: ['LifeMax'],
  intent: { kind: 'set-field', value: String(value) },
  ...(targetDocument === undefined ? {} : { targetDocument }),
})

describe('MCP resolved-subject edits through the host lifecycle', () => {
  it('lists the tools with schemas and non-destructive proposal annotations', async () => {
    const tools = (await client.listTools()).tools
    for (const name of ['modkit.open_resolved_workspace', 'modkit.propose_resolved_edit']) {
      const tool = tools.find(item => item.name === name)
      expect(tool?.inputSchema).toBeDefined()
      expect(tool?.annotations?.destructiveHint).toBe(false)
    }
  })

  it('writes an inherited field into the active declaration, reopens, undoes and redoes', async () => {
    const workspace = handleOf(await openWorkspace(['A', 'C']))
    try {
      const before = await readFile(join(dir('C'), UNIT_DATA), 'utf8')
      const proposal = await call('modkit.propose_resolved_edit', {
        handle: workspace,
        change: lifeField(60),
      })
      const proposed = data(proposal)
      expect(proposed).toMatchObject({
        state: 'planned',
        committed: false,
        preview: { state: 'resolved', destination: { rootId: 'C', mode: 'replace' } },
      })
      expect(await readFile(join(dir('C'), UNIT_DATA), 'utf8')).toBe(before)
      const transactionId = await commit(proposed['planHandle'])
      const written = await readFile(join(dir('C'), UNIT_DATA), 'utf8')
      expect(written).toContain('<LifeMax value="60"/>')
      expect(written).toContain('<CUnit id="Marauder">')
      expect(await readFile(join(dir('A'), UNIT_DATA), 'utf8')).toBe(baseXml)

      const history = data(await call('modkit.edit_history', { limit: 100 }))
      expect(JSON.stringify(history['items'])).toContain(transactionId)

      // The old workspace snapshot is now stale: its plan conflicts at prepare.
      const stale = data(
        await call('modkit.propose_resolved_edit', { handle: workspace, change: lifeField(70) }),
      )
      const stalePrepared = await call('modkit.prepare_edit', { planHandle: stale['planHandle'] })
      expect(envelope(stalePrepared).completeness).toBe('invalid')
      expect(JSON.stringify(data(stalePrepared)['conflicts'])).toContain('UnitData')
      await call('modkit.discard_edit', { id: stale['planHandle'] })

      // Reopen from disk: the resolved value is the committed one.
      const reopened = handleOf(await openWorkspace(['A', 'C']))
      const againCall = await call('modkit.propose_resolved_edit', {
        handle: reopened,
        change: lifeField(65),
      })
      const again = data(againCall)
      if (again['state'] !== 'planned') {
        throw new Error(`reopened: ${JSON.stringify(envelope(againCall).diagnostics)}`)
      }
      await call('modkit.discard_edit', { id: again['planHandle'] })
      await call('modkit.close_subject', { handle: reopened })

      const undone = data(await call('modkit.undo_edit', { transactionId }))
      expect(undone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(join(dir('C'), UNIT_DATA), 'utf8')).toBe(before)
      const redone = data(await call('modkit.redo_edit', { transactionId }))
      expect(redone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(join(dir('C'), UNIT_DATA), 'utf8')).toBe(written)
      const redoId = (redone['result'] as { receipt: { transactionId: string } }).receipt
        .transactionId
      expect(redoId).not.toBe(transactionId)
      const undoneAgain = await call('modkit.undo_edit', { transactionId: redoId })
      expect(
        data(undoneAgain)['result'],
        JSON.stringify(undoneAgain.structuredContent),
      ).toMatchObject({
        state: 'committed',
      })
      expect(await readFile(join(dir('C'), UNIT_DATA), 'utf8')).toBe(before)
      expect(data(await call('modkit.discard_edit', { id: redoId }))).toMatchObject({
        kind: 'history',
        discarded: true,
      })
    } finally {
      await call('modkit.close_subject', { handle: workspace })
    }
  }, 300_000)

  it('refuses another mod and a destination that bypasses the active declaration', async () => {
    const workspace = handleOf(await openWorkspace(['A', 'C']))
    try {
      const otherMod = await call('modkit.propose_resolved_edit', {
        handle: workspace,
        change: lifeField(80, { rootId: 'A', path: 'a.sc2mod/base.sc2data/gamedata/unitdata.xml' }),
      })
      expect(envelope(otherMod).completeness).toBe('invalid')
      expect(data(otherMod)).not.toHaveProperty('planHandle')

      const bypass = await call('modkit.propose_resolved_edit', {
        handle: workspace,
        change: lifeField(80, { rootId: 'C', path: 'c.sc2mod/base.sc2data/gamedata/abildata.xml' }),
      })
      expect(envelope(bypass).completeness).toBe('invalid')
      expect(data(bypass)).not.toHaveProperty('planHandle')
      expect(JSON.stringify(bypass.structuredContent)).toMatch(/last declaration/u)
      expect(await readFile(join(dir('A'), UNIT_DATA), 'utf8')).toBe(baseXml)
    } finally {
      await call('modkit.close_subject', { handle: workspace })
    }
    // A foreign root outside the configured roots never opens.
    const outside = await call('modkit.open_resolved_workspace', {
      gameId: GAME,
      directories: [resolve(root, '..', 'Elsewhere.SC2Mod')],
    })
    expect(outside.isError).toBe(true)
  }, 300_000)

  /*
   * The real provider answers `selection-required` only when the active mod has no canonical
   * catalog in the plan, which a complete host plan never produces (every canonical document is
   * planned). The adapter path is therefore proven over a host port that answers exactly that.
   */
  it('returns candidates and retains nothing when the destination must be chosen', async () => {
    const candidates = [
      { rootId: 'D', path: 'd.sc2mod/base.sc2data/gamedata/sc2data.xml' },
      { rootId: 'D', path: 'd.sc2mod/base.sc2data/gamedata/abildata.xml' },
    ]
    let planned = 0
    const workspace = {
      snapshotId: 'fake-snapshot',
      activeRootId: 'D',
      rootIds: ['A', 'D'],
      diagnostics: [],
      editing: host as never,
      selector: {
        summary: async () => ({
          snapshotId: 'fake-snapshot',
          totalSubjects: 1,
          completeness: 'complete',
        }),
        subjects: async () => ({ items: [], total: 1 }),
        editTarget: async (request: { targetDocument?: unknown }) =>
          request.targetDocument === undefined
            ? {
                state: 'selection-required',
                snapshotId: 'fake-snapshot',
                workspaceId: 'fake',
                selectedRootId: 'D',
                subjectId: 'Unit/Marine',
                fieldPath: ['LifeMax'],
                candidates,
                reason: 'the active mod has no canonical Unit catalog',
              }
            : {
                state: 'resolved',
                destination: { rootId: 'D', path: candidates[1]?.path, mode: 'create' },
              },
      },
      planChange: async () => {
        planned += 1
        throw new ModkitError({
          code: 'x3.host/resolved-data-edit-selection-required',
          message: 'choose a destination document',
          context: { candidates },
        })
      },
      release: async () => undefined,
    }
    const fakePort: ModkitMcpHostPort = {
      ...host,
      openResolvedDataWorkspace: async () => ({ state: 'resolved', workspace: workspace as never }),
    }
    const fake = createModkitMcpServer(fakePort)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const fakeClient = new Client({ name: 'sc2-resolved-selection', version: '1.0.0' })
    await Promise.all([fake.server.connect(serverTransport), fakeClient.connect(clientTransport)])
    try {
      const opened = await fakeClient.callTool({
        name: 'modkit.open_resolved_workspace',
        arguments: { gameId: GAME, directories: [dir('A'), dir('D')] },
      })
      const handle = handleOf(opened)
      const ambiguous = await fakeClient.callTool({
        name: 'modkit.propose_resolved_edit',
        arguments: { handle, change: lifeField(70) },
      })
      expect(envelope(ambiguous).completeness).toBe('partial')
      expect(codes(ambiguous)).toContain('x3.mcp/resolved-edit-selection-required')
      expect(data(ambiguous)).not.toHaveProperty('planHandle')
      expect(data(ambiguous)['preview']).toMatchObject({ candidates })
      expect(planned).toBe(0)

      // Naming a candidate reaches the host; its structured refusal keeps the candidate list.
      const named = await fakeClient.callTool({
        name: 'modkit.propose_resolved_edit',
        arguments: { handle, change: lifeField(70, candidates[1]) },
      })
      expect(planned).toBe(1)
      expect(codes(named)).toContain('x3.host/resolved-data-edit-selection-required')
      expect(data(named)).toMatchObject({ state: 'refused', context: { candidates } })
      expect(data(named)).not.toHaveProperty('planHandle')
    } finally {
      await fakeClient.close()
      await fake.dispose()
    }
  })

  it('isolates a shared object as one committed change', async () => {
    const workspace = handleOf(await openWorkspace(['A', 'C']))
    try {
      const proposalCall = await call('modkit.propose_resolved_edit', {
        handle: workspace,
        change: {
          kind: 'isolation',
          ownerSubjectId: 'Unit/Marine',
          targetSubjectId: 'Weapon/GaussRifle',
          cloneSubjectId: 'Weapon/MarineGaussRifle',
          ownerFieldPath: ['WeaponArray', '0', 'Link'],
        },
      })
      const proposal = data(proposalCall)
      if (proposal['state'] !== 'planned')
        throw new Error(`isolation: ${JSON.stringify(envelope(proposalCall).diagnostics)}`)
      expect(proposal).toMatchObject({ state: 'planned', preview: { state: 'planned' } })
      const transactionId = await commit(proposal['planHandle'])
      const written = await readFile(join(dir('C'), UNIT_DATA), 'utf8')
      expect(written).toContain('Link="MarineGaussRifle"')
      expect(written).toContain('<CUnit id="Marauder"><WeaponArray index="0" Link="GaussRifle"/>')
      const undone = await call('modkit.undo_edit', { transactionId })
      expect(data(undone)['result'], JSON.stringify(undone.structuredContent)).toMatchObject({
        state: 'committed',
      })
      expect(await readFile(join(dir('C'), UNIT_DATA), 'utf8')).toBe(activeXml)
    } finally {
      await call('modkit.close_subject', { handle: workspace })
    }
  }, 300_000)
})
