// -----------------------------------------------------------------------------
// Markdown (Gladys) to the Google Chat syntax, and the 4,096 characters cut.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toChatText, truncate } from '../src/format.js';

test('the common Markdown becomes the Chat syntax', () => {
  const cases = [
    ['**bold** and __bold__', '*bold* and *bold*'],
    ['*italic* and _italic_', '_italic_ and _italic_'],
    ['~~gone~~', '~gone~'],
    ['[Gladys](https://gladysassistant.com)', '<https://gladysassistant.com|Gladys>'],
    ['[x](javascript:alert(1))', '[x](javascript:alert(1))'],
    ['[x](ftp://host/file)', '[x](ftp://host/file)'],
    ['# Title\ntext', '*Title*\ntext'],
    ['## **Strong** title ##', '*Strong title*'],
    ['- one\n- two', '- one\n- two'],
    ['* one\n* two', '* one\n* two'],
    ['`**code**` stays', '`**code**` stays'],
    ['```\n**block**\n```', '```**block**\n```'],
    ['a\r\nb', 'a\nb'],
    ['2 * 3 * 4', '2 * 3 * 4'],
    ['# Use `x`', '*Use `x`*'],
  ];
  for (const [input, expected] of cases) assert.equal(toChatText(input), expected, input);
});

test('a NUL in the text cannot fake a placeholder', () => {
  assert.equal(toChatText('a\u00000\u0000b `c`'), 'a0b `c`');
});

test('empty, not a string: empty', () => {
  assert.equal(toChatText(''), '');
  assert.equal(toChatText('  \n '), '');
  assert.equal(toChatText(undefined), '');
  assert.equal(toChatText({ text: 'x' }), '');
});

test('4,096 characters at most, cut on a whole character', () => {
  const long = '😀'.repeat(5000);
  const out = toChatText(long);
  assert.equal(Array.from(out).length, 4096);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('�'));
  assert.equal(truncate('abc', 3), 'abc');
  assert.equal(truncate('abcd', 3), 'ab…');
});

test('linear work on a hostile text (no catastrophic backtracking)', () => {
  const started = performance.now();
  toChatText(`${'*'.repeat(20000)}${'[a'.repeat(5000)}${'_'.repeat(20000)}`);
  toChatText(`[${'a'.repeat(499)}](https://${'b'.repeat(1990)}`.repeat(10));
  assert.ok(performance.now() - started < 2000);
});
