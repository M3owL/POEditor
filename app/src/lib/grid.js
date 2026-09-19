/**
 * Spreadsheet grid <-> entry mapping.
 *
 * Pure logic, no I/O. The XLSX/CSV wrapper is a thin shell around this, which
 * keeps the part that actually breaks (guessing which column is which) testable
 * without a browser or a spreadsheet file.
 *
 * The hard part is that every studio names its columns differently. What has to
 * work: a header row of `key / en / pl`, a header row of
 * `id / source / target / comment`, a gettext-in-Excel layout with
 * `msgid / msgid_plural / msgstr[0] / msgstr[1]`, and a file with no header row
 * at all where the convention is simply key, source, target.
 */

import { createEntry, nextId } from './entry.js';

export const ROLE = {
  KEY: 'key',
  SOURCE: 'source',
  PLURAL_SOURCE: 'pluralSource',
  TARGET: 'target',
  COMMENT: 'comment',
  REFERENCES: 'references',
  APPROVED: 'approved',
  IGNORE: 'ignore',
};

/** Header spellings seen in the wild, grouped by the role they mean. */
const SYNONYMS = [
  { role: ROLE.PLURAL_SOURCE, names: ['msgid_plural', 'msgidplural', 'source_plural', 'plural_source', 'plural', 'srcplural'] },
  // `msgctxt` is the key. `msgid` is the source text -- putting it in the key
  // group would make a gettext-style sheet import with no source column at all.
  { role: ROLE.KEY, names: ['key', 'id', 'identifier', 'resname', 'msgctxt', 'name', 'stringid', 'term', 'label', 'token', 'code'] },
  { role: ROLE.SOURCE, names: ['source', 'src', 'original', 'originaltext', 'srctext', 'sourcetext', 'text', 'string', 'orig', 'en', 'english', 'base', 'msgid'] },
  { role: ROLE.TARGET, names: ['target', 'tgt', 'translation', 'translated', 'targettext', 'trgtext', 'msgstr', 'dest', 'destination', 'output'] },
  { role: ROLE.COMMENT, names: ['comment', 'comments', 'note', 'notes', 'context', 'description', 'devcomment', 'developercomment', 'translatorcomment', 'instructions', 'remarks'] },
  { role: ROLE.REFERENCES, names: ['reference', 'references', 'refs', 'location', 'locations', 'file', 'sourcefile', 'path'] },
  { role: ROLE.APPROVED, names: ['approved', 'reviewed', 'review', 'status', 'state', 'signedoff'] },
];

/** Plural target columns: msgstr[0], target_1, pl[2], msgstr3 ... */
const PLURAL_TARGET_PATTERNS = [
  /^(?:msgstr|target|tgt|trg|pl|plural|translation)\s*[\[(]\s*(\d+)\s*[\])]$/,
  /^(?:msgstr|target|tgt|trg|pl|plural|translation)\s*[_\-]?\s*(\d+)$/,
];

/** A bare language tag: `en`, `pl`, `pt-BR`, `zh_CN`. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/;

/** Normalise a header for comparison: lowercase, strip everything decorative. */
function normalise(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/\s+/g, '');
}

function pluralIndexFromHeader(header) {
  const cleaned = normalise(header).replace(/[\s]/g, '');
  for (const pattern of PLURAL_TARGET_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      const index = Number(match[1]);
      if (Number.isFinite(index)) return index;
    }
  }
  return null;
}

/**
 * Score a candidate header row.
 *
 * A real header row contains recognised role names. A row of translations
 * happens to contain the word "key" only by accident, so requiring at least two
 * hits (or one hit plus a language tag) avoids mistaking content for a header.
 */
export function scoreHeaderRow(row) {
  let hits = 0;
  let languageTags = 0;

  for (const cell of row) {
    const value = normalise(cell);
    if (value === '') continue;

    if (pluralIndexFromHeader(value) !== null) {
      hits += 1;
      continue;
    }

    if (SYNONYMS.some((group) => group.names.includes(value))) {
      hits += 1;
      continue;
    }

    if (LANGUAGE_TAG.test(value)) languageTags += 1;
  }

  const score = hits * 2 + languageTags;
  return { score, hits, languageTags };
}

/**
 * Which row is the header, or -1 when the file has none.
 *
 * Only the first few rows are considered: a header buried at row 40 is not a
 * header, and scanning the whole sheet would eventually find a row of source
 * text that happens to contain "Name" and misread the file.
 */
export function detectHeaderRow(grid, limit = 5) {
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < Math.min(limit, grid.length); index += 1) {
    const { score, hits, languageTags } = scoreHeaderRow(grid[index]);
    // Two recognised names, or one name plus a language column.
    const qualifies = hits >= 2 || (hits >= 1 && languageTags >= 1);
    if (qualifies && score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

/**
 * Assign a role to every column.
 *
 * `languages` optionally supplies the project's source/target language so a
 * column headed `pl` is not mistaken for the source. Without it the first
 * language-looking column is taken as the source, which is the usual layout.
 */
export function detectMapping(grid, headerRow = -1, languages = {}) {
  const header = headerRow >= 0 ? grid[headerRow] ?? [] : [];
  const width = Math.max(header.length, ...grid.slice(0, 12).map((row) => row.length), 0);

  const roles = Array.from({ length: width }, () => ROLE.IGNORE);
  const labels = Array.from({ length: width }, (_, i) => header[i] ?? '');
  const pluralTargets = new Map();
  const usedRoles = new Set();

  const sourceLang = normalise(languages.sourceLanguage);
  const targetLang = normalise(languages.targetLanguage);

  const claim = (index, role) => {
    if (roles[index] !== ROLE.IGNORE) return false;
    roles[index] = role;
    usedRoles.add(role);
    return true;
  };

  // Pass 1 -- exact synonym matches, and explicit plural columns.
  header.forEach((cell, index) => {
    const value = normalise(cell);
    if (value === '') return;

    const pluralIndex = pluralIndexFromHeader(value);
    if (pluralIndex !== null) {
      pluralTargets.set(index, pluralIndex);
      return;
    }

    for (const group of SYNONYMS) {
      if (!group.names.includes(value)) continue;

      // Only one source and one key column; extras fall through to pass 2.
      if (group.role === ROLE.SOURCE && usedRoles.has(ROLE.SOURCE)) return;
      if (group.role === ROLE.KEY && usedRoles.has(ROLE.KEY)) return;
      if (group.role === ROLE.TARGET && usedRoles.has(ROLE.TARGET)) return;

      claim(index, group.role);
      return;
    }
  });

  // Pass 2 -- language tags.
  header.forEach((cell, index) => {
    if (roles[index] !== ROLE.IGNORE) return;
    const value = normalise(cell);
    if (value === '' || !LANGUAGE_TAG.test(value)) return;

    if (sourceLang && value === sourceLang && !usedRoles.has(ROLE.SOURCE)) {
      claim(index, ROLE.SOURCE);
      return;
    }

    if (targetLang && value === targetLang) {
      claim(index, ROLE.TARGET);
      return;
    }

    if (!usedRoles.has(ROLE.SOURCE)) {
      claim(index, ROLE.SOURCE);
      return;
    }

    claim(index, ROLE.TARGET);
  });

  // Pass 3 -- positional fallback, only when nothing at all was recognised.
  const recognised = roles.filter((role) => role !== ROLE.IGNORE).length;
  if (recognised === 0) {
    roles[0] = ROLE.KEY;
    if (width > 1) roles[1] = ROLE.SOURCE;
    if (width > 2) roles[2] = ROLE.TARGET;
    usedRoles.add(ROLE.KEY);
    usedRoles.add(ROLE.SOURCE);
    usedRoles.add(ROLE.TARGET);
  } else {
    // A file with source but no target column is a source-only export; that is
    // legitimate, so nothing is forced here.
    if (!usedRoles.has(ROLE.SOURCE) && width > 1) {
      const spare = roles.findIndex((role, index) => role === ROLE.IGNORE && index !== roles.indexOf(ROLE.KEY));
      if (spare >= 0) {
        roles[spare] = ROLE.SOURCE;
        usedRoles.add(ROLE.SOURCE);
      }
    }
  }

  const targets = [];
  roles.forEach((role, index) => {
    if (role === ROLE.TARGET) targets.push(index);
  });
  for (const index of [...pluralTargets.keys()].sort((a, b) => pluralTargets.get(a) - pluralTargets.get(b))) {
    if (!targets.includes(index)) targets.push(index);
  }

  const firstOf = (role) => {
    const index = roles.indexOf(role);
    return index >= 0 ? index : null;
  };

  const columns = {
    key: firstOf(ROLE.KEY),
    source: firstOf(ROLE.SOURCE),
    pluralSource: firstOf(ROLE.PLURAL_SOURCE),
    targets,
    pluralTargets: [...pluralTargets.entries()].map(([index, form]) => ({ index, form })),
    comment: firstOf(ROLE.COMMENT),
    references: firstOf(ROLE.REFERENCES),
    approved: firstOf(ROLE.APPROVED),
  };

  const rolesByName = {
    key: columns.key,
    source: columns.source,
    pluralSource: columns.pluralSource,
    targets: columns.targets,
    comment: columns.comment,
    references: columns.references,
    approved: columns.approved,
  };

  return {
    headerRow,
    columns,
    roles,
    labels,
    width,
    recognised,
    languages,
    rolesByName,
    // Confidence drives the import dialog's wording: an unrecognised file gets
    // a warning instead of a silent misread.
    confident: recognised >= 2 || (recognised >= 1 && pluralTargets.size > 0),
  };
}

/** Cell to string. Spreadsheets hand back numbers, booleans and nulls. */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    // Excel stores 1.10 as 1.1; there is no way to recover the trailing zero,
    // but at least do not emit exponent notation for small numbers.
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function splitReferences(value) {
  return String(value ?? '')
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Grid -> entries.
 *
 * Rows are skipped when they have no source and no key: spreadsheets are full
 * of blank spacer rows and section headings, and importing those as empty
 * strings is worse than useless.
 */
export function gridToEntries(grid, mapping, options = {}) {
  const { columns, headerRow } = mapping;
  const start = headerRow >= 0 ? headerRow + 1 : 0;
  const entries = [];
  const skipped = [];

  for (let rowIndex = start; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];

    const pick = (index) => (index === null || index === undefined ? '' : cellText(row[index]));

    const key = pick(columns.key);
    const source = pick(columns.source);
    const pluralSource = pick(columns.pluralSource);

    const pluralForms = columns.pluralTargets
      .slice()
      .sort((a, b) => a.form - b.form)
      .map((entry) => cellText(row[entry.index]));

    const singularTargets = columns.targets.filter(
      (index) => !columns.pluralTargets.some((entry) => entry.index === index),
    );
    const target = singularTargets.length ? cellText(row[singularTargets[0]]) : '';

    const hasPluralData = pluralForms.length > 0 && pluralForms.some((form) => form.trim() !== '');

    if (key.trim() === '' && source.trim() === '' && pluralSource.trim() === '' && !hasPluralData) {
      skipped.push({ row: rowIndex, reason: 'empty' });
      continue;
    }

    const comment = pick(columns.comment);
    const references = splitReferences(pick(columns.references));
    const approvedRaw = pick(columns.approved).trim().toLowerCase();

    entries.push(
      createEntry({
        id: nextId(),
        key,
        source,
        target: hasPluralData && target === '' ? pluralForms[0] ?? '' : target,
        pluralSource: pluralSource || (hasPluralData ? source : null),
        pluralTargets: hasPluralData ? pluralForms : [],
        comment,
        references,
        approved: ['yes', 'true', '1', 'approved', 'done', 'ok', 'x'].includes(approvedRaw),
        origin: {
          sheetRow: rowIndex + 1,
          // Extra target columns beyond the first are offered as alternative
          // languages in the import dialog rather than silently discarded.
          extraTargets: singularTargets.slice(1).map((index) => cellText(row[index])),
        },
      }),
    );
  }

  return { entries, skipped };
}

/**
 * Work out the final column layout for export.
 *
 * If any entry carries plural forms but the mapping has no plural columns, the
 * columns are appended. Dropping plural forms on export would be silent data
 * loss, which is the one thing an export must never do.
 */
export function resolveExportColumns(entries, mapping) {
  const columns = { ...mapping.columns };

  const hasPlural = entries.some(
    (entry) => entry.pluralSource !== null && entry.pluralSource !== undefined && entry.pluralSource !== '',
  );
  const maxForms = entries.reduce((max, entry) => Math.max(max, entry.pluralTargets?.length ?? 0), 0);

  let nextIndex = mapping.width;

  if (hasPlural && (columns.pluralSource === null || columns.pluralSource === undefined)) {
    columns.pluralSource = nextIndex;
    nextIndex += 1;
  }

  const targetCount = columns.targets.length;
  if (hasPlural && targetCount < Math.max(maxForms, 2)) {
    const extra = [];
    for (let form = targetCount; form < Math.max(maxForms, 2); form += 1) {
      extra.push(nextIndex);
      nextIndex += 1;
    }
    columns.targets = [...columns.targets, ...extra];
    columns.pluralTargets = [
      ...(columns.pluralTargets ?? []),
      ...extra.map((index, offset) => ({ index, form: targetCount + offset })),
    ];
  }

  return { columns, hasPlural, maxForms, width: nextIndex };
}

/** Header labels for an export, derived from the roles. */
export function exportHeaderRow(columns, width, options = {}) {
  const header = Array.from({ length: width }, () => '');
  const sourceLanguage = options.sourceLanguage || 'source';
  const targetLanguage = options.targetLanguage || 'target';

  const set = (index, label) => {
    if (index === null || index === undefined || index >= width) return;
    header[index] = label;
  };

  set(columns.key, options.keyHeader || 'key');
  set(columns.source, sourceLanguage);
  set(columns.pluralSource, 'msgid_plural');
  set(columns.comment, 'comment');
  set(columns.references, 'references');
  set(columns.approved, 'approved');

  columns.targets.forEach((index, offset) => {
    const isPlural = (columns.pluralTargets ?? []).some((entry) => entry.index === index);
    if (isPlural) {
      const form = (columns.pluralTargets ?? []).find((entry) => entry.index === index)?.form ?? offset;
      header[index] = `msgstr[${form}]`;
    } else {
      header[index] = offset === 0 ? targetLanguage : `${targetLanguage}[${offset}]`;
    }
  });

  return header;
}

/** Entries -> grid, ready to hand to a spreadsheet writer. */
export function entriesToGrid(entries, mapping, options = {}) {
  const { columns, width, hasPlural } = resolveExportColumns(entries, mapping);
  const grid = [];

  if (options.includeHeader !== false) {
    grid.push(exportHeaderRow(columns, width, options));
  }

  for (const entry of entries) {
    const row = Array.from({ length: width }, () => '');

    const put = (index, value) => {
      if (index === null || index === undefined || index >= width) return;
      row[index] = value ?? '';
    };

    put(columns.key, entry.key);
    put(columns.source, entry.source);

    if (hasPlural) {
      put(columns.pluralSource, entry.pluralSource ?? '');
      columns.targets.forEach((index, offset) => {
        const isPlural = (columns.pluralTargets ?? []).some((item) => item.index === index);
        if (isPlural) {
          const form = (columns.pluralTargets ?? []).find((item) => item.index === index)?.form ?? offset;
          put(index, entry.pluralTargets?.[form] ?? '');
        } else if (offset === 0) {
          put(index, entry.target);
        }
      });
    } else {
      columns.targets.forEach((index, offset) => {
        if (offset === 0) put(index, entry.target);
      });
    }

    put(columns.comment, entry.comment);
    put(columns.references, (entry.references ?? []).join(', '));
    put(columns.approved, entry.approved ? 'yes' : '');

    grid.push(row);
  }

  return grid;
}

/**
 * Convert a grid to the cell objects write-excel-file expects.
 * Values are written as strings so Excel never reinterprets `0012` as 12.
 */
export function gridToSheetData(grid) {
  return grid.map((row) => row.map((value) => ({ value: value === '' ? null : String(value), type: String })));
}
