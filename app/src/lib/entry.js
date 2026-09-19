/**
 * The canonical entry model.
 *
 * Every format parses into this shape and serialises back out of it, so the
 * editor only ever deals with one kind of object.
 *
 *   id             unique within a project, used as a React key
 *   key            semantic identity: PO msgctxt, XLIFF resname, JSON path,
 *                  Android <string name>, and so on
 *   source         singular source text
 *   target         singular translation
 *   pluralSource   gettext msgid_plural / XLIFF <plural> (null when absent)
 *   pluralTargets  msgstr[0..n] (empty array when absent)
 *   comment        translator-facing note (#. / <note>)
 *   references     source locations (#: file:line)
 *   flags          #, fuzzy / c-format / maxLength:40 ...
 *   approved       reviewed and signed off
 *   origin         format-specific extras needed for an exact round-trip
 */

export const STATUS = {
  UNTRANSLATED: 'untranslated',
  TRANSLATED: 'translated',
  APPROVED: 'approved',
};

let counter = 0;

/** Fresh id. Monotonic, so ids never collide even across re-parses. */
export function nextId() {
  counter += 1;
  return `e${counter}`;
}

export function createEntry(partial = {}) {
  return {
    id: partial.id || nextId(),
    key: partial.key ?? '',
    source: partial.source ?? '',
    target: partial.target ?? '',
    pluralSource: partial.pluralSource ?? null,
    pluralTargets: partial.pluralTargets ?? [],
    comment: partial.comment ?? '',
    references: partial.references ?? [],
    flags: partial.flags ?? [],
    approved: partial.approved ?? false,
    origin: partial.origin ?? {},
  };
}

/** True when the entry needs more than one translated form. */
export function isPlural(entry) {
  return Boolean(entry.pluralSource) || entry.pluralTargets.length > 0;
}

/** How many translated forms this entry needs. */
export function pluralFormCount(entry) {
  if (!isPlural(entry)) return 1;
  return Math.max(entry.pluralTargets.length, 2);
}

/** Every source form, singular first. */
export function sourceForms(entry) {
  return isPlural(entry) ? [entry.source, entry.pluralSource] : [entry.source];
}

/** Every target form, singular first, padded to the required count. */
export function targetForms(entry) {
  if (!isPlural(entry)) return [entry.target];
  const count = pluralFormCount(entry);
  return Array.from({ length: count }, (_, i) => entry.pluralTargets[i] ?? '');
}

/**
 * An entry is complete when every form it needs has non-whitespace text.
 * A half-filled plural is not complete -- that is the whole point of checking.
 */
export function isComplete(entry) {
  return targetForms(entry).every((form) => form.trim() !== '');
}

export function entryStatus(entry) {
  if (entry.approved && isComplete(entry)) return STATUS.APPROVED;
  if (isComplete(entry)) return STATUS.TRANSLATED;
  return STATUS.UNTRANSLATED;
}

/** Which forms are filled, for the progress bar. */
export function filledFormCount(entry) {
  return targetForms(entry).filter((form) => form.trim() !== '').length;
}

export function totalFormCount(entry) {
  return targetForms(entry).length;
}

/** Concatenated source text, used for search and translation memory. */
export function searchableSource(entry) {
  return [entry.source, entry.pluralSource, entry.key]
    .filter(Boolean)
    .join(' \u0000 ')
    .toLowerCase();
}

/** Apply a target value, routing to the right slot for plurals. */
export function setTargetForm(entry, index, value) {
  if (!isPlural(entry)) {
    return { ...entry, target: value };
  }

  const next = [...entry.pluralTargets];
  while (next.length < pluralFormCount(entry)) next.push('');
  next[index] = value;
  return { ...entry, pluralTargets: next };
}

export function getTargetForm(entry, index) {
  return targetForms(entry)[index] ?? '';
}

/** Percentage of individual forms completed, not entries. */
export function projectProgress(entries) {
  let done = 0;
  let total = 0;
  let approved = 0;
  let translated = 0;
  let untranslated = 0;

  for (const entry of entries) {
    const forms = totalFormCount(entry);
    total += forms;
    done += filledFormCount(entry);

    const status = entryStatus(entry);
    if (status === STATUS.APPROVED) approved += 1;
    else if (status === STATUS.TRANSLATED) translated += 1;
    else untranslated += 1;
  }

  return {
    entries: entries.length,
    forms: total,
    formsDone: done,
    percent: total ? Math.round((done / total) * 100) : 0,
    approved,
    translated,
    untranslated,
  };
}

/** Clear every target, keeping sources. Used by "reset translations". */
export function clearTargets(entry) {
  return {
    ...entry,
    target: '',
    pluralTargets: entry.pluralTargets.map(() => ''),
    approved: false,
  };
}
