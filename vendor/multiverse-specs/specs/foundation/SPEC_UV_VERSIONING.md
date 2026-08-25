# UV versioning and negotiation

**Status:** normative for the profiles this seed carries, 2026-08-25
**Owns:** how a UV consumer decides what it is looking at, what it may do with it, and what it must refuse

This document collects the version rules that were previously stated per format
([SPEC_UVM §18](../model/SPEC_UVM.md#18-versioning-and-compatibility)) or implied by
[SPEC_UV_FOUNDATION §2](SPEC_UV_FOUNDATION.md#2-extension-negotiation-and-augmentation) and
[§6](SPEC_UV_FOUNDATION.md#6-conformance-vocabulary), so that a second UV profile does not have to
re-derive them and reach a different answer.

## 1. Four independent version axes

A consumer that collapses these into one number will be wrong about at least one of them.

| Axis                | Where it lives                                         | Who may change it            |
| ------------------- | ------------------------------------------------------ | ---------------------------- |
| Profile version     | `uv.version` in the format's identity marker            | the owning format spec       |
| Extension version   | the extension's own `version` property                 | the extension's publisher    |
| Schema version      | the `$id` of the JSON Schema                           | this repository              |
| Semantic scope version | `scopeId` + `version` in the scope descriptor        | this repository              |

A file at profile 1.0 may carry an extension at version 3, validate against a schema published at
`.../1.0/...`, and be compared under a scope at 1.0.0. None of those numbers implies any of the
others.

## 2. Profile versions

- A profile version is `MAJOR.MINOR`.
- **Minor is additive only**: new optional properties, new extensions, new registered enum values. A
  1.0 reader reads a 1.3 file correctly by ignoring what it does not know.
- **Major may remove or redefine.** A reader **MUST** refuse a major version it does not implement
  rather than guessing. Refusing is the conforming behaviour, not a failure.
- Unregistered enum values **MUST** be preserved on round-trip and **MUST** fall back to the
  documented default for rendering.
- The identity marker is a detection hint, never proof: structural validation still decides
  conformance ([SPEC_UV_FOUNDATION §1](SPEC_UV_FOUNDATION.md#1-identity-and-references)).

### 2.1 A profile name is not a maturity level

`core`, `full` and a game profile name (`m3`, `spring`, `w3d`) select *which* semantics a document
claims, not *how much* of it a reader supports. A reader that implements UVM/core refuses a
`full`-profile document rather than reading the part it recognises: a partial read that reports
success is the failure mode the whole conformance vocabulary exists to prevent.

## 3. Extension negotiation

Restating [SPEC_UV_FOUNDATION §2](SPEC_UV_FOUNDATION.md#2-extension-negotiation-and-augmentation)
because it is the rule most often got wrong:

- `used` — the payload is present and a conforming base projection remains usable.
- `required` — full interpretation needs a compatible provider. A consumer either refuses the full
  operation or returns an **explicitly labelled** partial projection with diagnostics. It never
  silently claims full conformance.
- Unknown optional payload is ignored semantically but preserved byte-for-byte or structurally by an
  editor that claims preservation.
- An extension present in `extensions` but absent from `extensionsUsed`, or declared in
  `extensionsUsed` but absent from `extensions`, is a malformed document in both directions.

## 4. Schema versions

- A schema `$id` is a stable identifier, not a location. The `https://modkitx.org/uv*/…` and
  `https://multiverse.engine/spec/…` identifiers currently in this repository are unpublished draft
  identifiers; hosting and permanence remain an open item (see [NOTES](../NOTES.md)).
- A schema is never edited in place under the same `$id` in a way that rejects a document it
  previously accepted. Tightening requires a new `$id`.

## 5. Semantic scope versions

A semantic scope carries a full `MAJOR.MINOR.PATCH` because it is compared, not parsed.

- **Minor and patch are additive**: a new optional facet, a new accepted digest algorithm, a new
  enum value. A 1.0.0 consumer keeps producing 1.0.0 hashes.
- **Major may remove or redefine a facet.**
- Two hashes are comparable only when scope id, scope version, the present facet set, the absent
  facet set and — where the scope has one — the resource-closure mode all match. There is no partial
  match and no tolerance: see
  [SPEC_SEMANTIC_SCOPE_DESCRIPTOR](../semantic-scopes/SPEC_SEMANTIC_SCOPE_DESCRIPTOR.md).
- Until a descriptor is registered, the scope name is not a release or compatibility guarantee. A
  pinned candidate descriptor may be used for admission-only reports and for nothing else.

## 6. Maturity is a separate vocabulary

Format maturity and implementation support are independent axes
([SPEC_UV_FOUNDATION §6](SPEC_UV_FOUNDATION.md#6-conformance-vocabulary)): `reserved`, `specified`,
`schema`, `fixtures`, `validated`, then the operation-specific rungs `reader`, `writer`,
`round-trip`, and finally `stable`.

No whole-format "supported" label substitutes for operation, profile and runtime evidence. The
registry in [`../README.md`](../README.md) records maturity precisely so that a reserved id cannot
be mistaken for an implementation.
