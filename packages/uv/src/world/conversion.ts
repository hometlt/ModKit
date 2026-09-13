export const UVW_CONVERSION_PROFILE_IDS = Object.freeze([
  'geometry',
  'visual-world',
  'native-authored-map',
  'playable-scenario',
] as const)

export type UvwConversionProfileId = (typeof UVW_CONVERSION_PROFILE_IDS)[number]

export interface UvwConversionRefusal {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export type UvwConversionLossMeasurement =
  | Readonly<{
      kind: 'absolute-error'
      value: number
      unit: string
    }>
  | Readonly<{
      kind: 'not-applicable'
      reason: string
    }>
  | Readonly<{
      kind: 'not-measured'
      reason: string
    }>

export interface UvwConversionLoss {
  readonly feature: string
  readonly reason: string
  readonly replacement: string
  readonly measurement?: UvwConversionLossMeasurement
}

export interface UvwConversionReceipt {
  readonly schemaVersion: 1
  readonly source: Readonly<{ family: 'uvw'; format: 'UVW'; version: '1.0' }>
  readonly target: Readonly<{ gameId: string; artifactKind: string }>
  readonly requestedProfile: UvwConversionProfileId | null
  readonly achievedProfile?: UvwConversionProfileId
  readonly status: 'converted' | 'refused'
  readonly losses: readonly (Omit<UvwConversionLoss, 'measurement'> & {
    readonly measurement: UvwConversionLossMeasurement
  })[]
  readonly refusals: readonly UvwConversionRefusal[]
  readonly verification: Readonly<Record<string, unknown>>
}

const PROFILE_IDS = new Set<string>(UVW_CONVERSION_PROFILE_IDS)

function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(item => snapshot(item))) as T
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = snapshot(item)
    return Object.freeze(output) as T
  }
  return value
}

export type UvwConversionProfilePreflight =
  | Readonly<{ accepted: true; requestedProfile: UvwConversionProfileId }>
  | Readonly<{
      accepted: false
      requestedProfile: UvwConversionProfileId | undefined
      refusal: UvwConversionRefusal
    }>

/** Refuses unknown or unsupported guarantees before a native writer allocates output bytes. */
export function preflightUvwConversionProfile(
  requested: unknown,
  supported: readonly UvwConversionProfileId[],
): UvwConversionProfilePreflight {
  const value = requested ?? 'geometry'
  if (typeof value !== 'string' || !PROFILE_IDS.has(value))
    return Object.freeze({
      accepted: false,
      requestedProfile: undefined,
      refusal: Object.freeze({
        code: 'conversion-profile-unknown',
        message: `unknown UVW conversion profile ${JSON.stringify(value)}`,
        path: 'options.profile',
      }),
    })
  const requestedProfile = value as UvwConversionProfileId
  if (!supported.includes(requestedProfile))
    return Object.freeze({
      accepted: false,
      requestedProfile,
      refusal: Object.freeze({
        code: 'conversion-profile-unsupported',
        message: `UVW conversion profile ${requestedProfile} is not implemented by this target writer`,
        path: 'options.profile',
      }),
    })
  return Object.freeze({ accepted: true, requestedProfile })
}

/** Creates an owned JSON-safe receipt. Missing error measurements stay explicit, never implied zero. */
export function createUvwConversionReceipt(input: {
  readonly targetGameId: string
  readonly artifactKind: string
  readonly requestedProfile: UvwConversionProfileId | null
  readonly achievedProfile?: UvwConversionProfileId
  readonly status: 'converted' | 'refused'
  readonly losses?: readonly UvwConversionLoss[]
  readonly refusals?: readonly UvwConversionRefusal[]
  readonly verification?: Readonly<Record<string, unknown>>
}): UvwConversionReceipt {
  if (input.targetGameId.length === 0 || input.artifactKind.length === 0)
    throw new TypeError('UVW conversion receipt target must be named')
  if (input.status === 'converted' && input.achievedProfile === undefined)
    throw new TypeError('converted UVW receipt requires an achieved profile')
  if (input.status === 'refused' && input.achievedProfile !== undefined)
    throw new TypeError('refused UVW receipt cannot claim an achieved profile')
  const losses = (input.losses ?? []).map(loss => ({
    ...loss,
    measurement:
      loss.measurement ??
      Object.freeze({
        kind: 'not-measured' as const,
        reason: 'the converter did not provide a numeric error bound',
      }),
  }))
  return snapshot({
    schemaVersion: 1 as const,
    source: { family: 'uvw' as const, format: 'UVW' as const, version: '1.0' as const },
    target: { gameId: input.targetGameId, artifactKind: input.artifactKind },
    requestedProfile: input.requestedProfile,
    ...(input.achievedProfile === undefined ? {} : { achievedProfile: input.achievedProfile }),
    status: input.status,
    losses,
    refusals: input.refusals ?? [],
    verification: input.verification ?? {},
  })
}
