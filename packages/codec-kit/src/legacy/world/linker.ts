import { compareCanonicalKeys } from './canonical.js'
import {
  WorldScheduleError,
  type LinkedWorldSchedule,
  type SystemDeclaration,
  type WorldCompositionLock,
  type WorldPhase,
  type WorldScheduleDiagnostic,
  type WorldTickContext,
} from './contracts.js'

const PHASE_ORDER: Readonly<Record<WorldPhase, number>> = Object.freeze({
  input: 0,
  ai: 1,
  script: 2,
  simulation: 3,
  output: 4,
})

const sortedUnique = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)].sort(compareCanonicalKeys))

function validateDeclaration<Context extends WorldTickContext>(
  declaration: SystemDeclaration<Context>,
): WorldScheduleDiagnostic[] {
  const diagnostics: WorldScheduleDiagnostic[] = []
  if (typeof declaration.id !== 'string' || declaration.id.trim() === '') {
    diagnostics.push({
      severity: 'error',
      code: 'multiverse.world/invalid-declaration',
      message: 'System id must be a non-blank string.',
    })
  }
  if (!(declaration.phase in PHASE_ORDER)) {
    diagnostics.push({
      severity: 'error',
      code: 'multiverse.world/invalid-declaration',
      message: `System ${String(declaration.id)} has an unknown phase.`,
      systemIds: [String(declaration.id)],
    })
  }
  if (
    !Number.isSafeInteger(declaration.cadence.everyTicks) ||
    declaration.cadence.everyTicks <= 0 ||
    (declaration.cadence.offsetTicks !== undefined &&
      (!Number.isSafeInteger(declaration.cadence.offsetTicks) ||
        declaration.cadence.offsetTicks < 0 ||
        declaration.cadence.offsetTicks >= declaration.cadence.everyTicks))
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'multiverse.world/invalid-declaration',
      message: `System ${declaration.id} has an invalid cadence.`,
      systemIds: [declaration.id],
    })
  }
  for (const [name, values] of [
    ['reads', declaration.reads],
    ['writes', declaration.writes],
    ['after', declaration.after ?? []],
    ['before', declaration.before ?? []],
  ] as const) {
    if (values.some(value => typeof value !== 'string' || value.trim() === '')) {
      diagnostics.push({
        severity: 'error',
        code: 'multiverse.world/invalid-declaration',
        message: `System ${declaration.id} has a blank ${name} entry.`,
        systemIds: [declaration.id],
      })
    }
    if (new Set(values).size !== values.length) {
      diagnostics.push({
        severity: 'error',
        code: 'multiverse.world/invalid-declaration',
        message: `System ${declaration.id} has duplicate ${name} entries.`,
        systemIds: [declaration.id],
      })
    }
  }
  if (
    declaration.exclusive !== undefined &&
    (declaration.exclusive.slotId.trim() === '' || declaration.exclusive.providerId.trim() === '')
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'multiverse.world/invalid-declaration',
      message: `System ${declaration.id} has an invalid exclusive provider coordinate.`,
      systemIds: [declaration.id],
    })
  }
  return diagnostics
}

function selectExclusiveProviders<Context extends WorldTickContext>(
  declarations: readonly SystemDeclaration<Context>[],
  composition: WorldCompositionLock,
): readonly SystemDeclaration<Context>[] {
  const diagnostics: WorldScheduleDiagnostic[] = []
  const bySlot = new Map<string, SystemDeclaration<Context>[]>()
  for (const declaration of declarations) {
    if (!declaration.exclusive) continue
    const candidates = bySlot.get(declaration.exclusive.slotId) ?? []
    candidates.push(declaration)
    bySlot.set(declaration.exclusive.slotId, candidates)
  }

  for (const slotId of Object.keys(composition.exclusiveSlots)) {
    if (!bySlot.has(slotId)) {
      diagnostics.push({
        severity: 'error',
        code: 'multiverse.world/unknown-exclusive-selection',
        message: `Composition selects unknown exclusive slot ${slotId}.`,
        slotId,
      })
    }
  }

  const selected = declarations.filter(declaration => {
    if (!declaration.exclusive) return true
    const { slotId, providerId } = declaration.exclusive
    const requested = composition.exclusiveSlots[slotId]
    if (requested === undefined) {
      if (!diagnostics.some(diagnostic => diagnostic.slotId === slotId)) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/missing-exclusive-selection',
          message: `Composition does not select a provider for exclusive slot ${slotId}.`,
          slotId,
        })
      }
      return false
    }
    return requested === providerId
  })

  for (const [slotId, candidates] of bySlot) {
    const requested = composition.exclusiveSlots[slotId]
    if (requested === undefined) continue
    const winners = candidates.filter(candidate => candidate.exclusive?.providerId === requested)
    if (winners.length !== 1) {
      diagnostics.push({
        severity: 'error',
        code: 'multiverse.world/multiple-exclusive-providers',
        message:
          winners.length === 0
            ? `Selected provider ${requested} is not registered for exclusive slot ${slotId}.`
            : `Provider ${requested} is registered more than once for exclusive slot ${slotId}.`,
        slotId,
        systemIds: winners.map(winner => winner.id),
      })
    }
  }
  if (diagnostics.length > 0) throw new WorldScheduleError(diagnostics)
  return selected
}

function hasAccessConflict<Context extends WorldTickContext>(
  left: SystemDeclaration<Context>,
  right: SystemDeclaration<Context>,
): string | undefined {
  const leftWrites = new Set(left.writes)
  const rightWrites = new Set(right.writes)
  return sortedUnique([...left.reads, ...left.writes, ...right.reads, ...right.writes]).find(
    key =>
      (leftWrites.has(key) && (rightWrites.has(key) || right.reads.includes(key))) ||
      (rightWrites.has(key) && left.reads.includes(key)),
  )
}

export function linkWorldSchedule<Context extends WorldTickContext>(
  authoredDeclarations: readonly SystemDeclaration<Context>[],
  composition: WorldCompositionLock = { exclusiveSlots: {} },
): LinkedWorldSchedule<Context> {
  const diagnostics = authoredDeclarations.flatMap(validateDeclaration)
  if (diagnostics.length > 0) throw new WorldScheduleError(diagnostics)

  const declarations = selectExclusiveProviders(authoredDeclarations, composition)
  const byId = new Map<string, SystemDeclaration<Context>>()
  for (const declaration of declarations) {
    if (byId.has(declaration.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'multiverse.world/duplicate-system',
        message: `System ${declaration.id} is declared more than once.`,
        systemIds: [declaration.id],
      })
    } else {
      byId.set(declaration.id, declaration)
    }
  }
  if (diagnostics.length > 0) throw new WorldScheduleError(diagnostics)

  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  for (const id of byId.keys()) {
    outgoing.set(id, new Set())
    incoming.set(id, new Set())
  }
  const addEdge = (from: string, to: string): void => {
    if (from === to) return
    outgoing.get(from)?.add(to)
    incoming.get(to)?.add(from)
  }

  const ids = [...byId.keys()]
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
      const left = byId.get(ids[leftIndex]!)!
      const right = byId.get(ids[rightIndex]!)!
      const leftPhase = PHASE_ORDER[left.phase]
      const rightPhase = PHASE_ORDER[right.phase]
      if (leftPhase < rightPhase) addEdge(left.id, right.id)
      if (rightPhase < leftPhase) addEdge(right.id, left.id)
    }
  }

  for (const declaration of declarations) {
    for (const dependency of declaration.after ?? []) {
      const target = byId.get(dependency)
      if (!target) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/missing-dependency',
          message: `System ${declaration.id} depends on missing system ${dependency}.`,
          systemIds: [declaration.id, dependency],
        })
        continue
      }
      if (PHASE_ORDER[target.phase] > PHASE_ORDER[declaration.phase]) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/backward-phase-edge',
          message: `System ${declaration.id} cannot run after later-phase system ${dependency}.`,
          systemIds: [declaration.id, dependency],
        })
        continue
      }
      addEdge(dependency, declaration.id)
    }
    for (const dependency of declaration.before ?? []) {
      const target = byId.get(dependency)
      if (!target) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/missing-dependency',
          message: `System ${declaration.id} precedes missing system ${dependency}.`,
          systemIds: [declaration.id, dependency],
        })
        continue
      }
      if (PHASE_ORDER[declaration.phase] > PHASE_ORDER[target.phase]) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/backward-phase-edge',
          message: `System ${declaration.id} cannot run before earlier-phase system ${dependency}.`,
          systemIds: [declaration.id, dependency],
        })
        continue
      }
      addEdge(declaration.id, dependency)
    }
  }
  if (diagnostics.length > 0) throw new WorldScheduleError(diagnostics)

  const reaches = (from: string, to: string): boolean => {
    const visited = new Set<string>()
    const pending = [...(outgoing.get(from) ?? [])]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (current === to) return true
      if (visited.has(current)) continue
      visited.add(current)
      pending.push(...(outgoing.get(current) ?? []))
    }
    return false
  }

  for (let leftIndex = 0; leftIndex < declarations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < declarations.length; rightIndex += 1) {
      const left = declarations[leftIndex]!
      const right = declarations[rightIndex]!
      const conflict = hasAccessConflict(left, right)
      if (conflict && !reaches(left.id, right.id) && !reaches(right.id, left.id)) {
        diagnostics.push({
          severity: 'error',
          code: 'multiverse.world/unordered-access-conflict',
          message: `Systems ${left.id} and ${right.id} conflict on ${conflict} without an ordering edge.`,
          systemIds: [left.id, right.id].sort(compareCanonicalKeys),
          accessKey: conflict,
        })
      }
    }
  }
  if (diagnostics.length > 0) throw new WorldScheduleError(diagnostics)

  const indegree = new Map([...incoming].map(([id, sources]) => [id, sources.size]))
  const ready = [...byId.keys()].filter(id => indegree.get(id) === 0).sort(compareCanonicalKeys)
  const linked: SystemDeclaration<Context>[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    linked.push(byId.get(id)!)
    for (const target of [...(outgoing.get(id) ?? [])].sort(compareCanonicalKeys)) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) {
        ready.push(target)
        ready.sort(compareCanonicalKeys)
      }
    }
  }
  if (linked.length !== declarations.length) {
    const cycleIds = [...byId.keys()].filter(id => (indegree.get(id) ?? 0) > 0)
    throw new WorldScheduleError([
      {
        severity: 'error',
        code: 'multiverse.world/dependency-cycle',
        message: `World schedule contains a dependency cycle: ${cycleIds.sort(compareCanonicalKeys).join(', ')}.`,
        systemIds: cycleIds.sort(compareCanonicalKeys),
      },
    ])
  }

  return Object.freeze({
    systems: Object.freeze(
      linked.map((declaration, order) => Object.freeze({ declaration, order })),
    ),
    composition: Object.freeze({
      exclusiveSlots: Object.freeze({ ...composition.exclusiveSlots }),
    }),
  })
}

export function executeLinkedWorldSchedule<Context extends WorldTickContext>(
  schedule: LinkedWorldSchedule<Context>,
  context: Context,
  onExecuted?: (systemId: string) => void,
): readonly string[] {
  const executed: string[] = []
  for (const system of schedule.systems) {
    const offset = system.declaration.cadence.offsetTicks ?? 0
    if ((context.tick - offset) % system.declaration.cadence.everyTicks !== 0) continue
    system.declaration.run(context)
    executed.push(system.declaration.id)
    onExecuted?.(system.declaration.id)
  }
  return Object.freeze(executed)
}

export function linkedScheduleFingerprintInput<Context extends WorldTickContext>(
  schedule: LinkedWorldSchedule<Context>,
): readonly object[] {
  return Object.freeze(
    schedule.systems.map(({ declaration, order }) =>
      Object.freeze({
        order,
        id: declaration.id,
        phase: declaration.phase,
        cadence: Object.freeze({ ...declaration.cadence }),
        reads: sortedUnique(declaration.reads),
        writes: sortedUnique(declaration.writes),
        after: sortedUnique(declaration.after ?? []),
        before: sortedUnique(declaration.before ?? []),
        ...(declaration.exclusive
          ? { exclusive: Object.freeze({ ...declaration.exclusive }) }
          : {}),
      }),
    ),
  )
}

