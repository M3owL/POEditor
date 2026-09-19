/**
 * Render tests.
 *
 * Server-rendering every pane catches the class of bug that a build cannot:
 * a component that throws on an empty list, a null dereference when nothing is
 * selected, a prop renamed in one place and not the other. `agent-browser` does
 * not support Windows, so this is how the UI gets verified without a headless
 * browser.
 *
 * It also asserts structural invariants that are easy to break and invisible
 * until someone cannot reach a button -- the modal scroll pattern in particular.
 *
 *   npm run test:render
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import App from '../src/App.jsx';
import Header from '../src/components/Header.jsx';
import EntryList from '../src/components/EntryList.jsx';
import EditorPane from '../src/components/EditorPane.jsx';
import SidePanel from '../src/components/SidePanel.jsx';
import StatusBar from '../src/components/StatusBar.jsx';
import EmptyState from '../src/components/EmptyState.jsx';
import ExportDialog from '../src/components/ExportDialog.jsx';
import ShortcutsDialog from '../src/components/ShortcutsDialog.jsx';
import HighlightedText from '../src/components/HighlightedText.jsx';
import Icon from '../src/components/ui/Icon.jsx';
import { createEntry, projectProgress } from '../src/lib/entry.js';
import { analyzeProject } from '../src/lib/qa.js';
import { buildMemory, lookupMatches } from '../src/lib/tm.js';
import { computeFilterCounts, filterEntries, mergeByKey, pluralFormsFor } from '../src/lib/project.js';
import { FORMAT_DESCRIPTORS } from '../src/formats/index.js';
import { DEFAULT_SETTINGS, FILTER, SHORTCUTS, pluralLabelsFor } from '../src/lib/constants.js';

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
const has = (markup, needle, message) =>
  assert.ok(markup.includes(needle), message ?? `expected the markup to contain ${JSON.stringify(needle)}`);

const render = (element) => renderToStaticMarkup(element);

/** Every class attribute in the markup, for structural assertions. */
function classAttributes(markup) {
  return [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]);
}

// ================================================================ fixtures

const SIMPLE = [
  createEntry({ key: 'MENU_START', source: 'Start game', target: 'Rozpocznij grę', comment: 'Title screen', references: ['src/menu.c:42'] }),
  createEntry({ key: 'HP', source: 'You have %d HP left', target: 'Zostało Ci HP', flags: ['c-format'] }),
  createEntry({ key: 'QUIT', source: 'Quit' }),
  createEntry({
    key: 'FILES',
    source: '%d file',
    pluralSource: '%d files',
    pluralTargets: ['%d plik', '%d pliki', '%d plików'],
    approved: true,
  }),
];

const SETTINGS = { ...DEFAULT_SETTINGS, targetLanguage: 'pl' };
const ANALYSIS = analyzeProject(SIMPLE, { ...SETTINGS, expectedPluralForms: 3 });
const PROGRESS = projectProgress(SIMPLE);

// ==================================================================== App

test('app: renders the empty state with no project', () => {
  const markup = render(<App />);
  has(markup, 'Drop your translation files here');
  has(markup, 'M3owL');
  has(markup, 'No project loaded');
});

test('app: the empty state lists every supported format', () => {
  const markup = render(<App />);
  for (const descriptor of FORMAT_DESCRIPTORS) {
    has(markup, descriptor.label, `${descriptor.label} must be advertised on the drop zone`);
  }
});

test('app: the drop zone says files stay local', () => {
  const markup = render(<App />);
  has(markup, 'no file is uploaded');
});

// ================================================================= Empty

test('empty state: renders the choose-files button', () => {
  const markup = render(<EmptyState onFiles={() => {}} onOpen={() => {}} restoreAvailable={false} />);
  has(markup, 'Choose files');
});

test('empty state: offers session restore only when one exists', () => {
  const without = render(<EmptyState onFiles={() => {}} onOpen={() => {}} restoreAvailable={false} />);
  ok(!without.includes('Restore last session'), 'no restore button when there is nothing to restore');

  const withSession = render(<EmptyState onFiles={() => {}} onOpen={() => {}} restoreAvailable />);
  has(withSession, 'Restore last session');
});

// ================================================================ Header

test('header: shows the file name, format and entry count', () => {
  const markup = render(
    <Header
      fileInfo={{ name: 'strings.po', sizeLabel: '12 KB' }}
      formatLabel="gettext PO"
      entryCount={1234}
      hasProject
      theme="dark"
      onToggleTheme={() => {}}
      onFiles={() => {}}
      onExport={() => {}}
      onClearProject={() => {}}
      onShortcuts={() => {}}
    />,
  );
  has(markup, 'strings.po');
  has(markup, 'gettext PO');
  // Thousands separators are locale-dependent -- pl-PL writes 1234 with no
  // separator -- so match the digits rather than one formatted string.
  ok(/1[,\s\u00a0]?234/.test(markup), 'the entry count must be shown');
});

test('header: Export is disabled without a project', () => {
  const markup = render(
    <Header
      fileInfo={null}
      formatLabel={null}
      entryCount={0}
      hasProject={false}
      theme="dark"
      onToggleTheme={() => {}}
      onFiles={() => {}}
      onExport={() => {}}
      onClearProject={() => {}}
      onShortcuts={() => {}}
    />,
  );
  has(markup, 'Open files');
  const exportButton = markup.match(/<button[^>]*>[\s\S]*?Export[\s\S]*?<\/button>/)?.[0] ?? '';
  has(exportButton, 'disabled', 'Export must be disabled with no project loaded');
});

// ============================================================= EntryList

test('entry list: renders every entry with its key and source', () => {
  const markup = render(
    <EntryList
      entries={SIMPLE}
      totalCount={SIMPLE.length}
      selectedId={SIMPLE[0].id}
      onSelect={() => {}}
      filter={FILTER.ALL}
      onFilterChange={() => {}}
      search=""
      onSearchChange={() => {}}
      analysis={ANALYSIS}
      progress={PROGRESS}
      filterCounts={computeFilterCounts(SIMPLE, ANALYSIS)}
    />,
  );

  has(markup, 'MENU_START');
  has(markup, 'Start game');
  has(markup, 'Rozpocznij grę');
  has(markup, 'FILES');
});

test('entry list: shows the issue badge for the broken placeholder', () => {
  const markup = render(
    <EntryList
      entries={SIMPLE}
      totalCount={SIMPLE.length}
      selectedId={null}
      onSelect={() => {}}
      filter={FILTER.ALL}
      onFilterChange={() => {}}
      search=""
      onSearchChange={() => {}}
      analysis={ANALYSIS}
      progress={PROGRESS}
      filterCounts={computeFilterCounts(SIMPLE, ANALYSIS)}
    />,
  );
  has(markup, 'error', 'the missing %d must be surfaced in the list');
});

test('entry list: plural progress is shown as filled over total', () => {
  const markup = render(
    <EntryList
      entries={[SIMPLE[3]]}
      totalCount={1}
      selectedId={null}
      onSelect={() => {}}
      filter={FILTER.ALL}
      onFilterChange={() => {}}
      search=""
      onSearchChange={() => {}}
      analysis={ANALYSIS}
      progress={PROGRESS}
      filterCounts={computeFilterCounts([SIMPLE[3]], ANALYSIS)}
    />,
  );
  has(markup, '3/3');
});

test('entry list: an empty result explains itself', () => {
  const markup = render(
    <EntryList
      entries={[]}
      totalCount={42}
      selectedId={null}
      onSelect={() => {}}
      filter={FILTER.ISSUES}
      onFilterChange={() => {}}
      search="zzz"
      onSearchChange={() => {}}
      analysis={ANALYSIS}
      progress={PROGRESS}
      filterCounts={{}}
    />,
  );
  has(markup, 'Nothing matches this filter');
  has(markup, 'Show all 42 entries');
});

test('entry list: filter chips carry their counts', () => {
  const counts = computeFilterCounts(SIMPLE, ANALYSIS);
  const markup = render(
    <EntryList
      entries={SIMPLE}
      totalCount={SIMPLE.length}
      selectedId={null}
      onSelect={() => {}}
      filter={FILTER.ALL}
      onFilterChange={() => {}}
      search=""
      onSearchChange={() => {}}
      analysis={ANALYSIS}
      progress={PROGRESS}
      filterCounts={counts}
    />,
  );

  for (const label of ['All', 'Untranslated', 'Translated', 'Approved', 'Issues']) {
    has(markup, label);
  }
});

// ============================================================= EditorPane

test('editor: renders the source and the translation field', () => {
  const markup = render(
    <EditorPane
      entry={SIMPLE[0]}
      issues={ANALYSIS.byEntry.get(SIMPLE[0].id) ?? []}
      position={1}
      total={4}
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );

  has(markup, 'Start game');
  has(markup, 'Rozpocznij grę');
  has(markup, 'textarea');
  has(markup, 'Title screen');
  has(markup, 'src/menu.c:42');
});

test('editor: highlights placeholders as tokens', () => {
  const markup = render(
    <EditorPane
      entry={SIMPLE[1]}
      issues={[]}
      position={2}
      total={4}
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );

  has(markup, 'class="tok"', 'the source placeholder must be rendered as a token');
  has(markup, '%d');
  has(markup, 'Insert:');
});

test('editor: a plural entry gets one field per form', () => {
  const markup = render(
    <EditorPane
      entry={SIMPLE[3]}
      issues={[]}
      position={4}
      total={4}
      targetLanguage="pl"
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );

  const fields = markup.match(/<textarea/g) ?? [];
  assert.equal(fields.length, 3, 'three plural forms means three textareas');

  // Polish uses one / few / many. Labelling them zero / one / two would point
  // the translator at the wrong form.
  has(markup, 'one');
  has(markup, 'few');
  has(markup, 'many');
  has(markup, 'plural · 3 forms');
});

test('editor: plural labels follow the target language', () => {
  const english = render(
    <EditorPane
      entry={SIMPLE[3]}
      issues={[]}
      position={4}
      total={4}
      targetLanguage="en"
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );

  has(english, 'one');
  has(english, 'other');
  ok(!english.includes('few'), 'English has no "few" form');
});

test('editor: the missing placeholder is reported above the field', () => {
  const issues = ANALYSIS.byEntry.get(SIMPLE[1].id) ?? [];
  const markup = render(
    <EditorPane
      entry={SIMPLE[1]}
      issues={issues}
      position={2}
      total={4}
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );

  has(markup, 'Missing placeholder');
  has(markup, '%d');
});

test('editor: an approved entry shows the approved state', () => {
  const markup = render(
    <EditorPane
      entry={SIMPLE[3]}
      issues={[]}
      position={4}
      total={4}
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );
  has(markup, 'Approved');
  has(markup, 'aria-pressed="true"');
});

test('editor: nothing selected renders a prompt, not a crash', () => {
  const markup = render(
    <EditorPane
      entry={null}
      issues={[]}
      position={0}
      total={0}
      onChangeForm={() => {}}
      onApproveToggle={() => {}}
      onClear={() => {}}
      onCopySource={() => {}}
      onPrev={() => {}}
      onNext={() => {}}
    />,
  );
  has(markup, 'Select an entry to translate it');
});

// ============================================================== SidePanel

test('side panel: shows memory matches with their score', () => {
  const memory = buildMemory([
    createEntry({ key: 'A', source: 'Start game', target: 'Rozpocznij grę' }),
  ]);
  const matches = lookupMatches(memory, 'Start game', {});

  const markup = render(
    <SidePanel
      tab="memory"
      onTabChange={() => {}}
      entry={SIMPLE[0]}
      issues={[]}
      analysis={ANALYSIS}
      matches={matches}
      onInsertMatch={() => {}}
      onImportTm={() => {}}
      tmCount={memory.records.length}
      onJumpToIssue={() => {}}
      meta={{ entries: 4 }}
      formatLabel="gettext PO"
      fileInfo={{ name: 'strings.po', sizeLabel: '2 KB' }}
      settings={SETTINGS}
      onChangeSettings={() => {}}
    />,
  );

  has(markup, 'Rozpocznij grę');
  has(markup, '100%');
  has(markup, 'exact');
  has(markup, 'Use this translation');
});

test('side panel: the quality tab reports counts by severity', () => {
  const markup = render(
    <SidePanel
      tab="quality"
      onTabChange={() => {}}
      entry={SIMPLE[1]}
      issues={ANALYSIS.byEntry.get(SIMPLE[1].id) ?? []}
      analysis={ANALYSIS}
      matches={[]}
      onInsertMatch={() => {}}
      onImportTm={() => {}}
      tmCount={0}
      onJumpToIssue={() => {}}
      meta={{ entries: 4 }}
      formatLabel="gettext PO"
      fileInfo={{ name: 'strings.po', sizeLabel: '2 KB' }}
      settings={SETTINGS}
      onChangeSettings={() => {}}
    />,
  );

  has(markup, 'Error');
  has(markup, 'Warning');
  has(markup, 'Next issue');
  has(markup, 'This entry');
});

test('side panel: the info tab lists the file and language pair', () => {
  const markup = render(
    <SidePanel
      tab="info"
      onTabChange={() => {}}
      entry={SIMPLE[0]}
      issues={[]}
      analysis={ANALYSIS}
      matches={[]}
      onInsertMatch={() => {}}
      onImportTm={() => {}}
      tmCount={0}
      onJumpToIssue={() => {}}
      meta={{ entries: 4, version: '1.2' }}
      formatLabel="gettext PO"
      fileInfo={{ name: 'strings.po', sizeLabel: '2 KB' }}
      settings={SETTINGS}
      onChangeSettings={() => {}}
    />,
  );

  has(markup, 'strings.po');
  has(markup, 'Source language');
  has(markup, 'Target language');
  has(markup, 'pl');
});

test('side panel: an entry with no issues is reported as clean', () => {
  const markup = render(
    <SidePanel
      tab="quality"
      onTabChange={() => {}}
      entry={SIMPLE[0]}
      issues={[]}
      analysis={ANALYSIS}
      matches={[]}
      onInsertMatch={() => {}}
      onImportTm={() => {}}
      tmCount={0}
      onJumpToIssue={() => {}}
      meta={{ entries: 4 }}
      formatLabel="gettext PO"
      fileInfo={{ name: 'strings.po', sizeLabel: '2 KB' }}
      settings={SETTINGS}
      onChangeSettings={() => {}}
    />,
  );
  has(markup, 'passes every check');
});

// ============================================================= StatusBar

test('status bar: reports progress and issues', () => {
  const markup = render(
    <StatusBar
      progress={PROGRESS}
      analysis={ANALYSIS}
      savedAt={new Date('2026-01-02T15:04:00')}
      saving={false}
      autosaveEnabled
      storageLabel="Storage 1.2 MB"
      hasProject
      undoTarget={null}
      onUndo={() => {}}
    />,
  );

  has(markup, 'approved');
  has(markup, 'error');
  has(markup, 'Saved');
  has(markup, 'Storage 1.2 MB');
});

test('status bar: offers undo only when something is undoable', () => {
  const without = render(
    <StatusBar progress={PROGRESS} analysis={ANALYSIS} hasProject undoTarget={null} onUndo={() => {}} />,
  );
  ok(!without.includes('Undo'), 'no undo affordance with an empty stack');

  const withUndo = render(
    <StatusBar progress={PROGRESS} analysis={ANALYSIS} hasProject undoTarget="clear translation" onUndo={() => {}} />,
  );
  has(withUndo, 'Undo clear translation');
});

test('status bar: says so when no project is loaded', () => {
  const markup = render(<StatusBar progress={null} analysis={null} hasProject={false} onUndo={() => {}} />);
  has(markup, 'No project loaded');
});

// ================================================================ Dialogs

test('export dialog: lists every format with the original marked', () => {
  const markup = render(
    <ExportDialog
      entries={SIMPLE}
      meta={{ formatId: 'po', format: 'po', sourceLanguage: 'en', targetLanguage: 'pl' }}
      formatId="po"
      fileName="strings.po"
      settings={SETTINGS}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  for (const descriptor of FORMAT_DESCRIPTORS) has(markup, descriptor.label);
  has(markup, 'original');
  has(markup, 'strings.pl.po', 'the suggested filename follows the target language');
  has(markup, 'nothing is lost');
});

test('export dialog: warns when the target format cannot carry plurals', () => {
  const markup = render(
    <ExportDialog
      entries={SIMPLE}
      meta={{ formatId: 'po', format: 'po', sourceLanguage: 'en', targetLanguage: 'pl' }}
      formatId="apple"
      fileName="strings.po"
      settings={SETTINGS}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  has(markup, 'cannot represent plural forms');
});

test('shortcuts dialog: lists every shortcut', () => {
  const markup = render(<ShortcutsDialog onClose={() => {}} />);

  // Every documented shortcut must actually be rendered -- a stale help sheet
  // is worse than no help sheet, because it teaches the wrong keys.
  for (const shortcut of SHORTCUTS) {
    has(markup, shortcut.keys, `the "${shortcut.keys}" chord must be shown`);
    has(markup, shortcut.action, `the "${shortcut.action}" description must be shown`);
  }

  has(markup, 'disabled while a dialog is open');
});

// ================================================= modal structural invariants

test('modal: centres inside a min-h-full wrapper, not on the scroll container', () => {
  const markup = render(
    <ExportDialog
      entries={SIMPLE}
      meta={{ formatId: 'po' }}
      formatId="po"
      fileName="strings.po"
      settings={SETTINGS}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  const classes = classAttributes(markup);

  const scrollContainer = classes.find((value) => value.includes('overflow-y-auto') && value.includes('backdrop-blur'));
  ok(scrollContainer, 'the backdrop must be the scroll container');
  ok(
    !scrollContainer.includes('items-center'),
    'items-center on the scroll container pushes the panel top out of reach when it overflows',
  );

  const centring = classes.find((value) => value.includes('min-h-full'));
  ok(centring, 'centring needs an inner wrapper with min-h-full');
  has(centring, 'items-center');

  const panel = classes.find((value) => value.includes('max-h-[calc(100dvh'));
  ok(panel, 'the panel must be capped to the viewport height');
  has(panel, 'flex-col');
});

test('modal: header and footer are siblings of a scrolling body', () => {
  const markup = render(
    <ExportDialog
      entries={SIMPLE}
      meta={{ formatId: 'po' }}
      formatId="po"
      fileName="strings.po"
      settings={SETTINGS}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );

  const classes = classAttributes(markup);
  const header = classes.find((value) => value.startsWith('flex shrink-0 items-start'));
  const footer = classes.find((value) => value.startsWith('flex shrink-0 items-center justify-end'));
  const body = classes.find((value) => value.startsWith('min-h-0 flex-1 overflow-y-auto'));

  ok(header, 'the header must be shrink-0 so it never scrolls away');
  ok(footer, 'the footer must be shrink-0 so the action buttons stay reachable');
  ok(body, 'only the body should scroll');
});

test('modal: has an accessible dialog role and a close control', () => {
  const markup = render(<ShortcutsDialog onClose={() => {}} />);
  has(markup, 'role="dialog"');
  has(markup, 'aria-modal="true"');
  has(markup, 'aria-label="Close"');
});

// ============================================================ Highlighted

test('highlighted text: marks tokens that are absent from the reference', () => {
  const markup = render(<HighlightedText text="Deal %d damage" against="Deal damage" />);
  has(markup, 'tok-warn', 'an unexpected placeholder must be flagged');
});

test('highlighted text: a matching token is not flagged', () => {
  const markup = render(<HighlightedText text="Deal %d damage" against="Zadaj %d obrażeń" />);
  has(markup, 'class="tok"');
  ok(!markup.includes('tok-warn'));
});

test('highlighted text: plain text renders without tokens', () => {
  const markup = render(<HighlightedText text="No placeholders here" />);
  has(markup, 'No placeholders here');
  ok(!markup.includes('tok'));
});

test('highlighted text: an empty value renders the placeholder hint', () => {
  const markup = render(<HighlightedText text="" empty="(empty source)" />);
  has(markup, '(empty source)');
});

test('icon: renders a path and nothing for an unknown name', () => {
  has(render(<Icon name="check" />), '<path');
  assert.equal(render(<Icon name="definitely-not-an-icon" />), '');
});

// ============================================================ pure logic

test('project: mergeByKey pairs a source file with a translation file', () => {
  const sources = [
    createEntry({ key: 'A', source: 'Hello' }),
    createEntry({ key: 'B', source: 'Bye' }),
    createEntry({ key: 'C', source: 'Untranslated elsewhere' }),
  ];
  const targets = [
    createEntry({ key: 'A', target: 'Witaj' }),
    createEntry({ key: 'B', target: 'Pa' }),
  ];

  const merged = mergeByKey(sources, targets);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].target, 'Witaj');
  assert.equal(merged[1].target, 'Pa');
  assert.equal(merged[2].target, '', 'an unmatched source stays untranslated');
});

test('project: mergeByKey keeps translation-only entries rather than dropping work', () => {
  const sources = [createEntry({ key: 'A', source: 'Hello' })];
  const targets = [createEntry({ key: 'A', target: 'Witaj' }), createEntry({ key: 'Z', target: 'Sierota' })];

  const merged = mergeByKey(sources, targets);
  assert.equal(merged.length, 2, 'the orphan must survive');
  assert.equal(merged[1].key, 'Z');
});

test('project: mergeByKey reads a paired file opened as sources', () => {
  const sources = [createEntry({ key: 'A', source: 'Hello' })];
  const targets = [createEntry({ key: 'A', source: 'Witaj' })];

  const merged = mergeByKey(sources, targets);
  assert.equal(merged[0].target, 'Witaj', 'the paired file put its text in source');
});

test('project: filters map onto translation status', () => {
  assert.equal(filterEntries(SIMPLE, { filter: FILTER.ALL }).length, 4);
  assert.equal(filterEntries(SIMPLE, { filter: FILTER.UNTRANSLATED }).length, 1);
  assert.equal(filterEntries(SIMPLE, { filter: FILTER.APPROVED }).length, 1);
  assert.equal(filterEntries(SIMPLE, { filter: FILTER.TRANSLATED }).length, 2);
});

test('project: the issues filter finds entries failing a check', () => {
  const issues = filterEntries(SIMPLE, { filter: FILTER.ISSUES, analysis: ANALYSIS });
  ok(issues.some((entry) => entry.key === 'HP'), 'the missing placeholder must be found');
});

test('project: search covers source, target and key', () => {
  assert.equal(filterEntries(SIMPLE, { search: 'menu_start' }).length, 1);
  assert.equal(filterEntries(SIMPLE, { search: 'Rozpocznij' }).length, 1);
  assert.equal(filterEntries(SIMPLE, { search: '%d files' }).length, 1, 'the plural source is searchable');
  assert.equal(filterEntries(SIMPLE, { search: 'nothing here' }).length, 0);
});

test('project: plural form counts follow the language', () => {
  assert.equal(pluralFormsFor('pl'), 3);
  assert.equal(pluralFormsFor('en'), 2);
  assert.equal(pluralFormsFor('ja'), 1);
  assert.equal(pluralFormsFor('ru'), 3);
  assert.equal(pluralFormsFor('pl-PL'), 3, 'a region subtag must not defeat the lookup');
  assert.equal(pluralFormsFor('xx'), 2, 'an unknown language falls back to two forms');
});

test('project: plural labels are language-specific', () => {
  assert.deepEqual(pluralLabelsFor('pl', 3), ['one', 'few', 'many']);
  assert.deepEqual(pluralLabelsFor('ru', 3), ['one', 'few', 'many']);
  assert.deepEqual(pluralLabelsFor('en', 2), ['one', 'other']);
  assert.deepEqual(pluralLabelsFor('ja', 1), ['other']);
  assert.deepEqual(pluralLabelsFor('ar', 6), ['zero', 'one', 'two', 'few', 'many', 'other']);
  // A region subtag must still resolve.
  assert.deepEqual(pluralLabelsFor('pl-PL', 3), ['one', 'few', 'many']);
  // An unknown language falls back to a sensible set for the count.
  assert.deepEqual(pluralLabelsFor('xx', 3), ['one', 'few', 'many']);
  // A file with more forms than the language declares still gets a label each.
  assert.equal(pluralLabelsFor('en', 5).length, 5);
  assert.equal(pluralLabelsFor('en', 5).every(Boolean), true);
  // And a declared set that does not match the count must not be used blindly.
  assert.deepEqual(pluralLabelsFor('fr', 2), ['one', 'other']);
});

test('project: the issues filter ignores informational notes', () => {
  const entries = [createEntry({ key: 'A', source: 'Hello there friend', target: 'Witaj' })];
  const analysis = analyzeProject(entries, {});
  // Whatever the checks produce, only warning-and-above may qualify.
  const filtered = filterEntries(entries, { filter: FILTER.ISSUES, analysis });
  for (const entry of filtered) {
    const issues = analysis.byEntry.get(entry.id) ?? [];
    ok(issues.some((current) => current.severity !== 'info'), 'an info-only entry must not appear');
  }
});

// =============================================================== summary

process.stdout.write('\n\n');

if (failures.length) {
  console.log('FAILURES\n');
  for (const { name, error } of failures) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message.split('\n').slice(0, 8).join('\n  ')}\n`);
  }
}

console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed ? 1 : 0);
