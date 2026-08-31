/**
 * Compile-time proof for the NXT-103 surface pin (`SurfaceOf<T>`): a standard surface must name
 * exactly the ABI interface's methods, optional ABI methods must be flagged, and `lease` is the
 * only kind that carries `result`/`wrapper`. No runtime behaviour — `pnpm typecheck` is the test.
 */

import { contractId } from '@modkit/core'
import type {
  DataSourceMethodSurfaceV1Wire,
  RasterImageSource,
  SurfaceOf,
  TextDataSource,
} from '@modkit/sdk'

const sig = { signal: 'last' } as const
const encoded = { contract: contractId('common.view/encoded-media'), major: 1 } as const

// a complete surface compiles
export const textOk = {
  methods: {
    info: { kind: 'value' },
    slice: { kind: 'value', ...sig },
    search: { kind: 'iterable', ...sig },
  },
} as const satisfies SurfaceOf<TextDataSource>

export const textMissing = {
  // @ts-expect-error — a missing ABI method (`search`) does not compile
  methods: {
    info: { kind: 'value' },
    slice: { kind: 'value', ...sig },
  },
} as const satisfies SurfaceOf<TextDataSource>

export const textExtra = {
  methods: {
    info: { kind: 'value' },
    slice: { kind: 'value', ...sig },
    search: { kind: 'iterable', ...sig },
    // @ts-expect-error — a method the ABI does not declare does not compile
    bogus: { kind: 'value' },
  },
} as const satisfies SurfaceOf<TextDataSource>

// an optional ABI method (`readRegion?`) must say so
export const rasterOk = {
  methods: {
    info: { kind: 'value', ...sig },
    encoded: { kind: 'lease', result: encoded, wrapper: 'bare', ...sig },
    readRegion: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies SurfaceOf<RasterImageSource>

export const rasterUnflagged = {
  methods: {
    info: { kind: 'value', ...sig },
    encoded: { kind: 'lease', result: encoded, wrapper: 'bare', ...sig },
    // @ts-expect-error — `readRegion` is optional on the ABI and must carry `optional: true`
    readRegion: { kind: 'value', ...sig },
  },
} as const satisfies SurfaceOf<RasterImageSource>

// kind ↔ result correlation is structural
export const leaseOk: DataSourceMethodSurfaceV1Wire = { kind: 'lease', result: encoded }
// @ts-expect-error — `lease` without `result` is not a method surface
export const leaseMissingResult: DataSourceMethodSurfaceV1Wire = { kind: 'lease' }
// @ts-expect-error — `value` must not carry `result`
export const valueWithResult: DataSourceMethodSurfaceV1Wire = { kind: 'value', result: encoded }
export const iterableWithWrapper: DataSourceMethodSurfaceV1Wire = {
  kind: 'iterable',
  // @ts-expect-error — `iterable` must not carry `wrapper`
  wrapper: 'bare',
}
