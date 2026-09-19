/**
 * Export.
 *
 * Converting between formats is lossy in ways that are not obvious, so the
 * warnings here are generated from what the entries actually contain rather
 * than shown as a generic disclaimer. A project with no plurals is not warned
 * about plurals.
 */

import { useMemo, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Icon from './ui/Icon.jsx';
import { FORMAT_DESCRIPTORS, lossWarnings, serializeEntries } from '../formats/index.js';
import { baseNameOf, download } from '../lib/files.js';

/** Subtitle-only extras. */
function SubtitleOptions({ options, onChange }) {
  return (
    <>
      <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3 py-2">
        <input
          type="checkbox"
          checked={options.bilingual === true}
          onChange={(event) => onChange({ bilingual: event.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--c-accent)]"
        />
        <span>
          <span className="block text-xs font-medium text-fg">Bilingual output</span>
          <span className="mt-0.5 block text-2xs text-faint">
            Writes the translation with the source underneath each cue.
          </span>
        </span>
      </label>

      <div>
        <label className="label" htmlFor="export-wrap">
          Wrap lines at
        </label>
        <select
          id="export-wrap"
          className="select py-1 text-xs"
          value={options.wrapWidth ?? 0}
          onChange={(event) => onChange({ wrapWidth: Number(event.target.value) })}
        >
          <option value={0}>Keep the original line breaks</option>
          <option value={42}>42 characters (broadcast standard)</option>
          <option value={37}>37 characters (Netflix style)</option>
        </select>
      </div>
    </>
  );
}

export default function ExportDialog({ entries, meta, formatId, fileName, settings, onClose, onDone }) {
  const [target, setTarget] = useState(formatId ?? 'po');
  const [options, setOptions] = useState({ includeHeader: true, preserveLayout: true });
  const [typedName, setTypedName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const descriptor = FORMAT_DESCRIPTORS.find((candidate) => candidate.id === target);
  const extension = descriptor?.extensions?.[0] ?? 'txt';
  const base = baseNameOf(fileName ?? 'translations');
  const targetLanguage = settings.targetLanguage || 'target';

  /**
   * The suggested name is derived during render rather than set in an effect.
   * An effect would leave the field empty on the first paint and make the
   * dialog's initial state depend on a post-render pass. Once the user types,
   * their value wins and stops tracking the format.
   */
  const suggestedName = `${base}.${targetLanguage}.${extension}`;
  const name = typedName ?? suggestedName;

  const warnings = useMemo(() => lossWarnings(meta, target, entries), [meta, target, entries]);

  const stats = useMemo(() => {
    let translated = 0;
    let total = 0;
    for (const entry of entries) {
      total += 1;
      if (entry.target?.trim()) translated += 1;
    }
    return { translated, total };
  }, [entries]);

  const isTabular = ['xlsx', 'csv', 'tsv'].includes(target);
  const isSubtitle = target === 'srt' || target === 'vtt';
  const canPreserveLayout = isTabular && Array.isArray(meta?.grid) && meta.grid.length > 0;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await serializeEntries(entries, meta, {
        format: target,
        ...options,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        sheetName: options.sheetName,
      });

      const mime = result.mime ?? 'application/octet-stream';
      const filename = name.trim() || `${base}.${result.extension ?? extension}`;

      download(result, filename, mime);
      onDone?.(filename, target);
    } catch (problem) {
      setError(problem.message ?? String(problem));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="btn-ghost">
        Cancel
      </button>
      <button type="button" onClick={run} className="btn-primary" disabled={busy || entries.length === 0}>
        <Icon name="download" size={13} />
        {busy ? 'Writing…' : `Export as ${descriptor?.label ?? target}`}
      </button>
    </>
  );

  return (
    <Modal
      title="Export translation"
      subtitle={`${stats.translated} of ${stats.total} entries translated`}
      icon="download"
      size="lg"
      onClose={onClose}
      footer={footer}
    >
      <div className="space-y-4">
        <div>
          <p className="label">Format</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {FORMAT_DESCRIPTORS.map((candidate) => {
              const active = candidate.id === target;
              const isOriginal = candidate.id === (meta?.formatId ?? meta?.format);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTarget(candidate.id)}
                  className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    active ? 'border-accent bg-accent-soft' : 'border-line bg-surface2 hover:bg-surface3'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-fg">{candidate.label}</span>
                    <span className="mt-0.5 block font-mono text-2xs text-faint">.{candidate.extensions[0]}</span>
                  </span>
                  {isOriginal ? (
                    <span className="chip shrink-0 bg-surface3 text-faint" title="The format this project was opened from">
                      original
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="export-name">
            File name
          </label>
          <input
            id="export-name"
            className="input font-mono text-xs"
            value={name}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </div>

        {/* ------------------------------------------------------- options */}
        {isTabular ? (
          <div className="space-y-2">
            <p className="label mb-0">Spreadsheet options</p>

            {canPreserveLayout ? (
              <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={options.preserveLayout !== false}
                  onChange={(event) => setOptions((current) => ({ ...current, preserveLayout: event.target.checked }))}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--c-accent)]"
                />
                <span>
                  <span className="block text-xs font-medium text-fg">Keep the original sheet layout</span>
                  <span className="mt-0.5 block text-2xs text-faint">
                    Writes back into sheet “{meta.sheet}”, leaving columns this tool does not use untouched.
                  </span>
                </span>
              </label>
            ) : null}

            <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3 py-2">
              <input
                type="checkbox"
                checked={options.includeHeader !== false}
                onChange={(event) => setOptions((current) => ({ ...current, includeHeader: event.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--c-accent)]"
              />
              <span>
                <span className="block text-xs font-medium text-fg">Include a header row</span>
                <span className="mt-0.5 block text-2xs text-faint">Column names for key, source and translation.</span>
              </span>
            </label>
          </div>
        ) : null}

        {isSubtitle ? <SubtitleOptions options={options} onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))} /> : null}

        {/* ------------------------------------------------------ warnings */}
        {warnings.length ? (
          <div className="rounded-lg border border-warn bg-warnSoft px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-warn">
              <Icon name="warning" size={14} />
              <p className="text-xs font-semibold">This conversion loses information</p>
            </div>
            <ul className="mt-1.5 space-y-1">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5 text-2xs leading-relaxed text-fg">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warn" />
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-2xs text-faint">
            <Icon name="checkCircle" size={12} className="text-ok" />
            {target === (meta?.formatId ?? meta?.format)
              ? 'Exporting in the original format — nothing is lost.'
              : 'No lossy conversions detected for this format.'}
          </div>
        )}

        {error ? (
          <div className="flex items-start gap-2 rounded-lg bg-errSoft px-3 py-2.5 text-err">
            <Icon name="error" size={14} className="mt-0.5 shrink-0" />
            <p className="text-xs">{error}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
