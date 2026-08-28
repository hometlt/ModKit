import { analyzeWarzoneResolvedData } from './data-provider.js'

const GAME_ID = 'org.modkitx/warzone-2100'
const ANALYZER_ID = 'org.modkitx.opensource.warzone2100.data-resource-bindings'
export const WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT =
  'org.modkitx.opensource.warzone2100/object-resource-binding'
const MAXIMUM_OBJECT_DOCUMENTS = 16
const MAXIMUM_OBJECT_TEXT_BYTES = 16_777_216
const MAXIMUM_OBJECTS = 10_000
const MAXIMUM_RESOURCE_ENTRIES = 20_000
const MAXIMUM_MODEL_DOCUMENTS = 1_024
const MAXIMUM_MODEL_TEXT_BYTES = 67_108_864
const MAXIMUM_MODEL_REFERENCES = 100_000
const MAXIMUM_DIAGNOSTICS = 2_048
const MAXIMUM_LOGICAL_PATH_CHARS = 4_096
const encoder = new TextEncoder()

const TEXTURE_DIRECTIVES = new Set([
  'TEXTURE',
  'BASE',
  'TCMASK',
  'TEAM',
  'NORMALMAP',
  'NORMAL',
  'NORM',
  'SPECULARMAP',
  'SPECULAR',
  'SPEC',
])

const MAP_TABLES = Object.freeze([
  Object.freeze({
    suffix: '/droid.json',
    kind: 'droid',
    field: 'template',
    namespace: 'warzone.templates',
  }),
  Object.freeze({
    suffix: '/struct.json',
    kind: 'structure',
    field: 'name',
    namespace: 'warzone.structures',
  }),
  Object.freeze({
    suffix: '/feature.json',
    kind: 'feature',
    field: 'name',
    namespace: 'warzone.features',
  }),
])

const COMPONENT_FIELDS = Object.freeze({
  'warzone.templates': Object.freeze([
    Object.freeze({ field: 'body', namespace: 'warzone.bodies' }),
    Object.freeze({ field: 'brain', namespace: 'warzone.brains' }),
    Object.freeze({ field: 'construct', namespace: 'warzone.constructors' }),
    Object.freeze({ field: 'propulsion', namespace: 'warzone.propulsions' }),
    Object.freeze({ field: 'repair', namespace: 'warzone.repairs' }),
    Object.freeze({ field: 'sensor', namespace: 'warzone.sensors' }),
    Object.freeze({ field: 'weapons', namespace: 'warzone.weapons' }),
  ]),
  'warzone.structures': Object.freeze([
    Object.freeze({ field: 'ecmID', namespace: 'warzone.ecm' }),
    Object.freeze({ field: 'sensorID', namespace: 'warzone.sensors' }),
    Object.freeze({ field: 'weapons', namespace: 'warzone.weapons' }),
  ]),
  'warzone.features': Object.freeze([]),
})

const MODEL_FIELDS = Object.freeze({
  'warzone.structures': Object.freeze(['baseModel', 'structureModel']),
  'warzone.features': Object.freeze(['model']),
  'warzone.bodies': Object.freeze(['model']),
  'warzone.constructors': Object.freeze(['mountModel', 'sensorModel']),
  'warzone.ecm': Object.freeze(['sensorModel']),
  'warzone.propulsions': Object.freeze(['model']),
  'warzone.sensors': Object.freeze(['mountModel', 'sensorModel']),
  'warzone.weapons': Object.freeze([
    'model',
    'mountModel',
    'muzzleGfx',
    'flightGfx',
    'hitGfx',
    'missGfx',
    'waterGfx',
  ]),
})

export const WARZONE_RESOURCE_BINDING_LIMITS = Object.freeze({
  maxObjectDocuments: MAXIMUM_OBJECT_DOCUMENTS,
  maxObjectTextBytes: MAXIMUM_OBJECT_TEXT_BYTES,
  maxObjects: MAXIMUM_OBJECTS,
  maxResourceEntries: MAXIMUM_RESOURCE_ENTRIES,
  maxModelDocuments: MAXIMUM_MODEL_DOCUMENTS,
  maxModelTextBytes: MAXIMUM_MODEL_TEXT_BYTES,
  maxModelReferences: MAXIMUM_MODEL_REFERENCES,
  maxDiagnostics: MAXIMUM_DIAGNOSTICS,
})

export const WARZONE_RESOURCE_BINDING_PROVENANCE = Object.freeze({
  repository: 'https://github.com/Warzone2100/warzone2100',
  revision: 'cbb1eb1515da60893595eef2868f4dcef8c37f1c',
  loaders: Object.freeze([
    'src/stats.cpp:statsGetIMD',
    'src/stats.cpp:loadWeaponStats',
    'src/stats.cpp:loadBodyStats',
    'src/stats.cpp:loadPropulsionStats',
    'src/stats.cpp:loadSensorStats',
    'src/stats.cpp:loadECMStats',
    'src/stats.cpp:loadConstructStats',
    'src/structure.cpp:loadStructureStats',
    'src/feature.cpp:loadFeatureStats',
  ]),
  statement:
    'Stats fields are treated as logical model ids exactly where the official 4.7 loaders call statsGetIMD or modelGet; archive paths and PIE texture directives require separate observed inputs.',
})

function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function positiveLimit(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function logicalPath(value, label) {
  nonEmptyString(value, label)
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    normalized.length > MAXIMUM_LOGICAL_PATH_CHARS ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some(part => part.length === 0 || part === '..')
  ) {
    throw new TypeError(`${label} must be a confined logical path`)
  }
  return normalized
}

function scalarStrings(value) {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(scalarStrings)
  return []
}

function validateRequest(request) {
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('Warzone resource binding request must be an object')
  nonEmptyString(value.workspaceId, 'workspaceId')
  if (value.gameId !== GAME_ID) {
    throw new TypeError(`Warzone resource binding analysis cannot inspect ${String(value.gameId)}`)
  }
  if (!Array.isArray(value.documents)) throw new TypeError('documents must be an array')
  if (!Array.isArray(value.objectDocuments)) throw new TypeError('objectDocuments must be an array')
  if (value.objectDocuments.length > MAXIMUM_OBJECT_DOCUMENTS) {
    throw new TypeError(`objectDocuments must contain at most ${MAXIMUM_OBJECT_DOCUMENTS} entries`)
  }
  let objectTextBytes = 0
  for (const [index, document] of value.objectDocuments.entries()) {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`objectDocuments[${index}] must be an object`)
    if (typeof item.text !== 'string') {
      throw new TypeError(`objectDocuments[${index}].text must be a string`)
    }
    objectTextBytes += encoder.encode(item.text).byteLength
  }
  if (objectTextBytes > MAXIMUM_OBJECT_TEXT_BYTES) {
    throw new TypeError(
      `object document text exceeds ${MAXIMUM_OBJECT_TEXT_BYTES} bytes (${objectTextBytes})`,
    )
  }
  if (!Array.isArray(value.resourceEntries)) throw new TypeError('resourceEntries must be an array')
  if (value.resourceEntries.length > MAXIMUM_RESOURCE_ENTRIES) {
    throw new TypeError(`resourceEntries must contain at most ${MAXIMUM_RESOURCE_ENTRIES} entries`)
  }
  const modelDocuments = value.modelDocuments ?? []
  if (!Array.isArray(modelDocuments) || modelDocuments.length > MAXIMUM_MODEL_DOCUMENTS) {
    throw new TypeError(`modelDocuments must contain at most ${MAXIMUM_MODEL_DOCUMENTS} entries`)
  }
  const maxObjects = positiveLimit(value.maxObjects, 'maxObjects', MAXIMUM_OBJECTS)
  const maxModelReferences = positiveLimit(
    value.maxModelReferences,
    'maxModelReferences',
    MAXIMUM_MODEL_REFERENCES,
  )
  const maxDiagnostics = positiveLimit(value.maxDiagnostics, 'maxDiagnostics', MAXIMUM_DIAGNOSTICS)
  let modelTextBytes = 0
  for (const [index, document] of modelDocuments.entries()) {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`modelDocuments[${index}] must be an object`)
    nonEmptyString(item.rootId, `modelDocuments[${index}].rootId`)
    logicalPath(item.path, `modelDocuments[${index}].path`)
    if (typeof item.text !== 'string') {
      throw new TypeError(`modelDocuments[${index}].text must be a string`)
    }
    modelTextBytes += encoder.encode(item.text).byteLength
  }
  if (modelTextBytes > MAXIMUM_MODEL_TEXT_BYTES) {
    throw new TypeError(
      `model document text exceeds ${MAXIMUM_MODEL_TEXT_BYTES} bytes (${modelTextBytes})`,
    )
  }
  return { ...value, modelDocuments, maxObjects, maxModelReferences, maxDiagnostics }
}

function resourceIndex(entries) {
  const effective = new Map()
  for (const [index, input] of entries.entries()) {
    const item =
      typeof input === 'string' ? { rootId: 'resource-index', path: input } : recordOf(input)
    if (item === undefined)
      throw new TypeError(`resourceEntries[${index}] must be a path or object`)
    const rootId = nonEmptyString(item.rootId, `resourceEntries[${index}].rootId`)
    const path = logicalPath(item.path, `resourceEntries[${index}].path`)
    effective.set(
      path.toLowerCase(),
      Object.freeze({
        rootId,
        path,
        ...(item.revision === undefined ? {} : { revision: item.revision }),
      }),
    )
  }
  const byBasename = new Map()
  for (const entry of effective.values()) {
    const basename = entry.path.split('/').at(-1).toLowerCase()
    const values = byBasename.get(basename) ?? []
    values.push(entry)
    byBasename.set(basename, values)
  }
  return { effective, byBasename }
}

function modelDocumentIndex(documents) {
  const effective = new Map()
  for (const document of documents) {
    const path = logicalPath(document.path, 'model document path')
    effective.set(path.toLowerCase(), Object.freeze({ ...document, path }))
  }
  return effective
}

function bindingState(logicalId, index) {
  const normalized = logicalPath(logicalId, 'model logical id')
  if (normalized.includes('/')) {
    const exact = index.effective.get(normalized.toLowerCase())
    return exact === undefined
      ? Object.freeze({ state: 'missing' })
      : Object.freeze({ state: 'resolved', resource: exact })
  }
  const basename = normalized.toLowerCase()
  const candidates = index.byBasename.get(basename) ?? []
  if (candidates.length === 0) return Object.freeze({ state: 'missing' })
  if (candidates.length > 1) {
    return Object.freeze({
      state: 'ambiguous',
      candidates: Object.freeze(candidates.map(item => Object.freeze({ ...item }))),
    })
  }
  return Object.freeze({ state: 'resolved', resource: candidates[0] })
}

function parsePieTextureDirectives(text, path, maxReferences) {
  if (text.includes('\0')) throw new TypeError(`${path}: PIE text contains a NUL byte`)
  const references = []
  const seen = new Set()
  let headerSeen = false
  for (const [index, raw] of text.split(/\r?\n/gu).entries()) {
    const line = raw.replace(/#.*$/u, '').trim()
    if (line.length === 0) continue
    const tokens = line.split(/\s+/u)
    if (!headerSeen) {
      if (tokens[0]?.toUpperCase() !== 'PIE') throw new TypeError(`${path}: PIE header is missing`)
      headerSeen = true
      continue
    }
    const directive = tokens[0]?.toUpperCase()
    if (!TEXTURE_DIRECTIVES.has(directive)) continue
    if (tokens.length < 3)
      throw new TypeError(`${path}: ${directive} is truncated at line ${index + 1}`)
    const logicalId = logicalPath(tokens[2], `${path}:${index + 1} texture`)
    const key = `${directive}\0${logicalId.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    references.push(Object.freeze({ directive, logicalId, line: index + 1 }))
    if (references.length > maxReferences) {
      throw new RangeError(`${path}: PIE texture references exceed ${maxReferences}`)
    }
  }
  if (!headerSeen) throw new TypeError(`${path}: PIE source is empty`)
  return Object.freeze(references)
}

function diagnosticsCollector(maximum) {
  const diagnostics = []
  const keys = new Set()
  let omitted = 0
  return Object.freeze({
    add(key, value) {
      if (keys.has(key)) return
      keys.add(key)
      if (diagnostics.length >= maximum) {
        omitted += 1
        return
      }
      diagnostics.push(Object.freeze(value))
    },
    finish() {
      return Object.freeze({
        values: Object.freeze(diagnostics),
        omitted,
      })
    },
  })
}

function materialBinding(modelState, modelDocuments, resources, maxReferences, diagnostics) {
  if (modelState.state !== 'resolved')
    return Object.freeze({ state: 'model-unresolved', textures: Object.freeze([]) })
  const document = modelDocuments.get(modelState.resource.path.toLowerCase())
  if (document === undefined) {
    diagnostics.add(`model-unread\0${modelState.resource.path.toLowerCase()}`, {
      severity: 'information',
      code: 'org.modkitx.opensource.warzone2100/model-material-unread',
      message: `${modelState.resource.path} was path-resolved but its PIE text was not supplied; texture/material binding remains partial`,
      source: modelState.resource,
    })
    return Object.freeze({ state: 'model-unread', textures: Object.freeze([]) })
  }
  let refs
  try {
    refs = parsePieTextureDirectives(document.text, document.path, maxReferences)
  } catch (error) {
    diagnostics.add(`model-invalid\0${document.path.toLowerCase()}`, {
      severity: 'warning',
      code: 'org.modkitx.opensource.warzone2100/model-material-invalid',
      message: `${document.path} texture directives were not admitted: ${error instanceof Error ? error.message : String(error)}`,
      source: Object.freeze({
        rootId: document.rootId,
        path: document.path,
        ...(document.revision === undefined ? {} : { revision: document.revision }),
      }),
    })
    return Object.freeze({ state: 'invalid-model', textures: Object.freeze([]) })
  }
  const textures = refs.map(ref => {
    const state = bindingState(ref.logicalId, resources)
    if (state.state !== 'resolved') {
      diagnostics.add(`texture-${state.state}\0${ref.logicalId.toLowerCase()}`, {
        severity: state.state === 'missing' ? 'warning' : 'information',
        code: `org.modkitx.opensource.warzone2100/texture-${state.state}`,
        message: `${document.path} ${ref.directive} ${ref.logicalId} is ${state.state} in the supplied resource index`,
        source: Object.freeze({ rootId: document.rootId, path: document.path }),
      })
    }
    return Object.freeze({ ...ref, ...state })
  })
  return Object.freeze({
    state:
      textures.length === 0
        ? 'none-declared'
        : textures.every(item => item.state === 'resolved')
          ? 'resolved'
          : 'partial',
    textures: Object.freeze(textures),
    source: Object.freeze({
      rootId: document.rootId,
      path: document.path,
      ...(document.revision === undefined ? {} : { revision: document.revision }),
    }),
  })
}

function entityKey(namespace, entityId) {
  return `${namespace}\0${entityId}`
}

function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]))
    )
  }
  const leftRecord = recordOf(left)
  const rightRecord = recordOf(right)
  if (leftRecord === undefined || rightRecord === undefined) return false
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key]),
    )
  )
}

function logicalModelBindingsForEntity(entity) {
  const fields = MODEL_FIELDS[entity.namespace] ?? []
  return fields.flatMap(fieldId =>
    scalarStrings(entity.fields[fieldId]).flatMap((logicalId, ordinal) =>
      logicalId.toLowerCase().endsWith('.pie')
        ? [
            Object.freeze({
              kind: 'pie-model',
              role: `${fieldId}[${ordinal}]`,
              logicalId,
              owner: Object.freeze({
                namespace: entity.namespace,
                entityId: entity.entityId,
                fieldId,
              }),
            }),
          ]
        : [],
    ),
  )
}

function selectedBodyPropulsionLogicalBindings(entity, propulsionId) {
  if (entity.namespace !== 'warzone.bodies' || typeof propulsionId !== 'string') return []
  const extra = recordOf(entity.fields.propulsionExtraModels)
  const selected = recordOf(extra?.[propulsionId])
  if (selected === undefined) return []
  return Object.entries(selected).flatMap(([role, logicalId]) =>
    typeof logicalId === 'string' && logicalId.toLowerCase().endsWith('.pie')
      ? [
          Object.freeze({
            kind: 'pie-model',
            role: `propulsionExtraModels.${propulsionId}.${role}`,
            logicalId,
            owner: Object.freeze({
              namespace: entity.namespace,
              entityId: entity.entityId,
              fieldId: 'propulsionExtraModels',
            }),
          }),
        ]
      : [],
  )
}

function portableMaterialBinding(model) {
  return Object.freeze({
    state: 'pie-document-unavailable',
    source: Object.freeze({ kind: 'pie-model', logicalId: model.logicalId }),
    textures: Object.freeze([]),
    reason:
      'DataCatalogSnapshot carries stats fields but no observed archive index or PIE document text',
  })
}

/**
 * Derive only catalog-proved, portable logical model references for placed objects.
 * Archive paths and PIE texture directives are deliberately unavailable on this input boundary.
 */
export function bindWarzoneCatalogObjectResources(catalog, objects) {
  const value = recordOf(catalog)
  if (
    value?.schemaVersion !== 1 ||
    value.gameId !== GAME_ID ||
    !Array.isArray(value.entities) ||
    (value.definitions !== undefined && !Array.isArray(value.definitions)) ||
    !Array.isArray(objects)
  ) {
    throw new TypeError('Warzone catalog object binding requires a matching DataCatalogSnapshot')
  }

  const entities = new Map()
  const collisions = new Set()
  for (const [source, candidates] of [
    ['definitions', value.definitions ?? []],
    ['entities', value.entities],
  ]) {
    for (const [index, candidate] of candidates.entries()) {
      const entity = recordOf(candidate)
      if (
        entity === undefined ||
        typeof entity.namespace !== 'string' ||
        typeof entity.entityId !== 'string' ||
        recordOf(entity.fields) === undefined
      ) {
        throw new TypeError(`catalog.${source}[${index}] is not a resolved data entity`)
      }
      const key = entityKey(entity.namespace, entity.entityId)
      const previous = entities.get(key)
      if (previous === undefined && !collisions.has(key)) {
        entities.set(key, entity)
      } else if (previous !== undefined && !sameJsonValue(previous, entity)) {
        entities.delete(key)
        collisions.add(key)
      }
    }
  }

  const diagnostics = []
  const bindings = []
  let componentBindings = 0
  let logicalModelReferences = 0
  for (const [index, input] of objects.entries()) {
    const object = recordOf(input)
    const ref = recordOf(object?.ref)
    if (
      object === undefined ||
      !Number.isSafeInteger(object.objectId) ||
      ref === undefined ||
      typeof ref.namespace !== 'string' ||
      typeof ref.entityId !== 'string'
    ) {
      throw new TypeError(`objects[${index}] must contain a safe objectId and catalog ref`)
    }
    const key = entityKey(ref.namespace, ref.entityId)
    if (collisions.has(key)) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'org.modkitx.opensource.warzone2100/map-catalog-entity-collision',
          message: `${ref.namespace}/${ref.entityId} conflicts between catalog definitions and queried entities`,
          catalogRef: Object.freeze({ ...ref }),
        }),
      )
      bindings.push(
        Object.freeze({
          objectId: object.objectId,
          ref: Object.freeze({ ...ref }),
          state: 'definition-collision',
          resources: Object.freeze({
            schemaVersion: 1,
            contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
            state: 'definition-collision',
            components: Object.freeze([]),
            models: Object.freeze([]),
            modelReferencesComplete: false,
            materialReferencesComplete: false,
            complete: false,
          }),
          components: Object.freeze([]),
          models: Object.freeze([]),
          modelReferencesComplete: false,
          materialReferencesComplete: false,
          complete: false,
        }),
      )
      continue
    }
    const definition = entities.get(key)
    if (definition === undefined) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'org.modkitx.opensource.warzone2100/map-catalog-entity-unresolved',
          message: `placed object references unavailable catalog entity ${ref.namespace}/${ref.entityId}`,
          catalogRef: Object.freeze({ ...ref }),
        }),
      )
      bindings.push(
        Object.freeze({
          objectId: object.objectId,
          ref: Object.freeze({ ...ref }),
          state: 'definition-missing',
          resources: Object.freeze({
            schemaVersion: 1,
            contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
            state: 'definition-missing',
            components: Object.freeze([]),
            models: Object.freeze([]),
            modelReferencesComplete: false,
            materialReferencesComplete: false,
            complete: false,
          }),
          components: Object.freeze([]),
          models: Object.freeze([]),
          modelReferencesComplete: false,
          materialReferencesComplete: false,
          complete: false,
        }),
      )
      continue
    }

    const components = []
    const owners = [definition]
    const definitionComplete = definition.complete === true
    if (!definitionComplete) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/map-object-definition-partial',
          message: `${definition.namespace}/${definition.entityId} is a partial resolved definition; its logical model references cannot be complete`,
          catalogRef: Object.freeze({ ...ref }),
        }),
      )
    }
    for (const componentField of COMPONENT_FIELDS[definition.namespace] ?? []) {
      for (const componentId of scalarStrings(definition.fields[componentField.field])) {
        if (componentId.length === 0) continue
        const componentRef = Object.freeze({
          namespace: componentField.namespace,
          entityId: componentId,
        })
        const componentKey = entityKey(componentRef.namespace, componentRef.entityId)
        const collision = collisions.has(componentKey)
        const component = collision ? undefined : entities.get(componentKey)
        const componentState = collision
          ? 'collision'
          : component === undefined
            ? 'missing'
            : component.complete === true
              ? 'resolved'
              : 'partial'
        components.push(
          Object.freeze({
            role: componentField.field,
            ...componentRef,
            state: componentState,
          }),
        )
        if (componentState !== 'resolved') {
          diagnostics.push(
            Object.freeze({
              severity: 'warning',
              code:
                componentState === 'collision'
                  ? 'org.modkitx.opensource.warzone2100/map-object-component-collision'
                  : componentState === 'missing'
                    ? 'org.modkitx.opensource.warzone2100/map-object-component-missing'
                    : 'org.modkitx.opensource.warzone2100/map-object-component-partial',
              message: `${definition.namespace}/${definition.entityId}.${componentField.field} names ${componentState} ${componentRef.namespace}/${componentRef.entityId}`,
              catalogRef: componentRef,
            }),
          )
        } else {
          owners.push(component)
        }
      }
    }
    const models = owners.flatMap(owner => [
      ...logicalModelBindingsForEntity(owner),
      ...selectedBodyPropulsionLogicalBindings(owner, definition.fields.propulsion),
    ])
    const portableModels = Object.freeze(
      models.map(model =>
        Object.freeze({
          ...model,
          state: 'logical-only',
          material: portableMaterialBinding(model),
        }),
      ),
    )
    const componentsComplete =
      definitionComplete && components.every(component => component.state === 'resolved')
    const modelReferencesComplete = componentsComplete && portableModels.length > 0
    if (portableModels.length === 0) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/map-object-model-logical-ref-unavailable',
          message: `${definition.namespace}/${definition.entityId} yields no catalog-proved PIE model reference`,
          catalogRef: Object.freeze({ ...ref }),
        }),
      )
    }
    componentBindings += components.length
    logicalModelReferences += portableModels.length
    bindings.push(
      Object.freeze({
        objectId: object.objectId,
        ref: Object.freeze({ ...ref }),
        entity: definition,
        resources: Object.freeze({
          schemaVersion: 1,
          contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
          state: modelReferencesComplete ? 'logical-models' : 'partial',
          components: Object.freeze(components),
          models: portableModels,
          modelReferencesComplete,
          materialReferencesComplete: false,
          complete: false,
        }),
        state: modelReferencesComplete ? 'logical-models' : 'partial',
        components: Object.freeze(components),
        models: portableModels,
        modelReferencesComplete,
        materialReferencesComplete: false,
        complete: false,
      }),
    )
  }
  if (logicalModelReferences > 0) {
    diagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.opensource.warzone2100/map-material-references-unavailable',
        message:
          'catalog-proved PIE model ids are portable, but archive paths and PIE texture directives require a bounded namespace/document planning pass',
      }),
    )
  }
  const modelBoundObjects = bindings.filter(binding => binding.modelReferencesComplete).length
  const summary = Object.freeze({
    schemaVersion: 1,
    contract: WARZONE_PORTABLE_OBJECT_RESOURCE_CONTRACT,
    objects: bindings.length,
    definitionBoundObjects: bindings.filter(binding => binding.entity !== undefined).length,
    modelBoundObjects,
    componentBindings,
    logicalModelReferences,
    materialTextureReferences: 0,
    modelReferencesComplete: bindings.length > 0 && modelBoundObjects === bindings.length,
    materialReferencesComplete: false,
    complete: false,
  })
  return Object.freeze({
    bindings: Object.freeze(bindings),
    diagnostics: Object.freeze(diagnostics),
    summary,
  })
}

function modelBindingsForEntity(entity, resources, modelDocuments, maximum, diagnostics) {
  const bindings = []
  for (const logical of logicalModelBindingsForEntity(entity)) {
    const state = bindingState(logical.logicalId, resources)
    if (state.state !== 'resolved') {
      diagnostics.add(`model-${state.state}\0${logical.logicalId.toLowerCase()}`, {
        severity: state.state === 'missing' ? 'warning' : 'information',
        code: `org.modkitx.opensource.warzone2100/model-${state.state}`,
        message: `${entity.namespace}/${entity.entityId}.${logical.owner.fieldId} names ${logical.logicalId}, which is ${state.state} in the supplied resource index`,
        namespace: entity.namespace,
        entityId: entity.entityId,
        fieldId: logical.owner.fieldId,
      })
    }
    bindings.push(
      Object.freeze({
        ...logical,
        ...state,
        material: materialBinding(state, modelDocuments, resources, maximum, diagnostics),
      }),
    )
    if (bindings.length > maximum) throw new RangeError(`model bindings exceed ${maximum}`)
  }
  return bindings
}

function selectedBodyPropulsionBindings(
  entity,
  propulsionId,
  resources,
  modelDocuments,
  maximum,
  diagnostics,
) {
  const bindings = []
  for (const logical of selectedBodyPropulsionLogicalBindings(entity, propulsionId)) {
    const state = bindingState(logical.logicalId, resources)
    bindings.push(
      Object.freeze({
        ...logical,
        ...state,
        material: materialBinding(state, modelDocuments, resources, maximum, diagnostics),
      }),
    )
  }
  return bindings
}

function parseObjectDocuments(documents, maximum) {
  const objects = []
  for (const [documentIndex, document] of documents.entries()) {
    const item = recordOf(document)
    if (item === undefined)
      throw new TypeError(`objectDocuments[${documentIndex}] must be an object`)
    const rootId = nonEmptyString(item.rootId, `objectDocuments[${documentIndex}].rootId`)
    const path = logicalPath(item.path, `objectDocuments[${documentIndex}].path`)
    if (typeof item.text !== 'string')
      throw new TypeError(`objectDocuments[${documentIndex}].text must be a string`)
    const table = MAP_TABLES.find(candidate => path.toLowerCase().endsWith(candidate.suffix))
    if (table === undefined) throw new TypeError(`${path}: unsupported Warzone map object document`)
    let parsed
    try {
      parsed = JSON.parse(item.text)
    } catch (error) {
      throw new TypeError(
        `${path}: malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const root = recordOf(parsed)
    if (root === undefined) throw new TypeError(`${path}: map object root must be an object`)
    for (const [objectId, raw] of Object.entries(root)) {
      const value = recordOf(raw)
      if (value === undefined)
        throw new TypeError(`${path}/${objectId}: map object must be an object`)
      const definitionId = nonEmptyString(value[table.field], `${path}/${objectId}.${table.field}`)
      objects.push(
        Object.freeze({
          objectId,
          kind: table.kind,
          definition: Object.freeze({ namespace: table.namespace, entityId: definitionId }),
          source: Object.freeze({
            rootId,
            path,
            documentIndex,
            ...(item.revision === undefined ? {} : { revision: item.revision }),
          }),
        }),
      )
      if (objects.length > maximum) throw new RangeError(`map objects exceed maxObjects ${maximum}`)
    }
  }
  return objects
}

/**
 * Extension-owned JSON-safe bridge for the current common-data ABI gap.
 * It consumes an observed archive index and optional observed PIE text; it performs no I/O and never executes scripts.
 */
export async function analyzeWarzoneMapObjectResourceBindings(request) {
  request?.signal?.throwIfAborted()
  const value = validateRequest(request)
  const resources = resourceIndex(value.resourceEntries)
  const modelDocuments = modelDocumentIndex(value.modelDocuments)
  const diagnostics = diagnosticsCollector(value.maxDiagnostics)
  const snapshot = await analyzeWarzoneResolvedData({
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    documents: value.documents,
    queries: [],
    maxDocuments: Math.max(1, value.documents.length),
    maxTextBytes: value.maxTextBytes,
    maxEntities: value.maxEntities,
    maxDepth: value.maxDepth,
    localizationDocuments: [],
    locales: [],
    localizationKeys: [],
    plannedDocumentCount: value.documents.length,
    unresolvedRequirementIds: [],
    ...(value.signal === undefined ? {} : { signal: value.signal }),
  })
  const entities = new Map(
    snapshot.definitions.map(entity => [entityKey(entity.namespace, entity.entityId), entity]),
  )
  const objects = parseObjectDocuments(value.objectDocuments, value.maxObjects)
  const objectBindings = []
  let modelBindingCount = 0
  for (const object of objects) {
    value.signal?.throwIfAborted()
    const definition = entities.get(
      entityKey(object.definition.namespace, object.definition.entityId),
    )
    if (definition === undefined) {
      diagnostics.add(
        `definition-missing\0${object.definition.namespace}\0${object.definition.entityId}`,
        {
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/object-definition-missing',
          message: `${object.definition.namespace}/${object.definition.entityId} is absent from the supplied ordered stats tables`,
          namespace: object.definition.namespace,
          entityId: object.definition.entityId,
          source: object.source,
        },
      )
      objectBindings.push(
        Object.freeze({
          ...object,
          state: 'definition-missing',
          components: Object.freeze([]),
          models: Object.freeze([]),
        }),
      )
      continue
    }
    const components = []
    const owners = [definition]
    for (const componentField of COMPONENT_FIELDS[definition.namespace] ?? []) {
      for (const componentId of scalarStrings(definition.fields[componentField.field])) {
        if (componentId.length === 0) continue
        const component = entities.get(entityKey(componentField.namespace, componentId))
        components.push(
          Object.freeze({
            role: componentField.field,
            namespace: componentField.namespace,
            entityId: componentId,
            state: component === undefined ? 'missing' : 'resolved',
          }),
        )
        if (component === undefined) {
          diagnostics.add(`component-missing\0${componentField.namespace}\0${componentId}`, {
            severity: 'warning',
            code: 'org.modkitx.opensource.warzone2100/object-component-missing',
            message: `${definition.namespace}/${definition.entityId}.${componentField.field} names missing ${componentField.namespace}/${componentId}`,
            namespace: definition.namespace,
            entityId: definition.entityId,
            fieldId: componentField.field,
          })
        } else {
          owners.push(component)
        }
      }
    }
    const models = owners.flatMap(owner => [
      ...modelBindingsForEntity(
        owner,
        resources,
        modelDocuments,
        value.maxModelReferences,
        diagnostics,
      ),
      ...selectedBodyPropulsionBindings(
        owner,
        definition.fields.propulsion,
        resources,
        modelDocuments,
        value.maxModelReferences,
        diagnostics,
      ),
    ])
    modelBindingCount += models.length
    if (modelBindingCount > value.maxModelReferences) {
      throw new RangeError(
        `object model bindings exceed maxModelReferences ${value.maxModelReferences}`,
      )
    }
    objectBindings.push(
      Object.freeze({
        ...object,
        state:
          models.length > 0 &&
          models.every(model => model.state === 'resolved') &&
          components.every(component => component.state === 'resolved')
            ? 'bound'
            : 'partial',
        definitionSource: Object.freeze(
          definition.sources.map(source => Object.freeze({ ...source })),
        ),
        components: Object.freeze(components),
        models: Object.freeze(models),
      }),
    )
  }
  const diagnosticResult = diagnostics.finish()
  const allModels = objectBindings.flatMap(object => object.models)
  const allTextures = allModels.flatMap(model => model.material.textures)
  const counts = Object.freeze({
    objects: objectBindings.length,
    boundObjects: objectBindings.filter(object => object.state === 'bound').length,
    definitions: new Set(
      objectBindings.map(object => `${object.definition.namespace}\0${object.definition.entityId}`),
    ).size,
    componentBindings: objectBindings.reduce((sum, object) => sum + object.components.length, 0),
    modelBindings: allModels.length,
    resolvedModelBindings: allModels.filter(model => model.state === 'resolved').length,
    missingModelBindings: allModels.filter(model => model.state === 'missing').length,
    ambiguousModelBindings: allModels.filter(model => model.state === 'ambiguous').length,
    modelsWithReadMaterialEvidence: allModels.filter(model => model.material.source !== undefined)
      .length,
    textureBindings: allTextures.length,
    resolvedTextureBindings: allTextures.filter(texture => texture.state === 'resolved').length,
    diagnostics: diagnosticResult.values.length,
    omittedDiagnostics: diagnosticResult.omitted,
  })
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    analyzerId: ANALYZER_ID,
    provenance: WARZONE_RESOURCE_BINDING_PROVENANCE,
    objectBindings: Object.freeze(objectBindings),
    diagnostics: diagnosticResult.values,
    counts,
    pathComplete:
      counts.boundObjects === counts.objects &&
      counts.missingModelBindings === 0 &&
      counts.ambiguousModelBindings === 0,
    textureDirectiveComplete:
      counts.modelBindings > 0 &&
      allModels.every(
        model => model.material.state === 'resolved' || model.material.state === 'none-declared',
      ),
    materialComplete: false,
    namedRemainder: Object.freeze([
      'common-abi-dynamic-resource-index',
      'runtime-model-selection',
      'runtime-material-semantics',
      'runtime-elevation',
      'runtime-footprint',
      'javascript-execution',
      'portable-uvd',
    ]),
  })
}
