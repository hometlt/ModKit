const AUTHORITY_KIND = 'x3.ga-recovery/format-family-smoke'
const RECEIPT_KIND = 'x3.electron/format-smoke-acceptance'
const FACILITY_REFUSAL_CODE = 'x3.host/facility-unavailable'
const READ_RANDOM_FACILITY = 'filesystem.read-random'

type JsonRecord = Readonly<Record<string, unknown>>

export type ElectronFormatSmokeBoundary =
  'direct-file' | 'container-file' | 'loose-materialized' | 'product-container-entry'

export interface ElectronFormatSmokeRouteStep {
  readonly formatId: string
  readonly extensionId: string
  readonly contributionId: string
}

export interface ElectronFormatSmokePlan {
  readonly kind: 'x3.electron/format-smoke-plan'
  readonly schemaVersion: 1
  readonly authoritySha256: string
  readonly cases: readonly {
    readonly caseId: string
    readonly fileName: string
    readonly boundary: ElectronFormatSmokeBoundary
    readonly stage: string
    readonly parentPath?: string
    readonly entryPath?: string
  }[]
}

export interface ElectronFormatSmokeObservation {
  readonly entryName: string
  readonly codecId?: string
  readonly selectedRoute?: readonly ElectronFormatSmokeRouteStep[]
  readonly bytes: number
  readonly sha256: string
  readonly views: readonly string[]
  readonly stages: readonly {
    readonly id: string
    readonly state: 'ok' | 'ok(degraded)' | 'EMPTY'
  }[]
  readonly panels: readonly { readonly id: string; readonly state: 'ok' | 'EMPTY' }[]
  readonly container?: {
    readonly parentEntryName: string
    readonly parentCodecId?: string
    readonly parentRoute?: readonly ElectronFormatSmokeRouteStep[]
    readonly entryPath: string
  }
  readonly editFallback?: { readonly code: string; readonly reason: string }
}

export interface ElectronFormatSmokeRuntime {
  readonly authoritySha256: string
  readonly plan: ElectronFormatSmokePlan
  readonly renderer: {
    readonly realmId: string
    readonly facilities: readonly string[]
  }
  readonly observations: readonly ElectronFormatSmokeObservation[]
}

interface SmokeCase {
  readonly id: string
  readonly stage: string
  readonly route: readonly {
    readonly formatId: string
    readonly extensionId: string
    readonly contributionId: string
  }[]
  readonly corpus: {
    readonly kind: string
    readonly path?: string
    readonly container?: string
    readonly bytes?: number
    readonly sha256?: string
    readonly reason?: string
  }
  readonly runtime?: {
    readonly pwa?: {
      readonly kind?: string
      readonly code?: string
      readonly facility?: string
    }
  }
}

interface Authority {
  readonly kind: typeof AUTHORITY_KIND
  readonly schemaVersion: 1
  readonly cases: readonly SmokeCase[]
  readonly namedExclusions: readonly { readonly id: string; readonly reason?: string }[]
  readonly generatedFrom: {
    readonly bundledCatalog?: {
      readonly sha256?: string
      readonly roots?: readonly { readonly coordinate: string; readonly digest?: string }[]
    }
    readonly offlineRelease?: {
      readonly descriptorSha256?: string
      readonly catalogSha256?: string
      readonly catalogSignature?: {
        readonly algorithm?: string
        readonly keyId?: string
        readonly verified?: boolean
      }
      readonly packageIds?: readonly string[]
      readonly roots?: readonly string[]
    }
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const basename = (value: string): string => {
  const parts = value.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

const finalRoute = (item: SmokeCase) => item.route[item.route.length - 1]

const sameRoute = (
  observed: readonly ElectronFormatSmokeRouteStep[] | undefined,
  expected: readonly ElectronFormatSmokeRouteStep[],
): boolean =>
  observed !== undefined &&
  observed.length === expected.length &&
  observed.every(
    (item, index) =>
      item.formatId === expected[index]?.formatId &&
      item.extensionId === expected[index]?.extensionId &&
      item.contributionId === expected[index]?.contributionId,
  )

export const electronFormatSmokeStageAlternates = (stage: string): readonly string[] => {
  switch (stage) {
    case 'raster':
      return ['image']
    case 'tree':
      return ['tree', 'archive']
    case 'tree-text':
      return ['tree', 'code', 'text', 'virtual-text']
    case 'metadata-tree':
      return ['tree', 'audio']
    case 'model-or-wireframe':
      return ['model', 'world', 'tree']
    default:
      return [stage]
  }
}

function readCases(authority: unknown): Authority {
  if (!isRecord(authority)) throw new TypeError('format-smoke authority must be an object')
  if (authority['kind'] !== AUTHORITY_KIND || authority['schemaVersion'] !== 1) {
    throw new TypeError('format-smoke authority kind/schemaVersion mismatch')
  }
  if (!Array.isArray(authority['cases'])) throw new TypeError('format-smoke cases must be an array')
  if (!Array.isArray(authority['namedExclusions'])) {
    throw new TypeError('format-smoke namedExclusions must be an array')
  }
  if (!isRecord(authority['generatedFrom'])) {
    throw new TypeError('format-smoke generatedFrom must be an object')
  }
  for (const item of authority['cases']) {
    if (!isRecord(item) || asString(item['id']) === undefined) {
      throw new TypeError('format-smoke case id must be a non-empty string')
    }
    if (!Array.isArray(item['route']) || item['route'].length === 0) {
      throw new TypeError(`format-smoke case ${String(item['id'])} has no route`)
    }
    if (!isRecord(item['corpus'])) {
      throw new TypeError(`format-smoke case ${String(item['id'])} has no corpus`)
    }
  }
  return authority as unknown as Authority
}

export function readElectronFormatSmokePlan(plan: unknown): ElectronFormatSmokePlan {
  if (!isRecord(plan)) throw new TypeError('format-smoke plan must be an object')
  if (plan['kind'] !== 'x3.electron/format-smoke-plan' || plan['schemaVersion'] !== 1) {
    throw new TypeError('format-smoke plan kind/schemaVersion mismatch')
  }
  if (
    typeof plan['authoritySha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(plan['authoritySha256'])
  ) {
    throw new TypeError('format-smoke plan authoritySha256 must be lowercase 64-hex')
  }
  if (!Array.isArray(plan['cases'])) throw new TypeError('format-smoke plan cases must be an array')
  for (const item of plan['cases']) {
    if (
      !isRecord(item) ||
      asString(item['caseId']) === undefined ||
      asString(item['fileName']) === undefined ||
      asString(item['stage']) === undefined ||
      !['direct-file', 'container-file', 'loose-materialized', 'product-container-entry'].includes(
        String(item['boundary']),
      ) ||
      String(item['fileName']).includes('/') ||
      String(item['fileName']).includes('\\')
    ) {
      throw new TypeError('format-smoke plan cases must be path-free case/file/boundary/stage rows')
    }
    if (
      item['boundary'] === 'product-container-entry' &&
      (asString(item['parentPath']) === undefined || asString(item['entryPath']) === undefined)
    ) {
      throw new TypeError('product-container-entry cases require parentPath and entryPath')
    }
  }
  return plan as unknown as ElectronFormatSmokePlan
}

export function summarizeElectronFormatSmokeAuthority(authority: unknown) {
  const document = readCases(authority)
  const included = document.cases.filter(item => item.corpus.kind !== 'named-exclusion')
  const excluded = document.cases.filter(item => item.corpus.kind === 'named-exclusion')
  const pwaFacilityRefusals = document.cases.filter(
    item =>
      item.runtime?.pwa?.kind === 'host-facility-refusal' &&
      item.runtime.pwa.code === FACILITY_REFUSAL_CODE &&
      item.runtime.pwa.facility === READ_RANDOM_FACILITY,
  )
  const packageIds = document.generatedFrom.offlineRelease?.packageIds ?? []
  const externalRoots = document.generatedFrom.offlineRelease?.roots ?? []
  const commonRoots = document.generatedFrom.bundledCatalog?.roots ?? []
  if (
    document.cases.length !== 14 ||
    included.length !== 14 ||
    excluded.length !== 0 ||
    document.namedExclusions.length !== 0
  ) {
    throw new TypeError('format-smoke authority must have 14 included cases and no exclusions')
  }
  if (
    packageIds.length !== 2 ||
    externalRoots.length !== 9 ||
    // the Common catalog grows with its built-in roots (eleven since java, 29.09); each is pinned
    // by digest in the authority, whose own digest the plan pins
    commonRoots.length === 0 ||
    document.generatedFrom.offlineRelease?.catalogSignature?.algorithm !== 'Ed25519' ||
    document.generatedFrom.offlineRelease.catalogSignature.verified !== true ||
    asString(document.generatedFrom.offlineRelease.catalogSignature.keyId) === undefined ||
    pwaFacilityRefusals.length !== 4
  ) {
    throw new TypeError(
      'format-smoke authority must carry signed catalog identity, exact package/root counts and four PWA read-random refusals',
    )
  }
  return Object.freeze({
    cases: document.cases,
    included,
    excluded,
    pwaFacilityRefusals,
    packageIds,
    externalRoots,
    commonRoots,
    catalog: Object.freeze({
      descriptorSha256: document.generatedFrom.offlineRelease?.descriptorSha256,
      catalogSha256: document.generatedFrom.offlineRelease?.catalogSha256,
      signature: document.generatedFrom.offlineRelease?.catalogSignature,
    }),
  })
}

function matchObservation(
  observations: readonly ElectronFormatSmokeObservation[],
  plan: ElectronFormatSmokePlan,
  item: SmokeCase,
): ElectronFormatSmokeObservation | undefined {
  const name = plan.cases.find(planned => planned.caseId === item.id)?.fileName
  if (name === undefined || name.length === 0) return undefined
  return observations.find(
    observation => observation.entryName.toLowerCase() === name.toLowerCase(),
  )
}

export function buildElectronFormatSmokeReceipt(
  authority: unknown,
  runtime: ElectronFormatSmokeRuntime,
) {
  const summary = summarizeElectronFormatSmokeAuthority(authority)
  const plan = readElectronFormatSmokePlan(runtime.plan)
  const planned = new Map(plan.cases.map(item => [item.caseId, item]))
  const failures: { code: string; caseId?: string; message: string }[] = []

  if (!/^[a-f0-9]{64}$/u.test(runtime.authoritySha256)) {
    failures.push({
      code: 'x3.electron-format-smoke/authority-sha-invalid',
      message: 'authority sha256 must be lowercase 64-hex',
    })
  }
  if (plan.authoritySha256 !== runtime.authoritySha256) {
    failures.push({
      code: 'x3.electron-format-smoke/plan-authority-mismatch',
      message: 'format-smoke plan does not name the profile authority sha256',
    })
  }
  if (plan.cases.length !== summary.included.length || planned.size !== plan.cases.length) {
    failures.push({
      code: 'x3.electron-format-smoke/plan-case-count',
      message: 'format-smoke plan must name every included authority case exactly once',
    })
  }
  for (const item of summary.included) {
    const boundary = planned.get(item.id)?.boundary
    if (
      (item.corpus.kind === 'sc2-casc-entry' || item.corpus.kind === 'warzone-wz-entry') &&
      boundary !== 'product-container-entry'
    ) {
      failures.push({
        code: 'x3.electron-format-smoke/container-boundary-required',
        caseId: item.id,
        message: `${item.id}: nested corpus must be opened through product container entry routing`,
      })
    }
  }

  const cases = summary.cases.map(item => {
    const route = finalRoute(item)
    const plannedCase = planned.get(item.id)
    const observed =
      item.corpus.kind === 'named-exclusion'
        ? undefined
        : matchObservation(runtime.observations, plan, item)
    const acceptedStages = electronFormatSmokeStageAlternates(item.stage)
    const mountedStage = observed?.stages.find(
      stage => acceptedStages.includes(stage.id) && stage.state !== 'EMPTY',
    )
    const codecMatches =
      observed !== undefined && route !== undefined && observed.codecId === route.contributionId
    const parentRoute = item.route[0]
    const routeMatches = observed !== undefined && sameRoute(observed.selectedRoute, item.route)
    const containerMatches =
      plannedCase?.boundary !== 'product-container-entry' ||
      (observed?.container !== undefined &&
        parentRoute !== undefined &&
        observed.container.parentCodecId === parentRoute.contributionId &&
        sameRoute(observed.container.parentRoute, [parentRoute]) &&
        observed.container.entryPath === plannedCase.entryPath)
    const exactBytes =
      observed !== undefined &&
      observed.bytes === item.corpus.bytes &&
      observed.sha256 === item.corpus.sha256
    const timedOutEdit = observed?.editFallback?.code === 'x3.electron/edit-arm-timeout'
    const caseFailures: string[] = []
    if (item.corpus.kind === 'named-exclusion') {
      caseFailures.push('unexpected-named-exclusion')
    } else {
      if (plannedCase === undefined) caseFailures.push('case-not-planned')
      if (observed === undefined) caseFailures.push('case-not-opened')
      if (!exactBytes) caseFailures.push('corpus-bytes-mismatch')
      if (!codecMatches || !routeMatches) caseFailures.push('route-not-selected')
      if (!containerMatches) caseFailures.push('container-route-not-selected')
      if (mountedStage === undefined) caseFailures.push('stage-not-mounted')
      if (timedOutEdit) caseFailures.push('edit-arm-timeout')
    }
    for (const reason of caseFailures) {
      failures.push({
        code: `x3.electron-format-smoke/${reason}`,
        caseId: item.id,
        message: `${item.id}: ${reason}`,
      })
    }
    return Object.freeze({
      id: item.id,
      included: item.corpus.kind !== 'named-exclusion',
      corpus: Object.freeze({
        kind: item.corpus.kind,
        basename: item.corpus.path === undefined ? undefined : basename(item.corpus.path),
        containerBasename:
          item.corpus.container === undefined ? undefined : basename(item.corpus.container),
        bytes: item.corpus.bytes,
        sha256: item.corpus.sha256,
      }),
      expected: Object.freeze({
        stage: item.stage,
        stageAlternates: acceptedStages,
        route: item.route.map(part =>
          Object.freeze({
            formatId: part.formatId,
            extensionId: part.extensionId,
            contributionId: part.contributionId,
          }),
        ),
      }),
      boundary:
        plannedCase === undefined
          ? undefined
          : Object.freeze({
              kind: plannedCase.boundary,
              routeScope:
                plannedCase.boundary === 'loose-materialized'
                  ? 'final-authority-step-only'
                  : plannedCase.boundary === 'product-container-entry'
                    ? 'container-and-final-authority-steps'
                    : 'single-authority-step',
            }),
      observed:
        observed === undefined
          ? undefined
          : Object.freeze({
              entryName: observed.entryName,
              codecId: observed.codecId,
              selectedRoute: observed.selectedRoute,
              bytes: observed.bytes,
              sha256: observed.sha256,
              views: observed.views,
              selectedStage: mountedStage?.id,
              stages: observed.stages,
              panels: observed.panels,
              container: observed.container,
              editFallback: observed.editFallback,
            }),
      failures: Object.freeze(caseFailures),
    })
  })

  return Object.freeze({
    kind: RECEIPT_KIND,
    schemaVersion: 1,
    verdict: failures.length === 0 ? 'pass' : 'fail',
    authority: Object.freeze({
      sha256: runtime.authoritySha256,
      cases: summary.included.length,
      namedExclusion: summary.excluded[0]?.id,
      packageIds: summary.packageIds,
      commonRoots: summary.commonRoots.map(item => item.coordinate),
      externalRoots: summary.externalRoots,
      catalog: summary.catalog,
      pwaFacilityRefusals: summary.pwaFacilityRefusals.map(item =>
        Object.freeze({
          caseId: item.id,
          code: item.runtime?.pwa?.code,
          facility: item.runtime?.pwa?.facility,
        }),
      ),
    }),
    runtime: Object.freeze({
      renderer: runtime.renderer,
      plan: Object.freeze({
        authoritySha256: plan.authoritySha256,
        cases: plan.cases.map(item =>
          Object.freeze({
            caseId: item.caseId,
            fileName: item.fileName,
            boundary: item.boundary,
            stage: item.stage,
          }),
        ),
      }),
    }),
    cases: Object.freeze(cases),
    failures: Object.freeze(failures),
  })
}
