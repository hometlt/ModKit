import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { verifyCharts } from './uv-verify.mjs'
import { composeVerifiedReceipt } from './uv-composition.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'
import { encodeUvb, uvbIdentityDigest } from './uvb-binary.mjs'
import { compileLuau } from '../../runtime/compiler/index.ts'
import { compileVerifiedScalarBindings } from '../../runtime/host/bindings.ts'
import { runBrowserWorker } from '../../runtime/test/browser-runner.ts'
import { verifyScenarioComposition } from './uv-contract-verifier.ts'
import payloadDocument from '../scenario/fixtures/uvs-event-payloads.uvs.json' with { type: 'json' }

const registry: unknown = JSON.parse(await readFile(new URL('../runtime/intrinsics.v1.json', import.meta.url), 'utf8'))
const events: unknown = JSON.parse(await readFile(new URL('../runtime/events.v1.json', import.meta.url), 'utf8'))
const constant = (value: unknown) => ({ kind: 'const', value })
const variable = (name: string) => ({ kind: 'var', name })
const call = (intrinsic: string, args: readonly unknown[] = []) => ({ kind: 'call', intrinsic, args })
const scenario = (handler: Readonly<Record<string, unknown>>) => ({
  uv: { format: 'UVS', version: '1.0' }, namespace: 'example',
  charts: [{ name: 'main', initialState: 'idle', variables: [
    { name: 'ready', type: 'bool', initial: false },
    { name: 'count', type: 'i64', initial: '0' },
    { name: 'speed', type: 'fixed64', initial: '4294967296' },
  ], states: [{ name: 'idle', on: [{ event: 'timer.fired', actions: [], ...handler }] }] }],
})
function check(handler: Readonly<Record<string, unknown>>) {
  return verifyCharts(scenario(handler), registry, events)
}
function refused(result: ReturnType<typeof verifyCharts>, rule: string): void {
  assert.ok('refusal' in result, JSON.stringify(result))
  assert.equal(result.refusal.rule, rule)
  assert.match(result.refusal.message, /chart main/u)
}

test('the public UVS verifier keeps exact variable types and checks both sides of comparisons', () => {
  const accepted = check({ condition: { kind: 'and', args: [
    { kind: 'not', args: [variable('ready')] },
    { kind: 'cmp', op: 'lt', args: [constant('8589934592'), variable('speed')] },
  ] }, actions: [{ kind: 'set-var', name: 'count', value: constant('9223372036854775807') }] })
  assert.deepEqual(accepted, { verified: true, bound: ['scenario.set-var@1'] })
  for (const handler of [
    { condition: variable('count') },
    { actions: [{ kind: 'set-var', name: 'count', value: variable('ready') }] },
    { actions: [{ kind: 'set-var', name: 'count', value: constant('9223372036854775808') }] },
    { condition: { kind: 'cmp', op: 'eq', args: [variable('speed'), variable('count')] } },
    { condition: { kind: 'cmp', op: 'lt', args: [variable('ready'), constant(true)] } },
    { condition: { kind: 'and', args: [constant(true), variable('speed')] } },
  ]) refused(check(handler), 'scenario-type-mismatch')
})

test('UVS calls enforce canonical signatures and pure nested argument/value expressions', () => {
  refused(check({ condition: call('player.resource@1') }), 'scenario-call-arity')
  refused(check({ actions: [{ kind: 'intrinsic', intrinsic: 'entity.set-stat-modifier@1', args: [] }] }), 'scenario-call-arity')
  refused(check({ actions: [{ kind: 'set-var', name: 'speed',
    value: call('rng.roll-fixed@1', [constant('stream')]) }] }), 'conditions-are-pure')
  refused(check({ actions: [{ kind: 'intrinsic', intrinsic: 'scenario.objective-add@1',
    args: [call('timer.start@1', [constant('1')])] }] }), 'conditions-are-pure')
  refused(check({ actions: [{ kind: 'set-var', name: 'count', value: variable('missing') }] }), 'references-resolve')
  refused(check({ condition: { kind: 'not', args: [] } }), 'scenario-expression-arity')
})

test('UVS verification has a typed depth limit rather than overflowing the host stack', () => {
  let condition: unknown = constant(true)
  for (let depth = 0; depth < 150; depth++) condition = { kind: 'not', args: [condition] }
  refused(check({ condition }), 'scenario-verifier-budget')
  const malformed = verifyCharts({ uv: { format: 'UVS', version: '1.0' }, namespace: 'example',
    charts: [{ name: 'main', initialState: 'idle', states: null }] }, registry, events)
  assert.ok('refusal' in malformed)
  assert.equal(malformed.refusal.rule, 'scenario-shape-invalid')
})

async function compose(document: unknown, required: readonly string[] = [],
  granted: readonly string[] = [], modules: readonly unknown[] = []) {
  const artifacts = new Map<string, { digest: string; document?: unknown; bytes?: Uint8Array }>()
  artifacts.set('scenario.uvs.json', { document, digest: await uvpJsonArtifactDigest('uvs', document) })
  const contents = [{ family: 'uvs', path: 'scenario.uvs.json', hash: artifacts.get('scenario.uvs.json')!.digest }]
  for (const [index, module] of modules.entries()) {
    const bytes = encodeUvb(module), digest = await uvbIdentityDigest(bytes)
    const path = `behavior-${index}.uvb`
    contents.push({ family: 'uvb', path, hash: digest }); artifacts.set(path, { bytes, digest })
  }
  const manifest = { uv: { format: 'UVP', version: '1.0' }, id: 'example/scenario',
    version: '1.0.0', kind: 'library', dependencies: [],
    requires: { intrinsics: required, capabilities: [] }, contents }
  return composeVerifiedReceipt(manifest.id, [manifest], registry, granted,
    ({ content }) => artifacts.get(content.path)!)
}

test('the actual composition route checks UVS events, signatures, dependencies and capabilities', async () => {
  for (const [document, required, granted, rule, reason] of [
    [scenario({ event: 'entity.unknown' }), [], [], 'scenario-verification-refused', 'references-resolve'],
    [scenario({ condition: variable('count') }), [], [], 'scenario-verification-refused', 'scenario-type-mismatch'],
    [scenario({ actions: [{ kind: 'intrinsic', intrinsic: 'entity.set-stat-modifier@1', args: [] }] }),
      ['entity.set-stat-modifier@1'], ['mutate'], 'scenario-verification-refused', 'scenario-call-arity'],
    [scenario({ actions: [{ kind: 'set-var', name: 'ready', value: constant(true) }] }),
      [], ['control'], 'scenario-requirement-undeclared', 'scenario.set-var@1'],
    [scenario({ actions: [{ kind: 'set-var', name: 'ready', value: constant(true) }] }),
      ['scenario.set-var@1'], [], 'scenario-verification-refused', 'capability-not-granted'],
  ] as const) {
    const outcome = await compose(document, required, granted)
    assert.ok('refusal' in outcome, JSON.stringify(outcome))
    assert.equal(outcome.refusal.rule, rule)
    assert.ok(outcome.refusal.message.includes(reason), outcome.refusal.message)
  }
})

test('UVS resolves actual shipped UVB function signatures before issuing a receipt', async () => {
  const module = compileLuau('function handle(flag: boolean): boolean\n  return flag\nend',
    { namespace: 'example', file: 'scenario.luau' })
  const document = (arg: unknown) => scenario({ actions: [
    { kind: 'uvb', module: 'example', function: 'handle', args: [arg] },
  ] })
  const missing = await compose(document(constant(true)))
  assert.ok('refusal' in missing)
  assert.match(missing.refusal.message, /missing example.handle/u)
  const wrong = await compose(document(variable('count')), [], [], [module])
  assert.ok('refusal' in wrong)
  assert.match(wrong.refusal.message, /expected bool, got i64/u)
  const duplicate = await compose(document(constant(true)), [], [], [module, module])
  assert.ok('refusal' in duplicate)
  assert.equal(duplicate.refusal.rule, 'behavior-function-duplicate')
  const valid = await compose(document(constant(true)), [], [], [module])
  assert.ok('receipt' in valid, JSON.stringify(valid))
  // This static action is executable, but declaration verification cannot invent the
  // absent world. The full receipt/world/provider route is covered by reactions.test.ts.
  await assert.rejects(compileVerifiedScalarBindings(valid.receipt),
    error => error instanceof Error && 'code' in error && error.code === 'binding-world')
})

test('UVS refuses discarded Results and accepts only explicitly checked shipped wrappers', async () => {
  const direct = scenario({ actions: [{ kind: 'intrinsic', intrinsic: 'timer.cancel@1',
    args: [constant('1')] }] })
  const checked = verifyCharts(direct, registry, events)
  refused(checked, 'results-are-handled')
  const directComposition = await compose(direct, ['timer.cancel@1'], ['mutate'])
  assert.ok('refusal' in directComposition)
  assert.match(directComposition.refusal.message, /results-are-handled.*timer.cancel@1/u)

  const module = compileLuau(`function raw(timer: TimerRef): ResultBool
  return mv.timer.cancel(timer)
end
function handled(timer: TimerRef): boolean
  return mv.result.valueOrFalse(raw(timer))
end`, { namespace: 'example', file: 'result-handler.luau' })
  const document = (name: string) => scenario({ actions: [{ kind: 'uvb', module: 'example',
    function: name, args: [constant('1')] }] })
  const raw = await compose(document('raw'), ['timer.cancel@1'], ['mutate'], [module])
  assert.ok('refusal' in raw)
  assert.match(raw.refusal.message, /results-are-handled.*example.raw/u)
  const handled = await compose(document('handled'), ['timer.cancel@1'], ['mutate'], [module])
  assert.ok('receipt' in handled, JSON.stringify(handled))
  await assert.rejects(compileVerifiedScalarBindings(handled.receipt),
    error => error instanceof Error && 'code' in error && error.code === 'binding-scenario-unavailable')
})

test('Node and a real Chrome worker give identical UVS declaration refusals', {
  skip: process.env['MULTIVERSE_TEST_REAL_BROWSER'] !== '1',
}, async () => {
  const inputs = [
    { document: scenario({ condition: variable('ready') }), required: [], granted: [] },
    { document: scenario({ condition: variable('count') }), required: [], granted: [] },
    { document: scenario({ event: 'entity.unknown' }), required: [], granted: [] },
    { document: scenario({ actions: [{ kind: 'intrinsic', intrinsic: 'scenario.objective-add@1', args: [] }] }),
      required: ['scenario.objective-add@1'], granted: ['control'] },
    { document: scenario({ actions: [{ kind: 'set-var', name: 'ready', value: constant(true) }] }),
      required: [], granted: ['control'] },
    { document: scenario({ actions: [{ kind: 'set-var', name: 'ready', value: constant(true) }] }),
      required: ['scenario.set-var@1'], granted: [] },
    { document: scenario({ actions: [{ kind: 'intrinsic', intrinsic: 'timer.cancel@1', args: [constant('1')] }] }),
      required: ['timer.cancel@1'], granted: ['mutate'] },
  ]
  const expected = inputs.map(input => verifyScenarioComposition([
    { packageId: 'example/scenario', path: 'scenario.uvs.json', document: input.document },
  ], [], registry, [{ id: 'example/scenario', requires: { intrinsics: input.required } }], input.granted))
  assert.ok('verified' in expected[0]!)
  assert.ok(expected.slice(1).every(outcome => 'refusal' in outcome))
  const browser = await runBrowserWorker(new URL('./uv-scenario-verifier.browser.ts', import.meta.url),
    { registry, inputs })
  assert.deepEqual(browser.result, { result: expected })
})

test('UVS 1.1 binds canonical fields within each handler and refuses legacy, extra or incompatible fields', () => {
  const accepted = verifyCharts(payloadDocument, registry, events)
  assert.deepEqual(accepted, { verified: true, bound: ['entity.exists@1', 'scenario.set-var@1', 'scenario.var@1'] })
  const cases = [
    [(doc: typeof payloadDocument) => { doc.uv.version = '1.0' }, 'scenario-version-unavailable'],
    [(doc: typeof payloadDocument) => { Object.assign(doc.charts[0]!.states[0]!.on[1]!.condition!.args![0]!, { name: 'entity' }) }, 'references-resolve'],
    [(doc: typeof payloadDocument) => { Object.assign(doc.charts[0]!.states[0]!.on[2]!.actions[0]!.value!, { name: 'entity' }) }, 'scenario-type-mismatch'],
    [(doc: typeof payloadDocument) => { Object.assign(doc.charts[0]!.states[0]!.on[2]!.actions[0]!.value!, { args: [] }) }, 'scenario-shape-invalid'],
  ] as const
  for (const [mutate, rule] of cases) {
    const doc = structuredClone(payloadDocument); mutate(doc)
    refused(verifyCharts(doc, registry, events), rule)
  }
})

test('UVS 1.1 variable reader authority and payload types are checked on the actual composition route', async () => {
  const requirements = ['scenario.var@1', 'scenario.set-var@1', 'entity.exists@1']
  const accepted = await compose(payloadDocument, requirements, ['read', 'control'])
  assert.ok('receipt' in accepted, JSON.stringify(accepted))
  const missing = await compose(payloadDocument, requirements.slice(1), ['read', 'control'])
  assert.ok('refusal' in missing)
  assert.equal(missing.refusal.rule, 'scenario-requirement-undeclared')
  assert.match(missing.refusal.message, /scenario.var@1/u)
  const denied = await compose(payloadDocument, requirements, ['control'])
  assert.ok('refusal' in denied)
  assert.match(denied.refusal.message, /capability-not-granted/u)
  const callback = compileLuau('function raw(timer: TimerRef): ResultBool\n return mv.timer.cancel(timer)\nend',
    { namespace: 'example', file: 'payload-result.luau' })
  const raw = { ...scenario({ actions: [{ kind: 'uvb', module: 'example', function: 'raw',
    args: [{ kind: 'event', name: 'timer' }] }] }), uv: { format: 'UVS', version: '1.1' } }
  const discarded = await compose(raw, ['timer.cancel@1'], ['mutate'], [callback])
  assert.ok('refusal' in discarded)
  assert.match(discarded.refusal.message, /results-are-handled/u)
})

test('UVS 1.1 payload and reader refusals agree between Node and a real Chrome worker', {
  skip: process.env['MULTIVERSE_TEST_REAL_BROWSER'] !== '1',
}, async () => {
  const invalid = structuredClone(payloadDocument)
  Object.assign(invalid.charts[0]!.states[0]!.on[2]!.actions[0]!.value!, { name: 'timer' })
  const inputs = [
    { document: payloadDocument, required: ['scenario.var@1', 'scenario.set-var@1', 'entity.exists@1'], granted: ['read', 'control'] },
    { document: invalid, required: ['scenario.var@1', 'scenario.set-var@1', 'entity.exists@1'], granted: ['read', 'control'] },
    { document: payloadDocument, required: ['scenario.set-var@1', 'entity.exists@1'], granted: ['read', 'control'] },
    { document: payloadDocument, required: ['scenario.var@1', 'scenario.set-var@1', 'entity.exists@1'], granted: ['control'] },
  ]
  const expected = inputs.map(input => verifyScenarioComposition([
    { packageId: 'example/scenario', path: 'scenario.uvs.json', document: input.document },
  ], [], registry, [{ id: 'example/scenario', requires: { intrinsics: input.required } }], input.granted))
  assert.ok('verified' in expected[0]!)
  assert.ok(expected.slice(1).every(outcome => 'refusal' in outcome))
  const browser = await runBrowserWorker(new URL('./uv-scenario-verifier.browser.ts', import.meta.url), { registry, inputs })
  assert.deepEqual(browser.result, { result: expected })
})
