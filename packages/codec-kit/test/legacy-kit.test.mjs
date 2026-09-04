import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import {
  LEGACY_DIAGNOSTIC_CATEGORIES,
  adaptDiagnostic,
  adaptLegacyError,
  adaptGameArtifactCodec,
  adaptEditPlan,
  invokeLegacyOperation,
  adaptOperationId,
  adaptRuntimeProvider,
  adaptLanguageModule,
} from '../dist/legacy/index.js'
import {
  createMemoryAssetSource,
  createArtifactOperationSession,
  ArtifactCodecRegistry,
} from '../dist/legacy/assets/index.js'
import { ModkitError as LegacyError } from '../dist/legacy/core/index.js'
import { adaptByteSource } from '../dist/legacy/vfs/index.js'
import { sha1Hex, crc32 } from '../dist/crypto/index.js'
import { deflate, inflate, bzip2Decompress, adpcmDecompress } from '../dist/compression/index.js'
import {
  assertRgba8DecodeWithinLimit,
  compressedTextureByteLength,
  bgraToRgba,
} from '../dist/texture/index.js'
const bytes = new TextEncoder().encode('actual fixture bytes\n')
const source = createMemoryAssetSource(bytes, { id: 'fixture', path: 'fixture.bin' })

test('all 14 diagnostic categories, identity, byte range and error details survive the MK3 boundary', () => {
  assert.equal(Object.keys(LEGACY_DIAGNOSTIC_CATEGORIES).length, 14)
  for (const category of Object.keys(LEGACY_DIAGNOSTIC_CATEGORIES)) {
    const result = adaptDiagnostic({
      id: category,
      category,
      severity: 'info',
      code: 'BAD_CODE/A.B',
      message: 'detail',
      range: { offset: 2, length: 3 },
      detail: { preserved: 42 },
      path: 'foo/bar',
      relatedIds: ['other'],
    })
    assert.equal(result.category, LEGACY_DIAGNOSTIC_CATEGORIES[category])
    assert.equal(result.severity, 'information')
    assert.equal(result.data.legacyCode, 'BAD_CODE/A.B')
    assert.equal(result.data.legacyPath, 'foo/bar')
    assert.deepEqual(result.range, { byteOffset: '2', byteLength: '3' })
    assert.deepEqual(result.data.legacyDetail, { preserved: 42 })
  }
  const legacy = new LegacyError({
    code: 'CONFIG_INVALID',
    message: 'bad',
    context: { byte: 2 },
    hint: 'retry',
  })
  const mapped = adaptLegacyError(legacy)
  assert.equal(mapped.cause, legacy)
  assert.equal(mapped.context.legacyCode, 'CONFIG_INVALID')
  assert.equal(mapped.context.legacyHint, 'retry')
  assert.equal(adaptLegacyError(new Error('plain')).message, 'plain')
})

test('legacy diagnostic source remains data while a real native owner supplies contribution identity', () => {
  const diagnostic = {
    id: 'bank.warning',
    code: 'signature',
    severity: 'warning',
    message: 'missing identity',
    source: 'Legacy Bank Codec',
  }
  const anonymous = adaptDiagnostic(diagnostic)
  assert.equal(anonymous.source, undefined)
  assert.equal(anonymous.data.legacySource, 'Legacy Bank Codec')
  const owned = adaptDiagnostic(diagnostic, { contributionId: 'blizzard/sc2-bank' })
  assert.deepEqual(owned.source, { contributionId: 'blizzard/sc2-bank' })
  assert.equal(owned.data.legacySource, 'Legacy Bank Codec')
})

test('compile compatibility registries refuse; operations require explicit owned mapping', () => {
  const registry = new ArtifactCodecRegistry('save')
  for (const method of ['register', 'get', 'list', 'summaries', 'route', 'open'])
    assert.throws(() => registry[method]({}), { code: 'codec-kit/legacy-registry-unavailable' })
  assert.equal(
    adaptOperationId('view.inspect', { contributionId: 'fixture/codec' }),
    'view.inspect',
  )
  assert.equal(
    adaptOperationId(
      'save.sign',
      { contributionId: 'fixture/codec' },
      { 'save.sign': 'fixture/codec.sign' },
    ),
    'fixture/codec.sign',
  )
  assert.throws(
    () => adaptOperationId('save.sign', { contributionId: 'fixture/codec' }),
    /explicit/,
  )
})

test('real legacy sessions retain permission, state, cancellation and disposal checks', async () => {
  const operation = {
    id: 'fixture.read',
    handlerId: 'read',
    state: 'available',
    mutatesSource: false,
    permissions: ['read-source'],
  }
  const base = {
    codecId: 'fixture',
    document: { value: 7 },
    context: {},
    descriptor: { operations: [operation] },
    handlers: { read: ({ document, input }) => ({ actual: document.value, input }) },
  }
  const denied = createArtifactOperationSession(base)
  await assert.rejects(
    invokeLegacyOperation(denied, 'read', null, value => ({ kind: 'json', value })),
    error =>
      error.cause instanceof LegacyError &&
      error.context.legacyCode === error.cause.code &&
      /permissions not granted/.test(error.message),
  )
  const session = createArtifactOperationSession({ ...base, grantedPermissions: ['read-source'] })
  assert.deepEqual(
    await invokeLegacyOperation(session, 'read', 3, value => ({ kind: 'json', value })),
    { kind: 'json', value: { actual: 7, input: 3 } },
  )
  const blocked = createArtifactOperationSession({
    ...base,
    descriptor: { operations: [{ ...operation, state: 'dependency-required' }] },
    grantedPermissions: ['read-source'],
  })
  await assert.rejects(
    invokeLegacyOperation(blocked, 'read', null, value => ({ kind: 'json', value })),
  )
  const cancelled = createArtifactOperationSession({
    ...base,
    context: { cancellation: { isCancellationRequested: true } },
    grantedPermissions: ['read-source'],
  })
  await assert.rejects(cancelled.invoke('read'), /cancel/i)
  await session.dispose()
  await session.dispose()
  await assert.rejects(
    invokeLegacyOperation(session, 'read', null, value => ({ kind: 'json', value })),
  )
})

test('source adapter enforces exact ranges, maxBytes, cancellation and safe integer size', async () => {
  let reads = 0
  const adapter = adaptByteSource(
    {
      size: async () => BigInt(bytes.length),
      read: async (offset, length) => {
        reads++
        return bytes.slice(Number(offset), Number(offset + length))
      },
    },
    source.descriptor,
  )
  assert.deepEqual(await adapter.readRange({ offset: 2, length: 4 }), bytes.slice(2, 6))
  assert.deepEqual(await adapter.readRange({ offset: 1000, length: 4 }), new Uint8Array())
  await assert.rejects(adapter.read({ maxBytes: 1 }), /maxBytes/)
  const before = reads
  await assert.rejects(adapter.read({ cancellation: { isCancellationRequested: true } }), /cancel/i)
  assert.equal(reads, before)
  await assert.rejects(
    adaptByteSource({ size: async () => 9007199254740992n }, source.descriptor).size(),
    /exact/,
  )
})

test('artifact adapter is a native MK3 Codec and probes the selected real legacy detector', async () => {
  let calls = 0
  const codec = adaptGameArtifactCodec(
    {
      sourceKinds: ['file'],
      async detect(candidate) {
        calls++
        assert.deepEqual(await candidate.read(), bytes)
        return {
          confidence: 0.75,
          evidence: [{ kind: 'magic', detail: 'fixture' }],
          requiredRanges: [{ offset: 0, length: bytes.length }],
        }
      },
    },
    {
      id: 'fixture/codec',
      format: { id: 'fixture', label: 'Fixture' },
      project: async () => {
        throw Error('not opened')
      },
    },
  )
  const candidate = {
    kind: 'bytes',
    ref: { uri: 'memory:fixture' },
    size: BigInt(bytes.length),
    read: async () => bytes,
  }
  const detection = await codec.probe({
    source: candidate,
    plan: {
      kind: 'bytes',
      ranges: [{ from: 'start', length: bytes.length }],
      maxBytes: bytes.length,
    },
  })
  assert.equal(calls, 1)
  assert.equal(detection.codecId, 'fixture/codec')
  assert.equal(detection.confidence, 0.75)
  assert.equal(JSON.parse(detection.evidence[0].note).legacyEvidence.detail, 'fixture')
  await assert.rejects(
    codec.probe({
      source: candidate,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 2 }], maxBytes: 2 },
    }),
    /admitted probe bytes/,
  )
  await assert.rejects(
    codec.probe({
      source: { ...candidate, size: undefined },
      plan: {
        kind: 'bytes',
        ranges: [{ from: 'start', length: bytes.length }],
        maxBytes: bytes.length,
      },
    }),
    /known size/,
  )
  assert.equal((await codec.planInput()).originKind, 'single')
  let observedSize
  const tailCodec = adaptGameArtifactCodec(
    {
      sourceKinds: ['file'],
      async detect(candidate) {
        observedSize = await candidate.size()
        assert.deepEqual(
          await candidate.readRange({ offset: bytes.length - 2, length: 2 }),
          bytes.slice(-2),
        )
        return {
          confidence: 1,
          evidence: [],
          requiredRanges: [{ offset: bytes.length - 2, length: 2 }],
        }
      },
    },
    {
      id: 'fixture/tail',
      format: { id: 'fixture', label: 'Fixture' },
      project: async () => {
        throw Error('not opened')
      },
    },
  )
  await tailCodec.probe({
    source: {
      ...candidate,
      read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
    },
    plan: { kind: 'bytes', ranges: [{ from: 'end', length: 2 }], maxBytes: 2 },
  })
  assert.equal(observedSize, bytes.length)
})

test('edit projection preserves payload/offset and rejects unsupported edits and overlap', () => {
  const input = {
    originKind: 'single',
    bindings: [
      {
        bindingId: 'content',
        source: { id: 'fixture', uri: 'memory:fixture' },
        revision: { value: '1' },
      },
    ],
    revisions: { topology: 'single' },
  }
  const plan = {
    edits: [
      {
        sourceId: 'fixture',
        operation: 'replace',
        range: { offset: 2, length: 4 },
        text: 'actual',
      },
    ],
    diagnostics: [],
    preservesUnknownData: true,
  }
  const result = adaptEditPlan(plan, input, {
    planId: 'fixture-plan',
    sourceId: 'fixture',
    fidelity: { roundTrip: 'lossless' },
  })
  assert.equal(result.edits[0].range.offset, 2n)
  assert.equal(new TextDecoder().decode(result.edits[0].payload.bytes), 'actual')
  assert.throws(
    () =>
      adaptEditPlan({ ...plan, edits: [...plan.edits, ...plan.edits] }, input, {
        sourceId: 'fixture',
        planId: 'bad',
        fidelity: {},
      }),
    /validation/,
  )
  assert.throws(
    () =>
      adaptEditPlan({ ...plan, edits: [{ sourceId: 'other', operation: 'delete' }] }, input, {
        sourceId: 'fixture',
        planId: 'bad',
        fidelity: {},
      }),
    /selected source/,
  )
})

test('runtime bridge reserves before execution and preserves result, refusal and lease disposal', async () => {
  let calls = 0,
    releases = 0
  const legacy = {
    createSession: async () => ({
      capabilities: ['execute'],
      execute: async request => {
        calls++
        assert.equal(request.budget.maxTicks, 2)
        return {
          state: 'suspended',
          clock: { tick: 2, timeSeconds: 0 },
          value: { sum: 7 },
          diagnostics: [{ code: 'actual', severity: 'info', message: 'done' }],
        }
      },
      dispose: async () => {
        releases++
      },
    }),
  }
  const provider = adaptRuntimeProvider(legacy, {
    providerId: 'fixture/runtime',
    runtimeIds: ['fixture'],
    createOptions: value => value,
  })
  const lease = await provider.createSession({
    sessionId: 'fixture',
    budget: { maxTicks: 2, maxWallTimeMs: 10, maxMemoryBytes: 4 },
  })
  const call = { entrypoint: 'sum', resources: { ticks: 2, wallTimeMs: 5, memoryBytes: 4 } }
  const result = await lease.value.execute(call)
  assert.equal(result.state, 'completed')
  assert.deepEqual(result.value, { sum: 7 })
  assert.equal(result.diagnostics[0].severity, 'information')
  assert.equal((await lease.value.execute(call)).reason, 'max-ticks')
  assert.equal(calls, 1)
  await lease.release()
  await lease.release()
  assert.equal(releases, 1)
  assert.equal((await lease.value.execute(call)).reason, 'session-disposed')
  const failed = adaptRuntimeProvider(
    {
      createSession: async () => {
        throw new LegacyError({ code: 'CONFIG_INVALID', message: 'creation failed' })
      },
    },
    { providerId: 'fixture/fail', runtimeIds: ['fixture'], createOptions: value => value },
  )
  await assert.rejects(
    failed.createSession({
      sessionId: 'bad',
      budget: { maxTicks: 1, maxWallTimeMs: 1, maxMemoryBytes: 1 },
    }),
    error => error.context.legacyCode === 'CONFIG_INVALID' && error.cause instanceof LegacyError,
  )
})

test('language bridge returns actual projection, rejects wrong snapshots and cancellation', async () => {
  const module = { languageId: 'fixture' }
  const document = { uri: 'memory:fixture', version: 1, languageId: 'fixture', text: 'actual' }
  const provider = adaptLanguageModule(module, {
    analyze: async (selected, request) => {
      assert.equal(selected, module)
      return {
        documentUri: request.document.uri,
        documentVersion: request.document.version,
        tokens: [
          {
            kind: 'keyword',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
          },
        ],
        diagnostics: [],
        symbols: [],
      }
    },
  })
  assert.equal((await provider.analyze({ document })).tokens.length, 1)
  await assert.rejects(
    provider.analyze({ document: { ...document, languageId: 'wrong' } }),
    /selected/,
  )
  await assert.rejects(provider.analyze({ document, signal: AbortSignal.abort() }))
  await assert.rejects(
    adaptLanguageModule(module, {
      analyze: async () => ({ documentUri: 'wrong', documentVersion: 1 }),
    }).analyze({ document }),
    /snapshot/,
  )
})

test('SHA1/CRC and real compression fixtures, corrupt bzip2, early output cap and explicit ADPCM refusal', async () => {
  for (const input of ['', 'abc', 'Unicode: Привет 🙂', 'x'.repeat(1000)])
    assert.equal(sha1Hex(input), createHash('sha1').update(input).digest('hex'))
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  for (const input of [new Uint8Array(), bytes, new Uint8Array(8192).fill(7)])
    assert.deepEqual(await inflate(await deflate(input)), input)
  const packed = Buffer.from(
    'QlpoOTFBWSZTWQlo5mYAAPnZgAAQQAAQABch1lAgAJApgAJoFKqHtUGRtTCLCLRFwRaIsIsIvhFyReiLRFsi4IuiLki+kXci2RdEWyLRFhF/F3JFOFCQCWjmZg==',
    'base64',
  )
  const expected = new TextEncoder().encode('bounded bzip2 fixture\n'.repeat(100))
  assert.deepEqual(bzip2Decompress(packed, { maxOutputBytes: expected.length }), expected)
  assert.deepEqual(
    bzip2Decompress(Uint8Array.of(0x10, ...packed), { maxOutputBytes: expected.length }),
    expected,
  )
  assert.throws(() => bzip2Decompress(packed, { maxOutputBytes: expected.length - 1 }), {
    code: 'codec-kit/compression-output-limit',
  })
  const corrupt = packed.slice()
  corrupt[20] ^= 255
  assert.throws(() => bzip2Decompress(corrupt, { maxOutputBytes: 10000 }), {
    code: 'codec-kit/invalid-bzip2',
  })
  for (let length = 0; length < packed.length; length++)
    assert.throws(() => bzip2Decompress(packed.subarray(0, length), { maxOutputBytes: 10000 }), {
      code: 'codec-kit/invalid-bzip2',
    })
  assert.throws(() =>
    bzip2Decompress(packed, { maxOutputBytes: 10000, signal: AbortSignal.abort() }),
  )
  assert.throws(() => adpcmDecompress(bytes), { code: 'codec-kit/adpcm-unavailable' })
})

test('texture CPU footprint and allocation guards preserve pinned behavior', () => {
  assert.equal(assertRgba8DecodeWithinLimit(4, 4), 64)
  assert.throws(
    () => assertRgba8DecodeWithinLimit(4, 4, 1, 63),
    error => error.code === 'ASSET_LIMIT_EXCEEDED',
  )
  assert.equal(
    compressedTextureByteLength(5, 5, 1, { width: 4, height: 4, depth: 1, bytes: 8 }),
    32,
  )
  assert.deepEqual(bgraToRgba(Uint8Array.of(1, 2, 3, 4), 1, 1), Uint8Array.of(3, 2, 1, 4))
})

test('real Texture2DDecoder WASM Node and explicit browser entrypoint produce equal BC1 pixels; missing assets refuse then retry', async () => {
  const node = await import('../dist/texture/gpu-texture-wasm.js?node-fixture')
  const browser = await import('../dist/texture/gpu-texture-wasm.js?browser-fixture')
  const block = Uint8Array.of(0x00, 0xf8, 0xe0, 0x07, 0, 0, 0, 0)
  const expected = await node.decode_bc1(block, 4, 4)
  assert.equal(expected.length, 64)
  const processValue = globalThis.process
  try {
    globalThis.process = undefined
    await assert.rejects(
      browser.decode_bc1(block, 4, 4),
      error => error.code === 'CODEC_RUNTIME_LOAD_FAILED',
    )
  } finally {
    globalThis.process = processValue
  }
  await assert.rejects(
    browser.initializeGpuTextureWasmBrowser({ assetBaseUrl: 'file:///missing-fixture/' }),
    error => error.code === 'CODEC_RUNTIME_LOAD_FAILED',
  )
  const require = createRequire(import.meta.url)
  const packageEntry = require.resolve('texture2ddecoder-wasm')
  const assetBaseUrl = pathToFileURL(fileURLToPath(new URL('../', pathToFileURL(packageEntry))))
  await browser.initializeGpuTextureWasmBrowser({ assetBaseUrl })
  assert.deepEqual(await browser.decode_bc1(block, 4, 4), expected)
})
