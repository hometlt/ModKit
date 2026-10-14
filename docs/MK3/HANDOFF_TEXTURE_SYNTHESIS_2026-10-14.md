# CDF97 synthesis — source implementation, integration pending

User-authorized native W2 texture work needs a common bounded inverse transform. Finder verified
there was no existing public CDF9/7 implementation. The sole owner is now
`packages/codec-kit/src/texture/cdf97.ts`, exported by the existing texture index (no new subpath).

The helper takes four equal finite bordered scalar bands and an explicit low-resolution window.
It emits doubled Float64 pixels; allocation element budgets and cancellation are explicit.
Mathematical synthesis is default. A profile may explicitly change the LH vertical odd last tap
offset from2 to1; native coefficient layout, quantization, channel assembly and tile placement
stay outside this common owner. No BC encoder or native writer was added.

Source-only tests cover DC, impulse bands, numerical profile expectations, border/band budgets,
nonfinite values, overflow and pre-cancellation. Public dist/worker/native pixels are NOT verified.
The existing `@modkit/codec-kit/texture` worker route remains; bundler/runtime closure must include
the new relative module when building the common artifact.

Core contains unrelated uncommitted work, including codec-kit legacy material and web subject
changes. No common live dist was built over it. idsoftware built codec-kit from a clean git archive
of `bab4dd6beff84e35dc7cee46c9e16b4728223824` in C:/MKTEMP with references disabled (existing public
peer declarations), packed exact peer versions and updated only its codec-kit vendor. Frozen/offline
install and its root/idtech6 builds pass; installed cdf97 JS/declarations match candidate bytes.
The existing public texture export is used, not a private source import. Common live dist/browser
worker integration remains the Integrator's pending scope; no VSIX/acceptance was rebuilt.

Native pixel receipt is now `C:/MKTEMP/idsoftware-idtech6/installation-2026-10-14T15-30-27-366Z/receipt.json`:
WBP Soldier normal mips2048/1024/512 decoded through Host/RAD + public CDF97. 512px atlas viewed
against native BC5 256px mip; no visible seams. This is RGBA preview without BC requantization,
not numerical native oracle or full-resolution proof (mip0 missing). Extension serial100/100 tests.
Animated model/UVM/gallery acceptance is still incomplete.
