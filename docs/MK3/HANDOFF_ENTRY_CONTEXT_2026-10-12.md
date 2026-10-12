# Entry metadata for native resources

User authorized the Core model/resource route for Wolfenstein II and optional RAD Oodle changes.
No VSIX, acceptance or other-repository integration was performed.

## Implemented owners

- Core owns `snapshotJson` and JSON data types. Codec-kit root/subpath exports remain compatible
  re-exports; SDK types alias Core. Snapshots reject own accessors without invoking getters, use
  bounded UTF-8/node/depth budgets and preserve old omission/cycle/freeze semantics.
- Codec-kit `ContainerEntry.context` transfers optional inert facts into container layers.
- VFS layered sources carry the context of the same winning archive copy as the returned bytes.
  `ContentSources` and `ModContext` expose optional `readWithContext` with legacy read fallback.
  `ArchiveLayers` implementations expose the new method. Entry providers must keep context immutable
  during the read lease; VFS does not interpret game-specific metadata.
- Host resource origins consume atomic reads and pin a bounded frozen JSON snapshot into
  `ArtifactByteSource.containerContext` and its revision. Subject activation inherits this entry
  context unless an explicit parent context was supplied.

## Verification and remaining scope

Core/SDK/VFS/codec-kit/Host TypeScript build succeeded. Focused owner Vitest: 58/58 in eight files;
standalone codec-kit material-parameter regression: 7/7, no skips. Final dependency lookup rerun
including the added atomic metadata assertion: 2/2. Mandatory finder, pre/post removal audit and
gate review done.

This is the local Host resource route, not a remote RPC API. No new desktop IPC operation or remote
mod-context method was added. Worker metadata transport and actual IDCL → BIMAGE → texdb resources
remain unverified. idsoftware vendor must be updated before using these new declarations.
Wolfenstein II skinning, native clip interpolation, streaming texture lookup, UVM export and the
gallery tab remain incomplete. Do not claim model/render acceptance from parser or tiny mip tests.
