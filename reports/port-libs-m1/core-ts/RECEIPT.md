# Core strict TypeScript handoff — M1, 2026-09-04

Owned work completed for codec-kit, code, scene, uv, host, ui, testkit. Extension-manager was reassigned to Terra. No commits created. Codec-kit runtime ownership released to sol_high_plan_audit for P9; this receipt describes its pre-P9 snapshot.

27 authored JavaScript files converted mechanically to TypeScript: codec-kit 7, code 3, scene 7, uv 10. Seven packages contain zero authored src JavaScript at handoff. Existing host 98, ui 50, testkit 17 TypeScript files retain runtime behavior. Package configs extend tsconfig.port-strict.json and emit declarations to dist. Redundant handwritten declarations removed after emit; code retains a necessary Monaco ambient module declaration. Package exports, contribution module paths, and module registrations point to emitted files. Root owns shared dependency/config changes.

## Evidence and exact status

| Check | Exit | Result / log |
| --- | --- | --- |
| Baseline scoped Vitest repeat | 0 | 105 files, 958 tests passed; baseline-vitest-repeat.log |
| Final seven-package tsc build | 0 | final-build.log; testkit rebuilt successfully after its path correction |
| Focused source ESLint | 0 | scoped-lint-final.log |
| Original JS vs normalized emitted TS | 0 | 27/27 equal; runtime-equivalence.json (only required module src→dist relocation normalized) |
| Host bracket accesses + UI type assertion runtime equality | 0 | 9/9 equal; t2-runtime-equivalence.json |
| Emitted package target existence | 0 | 148 targets across seven packages; package-verification.json |
| Host new subject-kind registration | 0 | all 9 A1 entries registered, duplicate trait and subject-kind rejected; host-subject-kind-registry.json |
| Scene unchanged native tests with TS resolver | 0 | 3 tests passed; scene-final-node.log |
| Broad final scoped Vitest BEFORE path corrections | 1 | 39 failed, 917 passed; 8 failed files, 96 passed files and one interrupted worker; final-vitest.log |
| All eight affected files AFTER path corrections | 0 | 130/130 tests passed; final-affected-vitest.log |
| Interrupted worker file rerun | 0 | capability-rpc-conformance.test.ts 13/13 passed; final-worker-rerun.log |
| Final git diff --check / selected Prettier check | 0 | successful terminal checks |

This is not a claim that the entire final scope passed in one run. Root will run the final serialized full gate after M1 freeze. Intermediate logs include in-flight dependency failures, missing JS during the first overlapping baseline, and an import-time timeout; neither timeout nor assertions were weakened.

Commands: node node_modules/typescript/bin/tsc -b packages/codec-kit packages/code packages/scene packages/uv packages/host packages/ui packages/testkit; node node_modules/vitest/vitest.mjs run (the seven package test paths); node --import ./packages/scene/scripts/test-typescript.mjs --test packages/scene/test/*.test.js. Focused reruns list their exact files in the corresponding logs.

## Authorized test / fixture changes

- code/test/package.test.ts: exactly three expected package targets src/module.d.ts, src/module.js, src/index.js become their dist equivalents.
- host/test/fixtures/{companion-extension/companion.mjs,companion-namespace-extension/nested.mjs,subject-open-namespace-extension/codec.mjs}: codec-kit runtime import src/index.js becomes dist/index.js.
- testkit/test/uvt-materializer.test.ts: one materializer import src→dist; testkit/test/uvt-writer.test.ts: three writer imports src→dist.
- testkit/test/text-data.test.ts: six codec-kit authored source inspection filenames .js→.ts; inspection still reads src.
- ui/test/browser-e2e.test.ts: type-only assertion on optional canvas width; normalized emitted runtime identical.
- testkit/src/uv-materialization.ts: required UV dynamic runtime loader src→dist.

Other intentional runtime change is root-requested host contribution-registry integration for the new SDK subject-kind A1 data-only contract, preserving duplicate checks. Eight other host files have only strict index-signature bracket access corrections. Scene adds a relative-import TS test resolver without changing its tests. No known remaining TypeScript errors in this owned scope.

## Done file list

For codec-kit/code/scene/uv: all pre-M1 authored src .js files replaced by .ts; redundant public .d.ts removed; package.json and tsconfig.json updated; code/scene/uv contribution manifests updated. Additional code/src/monaco-module.d.ts and scene/scripts/test-typescript.mjs added.

For host: package.json, tsconfig.json, src/contribution-registry.ts, src/commands/subject-commands.ts, src/detection-selection.ts, src/editing-evidence.ts, src/editing.ts, src/linked.ts, src/native-text.ts, src/offers.ts, src/resolution/lock.ts and the three fixture files above.

For ui: package.json, tsconfig.json, test/browser-e2e.test.ts. For testkit: package.json, tsconfig.json, src/uv-materialization.ts and the three test files above. Code package test listed above is also changed.
