/**
 * Public installed SC2 product route: MCP resolved edits keep canonical language saved models
 * coherent through commit/Undo/Redo. The producer receipt/config are explicit opt-in corpus
 * inputs; the test only writes its own temporary mod and caches. No archives/game files are read
 * directly. Both explicit directory chains and canonical package inputs use exact guards/writer/
 * history. Package tests cover stale source refusal/disposal and missed dependency saves; provider
 * analysis is not claimed to reuse the loader's retained Data model by this input-binding proof.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadContentSources } from '@modkit/vfs/content-sources/node'
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
const xml = (value: number) =>
  `<Catalog>\n  <CUnit id="ArchitectureMarine"><LifeMax value="${value}"/></CUnit>\n</Catalog>\n`

describe.runIf(receiptPath !== undefined && configPath !== undefined)(
  'installed SC2 MCP saved/language coherence',
  () => {
    it.each(['directories', 'target', 'target-empty'] as const)(
      'keeps %s workspace transactions or creation refusals exact',
      async mode => {
        const emptyActive = mode === 'target-empty'
        const packageMode = mode !== 'directories'
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
            passed: boolean
            roots: readonly { root: string; expectedId: string }[]
          }
          expect(receipt.passed).toBe(true)
          expect(receipt.roots.some(item => item.expectedId === 'blizzard/starcraft2')).toBe(true)
          const configuration = JSON.parse(await readFile(configPath!, 'utf8')) as {
            module: string
            options: Record<string, unknown>
          }
          const localConfig = join(root, 'content-source-config.json')
          await writeFile(
            localConfig,
            JSON.stringify({
              ...configuration,
              options: {
                ...configuration.options,
                battleNetCacheDirectory: join(root, 'bnet-cache'),
                documentsDirectory: join(root, 'documents'),
              },
            }),
          )
          await mkdir(join(base, 'Base.SC2Data', 'GameData'), { recursive: true })
          await mkdir(join(active, 'Base.SC2Data', 'GameData'), { recursive: true })
          await writeFile(join(base, UNIT_DATA), xml(45))
          if (!emptyActive) await writeFile(source, xml(50))
          if (packageMode)
            await writeFile(
              join(active, 'DocumentInfo'),
              '<DocInfo><Dependencies><Value>file:A.SC2Mod</Value></Dependencies></DocInfo>',
            )
          const before = emptyActive ? undefined : await readFile(source)
          let staleRead = false
          let staleReleases = 0
          const sources = packageMode
            ? await loadContentSources(localConfig, join(root, 'content-source-storage'))
            : undefined
          const injected =
            sources === undefined
              ? undefined
              : new Proxy(sources, {
                  get(target, property) {
                    if (property === 'openModContext')
                      return async (
                        request: Parameters<NonNullable<typeof sources.openModContext>>[0],
                      ) => {
                        const context = await target.openModContext!(request)
                        if (!staleRead) return context
                        return {
                          ...context,
                          read: async (layerId: string, path: string, maxBytes: number) =>
                            layerId === context.layers.at(-1)!.id &&
                            path.toLowerCase().endsWith('gamedata/unitdata.xml')
                              ? new TextEncoder().encode(xml(49))
                              : context.read(layerId, path, maxBytes),
                          async dispose() {
                            staleReleases++
                            await context.dispose()
                          },
                        }
                      }
                    const value: unknown = Reflect.get(target, property, target)
                    return typeof value === 'function' ? value.bind(target) : value
                  },
                })
          host = await createHostMcpPort(
            {
              roots: [root],
              extensions: receipt.roots.map(item => item.root),
              trustExtensions: true,
              allowEdits: true,
              contentSourceConfig: localConfig,
              contentSourceStorage: join(root, 'content-source-storage'),
              sharedModServer: false,
            },
            undefined,
            injected === undefined ? {} : { contentSources: injected },
          )
          app = createModkitMcpServer(host)
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
          client = new Client({ name: 'sc2-saved-language-coherence', version: '1.0.0' })
          await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
          expect(host.openLanguageSession).toBeTypeOf('function')
          if (!emptyActive)
            language = await host.openLanguageSession!({
              documents: [{ path: source, languageId: 'sc2-data' }],
            })
          const call = async (name: string, args: Record<string, unknown>) => {
            const result = await client!.callTool({ name, arguments: args })
            const envelope = result.structuredContent as McpEnvelope
            expect(
              envelope.diagnostics.filter(item => item.severity === 'error'),
              JSON.stringify(envelope),
            ).toEqual([])
            expect(
              envelope.diagnostics.some(item => item.code === 'x3.mcp/source-refresh-failed'),
            ).toBe(false)
            if (name === 'modkit.propose_resolved_edit')
              expect(
                (envelope.data as Record<string, unknown> | undefined)?.['state'],
                JSON.stringify(envelope),
              ).toBe('planned')
            return (envelope.data ?? {}) as Record<string, unknown>
          }
          /** Keep one view open across every write: reopening itself must not conceal a stale model. */
          const hover = async (value: number) => {
            if (emptyActive) return
            const result = await language!.invoke({
              primaryUri: language!.documents[0]!.uri,
              feature: 'hover',
              position: { line: 1, character: xml(value).split('\n')[1]!.indexOf('LifeMax') + 3 },
              maxResults: 20,
              maxEdits: 20,
            })
            const markdown = (result.result as { markdown?: string } | undefined)?.markdown
            expect(markdown, JSON.stringify(result)).toBeTypeOf('string')
            const effective = /^\*\*LifeMax\*\* = (?:`([^`]+)`|\n```json\n([\s\S]*?)\n```)/u.exec(
              markdown!,
            )
            expect(effective, markdown).not.toBeNull()
            expect(effective![1] ?? effective![2]).toBe(String(value))
          }
          await hover(50)
          if (packageMode && !emptyActive) {
            staleRead = true
            try {
              await expect(
                host.openResolvedDataWorkspace!(
                  {
                    gameId: GAME,
                    target: source,
                    locales: ['enUS'],
                    maxRequirements: 512,
                  },
                  new AbortController().signal,
                ),
              ).rejects.toMatchObject({ code: 'x3.host/resolved-data-source-binding-failed' })
              expect(staleReleases).toBe(1)
              expect(await readFile(source)).toEqual(before)
            } finally {
              staleRead = false
            }
          }
          const opened = await call('modkit.open_resolved_workspace', {
            gameId: GAME,
            ...(packageMode
              ? { target: emptyActive ? active : source }
              : { directories: [base, active] }),
          })
          if (packageMode) {
            const context = await host.modContext!(
              pathToFileURL(emptyActive ? active : source).href,
            )
            expect(
              context.layers.some(layer =>
                layer.sourcePath.toLowerCase().endsWith('mods/core.sc2mod'),
              ),
            ).toBe(true)
            expect(opened['rootIds']).toHaveLength(context.layers.length)
            expect(opened['activeRootId']).toBe((opened['rootIds'] as string[]).at(-1))
          }
          workspace = opened['handle'] as string
          expect(workspace).toBeTypeOf('string')
          if (emptyActive) {
            // The existing planner supplies no absent catalog candidate after a complete listing.
            // Preserve its refusal; enabling native creation is a separate provider-plan change.
            const refused = await client.callTool({
              name: 'modkit.propose_resolved_edit',
              arguments: {
                handle: workspace,
                change: {
                  kind: 'field',
                  subjectId: 'Unit/ArchitectureMarine',
                  fieldPath: ['LifeMax'],
                  intent: { kind: 'set-field', value: '60' },
                  targetDocument: {
                    rootId: opened['activeRootId'],
                    path: `${String(opened['activeSourcePath'])}/Base.SC2Data/GameData/UnitData.xml`,
                  },
                },
              },
            })
            expect(
              (refused.structuredContent as McpEnvelope).diagnostics.map(item => item.code),
            ).toContain('x3.mcp/resolved-edit-unavailable')
            await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' })
            expect(await readFile(join(base, UNIT_DATA), 'utf8')).toBe(xml(45))
            return
          }
          const proposal = await call('modkit.propose_resolved_edit', {
            handle: workspace,
            change: {
              kind: 'field',
              subjectId: 'Unit/ArchitectureMarine',
              fieldPath: ['LifeMax'],
              intent: { kind: 'set-field', value: '60' },
            },
          })
          expect(proposal['state']).toBe('planned')
          expect(await readFile(source)).toEqual(before)
          const prepared = await call('modkit.prepare_edit', { planHandle: proposal['planHandle'] })
          expect(prepared['state'], JSON.stringify(prepared)).toBe('ready')
          const committed = await call('modkit.commit_edit', { planHandle: proposal['planHandle'] })
          const transaction = committed['result'] as {
            state: string
            receipt: { transactionId: string }
          }
          expect(transaction.state).toBe('committed')
          const written = await readFile(source)
          expect(written.toString('utf8')).toContain('value="60"')
          await hover(60)
          if (packageMode) {
            const preview = proposal['preview'] as {
              guardCount: number
              guards: unknown[]
              guardsComplete: boolean
            }
            expect(preview.guardCount).toBeGreaterThan(8)
            expect(preview.guards).toHaveLength(8)
            expect(preview.guardsComplete).toBe(false)
            // Unwritten host dependencies are guards too, including when no watcher reports the save.
            await writeFile(join(base, UNIT_DATA), xml(46))
            const refused = await client.callTool({
              name: 'modkit.undo_edit',
              arguments: { transactionId: transaction.receipt.transactionId },
            })
            expect(
              ((refused.structuredContent as McpEnvelope).data as { result?: { state?: string } })
                ?.result?.state,
            ).toBe('not-applied')
            expect(await readFile(source)).toEqual(written)
            await writeFile(join(base, UNIT_DATA), xml(45))
            const metadata = await readFile(join(active, 'DocumentInfo'))
            await writeFile(join(active, 'DocumentInfo'), '<DocInfo><Dependencies/></DocInfo>')
            const changedChain = await client.callTool({
              name: 'modkit.undo_edit',
              arguments: { transactionId: transaction.receipt.transactionId },
            })
            expect(
              (changedChain.structuredContent as McpEnvelope).diagnostics.map(item => item.code),
            ).toContain('x3.host/resolved-data-context-chain-changed')
            expect(await readFile(source)).toEqual(written)
            await writeFile(join(active, 'DocumentInfo'), metadata)
          }
          const undone = await call('modkit.undo_edit', {
            transactionId: transaction.receipt.transactionId,
          })
          expect(undone['result']).toMatchObject({ state: 'committed' })
          expect(await readFile(source)).toEqual(before)
          await hover(50)
          const redone = await call('modkit.redo_edit', {
            transactionId: transaction.receipt.transactionId,
          })
          expect(redone['result']).toMatchObject({ state: 'committed' })
          expect(await readFile(source)).toEqual(written)
          await hover(60)
          expect(await readFile(join(base, UNIT_DATA), 'utf8')).toBe(xml(45))
        } finally {
          await language?.close()
          if (workspace !== undefined && client !== undefined)
            await client
              .callTool({ name: 'modkit.close_subject', arguments: { handle: workspace } })
              .catch(() => undefined)
          await client?.close()
          await app?.dispose()
          await host?.close()
          const basePath = resolve(tmpdir())
          const suffix = relative(basePath, resolve(root))
          if (suffix.startsWith('..') || !suffix.startsWith('modkit-mcp-sc2-coherence-'))
            throw new Error('fixture cleanup escaped its temporary root')
          await rm(root, { recursive: true, force: true })
        }
      },
      180_000,
    )
  },
)
