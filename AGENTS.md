# modkit-core — правила для агентов

Сначала прочитай общий свод правил рабочего пространства: `../AGENTS.md`
(`C:\MODDING\AGENTS.md`). Этот файл только дополняет его для ядра.

## Что здесь

- `packages/` — `core`, `sdk`, `vfs`, `host`, `codec-kit`, `scene`, `uv`, `code`, `ui`,
  `extension-manager`, `testkit`. Назначение и направление зависимостей — `../AGENTS.md` §3.
- `apps/` — `vscode`, `electron`, `web` (PWA, `apps/web/dist-app` закоммичен), `cli`, `mcp`,
  `lsp` (общий адаптер language contributions), `server`, `automation-host`.
- `extensions/` — встроенные format-neutral расширения (archives, audio, data, documents, images,
  models, translation, vector, video). Игровых соглашений здесь нет.
- `migration/`, `scripts/migration/`, `reports/parity/` — feature ledger, operation map, receipts,
  решения владельца (`reports/parity/owner-decisions/`). Правила храповика — `../AGENTS.md` §6.
- `adr/` — архитектурные решения. Долгоживущая документация MK3 вынесена из репозитория (см.
  `docs/README.md`); код-локальные README лежат рядом с кодом.

## Проверки

- Быстро: `pnpm check:fast` (типы + независимые тесты пакетов, до 4 потоков).
- Полная цепочка перед выпуском: `pnpm check` (включает унаследованные MK2-гейты — см. `../AGENTS.md` §8).
- Ledger: `node scripts/migration/check-feature-ledger.mjs` (0 проблем обязательно).

## Не терять и не пересоздавать

Перед новой возможностью и перед удалением или заменой кода — порядок из `../AGENTS.md` §4.0:
искать по каталогу §4.3–4.5, манифестам, сверке `modkit-core/reports/parity/sc2-pending-audit-2026-09-24.json`
и `git grep`; удалять только с заменой и тестом; найденный неописанный функционал дописывать в каталог.

## Перед изменением пакета

1. Найди существующую реализацию (`../AGENTS.md` §4). Новый алгоритм — узкий подпуть
   `codec-kit` + карта модулей веб-воркера (четыре файла в `apps/web`).
2. Строгий TS, без новых потребителей `codec-kit/legacy/*`.
3. После изменения публичного API пакета — vendor hop в репозитории расширений, иначе они его
   не увидят (`../AGENTS.md` §6).
4. Важное архитектурное изменение — строка в журнал `../AGENTS.md` §10.
