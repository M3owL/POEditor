import Modal from './ui/Modal.jsx';
import { SHORTCUTS } from '../lib/constants.js';

export default function ShortcutsDialog({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" icon="keyboard" size="sm" onClose={onClose}>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.keys} className="flex items-center justify-between gap-4 bg-surface2 px-3 py-2">
            <span className="text-xs text-dim">{shortcut.action}</span>
            <kbd className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs text-fg">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-2xs leading-relaxed text-faint">
        Shortcuts are disabled while a dialog is open, so typing a translation that contains
        a keyboard shortcut never triggers it.
      </p>
    </Modal>
  );
}
