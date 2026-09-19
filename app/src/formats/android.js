/**
 * Android `strings.xml`.
 *
 * Two things make this format harder than it looks.
 *
 * 1. Escaping is two layers deep. The text is XML (`&amp;`), and on top of that
 *    aapt applies its own backslash escapes, where an apostrophe *must* be
 *    written `\'` or the resource fails to compile. Decoding only the XML layer
 *    produces a file that looks right and does not build.
 *
 * 2. `<plurals>` holds one value per grammatical quantity, and `<string-array>`
 *    holds an ordered list. Flattening either into separate strings loses the
 *    relationship, so both are mapped onto the plural model.
 *
 * Like the XLIFF reader, the original document is kept and only values are
 * rewritten, so `<xliff:g>` markers, `translatable="false"` attributes and
 * comments survive.
 */

import { createEntry, nextId } from '../lib/entry.js';
import {
  attr,
  buildXml,
  childrenOf,
  findChildren,
  isElement,
  isText,
  nodeTag,
  nodesToRichText,
  parseXml,
  richTextToNodes,
  setAttr,
  walk,
} from '../lib/xml.js';

/** aapt's escape sequences, on top of XML escaping. */
const ANDROID_UNESCAPE = { n: '\n', t: '\t', r: '\r', "'": "'", '"': '"', '\\': '\\', '@': '@', '?': '?', u: null };

export function unescapeAndroid(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    const next = value[i + 1];
    if (next === undefined) break;

    if (next === 'u') {
      const hex = value.slice(i + 2, i + 6);
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
    }

    if (Object.prototype.hasOwnProperty.call(ANDROID_UNESCAPE, next) && ANDROID_UNESCAPE[next] !== null) {
      out += ANDROID_UNESCAPE[next];
    } else {
      out += next;
    }
    i += 1;
  }
  return out;
}

/**
 * Re-apply aapt escapes.
 *
 * The apostrophe matters most: `"Don't"` must become `"Don\'t"` or aapt fails
 * the build. Quotes and backslashes are escaped unconditionally; a leading `@`
 * or `?` is escaped because aapt would otherwise read it as a resource
 * reference.
 */
export function escapeAndroid(value) {
  let out = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');

  if (/^[@?]/.test(out)) out = `\\${out}`;
  return out;
}

const QUANTITIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Comments are not element nodes, so they need a manual pass in document order. */
function collectComments(children) {
  const comments = [];
  for (const child of children) {
    const tag = nodeTag(child);
    if (tag !== '#comment') continue;
    const body = (child['#comment'] ?? []).map((part) => (isText(part) ? part['#text'] : '')).join('');
    const cleaned = body.replace(/^\s*\*?\s?/, '').trim();
    if (cleaned) comments.push(cleaned);
  }
  return comments;
}

function valueOf(element) {
  return nodesToRichText(childrenOf(element));
}

export function parseAndroid(input) {
  const text = String(input.text ?? '');
  const tree = parseXml(text);

  const entries = [];
  let resourcesNode = null;

  walk(tree, ({ node, tag }) => {
    if (tag === 'resources') resourcesNode = node;
  });

  if (!resourcesNode) {
    throw new Error('That file has no <resources> element, so it is not an Android string file.');
  }

  const children = childrenOf(resourcesNode);
  let pendingComments = [];
  let counters = new Map();

  const nextKey = (name) => {
    const seen = counters.get(name) ?? 0;
    counters.set(name, seen + 1);
    return seen === 0 ? name : `${name}#${seen + 1}`;
  };

  for (const child of children) {
    const tag = nodeTag(child);

    if (tag === '#comment') {
      pendingComments = collectComments([child]);
      continue;
    }

    if (tag === '#text' || tag === null) continue;

    const name = attr(child, 'name') ?? '';
    const translatable = attr(child, 'translatable');
    const comment = pendingComments.join('\n');
    pendingComments = [];

    if (tag === 'string') {
      const flags = [];
      if (translatable === 'false') flags.push('translatable=false');
      if (attr(child, 'formatted') === 'false') flags.push('formatted=false');

      entries.push(
        createEntry({
          id: nextId(),
          key: nextKey(name),
          source: unescapeAndroid(valueOf(child)),
          comment,
          flags,
          origin: { androidKind: 'string', androidName: name },
        }),
      );
      continue;
    }

    if (tag === 'plurals') {
      const items = findChildren(child, 'item');
      const byQuantity = new Map();
      items.forEach((item) => byQuantity.set(attr(item, 'quantity') ?? 'other', item));

      const ordered = QUANTITIES.filter((quantity) => byQuantity.has(quantity));
      const extra = [...byQuantity.keys()].filter((quantity) => !QUANTITIES.includes(quantity));

      const values = [...ordered, ...extra].map((quantity) => unescapeAndroid(valueOf(byQuantity.get(quantity))));

      entries.push(
        createEntry({
          id: nextId(),
          key: nextKey(name),
          source: values[0] ?? '',
          pluralSource: values[1] ?? values[0] ?? '',
          pluralTargets: values,
          comment,
          origin: { androidKind: 'plurals', androidName: name, quantities: [...ordered, ...extra] },
        }),
      );
      continue;
    }

    if (tag === 'string-array') {
      const items = findChildren(child, 'item');
      items.forEach((item, index) => {
        entries.push(
          createEntry({
            id: nextId(),
            key: nextKey(`${name}[${index}]`),
            source: unescapeAndroid(valueOf(item)),
            comment: index === 0 ? comment : '',
            origin: { androidKind: 'array', androidName: name, arrayIndex: index },
          }),
        );
      });
      continue;
    }
  }

  return {
    entries,
    meta: {
      format: 'android',
      originalXml: text,
      resourceCount: entries.length,
    },
  };
}

/**
 * Single-value format: the translation replaces the value. Untranslated entries
 * keep their source so a partially finished export still builds.
 */
function outputValue(entry) {
  return entry.target.trim() !== '' ? entry.target : entry.source;
}

function applyToElement(element, entry) {
  const tag = nodeTag(element);
  element[tag] = richTextToNodes(escapeAndroid(outputValue(entry)));
}

export function serializeAndroid(entries, meta = {}) {
  const original = String(meta.originalXml ?? '');

  let tree = null;
  try {
    tree = parseXml(original);
  } catch {
    tree = null;
  }

  if (!Array.isArray(tree) || tree.length === 0) {
    // No source document: build a fresh one.
    const children = [];
    for (const entry of entries) {
      children.push({ '#text': '\n    ' });
      if (entry.pluralSource !== null && entry.pluralSource !== undefined) {
        const quantities = entry.origin?.quantities ?? QUANTITIES.slice(0, 2);
        const items = [];
        quantities.forEach((quantity, index) => {
          items.push({ '#text': '\n        ' });
          items.push({ item: richTextToNodes(escapeAndroid(entry.pluralTargets[index] ?? '')), ':@': { '@_quantity': quantity } });
        });
        items.push({ '#text': '\n    ' });
        children.push({ plurals: items, ':@': { '@_name': entry.key } });
      } else {
        children.push({ string: richTextToNodes(escapeAndroid(outputValue(entry))), ':@': { '@_name': entry.key } });
      }
    }
    children.push({ '#text': '\n' });

    const resources = { resources: children };
    const root = [{ '?xml': [{ '#text': '' }], ':@': { '@_version': '1.0', '@_encoding': 'utf-8' } }, resources];
    return { text: `${buildXml(root)}\n`, mime: 'application/xml', extension: 'xml' };
  }

  // Walk in the same order the parser did, so entries line up with elements.
  let resourcesNode = null;
  walk(tree, ({ node, tag }) => {
    if (tag === 'resources') resourcesNode = node;
  });

  if (!resourcesNode) return { text: original, mime: 'application/xml', extension: 'xml' };

  const slots = [];
  for (const child of childrenOf(resourcesNode)) {
    const tag = nodeTag(child);
    if (tag === 'string') {
      slots.push({ kind: 'string', element: child });
    } else if (tag === 'plurals') {
      slots.push({ kind: 'plurals', element: child, items: findChildren(child, 'item') });
    } else if (tag === 'string-array') {
      findChildren(child, 'item').forEach((item, index) => {
        slots.push({ kind: 'array', element: item, arrayIndex: index });
      });
    }
  }

  const remaining = [...entries];

  // Match by name first: reordering entries in the editor must not scramble a
  // file whose element order is fixed by the platform.
  for (const slot of slots) {
    const name = attr(slot.element, 'name') ?? '';
    const index = remaining.findIndex((entry) => entry.origin?.androidName === name
      && (slot.kind !== 'array' || entry.origin?.arrayIndex === slot.arrayIndex));
    if (index === -1) continue;

    const [entry] = remaining.splice(index, 1);

    if (slot.kind === 'string') {
      applyToElement(slot.element, entry);
    } else if (slot.kind === 'plurals') {
      const quantities = entry.origin?.quantities ?? slot.items.map((item) => attr(item, 'quantity') ?? 'other');
      slot.items.forEach((item, itemIndex) => {
        const quantity = attr(item, 'quantity') ?? 'other';
        const position = quantities.indexOf(quantity);
        const value = entry.pluralTargets[position >= 0 ? position : itemIndex] ?? '';
        const tag = nodeTag(item);
        item[tag] = richTextToNodes(escapeAndroid(value));
      });
    } else if (slot.kind === 'array') {
      applyToElement(slot.element, entry);
    }
  }

  return { text: buildXml(tree), mime: 'application/xml', extension: 'xml' };
}

export const androidFormat = {
  id: 'android',
  label: 'Android strings.xml',
  extensions: ['xml'],
  binary: false,
  capabilities: { plurals: true, notes: true, references: false, approved: false },
  parse: parseAndroid,
  serialize: serializeAndroid,
};

export { QUANTITIES };
