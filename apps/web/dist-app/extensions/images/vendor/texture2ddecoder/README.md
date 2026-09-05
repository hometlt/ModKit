# texture2ddecoder (vendored)

Third-party WebAssembly build of [Perfare's
Texture2DDecoder](https://github.com/Perfare/AssetStudio/tree/master/Texture2DDecoder), packaged as
[`texture2ddecoder-wasm`](https://www.npmjs.com/package/texture2ddecoder-wasm). MIT, see `LICENSE`.

It is here because the legacy MK2 DDS codec decoded BC6H and BC7 through exactly this package
(`references/modkitmk2/packages/image-processing/src/core/gpu-texture-wasm.ts` →
`decode_bc6` / `decode_bc7`), and the port carries the dependency across rather than dropping the
two formats. Byte-identical BC6H/BC7 output against the legacy decoder is only achievable by
running the same implementation: the half-float tone mapping BC6H ends in is an implementation
choice of this library, not something the format specifies.

| file                     | sha256                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `texture2ddecoder.js`    | `0a2b33ff735566fd3184e0421ff38fb7578d1348b3cc44fc4646cce29d001110` |
| `texture2ddecoder.wasm`  | `8b819b0622cce57f809b369081bdd6eca09d1c1793da7f82192db39229356c1d` |
| `LICENSE`                | `49e3169a509b9a5311fe50957a334e9e1975164f27da6004358c22e91e10747c` |

Copied verbatim from `texture2ddecoder-wasm@1.2.2`, files `wasm/texture2ddecoder.js`,
`wasm/texture2ddecoder.wasm` and `LICENSE`. Not reformatted and not linted — the two runtime files
are Emscripten output, and the repository's formatter and linter skip this directory for that
reason. Re-vendoring means replacing the files and updating the digests above.

`../../src/dds/bptc.js` is the only module that loads this runtime.
