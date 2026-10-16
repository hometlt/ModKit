import { dirname, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope } from '../src/index.js'

const fixture = resolve(
  import.meta.dirname,
  '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
)

it('renders the world a subject publishes as its viewer shows it, from the camera asked for', async () => {
  const host = await createHostMcpPort({ roots: [dirname(fixture)], extensions: [] })
  const app = createModkitMcpServer(host)
  const client = new Client({ name: 'world-render', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), app.server.connect(serverTransport)])
    const opened = await client.callTool({
      name: 'modkit.open_subject',
      arguments: { path: fixture },
    })
    const handle = ((opened.structuredContent as McpEnvelope).data as { handle: string }).handle
    const render = async (camera: Readonly<Record<string, unknown>>) => {
      const drawn = await client.callTool({
        name: 'modkit.world_scene',
        arguments: { handle, view: 'render', width: 96, height: 64, ...camera },
      })
      if (drawn.isError === true) throw new Error(JSON.stringify(drawn.structuredContent))
      const picture = (drawn.content as { type: string; mimeType?: string; data?: string }[]).find(
        item => item.type === 'image',
      )
      expect(picture).toMatchObject({ mimeType: 'image/png' })
      const decoded = await decodePngSamples(Buffer.from(picture!.data!, 'base64'))
      return {
        data: (drawn.structuredContent as McpEnvelope).data as Record<string, unknown>,
        decoded,
      }
    }
    const shown = await render({})
    expect(shown.data).toMatchObject({ width: 96, height: 64, camera: { zoom: 1 } })
    expect([shown.decoded.width, shown.decoded.height]).toEqual([96, 64])
    // something of the world is drawn over the black clear colour
    const { samples, channels } = shown.decoded
    let lit = 0
    for (let index = 0; index < samples.length; index += channels)
      if (samples[index]! + samples[index + 1]! + samples[index + 2]! > 0) lit += 1
    expect(lit).toBeGreaterThan(0)
    const visibilityBounds = [100000, 100000, 100001, 100001]
    const masked = await render({ visibilityBounds })
    expect(masked.data['visibilityBounds']).toEqual(visibilityBounds)
    for (let offset = 0; offset < masked.decoded.samples.length; offset += masked.decoded.channels) {
      expect(Array.from(masked.decoded.samples.slice(offset, offset + 3))).toEqual([0, 0, 0])
      if (masked.decoded.channels === 4) expect(masked.decoded.samples[offset + 3]).toBe(255)
    }
    expect((await render({})).decoded.samples).toEqual(shown.decoded.samples)
    const invalid = await client.callTool({ name: 'modkit.world_scene', arguments: {
      handle, view: 'render', width: 96, height: 64, visibilityBounds: [1, 0, 0, 1],
    } })
    expect(invalid.isError).toBe(true)
    // another camera draws another picture of the same world
    const turned = await render({ azimuth: 0.4, elevation: 1.2, zoom: 2 })
    expect(turned.data['camera']).toMatchObject({ azimuth: 0.4, elevation: 1.2, zoom: 2 })
    expect(turned.decoded.samples.some((value, index) => value !== samples[index])).toBe(true)
  } finally {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
  }
}, 120000)
