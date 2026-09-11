# SPEC — UVB: Universal Behavior bytecode 1.0

Status: **candidate**. Admission to `registered` requires the canonical binary encoding
frozen, the verifier and interpreter executing `../conformance/uvs-uvb/vectors.json`,
and one function lowered from each frontend (galaxy→luau→uvb, js→luau→uvb, luau→uvb)
producing identical journals on Node and browser hosts of the same wasm kernel.
Normative artifacts: [`schema/uvb.module.v1.schema.json`](schema/uvb.module.v1.schema.json)
(the structural form both the binary and the `.uvbt` text projection encode), fixture
under [`fixtures/`](fixtures/), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian):
`../../design/DRAFT_SPEC_UVB.md`, ADR-RUNTIME-001/002.

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

## 2a. Canonical binary encoding (binary 1.1, frozen 2026-09-01)

Reference codec: [`../tools/uvb-binary.mjs`](../tools/uvb-binary.mjs); executable
vectors: `../conformance/uvb-binary/vectors.json`, which pin the identity digest of the
fixture — **the freeze**: a layout change that alters a pinned digest is a new binary
version, never a fix.

- Layout: magic `UVB\0`, u8 major/minor, then sections in fixed order (namespace,
  requires, strings, functions, optional source map), each `u8 id | u32 length |
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
  structural form and decode back the same way.

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

An invalid module refuses composition naming function, instruction and — via the
optional source map — the Luau projection line.
