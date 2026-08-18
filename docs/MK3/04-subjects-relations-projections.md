# 04. Subjects, Relations, and Projections

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Subject provider

Subject provider собирает логический объект из workspace data:

```ts
interface SubjectProvider {
  readonly id: string
  readonly supportedKinds: readonly string[]

  canOpen(ref: SubjectRef, context: SubjectContext): Promise<boolean>

  open(ref: SubjectRef, context: SubjectContext): Promise<SubjectHandle>
}
```

Примеры:

- SC2 catalog entity;
- C&C object template;
- Warcraft object-data entity;
- localization matrix;
- mod summary;
- replay player/session;
- sheet, slide, design component;
- archive entry grouping;
- relation graph root.

## 2. Почему entity не нужно превращать в файл

SC2 Unit собирается из нескольких XML records, inheritance, actor graph, strings,
dependency mods и assets. У него нет единственного authoritative byte range.

Он имеет:

- stable subject address;
- source provenance для отдельных fields;
- semantic operations;
- relations к другим subjects/assets;
- optional derived previews.

Это честнее, чем создавать фиктивный `unit.json`.

## 3. Semantic relation roles

Единственная форма relation record определена в
[25 §13](25-subject-identity-editing-transactions-and-cache.md#13-relation-index). Список ниже —
кандидаты значения optional `semanticRole`, а не второй обязательный `role` field и не enum
provider-native relations.

Standard roles:

```text
visual.icon
visual.thumbnail
visual.primary-model
visual.texture
audio.voice
audio.music
audio.effect
localization.name
localization.description
code.embedded
code.generated
source.declaration
source.compiled
dependency.required
dependency.optional
```

Game extensions добавляют namespaced semantic roles:

```text
org.modkitx.blizzard.sc2/actor
org.modkitx.blizzard.sc2/weapon
org.modkitx.blizzard.sc2/ability
org.modkitx.blizzard.sc2/command-card
```

`semanticRole` описывает общий смысл связи. Provider-native `relation` хранит точный schema
field/path/edge kind; expected target traits/contracts принадлежат relation query/resolution, а не
заменяют саму relation identity.

## 4. Reference target

```ts
type SubjectReference =
  | { kind: 'subject'; ref: SubjectRef }
  | { kind: 'asset'; path?: string; logicalId?: string }
  | { kind: 'embedded'; parent: SubjectRef; embeddedId: string }
  | { kind: 'localization-key'; key: string; locale?: string }
  | { kind: 'query'; query: SubjectQuery }
```

Target не должен быть только абсолютным filesystem path. Workspace resolver учитывает
overlay, dependency chain, locale, archive nesting и CASC.

## 5. Relation resolution

```ts
interface RelationResolver {
  resolve(
    relation: SubjectRelation,
    context: ResolutionContext,
    signal?: AbortSignal,
  ): Promise<ResolvedRelation>
}
```

Resolved relation хранит:

- chosen target;
- alternatives;
- provenance chain;
- selected provider;
- capability satisfaction;
- diagnostics;
- cache key/revision.

## 6. Lazy graph

Relation graph потенциально огромен. API обязан поддерживать:

- direction;
- role/kind filters;
- depth/node limits;
- pagination/streaming;
- cancellation;
- cycle detection;
- explicit `truncated` state;
- provenance and source location.

Нельзя полностью раскрывать CASC, Unreal package или mod dependency graph для одного
hover.

## 7. Projection provider

Projection — pure или session-backed преобразование, которое не обязано иметь свой
физический формат.

```ts
interface ProjectionOffer {
  readonly id: string
  readonly consumes: TraitQuery
  readonly relationRoles?: readonly string[]
  readonly provides: readonly TraitRequirement[]
  readonly priority: number
}
```

Examples:

| Input                            | Output                    |
| -------------------------------- | ------------------------- |
| `PropertyGraph`                  | `TableCollection`         |
| `LocalizationWorkspace`          | comparison table          |
| `Scene3D`                        | thumbnail/image frames    |
| `AudioStreams`                   | waveform                  |
| `MapDocument`                    | terrain/pathing images    |
| SC2 Unit + model relation        | model preview attachment  |
| SC2 Unit + actor/sound relations | voice-line collection     |
| embedded text + source map       | virtual language document |

## 8. SC2 Unit subject

Native description:

```text
Subject: modkit-vfs://workspace/#blizzard.sc2%2Funit/Marine

Traits:
  content.metadata
  game.catalog
  org.modkitx.blizzard.sc2/unit-stats
  org.modkitx.blizzard.sc2/command-card

Operations:
  edit.field
  asset.validate
  asset.compare

Relations:
  visual.icon
  visual.primary-model
  localization.name
  localization.description
  audio.voice
  org.modkitx.blizzard.sc2/actor
  org.modkitx.blizzard.sc2/weapon
  org.modkitx.blizzard.sc2/ability
  source.declaration
```

### Degradation levels

| Installed providers  | Result                                     |
| -------------------- | ------------------------------------------ |
| Только SC2 Data      | Raw IDs, properties, provenance, relations |
| + SC2 Strings        | Localized name/description                 |
| + DDS/image provider | Icon previews                              |
| + M3/model provider  | 3D model stage                             |
| + audio providers    | Voice/effect playback                      |
| + Galaxy provider    | Embedded/generated code navigation         |

Ни один optional row не меняет возможность открыть Unit.

## 9. Entities разных игр

Не создаётся общий `Unit` DTO с фиксированными health/minerals/abilities.

Shared level:

```text
SubjectIdentity
MetadataGroup
Typed relations
Operations
Diagnostics
Provenance
Viewer slots
```

Game level:

```text
SC2 Unit capabilities
C&C ObjectTemplate capabilities
Warcraft ObjectData capabilities
Spring UnitDef capabilities
```

Generic viewer показывает общие metadata/relations. Game contribution добавляет
специализированные stats, command grid, tech tree и editors.

## 10. Localization workspace subject

Каждый locale file остаётся отдельным asset. Aggregator создаёт subject:

```text
modkit-derived:localization.matrix/<inputs-hash>

Capabilities:
  game.localization
  table.sheets
  table.cells
  asset.search
  asset.compare

Relations:
  contains -> enUS catalog
  contains -> ruRU catalog
  contains -> deDE catalog
```

Каждая cell ссылается на source artifact, key и revision. Edit transaction изменяет
конкретный locale file без пересериализации остальных.

## 11. Excel workbook

```text
Workbook asset/subject
├── document metadata
├── table sheets
├── formulas
├── embedded images
├── external workbook references
└── child Sheet subjects
```

Current selected sheet является `view-session` state. Persisted active sheet является
отдельным document property и меняется operation.

## 12. Blender project

```text
Blend asset/subject
├── scene objects
├── mesh collection
├── materials
├── animations/timeline
├── embedded images
├── external companions
└── project metadata
```

Blend не обязан классифицироваться только как model или container. Category нужна
только для discovery/default routing.

### 12.1 UI document collection

```text
SC2Layout asset/root subject
├── template nested subjects
├── frame declaration nested subjects
├── style/constant nested subjects
├── animation nested subjects
└── embedded script/resource relations
```

Runtime frame instances не являются persisted child subjects: ими владеет `UiRuntimeSession`.
Screenshot/thumbnail является derived asset. Language declaration разрешается через
`SemanticLocation -> SubjectRef`, поэтому generic Subject Viewer может открыть template без
создания fake file. Полная модель описана в
[21-game-ui-layouts-rendering-and-bindings.md](21-game-ui-layouts-rendering-and-bindings.md).

## 13. Subject editing

Field descriptor хранит semantic location и write operation:

```ts
interface EditableSubjectField {
  readonly location: SemanticLocation
  readonly value: JsonValue
  readonly editor: EditorHint
  readonly writeOperation: string
  readonly readonlyReason?: string
}
```

Operation возвращает `ChangeSet` с source-level edits и expected revisions.

## 14. Переход от EntityCard

Текущая card assembly полезна как compatibility projection, но не должна оставаться
ядром data model.

Migration:

1. `iconAsset`, `modelAsset`, sounds и links превратить в relations.
2. Card sections строить projection provider из SubjectDescriptor.
3. Viewer contributions получать из глобального catalog.
4. SC2 actor/model derivation оставить в SC2 subject provider.
5. Generic card model оставить presentation projection, а не domain storage.

Целевой `entity-cards` package владеет этой game-neutral projection model и relation/card graph;
`@modkitx/viewer-shell/cards` только отображает модель в конкретной view session.
