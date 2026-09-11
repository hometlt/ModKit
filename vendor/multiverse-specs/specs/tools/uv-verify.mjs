/**
 * Reference verifier for UVB modules and UVS charts against the intrinsic and event registries.
 *
 * This is the executable form of the verifier half of `../conformance/uvs-uvb/vectors.json`
 * (SPEC_UVB §3, SPEC_UVS §2). The kernel half (firing order, budgets at runtime, save/restore)
 * stays declared until a kernel exists. Dependency-free and replaceable, like every tool here.
 *
 * Every failure is a typed refusal `{ rule, message }`; the first refusal stops verification.
 */

const intrinsicKey = row => `${row.id}@${row.version}`

const indexRegistry = registry => {
  const byKey = new Map()
  for (const row of registry.intrinsics) byKey.set(intrinsicKey(row), row)
  return byKey
}

const resultType = returns => typeof returns === 'string' && returns.startsWith('result<')

// --- UVB ---------------------------------------------------------------------------------------

/**
 * Verify one structural UVB module.
 *   registry: runtime/intrinsics.v1.json
 *   options.granted: capability classes the composition granted (undefined = do not check)
 */
export function verifyModule(module, registry, options = {}) {
  const table = indexRegistry(registry)
  const bound = []
  for (const requirement of module.requires.intrinsics) {
    const row = table.get(requirement)
    if (row === undefined) {
      return { refusal: { rule: 'references-resolve', message: `module ${module.namespace} requires unknown intrinsic ${requirement}` } }
    }
    if (row.status === 'reserved') {
      return { refusal: { rule: 'intrinsic-reserved', message: `${requirement} is reserved for amendment ${row.amendment}; binding it refuses until the amendment lands` } }
    }
    if (options.granted !== undefined && !options.granted.includes(row.capability)) {
      return { refusal: { rule: 'capability-not-granted', message: `${requirement} needs capability ${row.capability}, not granted` } }
    }
    bound.push(row)
  }
  const functionNames = new Set(module.functions.map(fn => fn.name))
  for (const fn of module.functions) {
    const reads = new Set(fn.effects.reads)
    const writes = new Set(fn.effects.writes)
    const produced = new Map() // register -> instruction index of a result<T> producer
    fn.body.forEach((instruction, index) => {
      if (instruction.op === 'call' && !functionNames.has(instruction.function)) {
        throw { refusal: { rule: 'references-resolve', message: `${fn.name}: call to unknown function ${instruction.function}` } }
      }
      if (instruction.op === 'call.intrinsic') {
        const row = bound[instruction.intrinsicIndex]
        if (row === undefined) {
          throw { refusal: { rule: 'references-resolve', message: `${fn.name}[${index}]: intrinsicIndex ${instruction.intrinsicIndex} outside requires` } }
        }
        for (const area of row.reads ?? []) {
          if (!reads.has(area) && !writes.has(area)) {
            throw { refusal: { rule: 'effects-within-declaration', message: `${fn.name} calls ${intrinsicKey(row)} which reads ${area}, not declared` } }
          }
        }
        for (const area of row.writes ?? []) {
          if (!writes.has(area)) {
            throw { refusal: { rule: 'effects-within-declaration', message: `${fn.name} calls ${intrinsicKey(row)} which writes ${area}, not declared` } }
          }
        }
        if (resultType(row.returns)) {
          if (instruction.dst === undefined) {
            throw { refusal: { rule: 'results-are-handled', message: `${fn.name}[${index}]: result of ${intrinsicKey(row)} is discarded` } }
          }
          produced.set(instruction.dst, index)
        }
      }
      // any later read of a produced register counts as handling it
      const consumed = [instruction.a, instruction.b, ...(instruction.args ?? [])].filter(v => v !== undefined)
      for (const register of consumed) {
        if (produced.has(register) && produced.get(register) < index) produced.delete(register)
      }
    })
    if (produced.size > 0) {
      const [register, at] = [...produced.entries()][0]
      return { refusal: { rule: 'results-are-handled', message: `${fn.name}[${at}]: result in r${register} is never read` } }
    }
  }
  return { verified: true, bound: bound.map(intrinsicKey) }
}

// --- UVS ---------------------------------------------------------------------------------------

const walkExpr = (expr, visit) => {
  visit(expr)
  for (const arg of expr.args ?? []) walkExpr(arg, visit)
}

/**
 * Verify one UVS document.
 *   registry: runtime/intrinsics.v1.json; events: runtime/events.v1.json
 *   options.modules: map namespace -> structural UVB module, for `uvb` actions (undefined = skip)
 */
export function verifyCharts(document, registry, events, options = {}) {
  const table = indexRegistry(registry)
  const eventById = new Map(events.events.map(e => [e.id, e]))
  for (const chart of document.charts) {
    const states = new Set(chart.states.map(s => s.name))
    if (!states.has(chart.initialState)) {
      return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: initialState ${chart.initialState} is not a state` } }
    }
    const variables = new Set((chart.variables ?? []).map(v => v.name))
    for (const state of chart.states) {
      for (const handler of state.on) {
        const event = eventById.get(handler.event)
        if (event === undefined) {
          return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: unknown event ${handler.event}` } }
        }
        if (event.status === 'reserved') {
          return { refusal: { rule: 'event-reserved', message: `${handler.event} is reserved for amendment ${event.amendment}` } }
        }
        if (handler.condition !== undefined) {
          let impure
          walkExpr(handler.condition, expr => {
            if (expr.kind === 'call') {
              const row = table.get(expr.intrinsic)
              if (row === undefined) impure ??= { rule: 'references-resolve', message: `chart ${chart.name}: condition calls unknown ${expr.intrinsic}` }
              else if (row.capability !== 'read') impure ??= { rule: 'conditions-are-pure', message: `chart ${chart.name}: condition calls ${expr.intrinsic} of class ${row.capability}` }
            }
            if (expr.kind === 'var' && !variables.has(expr.name)) {
              impure ??= { rule: 'references-resolve', message: `chart ${chart.name}: condition reads undeclared variable ${expr.name}` }
            }
          })
          if (impure !== undefined) return { refusal: impure }
        }
        for (const action of handler.actions) {
          if (action.kind === 'intrinsic') {
            const row = table.get(action.intrinsic)
            if (row === undefined) return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: action calls unknown ${action.intrinsic}` } }
            if (row.status === 'reserved') return { refusal: { rule: 'intrinsic-reserved', message: `${action.intrinsic} is reserved for amendment ${row.amendment}` } }
          } else if (action.kind === 'set-var' && !variables.has(action.name)) {
            return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: set-var on undeclared ${action.name}` } }
          } else if (action.kind === 'uvb' && options.modules !== undefined) {
            const module = options.modules[action.module]
            if (module === undefined || !module.functions.some(fn => fn.name === action.function)) {
              return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: uvb action names missing ${action.module}.${action.function}` } }
            }
          }
        }
        if (handler.goto !== undefined && !states.has(handler.goto)) {
          return { refusal: { rule: 'references-resolve', message: `chart ${chart.name}: goto ${handler.goto} is not a state` } }
        }
      }
    }
  }
  return { verified: true }
}
