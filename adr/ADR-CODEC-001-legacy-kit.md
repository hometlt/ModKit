# ADR-CODEC-001: Pinned MK2 compatibility and the MK3 boundary

Implementation decision recorded on 2026-09-04; M1 owner acceptance pending. This is infrastructure readiness, not a completed codec, feature, operation or family ledger row.

## Decision and provenance

`@modkit/codec-kit/legacy` contains the neutral MK2 contracts and small helpers needed by the first port slices. `MK2-PORT-PROVENANCE.json` records 50 pinned source copies from commit `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`, exact import substitutions and required authored barrels. Canonical copies must not be reformatted or semantically edited. The migration copy gate validates their bytes. TypeScript checks all copies under the strict port configuration. Authored adapters remain subject to lint and format gates.

The legacy error class and raw codes remain intact inside copied algorithms. `adaptDiagnostic` exhaustively maps 14 categories to nine MK3 categories and retains original code, category, logical path and detail. Byte ranges become exact u64 strings. Boundary error codes encode the original UTF-8 bytes as lowercase hex, avoiding collisions from punctuation/case normalization. `adaptLegacyError` preserves the legacy error as its cause and retains context and hint.

## One host resolver

The legacy-vocabulary gate excludes only exact copied files under `codec-kit/src/legacy` after reconstructing the pinned 50-file M1 closure with the canonical copy gate and verifying its bytes, imports, dependencies and provenance. The authoritative declaration comes from the gate's repository, never from a supplied fixture `--root`. Missing or altered copies and forged provenance fail the gate. Authored adapters, barrels and neighboring files remain subject to vocabulary rules; neither a directory name nor a provenance-listed path alone grants an exception.

No MK2 codec catalog is installed. The copied semantic registry subclasses have a compile-compatibility base: every registration, lookup, route or open call throws `codec-kit/legacy-registry-unavailable`. Their constructor is inert. These declarations and their refusal test do not prove any codec feature.

`adaptGameArtifactCodec` returns a native MK3 `Codec`. The host owns contribution registration, selection, admission, input assembly and operation execution. Its probe wrapper exposes the actual candidate size, checks exact representability, limits total reads to the admitted budget and restricts reads to declared start/end ranges. Whole-source reads with unknown size or exceeding the probe plan are refused; a prefix is never reported as a complete file. Native open receives the complete already-admitted byte source. The consumer must provide an explicit `project(document, descriptor, context)` implementation for actual MK3 products. This adapter supports byte/file inspection; namespace adaptation and per-codec data-source/operation projection are subsequent slice work. It does not infer traits or turn unavailable legacy operations into successful outputs.

`invokeLegacyOperation` calls the genuine MK2 session, retaining its operation state, handler, permission, JSON input, cancellation and disposal checks. The consumer supplies an explicit output projection. `adaptOperationId` preserves admitted shared operations and requires explicit domain mapping validated against the contribution owner. `adaptEditPlan` supports validated single-source ranged byte/text replacements. It rejects create/delete/rename, whole-source replacement without an explicit range, multi-source edits and overlapping edits. Fidelity is supplied by the real consumer; the shim itself establishes no fidelity evidence.

`adaptByteSource` wraps an admitted host byte reader, preserving range, cancellation and byte caps. It neither scans paths nor mounts a legacy VFS.

## Language and runtime

The public names are `adaptLanguageModule` / `adaptLanguageService` and `adaptRuntimeProvider` / `adaptRuntime`; `legacy/adapter.ts` is the plan-facing re-export. Language conversion requires an explicit protocol-neutral projection over an already initialized module. It verifies document language, snapshot identity and cancellation. It creates no LSP transport, mutable document registry, substrate or language routing plane. Optional projected features are only published when supplied by their owner.

The runtime wrapper is a native `common.runtime/provider` value that the host must register/resolve. The v1 bridge requires the caller to supply the legacy creation options. Session budgets are snapshotted, requests reserve ticks/memory cumulatively before execution, over-budget requests do not reach legacy execution, concurrent calls are refused, and release is idempotent. Reservations remain charged after failures. `usage` reports admitted reservations, not measured resource use: the legacy ABI has no memory or wall-time measurements. The provider remains responsible for obeying the delegated per-call budget and cancellation; the shim does not promise preemption of synchronous provider work. A returned `created`, `running` or `suspended` legacy state means that this call completed, not that the runtime/program halted. `failed` and `disposed` results are explicit refusals. Legacy snapshots/events/v2 replay surfaces are not advertised or implemented by this v1 bridge.

## Shared libraries and explicit limits

The inherited MPQ `md5` function is retained inside the pinned file but excluded from the public crypto barrel: on hosts with WebCrypto it requests unsupported MD5 and does not reach its Node fallback. It is not a working M1 library claim. No semantic patch is made to the canonical source.

Canonical SHA1, MPQ hash/encryption/CRC helpers and texture helpers retain pinned bytes. `crypto/sha1.ts` is the sole canonical future bank SHA1 implementation. Deflate/inflate retain the genuine pinned pako implementation. The pinned compression original includes historical throwing bzip2 and ADPCM placeholders, retained internally in `compression/legacy-original.ts` for source fidelity.

Public bzip2 is a new adapter to `seek-bzip@2.0.0`, not legacy implementation parity. It rejects corrupt/truncated streams, requires a single complete stream, refuses trailing/concatenated streams without a container policy, and stops output emission at `maxOutputBytes`. Decoder block scratch memory and final output consolidation are additional memory; this is an output-byte cap, not a total-memory or CPU budget. Already-aborted signals refuse before decoding; synchronous work cannot observe newly delivered events until control returns. Public MPQ ADPCM raises a qualified unavailable error and remains pending until the archive slice chooses its actual decoder; no WAV IMA substitution is made.

Texture WASM requires the real `texture2ddecoder-wasm@1.2.2` dependency. Node uses its dynamic package entry. Browser/worker callers must deploy its `wasm/texture2ddecoder.js` and `wasm/texture2ddecoder.wasm` and explicitly call `initializeGpuTextureWasmBrowser({assetBaseUrl})`. Missing assets refuse and initialization can retry. The fixture runs real Node WASM and the explicit asset-URL adapter under Node, plus the browser-uninitialized refusal branch; it is not an end-to-end browser-host claim. Dynamic imports and required asset digests are declared in copy provenance.

Type dependencies referenced by public declaration files are ordinary pinned package dependencies, so standalone consumers can typecheck without relying on this monorepo's devDependencies. The emitted P9 declarations do not reference the private ambient pako/seek-bzip declarations.

## Evidence and retirement

`packages/codec-kit/test/legacy-kit.test.mjs` exercises real boundary behavior, source limits, native probes, legacy session permissions/state/cancellation, edit validation, runtime reservations/lease lifecycle, language snapshot checks, SHA/CRC vectors, zlib roundtrips, valid/corrupt/truncated/bounded bzip2 and real WASM paths. `artifacts/legacy-oracle/check-p9-parity.mjs` compares shared algorithms directly with pinned modules. Oracle step 0.3 has five exact old/new output and corpus matches against isolated accepted MK3 `878f9cd7658bc065a3eaa034a7f89e5020c887fe`; final current-M1 parity is a separate gate.

The shim retires module by module only when all copied consumers have moved to the native contract and their feature/operation parity receipts remain green. Compile compatibility declarations cannot close those rows. Shared canonical crypto/compression/texture libraries remain after shim retirement. No M2 bank or full-family implementation is included in M1.
