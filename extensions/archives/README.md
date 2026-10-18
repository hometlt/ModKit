# `common/archives`

`readZipByRanges` defaults to strict directory counts. The explicit fourth-argument profile
`{ compatibility: 'legacy-wrapped-entry-count' }` admits a classic non-ZIP64 directory only
after scanning every complete record, enforcing the actual entry budget and checking that
its count is congruent with both EOCD counts modulo 65536. It emits a warning; malformed
tails/counts still refuse. This read-only policy does not qualify legacy archives for editing.

Archive-family reference extension. The first vertical codec is ZIP: bounded structural probe,
central-directory validation, lazy namespace listing, and stored/deflate entry extraction.

ZIP parsing is local to `src/zip`; importing another extension cannot load it.

## Editing (ADR-HOST-002 Path A)

The ZIP codec declares two mutating operations. Neither writes anything: each returns
`{ kind: 'edit-plan', plan }` built with `editPlanFromInput`, and the host commits it under
`write-source` through its editing backend.

| operation        | handler          | input                                                                |
| ---------------- | ---------------- | -------------------------------------------------------------------- |
| `edit.structure` | `edit-structure` | `{ add: [{ path, bytes }], remove: [path], rename: [{ from, to }] }` |
| `edit.content`   | `edit-content`   | `{ path, bytes }`                                                    |

`bytes` is standard base64 in the JSON operation input. Changes apply in the order
remove → rename → add.

The plan is one whole-source `replace` with an inline payload: a freshly assembled archive.
Nothing is recompressed. Every untouched entry's local header, compressed data and
central-directory record are copied **verbatim**; only the local-header offset inside the central
record or ZIP64 offset extra is rewritten. Method, CRC-32, sizes, timestamps, extra fields, entry comments and the
archive comment survive. Added entries and `edit.content` replacements are stored (method 0) with
a freshly computed CRC-32 and a deterministic DOS-epoch timestamp; `edit.content` keeps the
entry's original timestamp, attributes, other extra fields and comment. Replaced entries lose
stale ZIP64 size/offset extras; the common writer regenerates any required ZIP64 metadata.

Fidelity is claimed as `semantic`. `preservesUnknownData` is `true` only when the input has a
canonical layout — entries contiguous from offset 0 in central-directory order, the directory
immediately after them, the EOCD (or the fixed ZIP64 end record, locator and EOCD) immediately
after that and nothing trailing — because only then
does re-assembly provably keep every byte the archive carried. Otherwise it is `false` and the
plan says why.

### Refusals

An archive the re-assembler cannot copy safely is refused before any bytes are produced, and the
descriptor carries the reason as a diagnostic:

- `x3.codec/zip-edit-zip64` — unsupported or inconsistent ZIP64 metadata, noncanonical ZIP64
  layout, duplicate/truncated ZIP64 extras, multi-disk entries or extensible end records;
- `x3.codec/zip-edit-encrypted` — an entry with the encryption or strong-encryption flag;
- `x3.codec/zip-edit-layout` — data before the first entry (a self-extracting stub), duplicate
  entry paths, a malformed extra field, or a streaming data descriptor that disagrees with the
  central directory.

Canonical single-disk ZIP64 archives are editable within the existing full-byte `maxInputBytes`
budget (1 GiB in the contribution). ZIP64 count sentinels begin at 65535 entries. Both classic
and ZIP64 signed/unsigned data descriptors are checked against the central directory; streamed
ZIP64 local size placeholders are accepted only with a matching descriptor. Untouched local
blocks, unknown extras, comments and the fixed ZIP64 end record's creator/required versions
survive. Local-header-only ZIP64 and offset-only ZIP64 extras use the same editor. Archives
larger than the edit budget remain readable by ranges, but edits fail before a plan is produced.
Actual edits over 4 GiB are not qualified. Output must fit `maxInputBytes` / `maxNodes`, and each
payload must fit `maxScalarBytes`.

The ZIP64 preservation corpus is `test/zip-ranges.test.ts`, including an independent Python
`zipfile` forced-ZIP64 input. `packages/codec-kit/test/container-zip.test.ts` covers classic ZIP,
the 65534/65535/65536 entry boundaries and ZIP64 header sizes without allocating 4 GiB payloads.

Fourteen additional product codecs now live in this package: 7z, Brotli, BZip2, CAB, DMG, GZip,
ISO, LZMA, PE, PlayStation XA, RAR, TAR, XZ and Zstandard. The older ZIP staging route was retired
in favour of the richer native ZIP contribution already here. Historical decisions remain in
inert `MIGRATION-NOTES-common-archives.json`.
