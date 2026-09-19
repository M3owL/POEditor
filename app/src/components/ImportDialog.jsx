/**
 * Import options.
 *
 * Shown when the file needs a decision the tool should not make silently:
 * which sheet, which column is which, and whether a single-value file holds
 * sources or translations.
 *
 * The preview is the point. Column guessing is right most of the time and
 * wrong in ways that are invisible until an export produces nonsense, so the
 * user gets to see the first few parsed entries before committing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Icon from './ui/Icon.jsx';
import { parseFile, FORMAT_BY_ID } from '../formats/index.js';
import { detectHeaderRow, detectMapping } from '../lib/grid.js';
import { formatBytes } from '../lib/files.js';

const ROLE_OPTIONS = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'key', label: 'Key' },
  { value: 'source', label: 'Source text' },
  { value: 'pluralSource', label: 'Plural source' },
  { value: 'target', label: 'Translation' },
  { value: 'comment', label: 'Comment' },
  { value: 'references', label: 'References' },
  { value: 'approved', label: 'Approved' },
];

/** Columns from a per-column role list, mirroring how grid.js reads a mapping. */
function columnsFromRoles(roles) {
  const firstOf = (role) => {
    const index = roles.indexOf(role);
    return index >= 0 ? index : null;
  };

  const targets = [];
  roles.forEach((role, index) => {
    if (role === 'target') targets.push(index);
  });

  return {
    key: firstOf('key'),
    source: firstOf('source'),
    pluralSource: firstOf('pluralSource'),
    targets,
    // More than one translation column means the gettext plural layout, one
    // column per form, in order.
    pluralTargets: targets.map((index, form) => ({ index, form })),
    comment: firstOf('comment'),
    references: firstOf('references'),
    approved: firstOf('approved'),
  };
}

function rolesFromColumns(columns, width) {
  const roles = Array.from({ length: width }, () => 'ignore');
  const put = (index, role) => {
    if (index !== null && index !== undefined && index < width) roles[index] = role;
  };

  put(columns.key, 'key');
  put(columns.source, 'source');
  put(columns.pluralSource, 'pluralSource');
  put(columns.comment, 'comment');
  put(columns.references, 'references');
  put(columns.approved, 'approved');
  for (const index of columns.targets ?? []) put(index, 'target');

  return roles;
}

export default function ImportDialog({ file, formatId, onConfirm, onCancel, settings }) {
  const descriptor = FORMAT_BY_ID.get(formatId);
  const tabular = ['xlsx', 'csv', 'tsv'].includes(formatId);
  const singleValue = ['json', 'apple', 'android', 'srt', 'vtt'].includes(formatId);

  const [sheet, setSheet] = useState(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [roles, setRoles] = useState([]);
  const [role, setRole] = useState('source');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const buildMapping = useCallback(
    () => ({ headerRow, columns: columnsFromRoles(roles), width: roles.length, labels: [], recognised: 0, confident: true }),
    [headerRow, roles],
  );

  // Parse, then reflect whatever the parse actually decided into the controls.
  const run = useCallback(
    async (options) => {
      setBusy(true);
      setError(null);
      try {
        const parsed = await parseFile(file, options);
        setResult(parsed);

        if (tabular && options.mapping === undefined) {
          // First pass: adopt the detected sheet, header row and columns.
          const meta = parsed.meta;
          setSheet(meta.sheet ?? null);
          const width = meta.mapping?.width ?? 0;
          setHeaderRow(meta.mapping?.headerRow ?? -1);
          setRoles(rolesFromColumns(meta.mapping?.columns ?? {}, width));
        }
      } catch (problem) {
        setError(problem.message ?? String(problem));
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    [file, tabular],
  );

  useEffect(() => {
    run({ role, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage });
    // Intentionally only on mount: later changes go through the explicit
    // handlers below so a parse is not triggered twice per interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const applyMapping = async (nextSheet, nextHeaderRow, nextRoles) => {
    await run({
      sheet: nextSheet ?? sheet ?? undefined,
      mapping: { headerRow: nextHeaderRow, columns: columnsFromRoles(nextRoles), width: nextRoles.length, labels: [], recognised: 0, confident: true },
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    });
  };

  const onSheetChange = async (name) => {
    setSheet(name);
    // A different sheet has different columns, so re-detect from scratch.
    const parsed = await parseFile(file, {
      sheet: name,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    });
    setResult(parsed);
    const width = parsed.meta?.mapping?.width ?? 0;
    setHeaderRow(parsed.meta?.mapping?.headerRow ?? -1);
    setRoles(rolesFromColumns(parsed.meta?.mapping?.columns ?? {}, width));
  };

  const onHeaderRowChange = async (value) => {
    setHeaderRow(value);
    const grid = result?.meta?.grid ?? [];
    const mapping = detectMapping(grid, value, {
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    });
    const width = mapping.width || roles.length;
    const nextRoles = rolesFromColumns(mapping.columns, width);
    setRoles(nextRoles);
    await applyMapping(sheet, value, nextRoles);
  };

  const onRoleChange = async (index, value) => {
    const nextRoles = [...roles];

    // Key, source, comment and so on are single-column roles.
    if (value !== 'ignore' && value !== 'target') {
      nextRoles.forEach((current, position) => {
        if (current === value && position !== index) nextRoles[position] = 'ignore';
      });
    }

    nextRoles[index] = value;
    setRoles(nextRoles);
    await applyMapping(sheet, headerRow, nextRoles);
  };

  const entries = result?.entries ?? [];
  const preview = useMemo(() => entries.slice(0, 4), [entries]);
  const grid = result?.meta?.grid ?? [];
  const headerLabels = useMemo(() => {
    if (!tabular) return [];
    const width = roles.length;
    const header = headerRow >= 0 ? grid[headerRow] ?? [] : [];
    return Array.from({ length: width }, (_, index) => header[index] ?? `column ${index + 1}`);
  }, [grid, headerRow, roles.length, tabular]);

  const roleCounts = useMemo(() => {
    const counts = { untranslated: 0, translated: 0 };
    for (const entry of entries) {
      if (entry.target?.trim()) counts.translated += 1;
      else counts.untranslated += 1;
    }
    return counts;
  }, [entries]);

  const footer = (
    <>
      <button type="button" onClick={onCancel} className="btn-ghost">
        Cancel
      </button>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || entries.length === 0}
        onClick={() =>
          onConfirm({
            options: {
              role,
              sheet: sheet ?? undefined,
              mapping: tabular ? buildMapping() : undefined,
              sourceLanguage: settings.sourceLanguage,
              targetLanguage: settings.targetLanguage,
            },
            parsed: result,
          })
        }
      >
        <Icon name="check" size={13} />
        Import {entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : ''}
      </button>
    </>
  );

  return (
    <Modal
      title={`Open ${file.name}`}
      subtitle={`${descriptor?.label ?? formatId} · ${formatBytes(file.size)}`}
      icon="upload"
      size="lg"
      onClose={onCancel}
      footer={footer}
    >
      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-errSoft px-3 py-2.5 text-err">
          <Icon name="error" size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">This file could not be read</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      ) : null}

      {busy && !result ? <p className="py-8 text-center text-sm text-dim">Reading…</p> : null}

      {result ? (
        <div className="space-y-4">
          {/* ------------------------------------------------- sheet choice */}
          {tabular && (result.meta?.sheets?.length ?? 0) > 1 ? (
            <div>
              <label className="label" htmlFor="import-sheet">
                Sheet
              </label>
              <select id="import-sheet" className="select" value={sheet ?? ''} onChange={(event) => onSheetChange(event.target.value)}>
                {result.meta.sheets.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name} — {candidate.rows} rows, {candidate.columns} columns
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* -------------------------------------------------- single value */}
          {singleValue ? (
            <fieldset>
              <legend className="label">What does this file contain?</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'source', label: 'Source strings', hint: 'The original text to translate' },
                  { value: 'target', label: 'Translations', hint: 'An existing translation to review' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={role === option.value}
                    onClick={async () => {
                      setRole(option.value);
                      await run({
                        role: option.value,
                        sourceLanguage: settings.sourceLanguage,
                        targetLanguage: settings.targetLanguage,
                      });
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      role === option.value ? 'border-accent bg-accent-soft' : 'border-line bg-surface2 hover:bg-surface3'
                    }`}
                  >
                    <span className="block text-xs font-medium text-fg">{option.label}</span>
                    <span className="mt-0.5 block text-2xs text-faint">{option.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* ------------------------------------------------ column mapping */}
          {tabular && roles.length ? (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="import-header">
                  Header row
                </label>
                <select
                  id="import-header"
                  className="select"
                  value={headerRow}
                  onChange={(event) => onHeaderRowChange(Number(event.target.value))}
                >
                  <option value={-1}>No header row</option>
                  {grid.slice(0, 6).map((row, index) => (
                    <option key={index} value={index}>
                      Row {index + 1}: {row.slice(0, 4).join(' · ').slice(0, 60)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="label">Columns</p>
                <div className="space-y-1.5">
                  {roles.map((currentRole, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 truncate font-mono text-2xs text-faint" title={headerLabels[index]}>
                        {headerLabels[index] || `column ${index + 1}`}
                      </span>
                      <Icon name="arrowRight" size={12} className="shrink-0 text-faint" />
                      <select
                        className="select py-1 text-xs"
                        value={currentRole}
                        aria-label={`Role of column ${index + 1}`}
                        onChange={(event) => onRoleChange(index, event.target.value)}
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {roles.filter((value) => value === 'target').length > 1 ? (
                  <p className="mt-1.5 text-2xs text-faint">
                    More than one translation column — they are read as plural forms, in order.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------------- preview */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="label mb-0">Preview</p>
              <p className="text-2xs text-faint">
                {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
                {roleCounts.translated ? ` · ${roleCounts.translated} already translated` : ''}
                {result.meta?.skippedRows ? ` · ${result.meta.skippedRows} blank rows skipped` : ''}
              </p>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-warn px-3 py-4 text-center">
                <Icon name="warning" size={16} className="mx-auto text-warn" />
                <p className="mt-1.5 text-xs text-dim">
                  No entries were found. Check the header row and the column roles.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {preview.map((entry) => (
                  <li key={entry.id} className="bg-surface2 px-3 py-2">
                    {entry.key ? <p className="truncate font-mono text-2xs text-faint">{entry.key}</p> : null}
                    <p className="truncate text-xs text-fg">{entry.source || <span className="italic text-faint">no source</span>}</p>
                    {entry.target ? (
                      <p className="truncate text-xs text-dim">{entry.target}</p>
                    ) : (
                      <p className="text-2xs italic text-faint">not translated</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
