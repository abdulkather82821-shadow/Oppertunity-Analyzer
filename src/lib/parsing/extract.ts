import { createHash } from 'node:crypto';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024); // 10 MB

export const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
} as const;

export type AllowedExtension = 'pdf' | 'docx' | 'txt';

export interface ExtractionResult {
  text: string;
  mimeType: string;
  extension: AllowedExtension;
  sha256: string;
  sizeBytes: number;
  warnings: string[];
}

export class UploadError extends Error {
  constructor(message: string, public code = 'invalid_upload') {
    super(message);
  }
}

/** Magic-byte sniffing — the declared MIME type and the extension are both untrusted input. */
export function sniffType(buffer: Uint8Array): { mimeType: string; extension: AllowedExtension } | null {
  const head = Buffer.from(buffer.slice(0, 8));
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    // A ZIP container is only a DOCX if it holds the Word document part. Entry names are stored
    // uncompressed in the zip headers, so a byte search is enough to tell a Word file from an
    // .xlsx, an .apk or an arbitrary archive renamed to .docx.
    if (!Buffer.from(buffer).includes('word/document.xml')) return null;
    return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
  }
  const sample = Buffer.from(buffer.slice(0, Math.min(buffer.length, 8192))).toString('utf8');
  // Printable text only (no control bytes). A file with no letters is still plain text — it is
  // reported as "no readable text" by the extractor rather than mislabelled "unsupported".
  if (sample.length > 0 && /^[\s\p{L}\p{N}\p{P}\p{S}]*$/u.test(sample)) {
    return { mimeType: 'text/plain', extension: 'txt' };
  }
  return null;
}

export function validateUpload(buffer: Uint8Array, declaredName: string, declaredType?: string | null): AllowedExtension {
  if (!buffer || buffer.length === 0) throw new UploadError('The uploaded file is empty.', 'empty_file');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — the maximum is ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      'file_too_large',
    );
  }
  const sniffed = sniffType(buffer);
  if (!sniffed) throw new UploadError('Unsupported file type. Upload a PDF, DOCX or TXT resume.', 'unsupported_type');

  const ext = (declaredName.split('.').pop() ?? '').toLowerCase();
  const extensionFromName = (Object.values(ALLOWED_TYPES) as readonly string[]).includes(ext) ? (ext as AllowedExtension) : null;
  if (extensionFromName && extensionFromName !== sniffed.extension) {
    // Content wins over the extension — but flag the mismatch so it is visible in the UI.
    console.warn(`[upload] extension "${ext}" does not match content type "${sniffed.extension}"`);
  }
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== sniffed.mimeType) {
    console.warn(`[upload] declared type "${declaredType}" differs from sniffed "${sniffed.mimeType}"`);
  }
  return sniffed.extension;
}

/**
 * Optional ClamAV daemon scan. If CLAMD_HOST is not configured we report `unavailable`
 * rather than pretending the file was scanned — the UI surfaces that honestly.
 */
export async function scanForMalware(buffer: Uint8Array): Promise<'clean' | 'infected' | 'unavailable' | 'not_run'> {
  const host = process.env.CLAMD_HOST;
  const port = Number(process.env.CLAMD_PORT ?? 3310);
  if (!host) return 'unavailable';
  try {
    const { default: net } = await import('node:net');
    return await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        socket.destroy();
        resolve('unavailable');
      }, 15_000);
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < buffer.length; i += 64 * 1024) {
          const chunk = buffer.slice(i, i + 64 * 1024);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          socket.write(Buffer.concat([header, chunk]));
        }
        socket.write(Buffer.alloc(4)); // zero-length terminator
      });
      socket.on('data', (data) => chunks.push(data));
      socket.on('end', () => {
        clearTimeout(timer);
        const reply = Buffer.concat(chunks).toString('utf8');
        resolve(/:\s*OK/.test(reply) ? 'clean' : /FOUND/.test(reply) ? 'infected' : 'unavailable');
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve('unavailable');
      });
    });
  } catch {
    return 'unavailable';
  }
}

/** Extract plain text from a resume buffer. The original file is never modified. */
export async function extractResumeText(
  buffer: Uint8Array,
  extension: AllowedExtension,
  declaredType?: string | null,
): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let text = '';

  if (extension === 'pdf') {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const pages: string[] = [];
      for (let number = 1; number <= pdf.numPages; number += 1) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        pages.push(reconstructPdfLines(content.items as PdfTextItem[]));
      }
      text = pages.join('\n\n');
      if (pdf.numPages > 12) warnings.push(`Resume has ${pdf.numPages} pages — unusually long; analysis may be truncated.`);
      if (text.replace(/\s/g, '').length < 40) {
        // Positions gave us nothing usable; take the library's own merged text rather than fail.
        const merged = await extractText(new Uint8Array(buffer), { mergePages: true });
        text = merged.text ?? text;
      }
    } catch (error) {
      if (error instanceof UploadError) throw error;
      const name = error instanceof Error ? error.name : '';
      if (/password/i.test(name) || /password/i.test(String(error))) {
        throw new UploadError('This PDF is password-protected. Remove the password and upload it again.', 'password_protected');
      }
      throw new UploadError('We could not read this PDF. It may be corrupted — try re-saving or exporting it again.', 'unreadable_file');
    }
  } else if (extension === 'docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      // mammoth puts a blank line between EVERY paragraph, but in a resume a paragraph is a line.
      // Left alone, every DOCX would read as double-spaced; collapse the separator back to a
      // single newline, while a deliberately empty paragraph (3+ newlines) stays a blank line.
      text = (result.value ?? '').replace(/\n+/g, (run) => (run.length <= 2 ? '\n' : '\n\n'));
      if (result.messages?.length) {
        const errors = result.messages.filter((m) => m.type === 'error');
        if (errors.length) warnings.push(`DOCX had ${errors.length} recoverable formatting issue(s); text may be incomplete.`);
      }
    } catch {
      throw new UploadError('We could not read this Word document. It may be corrupted — try re-saving it as DOCX or PDF.', 'unreadable_file');
    }
  } else {
    text = Buffer.from(buffer).toString('utf8');
    // Strip a UTF-8 BOM and normalise line endings so section detection is stable.
    text = text.replace(/^\uFEFF/, '');
  }

  text = normaliseText(text);
  if (!text || text.replace(/\s/g, '').length === 0) {
    throw new UploadError(
      extension === 'pdf'
        ? 'No selectable text found in this PDF. It may be a scanned image — upload an OCR/text version.'
        : 'This file contains no readable text.',
      'no_text',
    );
  }
  if (text.replace(/\s/g, '').length < 40) {
    throw new UploadError('This resume appears to be empty or nearly empty.', 'empty_resume');
  }

  const mimeType = declaredType ?? Object.keys(ALLOWED_TYPES).find((k) => ALLOWED_TYPES[k as keyof typeof ALLOWED_TYPES] === extension) ?? 'application/octet-stream';
  return { text, mimeType, extension, sha256, sizeBytes: buffer.length, warnings };
}

/** The parts of a pdf.js text item that line reconstruction needs. */
export interface PdfTextItem {
  str?: string;
  /** [a, b, c, d, e, f]: e = x, f = y (PDF y grows upward). */
  transform?: number[];
  width?: number;
  height?: number;
}

interface Cell {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rebuilds readable lines from the positioned text fragments pdf.js returns.
 *
 * A PDF stores text as independently placed fragments, not lines. Merging them blindly (the
 * library default) yields one long run with no newlines, which destroys section headings — the
 * parser can no longer tell "EDUCATION" from ordinary text. Here fragments are grouped by
 * vertical position into lines, ordered left to right, given a space only where there is a
 * visible gap, and separated into paragraphs where there is a large vertical gap.
 *
 * Two-column layouts: a wide horizontal gap starts a new segment, so side-by-side headings do
 * not fuse into one line; reading order within such pages can still interleave the columns.
 */
export function reconstructPdfLines(items: PdfTextItem[]): string {
  const cells: Cell[] = [];
  for (const item of items) {
    if (typeof item.str !== 'string' || item.str.length === 0 || !Array.isArray(item.transform)) continue;
    cells.push({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      w: item.width ?? 0,
      h: Math.max(item.height ?? 0, Math.abs(item.transform[3] ?? 0), 1),
    });
  }
  if (cells.length === 0) return '';

  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Cell[][] = [];
  for (const cell of cells) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - cell.y) <= Math.max(2, 0.45 * Math.max(line[0].h, cell.h))) line.push(cell);
    else lines.push([cell]);
  }

  const heights = lines.map((line) => Math.max(...line.map((cell) => cell.h))).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 10;

  const out: string[] = [];
  let previousY: number | null = null;
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    const segments: string[] = [];
    let text = '';
    let previous: Cell | null = null;
    for (const cell of line) {
      if (previous) {
        const gap = cell.x - (previous.x + previous.w);
        if (gap > typical * 3) {
          segments.push(text.trim());
          text = '';
        } else if (gap > typical * 0.15 && !/\s$/.test(text) && !/^\s/.test(cell.text)) {
          text += ' ';
        }
      }
      text += cell.text;
      previous = cell;
    }
    segments.push(text.trim());

    const y = line[0].y;
    if (previousY !== null && previousY - y > typical * 1.9) out.push('');
    previousY = y;
    for (const segment of segments) if (segment) out.push(segment);
  }
  return out.join('\n');
}

/** Unicode-fold, collapse whitespace, drop control characters (XSS-safe storage). */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resume files are private user data, so they are encrypted at rest with AES-256-GCM
 * when ENCRYPTION_KEY is configured. The IV and auth tag travel with the ciphertext.
 */
export function encryptAtRest(plaintext: Uint8Array): { data: Uint8Array; encrypted: boolean } {
  const key = encryptionKey();
  if (!key) return { data: plaintext, encrypted: false };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { data: Buffer.concat([iv, tag, encrypted]), encrypted: true };
}

export function decryptAtRest(payload: Uint8Array, encrypted: boolean): Uint8Array {
  if (!encrypted) return payload;
  const key = encryptionKey();
  if (!key) throw new Error('ENCRYPTION_KEY is not configured but the stored resume is encrypted.');
  const buffer = Buffer.from(payload);
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const data = buffer.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  const key = createHash('sha256').update(raw).digest();
  return key;
}
