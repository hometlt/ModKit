/** Executable admission, separate from structural validity and owned by the UVB verifier. */
import intrinsicRegistry from '../runtime/intrinsics.v1.json' with { type: 'json' }
import { foundationValueTypes, isFoundationValueType } from './uv-executable-values.ts'
interface Module {
  readonly uv: { readonly version: string }
  readonly namespace: string
  readonly requires: { readonly intrinsics: readonly string[] }
  readonly types?: readonly { readonly name: string; readonly fields: readonly { readonly type: string; readonly optional?: boolean }[] }[]
  readonly functions: readonly {
    readonly name: string; readonly params: readonly string[]; readonly returns: string
    readonly effects: { readonly reads: readonly string[]; readonly writes: readonly string[] }
    readonly body: readonly { readonly op: string; readonly type?: string }[]
  }[]
}
// Executable admission, not another vocabulary: names still resolve through the
// canonical intrinsic registry. This set matches the foundation VM's implementations.
const foundationIntrinsics = new Set([
  'rng.roll@1', 'rng.roll-fixed@1', 'entity.exists@1', 'entity.create@1',
  'entity.def@1', 'entity.owner@1', 'entity.position@1', 'entity.teleport@1',
  'entity.stat@1', 'entity.set-stat-modifier@1', 'entity.orientation-component@1', 'entity.set-orientation@1',
  'assembly.install@1', 'assembly.replace@1', 'assembly.remove@1', 'assembly.cancel@1',
  'timer.start@1', 'timer.cancel@1', 'timer.remaining@1', 'scenario.var@1', 'scenario.set-var@1',
  'order.move@1', 'order.stop@1', 'query.def-field@1', 'query.def-flag@1', 'query.def@1',
  'math.sin-turns@1', 'math.cos-turns@1', 'world.tick@1',
  'player.resource@1', 'player.add-resource@1', 'player.set-resource@1',
  'player.tech-unlocked@1', 'player.unlock-tech@1',
])
/** Executable subset of UVB 2. Structural validity alone never authorizes VM admission. */
export function verifyExecutableModuleProfile(input: unknown): Readonly<{ admitted: true }>
  | Readonly<{ refusal: { rule: string; message: string } }> {
  const module = input as Module | undefined
  const refuse = (message: string) => ({ refusal: { rule: 'behavior-profile-unavailable', message } })
  if (!Array.isArray(module?.requires?.intrinsics)) return refuse('Missing intrinsic requirements in the executable module.')
  const unsupported = module.requires.intrinsics.find(name => !foundationIntrinsics.has(name))
  if (unsupported) return refuse(`Intrinsic ${unsupported} is not implemented by the foundation VM.`)
  if (module.uv?.version === '1.0') return { admitted: true }
  if (module?.uv?.version !== '2.0') return refuse('Unsupported executable UVB version.')
  const boxable = new Set<string>(foundationValueTypes)
  const concrete = new Set([...boxable, 'ref<def>?', 'Pos', 'list<ref<entity>>', 'list<InstallationPayment>'])
  const recordNames = new Set(module.types?.map(record => record.name) ?? [])
  const usedRecords = new Set(module.functions.flatMap(fn => [...fn.params, fn.returns,
    ...fn.body.map(instruction => instruction.type ?? '')]).filter(type => recordNames.has(type)))
  const pendingRecords = [...usedRecords]
  while (pendingRecords.length) {
    const name = pendingRecords.pop()
    const record = module.types?.find(record => record.name === name)
    if (!record) return refuse(`Missing record ${name}.`)
    if (record.fields.some(field => !concrete.has(field.type) && !recordNames.has(field.type)
      || field.type === 'list<InstallationPayment>'))
      return refuse(`Record ${record.name} has an unimplemented executable field type.`)
    for (const field of record.fields) if (recordNames.has(field.type) && !usedRecords.has(field.type)) {
      usedRecords.add(field.type); pendingRecords.push(field.type)
    }
  }
  for (const name of recordNames) concrete.add(name)
  const signatures = intrinsicRegistry.intrinsics.filter(row => foundationIntrinsics.has(`${row.id}@${row.version}`))
  const reads = new Set(signatures.flatMap(row => row.reads))
  const writes = new Set(signatures.flatMap(row => row.writes))
  const admitted = new Set(['const', 'move', 'add.i64', 'sub.i64', 'mul.i64', 'div.i64',
    'add.fx', 'sub.fx', 'mul.fx', 'div.fx', 'eq', 'lt', 'le', 'and', 'or', 'not',
    'br', 'br_if', 'loop', 'ret', 'call', 'call.intrinsic', 'value.box', 'value.unbox', 'value.expect',
    'result.value-or-false', 'result.unwrap-or-branch', 'option.unwrap-or-branch', 'fixed.parse-decimal',
    'result.value-or', 'pos.make', 'list.empty', 'list.append', 'list.len', 'list.get', 'option.none', 'option.some', 'result.expect',
    'record.make', 'record.get', 'record.set', 'record.has', 'record.clear'])
  for (const fn of module.functions ?? []) {
    if (fn.effects.reads.some(area => !reads.has(area))
      || fn.effects.writes.some(area => !writes.has(area))
      || fn.params.some(type => !concrete.has(type))
      || !(concrete.has(fn.returns) || fn.returns === 'void' || fn.returns === 'value'
        || fn.returns.startsWith('result<') && fn.returns.endsWith('>')
          && isFoundationValueType(fn.returns.slice(7, -1))))
      return refuse(`${module.namespace}/${fn.name} needs an unimplemented UVB 2 type or effect.`)
    for (const instruction of fn.body) {
      if (!admitted.has(instruction.op)
        || instruction.op === 'const' && !['bool', 'i64', 'fixed64', 'strref'].includes(instruction.type ?? '')
        || instruction.op === 'list.empty' && instruction.type !== 'ref<entity>'
        || (instruction.op === 'option.none' || instruction.op === 'option.some')
          && !['ref<entity>', 'ref<def>'].includes(instruction.type ?? '')
        || (instruction.op.startsWith('value.') && !boxable.has(instruction.type ?? '')))
        return refuse(`${module.namespace}/${fn.name}: ${instruction.op} needs an unimplemented UVB 2 operation.`)
    }
  }
  return { admitted: true }
}
