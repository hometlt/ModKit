# UV canonicalization

**Status:** normative for the profiles this seed carries, 2026-08-25
**Owns:** which canonical form applies to which quantity, and the exact encoding of each
**Machine form:** [`uv-canonical-form.v1.json`](uv-canonical-form.v1.json)
**Reference implementation:** [`../tools/uv-canonical.mjs`](../tools/uv-canonical.mjs)
**Vectors:** [`../conformance/canonical-form/vectors.json`](../conformance/canonical-form/vectors.json)

[SPEC_UV_FOUNDATION §3](SPEC_UV_FOUNDATION.md#3-canonical-json-and-integrity) states the rule for
canonical *document bytes*. This document adds the rule for canonical *value graphs* and, more
importantly, says which of the two applies where. Both existed in the pre-seed material; neither
was wrong, and the seed keeps both rather than collapsing them into one and quietly changing a
digest.

## 1. Two forms, two quantities, never interchangeable

| Quantity                       | Canonical form               | Input                                    |
| ------------------------------ | ---------------------------- | ---------------------------------------- |
| `artifactCanonicalDigest`      | RFC 8785 (JCS)               | the bytes of a canonical JSON document   |
| `projectionSemanticHash(scope)`| `uv.canonical/typed-form@1`  | the facet value graph a scope declares   |
| `presentationSemanticHash(scope)`| `uv.canonical/typed-form@1`| the presentation subset a scope declares  |
| proof and composition roots    | `uv.canonical/typed-form@1`  | the proof value the producing spec fixes |

The two forms answer different questions. JCS answers "are these two documents the same document",
which is a question about serialization, and it is the right answer for a signature over a file
that a third party will re-serialize. The typed form answers "are these two *projections* the same
semantics", which is a question about values that may never have been a document at all: a live
faceted projection has no bytes to canonicalize.

A digest of one kind is never compared with a digest of the other. They are separate fields with
separate names in every receipt for exactly this reason.

## 2. `uv.canonical/typed-form@1`

The form is a total, type-tagged text encoding of a JSON-shaped value graph.

| Value    | Encoding                                                                          |
| -------- | --------------------------------------------------------------------------------- |
| null     | `["null"]`                                                                        |
| boolean  | `["boolean",true]` / `["boolean",false]`                                          |
| number   | `["number","<16 lowercase hex digits>"]` — the big-endian IEEE-754 binary64 bits   |
| string   | `["string",<JSON string literal>]`                                                |
| array    | `["array",[<encoded element>,…]]` in publication order                            |
| object   | `["object",[[<JSON key literal>,<encoded value>],…]]` with keys sorted by UTF-8 bytes |

Rules:

1. **Type tags are load-bearing.** `["number","401c000000000000"]` and `["string","7"]` cannot
   collide, and neither can an empty object and an empty array. A form without tags lets two
   different values reach the same digest, which is the one failure mode a semantic hash may not
   have.
2. **Numbers are bit patterns, not decimals.** There is one numeric type, binary64. `0.1 + 0.2` and
   `0.30000000000000004` are the same value and hash identically; `0.3` does not. A float32 value
   widens to binary64 exactly, so decoded attribute data hashes stably without a requantisation step.
3. **`-0` normalises to `+0`** before encoding.
4. **NaN and infinity are rejected.** A value graph that would carry one is a diagnostic, never a
   digest. There is no "treat NaN as null" fallback.
5. **Object keys sort by UTF-8 byte order**, with a UTF-16 code-unit tie-break that only ever
   applies to ill-formed input. Insertion order never reaches the digest.
6. **Array order is preserved.** Where order is not semantic, the *producing spec* sorts before
   encoding — the form never sorts an array on the producer's behalf, because it cannot know
   whether the order meant something.
7. **Cycles and `undefined` are rejected**, so an accidental object graph cannot be encoded as if it
   were a tree.

## 3. Digest envelope

Every UV digest is taken over a domain-tagged envelope, never over a bare value:

```text
digest = "sha256:" + hex( SHA-256( typedForm( { schemaVersion, domain, value } ) ) )
```

- `domain` names what is being hashed (`uv.semantic-scope/model-interchange-v1`,
  `uv.model/geometry-attributes@1`, …). Two different quantities that happen to hold the same value
  therefore never collide.
- `schemaVersion` lets the envelope itself change without silently reusing a digest.
- The output is **algorithm-qualified**: `sha256:<64 hex>`. A bare hex string is not a UV digest and
  a conforming consumer refuses it rather than assuming SHA-256. This is what makes a future
  algorithm change visible in every artifact instead of a flag day.

## 4. Provenance of this form

The encoding is not new here. It is the form the executable World-v0 proof roots already used
(`packages/world/src/canonical.ts` in the sealed legacy tree), lifted unchanged so that a digest
produced against this specification and a digest produced by the sealed implementation agree.

The agreement is recorded as data, not as a claim:
[`../conformance/canonical-form/vectors.json`](../conformance/canonical-form/vectors.json) carries
the canonical text and the digest of every accept vector, and its `differentialOracle` block records
that both implementations produced them. Any third implementation can be checked against the vectors
without access to either.
