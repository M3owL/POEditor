/**
 * Bottom bar: what just happened, and what is still outstanding.
 *
 * Autosave status belongs here rather than in a toast -- it changes constantly
 * and a toast per save would be unbearable. A quiet "Saved 14:32" is enough
 * reassurance that closing the tab will not lose work.
 */

import Icon from './ui/Icon.jsx';

function timeOf(date) {
  if (!date) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function StatusBar({
  progress,
  analysis,
  savedAt,
  saving,
  autosaveEnabled,
  storageLabel,
  hasProject,
  undoTarget,
  onUndo,
}) {
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-surface px-4 py-1.5 text-2xs text-faint">
      {hasProject && progress ? (
        <>
          <span className="flex items-center gap-1.5">
            <Icon name="checkCircle" size={11} className="text-ok" />
            <span className="text-dim">
              {progress.approved} approved · {progress.translated} translated · {progress.untranslated} left
            </span>
          </span>

          {analysis?.counts?.error ? (
            <span className="flex items-center gap-1 text-err">
              <Icon name="error" size={11} />
              {analysis.counts.error} error{analysis.counts.error === 1 ? '' : 's'}
            </span>
          ) : null}

          {analysis?.counts?.warning ? (
            <span className="flex items-center gap-1 text-warn">
              <Icon name="warning" size={11} />
              {analysis.counts.warning} warning{analysis.counts.warning === 1 ? '' : 's'}
            </span>
          ) : null}
        </>
      ) : (
        <span>No project loaded</span>
      )}

      <span className="flex-1" />

      {undoTarget ? (
        <button
          type="button"
          onClick={onUndo}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-dim transition-colors hover:bg-surface3 hover:text-fg"
          title={`Undo: ${undoTarget}`}
        >
          <Icon name="undo" size={11} />
          Undo {undoTarget}
        </button>
      ) : null}

      {storageLabel ? <span title="Browser storage used">{storageLabel}</span> : null}

      {autosaveEnabled && hasProject ? (
        <span className="flex items-center gap-1">
          {saving ? (
            <>
              <Icon name="refresh" size={11} className="animate-spin" />
              Saving…
            </>
          ) : savedAt ? (
            <>
              <Icon name="save" size={11} />
              Saved {timeOf(savedAt)}
            </>
          ) : (
            <>
              <Icon name="save" size={11} />
              Autosave on
            </>
          )}
        </span>
      ) : null}

      <span className="hidden items-center gap-1 sm:flex">
        <kbd className="rounded border border-line bg-surface2 px-1 font-mono">Ctrl</kbd>
        <kbd className="rounded border border-line bg-surface2 px-1 font-mono">/</kbd>
        <span>shortcuts</span>
      </span>
    </footer>
  );
}
