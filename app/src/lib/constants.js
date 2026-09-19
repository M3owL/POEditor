/**
 * Shared vocabulary: filters, severities, settings defaults, shortcuts.
 *
 * Kept in one place so the list, the side panel and the status bar cannot drift
 * apart on what a status is called.
 */

export const FILTER = {
  ALL: 'all',
  UNTRANSLATED: 'untranslated',
  TRANSLATED: 'translated',
  APPROVED: 'approved',
  ISSUES: 'issues',
};

export const FILTERS = [
  { id: FILTER.ALL, label: 'All', hint: 'Every entry' },
  { id: FILTER.UNTRANSLATED, label: 'Untranslated', hint: 'No target text yet' },
  { id: FILTER.TRANSLATED, label: 'Translated', hint: 'Complete, not approved' },
  { id: FILTER.APPROVED, label: 'Approved', hint: 'Reviewed and signed off' },
  { id: FILTER.ISSUES, label: 'Issues', hint: 'Failing at least one check' },
];

export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

export const SEVERITY_LABEL = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};

/** CLDR plural categories, in the order gettext and ICU use. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * Which categories a language actually uses.
 *
 * This matters more than a label. Labelling the three Polish forms
 * "zero / one / two" is wrong -- Polish uses one / few / many -- and a
 * translator reading "two" against a plural form will fill in the wrong one.
 */
export const PLURAL_CATEGORIES_BY_LANGUAGE = {
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  cy: ['zero', 'one', 'two', 'few', 'many', 'other'],
  ga: ['one', 'two', 'few', 'many', 'other'],
  lv: ['zero', 'one', 'other'],
  lt: ['one', 'few', 'many'],
  ro: ['one', 'few', 'other'],
  pl: ['one', 'few', 'many'],
  ru: ['one', 'few', 'many'],
  uk: ['one', 'few', 'many'],
  cs: ['one', 'few', 'many'],
  sk: ['one', 'few', 'many'],
  sl: ['one', 'two', 'few', 'other'],
  ja: ['other'],
  ko: ['other'],
  zh: ['other'],
  th: ['other'],
  vi: ['other'],
  tr: ['one', 'other'],
  fr: ['one', 'many', 'other'],
  pt: ['one', 'many', 'other'],
  es: ['one', 'many', 'other'],
  it: ['one', 'many', 'other'],
  de: ['one', 'other'],
  nl: ['one', 'other'],
  en: ['one', 'other'],
  sv: ['one', 'other'],
  da: ['one', 'other'],
  fi: ['one', 'other'],
  el: ['one', 'other'],
  he: ['one', 'two', 'many', 'other'],
};

/** The usual category set for a given form count, when the language is unknown. */
const CATEGORY_SETS_BY_COUNT = {
  1: ['other'],
  2: ['one', 'other'],
  3: ['one', 'few', 'many'],
  4: ['one', 'few', 'many', 'other'],
  5: ['one', 'two', 'few', 'many', 'other'],
  6: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

/**
 * Plural form labels for a language and a form count.
 *
 * Always returns exactly `count` labels, because every field on screen needs
 * one. Three cases, in order:
 *
 *   - the language declares exactly this many categories -> use them
 *   - it declares more -> keep the catch-all "other" and as many specific
 *     categories as fit. French declares one/many/other but needs two forms in
 *     practice, and the answer there is one/other, not one/many.
 *   - it declares fewer, or is unknown -> pad with a numbered label, so a file
 *     carrying more forms than the language needs still shows which is which.
 *     That mismatch is reported separately as a quality warning.
 */
export function pluralLabelsFor(languageCode, count) {
  const wanted = Math.max(1, count || 1);
  const normalised = String(languageCode ?? '').toLowerCase().replace(/_/g, '-');
  const base = normalised.split('-')[0];

  const declared = PLURAL_CATEGORIES_BY_LANGUAGE[normalised] ?? PLURAL_CATEGORIES_BY_LANGUAGE[base];

  if (declared && declared.length === wanted) return [...declared];

  if (declared && declared.length > wanted) {
    const specific = declared.filter((category) => category !== 'other');
    return [...specific.slice(0, wanted - 1), 'other'];
  }

  const source = declared ?? CATEGORY_SETS_BY_COUNT[wanted] ?? PLURAL_CATEGORIES;
  return Array.from({ length: wanted }, (_, index) => source[index] ?? `form ${index}`);
}

/** Languages worth offering as presets, with their plural form counts. */
export const LANGUAGE_PRESETS = [
  { code: 'en', label: 'English', forms: 2 },
  { code: 'pl', label: 'Polish', forms: 3 },
  { code: 'de', label: 'German', forms: 2 },
  { code: 'fr', label: 'French', forms: 2 },
  { code: 'es', label: 'Spanish', forms: 2 },
  { code: 'it', label: 'Italian', forms: 2 },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', forms: 2 },
  { code: 'ru', label: 'Russian', forms: 3 },
  { code: 'uk', label: 'Ukrainian', forms: 3 },
  { code: 'cs', label: 'Czech', forms: 3 },
  { code: 'ja', label: 'Japanese', forms: 1 },
  { code: 'ko', label: 'Korean', forms: 1 },
  { code: 'zh-CN', label: 'Chinese (Simplified)', forms: 1 },
  { code: 'tr', label: 'Turkish', forms: 2 },
  { code: 'ar', label: 'Arabic', forms: 6 },
];

export const DEFAULT_SETTINGS = {
  sourceLanguage: 'en',
  targetLanguage: 'pl',
  /** Warn when a translation is longer than the source by this factor. */
  lengthWarnRatio: 1.6,
  /** Treat an identical target as a warning. */
  flagSameAsSource: true,
  /** Autosave the working session to the browser. */
  autosave: true,
  theme: 'dark',
  /**
   * Instruction wrapped around the source by the "copy for a model" button.
   * `{text}` is replaced with the source. Editable, because the right wording
   * depends on the project's style guide rather than on this app.
   */
  promptTemplate: 'przetłumacz to na naturalny polski:\n{text}',
  /** Include the entry key and comment as a trailing note when copying. */
  promptIncludeContext: true,
  /** Hide findings the translator has dismissed from the panels. */
  showDismissed: false,
};

/** Keyboard shortcuts, shown in the help sheet. */
export const SHORTCUTS = [
  // Ctrl and Alt both navigate. Ctrl is the CAT-tool convention; Alt is there
  // because Ctrl + Arrow is also the browser's paragraph navigation, which
  // matters when a target string runs to several lines.
  { keys: 'Ctrl / Alt + ↓', action: 'Next entry' },
  { keys: 'Ctrl / Alt + ↑', action: 'Previous entry' },
  { keys: 'Ctrl + Enter', action: 'Approve and go to the next' },
  { keys: 'Ctrl + Shift + C', action: 'Copy source into the translation' },
  { keys: 'Ctrl + Shift + Backspace', action: 'Clear the translation' },
  { keys: 'Ctrl + K', action: 'Focus the search box' },
  { keys: 'Ctrl + O', action: 'Open files' },
  { keys: 'Ctrl + E', action: 'Export' },
  { keys: 'Ctrl + Z', action: 'Undo the last batch action' },
  { keys: 'Ctrl + /', action: 'Show this list' },
  { keys: 'Esc', action: 'Clear the search' },
];

/** Rows rendered at once. Long lists are windowed to keep typing responsive. */
export const LIST_WINDOW = 60;
