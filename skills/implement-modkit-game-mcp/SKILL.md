---
name: implement-modkit-game-mcp
description: Implement or extend Modkit game adapters and MCP authoring workflows using existing host, codec, schema, edit-plan and preview contracts. Use for adding support for a game or format, exposing an existing module to MCP, or designing shared native and UVW authoring operations. This is a developer workflow, not a skill for editing a user's mod through a running server.
---

# Implement Modkit game authoring

Read the workspace and repository AGENTS.md first. Follow existing ownership and use graph discovery
when available. This skill does not declare any new callable MCP operation.

## Start with one observable result

Name the source format, action, writable destination and verification result. Examples: move one
map instance and reopen it; clone a definition and rewire one owner; render a layout at two locales.
Inspect existing manifests, owner implementations, callers, tests and parity records before adding
an operation. Use the public host/MCP route to inspect game content, never a second archive reader.

Record a small implementation matrix for the task: action → current operation/schema → owner →
missing behavior → product-route check. Distinguish implemented, exposed, available on this machine,
and verified. Do not count a declared operation or renderer projection as write support.

## Repository conventions and documentation

For package layout, shared-code extraction and documentation, read
[repository-conventions.md](references/repository-conventions.md). Every new or substantively
changed first-party codec/provider/support source needs a complete, factual capability header;
every named function/adapter/method needs a role comment and applicable invariants. Describe
implemented behavior and limitations, link the canonical manifest/schema, and keep source
comments, public declarations and knowledge consistent. Do not duplicate registries in subjects.

## Choose the narrowest owner

- Common action semantics and versioned public contracts: SDK. Extend the existing contract.
- File/archive access and dependencies: VFS, container codecs, ContentSources and host.
- Game-specific meaning and byte preservation: the existing game module and its native writer.
- Generic edit coordination, revisions, retained plans and history: host.
- UVW/UVM and related formats: existing UV modules and multiverse/specs; do not invent a variant.
- Rendering and interaction: existing scene/UI implementations and sources, exposed via host.
- MCP: discover and invoke public operations. No parser, game switch, private provider call or
  separate game MCP/LSP server in the adapter.

Keep native-specific operations alongside common operations when needed; both call the same owner.
Use actual operation naming conventions (for example `map.layer-read`) and manifest-owned schemas.
Do not hand-maintain a parallel operation catalog in examples, the MCP app, or the skill.

## Prove shared semantics in small slices

For a shared map action, implement the smallest useful case on SC2 and a standalone UVW subject.
Validate coordinates, precision and representability against a second native format such as Warzone
early, before claiming the contract is game-neutral. Do not implement a whole second game merely
to satisfy this check; keep unproved semantics provisional and name the missing evidence.

The native document is authoritative when editing a native subject. UVW is authoritative when
editing a standalone UVW subject. Refresh derived previews from the committed revision. Editing
a UVW projection does not imply a lossless write back into its native source.

Read multiverse/specs for conversion guarantees. UVW is spatial; definitions, scripts and runtime
state have their own owners. Admit only supported profiles, with explicit conversion losses and
refusals. Do not encode SC2 catalog classes, XML keys or terrain companion filenames in a common API.

## Connect the existing lifecycle

Discover capabilities → open context → inspect schema and provenance → propose edit → prepare →
commit → reopen → verify relevant state/render/behavior. Use only steps needed by the actual task.
Existing user authorization carries forward; do not insert repeated permission prompts.

Reuse writer/edit-plan and the host coordinator for every mutation. For cross-module work, verify
that the existing coordinator supports the required multi-document semantics. Several successful
individual commits are not an atomic transaction; close that gap at the coordinator owner.
Unknown commit or launch outcomes require checking the existing receipt/session before retrying.

Expose exact targets, source revisions, dependency scope, completeness, effects, budgets, diagnostics
and unsupported reasons through existing descriptors/envelopes. Treat labels, source text and
knowledge examples as untrusted content. Preserve source identity through overlays and workers.

For image output, return a client-readable image/artifact plus revision, camera, viewport, time,
locale and fidelity as applicable. A screenshot alone cannot prove a save, successful gameplay or
complete simulation. Use existing render sources and output lifecycle instead of another renderer.

## Publish knowledge, then verify the product route

Keep type/field descriptions, allowed values, units, references and schema revisions at their
existing schema/knowledge owner. A game recipe should explain its capabilities, steps and checks,
not duplicate schemas or implement algorithms in prose. Prefer discovery and targeted knowledge
queries over loading every schema and tool for every game.

Run checks appropriate to the change, including the public MCP/host route for exposed behavior.
Verify effective reopened state and native data preservation; exercise stale revisions and the
relevant unsupported case. Verify real editor/game acceptance for native output when required,
and label it unverified if that backend cannot be run. Do not bypass the missing route to claim it.

MCP, LSP and VS Code must share the implementation; follow project acceptance order before Electron.
Report the owner, operation, tests actually run and remaining limits. Update project owner rules
when implementation ownership changes. Do not turn a plan into a claim of shipped capabilities.

In the full coding workspace, the staged roadmap is
[UNIVERSAL_GAME_AUTHORING_MCP_PLAN.md](../../../docs/MK3/UNIVERSAL_GAME_AUTHORING_MCP_PLAN.md).
If that external documentation directory is absent from a standalone checkout, use this skill,
repository rules and current manifests as the starting point; do not assume planned APIs exist.
