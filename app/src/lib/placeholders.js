/**
 * Placeholder extraction and consistency checks.
 *
 * The single most damaging class of translation bug in games is a mangled
 * placeholder: the string still reads fine but crashes the game or prints
 * "%s" on screen. These checks compare the placeholder inventory of the
 * source against the translation and report anything that does not line up.
 *
 * The printf pattern deliberately does NOT allow a space flag (`% d`). Natural
 * text like "100% gotowe" would otherwise look like a format specifier, and a
 * QA panel full of false positives gets ignored.
 */

const PATTERNS = [
  // printf, including explicit argument indexes: %s %d %1$s %02d %-10s
  { kind: 'printf', re: /%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?[diouxXeEfgGaAcsp]/g },
  // Qt / gettext: %1 %2
  { kind: 'qt', re: /%\d+(?!\$)/g },
  // ICU MessageFormat and .NET: {0} {0:dd.MM} {count, plural, ...}
  { kind: 'brace', re: /\{\s*\d+\s*(?:,[^{}]*)?\}/g },
  // named braces: {name} {{name}} {name:format}
  { kind: 'named-brace', re: /\{\{?\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}?\}/g },
  // Android / XLIFF: $VAR$  ${VAR}
  { kind: 'dollar-brace', re: /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*\$/g },
  // Windows / batch: %VAR%
  { kind: 'percent-var', re: /%[A-Za-z_][A-Za-z0-9_]*%/g },
  // Ruby / Python old style: %{name}
  { kind: 'ruby', re: /%\{[A-Za-z_][A-Za-z0-9_]*\}/g },
  // markup that must survive
  { kind: 'tag', re: /<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*)?\/?>/g },
  { kind: 'entity', re: /&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g },
];

/** Escape sequences that must be preserved verbatim. */
const ESCAPES = [
  { kind: 'newline', re: /\\n/g },
  { kind: 'tab', re: /\\t/g },
  { kind: 'carriage', re: /\\r/g },
];

function tally(list) {
  const map = new Map();
  for (const token of list) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
}

/**
 * Every placeholder-ish token in a string, with repeats collapsed to counts.
 * Returns a Map of token -> count.
 */
export function placeholderMap(text) {
  const found = [];
  const input = String(text ?? '');

  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    const matches = input.match(re);
    if (matches) found.push(...matches);
  }

  for (const { re } of ESCAPES) {
    re.lastIndex = 0;
    const matches = input.match(re);
    if (matches) found.push(...matches);
  }

  return tally(found);
}

/** Sorted token list, for display. */
export function placeholders(text) {
  return [...placeholderMap(text).keys()].sort();
}

/**
 * Split text into plain and token segments, in order.
 *
 * Used by the editor to render placeholders as distinct objects rather than as
 * characters a translator might retype by hand. Returns
 * `[{ type: 'text' | 'token', value }]`.
 */
export function tokenize(text) {
  const input = String(text ?? '');
  if (input === '') return [];

  // One pass with a combined pattern, so tokens are found in document order and
  // overlapping matches cannot double-count.
  const combined = new RegExp(PATTERNS.map(({ re }) => re.source).join('|'), 'g');

  const segments = [];
  let cursor = 0;
  let match;

  while ((match = combined.exec(input)) !== null) {
    // A zero-length match would loop forever.
    if (match.index === combined.lastIndex) {
      combined.lastIndex += 1;
      continue;
    }

    if (match.index > cursor) {
      segments.push({ type: 'text', value: input.slice(cursor, match.index) });
    }

    segments.push({ type: 'token', value: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < input.length) segments.push({ type: 'text', value: input.slice(cursor) });

  return segments;
}

/**
 * Compare placeholder inventories.
 * Returns { missing, extra, counts } -- all empty when everything lines up.
 */
export function comparePlaceholders(source, target) {
  const src = placeholderMap(source);
  const tgt = placeholderMap(target);

  const missing = [];
  const extra = [];

  for (const [token, count] of src) {
    const got = tgt.get(token) ?? 0;
    if (got < count) missing.push(count > 1 ? `${token} ×${count}` : token);
  }

  for (const [token, count] of tgt) {
    const want = src.get(token) ?? 0;
    if (count > want) extra.push(count > 1 ? `${token} ×${count}` : token);
  }

  return { missing: missing.sort(), extra: extra.sort() };
}

/** Trailing/leading whitespace that differs between source and target. */
export function whitespaceMismatch(source, target) {
  if (!source || !target) return null;

  const lead = (s) => s.match(/^\s*/)[0];
  const trail = (s) => s.match(/\s*$/)[0];

  const issues = [];
  if (lead(source) !== lead(target)) issues.push('leading');
  if (trail(source) !== trail(target)) issues.push('trailing');

  return issues.length ? issues : null;
}
