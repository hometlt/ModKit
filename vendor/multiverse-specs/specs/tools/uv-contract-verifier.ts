/** Shared registry lookup and typed UVS verification. This admits declarations, not execution. */
import { encodeCanonicalValue } from './uv-value.mjs'
import { projectScenarioVariables } from './uv-scenario-variables.mjs'
import eventRegistry from '../runtime/events.v1.json' with { type: 'json' }
import { scenarioVersion } from './uv-scenario-version.ts'

interface Parameter { readonly type: string; readonly optional?: boolean }
export interface Intrinsic {
  readonly id: string; readonly version: number; readonly params: readonly Parameter[]
  readonly returns: string; readonly capability: string
  readonly reads?: readonly string[]; readonly writes?: readonly string[]
  readonly status?: string; readonly amendment?: string
}
interface Registry { readonly intrinsics: readonly Intrinsic[]; readonly types?: readonly unknown[] }
interface Options {
  readonly modules?: Readonly<Record<string, unknown>>
  readonly granted?: readonly string[]
}
type Refusal = Readonly<{ rule: string; message: string }>
type Verification = Readonly<{ verified: true; bound: readonly string[] }> | Readonly<{ refusal: Refusal }>

export const intrinsicKey = (row: Intrinsic): string => `${row.id}@${row.version}`
export const indexRegistry = (registry: Registry): Map<string, Intrinsic> =>
  new Map(registry.intrinsics.map(row => [intrinsicKey(row), row]))
export const opaqueValueType = (type: unknown): boolean =>
  typeof type === 'string' && /(^|[<,])value(?=[>,]|$)/u.test(type)
export const opaqueSignature = (row: Intrinsic): boolean =>
  opaqueValueType(row.returns) || (row.params?.some(param => opaqueValueType(param.type)) ?? false)
export const opaqueRefusal = (context: string): Readonly<{ refusal: Refusal }> => ({ refusal: {
  rule: 'unrepresentable-value', message: `${context}: generic value needs an explicit typed representation in this verification profile`,
} })

class ChartError extends Error {
  readonly rule: string
  constructor(rule: string, message: string) { super(message); this.rule = rule }
}
function reject(rule: string, message: string): never { throw new ChartError(rule, message) }
function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    reject('scenario-shape-invalid', `${context} must be an object`)
  return value as Record<string, unknown>
}
function array(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) reject('scenario-shape-invalid', `${context} must be an array`)
  return value
}
function text(value: unknown, context: string): string {
  if (typeof value !== 'string') reject('scenario-shape-invalid', `${context} must be a string`)
  return value
}

/** Conditions and all argument/value expressions are pure. Call sites are checked against
 * the one registry/module signature; chart variables retain their declared concrete type.
 * Logical reference literals remain source addresses, not minted kernel handles.
 */
export function verifyCharts(document: unknown, registryInput: unknown, eventsInput: unknown,
  options: Options = {}): Verification {
  try {
    const registryRecord = record(registryInput, 'intrinsic registry')
    array(registryRecord['intrinsics'], 'intrinsic registry entries')
    const registry = registryInput as Registry
    const table = indexRegistry(registry)
    const events = array(record(eventsInput, 'event registry')['events'], 'event registry entries')
    const eventById = new Map(events.map(value => {
      const event = record(value, 'event registry entry')
      return [text(event['id'], 'event id'), event] as const
    }))
    const doc = record(document, 'scenario')
    const version = scenarioVersion(doc['uv'])
    const projected = projectScenarioVariables([{ packageId: 'scenario', path: 'document', document }])
    if ('refusal' in projected) return projected
    const bound = new Set<string>()
    let discardedResult: string | undefined
    let remaining = 65_536
    const charge = (context: string, depth = 0): void => {
      if (--remaining < 0 || depth > 128)
        reject('scenario-verifier-budget', `${context}: scenario verification budget exhausted`)
    }
    const useIntrinsic = (id: string, context: string, pure: boolean): Intrinsic => {
      const row = table.get(id)
      if (!row) reject('references-resolve', `${context}: unknown intrinsic ${id}`)
      if (row.status === 'reserved') reject('intrinsic-reserved', `${id} is reserved for amendment ${row.amendment}`)
      if (opaqueSignature(row)) reject('unrepresentable-value', opaqueRefusal(id).refusal.message)
      if (pure && row.capability !== 'read')
        reject('conditions-are-pure', `${context}: expression calls ${id} of class ${row.capability}`)
      if (options.granted && !options.granted.includes(row.capability))
        reject('capability-not-granted', `${context}: ${id} needs capability ${row.capability}, not granted`)
      bound.add(id)
      return row
    }
    for (const chartValue of array(doc['charts'], 'scenario charts')) {
      charge('scenario charts')
      const chart = record(chartValue, 'chart')
      const context = `chart ${text(chart['name'], 'chart name')}`
      const stateValues = array(chart['states'], `${context} states`)
      const states = new Set(stateValues.map(value => text(record(value, context)['name'], 'state name')))
      if (states.size !== stateValues.length) reject('references-resolve', `${context}: repeated state name`)
      if (!states.has(text(chart['initialState'], `${context} initialState`)))
        reject('references-resolve', `${context}: initialState is not a declared state`)
      const prefix = `${doc['namespace']}/${chart['name']}/`
      const variables = new Map(projected.variables.filter(variable => variable.id.startsWith(prefix))
        .map(variable => [variable.id.slice(prefix.length), variable.type]))
      const types = registry.types ?? []
      let payload = new Map<string, string>()

      const literalType = (value: unknown, expected: string | undefined, where: string): string => {
        const type = expected ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'string'
          ? 'strref' : typeof value === 'number' ? 'i64' : undefined)
        if (!type || type === 'void' || opaqueValueType(type))
          reject('scenario-type-mismatch', `${where}: constant needs a concrete type`)
        // Source logical addresses are not canonical numeric runtime handles. Their binding
        // and lifecycle are a later source/composition obligation, never a successful cast.
        if (/^ref<[a-z][a-z0-9-]*>$/u.test(type) && typeof value === 'string' && value.includes('/'))
          return type
        if (typeof value === 'number') {
          if (!Number.isSafeInteger(value))
            reject('scenario-type-mismatch', `${where}: numeric constant must be exact; use a typed decimal string`)
          if (type === 'i64' || type === 'fixed64') value = String(value)
        }
        try { encodeCanonicalValue({ type, value }, types) }
        catch (error) { reject('scenario-type-mismatch', `${where}: expected ${type}: ${error instanceof Error ? error.message : String(error)}`) }
        return type
      }
      const argumentsOf = (argsValue: unknown, params: readonly Parameter[], where: string,
        depth: number): void => {
        const args = argsValue === undefined ? [] : array(argsValue, `${where} arguments`)
        const required = params.filter(param => !param.optional).length
        if (args.length < required || args.length > params.length)
          reject('scenario-call-arity', `${where}: expected ${required}..${params.length} arguments, got ${args.length}`)
        for (const [index, arg] of args.entries()) expression(arg, params[index]!.type, `${where} argument ${index}`, depth + 1)
      }
      const expression = (value: unknown, expected: string | undefined, where: string, depth = 0): string => {
        charge(where, depth)
        const expr = record(value, where)
        const args = expr['args'] === undefined ? [] : array(expr['args'], `${where} operands`)
        let type: string
        switch (expr['kind']) {
          case 'const': type = literalType(expr['value'], expected, where); break
          case 'var': {
            const name = text(expr['name'], `${where} variable`)
            const declared = variables.get(name)
            if (!declared) reject('references-resolve', `${where}: undeclared variable ${name}`)
            if (version !== '1.0') {
              // Variable syntax has a concrete chart type. Do not fabricate opaque literals.
              const reader = table.get('scenario.var@1')
              if (!reader) reject('references-resolve', `${where}: scenario reader is not registered`)
              if (reader.status === 'reserved') reject('intrinsic-reserved', `${where}: scenario reader is reserved`)
              if (reader.capability !== 'read' || reader.writes?.length)
                reject('conditions-are-pure', `${where}: scenario reader is not pure`)
              if (options.granted && !options.granted.includes(reader.capability))
                reject('capability-not-granted', `${where}: variable read needs capability read`)
              bound.add('scenario.var@1')
            }
            type = declared; break
          }
          case 'event': {
            if (version === '1.0') reject('scenario-version-unavailable', `${where}: event fields require UVS 1.1`)
            if (Object.keys(expr).some(key => key !== 'kind' && key !== 'name'))
              reject('scenario-shape-invalid', `${where}: unknown event expression field`)
            const name = text(expr['name'], `${where} event field`)
            const declared = payload.get(name)
            if (!declared) reject('references-resolve', `${where}: event has no field ${name}`)
            if (opaqueValueType(declared)) reject('unrepresentable-value', opaqueRefusal(name).refusal.message)
            type = declared; break
          }
          case 'call': {
            const id = text(expr['intrinsic'], `${where} intrinsic`)
            const row = useIntrinsic(id, where, true)
            argumentsOf(expr['args'], row.params, `${where} ${id}`, depth)
            type = row.returns; break
          }
          case 'not': case 'and': case 'or': {
            if (expr['kind'] === 'not' ? args.length !== 1 : args.length < 2)
              reject('scenario-expression-arity', `${where}: ${expr['kind']} has invalid operand count`)
            for (const arg of args) expression(arg, 'bool', where, depth + 1)
            type = 'bool'; break
          }
          case 'cmp': {
            if (args.length !== 2 || !['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(String(expr['op'])))
              reject('scenario-expression-arity', `${where}: comparison needs two operands and a valid operator`)
            const first = record(args[0], where)
            const second = record(args[1], where)
            // The typed operand supplies context to an untyped literal, regardless of side.
            const rightFirst = first['kind'] === 'const' && second['kind'] !== 'const'
            const operandType = expression(args[rightFirst ? 1 : 0], undefined, where, depth + 1)
            expression(args[rightFirst ? 0 : 1], operandType, where, depth + 1)
            const allowed = ['eq', 'ne'].includes(String(expr['op']))
              ? ['bool', 'i64', 'fixed64', 'strref'].includes(operandType) || /^ref</u.test(operandType)
              : ['i64', 'fixed64', 'strref'].includes(operandType)
            if (!allowed) reject('scenario-type-mismatch', `${where}: comparison is not defined for ${operandType}`)
            type = 'bool'; break
          }
          default: reject('scenario-shape-invalid', `${where}: unknown expression kind ${String(expr['kind'])}`)
        }
        if (expected !== undefined && type !== expected)
          reject('scenario-type-mismatch', `${where}: expected ${expected}, got ${type}`)
        return type
      }
      if (chart['initialize'] !== undefined) {
        if (version === '1.0' || version === '1.1' || version === '1.2')
          reject('scenario-version-unavailable', `${context}: initialization requires UVS 1.3`)
        const initializers = array(chart['initialize'], `${context} initialization`)
        if (initializers.length > 4096) reject('scenario-verifier-budget', `${context}: initialization call budget exceeded`)
        for (const value of initializers) {
          charge(context)
          const action = record(value, context)
          if (Object.keys(action).some(key => !['kind', 'module', 'function', 'args'].includes(key))
            || action['kind'] !== 'uvb' || !Array.isArray(action['args']) || action['args'].length)
            reject('scenario-shape-invalid', `${context}: initialization requires a zero-argument shipped UVB call`)
          const namespace = text(action['module'], `${context} initialization module`)
          const name = text(action['function'], `${context} initialization function`)
          const module = options.modules?.[namespace]
          if (!module) reject('references-resolve', `${context}: initialization names missing ${namespace}.${name}`)
          const fn = array(record(module, namespace)['functions'], `${namespace} functions`)
            .map(value => record(value, namespace)).find(fn => fn['name'] === name)
          if (!fn) reject('references-resolve', `${context}: initialization names missing ${namespace}.${name}`)
          if (array(fn['params'], `${namespace}.${name} parameters`).length
            || !['void', 'bool', 'result<bool>'].includes(text(fn['returns'], `${namespace}.${name} return type`)))
            reject('scenario-type-mismatch', `${context}: initialization needs no parameters and void/bool/result<bool>`)
        }
      }
      for (const stateValue of stateValues) {
        charge(context)
        const state = record(stateValue, context)
        for (const handlerValue of array(state['on'], `${context} handlers`)) {
          charge(context)
          const handler = record(handlerValue, context)
          const eventId = text(handler['event'], `${context} event`)
          const event = eventById.get(eventId)
          if (!event) reject('references-resolve', `${context}: unknown event ${eventId}`)
          if (event['status'] === 'reserved') reject('event-reserved', `${eventId} is reserved for amendment ${event['amendment']}`)
          if (array(event['payload'], `${eventId} payload`).some(field => opaqueValueType(record(field, eventId)['type'])))
            reject('unrepresentable-value', opaqueRefusal(eventId).refusal.message)
          payload = new Map(array(event['payload'], `${eventId} payload`).map(value => {
            const field = record(value, eventId)
            return [text(field['name'], eventId), text(field['type'], eventId)] as const
          }))
          if (handler['condition'] !== undefined) expression(handler['condition'], 'bool', `${context} condition`)
          for (const actionValue of array(handler['actions'], `${context} actions`)) {
            charge(context)
            const action = record(actionValue, context)
            if (action['kind'] === 'intrinsic') {
              const id = text(action['intrinsic'], `${context} action intrinsic`)
              const row = useIntrinsic(id, context, false)
              argumentsOf(action['args'], row.params, `${context} action ${id}`, 0)
              if (row.returns.startsWith('result<')) discardedResult ??= `${context} action ${id}`
            } else if (action['kind'] === 'set-var') {
              const name = text(action['name'], `${context} set-var`)
              const type = variables.get(name)
              if (!type) reject('references-resolve', `${context}: set-var on undeclared variable ${name}`)
              expression(action['value'], type, `${context} set-var ${name}`)
              // The concrete UVS assignment is the typed shorthand for the existing writer.
              // Its value type comes from the chart, so no opaque literal is fabricated.
              const writer = table.get('scenario.set-var@1')
              if (!writer) reject('references-resolve', `${context}: scenario writer is not registered`)
              if (writer.status === 'reserved') reject('intrinsic-reserved',
                `${context}: scenario writer is reserved for amendment ${writer.amendment}`)
              if (options.granted && !options.granted.includes(writer.capability))
                reject('capability-not-granted', `${context}: set-var needs capability ${writer.capability}, not granted`)
              bound.add('scenario.set-var@1')
            } else if (action['kind'] === 'uvb') {
              const namespace = text(action['module'], `${context} UVB module`)
              const name = text(action['function'], `${context} UVB function`)
              if (options.modules !== undefined) {
                const module = options.modules[namespace]
                if (!module) reject('references-resolve', `${context}: uvb action names missing ${namespace}.${name}`)
                const functions = array(record(module, namespace)['functions'], `${namespace} functions`)
                const fn = functions.map(value => record(value, namespace)).find(fn => fn['name'] === name)
                if (!fn) reject('references-resolve', `${context}: uvb action names missing ${namespace}.${name}`)
                const params = array(fn['params'], `${namespace}.${name} parameters`).map(type => ({ type: text(type, 'parameter type') }))
                argumentsOf(action['args'], params, `${context} uvb ${namespace}.${name}`, 0)
                if (text(fn['returns'], `${namespace}.${name} return type`).startsWith('result<'))
                  discardedResult ??= `${context} uvb ${namespace}.${name}`
              } else for (const arg of action['args'] === undefined ? [] : array(action['args'], `${context} UVB args`))
                expression(arg, undefined, context)
            } else if (action['kind'] === 'refusal') {
              const origin = record(action['origin'], `${context} refusal origin`)
              text(origin['language'], 'refusal language'); text(origin['source'], 'refusal source')
              text(action['reason'], 'refusal reason')
            } else reject('scenario-shape-invalid', `${context}: unknown action kind ${String(action['kind'])}`)
          }
          if (handler['goto'] !== undefined && !states.has(text(handler['goto'], `${context} goto`)))
            reject('references-resolve', `${context}: goto names an undeclared state`)
        }
      }
    }
    // UVS 1 has no result-consumption syntax. Verify structure/references first so an
    // unsupported action cannot hide independent declaration errors. A shipped wrapper
    // must explicitly handle the Result in verified UVB before returning a non-Result.
    if (discardedResult !== undefined) reject('results-are-handled',
      `${discardedResult}: result is discarded; use a shipped UVB wrapper with explicit error handling`)
    return { verified: true, bound: [...bound].sort() }
  } catch (error) {
    return { refusal: { rule: error instanceof ChartError ? error.rule : 'scenario-shape-invalid',
      message: error instanceof Error ? error.message : String(error) } }
  }
}

/** Actual compositor stage. The inputs are its captured JSON and decoded, verified UVB;
 * no second decoder, declaration registry or source resolver is introduced here.
 */
export function verifyScenarioComposition(
  documents: readonly Readonly<{ packageId: string; path: string; document: unknown }>[],
  decodedModules: readonly unknown[], registry: unknown, manifests: readonly unknown[],
  granted: readonly string[],
): Readonly<{ verified: true }> | Readonly<{ refusal: Refusal }> {
  if (!documents.length) return { verified: true }
  try {
    const modules: Record<string, { functions: unknown[] }> = Object.create(null)
    for (const moduleValue of decodedModules) {
      const module = record(moduleValue, 'verified UVB module')
      const namespace = text(module['namespace'], 'UVB namespace')
      const joined = modules[namespace] ?? { functions: [] }
      for (const fnValue of array(module['functions'], `${namespace} functions`)) {
        const fn = record(fnValue, `${namespace} function`)
        if (joined.functions.some(value => record(value, namespace)['name'] === fn['name']))
          reject('behavior-function-duplicate', `${namespace}/${fn['name']} is declared by multiple verified modules`)
        joined.functions.push(fnValue)
      }
      modules[namespace] = joined
    }
    const owners = new Map(manifests.map(value => {
      const manifest = record(value, 'UVP manifest')
      return [text(manifest['id'], 'UVP id'), manifest] as const
    }))
    for (const entry of documents) {
      const checked = verifyCharts(entry.document, registry, eventRegistry, { modules, granted })
      if ('refusal' in checked) reject('scenario-verification-refused',
        `${entry.packageId}/${entry.path}: ${checked.refusal.rule}: ${checked.refusal.message}`)
      const owner = owners.get(entry.packageId)
      if (!owner) reject('scenario-verification-refused', `${entry.packageId}/${entry.path}: no UVP owner`)
      const requirements = array(record(owner['requires'], entry.packageId)['intrinsics'], 'UVP intrinsic requirements')
      for (const intrinsic of checked.bound) {
        if (!requirements.includes(intrinsic)) reject('scenario-requirement-undeclared',
          `${entry.packageId}/${entry.path} requires ${intrinsic} outside its UVP manifest`)
      }
    }
    return { verified: true }
  } catch (error) {
    return { refusal: { rule: error instanceof ChartError ? error.rule : 'scenario-shape-invalid',
      message: error instanceof Error ? error.message : String(error) } }
  }
}
