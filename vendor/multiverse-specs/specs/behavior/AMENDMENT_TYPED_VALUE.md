# UVB typed `value` — proposed amendment

Status: **partial executable scalar profile; full amendment remains a proposal**. The versioned
UVB 2.0 structural schema, reference binary codec and static verifier have executable conformance
vectors. The verified compositor admits bool/i64/fixed64/strref and
`ref<entity/def/player/job/timer>` through `value.box/unbox/expect`, `result<T>`,
existing control flow and `scenario.var/set-var@1` against a verified UVS chart.
Each reference spelling denotes one concrete kind, not a union or implicit cast.
Initial definition/player identities must exist in the fresh composition. Initial
entity/job/timer identities refuse before provider-open because none are allocated yet.
UVS 1.5 additionally admits boxed `ref<entity>?`, initially absent. This is an
explicit optional type, not a null handle in a nonnullable domain or inferred
source-language global initialization.
The read-only `query.def@1` executable slice looks up canonical receipt-resolved UVD
addresses and returns `ref<def>?`. `option.unwrap-or-branch` makes absence an explicit
UVB 2 control-flow edge. The same composition binds those addresses and field names;
`query.def-field@1` then returns boxed bool/i64/fixed64/strref from immutable
resolved UVD defaults. The current string slice binds UVD `string` fields to
`strref` with a 1024-byte UTF-8 value limit in private MVBC16; field identity
and value share the receipt-bound definition table. The separate read-only
`query.def-flag@1(ref<def>, strref field, strref key) -> bool` admits an
effective named UVD `flags` entry through private MVBC17. Only declared,
present boolean keys are bound; an absent field or key is `invalid-reference`,
never an inferred `false`. The flag table is included in composition/save
identity and does not create a second game catalog. UVD `enum`, whole `flags`
values, list and record values remain outside the generic boxed query profile.
The Luau compiler's `mv.query.stringOr(address, field, fallback)` composes
receipt-bound `query.def`, explicit nullable-def branching, `query.def-field`,
checked `value.unbox` and `result.value-or`. A missing definition or a
non-string field chooses the caller's fallback; a missing field on an existing
definition remains a typed `invalid-reference` refusal. The fallback expression
is evaluated only on those two branches; a successful field read does not
consume RNG or invoke a fallback helper. No native game
catalog or player-specific rule is inferred by this common operation.
The same nullable definition lookup is directly available to source functions as
`mv.query.def(address: StrRef): OptionalDefRef`. `OptionalDefRef` is the existing
`ref<def>?` register type, not a boxed `value`. `mv.option.hasDef(value)` checks
presence and `mv.option.defOr(value, fallback)` selects a `DefRef`, evaluating
fallback only on absence. The shared emitter copies the optional register before
the consuming unwrap, preserving ordinary source-variable reuse. Parameters,
local assignments and returns preserve that exact type; implicit `DefRef` casts,
nil/zero constructors and UVS State bindings still refuse. No wire opcode, registry
signature, canonical value encoding or WASM ABI changes for these source APIs.
Luau `mv.query.flagOr(address, field, key, fallback)` composes the same
receipt-bound definition lookup with `query.def-flag@1`. Its boolean fallback
applies only when the definition address is absent. A present definition with
an absent field or key still refuses as `invalid-reference`; the compiler
does not manufacture a false flag or a native game lookup. The absent-definition
branch evaluates its fallback only then. Verified query modules may also require
`rng.roll@1` or `rng.roll-fixed@1` with the separate `mutate` grant; this permits
deterministic fallback helpers without granting mutation to a read-only query.
Luau `mv.scenario.boolOr/i64Or/fixedOr/stringOr(id, fallback)` and
`entityOr/defOr/playerOr/jobOr/timerOr(id, fallback)` read a verified
UVS value through the same `scenario.var@1` State. They unbox the declared
type and evaluates the caller's fallback only on a type mismatch; an unknown
variable ID is an `invalid-reference` error, not an inferred initial value.
Mutation and save/restore of the variable are visible to subsequent Luau reads.
Luau `mv.scenario.requireBool/requireI64/requireFixed/requireString(id)` and
`requireEntity/requireDef/requirePlayer/requireJob/requireTimer(id)` use the
same verified `scenario.var@1` and `value.expect` in UVB 2. They require an exact
declared concrete type: a mismatch raises `type-mismatch`, an unknown ID raises
`invalid-reference`, and the current execution rolls back. This strict path is
for source languages whose variable read has no fallback.
Luau `mv.scenario.setBool/setI64/setFixed/setString(id, value)` and
`setEntity/setDef/setPlayer/setJob/setTimer(id, value)` box the source type
and call the same verified `scenario.set-var@1`; their `ResultBool` must be
returned or explicitly handled by `mv.try`/`mv.result.valueOrFalse`.
Unknown IDs and mismatched declared types return typed errors without changing
State. Bounded UVS reactions use this same codec/emitter, as specified in SPEC_UVS §3–5.
Mutation of an entity does not change a definition query. UVD `enum`, whole
`flags` values, references, list/record fields, and player-scoped or dynamic game catalog reads
remain unimplemented.
Rust VM, public worker and Node/Chrome parity exercise that subset in one State.
Other UVB 2 intrinsics and other list/record boxing still refuse before
execution. UVB 1.1 binary, identity digests and
the published registry remain unchanged. The executable `uvs-uvb-verifier` vectors currently
require a typed `unrepresentable-value` refusal whenever UVB 1.1 binds an intrinsic or event
with the generic `value` signature. This includes `query.def-field`, `scenario.var`,
`scenario.set-var`, `scenario.send-message` and `scenario.message`. A declared registry name
alone never makes that operation executable.

## Decision to implement

Use a **UVB major 2** profile for first-class, deterministic `value`. A minor revision cannot
silently add executable semantics to UVB 1.1: its closed opcode set and canonical binary are
frozen, and an old reader cannot ignore an unknown instruction and still execute a function.
Composition must negotiate the UVB major before the first tick. A UVB 1.1 module continues to
verify and hash exactly as before; no automatic rewrite changes its identity.

`value` is a closed, tagged sum of admitted UVB types, not an arbitrary JSON object or a host
language value. The initial members are `bool`, `i64`, `fixed64`, `strref`, `ref<K>`,
`list<T>` and nominal record `R`. `T`, `K` and `R` must resolve in the module's type environment.
`result<T>` remains a control-flow value with an explicit handling obligation and cannot be
stored inside `value`. A `value` records both its concrete type identity and payload. Box and
checked-unbox are new UVB 2 instructions. Unbox returns `result<T>` (typed mismatch, never a
coercion); scripts cannot inspect or mutate the opaque payload through host APIs. Structural
list/record operations run only after a successful unbox.

The module carries a canonical type table (including nominal record fields) under its identity
digest. Two structurally equal records with different nominal names remain different types.
Binary 2.0 retains the UVB envelope and section ordering, changes the two version bytes to
`02 00`, and appends one `u8` per section-4 record field after its name and type: `00` means
required, `01` means optional, all other values refuse. It appends `value.box` and
`value.unbox` to the version-2-only opcode table; both carry `dst`, `a`, and concrete `type`.
The reference verifier requires the source type to match the box type, the unbox source to be
`value`, and the unbox destination to be `result<T>` with explicit handling. These opcodes
have runtime semantics for bool/i64/fixed64/strref and the five concrete reference kinds. The versioned
table must encode record-field optionality and value presence. UVB 1.1 stores only
field name/type, so registry records such as `Filter` and `OrderInfo` cannot be admitted through
that binary even when their names and required field types match. Absent optional fields are
distinct from a present default value; the VM and canonical State encoding must preserve that
distinction across calls, snapshots and restore.

The proposed structural verifier now accepts concrete `list<Filter>` and nested lists, with a
maximum of 16 list/result type layers and 128 characters per type spelling. It refuses
`list<value>`, nested `result<T>`, malformed brackets and deeper types before composition.
This is a static bound only; it does not admit UVB 2 execution or establish the still-pending
runtime value byte, element-count and State section budgets.
Lists preserve element order; records serialize in declaration order; references use typed,
stable handles; fixed64 uses Q32.32. String content is validated UTF-8, bounded, and interned
by composition identity. No float, NaN, prototype, function, or cyclic object enters State.
The verifier bounds type nesting and value byte length before composition; the kernel enforces
the same budgets on every runtime write and restore. Bad tags, unknown types, dangling handles,
or noncanonical ordering refuse without partial mutation.

Registry `value` signatures then mean a UVB 2 existential value. The compiler must emit the
box/unbox sites and source mapping explicitly. The fact that a Data field has a type in UVD
does not permit the compiler to guess or coerce at runtime: its resolved UVD type and nominal
identity must be part of the composition receipt. UVS chart variables have declared concrete
types; initializers and `set-var` expressions must type-check against them. A callback event
payload is a typed value with its event signature in the receipt. All persistent variables,
timers, pending reactions and payloads belong to versioned scenario State sections and its
canonical hash. No second game-specific variable store is admitted.

## Proposed canonical State value bytes

[`../tools/uv-value.mjs`](../tools/uv-value.mjs) is the browser-portable reference codec;
`../tools/uv-value.test.mjs` pins scalar bytes, nominal identity, list order, optional
presence and malformed refusals. The bounded value subset is admitted; scenario State holds
verified UVS initializers and executes `scenario.var/set-var` for bool/i64/fixed64/strref
and concrete reference variables. Definition/player references must belong to the captured
composition; entity/job/timer identities must already have been allocated in State. Retaining
an allocated identity does not revive an expired timer or completed job; active-object
intrinsics check their own lifecycle. Nullable references, authored-address binding,
source global initialization and full list/record values remain open.
`../../runtime/kernel/src/typed_value.rs` independently encodes/decodes the same pinned
bytes in Rust; its integration tests use the reference hex vectors. It is deliberately
separate from the existing UVD entity-field `state::Value` wire, which remains frozen.
The blob is versioned by its containing scenario State section and the verified UVB major;
it has no second host-language serialization or independent game schema.

One complete value is `u8 tag | u32 typeByteLength | ASCII concrete type spelling |
payload`, little-endian. Tags are `0 bool`, `1 i64`, `2 fixed64`, `3 strref`,
`4 ref<K>`, `5 list<T>`, `6 nominal record R`, `7 ref<K>?`; the type spelling must resolve in the
verified module/registry type table and agree with the tag. `value` and `result<T>`
are not concrete stored types. A primitive payload is bool `u8 0/1`, signed LE64
for i64/fixed64, a length-prefixed UTF-8 string for strref, or nonzero unsigned
LE64 for a typed ref. In-memory string interning does not alter these bytes;
composition must verify a strref against its immutable string table and a ref against
its typed handle domain before a State write or restore.

An optional reference payload is `u8 presence` followed, only when presence is 1,
by nonzero unsigned LE64. Only 0 and 1 are valid markers; absence has no ID bytes.
For `ref<entity>?`, None is
`070c0000007265663c656e746974793e3f00`, and Some(1) is
`070c0000007265663c656e746974793e3f010100000000000000`.
Old tags 0–6 and their bytes remain unchanged. The generic canonical codec supports
concrete optional reference kinds; executable boxing and UVS State currently admit
only `ref<entity>?`. `ref<def>?` remains the unboxed definition-query profile.

UVB 2 appends `option.none dst,type` (opcode 40, flags 17) and
`option.some dst,a,type` (opcode 41, flags 19). `type` denotes the nonnullable
reference kind. None writes `ref<K>?`; Some requires an initialized `ref<K>` in
`a`, leaves it intact and writes the matching optional type. Executable constructors
admit entity and definition references. Contextual Luau `nil` constructs None;
`mv.option.entity`/`mv.option.def` construct Some. `eq` accepts two optional
references of exactly the same kind and compares presence/identity; ordering refuses.
The existing consuming `option.unwrap-or-branch` handles both admitted kinds.
The compiler unwraps a temporary so reuse of a source variable remains valid.
Neither constructors nor equality add an intrinsic signature or a second store.
UVB 1.1 has none of these new operations; its pinned opcode table stays frozen.

UVB 2 appends `result.expect dst,a` (opcode 42, flags 3). `a` must contain an
initialized `result<T>` and is consumed on successful unwrap; `dst` becomes
`T`. A result error ends execution as `behavior-result-failed` and rolls back
the whole invocation. No fallback value is produced. Executable payload types
are the same concrete types admitted by the existing result unwrap operation.
The shared Luau frontend exposes explicit `mv.require(result)` and uses this
checked operation for writable UVS source aliases inside non-Result functions.
ResultBool function assignments continue to use explicit error propagation;
readonly bindings still refuse. No intrinsic signature, State or interpreter
is added. The UVB 1.1 opcode table and pinned fixture bytes stay unchanged.

A list payload is `u32 count` followed by elements in order, each encoded by its
declared concrete element type without a repeated type header. A nominal record
payload follows its declaration's field order. A required field has its payload;
an optional field has a `u8 0/1` presence marker and a payload only when present.
Absent and present-with-default are different bytes. Two equal-shaped records with
different nominal names are different values because the outer type spelling differs;
the declaration itself belongs to the verified module identity.

The reference codec refuses values over 1 MiB, strings over 1024 UTF-8 bytes,
type spellings over 128 ASCII bytes, more than 65,536 recursive nodes/list elements,
nesting deeper than 16 and records with more than 256 fields. Its JSON-facing
projection requires canonical decimal strings for exact i64/fixed64/ref values;
these are only a host projection of the fixed-width binary. Floats, zero refs,
invalid UTF-8, unknown/duplicate fields, accessors, custom-prototype records,
bad tags/presence markers and trailing bytes refuse. The Rust kernel must independently
enforce the same limits and canonical re-encoding before this proposal becomes an
executable profile. Existing UVD primitive `Value`/MVRS section bytes do not change.

## Admission sequence

1. Pin new UVB 2 structural schema and binary vectors; preserve every UVB 1.1 vector byte
   and digest. Pin recursive type/value limits and exact canonical bytes before implementation.
2. Extend the **existing** UVB binary codec and verifier, then implement the same type tags in
   the single Rust kernel. Validate positive and negative vectors for all admitted members,
   nominal mismatch, list nesting, result handling, overflow and malformed bytes.
3. Add registry negotiation and static effects/types checks. A UVB 1.1 caller of a generic
   signature must continue to receive `unrepresentable-value`.
4. Compile one typed SC2 Data field read and one UVS variable/message round-trip through the
   public Modkit content route. Run identical UVB 2 bytes in Node and browser; compare event
   journal, save/restore continuation and state hashes. Repeat with a Warzone JS source value.

Until these checks pass, the complete typed `value` profile remains a proposal. The working
Rust foundation admits the bounded scalar/reference UVB 2 subset and verified UVS reactions alongside UVB 1.1; private
`MVBC`/`MVRS` framing is not UVB 2 and is not a universal save format.
