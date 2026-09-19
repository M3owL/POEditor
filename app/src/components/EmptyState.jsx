/**
 * The drop zone shown before anything is loaded.
 *
 * The format list is not decoration: the first question anyone asks of a
 * translation tool is "will it take my file", and answering it before they
 * upload saves a round trip.
 */

import { useState } from 'react';
import Icon from './ui/Icon.jsx';
import { FORMAT_DESCRIPTORS } from '../formats/index.js';

const GROUPS = [
  { icon: 'file', label: 'gettext', formats: ['po'] },
  { icon: 'layers', label: 'CAT exchange', formats: ['xliff', 'tmx'] },
  { icon: 'table', label: 'Spreadsheets', formats: ['xlsx', 'csv', 'tsv'] },
  { icon: 'globe', label: 'Platform', formats: ['json', 'android', 'apple'] },
  { icon: 'clock', label: 'Subtitles', formats: ['srt', 'vtt'] },
];

export default function EmptyState({ onFiles, onOpen, restoreAvailable, onRestore, restoring }) {
  const [dragging, setDragging] = useState(false);

  const byId = new Map(FORMAT_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-canvas p-6">
      <div className="w-full max-w-2xl">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            // Only clear when the pointer actually leaves the zone, not when it
            // moves onto a child element.
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length) onFiles(files);
          }}
          className={`rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
          }`}
        >
          <span
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
              dragging ? 'bg-accent text-accent-fg' : 'bg-surface3 text-dim'
            }`}
          >
            <Icon name="upload" size={22} />
          </span>

          <h2 className="mt-4 text-base font-semibold text-fg">
            {dragging ? 'Drop to open' : 'Drop your translation files here'}
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-dim">
            The format is detected automatically — including which spreadsheet column holds what.
            Everything is processed in your browser; no file is uploaded anywhere.
          </p>

          <div className="mt-5 flex items-center justify-center gap-2">
            <button type="button" onClick={onOpen} className="btn-primary">
              <Icon name="folder" size={14} />
              Choose files
            </button>

            {restoreAvailable ? (
              <button type="button" onClick={onRestore} className="btn-ghost" disabled={restoring}>
                <Icon name="undo" size={14} />
                {restoring ? 'Restoring…' : 'Restore last session'}
              </button>
            ) : null}
          </div>

          <p className="mt-3 text-2xs text-faint">
            You can open a source file and a translation file together — they are matched by key.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {GROUPS.map((group) => (
            <div key={group.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-faint">
                <Icon name={group.icon} size={12} />
                <span className="text-2xs font-medium uppercase tracking-wide">{group.label}</span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {group.formats.map((id) => {
                  const descriptor = byId.get(id);
                  if (!descriptor) return null;
                  return (
                    <li key={id} className="text-2xs text-dim">
                      {descriptor.label}
                      <span className="text-faint"> ·{descriptor.extensions[0]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
