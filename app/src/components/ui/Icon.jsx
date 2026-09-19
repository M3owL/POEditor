/**
 * Inline icons.
 *
 * Hand-rolled rather than pulling in an icon package: the set needed here is
 * about thirty glyphs, and an icon library would add a dependency and a
 * tree-shaking configuration for something that is 40 lines of SVG.
 *
 * All icons share a 24x24 viewBox and inherit `currentColor`, so sizing and
 * colour come from the surrounding classes.
 */

const PATHS = {
  upload: 'M12 15V3m0 0L8 7m4-4 4 4M4 15v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2',
  file: 'M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z',
  files: 'M9 3v5h5M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3M9 3l5 5v3M14 8h4l3 3v6a2 2 0 0 1-2 2h-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  filter: 'M3 5h18M7 12h10M11 19h2',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  x: 'M18 6 6 18M6 6l12 12',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronUp: 'm6 15 6-6 6 6',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  arrowDown: 'M12 5v14m0 0 6-6m-6 6-6-6',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  copy: 'M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M6 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7m3 4v6m4-6v6',
  undo: 'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.1l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.9-1.1L14.7 3h-4l-.4 2.5a7.5 7.5 0 0 0-1.9 1.1l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 1.9 1.1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.9-1.1l2.3 1 2-3.4-2-1.5c.1-.4.1-.7.1-1.1Z',
  keyboard: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3 4h.01M11 10h.01M15 10h.01M7 14h10',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  error: 'M12 8v4m0 4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  info: 'M12 16v-4m0-4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  moon: 'M21 13.2A9 9 0 1 1 10.8 3a7 7 0 0 0 10.2 10.2Z',
  book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Zm4 0v14M15 8h3m-3 3h3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0 0c2.5-2.7 3.8-6 3.8-10S14.5 4.7 12 2M12 22c-2.5-2.7-3.8-6-3.8-10S9.5 4.7 12 2M2.5 9h19m-19 6h19',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.5 6.2L3 16m0 4v-4h4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  sparkles: 'm12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM7 3v6h8V3M7 21v-6h10v6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  layers: 'm12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5',
  table: 'M3 5h18v14H3V5Zm0 5h18M9 10v9m6-9v9',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v5l3 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  swap: 'M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3',
  wand: 'm15 4 1.5 3L20 8.5 16.5 10 15 13l-1.5-3L10 8.5 13.5 7 15 4ZM4 20l6-6M4 14l2 2',
};

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.75, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
