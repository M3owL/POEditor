/**
 * Dismissed checks.
 *
 * A quality panel that cannot be quietened stops being read. The failure is
 * specific and predictable: a project legitimately has forty entries whose
 * translation is intentionally identical to the source (product names, "OK",
 * "%s"), the `same-as-source` warning fires on every one of them, and after the
 * third time the translator stops looking at the panel at all -- including at
 * the placeholder error that would have crashed the build.
 *
 * So every check can be silenced, at two levels:
 *
 *   - per entry: "this warning, on this string, is fine" -- for the genuine
 *     one-off exception that should not weaken the check everywhere
 *   - per check: "stop showing me this kind of warning" -- for a check that
 *     does not apply to this project at all
 *
 * Neither one deletes anything. Both are reversible, both are listed in the UI
 * with a count, and both are persisted, because a dismissal that resets on
 * reload is not a dismissal.
 *
 * The distinction that matters: a dismissal hides a finding from the panel and
 * from the entry's badge, but it never changes the text and never makes an
 * export refuse differently. This is a display filter, and calling it anything
 * else would be dishonest.
 */

import { SEVERITY } from './constants.js';

/**
 * Every check the app can raise, with the label shown in the "muted checks"
 * list. Grouped so the list is readable when it is long.
 */
export const CHECK_CATALOGUE = [
  // ---- things that break the build or the game
  { code: 'empty-target', label: 'Missing translation', group: 'Build-breaking' },
  { code: 'placeholder-missing', label: 'Placeholder missing from translation', group: 'Build-breaking' },
  { code: 'placeholder-extra', label: 'Placeholder added that is not in the source', group: 'Build-breaking' },
  { code: 'placeholder-order', label: 'Placeholders in a different order', group: 'Build-breaking' },
  { code: 'placeholder-format', label: 'Placeholder written differently', group: 'Build-breaking' },
  { code: 'newline-count', label: 'Different number of line breaks', group: 'Build-breaking' },
  { code: 'plural-form-count', label: 'Wrong number of plural forms', group: 'Build-breaking' },
  { code: 'duplicate-key', label: 'Duplicate key in the project', group: 'Build-breaking' },

  // ---- almost certainly wrong
  { code: 'unbalanced-brackets', label: 'Unbalanced brackets', group: 'Suspicious' },
  { code: 'same-as-source', label: 'Translation identical to the source', group: 'Suspicious' },
  { code: 'too-long', label: 'Translation much longer than the source', group: 'Suspicious' },

  // ---- worth a glance
  { code: 'terminal-punctuation', label: 'Final punctuation differs', group: 'Cosmetic' },
  { code: 'double-space', label: 'Double space', group: 'Cosmetic' },
  { code: 'inconsistent-translation', label: 'One source translated several ways', group: 'Cosmetic' },

  // ---- naturalness
  { code: 'missing-diacritics', label: 'Missing Polish diacritics', group: 'Polish' },
  { code: 'numeral-agreement', label: 'Wrong numeral agreement', group: 'Polish' },
  { code: 'calque', label: 'English calque or periphrasis', group: 'Polish' },
  { code: 'english-leftover', label: 'English left untranslated', group: 'Polish' },
  { code: 'passive', label: 'Passive voice', group: 'Polish' },
  { code: 'quotes', label: 'Straight quotes instead of Polish „…”', group: 'Polish' },
  { code: 'space-before-punctuation', label: 'Space before punctuation', group: 'Polish' },
  { code: 'missing-space', label: 'Missing space after punctuation', group: 'Polish' },
  { code: 'title-case', label: 'English Title Case', group: 'Polish' },
  { code: 'hyphen-range', label: 'Hyphen used for a range', group: 'Polish' },
  { code: 'formality-mixed', label: 'Mixed formal and informal address', group: 'Polish' },
  { code: 'repeated-word', label: 'Repeated word', group: 'Polish' },
  { code: 'verbose', label: 'Verbose translation', group: 'Polish' },
  { code: 'noun-chain', label: 'Chain of verbal nouns', group: 'Polish' },
  { code: 'punctuation-pile', label: 'Too many exclamation or question marks', group: 'Polish' },
];

const LABEL_BY_CODE = new Map(CHECK_CATALOGUE.map((check) => [check.code, check.label]));

/** Human label for a check code, falling back to the code itself. */
export function checkLabel(code) {
  return LABEL_BY_CODE.get(code) ?? code;
}

/**
 * Codes the catalogue does not know about.
 *
 * Used by a test, not by the UI: a check added to `qa.js` or `naturalness.js`
 * and forgotten here would appear in the panel with no way to mute it, which is
 * exactly the situation this module exists to prevent.
 */
export function unknownCheckCodes(codes) {
  return [...new Set(codes)].filter((code) => !LABEL_BY_CODE.has(code));
}

/** Empty dismissal state. */
export function createDismissals() {
  return { entries: {}, codes: {} };
}

const entryKey = (entryId, code) => `${entryId}\u0000${code}`;

/**
 * Is this finding hidden?
 *
 * A muted check hides its findings everywhere; a dismissed entry hides one
 * finding on one entry.
 */
export function isDismissed(state, entryId, code) {
  if (!state) return false;
  if (state.codes?.[code]) return true;
  if (!entryId) return false;
  return Boolean(state.entries?.[entryKey(entryId, code)]);
}

/** Hide one finding on one entry. */
export function dismiss(state, entryId, code) {
  return {
    ...state,
    entries: { ...state.entries, [entryKey(entryId, code)]: true },
  };
}

/** Show it again. */
export function restore(state, entryId, code) {
  const next = { ...state.entries };
  delete next[entryKey(entryId, code)];
  return { ...state, entries: next };
}

/** Hide every finding on one entry. */
export function dismissAllOnEntry(state, entryId, codes = []) {
  const entries = { ...state.entries };
  for (const code of codes) entries[entryKey(entryId, code)] = true;
  return { ...state, entries };
}

/** Mute a whole check, across the project. */
export function muteCheck(state, code) {
  return { ...state, codes: { ...state.codes, [code]: true } };
}

/** Un-mute it. */
export function unmuteCheck(state, code) {
  const codes = { ...state.codes };
  delete codes[code];
  return { ...state, codes };
}

export function toggleMuteCheck(state, code) {
  return state.codes?.[code] ? unmuteCheck(state, code) : muteCheck(state, code);
}

/**
 * How many dismissals are in effect, for the badge on the toggle.
 *
 * Counts both levels, because the translator wants to know how much is hidden,
 * not how it was hidden.
 */
export function dismissedCount(state) {
  if (!state) return 0;
  return Object.keys(state.entries ?? {}).length + Object.keys(state.codes ?? {}).length;
}

/** Every muted check code, sorted, for the UI list. */
export function mutedCodes(state) {
  return Object.keys(state.codes ?? {})
    .filter((code) => state.codes[code])
    .sort();
}

/** Forget every dismissal. */
export function clearDismissals() {
  return createDismissals();
}

/**
 * Drop dismissals for entries that no longer exist.
 *
 * Without this the store grows forever as files are opened and closed, and a
 * dismissal keyed to an id that has been reused would silently hide a real
 * finding in a different project.
 */
export function pruneDismissals(state, liveEntryIds) {
  const live = new Set(liveEntryIds);
  const entries = {};

  for (const [key, value] of Object.entries(state.entries ?? {})) {
    const separator = key.indexOf('\u0000');
    const entryId = separator === -1 ? key : key.slice(0, separator);
    if (live.has(entryId)) entries[key] = value;
  }

  return { ...state, entries };
}

/**
 * Split a finding list into what to show and what is hidden.
 *
 * `severity` is passed through so the caller can decide whether a hidden error
 * still deserves to tint the field -- it does, because a muted check is a
 * preference and a missing placeholder is still a broken build.
 */
export function partitionFindings(findings, { entryId, state }) {
  const visible = [];
  const hidden = [];

  for (const finding of findings ?? []) {
    if (isDismissed(state, entryId, finding.code)) hidden.push(finding);
    else visible.push(finding);
  }

  return { visible, hidden };
}

/**
 * The analysis with dismissed findings removed.
 *
 * Filtering here rather than only in the panel is the point of the feature: a
 * muted check that still counts towards the red badge in the status bar is still
 * glaring, and the translator still learns to ignore the badge. Muting has to
 * reach the counts.
 *
 * `affected` is recomputed from the surviving per-entry issues. Project-level
 * checks (duplicate keys, inconsistent wording) have no single entry, so only a
 * check-level mute can silence them -- an entry-level dismissal would have
 * nothing to attach to.
 */
export function filterAnalysis(analysis, { state } = {}) {
  if (!analysis || !state) return analysis;

  const byEntry = new Map();
  const counts = { error: 0, warning: 0, info: 0 };
  const affected = new Set();

  for (const [entryId, issues] of analysis.byEntry ?? []) {
    const kept = [];

    for (const item of issues) {
      if (isDismissed(state, entryId, item.code)) continue;
      kept.push(item);
      counts[item.severity] += 1;
    }

    if (kept.length > 0) {
      byEntry.set(entryId, kept);
      affected.add(entryId);
    }
  }

  const projectIssues = (analysis.projectIssues ?? []).filter((item) => !isDismissed(state, null, item.code));

  return {
    ...analysis,
    byEntry,
    counts,
    affected,
    projectIssues,
    summary: { ...analysis.summary, entriesWithIssues: affected.size },
  };
}

/** The findings on one entry that a dismissal is currently hiding. */
export function hiddenFindings(issues, { entryId, state }) {
  return (issues ?? []).filter((item) => isDismissed(state, entryId, item.code));
}

export { SEVERITY };
