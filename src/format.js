// -----------------------------------------------------------------------------
// Gladys writes its messages in Markdown; a Google Chat webhook reads its own
// syntax: *bold*, _italic_, ~strike~, `code`, ```block```, <url|text>. The
// common Markdown is turned into it, code left as is; the rest stays plain
// text. The result is cut to 4,096 characters (never a half character).
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
    // [text](https://…) -> <https://…|text>; other schemes stay plain.
    .replace(/\[([^\]\n]{1,500})\]\((https?:\/\/[^\s()<>|]{1,2000})\)/g, (_, label, url) =>
      hold(`<${url}|${label.replace(/[<>|]/g, '')}>`),
    )
    // Headings -> a bold line.
    .replace(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm, (_, title) =>
      hold(`*${title.replace(/\*\*|__/g, '')}*`),
    )
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

/** At most `max` characters (code points), the cut marked with "…". */
export function truncate(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('')}…`;
}
