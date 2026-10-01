# Deterministic entity orientation

Status: implemented executable foundation profile, 2026-10-01.

## Contract

An entity's orientation is a unit quaternion `[x,y,z,w]` mapping its local frame
to the UVW space named by its position. It has no global-up, yaw, topology, or
game-specific forward assumption. Identity is `[0,0,0,1]`. A model's authored
forward direction is a separate asset convention; orientation does not rewrite
geometry or silently rotate a model to match a gameplay heading.

The shared coordinate contract and UVM specify nominal asset/world forward `+Z`.
Earlier UVM prose incorrectly called `−Z` glTF's asset forward; it is corrected
against [glTF 2.0 §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units).
Cameras look along local `−Z`, and an explicitly authored socket or native mesh
may have another local nose. No existing geometry or socket defaults are rewritten
by this clarification. A game's adapter must explicitly account for its model
and gameplay frames. Neither SC2's angle zero/sign nor an asset correction is
inferred from the world basis alone. Resolving a source game's heading remains
an independent native-mapping task.

Each component is a signed Q32.32 quantum, as elsewhere in authoritative State.
With `S=2^32`, components must lie in `[-S,S]`. The raw squared norm must satisfy
`abs(sum(Q_i²)-S²) <= 2*S+1`: the error bound of independently nearest-rounded
components of a real unit quaternion (`sum(abs(q_i)) <= 2`). Invalid tuples are
refused, never silently normalized. Arithmetic uses bounded i128 integers.

`q` and `−q` are canonically identical: the first nonzero component in order
`w,x,y,z` must be positive. This handles exact half turns without floating-point
comparison. Accepted input is sign-canonicalized; a saved tuple must already be
canonical. Re-saving an equivalent negative quaternion cannot change StateHash.

## Intrinsics and source API

- `entity.orientation-component@1(ref<entity>,i64) → fixed64`: component indices
  0..3 are XYZW. Invalid/unpositioned entity or index raises `invalid-reference`.
- `entity.set-orientation@1(ref<entity>,fixed64,fixed64,fixed64,fixed64) → result<bool>`:
  succeeds with `true`, or returns `invalid-reference` / `invalid-orientation`
  without mutation. The returned result must be handled as for other mutations.
- Common AST-based Luau API: `mv.entity.orientationComponent(entity,index)` and
  `mv.entity.setOrientation(entity,x,y,z,w)`, using typed variables/locals.

Creation starts with identity. Create followed by set in one UVB execution shares
the same transaction; a thrown error/fuel exhaustion rolls back both and the
queued `entity.created` event. Returning a failed ResultBool does not roll back
earlier successful effects. Teleport preserves the numeric local quaternion in
the target space. Movement does not automatically aim the entity; turn-rate and
source game orientation policies remain explicit future native mappings.

## Save and admission

Either intrinsic selects private binding profile `MVBC 18`. It carries the same
immutable binding payload layout as profile 17 but a distinct identity. The Rust
decoder rejects orientation intrinsics in older profiles before the first tick.

Profile 18 uses entity section version 8. Each entity stores four little-endian
i64 components immediately after its optional position and before its fields.
These bytes participate in snapshot/save section digests and StateHash. Restore
validates norm, canonical sign and positioned-entity constraints atomically.
Profiles 1–17 keep their original bytes, hashes, section versions and identity.
UVB 1.1's frozen opcode/binary contract is unchanged; these calls use its existing
typed fixed64 arguments and intrinsic dispatch.

This profile stores and executes general 3D orientation. It does not claim SC2
facing parity, moving-frame transport, rotations between dimensions, dynamic
turning, or rendering through the product inspector.
