/**
 * Machine-readable installed-product acceptance exposed by the VS Code webview.
 *
 * This is deliberately a receipt, not an inspection API. It contains only immutable JSON facts
 * already present in the bundled catalog/runtime inventory and, after a subject opens, the
 * selected contribution plus the descriptor identity. No subject path, URI, host handle or
 * extension-root path is allowed across this boundary.
 */

/** One generated Common root in `generated/bundled-catalog.json`. */
export interface BundledAcceptanceRoot {
  readonly name: string
  readonly directory: string
  readonly coordinate: string
  readonly contributions: readonly string[]
}

/** The contribution fields A7 needs from the composed runtime inventory. */
export interface RuntimeAcceptanceContribution {
  readonly id?: string
  readonly extension: string
  readonly origin: string
  readonly path: string
}

/** A host-side load failure. Its local root/message are never copied into the webview receipt. */
export interface RuntimeAcceptanceLoadError {
  readonly code: string
  readonly message: string
  readonly root?: string
}

export interface A7LoadError {
  readonly code: string
  /** Bundled coordinate when the failed root can be identified, never a filesystem path. */
  readonly root?: string
  readonly message: string
}

export interface A7AcceptanceReceipt {
  readonly kind: 'x3.modkit/a7-bundled-runtime-inventory'
  readonly schemaVersion: 1
  readonly expectedRoots: readonly string[]
  readonly loadedRoots: readonly string[]
  readonly missingRoots: readonly string[]
  readonly unexpectedRoots: readonly string[]
  readonly expectedContributions: readonly string[]
  readonly loadedContributions: readonly string[]
  readonly missingContributions: readonly string[]
  readonly unexpectedContributions: readonly string[]
  readonly loadErrors: readonly A7LoadError[]
  readonly verdict: 'pass' | 'fail'
}

export interface ModkitSubjectAcceptanceReceipt {
  readonly selected: {
    readonly contributionId: string
    readonly variantId: string
    readonly confidence: number
  }
  /** Actual runtime selections from outermost container to the opened subject, never locations. */
  readonly selectedRoute?: readonly {
    readonly formatId: string
    readonly extensionId: string
    readonly contributionId: string
  }[]
  readonly descriptor: {
    readonly identity: Readonly<Record<string, unknown>>
  }
}

export interface ModkitAcceptanceReceipt {
  readonly kind: 'x3.modkit/vscode-installed-acceptance'
  readonly schemaVersion: 1
  readonly a7: A7AcceptanceReceipt
  readonly subject?: ModkitSubjectAcceptanceReceipt
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const sorted = (values: readonly string[]): readonly string[] =>
  Object.freeze([...values].sort(compareText))

/** Sorted multiset subtraction: duplicates stay observable instead of being hidden by a Set. */
function missingFrom(expected: readonly string[], actual: readonly string[]): readonly string[] {
  const remaining = new Map<string, number>()
  for (const value of actual) remaining.set(value, (remaining.get(value) ?? 0) + 1)
  const missing: string[] = []
  for (const value of expected) {
    const count = remaining.get(value) ?? 0
    if (count === 0) missing.push(value)
    else remaining.set(value, count - 1)
  }
  return sorted(missing)
}

const lastPathSegment = (value: string): string => {
  const segments = value.split(/[\\/]/u).filter(Boolean)
  return segments[segments.length - 1] ?? value
}

function safeLoadErrors(
  catalog: readonly BundledAcceptanceRoot[],
  errors: readonly RuntimeAcceptanceLoadError[],
): readonly A7LoadError[] {
  const coordinateByDirectory = new Map(catalog.map(root => [root.directory, root.coordinate]))
  const coordinates = new Set(catalog.map(root => root.coordinate))
  return Object.freeze(
    errors
      .map(error => {
        const root =
          error.root === undefined
            ? undefined
            : coordinates.has(error.root)
              ? error.root
              : coordinateByDirectory.get(lastPathSegment(error.root))
        return Object.freeze({
          code: error.code,
          ...(root === undefined ? {} : { root }),
          // Loader prose can contain an absolute artifact root. The code/coordinate carry the
          // machine identity; keep the public message deliberately path-free.
          message:
            root === undefined
              ? 'the bundled catalog did not load completely'
              : `bundled root «${root}» did not load completely`,
        })
      })
      .sort((left, right) => {
        const code = compareText(left.code, right.code)
        return code === 0 ? compareText(left.root ?? '', right.root ?? '') : code
      }),
  )
}

/** Compare the generated bundled manifest with the composition that is actually serving VS Code. */
export function createA7AcceptanceReceipt(
  catalog: readonly BundledAcceptanceRoot[],
  runtime: {
    readonly roots: readonly string[]
    readonly contributions: readonly RuntimeAcceptanceContribution[]
    readonly loadErrors: readonly RuntimeAcceptanceLoadError[]
  },
): A7AcceptanceReceipt {
  const expectedRoots = sorted(catalog.map(root => root.coordinate))
  const loadedRoots = sorted(runtime.roots)
  const loadedRootCoordinates = new Set(loadedRoots)
  const expectedContributions = sorted(
    catalog.flatMap(root => root.contributions.map(id => `${root.coordinate}#${id}`)),
  )
  const loadedContributions = sorted(
    runtime.contributions
      // The host also has built-in bridge/service modules with origin `bundled`. A7 is about the
      // roots the generated Common catalog loaded, so membership in the loader's root-coordinate
      // result is the boundary; an unexpected loaded root remains visible here too.
      .filter(
        contribution =>
          contribution.origin === 'bundled' && loadedRootCoordinates.has(contribution.extension),
      )
      .map(
        (contribution, index) =>
          `${contribution.extension}#${contribution.id ?? `<invalid-id:${index}>`}`,
      ),
  )
  const missingRoots = missingFrom(expectedRoots, loadedRoots)
  const unexpectedRoots = missingFrom(loadedRoots, expectedRoots)
  const missingContributions = missingFrom(expectedContributions, loadedContributions)
  const unexpectedContributions = missingFrom(loadedContributions, expectedContributions)
  const loadErrors = safeLoadErrors(catalog, runtime.loadErrors)
  const verdict =
    missingRoots.length === 0 &&
    unexpectedRoots.length === 0 &&
    missingContributions.length === 0 &&
    unexpectedContributions.length === 0 &&
    loadErrors.length === 0
      ? 'pass'
      : 'fail'

  return Object.freeze({
    kind: 'x3.modkit/a7-bundled-runtime-inventory',
    schemaVersion: 1,
    expectedRoots,
    loadedRoots,
    missingRoots,
    unexpectedRoots,
    expectedContributions,
    loadedContributions,
    missingContributions,
    unexpectedContributions,
    loadErrors,
    verdict,
  })
}

export function createModkitAcceptanceReceipt(a7: A7AcceptanceReceipt): ModkitAcceptanceReceipt {
  return Object.freeze({
    kind: 'x3.modkit/vscode-installed-acceptance',
    schemaVersion: 1,
    a7,
  })
}

const ABSOLUTE_LOCATION = /^(?:[a-z][a-z0-9+.-]*:|[a-z]:[\\/]|\\\\|\/)/iu
const MAXIMUM_IDENTITY_DEPTH = 8
const MAXIMUM_IDENTITY_ITEMS = 256
const MAXIMUM_IDENTITY_STRING = 4_096

/**
 * Copy inert descriptor identity JSON under explicit bounds, redacting any absolute location that
 * a future descriptor revision might add. Today codec identities contain no path at all; this
 * guard keeps the acceptance global safe if that contract grows.
 */
function safeIdentityValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (ABSOLUTE_LOCATION.test(value)) return '<redacted:absolute-location>'
    return value.slice(0, MAXIMUM_IDENTITY_STRING)
  }
  if (depth >= MAXIMUM_IDENTITY_DEPTH) return '<redacted:maximum-depth>'
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, MAXIMUM_IDENTITY_ITEMS).map(item => safeIdentityValue(item, depth + 1)),
    )
  }
  if (typeof value !== 'object' || value === null) return undefined
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(value).slice(0, MAXIMUM_IDENTITY_ITEMS)) {
    const safe = safeIdentityValue(item, depth + 1)
    if (safe !== undefined) copy[key] = safe
  }
  return Object.freeze(copy)
}

export function withSubjectAcceptance(
  receipt: ModkitAcceptanceReceipt,
  opened: {
    readonly selected: {
      readonly extensionId?: string
      readonly contributionId: string
      readonly variantId: string
      readonly confidence: number
    }
    readonly selectedRoute?: readonly {
      readonly formatId: string
      readonly extensionId: string
      readonly contributionId: string
    }[]
    readonly descriptor: Record<string, unknown>
  },
): ModkitAcceptanceReceipt {
  const descriptorIdentity = safeIdentityValue(opened.descriptor.identity, 0)
  const identity =
    typeof descriptorIdentity === 'object' &&
    descriptorIdentity !== null &&
    !Array.isArray(descriptorIdentity)
      ? (descriptorIdentity as Readonly<Record<string, unknown>>)
      : Object.freeze({})
  const directFormatId =
    typeof (opened.descriptor.identity as { readonly formatId?: unknown } | undefined)?.formatId ===
    'string'
      ? (opened.descriptor.identity as { readonly formatId: string }).formatId
      : undefined
  const route =
    opened.selectedRoute ??
    (opened.selected.extensionId === undefined || directFormatId === undefined
      ? []
      : [
          {
            formatId: directFormatId,
            extensionId: opened.selected.extensionId,
            contributionId: opened.selected.contributionId,
          },
        ])
  const selectedRoute = Object.freeze(
    route.map(step =>
      Object.freeze({
        formatId: String(safeIdentityValue(step.formatId, 0)),
        extensionId: String(safeIdentityValue(step.extensionId, 0)),
        contributionId: String(safeIdentityValue(step.contributionId, 0)),
      }),
    ),
  )
  return Object.freeze({
    ...receipt,
    subject: Object.freeze({
      selected: Object.freeze({
        contributionId: opened.selected.contributionId,
        variantId: opened.selected.variantId,
        confidence: opened.selected.confidence,
      }),
      ...(selectedRoute.length === 0 ? {} : { selectedRoute }),
      descriptor: Object.freeze({ identity }),
    }),
  })
}

const exposedReceipts = new WeakMap<object, ModkitAcceptanceReceipt>()
const exposedTargets = new WeakSet<object>()

/**
 * Publish an immutable, non-enumerable receipt through a getter with no setter. The property itself
 * is installed once and cannot be reconfigured; the module-private WeakMap advances its value from
 * the initial A7-only snapshot to the subject snapshot after a real open completes.
 */
export function exposeModkitAcceptance(target: object, receipt: ModkitAcceptanceReceipt): void {
  exposedReceipts.set(target, receipt)
  if (exposedTargets.has(target)) return
  if (Object.prototype.hasOwnProperty.call(target, '__MODKIT_ACCEPTANCE__')) {
    throw new TypeError('__MODKIT_ACCEPTANCE__ already exists')
  }
  Object.defineProperty(target, '__MODKIT_ACCEPTANCE__', {
    get: () => exposedReceipts.get(target),
    configurable: false,
    enumerable: false,
  })
  exposedTargets.add(target)
}
