/**
 * Subtitle formats: SRT and WebVTT.
 *
 * Subtitles are not really a string table -- the timing is the payload. A
 * translator must never be able to break a timecode, so blocks are parsed into
 * `index / timing / text` and the timing is carried through untouched.
 *
 * The source text is the original subtitle lines; the translation goes into the
 * target. On export the target is written out, falling back to the source for
 * untranslated blocks so a half-finished file is still playable.
 */

import { createEntry, nextId } from '../lib/entry.js';

const TIMING_LINE = /^\s*(.+?)\s*-->\s*(.+?)\s*$/;

/**
 * Split on blank lines, but only outside a block's text. A subtitle line is
 * never blank, so blank-line splitting is safe here -- unlike in PO.
 */
function splitBlocks(text) {
  const normalised = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\ufeff/, '');

  const blocks = [];
  let current = [];

  for (const line of normalised.split('\n')) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);

  return blocks;
}

export function parseSubtitles(input, options = {}) {
  const text = String(input.text ?? '');
  const isVtt = /^\s*WEBVTT/.test(text) || options.kind === 'vtt';

  const entries = [];
  const malformed = [];
  let cueNumber = 0;

  for (const block of splitBlocks(text)) {
    let cursor = 0;

    // WEBVTT files start with a signature line and may carry NOTE blocks.
    if (/^\s*WEBVTT/.test(block[0])) continue;
    if (/^\s*NOTE\b/.test(block[0])) continue;

    let identifier = null;
    if (!TIMING_LINE.test(block[0])) {
      // An optional cue identifier precedes the timing line.
      identifier = block[0];
      cursor = 1;
    }

    const timingMatch = block[cursor]?.match(TIMING_LINE);
    if (!timingMatch) {
      malformed.push(block.join(' ').slice(0, 80));
      continue;
    }

    const start = timingMatch[1];
    const end = timingMatch[2];
    const textLines = block.slice(cursor + 1);

    cueNumber += 1;

    entries.push(
      createEntry({
        id: nextId(),
        key: identifier ?? String(cueNumber),
        source: textLines.join('\n'),
        origin: {
          start,
          end,
          cue: cueNumber,
          identifier,
          kind: isVtt ? 'vtt' : 'srt',
        },
      }),
    );
  }

  return {
    entries,
    meta: {
      format: 'subtitles',
      kind: isVtt ? 'vtt' : 'srt',
      cueCount: entries.length,
      malformedBlocks: malformed.length,
    },
  };
}

/** Subtitle lines are wrapped at a readable width, like every other tool. */
function wrapLines(value, width) {
  if (!width || width <= 0) return String(value ?? '').split('\n');

  const out = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      if (line === '') {
        line = word;
      } else if ((line + ' ' + word).length <= width) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }

  return out;
}

export function serializeSubtitles(entries, meta = {}, options = {}) {
  const kind = options.kind ?? meta.kind ?? 'srt';
  const bilingual = options.bilingual === true;
  const wrapWidth = options.wrapWidth ?? 0;
  const parts = [];

  if (kind === 'vtt') parts.push('WEBVTT\n\n');

  entries.forEach((entry, index) => {
    const { start, end, cue, identifier } = entry.origin ?? {};

    if (kind === 'vtt' && identifier) parts.push(`${identifier}\n`);
    else if (kind === 'srt') parts.push(`${index + 1}\n`);

    parts.push(`${start ?? '00:00:00,000'} --> ${end ?? '00:00:02,000'}\n`);

    const translated = entry.target.trim() !== '' ? entry.target : entry.source;

    if (bilingual && entry.target.trim() !== '' && entry.source.trim() !== '') {
      // Bilingual output puts the source under the translation, which is the
      // layout used for subtitle review passes.
      parts.push(`${wrapLines(translated, wrapWidth).join('\n')}\n`);
      parts.push(`${wrapLines(entry.source, wrapWidth).join('\n')}\n\n`);
      return;
    }

    parts.push(`${wrapLines(translated, wrapWidth).join('\n')}\n\n`);
  });

  return {
    text: parts.join(''),
    mime: kind === 'vtt' ? 'text/vtt' : 'application/x-subrip',
    extension: kind,
  };
}

export const srtFormat = {
  id: 'srt',
  label: 'SubRip subtitles',
  extensions: ['srt'],
  binary: false,
  capabilities: { plurals: false, notes: false, references: false, approved: false },
  parse: (input, options) => parseSubtitles(input, { ...options, kind: 'srt' }),
  serialize: (entries, meta, options) => serializeSubtitles(entries, meta, { ...options, kind: 'srt' }),
};

export const vttFormat = {
  id: 'vtt',
  label: 'WebVTT subtitles',
  extensions: ['vtt'],
  binary: false,
  capabilities: { plurals: false, notes: false, references: false, approved: false },
  parse: (input, options) => parseSubtitles(input, { ...options, kind: 'vtt' }),
  serialize: (entries, meta, options) => serializeSubtitles(entries, meta, { ...options, kind: 'vtt' }),
};
