import { describe, expect, it } from 'vitest'
import { deepFreeze } from '@modkit/core'
import { revisionId, type DataResolvedEntity } from '@modkit/sdk'
import { planUvwExactObjectMappings, type UvwExactObjectMappingInput } from '../src/world/object-mapping.js'

const entity = (namespace: string, entityId: string): DataResolvedEntity => ({ namespace, entityId, typeId: 'fixture', inheritanceChain: [], fields: {}, sources: [], complete: true })
const snapshot = (bindingId: string) => ({ bindingId, role: 'fixture', subjectUri: `memory:${bindingId}`, revision: revisionId(`provider-token:${bindingId}-1`), compositionFingerprint: `fixture:${bindingId}:1` })
function fixture() {
  return {
    sourceSnapshot: snapshot('world'),
    dependencies: {
      source: { scope: 'source' as const, snapshot: snapshot('source-catalog'), entities: [entity('feature', 'Oil'), entity('other', 'Oil')] },
      target: { scope: 'target' as const, snapshot: snapshot('target-catalog'), entities: [entity('Unit', 'OilUnit'), entity('Unit', 'Mineral')] },
    },
    bindings: {
      oil: { packageKey: 'source', ref: { namespace: 'feature', entityId: 'Oil' } },
      other: { packageKey: 'source', ref: { namespace: 'other', entityId: 'Oil' } },
      target: { packageKey: 'target', ref: { namespace: 'Unit', entityId: 'OilUnit' } },
      mineral: { packageKey: 'target', ref: { namespace: 'Unit', entityId: 'Mineral' } },
    },
    instances: [
      { sourceRef: '油-1', definition: { packageKey: 'source', ref: { namespace: 'feature', entityId: 'Oil' } }, objectKind: 'feature', typeId: 'Oil' },
      { sourceRef: 'oil-2', definition: { packageKey: 'source', ref: { namespace: 'feature', entityId: 'Oil' } }, objectKind: 'feature', typeId: 'Oil' },
    ],
    rules: [{ id: 'oil', priority: 1, definitionBindings: ['oil'], targetBinding: 'target' }],
    maxRuleMatches: 10,
  } satisfies UvwExactObjectMappingInput
}
const codes = (input: UvwExactObjectMappingInput) => planUvwExactObjectMappings(input).refusals.map(refusal => refusal.code)

describe('exact 1:1 object mapping pilot', () => {
  it('owns an immutable plan, preserves Unicode aliases and pins world/catalog revisions', () => {
    const input = fixture()
    const before = structuredClone(input)
    const plan = planUvwExactObjectMappings(deepFreeze(input))
    expect(plan.accepted).toBe(true)
    expect(plan.mappings.map(mapping => mapping.sourceRef)).toEqual(['oil-2', '油-1'])
    expect(plan.writerBindings).toEqual([{ sourceWriterKey: 'feature:Oil', target: input.bindings.target }])
    expect(plan.snapshots).toHaveLength(3)
    expect(input).toEqual(before)
    expect(Object.isFrozen(plan.mappings[0]!.target.ref)).toBe(true)
    const mutable = fixture()
    const owned = planUvwExactObjectMappings(mutable)
    mutable.bindings.target.ref.entityId = 'Mineral'
    mutable.sourceSnapshot.compositionFingerprint = 'changed'
    expect(owned.mappings[0]!.target.ref.entityId).toBe('OilUnit')
    expect(owned.snapshots[0]!.compositionFingerprint).toBe('fixture:world:1')
    expect(Object.isFrozen(mutable)).toBe(false)
  })

  it('does not match equal entity IDs across namespaces or package contexts', () => {
    const input = fixture()
    input.instances[0]!.definition.ref.namespace = 'other'
    expect(codes(input)).toContain('object-mapping-unmatched')
    const secondContext = fixture()
    const scoped = { ...secondContext, dependencies: { ...secondContext.dependencies, another: { ...secondContext.dependencies.source, snapshot: snapshot('another') } } }
    scoped.instances[0]!.definition.packageKey = 'another'
    expect(codes(scoped)).toContain('object-mapping-unmatched')
  })

  it('uses priority explicitly, refuses ties even for the same target and ignores rule order', () => {
    const input = fixture()
    input.rules.push({ ...input.rules[0]!, id: 'higher', priority: 2 })
    expect(planUvwExactObjectMappings(input).mappings.every(mapping => mapping.ruleId === 'higher')).toBe(true)
    expect(planUvwExactObjectMappings({ ...input, rules: [...input.rules].reverse() })).toEqual(planUvwExactObjectMappings(input))
    input.rules[0]!.priority = 2
    const plan = planUvwExactObjectMappings(input)
    expect(plan.refusals.map(refusal => refusal.code)).toEqual(['object-mapping-conflict', 'object-mapping-conflict'])
    expect(plan.mappings).toEqual([])
    expect(plan.writerBindings).toEqual([])
  })

  it('ANDs sourceRefs with exact definitions and rejects dangling aliases', () => {
    const input = fixture()
    const selected = { ...input, rules: [{ ...input.rules[0]!, sourceRefs: ['油-1'] }] }
    const plan = planUvwExactObjectMappings(selected)
    expect(plan.refusals).toEqual([{ code: 'object-mapping-unmatched', path: 'oil-2', message: 'no exact rule matches this source instance' }])
    expect(codes({ ...input, rules: [{ ...input.rules[0]!, sourceRefs: ['unknown'] }] })).toContain('object-mapping-source-ref-missing')
    expect(codes({ ...input, rules: [{ ...input.rules[0]!, sourceRefs: ['油-1'], definitionBindings: ['other'] }] })).toContain('object-mapping-unmatched')
  })

  it('requires scoped, present, complete target definitions and pinned snapshots', () => {
    const missing = fixture()
    missing.dependencies.target.entities = []
    expect(codes(missing)).toContain('object-mapping-definition-missing')
    const wrongScope = fixture()
    wrongScope.bindings.target.packageKey = 'source'
    expect(codes(wrongScope)).toContain('object-mapping-binding-scope')
    const incomplete = fixture()
    incomplete.dependencies.target.entities[0] = { ...incomplete.dependencies.target.entities[0]!, complete: false }
    expect(codes(incomplete)).toContain('object-mapping-catalog-incomplete')
    const unpinned = fixture()
    unpinned.sourceSnapshot.compositionFingerprint = ''
    expect(codes(unpinned)).toContain('object-mapping-snapshot-unpinned')
    const duplicate = fixture()
    duplicate.dependencies.target.snapshot.bindingId = duplicate.dependencies.source.snapshot.bindingId
    expect(codes(duplicate)).toContain('object-mapping-snapshot-duplicate')
    const missingSource = fixture()
    missingSource.bindings.oil.packageKey = 'absent'
    expect(codes(missingSource)).toContain('object-mapping-binding-scope')
  })

  it('refuses rule-match budget overflow without partial executable mappings', () => {
    const input = fixture()
    expect(planUvwExactObjectMappings({ ...input, maxRuleMatches: 2 }).accepted).toBe(true)
    const plan = planUvwExactObjectMappings({ ...input, maxRuleMatches: 1 })
    expect(plan.refusals[0]!.code).toBe('object-mapping-budget-exceeded')
    expect(plan.mappings).toEqual([])
    expect(plan.writerBindings).toEqual([])
    expect(codes({ ...input, maxRuleMatches: 0 })).toContain('object-mapping-budget-invalid')
  })

  it.each([
    ['revision', 'not-a-canonical-revision'],
    ['bindingId', ''],
    ['role', ''],
    ['subjectUri', ''],
  ])('refuses an unpinned snapshot %s', (field, value) => {
    const input = fixture()
    // Deliberately violate the branded/host-prepared contract to exercise the guard.
    Object.assign(input.sourceSnapshot, { [field!]: value })
    const plan = planUvwExactObjectMappings(input)
    expect(plan.refusals.map(refusal => refusal.code)).toContain('object-mapping-snapshot-unpinned')
    expect(plan.mappings).toEqual([])
    expect(plan.writerBindings).toEqual([])
  })

  it('refuses writer-key collisions across distinct source definitions', () => {
    const input = fixture()
    input.instances[0]!.definition.ref.namespace = 'other'
    input.rules.push({ id: 'other', priority: 1, definitionBindings: ['other'], targetBinding: 'mineral' })
    const plan = planUvwExactObjectMappings(input)
    expect(plan.refusals.map(refusal => refusal.code)).toEqual(['object-mapping-writer-unrepresentable'])
    expect(plan.mappings).toEqual([])
  })

  it('refuses per-instance targets that cannot be expressed by the current type-wide writer', () => {
    const input = fixture()
    const specific = { id: 'specific', priority: 2, definitionBindings: ['oil'], sourceRefs: ['油-1'], targetBinding: 'mineral' }
    expect(codes({ ...input, rules: [...input.rules, specific] })).toContain('object-mapping-writer-unrepresentable')
    expect(planUvwExactObjectMappings({ ...input, rules: [...input.rules, { ...specific, targetBinding: 'target' }] }).accepted).toBe(true)
  })
})
