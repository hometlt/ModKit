import { canonicalJsonStringify } from '@modkit/core'

export interface ServiceOperationSchemaValidator {
  readonly valid: true
  validate(value: unknown): string | undefined
}

export type ServiceOperationSchemaCompilation =
  | ServiceOperationSchemaValidator
  | Readonly<{ valid: false; reason: string }>

const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])
const KEYWORDS = new Set([
  '$schema', '$id', '$comment', '$defs', '$ref',
  'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'allOf', 'anyOf', 'oneOf', 'not',
])

interface SchemaNode extends Record<string, unknown> {
  readonly $defs?: unknown
  readonly $ref?: unknown
  readonly type?: unknown
  readonly enum?: unknown
  readonly const?: unknown
  readonly properties?: unknown
  readonly required?: unknown
  readonly additionalProperties?: unknown
  readonly items?: unknown
  readonly minItems?: unknown
  readonly maxItems?: unknown
  readonly uniqueItems?: unknown
  readonly minLength?: unknown
  readonly maxLength?: unknown
  readonly minimum?: unknown
  readonly maximum?: unknown
  readonly exclusiveMinimum?: unknown
  readonly exclusiveMaximum?: unknown
  readonly multipleOf?: unknown
  readonly allOf?: unknown
  readonly anyOf?: unknown
  readonly oneOf?: unknown
  readonly not?: unknown
}

const record = (value: unknown): SchemaNode | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as SchemaNode)
    : undefined

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

const same = (left: unknown, right: unknown): boolean => {
  try {
    return canonicalJsonStringify(left) === canonicalJsonStringify(right)
  } catch {
    return false
  }
}

const decodedPointer = (value: string): readonly string[] | undefined => {
  if (value === '#') return []
  if (!value.startsWith('#/')) return undefined
  try {
    return value
      .slice(2)
      .split('/')
      .map(part => decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~'))
  } catch {
    return undefined
  }
}

function resolvePointer(root: unknown, ref: string): unknown {
  const parts = decodedPointer(ref)
  if (parts === undefined) return undefined
  let current: unknown = root
  for (const part of parts) {
    const object = record(current)
    if (object === undefined || !Object.hasOwn(object, part)) return undefined
    current = object[part]
  }
  return current
}

function inspectSchema(schema: unknown, root: unknown, seen: Set<unknown>): string | undefined {
  if (typeof schema === 'boolean') return undefined
  const object = record(schema)
  if (object === undefined) return 'schema nodes must be objects or booleans'
  if (seen.has(object)) return 'schema contains an object cycle'
  seen.add(object)
  try {
    const unknownKeyword = Object.keys(object).find(key => !KEYWORDS.has(key) && !key.startsWith('x-'))
    if (unknownKeyword !== undefined) return `unsupported JSON Schema keyword ${unknownKeyword}`
    const selectedTypes = Array.isArray(object.type) ? object.type : [object.type]
    if (
      object.type !== undefined &&
      (selectedTypes.length === 0 ||
        !selectedTypes.every(item => typeof item === 'string' && TYPES.has(item)) ||
        new Set(selectedTypes).size !== selectedTypes.length)
    ) return 'type must contain unique supported JSON types'
    if (object.enum !== undefined && (!Array.isArray(object.enum) || object.enum.length === 0)) {
      return 'enum must be a non-empty array'
    }
    if (object.required !== undefined && (
      !Array.isArray(object.required) ||
      !object.required.every(item => typeof item === 'string') ||
      new Set(object.required).size !== object.required.length
    )) return 'required must contain unique property names'
    for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength'] as const) {
      if (object[keyword] !== undefined && !nonNegativeInteger(object[keyword])) {
        return `${keyword} must be a non-negative safe integer`
      }
    }
    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
      if (object[keyword] !== undefined && (typeof object[keyword] !== 'number' || !Number.isFinite(object[keyword]))) {
        return `${keyword} must be finite`
      }
    }
    if (typeof object.multipleOf === 'number' && object.multipleOf <= 0) return 'multipleOf must be positive'
    if (object.properties !== undefined && record(object.properties) === undefined) return 'properties must be an object'
    if (object.$defs !== undefined && record(object.$defs) === undefined) return '$defs must be an object'
    if (
      object.additionalProperties !== undefined &&
      typeof object.additionalProperties !== 'boolean' &&
      record(object.additionalProperties) === undefined
    ) return 'additionalProperties must be a schema or boolean'
    if (object.items !== undefined && typeof object.items !== 'boolean' && record(object.items) === undefined) {
      return 'items must be one schema'
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = object[keyword]
      if (branches !== undefined && (!Array.isArray(branches) || branches.length === 0)) {
        return `${keyword} must be a non-empty schema array`
      }
    }
    if (object.$ref !== undefined) {
      if (typeof object.$ref !== 'string') return '$ref must be a string'
      const target = resolvePointer(root, object.$ref)
      if (target === undefined) return '$ref must resolve inside this descriptor schema'
    }
    const children: unknown[] = []
    if (record(object.properties) !== undefined) children.push(...Object.values(object.properties as object))
    if (record(object.$defs) !== undefined) children.push(...Object.values(object.$defs as object))
    for (const keyword of ['additionalProperties', 'items', 'not'] as const) {
      if (object[keyword] !== undefined) children.push(object[keyword])
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      if (Array.isArray(object[keyword])) children.push(...object[keyword])
    }
    for (const child of children) {
      const reason = inspectSchema(child, root, seen)
      if (reason !== undefined) return reason
    }
    return undefined
  } finally {
    seen.delete(object)
  }
}

const valueType = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

function evaluate(schema: unknown, value: unknown, root: unknown, path: string, depth: number): string | undefined {
  if (depth > 128) return `${path} exceeds schema evaluation depth`
  if (typeof schema === 'boolean') return schema ? undefined : `${path} is forbidden by schema`
  const object = record(schema)!
  if (typeof object.$ref === 'string') {
    return evaluate(resolvePointer(root, object.$ref), value, root, path, depth + 1)
  }
  if (object.const !== undefined && !same(value, object.const)) return `${path} does not equal const`
  if (Array.isArray(object.enum) && !object.enum.some(item => same(value, item))) return `${path} is outside enum`
  const types = object.type === undefined ? undefined : Array.isArray(object.type) ? object.type : [object.type]
  if (types !== undefined) {
    const actual = valueType(value)
    const accepted = types.some(type => type === actual || (type === 'integer' && actual === 'number' && Number.isInteger(value)))
    if (!accepted) return `${path} must be ${types.join(' or ')}`
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (typeof object.minLength === 'number' && length < object.minLength) return `${path} is shorter than minLength`
    if (typeof object.maxLength === 'number' && length > object.maxLength) return `${path} is longer than maxLength`
  }
  if (typeof value === 'number') {
    if (typeof object.minimum === 'number' && value < object.minimum) return `${path} is below minimum`
    if (typeof object.maximum === 'number' && value > object.maximum) return `${path} is above maximum`
    if (typeof object.exclusiveMinimum === 'number' && value <= object.exclusiveMinimum) return `${path} is below exclusiveMinimum`
    if (typeof object.exclusiveMaximum === 'number' && value >= object.exclusiveMaximum) return `${path} is above exclusiveMaximum`
    if (typeof object.multipleOf === 'number' && Math.abs(value / object.multipleOf - Math.round(value / object.multipleOf)) > 1e-12) return `${path} is not a multipleOf value`
  }
  if (Array.isArray(value)) {
    if (typeof object.minItems === 'number' && value.length < object.minItems) return `${path} has too few items`
    if (typeof object.maxItems === 'number' && value.length > object.maxItems) return `${path} has too many items`
    if (object.uniqueItems === true && value.some((item, index) => value.slice(0, index).some(other => same(item, other)))) return `${path} has duplicate items`
    if (object.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const reason = evaluate(object.items, value[index], root, `${path}/${index}`, depth + 1)
        if (reason !== undefined) return reason
      }
    }
  }
  const valueObject = record(value)
  if (valueObject !== undefined) {
    const properties = record(object.properties) ?? {}
    for (const required of Array.isArray(object.required) ? object.required : []) {
      if (!Object.hasOwn(valueObject, required as string)) return `${path}/${required as string} is required`
    }
    for (const [key, item] of Object.entries(valueObject)) {
      if (Object.hasOwn(properties, key)) {
        const reason = evaluate(properties[key], item, root, `${path}/${key}`, depth + 1)
        if (reason !== undefined) return reason
      } else if (object.additionalProperties === false) return `${path}/${key} is not allowed`
      else if (object.additionalProperties !== undefined && object.additionalProperties !== true) {
        const reason = evaluate(object.additionalProperties, item, root, `${path}/${key}`, depth + 1)
        if (reason !== undefined) return reason
      }
    }
  }
  if (Array.isArray(object.allOf)) {
    for (const branch of object.allOf) {
      const reason = evaluate(branch, value, root, path, depth + 1)
      if (reason !== undefined) return reason
    }
  }
  if (Array.isArray(object.anyOf) && !object.anyOf.some(branch => evaluate(branch, value, root, path, depth + 1) === undefined)) return `${path} matches no anyOf branch`
  if (Array.isArray(object.oneOf) && object.oneOf.filter(branch => evaluate(branch, value, root, path, depth + 1) === undefined).length !== 1) return `${path} must match exactly one oneOf branch`
  if (object.not !== undefined && evaluate(object.not, value, root, path, depth + 1) === undefined) return `${path} matches forbidden schema`
  return undefined
}

/** Compile an inert, CSP-safe JSON Schema subset without eval or generated code. */
export function createServiceOperationSchemaValidator(schema: unknown): ServiceOperationSchemaCompilation {
  const reason = inspectSchema(schema, schema, new Set())
  if (reason !== undefined) return Object.freeze({ valid: false, reason })
  const validator: ServiceOperationSchemaValidator = {
    valid: true as const,
    validate(value: unknown) {
      return evaluate(schema, value, schema, '$', 0)
    },
  }
  return Object.freeze(validator)
}
