/**
 * Application shell.
 *
 * Holds the project state and wires the panes together. The parsing, checking
 * and matching all live in `lib/` and `formats/`; this file is about flow:
 * files in, entries edited, files out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Header from './components/Header.jsx';
import EntryList from './components/EntryList.jsx';
import EditorPane from './components/EditorPane.jsx';
import SidePanel from './components/SidePanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import EmptyState from './components/EmptyState.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import { ToastStack, useToasts } from './components/ui/Toast.jsx';

import { FILTER, SEVERITY } from './lib/constants.js';
import {
  clearTargets,
  createEntry,
  entryStatus,
  projectProgress,
  setTargetForm,
  targetForms,
  STATUS,
} from './lib/entry.js';
import { analyzeProject, hasIssueAtLeast } from './lib/qa.js';
import { buildMemory, lookupMatches } from './lib/tm.js';
import { assessEntry, buildSuggestions } from './lib/suggest.js';
import { applyAllFixes, applyFix } from './lib/naturalness.js';
import { buildPrompt, copyToClipboard } from './lib/prompt.js';
import {
  clearDismissals as clearDismissalsState,
  dismiss,
  dismissAllOnEntry,
  filterAnalysis,
  hiddenFindings,
  isDismissed,
  muteCheck,
  pruneDismissals,
  restore as restoreDismissal,
  unmuteCheck,
} from './lib/dismissed.js';
import { detectFormat, parseFile, FORMAT_BY_ID } from './formats/index.js';
import { formatBytes, readFile } from './lib/files.js';
import {
  combineImports,
  computeFilterCounts,
  filterEntries,
  mergeByKey,
  pluralFormsFor,
} from './lib/project.js';
import {
  clearSession,
  createAutosave,
  loadDismissals,
  loadSession,
  loadSettings,
  saveDismissals,
  saveSettings,
  storageEstimate,
} from './lib/storage.js';

/** Formats that carry one value per key, so a file is either sources or translations. */
const SINGLE_VALUE = new Set(['json', 'apple', 'android', 'srt', 'vtt']);
/** Formats whose columns need confirming before import. */
const NEEDS_MAPPING = new Set(['xlsx', 'csv', 'tsv']);

/**
 * Guess whether a file holds sources or translations.
 *
 * The language code in the filename is the best signal available and is right
 * almost every time: `en.json` next to `pl.json`. Only consulted when two files
 * of the same single-value format were opened together; otherwise a lone file
 * is treated as sources.
 */
function inferRole(fileName, settings, index, total) {
  if (total < 2) return 'source';

  const lower = String(fileName).toLowerCase();
  const source = String(settings.sourceLanguage ?? '').toLowerCase();
  const target = String(settings.targetLanguage ?? '').toLowerCase();

  if (target && lower.includes(target)) return 'target';
  if (source && lower.includes(source)) return 'source';

  return index === 0 ? 'source' : 'target';
}

export default function App() {
  // ------------------------------------------------------------- settings
  const [settings, setSettings] = useState(loadSettings);

  // -------------------------------------------------------------- project
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [formatId, setFormatId] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [extraMemory, setExtraMemory] = useState([]);

  // ------------------------------------------------------------------- ui
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState(FILTER.ALL);
  const [search, setSearch] = useState('');
  const [sideTab, setSideTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [history, setHistory] = useState([]);
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [storageLabel, setStorageLabel] = useState(null);
  const [dismissals, setDismissals] = useState(loadDismissals);

  // Import queue: spreadsheets are confirmed one at a time.
  const [importQueue, setImportQueue] = useState([]);
  const [pendingImport, setPendingImport] = useState(null);
  const collectedRef = useRef([]);

  const { toasts, push, dismiss } = useToasts();
  const searchRef = useRef(null);
  const tmInputRef = useRef(null);
  const autosave = useRef(null);
  const restoreChecked = useRef(false);

  if (!autosave.current) autosave.current = createAutosave();

  const hasProject = entries.length > 0;

  // ------------------------------------------------------------ settings
  const updateSettings = useCallback((patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Theme lives on <html> so the CSS variables switch globally.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', settings.theme !== 'light');
    root.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme]);

  // ------------------------------------------------------------ analysis
  const expectedPluralForms = useMemo(
    () => pluralFormsFor(settings.targetLanguage),
    [settings.targetLanguage],
  );

  /**
   * Only the settings the checks actually read.
   *
   * Passing the whole settings object would re-run the analysis on every
   * keystroke in the prompt-template field, which has nothing to do with
   * quality.
   */
  const qaSettings = useMemo(
    () => ({
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      lengthWarnRatio: settings.lengthWarnRatio,
      flagSameAsSource: settings.flagSameAsSource,
      expectedPluralForms,
    }),
    [
      settings.sourceLanguage,
      settings.targetLanguage,
      settings.lengthWarnRatio,
      settings.flagSameAsSource,
      expectedPluralForms,
    ],
  );

  const rawAnalysis = useMemo(() => analyzeProject(entries, qaSettings), [entries, qaSettings]);

  // Dismissed checks are removed from the analysis, not just from the panel, so
  // a muted warning stops counting towards the red badge as well.
  const analysis = useMemo(() => filterAnalysis(rawAnalysis, { state: dismissals }), [rawAnalysis, dismissals]);

  const progress = useMemo(() => (entries.length ? projectProgress(entries) : null), [entries]);
  const filterCounts = useMemo(() => computeFilterCounts(entries, analysis), [entries, analysis]);

  const visible = useMemo(
    () => filterEntries(entries, { filter, search, analysis }),
    [entries, filter, search, analysis],
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const visibleIndex = useMemo(
    () => visible.findIndex((entry) => entry.id === selectedId),
    [visible, selectedId],
  );

  const selectedIssues = selectedEntry ? analysis.byEntry.get(selectedEntry.id) ?? [] : [];
  const selectedHiddenIssues = selectedEntry
    ? hiddenFindings(rawAnalysis.byEntry.get(selectedEntry.id), {
        entryId: selectedEntry.id,
        state: dismissals,
      })
    : [];

  // -------------------------------------------------------------- memory
  const memory = useMemo(() => buildMemory([...entries, ...extraMemory]), [entries, extraMemory]);

  const matches = useMemo(() => {
    if (!selectedEntry) return [];
    return lookupMatches(memory, selectedEntry.source, {
      excludeKey: selectedEntry.key,
      limit: 5,
    });
  }, [memory, selectedEntry]);

  // ------------------------------------------------- naturalness + suggestions
  const language = settings.targetLanguage;

  /**
   * The naturalness assessment, with dismissed corrections removed.
   *
   * Ignoring a correction has to lift the score, otherwise the number keeps
   * punishing a judgement the translator has already made and the number stops
   * meaning anything.
   */
  const assessment = useMemo(
    () =>
      assessEntry(selectedEntry, {
        language,
        isDismissed: (code) => isDismissed(dismissals, selectedEntry?.id, code),
      }),
    [selectedEntry, language, dismissals],
  );

  const suggestions = useMemo(
    () =>
      buildSuggestions(selectedEntry, {
        memory,
        entries,
        language,
        limit: 6,
      }),
    [selectedEntry, memory, entries, language],
  );

  // --------------------------------------------------------------- editing
  const commit = useCallback((updater, options = {}) => {
    setEntries((current) => {
      if (options.snapshot) {
        setHistory((stack) => [{ label: options.snapshot, entries: current }, ...stack].slice(0, 25));
      }
      return typeof updater === 'function' ? updater(current) : updater;
    });
  }, []);

  const patchEntry = useCallback(
    (id, patch) => commit((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))),
    [commit],
  );

  const onChangeForm = useCallback(
    (index, value) => {
      if (!selectedEntry) return;
      const updated = setTargetForm(selectedEntry, index, value);
      patchEntry(selectedEntry.id, {
        target: updated.target,
        pluralTargets: updated.pluralTargets,
        // Editing an approved entry withdraws the approval; leaving it green
        // after a change is how a reviewed file ships with a regression in it.
        approved: false,
      });
    },
    [selectedEntry, patchEntry],
  );

  const onApproveToggle = useCallback(() => {
    if (!selectedEntry) return;
    patchEntry(selectedEntry.id, { approved: !selectedEntry.approved });
  }, [selectedEntry, patchEntry]);

  const onCopySource = useCallback(() => {
    if (!selectedEntry) return;
    const source = selectedEntry.source;
    const plural = selectedEntry.pluralSource;

    patchEntry(selectedEntry.id, {
      target: source,
      pluralTargets: plural ? selectedEntry.pluralTargets.map(() => plural) : selectedEntry.pluralTargets,
      approved: false,
    });
  }, [selectedEntry, patchEntry]);

  const onClear = useCallback(() => {
    if (!selectedEntry) return;
    const cleared = clearTargets(selectedEntry);
    commit(
      (current) => current.map((entry) => (entry.id === selectedEntry.id ? cleared : entry)),
      { snapshot: 'clear translation' },
    );
  }, [selectedEntry, commit]);

  const onInsertMatch = useCallback(
    (text) => {
      if (!selectedEntry) return;
      commit(
        (current) =>
          current.map((entry) => (entry.id === selectedEntry.id ? { ...entry, target: text, approved: false } : entry)),
        { snapshot: 'use memory match' },
      );
      push('Translation inserted from memory.', { tone: 'success', ttl: 2500 });
    },
    [selectedEntry, commit, push],
  );

  const onUndo = useCallback(() => {
    setHistory((stack) => {
      if (stack.length === 0) return stack;
      const [last, ...rest] = stack;
      setEntries(last.entries);
      push(`Undid ${last.label}.`, { tone: 'info', ttl: 2500 });
      return rest;
    });
  }, [push]);

  // ------------------------------------------------- corrections and ignores
  /** Replace one target form, going through the same path as typing does. */
  const writeForms = useCallback(
    (forms, label) => {
      if (!selectedEntry) return;
      let updated = selectedEntry;
      forms.forEach((text, index) => {
        updated = setTargetForm(updated, index, text);
      });

      commit(
        (current) =>
          current.map((item) =>
            item.id === selectedEntry.id
              ? { ...item, target: updated.target, pluralTargets: updated.pluralTargets, approved: false }
              : item,
          ),
        { snapshot: label },
      );
    },
    [selectedEntry, commit],
  );

  const onApplyFix = useCallback(
    (finding) => {
      if (!selectedEntry) return;

      const forms = targetForms(selectedEntry);
      const index = finding.form ?? 0;
      const next = applyFix(forms[index] ?? '', finding);

      if (next === null) {
        push('That one has to be rewritten by hand.', { tone: 'warning', ttl: 3000 });
        return;
      }

      const updated = [...forms];
      updated[index] = next;
      writeForms(updated, 'apply correction');
    },
    [selectedEntry, writeForms, push],
  );

  const onApplyAllFixes = useCallback(() => {
    if (!selectedEntry) return;

    const forms = targetForms(selectedEntry);
    let applied = 0;

    // Only the findings still on screen are applied, so a correction the
    // translator ignored is not quietly applied by the "fix everything" button.
    const next = forms.map((text, index) => {
      const forForm = (assessment?.findings ?? []).filter((finding) => (finding.form ?? 0) === index);
      const result = applyAllFixes(text, forForm);
      if (result.text !== text) applied += result.applied.length;
      return result.text;
    });

    if (applied === 0) {
      push('Nothing left to fix automatically.', { tone: 'info', ttl: 2500 });
      return;
    }

    writeForms(next, 'apply all corrections');
    push(`Applied ${applied} correction${applied === 1 ? '' : 's'}.`, { tone: 'success', ttl: 2500 });
  }, [selectedEntry, assessment, writeForms, push]);

  const onToggleDismissFinding = useCallback(
    (finding, wasDismissed = false) => {
      if (!selectedEntry || !finding) return;
      setDismissals((current) =>
        wasDismissed
          ? restoreDismissal(current, selectedEntry.id, finding.code)
          : dismiss(current, selectedEntry.id, finding.code),
      );
    },
    [selectedEntry],
  );

  const onDismissAllFindings = useCallback(
    (findings) => {
      if (!selectedEntry) return;
      setDismissals((current) => dismissAllOnEntry(current, selectedEntry.id, (findings ?? []).map((f) => f.code)));
    },
    [selectedEntry],
  );

  const onToggleMuteCheck = useCallback((code) => {
    setDismissals((current) => (current.codes?.[code] ? unmuteCheck(current, code) : muteCheck(current, code)));
  }, []);

  const onClearDismissals = useCallback(() => {
    setDismissals(clearDismissalsState());
    push('Every check is active again.', { tone: 'info', ttl: 2500 });
  }, [push]);

  // ---------------------------------------------------------- copy for AI
  const onCopyPrompt = useCallback(
    async (target = null) => {
      const source = target ?? selectedEntry;
      if (!source) return;

      const text = [source.source, source.pluralSource].filter(Boolean).join('\n');
      const prompt = buildPrompt(text, {
        template: settings.promptTemplate,
        key: settings.promptIncludeContext ? source.key : '',
        comment: settings.promptIncludeContext ? source.comment : '',
      });

      const copied = await copyToClipboard(prompt);
      push(copied ? 'Prompt copied to the clipboard.' : 'The browser blocked clipboard access.', {
        tone: copied ? 'success' : 'error',
        detail: copied ? 'Paste it into your model of choice.' : 'Copy it from the Source panel instead.',
        ttl: 3000,
      });
    },
    [selectedEntry, settings.promptTemplate, settings.promptIncludeContext, push],
  );

  const onUseSuggestion = useCallback(
    (suggestion) => {
      if (!selectedEntry) return;
      writeForms([suggestion.text], 'use suggestion');
      push('Suggestion applied.', { tone: 'success', ttl: 2000, detail: suggestion.rationale });
    },
    [selectedEntry, writeForms, push],
  );

  // ------------------------------------------------------------ navigation
  const goTo = useCallback(
    (step) => {
      if (visible.length === 0) return;
      const next = (visibleIndex + step + visible.length) % visible.length;
      setSelectedId(visible[next].id);
    },
    [visible, visibleIndex],
  );

  const jumpToNextIssue = useCallback(() => {
    const candidates = entries.filter((entry) => hasIssueAtLeast(analysis.byEntry.get(entry.id), 'warning'));
    if (candidates.length === 0) {
      push('No issues to jump to.', { tone: 'success', ttl: 2500 });
      return;
    }

    // Stay on the current filter: switching it silently is disorienting.
    const currentIndex = candidates.findIndex((entry) => entry.id === selectedId);
    const next = candidates[(currentIndex + 1) % candidates.length];
    setSelectedId(next.id);
  }, [entries, analysis, selectedId, push]);

  // ------------------------------------------------------------- importing
  const finalizeImport = useCallback(
    (results) => {
      const combined = combineImports(results);
      collectedRef.current = [];

      if (!combined || combined.entries.length === 0) {
        push('No entries were found in those files.', { tone: 'warning' });
        return;
      }

      setEntries(combined.entries);
      setMeta(combined.meta);
      setFormatId(combined.formatId);
      setFileInfo({
        name: combined.fileName ?? 'project',
        size: combined.fileSize ?? 0,
        sizeLabel: formatBytes(combined.fileSize ?? 0),
      });
      setSelectedId(combined.entries[0]?.id ?? null);
      setFilter(FILTER.ALL);
      setSearch('');
      setHistory([]);

      // Entry ids are per-project, so dismissals keyed to the previous file's
      // ids would otherwise accumulate forever -- and a reused id would hide a
      // real finding in the new project.
      setDismissals((current) => pruneDismissals(current, combined.entries.map((entry) => entry.id)));

      const label = FORMAT_BY_ID.get(combined.formatId)?.label ?? combined.formatId;
      push(
        `Imported ${combined.entries.length.toLocaleString()} entr${combined.entries.length === 1 ? 'y' : 'ies'}.`,
        { tone: 'success', detail: `${label}${combined.meta?.pairedWith ? ` · paired with ${combined.meta.pairedWith}` : ''}` },
      );
    },
    [push],
  );

  const advanceImportQueue = useCallback(
    (queue) => {
      if (queue.length === 0) {
        finalizeImport(collectedRef.current);
        return;
      }
      const [next, ...rest] = queue;
      setImportQueue(rest);
      setPendingImport(next);
    },
    [finalizeImport],
  );

  const handleFiles = useCallback(
    async (files) => {
      setBusy(true);
      try {
        const read = await Promise.all(files.map((file) => readFile(file)));

        const detected = read.map((file) => ({
          file,
          formatId: detectFormat({ name: file.name, text: file.text, bytes: file.bytes }),
        }));

        const mapping = detected.filter((item) => NEEDS_MAPPING.has(item.formatId));
        const direct = detected.filter((item) => !NEEDS_MAPPING.has(item.formatId));

        // A single-value format opened twice is a language pair.
        const singleValueCounts = new Map();
        for (const item of direct) {
          if (!SINGLE_VALUE.has(item.formatId)) continue;
          singleValueCounts.set(item.formatId, (singleValueCounts.get(item.formatId) ?? 0) + 1);
        }

        const results = [];
        let seenByFormat = new Map();

        for (const item of direct) {
          const total = singleValueCounts.get(item.formatId) ?? 0;
          const index = seenByFormat.get(item.formatId) ?? 0;
          seenByFormat.set(item.formatId, index + 1);

          const role = SINGLE_VALUE.has(item.formatId)
            ? inferRole(item.file.name, settings, index, total)
            : 'source';

          const parsed = await parseFile(item.file, {
            role,
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
          });

          results.push({
            ...parsed,
            formatId: item.formatId,
            fileName: item.file.name,
            fileSize: item.file.size,
            role,
          });
        }

        collectedRef.current = results;

        if (mapping.length) {
          // Hand the spreadsheets to the dialog, one at a time.
          const queue = mapping.map((item) => ({
            file: item.file,
            formatId: item.formatId,
          }));
          advanceImportQueue(queue);
        } else {
          finalizeImport(results);
        }
      } catch (error) {
        push('That file could not be read.', { tone: 'error', detail: error.message });
      } finally {
        setBusy(false);
      }
    },
    [settings, push, advanceImportQueue, finalizeImport],
  );

  const confirmImport = useCallback(
    ({ parsed, options }) => {
      collectedRef.current = [
        ...collectedRef.current,
        {
          ...parsed,
          formatId: pendingImport.formatId,
          fileName: pendingImport.file.name,
          fileSize: pendingImport.file.size,
          role: options.role ?? 'source',
        },
      ];

      setPendingImport(null);
      advanceImportQueue(importQueue);
    },
    [pendingImport, importQueue, advanceImportQueue],
  );

  const cancelImport = useCallback(() => {
    collectedRef.current = [];
    setPendingImport(null);
    setImportQueue([]);
    push('Import cancelled.', { tone: 'info', ttl: 2500 });
  }, [push]);

  // ------------------------------------------------------- memory imports
  const handleTmFiles = useCallback(
    async (files) => {
      try {
        const added = [];
        for (const file of files) {
          const read = await readFile(file);
          const parsed = await parseFile(read, {
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
          });
          added.push(...parsed.entries);
        }

        if (added.length === 0) {
          push('That file contained no translations.', { tone: 'warning' });
          return;
        }

        setExtraMemory((current) => [...current, ...added]);
        push(`Added ${added.length.toLocaleString()} segments to the memory.`, { tone: 'success' });
      } catch (error) {
        push('That memory file could not be read.', { tone: 'error', detail: error.message });
      }
    },
    [settings, push],
  );

  // ------------------------------------------------------------- autosave
  // Dismissals are small and read on every render, so they go to localStorage
  // rather than into the IndexedDB session blob.
  useEffect(() => {
    saveDismissals(dismissals);
  }, [dismissals]);

  useEffect(() => {
    if (!settings.autosave || entries.length === 0) return;

    setSaving(true);
    autosave.current.schedule(
      {
        entries,
        meta,
        formatId,
        fileInfo,
        settings,
        selectedId,
      },
      (when) => {
        setSaving(false);
        setSavedAt(when);
      },
    );

    // The saving indicator needs to clear even when the write is a no-op.
    const timer = setTimeout(() => setSaving(false), 1400);
    return () => clearTimeout(timer);
  }, [entries, meta, formatId, fileInfo, settings, selectedId]);

  // Restore prompt, and the storage readout.
  useEffect(() => {
    if (restoreChecked.current) return;
    restoreChecked.current = true;

    loadSession().then((session) => {
      if (session?.entries?.length) setRestoreAvailable(true);
    });
    storageEstimate().then((estimate) => {
      if (estimate?.usage) setStorageLabel(`Storage ${formatBytes(estimate.usage)}`);
    });
  }, []);

  const restoreSession = useCallback(async () => {
    setRestoring(true);
    try {
      const session = await loadSession();
      if (!session?.entries?.length) {
        push('Nothing to restore.', { tone: 'warning' });
        setRestoreAvailable(false);
        return;
      }

      setEntries(session.entries);
      setMeta(session.meta ?? null);
      setFormatId(session.formatId ?? null);
      setFileInfo(session.fileInfo ?? null);
      setSelectedId(session.selectedId ?? session.entries[0]?.id ?? null);
      if (session.settings) setSettings((current) => ({ ...current, ...session.settings }));

      push(`Restored ${session.entries.length.toLocaleString()} entries.`, {
        tone: 'success',
        detail: session.savedAt ? `Saved ${new Date(session.savedAt).toLocaleString()}` : undefined,
      });
    } finally {
      setRestoring(false);
    }
  }, [push]);

  const closeProject = useCallback(async () => {
    setEntries([]);
    setMeta(null);
    setFormatId(null);
    setFileInfo(null);
    setSelectedId(null);
    setHistory([]);
    setSearch('');
    setFilter(FILTER.ALL);
    // Per-entry dismissals go with the project; muted checks are a preference
    // and stay.
    setDismissals((current) => pruneDismissals(current, []));
    await clearSession();
    setRestoreAvailable(false);
    push('Project closed.', { tone: 'info', ttl: 2500 });
  }, [push]);

  // ---------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (event) => {
      // A dialog owns the keyboard while it is open.
      if (pendingImport || showExport || showShortcuts) return;

      const modifier = event.ctrlKey || event.metaKey;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '');

      if (event.key === 'Escape') {
        if (search) {
          setSearch('');
          event.preventDefault();
        }
        return;
      }

      if (!modifier) return;

      // Entry navigation. Ctrl and Alt both work: Ctrl is the CAT convention,
      // Alt does not shadow the browser's own text-navigation shortcuts.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        goTo(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        if (!selectedEntry) return;
        event.preventDefault();
        patchEntry(selectedEntry.id, { approved: true });
        goTo(1);
        return;
      }

      if (event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        event.preventDefault();
        onCopySource();
        return;
      }

      if (event.shiftKey && event.key === 'Backspace') {
        event.preventDefault();
        onClear();
        return;
      }

      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault();
        document.querySelector('input[type="file"][multiple]')?.click();
        return;
      }

      if (event.key === 'e' || event.key === 'E') {
        if (!hasProject) return;
        event.preventDefault();
        setShowExport(true);
        return;
      }

      if (event.key === 'z' || event.key === 'Z') {
        if (history.length === 0) return;
        event.preventDefault();
        onUndo();
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // Ctrl+A inside a textarea must stay a normal select-all.
      if ((event.key === 'a' || event.key === 'A') && !inField) event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    pendingImport,
    showExport,
    showShortcuts,
    search,
    selectedEntry,
    goTo,
    patchEntry,
    onCopySource,
    onClear,
    onUndo,
    history.length,
    hasProject,
  ]);

  // Alt also navigates, matching the Ctrl behaviour.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || pendingImport || showExport || showShortcuts) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      goTo(event.key === 'ArrowDown' ? 1 : -1);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [goTo, pendingImport, showExport, showShortcuts]);

  const formatLabel = formatId ? FORMAT_BY_ID.get(formatId)?.label ?? formatId : null;

  // ----------------------------------------------------------------- render
  return (
    <div className="flex h-full flex-col bg-canvas">
      <Header
        fileInfo={fileInfo}
        formatLabel={formatLabel}
        entryCount={entries.length}
        hasProject={hasProject}
        theme={settings.theme}
        busy={busy}
        onToggleTheme={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        onFiles={handleFiles}
        onExport={() => setShowExport(true)}
        onClearProject={closeProject}
        onShortcuts={() => setShowShortcuts(true)}
      />

      {hasProject ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_20rem]">
          <EntryList
            entries={visible}
            totalCount={entries.length}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
            search={search}
            onSearchChange={setSearch}
            analysis={analysis}
            progress={progress}
            filterCounts={filterCounts}
            searchRef={searchRef}
          />

          <EditorPane
            entry={selectedEntry}
            issues={selectedIssues}
            hiddenIssueCount={selectedHiddenIssues.length}
            position={visibleIndex >= 0 ? visibleIndex + 1 : 0}
            total={visible.length}
            targetLanguage={settings.targetLanguage}
            onChangeForm={onChangeForm}
            onApproveToggle={onApproveToggle}
            onClear={onClear}
            onCopySource={onCopySource}
            onCopyPrompt={() => onCopyPrompt()}
            onDismissIssue={(issue) => onToggleDismissFinding(issue, false)}
            onRestoreIssue={() => updateSettings({ showDismissed: true })}
            assessment={assessment}
            onPrev={() => goTo(-1)}
            onNext={() => goTo(1)}
          />

          {/* The side panel is hidden below xl because the editor needs the
              width more than the memory list does on a laptop screen. */}
          <div className="hidden min-h-0 xl:flex">
            <SidePanel
              tab={sideTab}
              onTabChange={setSideTab}
              entry={selectedEntry}
              issues={selectedIssues}
              analysis={analysis}
              matches={matches}
              onInsertMatch={onInsertMatch}
              onImportTm={() => tmInputRef.current?.click()}
              tmCount={memory.records.length}
              onJumpToIssue={jumpToNextIssue}
              meta={{ ...meta, entries: entries.length }}
              formatLabel={formatLabel}
              fileInfo={fileInfo}
              settings={settings}
              onChangeSettings={updateSettings}
              assessment={assessment}
              dismissedFindings={assessment?.hidden ?? []}
              showDismissed={settings.showDismissed}
              onToggleShowDismissed={() => updateSettings({ showDismissed: !settings.showDismissed })}
              onApplyFix={onApplyFix}
              onApplyAllFixes={onApplyAllFixes}
              onDismissFinding={onToggleDismissFinding}
              onDismissAllFindings={onDismissAllFindings}
              onToggleMuteCheck={onToggleMuteCheck}
              onClearDismissals={onClearDismissals}
              dismissedMutes={dismissals.codes}
              suggestions={suggestions}
              onUseSuggestion={onUseSuggestion}
              onCopyPrompt={() => onCopyPrompt()}
            />
          </div>
        </main>
      ) : (
        <EmptyState
          onFiles={handleFiles}
          onOpen={() => document.querySelector('input[type="file"][multiple]')?.click()}
          restoreAvailable={restoreAvailable}
          onRestore={restoreSession}
          restoring={restoring}
        />
      )}

      <StatusBar
        progress={progress}
        analysis={analysis}
        savedAt={savedAt}
        saving={saving}
        autosaveEnabled={settings.autosave}
        storageLabel={storageLabel}
        hasProject={hasProject}
        undoTarget={history[0]?.label ?? null}
        onUndo={onUndo}
      />

      {/* Hidden input for translation-memory files. */}
      <input
        ref={tmInputRef}
        type="file"
        multiple
        accept=".tmx,.po,.xlf,.xliff,.xlsx,.csv,.tsv,.json"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) handleTmFiles(files);
          event.target.value = '';
        }}
      />

      {pendingImport ? (
        <ImportDialog
          key={pendingImport.file.name}
          file={pendingImport.file}
          formatId={pendingImport.formatId}
          settings={settings}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      ) : null}

      {showExport ? (
        <ExportDialog
          entries={entries}
          meta={{ ...meta, formatId }}
          formatId={formatId}
          fileName={fileInfo?.name}
          settings={settings}
          onClose={() => setShowExport(false)}
          onDone={(filename) => {
            setShowExport(false);
            push(`Exported ${filename}`, { tone: 'success' });
          }}
        />
      ) : null}

      {showShortcuts ? <ShortcutsDialog onClose={() => setShowShortcuts(false)} /> : null}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
