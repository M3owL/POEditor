/**
 * JSON string tables.
 *
 * Four shapes have to work, because four shapes are what actually get shipped:
 *
 *   1. flat        { "MENU_START": "Start game" }
 *   2. nested      { "menu": { "start": "Start game" } }   -> key "menu.start"
 *   3. i18next     { "items_one": "...", "items_other": "..." }
 *   4. record list [ { "key": "...", "source": "...", "target": "..." } ]
 *
 * Nested objects are flattened with dot paths, which is the convention every
 * i18n library uses, and unflattened on the way out so the file still looks
 * like the one that came in.
 *
 * A single JSON file does not say whether it holds sources or translations, so
 * `options.role` decides: 'source' (default) fills `source`, 'target' fills
 * `target`. Opening a source file and a translation file together is what
 * produces a complete project.
 */

import { createEntry, nextId } from '../lib/entry.js';

/** CLDR plural categories, in the canonical order. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_SUFFIX = new Set([...PLURAL_CATEGORIES, 'plural']);

/** Record-shaped rows, e.g. an export from a TMS. */
const RECORD_KEY_FIELDS = ['key', 'id', 'name', 'resname', 'msgctxt', 'msgid', 'term'];
const RECORD_SOURCE_FIELDS = ['source', 'src', 'original', 'msgid', 'text', 'en', 'english', 'base'];
const RECORD_TARGET_FIELDS = ['target', 'tgt', 'translation', 'translated', 'msgstr', 'value'];
const RECORD_COMMENT_FIELDS = ['comment', 'note', 'notes', 'context', 'description'];

function pickField(record, candidates) {
  for (const field of candidates) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const value = record[field];
      if (value !== null && value !== undefined && typeof value !== 'object') return { field, value: String(value) };
    }
  }
  return null;
}

function isRecordList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
    value.some((item) => pickField(item, RECORD_KEY_FIELDS) || pickField(item, RECORD_SOURCE_FIELDS))
  );
}

/** Flatten to `path -> primitive`, in document order. */
function flatten(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, prefix ? `${prefix}.${index}` : String(index), out));
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }

  out.push([prefix, value === null || value === undefined ? '' : String(value)]);
}

/**
 * Split a flat key into its base and plural category.
 * `items_one` -> { base: 'items', category: 'one' }
 */
function splitPluralSuffix(key) {
  const match = key.match(/^(.*)_([A-Za-z]+)$/);
  if (!match) return null;
  const [, base, suffix] = match;
  if (!base || !PLURAL_SUFFIX.has(suffix)) return null;
  return { base, category: suffix === 'plural' ? 'other' : suffix };
}

function parseRecordList(rows, options) {
  const role = options.role === 'target' ? 'target' : 'source';
  const entries = [];
  const unmapped = [];

  rows.forEach((row, index) => {
    const keyField = pickField(row, RECORD_KEY_FIELDS);
    const sourceField = pickField(row, RECORD_SOURCE_FIELDS);
    const targetField = pickField(row, RECORD_TARGET_FIELDS);
    const commentField = pickField(row, RECORD_COMMENT_FIELDS);

    if (!keyField && !sourceField) {
      unmapped.push(index);
      return;
    }

    const key = keyField?.value ?? String(index);
    const source = sourceField?.value ?? '';
    const target = targetField?.value ?? '';

    entries.push(
      createEntry({
        id: nextId(),
        key,
        source: role === 'target' ? source : source || (role === 'source' ? '' : ''),
        target: role === 'target' ? target || source : target,
        comment: commentField?.value ?? '',
        origin: { jsonRecord: index },
      }),
    );
  });

  return { entries, unmapped };
}

export function parseJson(input, options = {}) {
  const role = options.role === 'target' ? 'target' : 'source';
  const text = String(input.text ?? '');

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`That file is not valid JSON: ${error.message}`);
  }

  if (isRecordList(data)) {
    const { entries, unmapped } = parseRecordList(data, options);
    return {
      entries,
      meta: {
        format: 'json',
        shape: 'records',
        role,
        indentation: detectIndentation(text),
        unmappedRows: unmapped.length,
      },
    };
  }

  if (Array.isArray(data) || data === null || typeof data !== 'object') {
    throw new Error('A JSON string table must be an object or a list of records.');
  }

  const flat = [];
  flatten(data, '', flat);

  // Group i18next plural suffixes so `items_one` + `items_other` become one
  // entry with two forms instead of two unrelated strings.
  const pluralGroups = new Map();
  for (const [key] of flat) {
    const split = splitPluralSuffix(key);
    if (!split) continue;
    if (!pluralGroups.has(split.base)) pluralGroups.set(split.base, []);
    pluralGroups.get(split.base).push(split.category);
  }

  const merged = new Set();
  for (const [base, categories] of pluralGroups) {
    if (categories.length >= 2) merged.add(base);
  }

  const entries = [];
  const handled = new Set();

  for (const [key, value] of flat) {
    const split = splitPluralSuffix(key);
    const base = split && merged.has(split.base) ? split.base : null;

    if (base) {
      if (handled.has(base)) continue;
      handled.add(base);

      const forms = flat.filter(([candidate]) => {
        const inner = splitPluralSuffix(candidate);
        return inner && inner.base === base;
      });

      // Keep the file's own suffix order so the export is a faithful copy.
      const suffixes = forms.map(([candidate]) => candidate.slice(base.length + 1));
      const values = forms.map(([, candidateValue]) => candidateValue);

      const ordered = PLURAL_CATEGORIES.filter((category) => suffixes.includes(category));
      const extra = suffixes.filter((suffix) => !PLURAL_CATEGORIES.includes(suffix));
      const orderedSuffixes = [...ordered, ...extra];
      const orderedValues = orderedSuffixes.map((suffix) => values[suffixes.indexOf(suffix)]);

      entries.push(
        createEntry({
          id: nextId(),
          key: base,
          source: role === 'source' ? orderedValues[0] ?? '' : '',
          target: role === 'target' ? orderedValues[0] ?? '' : '',
          pluralSource: role === 'source' ? orderedValues[1] ?? orderedValues[0] ?? '' : null,
          pluralTargets: role === 'target' ? orderedValues : [],
          origin: { jsonPluralSuffixes: orderedSuffixes, jsonPath: base },
        }),
      );
      continue;
    }

    entries.push(
      createEntry({
        id: nextId(),
        key,
        source: role === 'source' ? value : '',
        target: role === 'target' ? value : '',
        origin: { jsonPath: key },
      }),
    );
  }

  return {
    entries,
    meta: {
      format: 'json',
      shape: 'flat',
      role,
      indentation: detectIndentation(text),
      pluralGroups: merged.size,
    },
  };
}

/** Match the file's own indentation so an export is not a whole-file diff. */
function detectIndentation(text) {
  const match = String(text).match(/\n(\s+)"/);
  if (!match) return 2;
  return match[1].includes('\t') ? '\t' : match[1].length;
}

// ------------------------------------------------------------ serialising

/** `a.b.c` -> nested object, merging shared prefixes. */
function assignPath(root, path, value) {
  const parts = path.split('.');
  let cursor = root;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = parts[i + 1];
    const wantsArray = /^\d+$/.test(next);

    if (cursor[part] === undefined || typeof cursor[part] !== 'object') {
      cursor[part] = wantsArray ? [] : {};
    }
    cursor = cursor[part];
  }

  cursor[parts[parts.length - 1]] = value;
}

export function serializeJson(entries, meta = {}, options = {}) {
  const indent = meta.indentation ?? 2;

  // Records round-trip as records; anything else is rebuilt as nested JSON.
  if (meta.shape === 'records' || options.shape === 'records') {
    const rows = entries.map((entry) => {
      const row = { key: entry.key, source: entry.source, target: entry.target };
      if (entry.comment) row.comment = entry.comment;
      return row;
    });
    return { text: `${JSON.stringify(rows, null, indent)}\n`, mime: 'application/json', extension: 'json' };
  }

  const root = {};

  for (const entry of entries) {
    const suffixes = entry.origin?.jsonPluralSuffixes;

    // Single-value format: prefer the translation, fall back to the source so a
    // partially finished export still loads.
    const hasTarget = entry.target.trim() !== '';

    if (suffixes && suffixes.length) {
      const values = hasTarget
        ? entry.pluralTargets ?? []
        : [entry.source, entry.pluralSource ?? entry.source];

      suffixes.forEach((suffix, index) => {
        assignPath(root, `${entry.key}_${suffix}`, values[index] ?? '');
      });
      continue;
    }

    assignPath(root, entry.key, hasTarget ? entry.target : entry.source);
  }

  return { text: `${JSON.stringify(root, null, indent)}\n`, mime: 'application/json', extension: 'json' };
}

export const jsonFormat = {
  id: 'json',
  label: 'JSON',
  extensions: ['json'],
  binary: false,
  capabilities: { plurals: true, notes: false, references: false, approved: false },
  parse: parseJson,
  serialize: serializeJson,
};
