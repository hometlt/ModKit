# 23. Contract Identity, Schema, Resolution, and Lock

Status: **non-canonical design draft**  
Canonical: [`../architecture/MODKIT_ARCHITECTURE.md`](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **normative-candidate for provider resolution v1 only**  
Updated: 2026-08-10

Этот документ уточняет identity/version/schema model virtual contracts, deterministic provider
resolution и project lock. Он развивает
[02-capabilities-and-contracts.md](02-capabilities-and-contracts.md),
[03-providers-and-resolution.md](03-providers-and-resolution.md) и
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

Примеры TypeScript/JSON здесь иллюстративны до утверждения canonical schemas.

## 1. Решение

Contract, provider, extension package и runtime variant имеют независимые identity/version. Consumer
запрашивает logical contract и требуемый результат, resolver фильтрует offers по совместимости,
permissions и runtime target, применяет explicit preferences/ranking и записывает точное решение в
machine activation result. Portable project lock сохраняет только logical provider policy; exact
artifacts/composition принадлежат install/session records. Hot path получает compiled numeric plan и
не выполняет semver/string resolution.

```text
logical request
    ↓ constraints
compatible offers
    ↓ target + permissions
ranked candidates
    ↓ explicit composition
provider-policy lock + machine activation snapshot
    ↓ link/codegen
compiled session plan
```

## 2. Разные identity

Один identifier не используется для четырёх ролей:

| Роль            | Пример                                        | Что version означает                |
| --------------- | --------------------------------------------- | ----------------------------------- |
| Contract        | `common.image/decoded` + major `1`            | совместимость logical API/schema    |
| Provider        | `org.modkitx/dds` + version `3.2.0`           | версия реализации и behaviour       |
| Extension       | `org.modkitx.common/images` + version `2.0.0` | состав поставки/contributions       |
| Package         | `@vendor/media-tools@2.4.1`                   | artifact distribution version       |
| Runtime variant | `portable` внутри provider version            | build/target конкретного entrypoint |

Package rename или перенос реализации в другой repository не меняет contract identity.

## 3. Namespace policy

Все новые logical IDs, кроме уже существующей grammar operation/trait IDs, используют qualified
форму. Version хранится отдельным полем; `@<major>` допускается только как display в lock/diagnostic.

```abnf
lower       = %x61-7A
digit       = %x30-39
atom        = 1*(lower / digit)
segment     = atom *("-" atom)
dotted      = segment *("." segment)
namespace   = dotted
name        = segment *("." segment)
qualified   = namespace "/" name
semver      = <valid SemVer 2.0.0 string>

contract-id  = qualified
provider-id  = qualified
extension-id = qualified
error-code   = qualified
world-id     = qualified
contract-display-id = qualified ["@" 1*digit]
release-coordinate  = qualified "@" semver
```

Примеры:

```text
common.image/decoded
common.table/view
multiverse.world/transform
multiverse.rts/orders
multiverse.rts/shield-state
blizzard.sc2/shield-regeneration-system
ea.sage/directional-armour
org.modkitx/permission-denied
```

Provider ID совместим с существующим codec coordinate `publisher/id`. Existing operation IDs
(`model.render`, `image.read`, codec-local verbs) и trait IDs (`image.raster`) сохраняют свои уже
валидируемые grammars; они не притворяются contract IDs.

Role table закрывает случаи, которые нельзя оставлять как `string // contract-specific` без
validator-а:

| Роль                                                                             | Grammar                                                | Version placement                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| contract, provider, contribution, extension, error, preset, World/profile/system | `qualified`                                            | отдельное поле; contract display может добавить только major             |
| extension release/artifact coordinate                                            | `qualified@semver`                                     | только display/catalog coordinate, identity и version хранятся раздельно |
| trait, operation                                                                 | существующая validated dotted grammar                  | semantic/descriptor version отдельно                                     |
| runtime variant                                                                  | один `segment`, уникальный внутри contribution version | build/artifact/ABI отдельно                                              |
| unresolved reason                                                                | закрытый kebab-case enum из document 23                | не является diagnostic/error ID                                          |
| diagnostic/error code                                                            | `qualified`                                            | definition version отдельно                                              |

Один actor/extension использует canonical namespace во всех новых IDs. Legacy aliases вроде
`org.modkitx.sc2/*`, `warzone2100.game/*` или dotted `provider.missing` разрешаются только через
явную migration table; они не создают вторую identity. UI labels и native schema field names могут
сохранять оригинальное написание.

Правила:

1. Любое extension может публиковать contract в namespace, которым оно владеет.
2. Экспериментальный contract не обязан ждать изменения core.
3. Общий `common.*`/`multiverse.*` contract проходит review/governance и conformance.
4. Похожее имя не означает совместимость.
5. Несовместимая semantics получает другой ID или major.
6. Package registry не является authority contract namespaces.

### 3.1 Extension publisher, vendor и contribution identity

Publisher является authority/distribution namespace, а не утверждением авторства исходного file
format. First-party extensions сохраняют существующую группировку
`org.modkitx.<group>/<extension-id>`; original vendor/project хранится отдельным metadata field. Нельзя
использовать namespace Blender/Adobe/Autodesk как publisher, если extension ими не публикуется.

Extension coordinate и contribution/provider coordinate независимы. Текущий generated catalog
содержит 233 codec/game entries (snapshot 2026-08-11); существующие contribution coordinates
используют плоскую форму `org.modkitx/<id>`, тогда как extension
packages уже используют grouped publishers (`org.modkitx.blizzard/starcraft-2`,
`org.modkitx.common/images` и т. п.). V2 adapter обязан сохранить существующий full contribution
coordinate явно; перенос contribution под extension не переименовывает provider/codec и не меняет
deterministic tie-break.

Новый contribution manifest хранит собственный qualified `id`, а generated catalog отдельно
добавляет owning `extensionId`. Наследовать full contribution coordinate из extension
`publisher/id` запрещено. Намеренная future смена coordinate требует migration map, lock/resolver
version bump и shuffled-order regression fixture; она не выполняется как побочный эффект manifest
v2.

## 4. Version model

Contract identity является парой `(contractId, major)`. Request может потребовать:

```text
exact       =1.4.2
compatible  ^1.3
range       >=1.2 <2
major       1.x
any         version omitted
```

Display может показывать:

```text
common.image/decoded@1
common.image/decoded@2
```

Они могут сосуществовать в repository и разных composition scopes, но не смешиваются в одном
handle/storage автоматически. Переход требует explicit bridge/projection/migration provider.

## 5. Два schema planes

### 5.1 Control plane schema

JSON Schema описывает serializable данные:

- manifests;
- trait descriptors and coarse codec capabilities;
- operation requests/results;
- provider offers;
- diagnostics/errors;
- lock files;
- command envelopes;
- editor/automation transport.

Control plane оптимизирован для introspection, validation, RPC и compatibility tooling, а не для
покадрового доступа к тысячам components.

**Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable).** `contract-definition-spec.v1` (обе ветки) получил optional поле `surface` (method
surface, документ [32](32-execution-boundary-and-method-surfaces.md) §3): схема — `oneOf` двух ветвей метода (только `lease` несёт `result`/`wrapper`),
ручной TS‑тип совпадает с выводом FromSchema (drift‑gate `packages/sdk/test/schema-drift.ts`),
семантика вне схемы (`releaseVia` называет `value`‑метод; поле ≠ метод) — в
`validateContractDefinitionSemantics`; standalone CSP‑safe validators эмитятся для surface и
method‑surface. Это control‑plane данные: они описывают вызовы, но не дают исполняемой authority.

### 5.2 Data/ABI schema (gated future)

После World/performance gate отдельная ABI schema может описывать:

- numeric scalar representation;
- alignment/layout;
- handles;
- arrays/strings/blobs;
- resource ownership;
- command/event buffers;
- component columns;
- Rust/WASM/native bindings.

Control schema может позже ссылаться на ABI schema, но JSON shape не становится memory layout.
Resolver v1 не требует IDL, ABI schema или Rust/WASM code generation.

## 6. Semantic schema fingerprint (gated future)

Hash вычисляется не из исходных bytes schema file, а из нормализованной semantic schema.

В fingerprint входят:

- stable field/type IDs;
- primitive/aggregate types;
- required/optional semantics;
- defaults, влияющие на interpretation;
- enum/variant values;
- numeric profile;
- ABI-relevant layout/ownership annotations;
- declared semantic constraints.

Не входят:

- formatting;
- порядок независимых object keys;
- prose descriptions;
- examples;
- source paths;
- documentation URLs.

```ts
interface SchemaIdentity {
  readonly contract: ContractId
  readonly major: number
  readonly semanticFingerprint: string
  readonly abiFingerprint?: string
}
```

Конкретные canonicalization/hash algorithms остаются открытой implementation decision. До их
утверждения нельзя публиковать stable fingerprints или использовать их как обязательный ключ
resolver/cache v1. Resolver proof использует contract major, provider/version и conformance
fixtures; semantic fingerprint возвращается в normative contract только после отдельного
canonicalization proof.

## 7. Compatibility proof

Совместимость не определяется только SemVer и не может быть полностью выведена из structure.

```text
structural schema diff
    + author compatibility declaration
    + conformance fixtures
    = accepted compatibility edge
```

Structural tooling проверяет fields/types/layout. Автор описывает semantic change. Conformance
fixtures подтверждают behaviour на известных inputs/outputs. Ошибка в любом слое блокирует
публикацию совместимого range.

## 8. Normative-candidate provider types v1

Это единственное определение `ProviderOffer`, `ProviderRequest` и `ResolutionResult` в proposal.
Остальные документы обязаны ссылаться сюда.

```ts
type ContractId = string
type ProviderId = string
type ExtensionId = string
type TraitId = string

interface ContractRequirement {
  readonly contract: ContractId
  readonly major: number
  readonly range?: string // default '*', обязан оставаться внутри major
}

type RequirementMode = 'required' | 'default' | 'suggested' | 'integrates'
type RequirementScopeKind =
  'contribution' | 'offer' | 'operation' | 'intent' | 'variant' | 'profile' | 'projection' | 'slot'

interface ScopedContractRequirement extends ContractRequirement {
  readonly mode: RequirementMode
  readonly scope: {
    readonly kind: RequirementScopeKind
    readonly id: string
  }
}

interface ContractOffer {
  readonly contract: ContractId
  readonly version: string // exact SemVer
}

type RuntimeTarget = CodecRuntimeTarget

type RuntimeTargetConstraint = Pick<
  CodecRuntimeVariant,
  | 'environments'
  | 'operatingSystems'
  | 'architectures'
  | 'requiredHostCapabilities'
  | 'requiredWebApis'
  | 'externalTools'
>

type ProviderOfferKind = 'primary' | 'replacement' | 'augmentation' | 'projection' | 'operation'

interface OfferHeader {
  readonly extensionId: ExtensionId
  readonly extensionVersion: string
  readonly providerId: ProviderId
  readonly runtimeVariant: string
  readonly target: RuntimeTargetConstraint
  readonly requiredPermissions?: readonly CodecPermissionClass[]
}

interface ProviderOffer extends OfferHeader {
  readonly kind: ProviderOfferKind
  readonly provides: readonly ContractOffer[] // минимум один
  readonly requires?: readonly ContractRequirement[]
  readonly outputs?: readonly TraitId[]
  readonly operations?: readonly string[]
  readonly augments?: ContractRequirement // только augmentation
  readonly replaces?: ContractRequirement // только replacement
  readonly limitations?: readonly string[]
}

interface ProviderRequest {
  readonly contract: ContractRequirement
  readonly target: RuntimeTarget
  readonly operation?: string
  readonly requiredOutputs?: readonly TraitId[]
  readonly preferredOutputs?: readonly TraitId[]
  readonly workload?:
    'thumbnail' | 'interactive' | 'batch' | 'lossless-edit' | 'simulation' | 'archival'
  readonly optional?: boolean // default false
  readonly pin?: {
    readonly providerId: ProviderId
    readonly runtimeVariant?: string
  }
}

type UnresolvedReason =
  | 'no-offer'
  | 'version-incompatible'
  | 'target-incompatible'
  | 'permission-required'
  | 'external-tool-required'
  | 'output-missing'
  | 'ambiguous'
  | 'pin-unsatisfied'

interface ResolvedProvider {
  readonly offer: ProviderOffer
  readonly resolvedContract: ContractOffer
}

interface RejectedCandidate {
  readonly providerId: ProviderId
  readonly runtimeVariant: string
  readonly reason: UnresolvedReason
  readonly detail?: string
}

type ResolutionResult =
  | {
      readonly state: 'resolved'
      readonly selected: ResolvedProvider
      readonly alternatives: readonly ResolvedProvider[]
      readonly rejected: readonly RejectedCandidate[]
    }
  | {
      readonly state: 'unresolved'
      readonly reason: UnresolvedReason
      readonly rejected: readonly RejectedCandidate[]
    }
```

`ContractRequirement` внутри `ProviderOffer.requires` имеет неявный scope текущего offer и mode
`required`. Manifest/install composition использует явный `ScopedContractRequirement`:

- `required` блокирует только названный scope и входит в install plan только когда этот scope
  requested/selected;
- `default` — отклоняемое предпочтение composition, не activation block; unattended host применяет
  его только по explicit product policy и не выдаёт trust/permissions;
- `suggested` всегда остаётся видимой, но не выбранной молча опцией;
- `integrates` связывается только если обе стороны уже доступны и не создаёт install edge,
  activation order или missing-dependency error.

Отсутствующий operation/variant/projection requirement не отключает остальные contributions
extension. Contribution не имеет независимой release version: exact extension release/artifact и
runtime variant фиксируются в install/activation record; contract compatibility задаётся
`ContractRequirement`. Поэтому provider pin не содержит отдельный `providerVersion`.

`RuntimeTarget` не является новым DTO: это нормативный alias существующего concrete
`CodecRuntimeTarget`. `RuntimeTargetConstraint` переиспользует constraint-поля существующего
`CodecRuntimeVariant`, но permissions намеренно вынесены из target constraints: target и security
проверяются разными стадиями. JSON names (`hostCapabilities`/`requiredHostCapabilities`)
сохраняются в v1; возможный future TypeScript alias `facilities` не блокирует resolver proof и не
требует manifest migration.

Execution profile/lifecycle относятся к activation host, а не к operation resolver v1. World
profile/component/system/binding не добавляются в `ProviderOfferKind`; для них используется
отдельный `WorldOffer` из
[26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md).

Request не содержит raw bytes/private handles. Bounded detection остаётся существующим
`FormatRegistry`/codec matching stage и только затем формирует contract request.

`ProviderOfferKind` резервирует будущие формы композиции, но resolver v1 исполняет только
`primary` и совместимый `replacement`. `augmentation`, `projection` и `operation` не получают
частичную скрытую реализацию: до соответствующего proof они возвращают явную unsupported-kind
diagnostic на своей границе. Contribution является manifest/discovery envelope и потому не является
`ProviderOfferKind`.

## 9. Resolution algorithm v1

Для v1 используется объяснимый staged resolver, не полный SAT solver:

1. Найти installed offers требуемого `(contractId, major)`.
2. Проверить exact offer version против request range.
3. Проверить concrete target против target constraints.
4. Проверить granted permissions/external tools и что `outputs` удовлетворяют
   `requiredOutputs` request-а.
5. Применить exact pin, если он задан.
6. Применить operation/workload и `preferredOutputs` как детерминированный preference tuple без
   self-declared numeric priority.
7. При одном лучшем candidate выбрать его.
8. При неразрешимом равенстве вернуть `ambiguous`, а не использовать discovery order.
9. Сортировать protocol IDs и canonical artifacts побайтовым UTF-8 comparison, не
   locale-dependent `localeCompare`. Для ASCII grammar logical IDs обычное JS-сравнение `a < b`
   является эквивалентной реализацией; UI/display sorting может оставаться locale-aware.
10. Записать selected identity в project lock.

Self-declared priority, directory/install order и host locale не выбирают provider. Augmentation DAG,
conformance-evidence ranking и World system linking не входят в resolver v1.

## 10. Ranking и workload

Provider выбирается для конкретной operation/workload:

```text
thumbnail        low startup, browser-safe
interactive      low latency, cancellable
batch-convert    throughput
lossless-edit    fidelity and transaction support
simulation       deterministic ABI
archival         exact preservation
```

Native implementation не получает глобальный приоритет. Для маленького preview TypeScript может
быть лучше native process, а для массового decode предпочтителен native/WASM provider.

## 11. Portable project provider-policy lock

Project lock хранит operation-provider decision. Он не является
[install lock документа 28](28-extension-distribution-catalog-installation-and-product-discovery.md)
или World composition lock. Коммитируемый project record является **provider-policy lock**: он
фиксирует переносимый семантический выбор, но не machine-local activation:

```ts
type WorkloadIntent =
  'thumbnail' | 'interactive' | 'batch' | 'lossless-edit' | 'simulation' | 'archival'

interface ProviderLockKey {
  readonly contract: ContractId
  readonly major: number
  readonly normalizedRange: string // default '*' после canonical normalization
  readonly operation?: string
  readonly requiredOutputs: readonly TraitRequirement[] // canonical range, unique, UTF-8 sorted
  readonly preferredOutputs: readonly TraitRequirement[] // canonical range, unique, UTF-8 sorted
  readonly workload?: WorkloadIntent
}

interface ProviderPolicySelection {
  // BRIEF-7: после отмены собственной contribution-версии identity выбора остаётся однозначной:
  readonly extension: ExtensionCoordinate // publisher-qualified, например 'org.example/homeworld'
  readonly releaseRange?: string // допустимый диапазон extension releases; default '*'
  readonly contributionId: string // provider/contribution id внутри extension
  readonly contractMajor: number
  /** Logical offer selected inside a contribution; required when one provider publishes several. */
  readonly offerId: string
  /** Contract-owned canonical, non-secret matcher result; raw facets never enter the lock. */
  readonly contractSelectionKey?: string
  // Exact release version, artifact digest и runtime variant сюда НЕ входят: точный acquired
  // artifact — в install lock (28 §7), выбранный variant/digest — в machine activation snapshot,
  // а deterministic composition — в session lock. Portable policy остаётся переносимой.
}

interface ProviderPolicyLockEntry {
  readonly key: ProviderLockKey
  readonly primary: ProviderPolicySelection
  readonly allowedFallbacks?: readonly ProviderPolicySelection[]
  readonly resolverVersion: number
}
```

Range, version-aware required/preferred outputs и workload входят в key, потому что могут изменить
выбор. Comparator order/spelling canonicalizes before serialization. `offerId` and an optional
contract-owned `contractSelectionKey` preserve the selected logical offer without serializing raw
request/offer facets or secrets.
OS/architecture, runtime variant, concrete artifact, external tool path, facilities и grants в этом
lock отсутствуют. Machine-local activation resolver выбирает совместимый installed/embedded artifact
variant в рамках `primary`/`allowedFallbacks` и возвращает explicit unavailable diagnostic, если это
невозможно. Он не переписывает provider-policy lock и не добавляет fallback сам.

Provider-policy lock не содержит credentials/secrets, catalog URL, installation path, runtime objects
или selected artifact. Install artifact/version/hash/signature/catalog provenance и target-scoped
acquisition принадлежат install lock документа 28. Exact activated semantic composition/content,
включая нужные artifact attestations, принадлежит session composition/compatibility envelope.
Schema/storage/system slots/overlay order принадлежат `WorldCompositionLock`. Изменение
`resolverVersion` помечает старые entries stale и требует явного lock refresh; silent re-resolution
запрещён.

## 12. Session fingerprint

Session получает fingerprint из:

- project lock;
- schema/ABI fingerprints;
- runtime binaries/build identities;
- numeric/time profiles;
- relevant source revisions;
- compiled system/storage plans.

Replay, snapshot и deterministic test сохраняют fingerprint или ссылку на него. Несоответствие не
замалчивается и приводит к compatibility diagnostic либо explicit migration/emulation mode.

## 13. Composition distinctions

Data overlay, cooperative augmentation и executable replacement являются разными operations:

```text
data overlay       declared ordered layer
augmentation       cooperative contribution with dependencies
replacement        one winner in declared exclusive slot
projection         derived representation, source unchanged
bridge             explicit cross-contract conversion
```

Operation resolver v1 понимает только provider offers. World linker отдельно понимает components,
profiles, systems, slots и overlays. `last loaded wins` и directory enumeration order запрещены в
обоих protocols.

## 14. Fallback boundary

Fallback разрешается только если это допускают operation и error definition:

- probe/resolution;
- read-only preview до observable commitment;
- recoverable unavailable target;
- optional projection.

Fallback запрещён:

- после частичной mutation;
- внутри locked deterministic session;
- после нарушения invariant/corruption;
- при несовместимом schema fingerprint.

Подробный lifecycle/failure policy описан в
[24-extension-security-execution-and-lifecycle.md](24-extension-security-execution-and-lifecycle.md).

## 15. Examples

### M3

```text
request: common.model/preview, major 1

offers:
    org.modkitx/m3-preview
    test.alternative/m3-preview

augmentation:
    org.modkitx/m3-animations
```

Preview и animation augmentation могут прийти из разных extensions. Exact provider выбирается по
target/workload и фиксируется lock. Первый proof использует две TypeScript implementations; native/
WASM fixture не требуется до появления реального variant.

### Foundation preset

```text
multiverse.foundation/rts, major 1
    requires ranges:
        multiverse.world/spatial, major 1, range ^1
        multiverse.rts/orders, major 1, range ^1
        multiverse.rts/combat, major 2, range ^2
```

Preset имеет собственную version, mechanics — независимые versions, lock — exact versions.

### Install/feature preset

```text
org.modkitx.blizzard/sc2-authoring
    requires contracts: sc2.data/read, sc2.layout/language
    suggests contracts: common.image/decoded, common.model/preview
```

Это data-only user-intent selection, а не provider и не install solver. Discovery может показать
missing/satisfied requirements без исполнения кода. Catalog/install resolver документа 28 сможет
принять preset как input, но S3 operation resolver не выполняет remote lookup и ничего автоматически
не устанавливает.

### Contract bridge

Bridge contribution явно объявляет source contract/major, target contract/major, loss/guarantees и
provider requirements. Operation resolver v1 возвращает для него `unsupported-kind`; будущий
resolver применяет bridge только по explicit request/policy и записывает exact bridge provider в
lock/trace. Совпадение имён или отсутствие direct provider не разрешает неявную bridge chain.

## 16. Инварианты

1. Contract identity не равна package identity.
2. Similar names не создают compatibility.
3. Major versions не смешиваются без bridge.
4. Provider не выбирает себя self-priority.
5. Install order не влияет на lock.
6. Resolver отсутствует в hot path.
7. Lock не содержит secrets.
8. Session не меняет provider implementation без explicit migration.
9. Schema documentation change не меняет future semantic fingerprint.
10. Stable fingerprinting требует published normalization/conformance rules и не блокирует
    resolver v1.
11. Detection catalog и activation/provider catalog имеют разные keys и не схлопываются.
12. Extension ownership не меняет independent contribution/provider coordinate.

**Инвариант, Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable):** surface контракта — часть его definition; ни host, ни транспорт, ни
приложение не держат параллельного словаря методов и не угадывают surface foreign‑контракта.

## 17. Acceptance criteria

- Два providers одного contract разрешаются одинаково при разном порядке discovery.
- Exact pin выбирает нужный provider либо даёт structured incompatibility diagnostic.
- Native Windows offer не выбирается на Linux/web target.
- Read-only recoverable provider failure может выбрать locked alternative policy.
- Mutating provider failure не запускает скрытый fallback.
- Contract majors `@1` и `@2` сосуществуют только через разные handles или explicit bridge.
- Изменение schema description не меняет fingerprint; изменение field type меняет.
- Lock round-trip deterministic и не зависит от object/directory order.
- Два requests, различающиеся range, required/preferred outputs или workload, не коллидируют.
- Один portable policy request не содержит OS/architecture/variant/facility/grant facts.
- Недоступный logical primary не вызывает silent fallback вне explicitly allowed policy.
- Session fingerprint меняется при замене runtime binary/schema/system plan.
- V1-to-v2 manifest adapter сохраняет current contribution coordinates и byte-identical
  coordinate-based codec matching order.

## 18. Следующие шаги

1. Утвердить canonical control-schema dialect.
2. Зафиксировать JSON schemas request/offer/result/lock и canonical UTF-8 ordering.
3. Разделить detection registrations `(codecId, environment)` и activation offers
   `(codecId, variantId, environment)` без потери runtime variants.
4. Реализовать deterministic staged resolver без activation кода.
5. Сделать два TypeScript proof: DDS/M3 preview choice и только позднее RTS mechanic/system slot.
6. Добавить explanation trace: почему candidate принят/отклонён.
7. После отдельного gate определить normalized semantic schema AST и domain-separated hash.
8. Только после conformance рассматривать SAT-like dependency extensions.
