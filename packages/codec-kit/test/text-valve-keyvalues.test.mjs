import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValveKeyValues, ValveKeyValuesError } from '../dist/text/valve-keyvalues.js';

const limits = { quotedEscapes: 'literal', maxInputLength: 100000, maxTokenLength: 10000, maxNodes: 1000, maxDepth: 32 };

test('preserves repeated ordered SearchPaths from Source gameinfo syntax', () => {
  // Small syntax fixture based on HL2/Episode gameinfo SearchPaths, not copyrighted game content.
  const [game] = parseValveKeyValues('\uFEFF"GameInfo" { // source\n FileSystem { SearchPaths { Game |gameinfo_path|. Game hl2 Game platform } } }', limits);
  assert.deepEqual(game.value[0].value[0].value, [
    { key: 'Game', value: '|gameinfo_path|.' },
    { key: 'Game', value: 'hl2' },
    { key: 'Game', value: 'platform' },
  ]);
});

test('retains directives and conditions without evaluating them', () => {
  assert.deepEqual(parseValveKeyValues('#base "base.vdf"\n#include inc.vdf [$WIN32]\nshader { "$x" "1" [!$X360] } [$WIN32 || $LINUX]', limits), [
    { key: '#base', value: 'base.vdf' },
    { key: '#include', value: 'inc.vdf', condition: '$WIN32' },
    { key: 'shader', value: [{ key: '$x', value: '1', condition: '!$X360' }], condition: '$WIN32 || $LINUX' },
  ]);
});

test('quoted escaping, unknown path escapes, comments and literal punctuation', () => {
  const input = String.raw`"path" "materials\props\crate" "text" "a\"b\\c\n\t\r" "url" "https://a/{x}[y]" empty ""`;
  assert.deepEqual(parseValveKeyValues(input, { ...limits, quotedEscapes: 'escaped' }), [
    { key: 'path', value: String.raw`materials\props\crate` },
    { key: 'text', value: 'a"b\\c\n\t\r' },
    { key: 'url', value: 'https://a/{x}[y]' },
    { key: 'empty', value: '' },
  ]);
  assert.deepEqual(parseValveKeyValues('// empty\n // trailing', limits), []);
});

test('malformed syntax reports exact UTF-16 offsets', () => {
  for (const [input, offset] of [['}', 0], ['a', 1], ['a {', 3], ['a "x', 2], ['a b [x', 4], ['a b []', 4], ['a b [x[y]]', 6], ['a }', 2], ['a b [x] [y]', 8]]) {
    assert.throws(() => parseValveKeyValues(input, limits), error => error instanceof ValveKeyValuesError && error.offset === offset, input);
  }
});

test('finite input/token/node/depth limits reject instead of truncating', () => {
  for (const key of ['maxInputLength', 'maxTokenLength', 'maxNodes', 'maxDepth']) {
    for (const value of [NaN, Infinity, -1, 0.5, undefined]) assert.throws(() => parseValveKeyValues('', { ...limits, [key]: value }), RangeError);
  }
  assert.throws(() => parseValveKeyValues('a b', { ...limits, maxInputLength: 2 }), /Input limit/);
  assert.throws(() => parseValveKeyValues('abcd x', { ...limits, maxTokenLength: 3 }), /Token limit/);
  assert.throws(() => parseValveKeyValues('a "abcd"', { ...limits, maxTokenLength: 5 }), /Token limit/);
  assert.throws(() => parseValveKeyValues('a b [long]', { ...limits, maxTokenLength: 5 }), /Token limit/);
  assert.throws(() => parseValveKeyValues('a b a c', { ...limits, maxNodes: 1 }), /Node limit/);
  assert.throws(() => parseValveKeyValues('a {}', { ...limits, maxDepth: 0 }), /Depth limit/);
  assert.throws(() => parseValveKeyValues('a {b {}}', { ...limits, maxDepth: 1 }), /Depth limit/);
  assert.deepEqual(parseValveKeyValues('a {}', { ...limits, maxDepth: 1, maxNodes: 1 }), [{ key: 'a', value: [] }]);
});

test('caller must explicitly choose path-preserving or escaped quoted text', () => {
  for (const quotedEscapes of [undefined, null, '', 'auto', true]) {
    assert.throws(() => parseValveKeyValues('', { ...limits, quotedEscapes }), /Invalid quotedEscapes/);
  }
  const paths = String.raw`path "materials\nature\tree" cr "a\rb" slashes "a\\b"`;
  assert.deepEqual(parseValveKeyValues(paths, limits), [
    { key: 'path', value: String.raw`materials\nature\tree` },
    { key: 'cr', value: String.raw`a\rb` },
    { key: 'slashes', value: String.raw`a\\b` },
  ]);
  assert.deepEqual(parseValveKeyValues(paths, { ...limits, quotedEscapes: 'escaped' }), [
    { key: 'path', value: 'materials\nature\tree' },
    { key: 'cr', value: 'a\rb' },
    { key: 'slashes', value: 'a\\b' },
  ]);
  // Literal mode has no quote escape: the quote ends the string, preserving its preceding slash.
  assert.deepEqual(parseValveKeyValues(String.raw`key "a\"`, limits), [{ key: 'key', value: 'a\\' }]);
  assert.throws(() => parseValveKeyValues(String.raw`key "a\"b"`, limits), ValveKeyValuesError);
  assert.deepEqual(parseValveKeyValues(String.raw`key "a\"b"`, { ...limits, quotedEscapes: 'escaped' }), [{ key: 'key', value: 'a"b' }]);
});

test('cancellation is polled inside long scans, including single tokens', () => {
  const reason = new Error('cancelled');
  const controller = new AbortController();
  controller.abort(reason);
  assert.throws(() => parseValveKeyValues('', limits, controller.signal), error => error === reason);
  for (const input of [' '.repeat(10000), `//${'x'.repeat(10000)}`, `a "${'x'.repeat(10000)}"`, `a ${'x'.repeat(10000)}`, `a b [${'x'.repeat(10000)}]`]) {
    let polls = 0;
    // Synchronous scan cannot yield to an AbortController event; a signal probe proves polling.
    const signal = { throwIfAborted() { if (++polls === 3) throw reason; } };
    assert.throws(() => parseValveKeyValues(input, { ...limits, maxTokenLength: 20000 }, signal), error => error === reason);
    assert.equal(polls, 3);
  }
});
