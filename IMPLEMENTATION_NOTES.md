# Implementation notes — modkitX3

Newest entries first. Owner documents live in `modkitx/docs`; this file records lab-side
analysis, decisions inside the delegated lab scope, and owner-decision gaps. It never
overrides a canonical or detailed owner.

---

## PLAN_FABLE_NEXT closure — editing parity, host contracts and app boundaries (Fable, 2026-08-20)

All nine implementation items in `PLAN_FABLE_NEXT_2026-08-20.md` are closed, with the remaining
real-VS-Code limitation kept as a validation boundary rather than hidden as implementation debt.

**Editing parity (`9cfafec`, `4d6c277`, `cfe59f7`).** VS Code now exposes mutating codec
operations and exact archive-entry bytes; the PWA's generated valid MP3 fixture completes a live
Chromium edit/save/reopen loop; packed library installation is proved from tarballs in a clean
consumer. Electron resolves the PNG `png/rgba8@semantic` writer, authors an RGBA semantic intent,
discloses the metadata-loss boundary, commits and reopens the changed pixel. JPEG remains read-only
because it has no matching semantic writer.

**Archive and fidelity contracts.** `container.extract` is a core-owned standard operation with a
typed `{ entryId }` input; ZIP publishes it and each application resolves that exact id rather than
knowing a codec-private spelling. Codec contributions also publish fidelity-evidence coordinates.
The host joins those declarations to the selected inventory record's real `providerVersion` and
`artifactDigest`, so neither Electron nor web carries copied ZIP proof literals. The final live
Electron smoke caught that its ESM adapter had not re-exported the new helper to the CommonJS main
process (writable subjects degraded to read-only); the adapter export and an exact-surface
regression test now protect that runtime composition boundary.

**One settings surface.** `createSettingsUi({ extraGroups })` accepts host groups with stable
context plus reload/destroy hooks; an extra group with a built-in id replaces it in its established
position. Electron now mounts Appearance, Extensions, Codecs and File associations in one settings
root rather than maintaining a second page.

**Embed trust.** `<modkit-viewer extension-catalog="…">` accepts an HTTP(S) catalog only when its
exact origin was baked into the build through `MODKIT_EMBED_EXTENSION_ORIGINS`. Runtime globals and
page attributes cannot expand the list. Catalog shape and declared digests are checked, installed
inventory origin is preserved, and remote code remains worker-only. Chromium proves both a
build-pinned other-origin catalog and refusal before fetch for a page-invented origin.

**Native VS Code document lifecycle.** The extension implements `CustomEditorProvider`, including
dirty events, save, revert, save-as and backup/restore. Editor Save buttons request native VS Code
save; the mounted text/hex editor commits first, then the webview drops the stale revision and
reopens from disk. The pure `CustomDocumentState` and structural duplex bridge tests cover lifecycle
ordering; `ext:build` proves the production CommonJS extension and webview bundles compose. A live
VS Code window is still unavailable in this environment.

**Explicit app graphs.** Production web sources no longer import the UI root barrel. The VS Code
stage catalog imports explicit surface subpaths and a source-boundary test refuses root, graph,
Monaco, settings or shell/workbench imports there. The measured reductions are deliberately small
(PWA control bundle −94 bytes; webview −98 bytes) because esbuild already tree-shook the barrel;
the durable result is that future root exports cannot silently widen these app graphs.

---

## Вкладки, минимальные сборки, документация — блок по списку владельца (Fable, 2026-08-20)

Владелец передал список из 12 задач (вкладки, документация RU, инструкция ИИ-агенту, принцип
минимальной сборки, опциональность вьюверов/расширений, tree-shaking, уровни использования,
алгоритм выбора, аудит приложений, «блоки, а не монолит»). Что легло и какими фактами:

**Вкладки (`6884a17`).** «Все открытые файлы выводятся один под другим» — точный репорт. Причина:
авторский `display: flex` на `explorer.tabcontent` побеждает UA-правило `[hidden]{display:none}`,
так что `content.hidden = true` ставился и не действовал; тем же классом бага были биты
`explorer.header` и др. Исправление структурное — `[data-mk-part][hidden]{display:none !important}`
(атрибут — семантическое обещание, `!important` возвращает UA-семантику, а не воюет с ней).
Negative-check выполнен: без правила новый e2e-кейс падает. Кейс закрепляет и оба требования
владельца дословно: содержимое вкладок остаётся смонтированным (переключение — только видимость),
повторная активация не создаёт второй экземпляр (mounts === 2 после переключений).

**Минимальные сборки (`0d544ca`).** `@modkitx-x3/ui`: субпути укомплектованы (`./explorer`,
`./hex-editor`, `./media` добавлены; ВАЖНО: `pnpm bundle` прунит всё, чего нет в exports-карте, —
новый субпуть без пересборки означает пустой dist), `sideEffects: false` объявлен честно (чистые
фабрики и данные). `scripts/test/minimal-build.test.ts` — гейт: пять эталонных потребителей
собираются esbuild'ом (stdin+resolveDir — bare-имена резолвятся от корня repo), и в байтах
проверяется отсутствие незваных поверхностей. **Урок маркеров**: словарь `parts.ts` несёт ВСЕ
part-имена в любой модуль, штампующий часть, — маркер по part-имени репортит словарь как
поверхность (первый черновик гейта ровно так и соврал). Маркеры — уникальные строки самих
поверхностей (их UI-тексты).

**Аудит (`docs/AUDIT_APPS_2026-08-20_RU.md`).** Во всех шести приложениях каждая заявленная
зависимость используется — удалять нечего. По бандлам: Monaco только в Electron (легитимен только
там), в VS Code отсутствует — требование владельца выполняется; webview VS Code несёт workbench по
дизайну A11; embed.js чист.

**Документация (`1249f40`).** `docs/GUIDE_DEVELOPER_RU.md` — архитектура, цепочка
файл→codec→viewer→extension, две полосы подключения как центральное различие, уровни использования
с минимальными конфигурациями, полный шаблон манифеста кодека (регистрация типов файлов =
`spec.match`), алгоритм из 12 вопросов. `docs/GUIDE_AI_AGENT_RU.md` — предписывающая версия:
карта модулей, запреты (barrel, Monaco вне Electron, Extension Host без нужды), рецепты по
платформам, обязательная проверка бандла. Принцип «набор независимых блоков, а не монолит» теперь
и текст, и гейт.

Попутно: `x3.host/edit-plan-subject-mismatch` доказан через провод (`dffa3f3`) — assert по
`code` на объекте ошибки (RPC сохраняет коды; grep по message его не находит — message кода не
несёт). И формат-id в doc-комментарии платформенного пакета — реальное нарушение границы, гейт
packed-codecs его поймал (`038de03`).

---

## Owner decisions and the two connection lanes (Fable as delegated owner, 2026-08-20)

The owner delegated the open decisions («ты владелец, реши вопросы») together with a request:
extensions connectable by static `import` into any bundle, curated builds («все вьюеры изображений
и ничего лишнего»), settings pages that connect/enable/disable extensions _and_ codecs, and modkit
as an easily consumed Node library. Decisions taken, each recorded where the code enforces it:

1. **Two connection lanes, split by trust.** Dynamic (`extensions`, `userExtensions`, the
   catalogs): an extension is an artifact — files, digest-verified, executed worker-brokered.
   Static (`modules`, `@modkitx-x3/extensions`): the application imported the extension at build
   time, and **the import was the trust decision** — refusing to run caller-linked code in-process
   while the rest of the caller's bundle runs in-process would be theatre. Linked contributions
   run only variants they _declare_ as `trusted-in-process` (the PNG encoder writer is worker-only
   and is excluded with that reason, never re-declared), and the gate still emits
   `x3.host/full-process-authority` on every activation. `packages/host/src/linked.ts` carries the
   full statement.

2. **The generated package is the import surface.** `packages/extensions-linked`
   (`@modkitx-x3/extensions`, generated by `scripts/emit-linked-extensions.mjs`, `linked:check` in
   the build chain) inlines each extension's manifests as data and its entrypoints as real ESM
   imports a bundler follows. Curated sets (`imagesOnly`, `modelsOnly`, `media`, `structuredText`,
   `archivesOnly`, `documentsOnly`, `everything`) answer the «и ничего лишнего» case. Browser-only
   extensions (monaco) are subpath imports only: an ESM barrel evaluates its whole graph, and one
   eager re-export would crash every Node consumer — found the hard way, encoded in the generator.

3. **Two resolution lanes in the facade**, because the mechanisms declare different environments:
   worker realm first — isolation is the point of loading by directory — and the trusted lane only
   when nothing brokered claims the subject. A codec available both ways still runs isolated.

4. **Disabling a codec is inventory work, not UI filtering.** `disabledContributions` (threaded
   from `createModkit` down to `buildInventory`) keeps the record listed — a settings page must
   show what is off, or it cannot be turned back on — and drops `activationEligible`, so the host
   refuses selection rather than each application reinventing a filter. Diagnostic
   `x3.host/contribution-disabled`, severity _information_: nothing is wrong, somebody chose this.

5. **Publication stays off; the blocker is now named.** `createModkit` and
   `@modkitx-x3/extensions` are exactly as useful as they are installable; workspace/git linkage
   is today's answer, npm publication is the real owner's call and is listed in the plan as the
   blocker of the library lane, not as a footnote.

6. **Deferred with reasons**: real playable media corpus (needs actual encoded files, not worth
   faking), Cyrillic Saira companion (fonts are an asset decision), the Nexus layout adoption, and
   in-page (non-worker) execution for the browser — the embed lane's curated static builds cover
   the stated need without a new browser trust boundary.

---

## A8 / A9 + the defects they surfaced — editing and user extensions in the browser (Fable with Opus agents, 2026-08-19/20)

**A9 — the PWA loads a user's own extension folders** (`d085968`, merged `399d5c4`).
`apps/web/src/extension-roots.ts` is the browser twin of `loadExtensionRoots`, reusing the Node
failure codes verbatim and reproducing the Node digest stream byte for byte, so a folder digests
identically on both hosts. Bytes reach the verified loader through a synthetic
`https://user-extension.invalid/<root>/<path>` origin served from the granted handles — no second,
unverified load path, and a composition that forgets to install the shim fails rather than reaching
a real server. Handles persist in IndexedDB; no digest is ever stored, every load re-reads and
re-hashes, and a lapsed grant shows as "needs permission" with a button rather than prompting on
page load.

**A8 — editing in the browser** (merged `2791c1e`). `describeEditability` answers "is this entry
writable?" without prompting anybody, and the honest notice changed from "this build has no browser
editing backend" to the handle rule that is now the truth: a picked file can be saved in place, a
dropped or fetched one genuinely cannot. The revision token is taken from the handle _before_ the
bytes are read, so a file that changed under the tab is refused rather than overwritten — proven
live, with the second save from a stale tab refused and the first save's bytes intact.

### The five defects the wiring exposed (`67dc269`)

Each of these was invisible until an app tried to use the seam, which is the recurring lesson of
this whole stretch: a contract nobody exercises is a contract nobody has checked.

1. **No multi-edit plan could commit.** The coordinator computes every request's `expectedRevision`
   before a batch runs, so two edits against one source arrive carrying the same one; both backends
   looped through `apply`, which compares against the _live_ revision, so the first write moved it
   and the second was refused as a lost conditional write. A hex editor writing two runs had to
   merge them to save at all. The shared `applySequentialBatch` threads each write's revision into
   the next; the first write to a source still honours the caller's expected revision, which is the
   guard that catches a file changed under the editor.
2. **The hex editor could not save through any writer.** It hand-built a change with
   `baseRevisions`, `bindingId` and a bare `kind` — fields no contract declares — and cast it
   `as never`, silencing the one place that would have said so.
3. **Editability was decided per host, where a browser needs it per file.** `editorPorts` may now
   answer `undefined` for one entry, and is asked once per opened subject rather than once per stage
   mount.
4. **One name for the edit session.** `SubjectEditorPorts.edit` and `createCodecPreview`'s
   `ports.session` were the same thing under two names.
5. **A bare side-effect import was silently dropped** by the verified loader's specifier scan — a
   relative one in that position was never fetched, hashed or rewritten at all. Fail-closed, but the
   named refusal was lost. Checked against all 209 real extension modules: the corrected scan is
   unchanged on every one of them.

Also: `tsconfig.tooling.json` now typechecks `apps/*/test/**`, which nothing had ever covered (three
real errors were hiding there), and `vitest.config.ts` collects `extensions/*/*/test/**` so the
first test written there actually runs instead of passing by never being collected.

### The app did not boot, and no gate could see it (`c33db05`)

Wiring the extensions panel into the shell shipped a build whose every unit test passed and whose
first line in a browser was `Boot failed: Cannot access 'services' before initialization` — the
panel asks the shell for conflicts during its first render, which happens before the composition,
because folders must be read before the inventory is built.

The gap matters more than the mistake: every `apps/web` test drives a module against structural
fakes, and nothing loaded the built page. `apps/web/test/boot.test.ts` now serves the committed
`dist-app` and loads it in a real Chromium — workbench mounted, placeholder gone, settings really
carrying the panel (reached by clicking Settings, the way a user reaches it), no page error, no CSP
refusal. It was verified as a regression test rather than assumed: with the bug reintroduced it
fails; with the fix it passes.

### Archive listings (`bcc8810`)

`NamespaceEntry` gained `storedSize`, `compression`, `modifiedAt` and `checksum` (with its algorithm
named). The ZIP codec had always parsed the method, the compressed size and the CRC-32 out of the
central directory and never published them, so no host could show a column it had no data for. MS-DOS
date/time carries no zone — ZIP defines it as local time on the writing machine, unrecoverable — so
it is read and shown as UTC rather than silently shifted by the reader's offset, keeps the format's
two-second resolution, and a zero date answers `undefined` rather than 1980-01-01.

### Decisions recorded

- **The workbench frame stays host-owned** (`cf84359`). Shipping a default layout in `modkit-ui.css`
  was considered; two hosts already have grids and would be overriding a third, and a wrong override
  is harder to see than an absent rule. Parts and tokens are the styling contract; the arrangement
  is the application's, and a theme may not assume the sidebar is on the left.
- **Agents must not run `pnpm check` as one foreground command.** The harness stops an agent after
  600s without output, so a gate that takes half an hour under load kills the run that is waiting on
  it — four agents died this way before the cause was clear. Run it in phases, or in the background
  with polling.
- **Parallelism has a ceiling on this machine.** With four agents plus a gate, tests that take
  seconds reported 39 minutes and 2.3 hours of wall time and failed on timeouts that meant nothing.
  Two concurrent agents is the working limit; a failure under load is re-run alone before it is
  believed.

---

## S14 / A1 / A2 + host follow-ups — editing across the wire, both apps completed, and three defects that hid well (Fable with Opus agents, 2026-08-19)

**S14 — editing over the subject RPC** (`b4f793f`). The Electron renderer holds a proxied session:
no grant, no backend, no coordinator, so it could show an editor but never save.
`x3.app/subject-services@1` gained an `edit` arm (`x3.app/subject-editing@1`) that crosses as data
and ids only — the grant snapshot, the prepared commit and the file backend stay on the serving
side, and a prepared id is spent on first use, so a consumer cannot replay a write or forge one it
was not granted. A host that cannot write a subject refuses the arm outright, which is what lets a
shell hide a save button rather than offer one that fails at the end.
`createFileEditingBackend({ roots })` now accepts a provider function, because Electron grants roots
as the user picks folders and a static list would be either empty or stale. Two ui hex-editor bugs
came out while wiring it: `prepare` was checked for a state of `prepared`, which no coordinator
produces (`ready` is the state), so every save reported failure after the plan was made; and
`propose`'s result was read as `{ state: 'invalid' }` instead of `{ valid, diagnostics }`, so a
refused change went on to be planned and prepared as if accepted.

**A1 — Electron viewing completeness** (`970b30f`, merged `2b3ac11`; report in
`REPORT_A1_ELECTRON_VIEWERS_2026-08-19.md`). Every first-party `stage` contribution is now
catalogued (video, audio, model, vector, streaming text added), and the view picker offers every
_applicable_ stage rather than the one the presentation plan chose — the plan decides the default,
not the menu. The image editor is deliberately not `editable`: this host cannot re-encode pixels, so
it is read-only with a disabled Save and says why.

**A2 — PWA workbench parity** (`edfdb85`, merged `12c2b93`; report in
`REPORT_A2_PWA_PARITY_2026-08-19.md`). The browser now runs the workbench Electron runs. It also
surfaced a product bug alive since S6: `createWebSubjectServices` registered no service-contract
definitions, so every codec resolving a nested provider while opening — CSV, TSV, INI and their
syntax providers — failed with `x3.host/rpc-bad-argument` and came back `unresolved`. **The PWA
silently had no structured text at all.** It now takes `serviceDefinitions` exactly as the Node twin
does.

### Three defects that hid well, and why

All three shared a shape worth naming: **the product degraded honestly, and the honesty concealed
the fault.** A viewer that mounts and then says "I cannot render this" looks like a limitation of
the format, not a broken transport. Every one of them survived live runs for that reason, and each
was found only when something _invoked_ rather than _displayed_.

1. **No byte-carrying result could cross the Electron subject RPC** (fixed app-side by A1,
   generalised in `d2ec87e`). The endpoint transfers result `ArrayBuffer`s; Electron's
   `MessagePortMain.postMessage` accepts only `MessagePortMain` values in a transfer list and
   rejects the rest. JSON operations worked, byte ones did not. The general fix belongs in
   `framePortFromMessagePort`, the one place that knows which port shape it adapted: it now takes
   `transfer: 'move' | 'copy'`, defaulting to `copy` for `emitter-event` ports. Both modes are
   conformant — the kit records `transfer: detached` / `copied` as an observation, because the
   protocol promises the receiver sees the bytes, not that the sender's buffer is detached.

2. **Typed arrays other than `Uint8Array` could never cross any RPC boundary** (`1214d90`).
   `validateWireValue` refused every other view with `only Uint8Array binary payloads are allowed`.
   `ModelPrimitive.positions` is a `Float32Array` and its `indices` a `Uint32Array`;
   `AudioSamples.channels` is `Float32Array[]`. So no mesh and no decoded audio had ever reached the
   Electron renderer or a browser worker. A1 reported it as "unreliable"; it was impossible. The
   wire value set now admits every typed array that owns its whole buffer. Still refused, and now
   for a stated reason: a `DataView` or bare `ArrayBuffer` (no element type — they would cross as
   bytes whose reading is a matter of convention), a partial view, and a _subclass_ (the far side
   would rebuild it as its base kind while the sender believed otherwise). The JSON codec needed the
   element kind as the tag itself, and multi-byte elements normalised to little-endian so a text
   channel between two machines means one thing. `rt-typed-arrays` joins the conformance kit
   (26 cases) — and the kit's own `deepEqual` had to be fixed first, because it compared typed
   arrays by index keys, under which a `Float32Array` and an `Int32Array` holding the same numbers
   are equal.

3. **`SubjectPreviewSession` omitted `operations()`** (`d2ec87e`) although the ABI surface declared
   it and the wire carried it, so the Electron app forked the whole connect function to add one
   line. It is on the shared session now and the fork is an alias.

### `packages/ui` — the documented composition now actually works

Five requests from A1 and A2, all of the form "the seam exists and does not hold":

- `PreviewStage.module` was typed `ViewerModule` although the field's own documentation said an
  editable stage carries an `EditorModule`, so no host could name an editor stage in TypeScript
  without a cast, and an untyped generated catalog was the only honest way to declare one.
- Viewers were mounted with no operations at all, so an operation toolbar, a transport bar or a
  container stage reading an entry could not be a stage; the session now lends its operation session
  once per opened subject.
- The explorer tree dropped `size` when rebuilding an entry from a node, which moved "is this file
  too large to read?" from before the read to after it.
- `createExplorer`'s file picker and drop called `explorer.open`, which previews into
  `explorer.preview` — the exact element a host with its own editor area replaces. Both paths
  therefore mounted into a detached node, and the drop listener sat on an element no longer in the
  document. Both now route through `onOpen`, and the drop target can be nominated.
- The settings extensions group was unconditionally editable, so a host that serves only what its
  build attested had to refuse the write and explain afterwards. `extensionsReadOnly` states the
  reason once and draws no control that would fail.

Also: fallback stages carry ids, so a file no codec claimed no longer offers a view named
`common.view/text-data-source`.

### Owner decision recorded — the trust model for browser-side user extensions

No signature is required; there is no publisher PKI in this lab and pretending otherwise would be
theatre. The page computes digests itself with WebCrypto from the bytes it just read, and the code
must say plainly what that buys: it does **not** attest provenance, it pins the bytes between the
moment they were read and the moment they are evaluated. A bundled catalog digest is a build-time
claim by a third party; a user-folder digest is not a claim about origin at all. User extensions are
worker-only, always — `allowTrustedInProcess` is unreachable from the UI and refused at the loader.

---

## A4 / A5 / A6 — editing the formats: archives, image and audio metadata, a PNG encoder, text writers (Opus agents, merged by Root 2026-08-19)

Three bounded agent slices on the S8 seam, merged after review; each carries its own proof and its
own refusals. Full `pnpm check` on the merged tree: 95 files / 744 tests, every gate.

**A6 — text writers** (`dea2bf5`). Eight `common.edit/writer@1` offers across the six text
extensions (json, jsonc, ini, csv, tsv, toml, xml, yaml), one writer module per extension, portable
variants only, no permission classes requested — the host commits. `validate` accepts replacement
edits on the change set's own target with a UTF-16/byte range or a whole-source text payload and
refuses everything else with a named diagnostic; `plan` re-validates and throws, so a caller that
skips `propose` still cannot commit a refused change. `yml` is deliberately not an offer: it is a
match alias, not a format any codec owns. Proof: `packages/host/test/text-writers.test.ts` (4) —
resolved by facet, committed through the file backend, the file changed exactly in the range and
reopened; `export-only` requests match a `mutate` offer, a foreign format does not.

**A5 — image and audio metadata, and the first first-party writer** (`f9ebdf5`). Path A: JPEG
`edit.field` (set/replace the COM segment) and `edit.structure` (remove COM/APPn — SOS, DQT, SOF
and friends refused by name), MP3 `edit.field` (ID3v2.3/2.4 text frames; the tag is rebuilt with
every other frame copied verbatim and the audio untouched; unsynchronised tags, extended headers,
footers and duplicate frames refused rather than guessed). Path B: the PNG encoder writer
(RGBA8 → PNG via `CompressionStream`), claiming `semantic` with `preservesUnknownData: false`
because ancillary chunks do not survive — and refusing outright when `CompressionStream` is absent.
Proof: `packages/host/test/media-edits.test.ts` (5), each asserting that every byte outside the
edit is identical. Not done, with reasons recorded: MP4/MOV (an `ilst` resize invalidates
`stco`/`co64` chunk offsets), WebM (`SeekHead`/`Cues` absolute positions), Ogg (page CRCs and
segment tables), WAV (no bundled codec yet — a promotion decision, not a safety one). The MP3
proof runs on a synthetic file: the repository contains no `.mp3`.

**A4 — zip editing** (`c1f2af2`). `edit.structure` (add/remove/rename) and `edit.content` as
whole-source replace plans: untouched entries' local header and compressed data are copied
verbatim — no recompression, method/CRC/sizes/timestamps/extra fields preserved — and only the
local-header offset in each central record is rewritten. Fidelity is `semantic`, never
byte-identical (the file is rebuilt), and `preservesUnknownData` is computed per archive from the
layout actually walked: `true` only for a canonical archive, `false` with a note otherwise.
Refused before any bytes exist: ZIP64, encrypted entries, self-extracting stubs, duplicate paths,
descriptor/central disagreements, and results that would need ZIP64. Proof:
`packages/host/test/archive-edits.test.ts` (6) with an independent ZIP reader and `node:zlib`.

**What their reports changed in Root's code.** The three hard-coded contribution censuses
(`text-data.test.ts`, `app-extension-sets.mjs`, `check-apps.mjs`) now count the new
contributions — agents cannot fix those from inside their scope, and A6 correctly refused to.
Two product bugs their reports surfaced are fixed: audio codecs declared `openIntents` without
`full`, so **every MP3 and Ogg failed to open in Electron and the PWA** (both open with `full`),
and a codec's refusal lost its reason crossing the worker boundary, so a deliberate "this archive
carries a ZIP64 locator" was indistinguishable from a crash. The product inline-payload ceiling
moved from the coordinator's 1 MiB primitive default to 16 MiB in `createSubjectEditing`, because
a whole-source rewrite (archive repack, image encode) exceeds 1 MiB with the first real file;
anything larger is still refused, and staged payloads — which no codec can produce yet — remain
the honest fix.

**Open requests from the agents, not yet done.** `openEntry` returns a `zip-entry:` ref nothing
resolves; archive viewers now use the shared `container.extract` contract (`{ entryId }` to bytes)
instead of recognizing a codec-local operation, while reopening nested sources remains future work.
`defineWriter` takes one offer, so
multi-format extensions hand-roll the module envelope, and the text change-set validator is
duplicated six times (codec-kit); a codec cannot declare an operation `disabled` with a reason
(codec-kit); `vitest.config.ts` does not include `extensions/**`; `apps/web/dist-app/extensions/**`
holds a stale committed copy of the archives extension.

---

## F1 / F3 / S12 — the pieces the applications need: a JSON transport, an evidence policy with a raw writer, and connectable extensions (Root/Fable, 2026-08-19)

Three small slices, each closing something a product could not do honestly.

**F1 — JSON frame codec** (`packages/host/src/execution/frame-json.ts`). Capability-RPC frames are
structured-clone values; a VS Code webview channel, a WebSocket or a pipe carries text. The codec
tags what JSON lacks — `bigint`, `Uint8Array`, and the numbers JSON cannot spell (`-0`, `NaN`,
`±Infinity`) — escapes an object that owns a `$x3` key, and recreates every key as an own property
so a `__proto__` key arrives as the forbidden key it is. What it cannot carry faithfully (a partial
typed-array view, a shared buffer) is refused at `post` rather than laundered into a clean copy.
`framePortFromJsonPort` adapts any text channel. Proof: the conformance kit passes every case over
a JSON text pair with `transfer: copied`, and the one hostile probe that needs a partial view is
reported as skipped, not silently passed (`packages/testkit/test/capability-rpc-conformance.test.ts`);
unit proofs in `packages/host/test/frame-json.test.ts` (4).

**F3 — evidence policy and the raw writer** (`packages/host/src/editing-evidence.ts`). 13D refuses a
plan whose claim has no evidence, so every product was hand-building evidence objects — the way a
host ends up asserting a proof it does not have. `createEvidenceRegistry` makes the policy data: a
record says which writer produced which claim and what proves it, a plan is proven only by a record
with exactly its claim (a `semantic` record never stands in for `byte-identical`), and anything the
host has not decided about stays `fidelity-unproven`. `createRawWriter` is the writer for editors
with no format knowledge (hex, plain text): literal replacements only, no re-encoding, so its claim
is byte-identical and its evidence is structural — `by-construction`, which the record says instead
of naming a corpus that was never run. `allowWholeSource: false` is the guard a bounded editor
needs: an editor holding only a prefix of a large file must not be able to save "the whole file".
`createSubjectEditing` now also returns `editorPorts` — the exact `edit`/`commit`/`payloads`/
`authorization` shape `createCodecPreview` feeds a ui editor module. Proof (4):
`packages/host/test/editing-evidence.test.ts`.

**S12 — connecting extensions** (`packages/host/src/node/extension-roots.ts`, `apps/electron`).
`loadExtensionDirectory` throws, which is right for a build step and wrong for a product reading a
user's extension list: one moved directory would stop the application. `loadExtensionRoots` loads
each root independently and reports what did not load — unreadable directory, a folder that is not
an extension at all (no authored container: the user picked the wrong folder and learns it), a
coordinate another root already claimed (first wins, second reported, so load order never becomes
the authority), an id that does not match the settings entry. Trust is not inferrable:
`allowTrustedInProcess` is refused for anything but `bundled` roots before the gate would refuse it.
Electron main now reads its settings list and connects those extensions as `installed` artifacts,
reports a malformed settings file instead of letting the extensions vanish silently, and exposes
the report as `ElectronSubjectServices.extensions`. Proof: `packages/host/test/extension-roots.test.ts`
(4) plus a live run with an isolated `--user-data-dir` — one scaffolded extension connected
(`[main] user extensions: org.example/demo-format`), one missing directory reported
(`x3.host/extension-root-unreadable`), the application still opened a PNG worker-brokered.

**Not done here.** The PWA's extension connection (a browser has no directory to load from without
File System Access handles, and the attested-catalog model has to grow a second, unattested lane —
a Root slice with its own honesty questions); an Electron-level test of the wiring (the app's test
directory is being changed by a parallel agent; it lands with that merge); wiring `editorPorts`
into the Electron and PWA previews (waiting on the same merges).

---

## S9 — the subject RPC is host-level; the server serves subjects over a port (Root/Fable, 2026-08-19)

**What exists.** `packages/host/src/subject-rpc.ts`: the R6 Electron bridge generalised — one root
`x3.app/subject-services@1` (`open(path)` → inert snapshot, `attach(sessionId)` → the live session
under `x3.abi/asset-session@1`) served by `exposeSubjectRpc` and consumed by `connectSubjectRpc`
over anything `framePortFromMessagePort` adapts; the opener is host policy (`SubjectOpener`);
`presentation` in the snapshot is optional (Electron resolves a plan, other hosts do not).
`apps/electron/src/subject-rpc.ts` is now aliases over it (Electron names and module identity
kept; main/renderer/tests unchanged). `@modkitx-x3/host/node` `createPathSubjectOpener`: a
requested path is resolved, refused outside the configured roots before any stat, opened through
the S7 file adapter and `subjects.open` under the host's grant/budget, and mapped to the snapshot.
`createServerApp` gains `exposeSubjectRpc({ port, session, roots, grant?, budget? })`.

**Proof.** `apps/server/test/subject-rpc.test.ts` (2): over a real Node `MessageChannel` the server
opens a PNG worker-brokered (notice on the wire), the client attaches the session and reads the
byte-range source through the standard surface (`size() → 2727n`, the PNG signature); a path
outside the roots is refused, an unclaimed file reports `unresolved/no-candidate`. The transport is
the one the kit already proves (acc-12: Node `MessageChannel` passes every case); the server adds
no new transport. Electron RPC tests (3) green on the shared module.

**Not done here.** A byte encoding of frames for socket-shaped transports (WebSocket/TCP) — frames
are structured-clone values today (bigint, `Uint8Array`, handle refs); a frame codec + kit run over
a socket pair is its own slice (S9b). Write operations over the RPC (`createSubjectEditing` on the
serving side, an `edit` arm) — after the Electron editor ports move onto the coordinator.

---

## UI-01 follow-ups for Root (REPORT_NEXUS_THEMES §3) (Root/Fable, 2026-08-19)

Three small things the Nexus themes could not reach through the parts vocabulary, done as asked:
(1) the Electron shell now carries the public `workbench` part (`setPart(shell, 'workbench')` in
`apps/electron/src/renderer.ts`) — the same anchor the PWA's `createWorkbench` stamps, so a theme's
decor lands under the panels in both hosts and Opus's `:has()`-guarded body fallback retires by
itself; the page's unlayered `.modkit-shell` rules keep the Electron flex layout, only the layered
part defaults apply; (2) `explorer.filetab` carries `data-mk-kind` (lowercase extension or
`file`, `fileKindOf` in `packages/ui/src/explorer/editors.ts`) so a theme's kind dot can mean
what the design meant; (3) ui-monaco redefines and re-applies its `modkit` theme when
`data-mk-theme`/`data-mk-density` change on the document root (MutationObserver, disconnected on
unmount) — open code panes follow a live theme switch. Proof: Electron selftest run — both files
open, `nexus-forge`/`nexus-dominion` switch with their decor attached, no errors.

---

## S8 — binary editing on the 13D seam: writer surface/definition, file backend, host-gated mutating operations, PNG `edit.field` (Root/Fable, 2026-08-19)

**What exists.** `docs/MK3/adr/ADR-HOST-002-binary-editing-on-the-13d-seam.md` (Accepted, evidence by
line). The finding that shaped it: BRIEF-13D is implemented in the lab (ABI, coordinator, text
proofs, packed editor) — binary `write`/`edit` needed **no new contract family**, only the parts
that were missing for a product path: (1) `common.edit/writer@1` as a standard contract — SDK
surface `WRITER_SURFACE` pinned to `Writer` (`validate`/`plan`, fields `identity`/`offer`),
standard definition + host matcher `org.modkitx/writer-facet-matcher@1` registered by
`createBundledServiceDefinitionRegistry`/`registerServiceDefinitionsOrThrow` under
`org.modkitx/editing`, facet schemas emitted (16 artifacts); (2) the permission rule (SDK
`operationScopedPermissionClasses`): classes only operations need are capabilities — offers carry
activation requirements only, the gate degrades instead of denying (`x3.host/permission-degraded`),
and `openSubject` gates `operations().invoke` against the effective child grant (codec-kit
sessions now mirror the manifest's classes; `readOnly` is honest); R5 re-activates only when the
open grant is actually wider than the probe's; (3) `createFileEditingBackend` in `host/node` —
`file:` sources in roots, S7 revision vocabulary, conditional temp+rename writes (byte/UTF-16/whole
replace, create, delete, rename), per-transaction pre-images for rollback, capability atomic /
recoverable / best-effort; (4) `createSubjectEditing` (revision + targets from the descriptor with
subject-open's fingerprint rule, host-issued grant snapshot, coordinator, `planFromOperation`,
writer session) and `createHostServiceResolver`/`activateServiceProvider` (the product-level
resolver port; subject-open's nested provider activation now shares it); (5) codec-kit
`editPlanFromInput`, `replaceBytes`, `defineWriter`, `declaredPermissionClasses`; (6) the first
mutating first-party operation: PNG `edit.field` sets/replaces a tEXt keyword as a byte-range plan
(both variants request `write-source`).

**Proof.** `packages/host/test/subject-editing.test.ts` (4): Path A — the PNG operation runs
worker-brokered, the plan crosses the boundary, the file backend commits atomically, the tEXt chunk
is present on reopen with every other byte identical, a second call replaces in place; a
read-source-only grant still opens the PNG (degraded) and the host refuses the operation
`permission-missing` while `inspect` works; a changed file → `conflict`, a read-only snapshot →
`permission-missing`, no evidence → `fidelity-unproven`, a foreign plan → subject mismatch;
Path B — the fixture writer resolves by facet, is leased worker-brokered with `identity`/`offer`
as handle data, backs a writer session whose plan commits, and an unsatisfiable facet is refused at
resolution. `file-editing-backend.test.ts` (3), `editing-definitions.test.ts` (4). All previous
suites unchanged; `pnpm check` green.

**Decisions recorded.** MK2 mapping: v1 `write` → writer provider contribution (Path B) next to the
read codec, v1 `edit` → Path A operations; no per-codec editor contribution; encoders still need
ports (OPUS-MK2-04 carries the converter change). Fidelity evidence is host policy (first-party
evidence ships with the proof); multi-edit plans are recoverable, never promised atomic;
single-source subjects only for now.

**Not done here.** Electron's `filesystem.write-file` shortcut still bypasses the coordinator
(migration = a broker-backed `EditingBackend` in main + renderer ports on `createSubjectEditing`);
PWA/VS Code editing; bundle/namespace topologies; a CLI `modkit edit`; staged payload store for
large edits; the converter mapping (Opus, MK2-04).

---

## OPUS-MK2-02 accepted; Root decisions on its owner list (Root/Fable, 2026-08-19)

**Accepted.** `042dc55` — debt as data (`MK2-CONVERSION.json` ×35), rework as the committed tree
(123 codecs / 35 extensions / 351 files, byte-stable), byte signatures for eight containers instead
of the everything-glob, a synthetic corpus (13 fixtures, real checksums, independent zlib/PNG
checks), 15 ports (DoD ≥ 12). The one red line it flagged in my scope (`!` in
`subject-services.test.ts`) is fixed in `f6c01fa`; full `pnpm check` on HEAD is green.

**Decisions (§12 of `REPORT_MK2_CONVERSION_2026-08-19.md`).** No per-codec viewer contribution
(viewers are universal; a port is done when a standard viewer mounts on its data sources);
binary `write`/`edit` is Root's next slice **S8** — an ADR'd contract family over the pieces that
already exist (`write-source`, `filesystem.atomic-replace`, `mutatesSource`, 13D text editing,
the S7 revision-guarded file adapter), not a port; format-definition deferred; the MK2 tree is an
import inventory, never product inventory (promotion is an explicit per-codec step, so
`org.modkitx/jpg` beside bundled `image-jpeg` is not a conflict); `casc` waits for VFS namespace
routing; real corpus samples are the owner's to supply. Next Opus requests are written:
`REQUEST_OPUS_UI_01` (first), `REQUEST_OPUS_MK2_03` (wave 2, parallel with S8).

---

## R-1 — Nexus UI adaptation, Root part: `color.accent-muted-fg`, `themes:check`, vendored fonts, hosts ship themes + fonts (Root/Fable, 2026-08-19)

**Context.** `REPORT_NEXUS_UI_ADAPTATION_2026-08-19.md` (accepted): the NexusForgeUI design
lands as installable themes on the existing token/part channel; nothing of its markup or runtime
is taken. This entry is the Root half; `REQUEST_OPUS_UI_01_2026-08-19.md` is the Opus half (the
two theme stylesheets, picker entries, live proofs).

**What exists.** (1) Registry tier-2 `color.accent-muted-fg` — text on the accent wash (the
design's primary button is wash + light text, not fill + inverse text); values in the three shipped
palettes, `sc2`, and the VS Code adapter (`list-activeSelectionForeground`); contract v1 is now
193 tokens, additive. (2) `scripts/check-themes.mjs` + `pnpm themes:check` (in `pnpm check`,
tests in `scripts/test/check-themes.test.ts`): every `assets/themes/<id>/theme.css` must declare
all public tier-2 `color`/`shadow` roles (73), only its own `[data-mk-theme='<id>']`,
`color-scheme`, `url(` only inside `@font-face` and pointing at an existing `assets/fonts` file,
and its own `prefers-reduced-motion` block when it animates; structure tokens may be inherited on
purpose. `sc2` is complete under it (it lacked only `color.axis-x/y/z` — my report's first reading
"inherits light canvas/graph/diff/chart" was wrong and is corrected there — and now carries its own
reduced-motion guard for the `body`-level decor `base.css` cannot reach). (3) `assets/fonts/`:
Saira (latin, latin-ext) and JetBrains Mono (latin, latin-ext, cyrillic, cyrillic-ext), variable
`wght` 400–700 woff2 subsets from Google Fonts (144 KB total, SHA-256 + source URLs + OFL texts in
`assets/fonts/README.md`, with a ready `@font-face` snippet). Saira has **no Cyrillic** subset —
Cyrillic UI text falls through to the system family behind it; recorded as an owner decision if a
uniform look is wanted. (4) `apps/electron/scripts/build-app.mjs` and `apps/web/scripts/build.mjs`
copy every `assets/themes/<id>/theme.css` as `theme-<id>.css`, copy `assets/fonts` → `fonts/`, and
link every theme (scoped by `[data-mk-theme]`, applies only when stamped) — a new theme directory
ships without touching the builds.

**Proof.** `tokens:check` 193/3 palettes; `themes:check` 1/1; gate tests (5) — complete theme
passes, missing role / foreign selector / no color-scheme, remote or stray `url(`, missing font
file, animating without reduced-motion all fail, real repo green; ui/electron/web suites pass;
both apps rebuilt with `fonts/` and `theme-sc2.css` shipped and linked.

**Not done here.** The Nexus themes themselves (O-1); a Cyrillic companion for the sans stack; the
PWA settings/theme picker; VS Code webview theme option.

---

## O-1 — the Nexus themes: `nexus-forge` and `nexus-dominion` as installable stylesheets (Opus, 2026-08-19)

**Context.** The Opus half of the Nexus UI adaptation (`REQUEST_OPUS_UI_01_2026-08-19.md`), on top
of R-1 above. Report: `REPORT_NEXUS_THEMES_2026-08-19.md`.

**What exists.** Two stylesheets — `assets/themes/nexus-forge/theme.css` (lime on carbon) and
`assets/themes/nexus-dominion/theme.css` (amber on navy) — each declaring all 73 public tier-2
appearance roles plus font stacks, zeroed radii and `--mk-tree-row-height: 24px` (79 declarations
each), self-hosting Saira and JetBrains Mono from `./fonts/`, and decorating only the public
`data-mk-part` vocabulary: mini-caps tracked labels, 7 px window-button and 9 px control bevels, a
12 px tab slant with a kind dot, indent guides over `--mk-tree-indent-level`, 2 px selection and
active-tab edges, recessed fields, a dark status rail. The background decor rides
`[data-mk-part='workbench']::before/::after` — `::before` at `z-index: -1` under the 90 %-opaque
panels (grid drift, Dominion's hex mesh), `::after` above them (scan bar, 3 px scanlines) — with
`isolation: isolate` keeping the negative layer contained; Dominion adds two blooms on the element
itself. Gradients only, `background-position`/`transform` only, all four loops per theme stopped by
each theme's own reduced-motion block. Electron lists both in the settings picker and its selftest
asserts, per theme, that `--mk-color-accent` becomes the theme's accent and that a decor animation
is attached.

**Proof.** `themes:check` 3/3 complete; every other gate green (`tokens`, `schemas`, `manifests`,
`icons`, `facilities`, `apps`, `legacy`, `imports`, `extensions`, `mk2`). Live, through
`playwright-core` against the real applications: the Electron workbench (`_electron.launch`) and the
PWA (`dist-app` on :8732, `?open=./favicon-32.png`) under each theme — accent, Saira, decor
animation names, tab clip, kind dot, guide tint, button bevel, status ground and row height all read
back as declared, console clean. Screenshots committed as
`assets/themes/nexus-*/preview-{electron,web}.jpg`.

**Not done here — three hooks the parts vocabulary is missing** (all outside this slice's scope;
detail in the report §3). (1) The Electron renderer builds its own shell and never stamps
`data-mk-part='workbench'`, so the decor anchor the request names does not exist there; the themes
carry a `body:not(:has([data-mk-part='workbench']))` fallback that retires itself the moment the
part appears. (2) `explorer.filetab` carries no file-kind attribute, so the kind dot states
selection instead of kind — `data-mk-kind` in `explorer/editors.ts` would finish it. (3)
`extensions/common/ui-monaco` reads the token values once, when an editor is created, so a live
theme switch leaves open code editors in the previous palette until the next file opens. Also
recorded: `chrome.css` paints the selected tree row with the `background` shorthand, which resets
the guide geometry a theme's `background-image` then inherits — both themes re-declare
`background-size/repeat/position` and say why.

---

## S7 — the product open path of every Node host: one subject-services builder, `modkit open`, server/automation `subjects` (Root/Fable, 2026-08-19)

**What exists.** `packages/host/src/subject-services.ts` (root entry): `SubjectOpenRequest`
(the request every product issues), `SubjectServices` (`inventory`, `target`,
`executionBackends`, `executionProfiles`, `supportedExtensions`, `serviceDefinitions?`, `open`),
`createSubjectServices` (bind an inventory, a target and a backend registry into `openSubject`),
`supportedExtensionHints` (the extraction Electron and the PWA had each copied),
`createBundledServiceDefinitionRegistry` (every inventoried owner accepted — for inputs the host
vouches for, never for installed/linked promotion), `registerServiceDefinitionsOrThrow`
(`x3.host/service-definition-rejected` — a partially-defined host is refused),
`serviceDefinitionSurfaces` (what backends read as `foreignSurfaces`).
`packages/host/src/node/subject-services.ts`: `createNodeSubjectServices({topology, realms:
{host, workers}, extensions, policy?, onDiagnostic?, serviceDefinitions?: 'bundled'|false|
registry, trustedInProcess?})` — backends with the definitions bound late, both compositions,
fail-closed registration, `createSubjectServices` for the worker realm's target; returns the
services plus `host`/`workers` compositions. `packages/host/src/node/file-artifact-source.ts`:
`openFileArtifactSource(path)` — the one production file adapter (revision
`provider-token:<dev>-<ino>-<size>-<mtimeNs>`, every bounded read re-checks it:
`x3.host/source-revision-changed`; `source-not-a-file`, `invalid-source-range`,
`source-size-unrepresentable`). Products: `modkit open <file> --ext <dir> [--ext …]
[--intent inspect|full] [--trust] [--json]` — roots are _linked_ artifacts (`--trust` is the
explicit in-process decision for all of them), the CLI's worker realm is the target, output names
the selection, boundary, format, traits, operations, data sources, candidates and diagnostics;
exit 0 opened / 1 unresolved or inventory errors / 2 usage or IO. `createServerApp` and
`createAutomationHost` compose through `createNodeSubjectServices` and expose `subjects`
(`executionBackends` option dropped — nothing used it). `createElectronSubjectServices` and
`createWebSubjectServices` are thin over the shared pieces (`ElectronSubjectServices` /
`WebSubjectServices` now `extends SubjectServices`); Electron `main.cjs` opens files through
`openFileArtifactSource` (its private `fileByteSource` copy is gone).

**One thing the wiring surfaced and fixed.** The published entries of `@modkitx-x3/host` are
bundled separately (six entries), so an inventory built inside `host/node` (by
`createNodeSubjectServices`) carried private records in _that_ copy's module-local WeakMap and
was "record-less" for the root entry: `apps:check`'s `offersFromInventory` saw 0 offers for the
automation host. The private record now travels on the contribution object itself under
`Symbol.for('x3.host/inventory-record')` — non-enumerable, non-writable, frozen, cross-checked
against `contribution.record` — exactly the S1b decision for the execution-backend registry:
any copy of the host honours it, a structural copy (spread/JSON/`Object.assign`) still carries
no record. The other brand tables (`offerBindings`, `resolverProducts`, `ticketBindings`) are
intra-pipeline (one `openSubject` runs inside one copy) and were left as WeakMaps; the same move
applies if a cross-entry flow ever needs them.

**Proof.** `packages/host/test/subject-services.test.ts` (7): hints lowercase/unique/sorted;
`createNodeSubjectServices` opens a real PNG worker-brokered (both compositions exposed,
`trusted-node` rejected for a linked root, `byte-range-source.size() → 2727n`), the root
entry's `offersFromInventory` recognises the node-built inventory while a spread copy of a
contribution has no record; `serviceDefinitions: false` / a given registry; `createSubjectServices`

- definitions helpers; `openFileArtifactSource` bounded reads, refused ranges, revision change
  refused, directories refused. `apps/modkit-cli/test/cli.test.ts` (+2): `modkit open` JSON
  opened/portable/worker-brokered/trusted rejected, human line names the boundary, exit 1/2/2/2.
  `apps/server` and `apps/automation-host` (+1 each): `subjects.open` opens the PNG worker-brokered
  with `installed`, untrusted inputs. Live: `modkit open favicon-32.png --ext extensions/common/images`
  opens in 1.4 s and the process exits; the real Electron app (`--open <dir> --selftest`) logs
  `[main] subject favicon-32.png -> org.modkitx/image-png/portable (100%)` through the shared adapter
  and mounts the Image view. Full gate set green (83 files / 694 tests, `apps:check` 16 cases,
  legacy 687, imports 204, extensions 53, schemas, catalogs, lint, format); one transient
  `ajv/dist/runtime/ucs2length.js` load failure across suites reproduced only while node_modules was
  being churned by the concurrent Opus tree and vanished on rerun.

**Not done here.** An HTTP/RPC surface for the server over `subjects.open` (sessions as handles
of `x3.app/subject-services@1`, as Electron does); a `--bundled` extension set for the CLI outside
the repository (today: explicit `--ext` roots only, no discovery); moving the remaining brand
tables onto their objects (not needed by any flow yet).

---

## S6 — the PWA product path: attested catalog, served artifacts, vendor worker bundles, open flow (Root/Fable, 2026-08-19)

**What exists.** `scripts/emit-web-catalog.mjs` → `apps/web/generated/extension-catalog.{js,d.ts}`:
for every bundled codec extension whose runtime dependencies the worker vendors cover (today
`@modkitx-x3/codec-kit` only — 9 extensions: archives, audio, documents, images, models,
text-delimited, text-ini, vector, video; text-json/toml/xml/yaml are listed `excluded` with the
missing vendor named), the _same_ `loadExtensionDirectory` the Node hosts use serializes files,
pre-read contribution documents + digests, the artifact digest and per-file digests, with the
artifact root as `extensions/<name>/` under the app origin. Wired as `catalogs:check:web` after
`typecheck` in `build` (it imports the built host). `apps/web/scripts/build.mjs`: one esbuild
graph with code splitting for the worker runtime — the host's `worker-entry.js` plus
`vendor/{codec-kit,codec-kit/text,core,sdk}` — so `core`/`sdk` are one instance across the
entry and the vendors; the catalogued artifact files are copied byte for byte under
`dist-app/extensions/<name>/`. `apps/web/src/subjects.ts`: `catalogToExtensionInputs` (the
gate's `verifyArtifactDigest` compares against the build attestation; byte verification happens
in the loader at load — verify-then-snapshot; `allowTrustedInProcess: false` everywhere),
`WEB_WORKER_MODULE_MAP` (bare specifiers → vendor URLs, unverified by design), and
`createWebSubjectServices` — the browser twin of Electron's subject services: composes both
realms with `createBrowserExecutionBackends` and opens subjects for the **worker realm's
target** through `openSubject`. `apps/web/src/shell.ts`: hands the page's real DOM globals to
the services and wires one honest open flow (pick a file → open → selected codec + boundary +
descriptor + the first data source's answer + diagnostics).

**Proof.** `apps/web/test/subject-services.test.ts` (3): the generated catalog equals a fresh
loader pass (same digests) and every input is `allowTrustedInProcess: false`; a real PNG opens
through the browser topology — portable variant, worker-brokered, gate notice + backend
`worker-shared-origin`, one module worker per activation spawned from the served entry, artifact
files fetched once each, tree data source answers over the RPC; a served artifact whose bytes
drifted from the attestation is refused at load (`artifact-digest-mismatch`), the trusted variant
is refused as `codec-execution-unavailable`, no worker ever evaluated the drifted bytes. Full
gate set green for this scope; the concurrent OPUS-MK2-02 working tree carries its own in-progress
lint/test state in `scripts/convert-mk2*`, untouched by this commit.

**Live in Chromium (2026-08-19, follow-up).** The shell gained `?open=<same-origin path>`: on
boot the page fetches the resource from its own origin only and opens it exactly like a picked
file — a launch path for the PWA and the manual smoke path. Served by `build.mjs --serve` and
loaded in a real Chromium page (`/?open=./favicon-32.png`): `main.js` composed 9 attested
extensions, the served `worker-entry.js` was spawned as a module worker, the loader fetched
`extensions/images/src/formats/png/codec.js` once and verified it with WebCrypto,
`openSubject` selected `org.modkitx/image-png/portable` worker-brokered, the descriptor came back
over the capability-RPC and `common.view/byte-range-source@1.size()` answered `2727n`; the page
showed both boundary statements (`worker-shared-process`, `worker-shared-origin`). Service-worker
registration failed only inside the embedded preview pane (the page fetches the script itself
with 200/`text/javascript`); the shell already treats the SW as non-blocking.

**Not done here.** A real-browser run of the _conformance kit_ (the shell path is proven live,
the kit pair is proven in Node with fakes; a Playwright harness is not in the repo); stage
viewers/explorer parity with Electron in the PWA (the shell shows the raw descriptor and one
data-source answer); vendoring text-json/toml/xml/yaml parsers for the worker; VS Code webview
on the same core.

---

## S5b — the DOM wiring of the browser worker backend (Root/Fable, 2026-08-19)

**What exists.** `packages/host/src/browser/worker-realm.ts`: `browserLoaderHooks` (fetch →
WebCrypto SHA-256 → `blob:` module URLs with `revokeAll`; bare specifiers only through the app's
`moduleMap`), `createDomWorkerRealmFactory` (a module `Worker` per activation, dedicated
`MessageChannel`, one `x3.host/worker-init` message with the transferred port,
`x3.host/worker-crashed` on the worker's error event) and `createBrowserExecutionBackends` (the
worker backend only — nothing evaluates on a page's main thread). `browser/worker-entry.ts`,
published as `@modkitx-x3/host/browser/worker-entry`: one-shot init listener over the shared
bootstrap core, `self.close()` on terminate/failure, auto-installed only inside a real worker
scope (`WorkerGlobalScope` present). All DOM shapes are structural (the host package still
compiles without `lib.dom`), so a page passes its globals and a test passes fakes.

**Proof.** `browser-worker-realm.test.ts` (3): hooks over an in-memory origin + Node's WebCrypto +
a data-URL blob store (real import of a minted URL, revoke frees); `createBrowserExecutionBackends`
with a fake `Worker` whose "script" is the production entry over a real `MessageChannel` —
one worker per activation, init message with the transferred port, the fixture codec probes end
to end, the artifact fetched exactly once; the entry ignores garbage and near-miss inits and
consumes exactly one real init. `bundle.test.ts` pins the new published entry.

**Not done here (S6, the web product path).** A browser catalog with per-file digests emitted at
build (`scripts/emit-app-catalogs.mjs`), extension artifacts served under the app origin, a
module map for `@modkitx-x3/sdk`/`codec-kit` browser builds, `createWebApp` composing
`createBrowserExecutionBackends` and an `openSubject` flow in the workbench, and a real-browser
conformance-kit run. Only after S6 is the PWA extensible by codecs end to end; today the host side
of that path is complete and proven with fakes.

---

## OPUS-MK2-01 accepted + Root decisions on its open items (Root/Fable, 2026-08-19)

**Accepted as landed by Opus (`0a638d2`, commit authorized by the owner):** `scripts/convert-mk2.mjs`
over the shared MK2 parser `scripts/lib/mk2-manifests.mjs` (the allocation report renders byte for
byte as before), 102/103 mechanical codecs → 34 inventory-eligible extensions under
`extensions/mk2/**` (workspace members), `check:mk2` in the `pnpm check` chain (skips cleanly
without an MK2 checkout), the acceptance harness over real corpus files (read-only, never copied)
with six hand-ported codecs opening both `trusted-in-process` and `worker-brokered`, and one real
codec-kit defect fixed: `probeLength` now clamps the declared window to the source size (the
window is a ceiling; two corpus samples smaller than 4096 bytes are the regression). Reviewed:
the clamp is correct and minimal; `modkitx` untouched.

**Root decisions (REPORT_MK2_CONVERSION §9, executed by OPUS-MK2-02):** (4) the `--rework` tree is
committed only with an inert per-extension `MK2-CONVERSION.json` naming every lost v1 plane
(viewer entrypoints, renames, converter defaults, dropped operations) — debt as data, no invented
viewer contributions; (5) `pathGlobs: ["**/*"]` stays a non-wildcard: detect-by-content is
`match.signatures` (S3), the converter maps v1 magic to signatures and drops the lone `**/*`,
the eight media containers get well-known signatures at port; `matchesGlob` unchanged; (6)
`earth-res` is a FormatDefinition, not a codec — skipped `format-definition-pending` until
document 30's contract exists; (7) synthetic spec-derived minimal fixtures are allowed as a second
acceptance axis (`corpus: real | synthetic`), real-corpus growth stays with the owner; (8) variant
pair and permission union are converter _defaults_ recorded in the notes and narrowed at manual
port. Request: `REQUEST_OPUS_MK2_02_2026-08-19.md`.

---

## S5 — browser worker backend: verify-then-snapshot loading, the same RPC core and consumer adapters (Root/Fable, 2026-08-18)

**What exists.** `packages/host/src/browser/verified-loader.ts` — the browser has no
`node:module` hooks, so verification happens **before** URLs exist instead of at evaluation:
every artifact file is fetched once, checked against the inventory per-file digests, its static
import specifiers rewritten (children first), and the verified source minted as an immutable
module URL (`blob:` in the browser, `data:` in tests) — what evaluation imports _is_ the verified
snapshot, so there is no TOCTOU window at all. Rules mirror the Node ladder: tampered file →
`artifact-digest-mismatch`; unlisted file or root escape → `execution-load-rejected` (the escape
is refused before any fetch); no digest map → entrypoint-only + `artifact-not-pinned`; bare
specifiers only through the app's module map, reported `unverified` (SB-1 like `node_modules`;
digests are SB-4); non-literal dynamic `import()` refused; import cycles refused; ceilings
(files/bytes) refused. The specifier scanner is conservative by contract: a mis-parse can only
produce a fetch refusal or a base-less module-resolution error — never unverified execution.

`browser/worker-bootstrap-core.ts` (runtime-agnostic executor half: one load, exactly the spawned
snapshot URL, module wrapped by the shared re-assembly) and `browser/worker-backend.ts`
(`createBrowserWorkerBackend`: `worker-brokered` × `browser-worker`, injected realm factory —
the web app will supply the DOM `Worker`, tests inject the production bootstrap core over a real
`MessageChannel` — deadline/grace watchdog, `x3.host/worker-shared-origin` per activation; no V8
resource-limit API in browsers, said so instead of pretended).

**Shared, not copied.** Extracted from the Node side so both backends run identical code:
`execution/module-reassembly.ts` (context/asset-input/codec/service-module wrapping — the Node
bootstrap now imports it) and `execution/consumer-adapters.ts` (module → codec → session adapters
with the invoke placements, parameterized by `ConsumerRealm`/`ConsumerWatch`; the Node backend's
restart indirection plugs in unchanged).

**Proof.** `browser-verified-loader.test.ts` (6 tests, real `data:`-URL evaluation: multi-file
graph works, tamper/unlisted/escape/cycle/dynamic/ceiling refusals, bare map + refusal,
entrypoint-only mode); `browser-worker-backend.test.ts` (3: the fixture codec activates from
fetched+verified bytes and probes through a host-executed source with the diagnostic naming the
snapshot; tamper refuses before the realm is ever spawned; a released lease answers structurally).
Node backend suite unchanged and green after the extraction.

**Not done here.** The real `new Worker` wiring + module map in the web app (its composition root
must serve artifact files and dependency bundles over its origin — next slice, with the browser
conformance-kit pair run in a real browser harness); events/watchdog parity with the Node
supervisor for worker death (`Worker.onerror`) lands with that wiring; `process-brokered` stays
behind its SB-2/3 gate.

---

## S4 (R6) — Electron subject IPC is capability-RPC; the last method allowlists are deleted (Root/Fable, 2026-08-18)

**What exists.** `apps/electron/src/subject-rpc.ts`: main exposes one root capability per window —
`x3.app/subject-services@1` (`open(path)` → inert snapshot; `attach(sessionId)` → the live session
under `x3.abi/asset-session@1`) — over an Electron `MessageChannelMain` pair, worker-role endpoint
behind the production `framePortFromMessagePort` (`emitter-event` for `MessagePortMain`); the
renderer connects a host-role endpoint (`event-target` over the DOM port the preload forwards via
`window.postMessage` transfer) and consumes materialized proxies. Below the root everything comes
from the surface authority: `dataSource(contract, major)` resolves the leased surface from the
standard registry, iterables are real pull streams (the old 1000-item materialization is gone),
`encoded()` is the auxiliary `common.view/encoded-media@1` capability (the old
`REMOTE_VALUE_METHODS` hand-rolled handle table is gone), dispose cascades through the lease.

**Deleted.** `DATA_SOURCE_METHODS`, `ITERABLE_SOURCE_METHODS`, `REMOTE_VALUE_METHODS`,
`invokeSubjectMethod`, the `subjectSessions` map and the `modkit.subject` channel in `main.cjs`;
`assertElectronSubjectRequest` + `ElectronSubjectRequest` + `boundedCloneValue` in the composition
root (frame validation lives in the protocol core on both sides); the preload's method-forwarding
`modkitSubjects` bridge (now it mints the port: `requestPort()` + a `modkit.subject.port`
forwarder). Adding a data-source contract to the standard table (or a definition surface) now
crosses the Electron boundary with zero Electron changes — invariant 2 of the plan holds in code.

**Proof.** `apps/electron/test/subject-rpc.test.ts` — the production pair without the binary
(same adapters, surfaces, endpoints; `MessagePortMain` shape emulated over a Node port): text-json
opens end to end (worker-brokered codec in main's worker realm, the shared-process notice crosses
the wire), tree pages + label search pulled through surfaces, a method the surface does not
declare simply does not exist, dispose cascades and a second use answers structurally; unresolved
snapshots cross inert; a never-attached session is disposed when the exposure closes; a forged
session id fails the endpoint closed before any dispatch. The conformance kit gained the
`electron:MessagePortMain-shape` run — all 25 cases over the exact main-side event shape.
`security.test.ts` drops the deleted validator and keeps the two-hop renderer ↔ main ↔ worker
topology pins.

**Not done here.** Renderer UX for lifecycle states (OPUS-UX-01); moving the _broker_ channels
(filesystem/dialog) onto capability-RPC — they are effects on main-owned facilities, not contract
objects, and keep their allowlist by design; a real Electron binary smoke run (the pair is
adapter-faithful; the binary path is exercised manually).

---

## S3 — NXT-101B signature index + R5 probe grant seam + detection-hostile acceptance (Root/Fable, 2026-08-18)

**R4 — bounded, data-only signature index.** `contract-definition` codec specs may declare
`match.signatures` (schema-bounded: `from: start|end`, offset ≤ 4096, pattern 1–64 bytes hex,
optional same-length AND-mask, ≤ 8 rules; `packages/sdk/src/schemas/contribution-specs.ts` +
manual type + drift gate). The host (`packages/host/src/detection-index.ts`) computes the
inventory's declared needs and reads **one head window and one tail window per opened subject**
(nothing when nothing is declared; each ≤ 4160 bytes; a size-less source reads nothing);
`runnableCandidates` admits a candidate when its name/media/path rules OR one of its signatures
match — the admission is explained by an information diagnostic `x3.host/signature-match` on the
candidate. No extension code runs for the shortlist; the codec's bounded probe stays the detection
authority. Bundled declarations: PNG (`89504e470d0a1a0a` at 0), ZIP (local header at 0 **and** the
comment-free EOCD 22 bytes before EOF). A renamed `.dat` PNG now reaches the PNG probe and opens.

**R5 — the probe grant seam.** `security/gate.ts` exports `PROBE_OPERATION` /
`PROBE_PERMISSION_CLASSES` (`['read-source']`): an activation whose ticket carries the probe
operation clamps the variant's requested classes to the probe set, applies the same set as an
operation ceiling (a caller policy can narrow it, never widen), and suffixes the child grant id
`#probe`. `subject-open` resolves detection candidates with the probe operation and, when the
winning variant requests anything beyond the probe set, **re-activates it under the caller grant
before open** (fresh ticket, second activation; nested service leases follow the candidate's
current scope; the probe realm is released only after the open activation stands). Variants that
request only probe classes (every bundled codec today) keep the single activation — zero change.
The resolver's earlier permission stage still refuses an offer whose full request the grant can
never cover: the host does not spend a probe on a codec the caller could never open.

**F6 — detection-hostile acceptance.** `subject-open.test.ts`: renamed PNG opens via signature
with reads pinned (8-byte window, 32-byte probe, then the codec's own read); a PNG+ZIP polyglot is
shortlisted by both detectors (head + EOCD windows pinned), the PNG probe wins detection and the
PNG codec's own `open()` refuses the trailing bytes — probed by both, opened by neither; a magic
collision (PNG signature, corrupt body) is probed and rejected; a no-match subject pays at most
the window read + the pre-existing text/hex fallback sniff. Two-phase fixture
`subject-open-grants-extension` (requests read+write): 2 activations / 2 `createCodec` on open
with a full grant; resolution-level refusal with a read-only grant (0 activations).
`gate.test.ts` (+3): probe ticket → `['read-source']` child `#probe`; open ticket → full set;
probing possible under a grant that could never open; caller probe ceiling cannot widen.

**Not done here.** Suffix-anchored signatures with floating offsets (ZIP EOCD with a comment);
per-format signature registries outside contributions (the contribution stays the only authority);
worker-brokered probe pooling (NXT-101 disposable probes stand).

---

## S2 — protocol 1.1 completed: has[] feature detection, opt-in nextBatch, operations().invoke placements, derived asset inputs (Root/Fable, 2026-08-18)

**What exists (additive, wire `version` stays 1 — a 1.0 peer interoperates).**

- **`has[]` (optional-method presence).** A handle ref may carry `has`: the surface's _optional_
  methods the object actually implements, listed by the side that creates the handle
  (`presentOptional` in `endpoint.ts`, on `expose` and on every leased result). The consumer's
  `materialize` then defines exactly the required methods plus the ones `has` names, so
  `typeof source.readRegion === 'function'` answers truthfully across the boundary — real feature
  detection instead of the pre-1.1 fallback where every optional method was defined and an absent
  implementation answered `x3.host/rpc-method-unavailable`. Refs of surfaces with no optional
  method stay byte-identical to 1.0 (`has` absent). `RemoteCapability.has` exposes it; validated
  by `isPresentList` (method-name grammar, `MAX_OPTIONAL_METHODS = 64`, unique).
- **`nextBatch` (opt-in).** `ProtocolLimits.iteratorBatchItems` (default **1** — item per round
  trip, byte-identical to 1.0). A consumer that raises it sends `next { max }`; the executor pulls
  up to `max` items and replies with one array value (`done` when already exhausted), the consumer
  drains the buffer locally and marks the iterator exhausted so the next `next` answers `done`
  without touching the generator. Bounded by `maxArrayLength`.
- **`operations().invoke` placements in the session adapter.** The Node worker backend's
  `sessionAdapter` now leases the `OperationSession` once and returns its _materialized_ proxy, so
  `invoke(handlerId, value, { signal, onProgress })` carries the ABI placements
  (`signal: {arg:2}`, `progress: {arg:2,key:'onProgress'}`): the options object stays a plain wire
  value, the executor re-creates the signal and progress callback; `dispose` releases the lease.
- **Derived asset inputs.** `x3.abi/asset-input@1` gained `subjects`/`recipe`/`materialized`
  fields and optional `openSubject`/`openMaterialized` methods; the worker bootstrap derives
  `subjectsFor` locally from the copied `subjects` (as it already did `bindingsFor`). A codec in a
  worker reads a derived input's subject list, opens one input subject as a host-executed session
  and the optional materialized artifact — all brokered.

**Proof.** `execution-endpoint.test.ts` (+2: `has` feature detection both ways; `nextBatch` one
round trip + order + default-still-one-per-next); `execution-surface-adapter.test.ts` (readPcm is
now absent, not a rejecting stub); `node-worker-backend.test.ts` (+1 derived input; the session
test now drives `invoke` with a signal and an `onProgress` and asserts both crossed). Full
`pnpm check` green.

**Not done here.** Per-contract `limits` as enforced policy (still data, no owner policy yet); a
`nextBatch`-aware standard-surface convention (which data sources opt into batching, and their
default batch size — an ABI convention question for the owner); browser worker backend.

---

## S1b — the worker backend is wired into every Node composition root; portable codecs run brokered in the products (Root/Fable, 2026-08-18)

**What exists.** Every Node root now models a `node-worker` realm next to its host realm and
composes one execution-backend registry for both (`createNodeExecutionBackends` in
`@modkitx-x3/host/node`: the trusted in-process backend, still gated per artifact by
`allowTrustedInProcess`, plus `createNodeWorkerBackend` under a root-owned
`workerBackendPolicy`): Electron (`ELECTRON_WORKER_REALM`, `ELECTRON_WORKER_POLICY`; `ElectronApp`
gains `workers` and `executionBackends`; `createElectronSubjectServices` opens subjects for the
**worker realm's target** and forwards backend diagnostics through `onDiagnostic`; `main.cjs`
logs them as `[worker]` and reports `execution: {codecRealm, environment, profiles}` in the
`modkit.profile` snapshot for the renderer), the CLI (`MODKIT_CLI_WORKER_REALM`,
`createModkitCliExecutionBackends`), the server and the automation host (their `workers`
composition and `executionBackends`). Helpers: `nodeWorkerRuntimeTargetBase`,
`nodeWorkerRealmProfile` (no facilities of its own — a worker gets what the host brokers),
`nodeWorkerLinks`. Rule R‑A2/W4 is now the product path: the target selects the variant —
Electron resolves for `node-worker`, so every bundled codec's `portable` variant is chosen and
activated `worker-brokered`; `trusted-node` variants stay available to the host realm.

**Two things the wiring surfaced and fixed.** (1) The published entries `@modkitx-x3/host` and
`@modkitx-x3/host/node` are bundled separately, so a registry created by the node entry was
"not created by this host" for the gate inside the root entry (module-local WeakMap). The private
bindings now travel on the registry object under `Symbol.for('x3.host/execution-backend-registry-bindings')`
(non-enumerable, frozen): any copy of the host honours it, a hand-built look-alike still does not.
(2) A codec in a worker resolves its provider through the host, and in the product the provider is
itself a portable variant — so `ServiceProviderModule` needed a boundary too:
`x3.abi/service-provider-module@1` (`createProvider(selection, context)` leases the provider by
the contract the selection names, `resultFromArgs`), the bootstrap exposes such modules with that
root surface, the backend's module adapter offers `createProvider` returning an ABI `Lease` whose
value is the materialized proxy, and the host bridges worker A (codec) → host → worker B (provider)
for `parse`/`dataSource`/tree pages. Definitions are late-bound: `foreignSurfaces` may be a thunk
read at every spawn, so an app registers its backends before its definitions are inventoried.

**Proof.** `node-worker-backend.test.ts` (16 → 17: provider in worker B, codec in worker A, host
bridging both, two shared-process notices, no crash/restart); `apps/electron/test/subject-services`
opens JSON in the worker realm (`portable`, `x3.host/worker-shared-process` in the open result
and twice in the backend sink, no `full-process-authority`); security/server/automation tests pin
the realm pairs, the empty worker facilities and the two-hop renderer ↔ main ↔ worker shape.

**Not done here.** Renderer UX for the vocabulary (OPUS‑UX‑01 remains Opus's); a product-level
retry on `rpc-peer-exited` (the backend restarts, `subject-open` does not re-open by itself);
co-locating a provider in the codec's worker (today: one worker per activation, host in the middle);
the browser worker backend.

---

## S1a — one spawn path, one MessagePort adapter, restart generation (acc-8), kit over the backend transport (acc-12) (Root/Fable, 2026-08-18)

**What exists.** `packages/host/src/execution/message-port.ts` — `framePortFromMessagePort` moved
from the testkit into the published `@modkitx-x3/host/execution` subpath: the one production
`MessagePort` → `FramePort` adapter (Node `worker_threads`, DOM, Electron `MessagePortMain`
listener styles); the testkit re-exports it, and its conformance test asserts identity with the
production import. `packages/host/src/node/worker-realm.ts` — `spawnWorkerRealm`, the production
spawn path (isolation options of the threat model §2, `resourceLimits` from the caller's policy,
capped stdio into sinks, dedicated transferred `MessagePort` behind the shared adapter, exit
tracking, idempotent `terminate()`, `outputTruncated`); exported from `@modkitx-x3/host/node`. The
Node worker backend spawns every generation through it; the testkit harness
(`spawnFixtureWorker`, hence `superviseFixtureWorker` and `demoWorkerPair`) spawns through it too
— what the hostile-worker acceptance and the kit exercise is now the backend's own transport, not
a look-alike. New fixture `env-report.mjs` reports from inside the thread and the acceptance
asserts `env: {}`, `argv` = [execPath, script], `execArgv: []`, the policy resource limits (T6, §6
checklist — proven, not read from the source). `WorkerBackendPolicy.maxRestartsPerLease` (default 3,
ceiling 1000, 0 disables).

**Restart (acc-8).** `worker-backend.ts` keeps, per module lease, one session id and a generation
counter. When the live generation died or was terminated, the next `createCodec` on the same lease
brings up generation + 1 of the same session: the previous worker is awaited to exit (its port is
closed in the `'exit'` handler before the new `Worker` exists), the same `load` request is sent
(same `entrypointDigest` → a file changed between generations is `x3.host/artifact-digest-mismatch`),
`x3.host/worker-restarted` is reported once per restart, concurrent callers share one restart (a
serialized chain), and `x3.host/worker-restart-limit` (`retryability: 'never'`) refuses the lease
beyond the policy. Codecs are bound to the generation that created them: their calls never migrate
(`rpc-peer-exited` for the in-flight one, `rpc-endpoint-closed` afterwards) and no handle travels
across generations. `x3.host/worker-shared-process` is per activation, reported before the first
evaluation (module evaluation already runs extension code). Session recovery is deliberately not
promised — a consumer re-opens. Tests: `node-worker-backend.test.ts` (13 → 16; fixture `crashy.mjs`
kills the worker on a `/crash` probe), `hostile-worker.test.ts` (18 → 19), conformance (9 → 11:
adapter identity + the kit over a `spawnWorkerRealm` pair, host-observable subset, transfer detached).

**Not done here.** Wiring into composition roots (S1b); restart policy at the product level (no
automatic re-`open` in `subject-open`); the harness keeps its own reference supervisor — sharing
the spawn path does not share the supervision, which is what the acceptance still proves.

---

## MK3 docs moved into the lab + execution-boundary decisions recorded (Root/Fable, 2026-08-18)

**What changed.** `modkitx/docs/MK3` (39 files: 00–31, `adr/`, `uk-a/`) is copied to
`docs/MK3` in this repository; from now on the lab copy is the working place and the owner copy is
a frozen snapshot dated 2026-08-14 (nothing was deleted or edited in `modkitx`; the owner repository
stays read-only for the lab). The copy is prettier-normalized (`format:check .` covers it: LF line
endings, aligned tables, embedded code samples formatted) — `diff -w` against the snapshot shows
only the intentional edits below. Links of the form `../architecture/*` and `../tasks-active/*`
still point at the `modkitx` repository (17 targets; stated in the README banner). New:
`docs/MK3/32-execution-boundary-and-method-surfaces.md` (capability-RPC, method surfaces, ABI
surfaces, Node worker backend, acceptance, open questions, evidence) and
`docs/MK3/adr/ADR-HOST-001-capability-rpc-and-method-surfaces.md` (Accepted). Dated «Принято
2026‑08‑18» additions: 02 §11.1 (method surface), 23 §5.1 + §16 invariant, 24 §5 profile names per
the Q77 enum + §6.1.1 rung status + §8 activation chain + §17 status, 27 §0.8/§6/§7, 10 §22,
11 (Q86–Q91 resolved), 09 §14 (next stages), 22 §8, 29 §13; README move banner and `Updated`;
`adr/README.md` index row. The `DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS` allowlist in
`apps/electron/electron/main.cjs` is described honestly as still present until R6 — it lost its
authority status, not its bytes.

**Not done here.** No owner-doc write-back; the `../architecture` and `../tasks-active` trees were
not copied (they are not MK3 and the owner keeps them); the roadmap after this slice is in
`docs/MK3/09-development-roadmap.md` §14 and `PLAN_FABLE_NEXT_2026-08-18.md`.

---

## F1/F4b follow-ups — in-process hostile kit cases, big transfers, acc-8/acc-9/acc-10 (Agent, 2026-08-18)

**What exists.** Four new in-process hostile cases in the conformance kit
(`packages/testkit/src/capability-rpc/conformance.ts`, `CASES` 21 → **25**), each mirroring a
worker fixture on the raw-injection path and each flagged `hostile: true, needsLocalWorker: true`
so host-only pairs report them as `skipped`: `hs-proto-pollution-reply` (an _own_ `__proto__` key
inside a forged `return`, produced with `JSON.parse` — `forbidden-key`, `Object.prototype`
untouched, parked call rejected `x3.host/rpc-protocol-violation`), `hs-bad-values-reply` (five
probes on fresh pairs: `NaN` → `bad-value`, a partial `Uint8Array` view → `partial-typed-array`,
`SharedArrayBuffer`-backed bytes → `shared-buffer`, 40-deep nesting → `depth-exceeded`, an extra
frame key → `unknown-key`), `hs-event-unknown-subscription` (a stray `event` is counted in
`droppedEvents`, endpoint stays open, no failure) and `hs-progress-after-settle` (progress after a
call settled is noise; progress for a call that never existed is `unknown-reply-target`). Two
helpers carry them: `lastHostCallId(ctx, method)` and `parkPendingHang(ctx)`. Acceptance
(`packages/testkit/test/hostile-worker.test.ts`, 14 → **18** tests): an 8 MiB `echo` both ways over
`worker_threads` (bytes intact, sender detached, 200 concurrent `checked(i)` in order, exit 0);
`release()` idempotence (acc-9 — three concurrent calls and a later one resolve with the _same_
`end` object, zero terminations for `demo-worker`, exactly one for `ignore-terminate`); a new
`noisy` fixture (1 MiB to `stdout` _and_ `stderr` in 64 KiB chunks) proving the harness caps
captured output at `outputCapBytes` and flags `truncated` (acc-10); a `previous-generation`
variant of `wrong-session` plus a restart test (acc-8 — session `restart-1` at generation 1 →
`release` → generation 2 serves the same session, the pre-restart remote is
`x3.host/rpc-endpoint-closed`, no handles travel across the restart). `packages/testkit/README.md`
is new: how a transport plugs into the kit, how to read the report, how to run the fixtures.

**What is proven.** The endpoint fails closed on every forged reply shape at the _frame_ boundary
(the value never reaches user code — no prototype pollution, no partial views, no shared memory),
and it distinguishes the three noise classes it must tolerate (stray events, late progress, late
replies after cancel) from the violations it must die on. Transfers up to `maxTransferBytes` cross
a real thread boundary zero-copy and in order. The reference supervisor's `release()` is a real
idempotent latch, not a lucky race, and the harness — not the worker — bounds captured output.

**Not in scope / not done.** `packages/host/**` was not touched: every case here matches the
endpoint's existing behaviour, no core defect was found. The kit's docstring gained the case count
(it never carried one before); the older F1/F4b entries below still quote "21 cases" as the record
of what those tasks delivered. `pnpm build`, `prettier --check`, `pnpm test` (73 files / 591 tests)
and the three `check:*` gates are green; `eslint .` reports 3 errors, all in the in-flight NXT-103
`packages/sdk/src/asset-capabilities/data-source-surfaces.ts` (`consistent-type-definitions`,
`consistent-indexed-object-style`) — outside this scope and left alone.

---

## R3a — Node worker backend: `worker-brokered` on the node target (Root/Fable, 2026-08-18)

**What exists.** `packages/host/src/node/worker-backend.ts` (`createNodeWorkerBackend`, exported
from `@modkitx-x3/host/node`), `packages/host/src/node/worker-bootstrap.ts` (its own published
entry `@modkitx-x3/host/node/worker-bootstrap` so `new Worker(url)` finds it after bundling — 42
bundle entries), `packages/host/src/execution/worker-policy.ts` (`WorkerBackendPolicy`, defaults,
hard ceilings, `workerBackendPolicy()` refuses — never clamps — values above a ceiling), and
`packages/host/test/node-worker-backend.test.ts` (8 tests over real `worker_threads`, 3/3 stable)
with the single-file fixture `test/fixtures/worker-codec/codec.mjs`.

**Backend (host side).** `ExecutionBackend { profile: 'worker-brokered', supports(node target +
worker-brokered variant), activate }`. `activate`: refuses non-`file:` entrypoints; hashes the
entrypoint bytes (`entrypointDigest`); spawns one `Worker` per activation from the bootstrap with the
threat-model options (`env: {}`, `argv: []`, `execArgv: []`, `resourceLimits` from the policy,
captured + capped stdio → diagnostics, `trackUnmanagedFds`, dedicated transferred `MessagePort`);
runs a host endpoint over `createStandardSurfaceRegistry({ definitions: foreignSurfaces })`;
supervisor reactions: `onFailure` → `terminate()`; worker `'exit'`/`'error'` → `peerClosed`
(+ `x3.host/worker-crashed`); every outbound request under the hang watchdog (deadline → cancel →
grace → `terminate()`); `release()` → `terminate` frame → grace → `terminate()`, idempotent.
`load` carries `entrypointDigest` (new optional field of the `load` frame / `LoadRequest`) under
`loadDeadlineMs`; a failed load releases the worker before rethrowing. Every activation reports
`x3.host/worker-shared-process` (decision 1 of the threat model §8) — failure and protocol
isolation, not a sandbox.

**Module adapter (host side).** The lease's `module` keeps the ABI's _synchronous_
`createCodec(context)`: the context's `diagnostics` sink is exposed as `x3.abi/diagnostic-sink@1`
and `budgets` copied; the remote `createCodec` is issued eagerly and awaited by the returned codec's
methods. `probe(request, signal)` exposes `request.source` as `x3.abi/artifact-source@1` (its data
fields — `ref`, `revision`, `kind`, `size` — travel inside the ref) for the call's duration;
`open(input, intent, budget, signal)` exposes the `AssetInput` as `x3.abi/asset-input@1` (fields +
host-executed `openBinding`/`openNamespace`) and returns a session adapter over the leased
`x3.abi/asset-session@1`: `revision` from the ref's fields, `state()` cached (`live` → `disposed`),
`descriptor`/`dataSource`/`events` proxied (data sources come back as `{ value, release }` with
materialized standard surfaces), `operations()` a lazy adapter, `dispose()` releases the session
and the exposed input.

**Bootstrap (worker side).** Worker endpoint over the same registry (foreign surfaces handed over
as data); exactly one `load`; `file:` only; real path must stay inside `artifactRoot`; the
entrypoint bytes are read once, re-hashed against `entrypointDigest` (`x3.host/artifact-digest-
mismatch` otherwise) and evaluated _from those bytes_ as a `data:` module — a module that needs
relative imports is refused with `x3.host/artifact-not-pinned` (decision 3: no `file:` fallback);
`ContributionContext` re-assembled (`budgets`, `diagnostics` → host capability, `contracts` a port
that refuses — service resolution from a worker is not v1); `AssetInput` re-assembled from the
copied fields with `bindingsFor` derived locally; exit 0 on `terminate`, 2 on protocol failure.

**Proved (acc-1/6/7/9/11 of the threat model).** Activation via `activateExecutionBackend`
through a real worker; probe reads through a host-executed source with its `ref.path` visible to
the codec; the codec's diagnostic reaches the host sink; `open` reads through the host's
`openBinding` lease, derives `bindingsFor` in the worker, returns a session with `revision`,
dynamic `dataSource`, `operations().invoke`, `events`, `dispose`; tamper inside the digest→evaluate
window (deterministic through the `afterEntrypointDigest` seam) → `x3.host/artifact-digest-mismatch`
and no worker survives; entrypoint outside the root → `execution-load-rejected`; relative import →
`artifact-not-pinned`; `https:` entrypoint refused before spawn; policy ceilings; `release()`
idempotent and calls afterwards → `endpoint-closed`.

**R3b-1 (same day) — verified multi-file loading, real extensions in the worker.** The node
inventory loader records per-file digests in the same walk as the artifact digest
(`ArtifactAttestationInput.fileDigests`, kept in the private inventory record); the gate hands them
to the backend (`ExecutionBackendActivation.fileDigests`) — still valid because the gate re-verified
the artifact digest just before — and also emits the product-facing `x3.host/worker-shared-process`
diagnostic next to the trusted one. The worker bootstrap now installs synchronous module hooks
(`module.registerHooks`): every module under the artifact root (`node_modules` excluded) is read
once, verified against the map (`x3.host/artifact-digest-mismatch` on change,
`x3.host/execution-load-rejected` for a file the inventory never listed) and handed to the evaluator
as those bytes — no `data:` trick, `import.meta.url` intact, no window between check and
evaluation; relative/absolute imports that escape the artifact are refused, bare specifiers
resolved by Node from inside the artifact (its `node_modules`, workspace links included) and a
dependency's own internal imports load normally but unverified — SB-1 honesty, dependency
digests are SB-4. Without a digest map the entrypoint alone is verified (`entrypointDigest`) and its
imports are `x3.host/artifact-not-pinned`. Proof: the real bundled **`text-json` codec** — inventoried
through `loadExtensionDirectory`, multi-file entrypoint + `@modkitx-x3/codec-kit`/sdk/core
dependencies — activates in a worker through the backend SPI and its probe detects JSON; a tampered
helper is refused, an unlisted file is refused, a dependency through `node_modules` loads, an
in-artifact `../outside.mjs` escape is refused (12 tests, 3/3 stable).

**R3b-2 (same day) — signals/progress inside argument objects, contract resolution from the
worker, service-arm surfaces; a real codec `open()` in the worker.** The surface model gained
placements: `signal: 'last' | 'none' | { arg, key }` and `progress: { arg, key }` — the consumer's
proxy lifts an `AbortSignal`/callback out of the declared key of an object argument (the object
stays a plain wire value), the executor re-creates a signal there and a progress emitter that sends
`progress` frames for the in-flight call (bounded to the wire DTO); `resultFromArgs` accepts
`ArgRef = number | { arg, key }`, so `contracts.resolve({ contract, major, signal })` leases a
provider whose surface is named by the request. The SDK schema/types/drift gate follow (`signal`
`anyOf`, `progress`, `fields`), and the **service arm** of contract-definition-spec.v1 gains the
same optional `surface` (semantic rule: a field cannot also be a method); `ServiceContractDefinitionRegistration`
carries the wire surface. New ABI surface `x3.abi/contract-resolver@1` (`resolve`/`resolveUnknown`,
result from `{ arg: 0, key }`); `x3.abi/operation-session@1.invoke` now declares its options-object
signal/progress. The backend exposes `context.contracts` as that capability; the bootstrap hands
the codec a proxy resolver (a resolved provider arrives as a proxy carrying its definition's
surface). The eight bundled text-data service contract definitions (`contract-*-syntax.json`) now
carry the provider surface (`fields: ['contract']`; `parse`/`serialize` value with
`signal: { arg: 0, key: 'signal' }`; `dataSource` lease of the tree/table data-source surface) —
they validate through the production registry (`check:extensions`).

Two wire rules changed on evidence from the real codec: (a) **arguments are copied, results and
events are transferred** — ABI code written for in-process calls reuses a buffer it passed
(`parse` then `dataSource` with the same `bytes`); transferring detached it under the caller and the
second call died with `DataCloneError`; a `Uint8Array` over a detached buffer is now refused
explicitly; (b) `undefined` is tolerated inside objects/arrays (an absent optional property as ABI
objects routinely carry — `ParseResult.truncation`), still refused as a top-level value.

**Proof:** the real bundled `text-json` codec **opens a session inside the worker**: its
`contracts.resolve` crosses to the host, the real JSON provider (host-side) is proxied by its
definition surface, `parse`/`dataSource` run on the host with the bytes crossing by copy, the
worker assembles and validates the subject descriptor, and the session comes back with revision,
descriptor and a tree data source (`root`/`children`) — end to end through the backend SPI
(`node-worker-backend.test.ts`, 13 tests). Endpoint tests cover object-carried signal (incl. cancel
through it), progress forwarding and request-named lease surfaces.

**Honest gaps (R3b-3…).** (1) A source that cannot enumerate files (no `fileDigests`) still gets
the activation-time entrypoint hash with its small window. (2)
`AssetSession.operations().invoke` progress/signal placements are declared but the host-side
session adapter's lazy `operations()` does not yet forward them per call. (3) `AssetInput`/`ArtifactSource` marshalling covers the single/
bundle/namespace shapes' fields listed in the ABI surfaces; derived inputs and `openMaterialized`
are not wired. (4) Not wired into the composition roots yet: `DEFAULT_EXECUTION_BACKENDS` still
holds only `trusted-in-process`; the CLI/Electron roots choose the policy and register the backend
(NXT-114 wiring + acc-8 restart generation + acc-12 conformance kit on the backend's port pair).

---

## R2 — surface adapter, runtime-ABI surfaces and protocol v1.1 kinds in the RPC core (Root/Fable, 2026-08-18)

**Protocol/core extensions (`packages/host/src/execution`, backward compatible — new frame fields
are optional and only appear when a surface declares the new features):**

- `leased-value` method kind: the executing side requires a `{ value, release }` result, allocates a
  release-only `lease` handle (no surface) and replies `return { value, lease: <ref> }`; the consumer
  gets `CallOutcome { kind: 'leased-value', value, release() }` and a materialized `{ value, release }`
  (`Lease<T>` on the ABI). Late replies after cancel discard the lease with a real release request.
- `resultFromArgs: { contract, major }` on a `lease` method: the executing side resolves the leased
  surface from the decoded arguments (`AssetSession.dataSource(contract, major)`), refusing unknown
  ones with `x3.host/rpc-bad-argument`; the consumer accepts any registered surface the returned
  ref names (`unknown-surface` violation otherwise) — refs already carry contract/major.
- `arity` on a method: omitted trailing arguments are padded with `undefined` before the signal is
  appended (`encoded(trackId?, signal?)`).
- `optional` on a method (data only for now; proxies still define the method, an absent
  implementation answers `x3.host/rpc-method-unavailable`; `has[]` presence remains v1.1).
- `fields` on a capability surface: data properties copied **inside the handle ref**
  (`{ '@x3.handle': { id, kind, contract, major, data } }`, `data` a handle-free wire object) by
  whichever side creates the handle — lease results, `ready.root`, and capabilities passed as
  arguments (`expose()` snapshots the fields) — and exposed on the consumer as own read-only
  properties of the materialized object and as `RemoteCapability.data`. This is how data+method
  hybrids (`AssetSession.revision`, `ArtifactByteSource.size`, an `AssetInput`'s bindings, a
  module's `abiVersion`) cross without a second marshalling layer, wherever the ref travels.
- Frame grammar: `return` gains optional `lease` (must be a `lease` ref; a leased value cannot itself
  be a handle). Hostile tests cover a non-lease `lease` ref and handles smuggled inside a ref's
  `data` at the top level and nested (all fail closed with `handle-not-allowed`).

**Adapter (`surface-adapter.ts`).** `capabilitySurfaceFromDataSource(contract, major, surface)`
maps NXT-103 surfaces 1:1; declared `limits` become validators (`maxStringLength` on arguments and
results, `maxBytes` on result bytes, `maxPageItems` on `items` of page-shaped results).
`createStandardSurfaceRegistry({ definitions?, surfaces? })` builds the one registry a host endpoint
runs with: the 13 standard + auxiliary data-source surfaces (adapted from `@modkitx-x3/sdk`), the
runtime-ABI surfaces, registered foreign definitions that carry a `surface` (those without are
skipped — a host never guesses a foreign surface), and extras; the standard/ABI set wins conflicts,
and a foreign lease naming an unregistered surface fails at build (`createSurfaceRegistry`).

**Runtime-ABI surfaces (`abi-surfaces.ts`, host-internal, ids `x3.abi/*@1`).** `codec-module`
(fields `abiVersion`; `createCodec` → codec), `codec` (`probe`, optional `planInput`, `open` →
asset-session), `asset-session` (field `revision`; `state`, `descriptor`, `dataSource` with
`resultFromArgs`, `operations` → operation-session, `events`, `dispose` = `releaseVia`),
`operation-session` (`invoke` as plain value — the options-object signal/progress do not cross yet,
plan F3), and the host-side objects a worker calls back into: `artifact-source` (union surface,
fields `ref`/`revision`/`kind`/`size`, optional `read`/`stream`/`openNamespace`), `asset-namespace`,
`asset-input` (union: fields `originKind`/`bindings`/`revisions`/`primaryBindingId`, optional
`openBinding`/`openNamespace`; sync `bindingsFor`/`subjectsFor` are derived locally by the worker
bootstrap), `diagnostic-sink`. Each is pinned to its SDK ABI interface by `AbiSurfaceOf<T>` at compile
time (missing/extra/unflagged-optional methods, or fields that are methods, do not compile); the
topology union of `AssetInput` collapses to `never` under intersection, so its pin is assembled from
the union's members.

**Proof.** `packages/host/test/execution-surface-adapter.test.ts`: the registry resolves everything;
foreign definitions are added/skipped/never shadow the standard set; real `TextDataSource`,
`NamespaceEntrySource.openEntry` (leased value), `AudioMediaSource.encoded()` (bare lease of the
auxiliary surface, `arity` observed as `(undefined, signal)`, absent optional `readPcm` answered
structurally) and an `AssetSession`-shaped object (`revision` field, dynamic `dataSource`, `dispose`
releases) round-trip through the RPC core over a loopback; declared limits reject on the right side.
`execution-endpoint.test.ts` (+6): leased values incl. discard after cancel on a macrotask wire,
dynamic lease results, arity padding, fields on root and leases, hostile `lease`/`data` frames.

**Not here (R3, the Node worker backend).** The marshalling of `ContributionContext` and
`AssetInput` _into_ the worker (budgets copied, ports/openers exposed as host capabilities and
re-assembled by the worker bootstrap), verify-after-load, `WorkerBackendPolicy`, and wiring the
registry into the execution backend — all built on the surfaces above.

---

## NXT-103 — data-source method surface is a contract-definition authority (Root/Fable, 2026-08-18)

**What landed (`packages/sdk`).** The `kind: 'data-source'` arm of `contract-definition-spec.v1`
gains an optional `surface`: `{ methods: Record<name, MethodSurface>, releaseVia? }` where a method
surface is a two-arm `oneOf` — `{ kind: 'lease', result: {contract, major}, wrapper?: 'lease'|'bare' }`
or `{ kind: 'value' | 'leased-value' | 'iterable' | 'events' }` — with the shared optional fields
`signal: 'last'|'none'`, `arity` (positional args before the signal; the executing side pads omitted
trailing args with `undefined` so `encoded(trackId?, signal?)` called as `encoded()` still gets its
signal last), `optional` (the ABI declares the method with `?`) and `limits`
(`maxPageItems`/`maxBytes`/`maxStringLength`). Method names follow `METHOD_NAME_PATTERN`
(`^[a-z][a-zA-Z0-9]{0,63}$`, the same grammar as the host protocol's `isMethodName`). Types:
`DataSourceSurfaceV1Wire`/`DataSourceMethodSurfaceV1Wire` (string contracts) and the branded
`DataSourceSurfaceV1`/`DataSourceMethodSurfaceV1`; `DataSourceRegistration` is now typed against
the wire spec (registrations carry data as registered). Semantic rules the schema cannot express
run in `validateContractDefinitionSemantics`: `releaseVia` must name a declared `value` method
(`x3.sdk/surface-release-via-unknown` / `-kind`). Standalone CSP-safe validators are emitted for
`dataSourceSurfaceV1` and `dataSourceMethodSurfaceV1` next to the definition validator.

**Drift gate.** No "recursive exclusive-union normalisation" was needed: the hand-written wire type
is the same two-arm union the `oneOf` produces, so `Equal<DeepMutable<…>, FromSchema<…>>` holds
for the method surface, the surface and the whole contract-definition union
(`packages/sdk/test/schema-drift.ts`). The kind ↔ result correlation is a structural fact on both
sides — a single interface with `result?` would have weakened it, exactly the trap Sol flagged.

**Standard table.** `STANDARD_DATA_SOURCE_SURFACES` (13 contracts, all major 1) +
`AUXILIARY_DATA_SOURCE_SURFACES` (`common.view/encoded-media@1` — `EncodedMediaSource` is a
capability object returned by `encoded()`, not a data-source contract; it needs a surface id for the
`lease` result and is released by cascade from its parent) + `standardDataSourceSurfaceFor(contract,
major)` (undefined for foreign contracts: their surface comes from their own definition, never a host
guess), exported from `@modkitx-x3/sdk` and `@modkitx-x3/sdk/data-sources`. Every entry is pinned to
its ABI interface at compile time by `SurfaceOf<T>` (`RequiredMethodKeys`/`OptionalMethodKeys`
mapped types): missing, extra or unflagged-optional methods do not compile
(`packages/sdk/test/data-source-surfaces-types.ts` proves the negatives with `@ts-expect-error`).
Kinds mirror the ABI: `Promise<X>` → `value`; `Promise<EncodedMediaSource>` → `lease`/`bare`;
`Promise<Lease<AssetSourceRef>>` (`openEntry`) → **`leased-value`** — a new kind: the value crosses
by copy, the lease is a release-only handle (proposal §5.2 option (б), no ABI change);
`AsyncIterable` → `iterable` (`search`) or `events` (`TransportSource.events`, live push);
`readRegion?`/`readPcm?`/`readFrame?`/`primitive?` → `optional: true`; `AudioMediaSource.encoded`
→ `arity: 1`. No `limits` in the standard table: bounds are owner policy per contract; the wire
already enforces the endpoint's global limits.

**Decisions taken here (Root, lab scope).** (1) `leased-value` instead of redefining `openEntry`
on the ABI. (2) The auxiliary surface lives in the standard table under `common.view/encoded-media`
rather than a host-internal exception. (3) `optional` is data now; the protocol's `has[]` presence
list on handle refs is still v1.1 — until then a materialized proxy defines optional methods and an
absent implementation answers `x3.host/rpc-method-unavailable`. (4) `arity` replaces the proposal's
`args` schemas for v1; `args`/`returns` JSON-schema refs remain a possible later addition. Owner-doc
sync (`docs/MK3/02` vocabulary, `27` §6 envelope) is the owner's to record; this entry is the lab
record.

**Not here.** The host adapter (`DataSourceSurfaceV1 → CapabilitySurface`), the ABI surfaces
(module/codec/session/provider) and the standard surface registry are R2 in `packages/host`.

---

## F4b — hostile-worker fixtures, Node worker harness and acceptance over real threads (Fable, 2026-08-18)

**What exists.** `packages/testkit/src/capability-rpc/node/worker-harness.ts` (exported from
`@modkitx-x3/testkit`): `spawnFixtureWorker(fixture, { session, generation, resourceLimits?,
fixtureOptions? })` starts a fixture in a real `worker_threads.Worker` with the isolation options
of `THREAT_MODEL_WORKER_BOUNDARY` §2 (`env: {}`, `argv: []`, `execArgv: []`, captured + capped
stdio, `trackUnmanagedFds`, a dedicated transferred `MessagePort`) and returns `{ port: FramePort,
exit, output, terminate() }`; `superviseFixtureWorker(...)` adds a host endpoint and the
**reference supervisor** — the observable reactions the threat model prescribes: `onFailure` →
`worker.terminate()`; worker `'exit'`/`'error'` → `endpoint.peerClosed()`; `release()` →
`terminate` frame → grace → `terminate()`; `watched(request)` → after
`x3.host/rpc-deadline-exceeded`, grace for a dropped late reply (the cancel acknowledgement) →
otherwise `terminate()`. Everything is exposed through `end` (`closed | peer-exited | violation |
peer-failure` + exit code/error), `terminations[]` and `endpoint.counters()`. The production
backend (NXT‑114, Root) owns its own policy; this file owns the proof it must pass.

**Fixtures** — `packages/testkit/fixtures/hostile-worker/*.mjs`, dependency-free raw-protocol
scripts over `_lib.mjs` (`serveDemoChain` answers `load`/`createCodec`/`open`/`descriptor`/`echo`/
`dispose`/`release` so each fixture scripts one misbehaviour in a hook): `proto-pollution` (HW‑01),
`bad-values` (HW‑02: nan | partial-view | shared | deep | unknown-frame-key), `exit-early` /
`exit-after-ready` (HW‑03), `throw-uncaught` (HW‑04), `hang-sync` (HW‑05), `hang-async` (HW‑06,
`honourCancel` variant), `oom` (HW‑07), `event-flood` (HW‑08), `forged-handles` (HW‑10: unknown |
foreign-owner | released), `wrong-session` (HW‑11: session | domain | generation), `reply-games`
(HW‑12: duplicate | unknown-id | ready-for-call | late-after-cancel), `ignore-terminate` (HW‑14),
plus `demo-worker` — a _well-behaved_ worker-role endpoint over the built dist serving the demo
world, the positive control across the thread boundary. HW‑09 (`tamper-marker`) and HW‑13
(`second-load`) test the backend's own loader (verify-after-load, one `load` per worker, `file:` ⊂
`artifactRoot`) and wait for R3.

**Acceptance** — `packages/testkit/test/hostile-worker.test.ts` (14 tests, 26 spawns, ~2.5 s,
4/4 stable runs): acc‑1 (exit before `ready` → activation rejects `x3.host/rpc-peer-exited`,
counters 0), acc‑2 (exit mid-call → pending rejected, host leases released, calls after →
`endpoint-closed`), acc‑3 (every violation class → `state='failed'`, one termination, counters 0,
worker gone), acc‑4 (dead loop and cancel-ignoring worker terminated after deadline+grace; a worker
that answers cancel is _not_ terminated; `release()` on a terminate-ignoring worker resolves within
grace), acc‑5 (`ERR_WORKER_OUT_OF_MEMORY` under `resourceLimits` = plain peer exit; 50k-event flood
→ `x3.host/rpc-events-overflow`, endpoint open), acc‑10 (uncaught error surfaces as exit + error
object, no leak of stack across the wire), and the positive control (load, callback into a host
lease, `Uint8Array` transfer, iterate, events, cancel, close → exit 0, counters 0). Not yet: acc‑6
(tamper), acc‑7 (diagnostic code — Root's naming), acc‑8 (restart generation — needs the backend's
restart), acc‑9 (idempotent `release()` ×3 — trivially true for the reference supervisor, to be
asserted against Root's `ExecutionModuleLease`), acc‑11 (loader scope), acc‑12 (conformance kit —
Root wires it to the real transport pair).

**Kit host-only mode (acc‑12 precursor).** `ConformancePair.worker` became optional; a pair with
`farSide: 'demo-world'` declares that the far end already runs a worker endpoint over the demo
world, and `ConformancePairFactory` now receives the `{ session, generation }` the kit's host
endpoint will use so a remote peer can be spawned with the same identity. In that mode the kit runs
the host-observable subset (16 of 21 cases: round trip, wire values, transfer, ordering, errors,
large payload, events end/abandon, cancel, deadline, lease-after-cancel, release cascade, pending
limit, graceful close, peer exit, local misuse) and reports the rest as `skipped` (`lc-events-
overflow` needs the local world; the four `hs-*` cases need raw injection through the peer port).
`demoWorkerPair(identity)` in the harness turns the `demo-worker` fixture into such a pair —
`runFramePortConformance(identity => demoWorkerPair(identity))` is green over real
`worker_threads` (16 passed / 5 skipped, transfer `detached`, delivery `asynchronous`, ~2 s). The
same shape fits R3's real transport pair and R6's Electron main↔utility pair without new kit code.

**Facts learned.** (1) A failing host endpoint sends `terminate` _and_ the supervisor calls
`worker.terminate()`; a fixture that honours the frame exits 0 before the kill lands (exit 1) —
tests accept both, what matters is `spawned.exited`. (2) `worker.terminate()` ends a synchronous
`for(;;)` reliably (V8 termination) — the only thing that does. (3) OOM at
`maxOldGenerationSizeMb: 24` arrives in well under a second and as an `'error'` with code
`ERR_WORKER_OUT_OF_MEMORY` followed by `'exit'`; the host process is untouched. (4) The event
flood is bounded on the host by `maxQueuedEvents` + `unsubscribe`; events that keep arriving after
`unsubscribe` are counted (`droppedEvents`), never queued.

---

## F1 — FramePort conformance kit + first core defect it found (Fable, 2026-08-18)

**What exists.** `packages/testkit/src/capability-rpc/{conformance,loopback,message-port,demo-world,index}.ts`,
exported from `@modkitx-x3/testkit`; self-test `packages/testkit/test/capability-rpc-conformance.test.ts`.
`runFramePortConformance(createPair, options) → { transport, passed, failures, skipped, observations }`
is framework-agnostic (no vitest inside the kit): a transport hands over both ends of one channel
(`ConformancePair { transport, host, worker, close? }`) and the kit runs 21 cases against fresh pairs —
round trip (load → callback into a host source → lease → iterate → dispose; wire values incl. bigint,
`Uint8Array`, unicode, nesting, `-0`; transfer; ordering of 64 concurrent calls + 200 FIFO events;
error rehydration; payload at/over `maxTransferBytes`), lifecycle (events end/failure/abandon/overflow,
cancel, deadline, lease-after-cancel, release cascade, pending limit, graceful close, peer exit,
local misuse) and hostile (malformed/foreign-session/stale-generation/non-monotonic/orphan-reply frames,
duplicate reply, unknown/foreign handles and methods, iterator busy). Hostile cases inject raw objects
**through the transport's own `post`** — no special injection API — so a transport that carries garbage
unchanged fails closed on the far endpoint, one that refuses garbage at `post` gets those cases
`skipped` (a validating adapter is fine and reported), one that swallows garbage fails (deadline instead
of violation). Observations, not pass/fail: `transfer: detached | copied`, `delivery: asynchronous`
(delivery inside `post` is a failure — re-entrancy). Cases are the host loopback suite re-expressed
against an abstract pair; the host suite stays as the unit suite (host cannot depend on testkit).

**Proven against.** loopback (microtask and macrotask delivery), a real Node `MessageChannel`
(`node:worker_threads`, structured clone + transfer, both `addEventListener` and `on('message')`
listener styles via `framePortFromMessagePort`) — all 21/21; and negative self-tests: a duplicating
transport, a dropping transport, a synchronous transport and a strict (refusing) transport are caught
or classified as designed. Scope note in the kit header: both ends live in the calling thread;
crash/hang/exit of a _real_ worker is backend acceptance (`THREAT_MODEL_WORKER_BOUNDARY` §4/§5), not
FramePort conformance.

**Defect found by the kit (fixed in `endpoint.ts`, my file).** On real event-loop hops (macrotask
loopback, `MessageChannel`) the worker's reply to a call can already be in flight when the host sends
`cancel`. The host then drops the late reply as `late-after-cancel` and — if it carried a handle —
released it with a **fire-and-forget** `release` frame (`trySend`). The executing side answers every
`release`, so the acknowledgement arrived for an id that was never pending → `unknown-reply-target`
→ the host failed closed after a perfectly legitimate race. Same pattern in the late-`ready` path
after a cancelled `load`. Fix: `discardHandle(id)` issues a real `release` _request_ (pending entry,
deadline, outcome ignored, failure reported as `x3.host/rpc-release-failed` diagnostic). Regression
test in `execution-endpoint.test.ts` (`Wire` now has a `macrotask` delivery mode; the test fails on
the unfixed code and passes on the fix). The microtask loopback never showed it because the worker
saw `cancel` before replying — the whole reason F1 exists.

**Wiring (one enabling change outside testkit, flagged for Root).** `packages/host/package.json`
gains the subpath export `./execution` (`@modkitx-x3/host/execution` → `dist/execution/index.*`).
Rationale over a root re-export: testkit, transports (NXT‑114/115/401), the Electron preload and worker
bootstraps then depend on the protocol alone and never pull inventory/resolution/gate code into a
renderer or worker bundle; the host root namespace stays as Root left it. `scripts/bundle.mjs` picks
the entry up from `exports` (41 entries; hash file regenerated by `pnpm build`). Root's `./browser`
boundary proof is unaffected — the execution modules import only `@modkitx-x3/core`.

---

## NXT-105 — capability-RPC core v1 landed (Fable, 2026-08-18; since published as `@modkitx-x3/host/execution`, wired by R2)

**What exists.** `packages/host/src/execution/{protocol,surface,handles,endpoint,index}.ts` +
`packages/host/test/execution-{protocol,handles,endpoint}.test.ts` (51 tests, hostile suite included).
Transport-agnostic: no worker, no port, no module loading, no public SDK change, **no standard
surface data** — a `SurfaceRegistry` port and an injected `loader` are the only seams. Not exported
from `packages/host/src/index.ts` and not bundled until Root composes it (NXT-100 backend SPI,
NXT-114/115 transports, NXT-401 Electron IPC). `execution/backend.ts` in the same directory is Root's
NXT-100 file, not part of this slice.

**Protocol (`protocol.ts`).** Envelope `{domain 'x3.host/rpc', version 1, session,
generation, id}`; frames `load ready call return throw cancel next done subscribe event
unsubscribe progress release terminate` with exact-key validators; wire values = JSON-safe data,
`bigint`, whole `Uint8Array` (owning its buffer; views over larger/shared buffers refused) and
handle refs `{ '@x3.handle': {id, kind, contract?, major?} }`; prototype-safe (`__proto__`,
`constructor`, `prototype` refused as keys); limits (depth/nodes/string/array/keys/transfer/args +
pending/handles/iterators/subscriptions/queued events/default deadline). Handle ids carry the
allocating side (`h…` host, `w…` worker) so an endpoint tells its own from the peer's without a
table; subscription ids `[hw]s<gen>-<n>` are allocated by the pusher. Error DTO from
`ModkitError.toJSON()` (context validated as wire value or dropped with `contextDropped`), no stacks,
`OperationCancelledError` stays a cancellation (`cancelled: true`) on rehydration.

**State machine (`endpoint.ts`) — decisions the code fixes:**

- exactly **one reply per request, always** — also after `cancel`; the caller marks the entry
  cancelled, drops the late reply as `late-after-cancel` (counted, non-fatal) and, if a handle came
  back late, sends `release` for it; the executing side releases a lease/iterator it produced after
  cancel before replying `throw` cancelled — nothing leaks and no id stays pending;
- reply for an id that was opened before and is not pending → `duplicate-reply` (fatal); for an id
  never opened → `unknown-reply-target` (fatal); `progress` after settlement is ignored;
- calling a **released** handle is a structured error (`x3.host/rpc-released-handle`), not a
  violation (legitimate races); calling an **unknown/foreign-generation/wrong-kind** handle or an
  unknown method is a violation → endpoint fails closed: pending rejected with
  `x3.host/rpc-protocol-violation`, active calls aborted, local targets released (reverse order),
  subscriptions closed, `terminate` sent, `onFailure(violation)`;
- iterators: one `next` in flight per iterator (`iterator-busy` is fatal), `done` releases;
  events: pusher-side pump, consumer-side bounded queue, overflow ends _that_ stream with
  `x3.host/rpc-events-overflow` and `unsubscribe` (endpoint stays open), `done` may carry an
  error; queued events are drained before a closed stream finishes;
- releases cascade parent → children on both sides; `releaseVia` (e.g. `dispose`) releases the
  handle when the ABI method completes; `wrapper: 'lease'` materializes `{ value, release }`;
- deadlines are per request (default `defaultCallDeadlineMs`, `deadlineMs` override, 0 = off;
  `subscribe` waits are exempt) → `x3.host/rpc-deadline-exceeded` (`retryability: 'conditional'`);
  a hang watchdog that _terminates_ the worker belongs to the backend (NXT-112).

**Materialized proxies.** `endpoint.materialize(capability)` builds a plain object with one method
per surface entry: trailing `AbortSignal` is stripped into the call's cancellation, `lease` results
materialize recursively, `iterable`/`events` return `AsyncIterable`s; the object carries its
`RemoteCapability` under `CAPABILITY_OF` so it can be passed back as an argument. Handle refs are
allowed nested in call args (`{ source: <ref> }`), only at top level in returns.

**Vocabulary.** «capability‑RPC» is the prose name only: the wire domain is `x3.host/rpc`, the
lease outcome field is `remote`, and no wire key or schema key spells `capability` — the legacy
gate (`check:legacy`) covers `packages/host/src/execution/**` and flagged the first draft, which is
exactly what it is for.

**Deliberately not here (waits for owners/other slices):** standard data-source and ABI surfaces
(NXT-103 / Root, proposal in `PROPOSAL_NXT103_DATA_SOURCE_SURFACE_2026-08-18.md`), `optional`
methods + `has[]` presence on handle refs (proposal §5.1), a `leasedValue` kind for
`openEntry(): Lease<AssetSourceRef>` (§5.2), progress _emission_ API on the executing side
(frames validated/delivered; ABI needs an options-object convention first), batching for
`iterable` (§5.4), any transport.

---

## G-APP-1 — the product open path bypassed the host (closed 2026-08-17; review by Fable, implementation by Sol)

**Gap (reproduced, not inferred).** The A‑2/A‑3 primitives exist in production `host`
(deterministic inventory, `offersFromInventory`, resolver, artifact-bound tickets, digest/entrypoint
verification, grant narrowing, activation gate, descriptor assembly, presentation-plan resolver) but
are **not assembled into the path a user's file takes**:

- `apps/electron/electron/main.cjs:105` composes `createElectronApp()` with no extension inputs —
  the shipping inventory is empty;
- `apps/electron/src/codecs.js` statically imports every common codec/provider and hands the
  explorer a file-extension table; `packages/ui/src/explorer/preview.ts` picks a codec by extension
  and calls `codec.open()` with no inventory, probe, resolver, lock or ticket; the codecs are bundled
  into and executed in the renderer realm (`dist-app/renderer.js` contains `org.modkitx/image-png`);
- every common manifest declared only a `worker-brokered` variant while `gate.ts:46` honours only
  `trusted-in-process`, so the host gate could not activate a single bundled codec;
- `enabledExtensions` (settings) is exported but consumed by no app; `pnpm apps:check` proves the
  declarative plane (inventory/eligibility/resolvability per realm), not file opening.

Consequences: the declared security model is decorative on that path (no grant, no full-authority
diagnostic, no isolation — a `worker-brokered` declaration executed in-process is the silent
downgrade 24 §6.1 rule 1 forbids); users cannot install/enable/disable formats; lock/determinism do
not apply; README/`REPORT_A0_A8…` overclaimed «never in a renderer» (both corrected today).

**Decision (Sol/Fable, accepted 2026-08-17).** One host-owned `subject-open` vertical slice
assembles the existing primitives (`ExtensionInput → Inventory → bounded probe → resolver → ticket →
activation → planInput → AssetInput → codec.open → descriptor → presentation plan → leased sources`),
first proven on UVM (trusted Node variant) and JSON + unknown Text/Hex, then wired into Electron main
with a generated bundled catalog, renderer receiving only leases through the preload broker,
`codecs.js` removed and stages taken from `resolvePresentationPlan`. Owner: Sol. Not a blanket
`trusted-in-process` downgrade: manifests keep the portable `worker-brokered` variant and add a
`trusted-node` variant for bundled/verified codecs (UVM pattern), always with the full-authority
diagnostic.

**Closure.** `ad6f0cc` assembled and tested the reusable host pipeline; `f510b3b` connected Electron
main to a generated bundled catalog, moved all session/data-source ownership behind validated
preload IPC, deleted the renderer codec table, consumed host presentation plans, and added permanent
app-import/bundle/inventory gates. The full gate on the latter commit's tree passed: 66 test files /
476 tests, 14 emitted schemas, 16 UI manifests, exact 16-row application matrix, legacy/import/
extension-inventory gates, and all universal-data budgets. Real Electron self-tests opened JSON,
PNG and UVM through selected `trusted-node` variants and surfaced an unknown binary through the
explicit Hex fallback. Browser E2E switches stages 100 times while retaining the same asset session
and releases every lease. The implementation does not claim worker isolation: SB-1 and the unified
VFS/container plane remain the next design slices below.

**Rules that fall out of the code (recorded so nobody rediscovers them):**

- **R-A1 disjoint variant targets.** `offersFromInventory` emits one offer per runtime variant and
  the resolver ignores execution profiles (23 §8: profile is an activation-host concern), so two
  variants matching one target tie in the preference tuple → `ambiguous`. Adding `trusted-node` on
  `node` therefore requires removing `node` from `portable` (as UVM does).
- **R-A2 target selects the variant, not a resolver preference.** Without a worker adapter the host
  resolves for environment `node`; with one it resolves for `node-worker`/`browser-worker` and the
  portable variant is chosen naturally — no resolver change, no self-declared priority.
- **R-A3 provenance gate for `trusted-in-process`.** 24 §16 forbids a restricted contribution from
  taking `trusted-in-process` without explicit host policy; inventory carries no provenance today,
  so the slice needs a bundled/first-party vs installed/linked marker feeding `HostPolicy`.
- **R-A4 checked bridge first.** `RandomAccessSource<number> → ArtifactByteSource<bigint>` as a
  strict adapter (bounds, `> MAX_SAFE_INTEGER` refused, cancellation propagated); the owner question
  of a single bigint `vfs` contract (27 §0.1) is filed, not blocking.

**Gates added by this pass (Fable; ratchets with stale-entry failure, no mutable baselines):**

- `scripts/check-app-imports.mjs` (`pnpm check:imports`): no authored `apps/**`/`packages/**`
  import of `extensions/**`/`examples/**` implementations or `modkit-extension-*`/codec-kit
  packages; a `generated/` path segment is the one permitted (generated) edge (27 §7). The initial
  known-debt entry (`apps/electron/src/codecs.js`) was retired the same day by the subject-open
  slice, which deleted the file — the ratchet did its job on its first day; the list is empty.
- `scripts/check-extension-inventory.mjs` (`pnpm check:extensions`): every authored container under
  `extensions/*/*` and `examples/*` builds an error-free inventory; bundled `common` units must be
  inventory-eligible. Known debt: `extensions/common/ui-graph-3d` (pattern-without-matches).
- `scripts/check-legacy.mjs` now scans `extensions/*/*` and `examples/*` ({src,schemas,contributions}
  - root manifests); the `@modkitx-x3/*` name scope stays a platform/apps rule (27 §0.2 names are free).
- Removed the empty post-refactor `extensions/common/text-data/` tree (dirs + node_modules, untracked).

**MK2 allocation report (Fable, read-only over the sibling `modkitx`, 27 §12.19).**
`node scripts/report-mk2-allocation.mjs --out REPORT_MK2_ALLOCATION_<date>.md [--json …]` classifies
every v1 manifest against the current X3 contracts; the vocabulary it restates
(`scripts/lib/mk3-vocabulary.mjs`) is pinned to `@modkitx-x3/core`/`sdk` by
`scripts/test/report-mk2-allocation.test.ts`. Snapshot 2026-08-17: 206 codec manifests → 103
mechanical / 24 convertible with rework / 79 need a contract X3 does not have; 31 game manifests →
all need a `game` contribution kind; 45 `extension.json` → `package.json#modkit` (5 `dependsOn`
need Q75 mode+scope). Dominant blockers: `write`/`edit` verbs (v1 read-only, 44 manifests),
language/runtime/launch planes (absent), viewer entrypoints → separate 13C contributions (16),
detect-only variants (15), mixed single+namespace `sourceKinds` (14), 22 catalog-only unavailable
variants → data-only `FormatDefinition` (30 §2). Every variant needs an `executionProfile` decision
(R-A1/R-A2). Operation-id renames: `image.compressed.read → image.compressed-read` (7) and
`sc2-*.<verb>` → `org.modkitx/sc2-*.<verb>`. This is input for the migration converter, not a
migration; MK2 stays untouched (BRIEF-12 §3).

**Acceptance for the subject-open slice (met by `ad6f0cc` + `f510b3b`):** one `openSubject` entry
and no `byExtension` path; Electron main composed with real inputs and a non-empty inventory;
renderer bundle free of codec code; E2E on PNG/JSON/UVM/unknown showing explain, ticket,
full-authority diagnostic (trusted-node), validated descriptor, plan from `resolvePresentationPlan`,
stage switch without session recreation; JSON proves nested `json-syntax` provider activation under
a child grant (`assertNotWider`); a `worker-brokered`-only contribution on a `node` target is
`unresolved` and surfaced (fallback declared, not silent); policy lock replay stable under shuffle;
detection reads ≤ `probe.maxBytes`.

**Owner questions filed as text (to move to MK3/11 on the owner's word):** (1) bundled `common`
before SB‑1 — `trusted-node` variant with diagnostic (24 §6.1 п.4) confirmed?; (2) owner of
`ArtifactSource`: move to `vfs` (27 §0.1) or amend §0.1/§5.9; (3) 27 §0.7 — record the text-data
split by dependency closure and the location of `plain-text` (BRIEF‑13A §13 says
`extensions/common/plain-text`); (4) 23 §8/§11 — `ContractOffer.offerId/facet`, position of
`contractSelectionKey`, `unsupported-kind`; (5) MK2 strategy — domain-interface adapters as a
«real boundary» (decision 54) or per-codec rewrite to the `Codec` ABI.

### Design notes (Fable, 2026-08-17): `worker-brokered` adapter and VFS contracts — not implemented

Sequencing agreed with Sol: nothing below starts before the subject-open slice is stable; the
adapter's only consumer is the host `openSubject` port, so it cannot be designed against a path that
does not exist yet. These notes fix the interfaces so the later slice does not reopen the
architecture; they add no code.

**W1 — what the worker adapter is (24 §6.1 SB‑1).** A new _available_ execution profile behind the
same activation gate: after ticket/target/grant/entrypoint checks pass, the host does not
`import()` the module in-process but posts `{load: artifactRoot, entrypoint, contributionId,
variantId}` to a fresh worker (Node `worker_threads` for CLI/server/Electron main; Web `Worker` for
PWA/webview). One protocol over `MessagePort` in both realms; the transport is the only difference.
Honest promise (24 §6 row «Node worker»): crash/cancellation isolation, brokered I/O through passed
handles, **no** protection from ambient `node:*`/Web APIs inside the worker — SB‑2 territory. Every
activation still emits an honest diagnostic naming that boundary.

**W2 — object model over the boundary.** The runtime ABI is capability-shaped (`Codec` →
`AssetSession` → `Lease<DataSource>` → methods), so the adapter is a _handle table_, not a
serializer: every object the worker returns that has methods becomes `{handle: id}`; the host builds
a proxy implementing the same TypeScript interface (`AssetSession`, `TextDataSource`,
`ByteRangeSource`, `RasterImageSource`, …); each method call is `{call, id, handle, method, args}`;
`Lease.release()` and `dispose()` map to `{release, handle}` and drop the entry on both sides. Values
crossing: JSON-safe data, `bigint` (structured-clone-safe), `Uint8Array` (transferred by buffer, never
copied twice), `AsyncIterable` → pull protocol (`{next, iterator}` / `{done}`), `events()` → push
messages, `Progress` → push, `AbortSignal` → `{cancel, id}` (worker checks `throwIfAborted`),
`ModkitError` → `toJSON()` + rehydration on the host (`code`/`context`/`retryability` preserved;
`OperationCancelledError` stays a cancellation). Budgets: `ResourceBudget` travels with `open`;
`deadlineMs` is enforced twice — inside the worker (existing checks) and by the host `terminate()` on
overrun/hang, which is the actual SB‑1 gain.

**W3 — bytes are brokered back to the host, not read ambiently.** The worker never receives a
path or `RandomAccessSource`; its `ArtifactByteSource.read/stream` is an RPC stub whose callbacks
are answered by the host under the activation grant (`sourceScope`/`filesystem` scopes,
`PermissionGrant` narrowing already implemented). That is exactly SB‑0 item 3 («broker checks in
real I/O providers») and it makes source access broker-enforced (level 3) even before SB‑2; a
worker-side read cache/prefetch keeps probe/inspect cheap (chunked transfers, bounded by
`probe.maxBytes` / `ResourceBudget`). Same for nested providers (`ContractResolverPort` inside the
worker → resolve/activate on the host → child grant `assertNotWider` → provider proxied into the
worker, or co-located when both variants target the same worker).

**W4 — realms and target selection (R‑A2).** The host decides where codecs run by choosing the
target it resolves for: `node` → `trusted-node` variants in-process; `node-worker`/`browser-worker`
→ portable variants through the adapter. In Electron the codec workers live in **main**; the
renderer keeps receiving only leases through the preload broker (two hops, renderer ↔ main ↔
worker), which is what keeps codecs out of the renderer realm without a policy exception. A
`browser-worker` inside the renderer is possible by manifest but a policy choice, not a default.

**W5 — gates the step must ship with (24 §6.1 rule 2).** Fixtures: crash in `open()` → structured
failure + released leases + host alive; hang → `deadlineMs` terminate; cancellation mid-page →
`OperationCancelledError` on the host; byte reads outside `sourceScope` → denied by the host broker
(not by the worker); no `node:*` in browser-worker bundles (existing browser-safety gate reused);
`worker-brokered` selected only when the adapter is present, else `unresolved` (never in-process,
24 §6.1 rule 1). Owner doc: a new row is _not_ needed — the §6 table already carries the honest
worker line; SB‑1 acceptance fixtures land in 24 §16.

**V1 — VFS contracts (13 §3) sized for X3.** One byte contract (bigint offsets, `read`/`stream`,
owner `vfs`, `sdk` re-exports; `RandomAccessSource` retired or kept as the checked bridge R‑A4).
Service contracts, resolved like any provider (`common.vfs/*` are `service-provider-contribution`
offers, scheme/topology as non-secret facets so the facet matcher already selects by scheme):

- `common.vfs/mount@1` — `mount(request: {address: StructuredAddress, credentials?: CredentialGrantRef,
options?}, ctx) → Lease<VfsMount>`; `VfsMount { id, revision: RevisionId, access:
ReadonlySet<SourceAccess>, stat(path), list(path, page), open(path) → Lease<ArtifactSource>,
watch?(path, sink), beginWrite?(opts) → VfsWriteTransaction, dispose() }` — 13 §3 verbatim, plus
  `RevisionId` from `sdk/subjects` so mounts feed revision vectors directly.
- `common.vfs/container@1` — `openContainer(source: ArtifactByteSource, ctx) → Lease<AssetNamespace>`:
  a container codec (zip today, MPQ/CASC later) publishes this beside its `codec-contribution` in the
  same package; the host input planner uses it to turn an archive into a `namespace` origin, which is
  what makes «archive entry as subject» and directory-shaped MK2 formats (SC2Map, CASC roots) work
  through the existing `ArtifactNamespaceSource.openNamespace()`.
- Host owns (13 §3): normalized virtual paths + traversal protection, mount table/routing, overlays,
  cache/credential brokers; credentials only as `CredentialGrantRef` handles (24 §3.1/§12), never
  in URIs, locks, cache keys or diagnostics.

**V2 — first implementations and their proofs.** Local directory mount (host/node + browser
directory handle), memory, zip container (from the existing archives extension), OPFS/HTTP-range
adapters re-homed onto the one byte contract. Gates: read outside grant refused _by the provider_;
archive opened as a namespace without materializing the whole file; mount revision changes flip
open sessions to `stale-revision`; a Git/GitHub/CASC provider can be added as an extension without
touching `core/sdk/vfs/host` (13 §12).

---

## Integrated codec, UI and application verification (2026-08-17)

- Text codecs are installable by dependency closure: JSON/JSONC and CSV/TSV share only their syntax
  families; INI, XML, YAML and TOML remain independent. Documents, archives, image, audio, video,
  vector and model providers are separate extension packages, and their indexes do not eagerly
  import sibling implementations.
- The format-neutral explorer always has a bounded view: valid NUL-free UTF-8 offers Text and Hex,
  arbitrary bytes offer Hex. Tabs preserve mounted preview leases while hidden, split groups target
  subsequent opens independently, and view selection never imports another codec.
- Settings use one canonical JSON-safe model across hosts. Electron stores it under `userData`
  through bounded preload IPC, serializes overlapping writes per profile, and commits with an atomic
  temporary-file rename. The renderer keeps Node disabled and all file access inside granted roots.
- The final integrated `CI=true; pnpm check` passed: deterministic 40-entry bundle, universal-data
  budgets, zero-warning lint/format gates, 59 test files / 445 tests, 14 schemas, 16 UI manifests,
  190 tokens, 29 facility IDs, 16 application/realm cases and a clean 178-file legacy scan.
- The authoritative handoff is
  `REPORT_A0_A8_CODECS_UI_APPS_COMPLETION_2026-08-17.md`. It records explicit non-claims for owner
  promotion, UV wire freeze, heavy optional providers, multi-file companion resolution and final
  installer/process-launch E2E.

---

## Assets Capabilities media layer and codec boundaries (2026-08-16)

- The standard data-source registry now owns five presentation-neutral media contracts:
  raster-image, vector-scene, audio-media, video-media and model-scene. They are bounded/lazy and
  browser-neutral; viewers no longer infer a format from raw bytes.
- Native codecs remain authoritative for parsing. UVG/UVA/UVV/UVM are interchange/cache targets,
  not mandatory eager copies on every open. This preserves native source bytes, provenance and
  round-trip evidence while still allowing a converter provider to materialize a UV asset.
- The extension split follows dependency closures, not filename count: archives, images, audio,
  video, vector, models and common documents are separate packages. Text syntax is split further
  into JSON/JSONC, CSV/TSV, INI, XML, YAML and TOML install units so one parser dependency never
  arrives with an unrelated format. Zero-dependency siblings may share one family package, but each
  codec has its own entrypoint. A dependency-heavy decoder/renderer must be a separate provider
  extension/package rather than entering a family index or `@modkitx-x3/ui`.
- PNG/JPEG publish raster sources; PNG additionally exposes a bounded lazy RGBA8 region decoder for
  supported 8-bit non-interlaced images. MP3/Ogg publish audio sources; MP4/WebM publish video
  sources. SVG publishes only the rejected-on-active-content `uvg.secure-static.v1` profile. OBJ
  publishes decoded triangle geometry; glTF publishes a metadata-only scene until its artifact-
  bound external buffers are resolved.
- UI image, audio, video, vector and model stages are independent public entrypoints. The root UI
  export may aggregate declarations, but activation imports only the selected contribution
  entrypoint. The lightweight viewers use browser decoders/2D rendering; WebGL/Three.js, FFmpeg,
  Basis/KTX2 and native codecs remain optional providers.
- `StandardTraitParameterMap` gives media traits typed parameter profiles while preserving
  `JsonValue` fallback for standard traits that do not yet have a specialized profile.

Open owner/spec work remains explicit: UVT/UVA/UVV/UVG wire drafts are not frozen; glTF external
buffer/image companion resolution belongs to the host artifact planner; full JPEG/MP3/Ogg/video
decode and GPU model rendering require separately selected providers. None of those gaps merge the
reference codec packages or weaken the source contracts.

---

## A‑2…A‑8 implementation handoff (2026-08-15)

- A‑2 closes inventory → contract-owned projection → resolution → artifact-bound activation,
  including deterministic lock replay, service facets and owner-atomic definition inventory.
- A‑3 provides descriptor assembly, read-only asset/operation sessions, all rejection states,
  stale-revision handling, idempotent disposal and the catalog-only v2→v1 adapter.
- A‑4 provides authoring builders/profiles, target smoke evidence, explain output and the
  four-concept codec scaffold; A‑5 carries the eight-family schema stress gate.
- A‑6 implements bounded byte/text/table data sources and deterministic presentation resolution,
  validation, singleton/fallback behavior and session-preserving stage changes.
- A‑7 is the external `common/plain-text` vertical slice: bounded structural detection, stable
  subject identity, read-only sessions, text/byte sources and platform-viewer routing without
  format strings. Its public index does not import executable implementation before activation.
- A‑8 installs packed platform and extension artifacts in clean directories. The host-free
  `./direct` surface runs without `@modkitx-x3/host`; the `./runtime` boundary fails closed when
  host is absent and loads when the packed host closure is installed.
- Successful A‑8 is a handoff, not promotion. Package names remain `@modkitx-x3/*`, MK2 remains
  unchanged, and 13B/13C/13D remain separately owned implementation tracks.

---

## A‑1 implementation handoff (2026-08-15)

- Opus verdict: **ACCEPT A‑1 with one P1**. The P1 is closed: the published core
  `sourceSpanSchema` now has a real `json-schema-to-ts` exact-union drift assertion. The separate
  data-source schema name is intentionally a compatibility alias of the published contract-
  definition data-source arm, not a thirteenth SDK artifact.
- Production core/SDK schema and ABI surfaces from BRIEF‑13A A‑1 are implemented, emitted and
  exercised by compile, runtime, adversarial, bundle and packed-consumer gates.
- `TraitId`/`TraitInstance` are the v2 names; no `Capability*` compatibility re-export is added.
- Producer trait declarations use exact definition versions and explicit representation/presence;
  consumers use ranges. Fidelity stays in observed/conformance evidence, not authored claims.
- Descriptor v2 carries portable single/bundle/namespace/derived origin, exact revisions and
  resolved/missing/ambiguous companion requirement state.
- Multiple service offers retain `offerId` and an optional non-secret contract selection key at
  activation; raw facets do not cross into activation tickets or portable policy locks.
- This is an implementation handoff, not self-acceptance. A‑2 inventory→fact→offer projection,
  facet matcher behavior, A‑3 sessions, A‑5 format stress and A‑6 presentation runtime remain open.

## Owner disposition and A-0 continuation (2026-08-14)

- Owner disposition after S4: **REVISE / CONTINUE**, not adopt or archive.
- S0–S4 implementation and packed-artifact evidence remain the proof baseline.
- A-0…A-8 from `modkitx/docs/tasks-active/platform-architecture/BRIEF_13A_mk3_extension_reference_spec.md`
  are next; A-0 is governance/status only and A-1 is the next implementation slice.
- Lab packages remain `@modkitx-x3/*`; promotion into `@modkitx/*` requires successful A-8 and a
  separate owner decision. MK2 remains unchanged.
- The BRIEF-13A/13B/13D compile fixtures prove type-level expressiveness. They do not prove a
  production SDK, host, data-source, viewer or editing runtime.

---

## Benchmark policy simplified (2026-08-14)

The calibration experiment below is retained as history, not as the current acceptance path.
The owner removed local probes, normalization and mutable baselines after they became more complex
than the performance question they were meant to answer.

- `pnpm check` is the mandatory functional, packaging and boundary gate.
- `pnpm bench` reports `core-import`, `closure-import` and `cli-validate-net` and always exits 0.
- `pnpm bench:gate` applies the same three absolute budgets only on a fixed CI runner or dedicated
  reference machine; a noisy scenario is `INCONCLUSIVE` (exit 2), not a pass.
- Until such a runner exists, performance numbers are observations and do not block adoption.
- The single-file production bundles remain: they are a packaging optimization independently
  justified by smaller public entry graphs, deterministic output and the external tarball proof.

Current verification: `pnpm check` passes 106/106 tests. A local informational run measured
core 7.78 ms, closure 36.34 ms and CLI validate net 316.62 ms; only the CLI observation exceeded
its 250 ms target, and it did not gate the run.

---

## Bundling pass + window (2026-08-14, 00:55–01:08) — no verdict, blocked by my own rule

Bounded bundling pass выполнен по авторизации владельца: каждый published entry
`core`/`sdk`/`vfs`/`host` — один детерминированный ESM-файл (esbuild над выходом `tsc`),
CLI — self-contained application bundle, `testkit` не бандлится; TS-исходники остались
модульными, межпакетные и внешние импорты остались external (иначе продублировалось бы
состояние модулей соседа — в `host` это security-WeakSet'ы), `exports` и `.d.ts` не тронуты.
110 тестов, внешний tarball-proof и browser-safety зелёные; две сборки побайтово идентичны
(гейт — тест, а не самоперезаписываемый файл хешей). Production-замыкание примера 1.44 → 1.36 MB.

**Окно вердикта не дало.** Все три прогона (включая попытку записать baseline) —
`INCONCLUSIVE`: `probe9` показал ×0.65–0.67 от старого baseline.

|                        | probe1 | probe9        | core (гейт 15) | closure (50) | CLI net (250) |
| ---------------------- | ------ | ------------- | -------------- | ------------ | ------------- |
| baseline до бандлинга  | 1.56   | 21.84         | 18.80          | 68.82        | 315.55        |
| 01:05 попытка baseline | 1.72   | 14.17 (×0.65) | 9.14           | 41.53        | 311.69        |
| 01:06 прогон 1         | 1.81   | 14.53 (×0.67) | 8.95           | 42.68        | 337.47        |
| 01:07 прогон 2         | 1.70   | 14.54 (×0.67) | 9.02           | 43.45        | 339.93        |

**Блокировал дефект моей логики (L19).** `--update` проверяет дрейф probe против **старого**
baseline, хотя смысл `--update` — заменить точку отсчёта. Сравнивать с тем, что собираешься
переписать, логически неверно, и это создаёт тупик: после любого изменения, которое меняет
характеристики (здесь — бандлинг), новый baseline записать невозможно. Предложение владельцу:
дрейф probe против старого baseline **не блокирует `--update`** (только предупреждение),
проверка шума остаётся; для зачётных прогонов правило не меняется. **Не применяю сам** —
это правка измерителя после нерезультативной сессии.

**Наблюдения, не вердикт** (сессии невалидны по собственному правилу):

- сырые: `core` 18.80 → 9.0, `closure` 68.82 → 42.7;
- `probe9` упал 21.84 → 14.5 при неизменных фикстурах. Вероятная причина — не машина, а сами
  фикстуры: baseline снимался вскоре после их создания (первое чтение, скан антивируса), а
  теперь они прогреты. Если так, **нормализация в этой сессии вводит в заблуждение**
  (normalized `closure` 64–65 противоречит структурному эффекту бандлинга). Ограничение
  метода: калибровочная фикстура тоже имеет состояние кэша, и его надо учитывать при первом
  baseline после свежего checkout;
- **`cli-validate-net` бандлингом не улучшился** и превышает гейт во всех трёх прогонах
  (312–340 при 250), независимо от калибровки. Правдоподобная причина — `modkit validate`
  подтягивает ajv (CJS-граф в сотни файлов) при первой валидации; это первый кандидат на
  разбор, но пас bounded — без решения владельца не начинаю.

---

## Window on the corrected meter (2026-08-14, 00:12–00:25) — cause finally attributed

Протокол владельца исполнен на перестроенном харнессе: 10 минут простоя → baseline новой
версии → два зачётных прогона; агент во время окна не выполнял операций.

|                                                  | probe1                    | probe9 (9 модулей, профиль `core/dist`) | core (9 модулей)    | closure (~35 модулей) | CLI net          |
| ------------------------------------------------ | ------------------------- | --------------------------------------- | ------------------- | --------------------- | ---------------- |
| baseline 00:22                                   | 1.56                      | 21.84                                   | 18.80               | 68.82                 | 315.55           |
| **run 1 00:23** (probes ×0.99 / ×1.02 — валиден) | 1.54                      | 22.31                                   | **18.18** (гейт 15) | **66.88** (50)        | **327.57** (250) |
| run 2 00:24                                      | 0.98 (spread 78 %, ×0.63) | 22.56                                   | 18.34               | 68.23                 | 309.05           |

**Итог: один валидный прогон, и он провален → REVISE** по правилу владельца. Run 2 —
`INCONCLUSIVE` (probe1 зашумел), в зачёт двух прогонов не идёт. Лимиты не менялись.

### Атрибуция причины (то, ради чего чинили измеритель)

Контрольное сравнение, впервые корректное — probe и measurand измерены одним кодом в одной
сессии:

- `core` (9 модулей) — **18.2 ms**;
- `probe9`, синтетический граф из 9 модулей того же размерного профиля, без единой строки
  логики Modkit — **22.3 ms**.

`core` **дешевле** эталонной пустышки такой же формы. Значит код `core` не является причиной:
стоимость создаёт сам модульный граф. Численно: probe1 1.5 ms, probe9 22 ms → ≈2.3 ms на
модуль; `closure` 67 ms при ~35 модулях ≈ 1.9 ms на модуль — сходится.

Следствие, которое теперь доказано, а не предположено: **гейт 15 ms ниже стоимости любого
девятимодульного пакета на этой машине**, включая пустой. Это несовместимость бюджета с
физической раскладкой файлов, а не дефект структуры `core`.

Условие владельца («если после исправления измерителя сопоставимая сессия действительно
провалится — предпочтительное исправление single-file production dist при модульном
TypeScript source») **выполнено**: сопоставимая сессия провалилась. Авторизация на бандлинг
не выдавалась заранее, поэтому лаборатория останавливается и запрашивает её отдельно.

### Известное ограничение нового измерителя (не правлю после результата)

`probe1` измеряет ~1.5 ms, и на этом масштабе относительный разброс нестабилен: в run 2 он
дал 78 % и ×0.63, из-за чего вся сессия ушла в `INCONCLUSIVE`, хотя `probe9` был ×1.03.
Предложение **до следующего окна** (решает владелец): либо применить к probes то же
scale-aware правило, что и к сценариям, либо оставить `probe1` информационным, а гейтить
калибровку по `probe9` — он один в один повторяет форму measurand. Сейчас не трогаю: менять
калибровку после красного результата — подгонка.

---

## Idle-window result (2026-08-13, 19:27–19:43) — REVISE confirmed by a valid run

Окно исполнено по протоколу владельца: 10 минут простоя, ровно два последовательных
`pnpm bench:gate`, агент во время окна не выполнял никаких операций.

| Прогон    | machine floor                | core (гейт 15)      | closure (50) | CLI net (250) | Итог   |
| --------- | ---------------------------- | ------------------- | ------------ | ------------- | ------ |
| 1 (19:41) | 3.24 ms (×1.44 baseline)     | 20.07 (spread 13 %) | 79.07 (13 %) | 384.79 (7 %)  | FAILED |
| 2 (19:43) | **2.19 ms (×0.97 baseline)** | 20.12 (15 %)        | 74.36 (6 %)  | 353.51 (2 %)  | FAILED |

Прогон 2 прошёл все проверки **той версии харнесса** и провалил гейты. Это **формальный gate
failure; причина не атрибутирована** (правка по указанию владельца 2026-08-13; моя прежняя
формулировка «это уже не среда, а факт о коде» была переоценкой). Основание правки: floor ×0.97
ничего не доказывал, потому что сам зонд был невалиден — он импортировал файл, который сам
только что создал, тогда как `core-import` читает существующий `dist` в отдельных новых
процессах. Разные нагрузки, поэтому равенство floor не означает равенства состояния файлового
пути. Сравнение «1 модуль против 9» поддерживает гипотезу о цене модульного графа, но **не**
доказывает дефект структуры `core`.

Статус REVISE сохраняется, но его причина — **незакрытая достоверность бенчмарка**, а не
доказанная медлительность ядра. Лимиты не трогались, прогоны не повторялись.

### Разбор (следующий шаг по правилу владельца)

Измерено сразу после окна, на той же машине:

| Что импортируется                                    | Стоимость                                   |
| ---------------------------------------------------- | ------------------------------------------- |
| floor-зонд: файл, который зонд сам только что создал | 2.19 ms                                     |
| один **существующий** модуль `core/dist/ids.js`      | 6.89 ms                                     |
| весь barrel `core` (9 модулей)                       | 18.5–20.2 ms (5 прогонов подряд, стабильно) |

Отсюда два вывода.

1. **Калибровочный зонд был недостаточен (L18).** Он создавал файл и тут же его импортировал —
   страница в кэше, антивирус отработал на записи. Реальные сценарии читают dist, записанный
   часами раньше, в отдельных новых процессах. Поэтому floor мог показывать ×0.97 «машина та
   же», пока путь чтения существующих файлов подорожал.
2. **Гипотеза о цене модульного графа** (один модуль ~6.9 ms против девяти ~19.5 ms)
   поддержана, но **не доказана**: пока измеритель невалиден, любая атрибуция преждевременна.

**Исправлено по указанию владельца (2026-08-13, `modkitX3`@5396bef):** зонд заменён на две
заранее закоммиченные фикстуры — `probe1` (один существующий модуль) и `probe9` (существующий
граф из девяти модулей, суммарно 16.9 KB против 14.8 KB у `core/dist`), обе измеряются **тем
же кодом**, что и measurand: новый процесс на sample, тот же warm-up и N. Сессия объявляется
`INCONCLUSIVE`, если любой probe шумит или отклонился от baseline более чем в 1.5 раза в любую
сторону, и калибровка имеет приоритет над вердиктом pass/fail. `cli-validate-net` переведён на
чередование bare/CLI с распределением парных разностей (раньше сначала измерялись все bare,
потом все CLI — смещение при изменении нагрузки). Бюджеты 15/50/250/100/1 не тронуты.

**Сверх поручения, только как информация и без гейта:** `normalizedP50` — сырое значение,
пересчитанное на дрейф `probe9`. Это отделяет «машина сегодня медленнее» от «код стал
медленнее» с одного взгляда, но авторитетом остаётся сырой p50, пока владелец не решит иначе.

---

## G13 execution result (2026-08-13) — REVISE stands, budgets not closed

Прогон по принятому владельцем протоколу (два последовательных тихих прогона на
reference-машине) **не дал двух зелёных сессий**. Фактические результаты, все на одном и том
же коде и одной машине, различаются вдвое в зависимости от того, работает ли на ней что-то
ещё:

| Состояние машины                | floor        | core-import (гейт 15) | closure (50) | CLI net (250) | Вердикт           |
| ------------------------------- | ------------ | --------------------- | ------------ | ------------- | ----------------- |
| Простой после отстоя            | 1.82–1.86 ms | 7.55–7.84             | 31.5–39.0    | 175–203       | всё в бюджете     |
| Идёт работа (сборки/линт/тесты) | не мерился   | 15.6–44.3             | 60.5–161.7   | 299–668       | стабильный провал |

По правилу владельца «один стабильный провал → REVISE, лимиты повторно не подгонять»:
**статус остаётся REVISE**, X3-S0 — `in-progress`. Числа не переписывались.

Существенное: это **не** факт о коде, а факт об измерительной среде. Ноутбук, на котором
идёт разработка, не может служить тихой reference-машиной, пока на нём идёт разработка;
принятые гейты (15 / 250 ms) лежат ровно на границе его рабочего состояния. Решение, где
мерить (выделенный тихий прогон/CI-раннер), остаётся за владельцем — лаборатория его не
принимает за него.

Инфраструктура к этому готова: baseline записан **вместе с machine floor** (2.25 ms), и
сессия, где floor уехал более чем в 1.5 раза, помечается `INCONCLUSIVE` независимо от
разброса — равномерно загруженная машина даёт медленные замеры с узким разбросом, чего
эвристика разброса в принципе не видит.

**Честная правка предыдущего заявления.** В коммите `b1b68a8` я написал, что шумная сессия
теперь `INCONCLUSIVE`, а не `passed`. Это было неверно: одна из трёх текстовых замен молча не
совпала, массив `inconclusive` заполнялся, но вердиктом не читался — и сессия с NOISY-сценарием
всё ещё печатала `passed` (поймано на живом прогоне: closure-import, разброс 47 %, exit 0).
Причина — мой guard проверял только «файл изменился», что удовлетворяли две другие удачные
замены. Исправлено в `a6edadf` с проверкой каждой замены отдельно; **L17**: правка,
сгенерированная скриптом, должна верифицироваться по каждому паттерну, а не по факту
изменения файла.

---

## Owner decisions 2026-08-13 (G13 + package topology)

**G13 — бюджеты §6 стали platform-specific.** Владелец принял reference environment (Intel
Core Ultra 7 155U, Windows x64, Node 24.16.0) и p50-гейты: `core-import` < 15 ms,
`closure-import` < 50 ms, `cli-validate-net` < 250 ms, `inventory-100` < 100 ms,
`resolve+explain` < 1 ms. p95 записывается, но не блокирует; сессия с разбросом > 35 % не
является доказательством; закрытие требует двух последовательных тихих прогонов; на других
машинах — только регрессия относительно их baseline; прежние 5 ms / 150 ms остаются
оптимизационными целями вне DoD; бандлинг ради прохождения проверки не вводится. Решение
записано в BRIEF-12 §6 (владелец разрешил правку этого файла явно — вне обычного §8-скоупа
лаборатории). Харнесс печатает aspiration отдельной пометкой, чтобы прежние цели не потерялись.

**Package topology подтверждена.** `core`, `sdk`, `vfs`, `host` и dev-only `testkit`
остаются отдельными publication units: вместе они образуют ядро MK3 как систему, но
физически сливать их в один `packages/core` не следует (owner, 2026-08-13). Это совпадает с
каноном §6.1 и снимает вопрос на будущее — переоткрывать его без нового основания не нужно.

**L16** (из этого же прохода): «не-доказательство» и «успех» — разные исходы. Гейт, который
печатал `passed` на сессии, где все материальные сценарии помечены NOISY, позволял шумной
машине «закрыть» бюджет, который никто не измерил. Теперь такая сессия — `INCONCLUSIVE`
(exit 2) и не засчитывается в два последовательных прогона.

---

## Post-audit rework R1–R8 (2026-08-13) — security boundary rebuilt

The owner accepted Sol's audit and ordered **revise**. Every finding was reproduced by the
lab before being fixed (repro script run against the built packages, not taken on faith),
and re-run afterwards. Statuses on the board were rolled back first, before any code.

### What was actually broken (all reproduced)

| #   | Defect                                                                                                                                                                                                      | Reproduction                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1  | `activateContribution()` accepted a raw manifest and imported whatever `entrypoint` said — an absolute URL simply wins over the base                                                                        | `data:text/javascript,…` executed, `globalThis.__PWNED === true` |
| D2  | Malformed `expiresAt` passed the check (`Date.parse` → NaN → comparison false)                                                                                                                              | grant with `"not-a-date"` accepted                               |
| D3  | No runtime-target check at activation                                                                                                                                                                       | `browser-main`/`linux`/`arm64` variant activated on Windows-x64  |
| D4  | Owner matrix promised `PermissionGrant` scopes + `parent ∩ callee ∩ policy ∩ operation`; only a class list existed                                                                                          | code inspection                                                  |
| D5  | Policy lock kept input order when two entries shared a key                                                                                                                                                  | `serialize([a,b]) !== serialize([b,a])`                          |
| D6  | `range`/`license` accepted arbitrary text despite `core` owning a range parser                                                                                                                              | `range: "not a semver range"` → 0 diagnostics                    |
| D7  | Bench harness measured process spawning; baselines were noise                                                                                                                                               | 8.8→12.4 ms and 257→420 ms across sessions, no code change       |
| D8  | Raw control bytes in two `host` sources (git saw them as binary); dev-only `testkit` in the example's production closure; blanket `target-incompatible`; lint tolerated warnings; contradictory PORTED tail | byte scan + manifest read                                        |

### What the rework put in place

- **ActivationTicket** (branded, issued only from a `resolved` ResolutionResult) is now the
  only admission to activation. The gate re-verifies extension/contribution/contract/
  variant against the inventory manifest, so a manifest swapped after resolution, a
  foreign extension or a foreign target are refusals — not trust.
- **Entry-point containment** (`host/security/entrypoint.ts`): URL schemes, absolute
  POSIX/Windows/UNC paths, backslashes, `..` traversal and control characters are rejected
  syntactically _and_ by a resolved-URL containment proof, with the same rules mirrored in
  the schema. Two independent gates; the host never assumes the schema ran.
- **PermissionGrant** per 24 §3.1/§4 with filesystem/network/credential scopes and
  `narrowGrant()` implementing `parent ∩ callee request ∩ host policy ∩ operation`;
  `assertNotWider` makes the «child never widens» invariant testable. Validity is
  fail-closed: unparseable or past expiry denies.
- **Honest diagnostic**: `trusted-in-process` activations now carry
  `x3.host/full-process-authority` stating in words that this is an audit/policy boundary,
  not a sandbox (24 §5.1) — the earlier silence implied more than the code delivered.
- **Lock**: conflicting entries under one key are refused; ordering falls back to the full
  canonical entry, so byte-stability no longer depends on input order.
- **Schema**: SemVer-range pattern + a semantic re-check through the resolver's own parser.
- **Security negative suite** (22 cases) proves each refusal happens _before_ the import
  via a spy counter, including the exact `data:` bypass the audit demonstrated.
- **Bench harness** rebuilt (see the S4 section below for what this changed in the numbers).

### Second audit (2026-08-13) — R9: ticket provenance

The audit disproved a claim I made in this very file: «ActivationTicket … not
hand-constructible». The brand only stopped an object literal from type-checking; the
public `issueActivationTicket()` accepted anything _shaped_ like a `ResolutionResult`, so a
fabricated `{ state: 'resolved', … }` came back as a genuine ticket — and the issued ticket
stayed mutable. Reproduced before fixing: a ticket was issued for `org.evil/x` and its
`variantId` overwritten by plain assignment.

Closed three ways, because relying on one mechanism was exactly the problem:

1. `resolveProvider` registers every result it returns in a private `WeakSet`; the issuer
   refuses anything absent from it (`x3.host/foreign-resolution-result`).
2. The free issuer left the package surface. The public entry point is host-owned
   `resolveForActivation(request, offers, operation?)`, which resolves and issues in one
   step, so there is no API that takes an arbitrary result.
3. Issued tickets are frozen, and the gate checks **membership**, not shape — a spread copy
   `{ ...ticket, variantId: 'other' }` is a different object and is refused.

**L15**: identity-based capability objects (WeakSet membership) beat structural brands
whenever the object is a security token; a brand is a TypeScript convenience, not a
runtime check. Recorded because I got this wrong once already.

### Lab decisions added

- **L12**: only `trusted-in-process` is honoured; any other profile is
  `x3.host/unsupported-execution-profile`. Ladder steps SB-1+ arrive with their gates.
- **L13**: activation admission is a _ticket_, not a manifest. Public API shape:
  `issueActivationTicket(result, target)` → `activateContribution({ ticket, manifest, … })`.
- **L14**: a bench session whose interquartile spread exceeds 35% can neither gate nor
  become a baseline; the rule is scale-aware (a scenario 10× under budget is exempt).
- **G13** (owner question, non-blocking): §6's `import core < 5 ms` is unreachable on the
  reference machine without bundling — a single trivial ESM file costs ~1.9 ms cold here
  and `core` ships 9 modules. Options: accept an environment caveat, pick another
  reference machine, or allow a bundling step (which BRIEF §7 currently forbids).

---

## Slices S0.2–S4 executed (2026-08-13) — core proven, stop for adopt/revise/archive

All slices closed same day, each behind the full gate (`pnpm check`: build+typecheck with
drift gates, eslint, prettier, 70 vitest tests, emitted-schema check, legacy gate).
Commits: S0.2 `f9c5cf4`, S0.3 `b9daaea`+`d8cbe78`, S0.5 `da6d934`, S1 `c3bc38b`,
S2 `152a2c1`, S3 `d777da9`, S4 `d9a07b2`. S4b (`.uve` packer) NOT started — gated behind
the owner decision by BRIEF-12 §5.

New lab decisions / gaps found while building:

- **G11 (non-blocking, proposal-worthy):** MK3/23 §8's closed `UnresolvedReason` enum has
  no value for the explicitly required unsupported-kind rejection (23 §8 text + §15 use
  the term). Lab: `RejectedCandidate.reason` additionally allows `'unsupported-kind'`;
  suggested owner fix: add it to the enum in 23 §8.
- **G12 (observation):** 23 §9's stage order (permissions at stage 4, pin at stage 5)
  means a pinned-but-ungranted provider yields aggregate reason `pin-unsatisfied` while
  the `rejected` list carries its `permission-required` diagnostic — tests document this;
  no change proposed (structured diagnostics are complete).
- **L9:** envelope-derived offers project the contract version as `${major}.0.0`
  (contribution has no release version by design, 27 §0.5.1; ranges stay inside the
  major). Real minor/patch contract versions arrive with codec-v2 specs.
- **L10:** grant classes feed `RuntimeTarget.grantedPermissions` for resolution (23 §9
  stage 4) and the activation gate re-checks the same grant before the dynamic import —
  one grant, two enforcement points (SB-0 dispatch level).
- **L11:** the host supports only `trusted-in-process` in S0–S4; any other profile is a
  structured `x3.host/unsupported-execution-profile` refusal, never a downgrade
  (24 §6.1 rule 1).

Bench (recorded baselines, reference machine of C3; full closure = core+sdk+vfs+host):

| Scenario                  | p50     | §6 target | Verdict                                                                                                                             |
| ------------------------- | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| closure-import (4 pkg)    | 30.2 ms | < 50 ms   | **in budget**                                                                                                                       |
| inventory-100-synthetic   | 0.75 ms | < 100 ms  | **in budget**                                                                                                                       |
| resolve+explain /contract | 0.01 ms | < 1 ms    | **in budget**                                                                                                                       |
| core-import               | 8.8 ms  | < 5 ms    | over — machine floor: a single module file costs ~13 ms fresh (AV/FS per-file overhead), lazy-ajv already applied                   |
| cli-validate-net          | 257 ms  | < 150 ms  | over — same floor + spawn noise (p95 416 ms); gate = regression-only on this machine pending owner review of targets vs environment |

External example closure: node_modules **1.4 MB**, 5 tarballs, zero deps beyond the lab
packages + ajv. Full route proven from the example's own cwd, deny path included.

---

## Owner decisions Q75–Q77 accepted (2026-08-13) — X3-S0.3 unblocked

The owner (relaying Sol's recommendation) approved, verbatim scope:

- **Q75 / G9 — root extension dependencies**: normalized `ExtensionManifest` gets optional
  `dependsOn?: readonly ExtensionRequirement[]` with `{ extension: ExtensionId
(publisher-qualified); range?: string (SemVer, default '*'); mode: 'required' | 'default'
| 'suggested' | 'integrates'; scope: { kind: contribution|offer|operation|intent|variant|
profile|projection|slot; id: string } }` — **`scope` is mandatory** (tightened vs the lab
  proposal) and it is a separate `ExtensionRequirement` type, not 23 §8's contract-based
  one. In S0–S4 the field is only shape-validated and preserved; no install solver;
  `integrates` creates no install edge; `conflicts`/`replaces`/`provides` deferred to a
  future install schema.
- **Q76 — standalone `version`/`license`**: normalized manifest always carries both; the
  npm adapter takes them **only** from top-level `package.json`; standalone
  `modkit.extension.json` must carry its own; duplicates inside `#modkit` = packaging
  error.
- **Q77 — one wire enum** `ExecutionProfile = 'browser-sandbox' | 'worker-brokered' |
'process-brokered' | 'wasm-brokered' | 'trusted-in-process' | 'remote-provider'`; 24 §5
  names remain prose mapping. Remote/process/WASM execution not required in S0–S4.

Also ordered: prettier format-only fix + `prettier --check` in the `pnpm check` gate (done
with this entry); real legacy gate must scan a non-zero number of sources once S0.2 lands
(asserted in the gate regression suite from S0.2 on). Route: S0.2 → S0.3 → S0.4 → S0.5 →
S1 → S2 → S3 → S4, stop after S4 for adopt/revise/archive; new architectural gaps go to
the owner, but no extra permission is awaited between green sub-stages.

---

## X3-S0.0 corrective pass (2026-08-13, after the Sol audit)

The owner-relayed audit accepted the DoR as a draft, returned X3-S0.0 to in-progress and
ordered a corrective pass. Items below amend the DoR section that follows; where they
contradict it, this section wins.

### C1. Owner-input baseline made reproducible

The DoR was read against the `modkitx` **working tree**, not a commit: `BRIEF_12` is
untracked, and `MODKIT_ARCHITECTURE.md` + `MK3/README.md` carry uncommitted edits on top of
`643abefc`, so «modkitx@643abefc» alone was not reproducible (audit item 1). SHA-256 of the
exact files read (working tree, 2026-08-13; taken at the corrective pass — text unchanged
within this session):

| File                                                                                | sha256                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md (untracked) | `bbc00dcf36e47739bae9db348979994c8865bb97590e7b9ae7dbf71f8e942a6c` |
| architecture/MODKIT_ARCHITECTURE.md (modified vs 643abefc)                          | `902a6ece8e964677f81ca61a9e0de606b56d5f51d852c6f6ad4f9c93de8cb5e2` |
| architecture/ASSET_CAPABILITIES.md                                                  | `be3f11b17062dfbb3190546a0d5377581465164d40a0abb52d1625f5125c9164` |
| architecture/TARGET_ARCHITECTURE_OVERVIEW.md                                        | `6507de8c13c4d7fce179ee52d35b3cd0881cc50478de9efb2ec73357767fd92e` |
| MK3/README.md (modified vs 643abefc)                                                | `67133f365d9ddc9b2b85e2b122e2ac64e44646467ebfd289ce97b77bbf525643` |
| MK3/02-capabilities-and-contracts.md                                                | `b97fa113f0c70e2444b0e5c4d734593b6887ee5a00999a2b887f7cfb422f2c3f` |
| MK3/15-package-boundaries-and-extension-layout.md                                   | `295a9f9f9f4a1881c0ae75911b73707a561f2fe582b4713f98c6ebf30cb0988a` |
| MK3/23-contract-identity-schema-resolution-and-lock.md                              | `d8b18f9480286e318a414004ecce83cf9a126e9356ac312bede722ea725f88b3` |
| MK3/24-extension-security-execution-and-lifecycle.md                                | `a92034ece263dcbe8ceefb49ed6d43555b3f5c27b7a6e1bdc64dd3f9c815184b` |
| MK3/25-subject-identity-editing-transactions-and-cache.md                           | `58b6874311cfd008a57be53eb37b78b9412ae6854a5ec13a2d67edd5064a7a88` |
| MK3/27-final-target-tree-extension-manifest-and-format-catalog.md                   | `aed060645c36c79efff0db40c079564495226b19af94f14ab7b6e1193620a143` |
| tasks-active/platform-architecture/REPORT_6_…simplification.md                      | `61bd321da5f7b0bde56b73231be3c957bb29768e4fe22c50ffa4c495c30fdc77` |
| tasks-active/platform-architecture/REPORT_9_…optional_platform_core.md              | `5654e2ad0fdba2d346e401c00cc8bae5436acc0abbadf2029f268eb6166c4749` |

Recommendation to owner (lab cannot do it under §8): commit BRIEF-12 and the pending canon /
MK3-README edits in `modkitx` so future baselines are plain commit hashes.

### C2. Gap register additions (audit item 2) — G9/G10 + G5 escalation

| #      | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Blocking?                                                                                                                                                         | Resolution / status                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G9     | **Root extension dependencies**: canon §5.13 prose requires the extension manifest to carry «dependencies on other extensions» (and its dependency-semantics table covers codec/extension manifests), but the adopted minimal authored form (27 §0.2, decision 64) and the v2 appendix example (27 §5) define no such field; REPORT-6 §6's minimal example has none either. A strict S0 schema must either include the field's exact shape or knowingly reject manifests that carry it | **Yes — blocks X3-S0.3** (ExtensionManifest schema). S0.1/S0.2 unaffected                                                                                         | Proposal filed as **Q75** in `MK3/11-open-questions.md` (recommended: optional `dependsOn` of extension-coordinate Requirements reusing the one-Requirement mode/scope model; shape-only validation in S0–S4, no solving). Owner decides; the DoR's earlier «deferred past S4» wording in §2.1 below is superseded |
| G10    | **Two `executionProfile` vocabularies inside MK3/24**: §3's typed enum (`browser-sandbox`, `worker-brokered`, `process-brokered`, `wasm-brokered`, `trusted-in-process`) vs §5's profile catalog (`trusted-in-process`, `wasm-sandbox`, `worker-isolated`, `sandboxed-process`, `remote-provider`) — names differ, `remote-provider` missing from the enum                                                                                                                             | No for S0–S4 (lab S3 minimum uses `trusted-in-process`; REPORT-6 §6 fixtures also use `browser-sandbox`, both inside §3's enum, which is the shape 27 §6 imports) | Proposal filed as **Q77**: unify on §3's enum + `remote-provider`, §5 headings become prose descriptions mapped 1:1. X3 schemas use §3's enum verbatim until the owner answers                                                                                                                                     |
| G5→Q76 | Standalone container `version`/`license` ambiguity — escalated from a session-report note to a formal proposal per audit item 2                                                                                                                                                                                                                                                                                                                                                        | No                                                                                                                                                                | Proposal filed as **Q76** with the same recommended reading as G5 (standalone carries own required fields; `#modkit` block must not duplicate npm fields); fixtures test both directions                                                                                                                           |

### C3. Benchmark protocol fixed in S0.0 (audit item 3; supersedes L8)

BRIEF-12 §6 requires S0.0 to fix the protocol; deferring it to S0.5 was wrong — S0.5 now
only _implements_ the script against this protocol:

- **Reference environment (recorded 2026-08-13):** Intel Core Ultra 7 155U (12 phys /
  14 logical cores, laptop-class — AC power assumed for gate runs), 31.5 GB RAM, NVMe SSD
  (Phison 512 GB), Windows 11 Pro build 26200, Node v24.16.0, pnpm 11.8.0. Numbers are an
  **absolute target + this-machine baseline**, never cross-machine constants.
- **Warm-up:** ≥3 discarded runs per scenario (warm FS, JIT); FS-cold numbers are out of
  scope for the §6 gates.
- **Run counts:** N=100 measured runs for in-process micro scenarios (inventory, resolve,
  explain); N=20 for process-level scenarios (CLI validate); N=10 fresh processes for the
  import-cost scenario. Report **p50 and p95**; p50 gates, p95 is recorded.
- **Process-startup exclusion:** in-process scenarios time `performance.now()` around the
  operation only. CLI wall-clock scenarios also measure a bare `node -e ""` baseline (same
  N/warm-up) and report raw + net (raw − baseline p50); §6 budgets apply to **net**.
  Import budget: fresh process, `performance.now()` around dynamic `import()` of the built
  entry — startup excluded by construction.
- **Timed window:** synthetic corpus/fixture generation is excluded from every window.
- **Gate policy (per §6):** the gate fails on (a) proven target excess — p50 over the §6
  target across a full N-run session, confirmed by one repeat session; or (b) baseline
  regression — p50 worse than the recorded baseline by >20 % across two consecutive full
  sessions. A single noisy run never gates. Baselines live in the repo next to the bench
  script and change only with an explanatory commit.

### C4. Legacy gate hardened + committed regression suite (audit item 4)

Fixes to `scripts/check-legacy.mjs`: (1) `package.json` content is no longer skipped after
the name check — `exports` keys/values are checked (`exports-path` rule) and the whole
manifest text runs through the generic rules; (2) `capability`/`capabilities` object keys
are caught **quoted or unquoted** (`capability-key` rule — schemas will live as TS consts);
(3) the `@modkit-legacy-input-fixture` marker is honored only under a `fixtures/` path —
outside it the marker itself is a violation (`marker-outside-fixtures`) and the file is
still scanned; (4) `--root` argument + `fileURLToPath` for testability/robustness.
Committed regression suite: `scripts/test/check-legacy.test.ts` over committed fixture
trees `scripts/test/fixtures/legacy-gate/{violations,clean}` — 9 rule classes asserted
positive, marker-abuse asserted still-scanned, clean tree asserted scanned-and-green,
`fixtures/legacy/` + marked-fixture exclusions asserted, real repo asserted green. The
suite runs in `pnpm test` (vitest) and `pnpm check`.

### C5. Toolchain installed and pinned (audit item 6)

`pnpm install` executed; `pnpm-lock.yaml` committed; justifications in `PORTED.md`
(typescript 5.9.3, vitest 2.1.9, eslint 9.39.5 + typescript-eslint 8.67.0, prettier 3.9.6,
@types/node 22.20.1 — dev-only). esbuild's postinstall stays denied
(`pnpm-workspace.yaml#allowBuilds`), its platform binary package suffices. Non-empty
verification chain green: `pnpm typecheck` (tooling tsconfig over gate tests + vitest
config), `pnpm lint`, `pnpm test` (5 real tests), `pnpm check:legacy`. The root `tsc -b`
returns to the `typecheck` script when X3-S0.2 adds the first composite package (empty
solution is TS18002).

### C6. Accounting corrections (audit items 3/5)

- Board: X3-S0.0 `assignee` removed (allowed only on an active `plan[]` step); corrective
  pass added as a plan step; X3-S0.1 renamed to its true remainder («toolchain install/pin
  - non-empty verification»), executed in this pass.
- The previous `modkitx` commit `68183cb7` swept the planning session's uncommitted edits
  of the same two files, including register rows (R3/R5, `0/45`) unrelated to X3 —
  acknowledged as procedural overreach; the content is factually correct (re-measured), so
  it is retained rather than reverted, and this note plus the session report record it.

---

## X3-S0.0 — Contract baseline / Definition of Ready (2026-08-13)

Verified against live files of `modkitx@643abefc` (branch `r1-convergence`, working tree of
2026-08-13; note: `engine-board.js`/`MASTER_TASK_REGISTER.md` X3 entries existed uncommitted).
Re-measured snapshot: 45 × legacy `extensions/*/*/extension.json`, 0 × `package.json#modkit`,
0 × `modkit.extension.json`, 32 workspace packages — matches BRIEF-12 §0 direction.

Abbreviations: **canon** = `docs/architecture/MODKIT_ARCHITECTURE.md`; **AC** =
`docs/architecture/ASSET_CAPABILITIES.md`; **23/24/25/27/02/15/30** = `docs/MK3/<n>-*.md`;
**R6/R9** = `docs/tasks-active/platform-architecture/REPORT_{6,9}_*.md`.

### 1. Owner matrix — public types of slices S0–S4

Ownership classes: **canon** (adopted canonical), **AC v1** (normative v1 wire contract),
**MK3 owner** (detailed/normative-candidate owner document), **lab detail** (shape delegated
to the lab within an owner's boundary; promotion needs the owner's gate), **deferred** (not
in S0–S4).

> **Amendment 2026-08-13 (post-audit).** Row 23 promised the full `PermissionGrant` with
> scopes and the `parent ∩ callee ∩ policy ∩ operation` intersection for S3, while the
> first implementation shipped only a permission-class list — the audit was right to call
> that a contract gap. It is now closed (scopes, `narrowGrant`, `assertNotWider`, plus the
> `trusted-in-process` full-authority diagnostic), so the row reads true again. Recorded
> here instead of being silently edited, because the promise/delivery mismatch is itself
> the finding.

> **Amendment 2026-08-14 (owner REVISE / CONTINUE).** Rows 18 and 29 remain accurate history for
> S0–S4, but their forward disposition changed. BRIEF-13A is the accepted basis for the read-only
> descriptor/session/data-source and codec-v2 work in A-1…A-8. No row below claims that the
> documentation compile fixtures are runtime implementation.

| #   | Public type (X3 slice)                                                                                                                                                                  | Owner class                                      | Exact source                                                                                                                                                                                                           | Notes                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ExtensionManifest` (normalized envelope) — S0                                                                                                                                          | canon (boundary) + MK3 owner (shape)             | canon §5.13 («tooling normalizes either container into one `ExtensionManifest` contract»); 27 §0.2–0.3; MK3/README decision 64                                                                                         | Executable schema is the S0 proof (R9 §19 item 3)                                                                                 |
| 2   | Authored containers `package.json#modkit` / `modkit.extension.json`, one-container rule                                                                                                 | canon                                            | canon §5.8 (discovery/identity paragraph) + §5.13; adopted 2026-08-12                                                                                                                                                  | Both at once = packaging error                                                                                                    |
| 3   | `contributionManifests` discovery pattern + glob rules                                                                                                                                  | canon (pattern) + MK3 owner (glob rules)         | canon §5.13; 27 §0.3, §5.1                                                                                                                                                                                             | Hosts never glob category dirs                                                                                                    |
| 4   | `ContributionManifestV1` envelope — S0                                                                                                                                                  | MK3 owner (candidate v2)                         | 27 §6, corrected by 27 §0.5 (no per-contribution version; `status` optional display hint; security authored only in child manifests)                                                                                   | Promotion map: candidate until S3c/D1; X3 is its proof vehicle                                                                    |
| 5   | `RuntimeVariantDeclaration` (variantId, entrypoint, target, executionProfile, requestedPermissionClasses)                                                                               | MK3 owner                                        | 24 §3 (27 §6 explicitly imports it; no second runtime-variant form)                                                                                                                                                    |                                                                                                                                   |
| 6   | `ScopedContractRequirement` + `required/default/suggested/integrates` semantics                                                                                                         | MK3 owner                                        | 23 §8 (27 §6 explicitly defers)                                                                                                                                                                                        |                                                                                                                                   |
| 7   | Logical ID grammar (contract/provider/extension/error qualified form; version as separate field)                                                                                        | MK3 owner                                        | 23 §3 (ABNF + role table), §3.1 (contribution id is qualified, never inherited from extension)                                                                                                                         |                                                                                                                                   |
| 8   | `core` primitives: stable IDs, `ModkitError`-style structured errors, diagnostics, deterministic ordering, cancellation, lifecycle/disposal — S0                                        | canon (ownership) + lab detail (exact API)       | canon §6.1 (`core` row), §14.7–9; rationale MK3/12 (consolidation map: «12 → core errors канона»); parity oracle `packages/core/src/errors.ts` (`ModkitError`)                                                         | Every blocking async/provider/I/O API takes `AbortSignal`, returns structured diagnostics (BRIEF-12 §3.4)                         |
| 9   | `ErrorDefinition` (namespaced error codes)                                                                                                                                              | MK3 owner                                        | 24 §11; error-code grammar 23 §3                                                                                                                                                                                       |                                                                                                                                   |
| 10  | `DiagnosticSeverity`, `RedactionPolicy`, `SchemaRef`                                                                                                                                    | MK3 owner                                        | 24 §3.1                                                                                                                                                                                                                |                                                                                                                                   |
| 11  | Contract-selected `spec` mechanism (unknown contract = inspectable, not activatable) — S0/S1                                                                                            | canon (behaviour) + MK3 owner (envelope rule)    | canon Done-criterion (BRIEF-12 §1.2); 27 §0.3, §6 rules; R6 §8 pipeline                                                                                                                                                | Concrete lab test-contract spec schemas = lab detail                                                                              |
| 12  | Host inventory (explicit list, in-memory, deterministic order) — S1                                                                                                                     | canon (ownership) + lab detail (entry shape)     | canon §6.1 (`host` row: inventory/resolution modules); R6 §8; oracle `generated/codec-catalog/codec-catalog.json`                                                                                                      | No root `generated/` authority (27 §0.6)                                                                                          |
| 13  | `SubjectRef` / `SubjectIdentity` / `SourceRef` / `RevisionRef`, canonical URI serialization — S2                                                                                        | MK3 owner (normative-candidate)                  | 25 §3                                                                                                                                                                                                                  | Equality rules 25 §3; revision never in identity                                                                                  |
| 14  | Unknown source-root subject + `InterpretationRef` — S2                                                                                                                                  | MK3 owner (candidate, PR-16)                     | 25 §20; 30 §5                                                                                                                                                                                                          | Format never enters root identity                                                                                                 |
| 15  | Portable `vfs` source/stream/random-access contracts — S2                                                                                                                               | canon (promoted §5.9) + lab detail               | canon §5.9; divergence register row «Владение VFS implementations» (resolved 2026-08-12); oracle `packages/vfs`                                                                                                        | Node file adapter lives in `host/node`, not browser-safe `vfs` (BRIEF-12 §5 S2)                                                   |
| 16  | Trait vocabulary / `TraitId` values                                                                                                                                                     | AC v1                                            | AC §4 (+§13 manifest surface); TypeScript names today are `CapabilityInstance`/`CAPABILITY_IDS` (`packages/assets/src/capabilities.ts`, verified live)                                                                 | X3 S0–S4 treats `TraitId` as an opaque validated dotted string (23 §3 role table); no copy of the ID list, no rename (see gap G1) |
| 17  | Operation vocabulary (three namespaces, `ASSET_OPERATION_IDS`)                                                                                                                          | AC v1                                            | AC §5.1–5.3; live `packages/assets/src/operations.ts`                                                                                                                                                                  | Used by X3 only as opaque operation strings inside resolver requests                                                              |
| 18  | `AssetDescriptor` (full descriptor contract)                                                                                                                                            | AC v1; deferred in S0–S4, scheduled by BRIEF-13A | AC §2; BRIEF-12 §3.5 excludes it from S0–S4; BRIEF-13A A-1…A-3 owns the read-only v2 projection and sessions                                                                                                           | Accepted basis only; implementation has not landed                                                                                |
| 19  | `ProviderOffer` / `ProviderRequest` / `ContractRequirement` / `ContractOffer` / `OfferHeader` / `ResolvedProvider` / `RejectedCandidate` / `ResolutionResult` / `UnresolvedReason` — S3 | MK3 owner (normative-candidate)                  | 23 §8 («единственное определение … Остальные документы обязаны ссылаться сюда»)                                                                                                                                        | Resolver v1 executes only `primary` + compatible `replacement`; other kinds → explicit unsupported-kind diagnostic                |
| 20  | Resolution algorithm v1 (staged, deterministic, UTF-8 byte ordering, `ambiguous` instead of discovery order) — S3                                                                       | MK3 owner                                        | 23 §9; acceptance §17                                                                                                                                                                                                  |                                                                                                                                   |
| 21  | `RuntimeTarget` / `RuntimeTargetConstraint`                                                                                                                                             | AC-era v1 wire fact + MK3 owner (aliasing rule)  | 23 §8: normative alias of live `CodecRuntimeTarget` / constraint fields of `CodecRuntimeVariant` (`packages/assets/src/codec-manifest.ts`, verified live: environments/OS/arch/hostCapabilities/webApis/externalTools) | Port with PORTED.md provenance at S3; JSON names kept v1                                                                          |
| 22  | Permission classes taxonomy — S3                                                                                                                                                        | MK3 owner (normative-candidate)                  | 24 §3: canonical taxonomy `read-source, write-source, filesystem-read, filesystem-write, network, process-launch, native-code, credentials, clipboard, persistent-storage`                                             | One authored dictionary; live legacy vocabularies get mapping, not a second authority (gap G4)                                    |
| 23  | `PermissionGrant` + `GrantedPathScope` / `GrantedNetworkScope` / `CredentialGrantRef`; nested-grant intersection; deny-by-default — S3                                                  | MK3 owner                                        | 24 §4, §3.1, §15 invariants                                                                                                                                                                                            | Grant precedes entry-point import (X3-S3.3 spy proof)                                                                             |
| 24  | Execution profiles + SB ladder scope for the lab                                                                                                                                        | MK3 owner (adopted ladder)                       | 24 §3 (profile union), §5, §6.1 (SB-0 обязательна до массовой миграции)                                                                                                                                                | X3 S3 implements the SB-0 dispatch/grant slice only                                                                               |
| 25  | Provider-policy lock: `ProviderLockKey` / `ProviderPolicySelection` / `ProviderPolicyLockEntry`, `resolverVersion` staleness — S3                                                       | MK3 owner                                        | 23 §11                                                                                                                                                                                                                 | This is BRIEF-12's «resolution lock»; install/session/World locks are different records (deferred, 28/23 §12–13)                  |
| 26  | `testkit` minimal host / conformance harness — S4                                                                                                                                       | canon (ownership, dev-only closure) + lab detail | canon §6.1 closure classes; MK3/10 (gates rationale); R6 §11 S4 (PR-23 shape)                                                                                                                                          |                                                                                                                                   |
| 27  | External example-extension layout — S4                                                                                                                                                  | canon + MK3 owner                                | canon §5.13 tree; 27 §0.2–0.3                                                                                                                                                                                          | Lives outside the workspace; installs packed tarballs                                                                             |
| 28  | Lab package naming `@modkitx-x3/*`, no publish                                                                                                                                          | BRIEF owner rule                                 | BRIEF-12 §7/§7.1                                                                                                                                                                                                       | `@modkitx/*` names belong to `modkitx` R5                                                                                         |
| 29  | Codec v2 `spec`, read-only session/data-source/viewer ABI and contribution offers                                                                                                       | BRIEF-13A accepted basis — A-1…A-8               | BRIEF-13A §§5–16; BRIEF-13C                                                                                                                                                                                            | Compile fixtures exist; production runtime has not landed                                                                         |
| 30  | `FormatDefinition`, install/composition locks beyond the read-only slice, World types, UVE packer, key material, signatures/quarantine                                                  | **deferred**                                     | 30 §2; 28 §7; 23 §12–13; 26; R9 §19; 24 §12.1; 24 §6.1 SB-2+                                                                                                                                                           | Not authorized by REVISE / CONTINUE; S4b remains a separate candidate                                                             |

### 2. Minimal fields (fixed for S0 schemas)

**2.1 Normalized `ExtensionManifest` (one contract for both authored containers):**

```
schemaVersion         1 (literal)
publisher             qualified namespace, ABNF `dotted` (23 §3), e.g. `org.example`
id                    `name` grammar (23 §3); unique within publisher only
version               SemVer 2.0.0 string — npm container: inherited from package.json#version;
                      standalone container: own field (see gap G5)
license               SPDX string — same inheritance rule (27 §7: license of the whole unit)
contributionManifests readonly string[] — relative patterns; ≤1 shallow `*` segment; no `**`,
                      no absolute paths, no `..`, no symlink escape (27 §5.1)
```

Normalization also reports (as diagnostics/metadata, not envelope fields): source container
kind, and the packaging error when both containers are present. ~~Extension-level
dependencies deferred past S4~~ — **superseded by corrective pass G9/Q75**: canon §5.13
requires the manifest to carry them, the exact field shape awaits the owner's Q75 answer,
and X3-S0.3 is blocked until then. Declared-inventory diffing (canon §5.13) remains
deferred past S4.

**2.2 `ContributionManifestV1` envelope (open, transport for every contribution kind):**

```
schemaVersion    1 (literal)
contract         { id: ContractId (qualified, 23 §3), major: number }
id               qualified contribution coordinate (23 §3.1); independent from the owning
                 extension coordinate, never inherited
displayName      string
status?          optional display hint 'supported'|'partial'|'unsupported'|'experimental'
                 (27 §0.5.2 wins over the §6 interface listing it required — gap G2)
runtimeVariants? readonly RuntimeVariantDeclaration[] (24 §3; static definitions may omit)
dependsOn?       readonly ScopedContractRequirement[] (23 §8)
limitations?     readonly string[]
spec             contract-selected payload (2.3)
```

No per-contribution `version` (27 §0.5.1): locks reference
`(extension coordinate, contribution id, contract major)`.

**2.3 Contract-selected `spec`:** the registry maps `(contract.id, contract.major)` → one
strict JSON Schema for `spec`. Known contract → strict validation (fail = structured
diagnostics, no activation). Unknown contract → envelope itself still validates, `spec` is
preserved as inspectable data, a structured `unknown-contract` diagnostic is emitted, and the
contribution is **never activatable** (27 §6 rules; R6 §8). S0 ships lab test-contract spec
schemas only; real codec-v2 spec stays deferred (owner matrix #29).

**2.4 Permission request / grant (S3 minimum, SB-0 scope):**

- Request: authored **only** in `runtimeVariants[].requestedPermissionClasses`
  (24 §3; single authored security owner per 27 §0.5.3), values from the canonical taxonomy
  (owner matrix #22). Missing permission = deny; no `requiresHostApproval` field.
- Grant (24 §4): `{ id, subjectScope?, sourceScope?, filesystem?: GrantedPathScope[],
network?: GrantedNetworkScope[], credentials?: CredentialGrantRef[], expiresAt?,
parentGrant? }`; nested call authority = parent grant ∩ callee request ∩ host policy ∩
  operation scope; child never wider than parent. Gate order: resolution → grant → only then
  entry-point import/execution (24 §8; X3-S3.3 spy proof).

**2.5 Resolution lock (portable provider-policy lock, 23 §11):**

```
ProviderLockKey        { contract, major, normalizedRange ('*' default after canonical
                         normalization), operation?, requiredOutputs: TraitId[] (unique,
                         UTF-8-byte-sorted), preferredOutputs: same, workload? }
ProviderPolicySelection{ extension (publisher-qualified coordinate), releaseRange? ('*'),
                         contributionId, contractMajor }
ProviderPolicyLockEntry{ key, primary, allowedFallbacks?, resolverVersion }
```

Excluded by design: OS/architecture, runtime variant, exact artifact/digest, external tool
paths, facilities, grants, credentials/secrets, catalog URLs (those belong to install lock /
machine activation snapshot / session records — deferred). Serialization is canonical and
byte-stable: sorted keys, UTF-8 byte ordering for ID lists, LF, independent of discovery /
registration / shuffle order (23 §9.9, §16.5, §17).

### 3. Schema/type source-of-truth workflow (decision §5.3)

**Chosen: authored strict JSON Schema objects are the single wire authority; everything else
is mechanically derived or compile-time-pinned to them.**

1. Each published schema (`ExtensionManifest`, both authored-container adapters,
   `ContributionManifestV1`, lock, …) is authored **once** as a TypeScript `as const` object
   in `@modkitx-x3/sdk` source (`packages/sdk/src/schemas/…`), dialect JSON Schema 2020-12
   (lab decision, see L2), strict (`additionalProperties: false`, required lists explicit).
2. The published `.json` schema artifacts are **emitted** from those consts by one tiny
   deterministic script (stable key order, LF, trailing newline) with a `--check` CI mode —
   a serialization step, not a codegen framework.
3. Public TypeScript types are hand-authored for API ergonomics but **pinned** to their
   schema by a compile-time structural-equality drift gate:
   `type _Check = Expect<Equal<ExtensionManifest, FromSchema<typeof extensionManifestSchema>>>`
   (dev-only `json-schema-to-ts`; the assertion lives in a type-test file). Any divergence
   fails `tsc`/vitest — the drift-test S0 acceptance names.
4. Runtime validation (CLI `modkit validate`, host loading) compiles **the same consts** with
   Ajv (2020-12 dialect) — planned single external dependency of `sdk`, to be justified in
   PORTED.md when S0 code lands; hand-writing a JSON Schema validator would itself be a
   second drifting authority. If the validate-budget (<150 ms, BRIEF-12 §6) fails, switch to
   ajv standalone-compiled validators generated from the same consts — authority unchanged.

**Why this creates no second authority:** the schema const is the only place a wire shape is
stated. The `.json` artifact is a checked projection; the TS type is compile-time-proven
equal (not sampled by fixtures); the runtime validator executes the same object. The one
allowed authority mechanic (BRIEF-12 §7: «generator ИЛИ drift-check») is the drift-check of
step 3; step 2 is packaging, not generation of a second form.

**Rejected:** TS-first + schema generator (`ts-json-schema-generator`) — published wire form
becomes hostage to generator version churn; zod/valibot as source — runtime dependency in
public API and unstable emitted schemas; hand-written schema + hand-written types with only
fixture-based drift tests — sampling, not proof.

### 4. Contract gap register (§5.4)

No **blocking** gaps found; every entry below has an owner-sanctioned resolution the lab can
proceed under, and none required a lab-side architectural override.

| #   | Gap                                                                                                                                                                                                                                           | Blocking?        | Resolution / status                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Capability→Trait rename not promoted: AC v1 normatively keeps `CapabilityInstance`/`CAPABILITY_IDS` (verified live in `packages/assets`); MK3/02 §1 bans `capability` from the new wire vocabulary; divergence register holds the rename open | **No** for S0–S4 | X3 needs no trait vocabulary: descriptor contract is out of scope (§3.5), resolver uses `TraitId` as an opaque validated dotted string (23 §3). X3 introduces **neither** `Capability*` names **nor** `Trait*` wire types, and copies no ID list — no second wire dictionary. If a slice turns out to need the descriptor/trait contract → stop + owner gap here, per BRIEF-12 §3.5                                                                                  |
| G2  | 27 §6 `ContributionManifestV1` interface lists `status` as required; adopted 27 §0.5.2 demotes whole-unit `status` to an optional display hint                                                                                                | No               | Resolved by the owner document's own precedence rule (27 §0 header: «при конфликте выигрывает этот раздел») → optional. Textual fix of §6 suggested to owner in the session report; not a lab decision                                                                                                                                                                                                                                                               |
| G3  | 27 §6 comments contribution `id` as «contract-specific grammar», 23 §3/§3.1 requires the qualified form for contribution/provider ids                                                                                                         | No               | 23 owns identity grammar (MK3/README ownership map) → qualified `publisher/name` form; 23 §3.1 explicitly: «Новый contribution manifest хранит собственный qualified id»                                                                                                                                                                                                                                                                                             |
| G4  | Three diverging live permission vocabularies (`CODEC_PERMISSION_CLASSES` — 9 classes, no `credentials`; `ASSET_PERMISSIONS`; VFS `SourceProviderPermission`), verified live                                                                   | No               | 24 §3 already prescribes the single canonical 10-class taxonomy for v1 and demands explicit mapping for legacy vocabularies; X3 authors exactly that taxonomy. Legacy mapping tables are needed only when legacy fixtures are converted (provenance via PORTED.md)                                                                                                                                                                                                   |
| G5  | Standalone `modkit.extension.json` and `version`/`license`: 27 §0.2 says they are «inherited from npm fields», which a non-npm layout does not have                                                                                           | No               | Interpretation fixed (supported by 27 §7 which shows `ExtensionManifest#license` fed by either container): the standalone container carries `version`/`license` as its own required fields; the npm container must NOT duplicate them (single source per artifact). Negative fixtures: standalone without them = error; `#modkit` block duplicating them = error. Flagged for owner confirmation in the session report; adapter-level reading, not a contract change |
| G6  | Canonical control-schema dialect not fixed (23 §18.1 open)                                                                                                                                                                                    | No               | Lab decision L2: JSON Schema 2020-12 for lab schemas; recorded here, promotion of the dialect belongs to owner 23. No published `$id`s until owner adopt (nothing is published at all, §7.1)                                                                                                                                                                                                                                                                         |
| G7  | BRIEF-12 §1 Done-criteria name packages `@modkitx/core`… while §7/§7.1 forbid occupying `@modkitx/*`                                                                                                                                          | No               | §7/§7.1 is the explicit later-dated rule: lab packages are `@modkitx-x3/*`; only local `pnpm pack` tarballs, no publish. Risk standing order: if the owner starts R5 creation of `@modkitx/sdk`/`host` while X3 flies, the parallelism risk goes into the session/final report                                                                                                                                                                                       |
| G8  | v1 `codec.manifest.json#runtimeVariants` (entrypoints map, capabilities verbs) differs from 24 §3 `RuntimeVariantDeclaration` (single `entrypoint`, `requestedPermissionClasses`)                                                             | No               | Not a conflict: v2 envelope deliberately uses 24 §3's shape; v1 manifests remain **legacy input fixtures** only (marked, excluded from the legacy gate), normalized during fixture conversion with PORTED.md provenance                                                                                                                                                                                                                                              |

### 5. Lab-local decisions recorded (inside delegated boundaries)

- **L1**: Lab package names `@modkitx-x3/{core,sdk,vfs,host,testkit}` + leaf
  `apps/modkit-cli` (binary `modkit`, private). Nothing is ever published (§7.1).
- **L2**: JSON Schema dialect 2020-12 (see G6).
- **L3**: `TraitId`/operation IDs are opaque grammar-validated strings in X3; no ID
  catalogs are copied from `modkitx` (see G1).
- **L4**: Permission classes = canonical 10-class list from 24 §3 (see G4).
- **L5**: Planned runtime validator: Ajv (2020-12) as the single external `sdk` dependency —
  justification lands in PORTED.md together with the first S0 code; `core` stays at
  «LogTape only» (canon §6.1) and even that is added only when diagnostics need it.
- **L6**: Canonical JSON serialization for emitted schemas/locks: UTF-8, LF, sorted object
  keys where order is not semantic, arrays of IDs unique + UTF-8-byte-sorted (23 §9.9).
- **L7** (hardened by corrective pass C4): Legacy gate = `scripts/check-legacy.mjs`
  (zero-dependency): scans `packages/**/src`, `apps/**/src`, `packages/**/schemas`, package
  names, `exports` maps and full manifest text; excludes `**/fixtures/legacy/**` paths, and
  honors the `@modkit-legacy-input-fixture` marker only under a `fixtures/` directory
  (elsewhere the marker is itself a violation). Committed regression suite:
  `scripts/test/check-legacy.test.ts`. Category-as-path is NOT grep-detectable and is
  enforced by S1 loader tests + review instead — recorded here so the gate's blind spot is
  explicit.
- **L8** (superseded by corrective pass C3): the protocol is fixed in S0.0 — see C3 above;
  X3-S0.5 only implements the bench script against it.

### 6. What X3-S0.0 did NOT do (explicit; amended by the corrective pass)

- No package sources, no `core` types, no schemas yet — first type lands in X3-S0.2+.
- ~~No `pnpm install` / lockfile~~ — done in corrective pass C5 (2026-08-13).
- No writes to `modkitx` beyond BRIEF-12 §8 scope (board/register; corrective pass added
  the Q75–Q77 proposals to `MK3/11-open-questions.md`, also §8-allowed).
- ~~No entry in `MK3/11-open-questions.md`~~ — superseded: the audit surfaced G9 as a real
  blocking gap; Q75–Q77 filed in the corrective pass.
