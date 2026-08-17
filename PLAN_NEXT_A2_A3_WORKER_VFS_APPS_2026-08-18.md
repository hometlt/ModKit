# ModkitX3 — следующий план A‑2/A‑3 после G‑APP‑1

Дата: 2026-08-18  
Базовая ветка: `spec/mk3-extension-reference`  
Проверенная база: `74b7976`  
Runtime-коммиты: `ad6f0cc`, `f510b3b`

## 0. Назначение и границы

Это не новая общая архитектура. План подчинён owner-документам `modkitx/docs/architecture/`,
MK3/23, MK3/24, MK3/27 и зафиксированным ABI ModkitX3. Он продолжает один ограниченный маршрут:

```text
extension inventory
  → openSubject
  → execution backend
  → leased session/data sources
  → presentation plan
  → application adapter
```

G‑APP‑1 уже закрыт для bundled Electron-кодеков через честный `trusted-node` путь. Следующая цель —
сделать `worker-brokered` реальным доступным execution profile, затем провести через тот же путь
контейнеры, составные assets и остальные приложения.

Не входит в этот план:

- обещание SB‑2 sandbox или защита worker от ambient Node/Web API;
- новый renderer, ECS, Multiverse runtime или массовый перенос MK2-кодеков;
- отдельная параллельная модель inventory/resolver/session;
- silent fallback с `worker-brokered` на `trusted-in-process`;
- перенос credentials, raw facets или произвольных request values в lock/IPC;
- изменение owner-документов без отдельного решения владельца.

## 1. Проверенная исходная точка

На `74b7976`:

- `packages/host/src/subject-open.ts` собирает inventory → bounded probe → resolver/lock →
  ticket/grant → activation → descriptor/session;
- `packages/host/src/security/gate.ts` fail-closed и поддерживает только
  `trusted-in-process`;
- provenance `bundled/installed/linked` и отдельное `allowTrustedInProcess` уже участвуют в gate;
- portable и trusted variants имеют непересекающиеся targets;
- Electron main владеет источником, codec session и data-source leases; renderer получает только
  проверенные вызовы через preload;
- `packages/host/src/source-bridge.ts` безопасно мостит numeric VFS source в bigint runtime source;
- default `SubjectInputResolver` поддерживает только `originKind: single` без companions;
- `packages/vfs` пока содержит только минимальный `RandomAccessSource<number>`;
- PWA/VS Code/headless app matrix доказывает декларативную композицию, но не единый product-open
  runtime для каждого приложения.

Базовый gate: `pnpm check` — 66 test files / 476 tests, 14 schemas, 16 UI manifests и 16 app/realm
cases.

## 2. Неподвижные инварианты

Каждый последующий slice обязан сохранять:

1. Один публичный host-owned путь открытия subject: `openSubject` или его совместимый facade.
2. Resolution выбирает logical offer; activation backend исполняет выбранный execution profile.
3. Недоступный backend означает structured unresolved/rejection, а не понижение профиля.
4. Trusted execution разрешается только provenance + host policy, а не именем publisher/manifest.
5. Renderer/webview не импортирует codec/provider implementation.
6. Все объекты с lifecycle пересекают границу как leases/handles и освобождаются идемпотентно.
7. Bytes, iterators, events, errors, cancellation и budgets остаются bounded и fail-closed.
8. Lock содержит только canonical non-secret selection data.
9. Source revision и полный revision vector сохраняются через open/restore/cache boundaries.
10. Wire/schema authority не дублируется ради удобства транспорта.

## 3. Критический путь

```mermaid
flowchart LR
  R["R0: Fable architectural review"] --> E["R1: ExecutionBackend SPI"]
  E --> P["R2: Worker protocol + handle runtime"]
  P --> N["R3: Node worker backend"]
  P --> B["R4: Browser worker backend"]
  E --> V["R5: VFS/container authority"]
  V --> I["R6: bundle/namespace input resolver"]
  N --> A["R7: Electron/CLI/server adoption"]
  B --> W["R8: PWA/VS Code adoption"]
  I --> A
  I --> W
  A --> X["R9: installed/linked extension lifecycle"]
  W --> X
  X --> C["R10: cross-app corpus and release gate"]
```

Архитектурное исследование R0 и тестовые fixtures можно делать параллельно. Production integration
не начинается до решения R0 по backend registry, protocol envelope и VFS ownership.

## 4. Этап R0 — независимый review и owner decisions

### NXT-000 — зафиксировать baseline

- Считать `74b7976` исходной точкой review.
- Воспроизводить `pnpm check`, Electron subject-services test и app matrix.
- Любая находка должна указывать exact file/contract и отличать production defect от owner-doc drift.

### NXT-001 — Fable review

Fable проводит read-only аудит этого плана и файлов из отдельного request-документа. Результат:

- `ACCEPT`, `REVISE` или `BLOCK`;
- P0/P1/P2 findings с доказательством;
- предлагаемые перестановки NXT-задач;
- список owner decisions;
- один рекомендуемый bounded implementation slice для Fable;
- список безопасных параллельных задач для остальных агентов.

### NXT-002 — обязательные owner decisions

До public ABI freeze нужно подтвердить:

1. Execution backend registry — internal host SPI, а не новый contribution contract.
2. Worker protocol — private versioned transport; SDK экспортирует только capability ABI.
3. Честное название границы: SB‑1 crash/cancellation/I/O brokerage, не sandbox.
4. Владелец bigint byte-source contract: `vfs` с SDK re-export либо сохранение checked bridge.
5. `common.vfs/mount@1` и `common.vfs/container@1`: service contracts или иной owner-approved seam.
6. Installed/linked provenance, digest policy и запрет trusted execution по умолчанию.

### Exit R0

- Нет открытого P0.
- Для каждого P1 есть owner, решение/default и acceptance proof.
- План обновлён по review; production work распределён по непересекающимся file scopes.

## 5. Этап R1 — execution backend SPI

### NXT-100 — отделить policy gate от механизма исполнения

Ввести внутренний `ExecutionBackend`/`ExecutionBackendRegistry` в host:

- `profile`, поддерживаемые realms/targets и feature availability;
- `activate(validatedTicket, boundArtifact, grant, context)`;
- возврат leased module/session capability;
- structured diagnostic при unavailable/mismatched backend;
- current trusted import становится первым backend, без изменения его provenance checks.

`SUPPORTED_EXECUTION_PROFILES` перестаёт быть глобальной декларацией возможностей. Доступность
определяет конкретная host composition. Resolver не получает preference по profile.

### NXT-101 — связать resolution с backend availability

- До выбора кандидата host знает, может ли target выполнить profile.
- Два variants одного contribution не должны становиться ambiguous для одного target.
- Backend не может заменить выбранный variant другим после ticket issuance.
- Ticket, digest, entrypoint и runtime variant остаются связаны до import/spawn.

### NXT-102 — acceptance

- trusted backend сохраняет все текущие тесты;
- worker-only + node без worker backend → unresolved с объяснением;
- наличие worker backend делает тот же contribution eligible без изменения resolver;
- forged backend/profile/target mismatch fail-closed;
- никакого import contribution module до финальной activation проверки.

## 6. Этап R2 — worker protocol и object runtime

### NXT-110 — protocol v1

Private protocol envelope должен иметь:

- domain/version, worker/session ID, monotonic message ID;
- `load`, `call`, `return`, `throw`, `cancel`, `release`, `terminate`;
- exact-key runtime validators на обеих сторонах;
- upper bounds для depth/nodes/string/array/transfer bytes;
- запрет prototype-bearing/host objects;
- deterministic serialization для diagnostics, но не для cache/lock identity.

Разрешённые значения: JSON-safe values, `bigint`, bounded `Uint8Array` transfer, validated error DTO и
opaque handles. Functions, arbitrary class instances, raw paths, credentials и `AbortSignal` не
пересылаются напрямую.

### NXT-111 — handle table и proxies

- Worker-owned `Codec`, `AssetSession`, providers, data sources и iterators получают opaque handle.
- Host proxy знает разрешённый method surface для contract@major.
- Handle принадлежит worker session и generation; cross-session/stale handle отвергается.
- `Lease.release()` идемпотентен и удаляет handle с обеих сторон.
- Worker exit освобождает host sources, nested providers, iterators и pending calls.
- Unknown method/contract/major/handle → structured protocol violation + fail-closed termination.

### NXT-112 — cancellation, deadlines и failure semantics

- `AbortSignal` отображается в cancel ID.
- Deadline контролируется worker-кодом и host watchdog; зависший worker завершается.
- Crash/hang/protocol violation не рушит host и не оставляет live leases.
- `ModkitError` сохраняет `code/context/retryability`; cancellation остаётся отдельным результатом.
- Late/duplicate replies после cancel/release игнорируются или отвергаются детерминированно.

### NXT-113 — brokered ArtifactSource

- Worker получает только byte/namespace proxy, никогда path/credential.
- `read/stream/list/open` возвращаются в host и проверяются grant + scope + budget.
- `Uint8Array` передаётся transferably; cache/prefetch bounded probe/runtime budget.
- Read после revision change возвращает stale-revision/diagnostic.
- Nested service resolution идёт через host, создаёт child grant и проходит `assertNotWider`.

### NXT-114 — Node worker backend

- Реализовать поверх `worker_threads` и `MessagePort`.
- Entry module загружается только после ticket/digest/entrypoint checks.
- Один reusable protocol core; Node transport не попадает в browser-safe entrypoints.
- Явный diagnostic сообщает: процесс изолирован от crash/hang, но ambient Node API не sandboxed.

### NXT-115 — Browser worker backend

- Реализовать поверх module `Worker`/`MessagePort`.
- Bundle gate запрещает `node:*` и concrete codec code в main renderer bundle.
- CSP-compatible bootstrap без `eval`/`new Function`.
- Worker URL/module provenance связан с artifact digest.

### Exit R2

Adversarial gate обязан включать crash, hang, abort during page, oversize transfer, malformed reply,
unknown handle/method, double release, worker exit with live iterators, out-of-scope source read,
nested provider grant widening и unavailable-backend refusal.

## 7. Этап R3 — VFS/container и составные assets

### NXT-200 — один byte-source contract

После owner decision:

- либо `ArtifactByteSource` становится каноническим bigint contract владельца `vfs` с SDK re-export;
- либо checked bridge остаётся нормативной границей с явным пределом `MAX_SAFE_INTEGER`.

В обоих случаях нельзя оставлять две взаимозаменяемые public authority без lossless rule.

### NXT-201 — mount/container service definitions

Минимальные contracts:

- `common.vfs/mount@1`: stat/list/open/revision/watch?/write transaction?;
- `common.vfs/container@1`: byte source → leased `AssetNamespace`.

Нужны schemas/facets, presence rules, revision semantics, permission mapping и non-secret selection
keys. Credentials только через opaque grant handles.

### NXT-202 — reference providers

1. Memory provider — deterministic test oracle.
2. Local directory provider — Node host, traversal-safe normalized paths.
3. Browser directory handle provider — explicit user grant.
4. ZIP container provider — первая реальная namespace vertical slice.

### NXT-203 — расширить SubjectInputResolver

Текущий default single-only resolver заменить/дополнить host resolver, который:

- разрешает `single`, `bundle`, `namespace`, затем `derived`;
- соблюдает cardinality, rule/requirement/binding IDs и ownership;
- различает missing/ambiguous/resolved companions;
- строит полный revision vector;
- не позволяет codec самостоятельно выбирать arbitrary sibling path;
- сохраняет portable origin descriptor для reopen/restore.

### NXT-204 — acceptance corpus

- ZIP → namespace → вложенный PNG/JSON subject без materialize-whole-archive;
- CUE + два BIN одного requirement/role;
- missing и ambiguous singular companion;
- namespace root без fake primary source;
- source/companion revision change между probe/plan/open;
- nested archive depth/entry/byte budgets;
- traversal и duplicate normalized path attacks.

## 8. Этап R4 — installed/linked extension lifecycle

### NXT-300 — extension sources и provenance

Host discovery различает:

- generated bundled catalog;
- installed immutable artifact;
- linked development artifact.

Каждая запись несёт artifact root, contribution manifest path/base, digests, extension coordinate,
origin и policy decision. Publisher/namespace не дают trust автоматически.

### NXT-301 — enable/disable и atomic replacement

- Inventory owner replacement остаётся atomic и generation-checked.
- Disable не активирует новые sessions; live sessions получают нормативную policy (finish/stale/close).
- Update создаёт новую inventory generation; lock replay не подменяет artifact digest.
- Broken/partial extension даёт diagnostics и не отравляет остальные owners.

### NXT-302 — policy UX

Пользователь видит:

- почему extension/variant выбран или отвергнут;
- execution boundary и requested/granted permissions;
- отличие bundled, installed и linked;
- явное решение для full-process authority;
- безопасный reload/update/disable flow.

Security decision хранится host-side и не принимается renderer/webview.

## 9. Этап R5 — один product-open путь во всех приложениях

### NXT-400 — общий application adapter

Вынести из Electron только reusable host orchestration port, не Electron IPC:

- extension source discovery;
- host topology/target/backend composition;
- `openSubject`, explain, call, close;
- presentation plan и session-owned binding tickets;
- lifecycle/telemetry hooks без codec knowledge.

### NXT-401 — Electron

- Добавить Node worker backend.
- По policy предпочитать не resolver preference, а соответствующий target.
- Оставить trusted-node как явный bundled fallback до worker parity.
- IPC events/AsyncIterable сделать cancellable pull/push protocol, затем убрать snapshot-only gap.

### NXT-402 — PWA

- `browser-worker` codecs открываются через тот же openSubject adapter.
- Main/UI получает только leases/proxies.
- OPFS/File System Access source provider и service-worker lifecycle проверены отдельно.

### NXT-403 — VS Code

- Desktop extension host использует Node worker backend.
- Web extension использует browser worker backend.
- Webview остаётся viewer realm без codec imports.
- Existing language/editor paths мигрируют по одному, без big-bang rewrite.

### NXT-404 — CLI/server/headless

- CLI получает `open`, `explain`, `inspect` через общий adapter.
- Server/automation host используют Node worker backend и explicit budgets.
- Никакого private testkit projector как production route.

### NXT-405 — product-open matrix

Заменить/дополнить декларативный `apps:check` runtime cases:

- JSON, PNG, UVM, ZIP+nested asset, unknown, malicious fixture;
- Electron main, PWA worker, VS Code desktop/web, CLI/server;
- одинаковый selected contribution/descriptor/presentation при одинаковом policy target;
- renderer/webview bundles не содержат codec implementation;
- shuffle/reload сохраняет lock replay;
- no available backend даёт одинаково объяснимый unresolved result.

## 10. Этап R6 — стресс и release closure

### NXT-500 — fault/corpus matrix

- malformed manifests/protocol frames;
- large/random-access sources и bigint offsets;
- cancellation на каждой await boundary;
- crash/hang/worker restart;
- nested providers and grants;
- archive bombs/path traversal;
- revision churn and stale sessions;
- concurrent owner replace/unregister;
- third-party extension with no trusted permission.

### NXT-501 — performance budgets

Pin:

- worker startup and warm reuse;
- probe bytes/read count;
- transfer bytes/copies;
- handle/lease count after close/crash;
- namespace listing/page limits;
- large text/table/hex existing budgets.

Оптимизация принимается только с parity fixtures и reproducible before/after.

### NXT-502 — release evidence

- clean packed install of platform + external worker codec;
- all application product-open smokes;
- schema/manifest/docs sync;
- independent Fable audit of security/lifecycle invariants;
- owner status changes only after green evidence and explicit promotion decision.

## 11. Делегирование

### Root/Sol — integration owner

Оставить за основным агентом:

- окончательные owner decisions и sequencing;
- изменения `openSubject`, activation composition и cross-package public ABI;
- интеграцию Electron/PWA/VS Code;
- разрешение пересечений, финальные gates, commits и reports.

### Fable — самые сложные архитектурные и специализированные задачи

Лучшее применение Fable:

1. Read-only review R0 и поиск скрытых authority/security/lifecycle противоречий.
2. Формальная спецификация worker protocol/state machine и threat model.
3. Bounded implementation строгих protocol validators + handle lifecycle с hostile tests.
4. VFS ownership/revision/credential/transaction design review.
5. Installed/linked provenance и trust-policy model.
6. Независимый pre-merge аудит R2/R3.

Не выдавать Fable одновременно «весь worker + все apps»: сильная модель полезнее на одном узком
сложном seam с точным file scope и adversarial acceptance.

### Opus — UX/design и owner-facing представление

Подходящие задачи:

- UX состояний resolving/unresolved/permission/trusted/crashed/stale;
- extension manager, enable/disable/update flows;
- namespace/companions/ambiguity presentation;
- accessibility, responsive layout, visual hierarchy;
- диаграммы и review документации после технического решения.

Не поручать Opus самостоятельно определять security boundary, lock identity или wire authority.

### Другие агенты

Можно безопасно делегировать после freeze интерфейсов:

- Node и Web transport adapters в непересекающихся файлах;
- fixtures/fault injection/corpus packaging;
- app-specific adapters после появления общего port;
- schema drift/packed consumer tests;
- mechanical manifest target migration;
- performance harness и leak counters;
- документационный sync по уже принятому решению.

Каждая задача получает: baseline commit, разрешённые файлы, forbidden files, exact tests, команду
gate и запрет расширять public ABI без review.

## 12. Рекомендуемое немедленное действие

1. Передать Fable `REQUEST_FABLE_REVIEW_NEXT_A2_A3_2026-08-18.md`.
2. До его verdict разрешить только read-only review и подготовку hostile fixtures без production API.
3. После `ACCEPT/REVISE` обновить этот план одним commit.
4. Первым production slice сделать NXT-100…102.
5. Затем поручить Fable NXT-110/111 как отдельную bounded задачу; root интегрирует NXT-114/115.

Такой порядок оставляет единственную точку композиции, не замораживает транспорт в SDK ABI и не
повторяет ошибку «декларативный gate зелёный, а реальный пользовательский путь другой».
