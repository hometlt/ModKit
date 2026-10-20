import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope } from '../src/index.js'

const fixture = resolve(import.meta.dirname,
  '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json')
const data = (result: { structuredContent?: unknown; isError?: unknown }) => {
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent))
  return (result.structuredContent as McpEnvelope).data as Record<string, unknown>
}

/** Exercise the real Host world source and the public MCP resource transport. */
async function connected(outputArtifacts: boolean) {
  const host = await createHostMcpPort({ roots: [dirname(fixture)], extensions: [], outputArtifacts })
  const app = createModkitMcpServer(host)
  const client = new Client({ name: 'world-glb', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), app.server.connect(serverTransport)])
  const opened = data(await client.callTool({ name: 'modkit.open_subject', arguments: { path: fixture } }))
  return { client, handle: opened['handle'] as string, close: async () => {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
  } }
}

/** Download all retained chunks without putting GLB bytes in the structured response. */
async function download(client: Client, firstChunkUri: string) {
  const chunks: Buffer[] = []
  let next: unknown = firstChunkUri
  while (typeof next === 'string') {
    const result = await client.readResource({ uri: next })
    const content = result.contents[0]
    if (content === undefined || !('blob' in content)) throw new Error('binary chunk absent')
    chunks.push(Buffer.from(content.blob, 'base64'))
    next = result._meta?.['nextUri']
  }
  return Buffer.concat(chunks)
}

it('discovers presets and exports every composition through the GLB owner with complete retained bytes', async () => {
  const app = await connected(true)
  try {
    const tools = (await app.client.listTools()).tools
    expect(tools.find(tool => tool.name === 'modkit.export_glb')?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: false })
    const options = data(await app.client.callTool({ name: 'modkit.glb_export_options', arguments: { handle: app.handle } }))
    expect(options).toMatchObject({ available: true, maxBytes: 64 * 1024 * 1024,
      defaults: { content: 'all', includeWater: true, textureSize: 2048 },
      presets: [{ id: 'terrain' }, { id: 'terrain-water' }, { id: 'all' }] })
    for (const content of ['all', 'terrain']) for (const includeWater of [false, true]) {
      const result = await app.client.callTool({ name: 'modkit.export_glb', arguments: {
        handle: app.handle, content, includeWater, textureSize: 16,
      } })
      const exported = data(result)
      expect(exported['receipt']).toMatchObject({ format: 'glb', content, includeWater, width: 16, height: 16 })
      const receipt = exported['receipt'] as { complete: boolean; models: { total: number } }
      expect((result.structuredContent as McpEnvelope).completeness).toBe(receipt.complete ? 'complete' : 'partial')
      if (content === 'terrain') expect(receipt.models.total).toBe(0)
      const artifact = exported['outputArtifact'] as { id: string; sha256: string; byteLength: number; firstChunkUri: string }
      const bytes = await download(app.client, artifact.firstChunkUri)
      expect(bytes.length).toBe(artifact.byteLength)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256)
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67)
      expect(bytes.readUInt32LE(4)).toBe(2)
      expect(bytes.readUInt32LE(8)).toBe(bytes.length)
      const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
      expect(document.meshes.some((mesh: { name: string }) => mesh.name.startsWith('world/water-'))).toBe(includeWater)
      await app.client.callTool({ name: 'modkit.release_output', arguments: { id: artifact.id } })
      const released = await app.client.readResource({ uri: artifact.firstChunkUri })
      expect(JSON.parse((released.contents[0] as { text: string }).text).diagnostics[0].code)
        .toBe('x3.mcp/output-artifact-unknown')
    }
  } finally { await app.close() }
}, 60000)

it('requires retained-output authority but lets a client inspect options without it', async () => {
  const app = await connected(false)
  try {
    expect(data(await app.client.callTool({ name: 'modkit.glb_export_options', arguments: { handle: app.handle } })))
      .toMatchObject({ available: false, requiresOutputArtifacts: true })
    const refused = await app.client.callTool({ name: 'modkit.export_glb', arguments: { handle: app.handle, textureSize: 16 } })
    expect(refused.isError).toBe(true)
    expect((refused.structuredContent as McpEnvelope).diagnostics[0]?.code).toBe('x3.mcp/output-artifacts-disabled')
    for (const invalid of [{ textureSize: 15 }, { textureSize: 4097 }, { content: 'rocks' }, { includeWater: 'false' }]) {
      const response = await app.client.callTool({ name: 'modkit.export_glb', arguments: { handle: app.handle, ...invalid } })
      expect(response.isError).toBe(true)
    }
  } finally { await app.close() }
}, 60000)

it('expires the exported GLB when its subject closes', async () => {
  const app = await connected(true)
  try {
    const result = data(await app.client.callTool({ name: 'modkit.export_glb', arguments: {
      handle: app.handle, textureSize: 16, content: 'terrain', includeWater: false,
    } }))
    const artifact = result['outputArtifact'] as { firstChunkUri: string }
    await app.client.callTool({ name: 'modkit.close_subject', arguments: { handle: app.handle } })
    const expired = await app.client.readResource({ uri: artifact.firstChunkUri })
    expect(JSON.parse((expired.contents[0] as { text: string }).text).diagnostics[0].code)
      .toBe('x3.mcp/output-artifact-unknown')
    const stale = await app.client.callTool({ name: 'modkit.export_glb', arguments: { handle: app.handle, textureSize: 16 } })
    expect(stale.isError).toBe(true)
  } finally { await app.close() }
}, 60000)
