/**
 * Format and library tests.
 *
 * Runs under plain Node -- no bundler, no browser -- because every module under
 * test is pure ESM with no DOM dependency. `formats/tabular.js` is excluded on
 * purpose: it imports the browser build of the Excel libraries, and its logic
 * lives in `lib/grid.js` and `lib/csv.js`, which are tested here directly.
 * The spreadsheet I/O path is exercised separately against the Node builds.
 *
 *   node app/scripts/format-test.mjs
 */

import assert from 'node:assert/strict';

import { createEntry, isComplete, projectProgress, setTargetForm, targetForms, clearTargets, entryStatus, STATUS } from '../src/lib/entry.js';
import { comparePlaceholders, placeholders, whitespaceMismatch } from '../src/lib/placeholders.js';
import { detectDelimiter, parseDelimited, serializeDelimited } from '../src/lib/csv.js';
import { detectHeaderRow, detectMapping, entriesToGrid, gridToEntries, ROLE } from '../src/lib/grid.js';
import { parsePO, serializePO, escapePO, unescapePO } from '../src/formats/po.js';
import { parseXliff, serializeXliff } from '../src/formats/xliff.js';
import { parseJson, serializeJson } from '../src/formats/json.js';
import { parseAndroid, serializeAndroid, escapeAndroid, unescapeAndroid } from '../src/formats/android.js';
import { parseApple, serializeApple } from '../src/formats/apple.js';
import { parseSubtitles, serializeSubtitles } from '../src/formats/subtitles.js';
import { parseTmx, serializeTmx } from '../src/formats/tmx.js';
import { detectFormat } from '../src/formats/index.js';
import { nodesToRichText, richTextToNodes, parseXml, buildXml, childrenOf } from '../src/lib/xml.js';

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

const eq = (actual, expected, message) => assert.deepEqual(actual, expected, message);
const ok = (value, message) => assert.ok(value, message);

// ============================================================ entry model

test('entry: a fresh entry is untranslated', () => {
  const entry = createEntry({ source: 'Hello' });
  eq(entry.target, '');
  eq(entryStatus(entry), STATUS.UNTRANSLATED);
  ok(!isComplete(entry));
});

test('entry: a filled target is translated', () => {
  const entry = createEntry({ source: 'Hello', target: 'Witaj' });
  eq(entryStatus(entry), STATUS.TRANSLATED);
  ok(isComplete(entry));
});

test('entry: approved requires completeness', () => {
  const incomplete = createEntry({ source: 'Hello', approved: true });
  eq(entryStatus(incomplete), STATUS.UNTRANSLATED, 'approved but empty is still untranslated');

  const complete = createEntry({ source: 'Hello', target: 'Witaj', approved: true });
  eq(entryStatus(complete), STATUS.APPROVED);
});

test('entry: a half-filled plural is not complete', () => {
  const entry = createEntry({ source: '1 file', pluralSource: '%d files', pluralTargets: ['1 plik', ''] });
  ok(!isComplete(entry), 'one empty form means incomplete');
  eq(targetForms(entry).length, 2);
});

test('entry: whitespace-only target is untranslated', () => {
  const entry = createEntry({ source: 'Hello', target: '   ' });
  ok(!isComplete(entry));
  eq(entryStatus(entry), STATUS.UNTRANSLATED);
});

test('entry: setTargetForm routes plurals into the right slot', () => {
  let entry = createEntry({ source: '1 file', pluralSource: '%d files', pluralTargets: ['a', 'b'] });
  entry = setTargetForm(entry, 1, 'B');
  eq(entry.pluralTargets, ['a', 'B']);
  eq(entry.target, '', 'the singular slot must not be touched');
});

test('entry: setTargetForm writes target for non-plurals', () => {
  const entry = setTargetForm(createEntry({ source: 'x' }), 0, 'y');
  eq(entry.target, 'y');
  eq(entry.pluralTargets, []);
});

test('entry: progress counts forms, not entries', () => {
  const entries = [
    createEntry({ source: 'a', target: 'A' }),
    createEntry({ source: 'b', pluralSource: '%d b', pluralTargets: ['B', ''] }),
  ];
  const progress = projectProgress(entries);
  eq(progress.forms, 3);
  eq(progress.formsDone, 2);
  eq(progress.percent, 67);
});

test('entry: clearTargets empties everything but the source', () => {
  const cleared = clearTargets(createEntry({ source: 'a', target: 'A', pluralTargets: ['B', 'C'], approved: true }));
  eq(cleared.target, '');
  eq(cleared.pluralTargets, ['', '']);
  eq(cleared.source, 'a');
  ok(!cleared.approved);
});

// =========================================================== placeholders

test('placeholders: finds printf, brace, qt and dollar forms', () => {
  const found = placeholders('You have %d of %1$s and {0} plus ${VAR} at %2');
  ok(found.includes('%d'));
  ok(found.includes('%1$s'));
  ok(found.includes('{0}'));
  ok(found.includes('${VAR}'));
  ok(found.includes('%2'));
});

test('placeholders: a percentage in prose is not a specifier', () => {
  eq(placeholders('100% gotowe'), [], 'trailing percent must not look like a format code');
  eq(placeholders('50% zniżki'), []);
});

test('placeholders: missing specifier is reported', () => {
  const { missing, extra } = comparePlaceholders('You have %d HP', 'Masz HP');
  eq(missing, ['%d']);
  eq(extra, []);
});

test('placeholders: duplicated specifier is reported as extra', () => {
  const { missing, extra } = comparePlaceholders('Deal %d damage', 'Zadajesz %d obrażeń, czyli %d');
  eq(missing, []);
  eq(extra, ['%d ×2'], 'the target repeats a specifier the source has once');
});

test('placeholders: repeated specifiers are counted', () => {
  const { missing } = comparePlaceholders('%s vs %s', 'tylko %s');
  eq(missing, ['%s ×2']);
});

test('placeholders: inline tags are tracked', () => {
  const { missing } = comparePlaceholders('<b>Bold</b> and <i>italic</i>', '<b>Pogrubienie</b>');
  ok(missing.some((token) => token.includes('<i>')));
});

test('placeholders: escaped newline is tracked', () => {
  const { missing } = comparePlaceholders('line one\\nline two', 'linia jeden linia dwa');
  eq(missing, ['\\n']);
});

test('placeholders: whitespace mismatch is detected', () => {
  eq(whitespaceMismatch('Hello ', 'Witaj'), ['trailing']);
  eq(whitespaceMismatch(' Hello', 'Witaj'), ['leading']);
  eq(whitespaceMismatch('Hello', 'Witaj'), null);
  eq(whitespaceMismatch('', ''), null);
});

// ================================================================== CSV

test('csv: detects comma, semicolon and tab', () => {
  eq(detectDelimiter('a,b,c\n1,2,3'), ',');
  eq(detectDelimiter('a;b;c\n1;2;3'), ';');
  eq(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
});

test('csv: a quoted separator does not count toward detection', () => {
  eq(detectDelimiter('"a,b,c,d,e"\n1;2'), ';', 'commas inside quotes must be ignored');
});

test('csv: quoted fields, embedded newlines and doubled quotes', () => {
  const grid = parseDelimited('a,"b,c","line\nbreak","say ""hi"""\n');
  eq(grid, [['a', 'b,c', 'line\nbreak', 'say "hi"']]);
});

test('csv: CRLF is one line break', () => {
  eq(parseDelimited('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('csv: a UTF-8 BOM does not stick to the first header', () => {
  eq(parseDelimited('\ufeffkey,en\n'), [['key', 'en']]);
});

test('csv: values are never coerced to numbers', () => {
  eq(parseDelimited('1.10,007,true'), [['1.10', '007', 'true']], 'keys like 1.10 must survive');
});

test('csv: serialising quotes only when needed', () => {
  eq(serializeDelimited([['a', 'b,c', 'say "hi"', ' padded ']]), 'a,"b,c","say ""hi"""," padded "');
});

test('csv: round trip through serialise and parse', () => {
  const grid = [['key', 'source', 'target'], ['A', 'He said "hi", loudly', 'Powiedział "cześć"']];
  eq(parseDelimited(serializeDelimited(grid)), grid);
});

// ================================================================= grid

test('grid: detects a key/en/pl header', () => {
  const grid = [['key', 'en', 'pl'], ['A', 'Hello', 'Witaj']];
  eq(detectHeaderRow(grid), 0);
});

test('grid: detects a gettext-style header', () => {
  const grid = [['msgid', 'msgid_plural', 'msgstr[0]', 'msgstr[1]']];
  eq(detectHeaderRow(grid), 0);
});

test('grid: content is not mistaken for a header', () => {
  const grid = [['A', 'Hello', 'Witaj'], ['B', 'Bye', 'Pa']];
  eq(detectHeaderRow(grid), -1, 'no recognised names means no header row');
});

test('grid: mapping assigns key, source and target', () => {
  const grid = [['key', 'en', 'pl'], ['A', 'Hello', 'Witaj']];
  const mapping = detectMapping(grid, 0, { sourceLanguage: 'en', targetLanguage: 'pl' });
  eq(mapping.columns.key, 0);
  eq(mapping.columns.source, 1);
  eq(mapping.columns.targets, [2]);
  ok(mapping.confident);
});

test('grid: mapping reads id/source/target/comment', () => {
  const grid = [['id', 'source', 'target', 'comment'], ['A', 'x', 'y', 'note']];
  const mapping = detectMapping(grid, 0);
  eq(mapping.columns.key, 0);
  eq(mapping.columns.source, 1);
  eq(mapping.columns.targets, [2]);
  eq(mapping.columns.comment, 3);
});

test('grid: mapping finds plural target columns', () => {
  const grid = [['msgid', 'msgstr[0]', 'msgstr[1]', 'msgstr[2]']];
  const mapping = detectMapping(grid, 0);
  eq(mapping.columns.source, 0);
  eq(mapping.columns.targets, [1, 2, 3]);
  eq(mapping.columns.pluralTargets, [{ index: 1, form: 0 }, { index: 2, form: 1 }, { index: 3, form: 2 }]);
});

test('grid: positional fallback when nothing is recognised', () => {
  const grid = [['A', 'Hello', 'Witaj']];
  const mapping = detectMapping(grid, -1);
  eq(mapping.columns.key, 0);
  eq(mapping.columns.source, 1);
  eq(mapping.columns.targets, [2]);
  ok(!mapping.confident, 'a guess must not claim confidence');
});

test('grid: rows become entries with plurals intact', () => {
  const grid = [
    ['msgid', 'msgid_plural', 'msgstr[0]', 'msgstr[1]'],
    ['%d file', '%d files', '%d plik', '%d pliki'],
  ];
  const mapping = detectMapping(grid, 0);
  const { entries } = gridToEntries(grid, mapping);
  eq(entries.length, 1);
  eq(entries[0].source, '%d file');
  eq(entries[0].pluralSource, '%d files');
  eq(entries[0].pluralTargets, ['%d plik', '%d pliki']);
});

test('grid: blank and spacer rows are skipped', () => {
  const grid = [['key', 'en', 'pl'], ['A', 'Hello', 'Witaj'], ['', '', ''], ['  ', '', '']];
  const mapping = detectMapping(grid, 0);
  const { entries, skipped } = gridToEntries(grid, mapping);
  eq(entries.length, 1);
  eq(skipped.length, 2);
});

test('grid: approved column is read', () => {
  const grid = [['key', 'en', 'pl', 'approved'], ['A', 'x', 'y', 'yes']];
  const mapping = detectMapping(grid, 0);
  const { entries } = gridToEntries(grid, mapping);
  ok(entries[0].approved);
});

test('grid: export adds plural columns rather than dropping forms', () => {
  const grid = [['key', 'en', 'pl'], ['A', 'x', 'y']];
  const mapping = detectMapping(grid, 0);
  const entries = [createEntry({ key: 'B', source: '1 file', pluralSource: '%d files', pluralTargets: ['1 plik', '%d pliki'] })];

  const out = entriesToGrid(entries, mapping, { sourceLanguage: 'en', targetLanguage: 'pl' });

  // Two columns are appended: one for msgid_plural, one for the second form.
  eq(out[0], ['key', 'en', 'pl', 'msgid_plural', 'msgstr[1]']);
  eq(out[1][3], '%d files', 'the plural source must be written');
  eq(out[1][4], '%d pliki', 'the second plural form must not be dropped');
});

test('grid: export keeps the header when asked', () => {
  const grid = [['key', 'en', 'pl'], ['A', 'x', 'y']];
  const mapping = detectMapping(grid, 0);
  const out = entriesToGrid([createEntry({ key: 'A', source: 'x', target: 'y' })], mapping, {
    sourceLanguage: 'en',
    targetLanguage: 'pl',
  });
  eq(out[0], ['key', 'en', 'pl']);
  eq(out[1], ['A', 'x', 'y']);
});

// ==================================================================== PO

const SAMPLE_PO = `# Polish translation.
msgid ""
msgstr ""
"Project-Id-Version: Meowl\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : 1);\\n"

#: src/menu.c:42
#. Shown on the title screen
msgid "Start game"
msgstr "Rozpocznij grę"

msgctxt "menu"
msgid "Back"
msgstr "Wstecz"

msgid "Back"
msgstr "Tył"

#, fuzzy
msgid "Unfinished"
msgstr "Nieukończone"

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d plik"
msgstr[1] "%d pliki"
msgstr[2] "%d plików"

msgid "Multi"
msgstr ""
"line one\\n"
"line two"
`;

test('po: header is captured with Plural-Forms', () => {
  const { meta } = parsePO(SAMPLE_PO);
  eq(meta.nplurals, 3);
  ok(meta.headerFields['Content-Type'].includes('UTF-8'));
});

test('po: entries are read, not split on blank lines', () => {
  const { entries } = parsePO(SAMPLE_PO);
  eq(entries.length, 6, 'six entries including the plural one');
});

test('po: msgctxt disambiguates identical msgids', () => {
  const { entries } = parsePO(SAMPLE_PO);
  const withContext = entries.find((entry) => entry.key === 'menu');
  ok(withContext, 'the contextual entry keeps its msgctxt as key');
  eq(withContext.source, 'Back');
  eq(withContext.target, 'Wstecz');

  const plain = entries.filter((entry) => entry.source === 'Back' && entry.key === '');
  eq(plain.length, 1);
  eq(plain[0].target, 'Tył');
});

test('po: comments and references are kept', () => {
  const { entries } = parsePO(SAMPLE_PO);
  const entry = entries.find((candidate) => candidate.source === 'Start game');
  eq(entry.references, ['src/menu.c:42']);
  ok(entry.comment.includes('Shown on the title screen'));
});

test('po: plural forms are read using nplurals', () => {
  const { entries } = parsePO(SAMPLE_PO);
  const plural = entries.find((candidate) => candidate.pluralSource);
  eq(plural.pluralSource, '%d files');
  eq(plural.pluralTargets, ['%d plik', '%d pliki', '%d plików']);
});

test('po: fuzzy entries are flagged and not approved', () => {
  const { entries } = parsePO(SAMPLE_PO);
  const fuzzy = entries.find((candidate) => candidate.source === 'Unfinished');
  ok(fuzzy.flags.includes('fuzzy'));
  ok(!fuzzy.approved);
});

test('po: multi-line msgstr is joined with a real newline', () => {
  const { entries } = parsePO(SAMPLE_PO);
  const multi = entries.find((candidate) => candidate.source === 'Multi');
  eq(multi.target, 'line one\nline two');
});

test('po: obsolete entries are preserved verbatim', () => {
  const text = 'msgid "A"\nmsgstr "B"\n\n#~ msgid "Old"\n#~ msgstr "Stary"\n';
  const { entries, meta } = parsePO(text);
  eq(entries.length, 1);
  eq(meta.obsolete.length, 1);

  const out = serializePO(entries, meta);
  ok(out.includes('#~ msgid "Old"'), 'obsolete block must survive a round trip');
});

test('po: escape and unescape round trip', () => {
  const value = 'Line "one"\nLine\\two\tTabbed';
  eq(unescapePO(escapePO(value)), value);
});

test('po: serialise then parse is lossless for content', () => {
  const { entries, meta } = parsePO(SAMPLE_PO);
  const reparsed = parsePO(serializePO(entries, meta));

  eq(reparsed.entries.length, entries.length);
  eq(reparsed.meta.nplurals, 3);

  const before = entries.find((entry) => entry.pluralSource);
  const after = reparsed.entries.find((entry) => entry.pluralSource);
  eq(after.pluralTargets, before.pluralTargets);
  eq(after.pluralSource, before.pluralSource);
});

test('po: serialising keeps the header so gettext can still read plurals', () => {
  const out = serializePO(parsePO(SAMPLE_PO).entries, parsePO(SAMPLE_PO).meta);
  ok(out.includes('Plural-Forms'), 'Plural-Forms must survive');
  ok(out.includes('Content-Type'));
});

// ================================================================ XLIFF

const SAMPLE_XLIFF = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="pl" datatype="plaintext" original="dialogs.csv">
    <body>
      <trans-unit id="1" resname="MENU_START">
        <source>Start game</source>
        <target>Rozpocznij grę</target>
        <note from="developer">Shown on the title screen</note>
      </trans-unit>
      <trans-unit id="2" resname="HP">
        <source>You have <g id="1" ctype="x-bold">%d</g> HP left</source>
        <target>Zostało Ci <g id="1" ctype="x-bold">%d</g> HP</target>
        <alt-trans>
          <target>Masz %d HP</target>
        </alt-trans>
      </trans-unit>
      <group id="g1">
        <trans-unit id="3" resname="NESTED">
          <source>Nested</source>
          <target></target>
        </trans-unit>
      </group>
    </body>
  </file>
</xliff>`;

test('xliff: version and language pair are read', () => {
  const { meta } = parseXliff(SAMPLE_XLIFF);
  eq(meta.version, '1.2');
  eq(meta.sourceLanguage, 'en');
  eq(meta.targetLanguage, 'pl');
});

test('xliff: units are read including nested groups', () => {
  const { entries } = parseXliff(SAMPLE_XLIFF);
  eq(entries.length, 3);
  eq(entries.map((entry) => entry.key), ['MENU_START', 'HP', 'NESTED']);
});

test('xliff: notes become comments', () => {
  const { entries } = parseXliff(SAMPLE_XLIFF);
  eq(entries[0].comment, 'Shown on the title screen');
});

test('xliff: inline markup is kept as visible markup', () => {
  const { entries } = parseXliff(SAMPLE_XLIFF);
  eq(entries[1].source, 'You have <g id="1" ctype="x-bold">%d</g> HP left');
  eq(entries[1].target, 'Zostało Ci <g id="1" ctype="x-bold">%d</g> HP');
});

test('xliff: an edited target is written back', () => {
  const { entries, meta } = parseXliff(SAMPLE_XLIFF);
  entries[0].target = 'Nowa gra';

  const out = serializeXliff(entries, meta);
  ok(out.includes('<target>Nowa gra</target>'));
});

test('xliff: alt-trans and notes survive a round trip', () => {
  const { entries, meta } = parseXliff(SAMPLE_XLIFF);
  entries[1].target = 'Zmienione';

  const out = serializeXliff(entries, meta);
  ok(out.includes('<alt-trans>'), 'alternative translations must not be dropped');
  ok(out.includes('Masz %d HP'));
  ok(out.includes('Shown on the title screen'));
  ok(out.includes('original="dialogs.csv"'), 'file attributes must survive');
});

test('xliff: inline markup survives an edit elsewhere in the string', () => {
  const { entries, meta } = parseXliff(SAMPLE_XLIFF);
  entries[1].target = 'Zostało <g id="1" ctype="x-bold">%d</g> punktów życia';

  const out = serializeXliff(entries, meta);
  ok(out.includes('<g id="1" ctype="x-bold">%d</g>'));
  ok(out.includes('punktów życia'));
});

test('xliff: an ampersand typed by a translator is escaped', () => {
  const { entries, meta } = parseXliff(SAMPLE_XLIFF);
  entries[0].target = 'Tom & Jerry';

  const out = serializeXliff(entries, meta);
  ok(out.includes('Tom &amp; Jerry'), 'raw ampersand would make the file invalid XML');
  ok(!/<target>Tom & Jerry<\/target>/.test(out));
});

test('xliff: new entries are appended to the document', () => {
  const { entries, meta } = parseXliff(SAMPLE_XLIFF);
  entries.push(createEntry({ key: 'ADDED', source: 'Added later', target: 'Dodane' }));

  const out = serializeXliff(entries, meta);
  ok(out.includes('resname="ADDED"'));
  ok(out.includes('Dodane'));
});

test('xliff 2.0: units inside segments are read', () => {
  const xml = `<?xml version="1.0"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="pl">
  <file id="f1">
    <unit id="u1">
      <segment>
        <source>Start</source>
        <target>Start</target>
      </segment>
    </unit>
    <unit id="u2">
      <notes><note>Dev note</note></notes>
      <segment>
        <source>Quit</source>
        <target></target>
      </segment>
    </unit>
  </file>
</xliff>`;

  const { entries, meta } = parseXliff(xml);
  eq(meta.version, '2.0');
  eq(meta.sourceLanguage, 'en');
  eq(entries.length, 2);
  eq(entries[0].key, 'u1');
  eq(entries[1].comment, 'Dev note');
});

test('xliff 2.0: an edited target round trips', () => {
  const xml = `<?xml version="1.0"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="pl">
  <file id="f1">
    <unit id="u1">
      <segment>
        <source>Start</source>
        <target>Start</target>
      </segment>
    </unit>
  </file>
</xliff>`;

  const { entries, meta } = parseXliff(xml);
  entries[0].target = 'Rozpocznij';

  const out = serializeXliff(entries, meta);
  ok(out.includes('<target>Rozpocznij</target>'));
  ok(out.includes('srcLang="en"'));
});

test('xliff: gettext plural groups merge into one entry', () => {
  const xml = `<?xml version="1.0"?>
<xliff version="1.2">
  <file source-language="en" target-language="pl">
    <body>
      <group restype="x-gettext-plurals">
        <trans-unit id="1">
          <source>%d file</source>
          <target>%d plik</target>
          <context-group><context context-type="x-plural-form">0</context></context-group>
        </trans-unit>
        <trans-unit id="2">
          <source>%d files</source>
          <target>%d pliki</target>
          <context-group><context context-type="x-plural-form">1</context></context-group>
        </trans-unit>
      </group>
    </body>
  </file>
</xliff>`;

  const { entries } = parseXliff(xml);
  eq(entries.length, 1, 'two trans-units, one logical entry');
  eq(entries[0].pluralSource, '%d files');
  eq(entries[0].pluralTargets, ['%d plik', '%d pliki']);
});

// ================================================================= JSON

test('json: a flat object becomes entries', () => {
  const { entries } = parseJson({ text: '{"MENU_START":"Start game","QUIT":"Quit"}' });
  eq(entries.map((entry) => entry.key), ['MENU_START', 'QUIT']);
  eq(entries[0].source, 'Start game');
});

test('json: nested objects flatten to dot paths', () => {
  const { entries } = parseJson({ text: '{"menu":{"start":"Start","end":"End"}}' });
  eq(entries.map((entry) => entry.key), ['menu.start', 'menu.end']);
});

test('json: nested objects unflatten on export', () => {
  const { entries, meta } = parseJson({ text: '{"menu":{"start":"Start"}}' });
  const { text } = serializeJson(entries, meta);
  eq(JSON.parse(text), { menu: { start: 'Start' } });
});

test('json: i18next plural suffixes merge into one entry', () => {
  const { entries } = parseJson({ text: '{"items_one":"%d item","items_other":"%d items"}' });
  eq(entries.length, 1);
  eq(entries[0].key, 'items');
  // A source file: the forms are sources, so they belong in the source slots.
  eq(entries[0].source, '%d item');
  eq(entries[0].pluralSource, '%d items');
  eq(entries[0].pluralTargets, []);
});

test('json: plural suffixes on a translation file fill the target forms', () => {
  const { entries } = parseJson({ text: '{"items_one":"%d plik","items_other":"%d plików"}' }, { role: 'target' });
  eq(entries.length, 1);
  eq(entries[0].pluralTargets, ['%d plik', '%d plików']);
  eq(entries[0].source, '');
});

test('json: plural entries export back to suffixed keys', () => {
  const { entries, meta } = parseJson({ text: '{"items_one":"one","items_other":"many"}' });
  const { text } = serializeJson(entries, meta);
  const parsed = JSON.parse(text);
  eq(parsed.items_one, 'one');
  eq(parsed.items_other, 'many');
});

test('json: an array of records is read', () => {
  const text = JSON.stringify([
    { key: 'A', source: 'Hello', target: 'Witaj', comment: 'greeting' },
    { key: 'B', source: 'Bye', target: 'Pa' },
  ]);
  const { entries, meta } = parseJson({ text });
  eq(meta.shape, 'records');
  eq(entries.length, 2);
  eq(entries[0].target, 'Witaj');
  eq(entries[0].comment, 'greeting');
});

test('json: role target puts values into the target field', () => {
  const { entries } = parseJson({ text: '{"A":"Witaj"}' }, { role: 'target' });
  eq(entries[0].target, 'Witaj');
  eq(entries[0].source, '');
});

test('json: indentation is preserved', () => {
  const { meta } = parseJson({ text: '{\n    "A": "x"\n}' });
  eq(meta.indentation, 4);
});

test('json: invalid JSON gives a readable error', () => {
  assert.throws(() => parseJson({ text: '{oops' }), /not valid JSON/);
});

// ================================================ XML rich text helpers

test('xml: rich text keeps inline markup position', () => {
  const tree = parseXml('<r>a <b>bold</b> c</r>');
  const root = tree[0].r;
  eq(nodesToRichText(root), 'a <b>bold</b> c');
});

test('xml: rich text round trips through the node builder', () => {
  const rich = 'You have <g id="1">%d</g> HP & more';
  const nodes = richTextToNodes(rich);
  eq(nodesToRichText(nodes), rich);
});

test('xml: a typed ampersand does not break the fragment', () => {
  const nodes = richTextToNodes('Tom & Jerry <b>rule</b>');
  const xml = buildXml([{ r: nodes }]);
  ok(xml.includes('&amp;'), 'ampersand must be escaped on the way out');
  ok(!/& Jerry/.test(xml));
});

test('xml: self-closing inline tags survive', () => {
  const rich = 'Press <x id="1"/> to continue';
  eq(nodesToRichText(richTextToNodes(rich)), rich);
});

// ============================================================== Android

const SAMPLE_ANDROID = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- The application name -->
    <string name="app_name">Meowl</string>
    <string name="welcome">Welcome, %1$s!</string>
    <string name="version" translatable="false">v1.0</string>
    <plurals name="items">
        <item quantity="one">%d item</item>
        <item quantity="few">%d items</item>
        <item quantity="other">%d items</item>
    </plurals>
    <string-array name="planets">
        <item>Mercury</item>
        <item>Venus</item>
    </string-array>
</resources>`;

test('android: strings are read with their names as keys', () => {
  const { entries } = parseAndroid({ text: SAMPLE_ANDROID });
  const appName = entries.find((entry) => entry.key === 'app_name');
  eq(appName.source, 'Meowl');
});

test('android: a preceding comment is attached', () => {
  const { entries } = parseAndroid({ text: SAMPLE_ANDROID });
  ok(entries.find((entry) => entry.key === 'app_name').comment.includes('application name'));
});

test('android: translatable=false becomes a flag', () => {
  const { entries } = parseAndroid({ text: SAMPLE_ANDROID });
  ok(entries.find((entry) => entry.key === 'version').flags.includes('translatable=false'));
});

test('android: plurals merge into one entry with quantities', () => {
  const { entries } = parseAndroid({ text: SAMPLE_ANDROID });
  const plural = entries.find((entry) => entry.key === 'items');
  eq(plural.pluralTargets, ['%d item', '%d items', '%d items']);
  eq(plural.origin.quantities, ['one', 'few', 'other']);
});

test('android: string-array items become indexed keys', () => {
  const { entries } = parseAndroid({ text: SAMPLE_ANDROID });
  const items = entries.filter((entry) => entry.key.startsWith('planets['));
  eq(items.length, 2);
  eq(items[0].source, 'Mercury');
});

test('android: an apostrophe is escaped for aapt', () => {
  eq(escapeAndroid("Don't stop"), "Don\\'t stop");
  eq(unescapeAndroid("Don\\'t stop"), "Don't stop");
});

test('android: a leading @ is escaped', () => {
  eq(escapeAndroid('@username'), '\\@username');
});

test('android: an edited string is written back into the document', () => {
  const { entries, meta } = parseAndroid({ text: SAMPLE_ANDROID });
  entries.find((entry) => entry.key === 'app_name').target = 'Miaucz';

  const { text } = serializeAndroid(entries, meta);
  ok(text.includes('>Miaucz<'));
  ok(text.includes('translatable="false"'), 'attributes must survive');
  ok(text.includes('<!-- The application name -->'), 'comments must survive');
});

test('android: an edited plural is written back by quantity', () => {
  const { entries, meta } = parseAndroid({ text: SAMPLE_ANDROID });
  const plural = entries.find((entry) => entry.key === 'items');
  plural.pluralTargets = ['%d element', '%d elementy', '%d elementów'];

  const { text } = serializeAndroid(entries, meta);
  ok(text.includes('>%d elementy<'));
  ok(text.includes('quantity="few"'));
});

test('android: an apostrophe in a translation is escaped in the output', () => {
  const { entries, meta } = parseAndroid({ text: SAMPLE_ANDROID });
  entries.find((entry) => entry.key === 'welcome').target = "Don't worry";

  const { text } = serializeAndroid(entries, meta);
  ok(text.includes("Don\\'t worry"), 'aapt requires the escape');
});

test('android: a file without <resources> is rejected clearly', () => {
  assert.throws(() => parseAndroid({ text: '<other/>' }), /resources/);
});

// ================================================================ Apple

const SAMPLE_STRINGS = `/* Shown on the title screen */
"MENU_START" = "Start game";

// A line comment
"QUIT" = "Quit";

"ESCAPED" = "He said \\"hi\\"\\nNew line";
`;

test('apple: entries are read with comments', () => {
  const { entries } = parseApple({ text: SAMPLE_STRINGS });
  eq(entries.map((entry) => entry.key), ['MENU_START', 'QUIT', 'ESCAPED']);
  eq(entries[0].comment, 'Shown on the title screen');
  eq(entries[1].comment, 'A line comment');
});

test('apple: escapes are decoded', () => {
  const { entries } = parseApple({ text: SAMPLE_STRINGS });
  eq(entries[2].source, 'He said "hi"\nNew line');
});

test('apple: a value containing = and ; survives', () => {
  const { entries } = parseApple({ text: '"A" = "a = b; c";' });
  eq(entries[0].source, 'a = b; c');
});

test('apple: export escapes and round trips', () => {
  const { entries, meta } = parseApple({ text: SAMPLE_STRINGS });
  entries[0].target = 'Nowa gra';

  const { text } = serializeApple(entries, meta);
  const reparsed = parseApple({ text });
  eq(reparsed.entries[0].source, 'Nowa gra', 'the translation is what gets written');
  eq(reparsed.entries[2].source, 'He said "hi"\nNew line');
});

test('apple: comments are re-emitted', () => {
  const { entries, meta } = parseApple({ text: SAMPLE_STRINGS });
  const { text } = serializeApple(entries, meta);
  ok(text.includes('/* Shown on the title screen */'));
});

// ============================================================= Subtitles

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
Hello there

2
00:00:05,500 --> 00:00:08,000
Second
line here
`;

test('srt: cues are read with their timings', () => {
  const { entries } = parseSubtitles({ text: SAMPLE_SRT });
  eq(entries.length, 2);
  eq(entries[0].origin.start, '00:00:01,000');
  eq(entries[0].origin.end, '00:00:04,000');
});

test('srt: multi-line cue text is kept', () => {
  const { entries } = parseSubtitles({ text: SAMPLE_SRT });
  eq(entries[1].source, 'Second\nline here');
});

test('srt: export writes the translation and keeps timings', () => {
  const { entries, meta } = parseSubtitles({ text: SAMPLE_SRT });
  entries[0].target = 'Cześć';

  const { text } = serializeSubtitles(entries, meta);
  ok(text.includes('00:00:01,000 --> 00:00:04,000'));
  ok(text.includes('Cześć'));
  ok(!text.includes('Hello there'), 'the translation replaces the source');
});

test('srt: untranslated cues fall back to the source', () => {
  const { entries, meta } = parseSubtitles({ text: SAMPLE_SRT });
  entries[0].target = 'Cześć';

  const { text } = serializeSubtitles(entries, meta);
  ok(text.includes('Second'), 'a half-finished file must still be playable');
});

test('srt: cue numbering is regenerated', () => {
  const { entries, meta } = parseSubtitles({ text: SAMPLE_SRT });
  const { text } = serializeSubtitles(entries, meta);
  ok(text.startsWith('1\n'));
  ok(text.includes('\n2\n'));
});

test('srt: a malformed block is skipped, not fatal', () => {
  const { entries, meta } = parseSubtitles({ text: '1\nno timing here\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nOk\n' });
  eq(entries.length, 1);
  eq(meta.malformedBlocks, 1);
});

test('vtt: the WEBVTT header is handled', () => {
  const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n';
  const { entries, meta } = parseSubtitles({ text, kind: 'vtt' });
  eq(meta.kind, 'vtt');
  eq(entries.length, 1);

  const out = serializeSubtitles(entries, meta, { kind: 'vtt' });
  ok(out.text.startsWith('WEBVTT'));
});

// ================================================================== TMX

const SAMPLE_TMX = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Trados" srclang="en" adminlang="en" datatype="plaintext"/>
  <body>
    <tu tuid="1" creationdate="20240101T120000Z">
      <tuv xml:lang="en"><seg>Start game</seg></tuv>
      <tuv xml:lang="pl"><seg>Rozpocznij grę</seg></tuv>
    </tu>
    <tu tuid="2">
      <tuv xml:lang="en"><seg>Quit</seg></tuv>
    </tu>
  </body>
</tmx>`;

test('tmx: the language pair is read from the header', () => {
  const { meta } = parseTmx({ text: SAMPLE_TMX }, { targetLanguage: 'pl' });
  eq(meta.sourceLanguage, 'en');
});

test('tmx: source and target are paired by language', () => {
  const { entries } = parseTmx({ text: SAMPLE_TMX }, { targetLanguage: 'pl' });
  eq(entries.length, 2);
  eq(entries[0].source, 'Start game');
  eq(entries[0].target, 'Rozpocznij grę');
  eq(entries[1].target, '', 'a unit with no target language is untranslated');
});

test('tmx: units without a source language are counted, not crashed on', () => {
  const xml = '<tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="de"><seg>Hallo</seg></tuv></tu></body></tmx>';
  const { entries, meta } = parseTmx({ text: xml }, { targetLanguage: 'pl' });
  eq(entries.length, 0);
  eq(meta.missingSource, 1);
});

test('tmx: an edited target round trips and keeps the header', () => {
  const { entries, meta } = parseTmx({ text: SAMPLE_TMX }, { targetLanguage: 'pl' });
  entries[0].target = 'Nowa gra';

  const { text } = serializeTmx(entries, meta, { sourceLanguage: 'en', targetLanguage: 'pl' });
  ok(text.includes('Nowa gra'));
  ok(text.includes('creationtool="Trados"'), 'header metadata must survive');
  ok(text.includes('creationdate="20240101T120000Z"'));
});

test('tmx: a missing target tuv is created', () => {
  const { entries, meta } = parseTmx({ text: SAMPLE_TMX }, { targetLanguage: 'pl' });
  entries[1].target = 'Wyjdź';

  const { text } = serializeTmx(entries, meta, { sourceLanguage: 'en', targetLanguage: 'pl' });
  ok(text.includes('Wyjdź'));
  ok(text.includes('xml:lang="pl"'));
});

// ============================================================= detection

test('detect: extensions map to formats', () => {
  eq(detectFormat({ name: 'a.po' }), 'po');
  eq(detectFormat({ name: 'a.xlf' }), 'xliff');
  eq(detectFormat({ name: 'a.xlsx' }), 'xlsx');
  eq(detectFormat({ name: 'a.csv' }), 'csv');
  eq(detectFormat({ name: 'a.json' }), 'json');
  eq(detectFormat({ name: 'a.strings' }), 'apple');
  eq(detectFormat({ name: 'a.srt' }), 'srt');
  eq(detectFormat({ name: 'a.tmx' }), 'tmx');
});

test('detect: .xml is decided by its root element', () => {
  eq(detectFormat({ name: 'a.xml', text: '<xliff version="1.2"/>' }), 'xliff');
  eq(detectFormat({ name: 'a.xml', text: '<tmx version="1.4"/>' }), 'tmx');
  eq(detectFormat({ name: 'a.xml', text: '<resources><string name="a">b</string></resources>' }), 'android');
});

test('detect: an XML declaration does not hide the root element', () => {
  eq(detectFormat({ name: 'a.xml', text: '<?xml version="1.0"?>\n<xliff version="1.2"/>' }), 'xliff');
});

test('detect: PO is recognised without an extension', () => {
  eq(detectFormat({ name: 'messages', text: 'msgid "A"\nmsgstr "B"\n' }), 'po');
});

test('detect: Apple strings is recognised without an extension', () => {
  eq(detectFormat({ name: 'Localizable', text: '"A" = "B";\n' }), 'apple');
});

test('detect: WebVTT wins over a generic subtitle check', () => {
  eq(detectFormat({ name: 'a.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n' }), 'vtt');
});

test('detect: tab-separated text is TSV', () => {
  eq(detectFormat({ name: 'data.txt', text: 'a\tb\tc\n1\t2\t3\n' }), 'tsv');
});

// =============================================================== summary

process.stdout.write('\n\n');

if (failures.length) {
  console.log('FAILURES\n');
  for (const { name, error } of failures) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message.split('\n').slice(0, 6).join('\n  ')}\n`);
  }
}

console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed ? 1 : 0);
