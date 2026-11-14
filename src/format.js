// -----------------------------------------------------------------------------
// Gladys writes its messages in Markdown; a Google Chat webhook reads its own
// syntax: *bold*, _italic_, ~strike~, `code`, ```block```, <url|text>. The
// common Markdown is turned into it, code left as is; the rest stays plain
// text. A mention (`<users/all>`, `<users/123>`) is never passed on: it would
// notify the whole space. The result is cut to 4,096 characters, never in a
// half character, a link or a code block.
// -----------------------------------------------------------------------------

import { MAX_TEXT } from './constants.js';

const HOLD = '\u0000';

/** Markdown (Gladys) -> Google Chat text. Linear: one pass per rule. */
export function toChatText(markdown) {
  // Bounded before any rule: the work stays small whatever comes in.
  const source = typeof markdown === 'string' ? markdown : '';
  const bound = 2 * MAX_TEXT;
  const text = (
    source.length > bound ? `${source.slice(0, bound).replace(/[\uD800-\uDBFF]$/, '')}…` : source
  ).replace(/\r\n?/g, '\n');
  // Code blocks and spans are kept untouched: set aside first.
  const held = [];
  const hold = (s) => `${HOLD}${held.push(s) - 1}${HOLD}`;
  let out = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '')
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, body) => hold(`\`\`\`${body}\`\`\``))
    .replace(/`([^`\n]+)`/g, (_, body) => hold(`\`${body}\``));
  out = out
    // Mentions written in a text never notify: <users/all> -> @all.
    .replace(/<users\/([^<>\s]{1,128})>/g, '@$1')
    // [text](https://…) -> <https://…|text>; other schemes stay plain.
    .replace(/\[([^\]\n]{1,500})\]\((https?:\/\/[^\s()<>|]{1,2000})\)/g, (_, label, url) =>
      hold(`<${url}|${label.replace(/[<>|]/g, '')}>`),
    );
  out = headings(out, hold)
    // Bold first (** or __), held so the italic rule below never sees it.
    .replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_, a, b) => hold(`*${a ?? b}*`))
    // Italic with one star (not a list bullet) -> _italic_.
    .replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)\*(?!\w)/g, (_, before, body) => `${before}_${body}_`)
    .replace(/~~([^~\n]+?)~~/g, '~$1~');
  // A held part may hold another (a code span in a heading): restored until none is left.
  for (let round = 0; round < 3 && out.includes(HOLD); round += 1) {
    // eslint-disable-next-line no-control-regex
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)] ?? '');
  }
  return truncate(out.trim(), MAX_TEXT);
}

/** Headings -> a bold line, line by line (no regex that could backtrack). */
function headings(text, hold) {
  return text
    .split('\n')
    .map((line) => {
      const start = /^ {0,3}#{1,6}[ \t]+/.exec(line);
      if (!start) return line;
      let end = line.length;
      while (end > start[0].length && ' \t#'.includes(line[end - 1])) end -= 1;
      const title = line.slice(start[0].length, end).replace(/\*\*|__/g, '');
      return title ? hold(`*${title}*`) : line;
    })
    .join('\n');
}

/**
 * At most `max` characters (code points), the cut marked with "…"; a link
 * `<url|text>` or a code block left open by the cut is dropped whole.
 */
export function truncate(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join('');
  const open = cut.lastIndexOf('<');
  if (open >= 0 && !cut.includes('>', open)) cut = cut.slice(0, open);
  if ((cut.split('```').length - 1) % 2 === 1) cut = cut.slice(0, cut.lastIndexOf('```'));
  return `${cut.trimEnd()}…`;
}
