/**
 * The side panel: overview, suggestions, quality, memory, and file facts.
 *
 * Five tabs is one more than fits comfortably, and the order is the design
 * decision that matters. Overview is first because "does what I just typed read
 * naturally" is the question a translator asks most often and can currently
 * answer least easily. Suggestions is second for the same reason -- it is where
 * the app proposes something, rather than reporting on what is already there.
 *
 * The tabs carry no icons. Five labels at 20rem is already 272px of a 320px
 * panel; adding a 13px glyph and a gap to each pushes the row to 367px and it
 * overflows. Labels alone fit, and a label is more informative than a shield.
 */

import { useMemo, useState } from 'react';
import Icon from './ui/Icon.jsx';
import HighlightedText from './HighlightedText.jsx';
import { SEVERITY_LABEL } from '../lib/constants.js';
import { CHECK_CATALOGUE } from '../lib/dismissed.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'suggestions', label: 'Suggest' },
  { id: 'quality', label: 'Quality' },
  { id: 'memory', label: 'Memory' },
  { id: 'info', label: 'Info' },
];

const SEVERITY_STYLE = {
  error: { text: 'text-err', bg: 'bg-errSoft', icon: 'error' },
  warning: { text: 'text-warn', bg: 'bg-warnSoft', icon: 'warning' },
  info: { text: 'text-info', bg: 'bg-infoSoft', icon: 'info' },
};

/** Colour for a 0..100 score, shared by the score dial and the confidence bars. */
function toneFor(percent) {
  if (percent >= 90) return { bar: 'bg-ok', text: 'text-ok' };
  if (percent >= 70) return { bar: 'bg-accent', text: 'text-accent' };
  if (percent >= 50) return { bar: 'bg-warn', text: 'text-warn' };
  return { bar: 'bg-err', text: 'text-err' };
}

function ConfidenceBar({ value, label }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const tone = toneFor(percent);

  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-surface3">
        <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
      </span>
      <span className={`w-8 text-right font-mono text-2xs ${tone.text}`}>{percent}%</span>
    </span>
  );
}

function Empty({ icon, title, hint }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center">
      <Icon name={icon} size={18} className="mx-auto text-faint" />
      <p className="mt-2 text-xs text-dim">{title}</p>
      {hint ? <p className="mt-1 text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * One finding row.
 *
 * The two actions are deliberately different shapes. "Apply" changes the text
 * and is only offered when the fix is mechanical. "Ignore" hides the row and
 * changes nothing -- and it is available on every finding, including the ones
 * that cannot be fixed, because those are exactly the ones that otherwise sit
 * there glaring.
 */
function FindingRow({ finding, onApplyFix, onDismiss, onRestore, dismissed, showDismissed }) {
  const style = SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.info;
  const canFix = Boolean(finding.fix);

  return (
    <li className={`rounded-lg border border-line bg-surface2 p-2.5 ${dismissed ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`flex items-center gap-1 ${style.text}`}>
          <Icon name={style.icon} size={12} />
          <span className="text-2xs font-semibold uppercase tracking-wide">{SEVERITY_LABEL[finding.severity]}</span>
          {dismissed ? <span className="chip bg-surface3 text-faint">ignored</span> : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {canFix && !dismissed ? (
            <button
              type="button"
              onClick={() => onApplyFix(finding)}
              className="btn-subtle btn-sm"
              title="Apply this correction"
            >
              <Icon name="wand" size={11} />
              Fix
            </button>
          ) : null}

          {dismissed ? (
            <button
              type="button"
              onClick={() => onRestore(finding)}
              className="btn-subtle btn-sm"
              title="Show this again"
            >
              <Icon name="refresh" size={11} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDismiss(finding)}
              className="btn-icon h-6 w-6"
              title={showDismissed ? 'Ignore this' : 'Ignore this correction'}
              aria-label="Ignore this correction"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-fg">{finding.message}</p>
      {finding.detail ? <p className="mt-0.5 text-2xs text-faint">{finding.detail}</p> : null}
      {finding.hint ? (
        <p className="mt-1 text-2xs italic text-faint">
          Needs the sentence rebuilt — shown as advice, not applied automatically.
        </p>
      ) : null}
    </li>
  );
}

/**
 * The list of every check, with a switch for each.
 *
 * Extracted from the tab so it can be rendered directly by a test: the tab keeps
 * it behind a collapsed disclosure, and a collapsed disclosure renders nothing,
 * which would leave the catalogue-to-UI mapping unverified.
 */
function MutedChecksList({ dismissedMutes, onToggleMuteCheck }) {
  return (
    <div className="space-y-2">
      {['Build-breaking', 'Suspicious', 'Cosmetic', 'Polish'].map((group) => (
        <div key={group}>
          <p className="mb-1 text-2xs uppercase tracking-wide text-faint">{group}</p>
          <ul className="space-y-0.5">
            {CHECK_CATALOGUE.filter((check) => check.group === group).map((check) => {
              const muted = Boolean(dismissedMutes?.[check.code]);
              return (
                <li key={check.code}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-surface3">
                    <input
                      type="checkbox"
                      checked={muted}
                      onChange={() => onToggleMuteCheck(check.code)}
                      className="h-3 w-3 accent-[var(--c-accent)]"
                    />
                    <span className={`text-2xs ${muted ? 'text-faint line-through' : 'text-dim'}`}>{check.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({
  entry,
  assessment,
  dismissedFindings,
  dismissedMutes,
  showDismissed,
  onToggleShowDismissed,
  onApplyFix,
  onApplyAllFixes,
  onDismiss,
  onRestore,
  onDismissAll,
  onToggleMuteCheck,
  onClearDismissals,
}) {
  const [showMuted, setShowMuted] = useState(false);

  if (!entry) return <div className="p-3"><Empty icon="list" title="Select an entry to assess it." /></div>;

  const score = assessment?.score;
  const percent = score === null || score === undefined ? null : score;
  const tone = percent === null ? { bar: 'bg-surface3', text: 'text-faint' } : toneFor(percent);

  const fixable = (assessment?.findings ?? []).filter((finding) => finding.fix);
  const visible = assessment?.findings ?? [];
  const hidden = dismissedFindings ?? [];

  return (
    <div className="space-y-3 p-3">
      {/* ------------------------------------------------------------ score */}
      <div className="rounded-lg border border-line bg-surface2 px-3 py-3">
        <div className="flex items-baseline justify-between">
          <span className="label mb-0">Naturalness</span>
          <span className={`chip ${percent === null ? 'bg-surface3 text-faint' : 'bg-surface3'} ${tone.text}`}>
            {assessment?.label?.label ?? '—'}
          </span>
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className={`text-3xl font-semibold leading-none ${tone.text}`}>{percent === null ? '—' : percent}</span>
          <span className="text-2xs text-faint">/ 100</span>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface3">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent ?? 0}%` }} />
        </div>

        {assessment?.metrics ? (
          <p className="mt-2 text-2xs text-faint">
            {assessment.metrics.words} words · {assessment.metrics.characters} chars
            {assessment.metrics.ratio !== null ? ` · ${assessment.metrics.ratio}× the source` : ''}
          </p>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- actions */}
      {fixable.length > 0 ? (
        <button type="button" onClick={onApplyAllFixes} className="btn-primary btn-sm w-full">
          <Icon name="wand" size={12} />
          Fix {fixable.length} thing{fixable.length === 1 ? '' : 's'} automatically
        </button>
      ) : null}

      {visible.length === 0 && hidden.length === 0 ? (
        <Empty
          icon="checkCircle"
          title={percent === null ? 'Nothing typed yet.' : 'Reads naturally.'}
          hint={percent === null ? 'Start typing a translation to see an assessment.' : 'No corrections to suggest.'}
        />
      ) : (
        <div>
          {/* The header renders whenever anything is hidden, even with nothing
              visible. Otherwise ignoring the last correction makes the "show
              ignored" control disappear with it, and the dismissal can never be
              undone. */}
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Corrections</span>
            {hidden.length ? (
              <button type="button" onClick={onToggleShowDismissed} className="btn-subtle btn-sm">
                <Icon name="eye" size={11} />
                {showDismissed ? 'Hide' : 'Show'} ignored ({hidden.length})
              </button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-2xs text-faint">
              Every correction on this entry is ignored.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((finding, index) => (
                <FindingRow
                  key={`${finding.code}-${finding.form ?? 0}-${index}`}
                  finding={finding}
                  onApplyFix={onApplyFix}
                  onDismiss={onDismiss}
                  onRestore={onRestore}
                  dismissed={false}
                  showDismissed={showDismissed}
                />
              ))}

              {showDismissed
                ? hidden.map((finding, index) => (
                    <FindingRow
                      key={`hidden-${finding.code}-${finding.form ?? 0}-${index}`}
                      finding={finding}
                      onApplyFix={onApplyFix}
                      onDismiss={onDismiss}
                      onRestore={onRestore}
                      dismissed
                      showDismissed={showDismissed}
                    />
                  ))
                : null}
            </ul>
          )}

          {visible.length > 1 ? (
            <button type="button" onClick={() => onDismissAll(visible)} className="btn-ghost btn-sm mt-2 w-full">
              <Icon name="x" size={11} />
              Ignore all on this entry
            </button>
          ) : null}
        </div>
      )}

      {/* ------------------------------------------------------ muted checks */}
      <div className="rounded-lg border border-line bg-surface2">
        <button
          type="button"
          onClick={() => setShowMuted((value) => !value)}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          aria-expanded={showMuted}
        >
          <span className="text-2xs font-medium text-dim">Muted checks</span>
          <Icon name={showMuted ? 'chevronUp' : 'chevronDown'} size={13} className="text-faint" />
        </button>

        {showMuted ? (
          <div className="border-t border-line px-3 py-2">
            <p className="mb-2 text-2xs text-faint">
              A muted check stays silent everywhere until you unmute it. Nothing is deleted.
            </p>

            <MutedChecksList dismissedMutes={dismissedMutes} onToggleMuteCheck={onToggleMuteCheck} />

            <button type="button" onClick={onClearDismissals} className="btn-ghost btn-sm mt-2 w-full">
              <Icon name="refresh" size={11} />
              Unmute everything
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function SuggestionsTab({ entry, suggestions, onUseSuggestion, onCopyPrompt, hasTarget }) {
  if (!entry) return <div className="p-3"><Empty icon="list" title="Select an entry to see suggestions." /></div>;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-2xs text-faint">
          {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
        </p>
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

      {suggestions.length === 0 ? (
        <Empty
          icon="sparkles"
          title="Nothing to suggest yet."
          hint={
            hasTarget
              ? 'No similar strings in memory, and the text reads fine.'
              : 'Translate a few entries and they become suggestions for the rest.'
          }
        />
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="rounded-lg border border-line bg-surface2 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                  className={`chip ${
                    suggestion.kind === 'memory-exact'
                      ? 'bg-okSoft text-ok'
                      : suggestion.kind === 'memory-fuzzy'
                        ? 'bg-accent-soft text-accent'
                        : suggestion.kind === 'consistency'
                          ? 'bg-infoSoft text-info'
                          : 'bg-warnSoft text-warn'
                  }`}
                >
                  {suggestion.label}
                </span>
                <ConfidenceBar value={suggestion.confidence} label="How well this is supported by evidence" />
              </div>

              <p className="text-xs leading-relaxed text-fg">
                <HighlightedText text={suggestion.text} />
              </p>

              <p className="mt-1 text-2xs text-faint">{suggestion.rationale}</p>

              <button
                type="button"
                onClick={() => onUseSuggestion(suggestion)}
                className="btn-ghost btn-sm mt-2 w-full"
              >
                <Icon name="arrowDown" size={12} />
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-2xs leading-relaxed text-faint">
        The percentage says how well each proposal is supported: an exact match the project agrees on scores
        highest, and it drops as the evidence gets thinner.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function MemoryTab({ matches, onInsertMatch, onImportTm, tmCount, memoryReady }) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-2xs text-faint">
          {tmCount} segment{tmCount === 1 ? '' : 's'} in memory
        </p>
        <button type="button" onClick={onImportTm} className="btn-subtle btn-sm" title="Add a TMX file to the memory">
          <Icon name="plus" size={12} />
          Add TMX
        </button>
      </div>

      {!memoryReady ? (
        <p className="text-xs text-faint">Select an entry to see matches.</p>
      ) : matches.length === 0 ? (
        <Empty
          icon="book"
          title="No similar strings yet."
          hint="Translations you complete are added to the memory automatically."
        />
      ) : (
        <ul className="space-y-1.5">
          {matches.map((match, index) => (
            <li key={`${match.normalised}-${index}`} className="rounded-lg border border-line bg-surface2 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`chip ${
                      match.kind === 'exact'
                        ? 'bg-okSoft text-ok'
                        : match.kind === 'prefix'
                          ? 'bg-accent-soft text-accent'
                          : 'bg-warnSoft text-warn'
                    }`}
                  >
                    {match.kind}
                  </span>
                  {match.key ? <span className="truncate font-mono text-2xs text-faint">{match.key}</span> : null}
                </span>
                <ConfidenceBar value={match.score * 100} label="Similarity" />
              </div>

              <p className="mb-1 text-2xs text-faint">
                <HighlightedText text={match.source} />
              </p>

              <p className="text-xs leading-relaxed text-fg">
                <HighlightedText text={match.target} />
              </p>

              <button type="button" onClick={() => onInsertMatch(match.target)} className="btn-ghost btn-sm mt-2 w-full">
                <Icon name="arrowDown" size={12} />
                Use this translation
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

function QualityTab({ issues, analysis, onJumpToIssue, onDismiss, dismissedCodes, showDismissed, onToggleShowDismissed }) {
  const counts = analysis?.counts ?? { error: 0, warning: 0, info: 0 };
  const total = counts.error + counts.warning + counts.info;
  const hiddenCount = dismissedCodes?.length ?? 0;

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        {(['error', 'warning', 'info']).map((severity) => {
          const style = SEVERITY_STYLE[severity];
          return (
            <div key={severity} className={`rounded-lg ${style.bg} px-2.5 py-2`}>
              <div className={`flex items-center gap-1 ${style.text}`}>
                <Icon name={style.icon} size={12} />
                <span className="text-2xs font-semibold uppercase tracking-wide">{SEVERITY_LABEL[severity]}</span>
              </div>
              <p className={`mt-0.5 text-lg font-semibold leading-none ${style.text}`}>{counts[severity]}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-line bg-surface2 px-3 py-2">
        <div>
          <p className="text-xs text-fg">
            {analysis?.summary?.entriesWithIssues ?? 0} entr{(analysis?.summary?.entriesWithIssues ?? 0) === 1 ? 'y' : 'ies'} with issues
          </p>
          {analysis?.summary?.inconsistentSources ? (
            <p className="text-2xs text-faint">
              {analysis.summary.inconsistentSources} source{analysis.summary.inconsistentSources === 1 ? '' : 's'} translated inconsistently
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onJumpToIssue} className="btn-ghost btn-sm" disabled={total === 0}>
          <Icon name="target" size={12} />
          Next issue
        </button>
      </div>

      {hiddenCount > 0 ? (
        <button type="button" onClick={onToggleShowDismissed} className="btn-subtle btn-sm w-full">
          <Icon name="eye" size={11} />
          {showDismissed ? 'Hide' : 'Show'} {hiddenCount} ignored
        </button>
      ) : null}

      {issues?.length ? (
        <div>
          <p className="label">This entry</p>
          <ul className="space-y-1.5">
            {issues.map((current, index) => {
              const style = SEVERITY_STYLE[current.severity];
              const dismissed = current.dismissed;
              return (
                <li
                  key={`${current.code}-${index}`}
                  className={`rounded-lg border border-line bg-surface2 p-2.5 ${dismissed ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`flex items-center gap-1 ${style.text}`}>
                      <Icon name={style.icon} size={12} />
                      <span className="text-2xs font-semibold uppercase tracking-wide">{SEVERITY_LABEL[current.severity]}</span>
                      {dismissed ? <span className="chip bg-surface3 text-faint">ignored</span> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onDismiss(current, dismissed)}
                      className="btn-icon h-6 w-6 shrink-0"
                      title={dismissed ? 'Show this again' : 'Ignore this warning'}
                      aria-label={dismissed ? 'Show this again' : 'Ignore this warning'}
                    >
                      <Icon name={dismissed ? 'refresh' : 'x'} size={12} />
                    </button>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg">{current.message}</p>
                  {current.detail ? <p className="mt-0.5 text-2xs text-faint">{current.detail}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <Empty icon="checkCircle" title="This entry passes every check." />
      )}

      {analysis?.projectIssues?.length ? (
        <div>
          <p className="label">Across the project</p>
          <ul className="space-y-1">
            {analysis.projectIssues.slice(0, 12).map((current, index) => {
              const style = SEVERITY_STYLE[current.severity];
              return (
                <li key={`${current.code}-${index}`} className="flex items-start gap-1.5">
                  <Icon name={style.icon} size={11} className={`mt-0.5 shrink-0 ${style.text}`} />
                  <p className="text-2xs leading-relaxed text-dim">{current.message}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="text-2xs leading-relaxed text-faint">
        Any check can be muted from the Overview tab, or ignored on a single entry with the × button.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

function InfoTab({ meta, formatLabel, entry, settings, onChangeSettings, fileInfo }) {
  const rows = [
    ['File', fileInfo?.name ?? '—'],
    ['Format', formatLabel ?? '—'],
    ['Size', fileInfo?.sizeLabel ?? '—'],
    ['Entries', meta?.entries ?? '—'],
    ['Source language', settings.sourceLanguage],
    ['Target language', settings.targetLanguage],
  ];

  if (meta?.sheet) rows.push(['Sheet', meta.sheet]);
  if (meta?.version) rows.push(['Version', meta.version]);
  if (meta?.pluralGroups) rows.push(['Plural groups', meta.pluralGroups]);
  if (meta?.skippedRows) rows.push(['Blank rows skipped', meta.skippedRows]);
  if (meta?.malformedBlocks) rows.push(['Malformed blocks', meta.malformedBlocks]);

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="label">File</p>
        <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 bg-surface2 px-3 py-1.5">
              <dt className="text-2xs text-faint">{label}</dt>
              <dd className="truncate text-xs text-fg" title={String(value)}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="label">Languages</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-2xs text-faint" htmlFor="settings-source">
              Source
            </label>
            <input
              id="settings-source"
              value={settings.sourceLanguage}
              onChange={(event) => onChangeSettings({ sourceLanguage: event.target.value })}
              className="input py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-faint" htmlFor="settings-target">
              Target
            </label>
            <input
              id="settings-target"
              value={settings.targetLanguage}
              onChange={(event) => onChangeSettings({ targetLanguage: event.target.value })}
              className="input py-1 text-xs"
            />
          </div>
        </div>
        <p className="mt-1 text-2xs text-faint">
          Used when exporting, and to decide how many plural forms an entry needs.
        </p>
      </div>

      {/* ------------------------------------------------------- copy for AI */}
      <div>
        <p className="label">Copy for AI</p>
        <label className="mb-1 block text-2xs text-faint" htmlFor="settings-prompt">
          Prompt template — <code className="font-mono">{'{text}'}</code> is replaced with the source
        </label>
        <textarea
          id="settings-prompt"
          value={settings.promptTemplate}
          onChange={(event) => onChangeSettings({ promptTemplate: event.target.value })}
          rows={3}
          spellCheck={false}
          className="textarea font-mono text-2xs"
        />
        <p className="mt-1 text-2xs text-faint">
          If the template has no <code className="font-mono">{'{text}'}</code>, the source is appended on its own
          line — it is never dropped.
        </p>

        <label className="mt-2 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={settings.promptIncludeContext}
            onChange={(event) => onChangeSettings({ promptIncludeContext: event.target.checked })}
            className="h-3 w-3 accent-[var(--c-accent)]"
          />
          <span className="text-2xs text-dim">Include the key and comment as a trailing note</span>
        </label>
      </div>

      <div>
        <p className="label">Panel</p>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showDismissed}
            onChange={(event) => onChangeSettings({ showDismissed: event.target.checked })}
            className="h-3 w-3 accent-[var(--c-accent)]"
          />
          <span className="text-2xs text-dim">Show ignored findings</span>
        </label>
      </div>

      {entry ? (
        <div>
          <p className="label">Selected entry</p>
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            <div className="flex items-baseline justify-between gap-3 bg-surface2 px-3 py-1.5">
              <dt className="text-2xs text-faint">Key</dt>
              <dd className="truncate font-mono text-2xs text-fg">{entry.key || '—'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 bg-surface2 px-3 py-1.5">
              <dt className="text-2xs text-faint">Plural</dt>
              <dd className="text-xs text-fg">{entry.pluralSource ? `yes · ${entry.pluralTargets.length} forms` : 'no'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 bg-surface2 px-3 py-1.5">
              <dt className="text-2xs text-faint">Approved</dt>
              <dd className="text-xs text-fg">{entry.approved ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function SidePanel({
  tab,
  onTabChange,
  entry,
  issues,
  analysis,
  matches,
  onInsertMatch,
  onImportTm,
  tmCount,
  onJumpToIssue,
  meta,
  formatLabel,
  fileInfo,
  settings,
  onChangeSettings,
  // ---- overview
  assessment,
  dismissedFindings,
  showDismissed,
  onToggleShowDismissed,
  onApplyFix,
  onApplyAllFixes,
  onDismissFinding,
  onDismissAllFindings,
  onToggleMuteCheck,
  onClearDismissals,
  dismissedMutes,
  // ---- suggestions
  suggestions,
  onUseSuggestion,
  onCopyPrompt,
}) {
  const dismissedCodes = useMemo(() => (dismissedFindings ?? []).map((finding) => finding.code), [dismissedFindings]);

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-surface" aria-label="Details">
      <div className="flex shrink-0 border-b border-line" role="tablist">
        {TABS.map((option) => {
          const active = tab === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(option.id)}
              title={option.label}
              className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-1.5 py-2 text-2xs font-medium transition-colors ${
                active ? 'border-accent text-fg' : 'border-transparent text-dim hover:text-fg'
              }`}
            >
              {option.label}
              {option.id === 'quality' && (analysis?.counts?.error ?? 0) > 0 ? (
                <span className="rounded bg-errSoft px-1 font-mono text-2xs text-err">{analysis.counts.error}</span>
              ) : null}
              {option.id === 'suggestions' && (suggestions?.length ?? 0) > 0 ? (
                <span className="font-mono text-2xs text-faint">{suggestions.length}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin">
        {tab === 'overview' ? (
          <OverviewTab
            entry={entry}
            assessment={assessment}
            dismissedFindings={dismissedFindings}
            dismissedMutes={dismissedMutes}
            showDismissed={showDismissed}
            onToggleShowDismissed={onToggleShowDismissed}
            onApplyFix={onApplyFix}
            onApplyAllFixes={onApplyAllFixes}
            onDismiss={(finding) => onDismissFinding?.(finding, false)}
            onRestore={(finding) => onDismissFinding?.(finding, true)}
            onDismissAll={onDismissAllFindings}
            onToggleMuteCheck={onToggleMuteCheck}
            onClearDismissals={onClearDismissals}
          />
        ) : null}

        {tab === 'suggestions' ? (
          <SuggestionsTab
            entry={entry}
            suggestions={suggestions ?? []}
            onUseSuggestion={onUseSuggestion}
            onCopyPrompt={onCopyPrompt}
            hasTarget={Boolean(entry?.target?.trim())}
          />
        ) : null}

        {tab === 'quality' ? (
          <QualityTab
            issues={issues}
            analysis={analysis}
            onJumpToIssue={onJumpToIssue}
            onDismiss={onDismissFinding}
            dismissedCodes={dismissedCodes}
            showDismissed={showDismissed}
            onToggleShowDismissed={onToggleShowDismissed}
          />
        ) : null}

        {tab === 'memory' ? (
          <MemoryTab
            matches={matches}
            onInsertMatch={onInsertMatch}
            onImportTm={onImportTm}
            tmCount={tmCount}
            memoryReady={Boolean(entry)}
          />
        ) : null}

        {tab === 'info' ? (
          <InfoTab
            meta={meta}
            formatLabel={formatLabel}
            entry={entry}
            settings={settings}
            onChangeSettings={onChangeSettings}
            fileInfo={fileInfo}
          />
        ) : null}
      </div>
    </aside>
  );
}

export { toneFor, MutedChecksList };
