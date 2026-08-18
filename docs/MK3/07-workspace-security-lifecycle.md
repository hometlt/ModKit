# 07. Workspace, Security, and Lifecycle

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Workspace responsibilities

Workspace layer владеет композицией, но не format parsing:

```text
Workspace
├── VFS mounts and overlays
├── dependency chain
├── AssetIndex
├── AssetInput/origin assembly
├── SubjectIndex
├── ReferenceGraph
├── LanguageIndex
├── ProviderCatalog
├── injected @modkitx/assets operation resolver
├── portable provider-policy lock storage
├── caches
└── policy/trust context
```

## 2. AssetIndex

Хранит дешёвые данные, пригодные для completion/search:

- source ID/path;
- origin kind, binding roles и revision vector;
- size/revision каждого известного binding;
- detected or candidate formats;
- declared traits and coarse codec capabilities;
- origin/dependency layer;
- locale/variant;
- companion summary;
- thumbnail availability;
- provenance.

Index не декодирует каждый asset заранее.

## 3. SubjectIndex

Индексирует logical entities:

- stable subject refs;
- kind/title;
- provider;
- declaration sites;
- lightweight capability summary;
- searchable labels;
- relation counts;
- icon reference without decoded image.

## 4. ReferenceGraph

Graph хранит typed edges и поддерживает:

- incoming/outgoing queries;
- field/source locations;
- role filters;
- invalid/missing targets;
- dependency provenance;
- bounded traversal;
- incremental invalidation.

## 5. VFS и overlay

Resolution order должен быть explicit и inspectable:

```text
unsaved editor overlay
workspace mod
dependency mods in declared order
base game/content store
optional remote fallback
```

UI показывает provenance, а writes направляются только в writable owner layer.

VFS implementations поддерживают provider contracts. `@modkitx/vfs` сохраняет canonical ownership
текущих foundational implementations; новые Git/GitHub/API/cloud/game-store providers могут жить в
extensions без правки codec routing. Providers объявляют schemes,
source/VFS capabilities, permissions, credential needs и offline policy. Credentials
выдаются через host-owned scoped broker и не попадают в URI, manifests, lock или logs.

Полная модель описана в
[13-vfs-providers-and-sources.md](13-vfs-providers-and-sources.md).

## 6. Разные locks и reproducibility

Workspace может хранить несколько разных records, но они не объединяются в giant lock:

| Record                          | Владелец/содержание                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project provider-policy lock v1 | `@modkitx/assets`: portable contract/request class, logical extension/provider majors, allowed fallbacks and resolver version; no machine target/variant/grant |
| Install lock                    | catalog/distribution owner from document 28: exact extension artifact, digest/signature state, dependency graph, target, provenance/conformance evidence       |
| World composition lock          | World linker: schemas, systems, slots, overlays, numeric/session profiles                                                                                      |
| Runtime activation snapshot     | machine-local selected artifact variant, facilities/tools and effective policy; not a portable project lock                                                    |
| Session grant                   | security host: scoped permissions/credentials/deadline; обычно не persistent lock                                                                              |

Ни один persistent lock не хранит credential values. Normative provider entry определена в
[23-contract-identity-schema-resolution-and-lock.md](23-contract-identity-schema-resolution-and-lock.md#11-portable-project-provider-policy-lock).
Install/catalog/product-inventory ownership определено отдельно в
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md).

## 7. Trust model

На текущей development stage локально установленное extension считается trusted по provenance, но
это не отменяет mandatory deny-by-default permissions. Target distribution layer документа 28
может поэтапно добавить:

```text
built-in verified
signed trusted catalog
signed third-party
local approved
development unsigned
quarantined
```

Trust не является trait и не следует из capability.

Наличие такого списка в target model не означает, что signatures/catalog/quarantine блокируют
первые local proofs. Точная выбранная staged policy описана в
[24-extension-security-execution-and-lifecycle.md](24-extension-security-execution-and-lifecycle.md).

## 8. Execution isolation

| Runtime             | Isolation policy                                      |
| ------------------- | ----------------------------------------------------- |
| browser worker/WASM | memory/time budgets, CSP, no ambient FS               |
| iframe viewer       | restricted slots, explicit messaging                  |
| Node worker         | crash isolation, но не security sandbox               |
| native              | explicit trust/install/permissions                    |
| external tool       | approved executable, bounded args/temp paths/timeouts |

## 9. Permissions

Примеры:

```text
read-source
write-source
filesystem-read
filesystem-write
network
process-launch
native-code
clipboard
persistent-storage
```

Operation session проверяет permissions перед handler lookup.
Неуказанное permission означает deny. Nested provider получает grant не шире parent operation.
Текущий второй словарь `ASSET_PERMISSIONS` должен получить compatibility mapping и сойтись с этой
taxonomy до schema v1; scoped paths/endpoints/credentials задаются grant-ом, не новыми class strings.

## 10. Resource budgets

Provider manifest объявляет:

- sniff bytes;
- maximum decoded bytes;
- memory class;
- CPU/time budget;
- maximum nested depth;
- concurrency;
- random-access requirements;
- worker/native/external-tool needs.

Host может уменьшить budget. Превышение возвращает structured diagnostic и завершает
provider session.

## 11. Cancellation и stale work

Обязательное cancellation для:

- detection;
- indexing;
- preview generation;
- search;
- dependency resolution;
- language diagnostics;
- relation traversal;
- export/conversion.

Результат для устаревшей document revision не публикуется.

## 12. Lifecycle

Каждый runtime handle имеет `dispose/close`. Владелец явно определён:

```text
App owns Workspace
Workspace owns Provider generations and indexes
Subject session owns handles/projections
Viewer session owns UI resources
Runtime session owns clock/state/event streams/snapshots
Operation owns temporary artifacts/transaction
```

Disposal должен быть idempotent.

## 13. Crash and quarantine

Initial implementation при activation/runtime failure:

1. завершает affected session;
2. записывает structured diagnostic/crash metadata;
3. освобождает handles/leases/process resources;
4. не выполняет скрытый fallback после mutation/deterministic commitment.

Будущая optional quarantine policy для repeated failures дополнительно:

1. quarantine provider generation;
2. оставляет Modkit и parent subjects работоспособными;
3. предлагает разрешённый read-only/resolution fallback;
4. не активирует broken generation повторно без явного действия или update.

## 14. Cache keys

Кеш зависит минимум от:

```text
asset origin + binding/namespace revision vector
provider ID + version + runtime variant
runtime target: environment + OS + architecture + ABI/features
contract/capability version
options
workspace dependency/locale state
```

Нельзя переиспользовать preview после смены provider или dependency chain.

## 15. Performance principles

- Catalog/manifest discovery без runtime imports.
- Generated indexes по contract/source-kind/capability вместо repeated full scans.
- Lazy provider activation.
- Resolver строит immutable session/operation plan до hot path.
- Paged/streamed collections.
- Incremental indexes and syntax trees.
- Visible-item thumbnail generation.
- Shared byte/random-access caches с bounded memory.
- Batch/transferable/stream transports вместо fine-grained per-element RPC.
- Heavy work вне extension/UI thread.
- Progress only for operations длиннее perceptible threshold.

Capability/provider lookup запрещён внутри per-pixel/per-vertex/per-row/per-entity/per-frame
hot loops. После activation provider работает через direct typed handles/function tables.
Cross-host и data-plane требования подробно описаны в
[19-host-portability-performance-and-extension-dx.md](19-host-portability-performance-and-extension-dx.md).

## 16. Observability

Tracing spans:

```text
source.resolve
codec.detect
provider.resolve
provider.activate
provider.plan.compile
asset.open
subject.open
relation.resolve
projection.create
viewer.mount
language.request
operation.execute
runtime.start/tick/stop
game.launch
automation.tool.invoke
```

Trace context сохраняет provider/contract/source/subject IDs без утечки file contents
или credentials.

## 17. Offline behavior

- Locked installed providers продолжают работать offline.
- Catalog lookup/update и remote fallback явно показываются как unavailable; cached catalog snapshot
  может оставаться inspectable.
- Workspace не меняет provider silently.
- Missing CDN assets не блокируют local subject.
- Install lock + artifact digests, provider lock и catalog snapshot позволяют воспроизвести
  environment, но остаются разными records.
