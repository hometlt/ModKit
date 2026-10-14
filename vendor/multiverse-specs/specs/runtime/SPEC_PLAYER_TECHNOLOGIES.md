# Bounded authored player technology flags

The sole signatures and effects remain `player.tech-unlocked@1` and
`player.unlock-tech@1` in `intrinsics.v1.json`. Source spellings are
`mv.player.techUnlocked` and `mv.player.unlockTech`. The existing Lua AST/compiler
emits registered intrinsic calls; no technology parser, schema or host State is added.

A flag is keyed by a player and an immutable definition from verified composition.
The generic `ref<def>` signature does not impose an invented native research kind:
the authored adapter chooses which definitions denote technologies. A definition's
parent, fields, native type and player slot do not imply an unlocked flag. Each
player/definition pair is independent; all flags initially read false without
allocating State. Captured UVS startup can explicitly unlock selected pairs.

Unlock is monotonic and idempotent: `Ok(true)` means newly unlocked, `Ok(false)`
means already unlocked. There is no implicit cost, delay, prerequisite, upgrade
level, alliance sharing or relock. Such gameplay policies are authored UVB and
must receive their own native equivalence tests. Initializers run once on fresh
State and never rerun on restored saves.

An undeclared player returns `Err("invalid-reference")` on a write; invalid reads
trap. Intrinsic writes also reject an unknown definition. Public/private function
entry admission already rejects uncaptured `DefRef` arguments before execution;
that earlier refusal remains intact. `mv.require(result)` propagates Result errors
through the existing transaction; `Ok(false)` remains successful false.

Resource accounts and unlocked flags share one aggregate budget of 4096 stored
player records. Existing flags can be queried or unlocked again at the limit,
and existing resource accounts can be changed or removed. A new record, exhausted
instruction fuel or an exceeded snapshot budget traps and rolls back the entire
execution, including earlier resource or technology writes. A transaction can
therefore combine an authored prerequisite check, payment and unlock; Runtime
does not silently infer those policies.

## Save profile and identity

Requirements containing either technology intrinsic select `players` section
version 2, even for an empty flag set. Its payload contains the exact v1 resource
table (`u32 count`; sorted `u64 player`, length-prefixed UTF-8 name, `i64 Q32.32`),
followed by `u32 technologyCount` and sorted rows of `u64 player`, `u32 definition`.
Both IDs refer to immutable captured addresses, never native numeric slots.
With no resource requirements the resource table must be empty.

Unknown identities, duplicates, unsorted rows, invalid counts, trailing bytes,
and a section version inconsistent with the immutable behavior profile are
refused atomically, including a payload with a valid SHA-256. Flags participate
in the existing State hash, snapshot, public save, continuation and rollback.

Resource-only profiles keep the exact version 1 payload and hash layout. Profiles
requiring neither resource nor technology operations keep their former section
set. Frozen UVB1.1, SessionV2, MVBC22 and private ABI19 are unchanged; the new WASM
must be deployed with its matching provider digest.

This contract executes a generic primitive. SC2/Warzone research semantics,
native prerequisites, timed production, upgrade levels and product UI remain
open; a synthetic authored fixture is not native gameplay acceptance.
