# SemanticScopeDescriptor

**Status:** normative, 2026-08-25
**Owns:** what a named semantic scope must fix before its name may be used as a guarantee
**Registry:** [`registry.json`](registry.json) · **Schema:** [`semantic-scope-descriptor.v1.schema.json`](semantic-scope-descriptor.v1.schema.json)

## 1. The problem a scope solves

When a live projection and a materialized-then-reopened artifact are compared, three different
quantities are available and they are routinely confused:

1. `artifactCanonicalDigest` — a digest of canonical bytes. Only a materialized artifact has one.
2. `projectionSemanticHash(scope)` — a hash of every facet inside a **named** semantic scope.
3. `presentationSemanticHash(scope)` — a hash of the presentation subset only. It is not evidence
   about skeleton, animation, collision, navigation or runtime round-trip.

Only the second is evidence that two paths carry the same semantics, and it is evidence only
because the scope is named. An unnamed "semantic hash" is an opinion: the two sides can always
disagree about what was in it.

A descriptor exists so that the sentence "the hashes matched" has exactly one meaning. There is no
"matched within losses". Anything a materializer does not carry is enumerated in a
`MaterializationReceipt`, not absorbed into a tolerance.

## 2. What a descriptor must fix

A registered descriptor fixes all of the following. The
[schema](semantic-scope-descriptor.v1.schema.json) requires every one of them, so an incomplete
descriptor cannot be registered by accident.

| Field                | Fixes                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| `scopeId`, `version` | the name and the comparability boundary                                           |
| `facets[]`           | the exact facet IDs, versions and whether each is required or optional            |
| `facets[].keys`      | the canonical encoding of each facet value                                        |
| `ordering`           | the deterministic order of every collection that reaches the hash                  |
| `numeric`            | the numeric model, widening, negative zero and non-finite handling                 |
| `missingSemantics`   | what absent, null, empty and unknown each mean, and that they are all different    |
| `resourceClosure`    | logical identity, algorithm-qualified content digests, and which mode is in force  |
| `hash`               | the canonical form, the domain tag, the envelope and the algorithm                 |
| `bindings`           | the live contract and the artifact profile the scope is computable from **today**  |
| `compatibility`      | what a minor may change, what a major may change, and when two hashes may be compared |

## 3. Rules every scope obeys

1. **Paging never reaches the hash.** A live source pages; a hash must not depend on how. Every
   collection the descriptor names is re-sorted by its declared key before encoding.
2. **Sequence order is preserved where it is semantic.** `childIds` is a sequence; reversing it is a
   different model. The descriptor says which collections are sets-by-id and which are sequences.
   Nothing is left to the implementation's taste.
3. **Absent is not empty and neither is null.** An optional facet the publisher did not publish is
   named in `absentFacets`; a known-empty collection is `[]`; a source member that genuinely has no
   value is `null`. All three produce different hashes, which is the point.
4. **A facet is never faked.** A missing plane is declared missing. Substituting an empty or default
   value would make a hash comparison succeed while the semantics differ, which is worse than a
   failure.
5. **The facet set is part of the hash.** Two hashes are comparable only when both sides published
   the same facet set. A publisher that omits an optional facet gets a different hash, honestly,
   rather than an accidental match against a richer publisher.
6. **Digests are algorithm-qualified.** `sha256:<hex>`. A bare hex string is refused rather than
   assumed.
7. **Resource-closure mode is hashed.** A logical hash and a content-qualified hash of the same
   model differ by construction, so the two can never be compared by accident.
8. **The scope is computable today.** `bindings` names the real contract and the real artifact
   profile it is derived from. A descriptor whose facets have no binding is a plan, not a scope, and
   the registry marks it `reserved` instead.

## 4. Registration

- `reserved` — the id and its owning block are fixed; no descriptor exists. The name carries no
  guarantee and must not appear in a release statement.
- `candidate` — a pinned descriptor used for admission-only reports. It is not a compatibility
  guarantee.
- `registered` — a complete descriptor with conformance vectors. Only this state may be named in a
  release or compatibility statement.

Registration requires conformance vectors that pin **both** equality and inequality. A suite that
only proves two identical inputs hash identically proves nothing about what the scope separates;
each registered scope therefore carries near-miss vectors for ordering, absence, closure mode and
numeric handling.

## 5. Registered scopes

| Scope                       | Status     | Descriptor                                              | Vectors                                                          |
| --------------------------- | ---------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `model-interchange-v1`      | registered | [descriptor](model-interchange-v1.json)                 | [vectors](../conformance/model-interchange-v1/vectors.json)      |
| `world-interchange-v1`      | reserved   | —                                                       | —                                                                |
| `definition-interchange-v1` | reserved   | —                                                       | —                                                                |

## 6. `model-interchange-v1` at a glance

Six facets, three of them required:

| Facet                        | Requirement | Live binding today                                    |
| ---------------------------- | ----------- | ----------------------------------------------------- |
| `uv.model/structure@1`       | required    | `common.view/model-scene-source@1` · `info()`          |
| `uv.model/hierarchy@1`       | required    | `common.view/model-scene-source@1` · `nodes(page)`     |
| `uv.model/mesh-index@1`      | required    | `common.view/model-scene-source@1` · `meshes(page)`    |
| `uv.model/bounds@1`          | optional    | `common.view/model-scene-source@1` · `info().bounds`   |
| `uv.model/geometry@1`        | optional    | `common.view/model-scene-source@1` · `primitive(id, …)`|
| `uv.model/resource-closure@1`| optional    | none yet — the live path needs the `ResourceSessionPort` |

Everything above the last row is computable today from the admitted base contract, unchanged, and
from a UVM/core 1.0 artifact. The last row is honest about the gap rather than describing a
contract that does not exist: a live publisher declares the facet absent until the resource port is
frozen, and the artifact binding is executable now.

The scope deliberately does **not** cover materials, skeleton, sockets, effects, collision, LOD or
variants. Those planes have no admitted live source yet; adding them to the scope would make every
hash unreproducible in exchange for a longer table.
