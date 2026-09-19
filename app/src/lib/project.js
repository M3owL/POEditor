/**
 * Project-level helpers: combining imports, filtering, and counts.
 *
 * Kept out of App so the rules are testable and so the component stays about
 * rendering rather than bookkeeping.
 */

import { FILTER, LANGUAGE_PRESETS } from './constants.js';
import { STATUS, entryStatus, projectProgress, searchableSource } from './entry.js';
import { hasIssueAtLeast } from './qa.js';

/** How many plural forms a language needs, from the preset table. */
export function pluralFormsFor(languageCode) {
  if (!languageCode) return 2;
  const normalised = String(languageCode).toLowerCase().replace(/_/g, '-');
  const preset =
    LANGUAGE_PRESETS.find((candidate) => candidate.code.toLowerCase() === normalised) ??
    LANGUAGE_PRESETS.find((candidate) => candidate.code.toLowerCase().split('-')[0] === normalised.split('-')[0]);
  return preset?.forms ?? 2;
}

/**
 * Pair a source file with a translation file by key.
 *
 * This is the "open en.json and pl.json together" case. Keys present only in
 * the translation file are kept rather than dropped -- a translator noticing a
 * string that no longer exists in the source is useful information, and
 * silently discarding their work would be worse.
 */
export function mergeByKey(sourceEntries, targetEntries) {
  const byKey = new Map();
  for (const entry of targetEntries) {
    if (entry.key) byKey.set(entry.key, entry);
  }

  const used = new Set();
  const merged = [];

  for (const source of sourceEntries) {
    const match = source.key ? byKey.get(source.key) : null;

    if (!match) {
      merged.push(source);
      continue;
    }

    used.add(match.id);

    // The paired file may have been opened as sources, in which case its text
    // sits in `source` rather than `target`.
    const translation = match.target?.trim() ? match.target : match.source;

    merged.push({
      ...source,
      target: translation ?? '',
      pluralTargets: match.pluralTargets?.length ? match.pluralTargets : source.pluralTargets,
      approved: match.approved || source.approved,
    });
  }

  for (const entry of targetEntries) {
    if (used.has(entry.id)) continue;
    merged.push(entry);
  }

  return merged;
}

/** Is this result a spreadsheet (and therefore has a grid to preserve)? */
function isTabular(result) {
  return Array.isArray(result?.meta?.grid);
}

/**
 * Fold several imported files into one project.
 *
 * Two files of the same single-value format are treated as a language pair.
 * Anything else is concatenated, because the alternative -- refusing to open
 * files the user clearly meant to open together -- is worse.
 */
export function combineImports(results) {
  const usable = results.filter((result) => result && result.entries);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  if (usable.length === 2) {
    const [first, second] = usable;
    const pairable = first.formatId === second.formatId && !isTabular(first) && !isTabular(second);

    if (pairable) {
      const firstIsSource = first.role !== 'target';
      const source = firstIsSource ? first : second;
      const target = firstIsSource ? second : first;

      return {
        entries: mergeByKey(source.entries, target.entries),
        meta: {
          ...source.meta,
          format: source.meta?.format,
          pairedWith: target.fileName,
          originalXml: source.meta?.originalXml,
          originalText: source.meta?.originalText,
        },
        formatId: source.formatId,
        fileName: source.fileName,
        fileSize: source.fileSize,
        role: 'source',
      };
    }
  }

  const entries = [];
  for (const result of usable) entries.push(...result.entries);

  const first = usable[0];
  return {
    entries,
    meta: { ...first.meta, combinedFrom: usable.map((result) => result.fileName).filter(Boolean) },
    formatId: first.formatId,
    fileName: first.fileName,
    fileSize: usable.reduce((total, result) => total + (result.fileSize ?? 0), 0),
    role: 'source',
  };
}

/** Apply the filter chips and the search box. */
export function filterEntries(entries, { filter = FILTER.ALL, search = '', analysis } = {}) {
  let out = entries;

  if (filter === FILTER.UNTRANSLATED) {
    out = out.filter((entry) => entryStatus(entry) === STATUS.UNTRANSLATED);
  } else if (filter === FILTER.TRANSLATED) {
    out = out.filter((entry) => entryStatus(entry) === STATUS.TRANSLATED);
  } else if (filter === FILTER.APPROVED) {
    out = out.filter((entry) => entryStatus(entry) === STATUS.APPROVED);
  } else if (filter === FILTER.ISSUES) {
    out = out.filter((entry) => hasIssueAtLeast(analysis?.byEntry?.get(entry.id), 'warning'));
  }

  const query = search.trim().toLowerCase();
  if (query) {
    out = out.filter(
      (entry) =>
        searchableSource(entry).includes(query) ||
        String(entry.target ?? '').toLowerCase().includes(query),
    );
  }

  return out;
}

/** Counts for each filter chip, computed in one pass. */
export function computeFilterCounts(entries, analysis) {
  const counts = {
    [FILTER.ALL]: entries.length,
    [FILTER.UNTRANSLATED]: 0,
    [FILTER.TRANSLATED]: 0,
    [FILTER.APPROVED]: 0,
    [FILTER.ISSUES]: 0,
  };

  for (const entry of entries) {
    const status = entryStatus(entry);
    if (status === STATUS.UNTRANSLATED) counts[FILTER.UNTRANSLATED] += 1;
    else if (status === STATUS.TRANSLATED) counts[FILTER.TRANSLATED] += 1;
    else if (status === STATUS.APPROVED) counts[FILTER.APPROVED] += 1;

    if (hasIssueAtLeast(analysis?.byEntry?.get(entry.id), 'warning')) counts[FILTER.ISSUES] += 1;
  }

  return counts;
}

/** Index of the next entry matching a predicate, wrapping around. */
export function findNextIndex(entries, currentId, step, predicate) {
  if (entries.length === 0) return -1;

  const start = Math.max(0, entries.findIndex((entry) => entry.id === currentId));
  const candidates = predicate ? entries.filter(predicate) : entries;
  if (candidates.length === 0) return -1;

  const currentPosition = candidates.findIndex((entry) => entry.id === currentId);
  if (currentPosition === -1) {
    // Not in the filtered set: enter it at the nearest edge.
    return step > 0 ? 0 : candidates.length - 1;
  }

  const next = (currentPosition + step + candidates.length) % candidates.length;
  const targetId = candidates[next].id;
  return entries.findIndex((entry) => entry.id === targetId);
}

export { projectProgress };
