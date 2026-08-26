# Spring / Recoil

Final MK3 owner for Spring/Recoil formats. S3O is MK3-authored here from the official engine layout;
it was not relocated from MK2 and has no staging or ratchet claim. Rapid/VFS staging routes remain
where they are until their own migration slice.

The reader decodes S3O version 0 geometry, stable piece ids/names, hierarchy and logical texture
references. S3O itself is static: BOS/COB or Lua unit-script motion needs a future definition-owned
script-selection and piece-name binding contract. The S3O file carries no script path, so this codec
does not invent a companion requirement. Spring 3DO is a separate named remainder.
