/**
 * XML helpers built on fast-xml-parser's ordered mode.
 *
 * Ordered mode matters. The default object mode collapses mixed content --
 * `<source>You have <g id="1">%d</g> HP</source>` becomes a nested object and
 * the inline tag loses its position relative to the text, so re-serialising
 * silently moves markup to the wrong place. Real XLIFF from Crowdin, Phrase or
 * memoQ is full of inline tags, so we need the document shape, not a summary.
 *
 * A node in ordered mode is `{ tagName: [...children], ':@': { '@_attr': v } }`,
 * a text node is `{ '#text': '...' }`, and an empty element has `[]` children.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false, // whitespace between elements is document formatting
  parseTagValue: false, // never turn "123" into a number
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  // Without this, comments are silently discarded. A translator's `<!-- ... -->`
  // note in strings.xml is real content, and losing it on export is data loss.
  commentPropName: '#comment',
};

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  preserveOrder: true,
  format: false, // the original whitespace text nodes already format it
  suppressEmptyNode: false,
  commentPropName: '#comment',
  // Only the three characters XML actually requires in text content. The
  // default set also escapes apostrophes and quotes, which turns a translator's
  // `Don't` into `Don&apos;t` in every Android string. Valid XML, but nothing
  // Android's own tooling produces, and it makes the output unreadable.
  // Attribute values are escaped separately by the builder, so they stay safe.
  entities: [
    { regex: /&/g, val: '&amp;' },
    { regex: /</g, val: '&lt;' },
    { regex: />/g, val: '&gt;' },
  ],
};

const parser = new XMLParser(PARSER_OPTIONS);
const builder = new XMLBuilder(BUILDER_OPTIONS);

/** Non-element node kinds that ordered mode can produce. */
const NON_ELEMENT_KEYS = new Set(['#text', '#comment', '#cdata', '#document', '?xml', '?xml-stylesheet']);

export function parseXml(text) {
  return parser.parse(String(text ?? ''));
}

export function buildXml(tree) {
  return builder.build(tree);
}

/** The tag name of a node, or null for text/comment nodes. */
export function nodeTag(node) {
  if (!node || typeof node !== 'object') return null;
  for (const key of Object.keys(node)) {
    if (key === ':@') continue;
    return key;
  }
  return null;
}

export function isElement(node, tag) {
  const name = nodeTag(node);
  if (name === null || NON_ELEMENT_KEYS.has(name)) return false;
  return tag === undefined || name === tag;
}

export function isText(node) {
  return Boolean(node) && typeof node === 'object' && typeof node['#text'] === 'string';
}

export function textOf(node) {
  return isText(node) ? node['#text'] : '';
}

export function attrsOf(node) {
  return (node && node[':@']) || {};
}

/** Read an attribute without the `@_` prefix leaking into call sites. */
export function attr(node, name) {
  const attrs = attrsOf(node);
  const value = attrs[`@_${name}`];
  return value === undefined ? null : value;
}

export function setAttr(node, name, value) {
  if (!node[':@']) node[':@'] = {};
  node[':@'][`@_${name}`] = String(value);
}

export function childrenOf(node) {
  const tag = nodeTag(node);
  if (tag === null) return [];
  const children = node[tag];
  return Array.isArray(children) ? children : [];
}

/** Direct element children matching a tag, skipping whitespace text nodes. */
export function findChildren(node, tag) {
  return childrenOf(node).filter((child) => isElement(child, tag));
}

/** First direct element child with this tag. */
export function findChild(node, tag) {
  return findChildren(node, tag)[0] ?? null;
}

/**
 * Depth-first search over the whole tree, yielding `{ node, tag, parent, depth }`.
 * Inline element order is preserved, which is what makes round-tripping safe.
 */
export function walk(tree, visit, parent = null, depth = 0) {
  for (const node of tree) {
    const tag = nodeTag(node);
    if (tag === null || NON_ELEMENT_KEYS.has(tag)) continue;
    visit({ node, tag, parent, depth });
    walk(childrenOf(node), visit, node, depth + 1);
  }
}

// ------------------------------------------------------------ XML escaping

export function escapeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeXmlAttr(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

export function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand last, otherwise "&amp;lt;" would become "<".
    .replace(/&amp;/g, '&');
}

// ------------------------------------------------- rich text (inline markup)

/**
 * Inline tags are shown to the translator as literal markup, e.g.
 *
 *   Zostało Ci <g id="1">%d</g> HP
 *
 * This is deliberately the same text the QA panel scans for tags, so a dropped
 * or duplicated tag is reported as a placeholder error rather than discovered
 * by a player. Text nodes are decoded so the editor shows `&` not `&amp;`.
 */
export function nodesToRichText(children) {
  let out = '';

  for (const node of children) {
    if (isText(node)) {
      out += decodeXmlEntities(node['#text']);
      continue;
    }

    const tag = nodeTag(node);
    if (tag === null || NON_ELEMENT_KEYS.has(tag)) continue;

    const attrs = attrsOf(node);
    const rendered = Object.keys(attrs)
      .map((key) => `${key.replace(/^@_/, '')}="${attrs[key]}"`)
      .join(' ');

    const open = rendered ? `<${tag} ${rendered}` : `<${tag}`;
    const inner = nodesToRichText(childrenOf(node));

    if (inner === '' && childrenOf(node).length === 0) {
      out += `${open}/>`;
    } else {
      out += `${open}>${inner}</${tag}>`;
    }
  }

  return out;
}

const TAG_TOKEN = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

function parseAttrString(raw) {
  const attrs = {};
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

/**
 * Turn the rich text back into ordered nodes.
 *
 * Written by hand rather than handed to the XML parser because the editor
 * holds plain text: a translator typing `Tom & Jerry` would produce an
 * unescaped ampersand, which is invalid XML. Tokenising here means the
 * ampersand is escaped on the way out instead of throwing.
 */
export function richTextToNodes(richText) {
  const text = String(richText ?? '');
  const nodes = [];
  const stack = [{ children: nodes, tag: null }];
  let cursor = 0;

  const pushText = (value) => {
    if (value === '') return;
    const top = stack[stack.length - 1];
    top.children.push({ '#text': value });
  };

  TAG_TOKEN.lastIndex = 0;
  let match;
  while ((match = TAG_TOKEN.exec(text)) !== null) {
    const [full, closing, tag, rawAttrs, selfClosing] = match;
    pushText(text.slice(cursor, match.index));
    cursor = match.index + full.length;

    const top = stack[stack.length - 1];

    if (closing === '/') {
      // Unmatched close tag: ignore rather than corrupt the document.
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node = {};
    node[tag] = [];
    if (rawAttrs.trim()) {
      const attrs = parseAttrString(rawAttrs);
      const decorated = {};
      for (const [key, value] of Object.entries(attrs)) decorated[`@_${key}`] = value;
      node[':@'] = decorated;
    }

    top.children.push(node);

    if (!selfClosing) stack.push({ children: node[tag], tag });
  }

  pushText(text.slice(cursor));
  return nodes;
}

/**
 * Serialise ordered nodes back to an XML string. Only used for building
 * fragments that are handed straight back to the parser, so it favours being
 * predictable over being pretty.
 */
export function nodesToXml(children) {
  let out = '';
  for (const node of children) {
    if (isText(node)) {
      out += escapeXmlText(node['#text']);
      continue;
    }
    const tag = nodeTag(node);
    if (tag === null || NON_ELEMENT_KEYS.has(tag)) continue;

    const attrs = attrsOf(node);
    const rendered = Object.keys(attrs)
      .map((key) => `${key.replace(/^@_/, '')}="${escapeXmlAttr(attrs[key])}"`)
      .join(' ');
    const open = rendered ? `<${tag} ${rendered}` : `<${tag}`;
    const inner = childrenOf(node);
    out += inner.length === 0 ? `${open}/>` : `${open}>${nodesToXml(inner)}</${tag}>`;
  }
  return out;
}

/** True when a node has any element children, i.e. carries inline markup. */
export function hasInlineMarkup(node) {
  return childrenOf(node).some((child) => isElement(child));
}

/** Plain text of a node with inline markup flattened away. */
export function plainTextOf(node) {
  return childrenOf(node)
    .map((child) => (isText(child) ? child['#text'] : plainTextOf(child)))
    .join('');
}
