# REPORT A6 — text writers on the 13D seam (2026-08-19)

Slice: **A6**. Branch: `agent-adabe9fbac3f0d583` (worktree of `spec/mk3-extension-reference`).
ADR: **ADR-HOST-002** (Accepted), Path B — a `common.edit/writer@1` provider next to a read codec.

Every bundled text codec family now offers a writer, so the universal text editor can save
through the host commit coordinator instead of writing files itself. The writers are honest
pass-throughs with validation: they carry what a text editor authors (a `replace`, whole-source
or over a UTF-16/byte range), refuse what they cannot carry with a diagnostic, and claim
`byte-identical` / `preservesUnknownData` because a range edit touches only the range it names.
Nothing in extension code writes: every writer variant requests **no** permission classes and the
host commits under `write-source`.

> ## Read this first — the slice cannot go green from inside its own scope
>
> Two hard-coded censuses outside my scope enumerate the contributions of `extensions/common`, and
> six new manifests invalidate both:
>
> 1. `packages/testkit/test/text-data.test.ts` — fails `pnpm check` at `pnpm test` (1 of 716 tests).
> 2. `scripts/app-extension-sets.mjs` + `scripts/check-apps.mjs` — fails `pnpm apps:check`.
>
> `packages/**` is explicitly forbidden to me and `scripts/**` is outside my exclusive scope, so
> both are handed to Root as Requests 1 and 2 below, with exact line numbers. **I verified the
> Request 2 fix**: applying it locally made `pnpm apps:check` pass, then I reverted it. Every other
> gate is green — I ran the whole `pnpm check` chain by hand past the failure point.

## Formats covered

Eight offers across six extensions — one `service-provider-contribution` manifest per extension,
one writer module per extension, one offer per `formatId` the extension owns:

| extension      | manifest                              | offers (offerId -> formatId)                   | provider id                         | evidence id                     |
| -------------- | ------------------------------------- | ---------------------------------------------- | ----------------------------------- | ------------------------------- |
| text-json      | `contributions/writer-json.json`      | `json-source` -> json, `jsonc-source` -> jsonc | `org.modkitx/text-json-writer`      | `text-json-text-writer-v1`      |
| text-ini       | `contributions/writer-ini.json`       | `ini-source` -> ini                            | `org.modkitx/text-ini-writer`       | `text-ini-text-writer-v1`       |
| text-delimited | `contributions/writer-delimited.json` | `csv-source` -> csv, `tsv-source` -> tsv       | `org.modkitx/text-delimited-writer` | `text-delimited-text-writer-v1` |
| text-toml      | `contributions/writer-toml.json`      | `toml-source` -> toml                          | `org.modkitx/text-toml-writer`      | `text-toml-text-writer-v1`      |
| text-xml       | `contributions/writer-xml.json`       | `xml-source` -> xml                            | `org.modkitx/text-xml-writer`       | `text-xml-text-writer-v1`       |
| text-yaml      | `contributions/writer-yaml.json`      | `yaml-source` -> yaml                          | `org.modkitx/text-yaml-writer`      | `text-yaml-text-writer-v1`      |

Every module lives at `src/editing/text-writer.js` inside its own extension.

**`yml` is not a separate offer, and that is correct.** `extensions/common/text-yaml/contributions/codec-yaml.json`
declares exactly one `formatRefs[].formatId` (`yaml`); `yml` appears only in `spec.match.extensions`
(and in the format definition's `extensions` list) as a filename alias. A `.yml` file therefore
opens as `formatId: yaml` and resolves the `yaml-source` offer. Adding a `yml` offer would have
invented a format no codec in this lab owns.

Every offer facet is exactly `{ providerId, fidelityEvidenceId, formatId, representationId:
"source", mutationMode: "mutate", minimumRoundTrip: "byte-identical" }`, and every manifest carries
a single `portable` runtime variant (`browser-worker` + `node-worker`, `executionProfile:
"worker-brokered"`, `requestedPermissionClasses: []`). All six extensions already glob
`./contributions/*.json` in `package.json#modkit.contributionManifests`, so no `package.json`
needed editing.

## The writer modules

One file per extension, built with `defineWriter` from `@modkitx-x3/codec-kit`:

- single-format extensions (ini, toml, xml, yaml) export the destructured module directly:
  `export const { abiVersion, provides, createProvider } = defineWriter({ ... })`;
- multi-format extensions (text-json: json + jsonc; text-delimited: csv + tsv) build one
  `defineWriter` module per format and export a `createProvider` that dispatches on
  `selection.offerId` (see Request 3 — `defineWriter` takes a single `offerId`).

`validate` accepts an edit only when **all** of these hold, and emits one error diagnostic per
violation otherwise:

| rule                                                                                            | diagnostic code                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| the change set has at least one target and one edit                                             | `org.modkitx/text-writer-change-empty`          |
| the edit is a `replace` (create / delete / rename are not text edits)                           | `org.modkitx/text-writer-operation-unsupported` |
| `edit.targetId` and `edit.source.id` belong to the change set's own targets                     | `org.modkitx/text-writer-target-foreign`        |
| a present `edit.range` is `utf16` or `bytes`                                                    | `org.modkitx/text-writer-range-unsupported`     |
| `edit.payload` is `text` or `inline` (a `staged` payload needs a store text editing never uses) | `org.modkitx/text-writer-payload-unsupported`   |

`planEdits` returns `change.edits` unchanged; the claimed fidelity is `{ roundTrip:
"byte-identical", preservesUnknownData: true }`, and `defineWriter` fills in the targets and
`{ mutationMode: "mutate", minimumGuarantee: "atomic" }`.

One deliberate addition beyond the letter of the brief: `planEdits` re-runs the same validation
and throws before returning. Without it a caller could skip `propose` and hand the coordinator a
`create` edit the writer has publicly declared it does not support — the refusal would be advisory
only. Valid change sets are still returned untouched, so the pass-through property holds.

## Relation to the raw writer Root has since landed

Root landed `createRawWriter` + `createEvidenceRegistry` in the host after this branch was cut;
they are not in this worktree. Stating the overlap plainly:

- **Not duplicated: facet resolution.** A single format-blind writer has no `formatId` to match
  on, so it cannot be selected by `org.modkitx/writer-facet-matcher@1`. These eight offers are what
  make `resolve({ contract: "common.edit/writer", major: 1, facet: { formatId: "csv", ... } })`
  answer at all — the mechanism ADR-HOST-002 §3 specifies, and what the proof below exercises. They
  also give each extension a per-format `fidelityEvidenceId` (so evidence policy can differ per
  format) and a place for a genuinely format-aware writer to grow later (an INI writer that edits a
  value in place, a CSV writer that rewrites one cell) without any caller changing.
- **Duplicated: the body.** The validation rule and the pass-through in these six modules are
  format-blind. If `createRawWriter` enforces the same "replace only, utf16/bytes ranges,
  text/inline payloads, byte-identical" contract, that rule now exists in seven places — the host
  raw writer plus my six copies. That is the concrete reason for Request 4: the rule belongs in
  codec-kit once, shared by the raw writer and by every per-format writer, leaving each extension
  module with only its identity and its offers.

## Proof

`packages/host/test/text-writers.test.ts` (the only file added under `packages/**`), modelled on
`packages/host/test/subject-editing.test.ts`. One `createNodeSubjectServices` (linked,
`allowTrustedInProcess: false`, worker realm) over text-json, text-ini and text-delimited.

For **json**, **ini** and **csv** (one `it` each, off a case table):

1. a temp copy is opened worker-brokered — asserted: the expected codec contribution
   (`org.modkitx/text-json`, `text-ini`, `text-csv`), the `portable` variant, the
   `x3.host/worker-shared-process` diagnostic, and `descriptor.constraints.readOnly === true`
   (the codec stays read-only; saving is the writer's contract, not the codec's);
2. the writer is resolved **by facet** through `createHostServiceResolver` — asserted: the whole
   `writer.offer` equals the manifest facet, `writer.identity.formatId` matches, and the lease
   crossed the boundary (`x3.host/worker-shared-process` on the resolver);
3. `createSubjectEditing({ ..., writer })` backs an edit session; a `ChangeSet` replacing one value
   by a **UTF-16 range** edit with a `text` payload proposes `{ valid: true, diagnostics: [] }`;
4. the same session refuses a `create` edit: `valid: false` with exactly
   `["org.modkitx/text-writer-operation-unsupported"]`;
5. `plan` is asserted to be a pass-through (`plan.edits` deep-equals the authored edits) at
   byte-identical / mutate + atomic;
6. `prepare` -> ready with `granted: true, achievableGuarantee: "atomic"`, `commit` -> committed
   with `commitGuarantee: "atomic"`, through `createFileEditingBackend({ roots: [scratch] })`;
7. the file is re-read and asserted to have changed **exactly** in the named range: the prefix
   before the offset and the suffix after it are byte-for-byte the original, the middle is the
   replacement. Replacements are deliberately a different length from the originals
   (`alpha` -> `omega-one`, `localhost` -> `127.0.0.1`, `alpha` -> `omega`), so a mis-spliced tail
   would show;
8. the file is reopened: the same codec is selected again and `parse` invokes `ok` with a `json`
   output — the edited text still parses.

A fourth `it` proves the facet rule discriminates:

- an `export-only` / `semantic` request for `tsv` resolves (a `mutate` / `byte-identical` offer
  satisfies a weaker request) and lands on `org.modkitx/text-delimited-writer`;
- a request for `toml` — a text format of this lab that none of the three loaded extensions owns —
  is refused with `x3.host/service-contract-unresolved`;
- a request for `json` at `representationId: "syntax-document"` is likewise unresolved.

Result: **4 tests, 4 passed** (`pnpm exec vitest run packages/host/test/text-writers.test.ts`).

The five formats the host proof does not open (jsonc, tsv, toml, xml, yaml) were covered by a
throwaway direct-import smoke run of all six modules and all eight offers: each offer validates a
UTF-16 range replace, refuses a `create` with `org.modkitx/text-writer-operation-unsupported`,
refuses it again in `plan`, exposes the right `offer.formatId` / `mutationMode`, and throws on an
unknown `offerId`. All eight passed. That script lives in the scratchpad, not in the repo (see
"Not done" for why no extension unit tests).

## Gates

Every gate below was run in the foreground on the final tree.

| gate                                                           | result                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                               | clean                                                                                                                                             |
| `pnpm build`                                                   | clean                                                                                                                                             |
| `pnpm typecheck`                                               | clean                                                                                                                                             |
| `pnpm lint`                                                    | clean                                                                                                                                             |
| `pnpm format:check`                                            | clean                                                                                                                                             |
| `pnpm test`                                                    | **1 failed / 715 passed** (89 files, 88 passed) — `packages/testkit/test/text-data.test.ts`, Request 1                                            |
| `pnpm exec vitest run packages/host/test/text-writers.test.ts` | 4/4 passed                                                                                                                                        |
| `pnpm schemas:check`                                           | clean (16 artifacts)                                                                                                                              |
| `pnpm manifests:check`                                         | clean (16 UI manifests)                                                                                                                           |
| `pnpm tokens:check`                                            | clean (193 tokens, 3 palettes)                                                                                                                    |
| `pnpm themes:check`                                            | clean (3 themes)                                                                                                                                  |
| `pnpm icons:check`                                             | clean (9 PNG targets + ICO)                                                                                                                       |
| `pnpm facilities:check`                                        | clean (28 standard + 1 legacy)                                                                                                                    |
| `pnpm apps:check`                                              | **failed** — contribution census, Request 2 (passes with the fix applied)                                                                         |
| `pnpm check:legacy`                                            | clean (710 files scanned)                                                                                                                         |
| `pnpm check:imports`                                           | clean (213 files scanned)                                                                                                                         |
| `pnpm check:extensions`                                        | clean (53 extension directories)                                                                                                                  |
| `pnpm check:mk2`                                               | skipped (no MK2 checkout beside this worktree)                                                                                                    |
| `pnpm catalogs:emit`                                           | 4 Electron catalogs + web catalog emitted                                                                                                         |
| `pnpm catalogs:check`                                          | clean                                                                                                                                             |
| `pnpm catalogs:check:web`                                      | clean                                                                                                                                             |
| `pnpm check` (whole chain)                                     | **fails at `pnpm test`**, on the one test above; the chain short-circuits there, so the gates after it were run individually — see the rows above |

`pnpm check` was run twice, start to finish, with the identical result (338s and 318s). Both runs
reached `pnpm test` with `build`, `bench:universal:gate`, `lint` and `format:check` green.

`pnpm catalogs:emit` changed only `apps/web/generated/extension-catalog.js` (+122/-4): the web
catalog attests text-ini and text-delimited, the two text extensions whose only runtime dependency
is the vendored `@modkitx-x3/codec-kit`. text-json, text-toml, text-xml and text-yaml stay in the
catalog's `excluded` list for their npm parsers, exactly as before this slice. The four Electron
catalogs came out byte-identical.

## Not done, and why

- **The two contribution censuses are not updated** — `packages/**` is forbidden to me and
  `scripts/**` is outside my exclusive scope. Requests 1 and 2.
- **No per-extension unit tests.** The root `vitest.config.ts` `include` covers only
  `packages/*/test/**`, `apps/*/test/**` and `scripts/test/**`; a test under
  `extensions/common/*/test/**` would never execute, and widening the include list means editing
  `vitest.config.ts`, which is outside my scope. The brief made these optional ("may get"), and the
  host proof covers the same code paths for real, across the execution boundary.
- **`artifactDigest` is a placeholder, honestly labelled.** A provider module cannot see its own
  artifact digest at runtime, so each writer declares
  `artifactDigest: "x3:org.modkitx/<ext>-writer@1.0.0"` with a comment saying the host inventory
  carries the attested digest (the Path B fixture does the same with
  `sha256:png-passthrough-writer-fixture`). It only bites if a host passes `expectedWriter` to
  `createSubjectEditing`, which pins evidence to the identity; nothing does today. If
  `createEvidenceRegistry` wants to key on a real digest, the host's inventory record is the only
  place that has one — worth a decision.
- **No `yml` offer** — see the formats section.

## Requests to Root

### 1. (blocking) Update the text-data manifest census in `packages/testkit/test/text-data.test.ts`

The test `13B text-data providers and codecs > validates all isolated contribution manifests through
the A-1 authorities` reads every JSON file under the six text extensions' `contributions/` and
asserts fixed counts. Six new manifests break four assertions:

- line 338 `expect(manifests).toHaveLength(24)` -> `30`
- line 339 `expect(new Set(manifests.map(manifest => manifest.id)).size).toBe(24)` -> `30`
- lines 354-356 `service-provider` manifests `toHaveLength(8)` -> `14` (8 syntax providers + 6 writers)
- lines 360-365 `expectedEntrypoints` is built only from `sourceEntrypoint(format, "codec" | "provider")`,
  so the writer entrypoint is rejected by the loop at lines 366-370; add `./src/editing/text-writer.js`.

The rest of that test already passes on the new manifests: the codec count (8) and
contract-definition count (8) are unchanged, no manifest carries `mutatesSource: true`,
`rawPreserving` or `edit.content` / `source.save`, and every declared entrypoint file exists.

### 2. (blocking) Update the app contribution census in `scripts/`

`pnpm apps:check` asserts an exact contribution-id list per extension set. Two files:

`scripts/app-extension-sets.mjs` — add one id to each text entry of `READY_APP_EXTENSIONS`:

```
text-delimited  += 'org.modkitx/text-delimited-writer'
text-ini        += 'org.modkitx/text-ini-writer'
text-json       += 'org.modkitx/text-json-writer'
text-toml       += 'org.modkitx/text-toml-writer'
text-xml        += 'org.modkitx/text-xml-writer'
text-yaml       += 'org.modkitx/text-yaml-writer'
```

`scripts/check-apps.mjs` — two realm expectations move:

- `pwa` / `structured-text`, worker: `{ offers: 16, active: 16 }` -> `{ offers: 22, active: 22 }`
- `pwa` / `editor-and-documents`, worker: `{ offers: 6, active: 6 }` -> `{ offers: 7, active: 7 }`

I applied exactly this locally and `pnpm apps:check` printed
`16 extension-set/realm cases conform across headless, PWA, Electron and VS Code adapters`, then I
reverted it (`git checkout -- scripts/`). Note the counts rise by 6, not 8:
`offersFromInventory` yields one entry per contribution/variant, so a two-offer writer still counts
once.

### 3. Which realms should resolve a writer? (a real finding, not just a gate detail)

The headless automation host and the Electron main realm expectations did **not** change, because
those realms target the `node` environment and my writer manifests declare only the `portable`
variant (`browser-worker` + `node-worker`), exactly as the brief specified. Consequence: **on a
plain-node host a writer request for any text format is currently unresolvable.** The syntax
providers next to them do ship a `trusted-node` variant, so this is an asymmetry someone chose
implicitly rather than deliberately. Either it is right (ADR-HOST-001 §3: providers cross the
boundary worker-brokered, so those hosts should resolve writers through their worker realm) or the
six manifests need a `trusted-node` variant too. That is a one-line-per-manifest change in my scope
if you want it — say the word.

### 4. `defineWriter` should accept several offers in one module

`DefineWriterOptions` takes a single `offerId` / `formatId` / `representationId`, and the
`createProvider` it generates throws on any other `offerId`. The brief asks for one module per
extension serving every format the extension owns, so text-json and text-delimited each call
`defineWriter` once per format and hand-roll the module envelope:

```js
const OFFERS = Object.freeze({
  'json-source': textWriter('json'),
  'jsonc-source': textWriter('jsonc'),
})
export const abiVersion = 1
export const provides = Object.freeze(['common.edit/writer'])
export async function createProvider(selection) {
  const offered = OFFERS[selection.offerId]
  if (offered === undefined) throw new TypeError(`unknown writer offer ${selection.offerId}`)
  return offered.createProvider(selection)
}
```

Suggested shape: `defineWriter({ providerId, providerVersion, artifactDigest, offers: [{ offerId,
formatId, representationId, mutationMode, minimumRoundTrip, fidelityEvidenceId, fidelity, validate,
planEdits }] })`, with today's flat single-offer form kept as sugar. I did **not** touch codec-kit.

### 5. A shared text change-set validator belongs in codec-kit

The ~45-line `validateTextChange` (the table above) is now duplicated in six extensions, because
extensions may not import one another and `extensions/_shared/**` is out of my scope — and, per the
raw-writer section, it is probably a seventh copy of what `createRawWriter` already enforces. A kit
export — e.g. `textChangeValidator({ ranges: ["utf16", "bytes"], payloads: ["text", "inline"] })`
returning a `validate` function, or a `defineTextPassThroughWriter` wrapper — would collapse all six
to a few lines each and give one place to fix the rule. The diagnostic codes
(`org.modkitx/text-writer-*`) are ready to move as-is.

### 6. Optional: let extension tests run

If per-extension unit tests are wanted anywhere in the lab, `vitest.config.ts` needs
`extensions/*/*/test/**/*.test.{ts,js}` (or similar) in `include`. Today several extensions ship
`test/fixtures/**` with no runner that can see them
(`extensions/common/text-ini/test/fixtures/ini-sc2-parity.json`,
`extensions/common/text-delimited/test/fixtures/csv-rfc4180-parity.json`).

### 7. No host or SDK change was needed for the seam itself

`common.edit/writer@1` resolved by facet, leased worker-brokered, and committed through
`createFileEditingBackend` without any change to `packages/**` beyond the new test file. UTF-16
ranges work end to end (`spliceUtf16` in `packages/host/src/node/file-editing-backend.ts`).

## Files

Added (12 extension files + 1 test + this report):

- `extensions/common/text-json/contributions/writer-json.json`, `extensions/common/text-json/src/editing/text-writer.js`
- `extensions/common/text-ini/contributions/writer-ini.json`, `extensions/common/text-ini/src/editing/text-writer.js`
- `extensions/common/text-delimited/contributions/writer-delimited.json`, `extensions/common/text-delimited/src/editing/text-writer.js`
- `extensions/common/text-toml/contributions/writer-toml.json`, `extensions/common/text-toml/src/editing/text-writer.js`
- `extensions/common/text-xml/contributions/writer-xml.json`, `extensions/common/text-xml/src/editing/text-writer.js`
- `extensions/common/text-yaml/contributions/writer-yaml.json`, `extensions/common/text-yaml/src/editing/text-writer.js`
- `packages/host/test/text-writers.test.ts`
- `REPORT_A6_TEXT_WRITERS_2026-08-19.md`

Regenerated by the emit scripts only:

- `apps/web/generated/extension-catalog.js`

Nothing else in the worktree is modified: `scripts/app-extension-sets.mjs` and
`scripts/check-apps.mjs` were patched only to verify Request 2 and were reverted.
