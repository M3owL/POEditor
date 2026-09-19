/**
 * TMX (Translation Memory eXchange) 1.4.
 *
 * A TMX file is a memory, not a project: each `<tu>` holds the same segment in
 * several languages, one `<tuv>` per language. To turn it into a project the
 * source and target languages have to be picked out of that set, which is why
 * this parser takes the language pair rather than guessing.
 *
 * Same document-preserving approach as XLIFF: the original tree is kept and
 * only the target `<tuv>` is written, so `creationdate`, `tuid`, `<prop>`
 * metadata and any extra languages stay exactly as they were.
 */

import { createEntry, nextId } from '../lib/entry.js';
import {
  attr,
  buildXml,
  childrenOf,
  findChild,
  findChildren,
  nodeTag,
  nodesToRichText,
  parseXml,
  richTextToNodes,
  walk,
} from '../lib/xml.js';

/** `xml:lang` survives parsing as `@_xml:lang`. */
function langOf(tuv) {
  return attr(tuv, 'xml:lang') || attr(tuv, 'lang') || '';
}

function sameLanguage(a, b) {
  if (!a || !b) return false;
  const normalise = (value) => String(value).toLowerCase().replace(/_/g, '-');
  const left = normalise(a);
  const right = normalise(b);
  // `en` should match `en-US` in both directions.
  return left === right || left.startsWith(`${right}-`) || right.startsWith(`${left}-`);
}

function segText(tuv) {
  const seg = findChild(tuv, 'seg');
  if (!seg) return '';
  return nodesToRichText(childrenOf(seg));
}

function propertiesOf(tu) {
  const props = [];
  for (const prop of findChildren(tu, 'prop')) {
    const type = attr(prop, 'type') ?? '';
    const value = nodesToRichText(childrenOf(prop)).trim();
    if (value) props.push(type ? `${type}: ${value}` : value);
  }
  return props;
}

export function parseTmx(input, options = {}) {
  const text = String(input.text ?? '');
  const tree = parseXml(text);

  let header = null;
  walk(tree, ({ node, tag }) => {
    if (tag === 'header' && !header) header = node;
  });

  const sourceLanguage = options.sourceLanguage || attr(header, 'srclang') || 'en';
  const targetLanguage = options.targetLanguage || '';

  const entries = [];
  const languagesSeen = new Set();
  let missingSource = 0;
  let missingTarget = 0;

  walk(tree, ({ node, tag }) => {
    if (tag !== 'tu') return;

    const tuvs = findChildren(node, 'tuv');
    const sourceTuv = tuvs.find((tuv) => sameLanguage(langOf(tuv), sourceLanguage));
    const targetTuv = targetLanguage
      ? tuvs.find((tuv) => sameLanguage(langOf(tuv), targetLanguage))
      : null;

    tuvs.forEach((tuv) => {
      const language = langOf(tuv);
      if (language) languagesSeen.add(language);
    });

    if (!sourceTuv) {
      missingSource += 1;
      return;
    }

    if (!targetTuv) missingTarget += 1;

    const tuid = attr(node, 'tuid') || attr(node, 'id') || '';

    entries.push(
      createEntry({
        id: nextId(),
        key: tuid || `tu${entries.length + 1}`,
        source: segText(sourceTuv),
        target: targetTuv ? segText(targetTuv) : '',
        comment: propertiesOf(node).join('\n'),
        origin: {
          tmxTuid: tuid,
          // Recorded so a translation that has to be created lands in the right
          // place rather than being appended blindly.
          targetLanguage,
          hadTarget: Boolean(targetTuv),
        },
      }),
    );
  });

  return {
    entries,
    meta: {
      format: 'tmx',
      version: attr(header, 'version') || '1.4',
      sourceLanguage,
      targetLanguage,
      languages: [...languagesSeen],
      originalXml: text,
      missingSource,
      missingTarget,
    },
  };
}

export function serializeTmx(entries, meta = {}, options = {}) {
  const sourceLanguage = options.sourceLanguage ?? meta.sourceLanguage ?? 'en';
  const targetLanguage = options.targetLanguage ?? meta.targetLanguage ?? '';

  const original = String(meta.originalXml ?? '');
  let tree = null;
  try {
    tree = parseXml(original);
  } catch {
    tree = null;
  }

  const hasDocument = Array.isArray(tree) && tree.length > 0;

  if (hasDocument) {
    const units = [];
    walk(tree, ({ node, tag }) => {
      if (tag === 'tu') units.push(node);
    });

    const remaining = [...entries];

    units.forEach((node) => {
      const tuid = attr(node, 'tuid') || attr(node, 'id') || '';
      const index = remaining.findIndex((entry) => entry.origin?.tmxTuid && entry.origin.tmxTuid === tuid);
      if (index === -1) return;

      const [entry] = remaining.splice(index, 1);
      const tuvs = findChildren(node, 'tuv');

      let targetTuv = tuvs.find((tuv) => sameLanguage(langOf(tuv), targetLanguage));

      if (!targetTuv && targetLanguage) {
        // Create the missing <tuv> next to the others.
        const created = {
          tuv: [{ '#text': '\n        ' }, { seg: richTextToNodes(entry.target) }, { '#text': '\n      ' }],
          ':@': { '@_xml:lang': targetLanguage },
        };
        const body = node.tu;
        if (Array.isArray(body)) body.push(created);
        targetTuv = created;
      }

      if (!targetTuv) return;
      const seg = findChild(targetTuv, 'seg');
      if (seg) {
        const tag = nodeTag(seg);
        seg[tag] = richTextToNodes(entry.target);
      }
    });

    return { text: buildXml(tree), mime: 'application/xml', extension: 'tmx' };
  }

  // No source document: build a minimal but valid TMX.
  const units = entries.map((entry) => ({
    tu: [
      { '#text': '\n      ' },
      {
        tuv: [{ '#text': '\n        ' }, { seg: richTextToNodes(entry.source) }, { '#text': '\n      ' }],
        ':@': { '@_xml:lang': sourceLanguage },
      },
      { '#text': '\n      ' },
      {
        tuv: [{ '#text': '\n        ' }, { seg: richTextToNodes(entry.target) }, { '#text': '\n      ' }],
        ':@': { '@_xml:lang': targetLanguage },
      },
      { '#text': '\n    ' },
    ],
    ':@': { '@_tuid': entry.key },
  }));

  const body = { body: [{ '#text': '\n    ' }, ...units, { '#text': '\n  ' }] };
  const header = {
    header: [],
    ':@': {
      '@_creationtool': 'M3owL',
      '@_creationtoolversion': '2.0',
      '@_datatype': 'plaintext',
      '@_segtype': 'sentence',
      '@_adminlang': sourceLanguage,
      '@_srclang': sourceLanguage,
      '@_o-tmf': 'M3owL',
    },
  };

  const root = [{ '?xml': [{ '#text': '' }], ':@': { '@_version': '1.0' } }, {
    tmx: [{ '#text': '\n  ' }, header, { '#text': '\n  ' }, body, { '#text': '\n' }],
    ':@': { '@_version': '1.4' },
  }];

  return { text: `${buildXml(root)}\n`, mime: 'application/xml', extension: 'tmx' };
}

export const tmxFormat = {
  id: 'tmx',
  label: 'TMX translation memory',
  extensions: ['tmx'],
  binary: false,
  capabilities: { plurals: false, notes: true, references: false, approved: false },
  parse: parseTmx,
  serialize: serializeTmx,
};
