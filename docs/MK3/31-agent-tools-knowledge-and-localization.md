# 31. Agent tools, knowledge/help and localization planes

Status: **non-canonical candidate contracts (agent + knowledge/localization planes)**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Created: 2026-08-12 (BRIEF-7)

Владелец двух плоскостей: (1) AI automation/agent tooling поверх публичных typed operations;
(2) localized help/knowledge/encyclopedia и UI localization. Не создаёт новых stateful registries:
всё ниже — contract-typed contributions и typed views над единым inventory/resolver
([23](23-contract-identity-schema-resolution-and-lock.md)) и operations
([06](06-viewers-editors-language.md), ASSET_CAPABILITIES §5). Security-семантика — у
[24](24-extension-security-execution-and-lifecycle.md). Всё candidate до слайсов AI-0…AI-6 и
KH-0…KH-6.

## 1. AI automation plane

### 1.1 Топология адаптеров

```text
agent host (Codex/Claude/local model/CI/custom service)
  -> protocol adapter (direct SDK / CLI / JSON-RPC / MCP-like / HTTP where appropriate)
  -> Modkit typed operations and transactions
  -> Multiverse compile/headless/simulation/replay operations
  -> structured result + diagnostics + provenance + artifacts/receipts
```

MCP, конкретный LLM SDK или prompt-формат — host adapters поверх стабильного operation/contract
layer, не kernel dependency. AI не получает privileged API: те же operations, permissions,
transactions и budgets, что CLI/editor/human UI. Correctness oracle принадлежит schemas,
validators, compiler и tests; LLM добавляет planning. Каждый skill воспроизводим человеком/CI без
LLM.

### 1.2 Четыре понятия

| Понятие                       | Что это                                                                                                                                                                          | Новый contract?                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Agent tool**                | Одна строго типизированная callable operation: input/output schema, permissions, budgets, cancellation, machine-readable errors                                                  | Нет — typed view: публикация существующего `OperationOffer` в agent catalog (projection, не дубль реализации) |
| **Agent skill**               | Versioned bounded workflow: цель, preconditions, tools, стратегия, expected artifacts, recovery, examples, evals; не получает новых полномочий; executable code в prose запрещён | Да — data-only contribution `agent-skill`                                                                     |
| **Knowledge contribution**    | Schema help, field semantics, relations, examples, docs, provenance, confidence; не trusted instruction, не повышает execution authority                                         | Да — data-only `knowledge-pack` (§2)                                                                          |
| **Agent evaluation/scenario** | Fixture/headless scenario: assertions, budgets, expected diagnostics, replay/hash oracle, quality metrics                                                                        | Да — data-only `agent-eval` (исполняет testkit/headless host, не сам artifact)                                |

Extensions добавляют game/format-specific tools/skills/knowledge/evals без core switch (обычные
contribution kinds через `contributionManifests`). SC2 extension даёт skills для catalog data,
Galaxy, triggers, layouts, maps, dependencies; common — только действительно общие.

### 1.3 Обязательные классы tools

discover/open/identify subjects+formats; query schemas/field help/defaults/allowed values/
provenance; relations (out/in/multi-hop) + usages/examples; localization resolve/compare;
inspect/render models/maps/images/audio/UI/entity cards; language diagnostics/references/
completion-queries/semantic validation **без обязательного LSP transport**; generate/patch
data/scripts/triggers/layouts/localization через transactions; convert/import/export c
fidelity/loss reports; validate references/dependencies/manifests/schemas/packaging; compile mod →
receipt inspect; bounded headless scenarios (pause/step/query + deterministic traces); run
scripts/mechanics/AI под budgets; record/replay/seek/compare + divergence explanation;
screenshots/previews как evidence artifacts; batch AI/balance/regression evaluation.

Результаты — structured facts со stable IDs/source locators, не prose dumps: context budget не
растёт линейно с размером мода. Semantic indexes — optional derived cache; authoritative — exact
schema/relation queries.

### 1.4 Безопасный authoring workflow

```text
inspect exact sources and schemas
  -> propose typed patch/transaction -> dry-run + diagnostics + relation impact
  -> human/policy approval when required -> commit transaction
  -> validate + render/compile -> headless simulation -> replay/receipt/evidence report
```

Permission classes (минимум): `read`, `workspace-write`, `conversion`, `code-script-execution`,
`headless-simulation`, `network-egress`, `secret-key-access`, `external-process-game-launch`,
`publishing`. Scoped handles, quotas, timeouts, cancellation, audit log, artifact retention.
Content/docs/localization/sources — **untrusted data**: текст мода не может объявить себя
instruction, запросить permission или вызвать tool; prompt-injection и poisoned-knowledge fixtures
входят в security conformance (24).

### 1.5 Route AI-0…AI-6

| Slice | Result                                                                             | Dependency                             |
| ----- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| AI-0  | Typed operation catalog, schemas, errors, permissions, protocol-neutral invocation | Modkit S0–S3                           |
| AI-1  | Read-only SC2 investigation skill (schema/help/relations/localization/preview)     | existing features + optional providers |
| AI-2  | Transactional patch/dry-run/impact/validation                                      | write + language operations            |
| AI-3  | Trigger/script generation + diagnostics + source evidence                          | SC2 language/trigger contributions     |
| AI-4  | Compile + headless simulation + replay validation skill                            | Gate G0 P4–P6                          |
| AI-5  | Extension-contributed skills/knowledge/evals вне monorepo                          | testkit + external extension proof     |
| AI-6  | Batch AI/balance/regression service profile                                        | stable headless runtime + profiling    |

CLI/direct-SDK adapter first; MCP/HTTP/model-provider adapters — optional поверх. Шесть
end-to-end proof workflows (§7.4 брифа): SC2 entity investigation; faction generation
(reviewable patch, не перезапись); trigger/script workflow c fidelity-отчётом; visual evidence;
simulation validation; AI-agent evaluation без privileged omniscient state.

## 2. Knowledge/help/encyclopedia plane

### 2.1 Четыре локализационных домена (не смешиваются)

1. **Product UI localization** — labels/menus/commands/diagnostics/settings/accessibility;
2. **Schema/field help** — смысл типов/полей, short+long описания, examples, warnings, versions;
3. **Subject/encyclopedia knowledge** — статьи о entities/formats/maps/scripts/mechanics/tools;
4. **Game-content localization** — строки самой игры/мода (owner — game codecs), не подменяет 1–3.

Contribution kinds (data-only, без executable authority): `localization-bundle` (домен 1),
`knowledge-pack` (домены 2–3). Оба — contract-typed views над общим inventory/resolver, не новый
stateful registry.

### 2.2 Stable target identity

Field help привязывается к versioned exact identity, не к display-строке:

```text
schema/contract coordinate + schema revision/compatible range
+ stable type/entity-kind identity + canonical field identity / schema pointer
+ optional ecosystem/game/profile scope
```

Knowledge для subject — через typed subject/format/relation selectors; identity subject не
меняется. Install/remove help-pack не ломает bookmarks/relations/editor state/compilation. Для
SC2 field это даёт: локализованное display name; short описание (grid/hover); long (panel/
encyclopedia); type/default/allowed values/inheritance из **authoritative schema**; examples и
real usages через relations; warnings/version applicability; related fields; внешние ссылки;
provenance/license/confidence/last-reviewed. Help поясняет, но не становится schema authority; UI
и AI различают `schema fact` / `documented interpretation` / `community note` /
`external reference`.

### 2.3 Locales и fallback

Стандартные locale tags; deterministic fallback:
`exact (pt-BR) → parent (pt) → user fallback → contribution source locale → built-in bootstrap`.
Typed placeholders, plural/select, number/date/unit formatting, safe rich text; executable
HTML/scripts в bundles запрещены; отсутствующий перевод — явный fallback, не пустая строка.
Каждый extension владеет source messages своего UI; независимый language-pack переводит чужой UI
через exact publisher-qualified namespace + compatible range; конфликты решает deterministic
policy, не discovery order. Minimal app несёт малый bootstrap catalog (startup/errors/выбор
языка) до activation extensions.

### 2.4 Standalone knowledge library и packaging

`docs/game-file-formats-encyclopedia` — prototype/source corpus; целевая библиотека может жить в
отдельном repository (сайт/доки публикует сама) с portable build tool:

```text
standalone knowledge-library repo (Markdown + metadata + sources/licenses/locales)
  -> validate/build/select -> versioned portable KnowledgePack artifact
  -> embed snapshot в game/codec/common extension ИЛИ отдельный knowledge extension
  -> Modkit UI / headless API / AI skills / third-party consumers
```

Runtime/extension не зависят от checkout библиотеки. Embedded pack несёт source coordinate/
revision, content digest, selected entries, locale coverage, licenses/attribution, target
compatibility; standalone reader читает тот же artifact без Modkit.

Гибридная дистрибуция (правило выбора): жёстко связано со schema/codec version → embed рядом;
большое/быстро меняющееся/отдельный автор/язык/полезно без codec → отдельный knowledge extension.
`common` — только bounded curated baseline (платформа, universal concepts, самые общие форматы),
не вся энциклопедия. Домены-корпуса (`media`, `archives`, `documents`) — отдельные packs при
реальном размере/спросе.

Markdown — authored authority, но host не сканирует произвольные `.md`: extension публикует
strict knowledge contribution (manifest/index связывает entry/anchor с exact
format/schema/field/subject identity; один файл может нести много addressable entries; short
descriptions — в manifest/sidecar, long body — в Markdown). При install/build: front-matter
schema validation; запрет MDX/scripts + sanitize HTML/links; проверка anchors/locales/
placeholders/target revisions/licenses; derived search index у lifecycle owner (не root
generated); byte/content digest + source revision; partial selection. Copied snapshot ≠ upstream
live version (разные provenance). Обновление pack не меняет codec behavior, subject identity,
compiled content или deterministic hash.

### 2.5 Encyclopedia/UI composition

Одна knowledge model питает: hover/inline help; grid/table/tree descriptions; help panel;
entity/subject card + полную encyclopedia page; format/codec inspection page; relations/examples
browser; full-text/semantic search; AI tools `getFieldHelp`/`getSubjectKnowledge`/
`searchKnowledge`/`explainDiagnostic`. Subject page — composition (identity + schema facts +
effective values/provenance + relations/usages + localization + previews из optional codecs +
knowledge sections + external refs), не giant wiki DTO. Отсутствие renderer'а не убивает page.
Headless AI получает то же без UI package. Search authority — installed packs/schemas/sources;
результат несёт exact refs + locale/fallback. Внешние wiki не цитируются как проверенный fact без
provenance/confidence; защищённый контент не копируется без разрешения (excerpts + attribution).

### 2.6 Route KH-0…KH-6

| Slice | Result                                                                                     | Proof                                                                               |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| KH-0  | Stable help/knowledge targets, locale fallback, typed query contracts                      | schema fixtures + conflict/fallback tests                                           |
| KH-1  | Standalone validator/selector → portable pack; extension встраивает Markdown subset        | runtime без checkout; digest/revision/license сохранены; standalone reader проходит |
| KH-2  | Common UI source catalog + независимый language pack + curated common-format help          | старт, смена locale, отчёт о fallback без executable activation                     |
| KH-3  | SC2 field-help pack для одной complete entity chain (codec-coupled subset + optional full) | short/long help, links, version scope, provenance, usage queries                    |
| KH-4  | Subject/entity encyclopedia composition                                                    | properties+relations+strings+previews+knowledge в одном page/API result             |
| KH-5  | Headless AI knowledge tools                                                                | AI-1 цитирует exact field/source/locale; fact ≠ interpretation                      |
| KH-6  | Внешний repository добавляет locale/help augmentation                                      | deterministic resolution; direct-library/testkit; без core change                   |

Authoring/validation tools для packs: missing keys, placeholder mismatch, stale schema targets,
broken/suspicious links, untranslated text, duplicate/conflicting entries, unsafe markup,
attribution completeness, coverage report. 100% coverage не требуется: partial pack явно
показывает scope и fallback.

## 3. Карта владельцев

| Материал                                                                                  | Владелец                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Operations/offers/resolution                                                              | 23, 06, ASSET_CAPABILITIES §5                  |
| Permissions/grants/untrusted content/injection fixtures                                   | 24                                             |
| Contribution kinds (`agent-skill`, `agent-eval`, `knowledge-pack`, `localization-bundle`) | 27 §6 (envelope) + этот документ (spec-shapes) |
| Distribution/packs/каталоги                                                               | 28                                             |
| Format knowledge (FormatDefinition)                                                       | 30 — knowledge-pack ссылается, не дублирует    |
| Game-content localization                                                                 | game codecs (sc2-strings и др.)                |
| Engine-side headless/eval hosts                                                           | multiverse (ROADMAP_ENGINE §8 stages 15–16)    |
