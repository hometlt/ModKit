# Sol Block 7 — first-pass report

- Date: 2026-08-23
- Branch: `spec/mk3-extension-reference`
- Scope: recommended first pass — cleanup, same-file parity gate, real GLTF/GLB/M3 geometry
- Canonical checkout: `../modkitx`, read-only

## Executive result

The recommended first pass is complete.

- The contract/reference examples are isolated under `extensions/_reference`; the obsolete
  `packages/extensions-linked` workspace package and its physical leftover are gone.
- `pnpm parity` now opens the same GLTF, GLB, and M3 bytes through canonical Modkit and the X3
  product path, leases declared X3 data sources, and writes a machine-readable report.
- GLTF, GLB, and M3 expose decoded triangle primitives with positions and indices; normals and UVs
  are exposed when present.
- A real installed StarCraft II corpus opens successfully, and an encoder-generated M3 triangle is
  committed without vendoring a game-owned file.
- Electron opened all three formats in a three-file folder and reported `model=ok` for each, then
  completed with `selftest: done`.
- The phased root gate is green: 172 test files and 1439 tests passed.

This is not the whole Block 7. Relocating the 42 families still under `extensions/mk2` was explicitly
left for the next phase; it should remain one family per commit. VS Code received its normal full-suite
coverage but was not run as a live Extension Development Host in this pass.

## Commits

All commits carry `Co-Authored-By: Claude Sol <noreply@anthropic.com>`. Nothing was pushed.

| Commit    | Result                                                                |
| --------- | --------------------------------------------------------------------- |
| `e790f88` | isolate contract examples and remove the obsolete linked package      |
| `9736322` | add same-file model parity gate and baseline report                   |
| `9fb2e50` | decode GLTF and GLB geometry buffers                                  |
| `042d4e8` | decode schema-driven M3 region geometry                               |
| `ccccb43` | add the TypeScript declaration for the parity classifier              |
| `583da1d` | refresh the web catalog for the new GLTF geometry module              |
| `ae6788f` | isolate the generated M3 fixture and harden Blizzard bundle isolation |

## Documentation and architecture gap audit

The X3 README/guides, target-state notes, parity plan, canonical architecture/status/tasks, and the
current `PROMPT.txt` were read before implementation. The first-pass gaps were:

1. executable demo contracts were mixed into normal `extensions/reference` inventory;
2. the deleted `packages/extensions-linked` package still had filesystem residue;
3. X3 lacked a canonical-vs-X3 same-file parity command;
4. the relevant GLTF/GLB/M3 model scenes were metadata-only;
5. all 42 converted families still occupy the transitional `extensions/mk2` layer.

Items 1–4 are closed in this pass. Item 5 is the next phase, not hidden as done.

## Cleanup inventory

### Removed or isolated

- `extensions/reference` was renamed to `extensions/_reference` and its consumers/workspace entries
  were updated.
- `packages/extensions-linked` was removed from source, workspace, and lockfile in `e790f88`.
- After install/build validation, its remaining physical directory was found to contain only an
  empty `generated/` directory plus a `node_modules/@modkitx-x3/host` junction. That exact directory
  was removed; it had no authored files.
- Five empty, untracked source directories were removed:
  - `extensions/mk2/blizzard-starcraft2/src/_shared`
  - `extensions/mk2/common-models/src/shared`
  - `extensions/mk2/ea-westwood/src/_shared`
  - `extensions/mk2/epic-games-unreal-engine/src/_shared`
  - `extensions/mk2/realitypump-earth-2150/src/earth-res`

### Post-cleanup checks

- `extensions/reference`: absent.
- `packages/extensions-linked`: absent.
- `node_modules` directories under `packages`/`extensions` without a sibling `package.json`: 0.
- Extension inventory: 64 extension directories, clean.
- Linked-entry regression tests: 16 passed.

Historical plans/reports that mention the old paths were not rewritten; they remain historical
evidence rather than active configuration.

## Same-file parity gate

- Command: `pnpm parity`
- Corpus: `scripts/parity/corpus.json`
- Report: `reports/parity/latest.json`

The gate invokes canonical codecs from the read-only sibling checkout and opens the exact same bytes
through X3 `createModkit`. X3 then leases every declared source and smoke-reads the model primitive
when geometry is decoded. Missing or failed sources therefore cannot masquerade as declared support.

| Format | State    | Classification | Canonical                  | X3                          |
| ------ | -------- | -------------- | -------------------------- | --------------------------- |
| GLTF   | compared | X3 richer      | decoded geometry, 1 source | decoded geometry, 6 sources |
| GLB    | compared | X3 richer      | decoded geometry, 1 source | decoded geometry, 3 sources |
| M3     | compared | X3 richer      | decoded geometry, 1 source | decoded geometry, 3 sources |

“X3 richer” describes the compared feature surface: X3 adds tree/byte/text/graph sources and standard
operations. It does not claim full semantic superiority. In particular, canonical M3 still decodes
materials, skeleton, and animations that this X3 pass does not expose as decoded runtime objects.

The M3 sample is a 11,952-byte triangle produced by canonical `encodeM3RenderModel`, not a Blizzard
asset. Its SHA-256 is
`d34480c1b726c37bfeea9dd75fc71a13ca7e47d6ff15b2d66487c6a4b3369de7`.

## 3D vertical result

### GLTF

- Embedded data-URI buffers are decoded through bounded accessor reads.
- Scene nodes, meshes, primitives, bounds, positions, indices, normals, and UVs are published through
  `common.view/model-scene-source`.
- External buffer URIs retain an explicit metadata-only fallback; no fake geometry is synthesized.
- Sparse accessors, Draco, meshopt, and animation playback remain explicit limitations.

### GLB

- The real BIN chunk is passed through the same bounded GLTF accessor decoder.
- The model source publishes actual primitives and bounds rather than a metadata-only graph.
- Sparse accessors and compressed geometry remain explicit limitations.

### M3/M3A

- The Node path ports the canonical schema-driven section parser and `structures.xml` rather than
  guessing binary offsets.
- MODL vertex flags, vertex buffers, divisions, regions, and face indices are decoded into positions,
  indices, normals, and the first UV channel.
- The portable codec retains metadata fallback outside Node. Materials, skeletons, animations,
  external M3A sidecars, browser-worker geometry, and writing remain pending.
- The converter was taught about the XML parser dependency, so `convert-mk2 --check` is reproducible.

### Automated and real-data evidence

- `packages/testkit/test/mk2-model-codecs.test.ts`: 25 passed, including decoded M3 triangle buffers,
  bounds, primitive reads, corruption, and resource budgets.
- `packages/testkit/test/sc2-real-corpus.test.ts`: 3 passed against the installed StarCraft II corpus.
- Full MK2 acceptance: 181/181 ported, 0 port-pending, 9 real and 172 synthetic samples opened.

### Electron evidence

An isolated Electron profile loaded `mk2/common-models` and `mk2/blizzard-models`. A temporary folder
contained only generated `triangle.gltf`, `triangle.glb`, and `triangle.m3`.

Observed renderer lines:

- `triangle.glb stages model=ok tree=ok hex=ok`
- `triangle.gltf stages code=ok model=ok tree=ok text=ok virtual-text=ok hex=ok`
- `triangle.m3 stages model=ok tree=ok hex=ok`
- all four inspector panels mounted for each file;
- final line: `selftest: done`;
- process exit code: 0.

The temporary profile, fixtures, and extension-folder fixtures were removed afterwards. The user’s
settings were not touched.

## Phased gate

The root gate was run sequentially, not as one opaque command.

| Phase                                                 | Result                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm build`                                          | passed; catalogs, project/tooling TypeScript, web catalog, 65 bundle entries |
| `pnpm lint` + `pnpm format:check`                     | passed, zero warnings                                                        |
| standalone tooling TypeScript                         | passed                                                                       |
| changed-surface Vitest                                | 7 files, 74 tests passed                                                     |
| full `pnpm test`                                      | 172 files, 1439 tests passed                                                 |
| universal data benchmark                              | passed all time/heap budgets                                                 |
| schemas/manifests/tokens/themes/icons/facilities/apps | all passed                                                                   |
| legacy/import/extension/MK2/ports gates               | all passed; 181/181 ports, 0 pending                                         |
| `pnpm parity`                                         | all three formats compared, no failed/skipped row                            |
| Electron selftest                                     | passed with all three model stages mounted                                   |

`apps/electron/dist-app` was restored after the live run. The pre-existing user modification to
`scripts/bundle-hashes.json` was snapshotted before build and restored byte-for-byte afterwards.
Pre-existing README/report/plan work was neither staged nor modified by these commits.

## Problems observed outside this task

### FileHandle disposal warnings in full MK2 acceptance

- Location: `packages/testkit/src/mk2-acceptance.ts:284`–`291`.
- Symptom: Node repeatedly reports `DEP0137`, closing `FileHandle` objects during garbage collection.
- Cause candidate: `corpusByteSource` creates an `openFileSource` random-access source, but the
  acceptance lifecycle disposes sessions without retaining and disposing that source. The source’s
  real close is in `packages/host/src/node/file-source.ts:76`–`80`.
- Why not fixed here: it affects the generic acceptance ownership/lifecycle contract, not model
  parity or geometry.
- Proposed follow-up: make the acceptance resolver own every random source in a run-level registry
  and close them in `finally`, then add a handle-leak regression test.

### Deprecated Electron console-message callback

- Location: `apps/electron/electron/main.cjs:1052`.
- Symptom: Electron warns that the positional `console-message` callback arguments are deprecated.
- Why not fixed here: unrelated API migration in the desktop logging bridge; it did not affect the
  selftest result.
- Proposed follow-up: consume the current event parameter object and retain the same final-line exit
  behavior in its unit/live tests.

## Families still under `extensions/mk2`

All 42 families remain to be relocated. Counts below are current authored files / codec manifests;
the size band is for planning, not a claim of semantic complexity.

| Family                               | Files | Codecs | Band |
| ------------------------------------ | ----: | -----: | ---- |
| adobe-flash                          |     9 |      3 | M    |
| annihilation-gas-powered             |     5 |      1 | S    |
| audiokinetic-wwise                   |     9 |      3 | M    |
| blizzard-casc                        |    16 |      1 | M    |
| blizzard-common-formats              |     5 |      1 | S    |
| blizzard-diablo                      |     7 |      2 | S    |
| blizzard-models                      |    16 |      1 | M    |
| blizzard-mpq                         |     5 |      1 | S    |
| blizzard-starcraft2                  |    26 |     11 | L    |
| blizzard-warcraft-3                  |     5 |      1 | S    |
| cavedog-total-annihilation           |     7 |      2 | S    |
| common-archives                      |    33 |     15 | XL   |
| common-audio                         |    17 |      7 | M    |
| common-containers                    |     5 |      1 | S    |
| common-images                        |    48 |     22 | XL   |
| common-models                        |    17 |      7 | M    |
| common-vector                        |     9 |      3 | M    |
| common-video                         |    15 |      6 | M    |
| ea-archives                          |     5 |      1 | S    |
| ea-emperor                           |     7 |      2 | S    |
| ea-models                            |     7 |      2 | S    |
| ea-sage                              |    13 |      5 | M    |
| ea-tiberian-sun                      |     5 |      1 | S    |
| ea-westwood                          |    18 |      7 | L    |
| epic-games-unreal-engine             |    17 |      7 | M    |
| firelight-fmod                       |     5 |      1 | S    |
| microsoft-age-series                 |    29 |     11 | L    |
| microsoft-halo-wars                  |     5 |      1 | S    |
| new-world-computing-heroes-3         |     7 |      2 | S    |
| new-world-computing-heroes-4         |     5 |      1 | S    |
| opensource-spring                    |     7 |      2 | S    |
| opensource-warzone-2100              |    15 |      6 | M    |
| petroglyph-glyphx                    |     7 |      2 | S    |
| rad-game-tools-video                 |     7 |      2 | S    |
| realitypump-earth-2150               |     7 |      2 | S    |
| realitypump-earth2160                |     7 |      2 | S    |
| relic-essence                        |    17 |      7 | M    |
| relic-models                         |     7 |      2 | S    |
| stainless-steel-studios-empire-earth |     9 |      3 | M    |
| ubisoft-heroes-6                     |     5 |      1 | S    |
| uncommon-documents                   |    48 |     18 | XL   |
| unity-engine                         |    13 |      5 | M    |

Totals: 526 files, 181 codec manifests; 22 S, 14 M, 3 L, 3 XL families.

Planning estimate for one-family-per-commit relocation:

- base move/manifest/workspace/test work: approximately 17.75 focused engineer-days using S=0.25,
  M=0.5, L=0.75, XL=1.0 day;
- collision resolution with existing canonical paths, catalog regeneration, review, and repeated root
  gates: another 3–8 days;
- total planning range: about 21–26 focused engineer-days and at least 42 family commits, plus a few
  integration/docs commits.

The estimate should be revised after the first three representative moves: one small publisher
family, `common-models` with an existing canonical collision, and one XL family.

## Next recommended step

Start the relocation phase with those three representative families, preserve one family per commit,
run targeted tests after each, and run the full root gate after each batch. Keep `extensions/mk2` as
the tracked remaining-work boundary until the final family moves; do not hide it with aliases.
