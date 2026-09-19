/**
 * XLSX, CSV and TSV.
 *
 * All three are the same problem -- a grid plus a column mapping -- so they
 * share `lib/grid.js` and `lib/csv.js`. Only the I/O differs, which is all this
 * module does.
 *
 * Note the explicit `/browser` subpath imports. Neither package exposes a `.`
 * entry point, so `import 'read-excel-file'` fails to resolve at all.
 */

import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';

import { createEntry, nextId } from '../lib/entry.js';
import { detectDelimiter, parseDelimited, serializeDelimited } from '../lib/csv.js';
import {
  detectHeaderRow,
  detectMapping,
  entriesToGrid,
  gridToEntries,
  gridToSheetData,
  resolveExportColumns,
  ROLE,
} from '../lib/grid.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Uint8Array -> ArrayBuffer, because that is what read-excel-file accepts. */
function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Uint8Array(bytes).buffer;
}

/**
 * Unwrap whatever the writer handed back.
 *
 * Neither build returns a plain Blob or Buffer. The browser entry always
 * returns `{ toBlob, toFile }` and the Node entry `{ toBuffer, toStream,
 * toFile }` -- so `{ blob: true }` is not a browser option at all, it is
 * simply ignored, and the deferred object has to be resolved by hand.
 */
async function toBytes(result) {
  if (!result) return null;
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (typeof Blob !== 'undefined' && result instanceof Blob) {
    return new Uint8Array(await result.arrayBuffer());
  }

  if (typeof result.toBlob === 'function') {
    const blob = await result.toBlob();
    if (blob instanceof Uint8Array) return blob;
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }

  if (typeof result.toBuffer === 'function') return new Uint8Array(await result.toBuffer());

  return null;
}

/** Serialise a mapping for storage. Maps are not JSON-friendly. */
function mappingToMeta(mapping) {
  return {
    headerRow: mapping.headerRow,
    columns: mapping.columns,
    labels: mapping.labels,
    width: mapping.width,
    recognised: mapping.recognised,
    confident: mapping.confident,
    languages: mapping.languages,
  };
}

/** Rebuild the live mapping shape from stored metadata. */
export function mappingFromMeta(stored) {
  if (!stored) return null;
  return {
    headerRow: stored.headerRow,
    columns: stored.columns,
    labels: stored.labels ?? [],
    width: stored.width,
    recognised: stored.recognised ?? 0,
    confident: stored.confident ?? true,
    languages: stored.languages ?? {},
    roles: [],
    rolesByName: stored.columns,
  };
}

// ---------------------------------------------------------------- parsing

/**
 * Read every sheet so the import dialog can offer a choice.
 * Returns `{ sheets: [{ name, grid }] }`.
 */
export async function readWorkbook(input) {
  const { text, bytes } = input;

  if (bytes) {
    const sheets = await readXlsxFile(toArrayBuffer(bytes));
    return {
      kind: 'xlsx',
      sheets: sheets.map((sheet) => ({ name: sheet.sheet, grid: sheet.data.map((row) => row.map(cellToText)) })),
    };
  }

  const delimiter = detectDelimiter(text);
  const kind = delimiter === '\t' ? 'tsv' : 'csv';
  return {
    kind,
    delimiter,
    sheets: [{ name: kind === 'tsv' ? 'TSV' : 'CSV', grid: parseDelimited(text, delimiter) }],
  };
}

/** Spreadsheet cells arrive as numbers, booleans, dates and nulls. */
function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Parse a spreadsheet into entries.
 *
 * `options.sheet` picks a sheet, `options.mapping` overrides the auto-detected
 * columns. When no mapping is supplied the first sheet is read and the columns
 * are guessed, which is what makes drag-and-drop work with no dialog.
 */
export async function parseTabular(input, options = {}) {
  const workbook = await readWorkbook(input);

  const sheetName = options.sheet ?? workbook.sheets[0]?.name;
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName) ?? workbook.sheets[0];

  if (!sheet) {
    return {
      entries: [],
      meta: {
        format: 'tabular',
        kind: workbook.kind,
        sheets: [],
        sheet: null,
        empty: true,
      },
    };
  }

  const mapping =
    options.mapping ??
    detectMapping(sheet.grid, detectHeaderRow(sheet.grid), {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
    });

  const { entries, skipped } = gridToEntries(sheet.grid, mapping, options);

  return {
    entries,
    meta: {
      format: 'tabular',
      kind: workbook.kind,
      delimiter: workbook.delimiter ?? null,
      sheets: workbook.sheets.map((candidate) => ({
        name: candidate.name,
        rows: candidate.grid.length,
        columns: Math.max(0, ...candidate.grid.slice(0, 20).map((row) => row.length)),
      })),
      sheet: sheet.name,
      mapping: mappingToMeta(mapping),
      skippedRows: skipped.length,
      // A sheet with no rows at all is worth telling the user about, rather
      // than showing them an empty list with no explanation.
      empty: sheet.grid.length === 0,
      // Kept so an export can write back into the studio's own layout instead
      // of flattening their sheet into a generic one.
      grid: sheet.grid,
      width: mapping.width,
    },
  };
}

// ------------------------------------------------------------ serialising

/**
 * Write entries back into the original grid when one is available.
 *
 * A studio's master sheet usually has columns this tool knows nothing about --
 * character limits, screenshots, VO status. Rebuilding the sheet from the entry
 * model would throw all of that away, so rows are patched in place by the row
 * number recorded at import. Only when there is no original grid does a fresh
 * one get built.
 */
function mergeIntoGrid(entries, meta, columns, width) {
  const grid = meta.grid.map((row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy;
  });

  const headerRow = meta.mapping?.headerRow ?? -1;
  const put = (row, index, value) => {
    if (index === null || index === undefined || index >= width) return;
    row[index] = value ?? '';
  };

  const rowsByEntry = new Map();
  for (const entry of entries) {
    const sheetRow = entry.origin?.sheetRow;
    if (typeof sheetRow === 'number' && sheetRow - 1 > headerRow && sheetRow - 1 < grid.length) {
      rowsByEntry.set(entry.id, sheetRow - 1);
    }
  }

  const written = new Set();

  for (const entry of entries) {
    let rowIndex = rowsByEntry.get(entry.id);

    if (rowIndex === undefined) {
      rowIndex = grid.length;
      grid.push(Array.from({ length: width }, () => ''));
    }

    written.add(rowIndex);
    const row = grid[rowIndex];

    put(row, columns.key, entry.key);
    put(row, columns.source, entry.source);
    put(row, columns.comment, entry.comment);
    put(row, columns.references, (entry.references ?? []).join(', '));
    put(row, columns.approved, entry.approved ? 'yes' : '');

    if (columns.pluralSource !== null && columns.pluralSource !== undefined) {
      put(row, columns.pluralSource, entry.pluralSource ?? '');
    }

    columns.targets.forEach((index, offset) => {
      const plural = (columns.pluralTargets ?? []).find((item) => item.index === index);
      if (plural) put(row, index, entry.pluralTargets?.[plural.form] ?? '');
      else if (offset === 0) put(row, index, entry.target);
    });
  }

  return grid;
}

export async function serializeTabular(entries, meta = {}, options = {}) {
  const kind = options.kind ?? meta.kind ?? 'csv';
  const mapping = {
    columns: meta.mapping?.columns ?? { key: 0, source: 1, targets: [2], pluralSource: null, pluralTargets: [] },
    width: meta.mapping?.width ?? meta.width ?? 3,
  };

  const { columns, width } = resolveExportColumns(entries, mapping);

  const canMerge =
    options.preserveLayout !== false &&
    Array.isArray(meta.grid) &&
    meta.grid.length > 0 &&
    meta.mapping?.headerRow >= 0;

  let grid;
  if (canMerge) {
    grid = mergeIntoGrid(entries, meta, columns, width);
    // Refresh the header so added plural columns are labelled.
    const header = entriesToGrid([], { columns, width, hasPlural: true }, {
      includeHeader: true,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
    })[0];
    grid[meta.mapping.headerRow] = header;
  } else {
    grid = entriesToGrid(entries, mapping, {
      includeHeader: options.includeHeader !== false,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      keyHeader: options.keyHeader,
    });
  }

  if (kind === 'xlsx') {
    const handle = writeXlsxFile([
      {
        sheet: options.sheetName ?? meta.sheet ?? 'Strings',
        data: gridToSheetData(grid),
        stickyRowsCount: options.includeHeader === false ? 0 : 1,
      },
    ]);
    const bytes = await toBytes(handle);
    if (!bytes) throw new Error('The spreadsheet writer returned nothing usable.');
    return { bytes, mime: XLSX_MIME, extension: 'xlsx' };
  }

  const delimiter = kind === 'tsv' ? '\t' : options.delimiter ?? meta.delimiter ?? ',';
  return { text: serializeDelimited(grid, delimiter), mime: 'text/csv', extension: kind };
}

// ------------------------------------------------------------- descriptors

export const xlsxFormat = {
  id: 'xlsx',
  label: 'Excel workbook',
  extensions: ['xlsx', 'xlsm'],
  binary: true,
  capabilities: { plurals: true, notes: true, references: true, approved: true },
  parse: (input, options) => parseTabular(input, { ...options, kind: 'xlsx' }),
  serialize: (entries, meta, options) => serializeTabular(entries, meta, { ...options, kind: 'xlsx' }),
};

export const csvFormat = {
  id: 'csv',
  label: 'CSV',
  extensions: ['csv'],
  binary: false,
  capabilities: { plurals: true, notes: true, references: true, approved: true },
  parse: (input, options) => parseTabular(input, { ...options, kind: 'csv' }),
  serialize: (entries, meta, options) => serializeTabular(entries, meta, { ...options, kind: 'csv' }),
};

export const tsvFormat = {
  id: 'tsv',
  label: 'TSV',
  extensions: ['tsv', 'txt'],
  binary: false,
  capabilities: { plurals: true, notes: true, references: true, approved: true },
  parse: (input, options) => parseTabular(input, { ...options, kind: 'tsv' }),
  serialize: (entries, meta, options) => serializeTabular(entries, meta, { ...options, kind: 'tsv' }),
};

export { ROLE, createEntry, nextId };
