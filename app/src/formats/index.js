/**
 * Format registry.
 *
 * Two layers on purpose:
 *
 *   - descriptors: static metadata (label, extensions, what the format can
 *     represent). Cheap to import, so the export dialog can list every format
 *     without pulling in a parser.
 *   - implementations: loaded on demand. The Excel libraries are several
 *     hundred kilobytes and most sessions never touch a spreadsheet, so they
 *     must not be in the initial bundle.
 *
 * Detection is content-first for `.xml`, because `.xml` is shared by Android
 * strings, TMX and XLIFF and the extension alone says nothing useful.
 */

import { decodeText, declaredCharsetOf, replacementRatio } from '../lib/files.js';

/** What each format can carry. Used to warn about lossy conversions. */
const CAP = {
  FULL: { plurals: true, notes: true, references: true, approved: true },
  RICH: { plurals: true, notes: true, references: false, approved: false },
  PLAIN: { plurals: false, notes: true, references: false, approved: false },
  MINIMAL: { plurals: false, notes: false, references: false, approved: false },
};

export const FORMAT_DESCRIPTORS = [
  { id: 'po', label: 'gettext PO', extensions: ['po', 'pot'], binary: false, capabilities: CAP.FULL },
  { id: 'xliff', label: 'XLIFF 1.2 / 2.0', extensions: ['xlf', 'xliff', 'sdlxliff'], binary: false, capabilities: CAP.FULL },
  { id: 'xlsx', label: 'Excel workbook', extensions: ['xlsx', 'xlsm'], binary: true, capabilities: CAP.FULL },
  { id: 'csv', label: 'CSV', extensions: ['csv'], binary: false, capabilities: CAP.FULL },
  { id: 'tsv', label: 'TSV', extensions: ['tsv'], binary: false, capabilities: CAP.FULL },
  { id: 'json', label: 'JSON', extensions: ['json'], binary: false, capabilities: CAP.RICH },
  { id: 'android', label: 'Android strings.xml', extensions: ['xml'], binary: false, capabilities: CAP.RICH },
  { id: 'apple', label: 'Apple .strings', extensions: ['strings'], binary: false, capabilities: CAP.PLAIN },
  { id: 'tmx', label: 'TMX memory', extensions: ['tmx'], binary: false, capabilities: CAP.PLAIN },
  { id: 'srt', label: 'SubRip .srt', extensions: ['srt'], binary: false, capabilities: CAP.MINIMAL },
  { id: 'vtt', label: 'WebVTT .vtt', extensions: ['vtt'], binary: false, capabilities: CAP.MINIMAL },
];

export const FORMAT_BY_ID = new Map(FORMAT_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

const EXTENSION_TO_FORMAT = new Map();
for (const descriptor of FORMAT_DESCRIPTORS) {
  for (const extension of descriptor.extensions) {
    if (!EXTENSION_TO_FORMAT.has(extension)) EXTENSION_TO_FORMAT.set(extension, descriptor.id);
  }
}

const LOADERS = {
  po: () => import('./po.js').then((module) => module.poFormat),
  xliff: () => import('./xliff.js').then((module) => module.xliffFormat),
  json: () => import('./json.js').then((module) => module.jsonFormat),
  android: () => import('./android.js').then((module) => module.androidFormat),
  apple: () => import('./apple.js').then((module) => module.appleFormat),
  tmx: () => import('./tmx.js').then((module) => module.tmxFormat),
  srt: () => import('./subtitles.js').then((module) => module.srtFormat),
  vtt: () => import('./subtitles.js').then((module) => module.vttFormat),
  xlsx: () => import('./tabular.js').then((module) => module.xlsxFormat),
  csv: () => import('./tabular.js').then((module) => module.csvFormat),
  tsv: () => import('./tabular.js').then((module) => module.tsvFormat),
};

const implementationCache = new Map();

/** Load a format implementation, memoised. */
export async function loadFormat(id) {
  if (!LOADERS[id]) throw new Error(`Unknown format: ${id}`);
  if (!implementationCache.has(id)) {
    implementationCache.set(id, LOADERS[id]());
  }
  return implementationCache.get(id);
}

// ------------------------------------------------------------- detection

/** Root element name of an XML document, without parsing it properly. */
function xmlRootName(text) {
  const match = String(text ?? '').match(/<([A-Za-z_][\w.:-]*)/);
  if (!match) return '';
  // Skip the declaration and processing instructions.
  if (match[1] === '?xml') {
    const after = String(text).replace(/<\?[\s\S]*?\?>/g, '');
    const inner = after.match(/<([A-Za-z_][\w.:-]*)/);
    return inner ? inner[1].toLowerCase() : '';
  }
  return match[1].toLowerCase();
}

/**
 * Decide the format of a file.
 *
 * Extension wins when it is unambiguous; content decides for `.xml` and for
 * files with no useful extension at all.
 */
export function detectFormat({ name = '', text = null, bytes = null } = {}) {
  const extension = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();

  // Binary spreadsheets cannot be sniffed as text.
  if (extension === 'xlsx' || extension === 'xlsm') return 'xlsx';

  if (text !== null && text !== undefined) {
    const trimmed = text.replace(/^\ufeff/, '').trimStart();

    if (trimmed.startsWith('WEBVTT')) return 'vtt';

    if (trimmed.startsWith('<')) {
      const root = xmlRootName(trimmed);
      if (root === 'xliff') return 'xliff';
      if (root === 'tmx') return 'tmx';
      if (root === 'resources') return 'android';
      // An XML file that is none of the above is most likely Android strings.
      if (extension === 'xml') return 'android';
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Not JSON after all; keep looking.
      }
    }

    // gettext: a msgid keyword at the start of a line is unmistakable.
    if (/^msgid\s+"/m.test(trimmed) || /^msgstr\s+"/m.test(trimmed)) return 'po';
    if (/^#[:.,~|]/m.test(trimmed) && /^msgid\b/m.test(trimmed)) return 'po';

    // Apple .strings: "key" = "value";
    if (/^\s*(?:\/\*[\s\S]*?\*\/\s*)?"(?:[^"\\]|\\.)*"\s*=\s*"(?:[^"\\]|\\.)*"\s*;/m.test(trimmed)) {
      return 'apple';
    }

    // Subtitles: a timing line with an arrow.
    if (/\d\s*-->\s*\d/.test(trimmed)) return 'srt';
  }

  const byExtension = EXTENSION_TO_FORMAT.get(extension);
  if (byExtension) return byExtension;

  // Last resort for .txt and unknown extensions: pick the delimiter.
  if (text) {
    const tabs = (text.match(/\t/g) ?? []).length;
    const commas = (text.match(/,/g) ?? []).length;
    if (tabs > commas && tabs > 0) return 'tsv';
    return 'csv';
  }

  return 'po';
}

// ----------------------------------------------------------- orchestration

/**
 * Decode a file, working out the charset from the content when needed.
 *
 * PO files declare `charset=` in their header. If a UTF-8 decode produced
 * replacement characters, the declaration is used to decode properly.
 */
export function decodeFile(file) {
  if (file.text !== null && file.text !== undefined) return file.text;

  const first = decodeText(file.bytes);
  const charset = declaredCharsetOf(first);

  if (charset && replacementRatio(first) > 0.0005) {
    const second = decodeText(file.bytes, charset);
    if (replacementRatio(second) < replacementRatio(first)) return second;
  }

  return first;
}

/**
 * Parse a file into entries.
 *
 * `options.format` overrides detection, `options.role` tells single-value
 * formats whether the file holds sources or translations, and
 * `options.mapping`/`options.sheet` drive the spreadsheet importer.
 */
export async function parseFile(file, options = {}) {
  const text = file.binary && !options.forceText ? null : decodeFile(file);

  const formatId = options.format ?? detectFormat({ name: file.name, text, bytes: file.bytes });
  const format = await loadFormat(formatId);

  const result = await format.parse({ text, bytes: file.bytes, name: file.name }, options);

  return {
    ...result,
    format: FORMAT_BY_ID.get(formatId) ?? { id: formatId, label: formatId },
    formatId,
  };
}

/**
 * Serialise entries into a chosen format.
 *
 * `meta` is the project's parse metadata. Language fields are forwarded so a
 * format conversion keeps the language pair, but format-specific metadata from
 * a different format is ignored rather than misapplied.
 */
export async function serializeEntries(entries, meta = {}, options = {}) {
  const formatId = options.format ?? meta.formatId ?? meta.format ?? 'po';
  const format = await loadFormat(formatId);

  const merged = {
    ...meta,
    sourceLanguage: options.sourceLanguage ?? meta.sourceLanguage,
    targetLanguage: options.targetLanguage ?? meta.targetLanguage,
    role: options.role ?? meta.role,
    // Document-preserving formats must not be handed another format's document.
    originalXml: meta.formatId === formatId || meta.format === formatId ? meta.originalXml : undefined,
    originalText: meta.formatId === formatId || meta.format === formatId ? meta.originalText : undefined,
    grid: meta.formatId === formatId || meta.format === formatId ? meta.grid : undefined,
    mapping: meta.formatId === formatId || meta.format === formatId ? meta.mapping : undefined,
    shape: meta.formatId === formatId || meta.format === formatId ? meta.shape : undefined,
    kind: meta.formatId === formatId || meta.format === formatId ? meta.kind : undefined,
  };

  const result = await format.serialize(entries, merged, options);
  return { ...result, formatId, label: FORMAT_BY_ID.get(formatId)?.label ?? formatId };
}

/** Fields that a target format cannot carry, for the export warning. */
export function lossWarnings(sourceMeta, targetFormatId, entries) {
  const target = FORMAT_BY_ID.get(targetFormatId);
  if (!target) return [];

  const warnings = [];
  const hasPlurals = entries.some((entry) => entry.pluralSource || entry.pluralTargets.length > 0);
  const hasComments = entries.some((entry) => entry.comment);
  const hasReferences = entries.some((entry) => entry.references?.length);
  const hasApproved = entries.some((entry) => entry.approved);

  if (hasPlurals && !target.capabilities.plurals) {
    warnings.push(`${target.label} cannot represent plural forms. Only the first form of each plural entry will be written.`);
  }
  if (hasComments && !target.capabilities.notes) {
    warnings.push(`${target.label} has nowhere to store translator comments; they will be dropped.`);
  }
  if (hasReferences && !target.capabilities.references) {
    warnings.push(`${target.label} has no field for source references; they will be dropped.`);
  }
  if (hasApproved && !target.capabilities.approved) {
    warnings.push(`${target.label} does not record approval status.`);
  }
  if (
    sourceMeta?.kind === 'xlsx' &&
    targetFormatId !== 'xlsx' &&
    sourceMeta?.mapping?.columns &&
    Object.values(sourceMeta.mapping.columns).some((value) => value !== null && value !== undefined && !Array.isArray(value))
  ) {
    warnings.push('Converting away from a spreadsheet loses any columns this tool does not recognise.');
  }

  return warnings;
}
