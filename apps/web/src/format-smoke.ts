/**
 * Installed PWA format-family acceptance.
 *
 * The generated descriptor owns the cases, corpus digests, selected routes and runtime policy.
 * This module owns only the browser product boundary: it hashes the exact descriptor served by
 * the built app, asks the real shell to open browser cases, and sends host-only cases through the
 * browser product's SC2/CASC source adapter until that real request reaches its facility gate.
 */
import { isModkitError } from '@modkit/core'

import {
  WEB_SOURCE_FILESYSTEM_READ_RANDOM,
  WEB_SOURCE_FACILITY_UNAVAILABLE,
  WEB_SOURCE_OPEN_BOUNDARY,
} from './source-open.js'

export const PWA_FORMAT_SMOKE_KIND = 'x3.modkit/pwa-installed-format-smoke'
export const PWA_HOST_FACILITY_UNAVAILABLE = WEB_SOURCE_FACILITY_UNAVAILABLE
export const PWA_FILESYSTEM_READ_RANDOM = WEB_SOURCE_FILESYSTEM_READ_RANDOM

export const FORMAT_SMOKE_CASE_IDS = Object.freeze([
  'image-dds',
  'image-png',
  'image-tga',
  'image-jpeg',
  'document-odt',
  'data-xml',
  'archive-zip',
  'archive-warzone-wz',
  'archive-mpq',
  'casc-dds',
  'audio-wav',
  'audio-ogg',
  'model-m3',
  'model-warzone-pie',
] as const)

export type FormatSmokeCaseId = (typeof FORMAT_SMOKE_CASE_IDS)[number]
export type FormatSmokeStage =
  'raster' | 'tree-text' | 'tree' | 'metadata-tree' | 'model-or-wireframe'

export interface FormatSmokeRouteStep {
  readonly formatId: string
  readonly extensionId: string
  readonly contributionId: string
}

interface FormatSmokeCorpus {
  readonly kind: string
  readonly path?: string
  readonly container?: string
  readonly bytes?: number
  readonly sha256?: string
  readonly reason?: string
}

export interface FormatSmokeAuthorityCase {
  readonly id: FormatSmokeCaseId
  readonly stage: FormatSmokeStage
  readonly formats: readonly string[]
  readonly route: readonly FormatSmokeRouteStep[]
  readonly corpus: FormatSmokeCorpus
  readonly runtime: {
    readonly pwa:
      | { readonly kind: 'browser-subset' }
      | {
          readonly kind: 'host-facility-refusal'
          readonly code: string
          readonly facility: string
        }
  }
}

export interface FormatSmokeAuthority {
  readonly kind: 'x3.ga-recovery/format-family-smoke'
  readonly schemaVersion: 1
  readonly generatedFrom: {
    readonly bundledCatalog: {
      readonly sha256: string
      readonly roots: readonly { readonly coordinate: string }[]
    }
    readonly offlineRelease: {
      readonly descriptorSha256: string
      readonly catalogSha256: string
      readonly packageIds: readonly string[]
      readonly roots: readonly string[]
    }
    readonly codecContributionCount: number
  }
  readonly cases: readonly FormatSmokeAuthorityCase[]
  readonly namedExclusions: readonly { readonly id: string; readonly reason: string }[]
}

export interface PwaFormatSmokePackageIdentity {
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly enabled: boolean
}

export interface PwaFormatSmokeRuntimeIdentity {
  readonly offlineCatalogSha256: string
  readonly loadedManagedRoots: readonly string[]
  readonly codecContributionCount: number
  readonly packages: readonly PwaFormatSmokePackageIdentity[]
}

export interface PwaFormatSmokeCorpusObservation {
  readonly bytes: number
  readonly sha256: string
  readonly verifiedBeforeOpen: true
}

export type PwaFormatSmokeStageEvidence =
  | {
      readonly kind: 'raster'
      readonly width: number
      readonly height: number
      readonly opaquePixels: number
      readonly metadataEntries: number
    }
  | { readonly kind: 'tree-text'; readonly treeNodes: number; readonly textCharacters: number }
  | { readonly kind: 'tree'; readonly treeNodes: number }
  | {
      readonly kind: 'metadata-tree'
      readonly metadataEntries: number
      readonly treeNodes: number
    }
  | {
      readonly kind: 'model-or-wireframe'
      readonly renderer: 'canvas' | 'wireframe'
      readonly width: number
      readonly height: number
    }

export interface PwaFormatSmokeOpenedResult {
  readonly selectedRoute: readonly FormatSmokeRouteStep[]
  readonly corpus: PwaFormatSmokeCorpusObservation
  readonly stage: PwaFormatSmokeStageEvidence
}

export interface PwaFormatSmokeRefusalSource {
  readonly boundary: typeof WEB_SOURCE_OPEN_BOUNDARY
  readonly kind: 'sc2-casc-entry'
  readonly contentSha256: string
  readonly bytes: number
  readonly requestedFormatId: string
}

export type PwaFormatSmokeCaseReceipt =
  | {
      readonly id: FormatSmokeCaseId
      readonly outcome: 'opened'
      readonly selectedRoute: readonly FormatSmokeRouteStep[]
      readonly corpus: PwaFormatSmokeCorpusObservation
      readonly stage: PwaFormatSmokeStageEvidence
      readonly verdict: 'pass' | 'fail'
    }
  | {
      readonly id: FormatSmokeCaseId
      readonly outcome: 'refused'
      readonly code: typeof PWA_HOST_FACILITY_UNAVAILABLE
      readonly facility: typeof PWA_FILESYSTEM_READ_RANDOM
      readonly source: PwaFormatSmokeRefusalSource
      readonly verdict: 'pass' | 'fail'
    }
  | {
      readonly id: FormatSmokeCaseId
      readonly outcome: 'excluded'
      readonly reason: string
      readonly verdict: 'pass'
    }
  | {
      readonly id: FormatSmokeCaseId
      readonly outcome: 'failed'
      readonly code: string
      readonly message: string
      readonly verdict: 'fail'
    }

export interface PwaFormatSmokeReceipt {
  readonly kind: typeof PWA_FORMAT_SMOKE_KIND
  readonly schemaVersion: 1
  readonly authority: {
    readonly sha256: string
    readonly caseCount: 14
    readonly namedExclusionCount: 1
  }
  readonly catalog: {
    readonly expectedBundledCatalogSha256: string
    readonly expectedOfflineCatalogSha256: string
    readonly actualOfflineCatalogSha256: string
    readonly expectedManagedRoots: readonly string[]
    readonly loadedManagedRoots: readonly string[]
    readonly expectedCodecContributionCount: number
    readonly loadedCodecContributionCount: number
  }
  readonly packages: {
    readonly expectedIds: readonly string[]
    readonly installed: readonly PwaFormatSmokePackageIdentity[]
  }
  readonly cases: readonly PwaFormatSmokeCaseReceipt[]
  readonly verdict: 'pending' | 'pass' | 'fail'
}

export interface PwaFormatSmokeBridge {
  preparePackages(ids: readonly string[]): Promise<{ readonly reloadRequired: boolean }>
  runtimeIdentity(): Promise<PwaFormatSmokeRuntimeIdentity>
  open(testCase: FormatSmokeAuthorityCase, corpusUrl: string): Promise<PwaFormatSmokeOpenedResult>
  openHostOnlySource(testCase: FormatSmokeAuthorityCase): Promise<never>
  /** Diagnostic-only sink; exceptions never enter the path-free receipt. */
  reportFailure?(caseId: FormatSmokeCaseId, error: unknown): void
}

export interface PwaFormatSmokeControl {
  prepare(): Promise<{ readonly reloadRequired: boolean }>
  run(corpusUrls: Readonly<Record<string, string>>): Promise<PwaFormatSmokeReceipt>
  receipt(): PwaFormatSmokeReceipt
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const sorted = (values: readonly string[]): readonly string[] =>
  Object.freeze([...values].sort(compareText))

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const nonBlank = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

const sha256 = (value: unknown, label: string): string => {
  const text = nonBlank(value, label)
  if (!/^sha256:[0-9a-f]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a qualified lower-case SHA-256`)
  }
  return text
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const route = (value: unknown, label: string): readonly FormatSmokeRouteStep[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`)
  }
  return Object.freeze(
    value.map((item, index) => {
      const step = object(item, `${label}[${index}]`)
      return Object.freeze({
        formatId: nonBlank(step['formatId'], `${label}[${index}].formatId`),
        extensionId: nonBlank(step['extensionId'], `${label}[${index}].extensionId`),
        contributionId: nonBlank(step['contributionId'], `${label}[${index}].contributionId`),
      })
    }),
  )
}

/** Validate the exact Wave 1B inventory without copying any expected route into observations. */
export function validatePwaFormatSmokeAuthority(value: unknown): FormatSmokeAuthority {
  const input = object(value, 'format smoke authority')
  if (input['kind'] !== 'x3.ga-recovery/format-family-smoke' || input['schemaVersion'] !== 1) {
    throw new TypeError('format smoke authority has the wrong kind or schemaVersion')
  }
  if (!Array.isArray(input['cases']) || input['cases'].length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError('format smoke authority must contain exactly 14 cases')
  }
  const cases = input['cases'].map((item, index) => {
    const entry = object(item, `cases[${index}]`)
    const id = nonBlank(entry['id'], `cases[${index}].id`)
    if (id !== FORMAT_SMOKE_CASE_IDS[index]) {
      throw new TypeError(`cases[${index}].id must be ${FORMAT_SMOKE_CASE_IDS[index]}`)
    }
    const stage = nonBlank(entry['stage'], `${id}.stage`)
    if (!['raster', 'tree-text', 'tree', 'metadata-tree', 'model-or-wireframe'].includes(stage)) {
      throw new TypeError(`${id}.stage is unsupported`)
    }
    if (!Array.isArray(entry['formats']) || entry['formats'].length === 0) {
      throw new TypeError(`${id}.formats must be non-empty`)
    }
    const selectedRoute = route(entry['route'], `${id}.route`)
    if (
      !same(
        entry['formats'],
        selectedRoute.map(step => step.formatId),
      )
    ) {
      throw new TypeError(`${id}.route does not follow its format list`)
    }
    const corpus = object(entry['corpus'], `${id}.corpus`)
    const runtime = object(entry['runtime'], `${id}.runtime`)
    const pwa = object(runtime['pwa'], `${id}.runtime.pwa`)
    const pwaKind = nonBlank(pwa['kind'], `${id}.runtime.pwa.kind`)
    if (pwaKind !== 'browser-subset' && pwaKind !== 'host-facility-refusal') {
      throw new TypeError(`${id}.runtime.pwa.kind is unsupported`)
    }
    if (pwaKind === 'host-facility-refusal' && corpus['kind'] !== 'sc2-casc-entry') {
      throw new TypeError(`${id} is refused without a filesystem-backed SC2 corpus`)
    }
    return Object.freeze({
      id: id as FormatSmokeCaseId,
      stage: stage as FormatSmokeStage,
      formats: Object.freeze(
        entry['formats'].map((format, at) => nonBlank(format, `${id}.formats[${at}]`)),
      ),
      route: selectedRoute,
      corpus: Object.freeze({
        kind: nonBlank(corpus['kind'], `${id}.corpus.kind`),
        ...(typeof corpus['path'] === 'string' ? { path: corpus['path'] } : {}),
        ...(typeof corpus['container'] === 'string' ? { container: corpus['container'] } : {}),
        ...(typeof corpus['bytes'] === 'number' ? { bytes: corpus['bytes'] } : {}),
        ...(typeof corpus['sha256'] === 'string' ? { sha256: corpus['sha256'] } : {}),
        ...(typeof corpus['reason'] === 'string' ? { reason: corpus['reason'] } : {}),
      }),
      runtime: Object.freeze({
        pwa:
          pwaKind === 'browser-subset'
            ? Object.freeze({ kind: 'browser-subset' as const })
            : Object.freeze({
                kind: 'host-facility-refusal' as const,
                code: nonBlank(pwa['code'], `${id}.runtime.pwa.code`),
                facility: nonBlank(pwa['facility'], `${id}.runtime.pwa.facility`),
              }),
      }),
    })
  })
  const browserCases = cases.filter(
    entry => entry.runtime.pwa.kind === 'browser-subset' && entry.corpus.kind !== 'named-exclusion',
  )
  const refusedCases = cases.filter(entry => entry.runtime.pwa.kind === 'host-facility-refusal')
  const excludedCases = cases.filter(entry => entry.corpus.kind === 'named-exclusion')
  if (browserCases.length !== 9 || refusedCases.length !== 4 || excludedCases.length !== 1) {
    throw new TypeError(
      'format smoke authority must contain 9 browser cases, 4 refusals and 1 exclusion',
    )
  }
  if (
    excludedCases[0]?.id !== 'document-odt' ||
    !Array.isArray(input['namedExclusions']) ||
    input['namedExclusions'].length !== 1
  ) {
    throw new TypeError('document-odt must be the one named exclusion')
  }
  const namedExclusion = object(input['namedExclusions'][0], 'namedExclusions[0]')
  if (
    namedExclusion['id'] !== 'document-odt' ||
    namedExclusion['reason'] !== excludedCases[0].corpus.reason
  ) {
    throw new TypeError('document-odt exclusion does not match namedExclusions')
  }
  const generatedFrom = object(input['generatedFrom'], 'generatedFrom')
  const bundledCatalog = object(generatedFrom['bundledCatalog'], 'generatedFrom.bundledCatalog')
  const offlineRelease = object(generatedFrom['offlineRelease'], 'generatedFrom.offlineRelease')
  if (!Array.isArray(bundledCatalog['roots']) || !Array.isArray(offlineRelease['roots'])) {
    throw new TypeError('generated catalog roots must be arrays')
  }
  if (!Array.isArray(offlineRelease['packageIds'])) {
    throw new TypeError('generated package ids must be an array')
  }
  const contributionCount = generatedFrom['codecContributionCount']
  if (!Number.isSafeInteger(contributionCount) || Number(contributionCount) <= 0) {
    throw new TypeError('generated codec contribution count must be positive')
  }
  return Object.freeze({
    kind: 'x3.ga-recovery/format-family-smoke',
    schemaVersion: 1,
    generatedFrom: Object.freeze({
      bundledCatalog: Object.freeze({
        sha256: sha256(bundledCatalog['sha256'], 'generatedFrom.bundledCatalog.sha256'),
        roots: Object.freeze(
          bundledCatalog['roots'].map((item, index) => {
            const root = object(item, `generatedFrom.bundledCatalog.roots[${index}]`)
            return Object.freeze({
              coordinate: nonBlank(
                root['coordinate'],
                `generatedFrom.bundledCatalog.roots[${index}].coordinate`,
              ),
            })
          }),
        ),
      }),
      offlineRelease: Object.freeze({
        descriptorSha256: sha256(
          offlineRelease['descriptorSha256'],
          'generatedFrom.offlineRelease.descriptorSha256',
        ),
        catalogSha256: sha256(
          offlineRelease['catalogSha256'],
          'generatedFrom.offlineRelease.catalogSha256',
        ),
        packageIds: sorted(
          offlineRelease['packageIds'].map((id, index) =>
            nonBlank(id, `generatedFrom.offlineRelease.packageIds[${index}]`),
          ),
        ),
        roots: sorted(
          offlineRelease['roots'].map((id, index) =>
            nonBlank(id, `generatedFrom.offlineRelease.roots[${index}]`),
          ),
        ),
      }),
      codecContributionCount: Number(contributionCount),
    }),
    cases: Object.freeze(cases),
    namedExclusions: Object.freeze([
      Object.freeze({
        id: 'document-odt',
        reason: nonBlank(namedExclusion['reason'], 'exclusion reason'),
      }),
    ]),
  })
}

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('')

/** Fetch and hash the authority copied into this exact PWA build. */
export async function loadPwaFormatSmokeAuthority(
  uri: string,
  expectedSha256: string,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly authority: FormatSmokeAuthority; readonly sha256: string }> {
  const response = await fetcher(uri, { cache: 'no-store' })
  if (!response.ok)
    throw new TypeError(`format smoke authority request failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = `sha256:${toHex(await crypto.subtle.digest('SHA-256', bytes))}`
  if (actual !== expectedSha256) {
    throw new TypeError('served format smoke authority does not match this build')
  }
  const authority = validatePwaFormatSmokeAuthority(
    JSON.parse(new TextDecoder().decode(bytes)) as unknown,
  )
  return Object.freeze({ authority, sha256: actual })
}

const positive = (value: number): boolean => Number.isFinite(value) && value > 0

function stagePass(expected: FormatSmokeStage, actual: PwaFormatSmokeStageEvidence): boolean {
  if (expected !== actual.kind) return false
  if (actual.kind === 'raster') {
    return (
      positive(actual.width) &&
      positive(actual.height) &&
      positive(actual.opaquePixels) &&
      positive(actual.metadataEntries)
    )
  }
  if (actual.kind === 'tree-text') {
    return positive(actual.treeNodes) && positive(actual.textCharacters)
  }
  if (actual.kind === 'tree') return positive(actual.treeNodes)
  if (actual.kind === 'metadata-tree') {
    return positive(actual.metadataEntries) && positive(actual.treeNodes)
  }
  return positive(actual.width) && positive(actual.height)
}

const safeFailure = (id: FormatSmokeCaseId, code: string): PwaFormatSmokeCaseReceipt =>
  Object.freeze({
    id,
    outcome: 'failed',
    code,
    // Never copy an exception message here: browser/file errors may contain the corpus URL.
    message: 'the installed PWA case did not complete',
    verdict: 'fail',
  })

function freezeReceipt(receipt: PwaFormatSmokeReceipt): PwaFormatSmokeReceipt {
  return Object.freeze(receipt)
}

export interface CreatePwaFormatSmokeAcceptanceOptions {
  readonly authority: FormatSmokeAuthority
  readonly authoritySha256: string
  readonly bridge: PwaFormatSmokeBridge
}

/** Compose the opt-in browser control and its path-free durable receipt. */
export function createPwaFormatSmokeAcceptance(
  options: CreatePwaFormatSmokeAcceptanceOptions,
): PwaFormatSmokeControl {
  const authority = options.authority
  const expectedPackages = authority.generatedFrom.offlineRelease.packageIds
  let receipt = freezeReceipt({
    kind: PWA_FORMAT_SMOKE_KIND,
    schemaVersion: 1,
    authority: Object.freeze({
      sha256: options.authoritySha256,
      caseCount: 14,
      namedExclusionCount: 1,
    }),
    catalog: Object.freeze({
      expectedBundledCatalogSha256: authority.generatedFrom.bundledCatalog.sha256,
      expectedOfflineCatalogSha256: authority.generatedFrom.offlineRelease.catalogSha256,
      actualOfflineCatalogSha256: '',
      expectedManagedRoots: authority.generatedFrom.offlineRelease.roots,
      loadedManagedRoots: Object.freeze([]),
      expectedCodecContributionCount: authority.generatedFrom.codecContributionCount,
      loadedCodecContributionCount: 0,
    }),
    packages: Object.freeze({ expectedIds: expectedPackages, installed: Object.freeze([]) }),
    cases: Object.freeze([]),
    verdict: 'pending',
  })

  return Object.freeze({
    prepare: () => options.bridge.preparePackages(expectedPackages),
    receipt: () => receipt,
    async run(corpusUrls: Readonly<Record<string, string>>) {
      const runtime = await options.bridge.runtimeIdentity()
      const observations: PwaFormatSmokeCaseReceipt[] = []
      for (const testCase of authority.cases) {
        if (testCase.corpus.kind === 'named-exclusion') {
          observations.push(
            Object.freeze({
              id: testCase.id,
              outcome: 'excluded',
              reason:
                testCase.corpus.reason ??
                authority.namedExclusions[0]?.reason ??
                'No real ODT corpus is available.',
              verdict: 'pass',
            }),
          )
          continue
        }
        if (testCase.runtime.pwa.kind === 'host-facility-refusal') {
          try {
            await options.bridge.openHostOnlySource(testCase)
            observations.push(safeFailure(testCase.id, 'x3.acceptance/facility-was-available'))
          } catch (error) {
            const terminal = testCase.route.at(-1)
            const actual =
              isModkitError(error) && error.code === PWA_HOST_FACILITY_UNAVAILABLE
                ? {
                    code: error.code,
                    boundary: error.context?.['boundary'],
                    facility: error.context?.['facility'],
                    requestId: error.context?.['requestId'],
                    sourceKind: error.context?.['sourceKind'],
                    contentSha256: error.context?.['contentSha256'],
                    bytes: error.context?.['bytes'],
                    requestedFormatId: error.context?.['requestedFormatId'],
                  }
                : undefined
            const matchesExpected =
              actual !== undefined &&
              actual.code === testCase.runtime.pwa.code &&
              actual.boundary === WEB_SOURCE_OPEN_BOUNDARY &&
              actual.facility === testCase.runtime.pwa.facility &&
              actual.requestId === testCase.id &&
              actual.sourceKind === testCase.corpus.kind &&
              actual.contentSha256 === testCase.corpus.sha256 &&
              actual.bytes === testCase.corpus.bytes &&
              actual.requestedFormatId === terminal?.formatId
            observations.push(
              matchesExpected
                ? Object.freeze({
                    id: testCase.id,
                    outcome: 'refused',
                    code: PWA_HOST_FACILITY_UNAVAILABLE,
                    facility: PWA_FILESYSTEM_READ_RANDOM,
                    source: Object.freeze({
                      boundary: WEB_SOURCE_OPEN_BOUNDARY,
                      kind: 'sc2-casc-entry',
                      contentSha256: actual.contentSha256 as string,
                      bytes: actual.bytes as number,
                      requestedFormatId: actual.requestedFormatId as string,
                    }),
                    verdict: 'pass',
                  })
                : safeFailure(testCase.id, 'x3.acceptance/wrong-facility-refusal'),
            )
          }
          continue
        }
        const corpusUrl = corpusUrls[testCase.id]
        if (typeof corpusUrl !== 'string' || corpusUrl === '') {
          observations.push(safeFailure(testCase.id, 'x3.acceptance/missing-corpus-url'))
          continue
        }
        try {
          const opened = await options.bridge.open(testCase, corpusUrl)
          const pass =
            same(opened.selectedRoute, testCase.route) && stagePass(testCase.stage, opened.stage)
          observations.push(
            Object.freeze({
              id: testCase.id,
              outcome: 'opened',
              selectedRoute: Object.freeze(
                opened.selectedRoute.map(step => Object.freeze({ ...step })),
              ),
              corpus: Object.freeze({ ...opened.corpus }),
              stage: Object.freeze({ ...opened.stage }) as PwaFormatSmokeStageEvidence,
              verdict: pass ? 'pass' : 'fail',
            }),
          )
        } catch (error) {
          options.bridge.reportFailure?.(testCase.id, error)
          observations.push(safeFailure(testCase.id, 'x3.acceptance/open-failed'))
        }
      }

      const installedPackages = Object.freeze(
        [...runtime.packages]
          .map(item => Object.freeze({ ...item }))
          .sort((left, right) => compareText(left.id, right.id)),
      )
      const identityPass =
        runtime.offlineCatalogSha256 === authority.generatedFrom.offlineRelease.catalogSha256 &&
        same(sorted(runtime.loadedManagedRoots), authority.generatedFrom.offlineRelease.roots) &&
        runtime.codecContributionCount === authority.generatedFrom.codecContributionCount &&
        same(
          installedPackages.filter(item => item.enabled).map(item => item.id),
          expectedPackages,
        )
      const pass = identityPass && observations.every(item => item.verdict === 'pass')
      receipt = freezeReceipt({
        kind: PWA_FORMAT_SMOKE_KIND,
        schemaVersion: 1,
        authority: receipt.authority,
        catalog: Object.freeze({
          expectedBundledCatalogSha256: authority.generatedFrom.bundledCatalog.sha256,
          expectedOfflineCatalogSha256: authority.generatedFrom.offlineRelease.catalogSha256,
          actualOfflineCatalogSha256: runtime.offlineCatalogSha256,
          expectedManagedRoots: authority.generatedFrom.offlineRelease.roots,
          loadedManagedRoots: sorted(runtime.loadedManagedRoots),
          expectedCodecContributionCount: authority.generatedFrom.codecContributionCount,
          loadedCodecContributionCount: runtime.codecContributionCount,
        }),
        packages: Object.freeze({ expectedIds: expectedPackages, installed: installedPackages }),
        cases: Object.freeze(observations),
        verdict: pass ? 'pass' : 'fail',
      })
      return receipt
    },
  })
}
