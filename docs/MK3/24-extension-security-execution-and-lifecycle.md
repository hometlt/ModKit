# 24. Extension Security, Execution, and Lifecycle

Status: **non-canonical proposal / detailed design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **normative-candidate for extension security declarations/enforcement semantics**  
Updated: 2026-08-12

Other owners: current manifest/operation contracts in `@modkitx/assets` and
[Implementation Status](../IMPLEMENTATION_STATUS.md). This document is the **normative candidate**
for extension security declarations and honest host enforcement semantics.

Этот документ уточняет trust, mandatory permissions, execution isolation, provider lifecycle,
updates, failures и custom errors. Он развивает
[07-workspace-security-lifecycle.md](07-workspace-security-lifecycle.md),
[12-errors-and-diagnostics.md](12-errors-and-diagnostics.md) и
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

## 1. Решение

На текущей стадии явно локально установленное extension считается доверенным по подтверждённому
provenance: signature chain, catalog verification и quarantine не блокируют первые local proofs.
Target external distribution/catalog/install model определена в
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md),
но её наличие не означает, что enforcement уже реализован. Permission declarations и operation
dispatch policy проектируются deny-by-default. Trust не равен unrestricted execution, но in-process
Node code фактически сохраняет ambient authority.

```text
extension requests permissions
    ↓ host policy
operation receives grant
    ↓ nested calls may narrow only
execution adapter enforces what its boundary can enforce
```

`trusted-in-process` является осознанным исключением: host может проверять grants перед выдачей
brokered handles/вызовом operation, но не может тем же process запретить коду прямой `node:fs`,
`node:net` или process access. Это audit/policy boundary, не sandbox.

## 2. Trust и permission — разные понятия

| Понятие              | Вопрос                                                       |
| -------------------- | ------------------------------------------------------------ |
| Trust/provenance     | Кто поставил extension и разрешено ли активировать artifact? |
| Requested permission | Какой доступ extension считает необходимым?                  |
| Granted permission   | Что конкретный host/user/session разрешил?                   |
| Isolation profile    | Может ли host технически обеспечить ограничение?             |

Начальная политика:

- локально установленные extensions trusted;
- permission declaration обязательна;
- отсутствующее permission означает deny;
- trusted-in-process получает explicit full-process warning/grant;
- secrets никогда не записываются в manifest/lock/diagnostic.

Нужно различать четыре уровня утверждений:

1. **declared** — contribution запросила permission;
2. **dispatch-enforced** — host не вызвал operation без grant;
3. **broker-enforced** — side effect возможен только через выданный ограниченный handle/API;
4. **ambient-isolated** — execution boundary технически блокирует обход broker.

Node `trusted-in-process` обеспечивает 1–2 и частично 3, но не 4. Browser-safe bundle без Node
imports и WASM с ограниченными imports могут обеспечить более сильную границу.

Будущие signatures/trust levels добавляются поверх этой модели, не меняя operation/provider APIs.

### 2.1 Distribution, inventory и activation boundaries

Catalog query, installed-product matching и install planning не исполняют extension code. Exact
artifact digest проверяется до unpack/activation; source repository URL сам по себе не является
trust proof. Install mutation, native product inventory и external tool location являются отдельными
permissioned operations:

- inventory scan требует consent, bounded scope и path redaction policy;
- recommendation никогда не означает automatic install;
- update показывает permission/license/artifact diff до confirmation;
- installed lock не переписывается при catalog outage/new release;
- browser не получает native inventory без trusted bridge;
- revoked/yanked release диагностируется, но не удаляется и не заменяется молча.

## 3. Declarative security metadata with target-scoped review rows

До S3c единственный authored source — permissions и target requirements существующих
`codec.manifest.json#runtimeVariants`. В extension-manifest v2 те же поля принадлежат executable
`contribution.manifest.json#runtimeVariants`; именно variant остаётся авторитетным источником
requested permissions, target requirements и execution profile.

Release artifact дополнительно несёт review table — с BRIEF-6 она **generated projection**, а не
authored поле root-манифеста (см. simplification ниже). Таблица не повторяет
capabilities/operations/entrypoints и не выдаёт permissions. Строки сохраняют mutually exclusive
target variants раздельно; flat union допустим только как ещё одна generated projection:

```ts
interface ExtensionSecurityDeclaration {
  readonly schemaVersion: 1
  readonly permissionModel: 'contribution-runtime-variants'
  readonly runtimeVariants: readonly RuntimeVariantSecuritySummary[]
}

interface RuntimeVariantSecuritySummary {
  readonly contributionId: string
  readonly variantId: string
  readonly target: RuntimeTargetConstraint
  readonly executionProfile:
    | 'browser-sandbox'
    | 'worker-brokered'
    | 'process-brokered'
    | 'wasm-brokered'
    | 'trusted-in-process'
  readonly requestedPermissionClasses: readonly CodecPermissionClass[]
}

interface RuntimeVariantDeclaration {
  readonly variantId: string
  readonly entrypoint: string
  readonly target: RuntimeTargetConstraint
  readonly executionProfile: RuntimeVariantSecuritySummary['executionProfile']
  readonly requestedPermissionClasses: readonly CodecPermissionClass[]
}
```

**Simplification (BRIEF-6, 2026-08-12).** Один authored authority: runtime variants, target
constraints, execution profiles и requested permissions авторитетны **только** в child
contribution manifests. Root review table больше не является второй authored таблицей: packaging
**генерирует** её из child envelopes (data-only чтение, без исполнения кода), подписывает в
составе release record, и validator проверяет соответствие generated projection ↔ child manifests
— drift двух authored источников невозможен по построению. Требования прежней модели сохранены:
review до загрузки кода (projection выводится из data-only manifests), target-scoped rows —
ровно одна строка на `(contributionId, variantId, target)`, install UX фильтрует строки по target
plan, schema validation обязательна, ни projection, ни catalog record не выдают permission. Для
поиска/UI допустим generated flat total union — тоже projection, не authority. После download
installer повторно проверяет exact artifact/manifest; catalog projection служит discovery, а не
заменой artifact verification.

Неуказанное permission не означает `false because trusted`; оно означает, что grant для этого
доступа не может быть выдан variant без изменения owning contribution manifest. Extension не объявляет
`requiresHostApproval: false`: необходимость approval выводит host policy из permission class,
scope, provenance и execution profile.

V1 должен использовать один словарь permission classes. Сейчас
`CODEC_PERMISSION_CLASSES`, `ASSET_PERMISSIONS` и VFS `SourceProviderPermission` расходятся
(`process-launch`/`launch-process`, `native-code`/`native-module`, coarse `filesystem`, credentials и
filesystem scopes). Canonical taxonomy строится от variant classes
`read-source`, `write-source`, `filesystem-read`, `filesystem-write`, `network`, `process-launch`,
`native-code`, `credentials`, `clipboard`, `persistent-storage`; legacy vocabularies получают
explicit mapping.
External tool остаётся target/facility requirement, а его запуск и I/O проверяются обычными
process/filesystem permissions.

### 3.1 Security reference types

```ts
interface GrantedPathScope {
  readonly root: SourceRef
  readonly access: 'read' | 'write' | 'read-write'
  readonly recursive: boolean
}

interface GrantedNetworkScope {
  readonly origins: readonly string[]
  readonly methods?: readonly string[]
  readonly allowCredentials?: boolean
}

interface CredentialGrantRef {
  readonly id: string
  readonly class: string
  readonly scope: string
  readonly audience?: string
}

type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'
type SchemaRef = string

interface RedactionPolicy {
  readonly secretFields?: readonly string[]
  readonly pathMode?: 'remove' | 'basename' | 'workspace-relative'
  readonly urlMode?: 'remove' | 'origin-only' | 'strip-query-fragment'
}
```

Path grant использует `SourceRef`, а не ambient absolute-path string. Broker может materialize его в
OS handle/path после проверки scope. Network origins являются normalized URL origins; wildcards
разрешаются только отдельной host policy, не implicit string matching.

## 4. Permission grants

Grant создаётся для operation/session, а не как неограниченный global boolean:

```ts
interface PermissionGrant {
  readonly id: string
  readonly subjectScope?: readonly SubjectRef[]
  readonly sourceScope?: readonly SourceRef[]
  readonly filesystem?: readonly GrantedPathScope[]
  readonly network?: readonly GrantedNetworkScope[]
  readonly credentials?: readonly CredentialGrantRef[]
  readonly expiresAt?: string
  readonly parentGrant?: string
}
```

Nested provider call получает intersection:

```text
parent grant
∩ callee manifest request
∩ host policy
∩ operation scope
= child grant
```

Child никогда не расширяет parent grant. Если требуемого доступа нет, resolver/operation возвращает
structured denial, а не пытается скрыто использовать ambient authority.

Measured baseline 2026-08-10: concrete provider-side permission check найден только в browser-file
provider; остальные пути в основном фильтруют variant/operation до dispatch. Поэтому security slice
обязан добавлять broker checks в реальные I/O providers. Наличие permission metadata само по себе не
считается broker enforcement.

## 5. Execution profiles

### 5.1 `trusted-in-process`

- минимальный overhead;
- подходит first-party performance-critical code;
- имеет ambient process access;
- не может честно заявлять ограниченный filesystem/network sandbox;
- требует explicit policy/diagnostic.

### 5.2 `wasm-brokered` (в тексте ниже — «wasm sandbox»)

- доступ только через предоставленные imports/handles;
- memory/time/fuel budgets;
- хорошо подходит portable codecs/runtime systems;
- native host calls проходят broker;
- shared-memory ABI требует отдельного разрешения.

### 5.3 `worker-brokered` (в тексте ниже — «worker isolated»)

- lifecycle/crash/cancellation isolation;
- structured clone/transferable/RPC boundary;
- сам worker не считается достаточной security boundary, если сохраняет ambient host APIs;
- host adapter обязан документировать реальную enforcement strength.

### 5.4 `process-brokered` (в тексте ниже — «sandboxed process»)

- отдельный helper process;
- brokered stdin/RPC/files/resources;
- OS/container sandbox, когда доступен;
- подходит native libraries/external tools;
- дороже startup и serialization.

**Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable).** Заголовки §5 приведены к единому enum `executionProfile` (Q77): `browser-sandbox`,
`worker-brokered`, `process-brokered`, `wasm-brokered`, `trusted-in-process`, `remote-provider`.
`worker-brokered` на target `node` **реализован** как Node worker backend (документ [32](32-execution-boundary-and-method-surfaces.md) §6): один
`worker_threads.Worker` на activation, host policy с ceilings, verify‑at‑evaluation через module
hooks и per‑file digests inventory, supervisor (violation → terminate, exit → peer exit, deadline →
cancel → grace → terminate), диагностика `x3.host/worker-shared-process`. Он остаётся ступенью
SB‑1 таблицы §6.1: изоляция отказов и протокола, не sandbox.

### 5.5 `remote-provider`

- сетевой transport;
- explicit endpoint allowlist/credentials;
- cancellation, backpressure, deadlines, leases и provenance;
- remote availability не гарантируется и не должна ломать local fallback policy.

## 6. Host-specific enforcement

Один logical permission имеет разные adapters:

| Host/profile                       | Dispatch check | Brokered I/O                       | Ambient isolation                       | Честное обещание v1                      |
| ---------------------------------- | -------------- | ---------------------------------- | --------------------------------------- | ---------------------------------------- |
| Node `trusted-in-process`          | Да             | Возможно                           | Нет                                     | policy/audit, full process authority     |
| Node worker                        | Да             | Да через переданные broker handles | Нет от ambient `node:*` внутри worker   | crash/cancellation isolation, не sandbox |
| Electron renderer + preload broker | Да             | Да                                 | От Node APIs renderer-а                 | зависит от preload/CSP                   |
| Browser/PWA worker                 | Да             | Web APIs/origin policy             | От `node:*`; не от разрешённых Web APIs | browser boundary                         |
| VS Code extension host in-process  | Да             | Частично                           | Нет от extension-host APIs              | workspace trust + audit                  |
| WASM restricted imports            | Да             | Да                                 | Да относительно невыданных imports      | future enforceable profile               |
| Sandboxed helper process           | Да             | Да                                 | Зависит от OS sandbox                   | future enforceable profile               |
| Remote provider                    | Да             | RPC/network broker                 | От local process, не от remote operator | future transport/trust profile           |

Manifest не обещает одинаковый enforcement mechanism. Он описывает request; target resolver выбирает
variant, который host способен выполнить с требуемым уровнем. Если policy требует ambient
isolation, `trusted-in-process` считается несовместимым, а не «достаточно доверенным».

### 6.1 Sandbox roadmap: лестница SB-0…SB-5 (принято 2026-08-12)

Sandbox future исполняется как gate-driven лестница, а не единовременный проект. Каждая ступень
поднимает уровень утверждений §2 (declared → dispatch-enforced → broker-enforced →
ambient-isolated) для конкретного класса кода, **не меняя operation/provider APIs**: execution
profile уже является полем runtime variant (§3), поэтому новая граница — это новый доступный
профиль плюс новые строки честных обещаний в §6, а не новая модель. Ступень строится только когда
наступил её gate; строить раньше — speculative infrastructure (тот же запрет, который канон Phase
I/J даёт marketplace-инфраструктуре).

| Ступень                              | Что добавляет                                                                                                                                                                                                               | Уровень §2                            | Gate (когда строить)                                                                                   | Чего по-прежнему не обещает                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **SB-0 — честный v1**                | Одна permission taxonomy (§17 п.1 = IT-4); deny-by-default dispatch + grant intersection; broker checks в реальных I/O providers; full-authority diagnostic для `trusted-in-process`; browser-boundary proof (нет `node:*`) | 1–2 полностью; 3 в реальных providers | Без gate: обязательна **до** массовой миграции кодеков (S3c) и **до** первого mutating AI tool (AI-2)  | Ambient isolation любого рода                                          |
| **SB-1 — worker/renderer isolation** | Кодеки в workers по умолчанию в browser-хостах; Electron renderer за preload-broker + CSP; crash/cancellation isolation                                                                                                     | 3                                     | Первый host, исполняющий кодеки в workers по умолчанию (PWA/Electron, topology runbook Slice 8)        | Worker не security sandbox: ambient Web APIs внутри worker не отозваны |
| **SB-2 — WASM restricted imports**   | Первый enforceable ambient boundary: доступ только через выданные imports; fuel/memory budgets; broker-materialized handles                                                                                                 | 4 относительно невыданных imports     | Первый untrusted/native-origin codec (класс Oodle/BasisU-транслитераций, community codec)              | Native tools; shared-memory ABI требует отдельного разрешения          |
| **SB-3 — sandboxed helper process**  | OS sandbox (Windows AppContainer/job objects, Linux seccomp/namespaces, macOS sandbox profile) + brokered RPC/files/resources                                                                                               | 4 в меру OS sandbox                   | Первый native executable/library codec внешнего publisher, либо security review перед marketplace beta | Не отменяет явный approval native-кода; дороже startup/serialization   |
| **SB-4 — distribution trust chain**  | Signatures, publisher namespace proof, revocation/quarantine, rollback (границы — документ 28)                                                                                                                              | Supply chain, ортогонально 1–4        | Первый внешний distribution channel (канон R7; register EX-8)                                          | Подпись не заменяет permissions: подписанный код получает те же grants |
| **SB-5 — remote provider trust**     | Endpoint allowlist, leases, deadlines, transport credentials, provenance                                                                                                                                                    | Граница доверия remote-оператору      | Первый реальный remote provider                                                                        | Локальная изоляция не защищает от remote operator                      |

Правила лестницы:

1. **Понижение профиля никогда не молчаливое.** Если policy или manifest требуют профиль сильнее,
   чем host может обеспечить, результат — structured `unresolved`/degraded state, а не запуск под
   более слабой границей. Запуск variant под границей слабее той, под которую выдан grant, —
   policy violation, не fallback (расширение правила §6 про ambient isolation).
2. **Ступень = fixtures + строка в §6.** Каждая ступень добавляет conformance fixtures к §16 и
   честную строку в таблицу §6; заявленный enforcement без такой строки нарушает инвариант §15.10.
3. **Gates независимы.** SB-4 может наступить раньше SB-3, если внешний distribution channel
   появится раньше первого native codec; лестница задаёт силу границ, не календарь.
4. **Политика по происхождению по умолчанию.** First-party/bundled `common` может использовать
   `trusted-in-process` с diagnostic; код, установленный из внешнего канала, по умолчанию получает
   самый сильный доступный профиль своего target; недоступность требуемого профиля — правило 1,
   не тихий downgrade.
5. **Threat coverage явная.** Ступень закрывает именованный класс угроз; всё остальное остаётся
   явно незакрытым:

| Угроза                                   | SB-0                       | SB-1                        | SB-2                 | SB-3               | SB-4                     |
| ---------------------------------------- | -------------------------- | --------------------------- | -------------------- | ------------------ | ------------------------ |
| Crash/зависание кодека роняет host       | нет                        | **да**                      | **да**               | **да**             | —                        |
| Resource abuse (CPU/память)              | budgets декларативны       | частично (terminate worker) | **да** (fuel/memory) | **да** (OS limits) | —                        |
| Чтение вне grant из кода расширения      | нет (in-process ambient)   | нет                         | **да**               | **да**             | —                        |
| Запись/exfiltration вне grant            | только на brokered paths   | частично                    | **да**               | **да**             | —                        |
| Подмена/tampering artifact               | digest verification (§2.1) | —                           | —                    | —                  | **подпись + revocation** |
| Скомпрометированный доверенный publisher | нет                        | нет                         | нет                  | нет                | revocation/quarantine    |

#### 6.1.1 Статус ступеней — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

| Ступень | Состояние 2026‑08‑18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SB‑0    | deny‑by‑default dispatch/grant intersection, trusted diagnostic `x3.host/full-process-authority`, gate‑проверка digest перед activation — реализованы (host); browser‑boundary proof — есть                                                                                                                                                                                                                                                                                                                                                                                         |
| SB‑1    | **Node worker backend реализован и подключён** (документ [32](32-execution-boundary-and-method-surfaces.md) §6): crash/hang/violation изоляция, V8 resource limits, watchdog, restart generation; verify‑at‑evaluation; диагностика `x3.host/worker-shared-process`; conformance kit + hostile‑worker acceptance в `pnpm test`. **Gate «первый host, исполняющий кодеки в workers по умолчанию» пройден 2026‑08‑18: Electron main, CLI, server и automation host резолвят открытие для realm'а `node-worker`.** Не даёт: ambient‑изоляции `node:*`. Browser worker backend — открыт |
| SB‑2/3  | не начаты; `process-brokered` обязателен до первого installed/linked native codec внешнего publisher'а                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| SB‑4    | не начата; digests зависимостей worker'а (bare imports грузятся без верификации) — сюда                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SB‑5    | не начата                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 7. Provider lifecycle

Provider объявляет допустимый scope:

```ts
type ProviderLifecycle = 'application' | 'workspace' | 'asset' | 'session' | 'operation'
```

V1 реализует и проверяет `application`, `session` и `operation`. `workspace`/`asset` остаются
зарезервированными contract values для будущих persistent indexes и decoder caches, но не входят в
acceptance, пока реальный provider не докажет такой lifecycle.

Правила:

- `application` только для stateless/explicitly synchronized state;
- credentials и workspace caches не протекают между scopes;
- runtime/edit provider обычно `session`;
- short pure conversion может быть `operation`;
- asset decoder cache может быть `asset`;
- host вправе выбрать более узкий, но не более широкий scope.

Каждый instance поддерживает cancellation/dispose и освобождает files, processes, GPU/WASM memory,
mount leases и credential handles.

## 8. Activation

Discovery и activation разделены:

```text
read manifest
    ↓ validate schema/security/target
catalog offer
    ↓ resolve and grant
activate selected entrypoint only
```

Нельзя исполнять произвольный extension code, чтобы узнать, какие contracts он предоставляет.

**Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable).** Для `worker-brokered` цепочка activation продолжается за gate: gate перепроверяет
artifact digest и передаёт backend'у per‑file digests inventory; worker исполняет каждый файл
artifact'а из байтов, сверенных с этой картой (module hooks), отклоняя изменённые
(`x3.host/artifact-digest-mismatch`), не входящие в inventory и побеги относительными импортами
(`x3.host/execution-load-rejected`); без карты — только entrypoint (`entrypointDigest`), его импорты
`x3.host/artifact-not-pinned`. Тихого fallback к `file:`/trusted нет (правило 1 §6.1). Дальше §8
документа 32.

## 9. Update and side-by-side sessions

Обновление extension не меняет уже работающую session:

```text
session A -> provider@1, old lock
install provider@2
session B -> provider@2, new lock
```

Старая implementation остаётся загруженной до dispose зависимых sessions. Hot migration возможна
только через explicit migration contract и записывается как изменение session composition/state.

Uninstall также не уничтожает active provider binaries/state до освобождения leases либо явно
останавливает зависимые sessions с diagnostic.

## 10. Failure and fallback policy

Error definition сообщает retryability/recoverability. Host учитывает operation stage:

| Стадия                            | Fallback                              |
| --------------------------------- | ------------------------------------- |
| Probe/detection                   | Разрешён                              |
| Resolution/activation unavailable | Разрешён по policy                    |
| Read-only preview до результата   | Разрешён для recoverable errors       |
| После observable partial result   | Только explicit restart               |
| После prepare mutation            | Только transaction protocol           |
| После partial commit              | Recovery/rollback, не другой provider |
| Deterministic locked tick         | Запрещён                              |
| Corruption/invariant violation    | Запрещён                              |

Fallback choice и причина входят в resolution/operation report.

## 11. Custom errors

Extensions публикуют namespaced definitions:

```ts
interface ErrorDefinition {
  readonly code: string
  readonly version: string
  readonly contextSchema?: SchemaRef
  readonly defaultSeverity: DiagnosticSeverity
  readonly retryability: 'never' | 'safe' | 'conditional'
  readonly remediationIds?: readonly string[]
  readonly redactionPolicy?: RedactionPolicy
}
```

Примеры:

```text
common.codec/unsupported-feature
blizzard.sc2/missing-dependency
multiverse.runtime/component-schema-mismatch
org.modkitx/permission-denied
```

Unknown error definition всё равно переносится как opaque namespaced code/context, но host помечает,
что schema/remediation неизвестны.

## 12. Credentials and secrets

Provider получает opaque credential handle — единственная нормативная форма определена в
[§3.1](#31-security-reference-types) (`CredentialGrantRef`: `id`, `class`, `scope`, optional
`audience`); второе объявление этого wire type запрещено.

Secret value:

- не входит в URI;
- не входит в project lock;
- не входит в cache key;
- не входит в diagnostic/log;
- выдаётся только brokered operation;
- может быть отозван независимо от extension.

### 12.1 Key material (candidate, BRIEF-5)

Encryption **algorithm** — обычный typed byte-transform service
([14 §2](14-processing-and-codec-layering.md)); **key material** — нет. Требование ключа
декларируется, ключ выдаётся broker-ом, и секретные байты никогда не сериализуются:

```ts
interface KeyMaterialRequirement {
  // A/P: authored knowledge claim кодека/формата, не grant
  readonly classId: string // algorithm-family contract, например 'common.security/aes-256'
  readonly purpose: string // audience/decrypt scope
  readonly selector?: string // key id / build selector
  readonly provenancePolicy?: readonly string[] // допустимые классы происхождения ключа
  readonly rotationScope?: string // build/version scope, после которого ключ невалиден
  readonly interactionRequired?: boolean // например user-supplied password
}

interface OpaqueKeyHandle {
  // R/M: host/session-scoped, non-serializable, revocable/disposable
  readonly id: string
  readonly classId: string
}
```

Роли разделены: **key requirement** (авторская декларация выше) ≠ **key provider/credential
broker** (offer для `common.security/key-material@1`: user prompt, OS secure storage, отдельный
permissioned local tool, remote key service) ≠ **decrypt service** (потребляет handle, не хранит
ключ) ≠ **encrypted container codec** (объявляет requirement и вызывает decrypt service).
`OpaqueKeyHandle` подчиняется всем правилам секретов этого раздела: не попадает в manifest,
catalog, lock, diagnostics, telemetry или serialized subject; nested grant intersection §4
применяется без изменений. Key rotation после game patch выражается `rotationScope`; в browser
недоступный provider даёт `dependency-required` degraded state, не крах. Знание о ключе
(включая published RE-происхождение) не является trust elevation и не разрешает
distribution — legal status живёт в
[30 §6](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md).

## 13. Budgets and cancellation

Operation context содержит:

- deadline/cancellation token;
- memory budget;
- output byte/item limits;
- CPU/fuel quota, если enforceable;
- network/request limit;
- recursion/dependency depth;
- progress/report channel.

Provider обязан различать cancellation, timeout, budget exceeded, unavailable и corruption.

## 14. Crash and quarantine future layer

В initial trusted-development mode crash даёт structured provider failure и cleanup. Будущая policy
может вести crash counters, quarantine variant/version и предлагать rollback. Это не меняет contract
identity и не разрешает automatic fallback для mutation/deterministic session.

## 15. Инварианты

1. Missing permission означает deny.
2. Trust не создаёт неявный operation grant.
3. `trusted-in-process` не обещает sandbox.
4. Nested provider grant не шире parent.
5. Manifest читается без activation.
6. Secrets отсутствуют в serializable project state.
7. Active session не получает silent provider update.
8. Fallback после mutation/deterministic commitment запрещён.
9. Provider cleanup проверяется conformance tests.
10. Host не утверждает enforcement, которого execution boundary не обеспечивает.
11. Понижение execution profile никогда не молчаливое: недоступный требуемый профиль даёт
    `unresolved`/degraded state, а не запуск под более слабой границей (§6.1 правило 1).

## 16. Acceptance criteria

- Extension, для которого expanded catalog не может построить обязательную derived security
  declaration, отклоняется validator.
- Operation, объявившая brokered filesystem/network access, без grant отклоняется dispatch-ом до
  выдачи broker handle и до side effect через этот broker.
- Для `trusted-in-process` diagnostic явно сообщает, что прямой ambient Node access технически не
  блокируется; тест не притворяется sandbox test.
- Child provider не использует credential/path вне parent grant.
- Restricted contribution не выбирает `trusted-in-process` без explicit host approval/policy.
- Update provider не меняет результат existing locked session.
- Crash worker/process освобождает leases и даёт structured failure.
- Credentials отсутствуют в lock/log/cache-key snapshots.
- Read-only fallback работает только для declared recoverable error.
- Mutating operation после prepare не активирует другой provider.
- Browser-safe variant не импортирует и не достигает `node:*` entrypoint.
- Catalog search, declarative product matching and install dry-run execute no extension entrypoint.
- Product inventory denied consent performs no scan; recommendation cannot trigger automatic
  install/activation.
- Artifact digest is verified before unpack/activation; source repository URL alone does not satisfy
  integrity policy.

## 17. Следующие шаги

1. Свести `CODEC_PERMISSION_CLASSES` и `ASSET_PERMISSIONS` в одну taxonomy с compatibility mapping.
2. Утвердить schema derived security catalog view поверх текущих codec variant permissions и
   target contribution variants, не добавляя дублирующее поле в `extension.json`.
3. Реализовать deny-by-default dispatch и grant intersection для brokered operations без обещания
   sandbox.
4. Добавить trusted-in-process adapter с явной полной authority diagnostic.
5. Подтвердить browser boundary тестом отсутствия `node:*`; worker использовать прежде всего для
   lifecycle/crash isolation.
6. Реализовать WASM/sandboxed-process profile только при первом реальном untrusted/native provider.
7. Добавить lifecycle/dispose/cancellation conformance harness.
8. Добавить secret redaction tests и side-by-side session/update fixture.
9. Реализовать signatures/catalog trust chain, revocation и rollback только вместе с первым внешним
   distribution channel; schema/API boundaries и fixtures из документа 28 проектируются раньше.
10. Добавить consent/redaction tests для generic installed-product inventory и доказать, что matching
    не активирует extension code.

**Статус Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable):** пункты 3, 4 (host), worker‑часть 5 (Node worker backend, документ [32](32-execution-boundary-and-method-surfaces.md) §6) и
7 (conformance kit + hostile‑worker acceptance, документ 10 §22) — выполнены; 1, 2, 8, 10 — SB‑0
hygiene, открыты; 6, 9 — за своими gates.

Ступени лестницы §6.1 группируют эти шаги: пункты 1–4, 7, 8, 10 и browser-часть пункта 5 — **SB-0**;
worker-часть пункта 5 — **SB-1** вместе с первым worker-по-умолчанию host-ом; пункт 6 — **SB-2/SB-3**
за их gates; пункт 9 — **SB-4** вместе с первым внешним distribution channel. Реестр задач: SEC
(SB-0) и SB-1…SB-5 в `docs/tasks-active/MASTER_TASK_REGISTER.md` §1.7 и на engine/platform board.
