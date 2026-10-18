# Granny / Oodle1 reader provenance

Oodle1 arithmetic/LZ decoder adapted from LunaticInAHat/liboodle,
https://github.com/LunaticInAHat/liboodle, commit
7837c253f8ca505a3ba3cd8e35d8bc3f5ab76a30, Unlicense.
The full upstream license is retained in LICENSE.liboodle.
Bounds, cancellation and the native scheduled-threshold decay gate were added.

Granny v6 LE32 reader is an independent implementation of the embedded type
library/header facts, informed by format notes at
https://github.com/senyaak/homm5-editor/tree/e40be948d16757ec8cff7f7d1be87b9956fc2d64/docs
(GR2_FORMAT.md, OODLE1_FORMAT.md). No source code from that unlicensed repository
was copied. The reader is game neutral; game semantics belong to extensions.

Packed LE64 variants use the same bounded type/object engine with an explicit layout:
44-byte members, unaligned 64-bit offsets and zero null pointers. Layout facts were checked
against coconutbird/ensemble-formats, revision 5e30fff926be55fb3f311aad5e3b8ad858ccd2ef
(MIT); attribution and source hashes are in provenance/granny-packed.json and
licenses/ensemble-formats-MIT.txt. No upstream generic graph implementation was copied.
Native file_info, carrier/chunk admission and root selection remain with game adapters.
GR2 LE32 remains relocation-authorized; this profile does not synthesize a GR2 header.

Encoded control/knot expansion is adapted from Norbyte/lslib, revision
6f5f6987d10d8485876b8368431c948e4dea4f83 (MIT, Copyright 2015 Norbyte).
The complete upstream license is in LICENSE.lslib; source hashes and scope are in
provenance/granny-curves.json. This expands controls, not evaluated animation frames.
Formats 12/14 (D9I1) are outside the admitted profile: upstream format 14 explicitly
marks its reconstruction uncertain; format 12 is conservatively refused as well.
Float32 knot domains preserve signed ordered values. Format 0 retains sample indices;
native time mapping is required before using a time-based sampler. Existing degree 2/3
sampling remains provisional until independently checked against the engine.

Native transform matrix convention is checked against LSLib GR2/Format.cs at that same
revision: row-vector ScaleShear * Rotation * Translation becomes column-vector
Translation * Rotation * transpose(ScaleShear). The implementation reuses existing Core
composition/product kernels and shared flags/component admission; no LSLib matrix kernel
is copied. The existing quaternion normalization policy is explicit, T*R composition is
float32, and all nine native scale/shear coefficients participate in the affine product.
This is separate from canonical game units, axis admission or native animation evaluation.
Ordered variant fields preserve native duplicate names; default record views remain strict.
