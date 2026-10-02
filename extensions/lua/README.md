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

- `src/literal.ts` — static reading of data modules without running them (`readLuaModule`).
- `src/evaluate.ts` (`./evaluate`) — a bounded evaluator of data scripts (decision 30 (b)): loops,
  local functions, closures, metatables, the pure Lua 5.1 library with `string` patterns and
  `format`, `math` (seeded `random`, reported) and `table`; no files, clock or environment. Every
  step counts against `maxSteps`, calls against `maxDepth`, tables and strings against their limits;
  past one the script is refused. A game passes its environment as `globals` (Recoil's `VFS`,
  `lowerkeys`), or runs its own library files first and passes their `globals` table on
  (`globalTable`); `luaValueToStatic` gives the static reader's tree.

Games add knowledge of their environment (Roblox API, WC3 natives, Spring unitdefs) in their own
extensions; a second Lua parser is not written anywhere. A game whose API ships as LuaLS
annotation files (`---@meta` libraries with `---@class`, `---@field`, `---@param`, `---@return`,
`---@enum`, `---@alias`, `---@type`) turns them into its `modkit.lua-environment.json` with
`luaEnvironmentFromAnnotations` (`./luals`), read through this syntax.

Tests: `test/lua-language.test.ts`; `test/lua-corpus.test.ts` reads directories listed in
`MODKIT_LUA_CORPUS` and is skipped without it.
