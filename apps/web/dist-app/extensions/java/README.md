# modkit-extension-java

JVM class files for MK3 (owner decision D2 of the Minecraft plan): one reader for every game whose
data lives in Java code. Nothing here knows a game; what a Minecraft class means stays in the
Minecraft extension.

- `modkit/java-class` — codec for `.class`: header, constant pool, fields with constant values,
  methods, and a `javap -c`-style listing as the subject's text.
- `parseClassFile`, `ConstantPool` (`src/class-file.ts`) — the class file with bounds on every count,
  length and pool index.
- `decodeInstructions`, `classListing` (`src/bytecode.ts`) — instructions with resolved branch and
  switch targets.
- `interpretMethod` (`src/interpreter.ts`) — the bounded constant interpreter: it walks one method's
  straight-line code abstractly and returns the calls it makes, with arguments as constants or
  symbolic values (a parameter, a static field, another call's result). Nothing runs; a branch,
  switch, throw or exception handler refuses the method with its program counter, so a caller can
  name what it skipped. Model builders (`CubeListBuilder.create().texOffs(0, 0).addBox(...)`) read
  back as call lists.

`dist/` is not in git: `pnpm --filter modkit-extension-java build` (the Integrator builds it for the
snapshot and the VSIX). Tests read `src/` and the javac-built fixture `test/fixtures/Sample.class`
(source beside it).
