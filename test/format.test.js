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

test('a mention written in a text never notifies the space', () => {
  assert.equal(toChatText('Alarm <users/all>!'), 'Alarm @all!');
  assert.equal(toChatText('<users/123456>'), '@123456');
  assert.equal(toChatText('[<users/all>](https://x.example)'), '<https://x.example|@all>');
  assert.equal(toChatText('`<users/all>` and ```\n<users/all>\n```'), '`@all` and ```@all\n```');
});

test('the cut never stops inside a link or a code block', () => {
  const link = `${'a'.repeat(4080)} [cam](https://x.example/${'p'.repeat(40)})`;
  const out = toChatText(link);
  assert.ok(Array.from(out).length <= 4096);
  assert.ok(!out.includes('<https'), 'the open link dropped whole');
  assert.ok(out.endsWith('…'));
  const block = `${'a'.repeat(4000)}\n\`\`\`\n${'code\n'.repeat(50)}\`\`\``;
  const cut = toChatText(block);
  assert.equal(cut.split('```').length - 1, 0, 'no code block left open');
  assert.ok(cut.endsWith('…'));
});

test('the bound on the input never leaves half a character', () => {
  // Spaces trimmed away: only what the bound kept is left.
  const out = toChatText(`${' '.repeat(8191)}😀tail`);
  assert.equal(out, '…');
  assert.doesNotMatch(
    toChatText(`${'a'.repeat(8191)}😀tail`),
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
  );
  assert.ok(out.endsWith('…'));
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

test('headings in linear time (no backtracking on trailing spaces or #)', () => {
  const started = performance.now();
  for (let i = 0; i < 3; i += 1) {
    toChatText(`# a${' '.repeat(8100)}x`);
    toChatText(`# a ${'#'.repeat(8100)}x`);
  }
  const took = performance.now() - started;
  assert.ok(took < 100, `${Math.round(took)} ms`);
  assert.equal(toChatText('### Title ##  '), '*Title*');
  assert.equal(toChatText('#nospace'), '#nospace');
  assert.equal(toChatText('#   '), '#');
});
