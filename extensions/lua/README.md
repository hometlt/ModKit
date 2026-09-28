# Modkit Lua

The Lua-family language of MK3: Lua 5.1–5.4, LuaJIT, Luau and CfxLua through one syntax tree.

- `native/` — full-moon (Rust) compiled to `wasm/modkit-lua-syntax.wasm` by
  `pnpm build:wasm`; plain C ABI (`lua_parse`, `lua_alloc`, `lua_dealloc`), no wasm-bindgen.
- `src/ast.ts` — AST v1 (draft until the Multiverse Runtime owner agrees): Luau node and field
  names, half-open UTF-16 ranges, literal source text kept (`raw`), comments and a flat token list.
- `src/syntax.ts` — loads the module (Node: file; browser: fetch next to the module) and parses.
- `src/binder.ts` — Lua scoping: locals, upvalues, globals, `self`, labels, Luau types/generics.
- `src/provider.ts` — `common.language/document-analysis` provider for `lua` and `luau`
  (tokens, diagnostics, outline, definition, references, rename, hover). `luau` documents are
  Luau; `lua` documents are Lua 5.4 unless Luau parses them with fewer errors (Roblox keeps Luau
  in `.lua` files). The LSP transport is the shared `apps/lsp` adapter.

Games add knowledge of their environment (Roblox API, WC3 natives, Spring unitdefs) in their own
extensions; a second Lua parser is not written anywhere. A game whose API ships as LuaLS
annotation files (`---@meta` libraries with `---@class`, `---@field`, `---@param`, `---@return`,
`---@enum`, `---@alias`, `---@type`) turns them into its `modkit.lua-environment.json` with
`luaEnvironmentFromAnnotations` (`./luals`), read through this syntax.

Tests: `test/lua-language.test.ts`; `test/lua-corpus.test.ts` reads directories listed in
`MODKIT_LUA_CORPUS` and is skipped without it.
