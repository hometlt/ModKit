# PORT SC2 sc2-triggers — M5 port-ready writer handoff (2026-09-05)

## 1. Scope and disposition

The frozen row contains 18 feature requirements and 6 legacy operation requirements. The complete
feature-to-S1-S14 mapping is in `brief.md`; all six legacy operation IDs are bound to executable
handlers. This writer lane is ready for M5 `port-ready` acceptance: the scoped source, compile,
pinned-test, adapter, differential, portable, host-writer and root surface gates pass. The codec
manifest remains honestly `status: partial`. Core evidence application and ledger integrity are an
orchestrator-owned C7 step, and full S1-S15/family/application closure remains scheduled for M7/M8.

Frozen oracle: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d` in
`C:/FILES/SC2Files/coding/references/modkitmk2`, accessed only with Git ODB commands and a
`git archive` of that exact commit. No oracle working-tree file was read.

## 2. C0-C8 acceptance record

| Gate | Result | Evidence |
|---|---|---|
| C0 preflight | pass | Frozen inventory: 51 Trigger files, 18 test files, 219 static call sites; `brief.md` assigns all 18 features to an implementation and M5/M7 disposition. |
| C1 compile/package | pass | Package typecheck and build exit 0. Node and portable bundle tests pass 2/2. Browser bundles have no output imports, `node:*` inputs, runtime imports from another codec, or unexpected source inputs. Engine AST is data only. |
| C2 pinned tests | pass in accepted scope | 18/18 files discovered; 183 passed, 0 failed, 37 historical upstream skips, 0 added skips/todos/timeouts. The 37 skips are non-evidence. Five native/regression files add 18 passed with 0 skipped/todo/timedOut. |
| C3 adapter/manifest | pass | Compiled codec activates through the installed minimal host; 12 executable operations, real text/tree/byte-range leases, language provider, and registered generic writer. Changed and no-op edit plans commit and reopen. |
| C4 differential | pass | 12/12 exact-pin comparisons match across synthetic, Tiberium map/mod and installed NativeLib buckets; 0 differing and 0 both-refused. Normalization only sorts object keys and removes `undefined`. |
| C5 M5 surface | pass | Orchestrator-owned authoritative surface gate at `ab452c2c`: 2 files, 6/6 tests, 0 pending/skipped/todo. This is the explicit early M5 scope; full S1-S15 remains M7. |
| C6 retirement | pass | The 10,334-line generated `semantic-converter-core.js` was deleted only after exact replacement, regression, portable and zero-reference checks; semantic conversion now resolves the copied TS implementation. |
| C7 evidence | ready for Core owner | `receipt.json`, `claims.json`, source accounting and 12 proof-backed divergence rows are prepared externally. Core apply/integrity is not performed by this writer. The current family copy command is blocked by a pre-existing refreeze-plan digest mismatch described below. |
| C8 report | pass | This report records source counts, commands, tests, corpus, skips, divergences, commits and scheduled remainder. |

## 3. Source accounting and compilation

The accepted Trigger source scope contains 51 exact-pin files, 636,991 bytes and 16,446 newline
terminated source lines. `source-accounting.json` accounts for every one: 41 remain at their
registered baseline, 10 have bounded M5 adaptations, 0 are missing, and 0 have unregistered
divergence. Two Galaxy files are separately recorded as Trigger runtime-closure extras.

`core-divergence-rows.json` contains 12 `semantic:false` rows. Every row records the exact source,
oracle commit, source SHA-256, registered destination SHA-256, final destination SHA-256, bounded
replacement counts, and the SHA-256 before and after each edit. The generator reconstructs every
final file byte-for-byte from Blizzard base commit
`516450da52eef6b2ffadd1742e9bb396b816c2fd`.

The adaptations are mechanical:

- `g2t-actions.ts` and `g2t-call.ts`: public Galaxy and codec-kit import relocations plus guarded,
  browser-safe access to the same optional trace environment keys.
- `g2t-core.ts`, `g2t-params.ts`, `g2t-payload.ts`, `g2t-trigger-body.ts`, and
  `galaxy-to-trigger.ts`: private relative Galaxy AST/parser imports moved to the accepted public
  Galaxy language-core package.
- `sax-reader.ts`: type-only attribute index refinement; emitted behavior is unchanged.
- `trigger-store.ts`: TypeScript `override` modifiers only.
- `rename.ts`: direct exact SAX/type imports and a local exact identity import, removing package
  barrel/registry edges.
- Galaxy `ttg-convert.ts`: direct payload-sentinel import, preventing unused xml2js code from
  entering a browser worker bundle.
- Galaxy `trigger-to-galaxy.ts`: `obj.parent` changed to `obj['parent']` for strict index-signature
  access; emitted property semantics are unchanged.

`pnpm run typecheck` and `pnpm run build`, from `modkit-extensions-blizzard/starcraft2`, both exit
0. The package's accepted strict profile was not weakened. The build uses `allowJs` to emit the
existing provider/adaptor JS beside the newly compiled TypeScript and follows only declared public
Galaxy contracts.

## 4. Native adapter and public contracts

`starcraft2/src/sc2-triggers/codec.ts` exposes the legacy operations `view.inspect`,
`script.symbols`, `script.references`, `asset.validate`, `asset.search`, `asset.compare`,
`edit.content`, and `export.convert`. It also exposes raw export, data-only EngineProgram lowering,
and explicit namespaced T2G/G2T operations. Its inspection session leases the source text, the
Trigger library/element tree and exact byte ranges. Root-level map TriggerData without an explicit
Library/Standard marker is parsed through a temporary semantic-only `Standard Id="Map"` wrapper;
the source bytes and index remain unchanged, and edit output removes the wrapper.

The installed host resolves `./dist/sc2-triggers/codec.js` for both trusted-node and portable
variants. The generic authored-text writer commits revision-pinned whole-source plans. The host
suite proves activation, a changed `Marine` to `Marauder` commit followed by semantic reopen, and
a byte-identical no-op commit followed by exact-byte reopen.

The document-analysis provider uses the shared public Galaxy workspace-link package and the common
SC2 XML support parser. It provides analysis, hover, definition, references and diagnostics while
keeping completion, formatting and refactor work in the M7 remainder.

## 5. Exact differential and corpus

`compare-legacy-sc2-triggers.mjs` materializes only the exact-pin codec directories using
`git archive`. Its two shims are inert logger/identity seams outside the semantic path; all other
dependencies resolve from the installed package. The final uncapped run writes `differential.json`.

| Bucket | Input bytes | Input SHA-256 | Observed result |
|---|---:|---|---|
| synthetic TriggerData | 334 | `19c53d0832f69a91891400f65500b21f94afe24f79aec0b854fe87c5945c071d` | source index, SAX, validation, Engine AST, T2G, G2T and rename matched where applicable |
| Tiberium mission map | 751,910 | `f9c157294107bd958a942dd1081b26fc8aebf75b97984ba024102b19c8137859` | source index matched; native corpus open found 3,433 elements and 7,743 references |
| Tiberium data mod | 7,436,388 | `566a56fc83dd68493e7f0643900538b332a67ced2577c79417f99591109c7f2b` | source index and SAX matched; 29,039 elements, 66,595 references, 17 libraries |
| installed NativeLib | 7,743,650 | `cbb2302825dce57ff9bb8efd44f9b0ed5cb056eee00265e5b711b0824d872396` | source index and SAX matched; 31,613 elements, 57,423 references, `Ntve` lowering dependency |

The 12 comparisons cover four source-index cases, three SAX cases, structure validation,
EngineProgram lowering with installed NativeLib, T2G, G2T and gamelink rename. All 12 match; there
are no observed semantic divergences. The native real-tier suite separately passes 3/3 with zero
skips and executes the exact frozen bytes and counts, implicit-map/open behavior, NativeLib
lowering and an exact-byte no-op.

## 6. Test accounting

The exact command `pnpm test:mk2 -- sc2-triggers` discovers all 18 frozen files. Runtime accounting
is 220 leaf tests: 183 passed, 0 failed and 37 historically skipped. The preflight's 219 count is a
static call-site audit; parameterization and runtime expansion account for the one-leaf difference.
The eight files reported skipped contain upstream `it.skip`/fixture-conditional branches for the
absent VS test, DPAN/NativeLib fixture trees and `@modkitx/engine`. The port neither edits the frozen
tests nor counts those 37 branches as proof. A hash-bound global setup materializes the line-ending
form expected by the unchanged CRLF test during execution and restores the accepted fixture bytes;
the destination blob remains `96e5c421163498ca5971a27cbbbfaf59f1125f29`.

The focused native/regression command runs five files and 18 tests: 18 passed, 0 failed, 0
skipped/todo/timedOut. The new real-tier suite runs three tests: 3 passed, 0 failed, 0 skipped. The
package portable-bundle gate runs two tests: 2 passed, 0 failed, 0 skipped/todo/cancelled.

## 7. Browser and surface proof

The portable codec bundle is built with esbuild for `platform=browser`, `format=esm`, target
ES2022. Its metafile records 230 inputs, zero output imports, zero `node:*` inputs, zero cross-codec
runtime inputs and zero unexpected source inputs. Importing that bundle and executing inspect and
Engine lowering both return `state: ok`. `sax@1.6` probes Node Stream for its unused SAXStream API;
the proof supplies an inert build-only Stream shim, while the executed Trigger SAX path uses no
Node API.

The separately bundled language provider records 13 inputs, zero output imports, zero `node:*`
inputs and zero cross-codec inputs. Its browser execution returns two symbols, six tokens and zero
diagnostics. The repository deterministic portable gate also proves all eight codec roots plus
atomic staging/refusal behavior. The authoritative root surface profile in commit `ab452c2c` passes
2 files and 6/6 tests with no pending, skipped or todo cases. Its final command is
`pnpm surfaces:check --codec sc2-triggers --scope m5 --out
C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-triggers/surfaces-m5`; the receipt SHA-256
is `23e86a50bbe4d9c8dda54cbfc01ec73284c68e9996cc49163a673c110ca864ee` and its bound Vitest report
SHA-256 is `7a2db6af8988b213e0252571133fd9426a00c3fabae256add8bb621895dfc007`.

## 8. Registry handoff and current blocker

The scoped claims and passing receipt are ready for the designated Core evidence owner. This
Blizzard writer made no Core or shared ledger change. Core's read-only evidence command passes:

```text
pnpm evidence:apply --receipt artifacts/legacy-parity-sc2/sc2-triggers/receipt.json --check
evidence validated: 24 requirements; regenerate codec-map before migration:check
```

That command is read-only because of `--check`; it validates the current contribution
publications, all 24 receipt proofs and the strict three-field claims schema. The mutating apply and
subsequent ledger regeneration remain with the designated Core owner.

Core commit `03e1cf83b1807314ef6a6465d3e32728a77a4826` fixes the previously observed family refreeze-pin
digest mismatch. The family copy command now advances past that check and stops on a Galaxy-owned
destination outside this writer's Trigger scope:

```text
node C:/FILES/SC2Files/coding/modkit-core/scripts/migration/check-mk2-copy.mjs --family sc2 --scope family
Missing/tampered canonical copy: modkit-extensions-blizzard/starcraft2/src/lib/mk2/codecs/galaxy/src/core/galaxy-checker.ts
```

The declaration expects SHA-256
`4c4dd768fa47ff2717bc220c354099ae371b6472adad6aad7f2b8a14e153ec36`; the current Galaxy
destination is `20bb77b4c9c35bcacf283eac61c70c1128b349c2b6f23b1f288e4f6f8d624da4`. The failure occurs before
the checker reaches the 12 Trigger adaptations. C7 remains pending until the Core owner integrates
the relevant Galaxy/Trigger divergence rows, applies this receipt, and records literal integrity,
scoped and family outputs.

## 9. Commits and tree

- `5531bcd3052534f30b86b3e36d8ce7148e8fb675` — native M5 codec, exact runtime closure and generated-bundle retirement.
- `f3c69b0f2ebeeb2692d1086bc31e0f74a3960789` — pinned, native, real-corpus and installed-host proofs.
- `ab452c2cc44b8ede46ab1ed44c7383d745221fb5` — orchestrator-owned authoritative M5 surface profile.

Branch: `sol/port-sc2`. The Blizzard working tree is clean at this handoff. No merge, rebase or push
was performed.

## 10. Scheduled remainder

M7 owns the full S1-S15 viewer/metadata/card/MCP/script/applicability matrix, completion/formatting/
refactor language operations, richer selector/facts/relations surfaces and registry scoped closure.
M8 owns multi-document cross-codec transactions, installed VS Code family acceptance, the seven-app
matrix and full SC2-family closure. Runtime execution stays with `sc2-runtime`. These are planned
requirements, not owner-approved drops; M5 `port-ready` does not claim `full` or GA.
