/**
 * Suggestion, prompt and dismissal tests.
 *
 * The three modules here are the ones the translator interacts with most, and
 * they share a failure mode worth testing for explicitly: they can be *plausible*
 * while being useless. A confidence figure that does not move with the evidence,
 * a prompt that silently drops the text, a dismissal that resets on reload --
 * none of those throw, and none of them look broken in a screenshot.
 *
 * So the tests below check the properties rather than the happy path:
 *
 *   - confidence is ordered by evidence, and stays inside 0..100
 *   - a suggestion never proposes the text that is already there
 *   - the prompt always contains the text, whatever the template looks like
 *   - a dismissal survives a save/load round trip and can be undone
 *   - every check the app can raise is muteable (see the last test, which
 *     fails if a new check is added to qa.js or naturalness.js and forgotten)
 *
 *   npm run test:suggest
 */

import assert from 'node:assert/strict';

import { buildSuggestions, assessEntry, SUGGESTION_CEILING } from '../src/lib/suggest.js';
import { buildMemory } from '../src/lib/tm.js';
import { createEntry, setTargetForm } from '../src/lib/entry.js';
import { analyzeProject } from '../src/lib/qa.js';
import { assessNaturalness } from '../src/lib/naturalness.js';
import {
  buildBatchPrompt,
  buildPrompt,
  formatForPrompt,
  DEFAULT_PROMPT_TEMPLATE,
} from '../src/lib/prompt.js';
import {
  CHECK_CATALOGUE,
  checkLabel,
  clearDismissals,
  createDismissals,
  dismiss,
  dismissAllOnEntry,
  dismissedCount,
  isDismissed,
  muteCheck,
  mutedCodes,
  partitionFindings,
  pruneDismissals,
  restore,
  unknownCheckCodes,
  unmuteCheck,
} from '../src/lib/dismissed.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('.');
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    process.stdout.write('F');
  }
}

const ok = (value, message) => assert.ok(value, message);
const eq = (actual, expected, message) =>
  assert.deepEqual(actual, expected, message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** Suggestions for an entry, with a memory built from the other entries. */
function suggestFor(entry, entries = [], options = {}) {
  const memory = buildMemory(entries);
  return buildSuggestions(entry, { entries, memory, language: 'pl', ...options });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

test('no entry means no suggestions', () => {
  eq(buildSuggestions(null, {}), []);
  eq(buildSuggestions(undefined, {}), []);
});

test('an exact memory match scores at the top of its band', () => {
  const entry = createEntry({ key: 'a', source: 'Save and close', target: '' });
  const other = createEntry({ key: 'b', source: 'Save and close', target: 'Zapisz i zamknij' });

  const [best] = suggestFor(entry, [other]);

  ok(best, 'expected a suggestion');
  eq(best.kind, 'memory-exact');
  eq(best.text, 'Zapisz i zamknij');
  ok(best.confidence <= SUGGESTION_CEILING['memory-exact'], 'must respect its ceiling');
  ok(best.confidence >= 90, `an exact match should be near the top, got ${best.confidence}`);
});

test('disagreement lowers the confidence, agreement keeps it high', () => {
  const entry = createEntry({ key: 'a', source: 'Delete file', target: '' });

  // Unanimous: the project has decided, so the match keeps its ceiling.
  const agreed = suggestFor(entry, [
    createEntry({ key: 'b', source: 'Delete file', target: 'Usuń plik' }),
    createEntry({ key: 'c', source: 'Delete file', target: 'Usuń plik' }),
    createEntry({ key: 'd', source: 'Delete file', target: 'Usuń plik' }),
  ]);

  eq(agreed.map((item) => item.text), ['Usuń plik'], 'a unanimous source yields one proposal');
  eq(agreed[0].kind, 'memory-exact', 'unanimous means it is an exact match');
  ok(agreed[0].confidence >= 95, `a unanimous exact match should be near the top, got ${agreed[0].confidence}`);

  // Contested 2-to-1: an exact match alone would show whichever rendering the
  // memory happened to hold first and hide the disagreement -- and would label
  // all of them "exact", telling the translator the opposite of the truth.
  const disputed = suggestFor(entry, [
    createEntry({ key: 'b', source: 'Delete file', target: 'Usuń plik' }),
    createEntry({ key: 'c', source: 'Delete file', target: 'Usuń plik' }),
    createEntry({ key: 'd', source: 'Delete file', target: 'Skasuj plik' }),
  ]);

  eq(disputed.length, 2, `both renderings should be offered, got ${JSON.stringify(disputed.map((item) => item.text))}`);
  eq(disputed[0].text, 'Usuń plik', 'the majority rendering comes first');
  ok(
    disputed.every((item) => item.kind === 'consistency'),
    `disagreement should be labelled as such, got ${JSON.stringify(disputed.map((item) => item.kind))}`,
  );
  ok(
    disputed[0].confidence > disputed[1].confidence,
    `2 of 3 must outrank 1 of 3, got ${disputed[0].confidence} vs ${disputed[1].confidence}`,
  );
  ok(
    disputed[0].confidence < agreed[0].confidence,
    'a contested rendering must not score as high as a unanimous one',
  );
  ok(
    disputed[0].rationale.includes('of 3'),
    `the rationale should say how many entries agree, got ${JSON.stringify(disputed[0].rationale)}`,
  );
});

test('a fuzzy match scores below an exact one', () => {
  const entry = createEntry({ key: 'a', source: 'Open the settings menu', target: '' });
  const other = createEntry({ key: 'b', source: 'Open the settings window', target: 'Otwórz okno ustawień' });

  const [best] = suggestFor(entry, [other]);
  ok(best.confidence < SUGGESTION_CEILING['memory-exact'], 'a near-miss must not outrank a match');
  ok(best.confidence <= SUGGESTION_CEILING['memory-fuzzy']);
});

test('a mechanically repairable translation is proposed', () => {
  const entry = createEntry({ key: 'a', source: 'You have 5 HP left', target: 'Zostalo Ci 5 HP' });
  const suggestions = suggestFor(entry, []);

  const repair = suggestions.find((item) => item.kind === 'diacritics' || item.kind === 'naturalness');

  ok(repair, 'expected a repair suggestion');
  ok(repair.text.includes('Zostało'), `expected the accents restored, got ${JSON.stringify(repair.text)}`);
});

test('nothing is proposed that is already typed', () => {
  const entry = createEntry({ key: 'a', source: 'Save and close', target: 'Zapisz i zamknij' });
  const other = createEntry({ key: 'b', source: 'Save and close', target: 'Zapisz i zamknij' });

  const suggestions = suggestFor(entry, [other]);

  for (const suggestion of suggestions) {
    ok(
      suggestion.text.trim() !== entry.target.trim(),
      `proposed the text that is already there: ${JSON.stringify(suggestion.text)}`,
    );
  }
});

test('identical texts are collapsed, keeping the strongest', () => {
  const entry = createEntry({ key: 'a', source: 'Retry', target: '' });
  const suggestions = suggestFor(entry, [
    createEntry({ key: 'b', source: 'Retry', target: 'Ponów' }),
    createEntry({ key: 'c', source: 'Retry', target: 'Ponów' }),
  ]);

  const texts = suggestions.map((item) => item.text);
  eq(texts.length, new Set(texts).size, `duplicate proposals survived: ${JSON.stringify(texts)}`);
});

test('every confidence is a sane percentage and the list is sorted', () => {
  const entry = createEntry({ key: 'a', source: 'Delete file', target: 'Usun plik' });

  const suggestions = suggestFor(entry, [
    createEntry({ key: 'b', source: 'Delete file', target: 'Usuń plik' }),
    createEntry({ key: 'c', source: 'Delete all files', target: 'Usuń wszystkie pliki' }),
  ]);

  for (const suggestion of suggestions) {
    ok(
      Number.isFinite(suggestion.confidence) && suggestion.confidence >= 0 && suggestion.confidence <= 100,
      `confidence out of range: ${suggestion.confidence} for ${suggestion.kind}`,
    );
    ok(typeof suggestion.label === 'string' && suggestion.label.length > 0, 'every suggestion is labelled');
    ok(typeof suggestion.rationale === 'string' && suggestion.rationale.length > 0, 'every suggestion explains itself');
  }

  for (let i = 1; i < suggestions.length; i += 1) {
    ok(
      suggestions[i - 1].confidence >= suggestions[i].confidence,
      'suggestions must be sorted best first',
    );
  }
});

test('the limit is respected', () => {
  const entry = createEntry({ key: 'a', source: 'Retry', target: '' });
  const others = Array.from({ length: 12 }, (_, i) =>
    createEntry({ key: `k${i}`, source: 'Retry', target: `Ponów ${i}` }),
  );

  eq(suggestFor(entry, others, { limit: 3 }).length, 3);
});

test('an empty target gets no repair suggestion', () => {
  const entry = createEntry({ key: 'a', source: 'Save', target: '' });
  const suggestions = suggestFor(entry, []);

  eq(suggestions.filter((item) => item.kind === 'naturalness' || item.kind === 'diacritics'), []);
});

// ---------------------------------------------------------------------------
// Overview assessment
// ---------------------------------------------------------------------------

test('the overview score is the worst plural form, not the average', () => {
  const entry = createEntry({
    key: 'a',
    source: 'You have 1 file',
    pluralSource: 'You have %d files',
    pluralTargets: ['Masz 1 plik', 'Masz 22 plikow'],
  });

  const result = assessEntry(entry, { language: 'pl' });
  const perForm = result.perForm.map((form) => form.score);

  ok(perForm[1] < perForm[0], `expected the plural to score lower, got ${JSON.stringify(perForm)}`);
  eq(result.score, Math.min(...perForm), 'the overall figure must be the worst form');
});

test('dismissed findings are removed from the overview', () => {
  const entry = createEntry({ key: 'a', source: 'You have 5 HP left', target: 'Zostalo Ci 5 HP' });

  const all = assessEntry(entry, { language: 'pl' });
  ok(all.findings.length > 0, 'expected findings to begin with');

  const filtered = assessEntry(entry, {
    language: 'pl',
    isDismissed: (code) => code === 'missing-diacritics',
  });

  eq(filtered.findings.length, 0, 'the dismissed check should be gone');
});

test('an empty entry has no overview score', () => {
  const result = assessEntry(createEntry({ key: 'a', source: 'Save', target: '' }), { language: 'pl' });
  eq(result.score, null);
});

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

test('formatting normalises the artefacts of a copied source string', () => {
  eq(formatForPrompt('  Save   and\n\n\nclose  '), 'Save and\n\nclose');
  eq(formatForPrompt('a\u00a0b'), 'a b', 'non-breaking space must become an ordinary one');
  eq(formatForPrompt('line\r\nnext'), 'line\nnext');
  eq(formatForPrompt(''), '');
  eq(formatForPrompt(null), '');
});

test('formatting never touches placeholders', () => {
  // These have to survive into the model's answer verbatim, so they are the one
  // thing the formatter must not be clever about.
  for (const text of ['You have %d files', 'Hello %1$s, you are %2$s', 'Welcome, {name}!', 'Press %s']) {
    eq(formatForPrompt(text), text, `${JSON.stringify(text)} must pass through unchanged`);
  }
});

test('the default prompt puts the instruction first and the text last', () => {
  const prompt = buildPrompt('Save and close');

  eq(prompt, 'przetłumacz to na naturalny polski:\nSave and close');
  ok(prompt.startsWith('przetłumacz to na naturalny polski'), 'the instruction comes first');
  ok(prompt.endsWith('Save and close'), 'the text comes last');
});

test('the text is never dropped, whatever the template looks like', () => {
  // A button whose whole job is to put the text on the clipboard must not lose
  // the text because the template was edited badly.
  const templates = [
    'przetłumacz to na naturalny polski:\n{text}',
    'translate: {text}',
    '{text}',
    'przetłumacz to:',
    '',
    '   ',
  ];

  for (const template of templates) {
    const prompt = buildPrompt('Zapisz i zamknij', { template });
    ok(
      prompt.includes('Zapisz i zamknij'),
      `template ${JSON.stringify(template)} dropped the text: ${JSON.stringify(prompt)}`,
    );
  }
});

test('context is appended only when asked for', () => {
  const without = buildPrompt('Save', { template: DEFAULT_PROMPT_TEMPLATE });
  ok(!without.includes('key:'), 'no context by default');

  const withContext = buildPrompt('Save', {
    template: DEFAULT_PROMPT_TEMPLATE,
    key: 'menu.save',
    comment: 'Shown on the toolbar',
  });

  ok(withContext.includes('menu.save'), 'the key should be included');
  ok(withContext.includes('Shown on the toolbar'), 'the comment should be included');
  ok(withContext.startsWith('przetłumacz to na naturalny polski:'), 'the instruction still leads');
});

test('a batch prompt numbers every source', () => {
  const prompt = buildBatchPrompt([
    { source: 'Save' },
    { source: 'Cancel' },
    { source: 'Delete' },
  ]);

  ok(prompt.includes('1. Save'), 'first item numbered');
  ok(prompt.includes('2. Cancel'), 'second item numbered');
  ok(prompt.includes('3. Delete'), 'third item numbered');
  ok(prompt.startsWith('przetłumacz to na naturalny polski'), 'the instruction leads the batch too');
});

// ---------------------------------------------------------------------------
// Dismissals
// ---------------------------------------------------------------------------

test('an entry dismissal hides one finding and can be undone', () => {
  const start = createDismissals();

  eq(isDismissed(start, 'e1', 'same-as-source'), false, 'nothing is hidden to begin with');

  const hidden = dismiss(start, 'e1', 'same-as-source');
  eq(isDismissed(hidden, 'e1', 'same-as-source'), true);
  eq(isDismissed(hidden, 'e2', 'same-as-source'), false, 'it must not leak to other entries');
  eq(isDismissed(hidden, 'e1', 'double-space'), false, 'it must not leak to other checks');

  const shown = restore(hidden, 'e1', 'same-as-source');
  eq(isDismissed(shown, 'e1', 'same-as-source'), false, 'restoring works');
});

test('muting a check hides it everywhere', () => {
  const state = muteCheck(createDismissals(), 'same-as-source');

  eq(isDismissed(state, 'e1', 'same-as-source'), true);
  eq(isDismissed(state, 'e99', 'same-as-source'), true);
  eq(isDismissed(state, 'e1', 'double-space'), false, 'other checks are unaffected');

  eq(isDismissed(unmuteCheck(state, 'same-as-source'), 'e1', 'same-as-source'), false);
});

test('dismissals survive a save and load round trip', () => {
  // A dismissal that resets on reload is not a dismissal -- it is the same
  // glare the feature exists to remove, one page refresh later.
  const state = muteCheck(dismiss(createDismissals(), 'e1', 'calque'), 'title-case');
  const restored = JSON.parse(JSON.stringify({ entries: state.entries, codes: state.codes }));

  eq(isDismissed(restored, 'e1', 'calque'), true);
  eq(isDismissed(restored, 'e2', 'title-case'), true);
  eq(isDismissed(restored, 'e2', 'calque'), false);
});

test('the count reflects both levels of dismissal', () => {
  const state = muteCheck(dismiss(dismiss(createDismissals(), 'e1', 'calque'), 'e1', 'passive'), 'title-case');
  eq(dismissedCount(state), 3);
  eq(dismissedCount(clearDismissals()), 0);
});

test('muted checks are listed', () => {
  const state = muteCheck(muteCheck(createDismissals(), 'verbose'), 'title-case');
  eq(mutedCodes(state), ['title-case', 'verbose']);
});

test('dismissing everything on one entry covers its findings', () => {
  const state = dismissAllOnEntry(createDismissals(), 'e1', ['calque', 'passive', 'quotes']);

  for (const code of ['calque', 'passive', 'quotes']) {
    eq(isDismissed(state, 'e1', code), true, `${code} should be hidden`);
  }
  eq(isDismissed(state, 'e1', 'verbose'), false);
});

test('dismissals for entries that no longer exist are pruned', () => {
  // Otherwise the store grows without bound as files are opened and closed, and
  // an id reused by a later project would hide a real finding.
  let state = dismiss(createDismissals(), 'e1', 'calque');
  state = dismiss(state, 'gone', 'calque');
  state = muteCheck(state, 'title-case');

  const pruned = pruneDismissals(state, ['e1']);

  eq(isDismissed(pruned, 'e1', 'calque'), true, 'live entries keep their dismissals');
  eq(Object.keys(pruned.entries).length, 1, 'the dead entry is dropped');
  eq(isDismissed(pruned, 'e2', 'title-case'), true, 'check-level mutes are project-wide and survive');
});

test('partitioning splits visible from hidden', () => {
  const findings = [{ code: 'calque' }, { code: 'passive' }, { code: 'title-case' }];
  const state = muteCheck(createDismissals(), 'title-case');

  const { visible, hidden } = partitionFindings(findings, { entryId: 'e1', state });

  eq(visible.map((item) => item.code), ['calque', 'passive']);
  eq(hidden.map((item) => item.code), ['title-case']);
});

test('every catalogue entry is unique and labelled', () => {
  const seen = new Set();

  for (const check of CHECK_CATALOGUE) {
    ok(!seen.has(check.code), `duplicate catalogue entry ${check.code}`);
    seen.add(check.code);
    ok(check.label && check.label.length > 0, `${check.code} has no label`);
    ok(check.group && check.group.length > 0, `${check.code} has no group`);
    eq(checkLabel(check.code), check.label);
  }
});

test('every check the app can raise is muteable', () => {
  // The invariant this module exists to protect. A check added to qa.js or
  // naturalness.js and forgotten here would appear in the panel with no way to
  // silence it -- the exact situation the feature was built to fix.
  const codes = new Set();

  // ---- naturalness, over a corpus that triggers every code
  const naturalnessCorpus = [
    'Zostalo Ci 5 HP',
    'Masz 22 plikow do przetworzenia',
    'Masz 3 punktow',
    'Adresujemy ten problem',
    'the quick brown fox jumps over the lazy dog',
    'Został otwarty przez gracza',
    '"prosty cudzysłów"',
    'Zapisz .',
    'Zapisz.Zamknij',
    'Welcome To The New World Today',
    'Zakres 10-20',
    'Masz to i proszę o cierpliwość',
    'To jest jest błąd',
    'wprowadzanie ustawienia powoduje problemy',
    'Uwaga!!!',
  ];

  for (const text of naturalnessCorpus) {
    for (const finding of assessNaturalness(text, { source: 'Some short English source', language: 'pl' }).findings) {
      codes.add(finding.code);
    }
  }

  // ---- qa.js, over entries built to fail one check each
  const longTarget = 'To jest bardzo długie tłumaczenie którego źródło było zupełnie krótkie';
  const qaEntries = [
    createEntry({ key: 'k1', source: 'Save', target: '' }),
    createEntry({ key: 'k2', source: 'You have %d files', target: 'Masz pliki' }),
    createEntry({ key: 'k3', source: 'Hello', target: 'Witaj %s' }),
    createEntry({ key: 'k4', source: '%1$s and %2$s', target: '%2$s i %1$s' }),
    createEntry({ key: 'k5', source: '%s', target: '%d' }),
    createEntry({ key: 'k6', source: 'line one\nline two', target: 'linia jedna linia druga' }),
    createEntry({ key: 'k7', source: 'Hello (world)', target: 'Witaj (świecie' }),
    createEntry({ key: 'k8', source: 'OK', target: 'OK' }),
    createEntry({ key: 'k9', source: 'Go', target: longTarget }),
    createEntry({ key: 'k10', source: 'Save.', target: 'Zapisz' }),
    createEntry({ key: 'k11', source: 'Retry', target: 'Ponów  ponownie' }),
    createEntry({ key: 'k12', source: 'Shared', target: 'Wspólny' }),
    createEntry({ key: 'k13', source: 'Shared', target: 'Dzielony' }),
    createEntry({
      key: 'k14',
      source: 'You have 1 file',
      pluralSource: 'You have %d files',
      pluralTargets: ['Masz 1 plik'],
    }),
    createEntry({ key: 'dup', source: 'A', target: 'B' }),
    createEntry({ key: 'dup', source: 'C', target: 'D' }),
  ];

  const analysis = analyzeProject(qaEntries, {
    sourceLanguage: 'en',
    targetLanguage: 'pl',
    expectedPluralForms: 3,
    lengthWarnRatio: 1.6,
    flagSameAsSource: true,
  });

  for (const issues of analysis.byEntry.values()) {
    for (const item of issues) codes.add(item.code);
  }
  for (const item of analysis.projectIssues ?? []) codes.add(item.code);

  const unknown = unknownCheckCodes([...codes]);

  eq(unknown, [], `these checks cannot be dismissed from the UI: ${unknown.join(', ')}`);
  ok(codes.size >= 20, `expected the corpus to trigger a broad set of checks, got ${codes.size}`);
});

// ---------------------------------------------------------------------------

process.stdout.write(`\n\n${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  for (const { name, error } of failures) {
    process.stdout.write(`\n✗ ${name}\n  ${error.message}\n`);
  }
  process.exitCode = 1;
}
