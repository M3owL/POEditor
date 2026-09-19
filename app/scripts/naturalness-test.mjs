/**
 * Polish naturalness tests.
 *
 * Two kinds of case live here, and the second matters more than the first.
 *
 * The first is ordinary: does the numeral rule get 22 right, does the calque
 * table catch "dokonaj zakupu".
 *
 * The second is the invariant that this module exists to protect, and it is the
 * one that is easy to lose:
 *
 *   - every finding carries a real severity
 *   - a finding with no mechanical fix is reported as a hint and NEVER edits
 *     the text
 *   - a finding WITH a fix produces grammatical Polish when applied
 *
 * That last one is not a style preference. A tool that silently rewrites
 * "W celu otwarcia drzwi" into "aby otwarcia drzwi" is worse than one that says
 * nothing, because the translator has no reason to re-read a sentence the tool
 * claims to have fixed. The regression tests below pin each safe fix to its
 * expected output so a future edit to the calque table cannot quietly
 * reintroduce that.
 *
 *   npm run test:naturalness
 */

import assert from 'node:assert/strict';

import {
  assessNaturalness,
  applyFix,
  applyAllFixes,
  expectedForm,
  fold,
  restoreDiacritics,
  isMisspelt,
  scoreLabel,
  CALQUES,
} from '../src/lib/naturalness.js';
import { SEVERITY, SEVERITY_ORDER } from '../src/lib/constants.js';

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

/** Assess Polish text, with the source optional. */
const pl = (target, source = '') => assessNaturalness(target, { source, language: 'pl' });

/** The codes a result reports, in order. */
const codes = (result) => result.findings.map((finding) => finding.code);

/** A specific finding, or undefined. */
const finding = (result, code) => result.findings.find((item) => item.code === code);

// ---------------------------------------------------------------------------
// The invariant that started all this
// ---------------------------------------------------------------------------

test('every finding carries a real severity', () => {
  // The module once declared FINDING = { ERROR, warning, INFO }; the mixed
  // casing made every FINDING.WARNING reference undefined, so five checks
  // emitted findings with no severity and quietly took the wrong penalty. Any
  // consumer doing a colour or ordering lookup would have broken on them.
  const corpus = [
    'Zostalo Ci 5 HP',
    'Masz 22 plikow do przetworzenia',
    'Adresujemy ten problem',
    'Dokonaj zakupu tej mikstury',
    'W celu otwarcia drzwi nacisnij przycisk',
    'Został otwarty przez gracza',
    'Witaj w Nowym Świecie',
    'Kliknij, aby otworzyć  menu',
    'Powtórzone powtórzone słowo',
    'Zakres 10-20 oraz "cudzysłów"',
    'To jest bardzo ale to bardzo długie tłumaczenie którego źródło było krótkie',
    'wprowadzanie ustawień powoduje problemy',
    'Uwaga!!!',
    'Masz 3 punktow',
    'the quick brown fox',
  ];

  for (const text of corpus) {
    for (const language of ['pl', 'de']) {
      const result = assessNaturalness(text, { source: 'Some English source text here', language });

      for (const item of result.findings) {
        ok(
          SEVERITY_ORDER[item.severity] !== undefined,
          `finding "${item.code}" in ${JSON.stringify(text)} has invalid severity ${JSON.stringify(item.severity)}`,
        );
        ok(typeof item.code === 'string' && item.code.length > 0, 'finding has a code');
        ok(typeof item.message === 'string' && item.message.length > 0, `finding "${item.code}" has a message`);
      }
    }
  }
});

test('a finding with no fix is always flagged as a hint', () => {
  const result = pl('Adresujemy ten problem');

  for (const item of result.findings) {
    if (item.fix) continue;
    // Every non-fixable finding must declare itself as advice only, so the UI
    // can present it differently from something it can apply.
    ok(item.hint === true, `finding "${item.code}" has no fix and is not marked as a hint`);
  }
});

test('hint-only findings never edit the text', () => {
  const cases = [
    ['Adresujemy ten problem', 'We address this problem'],
    ['W celu otwarcia drzwi nacisnij przycisk', 'In order to open the door press the button'],
    ['Bazujac na twoich ustawieniach', 'Based on your settings'],
    ['Dokonaj zakupu tej mikstury', 'Make a purchase of this potion'],
    ['Za pomoca narzedzia', 'By means of the tool'],
  ];

  for (const [text, source] of cases) {
    const result = pl(text, source);
    const { text: after, applied } = applyAllFixes(text, result.findings);

    // Diacritics may legitimately be restored; the *calque* must not be
    // substituted, because each of these replacements needs the sentence
    // rebuilt.
    ok(!applied.includes('calque'), `${JSON.stringify(text)} auto-applied a calque fix`);
    ok(
      !after.includes('rozwiązać / zająć się') && !after.includes('aby ') && !after.includes('na podstawie'),
      `${JSON.stringify(text)} was rewritten into ${JSON.stringify(after)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Safe fixes, pinned
// ---------------------------------------------------------------------------

test('safe fixes produce the expected text', () => {
  // Each pair is a claim about Polish grammar, so each is pinned by an example
  // rather than trusted. If the calque table is edited and one of these starts
  // producing something ungrammatical, this test says which.
  const cases = [
    ['To jest swój własny wybór', 'To jest własny wybór'],
    ['Wróć z powrotem do menu', 'Wróć do menu'],
    ['Połącz razem elementy', 'Połącz elementy'],
    ['Cofnij się do tyłu', 'Cofnij się'],
    ['To nowa innowacja', 'To innowacja'],
    // A replacement at the start of a sentence keeps its capital.
    ['W dniu dzisiejszym brak danych', 'Dzisiaj brak danych'],
    ['Na chwilę obecną nie ma danych', 'Obecnie nie ma danych'],
    ['Z uwagi na fakt, że brakuje miejsca', 'Ponieważ brakuje miejsca'],
    ['W momencie gdy gracz wchodzi', 'Gdy gracz wchodzi'],
    ['Musisz posiadać konto', 'Musisz mieć konto'],
    ['Podejmij decyzję teraz', 'Zdecyduj teraz'],
    ['Finalnie wybierz opcję', 'Ostatecznie wybierz opcję'],
    ['Aktualnie trwa aktualizacja', 'Obecnie trwa aktualizacja'],
    ['To jest dedykowany serwer', 'To jest przeznaczony serwer'],
    // The jargon entries cover the bare infinitive only. "wygenerować" carries
    // a prefix that shifts the meaning, so it is deliberately not rewritten.
    ['Aby generować raport', 'Aby tworzyć raport'],
  ];

  for (const [before, after] of cases) {
    const result = pl(before);
    const fixed = applyAllFixes(before, result.findings);

    eq(fixed.text, after, `${JSON.stringify(before)} should become ${JSON.stringify(after)}`);
  }
});

test('pleonasm fixes keep the inflection of the matched verb', () => {
  // The reason a pleonasm fix is safe at all. Substituting a fixed string would
  // turn "Wróć z powrotem" into "wracać" -- wrong person, mood and number -- so
  // the fix keeps the matched head and drops only the tail.
  const cases = [
    ['Wróć z powrotem', 'Wróć'],
    ['Wracam z powrotem', 'Wracam'],
    ['Wróciłem z powrotem', 'Wróciłem'],
    ['Łączymy razem', 'Łączymy'],
    ['Połącz razem', 'Połącz'],
    ['Współpracuj razem', 'Współpracuj'],
    ['Cofnij się do tyłu', 'Cofnij się'],
  ];

  for (const [before, after] of cases) {
    const result = pl(before);
    const fixed = applyAllFixes(before, result.findings);

    eq(fixed.text, after, `${JSON.stringify(before)} should become ${JSON.stringify(after)}`);
  }
});

test('every calque key is written folded', () => {
  // Matching happens against folded text, so a key containing "ó" or "ł" can
  // never be found. The entry then fails silently -- nothing is reported and
  // nothing looks broken. This is a cheap check that catches it.
  for (const calque of CALQUES) {
    eq(
      calque.phrase,
      fold(calque.phrase),
      `calque key ${JSON.stringify(calque.phrase)} contains diacritics and can never match`,
    );
    eq(calque.phrase, calque.phrase.toLowerCase(), `calque key ${JSON.stringify(calque.phrase)} is not lower case`);
  }
});

test('every calque key is unique', () => {
  const seen = new Map();

  for (const calque of CALQUES) {
    ok(!seen.has(calque.phrase), `duplicate calque key ${JSON.stringify(calque.phrase)}`);
    seen.set(calque.phrase, calque);
  }
});

test('a safe calque is never reported as a hint, and a hint never carries a fix', () => {
  for (const calque of CALQUES) {
    const result = pl(calque.phrase);
    const item = result.findings.find((entry) => entry.code === 'calque');

    ok(item, `calque ${JSON.stringify(calque.phrase)} did not trigger on itself`);
    eq(item.hint === true, !calque.safe, `calque ${JSON.stringify(calque.phrase)} hint flag disagrees with its safe flag`);
    eq(Boolean(item.fix), Boolean(calque.safe), `calque ${JSON.stringify(calque.phrase)} fix presence disagrees with its safe flag`);
    eq(item.message.includes(calque.replacement), true, `calque ${JSON.stringify(calque.phrase)} should offer ${JSON.stringify(calque.replacement)}`);
  }
});

test('longer calques win over their own prefixes', () => {
  // "dedykowany dla" contains "dedykowany". Reporting both would show the
  // translator two overlapping corrections for one span.
  const result = pl('Ten serwer jest dedykowany dla ciebie');
  const calques = result.findings.filter((item) => item.code === 'calque');

  eq(calques.length, 1, `expected one calque, got ${calques.map((item) => item.message).join(' | ')}`);
  ok(calques[0].match.includes('dedykowany dla'), `expected the long span, got ${JSON.stringify(calques[0].match)}`);
});

// ---------------------------------------------------------------------------
// Numeral agreement
// ---------------------------------------------------------------------------

test('numeral agreement picks the right form', () => {
  eq(expectedForm(1), 0, '1 -> singular');
  eq(expectedForm(2), 1, '2 -> nominative plural');
  eq(expectedForm(4), 1, '4 -> nominative plural');
  eq(expectedForm(5), 2, '5 -> genitive plural');
  eq(expectedForm(0), 2, '0 -> genitive plural');
  eq(expectedForm(12), 2, '12 -> genitive plural');
  eq(expectedForm(13), 2, '13 -> genitive plural');
  eq(expectedForm(14), 2, '14 -> genitive plural');
  eq(expectedForm(22), 1, '22 -> nominative plural');
  eq(expectedForm(23), 1, '23 -> nominative plural');
  eq(expectedForm(25), 2, '25 -> genitive plural');
  eq(expectedForm(112), 2, '112 -> genitive plural');
  eq(expectedForm(122), 1, '122 -> nominative plural');
  eq(expectedForm(-3), 1, 'negative counts follow the absolute value');
});

test('correct numeral agreement is not flagged', () => {
  for (const text of [
    'Masz 1 plik',
    'Masz 2 pliki',
    'Masz 4 pliki',
    'Masz 5 plików',
    'Masz 12 plików',
    'Masz 22 pliki',
    'Masz 25 plików',
    'Masz 122 pliki',
    'Masz 3 punkty',
    'Masz 5 punktów',
  ]) {
    eq(codes(pl(text)), [], `${JSON.stringify(text)} is correct Polish and should report nothing`);
    eq(pl(text).score, 100, `${JSON.stringify(text)} should score 100`);
  }
});

test('wrong numeral agreement is flagged and fixed', () => {
  const cases = [
    ['Masz 22 plikow do przetworzenia', 'Masz 22 pliki do przetworzenia'],
    ['Masz 12 pliki do przetworzenia', 'Masz 12 plików do przetworzenia'],
    ['Masz 3 punktow', 'Masz 3 punkty'],
    ['Masz 2 plików', 'Masz 2 pliki'],
    ['Zostało 22 punktow', 'Zostało 22 punkty'],
  ];

  for (const [before, after] of cases) {
    const result = pl(before);
    ok(codes(result).includes('numeral-agreement'), `${JSON.stringify(before)} should report numeral-agreement`);
    eq(applyAllFixes(before, result.findings).text, after, `${JSON.stringify(before)} should become ${JSON.stringify(after)}`);
  }
});

test('a noun with the right form but no accent is still fixed', () => {
  // "5 punktow" is the *correct* form (genitive plural) -- it only lacks the
  // accent. The numeral rule therefore stays silent, and an earlier version
  // marked the span as its own anyway, which silenced the diacritics check too
  // and left the text broken with nothing reported.
  const result = pl('Masz 5 punktow');

  eq(codes(result), ['missing-diacritics'], 'the diacritics check must own this, not the numeral rule');
  eq(applyAllFixes('Masz 5 punktow', result.findings).text, 'Masz 5 punktów');
  eq(pl('Masz 5 punktów').score, 100, 'the corrected form is clean Polish');
});

test('the numeral rule owns its noun, so diacritics leave it alone', () => {
  // "3 punktow" needs the numeral rule ("3 punkty"), not a diacritic
  // restoration ("3 punktów"). Both checks firing on the same word produced the
  // second, wrong answer.
  const result = pl('Masz 3 punktow');
  const diacritics = finding(result, 'missing-diacritics');

  ok(!diacritics, 'the noun after a numeral must not also be reported as a misspelling');
  eq(applyAllFixes('Masz 3 punktow', result.findings).text, 'Masz 3 punkty');
});

test('a noun is not matched through a longer form of itself', () => {
  // Alternation is ordered, so "plik|pliki|plików" matches "plik" inside
  // "plików" and reports the correct "5 plików" as an error.
  const result = pl('Masz 5 plików do przetworzenia');
  eq(codes(result), []);
});

// ---------------------------------------------------------------------------
// Diacritics
// ---------------------------------------------------------------------------

test('fold is length-preserving', () => {
  // Calque matching happens on folded text and reports spans sliced from the
  // original, which only works if an index survives folding.
  const samples = ['Zażółć gęślą jaźń', 'Zostalo Ci 5 HP', 'Łódź', 'Ćwiczenie Ę Ą Ó'];

  for (const sample of samples) {
    eq(fold(sample).length, sample.length, `fold changed the length of ${JSON.stringify(sample)}`);
  }
});

test('missing diacritics are detected and restored with case preserved', () => {
  eq(restoreDiacritics('Zostalo'), 'Zostało');
  eq(restoreDiacritics('ZOSTALO'), 'ZOSTAŁO');
  eq(restoreDiacritics('zostalo'), 'zostało');
  eq(restoreDiacritics('plikow'), 'plików');

  const result = pl('Zostalo Ci 5 HP');
  ok(codes(result).includes('missing-diacritics'), 'should report missing diacritics');
  eq(applyAllFixes('Zostalo Ci 5 HP', result.findings).text, 'Zostało Ci 5 HP');
});

test('correct Polish is never reported as misspelt', () => {
  // A dictionary entry whose value equals its key is a valid word. Reporting
  // those was a real false-positive source.
  for (const word of ['wersja', 'punkt', 'mikstury', 'gracz', 'poziom', 'konto', 'profil', 'misja']) {
    eq(isMisspelt(word), false, `${word} is correct Polish and must not be reported`);
    eq(restoreDiacritics(word), null, `${word} has nothing to restore`);
  }
});

test('words that are valid without diacritics are left alone', () => {
  for (const text of ['Nowa wersja', 'Masz 3 punkty', 'Wybierz poziom', 'Cena: 100', 'Brak danych']) {
    eq(codes(pl(text)), [], `${JSON.stringify(text)} should report nothing`);
  }
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

test('clean Polish scores 100 and worse text scores lower', () => {
  eq(pl('Zapisz i zamknij').score, 100);
  eq(pl('Podaj swoje imię').score, 100);
  eq(pl('Witaj w Nowym Świecie').score, 100);

  const clean = pl('Zapisz i zamknij').score;
  const withInfo = pl('Został otwarty przez gracza').score;
  const withWarning = pl('Adresujemy ten problem').score;
  const withError = pl('Zostalo Ci 5 HP').score;

  ok(clean > withInfo, 'an info finding should cost something');
  ok(withInfo > withWarning, 'a warning should cost more than an info');
  ok(withWarning > withError, 'an error should cost more than a warning');
});

test('empty text has no score', () => {
  const result = pl('');
  eq(result.score, null);
  eq(result.findings, []);
  eq(scoreLabel(result.score).label, 'brak tekstu');
});

test('severity ordering matches the shared vocabulary', () => {
  eq(SEVERITY.ERROR, 'error');
  eq(SEVERITY.WARNING, 'warning');
  eq(SEVERITY.INFO, 'info');
  ok(SEVERITY_ORDER.error < SEVERITY_ORDER.warning);
  ok(SEVERITY_ORDER.warning < SEVERITY_ORDER.info);
});

test('only Polish gets Polish-specific checks', () => {
  // The function must stay honest for other targets: fewer findings, not wrong
  // ones. "Zostalo" is not a German misspelling.
  const german = assessNaturalness('Zostalo Ci 5 HP', { source: 'You have 5 HP left', language: 'de' });
  eq(codes(german), []);
  eq(german.score, 100);

  const polish = assessNaturalness('Zostalo Ci 5 HP', { source: 'You have 5 HP left', language: 'pl' });
  ok(codes(polish).includes('missing-diacritics'));
});

test('placeholder-only changes do not upset the score', () => {
  for (const text of ['Masz %d pliki', 'Masz %s', 'Witaj, {name}!', 'Masz %1$d pliki']) {
    const result = pl(text, 'You have %d files');
    eq(codes(result), [], `${JSON.stringify(text)} should report nothing`);
  }
});

test('applyFix is a no-op when there is nothing mechanical to do', () => {
  const hint = pl('Adresujemy ten problem').findings.find((item) => item.code === 'calque');
  eq(applyFix('Adresujemy ten problem', hint), null);
  eq(applyFix('cokolwiek', null), null);
  eq(applyFix('cokolwiek', { code: 'x' }), null);
});

// ---------------------------------------------------------------------------

process.stdout.write(`\n\n${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  for (const { name, error } of failures) {
    process.stdout.write(`\n✗ ${name}\n  ${error.message}\n`);
  }
  process.exitCode = 1;
}
