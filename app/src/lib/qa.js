/**
 * Quality checks.
 *
 * A game string that loses a `%s` still reads perfectly and crashes at runtime.
 * These checks exist to catch that class of mistake while the translator is
 * still looking at the entry, rather than after a build.
 *
 * Severity is deliberate. Errors are things that break the build or the game.
 * Warnings are things that are almost certainly wrong. Notes are things worth a
 * glance. A panel where everything is red gets ignored, so nothing is promoted
 * to error on a hunch.
 */

import { SEVERITY, SEVERITY_ORDER } from './constants.js';
import { isPlural, targetForms } from './entry.js';
import { comparePlaceholders, placeholderMap, whitespaceMismatch } from './placeholders.js';

const issue = (code, severity, message, detail) => ({ code, severity, message, detail });

/** Count non-overlapping occurrences. */
function countOf(text, pattern) {
  return (String(text ?? '').match(pattern) ?? []).length;
}

/**
 * Source/target pairs to compare.
 *
 * For a plural entry the singular target is checked against the singular source
 * and every other form against the plural source -- comparing plural form 2
 * against the singular source would report nonsense.
 */
export function formPairs(entry) {
  const targets = targetForms(entry);

  if (!isPlural(entry)) {
    return [{ label: null, source: entry.source, target: targets[0] ?? '' }];
  }

  return targets.map((target, index) => ({
    label: index === 0 ? 'singular' : `plural ${index}`,
    source: index === 0 ? entry.source : entry.pluralSource ?? entry.source,
    target,
  }));
}

/**
 * Every issue for one entry.
 *
 * `settings` carries the project's language pair and thresholds; the checks
 * degrade gracefully when it is missing so the function is usable on its own.
 */
export function checkEntry(entry, settings = {}) {
  const issues = [];
  const pairs = formPairs(entry);

  for (const { label, source, target } of pairs) {
    const where = label ? ` (${label})` : '';
    const trimmed = target.trim();

    if (trimmed === '') {
      // An empty form is only an error when there is something to translate.
      if (source.trim() !== '') {
        issues.push(
          issue('empty-target', SEVERITY.ERROR, `Missing translation${where}.`, source.slice(0, 80)),
        );
      }
      continue;
    }

    // ------------------------------------------------------ placeholders
    const { missing, extra } = comparePlaceholders(source, target);

    if (missing.length) {
      issues.push(
        issue(
          'placeholder-missing',
          SEVERITY.ERROR,
          `Missing placeholder${missing.length > 1 ? 's' : ''}${where}: ${missing.join(', ')}`,
          'The source contains these but the translation does not.',
        ),
      );
    }

    if (extra.length) {
      issues.push(
        issue(
          'placeholder-extra',
          SEVERITY.WARNING,
          `Unexpected placeholder${extra.length > 1 ? 's' : ''}${where}: ${extra.join(', ')}`,
          'The translation adds these, which the source does not have.',
        ),
      );
    }

    // Positional printf without an explicit index depends on argument order.
    const positional = (text) =>
      (String(text ?? '').match(/%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?[diouxXeEfgGaAcsp]/g) ?? [])
        .filter((token) => !/^\d+\$/.test(token.slice(1)));

    const sourceOrder = positional(source);
    const targetOrder = positional(target);
    if (
      sourceOrder.length > 1 &&
      sourceOrder.length === targetOrder.length &&
      sourceOrder.join('\u0000') !== targetOrder.join('\u0000')
    ) {
      issues.push(
        issue(
          'placeholder-order',
          SEVERITY.WARNING,
          `Placeholders reordered${where}: source has ${sourceOrder.join(' ')}, translation has ${targetOrder.join(' ')}`,
          'Unindexed format specifiers are filled in order, so this will swap the values.',
        ),
      );
    }

    // ------------------------------------------------------- whitespace
    const spacing = whitespaceMismatch(source, target);
    if (spacing) {
      issues.push(
        issue(
          'whitespace',
          SEVERITY.WARNING,
          `${spacing.join(' and ')} whitespace differs from the source${where}`,
          'Leading and trailing spaces are usually deliberate in game strings.',
        ),
      );
    }

    const sourceNewlines = countOf(source, /\n/g);
    const targetNewlines = countOf(target, /\n/g);
    if (sourceNewlines !== targetNewlines) {
      issues.push(
        issue(
          'newline-count',
          SEVERITY.WARNING,
          `Line breaks differ${where}: source has ${sourceNewlines}, translation has ${targetNewlines}`,
          'The layout will not match the original.',
        ),
      );
    }

    // -------------------------------------------------------- punctuation
    const sourceEnd = source.trim().slice(-1);
    const targetEnd = target.trim().slice(-1);
    const terminal = /[.!?…。！？]/;
    if (terminal.test(sourceEnd) && !terminal.test(targetEnd) && targetEnd !== ':' && targetEnd !== ',') {
      issues.push(
        issue('terminal-punctuation', SEVERITY.INFO, `The source ends with "${sourceEnd}" but the translation does not${where}`),
      );
    }

    // --------------------------------------------------------- brackets
    for (const [open, close, name] of [['(', ')', 'parentheses'], ['[', ']', 'brackets']]) {
      const sourceOpen = countOf(source, new RegExp(`\\${open}`, 'g'));
      const targetOpen = countOf(target, new RegExp(`\\${open}`, 'g'));
      const sourceClose = countOf(source, new RegExp(`\\${close}`, 'g'));
      const targetClose = countOf(target, new RegExp(`\\${close}`, 'g'));
      if (sourceOpen === sourceClose && targetOpen !== targetClose) {
        issues.push(
          issue('unbalanced-brackets', SEVERITY.WARNING, `Unbalanced ${name}${where}`, target),
        );
      }
    }

    // ------------------------------------------------------ same as source
    if (settings.flagSameAsSource !== false && trimmed === source.trim() && source.trim() !== '') {
      issues.push(
        issue('same-as-source', SEVERITY.WARNING, `The translation is identical to the source${where}`),
      );
    }

    // ------------------------------------------------------------ length
    const ratio = settings.lengthWarnRatio ?? 1.6;
    if (source.length > 8 && target.length > source.length * ratio) {
      issues.push(
        issue(
          'too-long',
          SEVERITY.INFO,
          `Much longer than the source${where} (${target.length} vs ${source.length} characters)`,
          'Long strings get clipped in tight UI.',
        ),
      );
    }

    // ---------------------------------------------------- double spacing
    if (/\S {2,}\S/.test(target) && !/\S {2,}\S/.test(source)) {
      issues.push(issue('double-space', SEVERITY.INFO, `Double space inside the translation${where}`));
    }
  }

  // Plural form count: a two-form language filled with three forms, or the
  // reverse, usually means the file was written for the wrong language.
  if (isPlural(entry)) {
    const expected = settings.expectedPluralForms;
    const actual = entry.pluralTargets.length;
    if (expected && actual !== expected) {
      issues.push(
        issue(
          'plural-form-count',
          SEVERITY.WARNING,
          `This entry has ${actual} plural forms but ${settings.targetLanguage ?? 'the target language'} needs ${expected}`,
        ),
      );
    }
  }

  return issues;
}

/** Highest severity in a list, or null. */
export function worstSeverity(issues) {
  if (!issues || issues.length === 0) return null;
  return issues.reduce(
    (worst, current) => (SEVERITY_ORDER[current.severity] < SEVERITY_ORDER[worst] ? current.severity : worst),
    issues[0].severity,
  );
}

/** Does this entry have at least one issue at or above the given severity? */
export function hasIssueAtLeast(issues, severity) {
  const limit = SEVERITY_ORDER[severity];
  return (issues ?? []).some((current) => SEVERITY_ORDER[current.severity] <= limit);
}

/**
 * Project-wide analysis.
 *
 * Returns per-entry issues plus checks that only make sense across entries:
 * duplicate keys (the wrong string gets replaced at build time) and the same
 * source translated two different ways (inconsistent terminology).
 */
export function analyzeProject(entries, settings = {}) {
  const byEntry = new Map();
  const counts = { error: 0, warning: 0, info: 0 };
  const affected = new Set();

  for (const entry of entries) {
    const issues = checkEntry(entry, settings);
    if (issues.length) {
      byEntry.set(entry.id, issues);
      affected.add(entry.id);
      for (const current of issues) counts[current.severity] += 1;
    }
  }

  const projectIssues = [];

  // ------------------------------------------------------- duplicate keys
  const byKey = new Map();
  for (const entry of entries) {
    if (!entry.key) continue;
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }

  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    projectIssues.push(
      issue('duplicate-key', SEVERITY.WARNING, `Key "${key}" is used by ${group.length} entries`, 'Only one of them can win at build time.'),
    );
    for (const entry of group) affected.add(entry.id);
  }

  // ------------------------------------------------ inconsistent wording
  const bySource = new Map();
  for (const entry of entries) {
    if (!entry.source.trim() || !entry.target.trim()) continue;
    const normalised = entry.source.trim().toLowerCase();
    if (!bySource.has(normalised)) bySource.set(normalised, new Set());
    bySource.get(normalised).add(entry.target.trim());
  }

  let inconsistent = 0;
  for (const [source, targets] of bySource) {
    if (targets.size < 2) continue;
    inconsistent += 1;
    if (inconsistent <= 20) {
      projectIssues.push(
        issue('inconsistent-translation', SEVERITY.INFO, `"${source.slice(0, 60)}" is translated ${targets.size} different ways`),
      );
    }
  }

  // Missing plural forms across the project.
  const pluralMismatch = entries.filter((entry) => {
    if (!isPlural(entry)) return false;
    const expected = settings.expectedPluralForms;
    return expected ? entry.pluralTargets.length !== expected : false;
  }).length;

  return {
    byEntry,
    counts,
    affected,
    projectIssues,
    summary: {
      entriesWithIssues: affected.size,
      inconsistentSources: inconsistent,
      pluralMismatch,
    },
  };
}

/** Placeholder tokens in a string, for highlighting in the editor. */
export function tokensOf(text) {
  return [...placeholderMap(text).entries()].map(([token, count]) => ({ token, count }));
}
