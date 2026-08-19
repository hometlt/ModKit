# ADR-HOST-002 — Binary editing on the 13D seam: writer surface and definition, file backend, host-gated mutating operations

Status: **Accepted** (2026-08-19, lab Root = Fable by owner decision; S8)
Applies to: `modkitX3/packages/sdk` (editing ABI surface/definition), `packages/host` (gate,
subject-open, editing, standard definitions, node file backend), `extensions/_shared/codec-kit`,
first-party codecs that declare mutating operations, the MK2 converter's vocabulary
Relates to: BRIEF-13D (owner, `modkitx/docs/tasks-active/platform-architecture/BRIEF_13D_universal_asset_editing.md`,
R4 "IMPLEMENTED IN THE X3 LAB, NOT PROMOTED"), ADR-HOST-001 (one execution boundary)

## Context

13D is implemented in the lab: the editing ABI (`packages/sdk/src/editing.ts` — `SourceEdit` as a
discriminated union of byte-range / whole-source `replace`, `create`, `delete`, `rename` with
inline or staged payloads; `AssetEditPlan`; `CommitCoordinator`; `Writer` as the resolvable
service contract `common.edit/writer@1` with `WriterRequirement`/`WriterOffer` facets), the host
transaction coordinator (`packages/host/src/editing.ts`: derived write set, grant/revision re-check
before side effects, rollback, undo/redo, fidelity evidence binding) and twenty-four D-cases.
What is **not** there:

- no `EditingBackend` for files — the coordinator is proven only against in-memory backends, and
  the one product host that saves (Electron) bypasses it with a whole-file `filesystem.write-file`
  broker call and a `content-length` pseudo-revision;
- no method surface and no contract definition for `common.edit/writer@1` — a writer provider can
  be validated and leased in-process, but cannot be resolved with its facet (no matcher profile)
  nor materialized across an execution boundary (no surface); no host test ever resolves a writer;
- `mutatesSource: true` is declarable (the validator forces `write-source` onto the variant), the
  session already accepts the `edit-plan` operation output, but (a) the gate hard-denies activation
  when any requested class is missing — so a codec that declares one mutating operation would stop
  opening read-only — and (b) the session's permission check runs against the codec's own
  self-declared grant (`['read-source']` in codec-kit), not against the host's narrowed grant.

The MK2 converter classifies `write` (33 codecs) and `edit` (12) as `needs new contract` on the
note "binary edit contracts absent" — true about implementations, wrong about the ABI. The owner's
§2.6 is explicit: a codec that can write provides the writer as a separate, versioned contract;
§2.7: only the shared verbs `edit.content`, `edit.structure`, `edit.field`, `edit.undo-redo`,
`source.save`, `source.save-as`.

## Decision

1. **No new contract family.** Binary write/edit runs on 13D as specified. Two authoring paths,
   both ending in the host coordinator:
   - **Path A — codec operation.** A codec declares an operation with a shared verb and
     `mutatesSource: true`; its handler has the bytes and returns `{ kind: 'edit-plan', plan }`
     with byte-range or whole-source `SourceEdit`s. For in-place semantic edits (a PNG text chunk,
     an INI value, an archive entry).
   - **Path B — writer provider.** `common.edit/writer@1` (`validate`/`plan` over a `ChangeSet`)
     for edits authored by universal editors (hex, table, text) or carrying a representation
     payload to encode (save-as, format encoders). Writer providers request no permission classes:
     the host commits.
     MK2 mapping: v1 `write` → Path B provider contribution next to the read codec; v1 `edit` →
     Path A operations on the codec; no per-codec editor contribution (editors are universal, like
     viewers). Codecs whose v1 `write` is a full encoder still need a port, not a contract.
2. **The host owns `write-source` at two points.**
   - _Activation narrowing:_ classes required only by operations — each `spec.operations[].
requiredPermissions` plus `write-source` for `mutatesSource` — are **degradable**: when the
     caller's grant lacks them the child grant simply lacks them, the activation carries
     `x3.host/permission-degraded` naming the classes, and the affected operations are disabled.
     Every other requested class the grant lacks stays a hard `x3.host/permission-denied`
     (`read-source` always; anything the variant needs to load or open).
   - _Invoke gating:_ `openSubject` wraps the session's `operations()`: before a call reaches the
     codec, the host checks the operation's required classes (from the selected manifest) against
     the **effective child grant**; a miss is `permission-missing` host-side. codec-kit sessions
     mirror the manifest's requested classes so the in-codec check never contradicts the host's.
3. **`common.edit/writer@1` becomes a standard contract of the platform**, not a foreign one: the
   SDK pins its method surface to `Writer` (`validate`, `plan`: `value` with `signal`; fields
   `identity`, `offer`), the host's standard surface set includes it, and the host registers a
   standard definition (offer/request facets required, matcher profile
   `org.modkitx/writer-facet-matcher@1`: equal `formatId`/`representationId`, offer `mutate`
   satisfies request `export-only`, offer `minimumRoundTrip` ≥ request on
   `byte-identical > semantic > lossy > none`, canonical non-secret selection key) under owner
   `org.modkitx/editing` whenever a bundled definition registry is created. Writers therefore
   resolve through `resolveServiceProvider` and cross the boundary worker-brokered like any
   provider (ADR-HOST-001 §3).
4. **File editing backend** (`@modkitx-x3/host/node` `createFileEditingBackend`): `file:` sources
   only, inside configured roots; revision vocabulary is S7's `provider-token:<dev>-<ino>-<size>-
<mtimeNs>`; `currentRevision` re-stats; `apply` is conditional (the live revision must equal
   `expectedRevision`) and writes a temp file in the same directory then renames over the target
   — atomic per file; byte-range and whole-source `replace`, `create` without overwrite,
   `delete`, `rename`; pre-images are kept per transaction so `rollback` restores; `applyBatch`
   is sequential. Capability: `guarantees ['atomic','recoverable','best-effort']`,
   `supportsPrepare/Rollback/Rename: true`, `supportsJournal: false` — `atomic` is honest for a
   single-edit plan, multi-edit plans are recoverable, never promised atomic.
5. **Product wiring** (`@modkitx-x3/host` `createSubjectEditing`): from an `OpenedSubject`
   derive the `AssetRevision` and the single `SubjectEditTarget` with the subject-open fingerprint
   rule (`canonicalJsonStringify({topology:'single', bindingId, source, revision})`), issue the
   host `GrantSnapshot` from the open grant (`sourceIds` = the subject's sources), build a
   `CommitCoordinator` over the caller's backends and evidence policy, and offer
   `planFromOperation(output)` (Path A) and a writer-backed `session` (Path B). codec-kit gains
   `editPlanFromInput` (same revision rule, so a codec's plan and the host's expectation agree
   byte for byte) and `defineWriter` for one-file writer providers.
6. **Fidelity evidence is host policy.** `evidenceFor` resolves against a host-registered list
   (first-party evidence ships with the proof that produced it); a plan without evidence is
   `fidelity-unproven`, never silently committed.

## Consequences

- Read-only opens are unchanged; a grant without `write-source` opens a codec with mutating
  operations and sees those operations disabled with an honest diagnostic.
- First-party codecs may now declare mutating operations; the first is PNG `edit.field`
  (set/replace a `tEXt` keyword) proven end to end: operation in a worker → plan across the
  boundary → file backend commit → reopen shows the chunk, every other byte identical; refused
  without `write-source`; refused as `stale-revision` when the file changed in between.
- Electron's `filesystem.write-file` shortcut is legacy: its renderer ports move onto the
  coordinator with a broker-backed `EditingBackend` in a separate slice; the PWA and VS Code
  hosts get editing only through this seam.
- The MK2 converter maps `write` → writer provider, `edit` → operations (OPUS-MK2-04); the
  `needs new contract` basket shrinks by what the contracts now cover, ports remain ports.

## Alternatives considered

- A new session arm `x3.abi/asset-writer@1` (`encode → bytes`). Rejected: duplicates the 13D
  writer contract and contradicts §2.6 (writer is a separate, versioned contract), and a session
  arm cannot be resolved by facet or replaced independently of the reader.
- Letting the codec write (`source.save` doing filesystem work inside the codec/worker).
  Rejected: no coordinator guarantees, filesystem authority inside the execution boundary, no
  revision check, no rollback.
- Keeping hard denial and splitting codecs into read and write variants. Rejected: doubles every
  manifest and the worker-brokered write variant would still need host-side gating.

## Evidence

- SDK: standard writer surface pinned to `Writer` and the editing surface table —
  `packages/sdk/src/editing.ts:479` (`WRITER_SURFACE`), `:481` (`STANDARD_EDITING_SURFACES`);
  the facet rule `writerOfferSatisfies` — `packages/sdk/src/editing.ts:497`; facet schemas
  `packages/sdk/schemas/writer-requirement.v1.schema.json`, `writer-offer.v1.schema.json`
  (`pnpm schemas:check` → 16 artifacts); the operation-scoped permission rule —
  `packages/sdk/src/manifest/operation-permissions.ts:23` (`operationScopedPermissionClasses`),
  `:36` (`activationRequiredPermissionClasses`).
- Host, standard definition + matcher: `packages/host/src/editing-definitions.ts:75`
  (`WRITER_FACET_MATCHER`), `:82` (`WRITER_CONTRACT_DEFINITION`), `:106`
  (`registerStandardEditingDefinitions`); wired into `createBundledServiceDefinitionRegistry` and
  `registerServiceDefinitionsOrThrow` (`packages/host/src/subject-services.ts`); the standard
  surface set includes the editing table — `packages/host/src/execution/surface-adapter.ts:155`.
- Host, permissions: offers carry activation requirements only —
  `packages/host/src/contribution-registry.ts:73`; gate hard-denies only non-operation classes and
  degrades the rest with `x3.host/permission-degraded` — `packages/host/src/security/gate.ts:426`,
  `:427`, `:453`; host-side dispatch gating against the effective grant —
  `packages/host/src/subject-open.ts:228` (`gatedOperations`); R5 re-activation only when the open
  grant is wider — `packages/host/src/subject-open.ts:378`; the degradation statement on the
  probe-realm path — `:910`.
- Host, backend and wiring: `packages/host/src/node/file-editing-backend.ts:241`
  (`createFileEditingBackend`), `:281` (temp + rename), `:329` (conditional write lost);
  `packages/host/src/subject-editing.ts:138` (`createSubjectEditing`), `:185`
  (`planFromOperation`); `packages/host/src/service-leases.ts:60` (`activateServiceProvider`,
  shared with `subject-open`), `:153` (`createHostServiceResolver`).
- codec-kit: `extensions/_shared/codec-kit/src/index.js:583` (honest `readOnly`), `:629`
  (`declaredPermissionClasses` — the session mirrors the manifest), `:665` (`editPlanFromInput`),
  `:711` (`defineWriter`).
- First mutating operation: `extensions/common/images/src/formats/png/codec.js:250`
  (`EDIT_FIELD_OPERATION`), `:293` (`setTextHandler`); manifest
  `extensions/common/images/contributions/codec-png.json:108` (`edit.field`, `mutatesSource: true`,
  both variants request `write-source`).
- Proofs: `pnpm exec vitest run packages/host/test/subject-editing.test.ts` (4) — Path A end to end
  worker-brokered with byte-identical splice and reopen, replace in place, degraded read-only open
  with host-side refusal, conflict / permission-missing / fidelity-unproven / foreign plan, Path B
  writer resolved by facet, leased across the boundary with `identity`/`offer` as handle data,
  writer session commit, unresolvable facet refused;
  `packages/host/test/file-editing-backend.test.ts` (3); `packages/host/test/editing-definitions.test.ts`
  (4); the existing 13D D-cases (`packages/host/test/editing.test.ts`), gate, subject-open, S7 and
  app suites unchanged and green; `pnpm check` green on the landing commit.
