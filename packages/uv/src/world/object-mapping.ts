import { compareUtf8, deepFreeze } from '@modkit/core'
import { isRevisionId, type DataEntityRef, type DataResolvedEntity, type SubjectSnapshotRef } from '@modkit/sdk'
import type { UvwConversionRefusal } from './conversion.js'

/** Host-owned, already resolved catalog context; never a request to load a package. */
export interface UvwObjectMappingContext {
  readonly scope: 'source' | 'target'
  readonly snapshot: SubjectSnapshotRef
  readonly entities: readonly DataResolvedEntity[]
}

export interface UvwObjectDefinitionBinding {
  readonly packageKey: string
  readonly ref: DataEntityRef
}

export interface UvwExactObjectMappingRule {
  readonly id: string
  readonly priority: number
  readonly definitionBindings: readonly string[]
  /** Opaque instance aliases in the pinned source snapshot; AND with definitionBindings. */
  readonly sourceRefs?: readonly string[]
  readonly targetBinding: string
}

export interface UvwExactObjectMappingInput {
  readonly sourceSnapshot: SubjectSnapshotRef
  readonly dependencies: Readonly<Record<string, UvwObjectMappingContext>>
  readonly bindings: Readonly<Record<string, UvwObjectDefinitionBinding>>
  readonly instances: readonly Readonly<{
    readonly sourceRef: string
    readonly definition: UvwObjectDefinitionBinding
    /** Exact key fields understood by the current native writer, not catalog identity. */
    readonly objectKind: string
    readonly typeId: string
  }>[]
  readonly rules: readonly UvwExactObjectMappingRule[]
  readonly maxRuleMatches: number
}

export interface UvwExactObjectMappingPlan {
  readonly accepted: boolean
  /** Host must retain/check these revision guards before consuming this plan. */
  readonly snapshots: readonly SubjectSnapshotRef[]
  readonly mappings: readonly Readonly<{
    readonly sourceRef: string
    readonly ruleId: string
    readonly target: UvwObjectDefinitionBinding
  }>[]
  /** Writer-key table after exact resolution; the target adapter supplies native placement kinds. */
  readonly writerBindings: readonly Readonly<{
    readonly sourceWriterKey: string
    readonly target: UvwObjectDefinitionBinding
  }>[]
  readonly refusals: readonly UvwConversionRefusal[]
}

/** Exact 1:1, fail-closed pilot. Not the proposal profile/DSL interpreter and not a writer.
 * Snapshot tokens provide provenance, not proof of authenticity: only the public host may
 * prepare the catalogs/instance associations and enforce their revision guards.
 * Current native writers are type-wide: differing targets for one kind:typeId are refused.
 */
export function planUvwExactObjectMappings(input: UvwExactObjectMappingInput): UvwExactObjectMappingPlan {
  const refusals: UvwConversionRefusal[] = []
  const mappings: { sourceRef: string; ruleId: string; target: UvwObjectDefinitionBinding }[] = []
  const refuse = (code: string, path: string, message: string): void => {
    refusals.push({ code, path, message })
  }
  const snapshots = [input.sourceSnapshot, ...Object.keys(input.dependencies).sort(compareUtf8).map(key => input.dependencies[key]!.snapshot)]
  const snapshotIds = new Set<string>()
  for (const [index, snapshot] of snapshots.entries()) {
    if (!snapshot.bindingId || !snapshot.role || !snapshot.subjectUri || !snapshot.compositionFingerprint || !isRevisionId(snapshot.revision))
      refuse('object-mapping-snapshot-unpinned', `snapshots[${index}]`, 'snapshot requires identity, canonical revision and composition fingerprint')
    if (snapshotIds.has(snapshot.bindingId))
      refuse('object-mapping-snapshot-duplicate', `snapshots[${index}]`, 'snapshot bindings must be unique')
    snapshotIds.add(snapshot.bindingId)
  }
  if (!Number.isSafeInteger(input.maxRuleMatches) || input.maxRuleMatches < 1 || input.maxRuleMatches > 2_147_483_647)
    refuse('object-mapping-budget-invalid', 'maxRuleMatches', 'expected an integer from 1 to 2147483647')
  const keyOf = (binding: UvwObjectDefinitionBinding): string => JSON.stringify([binding.packageKey, binding.ref.namespace, binding.ref.entityId])
  const catalogs = new Map<string, Set<string>>()
  for (const [alias, context] of Object.entries(input.dependencies)) {
    const entities = new Set<string>()
    for (const entity of context.entities) {
      const key = JSON.stringify([entity.namespace, entity.entityId])
      if (!entity.complete || entities.has(key)) refuse('object-mapping-catalog-incomplete', `dependencies.${alias}`, 'catalog entity is incomplete or duplicated')
      entities.add(key)
    }
    catalogs.set(alias, entities)
  }
  const bindingValid = (binding: UvwObjectDefinitionBinding | undefined, scope: 'source' | 'target', path: string): boolean => {
    if (!binding || !Object.hasOwn(input.dependencies, binding.packageKey) || input.dependencies[binding.packageKey]!.scope !== scope) {
      refuse('object-mapping-binding-scope', path, `expected a declared ${scope} catalog context`)
      return false
    }
    if (!binding.ref.namespace || !binding.ref.entityId || !catalogs.get(binding.packageKey)!.has(JSON.stringify([binding.ref.namespace, binding.ref.entityId]))) {
      refuse('object-mapping-definition-missing', path, 'definition is absent from the pinned resolved catalog')
      return false
    }
    return true
  }
  const sourceRefs = new Set<string>()
  for (const instance of input.instances) {
    if (!instance.sourceRef || sourceRefs.has(instance.sourceRef) || !instance.objectKind || !instance.typeId)
      refuse('object-mapping-instance-invalid', instance.sourceRef, 'instance alias must be unique and writer identity must be present')
    sourceRefs.add(instance.sourceRef)
    bindingValid(instance.definition, 'source', instance.sourceRef)
  }
  const ruleIds = new Set<string>()
  for (const rule of input.rules) {
    if (!rule.id || ruleIds.has(rule.id) || !Number.isSafeInteger(rule.priority) || rule.definitionBindings.length === 0)
      refuse('object-mapping-rule-invalid', rule.id, 'rule requires a unique id, integer priority and source definitions')
    ruleIds.add(rule.id)
    for (const alias of rule.definitionBindings) bindingValid(Object.hasOwn(input.bindings, alias) ? input.bindings[alias] : undefined, 'source', `${rule.id}.${alias}`)
    bindingValid(Object.hasOwn(input.bindings, rule.targetBinding) ? input.bindings[rule.targetBinding] : undefined, 'target', `${rule.id}.${rule.targetBinding}`)
    if (rule.sourceRefs !== undefined && (rule.sourceRefs.length === 0 || rule.sourceRefs.some(ref => !sourceRefs.has(ref))))
      refuse('object-mapping-source-ref-missing', rule.id, 'sourceRefs must name existing source snapshot aliases')
  }
  if (refusals.length === 0) {
    const byDefinition = new Map<string, UvwExactObjectMappingRule[]>()
    for (const rule of input.rules) {
      for (const key of new Set(rule.definitionBindings.map(alias => keyOf(input.bindings[alias]!)))) {
        const rules = byDefinition.get(key) ?? []
        rules.push(rule)
        byDefinition.set(key, rules)
      }
    }
    const writerTargets = new Map<string, UvwObjectDefinitionBinding>()
    let matches = 0
    for (const instance of [...input.instances].sort((a, b) => compareUtf8(a.sourceRef, b.sourceRef))) {
      const candidates = (byDefinition.get(keyOf(instance.definition)) ?? []).filter(rule => rule.sourceRefs === undefined || rule.sourceRefs.includes(instance.sourceRef))
      matches += candidates.length
      if (matches > input.maxRuleMatches) {
        refuse('object-mapping-budget-exceeded', instance.sourceRef, 'rule/source match budget exhausted before writing')
        break
      }
      if (candidates.length === 0) {
        refuse('object-mapping-unmatched', instance.sourceRef, 'no exact rule matches this source instance')
        continue
      }
      const priority = candidates.reduce((maximum, rule) => Math.max(maximum, rule.priority), -Infinity)
      const winners = candidates.filter(rule => rule.priority === priority)
      if (winners.length !== 1) {
        refuse('object-mapping-conflict', instance.sourceRef, `equal-priority rules: ${winners.map(rule => rule.id).sort(compareUtf8).join(', ')}`)
        continue
      }
      const winner = winners[0]!
      const target = input.bindings[winner.targetBinding]!
      const writerKey = `${instance.objectKind}:${instance.typeId}`
      const previous = writerTargets.get(writerKey)
      if (previous !== undefined && keyOf(previous) !== keyOf(target))
        refuse('object-mapping-writer-unrepresentable', instance.sourceRef, 'the type-wide writer cannot express different targets for this kind:typeId')
      writerTargets.set(writerKey, target)
      mappings.push({ sourceRef: instance.sourceRef, ruleId: winner.id, target })
    }
    const writerBindings = [...writerTargets].sort(([left], [right]) => compareUtf8(left, right)).map(([sourceWriterKey, target]) => ({ sourceWriterKey, target }))
    return deepFreeze(structuredClone({ accepted: refusals.length === 0, snapshots, mappings: refusals.length === 0 ? mappings : [], writerBindings: refusals.length === 0 ? writerBindings : [], refusals }))
  }
  // Own the result; do not freeze, retain mutable references to, or modify caller input.
  return deepFreeze(structuredClone({ accepted: false, snapshots, mappings: [], writerBindings: [], refusals }))
}
