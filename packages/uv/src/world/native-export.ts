/**
 * map.export-native, the one handler of the world codecs (UVW `modkit/world-uvw`, single-file UVP
 * `modkit/world-uvp`): the world written by the installed game's map encoder
 * (common.map/native-encoder, WT10), its losses reported with the result. A codec selects and
 * checks the encoder; it writes no game's map. The encoder gets the world's bytes as opened — a
 * UVW document, or a UVP package (a ZIP with its media) when the world came as one — and asks the
 * target game's catalog first when it needs it (catalog questions, owner decision 67).
 */
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { operationId, type Diagnostic } from '@modkit/core'
import {
  DATA_CATALOG_ENTITIES_INPUT,
  DATA_CATALOG_QUERIES_OUTPUT,
  type ContributionContext,
  type DataEntityRef,
  type DataResolvedEntity,
  type JsonValue,
  type ResourceBudget,
} from '@modkit/sdk'
import { NATIVE_MAP_ENCODER_CONTRACT, type NativeMapEncoder } from '@modkit/sdk/maps'

/** What a world codec's inspection context lends the handler. */
export interface NativeMapExportContext {
  readonly contracts?: ContributionContext['contracts']
  readonly budget: ResourceBudget
}

/** The native export's form: the target map format and the encoder's own options. */
export const NATIVE_MAP_EXPORT_INPUT_SCHEMA = Object.freeze({
  $ref: 'modkit://schemas/uvw/native-map-export.v1',
  document: Object.freeze({
    schemaVersion: 1,
    forms: Object.freeze([
      Object.freeze({
        id: 'uvw-native-map-export',
        label: 'Save as a game map',
        summary: "Write this world with an installed game's map encoder.",
        baseInput: Object.freeze({ schemaVersion: 1 }),
        fields: Object.freeze([
          Object.freeze({
            key: 'formatId',
            label: 'Target format',
            type: Object.freeze({ kind: 'text' }),
            inputPath: Object.freeze(['formatId']),
            required: true,
            description: 'Installed native map format id, for example ra2-map or minecraft-anvil.',
          }),
          Object.freeze({
            key: 'options',
            label: 'Encoder options',
            type: Object.freeze({ kind: 'json' }),
            inputPath: Object.freeze(['options']),
            initial: Object.freeze({}),
          }),
        ]),
      }),
    ]),
  }),
})

/** The operation's declaration for the codec `contributionId`. */
export function nativeMapExportOperation(contributionId: string, handlerId: string) {
  return Object.freeze({
    id: operationId('map.export-native', { contributionId }),
    handlerId,
    inputSchema: NATIVE_MAP_EXPORT_INPUT_SCHEMA,
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['bytes', 'json'] as const),
  })
}

/** The handler over the world's bytes as opened (`world` is read when the operation runs). */
export function nativeMapExportHandler(
  world: Uint8Array | (() => Uint8Array | Promise<Uint8Array>),
  context: NativeMapExportContext,
  contributionId: string,
) {
  const operation = operationId('map.export-native', { contributionId })
  return async (
    input: unknown,
    operationContext: {
      readonly signal?: AbortSignal
      readonly reportDiagnostic?: (value: Diagnostic) => void
    } = {},
  ) => {
    if (context.contracts === undefined)
      throw new TypeError('host native map encoder capability is absent')
    const request = requestObject(
      snapshotJson(
        input,
        {
          maxBytes: context.budget.maxScalarBytes,
          maxNodes: context.budget.maxNodes,
          maxDepth: context.budget.maxDepth + 2,
        },
        operationContext.signal,
      ),
      'native map export request',
    )
    const formatId = request['formatId']
    if (
      request['schemaVersion'] !== 1 ||
      typeof formatId !== 'string' ||
      formatId.trim().length === 0 ||
      Object.keys(request).some(
        key => !['schemaVersion', 'formatId', 'options', DATA_CATALOG_ENTITIES_INPUT].includes(key),
      )
    )
      throw new TypeError('native map export requires {schemaVersion: 1, formatId}')
    // the answers to the encoder's catalog questions, when the host calls again with them
    const answered = request[DATA_CATALOG_ENTITIES_INPUT]
    if (answered !== undefined && !Array.isArray(answered))
      throw new TypeError(`native map export ${DATA_CATALOG_ENTITIES_INPUT} must be a list`)
    const signal = operationContext.signal
    signal?.throwIfAborted()
    const lease = await context.contracts.resolve({
      contract: NATIVE_MAP_ENCODER_CONTRACT,
      major: 1,
      facet: { formatId },
      operation,
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      const encoder: unknown = lease.value
      const candidate = encoder as Partial<NativeMapEncoder> | null
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        candidate.contract !== NATIVE_MAP_ENCODER_CONTRACT ||
        candidate.formatId !== formatId ||
        typeof candidate.encode !== 'function'
      )
        throw new TypeError(`resolved provider is not a ${formatId} native map encoder`)
      const encoded = await candidate.encode({
        uvw: (typeof world === 'function' ? await world() : world).slice(),
        ...(request['options'] === undefined ? {} : { options: request['options'] as JsonValue }),
        ...(answered === undefined
          ? {}
          : { catalogEntities: answered as unknown as readonly DataResolvedEntity[] }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (encoded === null || typeof encoded !== 'object' || encoded.formatId !== formatId)
        throw new TypeError(`native map encoder returned an invalid ${formatId} result`)
      // the target game's catalog first: the host answers from the target's mod context and calls again
      if ('catalogQueries' in encoded) {
        if (!Array.isArray(encoded.catalogQueries))
          throw new TypeError(
            `native map encoder asked ${formatId} catalog questions without a list`,
          )
        const queries: DataEntityRef[] = encoded.catalogQueries.map(ref => ({
          namespace: ref.namespace,
          entityId: ref.entityId,
        }))
        return {
          kind: 'json' as const,
          value: { [DATA_CATALOG_QUERIES_OUTPUT]: queries } as unknown as JsonValue,
        }
      }
      if (!(encoded.bytes instanceof Uint8Array))
        throw new TypeError(`native map encoder returned an invalid ${formatId} result`)
      for (const item of encoded.diagnostics ?? []) operationContext.reportDiagnostic?.(item)
      // the encoder's extension and media type name the file the application writes
      return {
        kind: 'bytes' as const,
        value: encoded.bytes,
        extension: encoded.extension,
        ...(encoded.mediaType === undefined ? {} : { mediaType: encoded.mediaType }),
      }
    } finally {
      await lease.release()
    }
  }
}

function requestObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}
