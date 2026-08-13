# Implementation notes — modkitX3

Newest entries first. Owner documents live in `modkitx/docs`; this file records lab-side
analysis, decisions inside the delegated lab scope, and owner-decision gaps. It never
overrides a canonical or detailed owner.

---

## X3-S0.0 corrective pass (2026-08-13, after the Sol audit)

The owner-relayed audit accepted the DoR as a draft, returned X3-S0.0 to in-progress and
ordered a corrective pass. Items below amend the DoR section that follows; where they
contradict it, this section wins.

### C1. Owner-input baseline made reproducible

The DoR was read against the `modkitx` **working tree**, not a commit: `BRIEF_12` is
untracked, and `MODKIT_ARCHITECTURE.md` + `MK3/README.md` carry uncommitted edits on top of
`643abefc`, so «modkitx@643abefc» alone was not reproducible (audit item 1). SHA-256 of the
exact files read (working tree, 2026-08-13; taken at the corrective pass — text unchanged
within this session):

| File | sha256 |
| --- | --- |
| tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md (untracked) | `bbc00dcf36e47739bae9db348979994c8865bb97590e7b9ae7dbf71f8e942a6c` |
| architecture/MODKIT_ARCHITECTURE.md (modified vs 643abefc) | `902a6ece8e964677f81ca61a9e0de606b56d5f51d852c6f6ad4f9c93de8cb5e2` |
| architecture/ASSET_CAPABILITIES.md | `be3f11b17062dfbb3190546a0d5377581465164d40a0abb52d1625f5125c9164` |
| architecture/TARGET_ARCHITECTURE_OVERVIEW.md | `6507de8c13c4d7fce179ee52d35b3cd0881cc50478de9efb2ec73357767fd92e` |
| MK3/README.md (modified vs 643abefc) | `67133f365d9ddc9b2b85e2b122e2ac64e44646467ebfd289ce97b77bbf525643` |
| MK3/02-capabilities-and-contracts.md | `b97fa113f0c70e2444b0e5c4d734593b6887ee5a00999a2b887f7cfb422f2c3f` |
| MK3/15-package-boundaries-and-extension-layout.md | `295a9f9f9f4a1881c0ae75911b73707a561f2fe582b4713f98c6ebf30cb0988a` |
| MK3/23-contract-identity-schema-resolution-and-lock.md | `d8b18f9480286e318a414004ecce83cf9a126e9356ac312bede722ea725f88b3` |
| MK3/24-extension-security-execution-and-lifecycle.md | `a92034ece263dcbe8ceefb49ed6d43555b3f5c27b7a6e1bdc64dd3f9c815184b` |
| MK3/25-subject-identity-editing-transactions-and-cache.md | `58b6874311cfd008a57be53eb37b78b9412ae6854a5ec13a2d67edd5064a7a88` |
| MK3/27-final-target-tree-extension-manifest-and-format-catalog.md | `aed060645c36c79efff0db40c079564495226b19af94f14ab7b6e1193620a143` |
| tasks-active/platform-architecture/REPORT_6_…simplification.md | `61bd321da5f7b0bde56b73231be3c957bb29768e4fe22c50ffa4c495c30fdc77` |
| tasks-active/platform-architecture/REPORT_9_…optional_platform_core.md | `5654e2ad0fdba2d346e401c00cc8bae5436acc0abbadf2029f268eb6166c4749` |

Recommendation to owner (lab cannot do it under §8): commit BRIEF-12 and the pending canon /
MK3-README edits in `modkitx` so future baselines are plain commit hashes.

### C2. Gap register additions (audit item 2) — G9/G10 + G5 escalation

| # | Gap | Blocking? | Resolution / status |
| --- | --- | --- | --- |
| G9 | **Root extension dependencies**: canon §5.13 prose requires the extension manifest to carry «dependencies on other extensions» (and its dependency-semantics table covers codec/extension manifests), but the adopted minimal authored form (27 §0.2, decision 64) and the v2 appendix example (27 §5) define no such field; REPORT-6 §6's minimal example has none either. A strict S0 schema must either include the field's exact shape or knowingly reject manifests that carry it | **Yes — blocks X3-S0.3** (ExtensionManifest schema). S0.1/S0.2 unaffected | Proposal filed as **Q75** in `MK3/11-open-questions.md` (recommended: optional `dependsOn` of extension-coordinate Requirements reusing the one-Requirement mode/scope model; shape-only validation in S0–S4, no solving). Owner decides; the DoR's earlier «deferred past S4» wording in §2.1 below is superseded |
| G10 | **Two `executionProfile` vocabularies inside MK3/24**: §3's typed enum (`browser-sandbox`, `worker-brokered`, `process-brokered`, `wasm-brokered`, `trusted-in-process`) vs §5's profile catalog (`trusted-in-process`, `wasm-sandbox`, `worker-isolated`, `sandboxed-process`, `remote-provider`) — names differ, `remote-provider` missing from the enum | No for S0–S4 (lab S3 minimum uses `trusted-in-process`; REPORT-6 §6 fixtures also use `browser-sandbox`, both inside §3's enum, which is the shape 27 §6 imports) | Proposal filed as **Q77**: unify on §3's enum + `remote-provider`, §5 headings become prose descriptions mapped 1:1. X3 schemas use §3's enum verbatim until the owner answers |
| G5→Q76 | Standalone container `version`/`license` ambiguity — escalated from a session-report note to a formal proposal per audit item 2 | No | Proposal filed as **Q76** with the same recommended reading as G5 (standalone carries own required fields; `#modkit` block must not duplicate npm fields); fixtures test both directions |

### C3. Benchmark protocol fixed in S0.0 (audit item 3; supersedes L8)

BRIEF-12 §6 requires S0.0 to fix the protocol; deferring it to S0.5 was wrong — S0.5 now
only *implements* the script against this protocol:

- **Reference environment (recorded 2026-08-13):** Intel Core Ultra 7 155U (12 phys /
  14 logical cores, laptop-class — AC power assumed for gate runs), 31.5 GB RAM, NVMe SSD
  (Phison 512 GB), Windows 11 Pro build 26200, Node v24.16.0, pnpm 11.8.0. Numbers are an
  **absolute target + this-machine baseline**, never cross-machine constants.
- **Warm-up:** ≥3 discarded runs per scenario (warm FS, JIT); FS-cold numbers are out of
  scope for the §6 gates.
- **Run counts:** N=100 measured runs for in-process micro scenarios (inventory, resolve,
  explain); N=20 for process-level scenarios (CLI validate); N=10 fresh processes for the
  import-cost scenario. Report **p50 and p95**; p50 gates, p95 is recorded.
- **Process-startup exclusion:** in-process scenarios time `performance.now()` around the
  operation only. CLI wall-clock scenarios also measure a bare `node -e ""` baseline (same
  N/warm-up) and report raw + net (raw − baseline p50); §6 budgets apply to **net**.
  Import budget: fresh process, `performance.now()` around dynamic `import()` of the built
  entry — startup excluded by construction.
- **Timed window:** synthetic corpus/fixture generation is excluded from every window.
- **Gate policy (per §6):** the gate fails on (a) proven target excess — p50 over the §6
  target across a full N-run session, confirmed by one repeat session; or (b) baseline
  regression — p50 worse than the recorded baseline by >20 % across two consecutive full
  sessions. A single noisy run never gates. Baselines live in the repo next to the bench
  script and change only with an explanatory commit.

### C4. Legacy gate hardened + committed regression suite (audit item 4)

Fixes to `scripts/check-legacy.mjs`: (1) `package.json` content is no longer skipped after
the name check — `exports` keys/values are checked (`exports-path` rule) and the whole
manifest text runs through the generic rules; (2) `capability`/`capabilities` object keys
are caught **quoted or unquoted** (`capability-key` rule — schemas will live as TS consts);
(3) the `@modkit-legacy-input-fixture` marker is honored only under a `fixtures/` path —
outside it the marker itself is a violation (`marker-outside-fixtures`) and the file is
still scanned; (4) `--root` argument + `fileURLToPath` for testability/robustness.
Committed regression suite: `scripts/test/check-legacy.test.ts` over committed fixture
trees `scripts/test/fixtures/legacy-gate/{violations,clean}` — 9 rule classes asserted
positive, marker-abuse asserted still-scanned, clean tree asserted scanned-and-green,
`fixtures/legacy/` + marked-fixture exclusions asserted, real repo asserted green. The
suite runs in `pnpm test` (vitest) and `pnpm check`.

### C5. Toolchain installed and pinned (audit item 6)

`pnpm install` executed; `pnpm-lock.yaml` committed; justifications in `PORTED.md`
(typescript 5.9.3, vitest 2.1.9, eslint 9.39.5 + typescript-eslint 8.67.0, prettier 3.9.6,
@types/node 22.20.1 — dev-only). esbuild's postinstall stays denied
(`pnpm-workspace.yaml#allowBuilds`), its platform binary package suffices. Non-empty
verification chain green: `pnpm typecheck` (tooling tsconfig over gate tests + vitest
config), `pnpm lint`, `pnpm test` (5 real tests), `pnpm check:legacy`. The root `tsc -b`
returns to the `typecheck` script when X3-S0.2 adds the first composite package (empty
solution is TS18002).

### C6. Accounting corrections (audit items 3/5)

- Board: X3-S0.0 `assignee` removed (allowed only on an active `plan[]` step); corrective
  pass added as a plan step; X3-S0.1 renamed to its true remainder («toolchain install/pin
  + non-empty verification»), executed in this pass.
- The previous `modkitx` commit `68183cb7` swept the planning session's uncommitted edits
  of the same two files, including register rows (R3/R5, `0/45`) unrelated to X3 —
  acknowledged as procedural overreach; the content is factually correct (re-measured), so
  it is retained rather than reverted, and this note plus the session report record it.

---

## X3-S0.0 — Contract baseline / Definition of Ready (2026-08-13)

Verified against live files of `modkitx@643abefc` (branch `r1-convergence`, working tree of
2026-08-13; note: `engine-board.js`/`MASTER_TASK_REGISTER.md` X3 entries existed uncommitted).
Re-measured snapshot: 45 × legacy `extensions/*/*/extension.json`, 0 × `package.json#modkit`,
0 × `modkit.extension.json`, 32 workspace packages — matches BRIEF-12 §0 direction.

Abbreviations: **canon** = `docs/architecture/MODKIT_ARCHITECTURE.md`; **AC** =
`docs/architecture/ASSET_CAPABILITIES.md`; **23/24/25/27/02/15/30** = `docs/MK3/<n>-*.md`;
**R6/R9** = `docs/tasks-active/platform-architecture/REPORT_{6,9}_*.md`.

### 1. Owner matrix — public types of slices S0–S4

Ownership classes: **canon** (adopted canonical), **AC v1** (normative v1 wire contract),
**MK3 owner** (detailed/normative-candidate owner document), **lab detail** (shape delegated
to the lab within an owner's boundary; promotion needs the owner's gate), **deferred** (not
in S0–S4).

| # | Public type (X3 slice) | Owner class | Exact source | Notes |
| --- | --- | --- | --- | --- |
| 1 | `ExtensionManifest` (normalized envelope) — S0 | canon (boundary) + MK3 owner (shape) | canon §5.13 («tooling normalizes either container into one `ExtensionManifest` contract»); 27 §0.2–0.3; MK3/README decision 64 | Executable schema is the S0 proof (R9 §19 item 3) |
| 2 | Authored containers `package.json#modkit` / `modkit.extension.json`, one-container rule | canon | canon §5.8 (discovery/identity paragraph) + §5.13; adopted 2026-08-12 | Both at once = packaging error |
| 3 | `contributionManifests` discovery pattern + glob rules | canon (pattern) + MK3 owner (glob rules) | canon §5.13; 27 §0.3, §5.1 | Hosts never glob category dirs |
| 4 | `ContributionManifestV1` envelope — S0 | MK3 owner (candidate v2) | 27 §6, corrected by 27 §0.5 (no per-contribution version; `status` optional display hint; security authored only in child manifests) | Promotion map: candidate until S3c/D1; X3 is its proof vehicle |
| 5 | `RuntimeVariantDeclaration` (variantId, entrypoint, target, executionProfile, requestedPermissionClasses) | MK3 owner | 24 §3 (27 §6 explicitly imports it; no second runtime-variant form) | |
| 6 | `ScopedContractRequirement` + `required/default/suggested/integrates` semantics | MK3 owner | 23 §8 (27 §6 explicitly defers) | |
| 7 | Logical ID grammar (contract/provider/extension/error qualified form; version as separate field) | MK3 owner | 23 §3 (ABNF + role table), §3.1 (contribution id is qualified, never inherited from extension) | |
| 8 | `core` primitives: stable IDs, `ModkitError`-style structured errors, diagnostics, deterministic ordering, cancellation, lifecycle/disposal — S0 | canon (ownership) + lab detail (exact API) | canon §6.1 (`core` row), §14.7–9; rationale MK3/12 (consolidation map: «12 → core errors канона»); parity oracle `packages/core/src/errors.ts` (`ModkitError`) | Every blocking async/provider/I/O API takes `AbortSignal`, returns structured diagnostics (BRIEF-12 §3.4) |
| 9 | `ErrorDefinition` (namespaced error codes) | MK3 owner | 24 §11; error-code grammar 23 §3 | |
| 10 | `DiagnosticSeverity`, `RedactionPolicy`, `SchemaRef` | MK3 owner | 24 §3.1 | |
| 11 | Contract-selected `spec` mechanism (unknown contract = inspectable, not activatable) — S0/S1 | canon (behaviour) + MK3 owner (envelope rule) | canon Done-criterion (BRIEF-12 §1.2); 27 §0.3, §6 rules; R6 §8 pipeline | Concrete lab test-contract spec schemas = lab detail |
| 12 | Host inventory (explicit list, in-memory, deterministic order) — S1 | canon (ownership) + lab detail (entry shape) | canon §6.1 (`host` row: inventory/resolution modules); R6 §8; oracle `generated/codec-catalog/codec-catalog.json` | No root `generated/` authority (27 §0.6) |
| 13 | `SubjectRef` / `SubjectIdentity` / `SourceRef` / `RevisionRef`, canonical URI serialization — S2 | MK3 owner (normative-candidate) | 25 §3 | Equality rules 25 §3; revision never in identity |
| 14 | Unknown source-root subject + `InterpretationRef` — S2 | MK3 owner (candidate, PR-16) | 25 §20; 30 §5 | Format never enters root identity |
| 15 | Portable `vfs` source/stream/random-access contracts — S2 | canon (promoted §5.9) + lab detail | canon §5.9; divergence register row «Владение VFS implementations» (resolved 2026-08-12); oracle `packages/vfs` | Node file adapter lives in `host/node`, not browser-safe `vfs` (BRIEF-12 §5 S2) |
| 16 | Trait vocabulary / `TraitId` values | AC v1 | AC §4 (+§13 manifest surface); TypeScript names today are `CapabilityInstance`/`CAPABILITY_IDS` (`packages/assets/src/capabilities.ts`, verified live) | X3 S0–S4 treats `TraitId` as an opaque validated dotted string (23 §3 role table); no copy of the ID list, no rename (see gap G1) |
| 17 | Operation vocabulary (three namespaces, `ASSET_OPERATION_IDS`) | AC v1 | AC §5.1–5.3; live `packages/assets/src/operations.ts` | Used by X3 only as opaque operation strings inside resolver requests |
| 18 | `AssetDescriptor` (full descriptor contract) | AC v1 — **deferred** | AC §2; BRIEF-12 §3.5 explicitly excludes it from S0–S4 | If a slice cannot proceed without it → stop + owner gap, not a second wire contract |
| 19 | `ProviderOffer` / `ProviderRequest` / `ContractRequirement` / `ContractOffer` / `OfferHeader` / `ResolvedProvider` / `RejectedCandidate` / `ResolutionResult` / `UnresolvedReason` — S3 | MK3 owner (normative-candidate) | 23 §8 («единственное определение … Остальные документы обязаны ссылаться сюда») | Resolver v1 executes only `primary` + compatible `replacement`; other kinds → explicit unsupported-kind diagnostic |
| 20 | Resolution algorithm v1 (staged, deterministic, UTF-8 byte ordering, `ambiguous` instead of discovery order) — S3 | MK3 owner | 23 §9; acceptance §17 | |
| 21 | `RuntimeTarget` / `RuntimeTargetConstraint` | AC-era v1 wire fact + MK3 owner (aliasing rule) | 23 §8: normative alias of live `CodecRuntimeTarget` / constraint fields of `CodecRuntimeVariant` (`packages/assets/src/codec-manifest.ts`, verified live: environments/OS/arch/hostCapabilities/webApis/externalTools) | Port with PORTED.md provenance at S3; JSON names kept v1 |
| 22 | Permission classes taxonomy — S3 | MK3 owner (normative-candidate) | 24 §3: canonical taxonomy `read-source, write-source, filesystem-read, filesystem-write, network, process-launch, native-code, credentials, clipboard, persistent-storage` | One authored dictionary; live legacy vocabularies get mapping, not a second authority (gap G4) |
| 23 | `PermissionGrant` + `GrantedPathScope` / `GrantedNetworkScope` / `CredentialGrantRef`; nested-grant intersection; deny-by-default — S3 | MK3 owner | 24 §4, §3.1, §15 invariants | Grant precedes entry-point import (X3-S3.3 spy proof) |
| 24 | Execution profiles + SB ladder scope for the lab | MK3 owner (adopted ladder) | 24 §3 (profile union), §5, §6.1 (SB-0 обязательна до массовой миграции) | X3 S3 implements the SB-0 dispatch/grant slice only |
| 25 | Provider-policy lock: `ProviderLockKey` / `ProviderPolicySelection` / `ProviderPolicyLockEntry`, `resolverVersion` staleness — S3 | MK3 owner | 23 §11 | This is BRIEF-12's «resolution lock»; install/session/World locks are different records (deferred, 28/23 §12–13) |
| 26 | `testkit` minimal host / conformance harness — S4 | canon (ownership, dev-only closure) + lab detail | canon §6.1 closure classes; MK3/10 (gates rationale); R6 §11 S4 (PR-23 shape) | |
| 27 | External example-extension layout — S4 | canon + MK3 owner | canon §5.13 tree; 27 §0.2–0.3 | Lives outside the workspace; installs packed tarballs |
| 28 | Lab package naming `@modkitx-x3/*`, no publish | BRIEF owner rule | BRIEF-12 §7/§7.1 | `@modkitx/*` names belong to `modkitx` R5 |
| 29 | Codec v2 `spec` (FormatRole/ArtifactStage/OpenIntent), `FormatDefinition`, install lock, session/composition locks, World types, UVE packer, augmentation/projection/operation offers, key material, signatures/quarantine | **deferred** | 27 §6 rules; 30 §2; 28 §7; 23 §12–13; 26; R9 §19; 23 §8; 24 §12.1; 24 §6.1 SB-2+ | Out of S0–S4; S4b gated behind owner decision |

### 2. Minimal fields (fixed for S0 schemas)

**2.1 Normalized `ExtensionManifest` (one contract for both authored containers):**

```
schemaVersion         1 (literal)
publisher             qualified namespace, ABNF `dotted` (23 §3), e.g. `org.example`
id                    `name` grammar (23 §3); unique within publisher only
version               SemVer 2.0.0 string — npm container: inherited from package.json#version;
                      standalone container: own field (see gap G5)
license               SPDX string — same inheritance rule (27 §7: license of the whole unit)
contributionManifests readonly string[] — relative patterns; ≤1 shallow `*` segment; no `**`,
                      no absolute paths, no `..`, no symlink escape (27 §5.1)
```

Normalization also reports (as diagnostics/metadata, not envelope fields): source container
kind, and the packaging error when both containers are present. ~~Extension-level
dependencies deferred past S4~~ — **superseded by corrective pass G9/Q75**: canon §5.13
requires the manifest to carry them, the exact field shape awaits the owner's Q75 answer,
and X3-S0.3 is blocked until then. Declared-inventory diffing (canon §5.13) remains
deferred past S4.

**2.2 `ContributionManifestV1` envelope (open, transport for every contribution kind):**

```
schemaVersion    1 (literal)
contract         { id: ContractId (qualified, 23 §3), major: number }
id               qualified contribution coordinate (23 §3.1); independent from the owning
                 extension coordinate, never inherited
displayName      string
status?          optional display hint 'supported'|'partial'|'unsupported'|'experimental'
                 (27 §0.5.2 wins over the §6 interface listing it required — gap G2)
runtimeVariants? readonly RuntimeVariantDeclaration[] (24 §3; static definitions may omit)
dependsOn?       readonly ScopedContractRequirement[] (23 §8)
limitations?     readonly string[]
spec             contract-selected payload (2.3)
```

No per-contribution `version` (27 §0.5.1): locks reference
`(extension coordinate, contribution id, contract major)`.

**2.3 Contract-selected `spec`:** the registry maps `(contract.id, contract.major)` → one
strict JSON Schema for `spec`. Known contract → strict validation (fail = structured
diagnostics, no activation). Unknown contract → envelope itself still validates, `spec` is
preserved as inspectable data, a structured `unknown-contract` diagnostic is emitted, and the
contribution is **never activatable** (27 §6 rules; R6 §8). S0 ships lab test-contract spec
schemas only; real codec-v2 spec stays deferred (owner matrix #29).

**2.4 Permission request / grant (S3 minimum, SB-0 scope):**

- Request: authored **only** in `runtimeVariants[].requestedPermissionClasses`
  (24 §3; single authored security owner per 27 §0.5.3), values from the canonical taxonomy
  (owner matrix #22). Missing permission = deny; no `requiresHostApproval` field.
- Grant (24 §4): `{ id, subjectScope?, sourceScope?, filesystem?: GrantedPathScope[],
  network?: GrantedNetworkScope[], credentials?: CredentialGrantRef[], expiresAt?,
  parentGrant? }`; nested call authority = parent grant ∩ callee request ∩ host policy ∩
  operation scope; child never wider than parent. Gate order: resolution → grant → only then
  entry-point import/execution (24 §8; X3-S3.3 spy proof).

**2.5 Resolution lock (portable provider-policy lock, 23 §11):**

```
ProviderLockKey        { contract, major, normalizedRange ('*' default after canonical
                         normalization), operation?, requiredOutputs: TraitId[] (unique,
                         UTF-8-byte-sorted), preferredOutputs: same, workload? }
ProviderPolicySelection{ extension (publisher-qualified coordinate), releaseRange? ('*'),
                         contributionId, contractMajor }
ProviderPolicyLockEntry{ key, primary, allowedFallbacks?, resolverVersion }
```

Excluded by design: OS/architecture, runtime variant, exact artifact/digest, external tool
paths, facilities, grants, credentials/secrets, catalog URLs (those belong to install lock /
machine activation snapshot / session records — deferred). Serialization is canonical and
byte-stable: sorted keys, UTF-8 byte ordering for ID lists, LF, independent of discovery /
registration / shuffle order (23 §9.9, §16.5, §17).

### 3. Schema/type source-of-truth workflow (decision §5.3)

**Chosen: authored strict JSON Schema objects are the single wire authority; everything else
is mechanically derived or compile-time-pinned to them.**

1. Each published schema (`ExtensionManifest`, both authored-container adapters,
   `ContributionManifestV1`, lock, …) is authored **once** as a TypeScript `as const` object
   in `@modkitx-x3/sdk` source (`packages/sdk/src/schemas/…`), dialect JSON Schema 2020-12
   (lab decision, see L2), strict (`additionalProperties: false`, required lists explicit).
2. The published `.json` schema artifacts are **emitted** from those consts by one tiny
   deterministic script (stable key order, LF, trailing newline) with a `--check` CI mode —
   a serialization step, not a codegen framework.
3. Public TypeScript types are hand-authored for API ergonomics but **pinned** to their
   schema by a compile-time structural-equality drift gate:
   `type _Check = Expect<Equal<ExtensionManifest, FromSchema<typeof extensionManifestSchema>>>`
   (dev-only `json-schema-to-ts`; the assertion lives in a type-test file). Any divergence
   fails `tsc`/vitest — the drift-test S0 acceptance names.
4. Runtime validation (CLI `modkit validate`, host loading) compiles **the same consts** with
   Ajv (2020-12 dialect) — planned single external dependency of `sdk`, to be justified in
   PORTED.md when S0 code lands; hand-writing a JSON Schema validator would itself be a
   second drifting authority. If the validate-budget (<150 ms, BRIEF-12 §6) fails, switch to
   ajv standalone-compiled validators generated from the same consts — authority unchanged.

**Why this creates no second authority:** the schema const is the only place a wire shape is
stated. The `.json` artifact is a checked projection; the TS type is compile-time-proven
equal (not sampled by fixtures); the runtime validator executes the same object. The one
allowed authority mechanic (BRIEF-12 §7: «generator ИЛИ drift-check») is the drift-check of
step 3; step 2 is packaging, not generation of a second form.

**Rejected:** TS-first + schema generator (`ts-json-schema-generator`) — published wire form
becomes hostage to generator version churn; zod/valibot as source — runtime dependency in
public API and unstable emitted schemas; hand-written schema + hand-written types with only
fixture-based drift tests — sampling, not proof.

### 4. Contract gap register (§5.4)

No **blocking** gaps found; every entry below has an owner-sanctioned resolution the lab can
proceed under, and none required a lab-side architectural override.

| # | Gap | Blocking? | Resolution / status |
| --- | --- | --- | --- |
| G1 | Capability→Trait rename not promoted: AC v1 normatively keeps `CapabilityInstance`/`CAPABILITY_IDS` (verified live in `packages/assets`); MK3/02 §1 bans `capability` from the new wire vocabulary; divergence register holds the rename open | **No** for S0–S4 | X3 needs no trait vocabulary: descriptor contract is out of scope (§3.5), resolver uses `TraitId` as an opaque validated dotted string (23 §3). X3 introduces **neither** `Capability*` names **nor** `Trait*` wire types, and copies no ID list — no second wire dictionary. If a slice turns out to need the descriptor/trait contract → stop + owner gap here, per BRIEF-12 §3.5 |
| G2 | 27 §6 `ContributionManifestV1` interface lists `status` as required; adopted 27 §0.5.2 demotes whole-unit `status` to an optional display hint | No | Resolved by the owner document's own precedence rule (27 §0 header: «при конфликте выигрывает этот раздел») → optional. Textual fix of §6 suggested to owner in the session report; not a lab decision |
| G3 | 27 §6 comments contribution `id` as «contract-specific grammar», 23 §3/§3.1 requires the qualified form for contribution/provider ids | No | 23 owns identity grammar (MK3/README ownership map) → qualified `publisher/name` form; 23 §3.1 explicitly: «Новый contribution manifest хранит собственный qualified id» |
| G4 | Three diverging live permission vocabularies (`CODEC_PERMISSION_CLASSES` — 9 classes, no `credentials`; `ASSET_PERMISSIONS`; VFS `SourceProviderPermission`), verified live | No | 24 §3 already prescribes the single canonical 10-class taxonomy for v1 and demands explicit mapping for legacy vocabularies; X3 authors exactly that taxonomy. Legacy mapping tables are needed only when legacy fixtures are converted (provenance via PORTED.md) |
| G5 | Standalone `modkit.extension.json` and `version`/`license`: 27 §0.2 says they are «inherited from npm fields», which a non-npm layout does not have | No | Interpretation fixed (supported by 27 §7 which shows `ExtensionManifest#license` fed by either container): the standalone container carries `version`/`license` as its own required fields; the npm container must NOT duplicate them (single source per artifact). Negative fixtures: standalone without them = error; `#modkit` block duplicating them = error. Flagged for owner confirmation in the session report; adapter-level reading, not a contract change |
| G6 | Canonical control-schema dialect not fixed (23 §18.1 open) | No | Lab decision L2: JSON Schema 2020-12 for lab schemas; recorded here, promotion of the dialect belongs to owner 23. No published `$id`s until owner adopt (nothing is published at all, §7.1) |
| G7 | BRIEF-12 §1 Done-criteria name packages `@modkitx/core`… while §7/§7.1 forbid occupying `@modkitx/*` | No | §7/§7.1 is the explicit later-dated rule: lab packages are `@modkitx-x3/*`; only local `pnpm pack` tarballs, no publish. Risk standing order: if the owner starts R5 creation of `@modkitx/sdk`/`host` while X3 flies, the parallelism risk goes into the session/final report |
| G8 | v1 `codec.manifest.json#runtimeVariants` (entrypoints map, capabilities verbs) differs from 24 §3 `RuntimeVariantDeclaration` (single `entrypoint`, `requestedPermissionClasses`) | No | Not a conflict: v2 envelope deliberately uses 24 §3's shape; v1 manifests remain **legacy input fixtures** only (marked, excluded from the legacy gate), normalized during fixture conversion with PORTED.md provenance |

### 5. Lab-local decisions recorded (inside delegated boundaries)

- **L1**: Lab package names `@modkitx-x3/{core,sdk,vfs,host,testkit}` + leaf
  `apps/modkit-cli` (binary `modkit`, private). Nothing is ever published (§7.1).
- **L2**: JSON Schema dialect 2020-12 (see G6).
- **L3**: `TraitId`/operation IDs are opaque grammar-validated strings in X3; no ID
  catalogs are copied from `modkitx` (see G1).
- **L4**: Permission classes = canonical 10-class list from 24 §3 (see G4).
- **L5**: Planned runtime validator: Ajv (2020-12) as the single external `sdk` dependency —
  justification lands in PORTED.md together with the first S0 code; `core` stays at
  «LogTape only» (canon §6.1) and even that is added only when diagnostics need it.
- **L6**: Canonical JSON serialization for emitted schemas/locks: UTF-8, LF, sorted object
  keys where order is not semantic, arrays of IDs unique + UTF-8-byte-sorted (23 §9.9).
- **L7** (hardened by corrective pass C4): Legacy gate = `scripts/check-legacy.mjs`
  (zero-dependency): scans `packages/**/src`, `apps/**/src`, `packages/**/schemas`, package
  names, `exports` maps and full manifest text; excludes `**/fixtures/legacy/**` paths, and
  honors the `@modkit-legacy-input-fixture` marker only under a `fixtures/` directory
  (elsewhere the marker is itself a violation). Committed regression suite:
  `scripts/test/check-legacy.test.ts`. Category-as-path is NOT grep-detectable and is
  enforced by S1 loader tests + review instead — recorded here so the gate's blind spot is
  explicit.
- **L8** (superseded by corrective pass C3): the protocol is fixed in S0.0 — see C3 above;
  X3-S0.5 only implements the bench script against it.

### 6. What X3-S0.0 did NOT do (explicit; amended by the corrective pass)

- No package sources, no `core` types, no schemas yet — first type lands in X3-S0.2+.
- ~~No `pnpm install` / lockfile~~ — done in corrective pass C5 (2026-08-13).
- No writes to `modkitx` beyond BRIEF-12 §8 scope (board/register; corrective pass added
  the Q75–Q77 proposals to `MK3/11-open-questions.md`, also §8-allowed).
- ~~No entry in `MK3/11-open-questions.md`~~ — superseded: the audit surfaced G9 as a real
  blocking gap; Q75–Q77 filed in the corrective pass.
