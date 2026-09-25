//! Walks a full-moon `Ast` and writes it as a `LuaParseResult["chunk"]` JSON value (`ast.ts`).
//!
//! Two shapes exist in the contract: nodes with a `"type"` discriminant (`node_start`/`field`),
//! and "plain" records with no discriminant (`AstName`, `AstLocal`, `AstAttr`,
//! `AstExprTableItem`, `AstGenericType(Pack)`, `AstTableProp`, `AstTableIndexer`, `AstTypeList`),
//! written by hand at each call site.
//!
//! full-moon's `TypeInfo` flattens what the contract splits into `AstType` vs `AstTypePack`;
//! `write_type_or_pack` dispatches on the variant and produces whichever shape fits.

use crate::decode;
use crate::{field, field_opt, node_start, warr, wbool, wrange, wstr, Ctx};

use full_moon::ast::lua54::Attribute;
use full_moon::ast::luau::{
    ElseIfExpression, GenericDeclaration, GenericDeclarationParameter, GenericParameterInfo,
    IfExpression, IndexedTypeInfo, InterpolatedString, LuauAttribute, TypeDeclaration, TypeField,
    TypeFieldKey, TypeFunction, TypeInfo, TypeInstantiation, TypeSpecifier,
};
use full_moon::ast::{
    Ast, Block, Call, Expression, Field, FunctionArgs, FunctionBody, FunctionDeclaration,
    FunctionName, GenericFor, Index, LastStmt, NumericFor, Parameter, Prefix, Stmt, Suffix,
    TableConstructor, Var,
};
use full_moon::node::Node;
use full_moon::tokenizer::{StringLiteralQuoteType, Symbol, TokenReference, TokenType};
use std::fmt::Write as _;

// -------------------------------------------------------------------------------------------
// Small shared helpers
// -------------------------------------------------------------------------------------------

/// Byte `(start, end)` of a node's own span, `(0, 0)` when undeterminable (matches the [0,0]
/// convention used for the UTF-16 range fallback).
fn byte_range_of(n: &impl Node) -> (usize, usize) {
    match n.range() {
        Some((s, e)) => (s.bytes(), e.bytes()),
        None => (0, 0),
    }
}

fn text_of(tok: &TokenReference) -> String {
    tok.token().to_string()
}

/// `AstName` / `AstAttr`: both are exactly `{name, range}`.
fn write_name(out: &mut String, name: &str, range: (u32, u32)) {
    out.push_str("{\"name\":");
    wstr(out, name);
    out.push_str(",\"range\":");
    wrange(out, range);
    out.push('}');
}

/// `AstLocal`: `{name, range, annotation?, isConst?, attribute?}`.
fn write_local(
    out: &mut String,
    ctx: &Ctx,
    name: &str,
    range: (u32, u32),
    annotation: Option<&TypeInfo>,
    is_const: bool,
    attribute: Option<&str>,
) {
    out.push_str("{\"name\":");
    wstr(out, name);
    out.push_str(",\"range\":");
    wrange(out, range);
    if let Some(ann) = annotation {
        field(out, "annotation", |out| write_type_or_pack(out, ctx, ann));
    }
    if is_const {
        field(out, "isConst", |out| wbool(out, true));
    }
    if let Some(attr) = attribute {
        field(out, "attribute", |out| wstr(out, attr));
    }
    out.push('}');
}

fn write_attr(out: &mut String, ctx: &Ctx, a: &LuauAttribute) {
    let range = (
        ctx.utf16(byte_range_of(a.at_sign()).0),
        ctx.utf16(byte_range_of(a.name()).1),
    );
    write_name(out, &text_of(a.name()), range);
}

// -------------------------------------------------------------------------------------------
// Entry point / blocks
// -------------------------------------------------------------------------------------------

pub fn write_chunk(out: &mut String, ctx: &Ctx, ast: &Ast) {
    let range = (0u32, ctx.total_utf16_len());
    node_start(out, "AstStatBlock", range);
    field(out, "body", |out| {
        warr(out, block_items(ast.nodes()), |out, item| write_stat_item(out, ctx, item));
    });
    out.push('}');
}

enum StatRef<'a> {
    Stmt(&'a Stmt),
    Last(&'a LastStmt),
}

fn block_items(block: &Block) -> impl Iterator<Item = StatRef<'_>> {
    block.stmts().map(StatRef::Stmt).chain(block.last_stmt().map(StatRef::Last))
}

fn write_stat_item(out: &mut String, ctx: &Ctx, item: StatRef) {
    match item {
        StatRef::Stmt(s) => write_stmt(out, ctx, s),
        StatRef::Last(l) => write_last_stmt(out, ctx, l),
    }
}

/// A body block's range is `[end of the token that opens it, start of the token that closes
/// it]`, not its own (possibly empty) span - see the caller's contract, rule 2.
fn write_block_with_bounds(out: &mut String, ctx: &Ctx, block: &Block, open_end_byte: usize, close_start_byte: usize) {
    let range = (ctx.utf16(open_end_byte), ctx.utf16(close_start_byte));
    node_start(out, "AstStatBlock", range);
    field(out, "body", |out| {
        warr(out, block_items(block), |out, item| write_stat_item(out, ctx, item));
    });
    out.push('}');
}

// -------------------------------------------------------------------------------------------
// Statements
// -------------------------------------------------------------------------------------------

fn write_stmt(out: &mut String, ctx: &Ctx, stmt: &Stmt) {
    match stmt {
        Stmt::Assignment(a) => {
            let range = ctx.range_of(a);
            node_start(out, "AstStatAssign", range);
            field(out, "vars", |out| warr(out, a.variables().iter(), |out, v| write_var(out, ctx, v)));
            field(out, "values", |out| warr(out, a.expressions().iter(), |out, e| write_expr(out, ctx, e)));
            out.push('}');
        }
        Stmt::Do(d) => {
            let range = ctx.range_of(d);
            node_start(out, "AstStatDo", range);
            field(out, "body", |out| {
                write_block_with_bounds(out, ctx, d.block(), byte_range_of(d.do_token()).1, byte_range_of(d.end_token()).0);
            });
            out.push('}');
        }
        Stmt::FunctionCall(fc) => {
            let range = ctx.range_of(fc);
            node_start(out, "AstStatExpr", range);
            field(out, "expr", |out| {
                let suffixes: Vec<&Suffix> = fc.suffixes().collect();
                write_chain(out, ctx, fc.prefix(), byte_range_of(fc.prefix()).0, &suffixes);
            });
            out.push('}');
        }
        Stmt::FunctionDeclaration(fd) => write_function_declaration(out, ctx, fd),
        Stmt::GenericFor(g) => write_generic_for(out, ctx, g),
        Stmt::If(i) => write_if_chain(
            out,
            ctx,
            byte_range_of(i.if_token()).0,
            i.condition(),
            byte_range_of(i.then_token()).1,
            i.block(),
            i.else_if().map(|v| v.as_slice()).unwrap_or(&[]),
            i.else_token(),
            i.else_block(),
            i.end_token(),
        ),
        Stmt::LocalAssignment(l) => {
            let range = ctx.range_of(l);
            node_start(out, "AstStatLocal", range);
            field(out, "vars", |out| {
                let specs: Vec<Option<&TypeSpecifier>> = l.type_specifiers().collect();
                let attrs: Vec<Option<&Attribute>> = l.attributes().collect();
                write_local_vars(out, ctx, l.names().iter(), specs.into_iter(), attrs.into_iter(), false);
            });
            field(out, "values", |out| warr(out, l.expressions().iter(), |out, e| write_expr(out, ctx, e)));
            out.push('}');
        }
        Stmt::LocalFunction(lf) => {
            let range = ctx.range_of(lf);
            node_start(out, "AstStatLocalFunction", range);
            field(out, "name", |out| write_local(out, ctx, &text_of(lf.name()), ctx.range_of(lf.name()), None, false, None));
            field(out, "func", |out| {
                let func_range = (ctx.utf16(byte_range_of(lf.local_token()).0), ctx.utf16(byte_range_of(lf.body().end_token()).1));
                let debugname = text_of(lf.name());
                write_function_expr(out, ctx, func_range, lf.attributes(), lf.body().generics(), lf.body(), None, Some(&debugname));
            });
            out.push('}');
        }
        Stmt::NumericFor(n) => write_numeric_for(out, ctx, n),
        Stmt::Repeat(r) => {
            let range = ctx.range_of(r);
            node_start(out, "AstStatRepeat", range);
            field(out, "body", |out| {
                write_block_with_bounds(out, ctx, r.block(), byte_range_of(r.repeat_token()).1, byte_range_of(r.until_token()).0);
            });
            field(out, "condition", |out| write_expr(out, ctx, r.until()));
            out.push('}');
        }
        Stmt::While(w) => {
            let range = ctx.range_of(w);
            node_start(out, "AstStatWhile", range);
            field(out, "condition", |out| write_expr(out, ctx, w.condition()));
            field(out, "body", |out| {
                write_block_with_bounds(out, ctx, w.block(), byte_range_of(w.do_token()).1, byte_range_of(w.end_token()).0);
            });
            out.push('}');
        }
        Stmt::CompoundAssignment(c) => {
            let range = ctx.range_of(c);
            node_start(out, "AstStatCompoundAssign", range);
            field(out, "op", |out| wstr(out, map_compound_op(c.compound_operator())));
            field(out, "var", |out| write_var(out, ctx, c.lhs()));
            field(out, "value", |out| write_expr(out, ctx, c.rhs()));
            out.push('}');
        }
        Stmt::ConstAssignment(c) => {
            let range = ctx.range_of(c);
            node_start(out, "AstStatLocal", range);
            field(out, "vars", |out| {
                let specs: Vec<Option<&TypeSpecifier>> = c.type_specifiers().collect();
                write_local_vars(out, ctx, c.names().iter(), specs.into_iter(), std::iter::repeat(None), true);
            });
            field(out, "values", |out| warr(out, c.expressions().iter(), |out, e| write_expr(out, ctx, e)));
            out.push('}');
        }
        Stmt::ConstFunction(cf) => {
            let range = ctx.range_of(cf);
            node_start(out, "AstStatLocalFunction", range);
            field(out, "name", |out| write_local(out, ctx, &text_of(cf.name()), ctx.range_of(cf.name()), None, true, None));
            field(out, "func", |out| {
                let func_range = (ctx.utf16(byte_range_of(cf.const_token()).0), ctx.utf16(byte_range_of(cf.body().end_token()).1));
                let debugname = text_of(cf.name());
                write_function_expr(out, ctx, func_range, cf.attributes(), cf.body().generics(), cf.body(), None, Some(&debugname));
            });
            out.push('}');
        }
        Stmt::ExportedTypeDeclaration(etd) => {
            let range = ctx.range_of(etd);
            write_type_alias(out, ctx, range, etd.type_declaration(), true);
        }
        Stmt::TypeDeclaration(td) => {
            let range = ctx.range_of(td);
            write_type_alias(out, ctx, range, td, false);
        }
        Stmt::ExportedTypeFunction(etf) => {
            let range = ctx.range_of(etf);
            write_type_function_stmt(out, ctx, range, etf.type_function(), true);
        }
        Stmt::TypeFunction(tf) => {
            let range = ctx.range_of(tf);
            write_type_function_stmt(out, ctx, range, tf, false);
        }
        Stmt::Goto(g) => {
            let range = ctx.range_of(g);
            node_start(out, "AstStatGoto", range);
            field(out, "label", |out| write_name(out, &text_of(g.label_name()), ctx.range_of(g.label_name())));
            out.push('}');
        }
        Stmt::Label(l) => {
            let range = ctx.range_of(l);
            node_start(out, "AstStatLabel", range);
            field(out, "name", |out| write_name(out, &text_of(l.name()), ctx.range_of(l.name())));
            out.push('}');
        }
        other => write_empty_block_fallback(out, ctx, other),
    }
}

fn write_empty_block_fallback(out: &mut String, ctx: &Ctx, n: &impl Node) {
    // Dead code for full-moon 2.2.0 with our fixed feature set: every variant above is
    // handled. Kept only because these enums are `#[non_exhaustive]`. `AstStatBlock` is a
    // valid `AstStat` on its own, so this is a harmless, contract-shaped no-op.
    let range = ctx.range_of(n);
    node_start(out, "AstStatBlock", range);
    field(out, "body", |out| out.push_str("[]"));
    out.push('}');
}

fn write_last_stmt(out: &mut String, ctx: &Ctx, l: &LastStmt) {
    match l {
        LastStmt::Break(tok) => {
            node_start(out, "AstStatBreak", ctx.range_of(tok));
            out.push('}');
        }
        LastStmt::Continue(tok) => {
            node_start(out, "AstStatContinue", ctx.range_of(tok));
            out.push('}');
        }
        LastStmt::Return(ret) => {
            let range = ctx.range_of(ret);
            node_start(out, "AstStatReturn", range);
            field(out, "list", |out| warr(out, ret.returns().iter(), |out, e| write_expr(out, ctx, e)));
            out.push('}');
        }
        other => write_empty_block_fallback(out, ctx, other),
    }
}

fn write_generic_for(out: &mut String, ctx: &Ctx, g: &GenericFor) {
    let range = ctx.range_of(g);
    node_start(out, "AstStatForIn", range);
    field(out, "vars", |out| {
        let specs: Vec<Option<&TypeSpecifier>> = g.type_specifiers().collect();
        write_local_vars(out, ctx, g.names().iter(), specs.into_iter(), std::iter::repeat(None), false);
    });
    field(out, "values", |out| warr(out, g.expressions().iter(), |out, e| write_expr(out, ctx, e)));
    field(out, "body", |out| {
        write_block_with_bounds(out, ctx, g.block(), byte_range_of(g.do_token()).1, byte_range_of(g.end_token()).0);
    });
    out.push('}');
}

fn write_numeric_for(out: &mut String, ctx: &Ctx, n: &NumericFor) {
    let range = ctx.range_of(n);
    node_start(out, "AstStatFor", range);
    field(out, "var", |out| {
        let ann = n.type_specifier().map(TypeSpecifier::type_info);
        write_local(out, ctx, &text_of(n.index_variable()), ctx.range_of(n.index_variable()), ann, false, None);
    });
    field(out, "from", |out| write_expr(out, ctx, n.start()));
    field(out, "to", |out| write_expr(out, ctx, n.end()));
    field_opt(out, "step", n.step().is_some(), |out| write_expr(out, ctx, n.step().unwrap()));
    field(out, "body", |out| {
        write_block_with_bounds(out, ctx, n.block(), byte_range_of(n.do_token()).1, byte_range_of(n.end_token()).0);
    });
    out.push('}');
}

/// Shared by `LocalAssignment`, `ConstAssignment`, `NumericFor` and `GenericFor` variable lists.
fn write_local_vars<'a>(
    out: &mut String,
    ctx: &Ctx,
    names: impl Iterator<Item = &'a TokenReference>,
    mut type_specs: impl Iterator<Item = Option<&'a TypeSpecifier>>,
    mut attrs: impl Iterator<Item = Option<&'a Attribute>>,
    is_const: bool,
) {
    out.push('[');
    let mut first = true;
    for tok in names {
        if !first {
            out.push(',');
        }
        first = false;
        let ann = type_specs.next().flatten().map(TypeSpecifier::type_info);
        let attr = attrs.next().flatten().map(|a| text_of(a.name()));
        write_local(out, ctx, &text_of(tok), ctx.range_of(tok), ann, is_const, attr.as_deref());
    }
    out.push(']');
}

fn write_function_declaration(out: &mut String, ctx: &Ctx, fd: &FunctionDeclaration) {
    let range = ctx.range_of(fd);
    node_start(out, "AstStatFunction", range);
    field(out, "name", |out| write_function_decl_name(out, ctx, fd.name()));
    field(out, "func", |out| {
        let func_range = (
            ctx.utf16(byte_range_of(fd.function_token()).0),
            ctx.utf16(byte_range_of(fd.body().end_token()).1),
        );
        let implicit_self = fd.name().method_colon().map(|c| ctx.range_of(c));
        let (ds, de) = byte_range_of(fd.name());
        let debugname = ctx.raw(ds, de);
        write_function_expr(out, ctx, func_range, fd.attributes(), fd.body().generics(), fd.body(), implicit_self, Some(debugname));
    });
    out.push('}');
}

fn write_function_decl_name(out: &mut String, ctx: &Ctx, fname: &FunctionName) {
    let names: Vec<&TokenReference> = fname.names().iter().collect();
    match names.split_first() {
        Some((first, rest)) => {
            let start = byte_range_of(*first).0;
            write_dotted_chain(out, ctx, first, start, rest, fname.method_name());
        }
        None => {
            // Grammar guarantees at least one name; never actually hit.
            node_start(out, "AstExprConstantNil", (0, 0));
            out.push('}');
        }
    }
}

fn write_dotted_chain(
    out: &mut String,
    ctx: &Ctx,
    first: &TokenReference,
    start_byte: usize,
    rest: &[&TokenReference],
    method_name: Option<&TokenReference>,
) {
    if let Some(method) = method_name {
        let range = (ctx.utf16(start_byte), ctx.utf16(byte_range_of(method).1));
        node_start(out, "AstExprIndexName", range);
        field(out, "expr", |out| write_dotted_chain(out, ctx, first, start_byte, rest, None));
        field(out, "index", |out| wstr(out, &text_of(method)));
        field(out, "indexLocation", |out| wrange(out, ctx.range_of(method)));
        field(out, "op", |out| wstr(out, ":"));
        out.push('}');
        return;
    }

    match rest.split_last() {
        None => write_name_expr(out, ctx, first),
        Some((last, rest2)) => {
            let range = (ctx.utf16(start_byte), ctx.utf16(byte_range_of(*last).1));
            node_start(out, "AstExprIndexName", range);
            field(out, "expr", |out| write_dotted_chain(out, ctx, first, start_byte, rest2, None));
            field(out, "index", |out| wstr(out, &text_of(last)));
            field(out, "indexLocation", |out| wrange(out, ctx.range_of(*last)));
            field(out, "op", |out| wstr(out, "."));
            out.push('}');
        }
    }
}

// -------------------------------------------------------------------------------------------
// `elseif` chains (statement `AstStatIf`, shared shape with the expression version below)
// -------------------------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn write_if_chain(
    out: &mut String,
    ctx: &Ctx,
    own_start_byte: usize,
    condition: &Expression,
    then_end_byte: usize,
    block: &Block,
    next_elseifs: &[full_moon::ast::ElseIf],
    else_token: Option<&TokenReference>,
    else_block: Option<&Block>,
    shared_end_token: &TokenReference,
) {
    let range = (ctx.utf16(own_start_byte), ctx.utf16(byte_range_of(shared_end_token).1));
    node_start(out, "AstStatIf", range);
    field(out, "condition", |out| write_expr(out, ctx, condition));
    field(out, "thenbody", |out| {
        let body_end_byte = match (next_elseifs.first(), else_token) {
            (Some(next), _) => byte_range_of(next.else_if_token()).0,
            (None, Some(et)) => byte_range_of(et).0,
            (None, None) => byte_range_of(shared_end_token).0,
        };
        write_block_with_bounds(out, ctx, block, then_end_byte, body_end_byte);
    });
    let has_elsebody = !next_elseifs.is_empty() || else_block.is_some();
    field_opt(out, "elsebody", has_elsebody, |out| {
        if let Some((first, rest)) = next_elseifs.split_first() {
            write_if_chain(
                out,
                ctx,
                byte_range_of(first.else_if_token()).0,
                first.condition(),
                byte_range_of(first.then_token()).1,
                first.block(),
                rest,
                else_token,
                else_block,
                shared_end_token,
            );
        } else if let Some(eb) = else_block {
            let open = else_token.map(|t| byte_range_of(t).1).unwrap_or(0);
            write_block_with_bounds(out, ctx, eb, open, byte_range_of(shared_end_token).0);
        }
    });
    out.push('}');
}

// -------------------------------------------------------------------------------------------
// Var (assignment targets) / suffix-chain folding
// -------------------------------------------------------------------------------------------

fn write_var(out: &mut String, ctx: &Ctx, v: &Var) {
    match v {
        Var::Name(tok) => write_name_expr(out, ctx, tok),
        Var::Expression(ve) => {
            let suffixes: Vec<&Suffix> = ve.suffixes().collect();
            write_chain(out, ctx, ve.prefix(), byte_range_of(ve.prefix()).0, &suffixes);
        }
        _ => {
            node_start(out, "AstExprConstantNil", (0, 0));
            out.push('}');
        }
    }
}

fn write_name_expr(out: &mut String, ctx: &Ctx, tok: &TokenReference) {
    let range = ctx.range_of(tok);
    node_start(out, "AstExprName", range);
    field(out, "name", |out| wstr(out, &text_of(tok)));
    out.push('}');
}

fn write_prefix_alone(out: &mut String, ctx: &Ctx, prefix: &Prefix) {
    match prefix {
        Prefix::Name(tok) => write_name_expr(out, ctx, tok),
        Prefix::Expression(e) => write_expr(out, ctx, e),
        _ => {
            node_start(out, "AstExprConstantNil", (0, 0));
            out.push('}');
        }
    }
}

/// Folds `prefix` plus `suffixes` left-to-right into nested `AstExprIndexName` /
/// `AstExprIndexExpr` / `AstExprCall` nodes, each spanning `[prefix_start, this suffix's end]`
/// (rule 5). Implemented by recursing from the *last* suffix inward, since each step wraps
/// everything before it.
fn write_chain(out: &mut String, ctx: &Ctx, prefix: &Prefix, prefix_start: usize, suffixes: &[&Suffix]) {
    let Some((last, rest)) = suffixes.split_last() else {
        write_prefix_alone(out, ctx, prefix);
        return;
    };

    match *last {
        Suffix::Index(Index::Dot { name, .. }) => {
            let range = (ctx.utf16(prefix_start), ctx.utf16(byte_range_of(*last).1));
            node_start(out, "AstExprIndexName", range);
            field(out, "expr", |out| write_chain(out, ctx, prefix, prefix_start, rest));
            field(out, "index", |out| wstr(out, &text_of(name)));
            field(out, "indexLocation", |out| wrange(out, ctx.range_of(name)));
            field(out, "op", |out| wstr(out, "."));
            out.push('}');
        }
        Suffix::Index(Index::Brackets { expression, .. }) => {
            let range = (ctx.utf16(prefix_start), ctx.utf16(byte_range_of(*last).1));
            node_start(out, "AstExprIndexExpr", range);
            field(out, "expr", |out| write_chain(out, ctx, prefix, prefix_start, rest));
            field(out, "index", |out| write_expr(out, ctx, expression));
            out.push('}');
        }
        Suffix::Call(Call::AnonymousCall(args)) => {
            let (type_args, rest2): (Option<&TypeInstantiation>, &[&Suffix]) = match rest.split_last() {
                Some((Suffix::TypeInstantiation(ti), r2)) => (Some(ti), r2),
                _ => (None, rest),
            };
            let range = (ctx.utf16(prefix_start), ctx.utf16(byte_range_of(*last).1));
            node_start(out, "AstExprCall", range);
            field(out, "func", |out| write_chain(out, ctx, prefix, prefix_start, rest2));
            write_call_args_fields(out, ctx, args, false, type_args);
            out.push('}');
        }
        Suffix::Call(Call::MethodCall(mc)) => {
            let range = (ctx.utf16(prefix_start), ctx.utf16(byte_range_of(*last).1));
            node_start(out, "AstExprCall", range);
            field(out, "func", |out| {
                let inner_range = (ctx.utf16(prefix_start), ctx.utf16(byte_range_of(mc.name()).1));
                node_start(out, "AstExprIndexName", inner_range);
                field(out, "expr", |out| write_chain(out, ctx, prefix, prefix_start, rest));
                field(out, "index", |out| wstr(out, &text_of(mc.name())));
                field(out, "indexLocation", |out| wrange(out, ctx.range_of(mc.name())));
                field(out, "op", |out| wstr(out, ":"));
                out.push('}');
            });
            write_call_args_fields(out, ctx, mc.args(), true, mc.type_instantiation());
            out.push('}');
        }
        // A type instantiation not immediately followed by a call (invalid Luau, or the tail of
        // the chain): nothing in the contract can hold it standalone, so it's dropped and the
        // chain continues as if it weren't there.
        _ => write_chain(out, ctx, prefix, prefix_start, rest),
    }
}

fn write_call_args_fields(out: &mut String, ctx: &Ctx, args: &FunctionArgs, is_self: bool, type_instantiation: Option<&TypeInstantiation>) {
    field(out, "args", |out| match args {
        FunctionArgs::Parentheses { arguments, .. } => {
            warr(out, arguments.iter(), |out, e| write_expr(out, ctx, e));
        }
        FunctionArgs::String(tok) => {
            out.push('[');
            write_string_literal_expr(out, ctx, tok);
            out.push(']');
        }
        FunctionArgs::TableConstructor(tc) => {
            out.push('[');
            write_table_expr(out, ctx, tc);
            out.push(']');
        }
        _ => out.push_str("[]"),
    });
    field(out, "self", |out| wbool(out, is_self));
    let (style, loc): (&str, (u32, u32)) = match args {
        FunctionArgs::Parentheses { parentheses, .. } => ("parens", ctx.range_of(parentheses)),
        FunctionArgs::String(tok) => ("string", ctx.range_of(tok)),
        FunctionArgs::TableConstructor(tc) => ("table", ctx.range_of(tc)),
        _ => ("parens", (0, 0)),
    };
    field(out, "argStyle", |out| wstr(out, style));
    field(out, "argLocation", |out| wrange(out, loc));
    if let Some(ti) = type_instantiation {
        field(out, "typeArguments", |out| {
            warr(out, ti.types().iter(), |out, t| write_type_or_pack(out, ctx, t));
        });
    }
}

// -------------------------------------------------------------------------------------------
// Expressions
// -------------------------------------------------------------------------------------------

/// Iteratively unwraps a run of same-precedence `BinaryOperator` nodes (as full-moon's parser
/// always produces for `a op b op c op ...`) into a base expression plus an ordered list of
/// `(operator, shallow-side operand)` links, innermost link first. Most operators are
/// left-associative (left-deep: `lhs` is the (n-1)-deep rest of the chain, `rhs` is a single
/// shallow term), but `..` and `^` are right-associative in Lua (right-deep: mirror image) - see
/// `BinOp::is_right_associative`. Whichever direction is deep, this only walks it (a plain loop,
/// not recursion): O(depth), touching every sub-expression exactly once.
fn flatten_binop_chain(expr: &Expression) -> (bool, &Expression, Vec<(&full_moon::ast::BinOp, &Expression)>) {
    let right_assoc = matches!(expr, Expression::BinaryOperator { binop, .. } if binop.is_right_associative());
    let mut links: Vec<(&full_moon::ast::BinOp, &Expression)> = Vec::new();
    let mut current = expr;
    loop {
        match current {
            Expression::BinaryOperator { lhs, binop, rhs } if binop.is_right_associative() == right_assoc => {
                if right_assoc {
                    links.push((binop, lhs.as_ref()));
                    current = rhs.as_ref();
                } else {
                    links.push((binop, rhs.as_ref()));
                    current = lhs.as_ref();
                }
            }
            _ => break,
        }
    }
    links.reverse(); // links[0] = innermost (nearest base), links[last] = outermost
    (right_assoc, current, links)
}

/// Rebuilds the nested `AstExprBinary` JSON from a flattened chain. `anchor` is the chain's
/// single deep-end boundary (the base's start for a left-deep chain, its end for a right-deep
/// one), computed once by the caller and shared by every level. Each level's *other* boundary
/// comes from that level's own shallow operand - cheap, since a shallow operand is never itself
/// part of this deep spine. O(1) work per link, O(depth) total for the whole chain.
///
/// Deliberately iterative, not recursive (open pass outermost -> innermost, then the base, then
/// a close pass innermost -> outermost): a chain of any length must not risk the wasm engine's
/// native call-stack limit - confirmed to matter, a recursive version hit "Maximum call stack
/// size exceeded" on a 4000-term chain, well within real generated-code sizes.
fn write_binop_chain(out: &mut String, ctx: &Ctx, right_assoc: bool, base: &Expression, anchor: u32, links: &[(&full_moon::ast::BinOp, &Expression)]) {
    for &(binop, shallow) in links.iter().rev() {
        let shallow_range = ctx.range_of(shallow);
        let range = if right_assoc { (shallow_range.0, anchor) } else { (anchor, shallow_range.1) };
        node_start(out, "AstExprBinary", range);
        field(out, "op", |out| wstr(out, map_binop(binop)));
        if right_assoc {
            field(out, "left", |out| write_expr(out, ctx, shallow));
            out.push_str(",\"right\":"); // filled by the next (inner) iteration, or the base
        } else {
            out.push_str(",\"left\":"); // filled by the next (inner) iteration, or the base
        }
    }

    write_expr(out, ctx, base);

    for &(_binop, shallow) in links.iter() {
        if right_assoc {
            out.push('}');
        } else {
            out.push_str(",\"right\":");
            write_expr(out, ctx, shallow);
            out.push('}');
        }
    }
}

fn write_expr(out: &mut String, ctx: &Ctx, expr: &Expression) {
    // BinaryOperator chains (`a .. b .. c .. ...`, very real in generated code that builds up
    // strings or expressions) are left-deep for most operators, right-deep for `..`/`^`: either
    // way, one side of the outermost node is itself a whole (n-1)-deep chain. full-moon's
    // derived `start_position()`/`end_position()` finds a node's boundary by recursing into the
    // relevant field, so on a chain it walks the *entire* deep spine down to the base - an
    // O(depth) cost *per call*. Since our own recursion visits every node on that spine too,
    // naively calling `ctx.range_of` at each of those `depth` levels costs
    // O(depth) + O(depth-1) + ... + O(1) = O(depth^2) overall, which is quadratic in the chain
    // length alone (confirmed: ~900ms for a 4000-term `..` chain, scaling worse than linearly).
    // Handled separately here: flatten the chain iteratively (one O(depth) pass, no redundant
    // re-walks), then rebuild the nested JSON using the shared deep-end boundary plus each
    // link's own (shallow, non-chain) operand - O(depth) total.
    if matches!(expr, Expression::BinaryOperator { .. }) {
        let (right_assoc, base, links) = flatten_binop_chain(expr);
        let base_range = ctx.range_of(base);
        let anchor = if right_assoc { base_range.1 } else { base_range.0 };
        write_binop_chain(out, ctx, right_assoc, base, anchor, &links);
        return;
    }

    let range = ctx.range_of(expr);
    match expr {
        Expression::Parentheses { expression, .. } => {
            node_start(out, "AstExprGroup", range);
            field(out, "expr", |out| write_expr(out, ctx, expression));
            out.push('}');
        }
        Expression::UnaryOperator { unop, expression } => {
            node_start(out, "AstExprUnary", range);
            field(out, "op", |out| wstr(out, map_unop(unop)));
            field(out, "expr", |out| write_expr(out, ctx, expression));
            out.push('}');
        }
        Expression::Function(anon) => {
            write_function_expr(out, ctx, range, anon.attributes(), anon.body().generics(), anon.body(), None, None);
        }
        Expression::FunctionCall(fc) => {
            let suffixes: Vec<&Suffix> = fc.suffixes().collect();
            write_chain(out, ctx, fc.prefix(), byte_range_of(fc.prefix()).0, &suffixes);
        }
        Expression::IfExpression(ie) => write_if_expr_chain(out, ctx, ie),
        Expression::InterpolatedString(is) => write_interp_string(out, ctx, range, is),
        Expression::TableConstructor(tc) => write_table_expr(out, ctx, tc),
        Expression::Number(tok) => write_number_expr(out, ctx, tok),
        Expression::String(tok) => write_string_literal_expr(out, ctx, tok),
        Expression::Symbol(tok) => write_symbol_expr(out, ctx, range, tok),
        Expression::TypeAssertion { expression, type_assertion } => {
            node_start(out, "AstExprTypeAssertion", range);
            field(out, "expr", |out| write_expr(out, ctx, expression));
            field(out, "annotation", |out| write_type_or_pack(out, ctx, type_assertion.cast_to()));
            out.push('}');
        }
        Expression::Var(Var::Name(tok)) => write_name_expr(out, ctx, tok),
        Expression::Var(Var::Expression(ve)) => {
            let suffixes: Vec<&Suffix> = ve.suffixes().collect();
            write_chain(out, ctx, ve.prefix(), byte_range_of(ve.prefix()).0, &suffixes);
        }
        _ => {
            node_start(out, "AstExprConstantNil", range);
            out.push('}');
        }
    }
}

fn write_symbol_expr(out: &mut String, ctx: &Ctx, range: (u32, u32), tok: &TokenReference) {
    let _ = ctx;
    if tok.is_symbol(Symbol::Nil) {
        node_start(out, "AstExprConstantNil", range);
        out.push('}');
    } else if tok.is_symbol(Symbol::True) || tok.is_symbol(Symbol::False) {
        node_start(out, "AstExprConstantBool", range);
        field(out, "value", |out| wbool(out, tok.is_symbol(Symbol::True)));
        out.push('}');
    } else if tok.is_symbol(Symbol::Ellipsis) {
        node_start(out, "AstExprVarargs", range);
        out.push('}');
    } else {
        // full-moon only ever builds Expression::Symbol from nil/true/false/...
        node_start(out, "AstExprConstantNil", range);
        out.push('}');
    }
}

fn write_number_expr(out: &mut String, ctx: &Ctx, tok: &TokenReference) {
    let range = ctx.range_of(tok);
    let (s, e) = byte_range_of(tok);
    let raw = ctx.raw(s, e);
    node_start(out, "AstExprConstantNumber", range);
    field(out, "raw", |out| wstr(out, raw));
    if let Some(v) = decode::decode_number_value(raw) {
        field(out, "value", |out| {
            let _ = write!(out, "{v:?}");
        });
    }
    out.push('}');
}

struct DecodedString<'a> {
    raw: &'a str,
    value: String,
    bytes_hex: Option<String>,
    quote_style: &'static str,
}

fn decode_string_token<'a>(ctx: &Ctx<'a>, tok: &TokenReference) -> DecodedString<'a> {
    let (s, e) = byte_range_of(tok);
    let raw = ctx.raw(s, e);
    match tok.token_type() {
        TokenType::StringLiteral { literal, quote_type, .. } => {
            let (quote_style, bytes) = match quote_type {
                StringLiteralQuoteType::Double => ("double", decode::decode_short_string(literal.as_str())),
                StringLiteralQuoteType::Single => ("single", decode::decode_short_string(literal.as_str())),
                StringLiteralQuoteType::Brackets => ("long", decode::decode_long_string(literal.as_str())),
                StringLiteralQuoteType::Backtick => ("backtick", decode::decode_short_string(literal.as_str())),
                _ => ("double", decode::decode_short_string(literal.as_str())),
            };
            let (value, bytes_hex) = decode::string_value_fields(&bytes);
            DecodedString { raw, value, bytes_hex, quote_style }
        }
        _ => DecodedString { raw, value: String::new(), bytes_hex: None, quote_style: "double" },
    }
}

fn write_string_literal_expr(out: &mut String, ctx: &Ctx, tok: &TokenReference) {
    let range = ctx.range_of(tok);
    let d = decode_string_token(ctx, tok);
    node_start(out, "AstExprConstantString", range);
    field(out, "raw", |out| wstr(out, d.raw));
    field(out, "quoteStyle", |out| wstr(out, d.quote_style));
    field(out, "value", |out| wstr(out, &d.value));
    if let Some(hex) = &d.bytes_hex {
        field(out, "bytesHex", |out| wstr(out, hex));
    }
    out.push('}');
}

fn write_table_expr(out: &mut String, ctx: &Ctx, tc: &TableConstructor) {
    let range = ctx.range_of(tc);
    node_start(out, "AstExprTable", range);
    field(out, "items", |out| warr(out, tc.fields().iter(), |out, f| write_table_item(out, ctx, f)));
    out.push('}');
}

fn write_table_item(out: &mut String, ctx: &Ctx, f: &Field) {
    let range = ctx.range_of(f);
    match f {
        Field::NoKey(e) => {
            out.push_str("{\"kind\":\"item\",\"range\":");
            wrange(out, range);
            field(out, "value", |out| write_expr(out, ctx, e));
            out.push('}');
        }
        Field::NameKey { key, value, .. } => {
            out.push_str("{\"kind\":\"record\",\"range\":");
            wrange(out, range);
            field(out, "name", |out| write_name(out, &text_of(key), ctx.range_of(key)));
            field(out, "value", |out| write_expr(out, ctx, value));
            out.push('}');
        }
        Field::ExpressionKey { key, value, .. } => {
            out.push_str("{\"kind\":\"general\",\"range\":");
            wrange(out, range);
            field(out, "key", |out| write_expr(out, ctx, key));
            field(out, "value", |out| write_expr(out, ctx, value));
            out.push('}');
        }
        Field::SetConstructor { name, .. } => {
            out.push_str("{\"kind\":\"set\",\"range\":");
            wrange(out, range);
            field(out, "name", |out| write_name(out, &text_of(name), ctx.range_of(name)));
            out.push('}');
        }
        _ => {
            out.push_str("{\"kind\":\"item\",\"range\":");
            wrange(out, range);
            field(out, "value", |out| {
                node_start(out, "AstExprConstantNil", range);
                out.push('}');
            });
            out.push('}');
        }
    }
}

fn write_if_expr_chain(out: &mut String, ctx: &Ctx, ie: &IfExpression) {
    let overall_end = byte_range_of(ie.else_expression()).1;
    write_if_expr_level(
        out,
        ctx,
        byte_range_of(ie.if_token()).0,
        ie.condition(),
        ie.if_expression(),
        ie.else_if_expressions().map(|v| v.as_slice()).unwrap_or(&[]),
        ie.else_expression(),
        overall_end,
    );
}

#[allow(clippy::too_many_arguments)]
fn write_if_expr_level(
    out: &mut String,
    ctx: &Ctx,
    start_byte: usize,
    condition: &Expression,
    true_expr: &Expression,
    remaining_elseifs: &[ElseIfExpression],
    final_else: &Expression,
    overall_end_byte: usize,
) {
    let range = (ctx.utf16(start_byte), ctx.utf16(overall_end_byte));
    node_start(out, "AstExprIfElse", range);
    field(out, "condition", |out| write_expr(out, ctx, condition));
    field(out, "trueExpr", |out| write_expr(out, ctx, true_expr));
    field(out, "falseExpr", |out| match remaining_elseifs.split_first() {
        Some((first, rest)) => write_if_expr_level(
            out,
            ctx,
            byte_range_of(first.else_if_token()).0,
            first.condition(),
            first.expression(),
            rest,
            final_else,
            overall_end_byte,
        ),
        None => write_expr(out, ctx, final_else),
    });
    out.push('}');
}

fn interp_literal_text(tok: &TokenReference) -> &str {
    match tok.token_type() {
        TokenType::InterpolatedString { literal, .. } => literal.as_str(),
        _ => "",
    }
}

fn write_interp_piece(out: &mut String, tok: &TokenReference) {
    let bytes = decode::decode_short_string(interp_literal_text(tok));
    let (value, _) = decode::string_value_fields(&bytes);
    wstr(out, &value);
}

fn write_interp_string(out: &mut String, ctx: &Ctx, range: (u32, u32), is: &InterpolatedString) {
    node_start(out, "AstExprInterpString", range);
    field(out, "strings", |out| {
        out.push('[');
        let mut first = true;
        for seg in is.segments() {
            if !first {
                out.push(',');
            }
            first = false;
            write_interp_piece(out, &seg.literal);
        }
        if !first {
            out.push(',');
        }
        write_interp_piece(out, is.last_string());
        out.push(']');
    });
    field(out, "expressions", |out| warr(out, is.expressions(), |out, e| write_expr(out, ctx, e)));
    out.push('}');
}

// -------------------------------------------------------------------------------------------
// Function bodies (`AstExprFunction`)
// -------------------------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn write_function_expr<'a>(
    out: &mut String,
    ctx: &Ctx,
    range: (u32, u32),
    attributes: impl Iterator<Item = &'a LuauAttribute>,
    generics: Option<&GenericDeclaration>,
    body: &FunctionBody,
    implicit_self: Option<(u32, u32)>,
    debugname: Option<&str>,
) {
    node_start(out, "AstExprFunction", range);
    field(out, "attributes", |out| warr(out, attributes, |out, a| write_attr(out, ctx, a)));
    let (gen, genp) = split_generics(generics);
    field(out, "generics", |out| warr(out, gen.iter(), |out, g| write_generic_param(out, ctx, g)));
    field(out, "genericPacks", |out| warr(out, genp.iter(), |out, g| write_generic_param(out, ctx, g)));
    if let Some(self_range) = implicit_self {
        field(out, "self", |out| write_local(out, ctx, "self", self_range, None, false, None));
    }

    let type_specs: Vec<Option<&TypeSpecifier>> = body.type_specifiers().collect();
    field(out, "args", |out| {
        out.push('[');
        let mut first = true;
        for (i, p) in body.parameters().iter().enumerate() {
            if let Parameter::Name(tok) = p {
                if !first {
                    out.push(',');
                }
                first = false;
                let ann = type_specs.get(i).copied().flatten().map(TypeSpecifier::type_info);
                write_local(out, ctx, &text_of(tok), ctx.range_of(tok), ann, false, None);
            }
        }
        out.push(']');
    });

    let vararg = body.parameters().iter().enumerate().find_map(|(i, p)| match p {
        Parameter::Ellipsis(tok) => Some((i, tok)),
        _ => None,
    });
    field(out, "vararg", |out| wbool(out, vararg.is_some()));
    if let Some((i, tok)) = vararg {
        field(out, "varargLocation", |out| wrange(out, ctx.range_of(tok)));
        if let Some(ts) = type_specs.get(i).copied().flatten() {
            field(out, "varargAnnotation", |out| write_vararg_annotation(out, ctx, ts.type_info()));
        }
    }

    if let Some(rt) = body.return_type() {
        field(out, "returnAnnotation", |out| write_type_list_from_single(out, ctx, rt.type_info()));
    }

    field(out, "body", |out| {
        let open = byte_range_of(body.parameters_parentheses().tokens().1).1;
        let close = byte_range_of(body.end_token()).0;
        write_block_with_bounds(out, ctx, body.block(), open, close);
    });

    if let Some(name) = debugname {
        field(out, "debugname", |out| wstr(out, name));
    }
    out.push('}');
}

fn write_vararg_annotation(out: &mut String, ctx: &Ctx, info: &TypeInfo) {
    match info {
        TypeInfo::GenericPack { .. } => write_type_or_pack(out, ctx, info),
        other => {
            let r = ctx.range_of(other);
            node_start(out, "AstTypePackVariadic", r);
            field(out, "variadicType", |out| write_type_or_pack(out, ctx, other));
            out.push('}');
        }
    }
}

// -------------------------------------------------------------------------------------------
// Operators
// -------------------------------------------------------------------------------------------

fn map_binop(op: &full_moon::ast::BinOp) -> &'static str {
    match op.token().token_type() {
        TokenType::Symbol { symbol } => match symbol {
            Symbol::Caret => "Pow",
            Symbol::Percent => "Mod",
            Symbol::Slash => "Div",
            Symbol::Star => "Mul",
            Symbol::DoubleSlash => "FloorDiv",
            Symbol::Minus => "Sub",
            Symbol::Plus => "Add",
            Symbol::TwoDots => "Concat",
            Symbol::DoubleLessThan => "Shl",
            Symbol::DoubleGreaterThan => "Shr",
            Symbol::Ampersand => "BitAnd",
            Symbol::Tilde => "BitXor",
            Symbol::Pipe => "BitOr",
            Symbol::GreaterThan => "CompareGt",
            Symbol::GreaterThanEqual => "CompareGe",
            Symbol::LessThan => "CompareLt",
            Symbol::LessThanEqual => "CompareLe",
            Symbol::TildeEqual => "CompareNe",
            Symbol::TwoEqual => "CompareEq",
            Symbol::And => "And",
            Symbol::Or => "Or",
            _ => "Add",
        },
        _ => "Add",
    }
}

fn map_unop(op: &full_moon::ast::UnOp) -> &'static str {
    match op.token().token_type() {
        TokenType::Symbol { symbol } => match symbol {
            Symbol::Minus => "Minus",
            Symbol::Not => "Not",
            Symbol::Hash => "Len",
            Symbol::Tilde => "BitNot",
            _ => "Minus",
        },
        _ => "Minus",
    }
}

fn map_compound_op(op: &full_moon::ast::CompoundOp) -> &'static str {
    match op.token().token_type() {
        TokenType::Symbol { symbol } => match symbol {
            Symbol::PlusEqual => "Add",
            Symbol::MinusEqual => "Sub",
            Symbol::StarEqual => "Mul",
            Symbol::SlashEqual => "Div",
            Symbol::CaretEqual => "Pow",
            Symbol::DoubleSlashEqual => "FloorDiv",
            Symbol::PercentEqual => "Mod",
            Symbol::TwoDotsEqual => "Concat",
            Symbol::DoubleLessThanEqual => "Shl",
            Symbol::DoubleGreaterThanEqual => "Shr",
            Symbol::AmpersandEqual => "BitAnd",
            Symbol::PipeEqual => "BitOr",
            _ => "Add",
        },
        _ => "Add",
    }
}

// -------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------

fn is_pack_like(info: &TypeInfo) -> bool {
    matches!(info, TypeInfo::Variadic { .. } | TypeInfo::VariadicPack { .. } | TypeInfo::GenericPack { .. })
}

/// `AstTypeList`: `{types, tailType?}`. A trailing pack-like `TypeInfo` becomes the tail.
fn write_type_list(out: &mut String, ctx: &Ctx, infos: &[&TypeInfo]) {
    let (types, tail): (&[&TypeInfo], Option<&TypeInfo>) = match infos.split_last() {
        Some((last, rest)) if is_pack_like(last) => (rest, Some(*last)),
        _ => (infos, None),
    };
    out.push_str("{\"types\":");
    warr(out, types.iter(), |out, t| write_type_or_pack(out, ctx, t));
    field_opt(out, "tailType", tail.is_some(), |out| write_type_or_pack(out, ctx, tail.unwrap()));
    out.push('}');
}

/// Builds an `AstTypeList` from a single `TypeInfo` (a return-type or `Callback` argument
/// position): a `Tuple` unpacks into its element list; anything else becomes either the sole
/// type, or the tail if it's itself pack-like.
fn write_type_list_from_single(out: &mut String, ctx: &Ctx, info: &TypeInfo) {
    match info {
        TypeInfo::Tuple { types, .. } => {
            let refs: Vec<&TypeInfo> = types.iter().collect();
            write_type_list(out, ctx, &refs);
        }
        other => write_type_list(out, ctx, &[other]),
    }
}

fn write_type_reference(out: &mut String, ctx: &Ctx, range: (u32, u32), prefix: Option<&TokenReference>, name_tok: &TokenReference, params: &[&TypeInfo]) {
    node_start(out, "AstTypeReference", range);
    if let Some(p) = prefix {
        field(out, "prefix", |out| wstr(out, &text_of(p)));
    }
    field(out, "name", |out| wstr(out, &text_of(name_tok)));
    field(out, "nameLocation", |out| wrange(out, ctx.range_of(name_tok)));
    field(out, "parameters", |out| warr(out, params.iter(), |out, p| write_type_or_pack(out, ctx, p)));
    out.push('}');
}

fn write_singleton_string(out: &mut String, ctx: &Ctx, range: (u32, u32), tok: &TokenReference) {
    node_start(out, "AstTypeSingletonString", range);
    let d = decode_string_token(ctx, tok);
    field(out, "value", |out| wstr(out, &d.value));
    field(out, "raw", |out| wstr(out, d.raw));
    out.push('}');
}

fn write_type_table(out: &mut String, ctx: &Ctx, range: (u32, u32), fields: &full_moon::ast::punctuated::Punctuated<TypeField>) {
    node_start(out, "AstTypeTable", range);
    let mut indexer: Option<String> = None;
    field(out, "props", |out| {
        out.push('[');
        let mut first = true;
        for f in fields.iter() {
            if let TypeFieldKey::IndexSignature { inner, .. } = f.key() {
                let mut buf = String::new();
                buf.push_str("{\"range\":");
                wrange(&mut buf, ctx.range_of(f));
                field(&mut buf, "indexType", |b| write_type_or_pack(b, ctx, inner));
                field(&mut buf, "resultType", |b| write_type_or_pack(b, ctx, f.value()));
                if let Some(acc) = f.access() {
                    field(&mut buf, "access", |b| wstr(b, &text_of(acc)));
                }
                buf.push('}');
                indexer = Some(buf);
                continue;
            }
            if !first {
                out.push(',');
            }
            first = false;
            write_table_prop(out, ctx, f);
        }
        out.push(']');
    });
    field_opt(out, "indexer", indexer.is_some(), |out| out.push_str(indexer.as_deref().unwrap_or("null")));
    out.push('}');
}

fn write_table_prop(out: &mut String, ctx: &Ctx, f: &TypeField) {
    if let TypeFieldKey::Name(tok) = f.key() {
        out.push_str("{\"name\":");
        wstr(out, &text_of(tok));
        out.push_str(",\"range\":");
        wrange(out, ctx.range_of(f));
        field(out, "type", |out| write_type_or_pack(out, ctx, f.value()));
        if let Some(acc) = f.access() {
            field(out, "access", |out| wstr(out, &text_of(acc)));
        }
        out.push('}');
    }
}

fn split_generics(gd: Option<&GenericDeclaration>) -> (Vec<&GenericDeclarationParameter>, Vec<&GenericDeclarationParameter>) {
    let mut names = Vec::new();
    let mut packs = Vec::new();
    if let Some(gd) = gd {
        for p in gd.generics().iter() {
            match p.parameter() {
                GenericParameterInfo::Name(_) => names.push(p),
                GenericParameterInfo::Variadic { .. } => packs.push(p),
                _ => {}
            }
        }
    }
    (names, packs)
}

/// `AstGenericType` / `AstGenericTypePack`: both `{name, range, defaultValue?}`. Works for
/// either a `Name` or `Variadic` parameter; the caller routes it into the right JSON array.
fn write_generic_param(out: &mut String, ctx: &Ctx, p: &GenericDeclarationParameter) {
    let (name_text, name_range) = match p.parameter() {
        GenericParameterInfo::Name(tok) => (text_of(tok), ctx.range_of(tok)),
        GenericParameterInfo::Variadic { name, .. } => (text_of(name), ctx.range_of(name)),
        _ => (String::new(), (0, 0)),
    };
    let _ = name_range;
    out.push_str("{\"name\":");
    wstr(out, &name_text);
    out.push_str(",\"range\":");
    wrange(out, ctx.range_of(p));
    if let Some(def) = p.default_type() {
        field(out, "defaultValue", |out| write_type_or_pack(out, ctx, def));
    }
    out.push('}');
}

/// Dual dispatcher: full-moon's `TypeInfo` enum flattens what the contract splits into
/// `AstType` and `AstTypePack`. Pack-like variants (`Variadic`, `VariadicPack`, `GenericPack`)
/// produce an `AstTypePack*`-shaped node; everything else produces an `AstType*`-shaped one.
fn write_type_or_pack(out: &mut String, ctx: &Ctx, info: &TypeInfo) {
    let range = ctx.range_of(info);
    match info {
        TypeInfo::Array { braces, access, type_info } => {
            node_start(out, "AstTypeTable", range);
            field(out, "props", |out| out.push_str("[]"));
            field(out, "indexer", |out| {
                out.push_str("{\"range\":");
                wrange(out, ctx.range_of(braces));
                field(out, "resultType", |out| write_type_or_pack(out, ctx, type_info));
                if let Some(acc) = access {
                    field(out, "access", |out| wstr(out, &text_of(acc)));
                }
                out.push('}');
            });
            field(out, "array", |out| wbool(out, true));
            out.push('}');
        }
        TypeInfo::Basic(tok) => write_type_reference(out, ctx, range, None, tok, &[]),
        TypeInfo::String(tok) => write_singleton_string(out, ctx, range, tok),
        TypeInfo::Boolean(tok) => {
            node_start(out, "AstTypeSingletonBool", range);
            field(out, "value", |out| wbool(out, tok.is_symbol(Symbol::True)));
            out.push('}');
        }
        TypeInfo::Callback { generics, arguments, return_type, .. } => {
            node_start(out, "AstTypeFunction", range);
            let (gen, genp) = split_generics(generics.as_ref());
            field(out, "generics", |out| warr(out, gen.iter(), |out, g| write_generic_param(out, ctx, g)));
            field(out, "genericPacks", |out| warr(out, genp.iter(), |out, g| write_generic_param(out, ctx, g)));
            field(out, "argTypes", |out| {
                let infos: Vec<&TypeInfo> = arguments.iter().map(|a| a.type_info()).collect();
                write_type_list(out, ctx, &infos);
            });
            field(out, "argNames", |out| {
                warr(out, arguments.iter(), |out, a| match a.name() {
                    Some((id, _colon)) => write_name(out, &text_of(id), ctx.range_of(id)),
                    None => out.push_str("null"),
                });
            });
            field(out, "returnTypes", |out| write_type_list_from_single(out, ctx, return_type));
            out.push('}');
        }
        TypeInfo::Generic { base, generics, .. } => {
            let params: Vec<&TypeInfo> = generics.iter().collect();
            write_type_reference(out, ctx, range, None, base, &params);
        }
        TypeInfo::GenericPack { name, .. } => {
            node_start(out, "AstTypePackGeneric", range);
            field(out, "genericName", |out| wstr(out, &text_of(name)));
            out.push('}');
        }
        TypeInfo::Intersection(inter) => {
            node_start(out, "AstTypeIntersection", range);
            field(out, "types", |out| warr(out, inter.types().iter(), |out, t| write_type_or_pack(out, ctx, t)));
            out.push('}');
        }
        TypeInfo::Module { module, type_info, .. } => match type_info.as_ref() {
            IndexedTypeInfo::Basic(tok) => write_type_reference(out, ctx, range, Some(module), tok, &[]),
            IndexedTypeInfo::Generic { base, generics, .. } => {
                let params: Vec<&TypeInfo> = generics.iter().collect();
                write_type_reference(out, ctx, range, Some(module), base, &params);
            }
            #[allow(unreachable_patterns)]
            _ => write_type_reference(out, ctx, range, Some(module), module, &[]),
        },
        TypeInfo::Optional { base, .. } => {
            node_start(out, "AstTypeOptional", range);
            field(out, "base", |out| write_type_or_pack(out, ctx, base));
            out.push('}');
        }
        TypeInfo::Table { fields, .. } => write_type_table(out, ctx, range, fields),
        TypeInfo::Typeof { inner, .. } => {
            node_start(out, "AstTypeTypeof", range);
            field(out, "expr", |out| write_expr(out, ctx, inner));
            out.push('}');
        }
        TypeInfo::Tuple { types, .. } => {
            let one_no_trailing_comma = types.len() == 1 && types.pairs().next().map(|p| p.punctuation().is_none()).unwrap_or(false);
            if one_no_trailing_comma {
                node_start(out, "AstTypeGroup", range);
                field(out, "inner", |out| {
                    if let Some(t) = types.iter().next() {
                        write_type_or_pack(out, ctx, t);
                    }
                });
                out.push('}');
            } else {
                node_start(out, "AstTypePackExplicit", range);
                field(out, "typeList", |out| {
                    let refs: Vec<&TypeInfo> = types.iter().collect();
                    write_type_list(out, ctx, &refs);
                });
                out.push('}');
            }
        }
        TypeInfo::Union(u) => {
            node_start(out, "AstTypeUnion", range);
            field(out, "types", |out| warr(out, u.types().iter(), |out, t| write_type_or_pack(out, ctx, t)));
            out.push('}');
        }
        TypeInfo::Variadic { type_info, .. } => {
            node_start(out, "AstTypePackVariadic", range);
            field(out, "variadicType", |out| write_type_or_pack(out, ctx, type_info));
            out.push('}');
        }
        TypeInfo::VariadicPack { name, .. } => {
            node_start(out, "AstTypePackVariadic", range);
            field(out, "variadicType", |out| write_type_reference(out, ctx, ctx.range_of(name), None, name, &[]));
            out.push('}');
        }
        _ => {
            // Dead code for full-moon 2.2.0 (non_exhaustive enum): harmless empty reference.
            write_type_reference(out, ctx, range, None, empty_token_fallback(info), &[]);
        }
    }
}

/// Only reached by the `TypeInfo` fallback arm above, which is dead code for full-moon 2.2.0.
/// full-moon has no "empty" `TokenReference` constant, so this borrows the first token of the
/// node itself (always exists) purely to satisfy the signature; its text is never inspected
/// there since callers only need *a* valid `AstTypeReference` shape.
fn empty_token_fallback(info: &TypeInfo) -> &TokenReference {
    info.tokens().next().expect("TypeInfo always has at least one token")
}

fn write_type_alias(out: &mut String, ctx: &Ctx, range: (u32, u32), td: &TypeDeclaration, exported: bool) {
    node_start(out, "AstStatTypeAlias", range);
    field(out, "name", |out| write_name(out, &text_of(td.type_name()), ctx.range_of(td.type_name())));
    let (gen, genp) = split_generics(td.generics());
    field(out, "generics", |out| warr(out, gen.iter(), |out, g| write_generic_param(out, ctx, g)));
    field(out, "genericPacks", |out| warr(out, genp.iter(), |out, g| write_generic_param(out, ctx, g)));
    field(out, "value", |out| write_type_or_pack(out, ctx, td.type_definition()));
    field(out, "exported", |out| wbool(out, exported));
    out.push('}');
}

fn write_type_function_stmt(out: &mut String, ctx: &Ctx, range: (u32, u32), tf: &TypeFunction, exported: bool) {
    node_start(out, "AstStatTypeFunction", range);
    field(out, "name", |out| write_name(out, &text_of(tf.function_name()), ctx.range_of(tf.function_name())));
    field(out, "body", |out| {
        let func_range = (
            ctx.utf16(byte_range_of(tf.function_token()).0),
            ctx.utf16(byte_range_of(tf.function_body().end_token()).1),
        );
        let debugname = text_of(tf.function_name());
        let empty: std::iter::Empty<&LuauAttribute> = std::iter::empty();
        write_function_expr(out, ctx, func_range, empty, tf.function_body().generics(), tf.function_body(), None, Some(&debugname));
    });
    field(out, "exported", |out| wbool(out, exported));
    out.push('}');
}
