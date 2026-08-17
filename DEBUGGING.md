# Debugging Modkit X3 from VS Code

Open `modkitX3` itself as the VS Code workspace, then use **Run and Debug** (`Ctrl+Shift+D`).
Every launch configuration asks which ready extension set to install.

| Configuration                       | What starts                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `Modkit X3: Headless`               | Real Node automation host                                                   |
| `Modkit X3: PWA (Chrome)`           | Local CSP/COOP/COEP server, real Chromium page, service worker and web host |
| `Modkit X3: Electron Adapter`       | Electron main/renderer composition adapter in Node                          |
| `Modkit X3: VS Code Adapter`        | VS Code extension-host/webview composition adapter in Node                  |
| `Modkit X3: Web Composition (Node)` | Web main/worker composition without launching Chrome                        |

The Electron and VS Code entries are deliberately named **Adapter**. The current X3 packages do
not yet contain a `BrowserWindow` executable or VS Code `activate()` entrypoint, so pretending to
launch those processes would make the debug proof dishonest. Breakpoints in their topology,
inventory and resolution code work now; the same launch names can be upgraded when the packaging
shells land.

The Debug Console exposes `globalThis.modkitDebug`. In the PWA it contains the app, workbench,
hydrated extension inputs and selected set. In Node configurations it contains every realm
composition and inventory. Stop the debug session to terminate a waiting Node runner; stop the PWA
background task from **Terminal → Run Task → Terminate Task** if VS Code leaves it running.

Useful tasks:

- `Modkit X3: Application Matrix` — all application/extension-set compatibility cases;
- `Modkit X3: Full Check` — complete repository gate;
- `Modkit X3: Build` — source maps and current `dist` before debugging.
