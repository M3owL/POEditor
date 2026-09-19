/**
 * Reading files in and writing files out.
 *
 * The charset handling is not decoration. gettext PO files declare their
 * encoding in the header, and a file from a 2010-era project is frequently
 * ISO-8859-2 rather than UTF-8. Decoding it as UTF-8 produces a screen full of
 * replacement characters and a translator who assumes the tool is broken.
 */

const UTF8 = new TextDecoder('utf-8');

/** Extensions that are definitely binary, so they are never read as text. */
const BINARY_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xls', 'zip', 'gz', '7z']);

export function extensionOf(name) {
  const match = String(name ?? '').match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * The text out of a parse input.
 *
 * The registry hands every format the same shape -- `{ text, bytes, name }` --
 * and every format must accept it, or a file silently loads as zero entries.
 * A bare string is accepted too, so a parser can be called directly from a
 * test or a console without wrapping it.
 */
export function inputText(input) {
  if (typeof input === 'string') return input;
  return String(input?.text ?? '');
}

export function baseNameOf(name) {
  return String(name ?? '').replace(/\.[^./\\]+$/, '');
}

/**
 * Decode bytes to text, honouring a declared charset when UTF-8 does not fit.
 *
 * `declaredCharset` comes from the file itself once the header has been read,
 * which is why this can be called twice for the same file.
 */
export function decodeText(bytes, declaredCharset) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (declaredCharset && declaredCharset.toLowerCase().replace(/[-_]/g, '') !== 'utf8') {
    try {
      return new TextDecoder(declaredCharset, { fatal: false }).decode(view);
    } catch {
      // Unknown or unsupported label; fall through to UTF-8.
    }
  }

  return UTF8.decode(view);
}

/** `charset=ISO-8859-2` from a PO header, if present. */
export function declaredCharsetOf(text) {
  const match = String(text ?? '').match(/charset\s*=\s*([A-Za-z0-9._-]+)/i);
  return match ? match[1] : null;
}

/** How much of a file looks like mojibake after a UTF-8 decode. */
export function replacementRatio(text) {
  if (!text) return 0;
  let bad = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0xfffd) bad += 1;
  }
  return bad / text.length;
}

export async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name ?? '';
  const extension = extensionOf(name);

  if (BINARY_EXTENSIONS.has(extension)) {
    return { name, extension, bytes, text: null, size: bytes.length, binary: true };
  }

  const text = decodeText(bytes);
  return { name, extension, bytes, text, size: bytes.length, binary: false };
}

/** Trigger a browser download for text or binary output. */
export function download({ text, bytes }, filename, mime = 'application/octet-stream') {
  const blob =
    bytes !== undefined && bytes !== null
      ? new Blob([bytes], { type: mime })
      : new Blob([text ?? ''], { type: `${mime};charset=utf-8` });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Byte size for display. */
export function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
