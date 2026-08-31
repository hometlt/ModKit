/**
 * Shared regex sources for schema `pattern` keywords. Mirrors the runtime validators in
 * @modkit/core (MK3/23 §3); the drift gate keeps types and schemas aligned, and the
 * pattern tests exercise schema and runtime validator on the same fixtures.
 *
 * These are JSON-Schema pattern *sources*, so every backslash is escaped once for the
 * TypeScript string literal and means a single backslash in the regex.
 */

export const DOTTED_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$'

/** Trait and operation IDs require at least one namespace separator. */
export const NAMESPACED_DOTTED_PATTERN =
  '^[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$'

/** Shared/domain IDs are dotted; codec-local IDs retain the full qualified owner before `.`. */
export const OPERATION_PATTERN =
  '^(?:[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[a-z0-9]+(?:-[a-z0-9]+)*)$'

export const QUALIFIED_PATTERN =
  '^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$'

export const SEGMENT_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$'

/** SemVer 2.0.0 (the spec's published pattern, no capture-group names). */
export const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$'

/**
 * The range subset the resolver actually implements (MK3/23 §4, mirrored by
 * `parseVersionRange` in core): `*`/`x`, `1.x` / `1.2.x`, exact or `=`, caret, and
 * space-joined comparator conjunctions such as `>=1.2 <2`. Structural gate only —
 * `parseVersionRange` stays the semantic authority, and the manifest validator runs both.
 */
const RANGE_NUMBER = '(?:0|[1-9]\\d*)'
const RANGE_NUMERIC = `${RANGE_NUMBER}(?:\\.${RANGE_NUMBER}){0,2}`
const RANGE_EXACT = `=?${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.${RANGE_NUMBER}`
const RANGE_WILDCARD = `(?:${RANGE_NUMBER}\\.(?:x|\\*)|${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.(?:x|\\*))`
const RANGE_CARET = `\\^${RANGE_NUMBER}\\.${RANGE_NUMBER}(?:\\.${RANGE_NUMBER})?`
const RANGE_COMPARATOR = `[<>]=?${RANGE_NUMERIC}`
const RANGE_ATOM = `(?:${RANGE_EXACT}|${RANGE_WILDCARD}|${RANGE_CARET}|${RANGE_COMPARATOR})`
export const VERSION_RANGE_PATTERN = `^(?:\\*|x|${RANGE_ATOM}(?: ${RANGE_ATOM})*)$`

/**
 * Authored entry point: a relative path inside its own artifact. Forbids URL schemes
 * (`data:`, `http(s):`, `file:`, …), absolute POSIX/Windows/UNC paths, backslashes, `..`
 * traversal and control characters. The host re-checks the same rules at activation —
 * this schema is the outer of two independent gates, never the only one (MK3/24 §8).
 */
export const RELATIVE_ENTRYPOINT_PATTERN =
  '^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!/)(?!\\\\)(?:(?!\\.\\.(?:/|$))[^\\\\/\\u0000-\\u001f]+/)*(?!\\.\\.$)[^\\\\/\\u0000-\\u001f]+$'

/**
 * Method names on a data-source method surface (NXT-103): lowerCamel, ≤ 64 chars. Mirrors
 * `isMethodName` in the host capability-RPC protocol so a surface the schema accepts is a
 * surface the wire can carry.
 */
export const METHOD_NAME_PATTERN = '^[a-z][a-zA-Z0-9]{0,63}$'
