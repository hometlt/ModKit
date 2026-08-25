#!/usr/bin/env node
/**
 * Executable conformance runner for the specs seed.
 *
 *   node specs/tools/uv-conformance.mjs            run every suite
 *   node specs/tools/uv-conformance.mjs --suite X  run one suite
 *
 * Every expectation lives in `../conformance/<suite>/vectors.json`, never in this file. The runner
 * only executes what the vectors declare, so a second implementation can replace this file without
 * renegotiating what conformance means.
 *
 * Dependency-free by design: Node built-ins only. `pnpm`, `npm install` and a package manifest are
 * deliberately absent from the specs seed — a specification a third party cannot run without a
 * lockfile is a specification with a hidden dependency.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { canonicalBytes, canonicalStringify, sha256Hex } from './uv-canonical.mjs'
import { applyMutations } from './mutations.mjs'
import {
  assertUvmCore,
  packGlb,
  projectionFromUvmCore,
  readGltfFixture,
  unpackGlb,
} from './uvm-core.mjs'
import { buildFacetBundle, projectionSemanticHash, DESCRIPTOR } from './model-interchange.mjs'
import { assertUvtProfile } from './uvt-profile.mjs'

const specsRoot = new URL('../', import.meta.url)
const readJson = relative => JSON.parse(readFileSync(fileURLToPath(new URL(relative, specsRoot)), 'utf8'))
const failures = []
let checks = 0

const fail = (suite, id, message) => failures.push(`${suite} / ${id}: ${message}`)
const expectEqual = (suite, id, actual, expected, what) => {
  checks += 1
  if (actual !== expected) fail(suite, id, `${what}\n    expected ${expected}\n    actual   ${actual}`)
}
const expectThrow = (suite, id, reason, run) => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (!String(error.message).includes(reason)) {
      fail(suite, id, `rejected for the wrong reason\n    expected to contain ${reason}\n    actual   ${error.message}`)
    }
    return
  }
  fail(suite, id, `expected a rejection carrying "${reason}", the input was accepted`)
}

const NON_FINITE = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY }

// --- suite: canonical-form -----------------------------------------------------------------------

function runCanonicalForm() {
  const suite = 'canonical-form'
  const file = readJson('conformance/canonical-form/vectors.json')
  for (const vector of file.vectors) {
    if (vector.expect === 'accept') {
      const value = vector.negativeZero === true ? -0 : vector.value
      expectEqual(suite, vector.id, canonicalStringify(value), vector.canonicalText, 'canonical text')
      expectEqual(
        suite,
        vector.id,
        `sha256:${sha256Hex(canonicalBytes(value))}`,
        vector.digest,
        'digest',
      )
      continue
    }
    const nonFinite = NON_FINITE[vector.nonFinite]
    if (nonFinite === undefined) {
      fail(suite, vector.id, `reject vector names an unknown non-finite value ${vector.nonFinite}`)
      continue
    }
    expectThrow(suite, vector.id, vector.reason, () => canonicalStringify({ value: nonFinite }))
  }
  return file.vectors.length
}

// --- suite: uvm-core -----------------------------------------------------------------------------

/**
 * Execute the JSON Schema assertions, but only with an engine the caller supplies.
 *
 * The seed ships no dependencies, so it cannot ship a validator. A consumer that already has one
 * passes `--schemas <module url of a draft 2020-12 Ajv build>` and the assertions run for real;
 * without it they are reported as not executed rather than silently counted as passing.
 */
async function runSchemaAssertions(engineUrl) {
  const suite = 'schema-assertions'
  const file = readJson('conformance/schema-assertions.json')
  const assertions = file.assertions ?? []
  if (engineUrl === undefined) return { executed: 0, declared: assertions.length }
  const { default: Ajv2020 } = await import(engineUrl)
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  for (const directory of file.schemaDirectories) {
    const schemaDir = fileURLToPath(new URL(`${directory}/`, specsRoot))
    for (const name of readdirSync(schemaDir).sort()) {
      if (name.endsWith('.schema.json')) {
        ajv.addSchema(JSON.parse(readFileSync(schemaDir + name, 'utf8')))
      }
    }
  }
  for (const assertion of assertions) {
    const document = readJson(assertion.document)
    const value = assertion.pointer
      .split('/')
      .filter(Boolean)
      .reduce((cursor, key) => (cursor === undefined ? undefined : cursor[key]), document)
    const id = `${assertion.document}${assertion.pointer}`
    const validate = ajv.getSchema(assertion.schemaId)
    checks += 1
    if (validate === undefined) {
      fail(suite, id, `no schema is registered under ${assertion.schemaId}`)
      continue
    }
    if (value === undefined) {
      fail(suite, id, `the document has nothing at ${assertion.pointer}`)
      continue
    }
    if (validate(value) !== (assertion.expect === 'valid')) {
      fail(
        suite,
        id,
        `expected ${assertion.expect} against ${assertion.schemaId}\n    ${JSON.stringify(validate.errors?.slice(0, 2))}`,
      )
    }
  }
  return { executed: assertions.length, declared: assertions.length }
}

function runUvmCore() {
  const suite = 'uvm-core'
  const file = readJson('conformance/uvm-core/vectors.json')
  for (const vector of file.vectors) {
    const fixture = fileURLToPath(new URL(`model/fixtures/${vector.fixture}`, specsRoot))
    const { document, binary } = readGltfFixture(fixture)
    const mutated = applyMutations(document, vector.mutations ?? [])
    if (vector.expect === 'reject') {
      expectThrow(suite, vector.id, vector.reason, () => assertUvmCore(mutated))
      continue
    }
    assertUvmCore(mutated)
    const glb = packGlb(mutated, binary)
    expectEqual(suite, vector.id, glb.byteLength, vector.glbByteLength, 'packed GLB length')
    expectEqual(
      suite,
      vector.id,
      `sha256:${createHash('sha256').update(glb).digest('hex')}`,
      vector.glbDigest,
      'packed GLB digest',
    )
    // Repeat materialisation of a canonical case is byte-stable, not merely equal-once.
    const repeat = packGlb(mutated, binary)
    expectEqual(
      suite,
      vector.id,
      `sha256:${createHash('sha256').update(repeat).digest('hex')}`,
      vector.glbDigest,
      'repeat packing is byte-stable',
    )
    // Unpacking the packed bytes returns the same document the fixture declared.
    const round = unpackGlb(glb)
    expectEqual(
      suite,
      vector.id,
      canonicalStringify(round.document),
      canonicalStringify(mutated),
      'GLB round-trip preserves the document',
    )
  }
  return file.vectors.length
}

// --- suite: uvt ----------------------------------------------------------------------------------

function runUvt() {
  const suite = 'uvt'
  const file = readJson('conformance/uvt/vectors.json')
  for (const vector of file.vectors) {
    const sidecar = readJson(`texture/fixtures/${vector.fixture}`)
    const mutated = applyMutations(sidecar, vector.mutations ?? [])
    if (vector.expect === 'reject') {
      checks += 1
      try {
        assertUvtProfile(mutated)
      } catch (error) {
        if (error.rule !== vector.rule) {
          fail(
            suite,
            vector.id,
            `refused for rule «${String(error.rule)}», the vector names «${vector.rule}»`,
          )
        }
        continue
      }
      fail(suite, vector.id, `expected the «${vector.rule}» rule to refuse this sidecar`)
      continue
    }
    checks += 1
    try {
      assertUvtProfile(mutated)
    } catch (error) {
      fail(suite, vector.id, `a shipped fixture must conform: ${error.message}`)
    }
  }
  return file.vectors.length
}

// --- suite: model-interchange-v1 -------------------------------------------------------------------

function runModelInterchange() {
  const suite = 'model-interchange-v1'
  const file = readJson('conformance/model-interchange-v1/vectors.json')

  // The vectors and the descriptor must name the same scope, or the suite proves nothing.
  expectEqual(suite, '(descriptor)', DESCRIPTOR.scopeId, file.scope.id, 'scope id')
  expectEqual(suite, '(descriptor)', DESCRIPTOR.version, file.scope.version, 'scope version')

  const bases = new Map()
  for (const name of Object.keys(file.baseProjections)) {
    const fixture = fileURLToPath(new URL(`model/fixtures/${name}.uvm.gltf`, specsRoot))
    const { document, binary } = readGltfFixture(fixture)
    const packed = unpackGlb(packGlb(document, binary))
    bases.set(name, projectionFromUvmCore(packed.document, packed.binary))
  }

  const hashes = new Map()
  for (const vector of file.vectors) {
    const base = bases.get(vector.base)
    if (base === undefined) {
      fail(suite, vector.id, `names an unknown base projection ${vector.base}`)
      continue
    }
    if (vector.expect === 'reject') {
      expectThrow(suite, vector.id, vector.reason, () =>
        projectionSemanticHash(applyMutations(base, vector.mutations ?? [])),
      )
      continue
    }
    const projection = applyMutations(base, vector.mutations ?? [])
    const value = projectionSemanticHash(projection)
    hashes.set(vector.id, value)
    expectEqual(suite, vector.id, value, vector.hash, 'projectionSemanticHash')
    const bundle = buildFacetBundle(projection)
    expectEqual(
      suite,
      vector.id,
      bundle.facets.map(entry => entry[0]).join(','),
      (vector.facets ?? []).join(','),
      'present facets',
    )
    expectEqual(
      suite,
      vector.id,
      bundle.absentFacets.join(','),
      (vector.absentFacets ?? []).join(','),
      'absent facets',
    )
  }
  for (const vector of file.vectors) {
    for (const [field, mustMatch] of [
      ['sameHashAs', true],
      ['differentHashFrom', false],
    ]) {
      const other = vector[field]
      if (other === undefined) continue
      checks += 1
      const otherHash = hashes.get(other)
      if (otherHash === undefined) {
        fail(suite, vector.id, `${field} names an unknown vector ${other}`)
        continue
      }
      const equal = otherHash === hashes.get(vector.id)
      if (equal !== mustMatch) {
        fail(
          suite,
          vector.id,
          `${field} ${other} is violated: the two hashes are ${equal ? 'equal' : 'different'}`,
        )
      }
    }
  }
  return file.vectors.length
}

// --- entry point -----------------------------------------------------------------------------------

const suites = {
  'canonical-form': runCanonicalForm,
  'uvm-core': runUvmCore,
  uvt: runUvt,
  'model-interchange-v1': runModelInterchange,
}

const argv = process.argv.slice(2)
const argValue = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
const requested = argValue('--suite')
const engineUrl = argValue('--schemas')
if (requested !== undefined && suites[requested] === undefined) {
  console.error(`unknown suite ${requested}; known suites: ${Object.keys(suites).join(', ')}`)
  process.exit(2)
}

let vectorCount = 0
for (const [name, run] of Object.entries(suites)) {
  if (requested !== undefined && name !== requested) continue
  vectorCount += run()
}

let schemaNote = ''
if (requested === undefined) {
  const { executed, declared } = await runSchemaAssertions(engineUrl)
  schemaNote =
    executed === declared
      ? `, ${executed} schema assertions executed`
      : `, ${declared} schema assertions declared but NOT executed (pass --schemas <draft 2020-12 engine module url> to run them)`
}

if (failures.length > 0) {
  console.error(`uv-conformance: ${failures.length} failure(s)\n`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(
  `uv-conformance: ${vectorCount} vectors, ${checks} checks${schemaNote}, all passing${requested === undefined ? '' : ` (suite ${requested})`}`,
)
