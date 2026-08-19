# `common/archives`

Archive-family reference extension. The first vertical codec is ZIP: bounded structural probe,
central-directory validation, lazy namespace listing, and stored/deflate entry extraction.

ZIP parsing is local to `formats/zip`; importing another extension cannot load it.

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
record is rewritten. Method, CRC-32, sizes, timestamps, extra fields, entry comments and the
archive comment survive. Added entries and `edit.content` replacements are stored (method 0) with
a freshly computed CRC-32 and a deterministic DOS-epoch timestamp; `edit.content` keeps the
entry's original timestamp, attributes, extra fields and comment.

Fidelity is claimed as `semantic`. `preservesUnknownData` is `true` only when the input has a
canonical layout — entries contiguous from offset 0 in central-directory order, the directory
immediately after them, the EOCD immediately after that and nothing trailing — because only then
does re-assembly provably keep every byte the archive carried. Otherwise it is `false` and the
plan says why.

### Refusals

An archive the re-assembler cannot copy safely is refused before any bytes are produced, and the
descriptor carries the reason as a diagnostic:

- `x3.codec/zip-edit-zip64` — a ZIP64 end-of-central-directory locator, or an entry whose
  size/offset lives in a ZIP64 extended-information extra field;
- `x3.codec/zip-edit-encrypted` — an entry with the encryption or strong-encryption flag;
- `x3.codec/zip-edit-layout` — data before the first entry (a self-extracting stub), duplicate
  entry paths, a malformed extra field, or a streaming data descriptor that disagrees with the
  central directory.

Results that would themselves need ZIP64 (more than 65535 entries, or more than 4 GiB of output)
are refused too, as is anything beyond the open budget's `maxInputBytes` / `maxNodes`, and a
payload beyond `maxScalarBytes`.
