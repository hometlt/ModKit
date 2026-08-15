import { uint64, type SourceSpan, type SourceSpanWire } from '@modkitx-x3/core'

export const byteOnlySpan = {
  byteOffset: uint64('0'),
  byteLength: uint64('16'),
} satisfies SourceSpan

export const textOnlySpan = {
  utf16Offset: 0,
  utf16Length: 8,
  line: 0,
  column: 0,
} satisfies SourceSpan

export const combinedSpan = {
  ...byteOnlySpan,
  ...textOnlySpan,
} satisfies SourceSpan

export const wireSpan = {
  byteOffset: '0',
  byteLength: '16',
} satisfies SourceSpanWire

// @ts-expect-error An empty span has no complete coordinate system.
export const emptySpan = {} satisfies SourceSpan

// @ts-expect-error Byte coordinates are an inseparable offset/length pair.
export const halfByteSpan = { byteOffset: uint64('0') } satisfies SourceSpan

// @ts-expect-error Text coordinates require offset, length, line, and column.
export const halfTextSpan = { utf16Offset: 0, utf16Length: 1 } satisfies SourceSpan

// @ts-expect-error A mixed span must provide both coordinate systems completely.
export const partialMixedSpan: SourceSpan = {
  byteOffset: uint64('0'),
  byteLength: uint64('1'),
  utf16Offset: 0,
  utf16Length: 1,
}

// @ts-expect-error Public byte coordinates require validation and branding.
export const unbrandedByteSpan = { byteOffset: '0', byteLength: '1' } satisfies SourceSpan

// @ts-expect-error bigint is never part of the JSON wire shape.
export const bigintByteSpan = { byteOffset: 0n, byteLength: 1n } satisfies SourceSpan
