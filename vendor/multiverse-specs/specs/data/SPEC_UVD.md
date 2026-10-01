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
12. **Nested identities and references.** `${self}` substitution and typed-reference checks
    recurse through every declared list/record level, including references inside lists in
    records. A missing or wrong-kind target uses the same refusal/diagnostic policy as a
    top-level reference. Paths such as `assembly.slots[0].allowed[0]` identify the failing value.
    This enables UVD to describe composite loadouts without a second reference resolver; it
    does not by itself admit list/record gameplay values into the current scalar Runtime binding.

## 6. Assembly role amendment (candidate, 2026-09-25)

A top-level kind field may declare `runtimeRole: "assembly.slots@1"`,
`"assembly.initial-parts@1"`, or `"assembly.stat-effects@1"`. This annotation is part of the **same UVD kind-schema** and
does not create a second catalog. It identifies meaning by field role, not by game kind or
native field name. Each role occurs at most once per kind. An initial-parts field requires a
slots field on that kind. Both are gameplay fields; `presentation: true` is forbidden.

`assembly.slots@1` is a `list<record>` with exactly three required record fields:
`id: string`, `capacity: i64`, `accepts: list<ref>`. `assembly.initial-parts@1` is a
`list<record>` with exactly `id: string`, `slot: string`, `definition: ref`. Both reference
fields declare `refKind` and use ordinary UVD reference checking. Missing role fields mean
empty lists. IDs are non-empty, at most 128 UTF-8 bytes and contain no NUL; slot and part IDs
are unique within an effective definition. Capacity is an exact integer from 0 to 4096;
each effective definition has at most 4096 slots and 4096 initial parts. A part may repeat a
definition address but not an instance ID. Every initial part names an existing slot, an
explicitly accepted definition, and consumes one capacity. Duplicate accepted references,
absent accepted definitions even under `danglingReferences: diagnose`, and over-capacity
loadouts refuse the whole composition. The canonical resolver returns an `assemblies` view
alongside resolved definitions and provenance; Runtime binding must consume that view.

`assembly.stat-effects@1` is a `list<record>` on a part kind, with exactly required
`id: string`, `field: string`, and `delta: fixed64`. IDs are stable and unique within the
effective part definition; a delta is an exact signed Q32.32 quantum within i64 range.
For every assembly slot accepting the part, the target field must exist as a fixed64
field with an effective value on that assembled definition. The resolver returns the
effects beside `assemblies`; the binder maps target names to the same numeric field IDs
as scalar UVD. Every installed part instance contributes its own delta. Effective values
sum base, authored/script modifier sources, and live part instances in i128, then check
the i64 range once. Removing/replacing a part recomputes from remaining sources; no
rounded total is reversed. Part effect values are immutable composition, while saved
State carries the part instance IDs that determine which effects are live.

Initial assembly, atomic part transitions and fixed64 part effects are executable in the
bounded Runtime profile. Weapon grants, independent weapon state, timed jobs, resource
policy and visual attachment authority remain RT-02A/M1B work. UVM sockets describe
presentation and do not determine gameplay compatibility.

### Capability grant admission (candidate, 2026-09-26)

The same UVD kind-schema also admits `assembly.grants@1` on a part definition as
`list<record{id:string, capability:ref}>` and `capability.counters@1` on a capability
definition as `list<record{id:string, initial:i64, minimum:i64, maximum:i64}>`. The
resolver requires unique stable IDs, existing typed capability references, exact signed
i64 values, `minimum ≤ initial ≤ maximum`, and at most 4096 entries per definition.
Repeated part definitions share immutable grant templates but their installed instances
will have distinct live identities `(part instance ID, grant ID)`. Counter names can
represent ammo or a next-ready tick without baking either game's weapon class into UVD.

The verified Runtime binder carries these resolved roles in MVBC8. Rust State keys live
counters by `(part instance ID, grant ID)`; a new part initializes from verified UVD,
removal deletes only that part's grants, and unchanged instances retain their values.
Entities section v5 and the binding digest include the corresponding mutable and immutable
halves. This bounded profile does not define firing, damage, automatic cooldown advancement
or game-specific ammunition policy; those require later combat rules and native lowering.

## 7. Movement identity roles (candidate, 2026-09-28)

The same kind-schema may declare one `movement.class@1` string field and one
`movement.speed@1` fixed64 field with `unit: "space-unit-per-tick"`. Both roles must be
declared together; each effective definition either sets both or neither. The class is a
stable UVW traversal class ID (1–128 UTF-8 bytes, no NUL). Speed is an exact positive signed
Q32.32 quantum in the current space's local units per simulation tick. A game adapter must
convert its native speed and tick scale before publishing UVD; Runtime does not infer them
from a native field name or wall-clock rate. Definitions without both values are immobile.

The canonical UVD resolver validates the pair and returns one `movements` view alongside
resolved definitions. The binder verifies the class against the same verified UVW world,
keeps speed as a normal fixed64 state field so source-keyed modifiers can change it, and
binds only the class and speed field ID into composition. This is admission metadata for
`order.move@1`, not a claim that the current kernel already moves entities. Dynamic
movement-class changes, space transitions, collision shapes and non-heightfield movement
require later explicit mechanics profiles, never fallback to a guessed class or speed.
