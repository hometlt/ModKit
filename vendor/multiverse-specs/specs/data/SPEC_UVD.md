# SPEC — UVD: Universal Definitions 1.0

Status: **candidate**. Admission to `registered` requires the real-corpus vectors of
`../conformance/uvd/vectors.json` (`admission/real-corpus`): an SC2 catalog slice and a
Warzone table slice converted, reopened losslessly and matched against Modkit's resolved
value chains. Normative artifacts: [`schema/uvd.document.v1.schema.json`](schema/uvd.document.v1.schema.json),
fixtures under [`fixtures/`](fixtures/), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian):
`../../design/DRAFT_SPEC_UVD.md`.

## 1. What UVD is

The terminal declarative form of game data: units, weapons, abilities, effects,
resources, technologies. The engine reads UVD directly; definitions never compile to
UVB. Canonical readable JSON under the UV canonical form: same data, same hash.

## 2. Three document roles

`kind-schema` declares the typed fields of definition kinds (the self-describing
layer); `definitions` ships full definitions with single inheritance via `parent`;
`overlay` ships partial edits (`set` / `remove` / `append`) applied at the document's
package layer. One document plays exactly one role.

## 3. Type discipline

Value types are the ADR-RUNTIME-001 set. `fixed64` serialises as integer quanta.
`f64` exists solely for `presentation: true` fields, which never reach gameplay state
or the state hash — a double cannot leak into determinism by construction.

## 4. Resolution contract (normative, executable with the composition tool)

1. Effective value = nearest setting layer, else nearest ancestor; every effective
   value carries provenance (layer, document). Modkit and the engine must show the
   same chain.
2. Parent cycles, references to missing definitions, fields the kind-schema does not
   declare, and overlays removing required fields refuse by name at composition.
3. Vendor fields with no shared meaning keep their own namespaced kinds and lose
   nothing.
4. A `remove` overlay on an ancestor is inherited as absence by descendants that do not set
   the field themselves; `append` on such a descendant starts from an empty list.
5. `kindVersion` of a definition must equal the version its kind-schema declares
   (`kind-version-mismatch`); a later layer redefining a kind refuses (`duplicate-kind`) —
   kind-schema extension by mods is a future amendment, not an accident.
6. `append` targets list fields only (`append-to-non-list`).

## 5. Amendment 1.1 (2026-09-01, from real-corpus admission)

The SC2 and Warzone admission (`../../admission/uvd-real-corpus/REPORT.md`) matched Warzone
211/211 and SC2 353/374 with every disagreement explained by three gaps. This amendment
closes them; the schema stays 1.0-compatible (every 1.0 document is a valid 1.1 document).

1. **Append inheritance.** A list field may declare `inherit: append`: the effective list is
   every ancestor's own list in root-to-leaf order followed by the own list (SC2
   `AbilArray`/`BehaviorArray`). A tombstone in the chain restarts the list. An overlay
   `append` on such a field extends the own tail only. Default stays `replace`.
2. **Late-bound identity.** String, strref and **ref** values (lists of them, and such
   fields inside records) may carry the token `${self}`, replaced at resolution by the
   local name of the definition being resolved — the leaf, exactly as SC2 binds `##id##`.
   Binding happens before reference checking, so a template's `effect = ${self}-damage`
   is a typed reference on every descendant. Provenance still names the setter. Note the
   token binds to the UVD local name (slug space): an adapter translates `##id##Damage`
   to `${self}-damage`, and the admission proved the slug mapping holds on all 18 rows.
3. **Type discipline is executable.** Every own and overlay value is checked against its
   field spec (`type-mismatch`): fixed64/i64 accept integer quanta only, enums their
   declared values, records their declared fields. A converter cannot pick its own scale
   unnoticed.
4. **References inside lists and records** are checked by the same rule as scalars.
5. **Policies instead of one strictness.** Resolution accepts `danglingReferences:
   refuse|diagnose` and `externalParents: refuse|truncate`; the defaults refuse, and the
   diagnose/truncate modes keep the value or the chain and return named diagnostics —
   what real shipped catalogs (which contain dead links and base-game parents) need. A
   LoweringReceipt records which policy an adapter used.
6. **Polymorphic references.** `refKind` may name a closed set of kinds (`["weapon", "unit"]`);
   the verifier checks the target's kind against the set (`reference-kind-mismatch`) — an
   existing definition of the wrong kind is refused by name. SC2 `Effect` links, which may
   name several effect kinds, become typed references instead of strings.
7. **Keyed merge.** A list of records may declare `inherit: merge` with a `keyField`: the
   effective list is the root-to-leaf merge by key — a later record with the same key replaces
   the earlier one, new keys append — and an overlay `append` upserts by key. This is the SC2
   indexed-array semantics (`CostResource index="Minerals"`, `Attributes index="Light"`): a
   descendant or a mod patches one element without restating the list.
8. **Flag sets.** The type `flags` is a closed set of named booleans (`values`), carried as an
   object keyed by the declared names; it merges by name root-to-leaf and an overlay `set`
   with a partial object patches named flags (SC2 `FlagArray`, `Attributes`, `Collide`).
   Undeclared names refuse (`type-mismatch`).
9. **Verbatim enum tokens.** Enum and flag `values` are the source's own tokens
   (`SUPER HEAVY`, `Half-Tracked`), not slugs: a UVD document mirrors its catalog exactly and
   reverse conversion needs no external table.
10. **Upsert documents.** A `definitions` document may declare `upsert: true`: a definition whose
    full id already exists in an earlier layer replaces that record's own fields. The kind is
    part of the full id, so re-publishing a name under another kind is a different definition,
    never a conflict. A later archive that re-publishes whole records (Warzone `mp.wz` over
    `base.wz`) maps one source table to one UVD document.
11. **Nested records.** `recordFields` recurse: a record field may itself be a record or a
    list of records (Warzone `propulsionExtraModels`); type discipline recurses with it.
