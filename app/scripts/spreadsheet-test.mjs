/**
 * Spreadsheet I/O tests: XLSX, CSV and TSV through the real format module.
 *
 * Separate from `format-test.mjs` because this one loads the Excel libraries.
 * Both builds run under Node 22 -- `File` and `Blob` are globals since Node 20,
 * which is what the browser build needs -- so the whole path can be exercised
 * without a browser.
 *
 *   node app/scripts/spreadsheet-test.mjs
 */

import assert from 'node:assert/strict';
import writeXlsxFile from 'write-excel-file/browser';

import { csvFormat, tsvFormat, xlsxFormat, parseTabular, serializeTabular } from '../src/formats/tabular.js';
import { detectMapping, detectHeaderRow } from '../src/lib/grid.js';
import { createEntry } from '../src/lib/entry.js';

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
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

/** Build an .xlsx from a plain grid, the way a studio's export would arrive. */
async function makeXlsx(sheets) {
  const handle = writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      data: sheet.grid.map((row) => row.map((value) => ({ value: value === '' ? null : String(value), type: String }))),
    })),
  );
  const blob = await handle.toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

const BASIC = [
  { name: 'Strings', grid: [['key', 'en', 'pl'], ['MENU_START', 'Start game', 'Rozpocznij grę'], ['QUIT', 'Quit', 'Wyjdź']] },
];

// ================================================================== XLSX

await test('xlsx: a workbook is parsed into entries', async () => {
  const bytes = await makeXlsx(BASIC);
  const { entries, meta } = await xlsxFormat.parse({ bytes, name: 'strings.xlsx' });

  eq(entries.length, 2);
  eq(entries[0].key, 'MENU_START');
  eq(entries[0].source, 'Start game');
  eq(entries[0].target, 'Rozpocznij grę');
  eq(meta.kind, 'xlsx');
  eq(meta.sheet, 'Strings');
});

await test('xlsx: the column mapping is detected and reported', async () => {
  const bytes = await makeXlsx(BASIC);
  const { meta } = await xlsxFormat.parse({ bytes, name: 'strings.xlsx' });

  eq(meta.mapping.columns.key, 0);
  eq(meta.mapping.columns.source, 1);
  eq(meta.mapping.columns.targets, [2]);
  ok(meta.mapping.confident, 'key/en/pl must be recognised');
});

await test('xlsx: an edited target round trips back into the file', async () => {
  const bytes = await makeXlsx(BASIC);
  const parsed = await xlsxFormat.parse({ bytes, name: 'strings.xlsx' });
  parsed.entries[0].target = 'Nowa gra';

  const out = await xlsxFormat.serialize(parsed.entries, parsed.meta, {});
  const again = await xlsxFormat.parse({ bytes: out.bytes, name: 'out.xlsx' });

  eq(again.entries[0].target, 'Nowa gra');
  eq(again.entries[1].target, 'Wyjdź', 'the untouched row must survive');
});

await test('xlsx: unrecognised columns are preserved on export', async () => {
  const bytes = await makeXlsx([
    {
      name: 'Strings',
      grid: [
        ['key', 'en', 'pl', 'character_limit', 'vo_status'],
        ['A', 'Hello', 'Witaj', '120', 'recorded'],
        ['B', 'Bye', 'Pa', '40', 'pending'],
      ],
    },
  ]);

  const parsed = await xlsxFormat.parse({ bytes, name: 'master.xlsx' });
  eq(parsed.entries.length, 2);

  parsed.entries[0].target = 'Cześć';
  const out = await xlsxFormat.serialize(parsed.entries, parsed.meta, {});

  const again = await xlsxFormat.parse({ bytes: out.bytes, name: 'out.xlsx' });
  // The studio's own columns are not part of our model, so check the raw grid.
  const grid = again.meta.grid;
  eq(grid[1][3], '120', 'character_limit must not be dropped');
  eq(grid[1][4], 'recorded', 'vo_status must not be dropped');
  eq(grid[1][2], 'Cześć', 'the translation must be written');
});

await test('xlsx: multiple sheets can be chosen', async () => {
  const bytes = await makeXlsx([
    { name: 'Strings', grid: [['key', 'en', 'pl'], ['A', 'one', 'jeden']] },
    { name: 'UI', grid: [['key', 'en', 'pl'], ['B', 'two', 'dwa']] },
  ]);

  const first = await xlsxFormat.parse({ bytes, name: 'w.xlsx' });
  eq(first.entries[0].source, 'one');

  const second = await xlsxFormat.parse({ bytes, name: 'w.xlsx' }, { sheet: 'UI' });
  eq(second.entries[0].source, 'two');
  eq(second.meta.sheets.length, 2, 'every sheet must be listed for the import dialog');
});

await test('xlsx: a gettext-style sheet keeps its plurals', async () => {
  const bytes = await makeXlsx([
    {
      name: 'Strings',
      grid: [
        ['msgid', 'msgid_plural', 'msgstr[0]', 'msgstr[1]'],
        ['%d file', '%d files', '%d plik', '%d pliki'],
      ],
    },
  ]);

  const { entries } = await xlsxFormat.parse({ bytes, name: 'p.xlsx' });
  eq(entries.length, 1);
  eq(entries[0].source, '%d file');
  eq(entries[0].pluralSource, '%d files');
  eq(entries[0].pluralTargets, ['%d plik', '%d pliki']);
});

await test('xlsx: plural forms survive an export', async () => {
  const bytes = await makeXlsx([
    { name: 'Strings', grid: [['msgid', 'msgid_plural', 'msgstr[0]', 'msgstr[1]'], ['%d file', '%d files', '%d plik', '%d pliki']] },
  ]);

  const parsed = await xlsxFormat.parse({ bytes, name: 'p.xlsx' });
  parsed.entries[0].pluralTargets = ['%d plik', '%d plików'];

  const out = await xlsxFormat.serialize(parsed.entries, parsed.meta, {});
  const again = await xlsxFormat.parse({ bytes: out.bytes, name: 'out.xlsx' });

  eq(again.entries[0].pluralTargets, ['%d plik', '%d plików']);
  eq(again.entries[0].pluralSource, '%d files');
});

await test('xlsx: an empty workbook is reported, not crashed on', async () => {
  const bytes = await makeXlsx([{ name: 'Empty', grid: [] }]);
  const { entries, meta } = await xlsxFormat.parse({ bytes, name: 'empty.xlsx' });
  eq(entries.length, 0);
  eq(meta.empty, true);
});

// =================================================================== CSV

await test('csv: a file is parsed through the format module', async () => {
  const text = 'key,en,pl\nMENU_START,Start game,Rozpocznij grę\n';
  const { entries, meta } = await csvFormat.parse({ text, name: 'strings.csv' });

  eq(entries.length, 1);
  eq(entries[0].source, 'Start game');
  eq(meta.kind, 'csv');
});

await test('csv: a quoted comma does not split the row', async () => {
  const text = 'key,en,pl\nA,"He said ""hi"", loudly","Powiedział ""cześć"""\n';
  const { entries } = await csvFormat.parse({ text, name: 'a.csv' });

  eq(entries[0].source, 'He said "hi", loudly');
  eq(entries[0].target, 'Powiedział "cześć"');
});

await test('csv: an edited target round trips', async () => {
  const text = 'key,en,pl\nA,Hello,Witaj\nB,Bye,Pa\n';
  const parsed = await csvFormat.parse({ text, name: 'a.csv' });
  parsed.entries[0].target = 'Cześć';

  const out = await csvFormat.serialize(parsed.entries, parsed.meta, {});
  const again = await csvFormat.parse({ text: out.text, name: 'out.csv' });

  eq(again.entries[0].target, 'Cześć');
  eq(again.entries[1].target, 'Pa');
});

await test('csv: a semicolon file is detected and round trips', async () => {
  const text = 'key;en;pl\nA;Hello;Witaj\n';
  const parsed = await csvFormat.parse({ text, name: 'eu.csv' });
  eq(parsed.entries[0].source, 'Hello');
  eq(parsed.meta.delimiter, ';');
});

await test('csv: newlines inside a field survive the round trip', async () => {
  const text = 'key,en,pl\nA,"line one\nline two",\n';
  const parsed = await csvFormat.parse({ text, name: 'a.csv' });
  eq(parsed.entries[0].source, 'line one\nline two');

  const out = await csvFormat.serialize(parsed.entries, parsed.meta, {});
  const again = await csvFormat.parse({ text: out.text, name: 'out.csv' });
  eq(again.entries[0].source, 'line one\nline two');
});

// =================================================================== TSV

await test('tsv: a tab file is parsed and round trips', async () => {
  const text = 'key\ten\tpl\nA\tHello\tWitaj\n';
  const parsed = await tsvFormat.parse({ text, name: 'a.tsv' });

  eq(parsed.entries[0].source, 'Hello');
  eq(parsed.meta.kind, 'tsv');

  parsed.entries[0].target = 'Cześć';
  const out = await tsvFormat.serialize(parsed.entries, parsed.meta, {});
  ok(out.text.includes('\t'), 'output must stay tab separated');

  const again = await tsvFormat.parse({ text: out.text, name: 'out.tsv' });
  eq(again.entries[0].target, 'Cześć');
});

// ======================================================== mapping override

await test('spreadsheet: a caller-supplied mapping wins over detection', async () => {
  // Nothing here is recognisable as a header, so detection stays positional.
  const bytes = await makeXlsx([
    { name: 'S', grid: [['Witaj', 'Hello', 'GREETING'], ['Pa', 'Bye', 'FAREWELL']] },
  ]);

  const auto = await parseTabular({ bytes, name: 'x.xlsx' }, {});
  ok(!auto.meta.mapping.confident, 'nothing recognisable must not claim confidence');
  eq(auto.entries[0].key, 'Witaj', 'the positional guess takes column 0 as the key');

  // An explicit mapping reorders the columns entirely.
  const forced = await parseTabular(
    { bytes, name: 'x.xlsx' },
    {
      mapping: {
        headerRow: -1,
        columns: { key: 2, source: 1, targets: [0], pluralSource: null, pluralTargets: [] },
        labels: [],
        width: 3,
        recognised: 0,
        confident: true,
      },
    },
  );

  eq(forced.entries[0].key, 'GREETING');
  eq(forced.entries[0].source, 'Hello');
  eq(forced.entries[0].target, 'Witaj');
});

await test('spreadsheet: header-less files fall back to key/source/target', async () => {
  const bytes = await makeXlsx([{ name: 'S', grid: [['KEY1', 'Hello', 'Witaj']] }]);
  const { entries } = await parseTabular({ bytes, name: 'x.xlsx' }, {});

  eq(entries.length, 1);
  eq(entries[0].key, 'KEY1');
  eq(entries[0].source, 'Hello');
  eq(entries[0].target, 'Witaj');
});

await test('spreadsheet: spacer rows are skipped and counted', async () => {
  const bytes = await makeXlsx([
    { name: 'S', grid: [['key', 'en', 'pl'], ['A', 'one', 'jeden'], ['', '', ''], ['B', 'two', 'dwa']] },
  ]);
  const { entries, meta } = await parseTabular({ bytes, name: 'x.xlsx' }, {});

  eq(entries.length, 2);
  eq(meta.skippedRows, 1);
});

await test('spreadsheet: serialising a fresh grid writes a header row', async () => {
  const mapping = { columns: { key: 0, source: 1, targets: [2], pluralSource: null, pluralTargets: [] }, width: 3 };
  const out = await serializeTabular(
    [createEntry({ key: 'A', source: 'Hello', target: 'Witaj' })],
    { kind: 'csv', mapping, grid: null },
    { sourceLanguage: 'en', targetLanguage: 'pl' },
  );

  const lines = out.text.split('\r\n');
  eq(lines[0], 'key,en,pl');
  eq(lines[1], 'A,Hello,Witaj');
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
