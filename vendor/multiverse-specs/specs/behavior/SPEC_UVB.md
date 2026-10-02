# SPEC — UVB: Universal Behavior bytecode 1.0

Status: **candidate**. Admission to `registered` requires the canonical binary encoding
frozen, the verifier and interpreter executing `../conformance/uvs-uvb/vectors.json`,
and one function lowered from each frontend (galaxy→luau→uvb, js→luau→uvb, luau→uvb)
producing identical journals on Node and browser hosts of the same wasm kernel.
Generic `value` in the intrinsic/event registries is outside UVB 1.1's representable types;
the verifier refuses such bindings. See the proposed, unadmitted
[`typed value amendment`](AMENDMENT_TYPED_VALUE.md). Its UVB 2.0 schema, reference binary
and static verifier vectors cover checked box/unbox and optional record declarations.
The foundation admits bool/i64/fixed64/strref and the five concrete non-null reference
kinds, `list<ref<entity>>` and `ref<entity>?` through canonical boxed values and
scenario State. Other list/record/optional boxed values and full native-game
execution remain outside that executable subset.
Normative artifacts: [`schema/uvb.module.v1.schema.json`](schema/uvb.module.v1.schema.json)
(the structural form both the binary and the `.uvbt` text projection encode), fixture
under [`fixtures/`](fixtures/), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian):
`../../design/DRAFT_SPEC_UVB.md`, ADR-RUNTIME-001/002.
The pinned `uvb-module-minimal` fixture proves binary layout only: it reads uninitialized
registers and is refused by the verifier. `uvb-module-verified` is the positive verifier
fixture. The verifier checks path-sensitive types for the admitted core instructions, call
signatures, declared effects of internal/intrinsic calls and `result<T>` obligations. It refuses
instructions whose operand rules are still unspecified. It refuses recursive internal calls and
checks an explicit composition call-depth ceiling. Full opcode typing and VM execution remain
admission work.

## 1. What UVB is

The only executable format of the kernel: a register bytecode with a closed op set.
Float operations do not exist in the format — determinism by construction, not review.
The hash is computed from the canonical binary only; the text projection is derived and
bijective.

## 2. Module contract

A module declares its interned strings, its versioned intrinsic requirements (checked
against the table and granted capabilities at composition), and functions with typed
params/returns, a register budget, declared effect areas and a body of instructions.
`result<T>` returns make errors values; discarding one fails verification.
`result.unwrap-or-branch a,dst,target` consumes `a` and writes the `T` payload to `dst`
only on the success fallthrough. On error it jumps to `target` with the original
`result<T>` still in `a`; `dst` is untouched. The error path must return that result
or explicitly handle it. The currently admitted core can propagate it with `ret`;
additional error handlers need their own typed rule. UVB 1.1 has no implicit error
swallowing or exception path.
UVB 2.0 adds `result.value-or-false dst,a` for `result<bool>` only. It consumes
the result on every path: `Ok(value)` writes `value`, `Err(_)` writes `false`.
This explicit lossy conversion is suitable when a source language exposes only
a boolean acceptance result. It does not alter UVB 1.1 bytes or implicitly
discard errors in other instructions.
UVB 2.0 `result.expect dst,a` explicitly consumes `result<T>`: `Ok(value)`
writes `T` to `dst`, including `Ok(false)`; `Err(_)` terminates the invocation
with typed VM failure `behavior-result-failed`. It has no success substitute
or error branch. The invocation's existing transactional boundary rolls back
all prior effects, including nested calls, allocations, RNG and queued events.
An ordinary returned `Result` and `result.unwrap-or-branch` retain their value/
propagation semantics; neither becomes an implicit exception.
The executable UVB 2.0 entity-list profile admits `list.empty dst,type` only
with `type: ref<entity>`, plus the existing `list.append dst,a,b`, `list.len`
and `list.get` opcodes for `list<ref<entity>>`. Append produces a new ordered
list; get uses a zero-based index and refuses an out-of-range access. Lists
contain at most 1024 references. The VM keeps them as transient values, not
separate entities in State; stateful creation inside one UVB call remains atomic.

UVB 2.0 `pos.make dst,type,args` requires `type: Pos` and four registers in
order `strref space, fixed64 x, fixed64 y, fixed64 z`. It constructs a pure
`Pos` value without reading world state. The nominal `Pos` declaration is
required; operations that consume a position validate the space against the
verified composition. Game adapters that turn source object IDs into positions
must resolve those IDs against verified UVW; literal or computed coordinates
retain their source-language semantics.

UVB 2.0 `option.none dst,type` and `option.some dst,a,type` construct explicitly
typed nullable references. Their canonical appended opcodes, operand rules and
admitted entity/definition subset are specified in AMENDMENT_TYPED_VALUE. A
nullable entity can be boxed into the same State value as UVS 1.5; Some identities
must already be allocated. Optional equality requires matching reference kinds,
compares presence/identity and never equates absence with an integer zero.

## 2a. Canonical binary encoding (binary 1.1, frozen 2026-09-01)

Reference codec: [`../tools/uvb-binary.mjs`](../tools/uvb-binary.mjs); executable
vectors: `../conformance/uvb-binary/vectors.json`, which pin the identity digest of the
fixture — **the freeze**: a layout change that alters a pinned digest is a new binary
version, never a fix.

- Layout: magic `UVB\0`, u8 major/minor, then sections in fixed order (namespace,
  requires, strings, optional types, functions, optional source map), each `u8 id | u32 length |
  payload`; all integers little-endian; strings length-prefixed UTF-8.
- Instructions: `u8 opcode` from the closed op table, `u16 field flags`, then present
  fields in fixed order. There is no opcode for a float operation: the encoder cannot
  express one, so "no floats" is enforced by construction at the byte level.
- **Identity digest** = sha256 over every section except the source map. Debug
  provenance may be added or stripped without changing what a module is; the bytes
  differ, the identity does not.
- **Text projection `.uvbt`** = canonical-form JSON of the structural module
  (uv-canonical). Binary↔text bijection is therefore binary↔canonical JSON; no second
  grammar exists to drift. An empty `strings` section is canonically absent.
- `$comment` is not part of the text projection or the binary; it is stripped before
  canonicalisation, so a schema-valid module with a comment and one without are one module.
- Version history: 1.0 was re-pinned as 1.1 the same day it was frozen, before any consumer
  existed, to add the `types` section (nominal records — without it 16 of 58 intrinsics were
  unreachable from bytecode). The 1.0 digest is void.
- i64 constants outside the safe integer range are written as decimal strings in the
  structural form and decode back the same way. Signed i64 bounds are checked before
  encoding; JavaScript numbers outside the safe integer range and decimal strings inside
  that range are refused, so distinct structural constants cannot collapse to one binary.
  The structural verifier and binary encoder apply the same portable constant rule.
- Binary 1.1 record declarations encode each field's name and type, **not optionality**.
  Registry records with optional fields (`Filter`, `OrderInfo`) cannot be represented faithfully
  by this type section and refuse verification. Their presence semantics require a versioned
  type-table amendment; this does not alter frozen 1.1 bytes.
- Binary 2.0 uses version bytes `02 00`, appends one 0/1 optionality byte per
  record field, and appends `value.box`/`value.unbox`,
  `result.value-or-false`, `list.empty`, `option.unwrap-or-branch`, and
  `fixed.parse-decimal`, `result.value-or`, `pos.make`, and `value.expect`
  to its own opcode table. `option.unwrap-or-branch a,dst,target` takes
  `ref<K>?`; the fall-through writes `ref<K>` to `dst`, while the missing
  branch writes nothing. The current kernel admits `K=def` only. Its
  positive and negative binary/verifier vectors check static representability, including
  the `scenario.var` and `scenario.set-var` generic signatures. Optional **value
  presence** in State remains a separate contract.

The shared Luau frontend names the existing `ref<def>?` register type
`OptionalDefRef`. `mv.query.def(address: StrRef)` uses the canonical
`query.def@1` signature. `mv.option.hasDef(value)` returns presence as a boolean;
`mv.option.defOr(value, fallback)` returns the present `DefRef` or evaluates its
fallback only on absence. Both lower to the existing option branch. Unwrap uses
a temporary register so that the source variable remains reusable. This type is
admitted in function parameters, returns and locals, never as a boxed UVS State
value. No nil/zero literal, implicit conversion or native initializer is inferred.

`fixed.parse-decimal dst,a` is a UVB 2 pure conversion from `strref` to Q32.32
`fixed64`. The decimal grammar, 256-byte input bound, 128 significant-digit bound,
absolute exponent bound 256, and half-even rounding follow the reference decimal
quantizer in [`../tools/uv-fixed-point.mjs`](../tools/uv-fixed-point.mjs). Invalid
syntax reports `invalid-fixed-decimal`, a bound violation reports `budget-exceeded`,
and a rounded quantum outside signed i64 reports `fx-overflow`. It never uses
floating-point arithmetic or changes State. A game's native string-conversion
rules remain the responsibility of its lowering adapter.

The shared AST-backed Luau compiler also admits `mv.fixed.fromQuantum("<signed-i64>")`
as a compile-time fixed64 constant. The string must be the canonical decimal spelling
of a signed Q32.32 quantum. This is source notation for the existing `const fixed64`
instruction, not a new runtime conversion; adapters may use it when a verified world
projection has already produced an exact quantum.

`result.value-or dst,a,b` consumes `a: result<T>` and chooses its successful
concrete value or the explicit fallback `b: T`, writing `dst: T`. The admitted
UVB 2 types are bool, i64, fixed64, strref and ref<entity/def/player/job/timer>.
Each ref spelling denotes a separate concrete kind. The fallback is a caller
decision; an error cannot be silently discarded or coerced to an implicit
default. This instruction does not change State.

`value.expect dst,a,type` reads a boxed `value`, requires exactly the declared
concrete type (the same nine types as `result.value-or`), and writes that value to
`dst`. A mismatch raises `type-mismatch` and rolls back the current execution.
Unlike `value.unbox`, it does not produce a recoverable result; use it only when
the source language requires a declared variable type without a fallback.

## 2b. Arithmetic (normative)

All `*.i64` and `*.fx` operations follow [`../foundation/SPEC_UV_FIXED_POINT.md`](../foundation/SPEC_UV_FIXED_POINT.md):
fixed64 is Q32.32; `mul.fx`/`div.fx` use a 128-bit intermediate; overflow and division by
zero are typed runtime errors (`fx-overflow`, `fx-div-by-zero`, `i64-overflow`,
`i64-div-by-zero`) — never wrapping, never saturation, never undefined behaviour. Saturating
variants, if ever wanted, are new opcodes. Two conforming interpreters therefore cannot
disagree on the first overflow.

## 3. Verification (before the first tick, all mandatory)

1. Every register is typed on every path; call signatures match.
2. Every intrinsic reference resolves at the declared version with granted capability.
3. Every loop carries its budget check (schema-level already); call depth is bounded;
   the per-tick instruction budget is a composition parameter.
4. The union of called intrinsics' effects stays inside the function's declaration.
5. No `result<T>` is discarded.

`loop` is an iteration header, not a conditional branch. Its `target` names the first
instruction after the loop body and must point forward inside the function. Execution
falls through to the body; a separate `br_if` or `br` exits to `target`. Every backward
`br`/`br_if` must target a `loop` header whose exit lies after that branch. Entering
the header charges the same shared instruction fuel as any other instruction; exhausted
fuel raises a typed `budget-exceeded` error and the enclosing State transaction rolls
back. The mandatory `budget.onExhausted = typed-error` records that policy in UVB.

An invalid module refuses composition naming function, instruction and — via the
optional source map — the Luau projection line.
The current reference verifier checks definite initialization, path-sensitive types for
`const`/`move`, calls, return, branches, arithmetic, comparisons, boolean logic, list reads and
result handling. It refuses unadmitted operand rules such as `list.set`, `record.set` and
`result.err`; recursive calls refuse until the VM has bounded call frames. Acyclic internal
calls have a statically computed longest path, optionally capped by `maxCallDepth`. The
admitted Rust foundation VM executes acyclic calls and structured `loop` headers with
shared instruction fuel. This is an instruction-budgeted foundation operation, not a
Galaxy/Luau loop lowering or a complete callback scheduler.
