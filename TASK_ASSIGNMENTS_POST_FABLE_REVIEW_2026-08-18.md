# Распределение задач после review Fable

Дата: 2026-08-18  
Baseline: `e92c2b1`  
Review: `REVIEW_FABLE_NEXT_A2_A3_2026-08-18.md` (`REVISE`, P0 нет)
Первый integration slice: `84cdd1c`

## 1. Принятые корректировки

Root принимает F‑01…F‑07 и рабочие defaults D‑1…D‑9:

- capability-RPC должен быть один для worker и Electron IPC;
- data-source method surface становится contract-definition authority;
- codec detection selection отделяется от provider-policy lock;
- generated catalogs обязаны иметь emitter + `--check`;
- UI codec-instantiation path удаляется;
- probe grant уже open grant, universal match явный, candidates bounded;
- PNG claim остаётся только после реального product-path теста;
- app adoption: Electron → CLI/server → PWA → VS Code.

## 2. Exclusive ownership

До объединения slice запрещено параллельно редактировать:

| Scope                                         | Владелец            |
| --------------------------------------------- | ------------------- |
| `packages/host/src/subject-open.ts`           | Root/Sol            |
| `packages/host/src/security/**`               | Root/Sol            |
| `packages/host/src/resolution/**`             | Root/Sol            |
| `packages/host/src/execution/backend*.ts`     | Root/Sol            |
| `packages/sdk` public ABI/schema              | Root + Fable review |
| `apps/**/main`, Electron main/preload         | Root/Sol            |
| root `package.json` и repository gates wiring | Root/Sol            |

Agents создают commit только по прямому указанию root. Shared worktree требует непересекающихся
files и немедленного сообщения о найденном overlap.

## 3. Fable — queued specialized task

### FABLE-NXT-105 — capability-RPC core v1

Статус: **queued**. Старт после того, как root приземлит минимальные NXT‑100 backend SPI types и
подтвердит форму NXT‑103 surface adapter.

Почему Fable: это самый рискованный state-machine/security/lifecycle seam; он требует строгих
validators, hostile inputs и доказательства cleanup при гонках.

#### Разрешённый scope

- новые `packages/host/src/execution/protocol.ts`;
- новые `packages/host/src/execution/handles.ts`;
- новые `packages/host/src/execution/surface.ts`;
- новый `packages/host/src/execution/index.ts`;
- новые `packages/host/test/execution-*.test.ts`.

Public SDK surface — только отдельным patch после согласования root; apps/transports/openSubject/
resolver/lock запрещены.

#### Требуемый результат

1. Envelope `{domain, version, session, generation, id}`.
2. Frames: `load`, `ready`, `call`, `return`, `throw`, `cancel`, `next`, `done`, `subscribe`,
   `event`, `unsubscribe`, `progress`, `release`, `terminate`.
3. Exact-key, prototype-safe, depth/node/string/array/transfer validators.
4. Handles с owner/session/generation и cross-generation rejection.
5. Idempotent release, worker-exit invalidation и deterministic pending-call rejection.
6. Surface registry с kinds `value | lease | iterable | events`.
7. Error DTO/rehydration для `ModkitError` и cancellation.
8. Hostile tests: prototype pollution, unsupported clone values, oversized typed-array view,
   late/duplicate reply, cancel-vs-return, restart generation, double release, live iterator/event
   cleanup, unknown method/contract/major и session limits.

#### Не входит

- Node/Web transport;
- backend registry;
- Electron IPC integration;
- app adapters;
- VFS;
- изменение lock/selection.

#### Gate

- focused tests;
- `pnpm typecheck`;
- scoped ESLint/Prettier;
- `git diff --check`;
- затем root запускает полный `pnpm check`.

## 4. Opus — design task

### OPUS-UX-01 — execution and extension lifecycle UX

Статус: **ready for read-only design** после удаления UI dual path NXT‑107. Production logic не
реализуется до capability-RPC/backend contracts.

#### Цель

Создать UX specification и component-state map для:

- resolving/probing/opening;
- unresolved/no backend/no candidate;
- permission requested/granted/refused;
- trusted full-process diagnostic;
- worker crash/hang/restart;
- stale revision/source changed;
- missing/ambiguous companions;
- extension bundled/installed/linked;
- enable/disable/update с live sessions.

#### Deliverables

1. State table: trigger, user message, actions, retryability, diagnostics detail.
2. Wireframe для Electron/PWA/VS Code с общей semantic model.
3. Accessibility: focus, screen-reader announcement, progress/cancel, non-color status.
4. Extension manager flow без решения security policy в renderer.
5. Design tokens/parts reuse; список недостающих UI primitives.
6. Negative UX: silent fallback и modal spam запрещены.

#### Граница

Opus не определяет trust, permission widening, lock identity, protocol frames или public schemas.
Его документ потребляет уже принятые результаты Root/Fable.

## 5. Завершённые bounded implementation tasks

| Task                        | Исполнитель             | Scope                                               | Состояние |
| --------------------------- | ----------------------- | --------------------------------------------------- | --------- |
| NXT‑106 catalog emitter     | `app_catalog_generator` | emitter, focused tests, Electron generated catalogs | completed |
| F‑07 PNG product proof      | `png_product_proof`     | host/Electron tests only                            | completed |
| NXT‑107 remove UI dual path | `ui_open_session_only`  | UI source/tests only                                | completed |

Root интегрировал `package.json`, app callers и generated checks. Полный repository gate и commit
закрывают handoff как единый R1 hygiene slice.

## 6. Root/Sol queue

### ROOT-01 — plan/review integration

- сохранить review Fable;
- обновить roadmap NXT‑103…107, owner decisions и app ordering;
- исправить README claims только по доказательствам.

### ROOT-02 — NXT-104 lock/selection split

- убрать codec selection из provider-policy lock;
- ввести отдельную canonical non-secret detection-selection provenance;
- доказать PNG/JPEG same-representation aggregation;
- отдельно тестировать provider replay и codec selection replay.

### ROOT-03 — NXT-100/101 backend SPI

- internal `ExecutionBackendRegistry`;
- trusted backend как текущая реализация;
- backend availability привязана к target, без resolver preference;
- probe grant, candidate cap, explicit universal match;
- release losing candidates.

### ROOT-03B — NXT-103 public method-surface authority

- Root владеет SDK type/schema/registry change и drift gates;
- Fable проводит focused review frozen adapter contract;
- только после этого NXT-105 может потреблять surface, не изобретая вторую allowlist.

### ROOT-04 — Fable handoff

После ROOT‑03/03B передать Fable exact SPI types и окончательный surface adapter port. Во время
Fable работы root не редактирует его новые `execution/{protocol,handles,surface}.ts`.

### ROOT-05 — transports and apps

После FABLE-NXT-105:

1. Electron IPC перевести на capability-RPC.
2. Node worker backend с `resourceLimits` + verify-after-load.
3. CLI/server runtime proof.
4. Browser worker backend.
5. PWA, затем VS Code.

## 7. Другие агенты после protocol freeze

Можно раздать независимо:

- Node transport adapter;
- Browser transport adapter;
- hostile worker fixtures (crash/hang/malformed/protocol race);
- ZIP→namespace→PNG corpus;
- CUE+2 BIN companion corpus;
- source revision/symlink/oversize fixtures;
- performance/leak counters;
- packed external worker extension;
- docs/schema drift sync по принятому ABI.

Нельзя делегировать без root review:

- public SDK surface;
- activation policy;
- lock/detection identity;
- provenance/trust defaults;
- VFS owner change;
- cross-app security decisions.

## 8. Merge order

1. Review + updated plan.
2. PNG proof, UI dual-path removal, app catalog emitter.
3. Root NXT‑104.
4. Root NXT‑100/101.
5. Fable NXT‑105.
6. Electron capability-RPC adapter.
7. Node worker backend + CLI/server proof.
8. VFS/container + bundle resolver.
9. Browser worker backend + PWA.
10. VS Code and release matrix.

Каждый merge point восстанавливает полный зелёный `pnpm check`; временно красный shared worktree не
считается завершённым handoff.
