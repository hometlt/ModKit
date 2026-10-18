#!/usr/bin/env node
/**
 * Emit the conformance vectors from the reference implementations.
 *
 *   node specs/tools/uv-conformance-emit.mjs
 *   node specs/tools/uv-conformance-emit.mjs --oracle <module url>
 *
 * The vectors are committed data, and `uv-conformance.mjs` checks them. This emitter exists so a
 * descriptor change can be re-vectored deliberately, not so a failing vector can be made to pass:
 * re-emitting is a reviewable diff of expected hashes, and a diff that nobody can explain is the
 * signal, not the fix.
 *
 * `--oracle` points at a module exporting `canonicalStringify` / `canonicalBytes` / `sha256Hex` —
 * the sealed legacy implementation the typed canonical form was lifted from. When it is supplied
 * every accept vector is required to agree with it, and the agreement is recorded in the emitted
 * file. Without it the differential block is carried forward from the existing vectors rather than
 * silently re-dated: a claim about a comparison that did not run would be worse than no claim.
 *
 * Dependency-free by design: Node built-ins only.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const specsRoot = new URL('../', import.meta.url)
const toolsRoot = new URL('./', import.meta.url)
const SPECS = fileURLToPath(specsRoot)
const T = toolsRoot.href

const argv = process.argv.slice(2)
const oracleUrl = argv.includes('--oracle') ? argv[argv.indexOf('--oracle') + 1] : undefined

const seed = await import(T + 'uv-canonical.mjs')
const oracle = oracleUrl === undefined ? undefined : await import(oracleUrl)
const { readGltfFixture, packGlb, unpackGlb, projectionFromUvmCore, resourceClosureFromUvmCore } =
  await import(T + 'uvm-core.mjs')
const mi = await import(T + 'model-interchange.mjs')
const { applyMutations } = await import(T + 'mutations.mjs')

const write = (dir, name, value) => {
  if (dir === 'conformance' && name === 'schema-assertions.json') {
    // Curated regression cases live in the committed corpus, alongside the generated seed cases.
    // Re-emitting the seed must never discard them or their additional schema directories.
    const previous = readExisting('conformance/schema-assertions.json')
    const key = assertion => assertion.id ?? JSON.stringify([
      assertion.document, assertion.pointer, assertion.schemaId, assertion.mutations ?? [],
    ])
    const generated = new Map(value.assertions.map(assertion => [key(assertion), assertion]))
    const retained = (previous?.assertions ?? []).map(assertion => {
      const replacement = generated.get(key(assertion)) ?? assertion
      generated.delete(key(assertion))
      return replacement
    })
    value = {
      ...value,
      $comment: previous?.$comment ?? value.$comment,
      schemaDirectories: [...new Set([...(previous?.schemaDirectories ?? []), ...value.schemaDirectories])],
      assertions: [...retained, ...generated.values()],
    }
  }
  mkdirSync(SPECS + dir, { recursive: true })
  writeFileSync(SPECS + dir + '/' + name, JSON.stringify(value, null, 2) + '\n')
}

const readExisting = relative => {
  const file = SPECS + relative
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
}

// --- canonical-form vectors ----------------------------------------------------------------------

const canonicalCases = [
  { id: 'scalar-integer', note: 'an integer is a binary64 value like any other number', value: 7 },
  {
    id: 'scalar-negative-zero',
    note: '-0 normalises to +0 before encoding, so the two never produce different digests',
    value: -0,
    negativeZero: true,
  },
  { id: 'scalar-null', note: 'null is a value, not an absence', value: null },
  { id: 'scalar-string-escapes', note: 'strings keep JSON escaping', value: 'line\nquote"tab\t' },
  {
    id: 'object-key-order-utf8',
    note: 'keys sort by UTF-8 bytes, so a non-ASCII key sorts after every ASCII key',
    value: { 'é': 1, e: 2, Z: 3, a: 4 },
  },
  {
    id: 'object-vs-array',
    note: 'the type tag keeps an object and an array from ever colliding',
    value: { items: [1, 2, [3, null, true]] },
  },
  {
    id: 'float-precision',
    note: 'binary64 bit patterns are encoded exactly; no decimal rounding happens',
    value: { a: 0.1, b: 0.2, c: 0.1 + 0.2, d: 1 / 3 },
  },
  {
    id: 'float32-widening',
    note: 'a float32 value widens to binary64 exactly, which is why a decoded attribute hashes stably',
    value: { f32: new Float32Array([0.1])[0] },
  },
  {
    id: 'empty-array-is-a-value',
    note: 'an empty array is a positive fact, never a stand-in for absent',
    value: { childIds: [] },
  },
]

const canonicalVectors = {
  $comment:
    'Canonical-form vectors for uv.canonical/typed-form@1. Every expectation is written out as text, so any implementation can be checked without trusting a particular copy of the code.',
  schemaVersion: 'uv-conformance-vectors-1',
  suite: 'canonical-form',
  form: 'uv.canonical/typed-form@1',
  spec: '../../foundation/SPEC_UV_CANONICALIZATION.md',
  // A differential claim is only re-dated when the comparison actually ran. Without `--oracle` the
  // existing block is carried forward unchanged, so re-emitting can never manufacture evidence.
  differentialOracle:
    oracle === undefined
      ? (readExisting('conformance/canonical-form/vectors.json')?.differentialOracle ?? {
          $comment: 'no differential has been run against a second implementation yet',
        })
      : {
          $comment:
            'Every accept vector below was produced by this repository and independently reproduced by the sealed legacy implementation, so the agreement is recorded as data rather than asserted in prose.',
          implementation: '@modkitx/world canonicalStringify / sha256Hex',
          location: 'modkitx/packages/world/src/canonical.ts (sealed legacy oracle, read-only)',
          checkedOn: new Date().toISOString().slice(0, 10),
          result: 'identical canonical text and identical digest for every accept vector',
        },
  markers: {
    negativeZero:
      'JSON cannot carry -0, so a vector that needs it sets this flag and the runner substitutes -0 for the recorded 0 before encoding',
    nonFinite:
      'JSON cannot carry NaN or infinity, so a reject vector names the value it needs instead of embedding it',
  },
  vectors: [],
}

for (const testCase of canonicalCases) {
  const text = seed.canonicalStringify(testCase.value)
  const digest = `sha256:${seed.sha256Hex(seed.canonicalBytes(testCase.value))}`
  if (oracle !== undefined) {
    if (text !== oracle.canonicalStringify(testCase.value)) {
      throw new Error(`oracle disagreement on ${testCase.id}: the two canonical forms differ`)
    }
    if (digest !== `sha256:${oracle.sha256Hex(oracle.canonicalBytes(testCase.value))}`) {
      throw new Error(`oracle disagreement on ${testCase.id}: the two digests differ`)
    }
  }
  canonicalVectors.vectors.push({
    id: testCase.id,
    expect: 'accept',
    note: testCase.note,
    value: testCase.value,
    ...(testCase.negativeZero === true ? { negativeZero: true } : {}),
    canonicalText: text,
    digest,
  })
}
for (const reject of [
  { id: 'reject-nan', nonFinite: 'NaN' },
  { id: 'reject-positive-infinity', nonFinite: 'Infinity' },
  { id: 'reject-negative-infinity', nonFinite: '-Infinity' },
]) {
  canonicalVectors.vectors.push({
    id: reject.id,
    expect: 'reject',
    note: 'a non-finite number can never enter a UV digest',
    nonFinite: reject.nonFinite,
    reason: 'cannot contain NaN or infinity',
  })
}
write('conformance/canonical-form', 'vectors.json', canonicalVectors)

// --- uvm-core vectors ------------------------------------------------------------------------------

const fixtureNames = ['uvm-core-triangle', 'uvm-core-rig', 'uvm-core-textured']
const loaded = new Map()
const uvmVectors = {
  $comment:
    'UVM/core 1.0 profile vectors. The accept cases pin the deterministic .uvm.gltf -> .uvm.glb packing rule and its digest, proving repeat materialisation is byte-stable; the reject cases pin the profile markers a conforming reader must refuse.',
  schemaVersion: 'uv-conformance-vectors-1',
  suite: 'uvm-core',
  profile: 'UVM/core@1.0',
  spec: '../../model/SPEC_UVM.md',
  packing: {
    rule: 'JSON.stringify with no whitespace, JSON chunk padded with 0x20 and BIN chunk padded with 0x00, both to a multiple of four',
    repeatIsByteStable: true,
  },
  vectors: [],
}

const uvmExtensionAssertion = (document, extension, schema) => ({
  document,
  pointer: `/extensions/${extension}`,
  schemaId: `https://modkitx.org/uvm/1.0/uvm.${schema}.schema.json`,
  expect: 'valid',
})

write('conformance', 'schema-assertions.json', {
  $comment:
    'JSON Schema assertions over everything in the seed that has a schema. The runner executes them only when an engine is supplied (--schemas <module url>), because the seed ships no dependencies; a consumer that already has an engine runs the same assertions against its pinned snapshot.',
  schemaVersion: 'uv-schema-assertions-1',
  engine: 'JSON Schema draft 2020-12',
  checkedWith:
    readExisting('conformance/schema-assertions.json')?.checkedWith ??
    'ajv 8.20.0, { allErrors: true, strict: false, validateFormats: false }',
  // Carried forward, not re-dated: this records when an engine last executed these assertions, and
  // the emitter does not execute them. Re-emitting must not turn a stale claim into a fresh one.
  checkedOn:
    readExisting('conformance/schema-assertions.json')?.checkedOn ??
    new Date().toISOString().slice(0, 10),
  note: 'the engine and the options are the ones the sealed legacy validator used, so a pass here means what a pass meant there',
  schemaDirectories: ['model/schema', 'semantic-scopes', 'texture/schema'],
  assertions: [
    ...fixtureNames.flatMap(name => [
      uvmExtensionAssertion(`model/fixtures/${name}.uvm.gltf`, 'UV_asset', 'asset'),
      uvmExtensionAssertion(`model/fixtures/${name}.uvm.gltf`, 'UV_provenance', 'provenance'),
    ]),
    uvmExtensionAssertion('model/examples/siege_tank.uvm.gltf', 'UV_asset', 'asset'),
    uvmExtensionAssertion('model/examples/siege_tank.uvm.gltf', 'UV_provenance', 'provenance'),
    uvmExtensionAssertion('model/examples/siege_tank.uvm.gltf', 'UV_game_gameplay', 'gameplay'),
    uvmExtensionAssertion('model/examples/siege_tank.uvm.gltf', 'UV_game_effects', 'effects'),
    uvmExtensionAssertion('model/examples/siege_tank.uvm.gltf', 'UV_game_variants', 'variants'),
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/slots',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.variants.schema.json', expect: 'valid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/states',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.model-states.schema.json', expect: 'valid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/invalidBoth',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.variants.schema.json', expect: 'invalid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/invalidPrimitive',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.variants.schema.json', expect: 'invalid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/invalidAttachment',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.variants.schema.json', expect: 'invalid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/invalidState',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.model-states.schema.json', expect: 'invalid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/lighting',
      schemaId: 'https://modkitx.dev/specs/world/uvw.profile.v1.schema.json#/$defs/lightingLayer', expect: 'valid' },
    { document: 'model/fixtures/uvm-variants.profile.json', pointer: '/invalidLighting',
      schemaId: 'https://modkitx.dev/specs/world/uvw.profile.v1.schema.json#/$defs/lightingLayer', expect: 'invalid' },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/nodes/6/extensions/UV_game_socket',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.socket.schema.json',
      expect: 'valid',
    },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/nodes/1/extensions/UV_game_collision',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.collision.schema.json',
      expect: 'valid',
    },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/materials/0/extensions/UV_game_material_team_color',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.material.schema.json#teamColor',
      expect: 'valid',
    },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/materials/1/extensions/UV_game_material',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.material.schema.json#gameMaterial',
      expect: 'valid',
    },
    ...['magenta', 'tolerant'].map(name => ({
      document: 'model/examples/uv_texture_color_key.json',
      pointer: `/${name}`,
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.texture.schema.json#colorKey',
      expect: 'valid',
    })),
    {
      document: 'model/examples/uv_texture_color_key.json',
      pointer: '/linearFloats',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.texture.schema.json#colorKey',
      expect: 'invalid',
      note: 'a colour key matches stored bytes, so a key stated as linear floats is refused rather than rounded',
    },
    {
      document: 'model/examples/uv_game_baked_particles.json',
      pointer: '/fire',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.baked-particles.schema.json',
      expect: 'valid',
    },
    {
      document: 'model/examples/uv_game_baked_particles.json',
      pointer: '/noRate',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.baked-particles.schema.json',
      expect: 'invalid',
      note: 'frames are placed on the clock by the frame rate, so a bake without one is refused',
    },
    {
      document: 'model/examples/uv_game_baked_particles.json',
      pointer: '/unknownOrientation',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.baked-particles.schema.json',
      expect: 'invalid',
      note: 'a sprite orientation outside camera, axis, plane and ribbon has no stated corners',
    },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/animations/1/extensions/UV_game_animation_clips',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.animation.schema.json#clips',
      expect: 'valid',
    },
    {
      document: 'model/examples/siege_tank.uvm.gltf',
      pointer: '/animations/1/extensions/UV_game_animation_events',
      schemaId: 'https://modkitx.org/uvm/1.0/uvm.animation.schema.json#events',
      expect: 'valid',
    },
    ...['uvt-2d-srgb', 'uvt-cube-linear', 'uvt-atlas-array'].map(name => ({
      document: `texture/fixtures/${name}.uvt.json`,
      pointer: '',
      schemaId: 'https://modkitx.org/uvt/1.0/uvt.profile.schema.json',
      expect: 'valid',
    })),
    {
      document: 'semantic-scopes/model-interchange-v1.json',
      pointer: '',
      schemaId: 'https://multiverse.engine/spec/semantic-scope-descriptor/1/schema.json',
      expect: 'valid',
      note: 'a registered descriptor must satisfy the descriptor schema, so an incomplete descriptor cannot be registered by accident',
    },
    {
      document: 'semantic-scopes/texture-interchange-v1.json',
      pointer: '',
      schemaId: 'https://multiverse.engine/spec/semantic-scope-descriptor/1/schema.json',
      expect: 'valid',
      note: 'a candidate descriptor satisfies the same schema as a registered one: candidate says the scope is not a compatibility guarantee, not that it may be incomplete',
    },
  ],
})
for (const name of fixtureNames) {
  const { document, binary } = readGltfFixture(`${SPECS}model/fixtures/${name}.uvm.gltf`)
  const glb = packGlb(document, binary)
  if (Buffer.compare(Buffer.from(glb), Buffer.from(packGlb(document, binary))) !== 0) {
    throw new Error(`${name}: packing is not byte-stable`)
  }
  loaded.set(name, unpackGlb(glb))
  uvmVectors.vectors.push({
    id: `${name}/pack`,
    expect: 'accept',
    fixture: `${name}.uvm.gltf`,
    note: 'packs to GLB, unpacks to the same document, and packs to the same bytes on a repeat run',
    mutations: [],
    glbByteLength: glb.byteLength,
    glbDigest: `sha256:${createHash('sha256').update(glb).digest('hex')}`,
  })
}
for (const negative of [
  {
    id: 'reject-profile-full',
    note: 'the scope binds UVM/core; a full-profile marker names a different profile, not a looser one',
    mutations: [{ op: 'set', path: 'asset.extras.uv.profile', value: 'full' }],
    reason: 'asset.extras.uv must identify the UVM/core 1.0 profile',
  },
  {
    id: 'reject-major-version',
    note: 'a reader refuses a major version it does not implement rather than guessing (SPEC_UVM §18)',
    mutations: [{ op: 'set', path: 'asset.extras.uv.version', value: '2.0' }],
    reason: 'asset.extras.uv must identify the UVM/core 1.0 profile',
  },
  {
    id: 'reject-missing-provenance',
    note: 'UV_provenance is required by the profile, so a document without it is not core-conformant',
    mutations: [{ op: 'delete', path: 'extensions.UV_provenance' }],
    reason: 'UV_provenance is declared but absent',
  },
  {
    id: 'reject-required-uv-extension',
    note: 'extensionsRequired must not list a UV_ extension (SPEC_UVM §3.1)',
    mutations: [{ op: 'set', path: 'extensionsRequired', value: ['UV_game_effects'] }],
    reason: 'UVM/core must not require a UV_ extension',
  },
  {
    id: 'reject-undeclared-extension-use',
    note: 'an extension present in extensions but missing from extensionsUsed is a malformed document',
    mutations: [{ op: 'set', path: 'extensionsUsed', value: ['UV_asset'] }],
    reason: 'UV_provenance is not declared in extensionsUsed',
  },
  {
    id: 'reject-empty-asset-id',
    note: 'UV_asset identity is hashed downstream, so a blank id is refused at the profile boundary',
    mutations: [{ op: 'set', path: 'extensions.UV_asset.id', value: '   ' }],
    reason: 'UV_asset requires a non-empty id',
  },
]) {
  uvmVectors.vectors.push({
    id: negative.id,
    expect: 'reject',
    fixture: 'uvm-core-triangle.uvm.gltf',
    note: negative.note,
    mutations: negative.mutations,
    reason: negative.reason,
  })
}
write('conformance/uvm-core', 'vectors.json', uvmVectors)

// --- model-interchange-v1 vectors --------------------------------------------------------------------

const baseProjections = {}
for (const name of fixtureNames) {
  const { document, binary } = loaded.get(name)
  baseProjections[name] = projectionFromUvmCore(document, binary)
}

const texturedDocument = loaded.get('uvm-core-textured').document
const closure = (mode, digest) =>
  resourceClosureFromUvmCore(texturedDocument, {
    mode,
    digests: digest === null ? {} : { 'textures/crate_diffuse.png': digest },
  })
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`

const definitions = [
  {
    id: 'triangle/base',
    base: 'uvm-core-triangle',
    mutations: [],
    note: 'the minimal core case: the three required facets plus bounds and geometry; the resource closure is honestly absent',
  },
  {
    id: 'rig/base',
    base: 'uvm-core-rig',
    mutations: [],
    note: 'hierarchy, non-identity transforms and two meshes',
  },
  {
    id: 'textured/base',
    base: 'uvm-core-textured',
    mutations: [],
    note: 'a textured model whose publisher does not publish a closure',
  },
  {
    id: 'triangle/paging-order-is-invisible',
    base: 'uvm-core-triangle',
    mutations: [
      { op: 'reverse', path: 'nodes' },
      { op: 'reverse', path: 'meshes' },
      { op: 'reverse', path: 'primitives' },
    ],
    sameHashAs: 'triangle/base',
    note: 'records are re-sorted by id, so the order a live source happened to page them in never reaches the hash',
  },
  {
    id: 'rig/paging-order-is-invisible',
    base: 'uvm-core-rig',
    mutations: [
      { op: 'reverse', path: 'nodes' },
      { op: 'reverse', path: 'meshes' },
      { op: 'reverse', path: 'primitives' },
    ],
    sameHashAs: 'rig/base',
    note: 'the same rule on a multi-node model',
  },
  {
    id: 'rig/child-order-is-semantic',
    base: 'uvm-core-rig',
    mutations: [{ op: 'reverse', path: 'nodes.0.childIds' }],
    differentHashFrom: 'rig/base',
    note: 'childIds is a sequence, not a set: reversing it is a different model and must not hash equal',
  },
  {
    id: 'triangle/absent-bounds-is-not-a-zero-box',
    base: 'uvm-core-triangle',
    mutations: [{ op: 'delete', path: 'info.bounds' }],
    differentHashFrom: 'triangle/base',
    note: 'a source that does not publish bounds lists the facet as absent instead of fabricating an empty box',
  },
  {
    id: 'triangle/metadata-only-drops-geometry',
    base: 'uvm-core-triangle',
    mutations: [
      { op: 'set', path: 'info.geometryAccess', value: 'metadata-only' },
      { op: 'delete', path: 'primitives' },
    ],
    differentHashFrom: 'triangle/base',
    note: 'a metadata-only publication is honestly a different hash, never "equal within losses"',
  },
  {
    id: 'closure/logical-a',
    base: 'uvm-core-textured',
    mutations: [{ op: 'set', path: 'resourceClosure', value: closure('logical', DIGEST_A) }],
    note: 'logical closure carrying a content digest the mode is required to discard',
  },
  {
    id: 'closure/logical-b',
    base: 'uvm-core-textured',
    mutations: [{ op: 'set', path: 'resourceClosure', value: closure('logical', DIGEST_B) }],
    sameHashAs: 'closure/logical-a',
    note: 'the same logical texture with different bytes: logical mode hashes equal, which is exactly what the mode promises',
  },
  {
    id: 'closure/logical-without-digest',
    base: 'uvm-core-textured',
    mutations: [{ op: 'set', path: 'resourceClosure', value: closure('logical', null) }],
    sameHashAs: 'closure/logical-a',
    note: 'a publisher that has no digest reaches the same logical hash as one that has it',
  },
  {
    id: 'closure/content-qualified-a',
    base: 'uvm-core-textured',
    mutations: [
      { op: 'set', path: 'resourceClosure', value: closure('content-qualified', DIGEST_A) },
    ],
    differentHashFrom: 'closure/logical-a',
    note: 'the mode is hashed, so a content-qualified hash can never be compared with a logical hash by accident',
  },
  {
    id: 'closure/content-qualified-b',
    base: 'uvm-core-textured',
    mutations: [
      { op: 'set', path: 'resourceClosure', value: closure('content-qualified', DIGEST_B) },
    ],
    differentHashFrom: 'closure/content-qualified-a',
    note: 'different texture bytes are a different model under content-qualified closure',
  },
  {
    id: 'closure/content-qualified-without-digest',
    base: 'uvm-core-textured',
    mutations: [{ op: 'set', path: 'resourceClosure', value: closure('content-qualified', null) }],
    differentHashFrom: 'closure/content-qualified-a',
    note: 'an unknown digest stays null and is still encoded, so "unknown content" never silently equals "known content"',
  },
  {
    id: 'closure/empty-closure-is-not-an-absent-closure',
    base: 'uvm-core-textured',
    mutations: [{ op: 'set', path: 'resourceClosure', value: { mode: 'logical', entries: [] } }],
    differentHashFrom: 'textured/base',
    note: 'not publishing the facet and publishing it with no entries are different statements',
  },
]

const rejects = [
  {
    id: 'closure/reject-bare-hex-digest',
    base: 'uvm-core-textured',
    mutations: [
      {
        op: 'set',
        path: 'resourceClosure',
        value: {
          mode: 'content-qualified',
          entries: [
            {
              role: 'image',
              logicalId: 'textures/crate_diffuse.png',
              mediaHint: 'image/png',
              digest: 'a'.repeat(64),
            },
          ],
        },
      },
    ],
    reason: 'is not algorithm-qualified',
    note: 'a digest must name its algorithm; a bare hex string is refused rather than assumed to be sha-256',
  },
  {
    id: 'closure/reject-unknown-algorithm',
    base: 'uvm-core-textured',
    mutations: [
      {
        op: 'set',
        path: 'resourceClosure',
        value: {
          mode: 'content-qualified',
          entries: [
            {
              role: 'image',
              logicalId: 'textures/crate_diffuse.png',
              mediaHint: 'image/png',
              digest: `md5:${'a'.repeat(32)}`,
            },
          ],
        },
      },
    ],
    reason: 'is not algorithm-qualified',
    note: 'only the algorithms the descriptor accepts may appear',
  },
  {
    id: 'closure/reject-unknown-role',
    base: 'uvm-core-textured',
    mutations: [
      {
        op: 'set',
        path: 'resourceClosure',
        value: {
          mode: 'logical',
          entries: [{ role: 'shader', logicalId: 'shaders/hull.fx', mediaHint: null, digest: null }],
        },
      },
    ],
    reason: 'unknown role',
    note: 'the role vocabulary is closed, so a new resource kind is a descriptor change rather than a local invention',
  },
  {
    id: 'geometry/reject-decoded-without-geometry',
    base: 'uvm-core-triangle',
    mutations: [{ op: 'delete', path: 'primitives' }],
    reason: 'geometryAccess=decoded requires uv.model/geometry@1',
    note: 'a decoded source may not withhold geometry: the two facts must agree or the scope refuses to hash',
  },
  {
    id: 'geometry/reject-metadata-only-with-geometry',
    base: 'uvm-core-triangle',
    mutations: [{ op: 'set', path: 'info.geometryAccess', value: 'metadata-only' }],
    reason: 'geometryAccess=metadata-only forbids uv.model/geometry@1',
    note: 'the mirror rule, so neither direction can be used to smuggle a mismatch past the comparison',
  },
  {
    id: 'numeric/reject-non-finite-transform',
    base: 'uvm-core-triangle',
    mutations: [{ op: 'set-non-finite', path: 'nodes.0.transform.0', value: 'NaN' }],
    reason: 'must contain finite numbers only',
    note: 'a projection carrying NaN is a diagnostic, never a hash',
  },
  {
    id: 'hierarchy/reject-duplicate-node-id',
    base: 'uvm-core-rig',
    mutations: [{ op: 'set', path: 'nodes.1.id', value: 'node-0' }],
    reason: 'node ids must be unique',
    note: 'identity is hashed, so a duplicate id is a contradiction rather than a merge',
  },
]

const vectors = []
const hashes = new Map()
for (const definition of definitions) {
  const projection = applyMutations(baseProjections[definition.base], definition.mutations)
  const value = mi.projectionSemanticHash(projection)
  hashes.set(definition.id, value)
  const bundle = mi.buildFacetBundle(projection)
  vectors.push({
    id: definition.id,
    expect: 'accept',
    note: definition.note,
    base: definition.base,
    mutations: definition.mutations,
    facets: bundle.facets.map(entry => entry[0]),
    absentFacets: bundle.absentFacets,
    hash: value,
    ...(definition.sameHashAs === undefined ? {} : { sameHashAs: definition.sameHashAs }),
    ...(definition.differentHashFrom === undefined
      ? {}
      : { differentHashFrom: definition.differentHashFrom }),
  })
}
for (const definition of rejects) {
  let thrown = null
  try {
    mi.projectionSemanticHash(applyMutations(baseProjections[definition.base], definition.mutations))
  } catch (error) {
    thrown = error.message
  }
  if (thrown === null) throw new Error(`${definition.id}: expected a rejection, got a hash`)
  if (!thrown.includes(definition.reason)) {
    throw new Error(`${definition.id}: rejection message "${thrown}" does not carry the declared reason`)
  }
  vectors.push({
    id: definition.id,
    expect: 'reject',
    note: definition.note,
    base: definition.base,
    mutations: definition.mutations,
    reason: definition.reason,
  })
}
for (const vector of vectors) {
  for (const [field, expectEqual] of [
    ['sameHashAs', true],
    ['differentHashFrom', false],
  ]) {
    const other = vector[field]
    if (other === undefined) continue
    if (!hashes.has(other)) throw new Error(`${vector.id}: ${field} names an unknown vector ${other}`)
    const equal = hashes.get(other) === vector.hash
    if (equal !== expectEqual) throw new Error(`${vector.id}: ${field} ${other} is not satisfied`)
  }
}

write('conformance/model-interchange-v1', 'vectors.json', {
  $comment:
    'Conformance vectors for the registered model-interchange-v1 semantic scope. Every vector names a base projection, the mutations applied to it and the exact hash the descriptor requires. Equality and inequality are both pinned, because a scope that only proves equality proves nothing about what it separates.',
  schemaVersion: 'uv-conformance-vectors-1',
  suite: 'model-interchange-v1',
  descriptor: '../../semantic-scopes/model-interchange-v1.json',
  scope: { id: 'model-interchange-v1', version: '1.0.0' },
  baseProjections: Object.fromEntries(
    fixtureNames.map(name => [
      name,
      {
        source: `projectionFromUvmCore(../../model/fixtures/${name}.uvm.gltf)`,
        note: 'the artifact binding of the scope, drained exactly as the live binding would be',
      },
    ]),
  ),
  mutationOps: {
    set: 'replace the value at a dotted path',
    'set-non-finite': 'replace the value at a dotted path with NaN, Infinity or -Infinity, which JSON cannot carry',
    delete: 'remove the value at a dotted path',
    reverse: 'reverse the array at a dotted path',
  },
  vectors,
})

console.log('vectors written:', vectors.length, 'model-interchange +', uvmVectors.vectors.length, 'uvm-core +', canonicalVectors.vectors.length, 'canonical-form')
