# Codec implementation workflow

Use for a new format, a version of an existing format, a native writer or a missing codec capability.
This is not a requirement to implement every game subsystem. Current SDK schemas and manifest
generators define the ABI; prose examples and scaffolds do not supersede them.

## Find the format owner

Search repository inventories and manifests, SDK/codec-kit public exports, owner code, tests and
parity receipts across the workspace. Compare signatures, versions, endian/layout, compression,
companions and read/write support. A format may already exist under an engine/middleware name.

Choose reuse, adaptation at that owner or a genuinely new codec. ZIP/PNG/WAV and other common codecs
belong to existing format-neutral extensions; shared primitives belong to codec-kit. Wwise/FMOD
belong to their technology extension packages. Publisher/engine families share one owner; native
game semantics stay with the game. Source-code availability alone does not select Core. Record
upstream provenance and project licensing decisions before using third-party code.

State the exact supported behavior: probe/read/inspect/resolve/edit/verify/export/native encode,
format versions, source topology, environments, budgets and unsupported cases. Keep round-trip
preservation distinct from display/projection. Avoid claiming support based only on file suffixes.

## Implement one openable subject

Use strict TypeScript with the repository's established module/compilation layout. Reuse
`createInspectionCodec` for session/probe/inspection plumbing. Use `defineCodec` and the established
generator where available; keep generated contributions and implementation synchronized.
A manifest may point directly at compiled JS inside its artifact. Empty `codec.js` re-exports are optional; package and verify the full runtime closure. Runtime and
tests use the same built module instance when the repository requires it.

Declare the actual ID, format/profile, match rules, probe/topology, intents, stages, data sources,
operations, representations, runtime variants, permissions and budgets from the current schema.
Detect with bounded signature/structure evidence. XML/JSON/INI-style documents need game/package/path
context or reliable structural evidence; ambiguity must not silently hijack another game's file.
Never use high confidence merely because a filename matches.

Parse through shared bounded primitives. Validate offsets, lengths, counts, endian, multiplication
overflow and resource limits; preserve authored order, identifiers, precision and unknown data needed
for writes. Respect cancellation and disposal. Cache parsing at the owning subject/revision rather
than separately inside each view, completion or operation.

### Containers and namespace formats

Container codecs use `createInspectionCodec` range access (`access: 'ranges'`) and the provided
`byteSource`; do not materialize a multi-gigabyte archive for a small record. Common entry tables,
extraction and nested subject opening own resource access. A partial listing stays partial; exact
path lookup uses the current lookup/find contract where available.

Semantic archive formats declare namespace topology and reuse their container alias. Folder and
archive representations share the same semantic implementation. Companion files use Host resource
ports such as `ResourceSessionPort`; source modules reuse existing range-source/entry helpers.
No embedded MPQ/CASC/ZIP reader, alternative VFS, recursive whole-disk scanner or private unpacker.

### Data and language formats

The codec calls its canonical schema/model/resolver and publishes effective values, provenance,
references and diagnostics. Constants/defaults stay in their native data scope. LSP analysis reuses
the same specification and unsaved document state through common language contributions; no private
language server or separate UI schema.

For XML-like authoring, check schema-dependent root and nested elements, attributes, indexed entries,
allowed value sets and native delimiters. For scripts, check symbols, signatures and dependencies in
the actual context. Include lexical highlighting and bounded incremental completion/validation;
support for one data filename is not support for the format.

### Image, audio, video, model and map formats

Native parsing stays at the format owner. Standard data sources drive shared viewers; they must carry
the native channels/planes, timing, mips, color/alpha conventions or model/material facts required by
the claimed scope. Do not silently discard unsupported features to make a preview look successful.

Resolve textures, audio banks and companions through their codecs and Host resource closure. Use
Host-provided decoding ports where required; codecs do not launch external video/audio processes.
Model export uses the UVM materializer and canonical transforms. Map projection uses current map/UVW
contracts, with independent coordinate and precision proof. Check package closure on export/reopen.
Native encoding is a separate supported capability, with losses/refusals and native acceptance.

## Connect views, knowledge and edits

Expose standard facts/schema/table/card/namespace/media/model/map sources appropriate to the format.
Add actions through operation descriptors and supported surfaces. Keep verification, field help,
navigation, typed edits and preview in shared components; do not add game switches to applications.
Schema/knowledge descriptors document supported fields, bounds, units, enum choices, references,
defaults, origin and edit constraints for both users and AI. Recipes explain discovery and checks,
not a copied parser, schema or hardcoded private operation list.

The native writer is the sole byte-preservation owner. Typed edits use the common writer/edit-plan
and Host coordinator: inspect revision → prepare affected writes → commit → reopen → verify. Refuse
stale, unsupported or unrepresentable edits with a precise reason. Preserve unrelated content and
unknown sections. Multiple writes are atomic only when the common coordinator guarantees that.
Retain source identity, trust/fidelity provenance and the actual receipt; inspect an unknown commit
outcome before retrying. An export operation does not imply a writable native subject.

## Verify the executable claim

Run the owner's actual manifest/module/boundary checks and meaningful compiled-code tests. A scaffold
is a small example, not proof of current TypeScript, manifest-generation or production packaging rules.
Follow current package scripts rather than commands copied from another extension.

At minimum, choose the checks relevant to the change:

- Positive, wrong-format, truncated/unsupported-version inputs and bounded reads/cancellation.
- Real public Host open → inspect/data source/operation, including required companions and context.
- Actual declared Node/browser worker variants and permissions; a Node import must not leak into a
  portable parser. New common exports need the project's worker maps, validators and owning review.
- Native write → reopen/effective result, unrelated/unknown-data preservation, stale refusal and
  supported undo/history. Native Editor/compiler/game validation when that guarantee is claimed.
- Claimed UVM/UVW/export readback, resources, transforms, losses and deterministic output.
- Real-content source discovery and test-tier inclusion. A missing corpus/native backend is
  incomplete acceptance, not a silent skip proving readiness.

Report the exact versions/capabilities verified, source kinds, runtime variants, receipts and
remaining limitations. Follow assigned integration ownership for Core builds, vendor packages and
installed acceptance. Before replacing legacy code, prove its relevant behavior at the replacement
owner and inspect callers; do not remove a capability merely because its implementation is old.
