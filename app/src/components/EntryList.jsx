/**
 * The entry list.
 *
 * Three things earn their space here: the status of every entry at a glance,
 * a filter that maps onto how translators actually work ("show me what is left"),
 * and the issue badges, so the list doubles as the QA overview.
 *
 * Rendering is incremental rather than virtualised. A windowed list library
 * would add a dependency and a measurement pass; appending 60 more rows as the
 * user scrolls keeps the first paint fast on a 50 000-string PO file without
 * any of that.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './ui/Icon.jsx';
import { FILTER, FILTERS, LIST_WINDOW, SEVERITY } from '../lib/constants.js';
import { STATUS, entryStatus, filledFormCount, totalFormCount } from '../lib/entry.js';
import { worstSeverity } from '../lib/qa.js';

const STATUS_STYLE = {
  [STATUS.APPROVED]: { dot: 'bg-ok', label: 'Approved' },
  [STATUS.TRANSLATED]: { dot: 'bg-accent', label: 'Translated' },
  [STATUS.UNTRANSLATED]: { dot: 'bg-lineStrong', label: 'Untranslated' },
};

const SEVERITY_STYLE = {
  error: 'bg-errSoft text-err',
  warning: 'bg-warnSoft text-warn',
  info: 'bg-infoSoft text-info',
};

function StatusDot({ status }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE[STATUS.UNTRANSLATED];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} title={style.label} aria-label={style.label} />;
}

function IssueBadges({ issues }) {
  if (!issues || issues.length === 0) return null;

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {(['error', 'warning', 'info']).map((severity) =>
        counts[severity] ? (
          <span
            key={severity}
            className={`chip ${SEVERITY_STYLE[severity]}`}
            title={`${counts[severity]} ${severity}${counts[severity] > 1 ? 's' : ''}`}
          >
            {counts[severity]}
          </span>
        ) : null,
      )}
    </span>
  );
}

export default function EntryList({
  entries,
  totalCount,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  analysis,
  progress,
  filterCounts,
  searchRef,
}) {
  const scrollRef = useRef(null);
  const [window, setWindow] = useState(LIST_WINDOW);

  // Reset the window whenever the visible set changes, otherwise scrolling a
  // long list and then filtering leaves thousands of rows mounted.
  useEffect(() => {
    setWindow(LIST_WINDOW);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [filter, search, entries.length]);

  // Keep the selected row in view when navigating with the keyboard.
  useEffect(() => {
    if (!selectedId) return;
    const node = scrollRef.current?.querySelector(`[data-entry-id="${selectedId}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const visible = useMemo(() => entries.slice(0, window), [entries, window]);
  const remaining = entries.length - visible.length;

  const onScroll = (event) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400 && remaining > 0) {
      setWindow((current) => current + LIST_WINDOW);
    }
  };

  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-surface" aria-label="Entries">
      {/* ---------------------------------------------------------- search */}
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search source, target or key…"
            aria-label="Search entries"
            className="input py-1.5 pl-8 text-xs"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg"
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => {
            const count = filterCounts?.[option.id] ?? 0;
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onFilterChange(option.id)}
                title={option.hint}
                aria-pressed={active}
                className={`chip transition-colors ${
                  active ? 'bg-accent text-accent-fg' : 'bg-surface2 text-dim hover:bg-surface3 hover:text-fg'
                }`}
              >
                {option.label}
                <span className={active ? 'opacity-80' : 'text-faint'}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------ list */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Icon name="search" size={20} className="text-faint" />
            <p className="text-sm text-dim">Nothing matches this filter.</p>
            <button type="button" onClick={() => onFilterChange(FILTER.ALL)} className="btn-subtle btn-sm">
              Show all {totalCount} entries
            </button>
          </div>
        ) : (
          <ul className="py-1">
            {visible.map((entry) => {
              const status = entryStatus(entry);
              const issues = analysis?.byEntry?.get(entry.id);
              const severity = worstSeverity(issues);
              const active = entry.id === selectedId;
              const forms = totalFormCount(entry);
              const done = filledFormCount(entry);

              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    data-entry-id={entry.id}
                    onClick={() => onSelect(entry.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                      active ? 'bg-accent-soft' : 'hover:bg-surface2'
                    }`}
                  >
                    <span className="mt-1.5">
                      <StatusDot status={status} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        {entry.key ? (
                          <span className="truncate font-mono text-2xs text-faint" title={entry.key}>
                            {entry.key}
                          </span>
                        ) : (
                          <span className="text-2xs italic text-faint">no key</span>
                        )}

                        {forms > 1 ? (
                          <span className={`text-2xs ${done === forms ? 'text-ok' : 'text-warn'}`}>
                            {done}/{forms}
                          </span>
                        ) : null}

                        {entry.approved ? <Icon name="check" size={11} className="shrink-0 text-ok" /> : null}
                      </span>

                      <span className="mt-0.5 block truncate text-xs text-fg">
                        {entry.source || <span className="italic text-faint">empty source</span>}
                      </span>

                      {entry.target ? (
                        <span className="mt-0.5 block truncate text-xs text-dim">{entry.target}</span>
                      ) : null}
                    </span>

                    <IssueBadges issues={issues} />
                    {severity === SEVERITY.ERROR ? <span className="sr-only">Has errors</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {remaining > 0 ? (
          <button
            type="button"
            onClick={() => setWindow((current) => current + LIST_WINDOW)}
            className="w-full px-3 py-2 text-center text-2xs text-faint hover:text-fg"
          >
            {remaining} more — scroll or click to load
          </button>
        ) : null}
      </div>

      {/* -------------------------------------------------------- progress */}
      {progress ? (
        <div className="shrink-0 border-t border-line px-3 py-2">
          <div className="flex items-center justify-between text-2xs text-faint">
            <span>
              {progress.formsDone} / {progress.forms} strings
            </span>
            <span className="font-medium text-dim">{progress.percent}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface3">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-2xs text-faint">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {progress.approved} approved
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-lineStrong" />
              {progress.untranslated} left
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
