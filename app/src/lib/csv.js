/**
 * RFC 4180 delimited text: CSV, TSV, and anything else with a separator.
 *
 * The naive `line.split(',')` approach breaks on the three things every real
 * localisation export contains: quoted fields, embedded newlines inside a
 * quoted field, and escaped quotes (`""`). A translator's note with a comma in
 * it would shift every column after it.
 *
 * So this is a character scanner, not a splitter.
 */

const DELIMITERS = [',', '\t', ';', '|'];

/**
 * Guess the separator by counting candidates outside quoted regions on the
 * first few lines. Semicolon is common in European Excel exports because comma
 * is the decimal separator, so it must be in the running.
 */
export function detectDelimiter(text) {
  const sample = String(text ?? '').split(/\r?\n/).slice(0, 20).join('\n');
  if (sample.trim() === '') return ',';

  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;

  for (let i = 0; i < sample.length; i += 1) {
    const ch = sample[i];
    if (ch === '"') {
      if (inQuotes && sample[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }

  let best = ',';
  let bestCount = 0;
  for (const [delimiter, count] of counts) {
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  // No separator at all means a single-column file; comma is the sane default.
  return bestCount === 0 ? ',' : best;
}

/**
 * Parse delimited text into a grid of strings.
 *
 * Deliberately does not coerce numbers or dates. A string table where the key
 * `1.10` silently became `1.1` is a bug report waiting to happen.
 */
export function parseDelimited(text, delimiter = ',') {
  const input = String(text ?? '');

  // Strip a UTF-8 BOM. Excel writes one, and it would otherwise glue itself to
  // the first header cell so "key" never matches.
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }

    if (ch === '\r') {
      // Treat CRLF and a lone CR as one line break.
      if (src[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }

    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // A trailing newline produces a final empty row; drop it, but keep an
  // unterminated last line.
  if (field !== '' || row.length > 0) endRow();

  while (rows.length && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();

  return rows;
}

/** Quote a field only when it needs it. */
export function quoteField(value, delimiter) {
  const text = value === null || value === undefined ? '' : String(value);
  const needsQuotes =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.trim() !== text;

  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialise a grid. `newline` defaults to CRLF because Excel on Windows treats
 * a bare LF inside quoted fields inconsistently, and CRLF is what the spec
 * actually asks for.
 */
export function serializeDelimited(rows, delimiter = ',', newline = '\r\n') {
  return rows
    .map((row) => row.map((cell) => quoteField(cell, delimiter)).join(delimiter))
    .join(newline);
}

export const csvFormatBase = {
  binary: false,
};
