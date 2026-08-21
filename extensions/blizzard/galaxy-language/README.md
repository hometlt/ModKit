# Galaxy language provider

Reference producer for `common.language/document-analysis@1`. It advertises Galaxy source routes
through a normal service-provider contribution and returns protocol-neutral semantic tokens,
diagnostics and document symbols.

This first contract slice intentionally does not embed an LSP server, workspace index, completion,
hover, rename or watched-file routing. An LSP adapter can translate this provider surface without
making those protocol and workspace concerns dependencies of the SDK contract.
