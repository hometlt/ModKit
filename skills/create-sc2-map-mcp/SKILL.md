---
name: create-sc2-map-mcp
description: Create or extend a StarCraft II map through public Modkit MCP operations, including terrain, objects, linked Data and triggers, localization, UI, cutscenes and verified package output. Use for SC2 map authoring; discover the running server's actual capabilities before choosing a recipe.
---

# Create an SC2 map with Modkit MCP

Uses public `modkit.*` tools and Blizzard operations discovered through capabilities and the
opened subject's descriptor. Service operations describe subject-independent functionality only. Pair with
[inspect-sc2-resolved-data](../inspect-sc2-resolved-data/SKILL.md) for Data inspection details.

## Server prerequisites

Start the MCP server with `--allow-edits` (writers), `--output-artifacts` (retained outputs),
`--trust-extensions` (local extension roots) and a content-source config pointing at the installed
game, so `local:casc` stock mods resolve. Roots must contain the working folder. After any rebuild of
the Blizzard extension `dist`, restart the server: a running server refuses changed artifacts
(`artifact changed after inventory`) and may fall back to the plain MPQ codec for `.SC2Map`.

## Economise round trips

- `modkit.batch` runs up to 64 steps (`plan_file` up to 256) in one call. Reference earlier results
  with `{"$from": "step.path"}`, file contents with `{"$file": path}` (JSON) / `{"$text": path}`
  (text), retained bytes with `{"$artifact": id}`. Use `select` and `resultBudget` to keep replies small.
- Keep large inputs (terrain plans, Galaxy scripts, catalogs) in files and pass them by reference.
- `modkit.usage` reports per-tool calls, errors, milliseconds and bytes — quote it in reports; never
  invent token counts.

## Lifecycle

1. **Discover.** `modkit.capabilities`, open the intended subject, then `modkit.inspect` for its
   operations and schemas. Query knowledge for exact fields and native IDs. Distinguish implemented,
   advertised, available and verified capabilities; a source checkout does not update a running server.
2. **New map from a blueprint.** Open a folder map saved by the Editor (any tileset) with
   `modkit.open_subject`. Invoke `blizzard/sc2-map-directory.derive-new` via `modkit.invoke_readonly`
   with `retainOutput: true` and the request: `size`, `tileset` (CTerrain id), `cliffSets`,
   `textures` (8 blend textures), `players` (control user/computer, race, color, start location),
   `dependencies`, `locales`, `playable` bounds, optional `water`, `heightRange`. Save the retained
   MPQ with `modkit.save_output` into a working folder, open it, and unpack it to a folder map with
   `modkit.extract_container`. Preserve the blueprint. Creating an additional document requires an
   advertised native writer operation and a guarded destination, such as supported `document.write`.
3. **Terrain.** `modkit.propose_edit` on the folder map with world-writer kinds, then
   `modkit.prepare_edit` → `modkit.commit_edit`:
   - `terrain.author` — base height, level shapes (rows from north), `cliffSet`, `ramps` (qualified
     native diagonal templates only; check the receipt for refused ramps and the half-level rule);
   - `texture.paint` — strokes per blend layer (weights sum to 15 per pixel);
   - `cell.paint` — `Pnp`/`Pnb`/`Pcl` attributes (no-path, no-build, clear-path override);
   - `object.scatter` — seeded doodads with slope/water/distance filters; use real CASC model/doodad IDs.
   Prove pathing on a fresh test copy: ordinary ground route exists → block all entrances → no route
   → `undo_edit` by the exact commit receipt → route restored. Keep the original edit handle alive
   until Undo finishes. When advertised, select `movementProfile: NORMAL_GROUND` and `requireRoute`;
   a PNG without a route is not a structured success or proof of disconnection. Test short paths and
   exits from each plateau as well. `regions` describes ground components; optional `areas` describes
   strategic territories whose boundaries do not imply obstacles. Disclose missing catalog footprints,
   static sampling and unit-radius/engine limitations.
4. **Data.** `blizzard/sc2-data.add-entities` per catalog document (`Unit`, `Abil`, `Effect`,
   `Behavior`, `Validator`, `Upgrade`, `Button`, `Actor`): entities by `class`/`id`/`parent`/`fields`
   or raw `xml`; duplicates are refused. Verify effective values, inheritance, arrays and references in
   `modkit.open_resolved_workspace` — never trust that the XML exists.
5. **Strings.** Write `GameStrings.txt` per locale (`ruRU`, `enUS` fallback) through the strings
   writer; keys referenced by Data and triggers must exist in every locale.
6. **Triggers.** Author an Editor-style `MapScript.galaxy` (globals, `gf_`/`gt_` functions, presets,
   structs) and apply `script.author` with `galaxy`, `header`, `dependencyLibraries` (NativeLib
   TriggerLib + TriggerStrings read with `modkit.mod_context_read` and `retain`), `galaxyDeclarations`
   and `functionKinds` (`{"gf_X": "condition"}`; custom events are detected from `void gf_X(trigger t)`
   bodies that only register events on `t`). The writer converts Galaxy → Triggers → Galaxy and writes
   `Triggers`, `TriggerStrings.txt` and `MapScript.galaxy`; inspect its receipt diagnostics. A clean
   structural round trip is not SC2 compilation — mark that as awaiting in-game verification.
7. **Layouts, styles, cutscenes.** Author `.SC2Layout`, register them in `DescIndex`, add font styles;
   preview with advertised layout operations. For `.SC2Cutscene`, inspect the opened scene's available
   preview source and running `world_scene` schema before requesting frames. Verify native animation
   names and attachments through their existing owners. A timeline/structural inspection does not prove
   a 3D frame; report unavailable frame support explicitly, without substituting a map screenshot.
8. **Pack.** Invoke `blizzard/sc2-map-directory.pack` with `retainOutput`, `modkit.save_output` the
   `.SC2Map`, reopen it with `modkit.open_subject` and re-read the documents you changed. Use a separate
   export destination: a folder named `Agria.SC2Map` cannot also receive the packed file. Record hash,
   size, validation, dependency scope and the selected map codec, not just MPQ recognition.

## Report honestly

Per item use one status: «проверено автоматически», «ожидает проверки в SC2», «ошибка»,
«не поддерживается». Cite the receipt/diagnostic/preview that proves an automatic check. Never report a
skipped or refused step as success; refused ramps, unresolved assets and conversion losses are results.
Respect any user restriction on launching the Editor/game. Separate native structural validation,
semantic checks, rendered frames and actual gameplay acceptance. Check scenario conditions against
negative cases: an enemy wave medic must not complete the player's reinforcement objective.
