# SC2 codec port — M4 container composition

**Verdict:** `pass`, submitted for owner acceptance.

**Stage:** `composition-ready`; this is not the `full` SC2-family claim.

**Scope:** SC2 container composition, the required P11 contracts, MPQ read/write evidence, and the bounded installed-CASC claim from execution-plan step 4.0/4.1.

## Delivered scope

- The SDK accepts a working semantic alias `container: { formatId }` only for namespace-topology codecs with bounded namespace selectors.
- The host selects the exact byte-topology container provider, opens it through ordinary inventory/grant/activation, and probes semantic aliases on the resulting namespace. A complete semantic no-match keeps the generic container open; ambiguity, cancellation, budget failure, and missing required surfaces fail closed.
- The host-owned namespace adapter synthesizes directories from flat paths, preserves provider case policy, rejects traversal/NUL and malformed paging, enforces entry/byte/depth/path budgets, and owns parent/session/entry lease cleanup.
- `blizzard/sc2-map.edit-world` now returns entry replacements that the host validates and materializes through the retained MPQ session's `container.pack`. The semantic codec never receives the original or rebuilt MPQ bytes.
- `sc2-map`, `sc2-mod`, `sc2-campaign`, and `sc2-replay` declare namespace topology plus the exact MPQ container alias. The former `starcraft2/src/sc2-map/mpq.js` duplicate is gone. This only supplies the container boundary for `sc2-campaign`; authored campaign behavior remains M6 work.
- MPQ publishes bounded inspection, extraction, deterministic fresh creation, native-preserving Save As, obfuscation, and recovery through the public codec surface. CASC publishes the existing installed namespace's bounded `container.extract` proof; semantic CASC routing is not claimed.

## Source and repository provenance

The only MK2 oracle revision is `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`. Oracle loaders use Git object database blobs plus hash-bound copied adapters; they do not read or modify the MK2 working tree.

| Repository | Branch | Accepted M3 base | M4 implementation head | Commits | Changed paths | `git diff --check` |
|---|---|---:|---:|---:|---:|---:|
| Core | `sol/port-libs` | `8476bdfc` | `f00179fe` | 13 | 56 | 0 |
| Blizzard | `sol/port-sc2` | `1751abd0` | `31ced120` | 21 | 336 | 0 |

The family copy gate remains exact at **1460 files / 4840 imports**. Accepted subsets remain **50/97** for M1 libraries and **87/217** for `sc2-bank`. The archive compatibility admission is tied to the accepted M3 destination hashes, the pinned MK2 source blobs, exact rewrite chains, and seven explicitly classified copied-unwired algorithm bodies.

## Differential and installed evidence

| Evidence | Result |
|---|---|
| Packed map/replay differential | **8/8 identical**, 0 differing, 0 MK2-only, 0 MK3-only, 0 both-refused |
| Packed result digest | `161a55eeceaf7009334737ff00ba6af5b8504c447d0599cbf0a59a4893b0f597` |
| Real map | `WTE70_Madlibrarian.SC2Map`, 22,703 bytes, SHA-256 `f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305` |
| Real replay | `Persephone.SC2Replay`, 59,767 bytes, SHA-256 `e3522504afdf4d4f00d216e560baf9c89536135c927f5808831155682fc515d6` |
| MPQ writer vector | `7350cf9dfdbc6bb01eb2b01a144a43126f22117fc441b0de59d89c6761a61f27` |
| MPQ obfuscation vector | `2fbe78300d431c2735187954875037575642166a344c416fe8fe41e201ac73df` |
| Public `container.pack` | 2 cross-direction cases, `afd94445e1f7bb16fe85edcabe77e46e1202439370c5301d704a2f43054f7ce8` |
| Native-preserving SC2Map Save As | pass; 31 untouched entries byte/flags/method preserved, edited map reopened through semantic SC2 and MPQ codecs, source unchanged, destination removed by undo |
| Installed CASC `container.extract` | **1/1 identical**, exact 787,142-byte `UnitData.xml`, SHA-256 `52026354da439891b67b4767f3caa7adb21088382aa61f167ac30f692574b963` |

The four applied and revalidated operation receipts close only these scoped requirements:

- `casc/archive.extract` → `container.extract` (`extract-entry`)
- `mpq/archive.extract` → `container.extract` (`extract-entry`)
- `mpq/archive.inspect` → `view.inspect` (`inspect`)
- `mpq/archive.write` → `container.pack` (`pack-container`)

## Algorithms and verification

Production MPQ, recovery, and SC2 preview code now reuse Core's bounded decompression, incremental Adler-32, Adler-32, CRC-32, and canonical MPQ hash implementations. The algorithm gate reports:

```json
{"repositories":6,"mpqHash":{"definitions":1,"blizzardDefinitions":0,"bindings":8,"vectors":5},"failures":[],"debt":43,"canonical":9,"canonicalCopy":5,"canonicalOwned":4,"copiedUnwired":9,"new":0,"retired":[]}
```

The final verification matrix is green:

| Gate | Result |
|---|---|
| Core container/P11 focused tests | 4 files, **28/28** |
| M3 archive carryover | 6 exact files, 49 `it` declarations, **51/51**, 0 skip/fail |
| Packed + installed CASC wrapper tests | 2 files, **2/2** |
| Native MPQ public workflow | 1 file, **4/4** |
| Algorithm infrastructure | **23/23** |
| Bounded compression primitives | **3/3** |
| Migration infrastructure | **128/128** |
| Core quick | **450 passed**, 0 failed |
| Blizzard quick | **219 passed**, 0 failed; 3 pre-existing conditional M3 model-fixture skips |
| Core/Blizzard/isolated-library typechecks | exit 0 |
| Core strict | 8 packages, 0 problems |
| Blizzard distribution pack | 2,061 files verified |

The registry result is preserved verbatim:

```text
migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)
```

The feature ledger has 891 requirements, 881 still pending, and 0 integrity problems. MPQ is 3 adapted / 1 pending audit; CASC is 1 adapted / 1 pending audit. No family/full closure is claimed.

## Remaining assigned work

- M5: data and language codecs under their scoped `port-ready` receipts.
- M6: map primitives, mod/workspace coordination, replay/M3/runtime work, and authored `sc2-campaign` CMP1–CMP6.
- M7: complete user surfaces and remaining codec requirements.
- M8: full SC2-family closure plus one installed VS Code acceptance.
- M9: general P11 service contracts and non-SC2 container consumers; no repeat port of accepted MPQ/CASC work.
- Wave 6 deadline: retire the 38 known registry-debt entries and restore the one unavailable coverage cross-check.

Run `node reports/port-sc2-composition-m4/verify.mjs` from `modkit-core` to verify the bundle and rerun the M4 acceptance-critical gates. M5 remains blocked until the owner explicitly accepts this M4 receipt.
