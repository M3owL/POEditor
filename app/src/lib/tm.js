/**
 * Translation memory.
 *
 * Two jobs: show the translator how this string was translated before, and let
 * them reuse it in one click. Both matter more than they sound -- inconsistent
 * terminology across a game is the single most visible localisation defect.
 *
 * Matching is exact first, then prefix, then fuzzy. Fuzzy uses the Dice
 * coefficient over character bigrams rather than word overlap, because game
 * strings are short and inflected: "Rozpocznij grę" and "Rozpocznij gre"
 * share almost no whole words but are obviously the same sentence.
 */

const DEFAULT_MIN_SCORE = 0.45;
const DEFAULT_LIMIT = 5;

/** Fold case, whitespace and trailing punctuation so trivial edits still match. */
export function normaliseForMemory(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, ' ')
    .replace(/[.!?…]+$/g, '')
    .trim();
}

function tokenise(text) {
  return normaliseForMemory(text).split(' ').filter(Boolean);
}

/** Character bigrams, padded so short strings still compare meaningfully. */
function bigrams(text) {
  const value = normaliseForMemory(text);
  const padded = ` ${value} `;
  const out = new Map();
  for (let i = 0; i < padded.length - 1; i += 1) {
    const gram = padded.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

/** Sørensen-Dice coefficient over character bigrams, 0..1. */
export function diceSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  let leftTotal = 0;
  let rightTotal = 0;

  for (const count of left.values()) leftTotal += count;
  for (const count of right.values()) rightTotal += count;

  for (const [gram, count] of left) {
    const other = right.get(gram);
    if (other) overlap += Math.min(count, other);
  }

  return (2 * overlap) / (leftTotal + rightTotal);
}

/**
 * Build a searchable memory from entries.
 *
 * Indexed by token so a lookup only scores candidates that share a word. With
 * a few thousand entries a full scan per keystroke is noticeable; this keeps it
 * proportional to the number of plausible matches instead.
 */
export function buildMemory(entries = []) {
  const records = [];
  const byToken = new Map();

  const add = (source, target, key = '') => {
    if (!String(source).trim() || !String(target).trim()) return;
    const normalised = normaliseForMemory(source);
    if (normalised === '') return;

    const record = { source, target, key, normalised };
    const index = records.push(record) - 1;

    for (const token of new Set(tokenise(source))) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(index);
    }
  };

  for (const entry of entries) {
    if (entry.pluralTargets?.length) {
      // Plurals are stored per form so a singular source can still match.
      add(entry.source, entry.target, entry.key);
      if (entry.pluralSource) add(entry.pluralSource, entry.pluralTargets[1] ?? entry.pluralTargets[0], entry.key);
    } else {
      add(entry.source, entry.target, entry.key);
    }
  }

  return { records, byToken };
}

/** Add one entry's translation to an existing memory, in place. */
export function rememberEntry(memory, entry) {
  if (!entry.source?.trim() || !entry.target?.trim()) return memory;

  const normalised = normaliseForMemory(entry.source);
  const existing = memory.records.find((record) => record.normalised === normalised);

  if (existing) {
    existing.target = entry.target;
    return memory;
  }

  const record = { source: entry.source, target: entry.target, key: entry.key, normalised };
  const index = memory.records.push(record) - 1;

  for (const token of new Set(tokenise(entry.source))) {
    if (!memory.byToken.has(token)) memory.byToken.set(token, []);
    memory.byToken.get(token).push(index);
  }

  return memory;
}

/**
 * Best matches for a source string.
 *
 * Returns `{ source, target, key, score, kind }` sorted by score, best first.
 * `kind` tells the UI whether to label it as an exact or a fuzzy match, which
 * changes whether a translator trusts it without reading.
 */
export function lookupMatches(memory, text, options = {}) {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const excludeKey = options.excludeKey ?? null;

  const query = String(text ?? '');
  if (!memory || !query.trim()) return [];

  const normalised = normaliseForMemory(query);
  if (normalised === '') return [];

  // Candidates: anything sharing a token, plus a bounded scan so a string with
  // entirely new wording can still surface a near-miss.
  const candidateIndexes = new Set();
  for (const token of new Set(tokenise(query))) {
    const bucket = memory.byToken.get(token);
    if (bucket) for (const index of bucket) candidateIndexes.add(index);
  }

  if (candidateIndexes.size < limit) {
    const cap = Math.min(memory.records.length, 2000);
    for (let i = 0; i < cap; i += 1) candidateIndexes.add(i);
  }

  const scored = [];

  for (const index of candidateIndexes) {
    const record = memory.records[index];
    if (!record) continue;
    if (excludeKey && record.key && record.key === excludeKey) continue;

    let score;
    let kind;

    if (record.normalised === normalised) {
      score = 1;
      kind = 'exact';
    } else if (
      record.normalised.startsWith(normalised) ||
      normalised.startsWith(record.normalised)
    ) {
      score = 0.92;
      kind = 'prefix';
    } else {
      score = diceSimilarity(query, record.source);
      kind = 'fuzzy';
    }

    if (score >= minScore) scored.push({ ...record, score, kind });
  }

  scored.sort((a, b) => b.score - a.score || a.source.length - b.source.length);

  // Collapse duplicates: the same source can appear in several entries.
  const seen = new Set();
  const out = [];
  for (const match of scored) {
    const signature = `${match.normalised}\u0000${match.target}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(match);
    if (out.length >= limit) break;
  }

  return out;
}

/** Import a TMX or similar file as additional memory entries. */
export function mergeEntries(memory, entries) {
  for (const entry of entries) rememberEntry(memory, entry);
  return memory;
}

export { DEFAULT_MIN_SCORE, DEFAULT_LIMIT };
