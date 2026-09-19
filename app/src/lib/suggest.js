/**
 * Suggestions with a confidence figure.
 *
 * Translation memory answers "what did I write for this source before". That is
 * one kind of help, and on a real project it is often not the one that is
 * needed -- the source is new, or the translator is staring at a half-finished
 * sentence wondering whether it reads naturally. This module collects every
 * other proposal the app can honestly make, and attaches a number to each.
 *
 * The confidence figure is the point, so it is derived from evidence rather
 * than assigned by feel. Each kind states what it knows:
 *
 *   memory-exact    the same source, already translated         highest
 *   consistency     the same source, translated elsewhere      high, and it
 *                   drops when those translations disagree with each other
 *   memory-fuzzy    a similar source                           proportional to
 *                                                               the similarity
 *   naturalness     the current text, mechanically repaired    proportional to
 *                                                               what the repair
 *                                                               achieves
 *   diacritics      the current text, accents restored         only when it
 *                                                               actually changes
 *                                                               something
 *
 * A number that does not move with the evidence is decoration, and translators
 * learn to ignore decoration. So a suggestion that is merely "a bit like" what
 * the memory holds cannot score as high as one that is identical, and a repair
 * that leaves the text still unnatural does not score as a cure.
 *
 * Nothing here mutates the project. A suggestion is a proposal; the translator
 * decides.
 */

import { assessNaturalness, applyAllFixes, scoreFromFindings, scoreLabel } from './naturalness.js';
import { lookupMatches, normaliseForMemory } from './tm.js';
import { targetForms } from './entry.js';

/** Confidence caps, per kind. */
const CEILING = {
  'memory-exact': 98,
  consistency: 94,
  'memory-fuzzy': 88,
  naturalness: 90,
  diacritics: 86,
};

const KIND_LABEL = {
  'memory-exact': 'Memory · exact',
  consistency: 'Consistency',
  'memory-fuzzy': 'Memory · similar',
  naturalness: 'Naturalness',
  diacritics: 'Diacritics',
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

/**
 * Text with the Polish accents restored, or null when nothing would change.
 *
 * Wrapped as a suggestion rather than applied, because the diacritics dictionary
 * is deliberately conservative: it covers the words where the ASCII spelling is
 * unambiguously wrong, and a translator should still see what it proposes.
 */
function diacriticVariant(target, source) {
  const before = assessNaturalness(target, { source, language: 'pl' });
  const { text, applied } = applyAllFixes(target, before.findings);

  if (!applied.includes('missing-diacritics') || text === target) return null;

  const after = assessNaturalness(text, { source, language: 'pl' });

  return {
    kind: 'diacritics',
    text,
    confidence: clamp(Math.min(CEILING.diacritics, 40 + (after.score - before.score) * 2.5)),
    rationale: `${before.score} → ${after.score} · ${scoreLabel(after.score).label}`,
  };
}

/**
 * The current text with every mechanical fix applied.
 *
 * Only mechanical fixes are offered. A finding whose replacement needs the
 * sentence rebuilt is a hint, and turning it into a pasteable suggestion would
 * be presenting broken Polish as an answer.
 */
function naturalnessVariant(target, source) {
  const before = assessNaturalness(target, { source, language: 'pl' });
  const { text, applied } = applyAllFixes(target, before.findings);

  const mechanical = applied.filter((code) => code !== 'missing-diacritics');
  if (mechanical.length === 0 || text === target) return null;

  const after = assessNaturalness(text, { source, language: 'pl' });

  return {
    kind: 'naturalness',
    text,
    // A repair is only worth as much as the result. Fixing one mistake out of
    // five leaves a text that is still not natural, and the number says so.
    confidence: clamp(Math.min(CEILING.naturalness, 35 + (after.score - before.score) * 3)),
    rationale: `fixed ${mechanical.length}: ${mechanical.join(', ')} · ${before.score} → ${after.score}`,
  };
}

/**
 * How the project renders this entry's source, and how often.
 *
 * This is what keeps the confidence honest. Three entries translating "Delete
 * file" three different ways are not three equally reliable exact matches -- they
 * are a source that has not been decided yet, and an "exact match" label on all
 * three would tell the translator the opposite of the truth. Counting the
 * renderings turns the disagreement into a number.
 *
 * Only the project is counted, not the memory: the memory is built from the
 * project plus imported segments, so counting both would double every entry
 * while adding no information about what this project actually does.
 */
function agreementFor(entry, entries) {
  const wanted = normaliseForMemory(entry.source);
  const tally = new Map();

  if (!wanted) return { tally, total: 0, of: () => ({ count: 0, total: 0, share: 1 }) };

  for (const other of entries) {
    if (other.id === entry.id) continue;
    if (normaliseForMemory(other.source) !== wanted) continue;

    for (const form of targetForms(other)) {
      const text = form.trim();
      if (!text) continue;
      const key = normaliseForMemory(text);
      const found = tally.get(key);
      if (found) found.count += 1;
      else tally.set(key, { text, count: 1 });
    }
  }

  const total = [...tally.values()].reduce((sum, item) => sum + item.count, 0);

  return {
    tally,
    total,
    /**
     * Agreement for a rendering. A rendering the project does not contain --
     * an imported TMX segment, say -- has no evidence against it, so it is
     * treated as unopposed rather than as a lone dissenter.
     */
    of(text) {
      const found = tally.get(normaliseForMemory(text));
      if (!found || total === 0) return { count: 0, total, share: 1 };
      return { count: found.count, total, share: found.count / total };
    },
  };
}

/**
 * Everything worth proposing for one entry, best first.
 *
 * `options.memory` is a translation memory from `tm.js`; `options.entries` is the
 * whole project, used for the consistency check. The memory lookup happens here
 * rather than being passed in, because a caller that forgets to pass it would
 * get a suggestions panel with no suggestions and no error -- a failure that
 * looks exactly like "nothing to suggest".
 *
 * Duplicate texts are collapsed, keeping the highest confidence, because two
 * suggestions that read identically are one suggestion with a confusing number
 * of buttons.
 */
export function buildSuggestions(entry, options = {}) {
  if (!entry) return [];

  const entries = options.entries ?? [];
  const memory = options.memory ?? null;
  const source = entry.source ?? '';
  const target = entry.target ?? '';
  const language = options.language ?? 'pl';
  const limit = options.limit ?? 8;

  const raw = [];
  const agreement = agreementFor(entry, entries);

  // ---- memory matches, already scored by the matcher
  const matches = options.matches ?? (memory ? lookupMatches(memory, source, { excludeKey: entry.key, limit: 5 }) : []);

  for (const match of matches) {
    const exact = match.kind === 'exact';
    const { count, total, share } = agreement.of(match.target);

    // An exact source match is only worth its ceiling when the project agrees
    // with itself about it. When it does not, the honest label is the
    // disagreement, not the match.
    const contested = exact && share < 1;

    raw.push({
      kind: contested ? 'consistency' : exact ? 'memory-exact' : 'memory-fuzzy',
      text: match.target,
      confidence: exact
        ? clamp(CEILING['memory-exact'] * (0.6 + 0.4 * share))
        : clamp(match.score * CEILING['memory-fuzzy']),
      rationale: exact
        ? contested
          ? `${count} of ${total} entries use this`
          : 'same source, already translated'
        : `${Math.round(match.score * 100)}% similar source`,
      origin: match.key || undefined,
    });
  }

  // ---- renderings the memory did not surface, so no disagreement is hidden
  const seenTexts = new Set(matches.map((match) => normaliseForMemory(match.target)));

  for (const [key, item] of agreement.tally) {
    if (seenTexts.has(key)) continue;
    const share = item.count / agreement.total;

    raw.push({
      kind: 'consistency',
      text: item.text,
      confidence: clamp(CEILING.consistency * (0.55 + 0.45 * share)),
      rationale: `${item.count} of ${agreement.total} entries use this`,
    });
  }

  // ---- mechanical repairs of what is already typed
  if (target.trim()) {
    const repaired = naturalnessVariant(target, source);
    if (repaired) raw.push(repaired);

    const accented = diacriticVariant(target, source);
    if (accented) raw.push(accented);
  }

  // ---- collapse, keep the best, and drop anything identical to what is there
  const byText = new Map();

  for (const suggestion of raw) {
    const text = String(suggestion.text ?? '').trim();
    if (!text) continue;
    if (text === target.trim()) continue;

    const key = normaliseForMemory(text);
    const existing = byText.get(key);

    if (!existing || suggestion.confidence > existing.confidence) {
      byText.set(key, { ...suggestion, text, label: KIND_LABEL[suggestion.kind] ?? suggestion.kind });
    }
  }

  return [...byText.values()]
    .sort((a, b) => b.confidence - a.confidence || a.text.length - b.text.length)
    .slice(0, limit)
    .map((suggestion, index) => ({ ...suggestion, id: `${suggestion.kind}-${index}` }));
}

/**
 * How well the entry's own text holds up, for the Overview tab.
 *
 * Two properties matter here and both are easy to get subtly wrong:
 *
 *   - the score is recomputed from the findings that SURVIVE the dismissals, so
 *     ignoring a correction lifts the number. A score that keeps punishing a
 *     judgement the translator has already made stops being read.
 *   - the headline figure is the worst form, not the average. A plural where
 *     one form is broken is not "mostly fine", it is broken.
 */
export function assessEntry(entry, options = {}) {
  if (!entry) {
    return { score: null, findings: [], hidden: [], label: scoreLabel(null), metrics: null, perForm: [], plural: false };
  }

  const source = entry.source ?? '';
  const language = options.language ?? 'pl';
  const isDismissed = options.isDismissed ?? (() => false);

  const forms = targetForms(entry);
  const plural = forms.length > 1;

  const perForm = forms.map((text, index) => {
    const result = assessNaturalness(text, { source, language });

    const tag = (finding) => ({ ...finding, form: plural ? index : null });
    const findings = result.findings.filter((finding) => !isDismissed(finding.code)).map(tag);
    const hidden = result.findings.filter((finding) => isDismissed(finding.code)).map(tag);

    return {
      ...result,
      findings,
      hidden,
      score: result.score === null ? null : scoreFromFindings(findings),
    };
  });

  const scores = perForm.map((form) => form.score).filter((score) => score !== null);
  const worst = scores.length === 0 ? null : Math.min(...scores);

  return {
    score: worst,
    findings: perForm.flatMap((form) => form.findings),
    hidden: perForm.flatMap((form) => form.hidden),
    label: scoreLabel(worst),
    metrics: perForm[0]?.metrics ?? null,
    perForm,
    plural,
  };
}

export { CEILING as SUGGESTION_CEILING, KIND_LABEL as SUGGESTION_LABEL };
