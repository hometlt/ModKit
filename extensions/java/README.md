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
  code abstractly and returns the calls and field stores it makes, in one order (`step`), with
  values as constants or symbols (a parameter, a static field, another call's result). Nothing
  runs. A branch or switch whose condition folds takes its side, so constant loops unroll within
  `maxInstructions`; `args` binds parameters, and `heap` lets the caller answer field, static and
  array reads (`setupAnim` over a model's parts, a static table from `<clinit>`). A condition over
  a symbol, a throw or an exception handler refuses with its program counter and hands back what
  was recorded. Model builders (`CubeListBuilder.create().texOffs(0, 0).addBox(...)`) read back as
  call lists.

`dist/` is not in git: `pnpm --filter modkit-extension-java build` (the Integrator builds it for the
snapshot and the VSIX). Tests read `src/` and the javac-built fixtures `test/fixtures/Sample.class`
and `Heap.class` (sources beside them).
