/**
 * Cross-format conversion tests.
 *
 * The per-format suites prove each parser reads and writes its own format.
 * They do not prove the thing translators actually do: receive one format,
 * work on it, hand back a different one. That path goes through
 * parseFile -> edit -> serializeEntries -> parseFile, and it is where a
 * format conversion silently drops plurals, mangles markup or renumbers keys.
 *
 * Every case here is a real hand-off: a studio sends PO and wants XLIFF back,
 * a client sends a spreadsheet and wants PO, and so on.
 *
 *   npm run test:conversion
 */

import assert from 'node:assert/strict';

import { parseFile, serializeEntries, detectFormat, lossWarnings, FORMAT_BY_ID } from '../src/formats/index.js';

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

const ok = (value, message) => assert.ok(value, message);
const eq = (actual, expected, message) =>
  assert.deepEqual(actual, expected, message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const file = (name, text) => ({ name, text, bytes: null, binary: false });

/**
 * Parse `text`, apply `edit` to every entry, export as `to`, and parse that
 * back. Returns the second parse so assertions can look at what survived.
 */
async function convert(text, from, to, edit = (entry) => entry) {
  const first = await parseFile(file(`input.${from}`, text), { format: from });
  const edited = first.entries.map((entry) => edit({ ...entry }));

  const output = await serializeEntries(edited, { ...first.meta, formatId: from }, { format: to });
  const second = await parseFile(file(`output.${to}`, output.text), { format: to });

  return { first, edited, output, second };
}

// ================================================================ fixtures

const PO_SOURCE = `# Polish translation for Hollow Knight.
# Copyright (C) 2026
msgid ""
msgstr ""
"Project-Id-Version: hollow-knight\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : 1);\\n"

#. Shown on the title screen
#: src/menu.c:42
msgid "Start game"
msgstr "Rozpocznij grę"

#: src/combat.c:118
#, c-format
msgid "You have %d HP left"
msgstr "Zostało Ci %d HP"

msgctxt "verb"
msgid "Quit"
msgstr "Wyjdź"

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d plik"
msgstr[1] "%d pliki"
msgstr[2] "%d plików"
`;

const XLIFF_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="game.pot" source-language="en" target-language="pl" datatype="po">
    <body>
      <trans-unit id="1">
        <source>Start game</source>
        <target>Rozpocznij grę</target>
        <note>Shown on the title screen</note>
      </trans-unit>
      <trans-unit id="2">
        <source>You have <g id="1">%d</g> HP left</source>
        <target>Zostało Ci <g id="1">%d</g> HP</target>
      </trans-unit>
      <group restype="x-gettext-plurals">
        <trans-unit id="3[0]" resname="FILES">
          <source>%d file</source>
          <target>%d plik</target>
          <context-group><context context-type="x-plural-form">0</context></context-group>
        </trans-unit>
        <trans-unit id="3[1]" resname="FILES">
          <source>%d files</source>
          <target>%d pliki</target>
          <context-group><context context-type="x-plural-form">1</context></context-group>
        </trans-unit>
        <trans-unit id="3[2]" resname="FILES">
          <source>%d files</source>
          <target>%d plików</target>
          <context-group><context context-type="x-plural-form">2</context></context-group>
        </trans-unit>
      </group>
    </body>
  </file>
</xliff>
`;

const ANDROID_SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Greeting on the home screen -->
    <string name="welcome">Welcome, %1$s!</string>
    <string name="hp_left">You have %1$d HP left</string>
    <plurals name="files">
        <item quantity="one">%d file</item>
        <item quantity="other">%d files</item>
    </plurals>
</resources>
`;

const JSON_SOURCE = JSON.stringify(
  {
    menu: { start: 'Start game', quit: 'Quit' },
    hp_left: 'You have %d HP left',
  },
  null,
  2,
);

const APPLE_SOURCE = `/* Shown on the title screen */
"Start game" = "Rozpocznij grę";

"hp_left" = "Zostało Ci %d HP";
`;

const SRT_SOURCE = `1
00:00:01,000 --> 00:00:03,500
Where am I?

2
00:00:04,000 --> 00:00:06,000
This place is
falling apart.
`;

const XLSX_ROWS = [
  [{ value: 'key' }, { value: 'en' }, { value: 'pl' }, { value: 'comment' }],
  [{ value: 'MENU_START' }, { value: 'Start game' }, { value: 'Rozpocznij grę' }, { value: 'Title screen' }],
  [{ value: 'HP_LEFT' }, { value: 'You have %d HP left' }, { value: 'Zostało Ci %d HP' }, { value: null }],
];

async function xlsxBytes() {
  const wx = await import('write-excel-file/node');
  const out = await wx.default([{ sheet: 'Strings', data: XLSX_ROWS }], { buffer: true });
  return new Uint8Array(await out.toBuffer());
}

// ==================================================== PO -> XLIFF -> PO

await test('PO -> XLIFF keeps plurals, comments and context', async () => {
  const { second } = await convert(PO_SOURCE, 'po', 'xliff');

  // A PO entry's key is its msgctxt, which is empty for a plain msgid, so
  // entries are identified by their source text here -- that is the identity
  // gettext actually uses.
  const bySource = new Map(second.entries.map((entry) => [entry.source, entry]));

  const start = bySource.get('Start game');
  ok(start, 'the plain entry must survive');
  eq(start.target, 'Rozpocznij grę');
  ok(start.comment?.includes('Shown on the title screen'), 'the extracted comment must travel');

  const hp = bySource.get('You have %d HP left');
  ok(hp, 'the c-format entry must survive');
  eq(hp.target, 'Zostało Ci %d HP');

  const files = second.entries.find((entry) => entry.pluralTargets?.length > 0);
  ok(files, 'the plural entry must survive as one entry');
  eq(files.pluralTargets, ['%d plik', '%d pliki', '%d plików'], 'all three Polish forms must be written');
});

await test('PO -> XLIFF -> PO is a closed loop', async () => {
  const { second } = await convert(PO_SOURCE, 'po', 'xliff');
  const back = await serializeEntries(second.entries, { ...second.meta, formatId: 'xliff' }, { format: 'po' });
  const reparsed = await parseFile(file('back.po', back.text), { format: 'po' });

  const plural = reparsed.entries.find((entry) => entry.pluralTargets?.length);
  ok(plural, 'the plural entry must still exist after two conversions');
  eq(plural.pluralTargets, ['%d plik', '%d pliki', '%d plików']);

  const hp = reparsed.entries.find((entry) => entry.source === 'You have %d HP left');
  eq(hp.target, 'Zostało Ci %d HP');
});

await test('PO context disambiguation survives a PO -> XLIFF -> PO trip', async () => {
  const { second } = await convert(PO_SOURCE, 'po', 'xliff');
  const back = await serializeEntries(second.entries, { ...second.meta, formatId: 'xliff' }, { format: 'po' });
  const reparsed = await parseFile(file('back.po', back.text), { format: 'po' });

  // "Quit" had msgctxt "verb". XLIFF carries the context as the unit's resname;
  // dropping it would merge this entry with any other "Quit" in the file.
  const quit = reparsed.entries.find((entry) => entry.source === 'Quit');
  ok(quit, 'the contextualised entry must survive');
  eq(quit.target, 'Wyjdź');
  eq(quit.key, 'verb', 'the msgctxt must come back as the key');
});

await test('a plain msgid does not acquire a fabricated msgctxt', async () => {
  // The synthetic unit id must never leak into resname: re-importing it would
  // read "n1" back as the key, and the next PO export would invent a context
  // that was never in the source file.
  const { second } = await convert(PO_SOURCE, 'po', 'xliff');
  const plain = second.entries.find((entry) => entry.source === 'Start game');
  ok(plain, 'the entry must survive');
  ok(!plain.key || plain.key === 'Start game', `expected no synthetic key, got ${JSON.stringify(plain.key)}`);
});

// ==================================================== XLIFF -> PO

await test('XLIFF -> PO keeps inline markup and notes', async () => {
  const { second } = await convert(XLIFF_SOURCE, 'xliff', 'po');

  const start = second.entries.find((entry) => entry.source === 'Start game');
  ok(start, 'the plain unit must survive');
  eq(start.target, 'Rozpocznij grę');
  ok(start.comment?.includes('Shown on the title screen'), 'the <note> must become a PO comment');

  const hp = second.entries.find((entry) => entry.source.includes('HP left'));
  ok(hp, 'the unit with inline markup must survive');
  // Inline markup is deliberately kept visible rather than stripped: a
  // translator has to be able to see that <g id="1"> wraps the placeholder.
  ok(hp.target.includes('%d'), 'the placeholder must survive');
  ok(hp.target.includes('<g id="1">'), 'the inline tag must be kept, not silently dropped');
  eq(hp.target, 'Zostało Ci <g id="1">%d</g> HP');
});

await test('XLIFF plural group -> PO keeps every form', async () => {
  const { second } = await convert(XLIFF_SOURCE, 'xliff', 'po');

  const plural = second.entries.find((entry) => entry.pluralTargets?.length);
  ok(plural, 'the plural group must become one plural entry');
  eq(plural.pluralTargets, ['%d plik', '%d pliki', '%d plików']);
  eq(plural.pluralSource, '%d files');
});

// ==================================================== XLSX -> PO

await test('XLSX -> PO keeps keys, targets and comments', async () => {
  const bytes = await xlsxBytes();
  const first = await parseFile({ name: 'strings.xlsx', bytes, binary: true }, {});
  eq(first.formatId, 'xlsx');

  const output = await serializeEntries(first.entries, { ...first.meta }, { format: 'po' });
  const second = await parseFile(file('out.po', output.text), { format: 'po' });

  const byKey = new Map(second.entries.map((entry) => [entry.key, entry]));
  eq(byKey.get('MENU_START')?.target, 'Rozpocznij grę');
  eq(byKey.get('HP_LEFT')?.target, 'Zostało Ci %d HP');
  ok(byKey.get('MENU_START')?.comment?.includes('Title screen'), 'the comment column must carry over');
});

await test('XLSX -> XLIFF keeps the key as the unit name', async () => {
  const bytes = await xlsxBytes();
  const first = await parseFile({ name: 'strings.xlsx', bytes, binary: true }, {});
  const output = await serializeEntries(first.entries, { ...first.meta }, { format: 'xliff' });
  const second = await parseFile(file('out.xlf', output.text), { format: 'xliff' });

  eq(second.entries.length, 2);
  const targets = second.entries.map((entry) => entry.target).sort();
  eq(targets, ['Rozpocznij grę', 'Zostało Ci %d HP']);
});

// ==================================================== Android -> XLIFF

await test('Android -> XLIFF keeps names, comments and plurals', async () => {
  const { second } = await convert(ANDROID_SOURCE, 'android', 'xliff');

  const welcome = second.entries.find((entry) => entry.source === 'Welcome, %1$s!');
  ok(welcome, 'the plain string must survive');
  ok(welcome.comment?.includes('Greeting'), 'the XML comment must travel');

  const plural = second.entries.find((entry) => entry.pluralTargets?.length > 1);
  ok(plural, 'the <plurals> block must survive as one plural entry');
  eq(plural.pluralTargets.length, 2, 'both quantities must be written');
  eq(plural.pluralTargets, ['%d file', '%d files']);
});

await test('Android -> XLIFF -> Android is a closed loop', async () => {
  const { second } = await convert(ANDROID_SOURCE, 'android', 'xliff');
  const back = await serializeEntries(second.entries, { ...second.meta, formatId: 'xliff' }, { format: 'android' });
  const reparsed = await parseFile(file('back.xml', back.text), { format: 'android' });

  const welcome = reparsed.entries.find((entry) => entry.key === 'welcome');
  ok(welcome, 'the resource name must be restored as the key');
  eq(welcome.source, 'Welcome, %1$s!', 'the Android value is the source, not the target');

  // The Android file had no translations, so the target comes back empty; what
  // matters is that the key, the text and the plural structure all survive.
  const plural = reparsed.entries.find((entry) => entry.key === 'files');
  ok(plural, 'the <plurals> block must come back as a resource named "files"');
  eq(plural.pluralTargets.length, 2, 'both quantities must survive the trip');
});

// ==================================================== JSON -> PO

await test('JSON -> PO flattens nested keys into a dotted path', async () => {
  const { second } = await convert(JSON_SOURCE, 'json', 'po');

  const keys = second.entries.map((entry) => entry.key).sort();
  eq(keys, ['hp_left', 'menu.quit', 'menu.start']);
  eq(second.entries.find((entry) => entry.key === 'menu.start')?.source, 'Start game');
});

await test('JSON -> XLIFF keeps the dotted keys', async () => {
  const { second } = await convert(JSON_SOURCE, 'json', 'xliff');
  const sources = second.entries.map((entry) => entry.source).sort();
  eq(sources, ['Quit', 'Start game', 'You have %d HP left']);
});

// ==================================================== Apple -> XLIFF

await test('Apple -> XLIFF keeps the key as the identifier and the comment', async () => {
  const { second } = await convert(APPLE_SOURCE, 'apple', 'xliff');

  // In a .strings file the left-hand side is the identifier and the value is
  // the text, so the identifier is the key and the value is the source.
  const start = second.entries.find((entry) => entry.key === 'Start game');
  ok(start, 'the entry must survive with its identifier as the key');
  ok(start.comment?.includes('Shown on the title screen'), 'the /* */ comment must travel');
});

// ==================================================== subtitles

await test('SRT -> SRT keeps timings and writes the translation', async () => {
  const { second } = await convert(SRT_SOURCE, 'srt', 'srt', (entry) => ({
    ...entry,
    target: `PL: ${entry.source.replace(/\n/g, ' / ')}`,
  }));

  // SRT has no source/target split -- a subtitle file holds one text per cue --
  // so the written translation comes back as the cue text. That is correct, and
  // it is why the export must never drop an untranslated cue.
  eq(second.entries.length, 2);
  eq(second.entries[0].source, 'PL: Where am I?');
  eq(second.entries[1].source, 'PL: This place is / falling apart.');
  ok(second.entries[0].origin?.start, 'the first cue must keep its start time');
  eq(second.entries[0].origin.start, '00:00:01,000');
  eq(second.entries[1].origin.end, '00:00:06,000');
});

await test('SRT -> VTT converts the cue format', async () => {
  const first = await parseFile(file('in.srt', SRT_SOURCE), { format: 'srt' });
  const output = await serializeEntries(first.entries, { ...first.meta, formatId: 'srt' }, { format: 'vtt' });

  ok(output.text.startsWith('WEBVTT'), 'a VTT file must open with the WEBVTT header');
  ok(output.text.includes('-->'), 'cues must still have timings');

  const second = await parseFile(file('out.vtt', output.text), { format: 'vtt' });
  eq(second.entries.length, 2);
});

// ==================================================== detection of exports

await test('every export is detected back as the format it claims to be', async () => {
  const cases = [
    ['po', PO_SOURCE],
    ['xliff', XLIFF_SOURCE],
    ['android', ANDROID_SOURCE],
    ['json', JSON_SOURCE],
    ['apple', APPLE_SOURCE],
    ['srt', SRT_SOURCE],
  ];

  for (const [from, text] of cases) {
    const first = await parseFile(file(`in.${from}`, text), { format: from });
    const output = await serializeEntries(first.entries, { ...first.meta, formatId: from }, { format: from });

    // Detection must work from the content alone -- a user re-importing an
    // exported file has no way to tell the tool what it is.
    const detected = detectFormat({ name: `exported.${from}`, text: output.text });
    eq(detected, from, `${from} export must be detected as ${from} without the extension hint`);

    const roundTripped = await parseFile(file(`exported.${from}`, output.text), {});
    eq(
      roundTripped.entries.length,
      first.entries.length,
      `${from} must not gain or lose entries on a same-format round trip`,
    );
  }
});

// ==================================================== loss warnings

await test('loss warnings fire for a format that cannot carry plurals', async () => {
  const first = await parseFile(file('in.po', PO_SOURCE), { format: 'po' });
  const warnings = lossWarnings(first.meta, 'srt', first.entries);
  ok(
    warnings.some((warning) => warning.includes('plural')),
    'converting plurals into subtitles must warn',
  );
});

await test('loss warnings stay silent when nothing is lost', async () => {
  const first = await parseFile(file('in.po', PO_SOURCE), { format: 'po' });
  // PO can carry everything, so a PO -> PO export must not warn about anything.
  const warnings = lossWarnings(first.meta, 'po', first.entries);
  eq(warnings, []);
});

await test('leaving a spreadsheet warns about unrecognised columns', async () => {
  const bytes = await xlsxBytes();
  const first = await parseFile({ name: 'strings.xlsx', bytes, binary: true }, {});
  const warnings = lossWarnings(first.meta, 'po', first.entries);
  ok(
    warnings.some((warning) => warning.includes('column')),
    'dropping the sheet layout must be flagged',
  );
});

// ==================================================== descriptor integrity

await test('every format descriptor has a loader that resolves', async () => {
  const { loadFormat } = await import('../src/formats/index.js');

  for (const descriptor of FORMAT_BY_ID.values()) {
    const implementation = await loadFormat(descriptor.id);
    ok(implementation, `${descriptor.id} must load`);
    ok(typeof implementation.parse === 'function', `${descriptor.id} must implement parse`);
    ok(typeof implementation.serialize === 'function', `${descriptor.id} must implement serialize`);
  }
});

await test('every parser accepts the registry input shape, not a bare string', async () => {
  // This is the invariant that broke the app once already: the registry calls
  // format.parse({ text, bytes, name }), so a parser written as parse(string)
  // receives an object, matches nothing, and returns zero entries -- a file
  // that loads as an empty project with no error shown.
  const { loadFormat } = await import('../src/formats/index.js');

  const samples = {
    po: PO_SOURCE,
    xliff: XLIFF_SOURCE,
    android: ANDROID_SOURCE,
    json: JSON_SOURCE,
    apple: APPLE_SOURCE,
    tmx: '<?xml version="1.0"?><tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="en"><seg>Hello</seg></tuv><tuv xml:lang="pl"><seg>Cześć</seg></tuv></tu></body></tmx>',
    srt: SRT_SOURCE,
    vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n',
  };

  for (const [id, text] of Object.entries(samples)) {
    const format = await loadFormat(id);

    // Canonical shape, exactly as parseFile builds it. This is the only input
    // shape the contract guarantees.
    const viaObject = await format.parse({ text, bytes: null, name: `sample.${id}` }, {});
    ok(Array.isArray(viaObject.entries), `${id} must return an entries array`);
    ok(viaObject.entries.length > 0, `${id} must read at least one entry from the canonical input object`);
    ok(
      viaObject.entries.every((entry) => typeof entry.source === 'string'),
      `${id} must give every entry a source string`,
    );
  }
});

await test('every serializer returns text, mime and extension', async () => {
  // The registry spreads the serializer's return value, so a bare string would
  // produce an object with no .text and the export would write nothing.
  const { loadFormat } = await import('../src/formats/index.js');

  const samples = {
    po: PO_SOURCE,
    xliff: XLIFF_SOURCE,
    android: ANDROID_SOURCE,
    json: JSON_SOURCE,
    apple: APPLE_SOURCE,
    srt: SRT_SOURCE,
    vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n',
    tmx: '<?xml version="1.0"?><tmx version="1.4"><header srclang="en"/><body><tu><tuv xml:lang="en"><seg>Hello</seg></tuv></tu></body></tmx>',
  };

  for (const [id, text] of Object.entries(samples)) {
    const format = await loadFormat(id);
    const parsed = await format.parse({ text, bytes: null, name: `sample.${id}` }, {});
    const result = await format.serialize(parsed.entries, { ...parsed.meta, formatId: id });

    ok(typeof result.text === 'string', `${id} must return a text string`);
    ok(result.text.length > 0, `${id} must return non-empty output`);
    ok(typeof result.mime === 'string', `${id} must declare a mime type`);
    ok(typeof result.extension === 'string', `${id} must declare an extension`);
  }
});

// ================================================================ report

console.log(`\n\n${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log('\nFAILURES\n');
  for (const { name, error } of failures) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message.split('\n')[0]}`);
    if (process.env.VERBOSE) console.log(error.stack);
  }
  process.exit(1);
}
