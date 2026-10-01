/**
 * Reference verifier for UVB modules and UVS charts against the intrinsic and event registries.
 *
 * This is the executable form of the verifier half of `../conformance/uvs-uvb/vectors.json`
 * (SPEC_UVB §3, SPEC_UVS §2). The kernel half (firing order, budgets at runtime, save/restore)
 * stays declared until a kernel exists. Dependency-free and replaceable, like every tool here.
 *
 * Every failure is a typed refusal `{ rule, message }`; the first refusal stops verification.
 */

import { classifyUvbConstant } from './uvb-constant.mjs'

const intrinsicKey = row => `${row.id}@${row.version}`

const indexRegistry = registry => {
  const byKey = new Map()
  for (const row of registry.intrinsics) byKey.set(intrinsicKey(row), row)
  return byKey
}

const resultType = returns => typeof returns === 'string' && returns.startsWith('result<')
const opaqueValueType = type => typeof type === 'string' && /(^|[<,])value(?=[>,]|$)/.test(type)
const opaqueSignature = row => opaqueValueType(row.returns) || row.params?.some(param => opaqueValueType(param.type))
const opaqueRefusal = context => ({ refusal: {
  rule: 'unrepresentable-value',
  message: `${context}: generic value has no UVB 1.1 register or canonical binary representation; a typed amendment is required`,
} })

const successors = (instruction, index) => {
  if (instruction.op === 'ret') return []
  if (instruction.op === 'br') return [instruction.target]
  if (instruction.op === 'br_if' || instruction.op === 'result.unwrap-or-branch'
    || instruction.op === 'option.unwrap-or-branch')
    return [index + 1, instruction.target]
  return [index + 1]
}

/** A backward edge starts a new iteration only at a budgeted loop header. The loop target
 * names its forward exit boundary; the instruction itself falls through after charging fuel.
 */
function verifyLoopStructure(fn) {
  for (const [index, instruction] of fn.body.entries()) {
    if (instruction.op === 'loop') {
      if (instruction.budget?.onExhausted !== 'typed-error')
        return { rule: 'loops-carry-budget', message: `${fn.name}[${index}]: loop needs a typed-error budget check` }
      if (!Number.isInteger(instruction.target) || instruction.target <= index + 1
        || instruction.target >= fn.body.length)
        return { rule: 'branch-target', message: `${fn.name}[${index}]: loop needs a forward exit target` }
    }
    if ((instruction.op === 'br' || instruction.op === 'br_if'
      || instruction.op === 'result.unwrap-or-branch'
      || instruction.op === 'option.unwrap-or-branch') && instruction.target <= index) {
      const header = fn.body[instruction.target]
      if (header?.op !== 'loop' || header.target <= index)
        return { rule: 'loops-carry-budget',
          message: `${fn.name}[${index}]: backward branch must target an enclosing budgeted loop` }
    }
  }
  return undefined
}

/** Definite assignment over the function CFG; a loop back-edge intersects incoming paths. */
function verifyInitializedRegisters(fn) {
  const body = fn.body
  if (fn.params.length > fn.registers)
    return { rule: 'register-out-of-range', message: `${fn.name}: params exceed register budget` }
  const inputs = Array(body.length).fill(undefined)
  inputs[0] = new Set(fn.params.map((_, index) => index))
  const pending = [0]
  while (pending.length > 0) {
    const index = pending.pop()
    const instruction = body[index]
    const state = inputs[index]
    const next = new Set(state)
    if (instruction.dst !== undefined) next.add(instruction.dst)
    for (const [edge, target] of successors(instruction, index).entries()) {
      if (!Number.isInteger(target) || target < 0 || target >= body.length)
        return { rule: 'branch-target', message: `${fn.name}[${index}]: target ${target} is outside the function` }
      // Unwrap writes dst only on the success edge, even when both edges meet immediately.
      const outgoing = (instruction.op === 'result.unwrap-or-branch'
        || instruction.op === 'option.unwrap-or-branch') && edge === 1
        ? state : next
      const old = inputs[target]
      const merged = old === undefined ? outgoing : new Set([...old].filter(register => outgoing.has(register)))
      if (old === undefined || merged.size !== old.size) {
        inputs[target] = merged
        pending.push(target)
      }
    }
  }
  for (const [index, instruction] of body.entries()) {
    const state = inputs[index]
    if (state === undefined) continue
    for (const register of [instruction.a, instruction.b, ...(instruction.args ?? []), instruction.dst]) {
      if (register !== undefined && (!Number.isInteger(register) || register < 0 || register >= fn.registers))
        return { rule: 'register-out-of-range', message: `${fn.name}[${index}]: r${register} exceeds ${fn.registers} registers` }
    }
    for (const register of [instruction.a, instruction.b, ...(instruction.args ?? [])]) {
      if (register !== undefined && !state.has(register))
        return { rule: 'register-uninitialized', message: `${fn.name}[${index}]: r${register} is uninitialized on a reachable path` }
    }
  }
  return undefined
}

/** Every reachable result must be explicitly returned or unwrapped before it is overwritten. */
function verifyResultObligations(fn, bound, functions) {
  const body = fn.body
  const inputs = Array(body.length).fill(undefined)
  inputs[0] = new Map()
  const pending = [0]
  const refused = (index, message) => ({ rule: 'results-are-handled', message: `${fn.name}[${index}]: ${message}` })
  while (pending.length > 0) {
    const index = pending.pop()
    const instruction = body[index]
    const state = new Map([...inputs[index]].map(([register, origins]) => [register, new Set(origins)]))
    const errorBranchState = instruction.op === 'result.unwrap-or-branch'
      || instruction.op === 'option.unwrap-or-branch'
      ? new Map([...state].map(([register, origins]) => [register, new Set(origins)])) : undefined
    const reads = [instruction.a, instruction.b, ...(instruction.args ?? [])].filter(value => value !== undefined)
    for (const register of reads) {
      if (!state.has(register)) continue
      if (register === instruction.a && (instruction.op === 'ret'
        || instruction.op === 'result.unwrap-or-branch'
        || instruction.op === 'option.unwrap-or-branch'
        || instruction.op === 'result.value-or-false'
        || instruction.op === 'result.value-or')) {
        state.delete(register)
      } else if (register === instruction.a && instruction.op === 'move') {
        // Move transfers the obligation; a copy cannot silently discard an error.
        if (instruction.dst !== register) state.delete(register)
      } else return refused(index, `result in r${register} is used without handling`)
    }
    if (instruction.dst !== undefined && state.has(instruction.dst)
      && !(instruction.op === 'move' && instruction.dst === instruction.a))
      return refused(index, `result in r${instruction.dst} is overwritten before handling`)
    if (instruction.op === 'move' && instruction.dst !== undefined && inputs[index].has(instruction.a))
      state.set(instruction.dst, new Set(inputs[index].get(instruction.a)))
    const returns = instruction.op === 'call.intrinsic' ? bound[instruction.intrinsicIndex]?.returns
      : instruction.op === 'call' ? functions.get(instruction.function)?.returns : undefined
    if (resultType(returns) || instruction.op === 'result.ok' || instruction.op === 'result.err'
      || instruction.op === 'value.unbox') {
      if (instruction.dst === undefined) return refused(index, 'result is discarded')
      state.set(instruction.dst, new Set([index]))
    }
    if (instruction.op === 'ret') {
      if (state.size > 0) return refused(index, `result in r${state.keys().next().value} is not handled on this path`)
      continue
    }
    for (const [edge, target] of successors(instruction, index).entries()) {
      const outgoing = errorBranchState !== undefined && edge === 1 ? errorBranchState : state
      const prior = inputs[target]
      if (prior === undefined) {
        inputs[target] = outgoing
        pending.push(target)
        continue
      }
      let changed = false
      for (const [register, origins] of outgoing) {
        const known = prior.get(register)
        if (known === undefined) { prior.set(register, new Set(origins)); changed = true }
        else for (const origin of origins) if (!known.has(origin)) { known.add(origin); changed = true }
      }
      if (changed) pending.push(target)
    }
  }
  return undefined
}

/** Path-sensitive register types for the specified UVB 1.1 core. Instructions with no admitted
 * operand rule refuse instead of inheriting whatever types happen to occupy their registers.
 */
function verifyTypedRegisters(fn, bound, functions, major) {
  const body = fn.body
  const inputs = Array(body.length).fill(undefined)
  inputs[0] = new Map(fn.params.map((type, register) => [register, type]))
  const pending = [0]
  const refusal = (index, message) => ({ rule: 'register-type-mismatch', message: `${fn.name}[${index}]: ${message}` })
  while (pending.length > 0) {
    const index = pending.pop()
    const instruction = body[index]
    const state = new Map(inputs[index])
    const before = new Map(state)
    const typeAt = register => state.get(register)
    const expect = (register, type) => register !== undefined && typeAt(register) === type
    const dst = type => {
      if (instruction.dst === undefined) return refusal(index, `${instruction.op} needs a destination`)
      state.set(instruction.dst, type)
      return undefined
    }
    let error
    let errorBranchState
    switch (instruction.op) {
      case 'const':
        if (!['i64', 'fixed64', 'bool', 'strref'].includes(instruction.type)) {
          error = { rule: 'type-rule-unavailable',
            message: `${fn.name}[${index}]: const ${instruction.type} has no UVB 1.1 binary representation` }
          break
        }
        try { classifyUvbConstant(instruction.value, instruction.type) }
        catch (cause) {
          error = { rule: 'constant-not-encodable', message: `${fn.name}[${index}]: ${cause.message}` }
          break
        }
        error = dst(instruction.type)
        break
      case 'move':
        error = instruction.a === undefined ? refusal(index, 'move needs a source') : dst(typeAt(instruction.a))
        if (error === undefined && instruction.a !== instruction.dst && resultType(typeAt(instruction.a)))
          state.delete(instruction.a)
        break
      case 'value.box':
        if (major !== 2 || instruction.type === undefined || opaqueValueType(instruction.type)
          || resultType(instruction.type) || !expect(instruction.a, instruction.type))
          error = refusal(index, 'box needs a concrete matching source type in UVB 2')
        else error = dst('value')
        break
      case 'value.unbox':
        if (major !== 2 || instruction.type === undefined || opaqueValueType(instruction.type)
          || resultType(instruction.type) || !expect(instruction.a, 'value'))
          error = refusal(index, 'unbox needs value and a concrete target type in UVB 2')
        else error = dst(`result<${instruction.type}>`)
        break
      case 'value.expect':
        if (major !== 2 || !['bool', 'i64', 'fixed64', 'strref'].includes(instruction.type)
          || !expect(instruction.a, 'value'))
          error = refusal(index, 'expect needs value and an admitted scalar target type in UVB 2')
        else error = dst(instruction.type)
        break
      case 'fixed.parse-decimal':
        error = major === 2 && expect(instruction.a, 'strref')
          ? dst('fixed64') : refusal(index, 'fixed.parse-decimal needs strref in UVB 2')
        break
      case 'pos.make':
        error = major === 2 && instruction.type === 'Pos'
          && instruction.args?.length === 4
          && ['strref', 'fixed64', 'fixed64', 'fixed64']
            .every((type, at) => expect(instruction.args[at], type))
          ? dst('Pos') : refusal(index, 'pos.make needs space and three fixed64 coordinates in UVB 2')
        break
      case 'result.value-or': {
        const fallback = typeAt(instruction.b)
        if (major !== 2 || !['bool', 'i64', 'fixed64', 'strref'].includes(fallback)
          || !expect(instruction.a, `result<${fallback}>`))
          error = refusal(index, 'value-or needs a matching scalar result and fallback in UVB 2')
        else {
          state.delete(instruction.a)
          error = dst(fallback)
        }
        break
      }
      case 'call':
      case 'call.intrinsic': {
        const target = instruction.op === 'call' ? functions.get(instruction.function)
          : bound[instruction.intrinsicIndex]
        const params = instruction.op === 'call' ? target.params : target.params.map(param => param.type)
        const firstOptional = instruction.op === 'call' ? -1
          : target.params.findIndex(param => param.optional === true)
        if (firstOptional >= 0 && target.params.slice(firstOptional).some(param => param.optional !== true)) {
          error = refusal(index, `${instruction.op} has a non-trailing optional parameter`)
          break
        }
        const minimum = firstOptional < 0 ? params.length : firstOptional
        const arity = (instruction.args ?? []).length
        if (arity < minimum || arity > params.length) {
          error = refusal(index, `${instruction.op} expects ${minimum}–${params.length} arguments`)
          break
        }
        for (let arg = 0; arg < arity; arg += 1) {
          if (!expect(instruction.args[arg], params[arg])) {
            error = refusal(index, `${instruction.op} argument ${arg} expects ${params[arg]}, got ${typeAt(instruction.args[arg])}`)
            break
          }
        }
        if (error !== undefined) break
        if (target.returns === 'void') {
          if (instruction.dst !== undefined) error = refusal(index, 'void call cannot write a destination')
        } else error = dst(target.returns)
        break
      }
      case 'ret':
        if (fn.returns === 'void' ? instruction.a !== undefined : !expect(instruction.a, fn.returns))
          error = refusal(index, `return expects ${fn.returns}, got ${typeAt(instruction.a)}`)
        break
      case 'br_if':
        if (!expect(instruction.a, 'bool')) error = refusal(index, 'branch condition must be bool')
        break
      case 'br':
        break
      case 'loop':
        if (instruction.budget?.onExhausted !== 'typed-error')
          error = { rule: 'loops-carry-budget',
            message: `${fn.name}[${index}]: loop needs a typed-error budget check` }
        break
      case 'add.i64': case 'sub.i64': case 'mul.i64': case 'div.i64':
      case 'add.fx': case 'sub.fx': case 'mul.fx': case 'div.fx': {
        const type = instruction.op.endsWith('.fx') ? 'fixed64' : 'i64'
        error = expect(instruction.a, type) && expect(instruction.b, type) ? dst(type)
          : refusal(index, `${instruction.op} needs two ${type} operands`)
        break
      }
      case 'and': case 'or':
        error = expect(instruction.a, 'bool') && expect(instruction.b, 'bool') ? dst('bool')
          : refusal(index, `${instruction.op} needs two bool operands`)
        break
      case 'not':
        error = expect(instruction.a, 'bool') ? dst('bool') : refusal(index, 'not needs a bool operand')
        break
      case 'eq': {
        const type = typeAt(instruction.a)
        if (type === undefined || type !== typeAt(instruction.b))
          error = refusal(index, 'eq operands must have the same type')
        else if (!['bool', 'i64', 'fixed64', 'strref'].includes(type)
          && !/^ref<[a-z][a-z0-9-]*>$/.test(type)) {
          error = { rule: 'type-rule-unavailable',
            message: `${fn.name}[${index}]: equality for ${type} has no admitted rule` }
        } else error = dst('bool')
        break
      }
      case 'lt': case 'le': {
        const type = typeAt(instruction.a)
        error = (type === 'i64' || type === 'fixed64') && expect(instruction.b, type)
          ? dst('bool') : refusal(index, `${instruction.op} needs matching numeric operands`)
        break
      }
      case 'list.len': {
        const type = typeAt(instruction.a)
        error = typeof type === 'string' && type.startsWith('list<') ? dst('i64')
          : refusal(index, 'list.len needs a list operand')
        break
      }
      case 'list.get': {
        const type = typeAt(instruction.a)
        error = typeof type === 'string' && type.startsWith('list<') && expect(instruction.b, 'i64')
          ? dst(type.slice(5, -1)) : refusal(index, 'list.get needs a list and i64 index')
        break
      }
      case 'list.empty':
        error = major === 2 && instruction.type === 'ref<entity>'
          ? dst('list<ref<entity>>') : refusal(index, 'list.empty needs ref<entity> in UVB 2')
        break
      case 'list.append':
        error = major === 2 && expect(instruction.a, 'list<ref<entity>>')
          && expect(instruction.b, 'ref<entity>')
          ? dst('list<ref<entity>>') : refusal(index, 'list.append needs entity list and reference in UVB 2')
        break
      case 'result.ok':
        error = typeAt(instruction.a) === undefined ? refusal(index, 'result.ok needs a value')
          : dst(`result<${typeAt(instruction.a)}>`)
        break
      case 'result.value-or-false':
        if (major !== 2 || !expect(instruction.a, 'result<bool>'))
          error = refusal(index, 'value-or-false needs result<bool> in UVB 2')
        else {
          state.delete(instruction.a)
          error = dst('bool')
        }
        break
      case 'result.unwrap-or-branch': {
        const type = typeAt(instruction.a)
        if (typeof type !== 'string' || !/^result<.+>$/.test(type)) {
          error = refusal(index, 'unwrap needs a result operand')
          break
        }
        errorBranchState = new Map(before)
        state.delete(instruction.a)
        error = dst(type.slice(7, -1))
        break
      }
      case 'option.unwrap-or-branch': {
        const type = typeAt(instruction.a)
        if (major !== 2 || typeof type !== 'string' || !/^ref<[a-z][a-z0-9-]*>\?$/.test(type)) {
          error = refusal(index, 'option unwrap needs a nullable reference in UVB 2')
          break
        }
        errorBranchState = new Map(before)
        state.delete(instruction.a)
        error = dst(type.slice(0, -1))
        break
      }
      default:
        return { rule: 'type-rule-unavailable',
          message: `${fn.name}[${index}]: ${instruction.op} has no admitted UVB 1.1 operand type rule` }
    }
    if (error !== undefined) return error
    for (const [edge, target] of successors(instruction, index).entries()) {
      const next = errorBranchState !== undefined && edge === 1
        ? errorBranchState : state
      const prior = inputs[target]
      if (prior === undefined) {
        inputs[target] = new Map(next)
        pending.push(target)
        continue
      }
      let changed = false
      for (const [register, type] of prior) {
        const incoming = next.get(register)
        if (incoming === undefined) { prior.delete(register); changed = true }
        else if (incoming !== type)
          return { rule: 'register-type-conflict',
            message: `${fn.name}[${target}]: r${register} joins ${type} with ${incoming}` }
      }
      if (changed) pending.push(target)
    }
  }
  return undefined
}

function verifyNominalDeclarations(module, registry, bound, major) {
  const declarations = new Map()
  const registryTypes = new Map((registry.types ?? []).map(type => [type.name, type]))
  for (const declared of module.types ?? []) {
    if (declarations.has(declared.name))
      return { rule: 'nominal-type-mismatch', message: `${declared.name} is declared twice` }
    declarations.set(declared.name, declared)
    const standard = registryTypes.get(declared.name)
    if (standard === undefined)
      return { rule: 'nominal-type-unresolved', message: `${declared.name} has no registry declaration` }
    if (major === 1 && standard.fields.some(field => field.optional === true))
      return { rule: 'nominal-optional-unrepresentable',
        message: `${declared.name} has optional fields absent from UVB 1.1 binary record declarations` }
    if (declared.fields.length !== standard.fields.length || declared.fields.some((field, index) =>
      field.name !== standard.fields[index].name || field.type !== standard.fields[index].type
      || (field.optional === true) !== (standard.fields[index].optional === true)))
      return { rule: 'nominal-type-mismatch', message: `${declared.name} differs from its registry declaration` }
  }
  const used = []
  for (const fn of module.functions) {
    used.push(...fn.params, fn.returns)
    for (const instruction of fn.body) if (instruction.type !== undefined) used.push(instruction.type)
  }
  for (const row of bound) used.push(...row.params.map(param => param.type), row.returns)
  for (const declared of declarations.values()) used.push(...declared.fields.map(field => field.type))
  for (const type of used) for (const name of type.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []) {
    if (!declarations.has(name))
      return { rule: 'nominal-type-unresolved', message: `${name} is used without a module type declaration` }
  }
  return undefined
}

// The structural schema deliberately accepts nested type spellings; the verifier owns their
// grammar and depth. A regex alone cannot prove balanced list brackets or forbid result/value
// inside a concrete list, and both would make canonical State values ambiguous.
function verifyV2TypeBounds(module) {
  const maxDepth = 16
  const parse = (name, depth = 0, resultAllowed = false) => {
    if (typeof name !== 'string' || name.length > 128 || depth > maxDepth) return false
    if (['value', 'bool', 'i64', 'fixed64', 'strref'].includes(name)) return true
    if (/^ref<[a-z][a-z0-9-]*>\??$/.test(name) || /^[A-Z][A-Za-z0-9]*$/.test(name)) return true
    if (name.startsWith('list<') && name.endsWith('>')) {
      const item = name.slice(5, -1)
      return item !== 'value' && !item.startsWith('result<') && parse(item, depth + 1)
    }
    if (resultAllowed && name.startsWith('result<') && name.endsWith('>')) {
      const item = name.slice(7, -1)
      return item !== 'value' && !item.startsWith('result<') && parse(item, depth + 1)
    }
    return false
  }
  for (const fn of module.functions) {
    if (fn.params.some(type => !parse(type)) || !(
      fn.returns === 'void' || parse(fn.returns, 0, true))
      || fn.body.some(instruction => instruction.type !== undefined && !parse(instruction.type)))
      return { rule: 'value-type-budget', message: `${fn.name} has an invalid or over-deep UVB 2 type` }
  }
  for (const declaration of module.types ?? []) {
    if (declaration.fields.some(field => !parse(field.type)))
      return { rule: 'value-type-budget', message: `${declaration.name} has an invalid or over-deep field type` }
  }
  return undefined
}

/** Until the VM has bounded call frames, only acyclic internal calls are admitted. */
function verifyCallDepth(functions, maxCallDepth) {
  if (maxCallDepth !== undefined && (!Number.isSafeInteger(maxCallDepth) || maxCallDepth < 1))
    return { rule: 'call-depth-budget', message: 'maxCallDepth must be a positive safe integer' }
  const callers = new Map([...functions.keys()].map(name => [name, []]))
  const remaining = new Map()
  const depth = new Map()
  for (const fn of functions.values()) {
    const callees = new Set(fn.body.filter(row => row.op === 'call').map(row => row.function))
    remaining.set(fn.name, callees.size)
    for (const callee of callees) callers.get(callee).push(fn.name)
  }
  const ready = [...remaining].filter(([, count]) => count === 0).map(([name]) => name)
  while (ready.length > 0) {
    const name = ready.pop()
    if (!depth.has(name)) depth.set(name, 1)
    for (const caller of callers.get(name)) {
      depth.set(caller, Math.max(depth.get(caller) ?? 1, depth.get(name) + 1))
      const count = remaining.get(caller) - 1
      remaining.set(caller, count)
      if (count === 0) ready.push(caller)
    }
  }
  if ([...remaining.values()].some(count => count > 0))
    return { rule: 'call-graph-cycle', message: 'recursive UVB calls need a bounded VM call-frame profile' }
  let longest = 0
  for (const value of depth.values()) longest = Math.max(longest, value)
  if (maxCallDepth !== undefined && longest > maxCallDepth)
    return { rule: 'call-depth-budget', message: `UVB call depth ${longest} exceeds ${maxCallDepth}` }
  return undefined
}

// --- UVB ---------------------------------------------------------------------------------------

/**
 * Verify one structural UVB module.
 *   registry: runtime/intrinsics.v1.json
 *   options.granted: capability classes the composition granted (undefined = do not check)
 */
export function verifyModule(module, registry, options = {}) {
  const major = module?.uv?.version === '2.0' ? 2 : module?.uv?.version === '1.0' ? 1 : 0
  if (module?.uv?.format !== 'UVB' || major === 0)
    return { refusal: { rule: 'unsupported-version', message: 'unsupported UVB structural version' } }
  if (!Array.isArray(module.functions) || module.functions.length === 0
    || module.functions.some(fn => !Array.isArray(fn.body) || fn.body.length === 0
      || !Number.isInteger(fn.registers) || fn.registers > 4096))
    return { refusal: { rule: 'module-shape-invalid', message: 'UVB functions need a body and a bounded register file' } }
  if (major === 2) {
    const typeFailure = verifyV2TypeBounds(module)
    if (typeFailure !== undefined) return { refusal: typeFailure }
  }
  const table = indexRegistry(registry)
  const bound = []
  if (major === 1 && module.types?.some(type => type.fields.some(field => opaqueValueType(field.type)))) {
    return opaqueRefusal(`module ${module.namespace} record declaration`)
  }
  for (const requirement of module.requires.intrinsics) {
    const row = table.get(requirement)
    if (row === undefined) {
      return { refusal: { rule: 'references-resolve', message: `module ${module.namespace} requires unknown intrinsic ${requirement}` } }
    }
    if (row.status === 'reserved') {
      return { refusal: { rule: 'intrinsic-reserved', message: `${requirement} is reserved for amendment ${row.amendment}; binding it refuses until the amendment lands` } }
    }
    if (major === 1 && opaqueSignature(row)) return opaqueRefusal(requirement)
    if (options.granted !== undefined && !options.granted.includes(row.capability)) {
      return { refusal: { rule: 'capability-not-granted', message: `${requirement} needs capability ${row.capability}, not granted` } }
    }
    bound.push(row)
  }
  const functions = new Map(module.functions.map(fn => [fn.name, fn]))
  if (functions.size !== module.functions.length)
    return { refusal: { rule: 'duplicate-function', message: `module ${module.namespace} declares a function twice` } }
  for (const fn of module.functions) {
    if (major === 1 && (fn.params.some(opaqueValueType) || opaqueValueType(fn.returns) ||
        fn.body.some(instruction => opaqueValueType(instruction.type)))) {
      return opaqueRefusal(`module ${module.namespace}.${fn.name}`)
    }
    const reads = new Set(fn.effects.reads)
    const writes = new Set(fn.effects.writes)
    for (const [index, instruction] of fn.body.entries()) {
      if (instruction.op === 'call' && !functions.has(instruction.function)) {
        return { refusal: { rule: 'references-resolve', message: `${fn.name}: call to unknown function ${instruction.function}` } }
      }
      if (instruction.op === 'call') {
        const callee = functions.get(instruction.function)
        for (const area of callee.effects.reads) {
          if (!reads.has(area) && !writes.has(area))
            return { refusal: { rule: 'effects-within-declaration',
              message: `${fn.name} calls ${callee.name} which reads ${area}, not declared` } }
        }
        for (const area of callee.effects.writes) {
          if (!writes.has(area))
            return { refusal: { rule: 'effects-within-declaration',
              message: `${fn.name} calls ${callee.name} which writes ${area}, not declared` } }
        }
      }
      if (instruction.op === 'call' && resultType(functions.get(instruction.function)?.returns)
        && instruction.dst === undefined)
        return { refusal: { rule: 'results-are-handled', message: `${fn.name}[${index}]: result is discarded` } }
      if (instruction.op === 'call.intrinsic') {
        const row = bound[instruction.intrinsicIndex]
        if (row === undefined) {
          return { refusal: { rule: 'references-resolve', message: `${fn.name}[${index}]: intrinsicIndex ${instruction.intrinsicIndex} outside requires` } }
        }
        if (resultType(row.returns) && instruction.dst === undefined)
          return { refusal: { rule: 'results-are-handled', message: `${fn.name}[${index}]: result is discarded` } }
        for (const area of row.reads ?? []) {
          if (!reads.has(area) && !writes.has(area)) {
            return { refusal: { rule: 'effects-within-declaration', message: `${fn.name} calls ${intrinsicKey(row)} which reads ${area}, not declared` } }
          }
        }
        for (const area of row.writes ?? []) {
          if (!writes.has(area)) {
            return { refusal: { rule: 'effects-within-declaration', message: `${fn.name} calls ${intrinsicKey(row)} which writes ${area}, not declared` } }
          }
        }
      }
    }
    const loopFailure = verifyLoopStructure(fn)
    if (loopFailure !== undefined) return { refusal: loopFailure }
    const registerFailure = verifyInitializedRegisters(fn)
    if (registerFailure !== undefined) return { refusal: registerFailure }
    const resultFailure = verifyResultObligations(fn, bound, functions)
    if (resultFailure !== undefined) return { refusal: resultFailure }
    const typeFailure = verifyTypedRegisters(fn, bound, functions, major)
    if (typeFailure !== undefined) return { refusal: typeFailure }
  }
  const nominalFailure = verifyNominalDeclarations(module, registry, bound, major)
  if (nominalFailure !== undefined) return { refusal: nominalFailure }
  const callFailure = verifyCallDepth(functions, options.maxCallDepth)
  if (callFailure !== undefined) return { refusal: callFailure }
  return { verified: true, bound: bound.map(intrinsicKey) }
}

/** Executable subset of UVB 2. Structural validity alone never authorizes VM admission. */
export function verifyExecutableModuleProfile(module) {
  if (module?.uv?.version === '1.0') return { admitted: true }
  const refuse = message => ({ refusal: { rule: 'behavior-profile-unavailable', message } })
  if (module?.uv?.version === '2.0'
    && module.functions?.some(fn => fn.body.some(item =>
      ['result.value-or-false', 'list.empty', 'list.append', 'list.len', 'list.get',
        'pos.make'].includes(item.op)))
    && module.functions.every(fn => fn.body.every(item =>
      item.op !== 'value.box' && item.op !== 'value.unbox')
      && !fn.params.some(opaqueValueType) && !opaqueValueType(fn.returns))
    && !module.types?.some(type => type.fields.some(field =>
      field.optional === true || opaqueValueType(field.type))))
    return { admitted: true }
  if (module?.uv?.version !== '2.0' || module.requires?.intrinsics?.some(name =>
    name !== 'scenario.var@1' && name !== 'scenario.set-var@1'
      && name !== 'query.def-field@1' && name !== 'query.def-flag@1'
      && name !== 'query.def@1' && name !== 'rng.roll@1'
      && name !== 'rng.roll-fixed@1'))
    return refuse('This UVB 2 intrinsic is not admitted by the scalar value VM profile.')
  const scalar = new Set(['bool', 'i64', 'fixed64'])
  const boxable = new Set([...scalar, 'strref'])
  const admitted = new Set(['const', 'move', 'add.i64', 'sub.i64', 'mul.i64', 'div.i64',
    'add.fx', 'sub.fx', 'mul.fx', 'div.fx', 'eq', 'lt', 'le', 'and', 'or', 'not',
    'br', 'br_if', 'loop', 'ret', 'call', 'call.intrinsic', 'value.box', 'value.unbox', 'value.expect',
    'result.value-or-false', 'result.unwrap-or-branch', 'option.unwrap-or-branch', 'fixed.parse-decimal',
    'result.value-or'])
  for (const fn of module.functions ?? []) {
    if (fn.effects.reads.some(area => area !== 'scenario' && area !== 'defs')
      || fn.effects.writes.some(area => area !== 'scenario' && area !== 'rng')
      || fn.params.some(type => !scalar.has(type) && type !== 'strref'
        && type !== 'ref<def>' && type !== 'ref<def>?')
      || !(boxable.has(fn.returns) || fn.returns === 'void' || fn.returns === 'value'
        || fn.returns === 'ref<def>' || fn.returns === 'ref<def>?'
        || /^result<(bool|i64|fixed64|strref)>$/.test(fn.returns)))
      return refuse(`${module.namespace}/${fn.name} needs an unimplemented UVB 2 type or effect.`)
    for (const instruction of fn.body) {
      if (!admitted.has(instruction.op)
        || (instruction.op.startsWith('value.') && !boxable.has(instruction.type)))
        return refuse(`${module.namespace}/${fn.name}: ${instruction.op} needs an unimplemented UVB 2 operation.`)
    }
  }
  return { admitted: true }
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
        if (event.payload.some(field => opaqueValueType(field.type))) return opaqueRefusal(handler.event)
        if (handler.condition !== undefined) {
          let impure
          walkExpr(handler.condition, expr => {
            if (expr.kind === 'call') {
              const row = table.get(expr.intrinsic)
              if (row === undefined) impure ??= { rule: 'references-resolve', message: `chart ${chart.name}: condition calls unknown ${expr.intrinsic}` }
              else if (opaqueSignature(row)) impure ??= opaqueRefusal(expr.intrinsic).refusal
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
            if (opaqueSignature(row)) return opaqueRefusal(action.intrinsic)
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
