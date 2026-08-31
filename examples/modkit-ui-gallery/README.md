# Modkit UI gallery

UK-1 conformance harness. Not a mock-up: every card mounts the shipped `ViewerModule` from
`@modkit/ui` through the real `mount/update/unmount` ABI against an in-memory implementation of
the standard data-source contract it consumes. If a viewer regresses, the gallery shows it.

```bash
node scripts/build.mjs           # build into dist/
node scripts/build.mjs --serve   # build and serve on http://localhost:8730
```

Run `pnpm --filter @modkit/ui tokens:emit` first if `packages/ui/styles/modkit-ui.css` is stale.

## What it proves

| Surface         | Proof                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Themes          | `modkit-dark`, `modkit-light`, `modkit-high-contrast`, the VS Code adapter, and "System" (no attribute → `prefers-color-scheme`)                                                |
| VS Code adapter | The page supplies a sample `--vscode-*` set, so the adapter can be exercised outside a webview. Any other theme leaves them undefined and the adapter falls back to its palette |
| Density         | `compact` / `comfortable` swap the row and control metrics                                                                                                                      |
| RTL             | `dir=rtl` flips every logical property; the tree indent moves side                                                                                                              |
| Zoom            | 100% / 200% through a validated token, not a layout hack                                                                                                                        |
| Reduced motion  | Toggle plus the stylesheet's own `prefers-reduced-motion` block                                                                                                                 |
| CSP             | The page runs the production policy. The probe button attempts the two forbidden mechanisms and both are blocked and logged                                                     |
| Parts           | Each card audits its mounted subtree and fails loudly on an unregistered `data-mk-part`                                                                                         |
| Hostile input   | Table rows carry markup and a bidi override; both must render as inert text                                                                                                     |
| Token inspector | Live computed values for all registered tokens under the current theme                                                                                                          |
| Catalog         | Statuses read from the generated UK-A catalog. Planned components are listed, never simulated                                                                                   |

## Catalog snapshot

`src/catalog-snapshot.json` is generated at build time from
`../references/modkit-docs/MK3/uk-a/component-catalog.md`. When that checkout is
absent the snapshot records the reason and the gallery says so. It never invents rows.

## Findings this harness has already caught

- **Cascade bug in the generated stylesheet.** The `prefers-color-scheme: dark` guard enumerated
  theme names inside `:not()`, reaching specificity (0,3,0) and out-specifying every explicit
  `[data-mk-theme='x']` selector at (0,2,0). The OS palette silently pinned itself over any theme
  not named in the guard — `vscode-adapter` rendered dark-palette colours while the host variables
  were present and ignored. Fixed to `:not([data-mk-theme])`, with a regression test.
- Two fixture errors rejected by the viewers themselves: absolute namespace paths, and a transport
  snapshot with no `controls` operation ids.
