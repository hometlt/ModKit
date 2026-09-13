import type { JsonValue, ModelMaterialRef } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '../json-snapshot.js'

export const DEFAULT_MODEL_MATERIAL_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64, maxNodes: 1_000_000, maxBytes: 134_217_728,
})

type RecordValue = Readonly<Record<string, JsonValue>>
const record = (value: JsonValue | undefined, label: string): RecordValue => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as RecordValue
}
const text = (value: JsonValue | undefined, label: string, nonEmpty = false): void => {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) throw new TypeError(`${label} must be a string`)
}
const strings = (value: JsonValue | undefined, label: string): void => {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array`)
  }
}
const optionalFields = (value: RecordValue, label: string): void => {
  for (const key of ['name', 'libraryId', 'type', 'blendMode']) {
    if (value[key] !== undefined) text(value[key], `${label}.${key}`)
  }
  if (
    value['alphaMode'] !== undefined &&
    value['alphaMode'] !== 'opaque' &&
    value['alphaMode'] !== 'mask' &&
    value['alphaMode'] !== 'blend'
  ) {
    throw new TypeError(`${label}.alphaMode must be opaque, mask or blend`)
  }
  if (
    value['alphaCutoff'] !== undefined &&
    (typeof value['alphaCutoff'] !== 'number' ||
      !Number.isFinite(value['alphaCutoff']) ||
      value['alphaCutoff'] < 0)
  ) {
    throw new TypeError(`${label}.alphaCutoff must be finite and nonnegative`)
  }
  for (const key of ['castShadows', 'receiveShadows']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new TypeError(`${label}.${key} must be a boolean`)
    }
  }
  for (const key of ['priority', 'uvSource', 'colorChannels', 'nativeFlags']) {
    if (value[key] !== undefined && typeof value[key] !== 'number') throw new TypeError(`${label}.${key} must be a number`)
  }
  for (const key of ['contracts', 'flagNames']) {
    if (value[key] !== undefined) strings(value[key], `${label}.${key}`)
  }
}

/** Validate and own the full material facet, including shader data and native layer metadata. */
export function snapshotModelMaterials(
  value: unknown,
  budget: JsonSnapshotBudget = DEFAULT_MODEL_MATERIAL_BUDGET,
  signal?: AbortSignal,
): readonly ModelMaterialRef[] {
  const snapshot = snapshotJson(value, { ...budget, sortKeys: true }, signal)
  if (!Array.isArray(snapshot)) throw new TypeError('model materials must be an array')
  const ids = new Set<string>()
  for (const entry of snapshot) {
    const material = record(entry, 'material')
    text(material['id'], 'material.id', true)
    const id = material['id'] as string
    if (ids.has(id)) throw new TypeError(`duplicate material id ${id}`)
    ids.add(id)
    optionalFields(material, `material ${id}`)
    if (material['layers'] !== undefined) {
      if (!Array.isArray(material['layers'])) throw new TypeError('material.layers must be an array')
      for (const entry of material['layers']) {
        const layer = record(entry, 'material layer')
        text(layer['slot'], 'material layer.slot', true)
        if (layer['resourceId'] !== undefined) text(layer['resourceId'], 'material layer.resourceId', true)
        optionalFields(layer, 'material layer')
      }
    }
    if (material['shader'] !== undefined) {
      const shader = record(material['shader'], 'material.shader')
      text(shader['id'], 'material.shader.id', true)
      record(shader['parameters'], 'material.shader.parameters')
    }
  }
  // Shape validation follows the JSON validation above; the returned graph is deeply immutable.
  return snapshot as unknown as readonly ModelMaterialRef[]
}
