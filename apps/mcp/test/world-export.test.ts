import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { canonicalizeUvwProfile, parseUvwProfile } from '@modkit/uv/world'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope } from '../src/index.js'

const fixture = resolve(
  import.meta.dirname,
  '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
)
const data = (result: { readonly structuredContent?: unknown; readonly isError?: unknown }) => {
  if (result.isError === true) throw new Error(JSON.stringify(result.structuredContent))
  return (result.structuredContent as McpEnvelope).data as Readonly<Record<string, unknown>>
}

it('exports the world a subject publishes as one retained UVW document, with its receipt', async () => {
  const host = await createHostMcpPort({
    roots: [dirname(fixture)],
    extensions: [],
    outputArtifacts: true,
  })
  const app = createModkitMcpServer(host)
  const client = new Client({ name: 'world-export', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), app.server.connect(serverTransport)])
    const opened = data(
      await client.callTool({ name: 'modkit.open_subject', arguments: { path: fixture } }),
    )
    const exported = await client.callTool({
      name: 'modkit.world_scene',
      arguments: { handle: opened['handle'], view: 'export' },
    })
    const receipt = data(exported)
    // a UVW subject is its own canonical world: nothing is left out
    expect((exported.structuredContent as McpEnvelope).completeness).toBe('complete')
    expect(receipt).toMatchObject({ excludedFacetIds: [], omittedObjects: 0, lostFields: [] })
    const artifact = receipt['outputArtifact'] as Readonly<Record<string, unknown>>
    expect(artifact['operationId']).toBe('common.view/world-scene-source')
    const chunks: Buffer[] = []
    let next = artifact['firstChunkUri']
    while (typeof next === 'string') {
      const resource = await client.readResource({ uri: next })
      const item = resource.contents[0]
      if (item === undefined || !('blob' in item)) throw new Error('binary chunk absent')
      chunks.push(Buffer.from(item.blob, 'base64'))
      next = (resource._meta as Readonly<Record<string, unknown>>)['nextUri']
    }
    const limits = { maxNodes: 1_000_000, maxBytes: 64 * 1024 * 1024 }
    // the same world, in canonical order (resources sorted by id)
    expect(parseUvwProfile(Buffer.concat(chunks), limits)).toEqual(
      canonicalizeUvwProfile(parseUvwProfile(await readFile(fixture), limits), limits),
    )
  } finally {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
  }
}, 60000)
