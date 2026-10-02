/** Portable model variant admission and captured-resource joins. No loading or renderer. */
import { resolveUvpResourceUri } from './uvp-resource-paths.mjs'

type Row = Record<string, unknown>
function fail(rule: string, message: string): never { throw new TypeError(`${rule}: ${message}`) }
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('model-variants-shape', 'Expected an object')
  return value as Row
}
function rows(value: unknown, maximum = Number.MAX_SAFE_INTEGER): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail('model-variants-shape', 'Expected a bounded array')
  return value as unknown[]
}
function closed(value: Row, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('model-variants-shape', 'Unknown field')
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim()) fail('model-variants-name', 'Expected a nonempty exact name')
  return value as string
}
function index(value: unknown, length: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= length)
    fail('model-variants-reference', 'Target index is out of range')
  return value as number
}
function digest(value: unknown, target: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || target === undefined))
    fail('model-variants-digest', 'A hash needs its model URI and 64 lowercase hex digits')
}
function table(document: Row, field: string): unknown[] { return rows(document[field] ?? []) }
function primitive(document: Row, value: unknown): string {
  const target = row(value), meshes = table(document, 'meshes')
  const mesh = index(target['mesh'], meshes.length)
  const part = index(target['primitive'], rows(row(meshes[mesh])['primitives']).length)
  return `${mesh}/${part}`
}
function unique<T>(values: readonly T[]): void {
  if (new Set(values).size !== values.length) fail('model-variants-duplicate', 'Repeated target or name')
}
function socket(document: Row, socketId: unknown): void {
  const id = name(socketId)
  const count = table(document, 'nodes').filter(value => {
    const extension = row(value)['extensions']
    return extension !== undefined && row(extension)['UV_game_socket'] !== undefined
      && row(row(extension)['UV_game_socket'])['id'] === id
  }).length
  if (count !== 1 || !table(document, 'extensionsUsed').includes('UV_game_socket'))
    fail('model-variants-socket', `Expected one declared socket with id ${id}`)
}
function modelStates(document: Row, extensions: Row): Map<string, Row> {
  const result = new Map<string, Row>(), raw = extensions['UV_game_model_states']
  if (raw === undefined) return result
  if (!table(document, 'extensionsUsed').includes('UV_game_model_states'))
    fail('model-variants-undeclared', 'UV_game_model_states')
  const states = row(raw); closed(states, ['schemaVersion', 'states'])
  if (states['schemaVersion'] !== 1) fail('model-variants-shape', 'Unsupported model states version')
  for (const value of rows(states['states'], 4096)) {
    const state = row(value); closed(state, ['state', 'model', 'modelSha256'])
    const id = name(state['state']); name(state['model']); digest(state['modelSha256'], state['model'])
    if (id === 'base' || result.has(id)) fail('model-variants-duplicate', 'Reserved or repeated model state')
    result.set(id, state)
  }
  return result
}

/** Validate only these optional extensions; absence does not change legacy core admission. */
export function assertUvmVariants(documentValue: unknown): void {
  const document = row(documentValue), extensions = row(document['extensions'] ?? {})
  const states = modelStates(document, extensions), raw = extensions['UV_game_variants']
  if (raw === undefined) return
  if (!table(document, 'extensionsUsed').includes('UV_game_variants')) fail('model-variants-undeclared', 'UV_game_variants')
  const game = row(raw); closed(game, ['variants', 'visibility', 'transitions', 'extras'])
  if (game['variants'] === undefined && game['visibility'] === undefined) fail('model-variants-shape', 'Missing variants or visibility')
  if (game['visibility'] !== undefined) {
    const targets = rows(game['visibility']).map(value => {
      const target = row(value); closed(target, ['mesh', 'primitive', 'value'])
      if (typeof target['value'] !== 'number' || !Number.isFinite(target['value']))
        fail('model-variants-visibility', 'Visibility must be finite')
      return primitive(document, target)
    })
    unique(targets)
  }
  const slots = new Map<string, string>(), defaults = new Set<string>()
  if (game['variants'] !== undefined) {
    const variants = rows(game['variants'], 4096)
    if (!variants.length) fail('model-variants-shape', 'Empty named variants')
    for (const value of variants) {
      const variant = row(value)
      closed(variant, ['name', 'slot', 'default', 'showNodes', 'hideNodes', 'showPrimitives', 'hidePrimitives',
        'materialVariant', 'modelState', 'asset', 'assetSha256', 'alignSocket', 'attachments', 'effects', 'extras'])
      const id = name(variant['name']), slot = variant['slot'] === undefined ? '' : name(variant['slot'])
      if (slots.has(id)) fail('model-variants-duplicate', 'Variant names must be globally unique')
      slots.set(id, slot)
      if (variant['default'] !== undefined && typeof variant['default'] !== 'boolean') fail('model-variants-shape', 'default must be boolean')
      if (variant['default'] === true) {
        if (defaults.has(slot)) fail('model-variants-default', 'At most one default in each slot')
        defaults.add(slot)
      }
      for (const [show, hide, nodeTargets] of [['showNodes', 'hideNodes', true], ['showPrimitives', 'hidePrimitives', false]] as const) {
        const targets = (key: string) => rows(variant[key] ?? []).map(target => {
          if (nodeTargets) return String(index(target, table(document, 'nodes').length))
          closed(row(target), ['mesh', 'primitive']); return primitive(document, target)
        })
        const shown = targets(show), hidden = targets(hide); unique(shown); unique(hidden)
        if (shown.some(target => hidden.includes(target))) fail('model-variants-conflict', 'A variant both shows and hides a target')
      }
      if (variant['materialVariant'] !== undefined) {
        if (!table(document, 'extensionsUsed').includes('KHR_materials_variants')) fail('model-variants-undeclared', 'KHR_materials_variants')
        index(variant['materialVariant'], rows(row(extensions['KHR_materials_variants'])['variants']).length)
      }
      if (variant['asset'] !== undefined) name(variant['asset'])
      digest(variant['assetSha256'], variant['asset'])
      if (variant['alignSocket'] !== undefined) {
        if (variant['asset'] === undefined) fail('model-variants-shape', 'alignSocket needs an asset')
        name(variant['alignSocket'])
      }
      if (variant['modelState'] !== undefined && !states.has(name(variant['modelState']))) fail('model-variants-reference', 'Missing named model state')
      if (variant['asset'] !== undefined && variant['modelState'] !== undefined) fail('model-variants-conflict', 'Two whole-model replacements')
      if (variant['effects'] !== undefined) {
        const effects = rows(variant['effects']).map(value => index(value, Number.MAX_SAFE_INTEGER)); unique(effects)
      }
      if (variant['attachments'] !== undefined) {
        const attachments = rows(variant['attachments'], 256), sockets: string[] = []
        for (const value of attachments) {
          const attachment = row(value); closed(attachment, ['socket', 'asset', 'assetSha256'])
          sockets.push(name(attachment['socket'])); name(attachment['asset']); digest(attachment['assetSha256'], attachment['asset'])
          if (variant['asset'] === undefined && variant['modelState'] === undefined) socket(document, attachment['socket'])
        }
        unique(sockets)
      }
    }
  }
  for (const value of rows(game['transitions'] ?? [])) {
    const transition = row(value); closed(transition, ['from', 'to', 'trigger', 'extras'])
    const from = name(transition['from']), to = name(transition['to']); name(transition['trigger'])
    if (!slots.has(from) || !slots.has(to) || slots.get(from) !== slots.get(to))
      fail('model-variants-transition', 'Transitions must resolve within one slot')
  }
}

export interface UvmVariantModelReference {
  readonly path: string
  readonly digest: string | undefined
  readonly socket: string | undefined
  readonly hostPath: string
  readonly purpose: 'state' | 'replacement' | 'attachment'
}
/** All possible models, not just the current selection. URIs use the existing confined owner. */
export function uvmVariantModelReferences(documentValue: unknown, documentPath: string): readonly UvmVariantModelReference[] {
  assertUvmVariants(documentValue)
  const document = row(documentValue), extensions = row(document['extensions'] ?? {})
  const states = modelStates(document, extensions), result: UvmVariantModelReference[] = []
  const path = (uri: unknown) => resolveUvpResourceUri(documentPath, name(uri))
  const add = (uri: unknown, hash: unknown, purpose: UvmVariantModelReference['purpose'], hostPath = documentPath, socketId?: unknown) => {
    result.push({ path: path(uri), digest: hash === undefined ? undefined : `sha256:${String(hash)}`,
      socket: socketId === undefined ? undefined : name(socketId), hostPath, purpose })
  }
  for (const state of states.values()) add(state['model'], state['modelSha256'], 'state')
  const game = extensions['UV_game_variants'] === undefined ? {} : row(extensions['UV_game_variants'])
  for (const value of rows(game['variants'] ?? [])) {
    const variant = row(value), state = variant['modelState'] === undefined ? undefined : states.get(name(variant['modelState']))
    const hostPath = variant['asset'] !== undefined ? path(variant['asset']) : state ? path(state['model']) : documentPath
    if (variant['asset'] !== undefined) add(variant['asset'], variant['assetSha256'], 'replacement', documentPath, variant['alignSocket'])
    for (const value of rows(variant['attachments'] ?? [], 256)) {
      const attachment = row(value)
      add(attachment['asset'], attachment['assetSha256'], 'attachment', hostPath, attachment['socket'])
    }
  }
  return result
}

interface CapturedModel { readonly packageId: string; readonly path: string; readonly digest: string; readonly document: unknown }
/** Runtime joins only already verified bytes. Authoring URIs never grant I/O authority. */
export function assertUvmVariantClosure(models: readonly CapturedModel[]): void {
  const key = (packageId: string, path: string) => JSON.stringify([packageId, path])
  const captured = new Map(models.map(model => [key(model.packageId, model.path), model]))
  const children = new Map<string, Set<string>>()
  for (const model of models) for (const reference of uvmVariantModelReferences(model.document, model.path)) {
    const targetKey = key(model.packageId, reference.path), target = captured.get(targetKey)
    if (!target || !reference.path.endsWith('.uvm.glb')) fail('model-variant-unverified', `${model.path} needs captured UVM ${reference.path}`)
    if (reference.digest === undefined || reference.digest !== target.digest)
      fail('model-variant-digest', `${model.path} has a missing or stale hash for ${reference.path}`)
    if (reference.socket !== undefined) {
      // alignSocket belongs to the replacement; an attachment socket belongs to its host.
      const host = reference.purpose === 'replacement' ? target : captured.get(key(model.packageId, reference.hostPath))
      if (!host) fail('model-variant-unverified', 'Missing attachment host')
      socket(row(host.document), reference.socket)
    }
    if (reference.purpose === 'attachment') {
      const hostKey = key(model.packageId, reference.hostPath)
      const edges = children.get(hostKey) ?? new Set<string>(); edges.add(targetKey); children.set(hostKey, edges)
    }
  }
  const active = new Set<string>(), heights = new Map<string, number>()
  const height = (id: string, depth: number): number => {
    if (active.has(id)) fail('model-variant-cycle', 'Recursive model attachment')
    if (depth > 16) fail('model-variant-depth', 'Attachment nesting exceeds 16')
    const cached = heights.get(id)
    if (cached !== undefined) return cached
    active.add(id)
    let value = 0
    for (const child of children.get(id) ?? []) value = Math.max(value, 1 + height(child, depth + 1))
    active.delete(id); heights.set(id, value)
    if (value > 16) fail('model-variant-depth', 'Attachment nesting exceeds 16')
    return value
  }
  for (const id of children.keys()) height(id, 0)
}
