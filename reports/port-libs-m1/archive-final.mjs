import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const source = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(source, '../../..')
const core = path.join(workspace, 'modkit-core')
const target = path.join(core, 'reports/port-libs-m1')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = value => `${JSON.stringify(value, null, 2)}\n`
const head = dir => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim()
const archived = []
async function copy(from, to, compress = false) {
  const bytes = await readFile(from)
  const compressed = compress && bytes.length > 5 * 1024 * 1024
  const stored = compressed ? gzipSync(bytes, { level: 9 }) : bytes
  const destination = `${to}${compressed ? '.gz' : ''}`
  const absolute = path.join(target, destination)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, stored)
  const reread = await readFile(absolute)
  if (sha(reread) !== sha(stored) || (compressed && sha(gunzipSync(reread)) !== sha(bytes)))
    throw new Error(`Archive mismatch: ${destination}`)
  archived.push({ path: destination, origin: path.relative(workspace, from).replaceAll('\\', '/'),
    originSha256: sha(bytes), originBytes: bytes.length, encoding: compressed ? 'gzip' : 'identity',
    sha256: sha(stored), bytes: stored.length })
}

const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const current = []
for (const name of names) {
  const receipt = JSON.parse(await readFile(path.join(source, 'oracle', `${name}.current.receipt.json`)))
  if (receipt.verdict !== 'pass' || receipt.exitCode !== 0 || !receipt.summaryMatchesM0 || !receipt.outputMatchesOld ||
      receipt.mk3Commit !== head(core) || receipt.mk3WorkingTree.diffSha256 !== sha(Buffer.alloc(0)))
    throw new Error(`Current M1 parity is not proven on clean implementation HEAD: ${name}`)
  current.push(receipt)
}
const packages = JSON.parse(await readFile(path.join(source, 'core-final-packages.json')))
if (!packages.success || packages.numFailedTests !== 0 || packages.numPendingTests !== 0 || (packages.numTodoTests ?? 0) !== 0 || packages.numPassedTests === 0)
  throw new Error('Final package regression must pass without skipped tests')

for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && (/^(core-final-|blizzard-final-)/u.test(entry.name) || ['migration-preflight.log', 'p0-sdk-tests.log'].includes(entry.name)))
    await copy(path.join(source, entry.name), `final/${entry.name}`)
}
const preflight = JSON.parse(await readFile(path.join(source, 'preflight.json')))
delete preflight.processes
await writeFile(path.join(target, 'final/preflight.json'), json(preflight))
for (const entry of await readdir(path.join(source, 'oracle'), { withFileTypes: true })) {
  if (entry.isFile() && names.some(name => entry.name.startsWith(`${name}.current.`)))
    await copy(path.join(source, 'oracle', entry.name), `current-parity/${entry.name}`, true)
}
for (const name of ['compare-runtime-root-final.mjs', 'verification.json', 'build.log', 'typecheck.log', 'lint.log', 'format.log', 'test.log'])
  await copy(path.join(source, 'extension-manager-ts', name), `extension-manager/${name}`)
for (const entry of await readdir(path.join(source, 'extension-manager-ts/root-final'), { withFileTypes: true }))
  if (entry.isFile()) await copy(path.join(source, 'extension-manager-ts/root-final', entry.name), `extension-manager/root-final/${entry.name}`)
for (const entry of await readdir(path.join(source, 'vendor-host-final'), { withFileTypes: true }))
  if (entry.isFile()) await copy(path.join(source, 'vendor-host-final', entry.name), `vendor-host-final/${entry.name}`)
for (const entry of await readdir(path.join(source, 'core-ts'), { withFileTypes: true }))
  if (entry.isFile() && /^(port-oracle-proof-|uv-final-|uv-boundary-|uv-runtime-|check-uv-boundary-runtime)/u.test(entry.name))
    await copy(path.join(source, 'core-ts', entry.name), `core-ts/${entry.name}`)
for (const name of ['BRIEF_SC2_BANK.final.md', 'sc2-bank-parity.final.mjs'])
  await copy(path.join(source, 'generated', name), `generator-examples/${name}`)
for (const name of ['surfaces-receipt.json', 'surfaces-tests.json'])
  await copy(path.join(core, 'reports/port-infra', name), `final/${name}`)
await copy(fileURLToPath(import.meta.url), 'archive-final.mjs')
await writeFile(path.join(target, 'final/archive-origins.json'), json(archived))

const files = []
async function inventory(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) await inventory(absolute)
    else if (entry.isFile()) {
      const rel = path.relative(target, absolute).replaceAll('\\', '/')
      if (['receipt.json', 'manifest.json'].includes(rel)) continue
      const bytes = await readFile(absolute)
      files.push({ path: rel, sha256: sha(bytes), bytes: bytes.length })
    }
  }
}
await inventory(target)
const manifest = json({ schemaVersion: 1, files })
await writeFile(path.join(target, 'manifest.json'), manifest)
const receipt = {
  schemaVersion: 1, milestone: 'M1', stage: 'infrastructure-ready', verdict: 'pass',
  ownerAcceptance: 'pending', generatedAt: new Date().toISOString(),
  repositories: { core: head(core), blizzard: head(path.join(workspace, 'modkit-extensions-blizzard')), docs: head(path.join(workspace, 'references/modkit-docs')) },
  oraclePin: '1a14ba4eddd0ae88de273348ebd44cfb98a0581d', acceptedM0: '878f9cd7658bc065a3eaa034a7f89e5020c887fe',
  strict: { packages: 8, sourceFiles: 281, errors: 0, remainingJavaScriptSources: 0 },
  tests: { packages: { passed: packages.numPassedTests, failed: packages.numFailedTests, skipped: packages.numPendingTests }, quick: { vitestPassed: 386, extensionManagerPassed: 62 }, migrationInfrastructure: { passed: 68 }, boundaryGates: { passed: 11 }, surfaceFixtures: { passed: 64, fullFamilyAcceptance: false }, pinnedP9Comparisons: 53 },
  currentM0Parity: current.map(item => ({ name: item.name, exitCode: item.exitCode, measurements: item.measurements, corpusDigest: item.corpusDigest, outputMatchesOld: item.outputMatchesOld, receipt: `current-parity/${item.name}.current.receipt.json` })),
  integrity: { frozenLegacyCodecs: 206, auditedSc2Codecs: 12, publishedContributions: 193, authoredCampaignRows: 1, pendingRequirements: 891, sc2ClosurePending: 309, registry: { knownDebt: 38, newProblems: 0, staleBaselineEntries: 0, unavailableChecks: 1 }, preservedE5Rows: 3 },
  copies: { scope: 'm1-libs', files: 50, importRewrites: 97, authoredAdapterBindings: 3, algorithmDebt: 51, canonicalAlgorithms: 5, newAlgorithmDebt: 0 },
  gates: ['core-final-m1-check.log', 'core-final-lint.log', 'core-final-format.log', 'core-final-quick.log', 'core-final-packages.log', 'core-final-boundaries.log', 'core-final-committed-gates.log', 'core-final-current-parity.log', 'blizzard-final-quick.log', 'blizzard-final-link.log', 'blizzard-final-pack.log'].map(log => ({ log: `final/${log}`, exitCode: 0 })),
  expectedIncompleteGate: { log: 'final/core-final-sc2-closure.log', command: 'pnpm port:closure', exitCode: 1, reason: 'SC2 family obligations remain pending; M1 establishes infrastructure only.' },
  limitations: [
    'M2 sc2-bank has not started; next milestone requires explicit owner acceptance of M1.',
    'sc2-campaign is separately authored CMP1-CMP6 scope, not parity against an MK2 stub.',
    'BPTC includes 1280 legacy-only refusals; they are not both-refused or successful semantic coverage.',
    'Old/new loader step 0.3 uses accepted M0 MK3 snapshot; current-parity is a separate frozen M1 run.',
    'MPQ ADPCM remains explicitly unavailable; inherited broken MD5 is internal and excluded from the public crypto barrel.',
    'Bzip2 is a new bounded adapter, not legacy parity; texture browser asset path is exercised under Node, not a browser-host acceptance.',
    'Blizzard quick/link retain three pre-existing skips; none were added.',
    'Real harness verifies oracle artifact identity; semantic correctness of each adapter still requires review.',
    'Full family surfaces, detailed MPQ/CASC audits, P1-P12 consumers and installed host acceptance remain at their planned milestones.'
  ],
  evidenceManifest: { path: 'manifest.json', sha256: sha(manifest), fileCount: files.length, bytes: files.reduce((sum, item) => sum + item.bytes, 0) }
}
await writeFile(path.join(target, 'receipt.json'), json(receipt))
const report = `# M1 — инфраструктура переноса SC2, 2026-09-04

**Готово к приёмке владельцем: infrastructure-ready. M2 не начата.**

[Receipt](port-libs-m1/receipt.json) · [Manifest доказательств](port-libs-m1/manifest.json) · [ADR shim](../adr/ADR-CODEC-001-legacy-kit.md).

Код ядра: \`${receipt.repositories.core}\` (ветка \`sol/port-libs\`), SDK P0: \`2045ff52\`.
Blizzard: \`${receipt.repositories.blizzard}\` (\`sol/port-sc2\`).
Планы: \`${receipt.repositories.docs}\` (\`sol/port-plan-review\`).

## Результат M1

| Область | Результат |
| --- | --- |
| T1/T2 | Восемь пакетов, 281 исходный TS-файл; strict typecheck 0 ошибок, исходных JS 0. Экспорт из dist, декларации собраны. Приложения остаются в общем typecheck; дополнительный профиль для них — T3. |
| 0.2, 0.8 | Blizzard TS lane, единый конфиг tier-тестов, vendor/link режимы; pack 289 файлов. |
| 0.3 | Пять old/new loader сравнений на принятом M0 snapshot: одинаковые выводы, порядок корпуса и counts. Затем пять отдельных сравнений на чистом текущем M1 commit. |
| 0.4 | SDK P0: типизированные поля, metadata/filter/edit контракты, data-only subject-kind, операции и 22 JSON-схемы. |
| 0.5, 0.10 | Изолированный legacy shim; диагностики 14→9, явные operation/edit/language/runtime адаптеры. Канонические crypto/compression/texture библиотеки; 11 fixture-тестов и 53 непустых pinned-сравнения. |
| 0.6 | 50 exact copies, 97 import rewrites, 3 authored adapter bindings. Подмена, неполный scope и двойное назначение отклоняются; sha1 банка имеет один canonical destination. |
| 0.7, 0.9 | Заморожены 206 legacy codecs, учтены 12 SC2-аудитов и 193 contributions из шести репозиториев; campaign — отдельная authored-строка. Ledger/evidence integrity проходит, pending видны. |
| 0.11 | Генераторы brief/harness и evidence:apply с положительными/отрицательными fixtures. Реальный harness проверяет байты oracle/cache/source/loader/dependencies и связывает proof с операцией и успешными case IDs. |
| Минимальные surfaces | 64 теста: поля, lazy data, разрешения, операции, edit/commit/reopen и writer no-op с сохранением байтов. Полные поверхности семейства остаются открыты. |

План P12 SC2 discovery зафиксирован в \`PLAN_MODKIT_CORE_SUBJECT_MODEL_2026-09-04.md\`, §P12:
единый провайдер установки и ручных каталогов, одинаковая валидация маркеров, общий источник корпуса для real-tier;
рабочая интеграция обязательна до M8. В M1 используется явный корпус \`C:/FILES/SC2Files/Mods\`.

## Проверки финального состояния

- \`pnpm m1:check\`, полный lint/format и schema/import/legacy/extension gates — exit 0.
- \`pnpm test:quick\`: 386 Vitest + 62 extension-manager теста прошли.
- Полная выбранная регрессия SDK и семи пакетов: **${packages.numPassedTests} тестов**, 0 failed, 0 skipped; [лог](port-libs-m1/final/core-final-packages.log), [JSON](port-libs-m1/final/core-final-packages.json).
- Blizzard \`test:quick\`, \`test:link\`, \`check:pack\` — exit 0. Три прежних skipped теста сохранены; новых skip/увеличений timeout нет.
- Шесть vendor TGZ проверены отдельным потребителем: 57 публичных импортов, strict, \`skipLibCheck=false\`, независимые runtime imports и векторы. Host пересобран после финального форматирования; 392/392 файла совпали с TGZ.
- Перенос runtime подтверждён нормализованным сравнением: 27/27 T1, 9/9 T2, 15/15 extension-manager; финальная UV-проверка 10/10. Единственное дополнительное поведение host — регистрация нового data-only subject-kind.

| Текущий M1 против принятого DDS baseline | Совпало | Расхождения |
| --- | ---: | ---: |
${current.map(item => `| ${item.name} | ${item.measurements.identical}/${item.measurements.compared} | ${item.measurements.differing} |`).join('\n')}

Корпус, команды, параметры и SHA сохранены в [current-parity](port-libs-m1/current-parity/).
В BPTC остаются 1280 отказов только legacy; они не выданы за двусторонний отказ или покрытие функции.

\`migration:check registry: known debt 38, new problems 0, stale baseline entries 0, unavailable checks 1\`.
Три E5 сохранены. Algorithms ratchet: 51 прежний долг, 5 canonical algorithms, новый долг 0.
Общий ledger: 891 pending; явный SC2 closure возвращает exit 1 с 309 pending требований — ожидаемо до следующих вех.

## Границы и изменения проверок

Сохранены поведенческие assertions; механически обновлены src→dist пути, число data-only контрактов и проверки рекурсивной схемы.
У extension-manager сохранён runtime; восстановлены прежние публичные типы callback/options для приложений.
UV выводит типы из SDK и не зависит от codec-kit.
Legacy vocabulary exception действует лишь после проверки точных canonical copies; authored adapters и обычный MK3-код проверяются полностью.
Форматирование двух прежних файлов и запись Array<T>→T[] исправлены без изменения runtime/assertions.
Байтовые отчёты и generated output исключены из форматирования и защищены собственными digest-гейтами.
Exact copies проверяются strict TypeScript и copy gate; общий lint/format применяется к authored adapters, не переписывая копии.

MPQ ADPCM явно unavailable; исторический неработающий MD5 оставлен внутри canonical source и не экспортируется публичным crypto API.
Bzip2 — новый ограниченный адаптер, не legacy parity. Browser asset-URL ветка texture проверена под Node; browser-host acceptance ещё впереди.
Адаптеры оракула требуют семантического review даже после проверки происхождения артефактов.
Исторические неудачные прогоны сохранены как история; финальная регрессия выше прошла целиком.

\`sc2-campaign\` будет создан по CMP1–CMP6 в M6: create/open/edit/save, состав карт, связи, зависимости, validation и сохранение неизвестных данных.
После явной приёмки M1 следующая очередь — M2 \`sc2-bank\`: bootstrap closure, адаптер, собственные тесты MK2, реальный дифференциал и scoped port-ready receipt.

Проверить байты архива: \`node reports/port-libs-m1/verify.mjs\` из modkit-core.
Перезапустить пять сравнений: \`node artifacts/legacy-oracle/run-dds-current.mjs\` из рабочего корня после фиксации всех source-изменений.
Receipt не означает приёмку владельцем и не закрывает M2 или всё семейство.
`
await writeFile(path.join(core, 'reports/PORT_LIBS_M1_2026-09-04.md'), report)
console.log(json({ archived: archived.length, evidenceFiles: files.length, bytes: receipt.evidenceManifest.bytes, currentParity: current.map(item => item.measurements.compared), packages: receipt.tests.packages }))
