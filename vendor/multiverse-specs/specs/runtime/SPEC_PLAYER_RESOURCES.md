# Bounded player resource accounts

The sole signatures and effects of `player.resource@1`, `player.set-resource@1`
and `player.add-resource@1` remain in `intrinsics.v1.json`. These already declared
operations now have the following executable State contract. Source spellings are
`mv.player.resource`, `mv.player.setResource` and `mv.player.addResource`; the
shared Lua AST/compiler emits the existing UVB intrinsic-call instruction.

An account is keyed by a player from the verified composition and an exact
nonempty UTF-8 resource name of at most 128 bytes without NUL. Resource names are
opaque, case-sensitive script identifiers, not native enums or display labels.
Runtime never allocates a missing player. Native adapters map their resource
vocabulary and numeric rules before invoking these operations.

Balances are signed exact Q32.32 values. A missing account reads as zero, without
allocating mutable State. Setting zero removes the sparse entry; reading or
adding zero to an absent account preserves its hash. Addition uses checked signed
i64 arithmetic; it never saturates, wraps or passes through host floats. Negative
balances are representable. Minimum balances, caps, harvest, supply, ownership,
reservations and insufficient-funds rules belong to authored gameplay behavior,
not a guessed game-specific policy in this primitive.

Set/add return `Ok(true)` when applied, including a successful unchanged value.
An undeclared player or invalid resource name returns `Err("invalid-reference")`
without mutation. Reads with such inputs trap with invalid-reference. Overflow,
instruction fuel, snapshot-size failure and the aggregate budget of 4096 nonzero
accounts plus authored technology flags trap and roll back the whole execution transaction. Existing entries
can be changed or removed at that account limit. Explicit `mv.require(result)`
statements provide the same checked error/rollback semantics as other writes.
A behavior can implement an atomic transfer by checking its policy, then issuing
the debit and credit inside one execution; this is not a new transfer intrinsic.

Initial balances are ordinary captured UVS startup writes. The same initializer,
compiler and State handle them; there is no separate host initialization bag or
resource catalog. Restoring a save restores accounts and does not repeat startup.
Nothing here changes a player's authenticated account or control binding.

## Save and admission

Profiles requiring these operations without technology operations emit the public
subsystem name `players`, section version 1. Profiles requiring technologies use
the same table in version 2, followed by their flags (SPEC_PLAYER_TECHNOLOGIES.md).
The resource table is `u32 count`, followed by
rows of `u64 player ID`, `u32 UTF-8 name length`, name bytes and `i64 Q32.32 amount`.
Rows are strictly sorted by player ID then UTF-8 name; duplicates, zero entries,
unknown players, invalid names and excess counts are refused atomically even when
the supplied digest is valid. The immutable binding maps IDs to authored player
addresses; native slot numbers are never stored as private IDs.

This section participates in the existing save/hash/frame and transaction. Its
presence follows immutable behavior requirements, not the current number of
balances, so restoring an empty or nonempty account set uses the same layout.
Profiles without these requirements retain their exact previous sections and
bytes. MVBC22, private bridge ABI19, SessionV2 and frozen UVB1.1 remain unchanged;
the changed WASM digest requires the usual matching package hop.

This is an executed generic account primitive. It does not establish native SC2
or Warzone resource semantics, player payments for assembly jobs, production,
native technology rules, alliances, automatic regeneration or a complete economy.
