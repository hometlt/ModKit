/**
 * An operation's answer as a read-only document.
 *
 * Some operations answer with a document rather than a fact: a merged declaration, a converted
 * catalog, a script the editor would have produced. MK2 opened those beside the source — a modder
 * reads a catalog to learn what a unit *is*, and the file only ever states the difference from its
 * parent — and a notification saying "completed" is not that.
 *
 * Nothing here knows a game, an operation, or VS Code. A result that carries text is shown; one
 * that does not is left to whoever asked, which is how a generic surface stays honest about what it
 * received.
 */

export const OPERATION_OUTPUT_SCHEME = 'modkit-output'

const LANGUAGE_BY_MEDIA_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/json': 'json',
  'text/plain': 'plaintext',
})

/** The text an operation answered with, when it answered with text at all. */
export function operationOutputText(
  data: unknown,
): { readonly text: string; readonly languageId?: string } | undefined {
  if (typeof data === 'string') return data.trim().length === 0 ? undefined : { text: data }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  // An operation result travels as `{kind, value}`; a command's `data` may already be the value.
  const value =
    (record['kind'] === 'json' || record['kind'] === 'bytes') && 'value' in record
      ? (record['value'] as Record<string, unknown> | string)
      : record
  if (typeof value === 'string') return value.trim().length === 0 ? undefined : { text: value }
  if (typeof value !== 'object' || value === null) return undefined
  const inner = value as Record<string, unknown>
  const text = inner['text']
  if (typeof text !== 'string' || text.trim().length === 0) return undefined
  const mediaType = typeof inner['mediaType'] === 'string' ? inner['mediaType'] : ''
  const languageId = LANGUAGE_BY_MEDIA_TYPE[mediaType]
  return languageId === undefined ? { text } : { text, languageId }
}

/** A file name for the tab, from what the caller asked for. */
export function operationOutputName(
  operationId: string,
  subject: string | undefined,
  languageId?: string,
): string {
  const leaf = subject === undefined ? 'subject' : (subject.split(/[\/]/u).at(-1) ?? 'subject')
  const base = leaf.replace(/\.[^.]+$/u, '')
  const operation = operationId.split(/[./]/u).at(-1) ?? 'output'
  const extension = languageId === 'xml' ? 'xml' : languageId === 'json' ? 'json' : 'txt'
  return `${base}.${operation}.${extension}`
}

export interface OperationOutputStore {
  /** Publish one answer and return the path a read-only editor opens it at. */
  publish(name: string, text: string): string
  read(path: string): string | undefined
  clear(): void
}

/** Holds the last answers this window produced; a republished name replaces its predecessor. */
export function createOperationOutputStore(maximum = 32): OperationOutputStore {
  const documents = new Map<string, string>()
  return {
    publish(name, text) {
      const path = name.startsWith('/') ? name : `/${name}`
      documents.delete(path)
      documents.set(path, text)
      while (documents.size > maximum) {
        const oldest = documents.keys().next().value
        if (oldest === undefined) break
        documents.delete(oldest)
      }
      return path
    },
    read: path => documents.get(path),
    clear: () => documents.clear(),
  }
}
