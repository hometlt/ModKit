# Implementation notes — modkitX3

Newest entries first. Owner documents live in `modkitx/docs`; this file records lab-side
analysis, decisions inside the delegated lab scope, and owner-decision gaps. It never
overrides a canonical or detailed owner.

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
kind, and the packaging error when both containers are present. Extension-level dependencies
and declared-inventory diffing (canon §5.13) are **deferred** past S4 — S0–S4 needs no
extension-to-extension dependency edge.

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
- **L7**: Legacy gate = `scripts/check-legacy.mjs` (zero-dependency): scans
  `packages/**/src`, `apps/**/src`, `packages/**/schemas`, plus package names/exports;
  excludes paths under `**/fixtures/legacy/**` and files carrying the
  `@modkit-legacy-input-fixture` marker (§3.5 requires the exclusion so negative tests of
  the old manifest stay possible). Category-as-path is NOT grep-detectable and is enforced
  by S1 loader tests + review instead — recorded here so the gate's blind spot is explicit.
- **L8**: Bench protocol details (reference environment, warm-up, run count, p50/p95,
  startup exclusion) are fixed in X3-S0.5 when the bench script lands, per BRIEF-12 §6 —
  the DoR only pins that numbers become gates via measured baseline, not declaration.

### 6. What X3-S0.0 did NOT do (explicit)

- No package sources, no `core` types, no schemas yet — first type lands in X3-S0.2+.
- No `pnpm install` / lockfile: dependency ranges in the scaffold are placeholders until the
  X3-S0.1 bootstrap slice installs and pins them.
- No writes to `modkitx` beyond the board/register status updates allowed by BRIEF-12 §8.
- No entry in `MK3/11-open-questions.md`: no found gap required an owner decision to
  proceed (G2/G5 carry suggested owner confirmations via the session report; both have
  non-blocking resolutions inside existing owner text).
