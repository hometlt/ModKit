import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, it } from 'vitest'
import { createHostMcpPort, createModkitMcpServer, type McpEnvelope } from '../src/index.js'
import { readUvmContainer } from '@modkit/uv/model/container'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object')
  return value as Readonly<Record<string, unknown>>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected string')
  return value
}
function envelope(value: {
  readonly structuredContent?: unknown
  readonly isError?: boolean | undefined
}): McpEnvelope {
  expect(value.isError).not.toBe(true)
  const result = object(value.structuredContent)
  expect(result['trust']).toBe('untrusted-data')
  return value.structuredContent as McpEnvelope
}

it('real MCP host retrieves complete M3 UVM/native/PNG results and reuses owned UVM without a large JSON input', async () => {
  const models = resolve(import.meta.dirname, '../../../../modkit-extensions-blizzard/models')
  const fixture = resolve(models, 'test/fixtures/m3/model.m3')
  const source = await readFile(fixture)
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'modkit-m3-mcp-output-'))
  expect(hash(source)).toBe('a9a126d0a2b7b54bc6ac70948a40bf34bd26260f063af498cc94ff3d9a528cda')
  const host = await createHostMcpPort({
    roots: [dirname(fixture), outputRoot],
    extensions: [models],
    outputArtifacts: true,
  })
  const app = createModkitMcpServer(host)
  const client = new Client({ name: 'm3-output-artifact-proof', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), app.server.connect(serverTransport)])
    const opened = envelope(
      await client.callTool({ name: 'modkit.open_subject', arguments: { path: fixture } }),
    )
    const handle = text(object(opened.data)['handle'])
    const invoke = async (
      operationId: string,
      input: unknown,
      inputArtifact?: unknown,
      onHandle = handle,
    ) => {
      const result = envelope(
        await client.callTool({
          name: 'modkit.invoke_readonly',
          arguments: {
            handle: onHandle,
            operationId,
            input,
            retainOutput: true,
            ...(inputArtifact === undefined ? {} : { inputArtifact }),
          },
        }),
      )
      const artifact = object(object(result.data)['outputArtifact'])
      expect(artifact['operationId']).toBe(operationId)
      expect(artifact['owner']).toBe(onHandle)
      return artifact
    }
    const retrieve = async (artifact: Readonly<Record<string, unknown>>) => {
      const manifestResult = await client.readResource({ uri: text(artifact['uri']) })
      const manifestItem = manifestResult.contents[0]
      if (manifestItem === undefined || !('text' in manifestItem))
        throw new Error('manifest text absent')
      const manifest = object(JSON.parse(manifestItem.text))
      expect(manifest['sha256']).toBe(artifact['sha256'])
      const chunks: Buffer[] = []
      let next = manifest['firstChunkUri'],
        byteLength = 0,
        count = 0
      while (next !== null) {
        if (++count > 1024) throw new Error('output chunk count exceeded advertised budget')
        const resource = await client.readResource({ uri: text(next) })
        const item = resource.contents[0]
        if (item === undefined || !('blob' in item)) throw new Error('complete binary chunk absent')
        const bytes = Buffer.from(item.blob, 'base64')
        const metadata = object(resource._meta)
        expect(bytes.byteLength).toBeLessThanOrEqual(65536)
        expect(hash(bytes)).toBe(metadata['sha256'])
        chunks.push(bytes)
        byteLength += bytes.byteLength
        next = metadata['nextUri']
      }
      expect(byteLength).toBe(manifest['byteLength'])
      const bytes = Buffer.concat(chunks)
      expect(hash(bytes)).toBe(artifact['sha256'])
      return bytes
    }
    const uvmArtifact = await invoke('model.export-uvm', {
      schemaVersion: 1,
      metersPerSourceUnit: 2,
    })
    const uvm = await retrieve(uvmArtifact)
    expect(uvm.byteLength).toBeGreaterThan(64)
    expect(readUvmContainer(uvm).document['asset']).toBeDefined()
    const nativeArtifact = await invoke(
      'model.write',
      { schemaVersion: 1 },
      {
        id: uvmArtifact['id'],
        field: 'uvmBytesHex',
        encoding: 'hex',
      },
    )
    expect(await retrieve(nativeArtifact)).toEqual(source)
    const mapping = object(
      object(object(readUvmContainer(uvm).document['extras'])['BlizzardM3'])['mapping'],
    )
    const strings = mapping['nativeStrings']
    if (!Array.isArray(strings)) throw new Error('native string bindings absent')
    const binding = strings
      .map(object)
      .find(
        item =>
          object(item['native'])['kind'] === 'sequence' &&
          Array.isArray(item['aliases']) &&
          item['aliases'].length > 1,
      )
    if (binding === undefined || !Array.isArray(binding['aliases']))
      throw new Error('sequence aliases absent')
    const replacement = 'MCP edited sequence'
    const editedArtifact = await invoke(
      'model.write',
      {
        schemaVersion: 1,
        json: binding['aliases'].map(alias => ({
          op: 'replace',
          path: text(object(alias)['path']),
          value: replacement,
        })),
      },
      { id: uvmArtifact['id'], field: 'uvmBytesHex', encoding: 'hex' },
    )
    const edited = await retrieve(editedArtifact)
    expect(edited).not.toEqual(source)
    const editedPath = resolve(outputRoot, 'edited.m3')
    await writeFile(editedPath, edited)
    const reopened = envelope(
      await client.callTool({ name: 'modkit.open_subject', arguments: { path: editedPath } }),
    )
    const reopenedHandle = text(object(reopened.data)['handle'])
    const reopenedUvm = await retrieve(
      await invoke(
        'model.export-uvm',
        { schemaVersion: 1, metersPerSourceUnit: 2 },
        undefined,
        reopenedHandle,
      ),
    )
    const reopenedStrings = object(
      object(object(readUvmContainer(reopenedUvm).document['extras'])['BlizzardM3'])['mapping'],
    )['nativeStrings']
    if (!Array.isArray(reopenedStrings)) throw new Error('reopened string bindings absent')
    expect(
      reopenedStrings.some(item => object(object(item)['native'])['value'] === replacement),
    ).toBe(true)
    envelope(
      await client.callTool({
        name: 'modkit.close_subject',
        arguments: { handle: reopenedHandle },
      }),
    )
    const pngArtifact = await invoke('model.render', {
      schemaVersion: 1,
      metersPerSourceUnit: 2,
      viewport: { width: 64, height: 64 },
      camera: {
        viewProjection: [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 1],
        viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      time: 0,
      clearColor: [0, 0, 0, 1],
      rendererId: 'modkit.headless',
      collisions: false,
    })
    const png = await retrieve(pngArtifact)
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.readUInt32BE(16)).toBe(64)
    expect(png.readUInt32BE(20)).toBe(64)
    envelope(
      await client.callTool({
        name: 'modkit.release_output',
        arguments: { id: nativeArtifact['id'] },
      }),
    )
    const released = await client.readResource({ uri: text(nativeArtifact['uri']) })
    expect(JSON.stringify(released)).toContain('output-artifact-unknown')
    envelope(await client.callTool({ name: 'modkit.close_subject', arguments: { handle } }))
    const closed = await client.readResource({ uri: text(uvmArtifact['uri']) })
    expect(JSON.stringify(closed)).toContain('output-artifact-unknown')
    expect(hash(await readFile(fixture))).toBe(hash(source))
  } finally {
    await Promise.allSettled([client.close(), app.dispose()])
    await host.close()
    await rm(outputRoot, { recursive: true, force: true })
  }
}, 180000)
