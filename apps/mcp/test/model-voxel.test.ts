import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { materializeUvmCore } from '@modkit/uv'
import { revisionId } from '@modkit/sdk'
import { encodePng } from '@modkit/codec-kit/raster'
import { readUvmContainer, packUvmGlb } from '@modkit/uv/model/container'
import { readUvmModel } from '../../../packages/scene/src/uvm/model.js'
import { createHostMcpPort, createModkitMcpServer } from '../src/index.js'

/** Public Host + MCP transport, including reopening the bytes that were actually downloaded. */
it('clips a model quarter, downloads the voxel GLB and renders the reopened voxel mesh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'modkit-voxel-'))
  const source = join(dir, 'plateau.glb'),
    destination = join(dir, 'quarter.glb')
  const fixture = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'node-0',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      meshes: [{ id: 'mesh-0', primitiveIds: ['floor'] }],
      primitives: [
        {
          id: 'floor',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 8, 0, 8, 8, 0, 0, 0, 0, 0, 0, 0, 8, 8, 0, 8]),
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:voxel-fixture'),
      options: { assetId: 'test/mcp-voxel', sourceFormat: 'fixture' },
    },
  )
  // Plain GLB geometry has no public material facet: keep this embedded green image as the
  // regression that prevents a successfully exported but silently white voxel model.
  const container = readUvmContainer(fixture.bytes)
  const document = structuredClone(container.document) as any
  document.asset = { version: '2.0' }
  delete document.extensions
  delete document.extensionsUsed
  const png = await encodePng(1, 1, Uint8Array.from([30, 180, 60, 255]))
  const offset = Math.ceil(container.binary.length / 4) * 4
  const binary = new Uint8Array(offset + png.length)
  binary.set(container.binary)
  binary.set(png, offset)
  const view = document.bufferViews.length
  document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length })
  document.buffers = [{ byteLength: binary.length }]
  document.images = [{ bufferView: view, mimeType: 'image/png' }]
  document.textures = [{ source: 0 }]
  document.materials = [
    {
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    },
  ]
  document.meshes[0].primitives[0].material = 0
  await writeFile(source, packUvmGlb(document, binary))
  const host = await createHostMcpPort({
    roots: [dir],
    extensions: [resolve('extensions/models'), resolve('extensions/images')],
    outputArtifacts: true,
  })
  const app = createModkitMcpServer(host),
    client = new Client({ name: 'model-voxel', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true)
    return result
  }
  try {
    await Promise.all([client.connect(a), app.server.connect(b)])
    const handle = ((await call('modkit.open_subject', { path: source })).structuredContent as any)
      .data.handle
    expect(
      ((await call('modkit.model_scene', { handle, view: 'info' })).structuredContent as any).data
        .voxelization.surfaceOnly,
    ).toBe(true)
    const result = await call('modkit.model_scene', {
      handle,
      view: 'voxelize',
      region: 'southwest',
      resolution: 16,
    })
    const envelope = result.structuredContent as any
    expect(envelope.completeness).toBe('partial')
    expect(envelope.data.receipt.bounds).toEqual([0, 4, 4, 8])
    const artifact = envelope.data.outputArtifact,
      chunks: Buffer[] = []
    let uri = artifact.firstChunkUri
    while (uri) {
      const r = await client.readResource({ uri })
      chunks.push(Buffer.from((r.contents[0] as any).blob, 'base64'))
      uri = r._meta?.['nextUri']
    }
    const bytes = Buffer.concat(chunks)
    const voxelContainer = readUvmContainer(bytes)
    const voxelModel = readUvmModel(voxelContainer.document, voxelContainer.binary, {
      maxScalarBytes: 8 * 1024 ** 2,
    })
    const colours = voxelModel.scene.primitives[0]!.colors!
    expect(colours[1]).toBeGreaterThan(colours[0]! * 2)
    expect(colours[1]).toBeCloseTo(180 / 255, 2)
    expect(bytes.length).toBe(artifact.byteLength)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256)
    await writeFile(destination, bytes)
    await call('modkit.release_output', { id: artifact.id })
    await call('modkit.close_subject', { handle })
    const reopened = (
      (await call('modkit.open_subject', { path: destination })).structuredContent as any
    ).data.handle
    const rendered = await call('modkit.model_scene', {
      handle: reopened,
      view: 'render',
      width: 128,
      height: 96,
    })
    const image = rendered.content.find(c => c.type === 'image') as {
      data: string
      mimeType: string
    }
    expect(image.mimeType).toBe('image/png')
    expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG')
    const invalid = await client.callTool({
      name: 'modkit.model_scene',
      arguments: { handle: reopened, view: 'voxelize', resolution: 129 },
    })
    expect(invalid.isError).toBe(true)
    await call('modkit.close_subject', { handle: reopened })
  } finally {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
    await Promise.allSettled([unlink(source), unlink(destination)])
    await rmdir(dir)
  }
}, 60000)
