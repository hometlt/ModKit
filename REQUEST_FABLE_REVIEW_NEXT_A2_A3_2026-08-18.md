# Запрос Fable: независимый review следующего A‑2/A‑3 плана

## Роль

Ты — независимый архитектурный и adversarial reviewer. На первом проходе не изменяй production
code и owner-документы. Цель — проверить, что следующий план действительно продолжает уже
реализованный product path, не создаёт вторую authority и не делает ложных security claims.

## Проверенная база

Repository: `modkitX3`  
Branch: `spec/mk3-extension-reference`  
Baseline: `74b7976`

Последовательность:

- `ad6f0cc` — host `openSubject` pipeline;
- `f510b3b` — Electron main composition, leased IPC, renderer codec removal, app/import/inventory
  gates;
- `74b7976` — документационное закрытие G‑APP‑1 и MK2 allocation report.

Последний полный gate: `pnpm check`, 66 test files / 476 tests, 14 schemas, 16 UI manifests и 16
app/realm cases.

## Обязательные материалы

Прочитай:

1. `PLAN_NEXT_A2_A3_WORKER_VFS_APPS_2026-08-18.md` полностью.
2. `IMPLEMENTATION_NOTES.md`, раздел G‑APP‑1/W1–W5/V1–V2.
3. `REPORT_A0_A8_CODECS_UI_APPS_COMPLETION_2026-08-17.md`, correction/closure.
4. `packages/host/src/subject-open.ts`.
5. `packages/host/src/security/gate.ts`.
6. `packages/host/src/source-bridge.ts`.
7. `packages/host/src/resolution/{resolver,lock}.ts`.
8. `packages/sdk/src/runtime-abi.ts`.
9. `packages/vfs/src/source.ts`.
10. `apps/electron/src/index.ts`, `apps/electron/electron/{main,preload}.cjs`.
11. Owner docs: MK3/23, MK3/24, MK3/27 и canonical VFS/Asset Capabilities sections.

## Вопросы review

### A. Execution backend

1. Верно ли, что backend registry должен быть internal host SPI, а resolver не должен предпочитать
   execution profile?
2. Достаточно ли связаны ticket → artifact digest → entrypoint → runtime variant → backend?
3. Где возможен profile downgrade, TOCTOU или повторный import до final gate?
4. Нужно ли менять public SDK ABI, или private protocol действительно достаточен?

### B. Worker protocol

1. Какие состояния/переходы отсутствуют в `load/call/return/throw/cancel/release/terminate`?
2. Как закрыть stale handles, duplicate/late replies, worker restart и release races?
3. Какие значения нельзя безопасно передавать structured clone?
4. Как сохранить `Lease`, `AsyncIterable`, events, `AbortSignal`, `ModkitError`, bigint и typed arrays?
5. Какие host-owned limits нужны на сообщения, handles, pending calls, iterators и transfers?
6. Где именно проходит честная SB‑1 граница и какие claims запрещены?

### C. VFS/container/input planning

1. Какой пакет должен владеть canonical bigint byte-source contract?
2. Правильны ли service seams `common.vfs/mount@1` и `common.vfs/container@1`?
3. Достаточны ли revision vector, path normalization, credential handles и transaction boundaries?
4. Может ли предложенный resolver корректно представить ZIP, CUE+2 BIN, namespace-root и derived
   inputs без host-invented identity?
5. Какие owner-doc противоречия надо решить до кода?

### D. Apps и lifecycle

1. Правильна ли последовательность Electron → PWA → VS Code → CLI/server?
2. Что должно быть общим application adapter, а что обязано остаться app-specific transport/UI?
3. Как installed/linked provenance влияет на trusted variants, locks, updates и live sessions?
4. Какие runtime product-open cases отсутствуют в матрице?

### E. Делегирование

1. Какой один сложный bounded slice Fable рекомендует взять себе после review?
2. Какие задачи безопасно отдать Opus на UX/design?
3. Какие задачи можно параллелить обычными агентами без пересечения authority/API?
4. Какие file scopes должны быть эксклюзивны root-интегратору?

## Требуемый формат ответа

Начни с:

```text
VERDICT: ACCEPT | REVISE | BLOCK
BASELINE VERIFIED: yes | no
HIGHEST RISK: <one sentence>
```

Далее:

1. Таблица findings: ID, P0/P1/P2, exact file/doc, доказательство, consequence, минимальное решение.
2. Patch-list для плана: какие NXT-задачи добавить/убрать/переставить/разделить.
3. Owner decisions: вопрос, recommended default, что блокирует.
4. Delegation matrix: Fable / root / Opus / other agents, с file scopes и prerequisites.
5. Acceptance additions: hostile tests и product cases, которых сейчас нет.
6. Recommended first implementation slice — одна ограниченная задача, не весь roadmap.

Не засчитывай зелёный декларативный app matrix как доказательство product-open runtime. Не предлагай
silent downgrade worker → trusted. Не расширяй scope до Multiverse/renderer/MK2 migration, если это
не прямой blocker для указанного A‑2/A‑3 seam.

## Возможная задача Fable после ACCEPT

Предпочтительный кандидат:

> Спроектировать и реализовать private worker protocol v1 validators + host/worker handle state
> machine с hostile tests, не трогая app adapters и public SDK ABI.

Предварительный file scope должен быть новым и изолированным, например
`packages/host/src/execution/worker-protocol.ts`, `worker-handles.ts` и соответствующие tests. Root
отдельно интегрирует backend registry, Node/Web transports и приложения после review результата.
