/** Generic, schema-driven edit forms and custom field-editor selection. */
import type {
  AnyDescriptor,
  AssetEditPlan,
  AssetOperationDescriptor,
  FieldEditFormField,
  FieldEditFormSpecV1,
  FieldEditInputSchemaV1,
  FieldEditorContributionSpecV1Wire,
  FieldType,
  JsonValue,
  MetadataEntry,
  OperationResult,
  SubjectCandidateProvider,
} from '@modkit/sdk'
import { compareUtf8 } from '@modkit/core'
import { isKnowledgeTarget } from '@modkit/sdk/knowledge'
import { candidateTargetForField, mountSubjectSelector } from '../selector/index.js'
import { setPart } from '../parts.js'

export interface FieldEditorControlV1 {
  read(): JsonValue
  validate(): string | undefined
  unmount?(): void | Promise<void>
}

export interface FieldEditorModuleV1 {
  readonly abiVersion: 1
  mount(args: {
    readonly container: unknown
    readonly field: FieldEditFormField
    readonly initial: JsonValue
    readonly signal: AbortSignal
  }): FieldEditorControlV1 | Promise<FieldEditorControlV1>
}

export interface FieldEditorRegistration {
  readonly spec: FieldEditorContributionSpecV1Wire
  readonly module: FieldEditorModuleV1
}

export interface FieldEditorRegistry {
  resolve(typeId: string, editorId?: string): FieldEditorModuleV1 | undefined
  problem(typeId: string, editorId?: string): string | undefined
}

/**
 * Build one host-scoped registry from activated, inventory-published contributions.
 * Ambiguous duplicate editor ids poison that custom type instead of depending on install order.
 */
export function createFieldEditorRegistry(
  registrations: readonly FieldEditorRegistration[],
  hostId: string,
): FieldEditorRegistry {
  const byType = new Map<string, FieldEditorRegistration[]>()
  const problems = new Map<string, string>()
  for (const registration of registrations) {
    const { spec, module } = registration
    const hosts = object(spec) ? spec['hosts'] : undefined
    if (
      !object(spec) ||
      !onlyKeys(spec, ['fieldTypeId', 'editorId', 'priority', 'hosts']) ||
      typeof spec.fieldTypeId !== 'string' ||
      spec.fieldTypeId.length === 0 ||
      typeof spec.editorId !== 'string' ||
      spec.editorId.length === 0 ||
      !Number.isSafeInteger(spec.priority) ||
      spec.priority < -1_000_000 ||
      spec.priority > 1_000_000 ||
      (hosts !== undefined &&
        (!Array.isArray(hosts) ||
          hosts.length === 0 ||
          hosts.some(host => typeof host !== 'string' || host.length === 0) ||
          new Set(hosts).size !== hosts.length)) ||
      module?.abiVersion !== 1 ||
      typeof module.mount !== 'function'
    ) {
      if (object(spec) && typeof spec['fieldTypeId'] === 'string') {
        problems.set(spec.fieldTypeId, 'the published field editor is malformed')
      }
      continue
    }
    if (Array.isArray(hosts) && !hosts.includes(hostId)) continue
    const list = byType.get(spec.fieldTypeId) ?? []
    if (list.some(item => item.spec.editorId === spec.editorId)) {
      problems.set(
        spec.fieldTypeId,
        `duplicate published field editor «${spec.editorId}» for «${spec.fieldTypeId}»`,
      )
      continue
    }
    list.push(registration)
    byType.set(spec.fieldTypeId, list)
  }
  for (const list of byType.values()) {
    list.sort(
      (left, right) =>
        right.spec.priority - left.spec.priority ||
        compareUtf8(left.spec.editorId, right.spec.editorId),
    )
  }
  return Object.freeze({
    resolve(typeId: string, editorId?: string) {
      if (problems.has(typeId)) return undefined
      const list = byType.get(typeId) ?? []
      return (editorId === undefined ? list[0] : list.find(item => item.spec.editorId === editorId))
        ?.module
    },
    problem(typeId: string, editorId?: string) {
      const problem = problems.get(typeId)
      if (problem !== undefined) return problem
      if ((byType.get(typeId) ?? []).length === 0) {
        return `no published field editor handles «${typeId}» in host «${hostId}»`
      }
      if (
        editorId !== undefined &&
        !(byType.get(typeId) ?? []).some(x => x.spec.editorId === editorId)
      ) {
        return `field editor «${editorId}» is not published for «${typeId}»`
      }
      return undefined
    },
  })
}

export interface EditOperationField extends FieldEditFormField {
  /** Stable compatibility names used by the three thin app renderers. */
  readonly name: string
  readonly kind: 'text' | 'content'
  readonly initial: string
  readonly hint?: string
  readonly initialText: string
  readonly editorId?: string
}

export interface EditOperationForm {
  /** What this form writes, when it writes a file of its own (see `FieldEditFormSpecV1.writes`). */
  readonly writes?: FieldEditFormSpecV1['writes']
  readonly id: string
  readonly label: string
  readonly operationId: string
  readonly handlerId: string
  readonly summary: string
  readonly fields: readonly EditOperationField[]
  build(values: ReadonlyMap<string, JsonValue>): JsonValue
}

export interface UnsupportedEditOperation {
  readonly operationId: string
  readonly handlerId: string
  readonly reason: string
}

export interface EditOffer {
  readonly forms: readonly EditOperationForm[]
  readonly unsupported: readonly UnsupportedEditOperation[]
}

export interface EditOfferOptions {
  readonly editable: boolean
  readonly fieldEditors?: FieldEditorRegistry
}

function parseJsonValue(text: string, label: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    throw new TypeError(`${label} must be valid JSON`)
  }
}

/** Validate and normalize a presentation value according to its portable field type. */
export function fieldValue(field: FieldEditFormField, value: JsonValue): JsonValue {
  const { type } = field
  if (type.kind === 'text' || type.kind === 'text-key' || type.kind === 'script') {
    const text = String(value ?? '')
    if (type.kind === 'text') {
      if (type.maxLength !== undefined && text.length > type.maxLength) {
        throw new TypeError(`${field.label} must contain at most ${type.maxLength} characters`)
      }
      if (type.pattern !== undefined && !new RegExp(type.pattern, 'u').test(text)) {
        throw new TypeError(`${field.label} does not match its required pattern`)
      }
    }
    return text
  }
  if (
    type.kind === 'duration' ||
    type.kind === 'date' ||
    type.kind === 'bytes' ||
    type.kind === 'id' ||
    type.kind === 'path' ||
    type.kind === 'subject-ref' ||
    type.kind === 'asset-ref'
  ) {
    return String(value ?? '')
  }
  if (type.kind === 'number') {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number)) throw new TypeError(`${field.label} must be a number`)
    if (type.integer === true && !Number.isInteger(number)) {
      throw new TypeError(`${field.label} must be an integer`)
    }
    if (type.min !== undefined && number < type.min) {
      throw new TypeError(`${field.label} must be at least ${type.min}`)
    }
    if (type.max !== undefined && number > type.max) {
      throw new TypeError(`${field.label} must be at most ${type.max}`)
    }
    return number
  }
  if (type.kind === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw new TypeError(`${field.label} must be true or false`)
  }
  if (type.kind === 'enum') {
    const id = String(value)
    if (!type.members.some(member => member.id === id) && type.unknown === undefined) {
      throw new TypeError(`${field.label} must be one of its published values`)
    }
    return id
  }
  if (type.kind === 'color') return String(value)
  if (type.kind === 'flags') {
    const ids = Array.isArray(value)
      ? value.map(String)
      : String(value)
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
    if (ids.some(id => !type.members.some(member => member.id === id))) {
      throw new TypeError(`${field.label} contains an unpublished flag`)
    }
    return ids
  }
  if (type.kind === 'vector') {
    const vector = Array.isArray(value) ? value : parseJsonValue(String(value), field.label)
    if (
      !Array.isArray(vector) ||
      vector.length !== type.size ||
      vector.some(item => typeof item !== 'number' || !Number.isFinite(item))
    ) {
      throw new TypeError(`${field.label} must contain ${type.size} finite numbers`)
    }
    return vector
  }
  if (
    type.kind === 'struct' ||
    type.kind === 'array' ||
    type.kind === 'record' ||
    type.kind === 'instructions' ||
    type.kind === 'json'
  ) {
    return typeof value === 'string' ? parseJsonValue(value, field.label) : value
  }
  return value
}

/** Mount either a built-in portable control or an activated custom editor module. */
export async function mountFieldEditor(
  container: HTMLElement,
  field: EditOperationField,
  signal: AbortSignal,
  registry?: FieldEditorRegistry,
  editorId?: string,
  candidates?: SubjectCandidateProvider,
): Promise<FieldEditorControlV1> {
  if (field.type.kind === 'custom') {
    const module = registry?.resolve(field.type.typeId, editorId)
    if (module === undefined) {
      throw new TypeError(
        registry?.problem(field.type.typeId, editorId) ??
          `unsupported custom field type «${field.type.typeId}»`,
      )
    }
    const control = await module.mount({
      container,
      field,
      initial: field.initial ?? '',
      signal,
    })
    if (
      typeof control !== 'object' ||
      control === null ||
      typeof control.read !== 'function' ||
      typeof control.validate !== 'function'
    ) {
      throw new TypeError(`custom field editor for «${field.type.typeId}» returned no control`)
    }
    return control
  }
  if (field.type.kind === 'subject-ref' || field.type.kind === 'asset-ref') {
    if (candidates !== undefined) {
      const target = candidateTargetForField(field.type)
      if (target === undefined) throw new TypeError('reference field has no selector target')
      const selector = await mountSubjectSelector(container, {
        candidates,
        target,
        initial: field.initialText,
        signal,
      })
      return Object.freeze({
        read: () => fieldValue(field, selector.read()),
        validate: () => selector.validate(),
        unmount: () => selector.destroy(),
      })
    }
    const unavailable = container.ownerDocument.createElement('input')
    unavailable.type = 'text'
    unavailable.value = field.initialText
    unavailable.disabled = true
    unavailable.setAttribute('name', field.key)
    unavailable.setAttribute('aria-label', field.label)
    setPart(unavailable, 'form.input')
    container.append(unavailable)
    return Object.freeze({
      read: () => fieldValue(field, unavailable.value),
      validate: () => 'subject candidate source is unavailable',
      unmount: () => unavailable.remove(),
    })
  }
  const document = container.ownerDocument
  const input =
    field.type.kind === 'enum'
      ? document.createElement('select')
      : field.type.kind === 'script' ||
          field.type.kind === 'struct' ||
          field.type.kind === 'array' ||
          field.type.kind === 'record' ||
          field.type.kind === 'instructions' ||
          field.type.kind === 'json'
        ? document.createElement('textarea')
        : document.createElement('input')
  input.setAttribute('name', field.key)
  input.setAttribute('aria-label', field.label)
  setPart(input, 'form.input')
  if (input instanceof HTMLSelectElement && field.type.kind === 'enum') {
    for (const member of field.type.members) {
      const option = document.createElement('option')
      option.value = member.id
      option.textContent = member.label ?? member.id
      input.append(option)
    }
    input.value = field.initialText
  } else if (input instanceof HTMLInputElement) {
    input.type =
      field.type.kind === 'boolean' ? 'checkbox' : field.type.kind === 'number' ? 'number' : 'text'
    if (field.type.kind === 'boolean') input.checked = field.initialText === 'true'
    else input.value = field.initialText
  } else {
    input.value = field.initialText
  }
  container.append(input)
  return Object.freeze({
    read(): JsonValue {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked
      return fieldValue(field, input.value)
    },
    validate(): string | undefined {
      try {
        fieldValue(
          field,
          input instanceof HTMLInputElement && input.type === 'checkbox'
            ? input.checked
            : input.value,
        )
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    unmount() {
      input.remove()
    },
  })
}

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const onlyKeys = (value: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean =>
  Object.keys(value).every(key => allowed.includes(key))

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

function validJson(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
  depth = 0,
): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    return false
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  const next = new Set(ancestors).add(value)
  if (Array.isArray(value)) {
    if (Object.getOwnPropertyNames(value).length !== value.length + 1) return false
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !('value' in descriptor) ||
        !validJson(descriptor.value, next, depth + 1)
      )
        return false
    }
    return true
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Object.entries(descriptors).every(
    ([, descriptor]) =>
      descriptor.enumerable === true &&
      'value' in descriptor &&
      validJson(descriptor.value, next, depth + 1),
  )
}

const validStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(nonEmptyString)

function validJsonSchemaRef(value: unknown): boolean {
  return (
    object(value) &&
    onlyKeys(value, ['$ref', 'document']) &&
    nonEmptyString(value['$ref']) &&
    (value['document'] === undefined || validJson(value['document']))
  )
}

function validSubjectFilter(value: unknown): boolean {
  if (
    !object(value) ||
    !onlyKeys(value, ['type', 'sameTypeAs', 'text', 'requireTags', 'excludeTags', 'predicate'])
  )
    return false
  if (value['type'] !== undefined && !nonEmptyString(value['type'])) return false
  if (value['sameTypeAs'] !== undefined && !nonEmptyString(value['sameTypeAs'])) return false
  if (value['text'] !== undefined && typeof value['text'] !== 'string') return false
  if (value['requireTags'] !== undefined && !validStringArray(value['requireTags'])) return false
  if (value['excludeTags'] !== undefined && !validStringArray(value['excludeTags'])) return false
  if (value['predicate'] !== undefined) {
    const predicate = value['predicate']
    if (
      !object(predicate) ||
      !onlyKeys(predicate, ['id', 'params']) ||
      !nonEmptyString(predicate['id']) ||
      (predicate['params'] !== undefined && !validJson(predicate['params']))
    )
      return false
  }
  return true
}

function validFieldSchema(value: unknown, depth: number): boolean {
  return (
    object(value) &&
    onlyKeys(value, ['key', 'label', 'type', 'cardinality', 'description', 'knowledgeTarget']) &&
    nonEmptyString(value['key']) &&
    typeof value['label'] === 'string' &&
    validFieldType(value['type'], depth + 1) &&
    (value['cardinality'] === undefined ||
      value['cardinality'] === 'scalar' ||
      value['cardinality'] === 'append' ||
      value['cardinality'] === 'indexed') &&
    (value['description'] === undefined || typeof value['description'] === 'string') &&
    (value['knowledgeTarget'] === undefined || isKnowledgeTarget(value['knowledgeTarget']))
  )
}

function validFieldType(type: unknown, depth = 0): type is FieldType {
  if (!object(type) || typeof type['kind'] !== 'string' || depth > 16) return false
  switch (type['kind']) {
    case 'text':
      return (
        onlyKeys(type, ['kind', 'multiline', 'pattern', 'maxLength']) &&
        (type['multiline'] === undefined || typeof type['multiline'] === 'boolean') &&
        (type['pattern'] === undefined || typeof type['pattern'] === 'string') &&
        (type['maxLength'] === undefined ||
          (Number.isSafeInteger(type['maxLength']) && Number(type['maxLength']) >= 0))
      )
    case 'number':
      return (
        onlyKeys(type, ['kind', 'min', 'max', 'integer', 'unit']) &&
        (type['min'] === undefined ||
          (typeof type['min'] === 'number' && Number.isFinite(type['min']))) &&
        (type['max'] === undefined ||
          (typeof type['max'] === 'number' && Number.isFinite(type['max']))) &&
        (type['integer'] === undefined || typeof type['integer'] === 'boolean') &&
        (type['unit'] === undefined || typeof type['unit'] === 'string')
      )
    case 'boolean':
      return onlyKeys(type, ['kind'])
    case 'duration':
    case 'date':
    case 'bytes':
    case 'id':
    case 'path':
      return onlyKeys(type, ['kind'])
    case 'text-key':
      return (
        onlyKeys(type, ['kind', 'catalog']) &&
        (type['catalog'] === undefined || nonEmptyString(type['catalog']))
      )
    case 'script':
      return onlyKeys(type, ['kind', 'language']) && nonEmptyString(type['language'])
    case 'json':
      return (
        onlyKeys(type, ['kind', 'schema']) &&
        (type['schema'] === undefined || validJsonSchemaRef(type['schema']))
      )
    case 'enum':
    case 'flags':
      return (
        onlyKeys(
          type,
          type['kind'] === 'enum' ? ['kind', 'members', 'unknown'] : ['kind', 'members'],
        ) &&
        Array.isArray(type['members']) &&
        type['members'].every(
          member =>
            object(member) &&
            onlyKeys(member, ['id', 'label']) &&
            nonEmptyString(member['id']) &&
            (member['label'] === undefined || typeof member['label'] === 'string'),
        ) &&
        new Set(type['members'].map(member => (object(member) ? member['id'] : undefined))).size ===
          type['members'].length
      )
    case 'color':
      return (
        onlyKeys(type, ['kind', 'model']) &&
        (type['model'] === 'rgb' || type['model'] === 'rgba' || type['model'] === 'argb')
      )
    case 'vector':
      return (
        onlyKeys(type, ['kind', 'size', 'unit']) &&
        (type['size'] === 2 || type['size'] === 3 || type['size'] === 4) &&
        (type['unit'] === undefined || typeof type['unit'] === 'string')
      )
    case 'subject-ref':
      return (
        onlyKeys(type, ['kind', 'subjectKind', 'filter']) &&
        nonEmptyString(type['subjectKind']) &&
        (type['filter'] === undefined || validSubjectFilter(type['filter']))
      )
    case 'asset-ref': {
      const accepts = type['accepts']
      return (
        onlyKeys(type, ['kind', 'accepts']) &&
        object(accepts) &&
        onlyKeys(accepts, ['formatIds', 'traits']) &&
        (accepts['formatIds'] === undefined || validStringArray(accepts['formatIds'])) &&
        (accepts['traits'] === undefined || validStringArray(accepts['traits']))
      )
    }
    case 'struct': {
      const fields = type['fields']
      return (
        onlyKeys(type, ['kind', 'fields']) &&
        Array.isArray(fields) &&
        fields.every(field => validFieldSchema(field, depth + 1)) &&
        new Set(fields.map(field => (object(field) ? field['key'] : undefined))).size ===
          fields.length
      )
    }
    case 'array':
      return (
        onlyKeys(type, ['kind', 'item', 'max']) &&
        validFieldType(type['item'], depth + 1) &&
        (type['max'] === undefined ||
          (Number.isSafeInteger(type['max']) && Number(type['max']) >= 0))
      )
    case 'record':
      return (
        onlyKeys(type, ['kind', 'key', 'value']) &&
        validFieldType(type['key'], depth + 1) &&
        validFieldType(type['value'], depth + 1)
      )
    case 'instructions': {
      const keywords = type['keywords']
      return (
        onlyKeys(type, ['kind', 'keywords', 'delimiter', 'listDelimiter']) &&
        object(keywords) &&
        typeof type['delimiter'] === 'string' &&
        (type['listDelimiter'] === undefined || typeof type['listDelimiter'] === 'string') &&
        Object.values(keywords).every(
          fields =>
            Array.isArray(fields) && fields.every(field => validFieldType(field, depth + 1)),
        )
      )
    }
    case 'custom':
      return (
        onlyKeys(type, ['kind', 'typeId', 'params']) &&
        nonEmptyString(type['typeId']) &&
        (type['params'] === undefined || validJson(type['params']))
      )
    default:
      return false
  }
}

/** A declared write target: format, optional encoding, and what the file is called. */
function validWrites(value: unknown): boolean {
  if (!object(value) || !onlyKeys(value, ['format', 'encoding', 'extension', 'mediaType'])) {
    return false
  }
  const named = (candidate: unknown): boolean =>
    object(candidate) &&
    onlyKeys(candidate, ['id', 'label']) &&
    nonEmptyString(candidate['id']) &&
    nonEmptyString(candidate['label'])
  return (
    named(value['format']) &&
    (value['encoding'] === undefined || named(value['encoding'])) &&
    nonEmptyString(value['extension']) &&
    nonEmptyString(value['mediaType'])
  )
}

function parseSchema(value: unknown): FieldEditInputSchemaV1 | undefined {
  if (
    !validJson(value) ||
    !object(value) ||
    !onlyKeys(value, ['schemaVersion', 'forms']) ||
    value['schemaVersion'] !== 1 ||
    !Array.isArray(value['forms']) ||
    value['forms'].length === 0
  )
    return undefined
  const ids = new Set<string>()
  for (const form of value['forms']) {
    if (
      !object(form) ||
      !onlyKeys(form, ['id', 'label', 'summary', 'binding', 'fields', 'baseInput', 'writes']) ||
      typeof form['id'] !== 'string' ||
      form['id'].length === 0 ||
      ids.has(form['id']) ||
      typeof form['label'] !== 'string' ||
      typeof form['summary'] !== 'string' ||
      !Array.isArray(form['fields']) ||
      // A preset (fixed `baseInput`, nothing to fill in) is the one form without controls.
      (form['fields'].length === 0 && form['baseInput'] === undefined)
    ) {
      return undefined
    }
    if (
      form['baseInput'] !== undefined &&
      (!object(form['baseInput']) ||
        Object.keys(form['baseInput']).some(
          key => key === '__proto__' || key === 'constructor' || key === 'prototype',
        ))
    )
      return undefined
    if (form['writes'] !== undefined && !validWrites(form['writes'])) return undefined
    ids.add(form['id'])
    if (
      form['binding'] !== undefined &&
      (!object(form['binding']) ||
        !onlyKeys(form['binding'], ['groupId', 'entryKey']) ||
        !nonEmptyString(form['binding']['groupId']) ||
        (form['binding']['entryKey'] !== undefined && !nonEmptyString(form['binding']['entryKey'])))
    ) {
      return undefined
    }
    const keys = new Set<string>()
    const paths = new Set<string>()
    for (const field of form['fields']) {
      if (
        !object(field) ||
        !onlyKeys(field, [
          'key',
          'label',
          'type',
          'cardinality',
          'description',
          'knowledgeTarget',
          'inputPath',
          'required',
          'initial',
          'source',
          'encoding',
        ]) ||
        typeof field['key'] !== 'string' ||
        field['key'].length === 0 ||
        keys.has(field['key']) ||
        typeof field['label'] !== 'string' ||
        !validFieldType(field['type']) ||
        (field['cardinality'] !== undefined &&
          field['cardinality'] !== 'scalar' &&
          field['cardinality'] !== 'append' &&
          field['cardinality'] !== 'indexed') ||
        (field['description'] !== undefined && typeof field['description'] !== 'string') ||
        (field['knowledgeTarget'] !== undefined && !isKnowledgeTarget(field['knowledgeTarget'])) ||
        !Array.isArray(field['inputPath']) ||
        field['inputPath'].length === 0 ||
        field['inputPath'].some(
          segment =>
            !(
              (typeof segment === 'string' && segment.length > 0) ||
              (Number.isSafeInteger(segment) && Number(segment) >= 0)
            ),
        ) ||
        (field['required'] !== undefined && typeof field['required'] !== 'boolean') ||
        (field['initial'] !== undefined && !validJson(field['initial'])) ||
        (field['source'] !== undefined &&
          field['source'] !== 'entry-key' &&
          field['source'] !== 'entry-value') ||
        (field['encoding'] !== undefined && field['encoding'] !== 'utf8-base64')
      ) {
        return undefined
      }
      const firstSegment = field['inputPath'][0]
      if (
        object(form['baseInput']) &&
        (typeof firstSegment === 'string' || typeof firstSegment === 'number') &&
        Object.hasOwn(form['baseInput'], firstSegment)
      )
        return undefined
      const path = JSON.stringify(field['inputPath'])
      const segments = field['inputPath'] as readonly (string | number)[]
      if (
        segments.some(
          segment =>
            typeof segment === 'string' &&
            (segment === '__proto__' || segment === 'prototype' || segment === 'constructor'),
        ) ||
        paths.has(path) ||
        [...paths].some(existing => {
          const other = JSON.parse(existing) as readonly (string | number)[]
          const common = Math.min(other.length, segments.length)
          return (
            other.slice(0, common).every((segment, index) => segment === segments[index]) &&
            other.length !== segments.length
          )
        })
      )
        return undefined
      keys.add(field['key'])
      paths.add(path)
    }
  }
  return value as unknown as FieldEditInputSchemaV1
}

function metadataEntries(descriptor: AnyDescriptor, groupId: string): readonly MetadataEntry[] {
  if (!('metadata' in descriptor)) return []
  return descriptor.metadata.find(group => group.id === groupId)?.entries ?? []
}

function selectedEntry(
  descriptor: AnyDescriptor,
  form: FieldEditFormSpecV1,
  operationId: string,
): MetadataEntry | undefined {
  if (form.binding === undefined) return undefined
  const entries = metadataEntries(descriptor, form.binding.groupId)
  const matches = (entry: MetadataEntry) => {
    const editable = entry.editable
    return (
      editable !== undefined &&
      'operation' in editable.write &&
      editable.write.operation === operationId
    )
  }
  if (form.binding.entryKey !== undefined) {
    const entry = entries.find(item => item.key === form.binding?.entryKey)
    return entry !== undefined && matches(entry) ? entry : undefined
  }
  return entries.find(matches)
}

function scalarText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' as const

export function base64OfUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] ?? 0
    const second = bytes[at + 1]
    const third = bytes[at + 2]
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    out += BASE64[(triple >> 18) & 63] ?? ''
    out += BASE64[(triple >> 12) & 63] ?? ''
    out += second === undefined ? '=' : (BASE64[(triple >> 6) & 63] ?? '')
    out += third === undefined ? '=' : (BASE64[triple & 63] ?? '')
  }
  return out
}

function setAtPath(
  root: Record<string, JsonValue>,
  path: readonly (string | number)[],
  value: JsonValue,
) {
  let current: Record<string, JsonValue> | JsonValue[] = root
  path.forEach((segment, index) => {
    const last = index === path.length - 1
    if (last) {
      ;(current as Record<string | number, JsonValue>)[segment] = value
      return
    }
    const next = path[index + 1]
    const child = typeof next === 'number' ? [] : {}
    const existing = (current as Record<string | number, JsonValue>)[segment]
    if (existing === undefined) (current as Record<string | number, JsonValue>)[segment] = child
    current = (existing ?? child) as Record<string, JsonValue> | JsonValue[]
  })
}

function resolveForm(
  operation: AssetOperationDescriptor,
  spec: FieldEditFormSpecV1,
  entry: MetadataEntry | undefined,
): EditOperationForm {
  const fields = Object.freeze(
    spec.fields.map(field => {
      const sourced =
        field.source === 'entry-key'
          ? entry?.key
          : field.source === 'entry-value'
            ? entry?.value
            : field.initial
      const initialText = scalarText(
        sourced === null || sourced === undefined ? field.initial : sourced,
      )
      return Object.freeze({
        ...field,
        name: field.key,
        kind: field.encoding === 'utf8-base64' ? ('content' as const) : ('text' as const),
        initial: initialText,
        ...(field.description === undefined ? {} : { hint: field.description }),
        ...(entry?.editable?.editor === undefined ? {} : { editorId: entry.editable.editor }),
        initialText,
      })
    }),
  )
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    operationId: operation.id,
    handlerId: operation.handlerId,
    summary: spec.summary,
    fields,
    ...(spec.writes === undefined ? {} : { writes: spec.writes }),
    build(values: ReadonlyMap<string, JsonValue>): JsonValue {
      const input: Record<string, JsonValue> =
        spec.baseInput === undefined
          ? {}
          : (JSON.parse(JSON.stringify(spec.baseInput)) as Record<string, JsonValue>)
      for (const field of fields) {
        let value = values.get(field.key)
        if (value === undefined) value = field.initial ?? ''
        if (field.required === true && (value === '' || value === null)) {
          throw new TypeError(`${field.label} is required`)
        }
        value = fieldValue(field, value)
        if (field.encoding === 'utf8-base64') value = base64OfUtf8(String(value ?? ''))
        setAtPath(input, field.inputPath, value)
      }
      if (operation.id === 'edit.field') {
        if (spec.binding === undefined)
          throw new TypeError('field edit form has no editable binding')
        input['groupId'] = spec.binding.groupId
        if (input['key'] === undefined) input['key'] = entry?.key ?? spec.binding.entryKey ?? ''
      }
      return input
    },
  })
}

/**
 * Forms for an operation that has no subject of its own — a service operation an extension
 * publishes, reached by a viewer with the pixels or text already in hand.
 *
 * Same schema as a codec's `edit.content`, same controls, same `build`; what is missing is the
 * descriptor, so nothing here can bind to a metadata entry.
 */
export function operationForms(
  operationId: string,
  handlerId: string,
  inputSchemaDocument: unknown,
): readonly EditOperationForm[] {
  const schema = parseSchema(inputSchemaDocument)
  if (schema === undefined) return Object.freeze([])
  const operation = { id: operationId, handlerId } as unknown as AssetOperationDescriptor
  return Object.freeze(schema.forms.map(spec => resolveForm(operation, spec, undefined)))
}

/** Resolve forms solely from published operation schemas and descriptor field bindings. */
export function editOffer(descriptor: AnyDescriptor, options: EditOfferOptions): EditOffer {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] })
  const forms: EditOperationForm[] = []
  const unsupported: UnsupportedEditOperation[] = []
  for (const operation of descriptor.operations) {
    if (!operation.mutatesSource || operation.state !== 'available') continue
    const schema = parseSchema(operation.inputSchema?.document)
    if (schema === undefined) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason:
          operation.inputSchema === undefined
            ? 'the operation did not publish an input schema'
            : 'the published input schema is missing or malformed',
      })
      continue
    }
    let rejected: string | undefined
    for (const spec of schema.forms) {
      const entry = selectedEntry(descriptor, spec, operation.id)
      if (operation.id === 'edit.field' && entry === undefined) {
        rejected = 'the descriptor has no matching editable field binding'
        break
      }
      if (entry !== undefined && entry.type === undefined) {
        rejected = 'the editable descriptor field has no field schema type'
        break
      }
      for (const field of spec.fields) {
        if (field.type.kind === 'custom') {
          const editorId = entry?.editable?.editor
          const problem = options.fieldEditors?.problem(field.type.typeId, editorId)
          if (
            problem !== undefined ||
            options.fieldEditors?.resolve(field.type.typeId, editorId) === undefined
          ) {
            rejected = problem ?? `unsupported custom field type «${field.type.typeId}»`
            break
          }
        }
      }
      if (rejected !== undefined) break
      forms.push(resolveForm(operation, spec, entry))
    }
    if (rejected !== undefined) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: rejected,
      })
    }
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) })
}

/**
 * Presets a non-mutating operation publishes through the same form schema — e.g. the
 * `export.convert` targets of an image. The result is bytes for a new file, never an edit plan, so
 * these are offered to export surfaces, not to the edit panel.
 */
export function exportOffer(
  descriptor: AnyDescriptor,
  operationId = 'export.convert',
): readonly EditOperationForm[] {
  const forms: EditOperationForm[] = []
  for (const operation of descriptor.operations) {
    if (operation.id !== operationId || operation.mutatesSource || operation.state !== 'available')
      continue
    const schema = parseSchema(operation.inputSchema?.document)
    for (const spec of schema?.forms ?? []) {
      if (spec.binding !== undefined || spec.fields.some(field => field.type.kind === 'custom'))
        continue
      forms.push(resolveForm(operation, spec, undefined))
    }
  }
  return Object.freeze(forms)
}

export function offersEditPanel(descriptor: AnyDescriptor, options: EditOfferOptions): boolean {
  return editOffer(descriptor, options).forms.length > 0
}

export function declaredMutatingOperations(
  descriptor: AnyDescriptor,
): readonly AssetOperationDescriptor[] {
  return descriptor.operations.filter(operation => operation.mutatesSource)
}

const INVOKE_REASONS: Readonly<Record<string, string>> = Object.freeze({
  'not-declared': 'this codec does not declare that operation',
  disabled: 'the codec disabled this operation for this file',
  'dependency-required': 'the operation needs a dependency this host has not resolved',
  'permission-missing': 'this subject was opened without permission to write the file',
  'input-not-serializable': 'the values could not be sent to the codec',
  'handler-unregistered': 'the codec registered no handler for that operation',
  cancelled: 'the operation was cancelled',
  'stale-revision': 'the file changed after this tab opened it',
})

export function invokeRefusalMessage(result: {
  readonly reason: string
  readonly diagnostics?: readonly { readonly message: string }[]
}): string {
  const plain = INVOKE_REASONS[result.reason]
  const detail = result.diagnostics?.[0]?.message
  const head = plain === undefined ? result.reason : `${plain} (${result.reason})`
  return detail === undefined ? `refused: ${head}` : `refused: ${head} — ${detail}`
}

export function fidelityNote(plan: AssetEditPlan): string {
  if (plan.fidelity.preservesUnknownData) return ''
  const notes = plan.fidelity.notes ?? []
  return notes.length === 0
    ? ' (this rewrite does not keep bytes the format does not account for)'
    : ` (${notes.join('; ')})`
}

export const isRejected = (
  result: OperationResult,
): result is Extract<OperationResult, { state: 'rejected' }> => result.state === 'rejected'
