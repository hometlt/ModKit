import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDefinitions } from './uv-composition.mjs'

const schema = { role: 'kind-schema', kinds: [
  { kind: 'vehicle', version: 1, fields: [
    { name: 'mounts', type: 'list', itemType: 'record', runtimeRole: 'assembly.slots@1', recordFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'capacity', type: 'i64', required: true },
      { name: 'accepts', type: 'list', itemType: 'ref', refKind: 'part', required: true },
    ] },
    { name: 'loadout', type: 'list', itemType: 'record', runtimeRole: 'assembly.initial-parts@1', recordFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'slot', type: 'string', required: true },
      { name: 'definition', type: 'ref', refKind: 'part', required: true },
    ] },
  ] },
  { kind: 'part', version: 1, fields: [{ name: 'mass', type: 'i64' }] },
] }

const partAddress = 'v/part/cannon'
function resolve(count, change = () => {}, options) {
  const ownedSchema = structuredClone(schema)
  const vehicle = { kind: 'vehicle', kindVersion: 1, name: 'rover', fields: {
    mounts: [{ id: 'turret', capacity: 8, accepts: [partAddress] }],
    loadout: Array.from({ length: count }, (_, index) => ({
      id: `gun-${index}`, slot: 'turret', definition: partAddress,
    })),
  } }
  const part = { kind: 'part', kindVersion: 1, name: 'cannon', fields: { mass: 1 } }
  const additionalDefinitions = []
  change(ownedSchema, vehicle, part, additionalDefinitions)
  return resolveDefinitions([{ id: 'base', documents: [ownedSchema, {
    role: 'definitions', namespace: 'v', definitions: [
      part, vehicle, ...additionalDefinitions,
    ],
  }] }], options)
}

for (const count of [0, 1, 2, 8]) test(`${count} parts share one UVD definition but retain stable instance IDs`, () => {
  const outcome = resolve(count)
  assert.equal(outcome.refusal, undefined)
  assert.equal(outcome.assemblies.get('v/vehicle/rover').initialParts.length, count)
  assert.deepEqual(outcome.assemblies.get('v/vehicle/rover').initialParts.map(part => part.id),
    Array.from({ length: count }, (_, index) => `gun-${index}`))
})

test('assembly roles do not depend on native class or field names', () => {
  const outcome = resolve(1)
  assert.equal(outcome.refusal, undefined)
  assert.deepEqual(outcome.assemblies.get('v/vehicle/rover').slots[0],
    { id: 'turret', capacity: 8, accepts: [partAddress] })
})

test('assembly admission uses the effective inherited keyed slot, not the parent row', () => {
  const inheritedSchema = structuredClone(schema)
  inheritedSchema.kinds[0].fields[0].inherit = 'merge'
  inheritedSchema.kinds[0].fields[0].keyField = 'id'
  const outcome = resolveDefinitions([{ id: 'base', documents: [inheritedSchema, {
    role: 'definitions', namespace: 'v', definitions: [
      { kind: 'part', kindVersion: 1, name: 'cannon', fields: { mass: 1 } },
      { kind: 'vehicle', kindVersion: 1, name: 'base', fields: {
        mounts: [{ id: 'turret', capacity: 1, accepts: [partAddress] }],
      } },
      { kind: 'vehicle', kindVersion: 1, name: 'child', parent: 'v/vehicle/base', fields: {
        mounts: [{ id: 'turret', capacity: 2, accepts: [partAddress] }],
        loadout: [0, 1].map(index => ({ id: `gun-${index}`, slot: 'turret', definition: partAddress })),
      } },
    ],
  }] }])
  assert.equal(outcome.refusal, undefined)
  assert.equal(outcome.assemblies.get('v/vehicle/base').slots[0].capacity, 1)
  assert.equal(outcome.assemblies.get('v/vehicle/child').slots[0].capacity, 2)
  assert.equal(outcome.assemblies.get('v/vehicle/child').initialParts.length, 2)
})

const refusals = [
  ['capacity', (schema, vehicle) => { vehicle.fields.mounts[0].capacity = 1 }, 2, 'assembly-capacity'],
  ['duplicate instance', (schema, vehicle) => { vehicle.fields.loadout[1].id = 'gun-0' }, 2, 'assembly-duplicate-part'],
  ['duplicate slot', (schema, vehicle) => { vehicle.fields.mounts.push({ ...vehicle.fields.mounts[0] }) }, 1, 'assembly-duplicate-slot'],
  ['unknown slot', (schema, vehicle) => { vehicle.fields.loadout[0].slot = 'hull' }, 1, 'assembly-slot-unknown'],
  ['incompatible part', (schema, vehicle) => { vehicle.fields.mounts[0].accepts = [] }, 1, 'assembly-incompatible-part'],
  ['unsafe capacity', (schema, vehicle) => { vehicle.fields.mounts[0].capacity = 9007199254740992 }, 1, 'assembly-capacity'],
  ['malformed role field', (schema) => { schema.kinds[0].fields[0].recordFields[1].type = 'fixed64' }, 1, 'assembly-schema'],
  ['unknown role', (schema) => { schema.kinds[0].fields[0].runtimeRole = 'assembly.unknown@1' }, 1, 'assembly-schema'],
]
for (const [name, change, count, rule] of refusals) test(`${name} refuses the composed assembly`, () => {
  const outcome = resolve(count, change)
  assert.equal(outcome.refusal?.rule, rule)
})

const withGrant = (schema, _vehicle, part, additionalDefinitions) => {
  schema.kinds[1].fields.push({ name: 'abilities', type: 'list', itemType: 'record',
    runtimeRole: 'assembly.grants@1', recordFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'capability', type: 'ref', refKind: 'capability', required: true },
    ] })
  schema.kinds.push({ kind: 'capability', version: 1, fields: [
    { name: 'state', type: 'list', itemType: 'record', runtimeRole: 'capability.counters@1',
      recordFields: [
        { name: 'id', type: 'string', required: true },
        { name: 'initial', type: 'i64', required: true },
        { name: 'minimum', type: 'i64', required: true },
        { name: 'maximum', type: 'i64', required: true },
      ] },
  ] })
  part.fields.abilities = [{ id: 'primary', capability: 'v/capability/rifle' }]
  additionalDefinitions.push({ kind: 'capability', kindVersion: 1, name: 'rifle', fields: {
    state: [
      { id: 'ammo', initial: 24, minimum: 0, maximum: 24 },
      { id: 'readyTick', initial: 0, minimum: 0, maximum: '9223372036854775807' },
    ],
  } })
}

for (const count of [0, 1, 2, 8]) test(`${count} parts admit independent grant templates through UVD`, () => {
  const outcome = resolve(count, withGrant)
  assert.equal(outcome.refusal, undefined)
  assert.deepEqual(outcome.partGrants.get(partAddress),
    [{ id: 'primary', capability: 'v/capability/rifle' }])
  assert.deepEqual(outcome.capabilityCounters.get('v/capability/rifle').map(counter => counter.id),
    ['ammo', 'readyTick'])
  assert.equal(outcome.assemblies.get('v/vehicle/rover').initialParts.length, count)
})

for (const [name, mutate, rule] of [
  ['duplicate grant', (_schema, _vehicle, part) => { part.fields.abilities.push({ ...part.fields.abilities[0] }) }, 'assembly-grant-id'],
  ['missing capability', (_schema, _vehicle, part) => { part.fields.abilities[0].capability = 'v/capability/missing' }, 'assembly-grant-reference'],
  ['invalid counter range', (_schema, _vehicle, _part, defs) => { defs[0].fields.state[0].initial = 25 }, 'capability-counter-range'],
  ['duplicate counter', (_schema, _vehicle, _part, defs) => { defs[0].fields.state.push({ ...defs[0].fields.state[0] }) }, 'capability-counter-id'],
]) test(`${name} refuses the capability grant`, () => {
  const outcome = resolve(2, (schema, vehicle, part, definitions) => {
    withGrant(schema, vehicle, part, definitions)
    mutate(schema, vehicle, part, definitions)
  }, { danglingReferences: 'diagnose' })
  assert.equal(outcome.refusal?.rule, rule)
})

test('dangling accepted part refuses even under UVD diagnostic policy', () => {
  const outcome = resolve(0, (_schema, vehicle) => {
    vehicle.fields.mounts[0].accepts = ['v/part/missing']
  }, { danglingReferences: 'diagnose' })
  assert.equal(outcome.refusal?.rule, 'assembly-dangling-part')
})

const withEffect = (schema, vehicle, part) => {
  schema.kinds[0].fields.push({ name: 'health', type: 'fixed64', required: true })
  schema.kinds[1].fields.push({ name: 'bonuses', type: 'list', itemType: 'record',
    runtimeRole: 'assembly.stat-effects@1', recordFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'field', type: 'string', required: true },
      { name: 'delta', type: 'fixed64', required: true },
    ] })
  vehicle.fields.health = '4294967296'
  part.fields.bonuses = [{ id: 'armor-kit', field: 'health', delta: '2147483648' }]
}

test('part stat effects are normalized from the same resolved UVD kind-schema', () => {
  const outcome = resolve(2, withEffect)
  assert.equal(outcome.refusal, undefined)
  assert.deepEqual(outcome.partEffects.get(partAddress),
    [{ id: 'armor-kit', field: 'health', delta: '2147483648' }])
})

for (const [name, mutate, rule] of [
  ['undeclared target', (_schema, _vehicle, part) => { part.fields.bonuses[0].field = 'speed' }, 'assembly-effect-target'],
  ['duplicate ID', (_schema, _vehicle, part) => { part.fields.bonuses.push({ ...part.fields.bonuses[0] }) }, 'assembly-effect-id'],
  ['overflow quantum', (_schema, _vehicle, part) => { part.fields.bonuses[0].delta = '9223372036854775808' }, 'assembly-effect-delta'],
  ['malformed role', (schema) => { schema.kinds[1].fields[1].recordFields[2].type = 'i64' }, 'assembly-schema'],
]) test(`${name} refuses the part effect`, () => {
  const outcome = resolve(1, (schema, vehicle, part) => {
    withEffect(schema, vehicle, part)
    mutate(schema, vehicle, part)
  })
  assert.equal(outcome.refusal?.rule, rule)
})
