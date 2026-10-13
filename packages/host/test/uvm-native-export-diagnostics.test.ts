import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createCodec } from '../../../extensions/models/src/uvm/codec.js'

it('reports native encoder losses with the UVM byte operation and releases the provider', async () => {
  const bytes = Buffer.from(await readFile(new URL('../../testkit/test/fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url), 'utf8'), 'base64')
  const diagnostic = { severity: 'warning', code: 'example/native-loss', message: 'Unsupported source shader omitted.' }
  let released = 0
  const encoder = { contract: 'common.model/native-encoder', formatId: 'test-native', extension: 'native',
    async encode(request: any) {
      expect(request.options).toEqual({ materialPolicy: 'base-color-coverage' })
      expect(request.uvm).toEqual(Uint8Array.from(bytes))
      return { formatId: 'test-native', extension: 'native', bytes: Uint8Array.of(1, 2, 3), diagnostics: [diagnostic] }
    } }
  const codec = createCodec({ contracts: { async resolve() { return { value: encoder, release: async () => { released++ } } } } })
  const source = { kind: 'bytes', ref: { id: 'fixture', uri: 'memory:uvm-native-export' },
    revision: 'provider-token:export', size: BigInt(bytes.length),
    async read(offset: bigint, length: number) { return bytes.slice(Number(offset), Number(offset) + length) } }
  const input = { originKind: 'single', primaryBindingId: 'content',
    revisions: { topology: 'single', revision: source.revision },
    bindings: [{ bindingId: 'content', role: 'content', source: source.ref, sourceKind: 'candidate', ownership: 'owned', revision: source.revision }],
    async openBinding() { return { value: source, release: async () => undefined } } }
  const session = await codec.open(input, 'full', { maxInputBytes: 16_777_216n, maxScalarBytes: 16_777_216,
    maxDepth: 96, maxNodes: 100000, maxDiagnostics: 10 })
  try {
    const result = await session.operations().invoke('export-uvm-native', {
      schemaVersion: 1, formatId: 'test-native', options: { materialPolicy: 'base-color-coverage' },
    })
    expect(result.state).toBe('ok')
    if (result.state !== 'ok') throw new Error('native export rejected')
    expect(result.output).toEqual({ kind: 'bytes', value: Uint8Array.of(1, 2, 3), extension: 'native' })
    expect(result.diagnostics).toEqual([diagnostic])
    expect(released).toBe(1)
  } finally { await session.dispose() }
})
