/**
 * Apple `.strings` and `.stringsdict`-adjacent files.
 *
 * The format is deceptively simple:
 *
 *   /* Shown on the title screen *\/
 *   "MENU_START" = "Start game";
 *
 * It is not line-oriented in practice. Values contain escaped quotes, literal
 * `\n`, `\u00e9` escapes, and comments appear both above entries and trailing on
 * the same line. Splitting on lines and running two regexes -- which is the
 * usual approach -- mangles any value containing `=` or a semicolon.
 *
 * This is a scanner, so quoting and escaping are handled properly.
 */

import { createEntry, nextId } from '../lib/entry.js';

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', 0: '\0' };

function unescapeStrings(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    const next = value[i + 1];
    if (next === undefined) break;

    if (next === 'u' || next === 'U') {
      const hex = value.slice(i + 2, i + 6);
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
    }

    out += Object.prototype.hasOwnProperty.call(ESCAPES, next) ? ESCAPES[next] : next;
    i += 1;
  }
  return out;
}

function escapeStrings(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

/**
 * Scan the file into `{ key, value, comment }` records.
 *
 * Handles `/* ... *\/` block comments (attached to the entry that follows),
 * `//` line comments, and trailing comments after the semicolon.
 */
export function parseStringsFile(text) {
  const src = String(text ?? '');
  const records = [];
  let pendingComment = [];
  let i = 0;

  const readQuoted = () => {
    // Assumes src[i] === '"'
    i += 1;
    let raw = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        raw += ch + (src[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return unescapeStrings(raw);
      }
      raw += ch;
      i += 1;
    }
    return unescapeStrings(raw);
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i + 2, end === -1 ? src.length : end);
      for (const line of body.split('\n')) {
        const cleaned = line.replace(/^\s*\*?\s?/, '').trimEnd();
        if (cleaned.trim() !== '') pendingComment.push(cleaned);
      }
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const body = src.slice(i + 2, end === -1 ? src.length : end).trim();
      if (body) pendingComment.push(body);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    if (ch === '"') {
      const key = readQuoted();

      // Skip whitespace and an optional '='.
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === '=') i += 1;
      while (i < src.length && /\s/.test(src[i])) i += 1;

      const value = src[i] === '"' ? readQuoted() : '';

      while (i < src.length && src[i] !== ';' && src[i] !== '\n') i += 1;
      if (src[i] === ';') i += 1;

      // Trailing comment on the same line.
      const lineEnd = src.indexOf('\n', i);
      const tail = src.slice(i, lineEnd === -1 ? src.length : lineEnd);
      const trailing = tail.match(/\/\*\s*(.*?)\s*\*\//);
      if (trailing) pendingComment.push(trailing[1]);

      records.push({ key, value, comment: pendingComment.join('\n') });
      pendingComment = [];
      continue;
    }

    // Anything else (stray semicolons, whitespace, encoding declarations).
    i += 1;
  }

  return records;
}

export function parseApple(input) {
  const text = String(input.text ?? '');
  const records = parseStringsFile(text);

  const entries = records.map((record, index) =>
    createEntry({
      id: nextId(),
      key: record.key,
      source: record.value,
      comment: record.comment,
      origin: { stringsIndex: index },
    }),
  );

  return {
    entries,
    meta: {
      format: 'apple',
      originalText: text,
      hasHeaderComment: /^\s*\/\*/.test(text),
    },
  };
}

export function serializeApple(entries, meta = {}, options = {}) {
  const parts = [];

  const original = String(meta.originalText ?? '');
  const header = original.match(/^\s*(\/\*[\s\S]*?\*\/)/);
  if (header) parts.push(`${header[1]}\n\n`);

  for (const entry of entries) {
    if (entry.comment) {
      parts.push('/* ');
      parts.push(entry.comment.replace(/\*\//g, '*\\/').split('\n').join('\n   '));
      parts.push(' */\n');
    }

    // Single-value format: write the translation when there is one, otherwise
    // keep the source, so a half-finished export is still a usable file.
    const value = entry.target.trim() !== '' ? entry.target : entry.source;
    parts.push(`"${escapeStrings(entry.key)}" = "${escapeStrings(value)}";\n\n`);
  }

  return { text: parts.join(''), mime: 'text/plain', extension: 'strings' };
}

export const appleFormat = {
  id: 'apple',
  label: 'Apple .strings',
  extensions: ['strings'],
  binary: false,
  capabilities: { plurals: false, notes: true, references: false, approved: false },
  parse: parseApple,
  serialize: serializeApple,
};
