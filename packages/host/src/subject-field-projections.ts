/**
 * The one projection a session needs before it can answer anything, kept apart from the rest.
 *
 * Opening a subject has to decide, there and then, whether it can offer a relation graph — which
 * depends on whether the descriptor's metadata declares typed fields. That question is this
 * function, and it is arithmetic over data. The machinery that *builds* graphs and composite facts
 * sources is heavy (it reaches subject refs, paging and budgets), and a codec that is only asked
 * for pixels never touches it: the session imports it when something asks for those sources.
 *
 * Splitting them is worth ~55 ms on every codec activation — a fresh worker, an empty module
 * cache, once per first open of every format.
 */
import type { FieldType, JsonValue, MetadataGroup } from '@modkit/sdk'

export interface SubjectFieldProjection {
  readonly path: string
  readonly value: JsonValue
  readonly type: FieldType
}

export function referencePath(path: string, segment: string): string {
  return path === '' ? segment : `${path}.${segment}`
}

/** Typed metadata entries as projectable fields; an entry without a type is not one. */
export function metadataFieldProjections(
  groups: readonly MetadataGroup[],
): readonly SubjectFieldProjection[] {
  return Object.freeze(
    groups.flatMap(group =>
      group.entries.flatMap(entry =>
        entry.type === undefined
          ? []
          : [{ path: referencePath(group.id, entry.key), type: entry.type, value: entry.value }],
      ),
    ),
  )
}
