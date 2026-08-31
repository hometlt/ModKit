export interface ModkitIdentityNormalization {
  readonly value: string
  readonly changed: boolean
}

const QUALIFIED_RULES = [
  ['org.modkitx/starcraft-2', 'blizzard/starcraft-2', true],
  ['org.modkitx/warzone-2100', 'wz2100project/warzone-2100', true],
  ['org.modkitx.opensource/warzone-2100', 'wz2100project/warzone-2100', true],
  ['org.modkitx.opensource/spring', 'spring/recoil', true],
  ['org.modkitx.blizzard/', 'blizzard/'],
  ['org.modkitx.ea/', 'ea/'],
  ['org.modkitx/', 'modkit/'],
  ['org.modkitx.', 'modkit.'],
  ['org.modkitx', 'modkit', true],
] as const satisfies readonly (readonly [from: string, to: string, exact?: boolean])[]

const SOURCE_RULES = [
  ['org.modkitx.blizzard', 'blizzard', true],
  ['org.modkitx.ea', 'ea', true],
  ['org.modkitx.opensource', 'opensource', true],
  ['org.modkitx', 'modkit', true],
] as const satisfies readonly (readonly [from: string, to: string, exact?: boolean])[]

const PACKAGE_RULES = [
  ['@modkitx-x3/', '@modkit/'],
  ['@modkitx/', '@modkit/'],
] as const satisfies readonly (readonly [from: string, to: string])[]

function normalizeByRules(
  value: string,
  rules: readonly (readonly [from: string, to: string, exact?: boolean])[],
): ModkitIdentityNormalization {
  for (const [from, to, exact] of rules) {
    const next =
      exact === true
        ? value === from
          ? to
          : undefined
        : value.startsWith(from)
          ? `${to}${value.slice(from.length)}`
          : undefined
    if (next !== undefined) return Object.freeze({ value: next, changed: next !== value })
  }
  return Object.freeze({ value, changed: false })
}

/** Canonicalize a Modkit coordinate while accepting the pre-rename ModkitX identities. */
export function normalizeModkitIdentifier(value: string): string {
  return normalizeByRules(value, QUALIFIED_RULES).value
}

/** Canonicalize a Modkit package specifier while accepting the pre-rename package scopes. */
export function normalizeModkitPackageSpecifier(value: string): string {
  return normalizeByRules(value, PACKAGE_RULES).value
}

/** Canonicalize a source label while accepting the pre-rename first-party source ids. */
export function normalizeModkitSourceIdentifier(value: string): string {
  return normalizeByRules(value, SOURCE_RULES).value
}
