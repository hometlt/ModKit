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
changes. No common dist or vendor was built over it. Integrator must arrange a clean scoped
build/pack/install and verify actual installed exports before idsoftware imports this new helper.
Do not bypass it with private source imports or a second transform in the extension.

Native coefficient evidence is in idsoftware handoff: 42 WBP tiles, 11800320 coefficient bytes
through Host/RAD, but no inverse-wavelet pixel reconstruction or animated model acceptance yet.
