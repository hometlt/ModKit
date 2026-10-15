# JPEG XR / independent-component HD Photo

One BSD jxrlib source closure, one WASM and one lifecycle in
`@modkit/codec-kit/raster/jpegxr`. Standard `decodeJpegXr`/`loadJpegXrDecoder`
retain their RGBA8, alpha, bound, cancellation and trap-recovery semantics.

`decodeJpegXrComponents` returns tight, interleaved, biased UNORM8 codestream
components without ICC, RGB/BGR conversion or implicit alpha. It refuses alpha,
premultiplication, non-8-bit output and more than three components. The output
bound is the actual component byte count, not RGBA padding.

The optional `dialect: 'hdphoto-independent'` is explicitly selected by a format
owner. It admits spatial, subversion 1, overlap 1, no tiling, no alpha and no
flexbits, with 1–3 components. Other HD Photo variants are not claimed. Its
per-image flag is copied into coding contexts and threaded through private
overlap operators; no process-global mode or fallback decoder exists. Standard
operators and optional upstream x86 entry points retain their original defaults.

Headerless component output derives channel count from the native plane header.
One channel uses the gray GUID; two/three use generic three-slot storage because
T.832 has no two-channel GUID. The raw decoder returns the plane's actual count
and stride. Game YCoCg, normal reconstruction and atlas conventions stay outside
Core. No native encoder is exported.

Provenance and original/modified hashes are in `PROVENANCE.json`; the pinned BSD
source is retained. Local changes implement independently established bitstream
rules, not copied proprietary decompiler output. Build with the existing
`build.mjs`, `EMSDK` and `MODKIT_TEMP=C:/MKTEMP`.

Run `pnpm exec vitest run --config vitest.owner.config.ts packages/codec-kit/test/raster-jpegxr.test.ts`.
The ordinary suite covers WIC regressions and raw API boundaries. Setting
`MODKIT_JXR_HDP_PROOFS` to the local pixel-oracle directory additionally checks
20 full raw pages, 1/2/3 components, 128/32-pixel shapes, individual output bounds
and subsequent standard decoding. Game assets are not committed; without that
environment variable the corpus case is not registered, not silently proven.
