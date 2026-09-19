/**
 * The side panel: memory, quality, and file facts.
 *
 * Memory is first because it is the tab that gets used most -- reusing an
 * existing translation is faster than typing a new one, and it is how
 * terminology stays consistent across a project.
 */

import { useState } from 'react';
import Icon from './ui/Icon.jsx';
import HighlightedText from './HighlightedText.jsx';
import { SEVERITY, SEVERITY_LABEL } from '../lib/constants.js';

const TABS = [
  { id: 'memory', label: 'Memory', icon: 'book' },
  { id: 'quality', label: 'Quality', icon: 'shield' },
  { id: 'info', label: 'Info', icon: 'info' },
];

const SEVERITY_STYLE = {
  error: { text: 'text-err', bg: 'bg-errSoft', icon: 'error' },
  warning: { text: 'text-warn', bg: 'bg-warnSoft', icon: 'warning' },
  info: { text: 'text-info', bg: 'bg-infoSoft', icon: 'info' },
};

function ScoreBar({ score, kind }) {
  const percent = Math.round(score * 100);
  const tone = kind === 'exact' ? 'bg-ok' : kind === 'prefix' ? 'bg-accent' : 'bg-warn';

  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1 w-10 overflow-hidden rounded-full bg-surface3">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="w-7 text-right font-mono text-2xs text-faint">{percent}%</span>
    </span>
  );
}

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
        <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center">
          <Icon name="book" size={18} className="mx-auto text-faint" />
          <p className="mt-2 text-xs text-dim">No similar strings yet.</p>
          <p className="mt-1 text-2xs text-faint">
            Translations you complete are added to the memory automatically.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {matches.map((match, index) => (
            <li key={`${match.normalised}-${index}`} className="rounded-lg border border-line bg-surface2 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`chip ${
                      match.kind === 'exact' ? 'bg-okSoft text-ok' : match.kind === 'prefix' ? 'bg-accent-soft text-accent' : 'bg-warnSoft text-warn'
                    }`}
                  >
                    {match.kind}
                  </span>
                  {match.key ? <span className="truncate font-mono text-2xs text-faint">{match.key}</span> : null}
                </span>
                <ScoreBar score={match.score} kind={match.kind} />
              </div>

              <p className="mb-1 text-2xs text-faint">
                <HighlightedText text={match.source} />
              </p>

              <p className="text-xs leading-relaxed text-fg">
                <HighlightedText text={match.target} />
              </p>

              <button
                type="button"
                onClick={() => onInsertMatch(match.target)}
                className="btn-ghost btn-sm mt-2 w-full"
              >
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

function QualityTab({ issues, analysis, onJumpToIssue }) {
  const counts = analysis?.counts ?? { error: 0, warning: 0, info: 0 };
  const total = counts.error + counts.warning + counts.info;

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

      {issues?.length ? (
        <div>
          <p className="label">This entry</p>
          <ul className="space-y-1.5">
            {issues.map((current, index) => {
              const style = SEVERITY_STYLE[current.severity];
              return (
                <li key={`${current.code}-${index}`} className="rounded-lg border border-line bg-surface2 p-2.5">
                  <div className={`flex items-center gap-1 ${style.text}`}>
                    <Icon name={style.icon} size={12} />
                    <span className="text-2xs font-semibold uppercase tracking-wide">{SEVERITY_LABEL[current.severity]}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg">{current.message}</p>
                  {current.detail ? <p className="mt-0.5 text-2xs text-faint">{current.detail}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center">
          <Icon name="checkCircle" size={18} className="mx-auto text-ok" />
          <p className="mt-2 text-xs text-dim">This entry passes every check.</p>
        </div>
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
    </div>
  );
}

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
}) {
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
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-2xs font-medium transition-colors ${
                active ? 'border-accent text-fg' : 'border-transparent text-dim hover:text-fg'
              }`}
            >
              <Icon name={option.icon} size={13} />
              {option.label}
              {option.id === 'quality' && (analysis?.counts?.error ?? 0) > 0 ? (
                <span className="rounded bg-errSoft px-1 font-mono text-2xs text-err">{analysis.counts.error}</span>
              ) : null}
              {option.id === 'memory' && tmCount > 0 ? (
                <span className="font-mono text-2xs text-faint">{tmCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'memory' ? (
          <MemoryTab
            matches={matches}
            onInsertMatch={onInsertMatch}
            onImportTm={onImportTm}
            tmCount={tmCount}
            memoryReady={Boolean(entry)}
          />
        ) : null}

        {tab === 'quality' ? <QualityTab issues={issues} analysis={analysis} onJumpToIssue={onJumpToIssue} /> : null}

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
