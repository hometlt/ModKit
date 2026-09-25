//! Rust -> WebAssembly syntax emitter for Modkit's Lua-family AST (`../src/ast.ts`).
//!
//! Plain `#[no_mangle] extern "C"` ABI, no wasm-bindgen. See `lua_parse` for the wire format.

mod convert;
mod decode;

use full_moon::node::Node;
use full_moon::tokenizer::{Lexer, LexerResult, Token, TokenType};
use full_moon::LuaVersion;
use std::fmt::Write as _;

// -------------------------------------------------------------------------------------------
// UTF-16 offset table
// -------------------------------------------------------------------------------------------

/// Maps a UTF-8 byte offset into the source to the corresponding UTF-16 code unit offset.
/// `table[b]` is valid for every `b` in `0..=source.len()`.
pub(crate) struct Utf16Table {
    table: Vec<u32>,
}

impl Utf16Table {
    fn build(src: &str) -> Self {
        let mut table = vec![0u32; src.len() + 1];
        let mut utf16 = 0u32;
        for (byte_idx, ch) in src.char_indices() {
            let utf8_len = ch.len_utf8();
            let unit = utf16;
            for b in 0..utf8_len {
                if let Some(slot) = table.get_mut(byte_idx + b) {
                    *slot = unit;
                }
            }
            utf16 = utf16.saturating_add(ch.len_utf16() as u32);
        }
        if let Some(last) = table.last_mut() {
            *last = utf16;
        }
        Utf16Table { table }
    }

    /// Converts a byte offset to a UTF-16 offset. Out-of-range input (should not happen for
    /// genuine full-moon positions) clamps to the nearest known value rather than panicking.
    fn to_utf16(&self, byte_offset: usize) -> u32 {
        match self.table.get(byte_offset) {
            Some(v) => *v,
            None => self.table.last().copied().unwrap_or(0),
        }
    }

    fn total_utf16_len(&self) -> u32 {
        self.table.last().copied().unwrap_or(0)
    }
}

/// Shared context threaded through the whole conversion pass.
pub(crate) struct Ctx<'a> {
    pub src: &'a str,
    pub table: &'a Utf16Table,
}

impl<'a> Ctx<'a> {
    /// Converts a full-moon node's own (trivia-free) span to a `[start, end)` UTF-16 range.
    /// Nodes with no determinable position (e.g. an empty block) fall back to `[0, 0]`, per
    /// the same convention used for error-recovery phantom tokens.
    pub fn range_of(&self, node: &impl Node) -> (u32, u32) {
        match node.range() {
            Some((s, e)) => (self.table.to_utf16(s.bytes()), self.table.to_utf16(e.bytes())),
            None => (0, 0),
        }
    }

    pub fn utf16(&self, byte_offset: usize) -> u32 {
        self.table.to_utf16(byte_offset)
    }

    pub fn total_utf16_len(&self) -> u32 {
        self.table.total_utf16_len()
    }

    /// Exact source text between two byte offsets. Never panics: an offset that doesn't land on
    /// a char boundary (should not happen for genuine token positions) yields an empty string.
    pub fn raw(&self, start_byte: usize, end_byte: usize) -> &'a str {
        self.src.get(start_byte..end_byte).unwrap_or("")
    }
}

// -------------------------------------------------------------------------------------------
// Hand-rolled JSON writer
// -------------------------------------------------------------------------------------------

pub(crate) fn wstr(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub(crate) fn wnum(out: &mut String, n: u32) {
    let _ = write!(out, "{n}");
}

pub(crate) fn wbool(out: &mut String, b: bool) {
    out.push_str(if b { "true" } else { "false" });
}

pub(crate) fn wrange(out: &mut String, r: (u32, u32)) {
    out.push('[');
    wnum(out, r.0);
    out.push(',');
    wnum(out, r.1);
    out.push(']');
}

/// Writes `,"key":` then invokes `write` to produce the value. Every AST node field after
/// `type`/`range` goes through this, so a leading comma is always correct.
pub(crate) fn field<F: FnOnce(&mut String)>(out: &mut String, key: &str, write: F) {
    out.push_str(",\"");
    out.push_str(key);
    out.push_str("\":");
    write(out);
}

/// Like [`field`], but omits the key/value entirely when `present` is false (optional fields
/// are omitted, never written as `null`, per the ast.ts contract).
pub(crate) fn field_opt<F: FnOnce(&mut String)>(out: &mut String, key: &str, present: bool, write: F) {
    if present {
        field(out, key, write);
    }
}

/// Writes a JSON array, calling `write_item` for each element of `items`.
pub(crate) fn warr<T, I: IntoIterator<Item = T>, F: FnMut(&mut String, T)>(
    out: &mut String,
    items: I,
    mut write_item: F,
) {
    out.push('[');
    let mut first = true;
    for item in items {
        if !first {
            out.push(',');
        }
        first = false;
        write_item(out, item);
    }
    out.push(']');
}

/// Opens a node object: writes `{"type":"<name>","range":[s,e]`. Caller follows with `field`s
/// for the rest, then closes with `out.push('}')`.
pub(crate) fn node_start(out: &mut String, type_name: &str, range: (u32, u32)) {
    out.push_str("{\"type\":\"");
    out.push_str(type_name);
    out.push_str("\",\"range\":");
    wrange(out, range);
}

// -------------------------------------------------------------------------------------------
// Dialects
// -------------------------------------------------------------------------------------------

fn dialect_from_u32(d: u32) -> Option<(LuaVersion, &'static str)> {
    match d {
        0 => Some((LuaVersion::lua51(), "lua51")),
        1 => Some((LuaVersion::lua52(), "lua52")),
        2 => Some((LuaVersion::lua53(), "lua53")),
        3 => Some((LuaVersion::lua54(), "lua54")),
        4 => Some((LuaVersion::luajit(), "luajit")),
        // Pure `LuaVersion::luau()` does not set full-moon's internal "lua52" bit, which also
        // gates hex-float `p` exponents in the lexer (a real Luau feature, unlike goto/labels,
        // which this pulls in too as an accepted side effect - see final report).
        5 => Some((LuaVersion::luau().with_lua52(), "luau")),
        6 => Some((LuaVersion::cfxlua(), "cfxlua")),
        _ => None,
    }
}

// -------------------------------------------------------------------------------------------
// Comments / tokens / errors
// -------------------------------------------------------------------------------------------

fn comment_kind(tt: &TokenType) -> Option<&'static str> {
    match tt {
        TokenType::SingleLineComment { .. } => Some("line"),
        TokenType::MultiLineComment { .. } => Some("block"),
        TokenType::Shebang { .. } => Some("shebang"),
        // full_moon's cfxlua/luau feature-gated variants are unconditionally present here since
        // our Cargo.toml enables both on the `full_moon` dependency; a matching
        // `#[cfg(feature = ...)]` on our own arms would test *this* crate's (nonexistent)
        // features instead and silently compile the arm out.
        TokenType::CStyleComment { .. } => Some("c-style"),
        _ => None,
    }
}

/// Class code order matches `LUA_TOKEN_CLASSES` in ast.ts.
fn token_class(tt: &TokenType) -> Option<u32> {
    match tt {
        TokenType::Identifier { .. } => Some(0),
        TokenType::Number { .. } => Some(2),
        TokenType::StringLiteral { .. } => Some(3),
        TokenType::InterpolatedString { .. } => Some(4),
        TokenType::Symbol { symbol } => {
            let text = symbol.to_string();
            if !text.is_empty() && text.chars().all(|c| c.is_ascii_alphabetic()) {
                Some(1) // keyword
            } else {
                Some(5) // operator
            }
        }
        _ => None,
    }
}

fn collect_lexer_tokens(src: &str, version: LuaVersion) -> Vec<Token> {
    match Lexer::new(src, version).collect() {
        LexerResult::Ok(tokens) => tokens,
        LexerResult::Recovered(tokens, _) => tokens,
        LexerResult::Fatal(_) => Vec::new(),
    }
}

// `warr` writes exactly one value per item; comments/tokens need to *filter* the flat lexer
// token stream first (keep only comments, or only non-trivia/non-EOF tokens), so these two
// loops are written directly instead of forcing that one-write-per-item shape.

fn write_comments_array(out: &mut String, ctx: &Ctx, tokens: &[Token]) {
    out.push('[');
    let mut first = true;
    for tok in tokens {
        let Some(kind) = comment_kind(tok.token_type()) else {
            continue;
        };
        if !first {
            out.push(',');
        }
        first = false;
        out.push_str("{\"kind\":\"");
        out.push_str(kind);
        out.push_str("\",\"range\":");
        wrange(out, (ctx.utf16(tok.start_position().bytes()), ctx.utf16(tok.end_position().bytes())));
        out.push('}');
    }
    out.push(']');
}

fn write_tokens_array(out: &mut String, ctx: &Ctx, tokens: &[Token]) {
    out.push('[');
    let mut first = true;
    for tok in tokens {
        let Some(class) = token_class(tok.token_type()) else {
            continue;
        };
        if !first {
            out.push(',');
        }
        first = false;
        wnum(out, class);
        out.push(',');
        wnum(out, ctx.utf16(tok.start_position().bytes()));
        out.push(',');
        wnum(out, ctx.utf16(tok.end_position().bytes()));
    }
    out.push(']');
}

fn write_errors_array(out: &mut String, ctx: &Ctx, errors: &[full_moon::Error]) {
    warr(out, errors.iter(), |out, e| {
        out.push_str("{\"message\":");
        wstr(out, &e.error_message());
        out.push_str(",\"range\":");
        let (s, en) = e.range();
        wrange(out, (ctx.utf16(s.bytes()), ctx.utf16(en.bytes())));
        out.push('}');
    });
}

// -------------------------------------------------------------------------------------------
// Top-level parse
// -------------------------------------------------------------------------------------------

fn empty_result_json(dialect_name: &str, message: &str) -> String {
    let mut out = String::new();
    out.push_str("{\"version\":1,\"dialect\":\"");
    out.push_str(dialect_name);
    out.push_str("\",\"chunk\":{\"type\":\"AstStatBlock\",\"range\":[0,0],\"body\":[]},\"comments\":[],\"tokens\":[],\"errors\":[{\"message\":");
    wstr(&mut out, message);
    out.push_str(",\"range\":[0,0]}]}");
    out
}

fn parse_to_json(src: &str, version: LuaVersion, dialect_name: &str) -> String {
    let table = Utf16Table::build(src);
    let ctx = Ctx { src, table: &table };

    let result = full_moon::parse_fallible(src, version);
    let lexer_tokens = collect_lexer_tokens(src, version);

    let mut out = String::with_capacity(src.len().saturating_mul(3).max(64));
    out.push_str("{\"version\":1,\"dialect\":\"");
    out.push_str(dialect_name);
    out.push_str("\",\"chunk\":");
    convert::write_chunk(&mut out, &ctx, result.ast());
    out.push_str(",\"comments\":");
    write_comments_array(&mut out, &ctx, &lexer_tokens);
    out.push_str(",\"tokens\":");
    write_tokens_array(&mut out, &ctx, &lexer_tokens);
    out.push_str(",\"errors\":");
    write_errors_array(&mut out, &ctx, result.errors());
    out.push('}');
    out
}

// -------------------------------------------------------------------------------------------
// WASM ABI - no wasm-bindgen, plain extern "C"
// -------------------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn lua_abi_version() -> u32 {
    1
}

/// Peak heap of one parse, measured on generated Luau (1.4 MB → 361 MiB, 3.1 MB → 733 MiB).
const PEAK_HEAP_PER_SOURCE_BYTE: usize = 256;
const MAX_HEAP_RESERVATION: usize = 2 << 30;

/// Grow the heap to the expected peak in one step before parsing.
///
/// The allocator grows linear memory by exactly what it needs, a few pages at a time, and every
/// `memory.grow` costs time proportional to the memory already there (V8: 17 s to reach 700 MiB
/// one page at a time, 2 ms in one step). Allocating the expected peak once and freeing it leaves
/// a block the parse then carves from; memory never shrinks, so later documents reuse it. A
/// refused reservation only means the parse grows as it goes.
fn reserve_heap(src_len: usize) {
    let estimate = src_len.saturating_mul(PEAK_HEAP_PER_SOURCE_BYTE).min(MAX_HEAP_RESERVATION);
    let mut block: Vec<u8> = Vec::new();
    let _ = block.try_reserve_exact(estimate);
}

#[no_mangle]
pub extern "C" fn lua_alloc(len: u32) -> u32 {
    let mut buf: Vec<u8> = Vec::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as u32
}

#[no_mangle]
pub extern "C" fn lua_dealloc(ptr: u32, len: u32) {
    if ptr == 0 {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr as *mut u8, len as usize, len as usize));
    }
}

/// Parses `src_len` bytes of UTF-8 Lua/Luau source at `src_ptr` under the given `dialect` code
/// and returns a pointer to a buffer: 4 bytes little-endian `u32` length `N`, then `N` bytes of
/// UTF-8 JSON (a `LuaParseResult`). The caller frees it with `lua_dealloc(ptr, N + 4)`.
#[no_mangle]
pub extern "C" fn lua_parse(src_ptr: u32, src_len: u32, dialect: u32) -> u32 {
    let bytes: &[u8] = unsafe { std::slice::from_raw_parts(src_ptr as *const u8, src_len as usize) };
    reserve_heap(bytes.len());

    let json = match std::str::from_utf8(bytes) {
        Ok(src) => match dialect_from_u32(dialect) {
            Some((version, name)) => parse_to_json(src, version, name),
            None => empty_result_json("lua51", "unknown dialect code"),
        },
        Err(_) => empty_result_json("lua51", "source is not valid UTF-8"),
    };

    let json_bytes = json.as_bytes();
    let total = 4usize.saturating_add(json_bytes.len());
    let mut buf: Vec<u8> = Vec::with_capacity(total);
    buf.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(json_bytes);

    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as u32
}
