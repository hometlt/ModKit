# Modkit

**A universal platform for exploring, inspecting, editing, and converting digital assets.**

Modkit brings files, archives, structured data, media, and 3D content into a shared workspace.
It combines a resource explorer, format-aware tools, code editing, visual previews, and automation
so you can follow an asset from its container to its dependencies and exported result.

Use it to inspect an unfamiliar file, work on a game mod, explore a collection of resources,
convert supported assets, or build repeatable processing workflows. Format-specific capabilities
come from extensions; the platform provides the workspace and a consistent way to use them.

## What you can do

### Explore files and archives

- Browse local folders and supported archive formats through one resource explorer.
- Open nested content without managing a separate extraction workflow for every format.
- Inspect resource metadata, detected formats, available operations, and diagnostics.
- Follow related resources and dependencies within the selected workspace.

### Preview and work with assets

- View images and textures, play supported audio and video, and inspect documents.
- Preview 3D models, materials, skeletons, and animation clips.
- Explore supported map and world data through visual layers and object inspection.
- Extract or export resources and convert between formats supported by the loaded extensions.

### Edit code and structured data

- Work with text, scripts, configuration, and format-aware data views.
- Use language features such as diagnostics, completion, navigation, and references where the
  selected language extension provides them.
- Inspect relationships, inherited values, and source provenance when a format exposes them.
- Apply supported edits through revision-aware operations, with undo and redo where available.

### Automate workflows

- Use command-line tools for inspection, conversion, and scripted processing.
- Connect AI assistants through the Model Context Protocol (MCP).
- Use language services through LSP-compatible tools.
- Build headless workflows that use the same format operations as the interactive applications.

Available operations depend on the format, extension, and application configuration. Conversion
can be partial: unsupported features and data loss should be reported rather than hidden.

## Choose your workspace

| Interface                            | Use it for                                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [Desktop application](apps/electron) | A dedicated asset workspace with the resource explorer and visual tools  |
| [Web application](apps/web)          | The browser-based interface and portable asset workflows                 |
| [VS Code extension](apps/vscode)     | Working with assets alongside source code and project files              |
| [Command line](apps/cli)             | Scripted inspection, extraction, conversion, and validation              |
| [MCP server](apps/mcp)               | Giving an AI client access to configured Modkit resources and operations |
| [Language server](apps/lsp)          | Connecting supported language features to editor clients                 |

These interfaces share the platform's resource and operation model. Their available capabilities
still depend on the extensions and permissions configured for that application.

## Extend the platform

Extensions add file formats, archive readers and writers, asset previews, language services,
game integrations, and authoring operations. You can use a general asset workspace or configure
one for a particular project without embedding every game's implementation in the platform.

The repository includes general-purpose extensions for archives, images, vector graphics,
audio, video, models, structured data, and documents. Game-specific support is distributed
separately; the [Blizzard extensions](https://github.com/hometlt/ModKit-Blizzard) are one example.

Applications can load explicitly configured extension directories or use their extension
management interface. An extension's presence does not imply that every version or feature
of its formats is supported; inspect its published operations and diagnostics.

## Build and run from source

Requirements: **Node.js 22 or newer**, **pnpm 10 or newer**, and Git.
Windows x64 is the primary validated development environment; equivalent support on other
operating systems is not yet established.

```sh
git clone https://github.com/hometlt/ModKit.git modkit-core
cd modkit-core
pnpm install --frozen-lockfile
pnpm build
```

After building, start the browser or desktop application:

```sh
# Web application
pnpm --filter @modkit/web-app app:serve

# Desktop application
pnpm --filter @modkit/electron-app start
```

For command-line usage, inspect the built CLI's available commands:

```sh
node apps/cli/dist/main.js --help
```

To use the MCP server, configure an allowed resource root and the required extension packages.
See the [MCP setup guide](apps/mcp/README.md) for stdio startup, content sources, and permissions.
Source builds are development workflows; they are not a promise of a prebuilt installer or
identical feature coverage across applications.

## Work with your own content

Open the folder or project you want to inspect and load the extensions it needs. Game content
is supplied by your own installation or workspace; Modkit does not include commercial game files.
Game integrations can discover supported installations, and host settings can provide explicit
locations when needed.

Start with inspection and previews. Review the target, diagnostics, and any reported loss before
writing or converting assets. File edits, process launches, and other effectful operations follow
the application's configured permissions.

## Development

```sh
pnpm check:fast   # Type checks and the quick test selection
pnpm check        # Full development verification, including builds and broader checks
```

Keep format-specific logic in its extension and reuse shared resource, rendering, and editing
services. Add focused tests for behavioral changes and preserve bounds, cancellation, and
explicit diagnostics. Some integration checks require configured extensions, local content,
or additional development tools.

## Licensing

Licenses are declared by the individual components and their third-party notices. See
[`licenses/README.md`](licenses/README.md). External extensions retain their own licenses;
support for a game's files does not grant rights to the game's content or trademarks.
