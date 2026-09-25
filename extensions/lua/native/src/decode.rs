//! Decoding of Lua/Luau numeric and string literal source text into values, per the mapping
//! rules in the caller's contract. Never panics: any malformed input just falls back to "no
//! value" (numbers) or a best-effort byte-for-byte reproduction (strings).

/// Strips a trailing LuaJIT numeric suffix (`ULL`, `LL`, or `I`, case-insensitive) if present.
/// Safe to call unconditionally: these letters cannot otherwise appear at the end of a Number
/// token's text (hex digits are `0-9a-fA-F`, which excludes `i`, `l`, `u`).
fn strip_luajit_suffix(s: &str) -> &str {
    let n = s.len();
    if n >= 3 && s[n - 3..].eq_ignore_ascii_case("ull") {
        return &s[..n - 3];
    }
    if n >= 2 && s[n - 2..].eq_ignore_ascii_case("ll") {
        return &s[..n - 2];
    }
    if n >= 1 && s[n - 1..].eq_ignore_ascii_case("i") {
        return &s[..n - 1];
    }
    s
}

fn hex_digits_as_f64(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    let mut value = 0.0f64;
    for c in s.chars() {
        let d = c.to_digit(16)?;
        value = value * 16.0 + d as f64;
    }
    Some(value)
}

fn binary_digits_as_f64(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    let mut value = 0.0f64;
    for c in s.chars() {
        let d = match c {
            '0' => 0.0,
            '1' => 1.0,
            _ => return None,
        };
        value = value * 2.0 + d;
    }
    Some(value)
}

/// `body` is the hex number text with the `0x`/`0X` prefix and any LuaJIT suffix already
/// removed. Handles hex integers, hex floats with a `.` fraction, and Lua 5.2+ `p`/`P` exponents.
fn parse_hex_number(body: &str) -> Option<f64> {
    let (mantissa, exponent) = match body.find(['p', 'P']) {
        Some(idx) => (&body[..idx], Some(&body[idx + 1..])),
        None => (body, None),
    };
    let (int_part, frac_part) = match mantissa.find('.') {
        Some(idx) => (&mantissa[..idx], Some(&mantissa[idx + 1..])),
        None => (mantissa, None),
    };
    if int_part.is_empty() && frac_part.is_none_or(str::is_empty) {
        return None;
    }

    let mut value = if int_part.is_empty() { 0.0 } else { hex_digits_as_f64(int_part)? };
    if let Some(frac) = frac_part {
        let mut scale = 1.0f64 / 16.0;
        for c in frac.chars() {
            let d = c.to_digit(16)?;
            value += d as f64 * scale;
            scale /= 16.0;
        }
    }
    if let Some(exp_str) = exponent {
        let exp: i32 = exp_str.parse().ok()?;
        value *= 2f64.powi(exp);
    }
    Some(value)
}

/// Best-effort `f64` for a Number token's exact source text (`raw`). Strips Luau `_` separators
/// and LuaJIT suffixes, then dispatches on the `0x`/`0b`/decimal prefix. Returns `None` when the
/// text can't be parsed or the result isn't finite - the caller omits `value` in that case.
pub fn decode_number_value(raw: &str) -> Option<f64> {
    let cleaned: String = raw.chars().filter(|&c| c != '_').collect();
    let bytes = cleaned.as_bytes();

    let value = if bytes.len() >= 2 && bytes[0] == b'0' && matches!(bytes[1], b'x' | b'X') {
        parse_hex_number(strip_luajit_suffix(&cleaned[2..]))
    } else if bytes.len() >= 2 && bytes[0] == b'0' && matches!(bytes[1], b'b' | b'B') {
        binary_digits_as_f64(strip_luajit_suffix(&cleaned[2..]))
    } else {
        strip_luajit_suffix(&cleaned).parse::<f64>().ok()
    };

    value.filter(|v| v.is_finite())
}

/// Encodes a code point as UTF-8, extended per Lua's `\u{...}` escape to accept values up to
/// `0x7FFFFFFF` using the original (pre-RFC3629) up-to-6-byte scheme. Never panics.
fn push_extended_utf8(out: &mut Vec<u8>, cp: u32) {
    if cp < 0x80 {
        out.push(cp as u8);
    } else if cp < 0x800 {
        out.push(0xC0 | (cp >> 6) as u8);
        out.push(0x80 | (cp & 0x3F) as u8);
    } else if cp < 0x1_0000 {
        out.push(0xE0 | (cp >> 12) as u8);
        out.push(0x80 | ((cp >> 6) & 0x3F) as u8);
        out.push(0x80 | (cp & 0x3F) as u8);
    } else if cp < 0x20_0000 {
        out.push(0xF0 | (cp >> 18) as u8);
        out.push(0x80 | ((cp >> 12) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 6) & 0x3F) as u8);
        out.push(0x80 | (cp & 0x3F) as u8);
    } else if cp < 0x400_0000 {
        out.push(0xF8 | (cp >> 24) as u8);
        out.push(0x80 | ((cp >> 18) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 12) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 6) & 0x3F) as u8);
        out.push(0x80 | (cp & 0x3F) as u8);
    } else {
        out.push(0xFC | (cp >> 30) as u8);
        out.push(0x80 | ((cp >> 24) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 18) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 12) & 0x3F) as u8);
        out.push(0x80 | ((cp >> 6) & 0x3F) as u8);
        out.push(0x80 | (cp & 0x3F) as u8);
    }
}

fn push_char_utf8(out: &mut Vec<u8>, c: char) {
    let mut buf = [0u8; 4];
    out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
}

/// Decodes a short-string literal body (the text full-moon captured *between* the quotes, with
/// escapes still in their raw `\` form) into bytes. Covers `\a\b\f\n\r\t\v\\\"\'\`\{`,
/// backslash-newline (LF/CR/CRLF/LFCR collapse to one `\n`), `\ddd`, `\xXX`, `\z`, `\u{XXXX}`.
/// An unrecognized escape keeps the character literally (drops the backslash), per spec.
pub fn decode_short_string(literal: &str) -> Vec<u8> {
    let chars: Vec<char> = literal.chars().collect();
    let n = chars.len();
    let mut out = Vec::with_capacity(literal.len());
    let mut i = 0usize;

    while i < n {
        let c = chars[i];
        if c != '\\' {
            push_char_utf8(&mut out, c);
            i += 1;
            continue;
        }

        if i + 1 >= n {
            out.push(b'\\');
            i += 1;
            continue;
        }

        let e = chars[i + 1];
        match e {
            'a' => {
                out.push(0x07);
                i += 2;
            }
            'b' => {
                out.push(0x08);
                i += 2;
            }
            'f' => {
                out.push(0x0C);
                i += 2;
            }
            'n' => {
                out.push(b'\n');
                i += 2;
            }
            'r' => {
                out.push(b'\r');
                i += 2;
            }
            't' => {
                out.push(b'\t');
                i += 2;
            }
            'v' => {
                out.push(0x0B);
                i += 2;
            }
            '\\' | '"' | '\'' | '`' | '{' => {
                push_char_utf8(&mut out, e);
                i += 2;
            }
            '\n' | '\r' => {
                out.push(b'\n');
                i += 2;
                let other = if e == '\n' { '\r' } else { '\n' };
                if i < n && chars[i] == other {
                    i += 1;
                }
            }
            'z' => {
                i += 2;
                while i < n && chars[i].is_whitespace() {
                    i += 1;
                }
            }
            'x' => {
                let mut j = i + 2;
                let mut val: u32 = 0;
                let mut count = 0;
                while j < n && count < 2 {
                    match chars[j].to_digit(16) {
                        Some(d) => {
                            val = val * 16 + d;
                            j += 1;
                            count += 1;
                        }
                        None => break,
                    }
                }
                if count > 0 {
                    out.push(val as u8);
                    i = j;
                } else {
                    out.push(b'x');
                    i += 2;
                }
            }
            'u' if chars.get(i + 2) == Some(&'{') => {
                let mut j = i + 3;
                let mut val: u32 = 0;
                let mut any = false;
                while j < n && chars[j] != '}' {
                    match chars[j].to_digit(16) {
                        Some(d) => {
                            val = val.saturating_mul(16).saturating_add(d);
                            any = true;
                            j += 1;
                        }
                        None => break,
                    }
                }
                if any && j < n && chars[j] == '}' {
                    push_extended_utf8(&mut out, val);
                    i = j + 1;
                } else {
                    out.push(b'u');
                    i += 2;
                }
            }
            d if d.is_ascii_digit() => {
                let mut j = i + 1;
                let mut val: u32 = 0;
                let mut count = 0;
                while j < n && count < 3 {
                    match chars[j].to_digit(10) {
                        Some(dig) => {
                            val = val * 10 + dig;
                            j += 1;
                            count += 1;
                        }
                        None => break,
                    }
                }
                out.push((val & 0xFF) as u8);
                i = j;
            }
            other => {
                // Unknown escape: keep the character, drop the backslash.
                push_char_utf8(&mut out, other);
                i += 2;
            }
        }
    }

    out
}

/// Decodes a long-string body (`[[...]]` / `[==[...]==]`, no escapes): drops one newline
/// sequence immediately after the opening bracket if present, and normalizes every newline
/// sequence (LF, CR, CRLF, LFCR) to a single `\n`.
pub fn decode_long_string(literal: &str) -> Vec<u8> {
    let mut chars = literal.chars().peekable();

    match chars.peek().copied() {
        Some('\n') => {
            chars.next();
            if chars.peek() == Some(&'\r') {
                chars.next();
            }
        }
        Some('\r') => {
            chars.next();
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
        }
        _ => {}
    }

    let mut out = Vec::with_capacity(literal.len());
    while let Some(c) = chars.next() {
        match c {
            '\n' => {
                out.push(b'\n');
                if chars.peek() == Some(&'\r') {
                    chars.next();
                }
            }
            '\r' => {
                out.push(b'\n');
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
            }
            other => push_char_utf8(&mut out, other),
        }
    }

    out
}

/// Splits decoded bytes into a JSON-safe `value` (UTF-8, lossily-converted if needed) and a
/// `bytesHex` fallback that's only `Some` when the bytes are not valid UTF-8.
pub fn string_value_fields(bytes: &[u8]) -> (String, Option<String>) {
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), None),
        Err(_) => (String::from_utf8_lossy(bytes).into_owned(), Some(to_hex(bytes))),
    }
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0xF) as usize] as char);
    }
    s
}
