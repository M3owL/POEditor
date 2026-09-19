/**
 * Text with placeholder tokens rendered as distinct objects.
 *
 * Two reasons this matters more than it looks:
 *
 *   1. A translator who sees `%d` as highlighted cannot accidentally retype it
 *      as `%D` or translate the `d`. Placeholders become things, not letters.
 *   2. Passing `against` highlights tokens that do not appear in the other
 *      language's string. That is the same comparison the QA panel runs, but
 *      shown in place, so the problem is visible while typing rather than in a
 *      list somewhere else.
 */

import { useMemo } from 'react';
import { placeholderMap, tokenize } from '../lib/placeholders.js';

export default function HighlightedText({ text, against = null, className = '', empty = null }) {
  const segments = useMemo(() => tokenize(text), [text]);
  const reference = useMemo(
    () => (against === null || against === undefined ? null : placeholderMap(against)),
    [against],
  );

  if (!text) {
    return empty ? <span className="text-faint">{empty}</span> : null;
  }

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.value}</span>;
        }

        const unexpected = reference !== null && !reference.has(segment.value);

        return (
          <span
            key={index}
            className={unexpected ? 'tok-warn' : 'tok'}
            title={unexpected ? 'Not present in the other language' : 'Placeholder — must be kept intact'}
          >
            {segment.value}
          </span>
        );
      })}
    </span>
  );
}
