# 09. Development Roadmap

Status: **non-canonical implementation proposal**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; execution work is owned by `docs/tasks-active/`**  
Updated: 2026-08-12

Canonical package ownership and active work remain in
[Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md) and
[tasks-active](../tasks-active/README.md). This roadmap converts the Proposal into bounded proofs; it
does not create a second active task board.

**Target-first (owner decision 2026-08-12).** Каждый slice ниже читается через канон §14: slice
строится сразу на финальных contracts (27 §0), переносит нужную реализацию direct port-ом,
переводит всех своих consumers и удаляет заменённый путь; фразы вида «v1 adapter сохраняет…»
внутри слайсов описывают только время жизни slice, не публичный переходный слой, и не входят в
final target. Последовательность target-native slices S0–S7 (final envelope → manifest loader без
root generated → unknown root → resolver с двумя providers → external extension+testkit → product
profile → SC2 composite → Multiverse bridge) зафиксирована в REPORT-6 §11.

## 1. Strategy

The migration is a sequence of vertical proofs over current packages, not a greenfield rewrite.
Every slice must leave the repository buildable, preserve observable behavior, and produce evidence
before the next abstraction is promoted.

```text
Lane A — specification/evidence
  tracked Proposal + audited corrections
    -> contribution/codec/service JSON schemas
    -> positive + negative fixtures
    -> docs/schema validator
    -> service/open-intent resolver proofs

Lane B — independent current-code slices
  deterministic comparator
    -> core/events browser boundary
    -> terminology migration
    -> SubjectRef + three adapters

Convergence
  manifest v2 + operation/service resolver + project lock
    -> visible SC2 Unit icon proof
    -> lazy catalog + trait evidence
    -> language/editing/security/runtime/World slices
    -> gated extraction only when proved
```

Rules:

1. No permanent public legacy facade is required: there are no stable external API users yet.
2. Internally staged adapters are allowed so each slice compiles and tests.
3. Do not move implementations merely to match a target tree.
4. Do not create a package until it has an independent dependency/lifecycle/consumer reason.
5. Do not interpret a missing trait as unsupported while manifest backfill is incomplete.
6. Do not design binary ABI/Rust/WASM before the TypeScript proof and benchmark gate.
7. CI-backed Proposal gates start only after the Proposal and its documentation-index entry are
   committed and shared in Git; staging alone is local, untracked files are not reviewable evidence
   and can be lost to `git clean -fd`. In a shared dirty worktree use path-scoped add plus
   path-scoped `git commit --only`, never blanket `git add .`.
8. Lane A does not block comparator/core-events work in Lane B. SubjectRef begins after its
   normative identity shape and overlapping `packages/assets` terminology changes are coordinated.

### 1.1 Priority lanes (owner direction 2026-08-12)

Головой очереди остаются adopted next steps REPORT-9 §19 (1 World ABI v0.1 · 2 G0 P0–P1 ·
3 Modkit S0 · 4 UVE packer · 5 UVD/UVS validate) — этот раздел их не меняет, а организует всё
остальное вокруг них в согласии с продуктовым клином REPORT-8 (SC2 IDE → AI plane → G0 →
skirmish). Lane — параллельная дорожка; внутри lane порядок сверху вниз. Board IDs — из
`docs/tasks-active/MASTER_TASK_REGISTER.md` и engine/platform board.

| Lane                                               | Содержание (board IDs)                                                                                                                                                                                                                            | Почему в этом месте                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **B0 — evidence trust** (сразу, параллельно всему) | IT-1, IT-2 (trait gate green), IT-5 comparator, IT-6 docs:check, MK-S0.4 baselines                                                                                                                                                                | Пока aggregate gate красный, ни одно evidence-заявление не достоверно; дёшево и разблокирует доверие ко всем последующим измерениям |
| **B1 — Modkit core route** (голова: NEXT-3)        | MK-S0 (.1–.4) → MK-S1 (loader, lazy detect, five-trait backfill) → MK-S3 (S3a catalog split → resolver/lock = IT-10 → PR-2 icon proof → PR-5/PR-6 service proofs) → MK-S2 unknown root; параллельно **SEC = SB-0** (24 §6.1) и R4 SubjectRef (S2) | Resolver + manifest v2 + identity — ядро, на котором стоит всё остальное; SB-0 обязана лечь **до** массовой миграции кодеков (S3c)  |
| **B2 — product wedge** (после B1 resolver)         | AI-0 → AI-1 (typed operation catalog, read-only skill); LANG L0–L2; TXN-1…TXN-5; затем MK-S4/MK-S5, MK-S6, AI-2 (требует SB-0 + TXN)                                                                                                              | AI-plane стоит прямо на resolver/operations (решение 60); язык и транзакции кормят SC2 IDE — продуктовый клин                       |
| **B3 — Multiverse** (голова: NEXT-1, NEXT-2)       | World ABI v0.1 → G0 P0/P1 target-native (W-TS-1) → P2 slot (W-TS-2) → MK-S7 bridge, PR-24                                                                                                                                                         | Параллельная дорожка движка; bridge только после ABI                                                                                |
| **B4 — форматы-минимум** (голова: NEXT-4, NEXT-5)  | UVE packer proof; UVD/UVS validate slice                                                                                                                                                                                                          | Разблокируют distribution-минимум и G0 P4                                                                                           |
| **Gated** (не строить до gate)                     | SB-1…SB-5 (24 §6.1); R7/EX-8 distribution; UVI/UVY; portable UI; general augmentation DAG; Rust/WASM ABI (S9 gate)                                                                                                                                | Каждый ждёт назначенный gate; строить раньше — speculative infrastructure                                                           |

**Правило видимого эффекта (owner direction 2026-08-12).** Каждый slice дорожек B1/B2 называет в
своём exit evidence наблюдаемый эффект в SC2 IDE — по образцу S3b (иконка юнита через
resolver/lock с видимой деградацией). Slice, у которого такого эффекта нет, явно объявляет себя
инфраструктурным и называет ближайший slice, который его эффект покажет. Сопутствующая процессная
метрика — **время «новый формат с фикстурой → превью в IDE + badge»** — кандидат в acceptance
(документ 10) и меряется testkit-отчётом golden path (19 §16), а не счётчиками пакетов: Rule
21/26 измеряют сходимость, эта метрика измеряет ценность.

## 2. S0 — Documentation, schemas, and baselines

### Goal

Remove contradictory normative blocks and record current behavior before implementation changes.

### Scope

- repository precondition: add the complete Proposal directory and its
  `docs/DOCUMENTATION_INDEX.md` entry to one path-scoped reviewable commit and share that commit
  before enabling Proposal-specific CI; this changes no canonical ownership;
- one `ProviderOffer`/`ProviderRequest`/contract/target/result schema in document 23;
- one `SourceRef`/`SubjectIdentity`/`SubjectRef` in document 25;
- orthogonal `MutationMode`, `CommitGuarantee`, `TransactionStatus` and `UndoGuarantee` target,
  gated by the first real editing consumer;
- separate `WorldOffer` in document 26;
- one qualified-ID grammar, with versions always in separate fields;
- canonical-wins status banners and divergence register;
- baseline codec catalog counts, startup imports/bytes/time, language diagnostics, edit round trips,
  `SimEngine` order/hash/tick performance;
- inventory locale-dependent comparisons that influence locks, schedules, diagnostics, hashes, or
  generated output;
- make `pnpm codecs:traits:check` part of the aggregate evidence gate and close current stale output;
- define manifest trait presence/verification separately from observed fidelity and prove that
  `may-expose` cannot satisfy a hard route;
- inventory browser-safe imports and static detector imports.
- draft machine-readable candidate schemas for the contribution envelope, codec contribution and
  service-provider contribution plus positive/negative fixtures. They remain Proposal artifacts;
  production adoption belongs to S3c after resolver coordinates are proven.
- draft document 28 distribution schemas for release record/artifact reference, install lock,
  catalog descriptor, installed-product evidence and declarative match rule. These schemas define
  boundaries only; remote marketplace/installer implementation remains gated.
- add a documentation contract checker that parses fenced normative TypeScript blocks and verifies:
  - exactly one owned definition per normative type;
  - referential closure against owned definitions, explicit external imports and a small TypeScript
    built-in allowlist;
  - all qualified-ID literals against the document 23 grammar;
  - local document/section links and anchors;
  - a curated concept-to-ID inventory so aliases such as two permission-denied IDs cannot drift;
- close the audited semantic inconsistencies before implementing their consumers. Automated checks
  catch structural drift; lock-key completeness, revision semantics, relation meaning and scheduler
  behavior still require review fixtures.

### Exit evidence

- a docs check asserts exactly one normative definition for each owned core type;
- the same check proves normative type-reference closure, ID grammar, curated concept-ID uniqueness,
  and local section-link resolution;
- `git ls-files docs/MK3` lists every Proposal document before the checker is
  made a CI gate;
- all local Markdown links and formatting pass;
- current manifest validators and generated-catalog checks pass unchanged;
- codec validation and trait-index freshness both pass in the same aggregate command;
- baselines are machine-readable fixtures, not prose estimates;
- candidate contribution/codec/service and distribution release/install/inventory schemas pass
  positive, negative and unknown-field fixtures;
- Proposal contains no claim that future packages/ABI/security isolation already exist.

### Not included

Runtime activation behavior, package moves, manifest backfill and production adoption of extension
manifest v2. JSON Schema proves shape only; resolver selection, degradation and `OpenIntent` budgets
require the executable S3 proofs.

### Dependencies and safe parallel lanes

The Git commit/share prerequisite must merge before Proposal-specific CI can enforce anything. Checker
implementation and baselines may be prepared locally in parallel, but their evidence becomes shared
only after that prerequisite. The first implementation wave can otherwise be split as follows:

| Lane | Independent work                                                                                 | Main ownership                                          |
| ---- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| A    | Git tracking, candidate schemas/fixtures, documentation checker and audited Proposal corrections | `docs/`, schema fixtures, checker script                |
| B    | Canonical comparator and generator/protocol classification                                       | `packages/core`, `packages/assets`, generators          |
| C    | Narrow browser-safe `core/events` boundary and import migration                                  | `packages/core`, four current consumers                 |
| D    | Language L0 contracts and protocol adapter fixtures                                              | `language-contracts`, `packages/lsp`                    |
| E    | Simulation baselines, synced-state inventory, restore/compatibility-envelope proof               | target-native Multiverse G0 + SC2 runtime parity oracle |

Lanes A, C, D and E can proceed independently after ownership is assigned. Lane B must not overlap
S1c's mechanical terminology changes in `packages/assets`. S2 subject identity and S3a catalog split
are independent prerequisites that converge before the operation resolver.

## 3. S1 — Three independent deterministic/boundary slices

### Goal

Make future locks/resolution/schedules reproducible and keep portable contracts importable.

### S1a — Canonical comparator (first technical slice)

- define canonical bytewise UTF-8 comparison; ASCII logical IDs use equivalent zero-cost JS
  comparison `a < b`;
- classify all current `localeCompare` sites as generator/protocol, verifier/report or UI;
- replace locale-sensitive comparison in generators and protocol-significant paths first;
- add a lint/boundary rule that forbids `localeCompare` in those paths;
- keep locale-aware sorting in UI/display paths where it is intentional;

### S1b — Browser boundary

- add/verify explicit browser-safe subpaths; first concrete proof is `@modkitx/core/events` and
  migration of the current browser-safe imports that reach events through the root barrel;
- prevent browser-safe packages from reaching `node:*` through root barrels;

### S1c — Terminology rename

- converge terminology in code-facing docs: traits, codec capabilities, contracts, operations,
  facilities, permissions;
- mechanically rename descriptor-layer TypeScript symbols `CapabilityId/Instance/Query` to
  `TraitId/Instance/Query` and `CAPABILITY_IDS` to `TRAIT_IDS`; JSON `traits` is unchanged;
- rename non-codec uses of capability in TypeScript: `CODEC_HOST_CAPABILITIES` ->
  `HOST_FACILITIES`, runtime capability -> runtime session feature, source/VFS capability ->
  source/VFS access; keep deprecated JSON aliases only where manifest compatibility requires it;
- plan compatibility mapping between `CODEC_PERMISSION_CLASSES` and `ASSET_PERMISSIONS`.

S1a, S1b and S1c are separate commits/slices. S1a runs first because generated catalog bytes and
future lock fixtures depend on it; S1c touches `packages/assets` and follows comparator changes to
avoid artificial merge conflicts.

### Exit evidence

- five shuffled input orders produce byte-identical lock/catalog/schedule fixtures;
- package-boundary test reports no `node:*` reachability from browser-safe entries, including the
  migrated events imports;
- generators/protocol paths do not use `localeCompare`; UI use is explicitly classified;
- no new `@modkitx/capabilities`, `provider-host`, or Multiverse package in this baseline-only slice.

## 4. S2 — Subject identity vertical proof

### Goal

Represent files, nested document parts, archive entries, and semantic entities with one
provider-independent address.

### Scope

- implement the document 25 `SourceRef`/`SubjectIdentity`/`SubjectRef` schema;
- define equality, URI serialization, percent encoding, and revision exclusion;
- adapt three real targets:
  - SC2 catalog entity;
  - SC2Layout template/frame FQN;
  - archive entry;
- preserve current public APIs internally until each consumer migrates, but do not publish a second
  permanent identity system;
- separate display labels, provider evidence, and format detection from identity.

### Exit evidence

- parse/serialize round trips for root and nested subjects;
- changing selected provider does not change subject identity;
- `SubjectSnapshotRef` changes revision without changing `SubjectRef` equality;
- rename/move returns explicit alias/ambiguous/not-found semantics;
- cards, relations, diagnostics, and edits can point to the same subject coordinate.

## 5. S3 — Operation-provider resolver and portable provider-policy lock

### Goal

Select an installed implementation by requested function, target, and outputs rather than discovery
order or exact codec ID.

### Ownership

V1 types, `resolveProvider()`, and portable provider-policy lock live in `@modkitx/assets`. This is the
**operation resolver**. Install/marketplace dependency solving is future work and has a different
lock. Activation stays in the current host composition module until a worker/process profile creates
a real `provider-host` boundary.

### Scope

- prerequisite S3a: generate one detection registration per `(codecId, environment)` while
  preserving every activation offer as `(codecId, variantId, environment)`; never choose one of two
  real runtime variants merely because both share an environment;
- implement only the normative-candidate types/algorithm from document 23;
- filter by contract/version, operation kind, runtime target, permission compatibility, required
  outputs/traits, and optional pin;
- use deterministic explicit rank plus canonical UTF-8/ASCII tie-break;
- return `resolved` or structured `unresolved`; hard-required consumers may convert unresolved to
  `ModkitError` at their boundary;
- persist a readable request key plus logical provider/extension majors and allowed fallbacks;
  runtime variant, OS/architecture, facilities, tools, grants and artifact digests stay in activation/
  install/session records; range, required/preferred outputs and workload cannot collide;
- add two TypeScript fixture providers of one test contract; do not invent native/WASM variants;
- use real ambiguity fixtures such as `.uasset` and `.map` catalogs.

### S3b — Visible vertical proof

After resolver/lock conformance passes, route one existing SC2 Unit card icon through the new
composition path:

```text
SC2 Unit SubjectRef
    -> relation with semanticRole visual.icon
    -> image SubjectRef
    -> ProviderRequest common.image/decoded@1
    -> deterministic provider selection + project lock entry
    -> existing entity-card/viewer-shell rendering
```

The production path uses the installed compatible image provider; the two TypeScript providers from
resolver fixtures prove deterministic choice and degradation without pretending that two production
DDS implementations already exist. Missing optional decode support renders the existing fallback and
an explanation trace, rather than failing the Unit card.

### S3c — Contract-typed contribution manifest v2

After request/offer/lock coordinates are proven, introduce the document 27 extension discovery
target as a separate breaking schema slice:

- one `extension-manifest v2` open `contributes[]` list with contract-typed shallow manifest globs;
- one `ContributionManifestV1<TSpec>` envelope for codec, game, source/subject/language/operation/runtime
  providers, service providers, projections, presets, contract bridges, subject viewers/editors,
  World and game-UI contributions;
- one codec contribution schema for `FormatRole[]`, source topology, `ArtifactStage`,
  `OpenIntent`, detection and fidelity claims, while legacy `kind` remains an adapter input;
- one service-provider contribution schema for typed inputs/outputs, contract requirements, budgets
  and runtime variants without source identity/detection;
- contract-specific `spec` schemas resolved without extension execution;
- owner contract definitions publish addressable conformance fixtures; foreign implementations can
  cite the exact suite/result used as compatibility evidence;
- presets remain data-only selections; bridge manifests declare source/target majors, but bridge
  execution remains unsupported-kind until its own proof and can never become an implicit
  conversion chain;
- canonical expansion order, orphan/duplicate/escape/contract-mismatch diagnostics;
- two-pass custom contribution-contract definition loading;
- generated detection and activation catalogs remain distinct outputs;
- v1 codec/game coordinates `org.modkitx/<id>` remain independent from grouped extension
  coordinates; adapter output preserves current coordinate tie-break and records owning extension
  separately;
- v1 codec/game/source-provider manifests are migrated through generated adapters, not accepted as a
  second permanent discovery model;
- extension license remains the single static-link/provenance boundary;
- manifest validation can emit a self-contained catalog publication fragment without knowing the
  main repository path; source repository, extension coordinate and contribution coordinates remain
  independent.

### S3d — Service resolution and bounded-open proofs

Schemas are necessary but do not prove runtime behaviour. Two falsifiable proofs join Lane A and
Lane B:

1. **7z -> LZMA service.** 7z and LZMA providers live in different fixture extensions; removing
   LZMA preserves archive index and marks only affected entries `dependency-required`; two providers
   resolve identically under five shuffled discovery orders and are locked; missing provider and
   corrupt stream return different stable errors.
2. **KTX2 preview intent.** Counters record bytes read and modules activated for `metadata`,
   `preview` and `full`; metadata activates no transcoder, the committed fixture requires at least
   10x fewer bytes read for preview than full plus fewer activated modules, and budget exhaustion is
   distinguishable from unsupported format.

SHP+PAL adds an optional cross-codec companion proof with true-color/degraded-grayscale fidelity;
M3+M3A covers same-codec semantic sidecars; Unity assets/ress/UnityFS covers namespace graph and
cycle protection.

### Exit evidence

- five discovery orders produce one lock;
- different requested outputs can choose different providers for the same detected family;
- satisfied pin wins; unsatisfied pin reports `pin-unsatisfied`;
- missing optional provider degrades; hard request produces structured failure;
- resolver does not read file bytes or activate arbitrary entrypoints during ranking;
- a codec that is the only installed implementation of its contract is selected with **zero**
  authored offers/ranking/lock configuration (19 §16 rule 6): the negative fixture asserts its
  scaffold output resolves untouched, and only the second implementation pays ranking ceremony.
- all activation variants for `unreal-iostore`, `spring-rapid`, `spring-vfs` and `sage-skudef` remain
  selectable after detection deduplication.
- one SC2 Unit card displays its icon through `SubjectRef` + relation + provider request + lock, and
  degrades visibly when the optional decoder is unavailable.
- two extensions using different contribution contracts and one custom namespaced contract produce
  byte-identical expanded catalogs across shuffled filesystem order;
- every contribution manifest is matched exactly once, and no authored host/package switch changes
  when the custom contribution type is added.
- contribution/codec/service schemas accept the valid KTX2, MP4, Wwise BNK, BLEND and SC2Map
  fixtures and reject malformed IDs, source-less codecs, service detection and duplicate ownership;
- v1/v2 adapters preserve byte-identical coordinate ordering across shuffled inputs;
- the 7z/LZMA and KTX2 proofs satisfy the S3d degradation/determinism/resource counters.

### Not included

Full marketplace/install solver, general SAT solver, augmentation DAG, conformance-evidence ranking,
automatic remote installation. Document 28 distribution schemas/API boundaries and local artifact
proof may proceed independently; data-only presets describe desired contributions but do not install
or solve them in this slice.

## 6. S4 — Catalog, lazy detection, and trait backfill

### Goal

Deliver a measurable startup/bundle improvement and make trait queries useful without eagerly
importing codecs.

### S4a — Lazy detection and measured import reduction

- remove hand-authored static `*.detectors.ts` imports where generated data can select a lazy
  detector entrypoint;
- make `matchCatalog()` asynchronous/lazy without loading codec implementations;
- make VS Code limitation explicit: custom editor/view contributions are build-time manifest data,
  while codecs/providers behind those contribution points may still activate lazily.

### S4b — Minimal routing trait backfill

- backfill only traits currently used for generic routing: `image.raster`, `model.geometry`,
  `container.entries`, `content.text` and `game.map`;
- add evidence/representation information and keep absence semantics as `undeclared`, never
  `not-supported`;
- expand beyond these five only when a consumer query exists.

### S4c — Independent artifact and embedded-app proof

- run the independent artifact proof on current manifest v1 plus generated adapters; it does not
  wait for S3c manifest v2;
- build one non-common fixture extension from an isolated repository/worktree into an immutable
  artifact + catalog fragment;
- update the application/source bundler to resolve explicit `modkit.extensions.json#linked` roots
  outside the monorepo and compare its output with the packaged artifact path;
- start a clean generic host with bundled `common` only, install/link the artifact without authored
  main-repository registry edit and regenerate installed detection/activation catalogs;
- build one web component/specialized app with a pinned browser-safe external extension and generated
  lazy loader/SBOM/license output;
- prove that main-repository root `generated/` is only development/bundled-common output and does not
  become marketplace or user-installed state.

### Exit evidence

- importing one browser category loads zero codec implementation modules before detection/selection;
- catalog registration does not throw on duplicate detect/implementation records;
- baseline bytes/time/module count improve and the delta is recorded;
- at least 90% of manifests in the five routed trait scopes declare audited traits, or the slice
  stops with an explicit measured exception list;
- generated trait index remains a declaration index, not a support oracle.
- independent extension artifact loads without source checkout or `pnpm-workspace` enrollment;
- linked-root development build loads the same contribution identities without copying source into
  `packages/`, `codecs/`, `apps/` or main-repo `extensions/`;
- common-only and embedded-extension bundles have measured/import-audited dependency sets;
- extension build fragment, app bundle catalog and installed catalog have separate output paths and
  schema owners.

## 7. S5 — Neutral language migration L0–L6

### Goal

Language functionality works directly in CLI, table/tree editors, AI tools, and tests without an LSP
server. LSP becomes one adapter over the same neutral service.

### Package decision

- `language-contracts`: browser-safe DTOs/interfaces only;
- `language-host`: stateful transport-neutral sessions, composition, indexes and scheduling;
- existing `@modkitx/lsp`: protocol/server adapters over `language-host` only;
- no additional `language-lsp` package and no permanent compatibility facade.

### Ordered slices

| Slice | Change                                                                                                                            | Exit                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| L0    | Define neutral position/range/diagnostic/edit/completion/hover/reference interfaces and embedded-document/source-map contracts    | `language-contracts` has no VS Code/LSP/Node dependency and passes browser import test                             |
| L1    | Extract neutral stateful lifecycle into `language-host`; make `@modkitx/lsp` an adapter from neutral providers to protocol DTOs   | Existing servers emit identical normalized diagnostics/completions; CLI starts the same host without LSP transport |
| L2    | Move SC2 strings semantic provider behind neutral API                                                                             | Text and table/cell callers share one semantic source without running LSP                                          |
| L3    | Move GameData/XML semantic provider                                                                                               | Entity card, references, CLI and LSP use one provider and resolved schema facts                                    |
| L4    | Move Galaxy, whose core service is already largely protocol-neutral, after its remaining `vscode-*` runtime dependency leaves     | Embedded Galaxy block uses neutral diagnostics/hover/navigation and native `EngineProgram` path                    |
| L5a   | Isolate SC2Layout Node-only `fs-extra`/`fast-glob`/`node:*` imports behind explicit Node entries and replace protocol DTO imports | Portable layout core passes browser boundary tests                                                                 |
| L5    | Move SC2Layout through the neutral provider after L5a                                                                             | Template subject/code navigation/structural preview share revisions/source maps                                    |
| L6    | Remove old internal SPI and merge adapters/CLI on neutral calls                                                                   | No permanent public legacy facade or parallel semantics remain                                                     |

Each slice keeps the repository green. Breaking target API is acceptable; duplicate long-lived public
APIs are not.

## 8. S6 — Transactions and revisions

### Goal

Reject stale edits before side effects and report the actual guarantee/recovery of a write.

### Scope

- first connect one real VS Code save command to an existing SC2 transaction factory and name the
  host/VFS commit owner;
- then migrate existing `AssetEditPlan`/`AssetEditTransaction` around the proven boundary;
- separate `MutationMode`, `CommitGuarantee`, `TransactionStatus` and `UndoGuarantee`;
- `expectedRevisions` based on current source `versionToken`/subject revisions;
- host commit returns `TransactionReceipt` with before/after revisions, outputs, status, undo and
  recovery; codec-side output materialization is not called a filesystem commit;
- nested SC2Layout edit proof;
- raw-preserving SC2 Unit edit proof;
- filesystem atomic/recoverable adapter where the backend can honestly provide it.

### Exit evidence

- the first production consumer proves stale-plan rejection and a second revision check immediately
  before the first write, including multi-binding plans;
- nested edit preserves unrelated formatting/unknown data;
- partial multi-source failure returns recovery information and never silently switches provider;
- irreversible action declares `undo: 'none'` before confirmation;
- no second generic patch hierarchy is introduced.

### Not included

Cross-backend two-phase commit, semantic merge, distributed recovery.

## 9. S7 — Honest security and provider lifecycle

### Goal

Enforce deny-by-default at boundaries that can enforce it, and explicitly report ambient authority
where they cannot.

### Scope

- one permission vocabulary and compatibility mapping;
- codec `runtimeVariants[].permissions` remain authoritative for executable requests;
  `extension.json.security` contains authored target-scoped review rows, and validation requires
  exact equality per contribution/variant/target; a flat union is generated UI metadata only and no
  summary/projection may grant authority;
- host policy, never an extension-authored boolean, decides which permission classes require
  approval;
- operation/session grants and nested intersection;
- dispatch enforcement before broker handles/side effects;
- trusted-in-process full-authority diagnostic;
- per-host/profile enforcement matrix;
- lifecycle/dispose/cancellation/secret-redaction tests;
- browser-safe test proving no reachability to `node:*`.

### Exit evidence

- missing declaration/grant fails deterministically;
- child grant never broadens parent grant;
- brokered filesystem/network access is denied before broker side effect;
- broker enforcement is added to concrete providers rather than inferred from dispatch filtering;
- no test claims Node in-process ambient filesystem/network isolation;
- existing locked session does not silently receive provider update;
- credentials never appear in lock/log/cache key.

### Not included

Signatures, marketplace trust chain, quarantine, WASM sandbox, sandboxed process, remote provider.
Those remain future profiles until a real provider requires them.

## 10. S8 — `SimEngine` becomes World v0 proof

### Goal

Prove replaceable mechanics and deterministic compiled scheduling on the working SC2 simulation,
without building a second engine.

### Scope: W-TS-1

- record current `SimEngine` literal order, hash output, snapshot/restore behavior, and tick benchmark;
- classify every `GalaxyGameState` field plus `SimEngine` session/transient field as synced,
  composition-immutable, derived, presentation or external; record snapshot/hash/restore/replay-input
  policy for every field before claiming restore completeness;
- before scheduler work, add a versioned domain-separated compatibility envelope and a restore-
  continuation fixture, preserving current `hashWorld` as migration oracle; then repair
  `Sc2RuntimeSession.restore` to restore/clear all declared resumable/transient state;
- define `WorldTickContext` and generic `SystemDeclaration<TContext extends WorldTickContext>`;
- describe 12 systems plus all 15 current tick units; add cadence for four periodic AI functions;
- use only three occupied phases: `input`, `update`, `event-delivery`; snapshot/presentation remain
  boundary operations;
- compile declarations into the same order;
- validate cycles, missing dependencies, read/write conflicts;
- add world-state, continuation, composition and content roots plus envelope root;
- use `multiverse.numeric/f64-observed` with allowed/observed operation rules;
- add cross-engine sqrt and N-tick Node/browser-worker fixtures.

### Scope: W-TS-2

- define SC2-qualified `blizzard.sc2/vitals-regeneration` exclusive slot around all `stepRegen`
  invocation paths;
- provide two independent fixture implementations of the whole regeneration step;
- resolve one deterministically and prove that changing it affects only the slot;
- classify command/event queues, accumulator, `nextLocalSequence`, `state.globals`, `state.nextId`,
  schedule/RNG/script state into the versioned roots; lockstep compares continuation root, admission
  compares protocol/profile + composition/content, save/resync persists the full envelope;
- promote to `multiverse.rts/*` only after a second game proves compatible semantics.

### Exit evidence

- compiled 15-unit order and cadence equal current behavior on golden fixture;
- shuffled registration order does not change schedule/lock/hash;
- current SC2 fixtures remain byte-for-byte/hash equivalent where the existing contract promises it;
- slot conflict is rejected before tick and exactly one selected provider runs;
- `Sc2RuntimeSession.restore` restores all state covered by the declared snapshot contract;
- the synced-state inventory has no unclassified field; perturbation fixtures prove that every
  synced field affects its assigned envelope root, while every exclusion has a tested rationale;
- tick benchmark does not regress beyond a predeclared budget.

### Explicitly not included

New packages, standalone kernel, `EntityHandle`, dense/SoA storage, IDL, binary ABI, parallel
executor, multiple worlds, universal Lua/Galaxy AST, complete RTS foundation.

## 11. S9 — Gates, not implementation phases

### Second-game/independent-consumer gate

Promote World contracts to standalone `@multiverse/world-contracts`, create
`@multiverse/engine`, or promote SC2 mechanics to common only when at least one condition is true:

- a second real game (Spring/SAGE/etc.) needs the same proven semantics; or
- a non-Modkit consumer requires the World contract independently.

The gate requires a compatibility fixture, not only similar terminology.

### Rust/WASM gate

Prototype an ABI only when all are true:

1. S8 deterministic fixtures pass across supported JS engines;
2. profiling identifies a specific hot path;
3. allocation/layout improvements in TypeScript were attempted first;
4. a workload target and regression budget are written down;
5. batch boundary can preserve snapshot/hash semantics.

### Package extraction gates

| Future package/profile        | Gate                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@modkitx/provider-host`      | first real worker/process execution profile with independent lifecycle                                                            |
| `@modkitx/capabilities`       | measured dependency/bundle ownership problem not solved by subpaths                                                               |
| extension catalog client      | read-only static catalog proof with two independent publishers and offline snapshot                                               |
| install/marketplace resolver  | independent artifact proof plus actual distribution channel and dependency-install workflow                                       |
| product inventory host        | consented generic collector + declarative rules for two unrelated products                                                        |
| portable UI contracts/runtime | two different UI formats pass shared conformance fixtures and publish explicit fidelity reports; no invented percentage threshold |
| general augmentation DAG      | two independent augmenters need conflict/write-ownership protocol                                                                 |

## 12. Future/research backlog

These items remain valid ideas but must not block v1:

- binary IDL and generated TypeScript/Rust/WASM bindings;
- `EntityHandle` plus numeric/SoA component storage;
- parallel scheduler and shared-memory views;
- multiple World domains and typed bridges;
- fixed-point or strict cross-platform numeric profiles;
- portable game UI document/runtime plan;
- full marketplace service, signatures/attestations, revocation/quarantine and automatic remote
  installation; read-only catalogs, schemas and independent local artifact proof are earlier slices;
- WASM/process/remote execution isolation;
- cross-backend two-phase commit and semantic merge;
- general projection/augmentation DAG;
- MCP/automation adapter beyond existing public operations.

## 13. Proposal completion criteria

The Proposal is ready to seed canonical task slices when:

1. normative types are unique and internally consistent;
2. every v1 package owner maps to a current package or an explicit gate;
3. every security claim names its enforcement boundary;
4. every deterministic claim has a fixture plan;
5. every migration slice names current code, exit evidence, and exclusions;
6. World evolution starts with `SimEngine`, not a parallel rewrite;
7. main/common, independent extension, catalog, installed/app bundle and generated scopes are
   explicitly separated according to document 28;
8. unresolved canonical divergences are recorded rather than silently decided here.

## 14. Следующие этапы после execution‑boundary slice — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

Состояние: NXT‑105 (capability‑RPC), NXT‑103 (method surfaces), R2 (adapter/ABI surfaces),
NXT‑114/R3 (Node worker backend с verified loading; реальный `text-json` codec probe/open в worker'е)
приземлены (документ [32](32-execution-boundary-and-method-surfaces.md)). Дальше, в порядке merge:

1. **Wiring в composition roots (CLI/Electron/server)** — _сделано 2026‑08‑18 (S1a/S1b)_:
   `createNodeExecutionBackends` с `WorkerBackendPolicy`, realm `node-worker` в каждом Node root'е;
   `portable`‑варианты кодеков и провайдеров идут через worker в продукте; acc‑8/acc‑12 закрыты.
   Осталось из этого пункта:
   `x3.host/worker-shared-process` в UX по решениям Opus (OPUS‑UX‑01); acc‑8 restart generation,
   acc‑12 kit на реальной паре портов backend'а (единый MessagePort‑adapter в `host/execution`).
2. **Протокол 1.1 остаток:** `has[]` присутствие optional‑методов, `nextBatch` для `iterable`,
   `operations().invoke` placements в host‑side session adapter, derived inputs/`openMaterialized`.
3. **R4/R5 (NXT‑101B, probe grant):** bounded data‑only signature index (renamed PNG `.dat`),
   отдельный probe grant через brokered execution seam; hostile detection fixtures (polyglot,
   magic collision).
4. **R6 — Electron IPC → capability‑RPC:** preload как `FramePort` над `MessagePort`; renderer без
   кодеков; kit против Electron‑пары; удаление остатков allowlist'ов.
5. **Browser worker backend (`browser-sandbox`)** на том же ядре; PWA, затем VS Code.
6. **VFS/container + bundle resolver (NXT‑200/201)** и MK2‑конвертер/parity‑harness по
   `REPORT_MK2_ALLOCATION_*` — после стабилизации worker/VFS.
7. **SB‑2/SB‑3/SB‑4** по своим gates: `process-brokered` до первого native codec внешнего
   publisher'а; digests зависимостей и подпись/revocation вместе с внешним distribution channel.
