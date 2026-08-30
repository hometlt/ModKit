# VS Code live checklist — block 13, work 1 and exit-gate line 3

Exit-gate line 3 of block 13 asks that the live checklist carry **screenshots/logs and
commit/toolchain IDs**. The automated half is `pnpm smoke:vscode` (nine scenarios, five cold
launches, receipt at `reports/vscode-smoke/receipt.json`); this is the half a person has to do,
because it is the half that asks _what the product looks like to someone using it_.

Nothing here re-asks a question the automated matrix already answers. Each step below is either
something no harness can see (does this look right, does it feel like the editor) or something the
harness sees only through CDP and a person sees directly.

## Before starting

Run the automated smoke first — it builds the extension and proves the machine is configured:

```
pnpm --filter @modkitx-x3/modkit-vscode smoke:vscode
```

Then fill in the identity block below. It is the part that makes the rest evidence rather than
anecdote; a checklist without it cannot be compared with the next one.

| Field                                                                                         | Value |
| --------------------------------------------------------------------------------------------- | ----- |
| X3 commit (`git rev-parse HEAD`)                                                              |       |
| Extension version (`apps/vscode/package.json`)                                                |       |
| VS Code version and commit (Help → About)                                                     |       |
| OS and build                                                                                  |       |
| Date, and who ran it                                                                          |       |
| Automated receipt this accompanies (`reports/vscode-smoke/receipt.json` → `subject.x3Commit`) |       |

Screenshots go beside this file, named `<step-id>.png` — for example `S3-explorer-big.png`.
Logs: the **Modkit MK3** output channel (View → Output → Modkit MK3), saved as `<step-id>.log`.

## Corpora

Five source families, the same five the automated matrix walks. Set what you have; a family you
cannot supply is recorded as `environment-required`, not guessed at.

| Family           | Where it comes from                                                   |
| ---------------- | --------------------------------------------------------------------- |
| Common Documents | ships with the repository — nothing to install                        |
| SC2 CASC/MPQ     | a legal StarCraft II install (`MODKITX_SC2_ROOT`)                     |
| C&C BIG          | a legal Kane's Wrath install (`MODKITX_CNC3_KW_ROOT`)                 |
| Warzone `.wz`    | the official free Warzone 2100 distribution (`MODKITX_WARZONE_ROOT`)  |
| BAR Spring VFS   | the official free Beyond All Reason distribution (`MODKITX_BAR_ROOT`) |

---

## S1 — the window describes itself

1. Open the repository folder in VS Code with the Modkit extension loaded.
2. Open the **Modkit** container in the activity bar.

**See:** two native views, `Host` and `Extensions`. `Host` lists the topology, the three realms, the
inventory diagnostic count and a `Facilities` group. `Extensions` lists the bundled catalog.

**Look for:** the `Facilities` group marks each composed facility as honoured or not, and any
facility the page offers that the realm does not compose. Nothing in the editor area draws a Modkit
panel, a Modkit file tree, or a Modkit settings page — all of that is native or absent.

**Capture:** `S1-host-view.png`.

## S2 — a single asset opens as a subject

1. `Modkit: Open Active File in Workbench` on a W3D or VXL model.

**See:** the custom editor shows the working area only — a stage picker and the stage. The file's
identity is VS Code's own tab and breadcrumb, not a second copy drawn inside the page. The status
bar names the subject **workspace-relative**, never as an absolute path.

**Look for:** no drive letter anywhere in the page, the status bar, or the Problems panel.

**Capture:** `S2-single-subject.png`.

## S3 — a container in the native Explorer

1. Open a BIG, an MPQ (`.SC2Map`) or a `.wz` in the custom editor once, so its folder is granted.
2. Run `Modkit: Browse Container in Explorer`.

**See:** the archive appears as a folder in VS Code's **own** Explorer, expandable, with the
container's real directory structure. Not a Modkit tree — the Explorer.

3. Expand two levels and open a member with `Modkit: Open Container Member…` (or Open With → Modkit
   Asset Preview from the Explorer context menu).

**See:** the member opens as a subject in its own right, with its own stages — a model shows a
model, not a hex pane. The status bar names it as `<archive> › <path inside>`.

**Look for:** if the window has no folder open, `Browse Container in Explorer` refuses with a
sentence telling you to open a folder and run it again. That refusal is correct behaviour, not a
bug: adding the first workspace folder restarts the extension host.

**Capture:** `S3-explorer-<family>.png` for each family you have, and `S3-member-subject.png`.

## S4 — the five source families, by hand

For each family you have, do S3 and then run `Modkit: Run Command…` on the container, choosing
**Inspect**.

**See:** a notification naming the command, and the full structured result in the Modkit MK3 output
channel.

**Record, per family:** what opened, which contribution claimed it, and how it felt — instant, a
pause, a spinner that sat. Two families are expected to answer with a _limit_ rather than a subject,
and that is the recorded answer, not a failure:

- **Warzone `.wz`** opens through the generic ZIP route. Warzone's own semantics are still in mk2
  staging and belong to block 17.
- **BAR `.sd7`** is refused by name by the 7z reader (`no contribution claimed this subject`). Spring
  VFS semantics also belong to block 17.

**Capture:** `S4-<family>.png` and `S4-<family>.log`.

## S5 — a command that cannot be served

1. `Modkit: Run Command…` → **Preview** on a PNG or any image.

**See:** a warning naming what is unavailable, with a **What instead?** button that names a route
that would work.

**Look for:** the product says what to do instead. A bare "not supported" is a defect worth
reporting even though the automated fixture passes.

**Capture:** `S5-unavailable.png`.

## S6 — cancellation

1. `Modkit: Run Command…` → **Inspect** on the largest container you have.
2. Press **Cancel** in the progress notification while it runs.

**See:** the notification closes on an answer. The output channel records a result whose code is
`x3.command/cancelled`. The editor stays responsive and the next command works.

**Capture:** `S6-cancel.log`.

## S7 — a broken configuration is reported, not swallowed

1. Add a directory that is not an extension to `modkit.extensions` in workspace settings.
2. Reload the window.

**See:** a warning on activation, the failure listed in the **Extensions** view with its reason, and
the same line in the output channel. The rest of the catalog still loads.

**Capture:** `S7-bad-root.png`.

## S8 — close down

1. Close every Modkit editor.
2. Run any Modkit command.

**See:** the command still answers. Nothing hangs, and the extension host does not need a reload.

---

## Verdict

| Step                       | Pass / Fail / Not attempted | Note |
| -------------------------- | --------------------------- | ---- |
| S1 window describes itself |                             |      |
| S2 single subject          |                             |      |
| S3 container in Explorer   |                             |      |
| S4 five families           |                             |      |
| S5 unavailable command     |                             |      |
| S6 cancellation            |                             |      |
| S7 broken configuration    |                             |      |
| S8 close down              |                             |      |

A FAIL returns the defect to its slice with the screenshot attached, exactly as the block-9 receipt
did — it does not lower the claim.
