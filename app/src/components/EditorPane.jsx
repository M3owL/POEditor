/**
 * The editing pane.
 *
 * Everything here is about removing reasons to leave the keyboard: the source
 * stays visible, placeholders can be inserted without retyping them, the
 * issues for this entry sit right above the field, and approval is one chord
 * away.
 *
 * Plural entries get one field per form. A single textarea for a language that
 * needs three forms is the most common way a CAT tool quietly corrupts a
 * translation, so the forms are never collapsed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './ui/Icon.jsx';
import HighlightedText from './HighlightedText.jsx';
import { pluralLabelsFor, SEVERITY } from '../lib/constants.js';
import { isPlural, targetForms } from '../lib/entry.js';
import { placeholders } from '../lib/placeholders.js';

const SEVERITY_ICON = { error: 'error', warning: 'warning', info: 'info' };
const SEVERITY_TEXT = { error: 'text-err', warning: 'text-warn', info: 'text-info' };

function PluralLabel({ label, index, total }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-2xs uppercase tracking-wide text-faint">{label}</span>
      {total > 2 ? <span className="text-2xs text-faint">form {index}</span> : null}
    </span>
  );
}

export default function EditorPane({
  entry,
  issues,
  hiddenIssueCount,
  position,
  total,
  targetLanguage,
  onChangeForm,
  onApproveToggle,
  onClear,
  onCopySource,
  onCopyPrompt,
  onDismissIssue,
  onRestoreIssue,
  assessment,
  onPrev,
  onNext,
  onJumpToMatch,
}) {
  const [activeForm, setActiveForm] = useState(0);
  const fieldsRef = useRef([]);

  // Switching entries must not carry the previous cursor position across.
  useEffect(() => {
    setActiveForm(0);
  }, [entry?.id]);

  const plural = entry ? isPlural(entry) : false;
  const forms = entry ? targetForms(entry) : [];

  // Labels follow the target language: Polish uses one / few / many, not the
  // generic zero / one / two that a naive index would produce.
  const pluralLabels = useMemo(
    () => pluralLabelsFor(targetLanguage, forms.length),
    [targetLanguage, forms.length],
  );

  const sourceTokens = useMemo(() => (entry ? placeholders(entry.source) : []), [entry]);
  const pluralTokens = useMemo(() => (entry?.pluralSource ? placeholders(entry.pluralSource) : []), [entry]);

  if (!entry) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-canvas">
        <div className="max-w-sm text-center">
          <Icon name="list" size={22} className="mx-auto text-faint" />
          <p className="mt-3 text-sm text-dim">Select an entry to translate it.</p>
        </div>
      </section>
    );
  }

  /** Insert a placeholder at the caret in whichever field has focus. */
  const insertToken = (token) => {
    const field = fieldsRef.current[activeForm] ?? fieldsRef.current[0];
    if (!field) return;

    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`;

    onChangeForm(activeForm, next);

    // Restore the caret after React has written the new value.
    requestAnimationFrame(() => {
      field.focus();
      const caret = start + token.length;
      field.setSelectionRange(caret, caret);
    });
  };

  const tokens = [...new Set([...sourceTokens, ...pluralTokens])];

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-canvas" aria-label="Translation editor">
      {/* --------------------------------------------------------- header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {entry.key ? (
            <span className="truncate rounded bg-surface3 px-1.5 py-0.5 font-mono text-2xs text-dim" title={entry.key}>
              {entry.key}
            </span>
          ) : (
            <span className="text-2xs italic text-faint">no key</span>
          )}

          {entry.flags?.map((flag) => (
            <span key={flag} className="chip bg-warnSoft text-warn" title="Set by the source file">
              {flag}
            </span>
          ))}

          {plural ? <span className="chip bg-infoSoft text-info">plural · {forms.length} forms</span> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-2xs text-faint">
            {position} / {total}
          </span>
          <button type="button" onClick={onPrev} className="btn-icon" aria-label="Previous entry" title="Previous (Ctrl + ↑)">
            <Icon name="chevronUp" size={15} />
          </button>
          <button type="button" onClick={onNext} className="btn-icon" aria-label="Next entry" title="Next (Ctrl + ↓)">
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* ------------------------------------------------------- source */}
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Source</span>
            <div className="flex items-center gap-1">
              {/* Two different "copy" actions, and the distinction matters:
                  "Fill" puts the source in the translation field to edit,
                  "Copy for AI" puts it on the clipboard wrapped in the prompt
                  so it can be pasted straight into a model. */}
              <button
                type="button"
                onClick={onCopySource}
                className="btn-subtle btn-sm"
                title="Copy the source into the translation field (Ctrl + Shift + C)"
              >
                <Icon name="arrowDown" size={12} />
                Fill
              </button>

              <button
                type="button"
                onClick={onCopyPrompt}
                className="btn-subtle btn-sm"
                title="Copy the source to the clipboard, wrapped in your prompt"
              >
                <Icon name="sparkles" size={12} />
                Copy for AI
              </button>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-fg">
            <HighlightedText text={entry.source} empty="(empty source)" />
          </p>

          {plural && entry.pluralSource ? (
            <p className="mt-2 border-l-2 border-lineStrong pl-3 text-sm leading-relaxed text-dim">
              <span className="mr-2 text-2xs uppercase tracking-wide text-faint">plural</span>
              <HighlightedText text={entry.pluralSource} />
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------------ context */}
        {entry.comment || entry.references?.length ? (
          <div className="border-b border-line bg-surface2 px-4 py-2.5">
            {entry.comment ? (
              <div className="flex gap-2">
                <Icon name="info" size={13} className="mt-0.5 shrink-0 text-faint" />
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-dim">{entry.comment}</p>
              </div>
            ) : null}

            {entry.references?.length ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <Icon name="folder" size={12} className="text-faint" />
                {entry.references.slice(0, 8).map((reference) => (
                  <span key={reference} className="rounded bg-surface3 px-1.5 py-0.5 font-mono text-2xs text-faint">
                    {reference}
                  </span>
                ))}
                {entry.references.length > 8 ? (
                  <span className="text-2xs text-faint">+{entry.references.length - 8} more</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------- issues
            Rendered whenever there is anything to say, including when the only
            thing to say is that findings are hidden. Otherwise ignoring every
            warning on an entry makes the bar vanish and the dismissal becomes
            invisible and un-undoable. */}
        {issues?.length || hiddenIssueCount > 0 ? (
          <div className="space-y-1 border-b border-line px-4 py-2.5">
            {issues?.map((current, index) => (
              <div key={`${current.code}-${index}`} className="group flex items-start gap-2">
                <Icon
                  name={SEVERITY_ICON[current.severity]}
                  size={13}
                  className={`mt-0.5 shrink-0 ${SEVERITY_TEXT[current.severity]}`}
                />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-dim">
                  <span className={`font-medium ${SEVERITY_TEXT[current.severity]}`}>{current.message}</span>
                  {current.detail ? <span className="text-faint"> — {current.detail}</span> : null}
                </p>
                {/* Dismissible from here as well as from the panel, because the
                    entry is where the translator notices the noise. */}
                <button
                  type="button"
                  onClick={() => onDismissIssue(current)}
                  className="btn-icon h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  title="Ignore this warning"
                  aria-label="Ignore this warning"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}

            {hiddenIssueCount > 0 ? (
              <p className="pt-0.5 text-2xs text-faint">
                {hiddenIssueCount} ignored finding{hiddenIssueCount === 1 ? '' : 's'} hidden —{' '}
                <button
                  type="button"
                  onClick={() => onRestoreIssue(null)}
                  className="underline decoration-dotted hover:text-dim"
                >
                  show
                </button>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------- target */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Translation</span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClear}
                className="btn-subtle btn-sm"
                title="Clear the translation (Ctrl + Shift + Backspace)"
                disabled={forms.every((form) => form === '')}
              >
                <Icon name="trash" size={12} />
                Clear
              </button>

              <button
                type="button"
                onClick={onApproveToggle}
                aria-pressed={entry.approved}
                className={`btn-sm ${entry.approved ? 'btn-primary' : 'btn-ghost'}`}
                title="Approve this entry (Ctrl + Enter approves and moves on)"
              >
                <Icon name="check" size={12} />
                {entry.approved ? 'Approved' : 'Approve'}
              </button>
            </div>
          </div>

          {/* Placeholder insertion. Clicking beats retyping `%1$s` and getting
              the index wrong. */}
          {tokens.length ? (
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span className="text-2xs text-faint">Insert:</span>
              {tokens.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-2xs text-accent transition-colors hover:bg-accent hover:text-accent-fg"
                  title={`Insert ${token} at the cursor`}
                >
                  {token}
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-3">
            {forms.map((value, index) => {
              const fieldIssues = (issues ?? []).filter(
                (current) =>
                  plural
                    ? current.message.includes(index === 0 ? '(singular)' : `(plural ${index})`)
                    : true,
              );
              const hasError = fieldIssues.some((current) => current.severity === SEVERITY.ERROR);

              return (
                <div key={index}>
                  {plural ? (
                    <div className="mb-1 flex items-center justify-between">
                      <PluralLabel label={pluralLabels[index]} index={index} total={forms.length} />
                      <span className="text-2xs text-faint">{value.length} chars</span>
                    </div>
                  ) : null}

                  <textarea
                    ref={(node) => {
                      fieldsRef.current[index] = node;
                    }}
                    value={value}
                    onChange={(event) => onChangeForm(index, event.target.value)}
                    onFocus={() => setActiveForm(index)}
                    spellCheck
                    rows={plural ? 2 : 3}
                    placeholder={
                      index === 0 ? 'Type the translation…' : 'Type this plural form…'
                    }
                    aria-label={plural ? `Translation, form ${index}` : 'Translation'}
                    className={`textarea min-h-[3.5rem] font-normal ${
                      hasError ? 'border-err focus:border-err' : ''
                    }`}
                  />

                  {!plural ? (
                    <div className="mt-1 flex items-center justify-between text-2xs text-faint">
                      <span>{value.length} characters</span>
                      {value.trim() === '' ? <span className="text-warn">not translated</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* ------------------------------------------------------ preview
              What the finished string looks like, with placeholders highlighted
              so a lost `%s` is visible rather than merely reported, plus the
              naturalness verdict for the form being edited. It is a preview of
              the Polish, not of the markup: the point is to read the sentence
              back once before approving it. */}
          <PreviewBlock
            value={forms[activeForm] ?? ''}
            result={assessment?.perForm?.[activeForm]}
            label={assessment?.plural ? pluralLabels[activeForm] : null}
            source={entry.source}
          />
        </div>
      </div>
    </section>
  );
}

/** Colour band for a 0..100 naturalness score. */
function previewTone(score) {
  if (score === null || score === undefined) return { text: 'text-faint', bar: 'bg-surface3', chip: 'bg-surface3' };
  if (score >= 90) return { text: 'text-ok', bar: 'bg-ok', chip: 'bg-okSoft text-ok' };
  if (score >= 70) return { text: 'text-accent', bar: 'bg-accent', chip: 'bg-accent-soft text-accent' };
  if (score >= 50) return { text: 'text-warn', bar: 'bg-warn', chip: 'bg-warnSoft text-warn' };
  return { text: 'text-err', bar: 'bg-err', chip: 'bg-errSoft text-err' };
}

function PreviewBlock({ value, result, label, source }) {
  const empty = !String(value ?? '').trim();
  const score = result?.score ?? null;
  const tone = previewTone(score);

  // The single most useful thing to say, if there is anything to say.
  const headline = (result?.findings ?? [])[0];

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface2 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label mb-0">
          Preview{label ? ` · ${label}` : ''}
        </span>

        {empty ? (
          <span className="text-2xs text-faint">nothing typed</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-12 overflow-hidden rounded-full bg-surface3">
              <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${score ?? 0}%` }} />
            </span>
            <span className={`font-mono text-2xs ${tone.text}`}>{score === null ? '—' : score}</span>
          </span>
        )}
      </div>

      {empty ? (
        <p className="text-xs italic text-faint">The translated string will appear here.</p>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
            <HighlightedText text={value} />
          </p>

          {headline ? (
            <p className={`mt-1.5 text-2xs ${tone.text}`}>
              {headline.message}
            </p>
          ) : (
            <p className="mt-1.5 text-2xs text-ok">Reads naturally.</p>
          )}

          {result?.metrics?.ratio !== null && result?.metrics?.ratio !== undefined && source?.trim() ? (
            <p className="mt-1 text-2xs text-faint">
              {result.metrics.ratio}× the source length
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
