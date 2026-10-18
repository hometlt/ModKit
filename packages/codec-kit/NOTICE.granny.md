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
