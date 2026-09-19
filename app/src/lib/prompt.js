/**
 * Copy for an external model.
 *
 * The workflow this exists for: a string is hard, and the fastest way through it
 * is to paste the source into a chat model and ask for a natural Polish version.
 * Doing that by hand means selecting the text, opening the model, typing the
 * same instruction for the hundredth time, and pasting -- which is slow enough
 * that people stop doing it and start writing calques instead.
 *
 * So one button puts the instruction and the text on the clipboard together,
 * ready to paste. Three decisions worth stating:
 *
 *   - The prompt is a template, not a hard-coded string. "przetłumacz to na
 *     naturalny polski" is the right default for one translator and the wrong
 *     one for a studio with its own style guide, and the difference is a
 *     setting, not a fork.
 *   - The text is formatted before it goes in. A source string copied out of a
 *     PO file routinely carries a non-breaking space, a stray double space, or
 *     the newline that was in the source file; a model given those tends to
 *     reproduce them in the answer, and then the translator pastes the mess
 *     back into the project.
 *   - The instruction goes first and the text last, on its own line. A model
 *     reading "…polski: <text>" gets the boundary right; a model reading the
 *     text first tends to treat the instruction as part of it.
 */

/** `{text}` is replaced with the formatted source. Everything else is literal. */
export const DEFAULT_PROMPT_TEMPLATE = 'przetłumacz to na naturalny polski:\n{text}';

/** Shown in the UI next to the template field. */
export const PROMPT_PLACEHOLDER = '{text}';

/**
 * Normalise a string for pasting into a model.
 *
 * Deliberately conservative: it fixes the artefacts of copying text out of a
 * translation file and changes nothing that could be meaningful. Placeholders
 * such as `%1$s` or `{name}` are left exactly as they are, because those must
 * survive into the answer.
 */
export function formatForPrompt(text) {
  return String(text ?? '')
    // Non-breaking and other exotic spaces read as ordinary spaces in the file
    // but confuse a model about word boundaries.
    .replace(/[\u00a0\u2007\u202f\u2009\u200a]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Wrap text in the prompt template.
 *
 * When the template has no `{text}` placeholder the text is appended on a new
 * line, because silently dropping it would be the worst possible failure for a
 * button whose entire job is to put the text on the clipboard.
 */
export function buildPrompt(text, options = {}) {
  const template = options.template ?? DEFAULT_PROMPT_TEMPLATE;
  const body = formatForPrompt(text);

  const filled = template.includes(PROMPT_PLACEHOLDER)
    ? template.replaceAll(PROMPT_PLACEHOLDER, body)
    : `${template.replace(/\s+$/, '')}\n${body}`;

  const context = [];

  if (options.key) context.push(`key: ${options.key}`);
  if (options.comment) context.push(`context: ${formatForPrompt(options.comment)}`);
  if (options.note) context.push(options.note);

  return context.length ? `${filled}\n\n(${context.join(' · ')})` : filled;
}

/**
 * Put text on the clipboard.
 *
 * Two paths, because the modern one is not always available: `navigator.clipboard`
 * requires a secure context, so it is missing over plain HTTP on a LAN address.
 * The fallback is the old selection trick, which still works everywhere. Returns
 * a boolean rather than throwing -- a failed copy must not take the editor down,
 * and the caller has a toast to show either way.
 */
export async function copyToClipboard(text) {
  const value = String(text ?? '');

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or not focused; fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build the prompt for a whole batch, for "copy everything still untranslated".
 *
 * Numbered so the model's answers can be matched back to the entries by eye.
 * A batch is a convenience, not a substitute for reading each answer: the
 * translator still pastes them one at a time.
 */
export function buildBatchPrompt(items, options = {}) {
  const template = options.template ?? DEFAULT_PROMPT_TEMPLATE;
  const instruction = template.includes(PROMPT_PLACEHOLDER)
    ? template.slice(0, template.indexOf(PROMPT_PLACEHOLDER)).trim()
    : template.trim();

  const body = items
    .map((item, index) => `${index + 1}. ${formatForPrompt(item.source)}`)
    .join('\n');

  return `${instruction}\n\n${body}`;
}

export { DEFAULT_PROMPT_TEMPLATE as PROMPT_TEMPLATE };
