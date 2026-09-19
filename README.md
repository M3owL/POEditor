# POEditor

A translation editor that runs entirely in the browser. Open a localisation
file, translate it, export it back — in the same format, or in a different one.

**Nothing is uploaded.** Files are read with the File API and processed in the
page. There is no backend, no account, and no telemetry. The only network
request the app ever makes is for its own JavaScript.

Live: https://m3owl.github.io/POEditor/

---

## Why this exists

The previous version of this project was a single 17 KB `index.html` that loaded
React and Babel from a CDN and parsed gettext PO files by splitting on blank
lines and running two regexes. That approach silently corrupts most real files:

| What breaks | Why |
|---|---|
| Plural forms | `msgid_plural` / `msgstr[0..n]` were not parsed at all |
| Contexts | `msgctxt` was ignored, so two different strings with the same text collapsed into one |
| Multi-line strings | A `msgid` continued across several `"..."` lines was truncated at the first |
| The metadata header | Including `Plural-Forms`, without which gettext cannot read any plural in the file |
| Translator comments | `#.` notes and `#:` source references were discarded |
| Obsolete entries | `#~` blocks were dropped on export |

It also only handled PO. This version reads and writes eight formats, and the
parsers are line-oriented state machines and real XML scanners rather than
regexes over lines.

---

## Supported formats

| Format | Extensions | Read | Write | Plurals | Notes | References |
|---|---|---|---|---|---|---|
| gettext PO | `.po` `.pot` | ✅ | ✅ | ✅ | ✅ | ✅ |
| XLIFF 1.2 / 2.0 | `.xlf` `.xliff` `.sdlxliff` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Excel workbook | `.xlsx` `.xlsm` | ✅ | ✅ | ✅ | ✅ | ✅ |
| CSV | `.csv` | ✅ | ✅ | ✅ | ✅ | ✅ |
| TSV | `.tsv` | ✅ | ✅ | ✅ | ✅ | ✅ |
| JSON | `.json` | ✅ | ✅ | ✅ | — | — |
| Android `strings.xml` | `.xml` | ✅ | ✅ | ✅ | ✅ | — |
| Apple `.strings` | `.strings` | ✅ | ✅ | — | ✅ | — |
| TMX | `.tmx` | ✅ | ✅ | — | ✅ | — |
| SubRip | `.srt` | ✅ | ✅ | — | — | — |
| WebVTT | `.vtt` | ✅ | ✅ | — | — | — |

The format is detected from the content, not just the extension. `.xml` is
shared by Android strings, TMX and XLIFF, so the root element decides.

### Opening two files together

Drop a source file and a translation file at once — `en.json` and `pl.json`,
for example — and they are paired by key. Which is which is worked out from the
language codes in the filenames against the project's language pair. Entries
that exist only in the translation file are kept rather than discarded, so
nothing is lost if the two files have drifted apart.

### Spreadsheets

Column roles are guessed from the header row (`key`, `id`, `resname`, `msgctxt`,
`source`, `en`, `target`, `pl`, `comment`, …) and confirmed in a dialog with a
live preview before anything is imported. gettext-in-Excel layouts work:
`msgid` / `msgid_plural` / `msgstr[0]` / `msgstr[1]`.

**Columns this tool does not recognise are preserved on export.** A studio's
master sheet usually carries character limits, VO status and screenshot
references; rebuilding it from the entry model would throw all of that away, so
rows are patched in place by the row number recorded at import.

---

## What it does while you translate

**Placeholder checking.** `%d`, `%1$s`, `{0}`, `{name}`, `$VAR$`, `%VAR%`,
`%{ruby}`, inline tags and XML entities are compared between source and
translation. A missing specifier is an error, an unexpected one is a warning,
and a reordered set of unindexed `%s` is flagged because the values will swap.

A `%` followed by a space is deliberately *not* treated as a format specifier,
so `100% gotowe` does not produce a false positive. A QA panel full of noise
gets ignored, which is worse than no QA panel.

**Everything else checked:** leading and trailing whitespace, line-break counts,
terminal punctuation, unbalanced brackets, an identical source and target,
strings that grew far longer than the source, double spaces, and plural form
counts that do not match the target language.

Across the whole project: duplicate keys, the same source translated several
different ways, and entries whose plural form count is wrong.

**Translation memory.** Every completed translation is remembered, and matches
are shown as you work with an exact / prefix / fuzzy label and a score. Matching
uses the Dice coefficient over character bigrams rather than word overlap,
because game strings are short and inflected — "Rozpocznij grę" and "Rozpocznij
gre" share almost no whole words but are obviously the same sentence. TMX files
can be imported as extra memory.

**Plural forms are never collapsed.** One field per form, labelled with the
target language's actual categories. Polish gets one / few / many; labelling
those zero / one / two would point a translator at the wrong form.

---

## Working offline, and staying local

The session autosaves to IndexedDB as you type, so a refresh or a closed tab
does not lose work. The empty screen offers to restore it.

Settings live in `localStorage` because they are tiny and read synchronously on
boot; the project lives in IndexedDB because a large PO file exceeds what
`localStorage` can hold. Both degrade to a no-op rather than throwing, so
private browsing disables autosave instead of breaking the editor.

---

## Project layout

```
app/                       Vite root
├── index.html             shell
├── public/favicon.svg
├── src/
│   ├── main.jsx           entry
│   ├── App.jsx            state and flow
│   ├── index.css          Tailwind + design tokens
│   ├── lib/
│   │   ├── entry.js       the canonical entry model
│   │   ├── xml.js         ordered XML parsing + inline markup
│   │   ├── csv.js         RFC 4180 delimited text
│   │   ├── grid.js        spreadsheet columns <-> entries
│   │   ├── placeholders.js token extraction and comparison
│   │   ├── qa.js          quality checks
│   │   ├── tm.js          translation memory
│   │   ├── project.js     combining imports, filtering
│   │   ├── storage.js     IndexedDB session + settings
│   │   ├── files.js       reading and downloading files
│   │   └── constants.js   filters, languages, shortcuts
│   ├── formats/
│   │   ├── index.js       registry, detection, lazy loading
│   │   ├── po.js          gettext PO
│   │   ├── xliff.js       XLIFF 1.2 + 2.0
│   │   ├── tabular.js     XLSX / CSV / TSV
│   │   ├── json.js        JSON and i18next
│   │   ├── android.js     Android strings.xml
│   │   ├── apple.js       Apple .strings
│   │   ├── subtitles.js   SRT + WebVTT
│   │   └── tmx.js         TMX
│   ├── components/        panes, dialogs, ui primitives
│   └── scripts/           test suites
├── tools/publish.mjs      copies dist/ to the repository root
index.html                 built — this is what Pages serves
assets/                    built
```

### The entry model

Every format parses into one shape and serialises back out of it, so the editor
only ever deals with one kind of object:

```js
{
  id, key,
  source, target,
  pluralSource, pluralTargets: [],
  comment, references: [], flags: [],
  approved,
  origin   // format-specific extras needed for an exact round-trip
}
```

### Round-tripping XLIFF

Most tools rebuild an XLIFF file from their own model and drop everything the
model does not know about: `alt-trans` history, `context-group` entries, `state`
and `approved` attributes, group nesting, custom namespaces, the original
whitespace. A vendor reviewing a delivery notices immediately.

This one stores the source document verbatim and, on export, re-parses it and
mutates only the `<target>` nodes. Everything else survives by construction.
Inline markup (`<g>`, `<x/>`, `<ph>`, `<pc>`) is shown to the translator as
literal markup, which is also what the QA checks scan for, so a dropped tag is
reported rather than shipped.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5174
npm run build      # vite build, then publish to the repository root
npm run preview    # serve the production build
```

### Tests

```bash
npm test             # 149 tests: formats, parsers, spreadsheet I/O, conversion
npm run test:formats # 109 tests: one suite per format
npm run test:spreadsheet  # 18 tests: the real XLSX/CSV/TSV path
npm run test:conversion   # 22 tests: converting between formats
npm run test:render  # 46 tests: every pane, plus modal structural invariants
npm run verify       # all of the above
```

The format suites run under plain Node with no bundler, because every module
under test is pure ESM with no DOM dependency. The spreadsheet suite loads the
real Excel libraries — both builds run under Node 22, since `File` and `Blob`
are globals there — so the whole XLSX path is exercised without a browser.

The conversion suite covers the thing the per-format suites cannot: receiving
one format and handing back another, via `parseFile -> edit -> serializeEntries
-> parseFile`. It also guards the contract between the registry and the format
modules, which is where the sharpest bug in this codebase lived — the registry
calls `format.parse({ text, bytes, name })`, so a parser written as
`parse(string)` receives an object, matches nothing and returns zero entries.
The file loads as an empty project and nothing errors. Every format is now
asserted to accept that input shape and to return `{ text, mime, extension }`
from `serialize`.

The render suite server-renders every pane and asserts the structural
invariants that are easy to break and invisible until someone cannot reach a
button. In particular: a modal must centre inside a `min-h-full` wrapper, never
on the scroll container, because `items-center` on a scroll container pushes an
over-tall panel's top above the scroll origin, where it cannot be reached.

---

## Deploying

`index.html` and `assets/` at the repository root are build output, committed on
purpose. GitHub Pages on this repository serves from `main / (root)`, so a
branch-based deploy needs no configuration at all — the site works the moment
the branch is pushed.

That is why the Vite root is `app/` and `tools/publish.mjs` copies the build
back to the root. Putting the Vite template at the root instead would hand the
browser a `<script src="/POEditor/assets/index-*.js">` that only exists after a
build, which is a blank page.

`.github/workflows/deploy.yml` is there for anyone who prefers to switch Pages
to **GitHub Actions**. If you do, flip the source *after* the workflow has run
once — switching before leaves Pages with nothing to serve.

**Run `npm run build` before committing after any change under `app/`.** The
published copy at the root goes stale otherwise. The build clears old hashed
files from `assets/` itself.

Custom domain? Set `VITE_BASE=/`.

---

## Licence

MIT.
