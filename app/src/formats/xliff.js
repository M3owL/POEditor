/**
 * XLIFF 1.2 and 2.0.
 *
 * Strategy: keep the original document and change only `<target>` content.
 *
 * Most XLIFF tooling round-trips badly because it rebuilds the file from its
 * own model, which drops everything the model does not know about: `alt-trans`
 * history, `context-group` entries, `state` and `approved` attributes, group
 * nesting, custom namespaces, the original whitespace. A vendor reviewing a
 * delivery notices immediately.
 *
 * So the parser stores the source document verbatim in `meta.originalXml`, and
 * serialising re-parses it and mutates the target nodes in document order.
 * Everything else is preserved by construction. New entries that were not in
 * the original are appended as fresh units.
 *
 * Inline markup (`<g>`, `<x/>`, `<ph>`, `<pc>`) is surfaced to the translator as
 * literal markup inside the string, which is also what the QA panel scans for,
 * so a dropped tag is reported rather than shipped.
 */

import { createEntry, nextId, sourceForms, targetForms } from '../lib/entry.js';
import { inputText } from '../lib/files.js';
import {
  attr,
  buildXml,
  childrenOf,
  findChild,
  findChildren,
  isElement,
  nodeTag,
  nodesToRichText,
  parseXml,
  richTextToNodes,
  setAttr,
  walk,
} from '../lib/xml.js';

// ------------------------------------------------------------- collections

/**
 * Every unit in document order, with the node that holds its translation.
 *
 * XLIFF 2.0 nests source/target inside `<segment>`, 1.2 keeps them directly on
 * `<trans-unit>`, so the target's parent differs between versions and both are
 * recorded here rather than guessed at serialisation time.
 *
 * `group` and `container` are tracked because gettext plurals are expressed as
 * sibling trans-units inside one `<group>`, and merging them requires knowing
 * which group a unit belongs to.
 */
function collectUnits(tree, version) {
  const unitTag = version.startsWith('2') ? 'unit' : 'trans-unit';
  const found = [];

  const descend = (nodes, container, group) => {
    for (const node of nodes) {
      const tag = nodeTag(node);
      if (tag === null || tag === '#text' || tag === '#comment' || tag === '#cdata') continue;

      const nextGroup = tag === 'group' ? node : group;

      if (tag === unitTag) {
        if (version.startsWith('2')) {
          const segments = findChildren(node, 'segment');
          const holders = segments.length ? segments : [node];
          holders.forEach((holder, index) => {
            found.push({
              unit: node,
              parent: holder,
              container: container ?? node,
              group: nextGroup,
              source: findChild(holder, 'source') ?? findChild(node, 'source'),
              target: findChild(holder, 'target'),
              segment: holder,
              segmentIndex: index,
              segmentCount: holders.length,
            });
          });
        } else {
          found.push({
            unit: node,
            parent: node,
            container: container ?? node,
            group: nextGroup,
            source: findChild(node, 'source'),
            target: findChild(node, 'target'),
            segment: node,
            segmentIndex: 0,
            segmentCount: 1,
          });
        }
        // A unit is a leaf for our purposes; its children are source/target.
        continue;
      }

      descend(childrenOf(node), node, nextGroup);
    }
  };

  descend(tree, null, null);
  return found;
}

/**
 * gettext plurals in XLIFF 1.2 are a group of trans-units, one per plural form,
 * tagged `restype="x-gettext-plurals"` with a context marking the form index.
 * Reading them as separate strings loses the relationship, so they are merged
 * back into a single plural entry.
 */
function pluralFormIndexOf(node) {
  for (const contextGroup of findChildren(node, 'context-group')) {
    for (const context of findChildren(contextGroup, 'context')) {
      const type = attr(context, 'context-type');
      if (type !== 'x-plural-form' && type !== 'x-plural') continue;
      const value = Number(nodesToRichText(childrenOf(context)).trim());
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function groupPluralUnits(units) {
  const groups = new Map();

  units.forEach((record, index) => {
    const form = pluralFormIndexOf(record.unit);
    if (form === null) return;
    // Grouping by the trans-unit itself would give every unit a group of one
    // and never merge anything. The enclosing <group> is what they share.
    const key = record.group ?? record.container;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...record, form, index });
  });

  const merged = new Set();
  for (const records of groups.values()) {
    if (records.length < 2) continue;
    for (const record of records) merged.add(record.index);
  }

  return { merged, groups };
}

// ---------------------------------------------------------------- parsing

function noteText(unit) {
  const notes = [];

  // XLIFF 1.2 puts <note> directly on the unit; 2.0 wraps them in <notes>.
  const collect = (parent) => {
    for (const note of findChildren(parent, 'note')) {
      const value = nodesToRichText(childrenOf(note)).trim();
      if (value) notes.push(value);
    }
  };

  collect(unit);
  for (const notesNode of findChildren(unit, 'notes')) collect(notesNode);

  return notes.join('\n');
}

function referenceList(unit) {
  const refs = [];
  for (const group of findChildren(unit, 'context-group')) {
    const type = attr(group, 'purpose') || attr(group, 'context-type');
    for (const context of findChildren(group, 'context')) {
      const value = nodesToRichText(childrenOf(context)).trim();
      if (!value) continue;
      refs.push(type && type !== 'location' ? `${value} (${type})` : value);
    }
  }
  return refs;
}

function flagList(unit, target) {
  const flags = [];
  if (attr(unit, 'translate') === 'no') flags.push('translate=no');
  if (attr(unit, 'xml:space') === 'preserve' || attr(target, 'xml:space') === 'preserve') {
    flags.push('xml:space=preserve');
  }
  const state = attr(target, 'state') || attr(unit, 'state');
  if (state) flags.push(`state=${state}`);
  if (attr(unit, 'approved') === 'yes') flags.push('approved');
  return flags;
}

export function parseXliff(input) {
  // Normalised once here so the rest of the body -- which also keeps a verbatim
  // copy of the document for lossless round trips -- can use it directly.
  const text = inputText(input);
  const tree = parseXml(text);

  let version = '1.2';
  let sourceLanguage = '';
  let targetLanguage = '';
  let declared = false;

  walk(tree, ({ node, tag }) => {
    if (declared) return;
    if (tag === 'xliff') {
      version = attr(node, 'version') || '1.2';
      sourceLanguage = attr(node, 'srcLang') || attr(node, 'source-language') || '';
      targetLanguage = attr(node, 'trgLang') || attr(node, 'target-language') || '';
      declared = true;
    }
  });

  // 1.2 keeps the language pair on <file>, not on <xliff>.
  if (!sourceLanguage || !targetLanguage) {
    walk(tree, ({ node, tag }) => {
      if (tag !== 'file') return;
      sourceLanguage = sourceLanguage || attr(node, 'source-language') || '';
      targetLanguage = targetLanguage || attr(node, 'target-language') || '';
    });
  }

  const units = collectUnits(tree, version);
  const { merged, groups } = groupPluralUnits(units);

  const entries = [];
  const consumed = new Set();

  units.forEach((record, index) => {
    if (consumed.has(index)) return;

    const sourceText = record.source ? nodesToRichText(childrenOf(record.source)) : '';
    const targetText = record.target ? nodesToRichText(childrenOf(record.target)) : '';

    const unitId = attr(record.unit, 'id') ?? '';
    const resname = attr(record.unit, 'resname') ?? '';
    const segmentId = version.startsWith('2') && record.segmentCount > 1
      ? attr(record.segment, 'id')
      : null;

    // The key is `resname` in 1.2. The unit `id` is deliberately NOT a fallback
    // there: XLIFF 1.2 requires an id on every unit, so it is frequently a
    // synthetic counter, and promoting that to a key is actively harmful.
    // Exporting such an entry back to PO would emit `msgctxt "n1"`, and gettext
    // keys its lookup on msgid+msgctxt -- so the translation would silently
    // stop matching the string in the program. The unit id is kept in `origin`
    // instead, where it is still available for display.
    //
    // XLIFF 2.0 is the exception: it dropped `resname` entirely, so the unit id
    // is the only name a unit has and is genuinely the key.
    let key = resname || (version.startsWith('2') ? unitId : '');
    if (segmentId) key = key ? `${key}#${segmentId}` : '';

    // A merged plural group: gather every form into one entry.
    if (merged.has(index)) {
      const siblings = [...groups.entries()]
        .find(([, records]) => records.some((r) => r.index === index))[1]
        .sort((a, b) => a.form - b.form);

      for (const sibling of siblings) consumed.add(sibling.index);

      const singular = siblings.find((s) => s.form === 0) ?? siblings[0];
      const pluralNode = siblings.find((s) => s.form === 1);
      const formCount = Math.max(...siblings.map((s) => s.form)) + 1;

      entries.push(
        createEntry({
          id: nextId(),
          key,
          source: singular.source ? nodesToRichText(childrenOf(singular.source)) : '',
          target: singular.target ? nodesToRichText(childrenOf(singular.target)) : '',
          pluralSource: pluralNode?.source
            ? nodesToRichText(childrenOf(pluralNode.source))
            : '',
          pluralTargets: Array.from({ length: formCount }, (_, form) => {
            const match = siblings.find((s) => s.form === form);
            return match?.target ? nodesToRichText(childrenOf(match.target)) : '';
          }),
          comment: noteText(singular.unit),
          references: referenceList(singular.unit),
          flags: flagList(singular.unit, singular.target),
          approved: attr(singular.unit, 'approved') === 'yes',
          origin: { xliffPluralGroup: true, pluralForms: siblings.map((s) => s.form) },
        }),
      );
      return;
    }

    // XLIFF 1.2 lets several trans-units share one id, disambiguated by a
    // context of type "x-...". Keep the key unique so the list does not collide.
    // An entry with no key has nothing to collide on, so it is left empty
    // rather than given a meaningless "#2" suffix.
    let uniqueKey = key;
    if (key && entries.some((entry) => entry.key === uniqueKey)) {
      let suffix = 2;
      while (entries.some((entry) => entry.key === `${key}#${suffix}`)) suffix += 1;
      uniqueKey = `${key}#${suffix}`;
    }

    entries.push(
      createEntry({
        id: nextId(),
        key: uniqueKey,
        source: sourceText,
        target: targetText,
        comment: noteText(record.unit),
        references: referenceList(record.unit),
        flags: flagList(record.unit, record.target),
        approved: attr(record.unit, 'approved') === 'yes',
        origin: { xliffIndex: index, unitId },
      }),
    );
  });

  return {
    entries,
    meta: {
      format: 'xliff',
      version,
      sourceLanguage,
      targetLanguage,
      originalXml: String(text ?? ''),
      unitCount: units.length,
      pluralGroups: groups.size,
    },
  };
}

// ------------------------------------------------------------ serialising

/**
 * Write state attributes only when the document already used them.
 *
 * Adding `state="translated"` to a file that never had states produces a diff
 * a reviewer will query. Leaving existing states stale is worse. This is the
 * middle ground: reflect reality where the vocabulary already exists.
 */
function syncState(node, value) {
  if (!node) return;
  if (attr(node, 'state') !== null) setAttr(node, 'state', value);
}

function applyTarget(record, entry, version) {
  const nodes = richTextToNodes(entry.target);
  const holder = record.parent;
  const holderTag = nodeTag(holder);

  if (record.target) {
    record.target[nodeTag(record.target)] = nodes;
  } else {
    const created = { target: nodes };
    // <source> precedes <target>, so insert directly after it when we can.
    const siblings = childrenOf(holder);
    const sourceIndex = siblings.indexOf(record.source);
    if (sourceIndex >= 0) siblings.splice(sourceIndex + 1, 0, created);
    else siblings.push(created);
  }

  const targetNode =
    record.target ?? childrenOf(holder).find((child) => isElement(child, 'target')) ?? null;

  if (entry.approved) {
    setAttr(record.unit, 'approved', 'yes');
    syncState(targetNode, 'final');
  } else {
    if (attr(record.unit, 'approved') === 'yes') setAttr(record.unit, 'approved', 'no');
    syncState(targetNode, entry.target.trim() === '' ? 'needs-translation' : 'translated');
  }
}

/**
 * A brand-new unit, for entries the original document did not contain.
 *
 * This is the path taken whenever the project came from a different format --
 * an Android file, a spreadsheet, a JSON bundle -- so everything the entry
 * carries has to be written here or it is lost on conversion. Two things were
 * being dropped: the translator comment (which is the only context a
 * translator gets) and the plural forms (which silently collapsed a
 * three-form Polish string into its singular).
 */
function buildNewUnit(entry, version, index) {
  const id = entry.key || `n${index + 1}`;

  // `resname` is optional in XLIFF, and writing the synthetic id into it is not
  // harmless: re-importing that file would read `n1` back as the entry's key,
  // and a later PO export would then invent a `msgctxt "n1"` that was never in
  // the source. Only emit it when there is a real key behind it.
  const attributes = { '@_id': id };
  if (entry.key) attributes['@_resname'] = entry.key;

  const notes = noteNodes(entry, version);
  const forms = sourceForms(entry);
  const targets = targetForms(entry);

  // The number of units is driven by the TARGET form count, not the source one.
  // Polish needs three forms but has only two source strings (singular and
  // plural), so counting sources dropped msgstr[2] entirely -- the most common
  // way to lose a plural form.
  const formCount = Math.max(forms.length, targets.length);

  if (formCount > 1) {
    // gettext plurals: one unit per form inside a group the reader merges back
    // into a single plural entry. The form index lives in a context, which is
    // what ties them together.
    const units = Array.from({ length: formCount }, (_, formIndex) =>
      buildUnitNode(
        {
          id: `${id}[${formIndex}]`,
          resname: entry.key || null,
          // Forms past the first reuse the plural source, which is how gettext
          // represents "N files" for every count that is not one.
          source: forms[formIndex] ?? forms[forms.length - 1] ?? entry.source,
          target: targets[formIndex] ?? '',
          notes,
          pluralForm: formIndex,
        },
        version,
      ),
    );

    return {
      group: [
        { '#text': '\n      ' },
        ...units.flatMap((unit, unitIndex) => (unitIndex === 0 ? [unit] : [{ '#text': '\n      ' }, unit])),
        { '#text': '\n    ' },
      ],
      ':@': { '@_restype': 'x-gettext-plurals', '@_id': `${id}-group` },
    };
  }

  return buildUnitNode(
    { id, resname: entry.key || null, source: entry.source, target: entry.target, notes, pluralForm: null },
    version,
  );
}

/** `<note>` nodes for an entry's comment, in the shape the reader expects. */
function noteNodes(entry, version) {
  if (!entry.comment) return [];

  const lines = String(entry.comment)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const nodes = lines.map((line) => ({ note: [{ '#text': line }] }));

  // 1.2 puts <note> straight on the unit; 2.0 wraps them in <notes>.
  if (version.startsWith('2')) return [{ notes: nodes }];
  return nodes;
}

/** One trans-unit / unit node, in whichever XLIFF version is being written. */
function buildUnitNode({ id, resname, source, target, notes, pluralForm }, version) {
  const attributes = { '@_id': id };
  if (resname) attributes['@_resname'] = resname;

  // The form index is how the reader knows these units belong together.
  const context =
    pluralForm === null
      ? []
      : [
          {
            'context-group': [
              {
                context: [
                  { '#text': String(pluralForm) },
                ],
                ':@': { '@_context-type': 'x-plural-form' },
              },
            ],
          },
        ];

  if (version.startsWith('2')) {
    return {
      unit: [
        { '#text': '\n      ' },
        {
          segment: [
            { '#text': '\n        ' },
            { source: richTextToNodes(source) },
            { '#text': '\n        ' },
            { target: richTextToNodes(target) },
            { '#text': '\n      ' },
          ],
        },
        ...notes.flatMap((node) => [{ '#text': '\n        ' }, node]),
        ...context.flatMap((node) => [{ '#text': '\n        ' }, node]),
        { '#text': '\n    ' },
      ],
      ':@': attributes,
    };
  }

  return {
    'trans-unit': [
      { '#text': '\n        ' },
      { source: richTextToNodes(source) },
      { '#text': '\n        ' },
      { target: richTextToNodes(target) },
      ...notes.flatMap((node) => [{ '#text': '\n        ' }, node]),
      ...context.flatMap((node) => [{ '#text': '\n        ' }, node]),
      { '#text': '\n      ' },
    ],
    ':@': attributes,
  };
}

/** Find the node new units should be appended to. */
function appendContainer(tree, version) {
  let container = null;
  walk(tree, ({ node, tag }) => {
    if (container) return;
    if (version.startsWith('2') && tag === 'file') container = node;
    if (!version.startsWith('2') && tag === 'body') container = node;
  });
  return container;
}

export function serializeXliff(entries, meta = {}) {
  const version = meta.version || '1.2';
  const unitTag = version.startsWith('2') ? 'unit' : 'trans-unit';

  let tree;
  try {
    tree = parseXml(meta.originalXml ?? '');
  } catch {
    tree = null;
  }

  const hasDocument = Array.isArray(tree) && tree.length > 0;

  if (!hasDocument) {
    // No source document to preserve (e.g. importing from another format).
    const container = entries.map((entry, index) => buildNewUnit(entry, version, index));
    const body = { body: [{ '#text': '\n    ' }, ...container, { '#text': '\n  ' }] };
    const file = {
      file: [{ '#text': '\n  ' }, body, { '#text': '\n' }],
      ':@': {
        '@_source-language': meta.sourceLanguage || 'en',
        '@_target-language': meta.targetLanguage || '',
        '@_datatype': 'plaintext',
        '@_original': 'export',
      },
    };
    const root = {
      xliff: [{ '#text': '\n' }, file, { '#text': '\n' }],
      ':@': { '@_version': version, '@_xmlns': 'urn:oasis:names:tc:xliff:document:1.2' },
    };
    return `${buildXml([root])}\n`;
  }

  const records = collectUnits(tree, version);

  entries.forEach((entry, index) => {
    const record = records[index];
    if (!record) return;
    applyTarget(record, entry, version);
  });

  // Entries beyond the original document's units are appended.
  if (entries.length > records.length) {
    const container = appendContainer(tree, version);
    const list = container ? container[nodeTag(container)] : null;
    if (Array.isArray(list)) {
      for (let i = records.length; i < entries.length; i += 1) {
        list.push(buildNewUnit(entries[i], version, i));
      }
    }
  }

  return buildXml(tree);
}

export const xliffFormat = {
  id: 'xliff',
  label: 'XLIFF',
  extensions: ['xlf', 'xliff', 'sdlxliff'],
  binary: false,
  capabilities: { plurals: true, notes: true, references: true, approved: true },
  parse: parseXliff,
  // Wrapped so the registry always receives { text, mime, extension }; the
  // serializer itself returns a bare string, which is what a human wants when
  // calling it directly.
  serialize: (entries, meta) => ({
    text: serializeXliff(entries, meta),
    mime: 'application/xliff+xml',
    extension: 'xlf',
  }),
};
