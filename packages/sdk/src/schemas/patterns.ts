/**
 * Shared regex sources for schema `pattern` keywords. Mirrors the runtime grammar
 * validators in @modkitx-x3/core (MK3/23 §3); the drift gate keeps types and schemas
 * aligned, and grammar tests exercise both sides on the same fixtures.
 */

export const DOTTED_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$'

export const QUALIFIED_PATTERN =
  '^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$'

export const SEGMENT_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$'

/** SemVer 2.0.0 (the spec's published pattern, no capture-group names). */
export const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$'
