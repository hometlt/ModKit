/**
 * Admission of the existing UV_game_material union, not a second material model.
 * uvm.material.schema.json owns its fields. A shaderless packet overrides only
 * explicitly declared blendMode/depthWrite/sortPriority; it cannot carry params,
 * passes or texture layers. A shader-bearing packet retains its existing schema,
 * shadow, water and resource checks. This module neither executes shaders nor
 * injects shader identities, defaults, render programs or conversion policy.
 */
import materialSchema from '../model/schema/uvm.material.schema.json' with { type: 'json' }

const stateFields = materialSchema.$defs.gameMaterial.oneOf
  .find(branch => branch.propertyNames !== undefined)?.propertyNames?.enum ?? []
const blendModes = materialSchema.$defs.gameMaterial.properties.blendMode.enum

/** Refuse an unadmitted packet without repairing it or fabricating a shader. */
function refuse(rule: string, message: string): never {
  throw Object.assign(new TypeError(`${rule}: ${message}`), { rule })
}

/** Validate the narrow state-only branch before the existing common material checks. */
export function assertUvmMaterialState(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    refuse('material-state-shape', 'UV_game_material must be an object')
  const material = value as Record<string, unknown>
  if (Object.hasOwn(material, 'shader')) {
    if (typeof material['shader'] !== 'string' || material['shader'].length === 0)
      refuse('material-shader-identity', 'A shader-bearing packet needs its actual nonempty identity')
    return // The existing schema and shader/resource owners still validate this branch.
  }
  const keys = Object.keys(material)
  if (!keys.length || keys.some(key => !stateFields.some(field => field === key)))
    refuse('material-state-only-fields', 'Shaderless state needs at least one fixed field and no shader-specific payload')
  if (Object.hasOwn(material, 'blendMode')
      && !blendModes.some(mode => mode === material['blendMode']))
    refuse('material-blend-state', 'Unknown shaderless blend mode')
  if (Object.hasOwn(material, 'depthWrite') && typeof material['depthWrite'] !== 'boolean')
    refuse('material-depth-state', 'depthWrite must be boolean')
  if (Object.hasOwn(material, 'sortPriority') && !Number.isInteger(material['sortPriority']))
    refuse('material-sort-state', 'sortPriority must be an integer')
}
