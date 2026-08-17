// Types for the restated MK3 vocabulary used by the MK2 allocation report (plain JavaScript by
// design: it must run against a foreign checkout without a build step).

export const SEGMENT: RegExp
export const QUALIFIED: RegExp
export const OPERATION_DOMAINS: readonly string[]
export const SHARED_OPERATION_IDS: readonly string[]
export const PERMISSION_CLASSES: readonly string[]
export const PERMISSION_MAPPING: Readonly<Record<string, readonly string[]>>
export const CAPABILITY_MAPPING: Readonly<
  Record<
    string,
    {
      readonly home: 'implicit' | 'operation' | 'data-plane' | 'blocked' | 'absent' | 'unclear'
      readonly ids?: readonly string[]
      readonly note?: string
    }
  >
>
export const X3_ROLE_BY_KIND: Readonly<Record<string, string>>
