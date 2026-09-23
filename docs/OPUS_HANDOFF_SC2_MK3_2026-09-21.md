# Opus handoff: SC2 MK2 → MK3 parity and CASC package resources

## Update 2026-09-22: завершённый этап MK3 completion

Этот раздел новее остального документа и описывает фактическое состояние после реализации первой
части completion plan. Полный отчёт: `docs/SC2_MK3_COMPLETION_IMPLEMENTATION_2026-09-22.md`.
Архитектурный план: `docs/BLIZZARD_SC2_MK3_COMPLETION_AND_GAME_EXTENSION_BLUEPRINT_2026-09-21.md`.

### Что выполнено

1. Map implementation перенесена из MK2 в единственного владельца
   `starcraft2/modules/map/shared/{format,image,navigation}`. 48 старых файлов оставлены как короткие
   compatibility reexports. Production Map больше не импортирует `src/lib/mk2`; embedded `.BlizWiz`
   использует канонический Wizard parser для `<wizardfile>`.
2. SC2Arcade implementation принадлежит
   `starcraft2/modules/game/battlenet/content-sources/sc2arcade.ts`; старый entrypoint является
   compatibility adapter. Это пока не означает live acceptance publish/delete через Battle.net.
3. Добавлен AST boundary ratchet: `scripts/check-mk3-boundaries.mjs`, тест, baseline
   `architecture/mk3-legacy-imports.json` и отчёт `architecture/mk3-completion-report.md`.
   Текущий остаток: 84 записи / 91 occurrence / 65 файлов, все из
   `@modkit/codec-kit/legacy/*`; прямых production imports из `src/lib/mk2` в проверяемом scope нет.
4. Добавлена общая VS Code команда `modkit.verifyDocument` в
   `apps/vscode/src/verify-document.ts`. Она проверяет live unsaved text, поддерживает cancellation,
   не публикует устаревший результат и выводит findings в Problems. Кнопка и локализация подключены
   через общий contributions generator. Installed acceptance подтвердил Galaxy, Data, Strings,
   Style и Layout. Binary/custom editors пока используют существующие `subject.validate` и
   `asset.validate`.
5. Host сохраняет semantic `isIncomplete`, валидирует provider diagnostics и имеет fast path для
   обычных completion lists без `subject-ref`: такой запрос больше не открывает дорогой
   source/mod/dependency graph. Фоновая semantic-диагностика VS Code отложена на 2,5 секунды, чтобы
   не конкурировать с вводом `<`; ручной Verify выполняется сразу.
6. Создан замороженный SC2 acceptance snapshot:
   `modkit-extensions-blizzard/artifacts/sc2-acceptance/run-6X0aiz/starcraft2`, digest
   `sha256:138d4671b66cb3de6956efece67ecafb4009cf7ddde2c5c40a28f9ce8abce545`. Receipt:
   `modkit-extensions-blizzard/artifacts/sc2-acceptance/run-6X0aiz/acceptance.json`. В нём 5 169
   файлов и 141 577 017 байт; Mod host 18/18 и native Map 2/2 прошли.

### Финальный тестовый VSIX

- Artifact: `modkit-core/artifacts/modkit-sc2-completion-20260922-v3.vsix`.
- SHA256: `0e8fdcd36403ef774100c71c0cdd8a4dac5fb40ca937cefec8988647bdd852d2`.
- Receipt: `modkit-core/reports/vscode-smoke/sc2-completion-20260922-final.json`.
- VS Code 1.138.0: activation 3 643 ms; единственный root completion `Catalog` — 598 ms;
  completion после редактирования — 538 ms.
- Data completion подтвердил контекстные catalog classes, nested fields, XML attributes, snippets,
  asset values и trigger characters `<`, space, `\"`, `=`, `,`, `;`.
- Receipt имеет `passed: false` только потому, что прежний Galaxy rename не подготовил edit для
  двух документов: workspace fixture остался `complete=false` из-за отсутствующих installation
  dependencies Core/Liberty. Защиту rename при неполном workspace не ослаблять.

### Проверки этого этапа

- Map core/navigation/image: 127 passed; MK3 Map module: 53 passed; semantic-world/writer: 23;
  PNG: 2; native Map snapshot: 2/2.
- SC2Arcade/dependency/virtual DocumentInfo: 44 passed.
- Host language suite: 31/31; Core language session: 22; relevant combined run: 53/53.
- VS Code contributions: 10/10; localization: 6/6.
- `tsc -b packages/host apps/vscode` passed.
- Boundary, module-map and ported-library checks passed.

### Следующий точный шаг

Сначала выяснить, почему физический пустой `DocumentInfo` в E2E `Probe.SC2Mod` не отменяет implicit
Core/Liberty dependencies. Возможны две причины: fixture не соответствует реально распознаваемой
форме `DocumentInfo`/`ComponentList`, либо dependency resolver применяет defaults к пользовательскому
loose package. Исправить источник неполноты и повторить установленный acceptance с существующим v3
VSIX; runtime rebuild для этого нужен только если ошибка в resolver, а не в fixture. Нельзя
подменять результат разрешением unsafe Galaxy rename.

После этого продолжить по владельцам: удалять 84 legacy imports с одновременным уменьшением
baseline; объединить Verify toolbar для text/binary/custom editors; выполнить installed matrix для
folder/archive/CASC/cache/Battle.net; затем закрывать Data, Strings, Styles, Layout, Galaxy и Wizard
parity, entity cards, editable stats, model/audio preview и relation graph.

Оба репозитория содержат незакоммиченные изменения других задач. Не делать reset, clean, stash или
массовое форматирование. Проверять diff только по затронутым файлам.

Date: 2026-09-21. Repositories are heavily dirty with related and unrelated work. Do not reset,
clean, stash, or rewrite changes. Work in the current checkout and inspect diffs narrowly.

## User goal

Restore all MK2 functionality in MK3, adapted to MK3 architecture. Immediate scope has been Data,
Galaxy, Layout, Strings, Styles, Wizards, shared language context, VS Code Sources/Resources, CASC,
Battle.net/cache sources, and SC2 mod/map/campaign dependency composition. One schema/model must own
each domain; codecs and UI must reuse it rather than create parallel models.

The latest explicit requirement is:

1. Opening a file inside a `.SC2Mod` or `.SC2Campaign` from CASC must activate that package as the
   Modkit subject. Resources must work for the active text editor instead of saying “Open a Modkit
   subject to browse its resources”.
2. Blizzard built-in packages missing root `DocumentInfo` in CASC must expose a virtual
   `DocumentInfo`. It contains normal `file:` dependencies. From there the package must use the same
   codec, subject, dependency, resource, and language pipelines as an ordinary authored mod.
3. A real authored `DocumentInfo` always wins; virtual files are read-only projections and never
   written into CASC.

## Repositories

- Core: `C:\FILES\SC2Files\coding\modkit-core`
- Blizzard extensions: `C:\FILES\SC2Files\coding\modkit-extensions-blizzard`
- Real SC2 install: `C:\Apps\StarCraft II`, observed version `5.0.16.97563`
- Manual VS Code kit: `modkit-core\artifacts\vscode-manual-authoring`

Read `PROMPT.txt` and repository instructions before continuing. Prefer codebase-memory graph tools
for discovery. The user asked for work in this thread; do not create another user task unless asked.

## Completed architecture work

### SC2 dependency authority

`starcraft2/modules/mod/shared/workspace/implicit-dependencies.js` is now the single engine package
graph. It covers Core/Liberty/Swarm/Void mods, their campaigns and Story packages, plus multiplayer
packages. It exports normalization, canonical path resolution, direct dependencies, dependency-first
closure, host dependency requests, and `sc2BuiltinDocumentInfo()`.

The expected Void Story dependency-first chain is:

1. `Mods/Core.SC2Mod`
2. `Mods/Liberty.SC2Mod`
3. `Campaigns/Liberty.SC2Campaign`
4. `Mods/Swarm.SC2Mod`
5. `Campaigns/Swarm.SC2Campaign`
6. `Mods/Void.SC2Mod`
7. `Campaigns/Void.SC2Campaign`
8. active `Campaigns/VoidStory.SC2Campaign`

The graph is consumed by mod, campaign, map preview, local Battle.net sources, and VS Code container
dependency sources. `package.json` build/typecheck now include `tsconfig.battlenet.json`; otherwise
the installed provider remained stale after source changes.

### Virtual DocumentInfo

`starcraft2/shared/package-namespace/runtime.js` now wraps a namespace with a virtual root
`DocumentInfo` when `options.virtualDocumentInfo(root.uri)` returns text and no physical file exists.
The virtual entry is visible through list/open, the namespace entry data source, extraction,
dependency parsing, semantic mod parsing, and resource trees.

Callbacks are connected in:

- `starcraft2/modules/mod/codecs/mod/src/codec.ts`
- `starcraft2/modules/campaign/codecs/campaign/runtime.js`
- `starcraft2/modules/campaign/codecs/directory/runtime.js`

`Mods/Core.SC2Mod` is explicitly in the graph with an empty dependency list, so it also receives a
valid empty virtual document. Custom/user packages receive no virtual file.

`tsconfig.sc2-mod.json` explicitly includes the JS dependency authority. This is required so emitted
`dist` is current before Vite packages the portable codec.

### Installed campaign/mod recognition and sources

- Installed `.SC2Campaign` roots with `Base.SC2Data` can open without physical ComponentList or
  DocumentInfo.
- `Sc2DesktopContentSources` exposes Maps, Mods, and Campaigns and resolves the engine graph.
- VS Code container dependency adapter mounts `.SC2Campaign` as well as `.SC2Mod`.
- CASC acceptance against the real install passed: 666,588 entries, Mods and Campaigns roots, and
  successful extraction of campaign UnitData.

### Resources for an active CASC text file

`apps/vscode/src/extension.ts` previously kept automatic language package scopes separate from the
Resources view. The view only used an active custom editor or a physical workspace directory.

Current edits add `openTreeDataSource` to `LiveLanguageScope` and make Resources first resolve the
active text editor's package scope. This lets a `modkit-container:` file use the same automatically
opened `.SC2Mod`/`.SC2Campaign` session for Resources. Resource navigation now uses `subjectUriOf()`
so container subjects are not incorrectly converted to `file:` URIs.

Review this area carefully for lifecycle/race behavior. Automatic scopes are cached and disposed by
the existing language-scope cleanup. Resources leases must always be released.

## Verification already completed

Passing:

- SC2 dependency/unit/workspace/map tests: 21 tests.
- MK2 mod codec parity suite: 18 tests after rebuilding portable codec.
- Core VS Code container/language tests: 31 tests.
- SC2 map/mod TypeScript checks passed before the latest small Core change.
- Core VS Code TypeScript check passed immediately after the Resources change, before sandbox policy
  changed. A later repetition failed with `EPERM` reading pnpm's TypeScript binary, not a TS error.
- Real CASC acceptance passed with `node casc/test/run-installation-acceptance.mjs --root
"C:\Apps\StarCraft II"`.

Important tests:

- `starcraft2/modules/mod/test/implicit-dependencies.test.ts`
- `starcraft2/test/sc2-workspace-codec.test.ts`
- `starcraft2/test/mk2/codecs/sc2-mod/test/codec.test.ts`
- `starcraft2/test/map-preview-provider.test.ts`
- `starcraft2/modules/game/test/battlenet-local-sources.test.mjs`
- `apps/vscode/test/container-content-sources.test.ts`
- `apps/vscode/test/containers.test.ts`
- `apps/vscode/test/language-session.test.ts`

## Immediate next actions

1. Run Core typecheck/build with permission to read pnpm `node_modules`:
   `pnpm --dir apps/vscode run prepare:manual-authoring -- --launch`
   This rebuilds relevant Blizzard projects, portable mod codec, Core host, VSIX, installs it into an
   isolated profile, and launches `[MK3 TEST]`.
2. In `[MK3 TEST]`, select/open `C:\Apps\StarCraft II` as CASC and open
   `Mods/Void.SC2Mod/Base.SC2Data/GameData/AbilData.xml` as a text file.
3. Confirm Resources automatically shows the Void subject resource tree while that text editor is
   active. Confirm `DocumentInfo` appears in the package namespace/resource tree and opens read-only.
4. Confirm its text contains `file:Mods/Swarm.SC2Mod`, and completion/hover/diagnostics resolve Core,
   Liberty, Swarm, then Void.
5. Repeat for `Campaigns/VoidStory.SC2Campaign`; the virtual document must point to
   `Campaigns/Void.SC2Campaign` and the full eight-layer chain must load.
6. Repeat with a custom authored mod containing real DocumentInfo; confirm no virtual replacement.

## Known unrelated blockers / cautions

- `pnpm contributions:emit` updates contributions successfully but the following module-map check
  currently fails on pre-existing `blizzard/starcraft2-image-operations` lacking a module-map target.
- `git diff --check` in Core reports existing trailing whitespace in `todo`; do not alter it as part
  of this task.
- Both repositories contain many changes from SOL-01..05 and prior parity work. Do not assume every
  dirty file belongs to this latest fix.
- Installed campaigns can be very large. Keep namespace operations bounded and avoid duplicating
  full package scans merely to synthesize metadata.

## Broader remaining program

After this manual acceptance, continue the parity plan in
`docs/SC2_AUTHORING_PARITY_RECOVERY_PLAN_2026-09-20.md` and backlog
`docs/MK2_TO_MK3_BACKLOG_2026-09-20.md`. High-priority remaining work includes full Resources/entity
cards parity (resolved values, editable stats, wiki links/images, model/audio previews, relation
graphs), shared verify actions across codecs, complete special-character completion/validation for
all SC2 languages, universal per-folder/file resource selection, simultaneous subjects from multiple
games, Battle.net authenticated hosted-content management, and full cache/public/user-map workflows.

Keep Data schema ownership in Data, Galaxy script specification in Galaxy, and reuse shared language,
reference, knowledge, subject, and UI contracts across codecs.
