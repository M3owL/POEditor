/**
 * gettext PO / POT.
 *
 * The previous implementation split the file on blank lines and matched
 * msgid/msgstr with two regexes. That silently corrupts most real-world
 * files:
 *
 *   - multi-line strings (a msgid continued across several "..." lines)
 *   - msgctxt, so two entries with the same text but different contexts
 *     collapsed into one
 *   - msgid_plural / msgstr[0..n], i.e. every plural form, entirely
 *   - the metadata header, including Plural-Forms, which is what tells you
 *     how many plural forms a language needs
 *   - comments and #: source references, which are the translator's only
 *     context
 *
 * This is a line-oriented state machine instead, which is how gettext itself
 * reads the format. Nothing depends on blank lines being present.
 */

import { createEntry, nextId } from '../lib/entry.js';
import { inputText } from '../lib/files.js';

// ---------------------------------------------------------------- escaping

const UNESCAPE = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
};

export function unescapePO(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    const next = value[i];
    out += Object.prototype.hasOwnProperty.call(UNESCAPE, next) ? UNESCAPE[next] : `\\${next ?? ''}`;
  }
  return out;
}

/**
 * Order matters. Backslashes must be doubled first, otherwise escaping a quote
 * and then a newline would double-escape the backslash it just introduced.
 */
export function escapePO(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

// ----------------------------------------------------------------- parsing

/** Read a run of "..." segments from a line, returning the raw (still escaped) text. */
function readQuotedSegments(line) {
  const parts = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(line)) !== null) parts.push(match[1]);
  return parts.join('');
}

const KEYWORD_RE = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*)$/;

function emptySlot() {
  return {
    ctxt: null,
    id: null,
    plural: null,
    forms: new Map(),
    comments: [],
    extracted: [],
    references: [],
    flags: [],
    previous: null,
    obsolete: false,
    raw: [],
  };
}

export function parsePO(input) {
  const lines = inputText(input).replace(/\r\n?/g, '\n').split('\n');

  const entries = [];
  const meta = { header: '', headerFields: {}, obsolete: [], nplurals: 2 };
  let slot = null;
  let pending = { comments: [], extracted: [], references: [], flags: [], previous: null };
  let lastTarget = null; // { key, index } for continuation lines

  const flush = () => {
    if (!slot) return;

    const source = slot.id ?? '';
    const isHeader = source === '' && !slot.ctxt;

    if (isHeader && entries.length === 0 && !slot.plural) {
      // Metadata block. Keep it verbatim so Plural-Forms and friends survive.
      meta.header = slot.forms.get('msgstr:0') ?? '';
      for (const line of meta.header.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) meta.headerFields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      const nplurals = Number(meta.headerFields['Plural-Forms']?.match(/nplurals\s*=\s*(\d+)/)?.[1]);
      if (Number.isFinite(nplurals) && nplurals > 0) meta.nplurals = nplurals;

      slot = null;
      lastTarget = null;
      return;
    }

    if (slot.obsolete) {
      meta.obsolete.push(slot.raw.join('\n'));
      slot = null;
      lastTarget = null;
      return;
    }

    if (slot.id === null && slot.ctxt === null) {
      slot = null;
      lastTarget = null;
      return;
    }

    const pluralSource = slot.plural;
    const formCount = pluralSource ? Math.max(meta.nplurals, 2) : 1;

    entries.push(
      createEntry({
        id: nextId(),
        key: slot.ctxt ?? '',
        source,
        target: slot.forms.get('msgstr:0') ?? '',
        pluralSource,
        pluralTargets: pluralSource
          ? Array.from({ length: formCount }, (_, i) => slot.forms.get(`msgstr:${i}`) ?? '')
          : [],
        comment: [...slot.comments, ...slot.extracted].join('\n'),
        references: slot.references,
        flags: slot.flags,
        approved: !slot.flags.includes('fuzzy') && (slot.forms.get('msgstr:0') ?? '') !== '',
        origin: {
          previous: slot.previous,
          hadCtxt: slot.ctxt !== null,
          rawFlags: slot.flags,
        },
      }),
    );

    slot = null;
    lastTarget = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Obsolete entries: preserved verbatim, never edited.
    if (line.startsWith('#~')) {
      if (!slot) slot = emptySlot();
      slot.obsolete = true;
      slot.raw.push(line);
      continue;
    }

    if (slot?.obsolete) {
      if (line.startsWith('#~') || line.startsWith('"')) {
        slot.raw.push(line);
        continue;
      }
      flush();
    }

    if (line === '') {
      flush();
      continue;
    }

    if (line.startsWith('#')) {
      // The marker is two characters (`#:`, `#.`, `#,`, `#|`) or one (`#`).
      // Stripping only the `#` leaves the marker glued to the first reference,
      // so `#: src/a.c:1` would parse as the reference ":".
      const marker = line.slice(0, 2);
      const body = line.slice(2);

      if (marker === '#|') {
        pending.previous = body.trim();
      } else if (marker === '#.') {
        pending.extracted.push(body.trim());
      } else if (marker === '#:') {
        pending.references.push(...body.trim().split(/\s+/).filter(Boolean));
      } else if (marker === '#,') {
        pending.flags.push(...body.split(',').map((f) => f.trim()).filter(Boolean));
      } else {
        pending.comments.push(line.startsWith('# ') ? body : line.slice(1));
      }

      // A comment line directly before a keyword belongs to that entry.
      if (slot && slot.id !== null) flush();
      continue;
    }

    // Continuation of the previous keyword: a bare "..." line.
    // These must be unescaped too. The whole metadata header arrives this way,
    // so skipping it leaves literal `\n` sequences in the header and the
    // Plural-Forms line is never found.
    if (line.startsWith('"')) {
      if (lastTarget) {
        const addition = unescapePO(readQuotedSegments(line));
        const existing = slot.forms.get(lastTarget.key) ?? '';
        slot.forms.set(lastTarget.key, existing + addition);
      }
      continue;
    }

    const match = line.match(KEYWORD_RE);
    if (!match) continue;

    const [, keyword, pluralIndex, quoted] = match;
    const value = unescapePO(readQuotedSegments(quoted));

    if (keyword === 'msgctxt') {
      if (slot && (slot.id !== null || slot.ctxt !== null)) flush();
      if (!slot) slot = emptySlot();
      slot.ctxt = value;
      slot.comments.push(...pending.comments);
      slot.extracted.push(...pending.extracted);
      slot.references.push(...pending.references);
      slot.flags.push(...pending.flags);
      slot.previous = pending.previous;
      pending = { comments: [], extracted: [], references: [], flags: [], previous: null };
      lastTarget = { key: 'ctxt', index: null };
      continue;
    }

    if (keyword === 'msgid') {
      if (slot && slot.id !== null) flush();
      if (!slot) slot = emptySlot();
      slot.id = value;
      if (slot.comments.length === 0) {
        slot.comments.push(...pending.comments);
        slot.extracted.push(...pending.extracted);
        slot.references.push(...pending.references);
        slot.flags.push(...pending.flags);
        slot.previous = pending.previous;
      }
      pending = { comments: [], extracted: [], references: [], flags: [], previous: null };
      lastTarget = { key: 'id', index: null };
      continue;
    }

    if (keyword === 'msgid_plural') {
      if (!slot) slot = emptySlot();
      slot.plural = value;
      lastTarget = { key: 'plural', index: null };
      continue;
    }

    // msgstr or msgstr[n]
    if (!slot) slot = emptySlot();
    const key = `msgstr:${pluralIndex ?? 0}`;
    slot.forms.set(key, (slot.forms.get(key) ?? '') + value);
    lastTarget = { key, index: pluralIndex ?? 0 };
  }

  flush();

  return { entries, meta };
}

// -------------------------------------------------------------- serialising

/** Wrap an escaped value the way msgcat does: first line empty, split after \n. */
function emitString(keyword, escaped) {
  if (escaped.length <= 72 && !escaped.includes('\\n')) {
    return `${keyword} "${escaped}"\n`;
  }

  const segments = escaped.split(/(?<=\\n)/).filter((s) => s !== '');
  if (segments.length <= 1) return `${keyword} "${escaped}"\n`;

  let out = `${keyword} ""\n`;
  for (const segment of segments) out += `"${segment}"\n`;
  return out;
}

export function serializePO(entries, meta = {}) {
  const parts = [];

  // Header first, always. Plural-Forms must not be lost or every plural form
  // in the file becomes unreadable to gettext.
  const headerFields = meta.headerFields ?? {};
  const header =
    meta.header ||
    [
      'Project-Id-Version: PACKAGE VERSION',
      'Report-Msgid-Bugs-To: ',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      `Plural-Forms: ${headerFields['Plural-Forms'] ?? 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>20) ? 1 : 2);'}`,
      '',
    ].join('\n');

  parts.push('# Polish translation.\n');
  parts.push(emitString('msgid', ''));
  // The `msgstr ""` line is mandatory. Without it the continuation lines below
  // are appended to the msgid, so the metadata block never materialises and
  // Plural-Forms is lost -- which silently breaks every plural form in the file.
  parts.push(emitString('msgstr', ''));
  for (const line of escapePO(header).split(/(?<=\\n)/)) {
    if (line !== '') parts.push(`"${line}"\n`);
  }
  parts.push('\n');

  for (const entry of entries) {
    const commentLines = [];
    for (const line of String(entry.comment ?? '').split('\n')) {
      if (line.trim() !== '') commentLines.push(`# ${line}\n`);
    }
    for (const ref of entry.references ?? []) commentLines.push(`#: ${ref}\n`);

    const flags = (entry.flags ?? []).filter((f) => f !== 'fuzzy');
    if (entry.approved === false && entry.target === '' && !entry.pluralSource) {
      flags.push('fuzzy');
    }
    if (flags.length) commentLines.push(`#, ${flags.join(', ')}\n`);

    if (entry.origin?.previous) commentLines.push(`#| ${entry.origin.previous}\n`);

    if (commentLines.length) parts.push(...commentLines);

    if (entry.key) parts.push(emitString('msgctxt', escapePO(entry.key)));
    parts.push(emitString('msgid', escapePO(entry.source)));

    if (entry.pluralSource) {
      parts.push(emitString('msgid_plural', escapePO(entry.pluralSource)));
      entry.pluralTargets.forEach((form, index) => {
        parts.push(emitString(`msgstr[${index}]`, escapePO(form ?? '')));
      });
    } else {
      parts.push(emitString('msgstr', escapePO(entry.target ?? '')));
    }

    parts.push('\n');
  }

  for (const block of meta.obsolete ?? []) {
    parts.push(`${block}\n\n`);
  }

  return parts.join('');
}

export const poFormat = {
  id: 'po',
  label: 'gettext PO',
  extensions: ['po', 'pot'],
  binary: false,
  capabilities: { plurals: true, notes: true, references: true, approved: true },
  parse: parsePO,
  // Wrapped so the registry always receives { text, mime, extension }; the
  // serializer itself returns a bare string, which is what a human wants when
  // calling it directly.
  serialize: (entries, meta) => ({
    text: serializePO(entries, meta),
    mime: 'text/plain; charset=utf-8',
    extension: 'po',
  }),
};
