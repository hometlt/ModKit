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
separately; the [Blizzard extensions](https://github.com/hometlt/modkit-extensions-blizzard) are one example.

Applications can load explicitly configured extension directories or use their extension
management interface. An extension's presence does not imply that every version or feature
of its formats is supported; inspect its published operations and diagnostics.

## Repositories

GitHub [groups the repositories by topic](https://github.com/search?q=user%3Ahometlt+topic%3Amodkit&type=repositories).
The [extension topic](https://github.com/search?q=user%3Ahometlt+topic%3Amodkit-extension&type=repositories)
shows the separately maintained game and format modules.

| Platform repository | Purpose |
| --- | --- |
| [ModKit](https://github.com/hometlt/ModKit) | Core applications, shared SDK and host services. |
| [Modkit-Registry](https://github.com/hometlt/Modkit-Registry) | Extension catalog data, schemas and signing tools. |
| [modkit-gallery](https://github.com/hometlt/modkit-gallery) | Verified model, animation and map previews. |

| Extension repository | Focus |
| --- | --- |
| [modkit-extensions-annihilation](https://github.com/hometlt/modkit-extensions-annihilation) | Total Annihilation and Spring/Recoil extensions, including Beyond All Reason formats and shared engine codecs. |
| [modkit-extensions-blizzard](https://github.com/hometlt/modkit-extensions-blizzard) | Blizzard extensions for SC2, Warcraft and Diablo: CASC, MPQ, M3, BLP, data, maps and replays. |
| [modkit-extensions-croteam](https://github.com/hometlt/modkit-extensions-croteam) | Serious Sam HD: The First Encounter inspection and read-only unit media conversion. |
| [modkit-extensions-documents](https://github.com/hometlt/modkit-extensions-documents) | Inspection of AI, Blend, CDR, DOCX, Drawio, Figma, PDF, PPTX, PSD, Visio and XLSX documents. |
| [modkit-extensions-dune2000](https://github.com/hometlt/modkit-extensions-dune2000) | Dune 2000 installation discovery, MAP terrain and MIS mission support. |
| [modkit-extensions-ea](https://github.com/hometlt/modkit-extensions-ea) | Electronic Arts, Westwood and SAGE game extensions and file formats. |
| [modkit-extensions-empire-earth](https://github.com/hometlt/modkit-extensions-empire-earth) | Empire Earth SSA archive inspection and extraction. |
| [modkit-extensions-ensemble](https://github.com/hometlt/modkit-extensions-ensemble) | Age of Empires III, Age of Mythology and Halo Wars DE formats. |
| [modkit-extensions-facefx](https://github.com/hometlt/modkit-extensions-facefx) | FaceFX actor and animation-set inspection, facial curves and bounded edits. |
| [modkit-extensions-flash](https://github.com/hometlt/modkit-extensions-flash) | FLA/XFL, FLV, SWF and CFX8 inspection and media extraction. |
| [modkit-extensions-fmod](https://github.com/hometlt/modkit-extensions-fmod) | FMOD FSB sound-bank inspection and supported audio streams. |
| [modkit-extensions-frostgiant](https://github.com/hometlt/modkit-extensions-frostgiant) | Stormgate installation, content and resolved-data support. |
| [modkit-extensions-gas-powered](https://github.com/hometlt/modkit-extensions-gas-powered) | Supreme Commander: Forged Alliance and Supreme Commander 2 formats. |
| [modkit-extensions-idsoftware](https://github.com/hometlt/modkit-extensions-idsoftware) | id Tech 1–4 game formats, including Quake PAK and MDL. |
| [modkit-extensions-luau](https://github.com/hometlt/modkit-extensions-luau) | Optional Luau scripting runtime for Modkit, built from the official VM to WebAssembly. |
| [modkit-extensions-minecraft](https://github.com/hometlt/modkit-extensions-minecraft) | Minecraft Java world, model and asset support for Modkit. |
| [modkit-extensions-nival](https://github.com/hometlt/modkit-extensions-nival) | Heroes of Might and Magic V models, skeletons, animation and textures. |
| [modkit-extensions-petroglyph](https://github.com/hometlt/modkit-extensions-petroglyph) | Petroglyph GlyphX and Grey Goo game content support. |
| [modkit-extensions-ps1](https://github.com/hometlt/modkit-extensions-ps1) | PlayStation 1 CUE/BIN and XA audio inspection. |
| [modkit-extensions-rad](https://github.com/hometlt/modkit-extensions-rad) | Optional RAD Oodle decompression and RAD Game Tools video support. |
| [modkit-extensions-realitypump](https://github.com/hometlt/modkit-extensions-realitypump) | Earth 2150 and Earth 2160 archives, models, animation and map resources. |
| [modkit-extensions-relic](https://github.com/hometlt/modkit-extensions-relic) | Relic Essence formats for Dawn of War I, II and III. |
| [modkit-extensions-renegade](https://github.com/hometlt/modkit-extensions-renegade) | W3D game installation and content-source discovery; models and MIX stay with EA extensions. |
| [modkit-extensions-roblox](https://github.com/hometlt/modkit-extensions-roblox) | Roblox places, models, meshes, animation, terrain and Rojo project support. |
| [modkit-extensions-starship-troopers](https://github.com/hometlt/modkit-extensions-starship-troopers) | Starship Troopers: Terran Command content and game data extension. |
| [modkit-extensions-tindalos](https://github.com/hometlt/modkit-extensions-tindalos) | Battlefleet Gothic: Armada II content and model support. |
| [modkit-extensions-uncapped](https://github.com/hometlt/modkit-extensions-uncapped) | Battle Aces game content, models and native asset preview support. |
| [modkit-extensions-unity](https://github.com/hometlt/modkit-extensions-unity) | Shared Unity Engine readers and asset formats for game extensions. |
| [modkit-extensions-unreal](https://github.com/hometlt/modkit-extensions-unreal) | Unreal Engine packages and content formats for game extensions. |
| [modkit-extensions-valve](https://github.com/hometlt/modkit-extensions-valve) | Half-Life 2 VPK, Source models, VMT materials and VTF textures. |
| [modkit-extensions-warzone](https://github.com/hometlt/modkit-extensions-warzone) | Warzone 2100 game files, models, maps and data. |
| [modkit-extensions-wwise](https://github.com/hometlt/modkit-extensions-wwise) | Wwise BNK and WEM audio plus AKPK/PCK package inspection. |

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
