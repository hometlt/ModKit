# Запрос Opus: OPUS‑UX‑01 — UX состояний исполнения и жизненного цикла расширений

Дата: 2026‑08‑18. Автор запроса: Fable (по поручению Root/Sol,
`TASK_ASSIGNMENTS_POST_FABLE_REVIEW_2026-08-18.md` §4). Baseline: `13cf21d`.

## Роль и рамка

Ты — UX/design‑владелец состояний, которые пользователь видит, когда host открывает файл, исполняет
кодек, ждёт разрешение, теряет worker или обновляет расширение. Ты **не** определяешь trust,
расширение прав, lock identity, protocol frames или публичные схемы — это уже решено (или решается)
Root/Fable; твой документ их **потребляет**. Production‑логика не пишется: результат — спецификация
состояний, компонентная карта, wireframes и список недостающих UI‑примитивов. Первый проход —
read‑only по коду.

Терминология — только из существующих типов и кодов (§2). Новые параллельные названия состояний
запрещены; если чего‑то не хватает — предложи _добавление_ к словарю в отдельном разделе
«предлагаемые термины», не изобретай синонимов.

## 1. Обязательное чтение

1. `IMPLEMENTATION_NOTES.md` — разделы G‑APP‑1, W1–W5, V1–V2.
2. `PLAN_NEXT_A2_A3_WORKER_VFS_APPS_2026-08-18.md` §2 (инварианты), §8 (NXT‑302 policy UX), §9.
3. `REVIEW_FABLE_NEXT_A2_A3_2026-08-18.md` §5 (product cases).
4. Код (только чтение): `packages/host/src/subject-open.ts` (типы `OpenSubjectResult`,
   `UnresolvedSubject`, `SubjectOpenCandidateExplanation`), `packages/host/src/security/gate.ts`
   (коды отказа активации), `packages/sdk/src/runtime-abi.ts` (`OperationRejection`,
   `SessionState`), `packages/sdk/src/editing.ts` (`EditSessionState`, `CommitRejection`,
   `TransactionStatus`, `UndoGuarantee`), `packages/host/src/inventory.ts` (`ExtensionOrigin`,
   `ExtensionExecutionPolicy`), `packages/host/src/execution/protocol.ts` и `endpoint.ts`
   (коды `x3.host/rpc-*` — что видит пользователь при падении/зависании worker'а),
   `packages/ui/src/settings/model.ts` (включение расширений), `apps/electron/src/renderer.ts`
   (что footer/статус показывают сегодня).
5. Owner‑доки: MK3/24 §2 (четыре уровня утверждений: declared / dispatch‑enforced /
   broker‑enforced / ambient‑isolated), §5.1 (`trusted-in-process` = не sandbox), §6.1 п.1
   (понижение профиля никогда не молчаливое), §10 (fallback‑политика по стадиям).

## 2. Словарь состояний (из кода; используй ровно эти имена)

**Открытие subject (`OpenSubjectResult`)**

- `state: 'opened'` — `selected {extensionId, contributionId, variantId, offerId, confidence}`,
  `candidates[]` с `state: 'rejected' | 'detected' | 'selected'`, `diagnostics[]`, `lockText`.
- `state: 'unresolved'` — `reason: 'no-candidate' | 'no-match' | 'ambiguous' | 'input-unresolved'`,
  `fallback: { preferred: 'text' | 'hex', available: ('text'|'hex')[] }`, `descriptor`
  (валидный, `interpretation: 'none'`), `candidates[]`, `diagnostics[]`.
- Диагностики кандидатов: `x3.host/codec-execution-unavailable` (нет исполнимой границы для
  варианта — напр. только `worker-brokered`, а worker‑backend отсутствует),
  `x3.host/codec-resolution-unresolved`, `x3.host/subject-candidate-limit`,
  `x3.host/probe-range-violation`, `x3.host/probe-budget-exceeded`,
  `x3.host/invalid-detection-result`, `x3.host/input-resolver-required` (bundle/namespace ещё
  не поддержаны), `x3.host/subject-session-identity-mismatch`.

**Резолюция провайдера (`UnresolvedReason`)** — `no-offer`, `version-incompatible`,
`target-incompatible`, `permission-required`, `external-tool-required`, `output-missing`,
`ambiguous`, `pin-unsatisfied` (+ `unsupported-kind` в `rejected[]`).

**Активация (коды `x3.host/*` из gate)** — `invalid-ticket`, `ticket-manifest-mismatch`,
`artifact-digest-mismatch` («артефакт изменился после инвентаризации»), `unknown-variant`,
`target-incompatible`, `unsupported-execution-profile` («отказ, а не понижение»),
`trusted-in-process-not-authorized` («полная власть процесса не разрешена политикой хоста»),
`grant-not-live` (истёк/битый грант), `permission-denied` (`context.missing[]` — какие классы не
покрыты), `entrypoint-not-contained`; предупреждение `full-process-authority` (**обязательно
показывать**: «работает как trusted‑in‑process; это аудит/политика, не sandbox»).

**Сессия и операции** — `SessionState: 'live' | 'stale-revision' | 'disposed'`;
`OperationRejection: 'not-declared' | 'disabled' | 'dependency-required' | 'permission-missing' |
'input-not-serializable' | 'handler-unregistered' | 'cancelled' | 'stale-revision'`.

**Редактирование** — `EditSessionState: 'live' | 'stale-revision' | 'committing' | 'disposed'`;
`CommitRejection: 'stale-revision' | 'permission-missing' | 'write-scope-mismatch' |
'guarantee-unachievable' | 'fidelity-unproven' | 'confirmation-required' | 'payload-unavailable' |
'plan-invalid' | 'source-read-only' | 'cancelled'`; `TransactionStatus: 'committed' |
'partially-applied' | 'rolled-back' | 'not-applied'`; `UndoGuarantee: 'inverse' | 'snapshot' |
'replay' | 'none'`.

**Граница исполнения (capability‑RPC, появится с worker‑backend)** — `x3.host/rpc-peer-exited`
(worker упал/убит), `x3.host/rpc-terminated`, `x3.host/rpc-endpoint-closed`,
`x3.host/rpc-deadline-exceeded` (зависание; `retryability: 'conditional'`),
`x3.host/rpc-protocol-violation` (worker вёл себя некорректно — принудительно остановлен),
`x3.host/rpc-events-overflow` (UI не успевает потреблять поток), `x3.host/rpc-released-handle`,
`x3.host/rpc-limit-exceeded`. Восстановление после `rpc-peer-exited` — новое **поколение**
(generation) worker'а: старые сессии не оживают, их надо переоткрыть.

**Расширения** — `ExtensionOrigin: 'bundled' | 'installed' | 'linked'`;
`ExtensionExecutionPolicy.allowTrustedInProcess: boolean` (host‑side решение, никогда не из
манифеста); `SpecState`/`inventoryEligible`/`activationEligible` из inventory (unknown‑contract —
inspectable, но не активируемый); включение/выключение — `packages/ui/src/settings/model.ts`
(`enabled`).

**Диагностики** — `severity: 'error' | 'warning' | 'information' | 'hint'`, `code`, `message`,
`path?`, `data?`; `retryability: 'never' | 'safe' | 'conditional'` у ошибок.

## 3. Что нужно получить

1. **State table** (одна строка на состояние/переход): trigger (тип/код из §2) → что видит
   пользователь (краткий текст, тон), доступные действия (retry / open as text / open as hex /
   grant / choose candidate / reload extension / report), retryability, где раскрывается detail
   (diagnostics viewer), что логируется. Обязательно покрыть: resolving/probing/opening;
   `unresolved` × 4 причины (в т.ч. «кандидаты есть, но исполнить нельзя» — worker‑only без
   backend'а); `ambiguous` (выбор пользователя между кандидатами с confidence);
   permission requested/granted/refused; `full-process-authority` (постоянный, не модальный
   индикатор); worker crash/hang/restart (generation bump: какие вкладки/сессии переоткрывать);
   stale revision / source changed под открытой сессией; missing/ambiguous companions
   (`input-unresolved`); bundled/installed/linked; enable/disable/update при живых сессиях
   (24 §9: живая сессия не получает silent update).
2. **Wireframes** для Electron, PWA, VS Code (extension host + webview) с общей semantic‑моделью:
   где живёт статус открытия (footer/статусбар/тост), где список кандидатов и объяснение выбора
   (`explain`), где extension manager.
3. **Accessibility**: фокус после смены состояния, screen‑reader announcements для переходов,
   прогресс/отмена (cancel — обязателен для probe/open > 1 s), статус не только цветом.
4. **Extension manager flow** без принятия security‑решений в renderer: включить/выключить,
   обновить, показать origin, показать «полная власть процесса» и **кто её выдал** (host policy),
   удалить; конфликты с живыми сессиями.
5. **Design tokens/parts reuse** и список недостающих UI‑примитивов (`packages/ui/src/{parts,tokens,primitives}`).
6. **Negative UX**: запрещены silent fallback (пользователь всегда знает, что открыто и почему),
   modal spam, «понижение профиля молча», сокрытие diagnostics.

## 4. Границы

- Никаких изменений в `packages/host/**`, `packages/sdk/**`, `apps/**/main`, `apps/**/preload`,
  манифестах и схемах.
- Первый проход — документ (markdown + wireframes как SVG/mermaid в `docs`‑папке приложения или
  `packages/ui/docs/`, по согласованию с Root); production‑компоненты — только после
  capability‑RPC/backend contracts (NXT‑100/105) и явной команды Root.
- Не переименовывать состояния; предложения по словарю — отдельным разделом.
- Не решать, кому доверять: `allowTrustedInProcess`, гранты, lock — вне scope; UX показывает и
  объясняет решение хоста, но не принимает его.

## 5. Формат ответа

1. `OPUS_UX_LIFECYCLE_STATES_<date>.md` с таблицей состояний (§3.1), картой компонентов и списком
   недостающих примитивов.
2. Wireframes (3 хоста × ключевые состояния) — файлы рядом.
3. Раздел «предлагаемые термины» (если нужен) и «вопросы Root/Fable».
4. Явный список того, что документ **не** решает (см. §4).
