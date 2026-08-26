# Spring / Recoil

Final MK3 owner for Spring/Recoil model and unit-binding formats. S3O is MK3-authored here from the
official engine layout; it was not relocated from MK2 and has no staging claim. Installed Spring
rapid packages are mounted by the host through the explicit `rapid+file:` VFS provider.

The direct reader decodes S3O version 0 geometry, stable piece ids/names, hierarchy and logical
texture references. S3O itself remains static and therefore still declares no script companion.
The separate unit-definition contribution parses `objectName` and `script` from inert Lua data;
the host resolves those exact logical paths and supplies the selected S3O/COB/BOS bindings.

Animation metadata is emitted only from explicit BOS `Frame` markers when the function is present
in the COB script table and every target has the same name in BOS, COB and the S3O stable-piece
table. Lua, COB and BOS are never executed. Compiled COB motion, Lua motion that needs execution,
Spring 3DO, S3O writing and material semantics remain named remainders.
