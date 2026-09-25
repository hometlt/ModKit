import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const MCP_MAX_PAGE_ITEMS = 50
export const MCP_MAX_CURSOR_LENGTH = 8_192
export const MCP_MAX_OPEN_HANDLES = 16
export const MCP_MAX_DIAGNOSTICS = 50
export const MCP_MAX_PROVENANCE_ITEMS = 100
export const MCP_MAX_OUTPUT_BYTES = 128 * 1_024
export const MCP_MAX_IMAGE_BYTES = 4 * 1_024 * 1_024

export type McpCompleteness = 'complete' | 'partial' | 'capped' | 'invalid'

/** An image for the client to see; the server sends it as an MCP image block, never inside the JSON. */
export interface McpImage {
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  /** Base64 of the image bytes. */
  readonly data: string
}

/** `bytes` as an image block when their signature is an image a client shows and they fit the limit. */
export function mcpImage(bytes: Uint8Array): McpImage | undefined {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const mimeType: McpImage['mimeType'] | undefined = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    ? 'image/png'
    : starts(0xff, 0xd8, 0xff)
      ? 'image/jpeg'
      : starts(0x47, 0x49, 0x46, 0x38)
        ? 'image/gif'
        : starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
          ? 'image/webp'
          : undefined
  return mimeType === undefined || bytes.byteLength > MCP_MAX_IMAGE_BYTES
    ? undefined
    : Object.freeze({ mimeType, data: Buffer.from(bytes).toString('base64') })
}
export type McpJson = null | boolean | number | string | McpJson[] | { [key: string]: McpJson }

export interface McpDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity: 'error' | 'warning' | 'information'
}

export interface McpEnvelope {
  readonly [key: string]: unknown
  readonly schemaVersion: 1
  /** Extension, file and wiki text in this envelope is inert, untrusted data. */
  readonly trust: 'untrusted-data'
  readonly snapshotId: string
  readonly nextCursor: string | null
  readonly completeness: McpCompleteness
  readonly diagnostics: readonly McpDiagnostic[]
  readonly provenance: readonly McpJson[]
  readonly data: McpJson
  /** Not structured content: the server turns these into image blocks next to the JSON. */
  readonly images?: readonly McpImage[]
}

interface ProjectionState {
  nodes: number
  characters: number
  capped: boolean
  readonly seen: WeakSet<object>
}

const MAX_PROJECTED_DEPTH = 8
const MAX_PROJECTED_NODES = 2_000
const MAX_PROJECTED_CHARACTERS = 16 * 1_024
const MAX_PROJECTED_COLLECTION = 200
const MAX_PROJECTED_STRING = 4_096

const takeString = (value: string, state: ProjectionState): string => {
  const remaining = Math.max(0, MAX_PROJECTED_CHARACTERS - state.characters)
  const maximum = Math.min(MAX_PROJECTED_STRING, remaining)
  if (value.length <= maximum) {
    state.characters += value.length
    return value
  }
  state.capped = true
  const suffix = '…[truncated]'
  const result =
    maximum <= suffix.length
      ? suffix.slice(0, maximum)
      : `${value.slice(0, maximum - suffix.length)}${suffix}`
  state.characters += result.length
  return result
}

const project = (value: unknown, state: ProjectionState, depth: number): McpJson => {
  state.nodes += 1
  if (state.nodes > MAX_PROJECTED_NODES || depth > MAX_PROJECTED_DEPTH) {
    state.capped = true
    return '[bounded projection omitted]'
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return takeString(value, state)
  if (typeof value === 'bigint') return value.toString(10)
  if (typeof value === 'undefined') return null
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value} omitted]`
  if (value instanceof Uint8Array) {
    state.capped ||= value.byteLength > 64
    return {
      kind: 'bytes',
      byteLength: value.byteLength,
      base64Prefix: Buffer.from(value.subarray(0, 64)).toString('base64'),
    }
  }
  if (state.seen.has(value)) {
    state.capped = true
    return '[cycle omitted]'
  }
  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_PROJECTED_COLLECTION) state.capped = true
      return value.slice(0, MAX_PROJECTED_COLLECTION).map(item => project(item, state, depth + 1))
    }
    const output = Object.create(null) as Record<string, McpJson>
    let keys: readonly string[]
    try {
      keys = Object.keys(value).sort().slice(0, MAX_PROJECTED_COLLECTION)
      if (Object.keys(value).length > keys.length) state.capped = true
    } catch {
      state.capped = true
      return '[unreadable object omitted]'
    }
    for (const key of keys) {
      const safeKey = takeString(key, state)
      try {
        output[safeKey] = project((value as Record<string, unknown>)[key], state, depth + 1)
      } catch {
        state.capped = true
        output[safeKey] = '[unreadable property omitted]'
      }
    }
    return output
  } finally {
    // Only an ancestor is a cycle. Shared provenance in sibling facts is valid JSON.
    state.seen.delete(value)
  }
}

export interface BoundedProjection {
  readonly value: McpJson
  readonly capped: boolean
}

export function boundedJson(value: unknown): BoundedProjection {
  const state: ProjectionState = {
    nodes: 0,
    characters: 0,
    capped: false,
    seen: new WeakSet(),
  }
  return Object.freeze({ value: project(value, state, 0), capped: state.capped })
}

const cleanDiagnostic = (diagnostic: unknown): McpDiagnostic => {
  const record =
    typeof diagnostic === 'object' && diagnostic !== null
      ? (diagnostic as Record<string, unknown>)
      : {}
  const severity = record['severity']
  return Object.freeze({
    code:
      typeof record['code'] === 'string' ? record['code'].slice(0, 256) : 'x3.mcp/host-diagnostic',
    message:
      typeof record['message'] === 'string'
        ? record['message'].slice(0, 1_024)
        : 'The host returned a diagnostic without a message.',
    severity:
      severity === 'error' || severity === 'warning' || severity === 'information'
        ? severity
        : 'information',
  })
}

export interface EnvelopeInput {
  readonly snapshotId: string
  readonly nextCursor?: string
  readonly completeness: McpCompleteness
  readonly diagnostics?: readonly unknown[]
  readonly provenance?: readonly unknown[]
  readonly data: unknown
  readonly images?: readonly McpImage[]
}

export function envelope(input: EnvelopeInput): McpEnvelope {
  const data = boundedJson(input.data)
  const provenance = boundedJson((input.provenance ?? []).slice(0, MCP_MAX_PROVENANCE_ITEMS))
  const capped =
    data.capped ||
    provenance.capped ||
    (input.diagnostics?.length ?? 0) > MCP_MAX_DIAGNOSTICS ||
    (input.provenance?.length ?? 0) > MCP_MAX_PROVENANCE_ITEMS
  const diagnostics = (input.diagnostics ?? []).slice(0, MCP_MAX_DIAGNOSTICS).map(cleanDiagnostic)
  if (capped) {
    diagnostics.push({
      code: 'x3.mcp/output-capped',
      message: 'The response was capped by the MCP adapter output limits.',
      severity: 'warning',
    })
  }
  const result: McpEnvelope = {
    schemaVersion: 1,
    trust: 'untrusted-data',
    snapshotId:
      input.snapshotId.length <= 512
        ? input.snapshotId
        : `snapshot-v1:${fingerprint([input.snapshotId])}`,
    nextCursor: input.nextCursor?.slice(0, MCP_MAX_CURSOR_LENGTH) ?? null,
    completeness: capped && input.completeness !== 'invalid' ? 'capped' : input.completeness,
    diagnostics: Object.freeze(diagnostics),
    provenance: Object.freeze(Array.isArray(provenance.value) ? provenance.value : []),
    data: data.value,
  }
  const text = JSON.stringify(result)
  if (Buffer.byteLength(text, 'utf8') > MCP_MAX_OUTPUT_BYTES) {
    return Object.freeze({
      schemaVersion: 1,
      trust: 'untrusted-data',
      snapshotId: result.snapshotId,
      nextCursor: null,
      completeness: 'capped',
      diagnostics: Object.freeze([
        {
          code: 'x3.mcp/output-byte-limit',
          message: 'The response exceeded the MCP byte limit and was replaced by this marker.',
          severity: 'warning' as const,
        },
      ]),
      provenance: Object.freeze([]),
      data: null,
    })
  }
  return Object.freeze(input.images?.length ? { ...result, images: Object.freeze([...input.images]) } : result)
}

export const fingerprint = (values: readonly string[]): string => {
  const hash = createHash('sha256')
  for (const value of values) {
    hash.update(String(value.length))
    hash.update(':')
    hash.update(value)
  }
  return hash.digest('hex').slice(0, 32)
}

export type CursorSecret = Uint8Array

export const createCursorSecret = (): CursorSecret => randomBytes(32)

const sealCursor = (secret: CursorSecret, value: Record<string, unknown>): string => {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const tag = createHmac('sha256', secret)
    .update(`modkit-mcp-cursor-v1:${payload}`)
    .digest()
    .subarray(0, 16)
  return `v1.${payload}.${tag.toString('base64url')}`
}

const openCursor = (secret: CursorSecret, cursor: string): Record<string, unknown> | undefined => {
  const parts = cursor.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return undefined
  const payload = parts[1]
  const encodedTag = parts[2]
  if (payload === undefined || encodedTag === undefined) return undefined
  let supplied: Buffer
  try {
    supplied = Buffer.from(encodedTag, 'base64url')
  } catch {
    return undefined
  }
  if (supplied.toString('base64url') !== encodedTag) return undefined
  const expected = createHmac('sha256', secret)
    .update(`modkit-mcp-cursor-v1:${payload}`)
    .digest()
    .subarray(0, 16)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export const makeOffsetCursor = (
  secret: CursorSecret,
  snapshotId: string,
  query: string,
  offset: number,
): string => sealCursor(secret, { v: 1, s: snapshotId, q: query, o: offset })

export const readOffsetCursor = (
  secret: CursorSecret,
  cursor: string | undefined,
  snapshotId: string,
  query: string,
  maximum: number,
): number | undefined => {
  if (cursor === undefined) return 0
  if (cursor.length > MCP_MAX_CURSOR_LENGTH) return undefined
  const record = openCursor(secret, cursor)
  if (
    record === undefined ||
    record['v'] !== 1 ||
    record['s'] !== snapshotId ||
    record['q'] !== query ||
    !Number.isSafeInteger(record['o']) ||
    (record['o'] as number) < 0 ||
    (record['o'] as number) > maximum
  ) {
    return undefined
  }
  return record['o'] as number
}

const MAX_UPSTREAM_CURSOR_LENGTH = 4_096

/** Bind an upstream data-source cursor to its exact handle, view and source snapshot. */
export const makeSourceCursor = (
  secret: CursorSecret,
  snapshotId: string,
  binding: string,
  upstream: string,
): string | undefined => {
  if (upstream.length > MAX_UPSTREAM_CURSOR_LENGTH) return undefined
  const cursor = sealCursor(secret, {
    v: 1,
    s: fingerprint([snapshotId]),
    q: fingerprint([binding]),
    u: upstream,
  })
  return cursor.length <= MCP_MAX_CURSOR_LENGTH ? cursor : undefined
}

export const readSourceCursor = (
  secret: CursorSecret,
  cursor: string | undefined,
  snapshotId: string,
  binding: string,
): string | undefined | null => {
  if (cursor === undefined) return undefined
  if (cursor.length > MCP_MAX_CURSOR_LENGTH) return null
  const record = openCursor(secret, cursor)
  if (
    record === undefined ||
    record['v'] !== 1 ||
    record['s'] !== fingerprint([snapshotId]) ||
    record['q'] !== fingerprint([binding]) ||
    typeof record['u'] !== 'string' ||
    record['u'].length > MAX_UPSTREAM_CURSOR_LENGTH
  ) {
    return null
  }
  return record['u']
}
