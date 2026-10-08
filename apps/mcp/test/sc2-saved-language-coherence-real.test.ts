/**
 * Public installed SC2 product route: MCP resolved edits keep canonical language saved models
 * coherent through commit/Undo/Redo. The producer receipt/config are explicit opt-in corpus
 * inputs; the test only writes its own temporary mod and caches. No archives/game files are read
 * directly. Editing still uses the existing exact guards/writer/history; directory analysis is
 * intentionally not claimed to have migrated to the canonical model by this coherence proof.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import {
  createHostMcpPort,
  createModkitMcpServer,
  type McpEnvelope,
  type McpLanguageSession,
  type ModkitMcpHostPort,
} from '../src/index.js'

const receiptPath = process.env.MODKIT_TEST_SC2_INSTALLED_RECEIPT
const configPath = process.env.MODKIT_TEST_SC2_SOURCE_CONFIG
const GAME = 'blizzard/starcraft-2'
const UNIT_DATA = join('Base.SC2Data', 'GameData', 'UnitData.xml')
/** A unique entity keeps this fixture independent of installed Marine overrides. */
const xml = (value: number) => `<Catalog>\n  <CUnit id="ArchitectureMarine"><LifeMax value="${value}"/></CUnit>\n</Catalog>\n`

describe.runIf(receiptPath !== undefined && configPath !== undefined)('installed SC2 MCP saved/language coherence', () => {
  it('refreshes retained canonical Data hover after commit, Undo and Redo without losing exact bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modkit-mcp-sc2-coherence-'))
    const base = join(root, 'A.SC2Mod')
    const active = join(root, 'C.SC2Mod')
    const source = join(active, UNIT_DATA)
    let host: ModkitMcpHostPort | undefined
    let app: ReturnType<typeof createModkitMcpServer> | undefined
    let client: Client | undefined
    let workspace: string | undefined
    let language: McpLanguageSession | undefined
    try {
      const receipt = JSON.parse(await readFile(receiptPath!, 'utf8')) as {
        passed: boolean; roots: readonly { root: string; expectedId: string }[]
      }
      expect(receipt.passed).toBe(true)
      expect(receipt.roots.some(item => item.expectedId === 'blizzard/starcraft2')).toBe(true)
      const configuration = JSON.parse(await readFile(configPath!, 'utf8')) as {
        module: string; options: Record<string, unknown>
      }
      const localConfig = join(root, 'content-source-config.json')
      await writeFile(localConfig, JSON.stringify({ ...configuration, options: {
        ...configuration.options,
        battleNetCacheDirectory: join(root, 'bnet-cache'),
        documentsDirectory: join(root, 'documents'),
      } }))
      await mkdir(join(base, 'Base.SC2Data', 'GameData'), { recursive: true })
      await mkdir(join(active, 'Base.SC2Data', 'GameData'), { recursive: true })
      await writeFile(join(base, UNIT_DATA), xml(45))
      await writeFile(source, xml(50))
      const before = await readFile(source)
      host = await createHostMcpPort({
        roots: [root], extensions: receipt.roots.map(item => item.root),
        trustExtensions: true, allowEdits: true,
        contentSourceConfig: localConfig,
        contentSourceStorage: join(root, 'content-source-storage'), sharedModServer: false,
      })
      app = createModkitMcpServer(host)
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      client = new Client({ name: 'sc2-saved-language-coherence', version: '1.0.0' })
      await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
      expect(host.openLanguageSession).toBeTypeOf('function')
      language = await host.openLanguageSession!({ documents: [{ path: source, languageId: 'sc2-data' }] })
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client!.callTool({ name, arguments: args })
        const envelope = result.structuredContent as McpEnvelope
        expect(envelope.diagnostics.filter(item => item.severity === 'error'), JSON.stringify(envelope)).toEqual([])
        expect(envelope.diagnostics.some(item => item.code === 'x3.mcp/source-refresh-failed')).toBe(false)
        return (envelope.data ?? {}) as Record<string, unknown>
      }
      /** Keep one view open across every write: reopening itself must not conceal a stale model. */
      const hover = async (value: number) => {
          const result = await language!.invoke({
            primaryUri: language!.documents[0]!.uri, feature: 'hover',
            position: { line: 1, character: xml(value).split('\n')[1]!.indexOf('LifeMax') + 3 },
            maxResults: 20, maxEdits: 20,
          })
          const markdown = (result.result as { markdown?: string } | undefined)?.markdown
          expect(markdown, JSON.stringify(result)).toBeTypeOf('string')
          const effective = /^\*\*LifeMax\*\* = (?:`([^`]+)`|\n```json\n([\s\S]*?)\n```)/u.exec(markdown!)
          expect(effective, markdown).not.toBeNull()
          expect(effective![1] ?? effective![2]).toBe(String(value))
      }
      await hover(50)
      const opened = await call('modkit.open_resolved_workspace', { gameId: GAME, directories: [base, active] })
      workspace = opened['handle'] as string
      expect(workspace).toBeTypeOf('string')
      const proposal = await call('modkit.propose_resolved_edit', {
        handle: workspace,
        change: { kind: 'field', subjectId: 'Unit/ArchitectureMarine', fieldPath: ['LifeMax'], intent: { kind: 'set-field', value: '60' } },
      })
      expect(proposal['state']).toBe('planned')
      expect(await readFile(source)).toEqual(before)
      const prepared = await call('modkit.prepare_edit', { planHandle: proposal['planHandle'] })
      expect(prepared['state']).toBe('ready')
      const committed = await call('modkit.commit_edit', { planHandle: proposal['planHandle'] })
      const transaction = committed['result'] as { state: string; receipt: { transactionId: string } }
      expect(transaction.state).toBe('committed')
      const written = await readFile(source)
      expect(written.toString('utf8')).toContain('value="60"')
      await hover(60)
      const undone = await call('modkit.undo_edit', { transactionId: transaction.receipt.transactionId })
      expect(undone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(source)).toEqual(before)
      await hover(50)
      const redone = await call('modkit.redo_edit', { transactionId: transaction.receipt.transactionId })
      expect(redone['result']).toMatchObject({ state: 'committed' })
      expect(await readFile(source)).toEqual(written)
      await hover(60)
      expect(await readFile(join(base, UNIT_DATA), 'utf8')).toBe(xml(45))
    } finally {
      await language?.close()
      if (workspace !== undefined && client !== undefined) await client.callTool({ name: 'modkit.close_subject', arguments: { handle: workspace } }).catch(() => undefined)
      await client?.close()
      await app?.dispose()
      await host?.close()
      const basePath = resolve(tmpdir())
      const suffix = relative(basePath, resolve(root))
      if (suffix.startsWith('..') || !suffix.startsWith('modkit-mcp-sc2-coherence-')) throw new Error('fixture cleanup escaped its temporary root')
      await rm(root, { recursive: true, force: true })
    }
  }, 180_000)
})
