# Universal Verse Foundation

**Status:** normative-candidate shared contract, 2026-08-12  
**Owns:** rules reused by two or more UV formats; it is not a file format or package

Individual UV specifications own their semantic payloads and physical mappings. This document owns
the composition protocol between them so UVM, UVW, UVD, UVS, UVR, UVP, UVE, UVT, UVA, UVV, UVF,
UVG and future admitted profiles do not invent incompatible identity, extension, time or loss rules.
Candidate profiles such as UVI and UVY may reference these rules without becoming admitted formats.

## 1. Identity and references

A UV subject may be a file, a manifest with companions, a directory graph, an archive, a remote
streamed hierarchy, a container entry or a logical projection over native content. File paths and
file extensions are locators and detection hints, never identity proof.

A portable reference contains a relative/package/external URI, an optional content digest, the
expected media/profile id and an optional logical locator. Companion files are declared. Locale,
runtime target, quality and representation are selection axes and do not create a new logical
identity. Relative URIs resolve against the owning document or package; network and absolute-file
schemes require an explicit host policy.

Canonical JSON documents expose `{ "uv": { "format": "UVD|UVW|UVS|UVR|…", "version":
"MAJOR.MINOR" } }` at the root. glTF profiles use the same object under `asset.extras.uv`.
Substrate-native binary profiles carry an equivalent marker through their standard metadata
mechanism. The marker assists profile detection; structural validation still proves conformance.

## 2. Extension negotiation and augmentation

UV extensions use publisher-qualified ids of the form `org.<publisher>/<name>@<major>`. A format may
map that logical id onto substrate-native names, such as a glTF extension name, KTX key/value key,
Matroska tag/track, sidecar entry or root JSON `extensions` member.

- `used` means the payload is present but a conforming base projection remains usable.
- `required` means full interpretation needs a compatible provider. A consumer either refuses the
  full operation or returns an explicitly labelled partial projection with diagnostics; it never
  silently claims full conformance.
- Unknown optional payload is ignored semantically but preserved byte-for-byte or structurally by
  an editor that claims preservation/round-trip support.
- Augmentation names the exact target contract/format extension and owner coordinate. Discovery
  order never decides ownership. Override/replace requires an explicit rule and composition order.

An extension may contribute schemas, readers, writers, validators, renderers, editors, conversion
operations and native-preservation records for any UV format. For example, an SC2 extension may add
an M3-specific UVM vocabulary and conversion provider without making the UVM base depend on SC2.
Missing augmentations degrade only their declared semantics; base content remains available when its
own conformance class permits it.

## 3. Canonical JSON and integrity

JSON-based UV forms use the JSON Canonicalization Scheme (RFC 8785) when bytes enter a signature,
content digest, lock, deterministic cache key or network-compatibility root. Parsers reject duplicate
keys and non-finite numbers before canonicalization. Unicode text remains JSON data; path
canonicalization additionally applies NFC where the owning archive specification requires it.

Every digest states its algorithm and domain tag. A parent manifest hashes ordered logical
`(uri, media/profile id, digest)` entries rather than host directory enumeration. Source formatting
may be preserved separately but does not affect runtime compatibility unless a native-preservation
profile explicitly hashes it.

## 4. Shared timeline

The shared timeline primitive is a rational time base plus integer ticks, ranges, markers, tracks,
references and typed event envelopes. Authored seconds are provenance, not synchronized state.
Every synchronized compiler declares its quantization mode (`exact`, `ceil`, `floor` or
`nearest-ties-even`) and records the time profile, compiler contract/version and field table.

UVM clips, UVT sequences, UVA cues, UVV tracks, UVS logic, UVG/UVI/UVY animation and replay projections
map to this contract. A format may use its substrate-native timestamps, but its UV profile documents
the lossless mapping or emits a loss record. Presentation clocks never feed deterministic simulation.

## 5. Native representations, provenance and loss

Conversion follows:

```text
native representation + normalized UV projection + provenance/loss receipt
```

The receipt identifies source format/version/digest, provider contract/version, options, preserved
native payloads and structured losses. A round-trip claim is one of `equivalent`, `partial` or
`reference-only`, scoped to a declared operation/profile; it is never inferred from successful
parsing. Game- and tool-specific data stays in publisher-qualified UV extensions or native
representations rather than being forced into a universal DTO.

## 6. Conformance vocabulary

Format maturity and implementation support are independent axes:

1. `reserved` — id and boundary accepted;
2. `specified` — complete normative text exists;
3. `schema` — machine-readable validation exists where applicable;
4. `fixtures` — positive, negative and preservation fixtures exist;
5. `validated` — executable validator passes the suite;
6. `reader`, `writer`, `round-trip` — operation-specific implementation evidence;
7. `stable` — published compatibility promise.

No whole-format “supported” label substitutes for operation/profile/runtime evidence. The family
registry records maturity without turning a stub into an implementation claim.

## 7. Security baseline

All consumers apply input, recursion, allocation, decompression and reference-fetch budgets.
Executable authority is never inferred from a media format: UVE activation, UVP script-hosting, UVG
or UVI scripting, codecs and native libraries each require their owning host policy. External URLs,
embedded fonts/media, XML/SVG entities and archive entries are untrusted input.
