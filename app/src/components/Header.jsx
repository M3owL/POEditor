/**
 * Top bar: identity, the loaded file, and the primary actions.
 *
 * The file input lives here rather than in a dialog so that "Open" is a single
 * click, and so drag-and-drop has an obvious counterpart.
 */

import { useRef } from 'react';
import Icon from './ui/Icon.jsx';

export const ACCEPT =
  '.po,.pot,.xlf,.xliff,.sdlxliff,.xlsx,.xlsm,.csv,.tsv,.json,.xml,.strings,.tmx,.srt,.vtt';

export default function Header({
  fileInfo,
  formatLabel,
  entryCount,
  hasProject,
  theme,
  onToggleTheme,
  onFiles,
  onExport,
  onClearProject,
  onShortcuts,
  busy,
}) {
  const inputRef = useRef(null);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <Icon name="swap" size={16} />
        </span>

        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight text-fg">
            M3owL <span className="text-dim">POEditor</span>
          </h1>
          <p className="truncate text-2xs leading-tight text-faint">
            {fileInfo ? (
              <>
                {fileInfo.name}
                {formatLabel ? <span className="text-faint"> · {formatLabel}</span> : null}
                {entryCount ? <span className="text-faint"> · {entryCount.toLocaleString()} entries</span> : null}
              </>
            ) : (
              'Localisation editor — files never leave your machine'
            )}
          </p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onFiles(files);
            // Reset so re-picking the same file fires a change event again.
            event.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-ghost btn-sm"
          title="Open one or more files (Ctrl + O)"
          disabled={busy}
        >
          <Icon name="folder" size={13} />
          {hasProject ? 'Add files' : 'Open files'}
        </button>

        <button
          type="button"
          onClick={onExport}
          className="btn-primary btn-sm"
          title="Export the translation (Ctrl + E)"
          disabled={!hasProject || busy}
        >
          <Icon name="download" size={13} />
          Export
        </button>

        <span className="mx-0.5 h-5 w-px bg-line" />

        {hasProject ? (
          <button
            type="button"
            onClick={onClearProject}
            className="btn-icon"
            title="Close this project and start over"
            aria-label="Close project"
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onToggleTheme}
          className="btn-icon"
          title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
          aria-label="Toggle theme"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>

        <button type="button" onClick={onShortcuts} className="btn-icon" title="Keyboard shortcuts (Ctrl + /)" aria-label="Keyboard shortcuts">
          <Icon name="keyboard" size={15} />
        </button>
      </div>
    </header>
  );
}
