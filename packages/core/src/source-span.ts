import { deepFreeze } from './immutability.js'

/**
 * Wire-safe source coordinates shared by diagnostics and data-plane contracts.
 * Byte coordinates are canonical unsigned 64-bit decimal strings because JSON has
 * no lossless integer representation for the full u64 range. Text coordinates use
 * zero-based UTF-16 code units.
 */

const UINT64_MAX_DECIMAL = '18446744073709551615'

function fixedWidthDecimalAtMost(maximum: string): string {
  const alternatives = [maximum]

  // Every 20-digit u64 starts with the same first digit as UINT64_MAX_DECIMAL.
  // At each later position, accept a smaller digit and any remaining suffix.
  for (let index = 1; index < maximum.length; index += 1) {
    const maximumDigit = Number(maximum[index])
    if (maximumDigit === 0) continue

    const prefix = maximum.slice(0, index)
    const lowerDigit = maximumDigit === 1 ? '0' : `[0-${maximumDigit - 1}]`
    const remaining = maximum.length - index - 1
    const suffix = remaining === 0 ? '' : `[0-9]{${remaining}}`
    alternatives.push(`${prefix}${lowerDigit}${suffix}`)
  }

  return `(?:${alternatives.join('|')})`
}

/** Canonical decimal spelling of an unsigned 64-bit integer, including its upper bound. */
export const UINT64_DECIMAL_PATTERN = `^(?:0|[1-9][0-9]{0,18}|${fixedWidthDecimalAtMost(UINT64_MAX_DECIMAL)})$`

const byteCoordinateProperties = {
  byteOffset: { type: 'string', pattern: UINT64_DECIMAL_PATTERN },
  byteLength: { type: 'string', pattern: UINT64_DECIMAL_PATTERN },
} as const

const textCoordinateProperties = {
  utf16Offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  utf16Length: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  line: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  column: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
} as const

/**
 * Single wire authority for SourceSpan. Exactly one complete byte coordinate system,
 * one complete UTF-16 coordinate system, or both systems together is required.
 */
export const sourceSpanSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.modkit.org/x3/source-span.v1.schema.json',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['byteOffset', 'byteLength'],
      properties: byteCoordinateProperties,
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['utf16Offset', 'utf16Length', 'line', 'column'],
      properties: textCoordinateProperties,
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['byteOffset', 'byteLength', 'utf16Offset', 'utf16Length', 'line', 'column'],
      properties: {
        ...byteCoordinateProperties,
        ...textCoordinateProperties,
      },
    },
  ],
} as const

deepFreeze(sourceSpanSchema)

type SchemaProperties<Schema> = Schema extends {
  readonly properties: infer Properties extends Readonly<Record<string, unknown>>
}
  ? Properties
  : never

type SchemaRequiredKeys<Schema> = Schema extends {
  readonly required: readonly (infer Key)[]
}
  ? Extract<Key, keyof SchemaProperties<Schema>>
  : never

type SchemaPropertyValue<Property> = Property extends { readonly type: 'string' }
  ? string
  : Property extends { readonly type: 'integer' }
    ? number
    : never

type PropertyKeysOfUnion<Schema> = Schema extends unknown ? keyof SchemaProperties<Schema> : never
type SourceSpanSchemaBranch = (typeof sourceSpanSchema.oneOf)[number]
type SourceSpanPropertyKey = PropertyKeysOfUnion<SourceSpanSchemaBranch>

type InferStrictBranch<Schema> = {
  readonly [Key in SchemaRequiredKeys<Schema>]: SchemaPropertyValue<SchemaProperties<Schema>[Key]>
} & Partial<Readonly<Record<Exclude<SourceSpanPropertyKey, keyof SchemaProperties<Schema>>, never>>>

type InferSourceSpanWire<Schema> = Schema extends unknown ? InferStrictBranch<Schema> : never

/** Unbranded JSON representation, derived from the schema const for drift checks. */
export type SourceSpanWire = InferSourceSpanWire<SourceSpanSchemaBranch>

declare const uint64StringBrand: unique symbol

/** Canonical decimal u64 string. Construct with {@link uint64}. */
export type UInt64String = string & { readonly [uint64StringBrand]: true }

type BrandByteCoordinates<Span> = Span extends unknown
  ? {
      readonly [Key in keyof Span]: Key extends 'byteOffset' | 'byteLength'
        ? Span[Key] extends string
          ? UInt64String
          : Span[Key]
        : Span[Key]
    }
  : never

/** Public source span with branded byte coordinates and exact branch exclusivity. */
export type SourceSpan = BrandByteCoordinates<SourceSpanWire>

const uint64DecimalPattern = new RegExp(UINT64_DECIMAL_PATTERN)

export function isUInt64String(value: unknown): value is UInt64String {
  return typeof value === 'string' && uint64DecimalPattern.test(value)
}

/** Validate and brand a canonical decimal u64 value without losing precision. */
export function uint64(value: string | bigint): UInt64String {
  const decimal = typeof value === 'bigint' ? value.toString(10) : value
  if (!isUInt64String(decimal)) {
    throw new RangeError(`expected canonical decimal u64, received: ${decimal}`)
  }
  return decimal
}
