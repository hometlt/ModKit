# Third-party notices

`wasm/modkit-lua-syntax.wasm` is compiled from `native/` (built by `scripts/build-wasm.mjs`,
dependencies pinned in `native/Cargo.lock`). It contains the following crates.

| Crate | Version | License | Source |
| --- | --- | --- | --- |
| full_moon | 2.2.0 | MPL-2.0 | https://github.com/Kampfkarren/full-moon (unmodified; source on crates.io) |
| smol_str | 0.3.6 | MIT OR Apache-2.0 | https://github.com/rust-analyzer/smol_str |
| bytecount | 0.6.9 | Apache-2.0 OR MIT | https://github.com/llogiq/bytecount |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if |
| hashbrown, indexmap, bytes, borsh, serde | see `native/Cargo.lock` | MIT OR Apache-2.0 (bytes: MIT) | crates.io, when linked by the crates above |

Compile-time only (procedural macros, not in the binary): full_moon_derive (MPL-2.0),
derive_more (MIT), paste, syn, quote, proc-macro2, unicode-ident, unicode-xid, autocfg,
cfg_aliases (MIT OR Apache-2.0; unicode-ident also Unicode-3.0).

full-moon is used unmodified under MPL-2.0; its source is available from crates.io and the
repository above. The Modkit code around it (`native/src`, `src`) is MIT.
